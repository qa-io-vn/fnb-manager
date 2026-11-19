-- ISTQB boundary value analysis on the loyalty amounts and counts, with SQL as
-- the unit under test: the minimum bill for a stamp, the point unit, the daily
-- cap of earning invoices, the 50 % discount cap on rewards and the stamp card
-- rollover. Each description names the technique and the value tested.
begin;
select plan(26);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000013001'::uuid as tenant_b,
  'cccccccc-cccc-4ccc-8ccc-000000013001'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000013001'::uuid as store_b,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000013001'::uuid as programme_b,
  timestamptz '2026-11-10 10:00+07' as t0;

insert into public.tenants (id, slug, name, country_code) select tenant_b, 'loyalty-bva-pgtap', 'Loyalty boundaries pgTAP', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) select account_b, tenant_b, 'mock', 'loyalty-bva', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name) select store_b, tenant_b, account_b, 'bva-1', 'Synthetic store' from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status, welcome_stamps, stamps_per_card)
select programme_b, tenant_b, 'Synthetic programme', date '2026-11-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status, 0, 8 from fx;

create temp table ids (name text primary key, id uuid);
insert into ids
select 'member_' || n,
  app.loyalty_join(fx.tenant_b, app.loyalty_customer_for_phone(fx.tenant_b, '0900000' || (300 + n)::text, fx.t0 - interval '1 day'), 'mini_app', fx.store_b, null, null, fx.t0 - interval '1 day')
from fx cross join generate_series(1, 12) n;

create function pg_temp.invoice(p_name text, p_sold timestamptz, p_net numeric)
returns uuid
language sql
as $$
  with inserted as (
    insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, gross_amount, net_amount, paid_amount)
    select fx.tenant_b, fx.store_b, fx.account_b, 'bva-' || p_name, null, p_sold, app.store_business_date(fx.store_b, p_sold), p_net, p_net, p_net
    from fx
    returning id
  )
  insert into ids (name, id) select p_name, inserted.id from inserted
  returning id;
$$;

create function pg_temp.earn(p_invoice uuid, p_member text)
returns text
language sql
as $$
  select concat_ws(':', e.stamps, e.points, coalesce(e.refusal, '-'), e.entry_id is not null)
  from app.loyalty_earn(p_invoice, (select id from ids where name = p_member), 'A', (select t0 from fx) + interval '1 hour') e;
$$;

create function pg_temp.outcome(p_statement text)
returns text
language plpgsql
as $$
begin
  execute p_statement;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

-- Minimum bill for a stamp: stamp_min_bill_amount = 50,000.
select is(pg_temp.earn(pg_temp.invoice('bill_x_minus_1', (select t0 from fx), 49999), 'member_1'), '0:4:below_minimum:t',
  'BVA minimum bill x - 1 (49,999): four points, no stamp, below_minimum noted');
select is(pg_temp.earn(pg_temp.invoice('bill_x', (select t0 from fx), 50000), 'member_2'), '1:5:-:t',
  'BVA minimum bill x (50,000): a stamp and five points');
select is(pg_temp.earn(pg_temp.invoice('bill_x_plus_1', (select t0 from fx), 50001), 'member_3'), '1:5:-:t',
  'BVA minimum bill x + 1 (50,001): a stamp and five points');

-- Point unit: one point per started 10,000.
select is(pg_temp.earn(pg_temp.invoice('unit_x_minus_1', (select t0 from fx), 9999), 'member_4'), '0:0:below_minimum:f',
  'BVA point unit x - 1 (9,999): nothing is earned and no ledger row is written');
select is(pg_temp.earn(pg_temp.invoice('unit_x', (select t0 from fx), 10000), 'member_5'), '0:1:below_minimum:t',
  'BVA point unit x (10,000): one point');
select is(pg_temp.earn(pg_temp.invoice('unit_x_plus_1', (select t0 from fx), 10001), 'member_5'), '0:1:below_minimum:t',
  'BVA point unit x + 1 (10,001): still one point');
select is(
  (select count(*)::integer from public.loyalty_ledger where membership_id = (select id from ids where name = 'member_4')),
  0,
  'BVA point unit x - 1: the member''s ledger is empty'
);

-- Daily cap of earning invoices: earning_invoices_per_phone_per_day = 3.
select is(pg_temp.earn(pg_temp.invoice('cap_1', (select t0 from fx) + interval '1 minute', 60000), 'member_6'), '1:6:-:t', 'BVA daily cap: the first invoice of the day earns');
select is(pg_temp.earn(pg_temp.invoice('cap_2', (select t0 from fx) + interval '2 minutes', 60000), 'member_6'), '1:6:-:t', 'BVA daily cap x - 1 (the second invoice) earns');
select is(pg_temp.earn(pg_temp.invoice('cap_3', (select t0 from fx) + interval '3 minutes', 60000), 'member_6'), '1:6:-:t', 'BVA daily cap x (the third invoice) earns');
select is(pg_temp.earn(pg_temp.invoice('cap_4', (select t0 from fx) + interval '4 minutes', 60000), 'member_6'), '0:0:daily_cap:f', 'BVA daily cap x + 1 (the fourth invoice) is refused daily_cap');
select is(
  (select string_agg(reason, ',') from public.loyalty_refusals where invoice_id = (select id from ids where name = 'cap_4')),
  'daily_cap',
  'BVA daily cap x + 1: the refusal is stored for the shift anomaly report'
);
select is(app.loyalty_clawback((select id from ids where name = 'cap_2'), 'synthetic void', (select t0 from fx) + interval '5 minutes'), 1,
  'a clawback reverses the second earn');
