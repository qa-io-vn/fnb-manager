create table app.invoice_rail_evidence (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  invoice_id uuid not null,
  business_date date not null,
  kind text not null check (kind in (
    'member_phone', 'member_ref', 'pool_code', 'redemption_code', 'callback_sale', 'discount_entry', 'zero_price_line', 'crm_promotion'
  )),
  rail public.coupon_rail,
  on_rail boolean not null,
  reward_key text check (reward_key is null or reward_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  amount numeric(14, 2) not null default 0,
  recognised_at timestamptz not null,
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade,
  foreign key (tenant_id, invoice_id) references public.invoices (tenant_id, id) on delete cascade
);

create unique index invoice_rail_evidence_key on app.invoice_rail_evidence (invoice_id, kind, coalesce(reward_key, ''));
create index invoice_rail_evidence_tenant_date_idx on app.invoice_rail_evidence (tenant_id, business_date);

comment on table app.invoice_rail_evidence is 'what each synced non-voided invoice carries of the loyalty rails (FR-LOY-04, FR-LOY-07), recognised after every sync by app.recognise_rail_events for the matching of phase 17a and the redemption reconciliation: member_phone (a readable customer phone), member_ref (a linked customer), pool_code (the voucher code is a pool code of the store), redemption_code (the voucher code is a redemption code of the tenant), callback_sale (the voucher callback answered this sale), discount_entry (the bill discount name is a mapped POS discount entry), zero_price_line (a 0-price line of a mapped free item), crm_promotion (a line carries the promotion of a mapped or listed CRM programme); with the store''s rail at the time of sale, whether the evidence belongs to that rail, the reward when a mapping names it and the discount it carried (lines, bill discount and voucher amount for a code; the bill discount for an entry; the promoted lines'' discounts, with a bill discount named after their promotion, for a CRM promotion); never a phone, a code or a name';

revoke all on table app.invoice_rail_evidence from public, anon, authenticated, service_role;

create function app.recognise_rail_events(p_tenant_id uuid, p_from date, p_to date, p_at timestamptz default now())
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  if p_tenant_id is null or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'recognise_rail_events takes a tenant and a range of at most 63 business days' using errcode = '22023';
  end if;
  delete from app.invoice_rail_evidence e
  where e.tenant_id = p_tenant_id and e.business_date between p_from and p_to;

  with sales as materialized (
    select
      i.id, i.tenant_id, i.store_id, i.business_date, i.external_id, i.customer_phone, i.customer_id,
      nullif(upper(btrim(i.voucher_code)), '') as voucher_code,
      nullif(lower(btrim(i.bill_discount_name)), '') as discount_name,
      i.bill_discount_amount,
      i.item_discount_amount + i.bill_discount_amount + i.voucher_amount as discount_total,
      r.rail,
      coalesce(r.crm_programme_external_ids, '{}'::text[]) as programmes
    from public.invoices i
    left join lateral (
      select k.rail, k.crm_programme_external_ids
      from public.coupon_rails k
      where k.store_id = i.store_id
        and k.active_from <= i.sold_at
        and (k.active_until is null or k.active_until > i.sold_at)
      order by k.active_from desc
      limit 1
    ) r on true
    where i.tenant_id = p_tenant_id
      and i.business_date between p_from and p_to
      and i.status <> 'voided'
  ),
  found as (
    select s.id, s.tenant_id, s.store_id, s.business_date, 'member_phone' as kind, s.rail, true as on_rail, null::text as reward_key, 0::numeric as amount
    from sales s
    where app.loyalty_normalize_phone(s.customer_phone) is not null
    union all
    select s.id, s.tenant_id, s.store_id, s.business_date, 'member_ref', s.rail, true, null, 0
    from sales s
    where s.customer_id is not null
    union all
    select distinct on (s.id, k.reward_key)
      s.id, s.tenant_id, s.store_id, s.business_date, 'pool_code', s.rail, s.rail is not distinct from 'crm_code_pool', k.reward_key, s.discount_total
    from sales s
    join public.coupon_codes k on k.store_id = s.store_id and upper(k.code) = s.voucher_code
    where s.voucher_code is not null
    union all
    select distinct on (s.id, c.reward_key)
      s.id, s.tenant_id, s.store_id, s.business_date, 'redemption_code', s.rail,
      coalesce(o.rail = s.rail and o.rail <> 'pos_payment_discount', false), c.reward_key, s.discount_total
    from sales s
    join public.redemptions o
      on o.tenant_id = s.tenant_id
     and (o.store_id is null or o.store_id = s.store_id)
     and upper(o.code) = s.voucher_code
    join public.coupons c on c.id = o.coupon_id
    where s.voucher_code is not null
    union all
    select distinct on (s.id, c.reward_key)
      s.id, s.tenant_id, s.store_id, s.business_date, 'callback_sale', s.rail, s.rail is not distinct from 'crm_callback', c.reward_key, a.discount_amount
    from sales s
    join app.voucher_callback_answers a on a.store_id = s.store_id and a.sale_ref = s.external_id
    left join public.redemptions o on o.id = a.redemption_id
    left join public.coupons c on c.id = o.coupon_id
    union all
    select distinct on (s.id, w.reward_key)
      s.id, s.tenant_id, s.store_id, s.business_date, 'discount_entry', s.rail, s.rail is not distinct from 'pos_payment_discount', w.reward_key, s.bill_discount_amount
    from sales s
    join public.coupon_rail_rewards w
      on w.store_id = s.store_id
     and w.pos_discount_name is not null
     and lower(btrim(w.pos_discount_name)) = s.discount_name
    union all
    select s.id, s.tenant_id, s.store_id, s.business_date, 'zero_price_line', s.rail, s.rail is not distinct from 'pos_payment_discount', w.reward_key,
      sum(l.gross_amount)
    from sales s
    join public.invoice_lines l on l.invoice_id = s.id and l.line_kind = 'item' and l.net_amount = 0
    join public.coupon_rail_rewards w on w.store_id = s.store_id and w.pos_free_item_external_id = l.item_external_id
    group by s.id, s.tenant_id, s.store_id, s.business_date, s.rail, w.reward_key
    union all
    select p.id, p.tenant_id, p.store_id, p.business_date, 'crm_promotion', p.rail, p.rail in ('crm_code_pool', 'crm_callback'), p.reward_key,
      sum(p.line_discount) + max(case when p.named then p.bill_discount_amount else 0 end)
    from (
      select
        s.id, s.tenant_id, s.store_id, s.business_date, s.rail, s.bill_discount_amount,
        l.id as line_id,
        l.discount_amount as line_discount,
        s.discount_name is not null and lower(btrim(l.promotion_name)) = s.discount_name as named,
        (
          select min(w.reward_key)
          from public.coupon_rail_rewards w
          where w.store_id = s.store_id and w.crm_programme_external_id = btrim(l.promotion_external_id)
        ) as reward_key
      from sales s
      join public.invoice_lines l on l.invoice_id = s.id
      where nullif(btrim(l.promotion_external_id), '') is not null
        and (
          btrim(l.promotion_external_id) = any (s.programmes)
          or exists (
            select 1 from public.coupon_rail_rewards w
            where w.store_id = s.store_id and w.crm_programme_external_id = btrim(l.promotion_external_id)
          )
        )
    ) p
    group by p.id, p.tenant_id, p.store_id, p.business_date, p.rail, p.reward_key
  )
  insert into app.invoice_rail_evidence (tenant_id, store_id, invoice_id, business_date, kind, rail, on_rail, reward_key, amount, recognised_at)
  select f.tenant_id, f.store_id, f.id, f.business_date, f.kind, f.rail, coalesce(f.on_rail, false), f.reward_key, coalesce(f.amount, 0), p_at
  from found f
  on conflict (invoice_id, kind, coalesce(reward_key, '')) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

comment on function app.recognise_rail_events(uuid, date, date, timestamptz) is 'the rail recognition after every sync (at most 63 days): replaces the app.invoice_rail_evidence rows of the tenant''s invoices of the range with what each non-voided invoice carries now (see the table), judged against the store''s coupon rail at the time of sale and its mappings, so switching a store''s rail or editing a mapping changes what the next run recognises with no code change; returns the number of evidence rows; called by app.reconcile_redemptions; service role only';

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
begin
  if p_tenant_id is null or p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'reconcile_redemptions takes a tenant and a range of at most 63 business days' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('reconcile_loyalty:' || p_tenant_id::text));
  v_evidence := app.recognise_rail_events(p_tenant_id, p_from, p_to, p_at);

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
    'mismatch_alerts', v_alerts,
    'rail_evidence', v_evidence
  );
