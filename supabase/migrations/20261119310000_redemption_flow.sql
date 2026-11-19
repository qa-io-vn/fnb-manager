alter table public.redemptions
  add column rail public.coupon_rail,
  add column pos_discount_name text check (pos_discount_name is null or char_length(btrim(pos_discount_name)) between 1 and 200),
  add column pos_free_item_external_id text check (pos_free_item_external_id is null or char_length(btrim(pos_free_item_external_id)) between 1 and 100),
  add column verified_at timestamptz,
  add column verified_by uuid references auth.users (id) on delete set null,
  add column release_reason text check (release_reason is null or release_reason = 'hold_expired'),
  add column release_entry_id uuid,
  add constraint redemptions_tenant_id_release_entry_id_fkey foreign key (tenant_id, release_entry_id) references public.loyalty_ledger (tenant_id, id),
  add constraint redemptions_verified_check check (verified_by is null or verified_at is not null),
  add constraint redemptions_release_state_check check (state = 'released' or release_reason is null);

comment on column public.redemptions.rail is 'the store''s coupon rail when the hold was made: the code is a pool code (crm_code_pool) or a generated code (crm_callback, pos_payment_discount); null on rows written before phase 18b';
comment on column public.redemptions.pos_discount_name is 'pos_payment_discount: the POS payment discount entry the cashier applies, copied from coupon_rail_rewards at hold time; a synced invoice of the store carrying it confirms the redemption';
comment on column public.redemptions.pos_free_item_external_id is 'pos_payment_discount without a discount name: the 0-price promotional item whose line confirms the redemption';
comment on column public.redemptions.verified_at is 'when staff verified the code at the till (staff_verify_redemption); the redemption stays held until the synced invoice confirms it';
comment on column public.redemptions.release_entry_id is 'the ledger adjust row (reason redemption_released) that gave the held stamps and points back';

create unique index redemptions_live_tenant_code_key on public.redemptions (tenant_id, upper(code)) where state = 'held';
create unique index redemptions_confirmed_invoice_key on public.redemptions (confirmed_invoice_id) where confirmed_invoice_id is not null;
create index redemptions_held_idx on public.redemptions (tenant_id, hold_expires_at) where state = 'held';
create index redemptions_coupon_membership_idx on public.redemptions (coupon_id, membership_id);

