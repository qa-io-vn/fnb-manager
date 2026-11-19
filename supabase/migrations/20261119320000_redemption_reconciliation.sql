alter table public.loyalty_queue
  add column redemption_id uuid,
  add column invoice_id uuid,
  add constraint loyalty_queue_tenant_id_redemption_id_fkey foreign key (tenant_id, redemption_id) references public.redemptions (tenant_id, id) on delete cascade,
  add constraint loyalty_queue_tenant_id_invoice_id_fkey foreign key (tenant_id, invoice_id) references public.invoices (tenant_id, id),
  alter column membership_id drop not null,
  drop constraint loyalty_queue_matched_path_check,
  drop constraint loyalty_queue_reason_check,
  drop constraint loyalty_queue_candidate_invoice_ids_check,
  drop constraint loyalty_queue_check,
  add constraint loyalty_queue_matched_path_check check (matched_path in ('B', 'C', 'D')),
  add constraint loyalty_queue_reason_check check (
    case matched_path
      when 'D' then reason in ('verified_without_invoice', 'discount_without_redemption', 'amount_mismatch')
      else reason in ('two_candidates', 'duplicate_receipt')
    end
  ),
  add constraint loyalty_queue_candidate_invoice_ids_check check (
    array_position(candidate_invoice_ids, null) is null
    and cardinality(candidate_invoice_ids) <= 20
    and (matched_path = 'D' or cardinality(candidate_invoice_ids) >= 2)
  ),
  add constraint loyalty_queue_check check (
    case matched_path
      when 'D' then num_nonnulls(checkin_id, claim_id) = 0 and num_nonnulls(redemption_id, invoice_id) >= 1
      else num_nonnulls(checkin_id, claim_id) = 1 and redemption_id is null and invoice_id is null and membership_id is not null
    end
  );

comment on table public.loyalty_queue is 'the manager queue: a check-in or receipt claim with two candidate invoices within tolerance waits here instead of being guessed (paths B and C), and a redemption the synced invoices disagree with is listed here (path D: verified_without_invoice, discount_without_redemption, amount_mismatch); an owner or manager of the store resolves or dismisses it with resolve_loyalty_queue_item';
comment on column public.loyalty_queue.redemption_id is 'path D: the redemption the item is about (verified_without_invoice, amount_mismatch)';
comment on column public.loyalty_queue.invoice_id is 'path D: the invoice the item is about (discount_without_redemption, amount_mismatch)';

create unique index loyalty_queue_one_per_redemption_reason_key on public.loyalty_queue (redemption_id, reason) where redemption_id is not null;
create unique index loyalty_queue_one_per_invoice_reason_key on public.loyalty_queue (invoice_id, reason) where invoice_id is not null and redemption_id is null;

insert into public.alert_rule_catalog (rule_key, category, delivery, default_enabled, default_severity, default_roles, default_params, params_schema, default_cooldown, remind_every, notify_on_resolve, store_scoped, sort_order)
values (
  'redemption_mismatch', 'business', 'immediate', true, 'warning', array['owner', 'manager']::public.tenant_role[],
  '{"grace_hours": 24, "amount_tolerance": 1000}',
  '{"grace_hours": {"type": "integer", "min": 1, "max": 168}, "amount_tolerance": {"type": "integer", "min": 0, "max": 100000}}',
  interval '0', null, false, true, 195
);