end;
$$;


comment on function app.reconcile_redemptions(uuid, date, date, timestamptz) is 'the redemption step after every sync (at most 63 days): first recognises the rail evidence of the range (app.recognise_rail_events), then confirms the verified holds of the fallback rail whose discount entry or 0-price line is on a synced invoice (app.redemption_confirming_invoice, then app.confirm_redemption), then lists in loyalty_queue (path D, once per redemption or invoice and reason) a code verified at the till without a confirming invoice grace_hours later (verified_without_invoice), a completed invoice of the range whose recognised evidence is a mapped discount entry, a pool code or a redemption code without a redemption it confirms (discount_without_redemption), and a confirmed percent_off or amount_off redemption of the range whose invoice discount differs from the expected one by more than amount_tolerance or whose bill is under the minimum (amount_mismatch); items whose redemption or invoice is confirmed later resolve themselves; per store, open items open or refresh the redemption_mismatch episode store:<id> with count-only facts (open_items and one count per kind) and no open item resolves it as cleared; returns counts: discount_confirmed, discount_earned, mismatches_found, mismatch_alerts, rail_evidence';

revoke all on function app.recognise_rail_events(uuid, date, date, timestamptz) from public, anon, authenticated;
grant execute on function app.recognise_rail_events(uuid, date, date, timestamptz) to service_role;
