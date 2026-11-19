-- A confirmed redemption whose invoice is voided later (the nightly re-pull) is
-- cancelled: the stamps and points are given back, the pool code is quarantined,
-- the item goes to the manager queue (path D, confirmed_invoice_voided) and the
-- redemption_mismatch episode of the store counts it. Until now the state
-- cancelled existed in the enum but no function wrote it (G-03).

alter table public.loyalty_queue
  drop constraint loyalty_queue_reason_check,
  add constraint loyalty_queue_reason_check check (
    case matched_path
      when 'D' then reason in ('verified_without_invoice', 'discount_without_redemption', 'amount_mismatch', 'confirmed_invoice_voided')
      else reason in ('two_candidates', 'duplicate_receipt')
    end
  );

create function app.cancel_voided_redemptions(p_tenant_id uuid, p_at timestamptz default now())
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_redemption public.redemptions;
  v_hold public.loyalty_ledger;
  v_entry uuid;
  v_count integer := 0;
begin
  for v_row in
    select r.id, r.confirmed_invoice_id
    from public.redemptions r
    join public.invoices i on i.tenant_id = r.tenant_id and i.id = r.confirmed_invoice_id
    where r.tenant_id = p_tenant_id
      and r.state = 'confirmed'
      and i.status = 'voided'
    order by r.confirmed_at, r.id
  loop
    select r.* into v_redemption from public.redemptions r where r.id = v_row.id and r.state = 'confirmed' for update;
    continue when v_redemption.id is null;
    v_entry := null;
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
    set state = 'cancelled', released_at = p_at, release_entry_id = v_entry
    where r.id = v_redemption.id;
    if v_redemption.coupon_code_id is not null then
      update public.coupon_codes k
      set state = 'quarantined', quarantined_at = p_at
      where k.id = v_redemption.coupon_code_id and k.state in ('available', 'assigned', 'used');
    end if;
    insert into public.loyalty_queue (tenant_id, store_id, membership_id, redemption_id, invoice_id, matched_path, candidate_invoice_ids, reason, created_at)
    values (v_redemption.tenant_id, v_redemption.store_id, v_redemption.membership_id, v_redemption.id, v_redemption.confirmed_invoice_id, 'D', '{}'::uuid[], 'confirmed_invoice_voided', p_at)
    on conflict (redemption_id, reason) where redemption_id is not null do nothing;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

comment on function app.cancel_voided_redemptions(uuid, timestamptz) is 'cancels every confirmed redemption of the tenant whose confirming invoice the re-pull has voided (state transition confirmed -> cancelled): an adjust row with reason redemption_released gives the stamps and points back (the redeem row keeps its confirm row as history), the stamps the redemption closed are active again with their own expiry, a pool code is quarantined, and one path D queue item confirmed_invoice_voided names the redemption and the invoice for the store''s managers; the invoice''s own earn is clawed back by the nightly step; idempotent; returns the number cancelled; called by app.reconcile_redemptions; service role only';

revoke all on function app.cancel_voided_redemptions(uuid, timestamptz) from public, anon, authenticated;
grant execute on function app.cancel_voided_redemptions(uuid, timestamptz) to service_role;

create or replace function app.reconcile_redemptions(p_tenant_id uuid, p_from date, p_to date, p_at timestamptz default now())
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
  v_evidence integer;
  v_cancelled integer;
begin
  if p_tenant_id is null or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'reconcile_redemptions takes a tenant and a range of at most 63 business days' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('reconcile_loyalty:' || p_tenant_id::text));
  v_evidence := app.recognise_rail_events(p_tenant_id, p_from, p_to, p_at);
  v_cancelled := app.cancel_voided_redemptions(p_tenant_id, p_at);

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
      and r.state not in ('confirmed', 'cancelled')
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
      and exists (
        select 1 from app.invoice_rail_evidence e
        where e.invoice_id = i.id
          and e.kind in ('discount_entry', 'pool_code', 'redemption_code')
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
      count(q.id) filter (where q.state = 'open' and q.reason = 'confirmed_invoice_voided') as confirmed_invoice_voided,
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
    v_facts := jsonb_strip_nulls(jsonb_build_object(
      'open_items', v_row.open_items,
      'verified_without_invoice', v_row.verified_without_invoice,
      'discount_without_redemption', v_row.discount_without_redemption,
      'amount_mismatch', v_row.amount_mismatch,
      'confirmed_invoice_voided', nullif(v_row.confirmed_invoice_voided, 0)
    ));
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
    'mismatch_alerts', v_alerts,
    'rail_evidence', v_evidence
  );
end;
$$;



comment on function app.reconcile_redemptions(uuid, date, date, timestamptz) is 'the redemption step after every sync (at most 63 days): recognises the rail evidence of the range, cancels the confirmed redemptions whose invoice was voided (app.cancel_voided_redemptions, queue item confirmed_invoice_voided), confirms the verified holds of the fallback rail whose discount entry or 0-price line is on a synced invoice, then lists in loyalty_queue (path D, once per redemption or invoice and reason) a code verified at the till without a confirming invoice grace_hours later (verified_without_invoice; never a cancelled redemption), a completed invoice of the range whose recognised evidence is a mapped discount entry, a pool code or a redemption code without a redemption it confirms (discount_without_redemption), and a confirmed percent_off or amount_off redemption of the range whose invoice discount differs from the expected one by more than amount_tolerance or whose bill is under the minimum (amount_mismatch); items whose redemption or invoice is confirmed later resolve themselves; per store, open items open or refresh the redemption_mismatch episode store:<id> with count-only facts (open_items and one count per kind, confirmed_invoice_voided only when above 0) and no open item resolves it as cleared; returns counts: discount_confirmed, discount_earned, mismatches_found, mismatch_alerts, rail_evidence';