create function app.redemption_expected_discount(p_coupon_id uuid, p_invoice_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  with c as (
    select k.* from public.coupons k where k.id = p_coupon_id
  ),
  base as (
    select
      case
        when c.reward_item_external_ids is not null then (
          select coalesce(sum(l.net_amount), 0)
          from public.invoice_lines l
          where l.invoice_id = p_invoice_id
            and l.line_kind = 'item'
            and l.item_external_id = any (c.reward_item_external_ids)
        )
        else i.gross_amount - i.item_discount_amount - (
          select coalesce(sum(l.net_amount), 0)
          from public.invoice_lines l
          where l.invoice_id = p_invoice_id
            and l.line_kind = 'item'
            and l.item_external_id = any (c.excluded_item_external_ids)
        )
      end as amount
    from c
    join public.invoices i on i.id = p_invoice_id
  )
  select case c.reward_kind
    when 'percent_off' then round(greatest(b.amount, 0) * c.reward_percent / 100, 0)
    when 'amount_off' then least(c.reward_amount, greatest(b.amount, 0))
  end
  from c cross join base b;
$$;

comment on function app.redemption_expected_discount(uuid, uuid) is 'the discount a percent_off or amount_off reward gives on an invoice: its percentage (rounded to the dong) or its amount, of the reward items'' lines when it names items, else of the bill after item discounts less the excluded items; null for the gift kinds';

create function app.reconcile_redemptions(p_tenant_id uuid, p_from date, p_to date, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_invoice uuid;
  v_outcome text;
  v_confirmed integer := 0;
  v_earned integer := 0;
  v_found integer := 0;
  v_alerts integer := 0;
  v_rows integer;
  v_stores uuid[];
  v_new_stores uuid[] := '{}'::uuid[];
  v_facts jsonb;
  v_raised record;
begin
  if p_tenant_id is null or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'reconcile_redemptions takes a tenant and a range of at most 63 business days' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('reconcile_loyalty:' || p_tenant_id::text));

  for v_row in
    select r.id
    from public.redemptions r
    where r.tenant_id = p_tenant_id
      and r.state = 'held'
      and r.rail = 'pos_payment_discount'
      and r.verified_at is not null
    order by r.verified_at, r.id
  loop
    v_invoice := app.redemption_confirming_invoice(v_row.id);
    continue when v_invoice is null;
    v_outcome := app.confirm_redemption(v_row.id, v_invoice, p_at);
    if v_outcome is not null then
      v_confirmed := v_confirmed + 1;
      if v_outcome = 'earned' then
        v_earned := v_earned + 1;
      end if;
    end if;
  end loop;

  update public.loyalty_queue q
  set state = 'resolved', resolved_at = p_at, chosen_invoice_id = r.confirmed_invoice_id, resolution_reason = 'confirmed by the synced invoice'
  from public.redemptions r
  where q.tenant_id = p_tenant_id
    and q.matched_path = 'D'
    and q.state = 'open'
    and q.reason = 'verified_without_invoice'
    and r.id = q.redemption_id
    and r.state = 'confirmed';
  update public.loyalty_queue q
  set state = 'resolved', resolved_at = p_at, chosen_invoice_id = q.invoice_id, resolution_reason = 'confirmed by the synced invoice'
  where q.tenant_id = p_tenant_id
    and q.matched_path = 'D'
    and q.state = 'open'
    and q.reason = 'discount_without_redemption'
    and exists (select 1 from public.redemptions r where r.confirmed_invoice_id = q.invoice_id);

  with rules as (
    select
      s.id as store_id,
      coalesce((e.params ->> 'grace_hours')::integer, 24) as grace_hours,
      coalesce((e.params ->> 'amount_tolerance')::numeric, 1000) as amount_tolerance
    from public.stores s
    cross join lateral app.effective_alert_rule(s.tenant_id, s.id, 'redemption_mismatch') e
    where s.tenant_id = p_tenant_id
  ),
  verified as (
    select r.tenant_id, r.store_id, r.membership_id, r.id as redemption_id, null::uuid as invoice_id, 'verified_without_invoice'::text as reason
    from public.redemptions r
    join rules g on g.store_id = r.store_id
    where r.tenant_id = p_tenant_id
      and r.verified_at is not null
      and r.state <> 'confirmed'
      and r.verified_at + make_interval(hours => g.grace_hours) <= p_at
  ),
  amounts as (
    select r.tenant_id, i.store_id, r.membership_id, r.id as redemption_id, i.id as invoice_id, 'amount_mismatch'::text as reason
    from public.redemptions r
    join public.invoices i on i.id = r.confirmed_invoice_id
    join public.coupons c on c.id = r.coupon_id
    join rules g on g.store_id = i.store_id
    cross join lateral (
      select
        app.redemption_expected_discount(c.id, i.id) as expected,
        case when r.rail = 'pos_payment_discount' then i.bill_discount_amount else i.voucher_amount end as actual
    ) x
    where r.tenant_id = p_tenant_id
      and r.state = 'confirmed'
      and r.rail is not null
      and i.business_date between p_from and p_to
      and c.reward_kind in ('percent_off', 'amount_off')
      and (abs(x.actual - x.expected) > g.amount_tolerance or i.gross_amount < c.min_bill_amount)
  ),
  inserted as (
    insert into public.loyalty_queue (tenant_id, store_id, membership_id, redemption_id, invoice_id, matched_path, candidate_invoice_ids, reason, created_at)
    select f.tenant_id, f.store_id, f.membership_id, f.redemption_id, f.invoice_id, 'D', '{}'::uuid[], f.reason, p_at
    from (select * from verified union all select * from amounts) f
    on conflict (redemption_id, reason) where redemption_id is not null do nothing
    returning store_id
  )
  select count(*), coalesce(array_agg(distinct store_id), '{}'::uuid[]) into v_rows, v_stores from inserted;
  v_found := v_found + v_rows;
  v_new_stores := v_new_stores || v_stores;

  with flagged as (
    select i.id, i.tenant_id, i.store_id
    from public.invoices i
    where i.tenant_id = p_tenant_id
      and i.business_date between p_from and p_to
      and i.status = 'completed'
      and (
        (
          i.bill_discount_name is not null
          and exists (
            select 1 from public.coupon_rail_rewards w
            where w.store_id = i.store_id
              and w.pos_discount_name is not null
              and lower(btrim(w.pos_discount_name)) = lower(btrim(i.bill_discount_name))
          )
        )
        or (
          i.voucher_code is not null
          and (
            exists (select 1 from public.coupon_codes k where k.store_id = i.store_id and upper(k.code) = upper(btrim(i.voucher_code)))
            or exists (
              select 1 from public.redemptions o
              where o.tenant_id = i.tenant_id
                and (o.store_id is null or o.store_id = i.store_id)
                and upper(o.code) = upper(btrim(i.voucher_code))
            )
          )
        )
      )
      and not exists (select 1 from public.redemptions o where o.confirmed_invoice_id = i.id)
      and not exists (
        select 1 from public.redemptions o
        where o.tenant_id = i.tenant_id
          and o.state = 'held'
          and (o.store_id is null or o.store_id = i.store_id)
          and i.voucher_code is not null
          and upper(o.code) = upper(btrim(i.voucher_code))
      )
  ),
  inserted as (
    insert into public.loyalty_queue (tenant_id, store_id, invoice_id, matched_path, candidate_invoice_ids, reason, created_at)
    select f.tenant_id, f.store_id, f.id, 'D', '{}'::uuid[], 'discount_without_redemption', p_at
    from flagged f
    on conflict (invoice_id, reason) where invoice_id is not null and redemption_id is null do nothing
    returning store_id
  )
  select count(*), coalesce(array_agg(distinct store_id), '{}'::uuid[]) into v_rows, v_stores from inserted;
  v_found := v_found + v_rows;
  v_new_stores := v_new_stores || v_stores;

  for v_row in
    select
      s.id as store_id,
      count(q.id) filter (where q.state = 'open') as open_items,
      count(q.id) filter (where q.state = 'open' and q.reason = 'verified_without_invoice') as verified_without_invoice,
      count(q.id) filter (where q.state = 'open' and q.reason = 'discount_without_redemption') as discount_without_redemption,
      count(q.id) filter (where q.state = 'open' and q.reason = 'amount_mismatch') as amount_mismatch,
      (
        select e.id from public.alert_events e
        where e.tenant_id = p_tenant_id
          and e.dedupe_key = 'redemption_mismatch:store:' || s.id::text
          and e.state = 'open'
        order by e.opened_at desc
        limit 1
      ) as open_event
    from public.stores s
    left join public.loyalty_queue q on q.store_id = s.id and q.matched_path = 'D'
    where s.tenant_id = p_tenant_id
    group by s.id
    order by s.id
  loop
    v_facts := jsonb_build_object(
      'open_items', v_row.open_items,
      'verified_without_invoice', v_row.verified_without_invoice,
      'discount_without_redemption', v_row.discount_without_redemption,
      'amount_mismatch', v_row.amount_mismatch
    );
    if v_row.open_items > 0 and (v_row.open_event is null or v_row.store_id = any (v_new_stores)) then
      select r.* into v_raised
      from app.raise_alert(p_tenant_id, 'redemption_mismatch', 'store:' || v_row.store_id::text, 'incremental', p_at,
        v_row.store_id, null, null, app.store_business_date(v_row.store_id, p_at), v_facts) r;
      if v_raised.outcome = 'opened' then
        v_alerts := v_alerts + 1;
      end if;
    elsif v_row.open_items > 0 then
      update public.alert_events e
      set facts = v_facts
      where e.id = v_row.open_event
        and e.facts is distinct from v_facts;
    elsif v_row.open_event is not null then
      perform app.resolve_rule_episode(v_row.open_event, 'cleared', p_at);
    end if;
  end loop;

  return jsonb_build_object(
    'discount_confirmed', v_confirmed,
    'discount_earned', v_earned,
    'mismatches_found', v_found,
    'mismatch_alerts', v_alerts
  );
end;
$$;

comment on function app.reconcile_redemptions(uuid, date, date, timestamptz) is 'the redemption step after every sync (at most 63 days): confirms the verified holds of the fallback rail whose discount entry or 0-price line is on a synced invoice (app.redemption_confirming_invoice, then app.confirm_redemption), then lists in loyalty_queue (path D, once per redemption or invoice and reason) a code verified at the till without a confirming invoice grace_hours later (verified_without_invoice), a completed invoice of the range carrying a mapped discount entry name, a pool code or a redemption code without a redemption it confirms (discount_without_redemption), and a confirmed percent_off or amount_off redemption of the range whose invoice discount differs from the expected one by more than amount_tolerance or whose bill is under the minimum (amount_mismatch); items whose redemption or invoice is confirmed later resolve themselves; per store, open items open or refresh the redemption_mismatch episode store:<id> with count-only facts (open_items and one count per kind) and no open item resolves it as cleared; returns counts: discount_confirmed, discount_earned, mismatches_found, mismatch_alerts';

alter function app.reconcile_loyalty(uuid, date, date, timestamptz) rename to reconcile_loyalty_paths;

comment on function app.reconcile_loyalty_paths(uuid, date, date, timestamptz) is 'the phase 17 part of the loyalty reconciliation, called by app.reconcile_loyalty: path A (the customer or phone on invoices of the range), path B (recorded check-ins), path C (pending receipt claims), path D (held redemptions whose code is on an invoice of the range, confirmed and earned), then expiry of stale codes, check-ins and claims; idempotent; returns counts only';

create function app.reconcile_loyalty(p_tenant_id uuid, p_from date, p_to date, p_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_counts jsonb;
begin
  v_counts := app.reconcile_loyalty_paths(p_tenant_id, p_from, p_to, p_at);
  if v_counts ? 'skipped' then
    return v_counts;
  end if;
  return v_counts || app.reconcile_redemptions(p_tenant_id, p_from, p_to, p_at);
end;
$$;

comment on function app.reconcile_loyalty(uuid, date, date, timestamptz) is 'the loyalty reconciliation after a sync: app.reconcile_loyalty_paths (paths A to D and the expiry of stale codes, check-ins and claims), then app.reconcile_redemptions (the fallback-rail confirmations and the redemption mismatches); nothing without an active programme; idempotent; returns counts only; service role and the jobs';

create function public.redemption_summary(store_ids uuid[], from_date date, to_date date)
returns table (
  store_id uuid,
  coupon_id uuid,
  reward_key text,
  coupon_name text,
  reward_kind public.coupon_reward_kind,
  redemptions bigint,
  held bigint,
  confirmed bigint,
  released bigint,
  stamps_redeemed bigint,
  points_redeemed bigint,
  reward_cost_amount numeric,
  member_invoices bigint,
  confirmed_share numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  max_range_days constant integer := 92;
  visible_ids uuid[];
  returned_rows bigint;
begin
  perform app.require_store_ids('redemption_summary', redemption_summary.store_ids);
  perform app.require_date_range('redemption_summary', redemption_summary.from_date, redemption_summary.to_date, max_range_days);
  if cardinality(redemption_summary.store_ids) = 0 then
    return;
  end if;
  visible_ids := array(select v.store_id from app.visible_stores(redemption_summary.store_ids) v);

  return query
  with positions as (
    select v.store_id as p_store, v.store_position as p_position
    from app.visible_stores(redemption_summary.store_ids) v
  ),
  held_rows as (
    select
      r.id as r_id,
      r.store_id as r_store,
      r.coupon_id as r_coupon,
      r.state as r_state,
      r.rail as r_rail,
      r.confirmed_invoice_id as r_invoice,
      r.redeem_entry_id as r_entry
    from public.redemptions r
    join public.stores s on s.id = r.store_id
    where r.store_id = any (visible_ids)
      and ((r.held_at at time zone s.timezone) - make_interval(mins => s.business_day_start_minutes))::date
        between redemption_summary.from_date and redemption_summary.to_date
  ),
  by_reward as (
    select
      h.r_store,
      h.r_coupon,
      count(*) as n_all,
      count(*) filter (where h.r_state = 'held') as n_held,
      count(*) filter (where h.r_state = 'confirmed') as n_confirmed,
      count(*) filter (where h.r_state = 'released') as n_released,
      coalesce(sum(-l.stamp_delta) filter (where h.r_state = 'confirmed'), 0)::bigint as n_stamps,
      coalesce(sum(-l.point_delta) filter (where h.r_state = 'confirmed'), 0)::bigint as n_points,
      coalesce(sum(case when h.r_rail = 'pos_payment_discount' then i.bill_discount_amount else i.voucher_amount end) filter (where h.r_state = 'confirmed'), 0) as n_cost
    from held_rows h
    left join public.loyalty_ledger l on l.id = h.r_entry
    left join public.invoices i on i.id = h.r_invoice
    group by h.r_store, h.r_coupon
  ),
  members as (
    select l.store_id as m_store, count(distinct l.invoice_id) as n_invoices
    from public.loyalty_ledger l
    where l.store_id = any (visible_ids)
      and l.entry_kind = 'earn'
      and l.business_date between redemption_summary.from_date and redemption_summary.to_date
      and not exists (select 1 from public.loyalty_ledger c where c.entry_kind = 'clawback' and c.source_entry_id = l.id)
    group by l.store_id
  )
  select
    b.r_store,
    b.r_coupon,
    c.reward_key,
    c.name,
    c.reward_kind,
    b.n_all,
    b.n_held,
    b.n_confirmed,
    b.n_released,
    b.n_stamps,
    b.n_points,
    b.n_cost,
    coalesce(m.n_invoices, 0),
    case when coalesce(m.n_invoices, 0) > 0 then round(b.n_confirmed::numeric / m.n_invoices, 4) end
  from by_reward b
  join public.coupons c on c.id = b.r_coupon
  join positions p on p.p_store = b.r_store
  left join members m on m.m_store = b.r_store
  order by p.p_position, c.reward_key collate "C", b.r_coupon;

  get diagnostics returned_rows = row_count;
  perform app.require_report_rows('redemption_summary', returned_rows);
end;
$$;

comment on function public.redemption_summary(uuid[], date, date) is 'report function for Khuyến mãi & giảm giá (FR-LOY-24): per visible store and reward, the redemptions held on the business days of the range (by the store''s business date of the hold) with how many are still held, confirmed and released, the stamps and points the confirmed ones spent, their reward cost (the payment discount of the confirming invoice on the fallback rail, its voucher amount on the code rails), the store''s member invoices of the range (invoices that earned and were not clawed back) and the confirmed share of them; as the caller, so staff and the publisher get no row; 0 to 50 stores, at most 92 days, at most 900 rows, else 22023';

revoke all on function app.redemption_expected_discount(uuid, uuid) from public, anon, authenticated;
revoke all on function app.reconcile_redemptions(uuid, date, date, timestamptz) from public, anon, authenticated;
revoke all on function app.reconcile_loyalty(uuid, date, date, timestamptz) from public, anon, authenticated;
revoke all on function public.redemption_summary(uuid[], date, date) from public, anon;

grant execute on function app.redemption_expected_discount(uuid, uuid) to service_role;
grant execute on function app.reconcile_redemptions(uuid, date, date, timestamptz) to service_role;
grant execute on function app.reconcile_loyalty(uuid, date, date, timestamptz) to service_role;
grant execute on function public.redemption_summary(uuid[], date, date) to authenticated, service_role;
