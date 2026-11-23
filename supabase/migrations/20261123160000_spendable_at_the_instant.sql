-- ADR-047: a credit is spendable, and shown in the balance, while the moment is before its expires_at; the
-- nightly app.loyalty_expire only writes the ledger row afterwards, at its next run.
--
--   * app.loyalty_balance(membership, at) leaves out, at that moment, the stamps whose expiry has passed
--     and the points that app.loyalty_expiring_points would expire, whatever expire rows exist yet, so
--     between midnight and the nightly run a credit is already unspendable and out of the wallet. Called
--     with a null moment it is, as before, the balance of all the ledger rows; public.loyalty_balance now
--     passes now(). Every reader goes through it: app.redeem_coupon, app.customer_coupons,
--     app.customer_redeem, app.customer_wallet, the staff app's member card, the clawback cap and the floor
--     of an adjustment (ADR-046).
--   * The expiry is first in first out over the points: a redemption or a manual debit between the end of
--     a credit and the nightly run would otherwise be counted against the dead credit and leave the live
--     one to expire later. So a debit that is accepted first writes the member's due expiry at that
--     moment (app.loyalty_expire_membership, the step app.loyalty_expire runs for each member):
--     app.redeem_coupon and the negative part of app.loyalty_apply_adjustment. A refused one writes nothing.
--   * app.loyalty_apply_adjustment closes only stamps still valid at the moment.
--   * app.customer_wallet gives the dates as the last valid day ("valid through", valid_through, also
--     under the old keys expires_on and expiring.on) with the instant (expires_at), the next expiring points
--     as those that end at the next expiry instant (not those already ended), a confirmed pending earn
--     with the expiry of its confirm row, and the points balance through greatest(0, ...) as a safety net
--     (ADR-046 (4)).
-- Everything else of each function is as in its latest definition: app.loyalty_balance 20261123130000,
-- public.loyalty_balance 20261119120000, app.loyalty_expire 20261123130000, app.redeem_coupon
-- 20261119310000, app.loyalty_apply_adjustment 20261123150000, app.customer_wallet 20261120520000.