create function app.redemption_new_code(p_tenant_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_attempt integer := 0;
begin
  loop
    v_attempt := v_attempt + 1;
    v_code := app.notify_random_code('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 8);
    exit when not exists (select 1 from public.redemptions r where r.tenant_id = p_tenant_id and upper(r.code) = v_code)
      and not exists (select 1 from public.coupon_codes k where k.tenant_id = p_tenant_id and upper(k.code) = v_code);
    if v_attempt >= 20 then
      raise exception 'no free redemption code, try again' using errcode = '55000';
    end if;
  end loop;
  return v_code;
end;
$$;

comment on function app.redemption_new_code(uuid) is 'a fresh single-use redemption code of 8 characters without look-alike letters or digits, never given before in the tenant (redemptions and pool codes), so a code shown again always names its first redemption';

create function app.redemption_spendable_stamps(p_membership_id uuid, p_at timestamptz)
returns setof public.stamps
language sql
stable
security definer
set search_path = ''
as $$
  select a.*
  from public.stamps a
  where a.membership_id = p_membership_id
    and a.state = 'active'
    and a.earned_at <= p_at
    and a.expires_at > p_at
    and not exists (
      select 1
      from public.loyalty_ledger e
      where e.id = a.earn_entry_id
        and e.pending
        and not exists (select 1 from public.loyalty_ledger c where c.entry_kind = 'confirm' and c.source_entry_id = e.id)
    )
  order by a.expires_at, a.earned_at, a.id;
$$;

comment on function app.redemption_spendable_stamps(uuid, timestamptz) is 'the active stamps of a membership a redemption may use at a moment, oldest expiry first: not expired and not credited by an earn still waiting for its confirm row';

create function app.redeem_coupon(p_membership_id uuid, p_coupon_id uuid, p_store_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_membership public.memberships;
  v_programme public.loyalty_programmes;
  v_coupon public.coupons;
  v_store public.stores;
  v_today date;
  v_rail public.coupon_rail;
  v_mapping public.coupon_rail_rewards;
  v_balance record;
  v_spendable integer;
  v_pool public.coupon_codes;
  v_code text;
  v_refusal text;
  v_expires timestamptz;
  v_entry uuid;
  v_id uuid;
  v_closed integer;
begin
  select m.* into v_membership from public.memberships m where m.id = p_membership_id for update;
  if v_membership.id is null then
    raise exception 'redeem_coupon needs an existing membership' using errcode = '22023';
  end if;
  select p.* into v_programme from public.loyalty_programmes p where p.id = v_membership.programme_id;
  select c.* into v_coupon from public.coupons c where c.id = p_coupon_id and c.tenant_id = v_membership.tenant_id;
  select s.* into v_store from public.stores s where s.id = p_store_id and s.tenant_id = v_membership.tenant_id;
  v_today := app.store_business_date(v_store.id, p_at);

  if v_membership.status <> 'active' then
    v_refusal := 'membership_inactive';
  elsif v_store.id is null or not v_store.active then
    v_refusal := 'store_unavailable';
  elsif v_programme.status <> 'active' or v_today < v_programme.starts_on or (v_programme.ends_on is not null and v_today > v_programme.ends_on) then
    v_refusal := 'programme_inactive';
  elsif v_coupon.id is null
    or v_coupon.programme_id <> v_membership.programme_id
    or not v_coupon.active
    or (v_coupon.valid_from is not null and v_today < v_coupon.valid_from)
    or (v_coupon.valid_until is not null and v_today > v_coupon.valid_until)
  then
    v_refusal := 'coupon_unavailable';
  elsif v_coupon.store_ids is not null and not (p_store_id = any (v_coupon.store_ids)) then
    v_refusal := 'store_unavailable';
  else
    select r.rail into v_rail
    from public.coupon_rails r
    where r.store_id = p_store_id and r.active_until is null and r.active_from <= p_at;
    select w.* into v_mapping
    from public.coupon_rail_rewards w
    where w.store_id = p_store_id and w.reward_key = v_coupon.reward_key and w.active;
    if v_rail is null
      or v_mapping.id is null
      or (v_rail = 'pos_payment_discount' and v_mapping.pos_discount_name is null and v_mapping.pos_free_item_external_id is null)
    then
      v_refusal := 'rail_not_ready';
    elsif exists (
      select 1 from public.redemptions r
      where r.membership_id = p_membership_id and r.coupon_id = v_coupon.id and r.state = 'held'
    ) then
      v_refusal := 'already_held';
    elsif v_coupon.per_member_limit is not null and (
      select count(*) from public.redemptions r
      where r.membership_id = p_membership_id and r.coupon_id = v_coupon.id and r.state in ('held', 'confirmed')
    ) >= v_coupon.per_member_limit then
      v_refusal := 'member_limit_reached';
    else
      select b.* into v_balance from app.loyalty_balance(p_membership_id, p_at) b;
      select count(*) into v_spendable from app.redemption_spendable_stamps(p_membership_id, p_at);
      if v_coupon.cost_stamps > 0 and (v_balance.stamps < v_coupon.cost_stamps or v_spendable < v_coupon.cost_stamps) then
        v_refusal := 'insufficient_stamps';
      elsif v_coupon.cost_points > 0 and v_balance.points < v_coupon.cost_points then
        v_refusal := 'insufficient_points';
      end if;
    end if;
  end if;

  v_expires := least(
    p_at + make_interval(hours => v_coupon.hold_hours),
    p_at + make_interval(days => v_coupon.valid_days),
    case when v_coupon.valid_until is not null then
      ((v_coupon.valid_until + 1)::timestamp + make_interval(mins => v_store.business_day_start_minutes)) at time zone v_store.timezone
    end
  );
  if v_refusal is null and v_rail = 'crm_code_pool' then
    select k.* into v_pool
    from public.coupon_codes k
    where k.store_id = p_store_id
      and k.reward_key = v_coupon.reward_key
      and k.state = 'available'
      and (k.expires_at is null or k.expires_at > v_expires)
      and not exists (
        select 1 from public.redemptions r
        where r.tenant_id = k.tenant_id and upper(r.code) = upper(k.code) and r.state = 'held'
      )
    order by k.imported_at, k.id
    limit 1
    for update skip locked;
    if v_pool.id is null then
      v_refusal := 'no_code_available';
    end if;
  end if;
  if v_refusal is not null then
    return jsonb_build_object('redemption_id', null, 'state', null, 'refusal', v_refusal);
  end if;

  v_code := coalesce(v_pool.code, app.redemption_new_code(v_membership.tenant_id));
  insert into public.loyalty_ledger (
    tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, point_delta, value_amount,
    business_date, pending, reason, occurred_at
  )
  values (
    v_membership.tenant_id, v_programme.id, p_membership_id, p_store_id, 'redeem', -v_coupon.cost_stamps, -v_coupon.cost_points,
    -round(v_coupon.cost_points * v_programme.point_value_amount, 2), v_today, true, 'redemption', p_at
  )
  returning id into v_entry;
  if v_coupon.cost_stamps > 0 then
    update public.stamps s
    set state = 'redeemed', closed_entry_id = v_entry, closed_at = p_at
    where s.id in (select a.id from app.redemption_spendable_stamps(p_membership_id, p_at) a limit v_coupon.cost_stamps);
    get diagnostics v_closed = row_count;
    if v_closed <> v_coupon.cost_stamps then
      raise exception 'the membership''s stamps changed during the redemption, try again' using errcode = '40001';
    end if;
  end if;
  insert into public.redemptions (
    tenant_id, store_id, membership_id, coupon_id, coupon_code_id, code, state, held_at, hold_expires_at, redeem_entry_id,
    rail, pos_discount_name, pos_free_item_external_id
  )
  values (
    v_membership.tenant_id, p_store_id, p_membership_id, v_coupon.id, v_pool.id, v_code, 'held', p_at, v_expires, v_entry,
    v_rail,
    case when v_rail = 'pos_payment_discount' then v_mapping.pos_discount_name end,
    case when v_rail = 'pos_payment_discount' and v_mapping.pos_discount_name is null then v_mapping.pos_free_item_external_id end
  )
  returning id into v_id;
  if v_pool.id is not null then
    update public.coupon_codes k set state = 'assigned', assigned_at = p_at where k.id = v_pool.id;
  end if;
  return jsonb_build_object(
    'redemption_id', v_id,
    'state', 'held',
    'refusal', null,
    'code', v_code,
    'rail', v_rail,
    'coupon_id', v_coupon.id,
    'store_id', p_store_id,
    'held_at', p_at,
    'hold_expires_at', v_expires,
    'stamps_spent', v_coupon.cost_stamps,
    'points_spent', v_coupon.cost_points
  );
end;
$$;

comment on function app.redeem_coupon(uuid, uuid, uuid, timestamptz) is 'redeems a reward for a membership at a store: a pending ledger redeem row holds the reward''s stamps (closing the oldest spendable stamps) and points, and a held redemption carries a single-use code chosen by the store''s rail (an available pool code for crm_code_pool, a generated code for crm_callback and pos_payment_discount, with the discount entry name or 0-price item of the fallback rail copied from the mapping); the hold lasts hold_hours, at most valid_days and never past valid_until; refusals are answered, not raised: membership_inactive, store_unavailable, programme_inactive, coupon_unavailable, rail_not_ready, already_held, member_limit_reached, insufficient_stamps, insufficient_points, no_code_available; returns {redemption_id, state, refusal, code, rail, coupon_id, store_id, held_at, hold_expires_at, stamps_spent, points_spent}; service role only';

create function app.confirm_redemption(p_redemption_id uuid, p_invoice_id uuid, p_at timestamptz default now())
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_redemption public.redemptions;
  v_earn record;
begin
  update public.redemptions r
  set state = 'confirmed', confirmed_invoice_id = p_invoice_id, confirmed_at = p_at
  where r.id = p_redemption_id and r.state = 'held'
  returning r.* into v_redemption;
  if v_redemption.id is null then
    return null;
  end if;
  if v_redemption.redeem_entry_id is not null
    and exists (select 1 from public.loyalty_ledger l where l.id = v_redemption.redeem_entry_id and l.pending)
  then
    perform app.loyalty_confirm(v_redemption.redeem_entry_id, p_invoice_id, p_at);
  end if;
  if v_redemption.coupon_code_id is not null then
    update public.coupon_codes k
    set state = 'used', used_invoice_id = p_invoice_id, used_at = p_at
    where k.id = v_redemption.coupon_code_id and k.state in ('available', 'assigned');
  end if;
  if not exists (select 1 from public.loyalty_ledger l where l.invoice_id = p_invoice_id and l.entry_kind = 'earn')
    and not exists (select 1 from public.loyalty_refusals f where f.invoice_id = p_invoice_id and f.membership_id = v_redemption.membership_id)
  then
    select e.* into v_earn from app.loyalty_earn(p_invoice_id, v_redemption.membership_id, 'D', p_at) e;
    return case when v_earn.entry_id is not null then 'earned' else 'refused' end;
  end if;
  return 'confirmed';
end;
$$;

comment on function app.confirm_redemption(uuid, uuid, timestamptz) is 'confirms a held redemption with the synced invoice that carries it: the redemption becomes confirmed (Đã dùng), its pending redeem row gets its confirm row, its pool code becomes used, and the invoice earns for the member on path D unless it already earned or was refused for them; returns earned, refused or confirmed, or null when the redemption was not held; service role only';

create function app.redemption_confirming_invoice(p_redemption_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_redemption public.redemptions;
  v_before integer;
  v_after integer;
  v_invoice uuid;
begin
  select r.* into v_redemption from public.redemptions r where r.id = p_redemption_id;
  if v_redemption.id is null or v_redemption.state <> 'held' then
    return null;
  end if;
  if v_redemption.rail = 'pos_payment_discount' then
    if v_redemption.verified_at is null then
      return null;
    end if;
    select p.checkin_window_before_minutes, p.checkin_window_after_minutes into v_before, v_after
    from public.memberships m
    join public.loyalty_programmes p on p.id = m.programme_id
    where m.id = v_redemption.membership_id;
    select i.id into v_invoice
    from public.invoices i
    where i.tenant_id = v_redemption.tenant_id
      and i.store_id = v_redemption.store_id
      and i.status = 'completed'
      and i.sold_at >= v_redemption.verified_at - make_interval(mins => v_before)
      and i.sold_at <= v_redemption.verified_at + make_interval(mins => v_after)
      and (
        (v_redemption.pos_discount_name is not null and lower(btrim(i.bill_discount_name)) = lower(btrim(v_redemption.pos_discount_name)))
        or (
          v_redemption.pos_discount_name is null
          and v_redemption.pos_free_item_external_id is not null
          and exists (
            select 1 from public.invoice_lines l
            where l.invoice_id = i.id
              and l.line_kind = 'item'
              and l.item_external_id = v_redemption.pos_free_item_external_id
              and l.net_amount = 0
          )
        )
      )
      and not exists (select 1 from public.redemptions o where o.confirmed_invoice_id = i.id)
    order by abs(extract(epoch from i.sold_at - v_redemption.verified_at)), i.external_id collate "C"
    limit 1;
    return v_invoice;
  end if;
  select i.id into v_invoice
  from public.invoices i
  where i.tenant_id = v_redemption.tenant_id
    and (v_redemption.store_id is null or i.store_id = v_redemption.store_id)
    and i.status = 'completed'
    and i.voucher_code is not null
    and upper(btrim(i.voucher_code)) = upper(v_redemption.code)
    and not exists (select 1 from public.redemptions o where o.confirmed_invoice_id = i.id)
  order by i.sold_at, i.external_id collate "C"
  limit 1;
  return v_invoice;
end;
$$;

comment on function app.redemption_confirming_invoice(uuid) is 'the synced invoice that confirms a held redemption, or null: on pos_payment_discount, a completed invoice of the store carrying the discount entry name (or the 0-price line of the free item) sold within the programme''s check-in window around the staff verification (checkin_window_before_minutes before to checkin_window_after_minutes after), closest first, and nothing before staff verified the code; on the code rails, a completed invoice of the store carrying the code as its voucher code; an invoice that already confirms a redemption never confirms another';

create function app.release_redemption(p_redemption_id uuid, p_reason text, p_at timestamptz default now())
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_redemption public.redemptions;
  v_hold public.loyalty_ledger;
  v_entry uuid;
begin
  select r.* into v_redemption from public.redemptions r where r.id = p_redemption_id for update;
  if v_redemption.id is null or v_redemption.state <> 'held' then
    return null;
  end if;
  select l.* into v_hold from public.loyalty_ledger l where l.id = v_redemption.redeem_entry_id;
  if v_hold.id is not null and (v_hold.stamp_delta <> 0 or v_hold.point_delta <> 0) then
    insert into public.loyalty_ledger (
      tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, point_delta, value_amount,
      business_date, source_entry_id, reason, occurred_at
    )
    values (
      v_hold.tenant_id, v_hold.programme_id, v_hold.membership_id, v_hold.store_id, 'adjust', -v_hold.stamp_delta, -v_hold.point_delta,
      -v_hold.value_amount, app.store_business_date(v_hold.store_id, p_at), v_hold.id, 'redemption_released', p_at
    )
    returning id into v_entry;
    update public.stamps s
    set state = 'active', closed_entry_id = null, closed_at = null
    where s.closed_entry_id = v_hold.id
      and s.state = 'redeemed';
  end if;
  update public.redemptions r
  set state = 'released', released_at = p_at, release_reason = p_reason, release_entry_id = v_entry
  where r.id = p_redemption_id;
  if v_redemption.coupon_code_id is not null then
    update public.coupon_codes k
    set state = 'quarantined', quarantined_at = p_at
    where k.id = v_redemption.coupon_code_id and k.state in ('available', 'assigned');
  end if;
  return v_entry;
end;
$$;

comment on function app.release_redemption(uuid, text, timestamptz) is 'releases a held redemption (Đã hoàn lại): an adjust row with reason redemption_released and the opposite deltas of the hold (source_entry_id the redeem row) gives the stamps and points back, the stamps the hold closed become active again with their own expiry, the redemption becomes released and its pool code quarantined; returns the adjust row, or null when nothing was held; service role only';

create function app.release_redemption_holds(p_tenant_id uuid, p_as_of timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_invoice uuid;
  v_released integer := 0;
  v_confirmed integer := 0;
  v_quarantined integer := 0;
begin
  for v_row in
    select r.id, r.coupon_code_id
    from public.redemptions r
    where r.tenant_id = p_tenant_id
      and r.state = 'held'
      and r.hold_expires_at <= p_as_of
    order by r.hold_expires_at, r.id
  loop
    v_invoice := app.redemption_confirming_invoice(v_row.id);
    if v_invoice is not null then
      if app.confirm_redemption(v_row.id, v_invoice, p_as_of) is not null then
        v_confirmed := v_confirmed + 1;
      end if;
      continue;
    end if;
    perform app.release_redemption(v_row.id, 'hold_expired', p_as_of);
    if exists (select 1 from public.redemptions r where r.id = v_row.id and r.state = 'released') then
      v_released := v_released + 1;
      if v_row.coupon_code_id is not null then
        v_quarantined := v_quarantined + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('released_holds', v_released, 'late_confirmed_holds', v_confirmed, 'quarantined_codes', v_quarantined);
end;
$$;

comment on function app.release_redemption_holds(uuid, timestamptz) is 'the 24-hour release of the nightly step: every held redemption of the tenant whose hold_expires_at has passed is confirmed when its invoice is already synced (app.redemption_confirming_invoice), and otherwise released with its stamps and points given back and its pool code quarantined (app.release_redemption); idempotent for a moment; counts only';

create or replace function app.loyalty_expiring_points(p_membership_id uuid, p_as_of timestamptz)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with rows as (
    select l.*
    from public.loyalty_ledger l
    where l.membership_id = p_membership_id
      and l.occurred_at <= p_as_of
  ),
  credits as (
    select
      c.point_delta + coalesce((select sum(r.point_delta) from rows r where r.entry_kind = 'clawback' and r.source_entry_id = c.id), 0) as net,
      c.expires_at
    from rows c
    where c.point_delta > 0
      and c.entry_kind in ('earn', 'adjust')
      and c.reason is distinct from 'redemption_released'
  ),
  debits as (
    select coalesce(-sum(r.point_delta), 0) as total
    from rows r
    where r.entry_kind in ('redeem', 'expire')
       or (r.entry_kind = 'adjust' and (r.point_delta < 0 or r.reason = 'redemption_released'))
  )
  select greatest(
    coalesce((select sum(c.net) from credits c where c.expires_at is not null and c.expires_at <= p_as_of), 0)
      - (select d.total from debits d),
    0
  )::integer;
$$;

comment on function app.loyalty_expiring_points(uuid, timestamptz) is 'the points of a membership that expire by p_as_of, first in first out: the credits whose expiry has passed (net of their clawbacks) less every point already spent, held, adjusted away or expired; a released redemption hold (adjust, reason redemption_released) cancels its hold instead of counting as a new credit, so the points it gives back keep the expiry of the credits they came from';

create or replace function app.loyalty_liability(p_programme_id uuid, p_as_of timestamptz default now())
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_programme public.loyalty_programmes%rowtype;
  v_timezone text;
  v_date date;
  v_day_start timestamptz;
  v_members integer;
  v_points bigint;
  v_stamps bigint;
  v_first_expiry timestamptz;
  v_spent bigint;
  v_expired bigint;
  v_rate numeric;
  v_source text;
  v_issued bigint;
  v_redeemed bigint;
  v_expired_day bigint;
  v_clawed bigint;
  v_cohorts jsonb;
  v_id uuid;
begin
  select p.* into v_programme from public.loyalty_programmes p where p.id = p_programme_id;
  if not found then
    raise exception 'loyalty_liability needs an existing programme' using errcode = '22023';
  end if;
  select t.timezone into v_timezone from public.tenants t where t.id = v_programme.tenant_id;
  v_date := (p_as_of at time zone v_timezone)::date;
  v_day_start := v_date::timestamp at time zone v_timezone;

  with balances as (
    select
      m.id,
      coalesce(sum(l.point_delta) filter (where not (l.entry_kind = 'earn' and l.pending and not exists (
        select 1 from public.loyalty_ledger c where c.entry_kind = 'confirm' and c.source_entry_id = l.id and c.occurred_at <= p_as_of
      ))), 0) as points,
      coalesce(sum(l.stamp_delta) filter (where not (l.entry_kind = 'earn' and l.pending and not exists (
        select 1 from public.loyalty_ledger c where c.entry_kind = 'confirm' and c.source_entry_id = l.id and c.occurred_at <= p_as_of
      ))), 0) as stamps
    from public.memberships m
    left join public.loyalty_ledger l on l.membership_id = m.id and l.occurred_at <= p_as_of
    where m.programme_id = p_programme_id
      and m.joined_at <= p_as_of
    group by m.id
  )
  select count(*), coalesce(sum(greatest(b.points, 0)), 0), coalesce(sum(greatest(b.stamps, 0)), 0)
  into v_members, v_points, v_stamps
  from balances b;

  select min(l.occurred_at) into v_first_expiry
  from public.loyalty_ledger l
  where l.programme_id = p_programme_id and l.entry_kind = 'expire' and l.point_delta < 0 and l.occurred_at <= p_as_of;
  if v_first_expiry is not null and v_first_expiry <= p_as_of - interval '6 months' then
    select
      coalesce(-sum(l.point_delta) filter (where l.entry_kind = 'expire'), 0),
      coalesce(-sum(l.point_delta) filter (where l.entry_kind in ('redeem', 'expire') or (l.entry_kind = 'adjust' and l.reason = 'redemption_released')), 0)
    into v_expired, v_spent
    from public.loyalty_ledger l
    where l.programme_id = p_programme_id
      and l.occurred_at > p_as_of - interval '12 months'
      and l.occurred_at <= p_as_of;
    if v_spent > 0 then
      v_rate := least(round(v_expired::numeric / v_spent, 3), 1);
      v_source := 'observed';
    end if;
  end if;
  if v_source is null then
    v_rate := v_programme.expected_breakage_rate;
    v_source := 'configured';
  end if;

  select
    coalesce(sum(l.point_delta) filter (where l.point_delta > 0 and l.entry_kind in ('earn', 'adjust') and l.reason is distinct from 'redemption_released'), 0),
    coalesce(-sum(l.point_delta) filter (where l.entry_kind = 'redeem' or (l.entry_kind = 'adjust' and l.reason = 'redemption_released')), 0),
    coalesce(-sum(l.point_delta) filter (where l.entry_kind = 'expire'), 0),
    coalesce(-sum(l.point_delta) filter (where l.entry_kind = 'clawback'), 0)
  into v_issued, v_redeemed, v_expired_day, v_clawed
  from public.loyalty_ledger l
  where l.programme_id = p_programme_id
    and l.occurred_at >= v_day_start
    and l.occurred_at <= p_as_of;

  select coalesce(jsonb_agg(jsonb_build_object('month', c.month, 'issued', c.issued, 'expired', c.expired) order by c.month), '[]'::jsonb)
  into v_cohorts
  from (
    select
      to_char(k.month, 'YYYY-MM') as month,
      coalesce(sum(k.issued), 0)::bigint as issued,
      coalesce(sum(k.expired), 0)::bigint as expired
    from (
      select date_trunc('month', l.occurred_at at time zone v_timezone) as month, l.point_delta as issued, 0 as expired
      from public.loyalty_ledger l
      where l.programme_id = p_programme_id and l.occurred_at <= p_as_of and l.point_delta > 0 and l.entry_kind in ('earn', 'adjust')
        and l.reason is distinct from 'redemption_released'
      union all
      select date_trunc('month', (l.occurred_at at time zone v_timezone) - make_interval(months => v_programme.points_expiry_months)), 0, -l.point_delta
      from public.loyalty_ledger l
      where l.programme_id = p_programme_id and l.occurred_at <= p_as_of and l.entry_kind = 'expire' and l.point_delta < 0
    ) k
    group by k.month
  ) c;

  insert into public.loyalty_liability_daily (
    tenant_id, programme_id, as_of_date, as_of, members, outstanding_points, outstanding_stamps, point_value_amount,
    expected_breakage_rate, breakage_source, liability_amount, points_issued, points_redeemed, points_expired, points_clawed_back,
    deferred_revenue_released_amount, breakage_by_cohort, computed_at
  )
  values (
    v_programme.tenant_id, p_programme_id, v_date, p_as_of, v_members, v_points, v_stamps, v_programme.point_value_amount,
    v_rate, v_source, round(v_points * v_programme.point_value_amount * (1 - v_rate), 2), v_issued, v_redeemed, v_expired_day, v_clawed,
    round(v_redeemed * v_programme.point_value_amount, 2), v_cohorts, now()
  )
  on conflict (programme_id, as_of_date) do update set
    as_of = excluded.as_of,
    members = excluded.members,
    outstanding_points = excluded.outstanding_points,
    outstanding_stamps = excluded.outstanding_stamps,
    point_value_amount = excluded.point_value_amount,
    expected_breakage_rate = excluded.expected_breakage_rate,
    breakage_source = excluded.breakage_source,
    liability_amount = excluded.liability_amount,
    points_issued = excluded.points_issued,
    points_redeemed = excluded.points_redeemed,
    points_expired = excluded.points_expired,
    points_clawed_back = excluded.points_clawed_back,
    deferred_revenue_released_amount = excluded.deferred_revenue_released_amount,
    breakage_by_cohort = excluded.breakage_by_cohort,
    computed_at = excluded.computed_at
  returning id into v_id;
  return v_id;
end;
$$;

comment on function app.loyalty_liability(uuid, timestamptz) is 'computes and stores (one row per programme and local day, replaced on a re-run) the liability of a programme as of a moment: outstanding points times point_value_amount times (1 - expected breakage), the configured rate until the first expiry is six months old, then the observed share of expired points among redeemed and expired points of the last 12 months; a released redemption hold (adjust, reason redemption_released) nets out of the redeemed points and is not issued; returns the row id';

alter function app.loyalty_nightly(uuid, timestamptz) rename to loyalty_nightly_steps;

comment on function app.loyalty_nightly_steps(uuid, timestamptz) is 'the phase 17 part of the nightly loyalty step, called by app.loyalty_nightly after the redemption release: claws back the earns of invoices the re-pull marked voided or edited, expires stamps and points, and stores the liability of each active or paused programme; idempotent for a moment; counts only';

create function app.loyalty_nightly(p_tenant_id uuid, p_as_of timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_release jsonb;
begin
  if not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    raise exception 'loyalty_nightly needs an existing tenant' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('reconcile_loyalty:' || p_tenant_id::text));
  v_release := app.release_redemption_holds(p_tenant_id, p_as_of);
  return app.loyalty_nightly_steps(p_tenant_id, p_as_of) || v_release;
end;
$$;

comment on function app.loyalty_nightly(uuid, timestamptz) is 'the nightly loyalty step of a tenant after the nightly sync: first the 24-hour release of expired redemption holds (app.release_redemption_holds), then app.loyalty_nightly_steps (clawbacks of voided or edited invoices, stamp and point expiry, so a returned stamp past its expiry expires the same night, and the liability); idempotent for a moment; counts only: clawbacks, expired_memberships, expired_stamps, expired_points, liability_rows, released_holds, late_confirmed_holds, quarantined_codes';

create function app.customer_redeem(p_coupon uuid, p_store text, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_login app.customer_logins := app.customer_session();
  v_membership public.memberships := app.customer_session_membership();
  v_store uuid;
  v_store_code text;
  v_store_name text;
  v_result jsonb;
  v_balance record;
begin
  if p_coupon is null then
    raise exception 'customer_redeem names the reward' using errcode = '22023';
  end if;
  v_store := app.customer_app_store(v_login.zalo_app_id, p_store);
  if v_store is null then
    raise exception 'the store is not a store of this app' using errcode = '22023';
  end if;
  select s.code, s.name into v_store_code, v_store_name from app.customer_app_stores(v_login.zalo_app_id) s where s.store_id = v_store;
  v_result := app.redeem_coupon(v_membership.id, p_coupon, v_store, p_at);
  select b.stamps, b.points into v_balance from app.loyalty_balance(v_membership.id, p_at) b;
  return v_result || jsonb_build_object(
    'store_code', v_store_code,
    'store_name', v_store_name,
    'qr_payload', case when v_result ->> 'code' is not null then 'fnb-redeem:1:' || (v_result ->> 'code') end,
    'seconds_left', case when v_result ->> 'hold_expires_at' is not null
      then greatest(floor(extract(epoch from ((v_result ->> 'hold_expires_at')::timestamptz - p_at))), 0)::integer end,
    'stamps', v_balance.stamps,
    'points', v_balance.points
  );
end;
$$;

comment on function app.customer_redeem(uuid, text, timestamptz) is 'Đổi quà: a joined customer redeems a reward at a store of the app''s brand (its customer store code) through app.redeem_coupon; answers {redemption_id, state held, refusal null, code, qr_payload fnb-redeem:1:<code>, rail, coupon_id, store_id, store_code, store_name, held_at, hold_expires_at, seconds_left, stamps_spent, points_spent, stamps, points}, or {refusal, stamps, points, store_code, store_name} with the refusal of app.redeem_coupon; 22023 for a missing reward or a store the app does not offer; 42501 for a visitor and every other caller';

create function app.customer_coupons(p_store text default null, p_at timestamptz default now())
returns table (
  coupon_id uuid,
  reward_key text,
  name text,
  description text,
  reward_kind public.coupon_reward_kind,
  reward_percent numeric,
  reward_item_names text[],
  cost_stamps smallint,
  cost_points integer,
  store_codes text[],
  valid_from date,
  valid_until date,
  hold_hours smallint,
  per_member_limit smallint,
  redeemed integer,
  live_redemption_id uuid,
  affordable boolean,
  stamps_short integer,
  points_short integer,
  available boolean,
  unavailable_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_login app.customer_logins := app.customer_session();
  v_membership public.memberships := app.customer_session_membership();
  v_store uuid;
  v_today date;
  v_stamps integer;
  v_points integer;
  v_spendable integer;
begin
  if p_store is not null then
    v_store := app.customer_app_store(v_login.zalo_app_id, p_store);
    if v_store is null then
      raise exception 'the store is not a store of this app' using errcode = '22023';
    end if;
    v_today := app.store_business_date(v_store, p_at);
  else
    select (p_at at time zone t.timezone)::date into v_today from public.tenants t where t.id = v_membership.tenant_id;
  end if;
  select b.stamps, b.points into v_stamps, v_points from app.loyalty_balance(v_membership.id, p_at) b;
  select count(*)::integer into v_spendable from app.redemption_spendable_stamps(v_membership.id, p_at);
  v_stamps := least(coalesce(v_stamps, 0), v_spendable);
  v_points := coalesce(v_points, 0);
  return query
  with app_stores as (
    select s.store_id, s.code from app.customer_app_stores(v_login.zalo_app_id) s
  ),
  catalogue as (
    select
      c.*,
      (select array_agg(a.code order by a.code) from app_stores a where a.store_id = any (c.store_ids)) as codes,
      (select count(*)::integer from public.redemptions r
        where r.membership_id = v_membership.id and r.coupon_id = c.id and r.state in ('held', 'confirmed')) as used,
      (select r.id from public.redemptions r
        where r.membership_id = v_membership.id and r.coupon_id = c.id and r.state = 'held'
        order by r.held_at desc limit 1) as live,
      v_store is null or exists (
        select 1
        from public.coupon_rails k
        join public.coupon_rail_rewards w on w.store_id = k.store_id and w.reward_key = c.reward_key and w.active
        where k.store_id = v_store
          and k.active_until is null
          and k.active_from <= p_at
          and (k.rail <> 'pos_payment_discount' or w.pos_discount_name is not null or w.pos_free_item_external_id is not null)
      ) as rail_ready
    from public.coupons c
    where c.programme_id = v_membership.programme_id
      and c.active
      and (c.valid_from is null or c.valid_from <= v_today)
      and (c.valid_until is null or c.valid_until >= v_today)
      and (
        (v_store is not null and (c.store_ids is null or v_store = any (c.store_ids)))
        or (v_store is null and (c.store_ids is null or exists (select 1 from app_stores a where a.store_id = any (c.store_ids))))
      )
  ),
  judged as (
    select
      x.*,
      x.cost_stamps <= v_stamps and x.cost_points <= v_points as can_pay,
      case
        when v_membership.status <> 'active' then 'membership_inactive'
        when x.live is not null then 'already_held'
        when x.per_member_limit is not null and x.used >= x.per_member_limit then 'member_limit_reached'
        when not x.rail_ready then 'rail_not_ready'
        when x.cost_stamps > v_stamps then 'insufficient_stamps'
        when x.cost_points > v_points then 'insufficient_points'
      end as reason
    from catalogue x
  )
  select
    j.id,
    j.reward_key,
    j.name,
    j.description,
    j.reward_kind,
    j.reward_percent,
    (
      select array_agg(n.item_name order by n.position)
      from (
        select u.position, coalesce(
          (select min(i.name) from public.items i where i.tenant_id = j.tenant_id and i.external_id = u.external_id),
          u.external_id
        ) as item_name
        from unnest(j.reward_item_external_ids) with ordinality as u (external_id, position)
      ) n
    ),
    j.cost_stamps,
    j.cost_points,
    case when j.store_ids is null then null else coalesce(j.codes, '{}'::text[]) end,
    j.valid_from,
    j.valid_until,
    j.hold_hours,
    j.per_member_limit,
    j.used,
    j.live,
    j.can_pay,
    greatest(j.cost_stamps - v_stamps, 0),
    greatest(j.cost_points - v_points, 0),
    j.reason is null,
    j.reason
  from judged j
  order by j.cost_stamps, j.cost_points, j.name, j.id;
end;
$$;

comment on function app.customer_coupons(text, timestamptz) is 'Đổi quà: the active rewards of a joined customer''s programme valid today, for one store of the app''s brand (its customer store code) or every store of it, each with what it costs, whether the member can afford it (spendable stamps and points: confirmed, not held, not expired) and whether it can be redeemed now, else why (membership_inactive, already_held, member_limit_reached, rail_not_ready, insufficient_stamps, insufficient_points); rewards are described by kind, percentage and item names, never by an amount; 22023 for a store the app does not offer, 42501 for a visitor and every other caller';

create function app.customer_vouchers(p_at timestamptz default now())
returns table (
  redemption_id uuid,
  coupon_id uuid,
  coupon_name text,
  reward_kind public.coupon_reward_kind,
  reward_percent numeric,
  store_code text,
  store_name text,
  code text,
  qr_payload text,
  state public.redemption_state,
  display_state text,
  held_at timestamptz,
  hold_expires_at timestamptz,
  seconds_left integer,
  verified boolean,
  confirmed_at timestamptz,
  released_at timestamptz,
  stamps_spent integer,
  points_spent integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_customer uuid := app.customer_session_customer();
begin
  return query
  select
    r.id,
    c.id,
    c.name,
    c.reward_kind,
    c.reward_percent,
    app.customer_store_code(s.code, s.external_id),
    s.name,
    case when r.state = 'held' and r.hold_expires_at > p_at then r.code end,
    case when r.state = 'held' and r.hold_expires_at > p_at
      then 'fnb-redeem:1:' || r.code end,
    r.state,
    case
      when r.state = 'held' and r.hold_expires_at > p_at then 'held'
      when r.state = 'held' then 'expired'
      when r.state = 'confirmed' then 'used'
      when r.state = 'released' then 'returned'
      else 'cancelled'
    end,
    r.held_at,
    r.hold_expires_at,
    case when r.state = 'held' then greatest(floor(extract(epoch from (r.hold_expires_at - p_at))), 0)::integer end,
    r.verified_at is not null,
    r.confirmed_at,
    r.released_at,
    coalesce(-l.stamp_delta, c.cost_stamps)::integer,
    coalesce(-l.point_delta, c.cost_points)::integer
  from public.redemptions r
  join public.memberships m on m.id = r.membership_id
  join public.coupons c on c.id = r.coupon_id
  left join public.stores s on s.id = r.store_id
  left join public.loyalty_ledger l on l.id = r.redeem_entry_id
  where m.customer_id = v_customer
    and r.held_at <= p_at
    and (r.state = 'held' or r.held_at > p_at - interval '90 days')
  order by (r.state = 'held') desc, r.held_at desc, r.id
  limit 100;
end;
$$;

comment on function app.customer_vouchers(timestamptz) is 'Ví voucher: a joined customer''s redemptions, the held ones first and the others of the last 90 days, newest first, at most 100: the reward, the store, the code and its QR payload while the hold runs, the state and its display (held, expired while the release is pending, used for Đã dùng, returned for Đã hoàn lại, cancelled), the hold''s end and the seconds left, whether staff verified it and what it held; 42501 for a visitor and every other caller';

create function app.staff_verify_redemption(p_store_id uuid, p_code text, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_raw text := btrim(p_code);
  v_code text;
  v_store public.stores;
  v_redemption public.redemptions;
  v_coupon public.coupons;
  v_membership public.memberships;
  v_customer public.customers;
  v_window integer;
  v_reason text;
  v_refusal text;
  v_first boolean := false;
  v_item_name text;
begin
  select s.* into v_store from public.stores s where s.id = p_store_id;
  if v_store.id is null
    or v_uid is null
    or not app.has_store_scope(v_store.tenant_id, v_store.id, array['owner', 'manager', 'staff']::public.tenant_role[])
  then
    raise exception 'only an owner, manager or staff member of the store verifies a code there' using errcode = '42501';
  end if;
  v_code := coalesce(substring(v_raw from '^fnb-redeem:[0-9]+:(.+)$'), v_raw);
  if v_code is null or char_length(v_code) not between 1 and 64 or v_code ~ '[[:space:][:cntrl:]]' then
    raise exception 'a reward code holds 1 to 64 characters without spaces, or is its QR payload fnb-redeem:1:<code>' using errcode = '22023';
  end if;

  select r.* into v_redemption
  from public.redemptions r
  where r.tenant_id = v_store.tenant_id
    and upper(r.code) = upper(v_code)
  order by (r.store_id = p_store_id) desc, (r.state = 'held') desc, r.held_at desc, r.id
  limit 1
  for update;
  select p.checkin_window_after_minutes into v_window
  from public.memberships m
  join public.loyalty_programmes p on p.id = m.programme_id
  where m.id = v_redemption.membership_id;

  if v_redemption.id is null then
    v_reason := 'unknown_code';
  elsif v_redemption.store_id is distinct from p_store_id then
    v_reason := 'other_store';
  elsif v_redemption.state = 'confirmed' then
    v_reason := 'used';
  elsif v_redemption.state = 'released' then
    v_reason := 'released';
  elsif v_redemption.state = 'cancelled' then
    v_reason := 'cancelled';
  elsif v_redemption.hold_expires_at <= p_at then
    v_reason := 'expired';
  elsif v_redemption.verified_at is not null
    and not (v_redemption.verified_by is not distinct from v_uid and v_redemption.verified_at > p_at - make_interval(mins => v_window))
  then
    v_reason := 'already_verified';
  end if;

  if v_reason is not null then
    v_refusal := case v_reason
      when 'unknown_code' then 'unknown'
      when 'other_store' then 'wrong_store'
      when 'already_verified' then 'used'
      when 'cancelled' then 'released'
      else v_reason
    end;
    return jsonb_build_object(
      'state', 'refused',
      'refusal', v_refusal,
      'reason', v_reason,
      'text_key', 'redeem.refusal.' || v_refusal,
      'used_at', case v_reason when 'used' then v_redemption.confirmed_at when 'already_verified' then v_redemption.verified_at end,
      'used_store_name', case when v_reason in ('used', 'already_verified') then v_store.name end,
      'expired_at', case when v_reason in ('expired', 'released', 'cancelled') then v_redemption.hold_expires_at end
    );
  end if;

  if v_redemption.verified_at is null then
    update public.redemptions r
    set verified_at = p_at, verified_by = v_uid
    where r.id = v_redemption.id
    returning r.* into v_redemption;
    v_first := true;
  end if;
  select c.* into v_coupon from public.coupons c where c.id = v_redemption.coupon_id;
  select m.* into v_membership from public.memberships m where m.id = v_redemption.membership_id;
  select c.* into v_customer from public.customers c where c.id = v_membership.customer_id;
  if v_redemption.pos_free_item_external_id is not null then
    select min(i.name) into v_item_name from public.items i
    where i.tenant_id = v_redemption.tenant_id and i.external_id = v_redemption.pos_free_item_external_id;
  end if;
  return jsonb_build_object(
    'state', 'verified',
    'refusal', null,
    'text_key', 'redeem.valid',
    'first_verification', v_first,
    'redemption_id', v_redemption.id,
    'reward_name', v_coupon.name,
    'reward_kind', v_coupon.reward_kind,
    'reward_percent', v_coupon.reward_percent,
    'rail', v_redemption.rail,
    'pos_discount_name', case when v_redemption.rail = 'pos_payment_discount'
      then coalesce(v_redemption.pos_discount_name, v_item_name, v_redemption.pos_free_item_external_id) end,
    'pos_free_item_external_id', v_redemption.pos_free_item_external_id,
    'voucher_code', case when v_redemption.rail is distinct from 'pos_payment_discount' then v_redemption.code end,
    'min_bill_amount', nullif(v_coupon.min_bill_amount, 0),
    'hold_until', v_redemption.hold_expires_at,
    'confirm_by', case when v_redemption.rail = 'pos_payment_discount'
      then least(v_redemption.verified_at + make_interval(mins => v_window), v_redemption.hold_expires_at) end,
    'verified_at', v_redemption.verified_at,
    'phone_masked', '•••• ••• ' || right(coalesce(v_customer.phone, ''), 3)
  );
end;
$$;

comment on function app.staff_verify_redemption(uuid, text, timestamptz) is 'the staff app''s check of a reward code (or its QR payload fnb-redeem:1:<code>) at a store, for an owner, manager or staff member with the store in scope (42501 otherwise): a held, unexpired redemption of that store is marked verified (the first time) and answered {state verified, refusal null, text_key redeem.valid, first_verification, redemption_id, reward_name, reward_kind, reward_percent, rail, pos_discount_name (the POS payment discount entry to apply on pos_payment_discount, or the 0-price item''s name), pos_free_item_external_id, voucher_code (the code to type on the CRM rails), min_bill_amount (null for none), hold_until, confirm_by (on pos_payment_discount, when the sale must be rung for the invoice to match: the programme''s check-in window after the verification), verified_at, phone_masked (last three digits)}; it stays held until the synced invoice confirms it; a refusal is answered {state refused, refusal, reason, text_key redeem.refusal.<refusal>, used_at, used_store_name, expired_at}: unknown (no such code in the tenant), wrong_store (the code belongs to another store, nothing more said), used (confirmed, or already verified by someone else or longer ago than the check-in window, so a code is not applied twice), expired (the hold ended), released (given back, or cancelled); 22023 for a malformed code';

create function public.customer_redeem(p_coupon uuid, p_store text)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select app.customer_redeem(p_coupon, p_store, now());
$$;

comment on function public.customer_redeem(uuid, text) is 'RPC for the customer Mini App: app.customer_redeem at the current time';

create function public.customer_coupons(p_store text default null)
returns table (
  coupon_id uuid,
  reward_key text,
  name text,
  description text,
  reward_kind public.coupon_reward_kind,
  reward_percent numeric,
  reward_item_names text[],
  cost_stamps smallint,
  cost_points integer,
  store_codes text[],
  valid_from date,
  valid_until date,
  hold_hours smallint,
  per_member_limit smallint,
  redeemed integer,
  live_redemption_id uuid,
  affordable boolean,
  stamps_short integer,
  points_short integer,
  available boolean,
  unavailable_reason text
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from app.customer_coupons(p_store, now());
$$;

comment on function public.customer_coupons(text) is 'RPC for the customer Mini App: app.customer_coupons at the current time';

create function public.customer_vouchers()
returns table (
  redemption_id uuid,
  coupon_id uuid,
  coupon_name text,
  reward_kind public.coupon_reward_kind,
  reward_percent numeric,
  store_code text,
  store_name text,
  code text,
  qr_payload text,
  state public.redemption_state,
  display_state text,
  held_at timestamptz,
  hold_expires_at timestamptz,
  seconds_left integer,
  verified boolean,
  confirmed_at timestamptz,
  released_at timestamptz,
  stamps_spent integer,
  points_spent integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from app.customer_vouchers(now());
$$;

comment on function public.customer_vouchers() is 'RPC for the customer Mini App: app.customer_vouchers at the current time';

create function public.staff_verify_redemption(p_store_id uuid, p_code text)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select app.staff_verify_redemption(p_store_id, p_code, now());
$$;

comment on function public.staff_verify_redemption(uuid, text) is 'RPC for the staff app: app.staff_verify_redemption at the current time';

revoke all on function app.redemption_new_code(uuid) from public, anon, authenticated, service_role;
revoke all on function app.redemption_spendable_stamps(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.redeem_coupon(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function app.confirm_redemption(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function app.redemption_confirming_invoice(uuid) from public, anon, authenticated;
revoke all on function app.release_redemption(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function app.release_redemption_holds(uuid, timestamptz) from public, anon, authenticated;
revoke all on function app.loyalty_nightly(uuid, timestamptz) from public, anon, authenticated;
revoke all on function app.customer_redeem(uuid, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.customer_coupons(text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.customer_vouchers(timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.staff_verify_redemption(uuid, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.customer_redeem(uuid, text) from public, anon, service_role;
revoke all on function public.customer_coupons(text) from public, anon, service_role;
revoke all on function public.customer_vouchers() from public, anon, service_role;
revoke all on function public.staff_verify_redemption(uuid, text) from public, anon, service_role;

grant execute on function app.redeem_coupon(uuid, uuid, uuid, timestamptz) to service_role;
grant execute on function app.confirm_redemption(uuid, uuid, timestamptz) to service_role;
grant execute on function app.redemption_confirming_invoice(uuid) to service_role;
grant execute on function app.release_redemption(uuid, text, timestamptz) to service_role;
grant execute on function app.release_redemption_holds(uuid, timestamptz) to service_role;
grant execute on function app.loyalty_nightly(uuid, timestamptz) to service_role;
grant execute on function public.customer_redeem(uuid, text) to authenticated;
grant execute on function public.customer_coupons(text) to authenticated;
grant execute on function public.customer_vouchers() to authenticated;
grant execute on function public.staff_verify_redemption(uuid, text) to authenticated;