select is(pg_temp.earn(pg_temp.invoice('cap_5', (select t0 from fx) + interval '6 minutes', 60000), 'member_6'), '1:6:-:t',
  'BVA daily cap after a clawback: a clawed-back earn frees its place, so the next invoice is the third again and earns');
select is(pg_temp.earn(pg_temp.invoice('cap_6', (select t0 from fx) + interval '7 minutes', 60000), 'member_6'), '0:0:daily_cap:f',
  'BVA daily cap after a clawback: the one after is x + 1 again');
select is(pg_temp.earn(pg_temp.invoice('cap_next_day', (select t0 from fx) + interval '1 day', 60000), 'member_6'), '1:6:-:t',
  'BVA daily cap: the next business date starts a new count');

-- The discount cap of FR-CMP-12: at most 50 % off (Circular 39/2025/TT-BCT).
select is(pg_temp.outcome(format(
  $q$ insert into public.coupons (tenant_id, programme_id, reward_key, name, reward_kind, reward_percent, cost_stamps, status) values (%L, %L, 'pct-4999', 'Synthetic 49.99', 'percent_off', 49.99, 8, 'draft') $q$,
  (select tenant_b from fx), (select programme_b from fx))), 'ok', 'BVA discount cap x - 0.01 (49.99 %) is accepted');
select is(pg_temp.outcome(format(
  $q$ insert into public.coupons (tenant_id, programme_id, reward_key, name, reward_kind, reward_percent, cost_stamps, status) values (%L, %L, 'pct-5000', 'Synthetic 50', 'percent_off', 50.00, 8, 'draft') $q$,
  (select tenant_b from fx), (select programme_b from fx))), 'ok', 'BVA discount cap x (50 %) is accepted');
select is(pg_temp.outcome(format(
  $q$ insert into public.coupons (tenant_id, programme_id, reward_key, name, reward_kind, reward_percent, cost_stamps, status) values (%L, %L, 'pct-5001', 'Synthetic 50.01', 'percent_off', 50.01, 8, 'draft') $q$,
  (select tenant_b from fx), (select programme_b from fx))), '22023', 'BVA discount cap x + 0.01 (50.01 %) is refused');
select is(pg_temp.outcome(format(
  $q$ update public.coupons set reward_percent = 50.01 where tenant_id = %L and reward_key = 'pct-5000' $q$,
  (select tenant_b from fx))), '22023', 'BVA discount cap x + 0.01 is refused on an edit too');
select is(pg_temp.outcome(format(
  $q$ insert into public.coupons (tenant_id, programme_id, reward_key, name, reward_kind, reward_amount, min_bill_amount, cost_stamps, status) values (%L, %L, 'amt-25000', 'Synthetic 25k', 'amount_off', 25000, 50000, 8, 'draft') $q$,
  (select tenant_b from fx), (select programme_b from fx))), 'ok', 'BVA amount-off cap x (25,000 off a 50,000 minimum bill, 50 %) is accepted');
select is(pg_temp.outcome(format(
  $q$ insert into public.coupons (tenant_id, programme_id, reward_key, name, reward_kind, reward_amount, min_bill_amount, cost_stamps, status) values (%L, %L, 'amt-25001', 'Synthetic 25k+1', 'amount_off', 25001, 50000, 8, 'draft') $q$,
  (select tenant_b from fx), (select programme_b from fx))), '22023', 'BVA amount-off cap x + 1 (25,001 off 50,000) is refused');

-- Stamp card rollover: stamps_per_card = 8.
insert into public.loyalty_ledger (tenant_id, programme_id, membership_id, entry_kind, stamp_delta, point_delta, value_amount, reason, expires_at, occurred_at)
select fx.tenant_b, fx.programme_b, (select id from ids where name = 'member_' || v.member), 'adjust', v.stamps, 0, 0, 'synthetic credit',
  fx.t0 + interval '180 days', fx.t0
from fx cross join (values (7, 7), (8, 8), (9, 9), (10, 15), (11, 16), (12, 17)) as v (member, stamps);

create function pg_temp.card(p_member text)
returns text
language sql
as $$
  select concat_ws(':', b.stamps, b.cards_completed, b.stamps_on_card)
  from app.loyalty_balance((select id from ids where name = p_member), (select t0 from fx) + interval '1 hour') b;
$$;

select is(pg_temp.card('member_7'), '7:0:7', 'BVA card rollover x - 1 (7 of 8 stamps): no card completed, seven on the card');
select is(pg_temp.card('member_8'), '8:1:0', 'BVA card rollover x (8 stamps): one card completed, the next card empty');
select is(pg_temp.card('member_9'), '9:1:1', 'BVA card rollover x + 1 (9 stamps): one card completed, one on the next');
select is(pg_temp.card('member_10') || ',' || pg_temp.card('member_11') || ',' || pg_temp.card('member_12'), '15:1:7,16:2:0,17:2:1',
  'BVA second rollover 2x - 1, 2x, 2x + 1 (15, 16, 17 stamps)');

select * from finish();
rollback;