create or replace function app.loyalty_balance(p_membership_id uuid, p_at timestamptz default null)
returns table (
  membership_id uuid,
  programme_id uuid,
  stamps integer,
  points integer,
  pending_stamps integer,
  pending_points integer,
  stamps_per_card smallint,
  cards_completed integer,
  stamps_on_card integer,
  next_stamp_expiry timestamptz,
  points_value_amount numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with entries as (
    select l.*
    from public.loyalty_ledger l
    where l.membership_id = p_membership_id
      and (p_at is null or l.occurred_at <= p_at)
  ),
  open_pending as (
    select e.id
    from entries e
    where e.pending
      and e.entry_kind = 'earn'
      and not exists (select 1 from entries c where c.entry_kind = 'confirm' and c.source_entry_id = e.id)
  ),
  split as (
    select
      e.stamp_delta,
      e.point_delta,
      exists (select 1 from open_pending o where o.id = e.id or o.id = e.source_entry_id) as is_pending
    from entries e
  ),
  totals as (
    select
      coalesce(sum(s.stamp_delta) filter (where not s.is_pending), 0)::integer as stamps,
      coalesce(sum(s.point_delta) filter (where not s.is_pending), 0)::integer as points,
      coalesce(sum(s.stamp_delta) filter (where s.is_pending), 0)::integer as pending_stamps,
      coalesce(sum(s.point_delta) filter (where s.is_pending), 0)::integer as pending_points
    from split s
  ),
  -- ADR-047: at a moment, the stamps whose expiry has passed and that no expire row (or later close) has
  -- taken by then are no longer spendable
  dead_stamps as (
    select count(*)::integer as n
    from public.stamps st
    join entries e on e.id = st.earn_entry_id
    where p_at is not null
      and st.membership_id = p_membership_id
      and st.expires_at <= p_at
      and (st.state = 'active' or (st.state in ('expired', 'clawed_back') and st.closed_at > p_at))
      and not exists (select 1 from open_pending o where o.id = st.earn_entry_id)
  ),
  -- and neither are the points app.loyalty_expiring_points would expire at that moment
  credits as (
    select
      c.point_delta + coalesce((select sum(r.point_delta) from entries r where r.entry_kind = 'clawback' and r.source_entry_id = c.id), 0) as net,
      case when c.pending then coalesce(f.expires_at, c.expires_at) else c.expires_at end as expires_at
    from entries c
    left join entries f on c.pending and f.entry_kind = 'confirm' and f.source_entry_id = c.id
    where c.point_delta > 0
      and c.entry_kind in ('earn', 'adjust')
      and c.reason is distinct from 'redemption_released'
      and (not c.pending or f.id is not null)
  ),
  dead_points as (
    select (case when p_at is null then 0 else greatest(
      coalesce((select sum(c.net) from credits c where c.expires_at <= p_at), 0)
        - coalesce((
          select -sum(r.point_delta)
          from entries r
          where r.entry_kind in ('redeem', 'expire')
             or (r.entry_kind = 'adjust' and (r.point_delta < 0 or r.reason = 'redemption_released'))
        ), 0),
      0
    ) end)::integer as n
  ),
  spendable as (
    select t.stamps - ds.n as stamps, t.points - dp.n as points, t.pending_stamps, t.pending_points
    from totals t cross join dead_stamps ds cross join dead_points dp
  )
  select
    m.id,
    m.programme_id,
    s.stamps,
    s.points,
    s.pending_stamps,
    s.pending_points,
    p.stamps_per_card,
    greatest(s.stamps, 0) / p.stamps_per_card,
    greatest(s.stamps, 0) % p.stamps_per_card,
    (
      select min(st.expires_at)
      from public.stamps st
      where st.membership_id = m.id
        and st.state = 'active'
        and (p_at is null or st.expires_at > p_at)
        and not exists (select 1 from open_pending o where o.id = st.earn_entry_id)
    ),
    round(s.points * p.point_value_amount, 2)
  from public.memberships m
  join public.loyalty_programmes p on p.id = m.programme_id
  cross join spendable s
  where m.id = p_membership_id;
$$;

comment on function app.loyalty_balance(uuid, timestamptz) is 'the balance of a membership from its ledger rows: spendable stamps and points (confirmed earns, adjustments, holds, redemptions, clawbacks and expiries) and pending ones (earns waiting for their confirm row), with the card progress, the first expiry of a stamp the balance counts (not one of a pending earn, ADR-046) and the points value; at a moment p_at, the rows up to it less the credits whose expiry has passed by then, whatever expire rows exist yet (ADR-047: a credit is spendable while the moment is before its expires_at); with a null p_at, all the rows as they are; no row when the caller cannot read the membership';

create or replace function public.loyalty_balance(p_membership_id uuid)
returns table (
  membership_id uuid,
  programme_id uuid,
  stamps integer,
  points integer,
  pending_stamps integer,
  pending_points integer,
  stamps_per_card smallint,
  cards_completed integer,
  stamps_on_card integer,
  next_stamp_expiry timestamptz,
  points_value_amount numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from app.loyalty_balance(p_membership_id, now());
$$;

comment on function public.loyalty_balance(uuid) is 'RPC: app.loyalty_balance at this moment (ADR-047: a credit past its expiry is out of the balance before the nightly run writes its expire row) for a membership the caller reads (a customer session its own, owners, managers and viewers their tenant''s)';

create or replace function app.loyalty_expire_membership(p_membership_id uuid, p_as_of timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership record;
  v_due uuid[];
  v_stamps integer;
  v_points integer;
  v_entry uuid;
begin
  select m.id, m.tenant_id, m.programme_id, p.point_value_amount into v_membership
  from public.memberships m
  join public.loyalty_programmes p on p.id = m.programme_id
  where m.id = p_membership_id;
  if v_membership.id is null then
    raise exception 'loyalty_expire_membership needs an existing membership' using errcode = '22023';
  end if;
  select coalesce(array_agg(s.id), '{}'::uuid[]) into v_due
  from public.stamps s
  where s.membership_id = p_membership_id
    and s.state = 'active'
    and s.expires_at <= p_as_of
    and not exists (
      select 1
      from public.loyalty_ledger e
      where e.id = s.earn_entry_id
        and e.pending
        and not exists (select 1 from public.loyalty_ledger c where c.entry_kind = 'confirm' and c.source_entry_id = e.id)
    );
  v_stamps := cardinality(v_due);
  v_points := app.loyalty_expiring_points(p_membership_id, p_as_of);
  if v_stamps > 0 or v_points > 0 then
    insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, stamp_delta, point_delta, value_amount, reason, occurred_at)
    values (v_membership.tenant_id, v_membership.programme_id, p_membership_id, 'expire', -v_stamps, -v_points,
      -round(v_points * v_membership.point_value_amount, 2), 'expired', p_as_of)
    returning id into v_entry;
    update public.stamps s
    set state = 'expired', closed_entry_id = v_entry, closed_at = p_as_of
    where s.id = any (v_due);
  end if;
  return jsonb_build_object('entry_id', v_entry, 'stamps', v_stamps, 'points', v_points);
end;
$$;

comment on function app.loyalty_expire_membership(uuid, timestamptz) is 'the expiry step of one membership at a moment: one expire row (reason expired) with the stamps whose expiry has passed and the points app.loyalty_expiring_points gives, first in first out, the stamps closed as expired; nothing of an earn still waiting for its confirm row (ADR-046); nothing written when nothing is due; run by app.loyalty_expire for each member and, before an accepted debit, by app.redeem_coupon and app.loyalty_apply_adjustment (ADR-047); the caller holds the membership lock; returns {entry_id, stamps, points}; internal';

create or replace function app.loyalty_expire(p_tenant_id uuid, p_as_of timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership record;
  v_result jsonb;
  v_rows integer := 0;
  v_total_stamps integer := 0;
  v_total_points integer := 0;
begin
  for v_membership in
    select m.id
    from public.memberships m
    where m.tenant_id = p_tenant_id
      and (
        exists (select 1 from public.stamps s where s.membership_id = m.id and s.state = 'active' and s.expires_at <= p_as_of)
        or exists (select 1 from public.loyalty_ledger l where l.membership_id = m.id and l.point_delta > 0 and l.expires_at <= p_as_of)
      )
    order by m.id
    for update of m
  loop
    v_result := app.loyalty_expire_membership(v_membership.id, p_as_of);
    if v_result ->> 'entry_id' is not null then
      v_rows := v_rows + 1;
      v_total_stamps := v_total_stamps + (v_result ->> 'stamps')::integer;
      v_total_points := v_total_points + (v_result ->> 'points')::integer;
    end if;
  end loop;
  return jsonb_build_object('memberships', v_rows, 'stamps', v_total_stamps, 'points', v_total_points);
end;
$$;

comment on function app.loyalty_expire(uuid, timestamptz) is 'expires the stamps whose validity ended and the points whose rolling expiry passed (first in first out) for every membership of a tenant, one expire row per membership with both deltas (app.loyalty_expire_membership); the stamps and points of an earn still waiting for its confirm row never expire (ADR-046); the credits that ended before the run are already out of the balance (ADR-047), the run writes their row; a second run with the same moment adds nothing; returns counts only; service role only';

create or replace function app.redeem_coupon(p_membership_id uuid, p_coupon_id uuid, p_store_id uuid, p_at timestamptz default now())
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

  -- ADR-047: the credits that ended before this moment get their expire row first, so the first in first
  -- out expiry never counts this redemption against points that were no longer spendable
  perform app.loyalty_expire_membership(p_membership_id, p_at);
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

create or replace function app.loyalty_apply_adjustment(
  p_membership_id uuid,
  p_store_id uuid,
  p_stamps integer,
  p_points integer,
  p_reason text,
  p_approved_by uuid,
  p_at timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_membership public.memberships;
  v_programme public.loyalty_programmes;
  v_balance record;
  v_entry uuid;
  v_timezone text;
begin
  select m.* into v_membership from public.memberships m where m.id = p_membership_id for update;
  if v_membership.id is null then
    raise exception 'loyalty_apply_adjustment needs an existing membership' using errcode = '22023';
  end if;
  select p.* into v_programme from public.loyalty_programmes p where p.id = v_membership.programme_id;
  select t.timezone into v_timezone from public.tenants t where t.id = v_membership.tenant_id;
  if coalesce(p_stamps, 0) < 0 or coalesce(p_points, 0) < 0 then
    select b.stamps, b.points into v_balance from app.loyalty_balance(p_membership_id, p_at) b;
    if (coalesce(p_stamps, 0) < 0 and coalesce(v_balance.stamps, 0) + p_stamps < 0)
      or (coalesce(p_points, 0) < 0 and coalesce(v_balance.points, 0) + p_points < 0)
    then
      raise exception 'an adjustment never takes a balance below zero: % stamps and % points are spendable',
        coalesce(v_balance.stamps, 0), coalesce(v_balance.points, 0)
        using errcode = '22023';
    end if;
    -- ADR-047: the credits that ended before this moment get their expire row first, so the debit is
    -- never counted against them
    perform app.loyalty_expire_membership(p_membership_id, p_at);
  end if;
  insert into public.loyalty_ledger (
    tenant_id, programme_id, membership_id, store_id, entry_kind, stamp_delta, point_delta, value_amount,
    reason, approved_by, expires_at, occurred_at
  )
  values (
    v_membership.tenant_id, v_programme.id, p_membership_id, p_store_id, 'adjust', coalesce(p_stamps, 0), coalesce(p_points, 0),
    round(coalesce(p_points, 0) * v_programme.point_value_amount, 2), p_reason, p_approved_by,
    case when p_points > 0 then app.loyalty_credit_expires_at(p_at, v_programme.points_expiry_months, v_timezone) end, p_at
  )
  returning id into v_entry;
  if p_stamps > 0 then
    insert into public.stamps (tenant_id, membership_id, earn_entry_id, earned_at, expires_at)
    select v_membership.tenant_id, p_membership_id, v_entry, p_at, app.loyalty_credit_expires_at(p_at, v_programme.stamp_validity_months, v_timezone)
    from generate_series(1, p_stamps);
  elsif p_stamps < 0 then
    update public.stamps s
    set state = 'clawed_back', closed_entry_id = v_entry, closed_at = p_at
    where s.id in (
      select a.id
      from public.stamps a
      where a.membership_id = p_membership_id
        and a.state = 'active'
        and a.expires_at > p_at
        and not exists (
          select 1
          from public.loyalty_ledger e
          where e.id = a.earn_entry_id
            and e.pending
            and not exists (select 1 from public.loyalty_ledger c where c.entry_kind = 'confirm' and c.source_entry_id = e.id)
        )
      order by a.expires_at, a.id
      limit -p_stamps
    );
  end if;
  return v_entry;
end;
$$;

comment on function app.loyalty_apply_adjustment(uuid, uuid, integer, integer, text, uuid, timestamptz) is 'writes a manual adjustment as a loyalty_ledger adjust row with its reason and approver (points valued at the programme''s point_value_amount); added points and stamps are valid through the end of the anniversary day of the adjustment (ADR-047), removed stamps close the oldest stamps the balance counts at that moment (valid, not of an earn still waiting for its confirm row) as clawed_back; refuses with 22023, writing nothing, a negative part larger than the spendable balance of that kind at the moment (ADR-046: a balance never goes below zero; ADR-047: a credit past its expiry is not spendable) and an unknown membership; an accepted debit first writes the member''s due expiry (app.loyalty_expire_membership); returns the ledger row; internal';

create or replace function app.customer_wallet(p_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_membership public.memberships := app.customer_session_membership();
  v_programme public.loyalty_programmes;
  v_customer public.customers;
  v_timezone text;
  v_balance record;
  v_next_expiry timestamptz;
  v_expiring integer;
  v_history jsonb;
  v_claims jsonb;
begin
  select p.* into v_programme from public.loyalty_programmes p where p.id = v_membership.programme_id;
  select c.* into v_customer from public.customers c where c.id = v_membership.customer_id;
  select t.timezone into v_timezone from public.tenants t where t.id = v_membership.tenant_id;
  select b.* into v_balance from app.loyalty_balance(v_membership.id, p_at) b;

  -- ADR-047: the next instant at which credits end, a confirmed pending earn with the expiry of its confirm
  -- row (ADR-046), a credit a clawback took whole left out; the points ending then are those expiring by
  -- that instant less those already ended (out of the balance before their expire row is written)
  select min(case when l.pending then coalesce(f.expires_at, l.expires_at) else l.expires_at end) into v_next_expiry
  from public.loyalty_ledger l
  left join public.loyalty_ledger f on l.pending and f.entry_kind = 'confirm' and f.source_entry_id = l.id and f.occurred_at <= p_at
  where l.membership_id = v_membership.id
    and l.entry_kind in ('earn', 'adjust')
    and l.point_delta > 0
    and l.reason is distinct from 'redemption_released'
    and l.occurred_at <= p_at
    and (not l.pending or f.id is not null)
    and (case when l.pending then coalesce(f.expires_at, l.expires_at) else l.expires_at end) > p_at
    and l.point_delta + coalesce((
      select sum(c.point_delta) from public.loyalty_ledger c where c.entry_kind = 'clawback' and c.source_entry_id = l.id and c.occurred_at <= p_at
    ), 0) > 0;
  if v_next_expiry is not null then
    v_expiring := app.loyalty_expiring_points(v_membership.id, v_next_expiry) - app.loyalty_expiring_points(v_membership.id, p_at);
  end if;

  select coalesce(jsonb_agg(h.entry order by h.at desc, h.id), '[]'::jsonb)
  into v_history
  from (
    select e.at, e.id, e.entry
    from (
      select
        l.occurred_at as at,
        l.id,
        jsonb_build_object(
          'id', l.id,
          'at', l.occurred_at,
          'kind', case
            when l.entry_kind = 'adjust' and l.reason = 'welcome' and l.approved_by is null and l.invoice_id is null then 'welcome'
            when l.entry_kind = 'clawback' then 'reversal'
            else l.entry_kind::text
          end,
          'state', case
            when exists (select 1 from public.loyalty_ledger c where c.entry_kind = 'clawback' and c.source_entry_id = l.id and c.occurred_at <= p_at) then 'reversed'
            when l.entry_kind = 'redeem' and exists (
              select 1 from public.loyalty_ledger c
              where c.entry_kind = 'adjust' and c.reason = 'redemption_released' and c.source_entry_id = l.id and c.occurred_at <= p_at
            ) then 'reversed'
            when l.pending and not exists (select 1 from public.loyalty_ledger c where c.entry_kind = 'confirm' and c.source_entry_id = l.id and c.occurred_at <= p_at) then 'pending'
            else 'confirmed'
          end,
          'stamps', l.stamp_delta,
          'points', l.point_delta,
          'reason', l.reason,
          'store_name', s.name,
          'receipt_no', nullif(btrim(i.receipt_no), ''),
          'matched_path', case
            when l.entry_kind = 'earn' then case l.matched_path when 'A' then 'phone' when 'B' then 'member_code' when 'C' then 'receipt_claim' when 'D' then 'voucher' when 'E' then 'bill' end
            when l.entry_kind = 'adjust' and l.reason = 'welcome' and l.approved_by is null and l.invoice_id is null then 'welcome'
            when l.entry_kind = 'adjust' and l.reason = 'redemption_released' and l.source_entry_id is not null then null
            when l.entry_kind = 'adjust' then 'manual'
          end
        ) as entry
      from public.loyalty_ledger l
      left join public.stores s on s.id = l.store_id
      left join public.invoices i on i.id = l.invoice_id
      where l.membership_id = v_membership.id
        and l.entry_kind <> 'confirm'
        and l.occurred_at <= p_at
    ) e
    order by e.at desc, e.id
    limit 100
  ) h;

  select coalesce(jsonb_agg(k.claim order by k.created_at desc, k.id), '[]'::jsonb)
  into v_claims
  from (
    select
      c.created_at,
      c.id,
      jsonb_build_object(
        'id', c.id,
        'store_name', s.name,
        'receipt_no', c.receipt_no,
        'business_date', to_char(c.business_date, 'YYYY-MM-DD'),
        'submitted_at', c.created_at,
        'state', c.status,
        'reason', c.reason
      ) as claim
    from public.receipt_claims c
    join public.stores s on s.id = c.store_id
    where c.membership_id = v_membership.id
      and c.created_at <= p_at
    order by c.created_at desc, c.id
    limit 50
  ) k;

  return jsonb_build_object(
    'card', jsonb_build_object(
      'programme_name', v_programme.name,
      'display_name', coalesce(nullif(btrim(v_customer.name), ''), 'Thành viên'),
      'phone_masked', '•••• ••• ' || right(coalesce(v_customer.phone, ''), 3),
      'member_since', to_char((v_membership.joined_at at time zone v_timezone)::date, 'YYYY-MM-DD'),
      'purchases', (
        select count(*)::integer
        from public.loyalty_ledger l
        where l.membership_id = v_membership.id
          and l.entry_kind = 'earn'
          and l.occurred_at <= p_at
          and not exists (select 1 from public.loyalty_ledger c where c.entry_kind = 'clawback' and c.source_entry_id = l.id and c.occurred_at <= p_at)
          and (not l.pending or exists (select 1 from public.loyalty_ledger c where c.entry_kind = 'confirm' and c.source_entry_id = l.id and c.occurred_at <= p_at))
      )
    ),
    'stamp_cards', jsonb_build_array(
      jsonb_build_object(
        'id', v_membership.id,
        'name', v_programme.name,
        'stamps', greatest(v_balance.stamps_on_card, 0),
        'stamps_per_card', v_programme.stamps_per_card,
        'pending', greatest(v_balance.pending_stamps, 0),
        -- ADR-047: the last day the next stamp to end is valid (the local date of the last moment before its
        -- expires_at), under the old key too, and the instant
        'expires_on', to_char(((v_balance.next_stamp_expiry - interval '1 microsecond') at time zone v_timezone)::date, 'YYYY-MM-DD'),
        'valid_through', to_char(((v_balance.next_stamp_expiry - interval '1 microsecond') at time zone v_timezone)::date, 'YYYY-MM-DD'),
        'expires_at', v_balance.next_stamp_expiry
      )
    ),
    'points', jsonb_build_object(
      'balance', greatest(v_balance.points, 0),
      'pending', greatest(v_balance.pending_points, 0),
      'expiring', case
        when coalesce(v_expiring, 0) > 0 then jsonb_build_object(
          'points', v_expiring,
          'on', to_char(((v_next_expiry - interval '1 microsecond') at time zone v_timezone)::date, 'YYYY-MM-DD'),
          'valid_through', to_char(((v_next_expiry - interval '1 microsecond') at time zone v_timezone)::date, 'YYYY-MM-DD'),
          'expires_at', v_next_expiry
        )
      end
    ),
    'tier', null,
    'marketing_consent', app.has_active_consent(v_membership.tenant_id, 'customer', v_membership.customer_id, 'marketing'),
    'history', v_history,
    'claims', v_claims,
    'claims_today', app.customer_claims_today(v_membership.id, p_at),
    'claims_per_day', v_programme.receipt_claims_per_phone_per_day,
    'bills_to_confirm', app.customer_pending_bills(p_at),
    'deletion_request', app.customer_deletion_request(v_membership.tenant_id, v_membership.customer_id, p_at)
  );
end;
$function$

;

comment on function app.customer_wallet(timestamptz) is 'RPC core (customer session): the member''s card, stamp cards, points, history (path E earns read matched_path bill), receipt claims, the bills waiting for the customer''s blind total (bills_to_confirm, never the staff total) and the deletion request state; balances at the moment (ADR-047: a credit past its expiry is out before the nightly run writes its row), the points balance never below zero (greatest(0, ...), ADR-046); the stamp card and the next expiring points give the last valid day as valid_through (also under the old keys expires_on and on) and the instant as expires_at, the points being those that end at that instant';

revoke all on function app.loyalty_expire_membership(uuid, timestamptz) from public, anon, authenticated;
grant execute on function app.loyalty_expire_membership(uuid, timestamptz) to service_role;

comment on function app.redeem_coupon(uuid, uuid, uuid, timestamptz) is 'redeems a reward for a membership at a store: a pending ledger redeem row holds the reward''s stamps (closing the oldest spendable stamps) and points, and a held redemption carries a single-use code chosen by the store''s rail (an available pool code for crm_code_pool, a generated code for crm_callback and pos_payment_discount, with the discount entry name or 0-price item of the fallback rail copied from the mapping); the hold lasts hold_hours, at most valid_days and never past valid_until; what the member may spend is read at the moment (ADR-047: a credit past its expiry is not spendable, whatever expire rows exist) and an accepted hold first writes the member''s due expiry (app.loyalty_expire_membership); refusals are answered, not raised: membership_inactive, store_unavailable, programme_inactive, coupon_unavailable, rail_not_ready, already_held, member_limit_reached, insufficient_stamps, insufficient_points, no_code_available; returns {redemption_id, state, refusal, code, rail, coupon_id, store_id, held_at, hold_expires_at, stamps_spent, points_spent}; service role only';
