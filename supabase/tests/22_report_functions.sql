begin;
select plan(99);

create temp table fixture as
select
  '44444444-4444-4444-8444-000000000001'::uuid as tenant_id,
  '44444444-4444-4444-8444-000000000011'::uuid as account_a,
  '44444444-4444-4444-8444-000000000012'::uuid as account_b,
  '44444444-4444-4444-8444-000000000021'::uuid as store_a,
  '44444444-4444-4444-8444-000000000022'::uuid as store_b,
  '44444444-4444-4444-8444-000000000023'::uuid as store_c,
  array['44444444-4444-4444-8444-000000000021', '44444444-4444-4444-8444-000000000022']::uuid[] as both_stores,
  '66666666-6666-4666-8666-000000000001'::uuid as aggregate_tenant_id,
  '66666666-6666-4666-8666-000000000011'::uuid as aggregate_account,
  '66666666-6666-4666-8666-000000000021'::uuid as hourly_store,
  '66666666-6666-4666-8666-000000000022'::uuid as lifecycle_store,
  '2025-01-01'::date as data_from,
  '2026-03-31'::date as data_to,
  '2026-03-18'::date as anchor;

insert into public.tenants (id, slug, name)
select tenant_id, 'report-fixture', 'Report Fixture' from fixture
union all
select aggregate_tenant_id, 'report-aggregates', 'Report Aggregates' from fixture;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_id, 'mock', 'report-account-a', 'Report Account A' from fixture
union all
select account_b, tenant_id, 'mock', 'report-account-b', 'Report Account B' from fixture
union all
select aggregate_account, aggregate_tenant_id, 'mock', 'report-aggregates', 'Report Aggregates' from fixture;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_a, tenant_id, account_a, 'report-store-a', 'Store A' from fixture
union all
select store_b, tenant_id, account_b, 'report-store-b', 'Store B' from fixture
union all
select store_c, tenant_id, account_a, 'report-store-c', 'Store C' from fixture
union all
select hourly_store, aggregate_tenant_id, aggregate_account, 'report-hourly', 'Store H' from fixture
union all
select lifecycle_store, aggregate_tenant_id, aggregate_account, 'report-lifecycle', 'Store L' from fixture;

insert into public.payment_methods (tenant_id, pos_account_id, external_id, name, kind)
select f.tenant_id, m.account_id, m.external_id, m.name, m.kind::public.payment_kind
from fixture f
cross join lateral (
  values
    (f.account_a, 'CASH-A', 'Cash', 'cash'),
    (f.account_a, 'CARD-A', 'Card', 'card'),
    (f.account_a, 'WALLET-A', 'E-wallet', 'ewallet'),
    (f.account_b, 'CASH-B', 'Cash', 'cash'),
    (f.account_b, 'WALLET-B', 'E-wallet', 'ewallet')
) as m (account_id, external_id, name, kind);

create temp table plan_stores as
select f.store_a as store_id, f.account_a as account_id, 'A'::text as store_code, 0 as store_offset from fixture f
union all
select f.store_b, f.account_b, 'B', 1 from fixture f;

create temp table sale_plan as
select
  ps.store_id,
  ps.account_id,
  ps.store_code,
  ps.store_offset,
  f.data_from + o.day_offset as business_date,
  o.day_offset as day_index,
  n.invoice_no,
  o.day_offset * 7 + n.invoice_no * 3 + ps.store_offset * 5 as seed,
  format('INV-%s-%s-%s', ps.store_code, to_char(f.data_from + o.day_offset, 'YYYYMMDD'), n.invoice_no) as external_id,
  format('SH-%s-%s', ps.store_code, to_char(f.data_from + o.day_offset, 'YYYYMMDD')) as shift_external_id
from fixture f
cross join plan_stores ps
cross join generate_series(0, f.data_to - f.data_from) as o (day_offset)
cross join generate_series(1, 2) as n (invoice_no);

create temp table sales_fixture as
select
  p.*,
  x.drink_no,
  x.drink_size,
  x.drink_quantity,
  x.drink_price,
  x.drink_quantity * x.drink_price as drink_gross,
  x.drink_discount,
  x.with_snack,
  x.with_modifier,
  x.bill_discount,
  x.extra_discount,
  x.bill_discount_name,
  x.voucher_amount,
  x.voucher_name,
  x.voucher_code,
  x.sale_status,
  x.customer_phone,
  x.sold_time,
  x.payment_mode,
  x.other_method,
  x.drink_quantity * x.drink_price + case when x.with_snack then 15000 else 0 end as gross_amount,
  x.drink_quantity * x.drink_price + case when x.with_snack then 15000 else 0 end
    - x.drink_discount - x.bill_discount - x.extra_discount - x.voucher_amount as net_amount
from sale_plan p
cross join lateral (
  select
    (p.seed % 6) + 1 as drink_no,
    case when p.seed % 5 = 0 then 'L' else 'M' end as drink_size,
    1 + p.seed % 2 as drink_quantity,
    30000 + ((p.seed % 6) + 1) * 5000 + case when p.seed % 5 = 0 then 10000 else 0 end as drink_price,
    case when p.seed % 9 = 0 then 5000 else 0 end as drink_discount,
    p.seed % 3 = 0 as with_snack,
    p.seed % 4 = 0 as with_modifier,
    case when p.seed % 11 = 0 then 3000 else 0 end as bill_discount,
    case when p.seed % 11 = 0 then 2000 else 0 end as extra_discount,
    case when p.seed % 11 = 0 and p.seed % 22 <> 0 then 'Loyal guest' end as bill_discount_name,
    case when p.seed % 13 = 0 then 4000 else 0 end as voucher_amount,
    case when p.seed % 13 = 0 then 'Spring voucher' end as voucher_name,
    case when p.seed % 17 = 0 then 'CODE-' || (p.seed % 3)::text end as voucher_code,
    (case when p.seed % 41 = 0 then 'voided' when p.seed % 23 = 0 then 'edited' else 'completed' end)::public.invoice_status as sale_status,
    case when p.seed % 5 = 1 then 'member-' || (p.seed % 7)::text end as customer_phone,
    case when p.invoice_no = 1 then time '09:00' else time '19:00' end + make_interval(hours => p.seed % 3) as sold_time,
    case when p.seed % 6 = 0 then 'split' when p.seed % 2 = 0 then 'cash' else 'other' end as payment_mode,
    case when p.store_code = 'A' and p.seed % 4 = 1 then 'CARD-A' when p.store_code = 'A' then 'WALLET-A' else 'WALLET-B' end as other_method
) x;

insert into public.invoices (
  tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, shift_external_id, customer_phone,
  gross_amount, item_discount_amount, bill_discount_amount, extra_discount_amount, bill_discount_name,
  voucher_code, voucher_name, voucher_amount, net_amount, paid_amount, status
)
select
  f.tenant_id, s.store_id, s.account_id, s.external_id, (s.business_date + s.sold_time) at time zone 'Asia/Ho_Chi_Minh', s.business_date,
  s.shift_external_id, s.customer_phone, s.gross_amount, s.drink_discount, s.bill_discount, s.extra_discount, s.bill_discount_name,
  s.voucher_code, s.voucher_name, s.voucher_amount, s.net_amount, s.net_amount, s.sale_status
from sales_fixture s
cross join fixture f;

insert into public.invoice_lines (
  tenant_id, store_id, invoice_id, external_id, parent_line_external_id, line_kind, item_external_id, item_name, base_name, size_label,
  item_type_external_id, item_type_name, quantity, unit_price, gross_amount, discount_amount, net_amount, promotion_external_id, promotion_name
)
select
  f.tenant_id, s.store_id, i.id, 'L1', null, 'item'::public.line_kind,
  format('DRINK-%s-%s', s.drink_no, s.drink_size), format('Drink %s (%s)', s.drink_no, s.drink_size), format('Drink %s', s.drink_no), s.drink_size,
  case when s.drink_no <= 3 then 'TYPE-TEA' else 'TYPE-COFFEE' end, case when s.drink_no <= 3 then 'Tea' else 'Coffee' end,
  s.drink_quantity, s.drink_price, s.drink_gross, s.drink_discount, s.drink_gross - s.drink_discount,
  case when s.drink_discount > 0 and s.seed % 2 = 0 then 'PROMO-HAPPY' end,
  case when s.drink_discount > 0 then 'Happy hour' end
from sales_fixture s
cross join fixture f
join public.invoices i on i.store_id = s.store_id and i.external_id = s.external_id
union all
select
  f.tenant_id, s.store_id, i.id, 'L2', null, 'item'::public.line_kind,
  'SNACK-1', 'Snack', 'Snack', null, 'TYPE-SNACK', 'Snacks', 1, 15000, 15000, 0, 15000, null, null
from sales_fixture s
cross join fixture f
join public.invoices i on i.store_id = s.store_id and i.external_id = s.external_id
where s.with_snack
union all
select
  f.tenant_id, s.store_id, i.id, 'L3', 'L1', 'modifier'::public.line_kind,
  'MOD-ICE', 'Less ice', null, null, 'TYPE-OPTION', 'Options', 1, 0, 0, 0, 0, null, null
from sales_fixture s
cross join fixture f
join public.invoices i on i.store_id = s.store_id and i.external_id = s.external_id
where s.with_modifier;

insert into public.invoice_payments (tenant_id, store_id, invoice_id, sequence_no, business_date, payment_method_external_id, amount)
select
  f.tenant_id, s.store_id, i.id, 1, s.business_date,
  case when s.payment_mode = 'other' then s.other_method else 'CASH-' || s.store_code end,
  case when s.payment_mode = 'split' then 10000 else s.net_amount end
from sales_fixture s
cross join fixture f
join public.invoices i on i.store_id = s.store_id and i.external_id = s.external_id
union all
select f.tenant_id, s.store_id, i.id, 2, s.business_date, s.other_method, s.net_amount - 10000
from sales_fixture s
cross join fixture f
join public.invoices i on i.store_id = s.store_id and i.external_id = s.external_id
where s.payment_mode = 'split';

insert into public.shifts (
  tenant_id, store_id, external_id, name, cashier_name, opened_at, closed_at, sales_amount, orders_count,
  opening_float_amount, expected_cash_amount, cash_drawer_amount
)
select
  f.tenant_id,
  d.store_id,
  d.shift_external_id,
  'Day shift',
  case when d.day_index % 2 = 0 then 'Cashier One' else 'Cashier Two' end,
  (d.business_date + time '06:00') at time zone 'Asia/Ho_Chi_Minh',
  (d.business_date + time '23:30') at time zone 'Asia/Ho_Chi_Minh',
  d.sales_amount,
  d.orders,
  500000,
  500000 + d.cash_amount,
  case
    when (d.day_index + d.store_offset) % 31 = 0 then null
    else 500000 + d.cash_amount + case
      when (d.day_index + d.store_offset * 3) % 17 = 0 then 80000
      when (d.day_index + d.store_offset * 3) % 7 = 0 then -15000
      when (d.day_index + d.store_offset * 3) % 5 = 0 then 3000
      else 0
    end
  end
from (
  select
    s.store_id,
    s.store_offset,
    s.business_date,
    s.day_index,
    s.shift_external_id,
    coalesce(sum(s.net_amount) filter (where s.sale_status <> 'voided'), 0) as sales_amount,
    (count(*) filter (where s.sale_status <> 'voided'))::integer as orders,
    coalesce(sum(case s.payment_mode when 'split' then 10000 when 'cash' then s.net_amount else 0 end) filter (where s.sale_status <> 'voided'), 0) as cash_amount
  from sales_fixture s
  group by s.store_id, s.store_offset, s.business_date, s.day_index, s.shift_external_id
) d
cross join fixture f;

insert into public.invoices (
  tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, item_discount_amount,
  bill_discount_amount, extra_discount_amount, bill_discount_name, voucher_name, voucher_amount, net_amount, paid_amount, status
)
select f.tenant_id, f.store_a, f.account_a, 'INV-A-VOID', ('2026-02-10'::date + time '15:00') at time zone 'Asia/Ho_Chi_Minh', '2026-02-10',
  90000, 9000, 7000, 1000, 'Voided bill', 'Voided voucher', 6000, 67000, 67000, 'voided'
from fixture f;

insert into public.invoice_lines (tenant_id, store_id, invoice_id, external_id, line_kind, item_external_id, item_name, quantity, unit_price, gross_amount, discount_amount, net_amount, promotion_external_id, promotion_name)
select f.tenant_id, f.store_a, i.id, 'L1', 'item', 'DRINK-1-M', 'Drink 1 (M)', 2, 45000, 90000, 9000, 81000, 'PROMO-VOID', 'Voided promotion'
from fixture f
join public.invoices i on i.store_id = f.store_a and i.external_id = 'INV-A-VOID';

insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, net_amount, paid_amount)
select f.tenant_id, l.store_id, l.account_id, l.external_id, (l.business_date + time '10:00') at time zone 'Asia/Ho_Chi_Minh', l.business_date, 40000, 40000, 40000
from fixture f
cross join lateral (
  values
    (f.store_b, f.account_b, 'LIVE-B-1', current_date - 1),
    (f.store_b, f.account_b, 'LIVE-B-2', current_date - 1),
    (f.store_b, f.account_b, 'LIVE-B-3', current_date),
    (f.store_b, f.account_b, 'LIVE-B-4', current_date),
    (f.store_c, f.account_a, 'LIVE-C-1', current_date)
) as l (store_id, account_id, external_id, business_date);

insert into public.invoice_lines (tenant_id, store_id, invoice_id, external_id, line_kind, item_external_id, item_name, quantity, unit_price, gross_amount, net_amount)
select f.tenant_id, i.store_id, i.id, 'L1', 'item', 'DRINK-2-M', 'Drink 2 (M)', 1, 40000, 40000, 40000
from fixture f
join public.invoices i on i.tenant_id = f.tenant_id and i.external_id like 'LIVE-%';

insert into public.invoice_payments (tenant_id, store_id, invoice_id, sequence_no, business_date, payment_method_external_id, amount)
select f.tenant_id, i.store_id, i.id, 1, i.business_date, case when i.store_id = f.store_b then 'CASH-B' else 'CASH-A' end, 40000
from fixture f
join public.invoices i on i.tenant_id = f.tenant_id and i.external_id like 'LIVE-%';

insert into public.sync_checks (tenant_id, store_id, business_date, is_matched)
select f.tenant_id, f.store_a, d::date, d::date <> '2026-03-06'::date
from fixture f
cross join generate_series('2026-03-01'::date, '2026-03-31'::date, interval '1 day') as d
where d::date <> '2026-03-05'::date
union all
select f.tenant_id, f.store_b, '2026-03-10'::date, true
from fixture f;

insert into public.targets (tenant_id, store_id, period_kind, period_start, net_target_amount)
select f.tenant_id, t.store_id, t.period_kind::public.period_kind, t.period_start, t.amount
from fixture f
cross join lateral (
  values
    (f.store_a, 'month', '2026-03-01'::date, 10000000),
    (f.store_a, 'month', '2026-02-01'::date, 9000000),
    (f.store_b, 'week', '2026-03-16'::date, 2000000)
) as t (store_id, period_kind, period_start, amount);

insert into public.holidays (tenant_id, country_code, holiday_date, name, kind)
select f.tenant_id, 'VN', h.holiday_date, h.name, h.kind::public.holiday_kind
from fixture f
cross join (
  values
    ('2025-06-10'::date, 'Store Tet first day', 'tet'),
    ('2025-06-11'::date, 'Store Tet second day', 'tet'),
    ('2025-06-14'::date, 'Store Tet last day', 'tet'),
    ('2025-06-20'::date, 'Store anniversary', 'custom')
) as h (holiday_date, name, kind);

select app.refresh_analytics(f.tenant_id, f.data_from, f.data_to) from fixture f;

insert into public.agg_daily_sales (tenant_id, store_id, business_date, invoices, net_amount, items_sold)
select f.aggregate_tenant_id, f.hourly_store, d.business_date, d.invoices, d.net_amount, d.invoices
from fixture f
cross join (
  values
    ('2025-06-25'::date, 3, 200),
    ('2025-06-18'::date, 2, 150),
    ('2025-06-11'::date, 3, 300),
    ('2025-06-04'::date, 2, 200),
    ('2025-05-28'::date, 4, 400),
    ('2025-04-30'::date, 9, 10000)
) as d (business_date, invoices, net_amount);

insert into public.agg_hourly_sales (tenant_id, store_id, business_date, hour_local, invoices, net_amount, items_sold)
select f.aggregate_tenant_id, f.hourly_store, h.business_date, h.hour_local, h.invoices, h.net_amount, h.invoices
from fixture f
cross join (
  values
    ('2025-06-25'::date, 10, 2, 120),
    ('2025-06-25'::date, 15, 1, 80),
    ('2025-06-18'::date, 10, 1, 100),
    ('2025-06-18'::date, 11, 1, 50),
    ('2025-06-11'::date, 10, 3, 300),
    ('2025-06-04'::date, 10, 2, 200),
    ('2025-05-28'::date, 10, 4, 400),
    ('2025-04-30'::date, 10, 9, 10000)
) as h (business_date, hour_local, invoices, net_amount);

insert into public.agg_item_daily (tenant_id, store_id, business_date, item_external_id, item_name, item_type_external_id, item_type_name, quantity, net_amount, invoices)
select f.aggregate_tenant_id, f.lifecycle_store, r.business_date, r.item_external_id, r.item_name, 'TYPE-TEA', 'Tea', r.quantity, r.net_amount, r.quantity
from fixture f
cross join (
  values
    ('2027-01-15'::date, 'LIFE-A', 'Lifecycle A', 5, 50),
    ('2027-03-02'::date, 'LIFE-A', 'Lifecycle A', 7, 70),
    ('2028-01-10'::date, 'LIFE-A', 'Lifecycle A', 3, 30),
    ('2028-02-29'::date, 'LIFE-A', 'Lifecycle A', 4, 40),
    ('2028-03-01'::date, 'LIFE-A', 'Lifecycle A', 6, 60),
    ('2026-12-31'::date, 'LIFE-B', 'Lifecycle B', 9, 90),
    ('2028-02-29'::date, 'LIFE-C', 'Lifecycle C', 2, 20)
) as r (business_date, item_external_id, item_name, quantity, net_amount);

select has_function('app', 'period_bounds', array['text', 'date'], 'app.period_bounds takes a grain and an anchor');
select has_function('app', 'period_totals', array['uuid[]', 'date', 'date'], 'app.period_totals takes stores and a range');
select has_function('app', 'shift_variance_scores', array['uuid[]', 'date', 'date', 'numeric', 'numeric'], 'app.shift_variance_scores takes stores, a range and the two thresholds');
select has_function('public', 'cash_variance_flags', array['uuid[]', 'date', 'date', 'numeric', 'numeric'], 'public.cash_variance_flags keeps its signature');
select has_function('public', 'period_compare_by_store', array['uuid[]', 'text', 'date'], 'public.period_compare_by_store exists');
select has_function('public', 'period_series', array['uuid[]', 'text', 'date', 'date', 'boolean'], 'public.period_series takes an optional include_stores');
select has_function('public', 'daily_baselines', array['uuid[]', 'date', 'date', 'integer'], 'public.daily_baselines exists');
select has_function('public', 'hourly_profile', array['uuid[]', 'date', 'integer'], 'public.hourly_profile exists');
select has_function('public', 'metric_compare', array['uuid[]', 'text[]', 'text', 'date'], 'public.metric_compare exists');
select has_function('public', 'item_summary', array['uuid[]', 'date', 'date', 'date', 'date'], 'public.item_summary takes an optional compare range');
select has_function('public', 'payment_summary', array['uuid[]', 'date', 'date', 'date', 'date'], 'public.payment_summary takes an optional compare range');
select has_function('public', 'promotion_summary', array['uuid[]', 'date', 'date'], 'public.promotion_summary exists');
select has_function('public', 'shift_review', array['uuid[]', 'date', 'date', 'numeric', 'numeric'], 'public.shift_review exists');
select has_function('public', 'item_lifecycle', array['uuid[]', 'date'], 'public.item_lifecycle exists');
select has_function('public', 'store_coverage', array['uuid[]', 'date', 'date'], 'public.store_coverage exists');
select has_function('public', 'store_targets', array['uuid[]', 'period_kind', 'date'], 'public.store_targets exists');

create temp table report_functions as
select f.function_name
from (
  values
    ('period_compare_by_store'), ('period_series'), ('daily_baselines'), ('hourly_profile'), ('metric_compare'), ('item_summary'),
    ('payment_summary'), ('promotion_summary'), ('shift_review'), ('item_lifecycle'), ('store_coverage'), ('store_targets')
) as f (function_name);

select is(
  (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (select function_name from report_functions)
      and (p.prosecdef or p.provolatile <> 's' or not coalesce('search_path=""' = any (p.proconfig), false))
  ),
  0::bigint,
  'every report function is security invoker, stable and pins an empty search_path'
);
select is(
  (
    select count(*)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (select function_name from report_functions)
  ),
  12::bigint,
  'each report function has a single signature, so PostgREST resolves it by argument names'
);
select is(
  (
    select (p.provolatile, p.prosecdef, 'search_path=""' = any (p.proconfig))
    from pg_proc p
    where p.oid = 'app.period_bounds(text, date)'::regprocedure
  ),
  ('i'::"char", false, true),
  'app.period_bounds is immutable, security invoker and pins an empty search_path'
);

create temp table bound_anchors as
select a.anchor
from (
  values ('2026-01-01'::date), ('2026-02-28'::date), ('2028-02-29'::date), ('2026-03-31'::date), ('2026-12-31'::date), ('2026-12-28'::date), ('2027-01-03'::date)
) as a (anchor);

select results_eq(
  $$ select a.anchor, b.period, b.from_date, b.to_date
     from bound_anchors a cross join lateral app.period_bounds('day', a.anchor) with ordinality as b (period, from_date, to_date, position)
     order by a.anchor, b.position $$,
  $$ select a.anchor, c.period, c.from_date, c.to_date
     from bound_anchors a cross join lateral public.period_compare('{}'::uuid[], 'day', a.anchor) with ordinality as c
     order by a.anchor, c.ordinality $$,
  'period_bounds equals the day boundaries of period_compare, baseline included'
);
select results_eq(
  $$ select a.anchor, b.period, b.from_date, b.to_date
     from bound_anchors a cross join lateral app.period_bounds('week', a.anchor) with ordinality as b (period, from_date, to_date, position)
     order by a.anchor, b.position $$,
  $$ select a.anchor, c.period, c.from_date, c.to_date
     from bound_anchors a cross join lateral public.period_compare('{}'::uuid[], 'week', a.anchor) with ordinality as c
     order by a.anchor, c.ordinality $$,
  'period_bounds equals the week boundaries of period_compare, ISO week 53 included'
);
select results_eq(
  $$ select a.anchor, b.period, b.from_date, b.to_date
     from bound_anchors a cross join lateral app.period_bounds('month', a.anchor) with ordinality as b (period, from_date, to_date, position)
     order by a.anchor, b.position $$,
  $$ select a.anchor, c.period, c.from_date, c.to_date
     from bound_anchors a cross join lateral public.period_compare('{}'::uuid[], 'month', a.anchor) with ordinality as c
     order by a.anchor, c.ordinality $$,
  'period_bounds equals the month boundaries of period_compare, clipped month ends and the leap day included'
);
select results_eq(
  $$ select a.anchor, b.period, b.from_date, b.to_date
     from bound_anchors a cross join lateral app.period_bounds('year', a.anchor) with ordinality as b (period, from_date, to_date, position)
     order by a.anchor, b.position $$,
  $$ select a.anchor, c.period, c.from_date, c.to_date
     from bound_anchors a cross join lateral public.period_compare('{}'::uuid[], 'year', a.anchor) with ordinality as c
     order by a.anchor, c.ordinality $$,
  'period_bounds equals the year boundaries of period_compare'
);
select throws_ok(
  $$ select * from app.period_bounds('quarter', '2026-03-18') $$,
  '22023',
  null,
  'period_bounds rejects an unknown grain with invalid_parameter_value'
);

create temp table totals_ranges as
select r.range_name, r.store_ids, r.from_date, r.to_date
from fixture f
cross join lateral (
  values
    ('a whole year', f.both_stores, '2025-01-01'::date, '2025-12-31'::date),
    ('a month', f.both_stores, '2026-03-01'::date, '2026-03-31'::date),
    ('the live days', array[f.store_a, f.store_b, f.store_c], current_date - 3, current_date)
) as r (range_name, store_ids, from_date, to_date);

select is(
  (
    select count(*)
    from totals_ranges r
    cross join lateral app.period_totals(r.store_ids, r.from_date, r.to_date) t
    cross join lateral app.summarize_daily(r.store_ids, r.from_date, r.to_date) s
    where r.range_name = 'a whole year'
      and (t.days_with_data, t.invoices, t.net_amount, t.gross_amount, t.discount_amount, t.paid_amount, t.cash_amount, t.items_sold,
        t.voucher_invoices, t.member_invoices, t.identified_invoices, t.avg_ticket, t.items_per_ticket, t.avg_item_price,
        t.cash_share, t.voucher_share, t.member_share, t.identified_share)
        is not distinct from
        (s.days_with_data, s.invoices, s.net_amount, s.gross_amount, s.discount_amount, s.paid_amount, s.cash_amount, s.items_sold,
        s.voucher_invoices, s.member_invoices, s.identified_invoices, s.avg_ticket, s.items_per_ticket, s.avg_item_price,
        s.cash_share, s.voucher_share, s.member_share, s.identified_share)
      and t.days_with_data > 0
  ),
  1::bigint,
  'period_totals equals summarize_daily on every shared column over a whole year'
);
select is(
  (
    select count(*)
    from totals_ranges r
    cross join lateral app.period_totals(r.store_ids, r.from_date, r.to_date) t
    cross join lateral app.summarize_daily(r.store_ids, r.from_date, r.to_date) s
    where r.range_name = 'a month'
      and (t.days_with_data, t.invoices, t.net_amount, t.gross_amount, t.discount_amount, t.paid_amount, t.cash_amount, t.items_sold,
        t.voucher_invoices, t.member_invoices, t.identified_invoices, t.avg_ticket, t.items_per_ticket, t.avg_item_price,
        t.cash_share, t.voucher_share, t.member_share, t.identified_share)
        is not distinct from
        (s.days_with_data, s.invoices, s.net_amount, s.gross_amount, s.discount_amount, s.paid_amount, s.cash_amount, s.items_sold,
        s.voucher_invoices, s.member_invoices, s.identified_invoices, s.avg_ticket, s.items_per_ticket, s.avg_item_price,
        s.cash_share, s.voucher_share, s.member_share, s.identified_share)
      and t.days_with_data > 0
  ),
  1::bigint,
  'period_totals equals summarize_daily on every shared column over a month'
);
select is(
  (
    select count(*)
    from totals_ranges r
    cross join lateral app.period_totals(r.store_ids, r.from_date, r.to_date) t
    cross join lateral app.summarize_daily(r.store_ids, r.from_date, r.to_date) s
    where r.range_name = 'the live days'
      and (t.days_with_data, t.invoices, t.net_amount, t.gross_amount, t.discount_amount, t.paid_amount, t.cash_amount, t.items_sold,
        t.voucher_invoices, t.member_invoices, t.identified_invoices, t.avg_ticket, t.items_per_ticket, t.avg_item_price,
        t.cash_share, t.voucher_share, t.member_share, t.identified_share)
        is not distinct from
        (s.days_with_data, s.invoices, s.net_amount, s.gross_amount, s.discount_amount, s.paid_amount, s.cash_amount, s.items_sold,
        s.voucher_invoices, s.member_invoices, s.identified_invoices, s.avg_ticket, s.items_per_ticket, s.avg_item_price,
        s.cash_share, s.voucher_share, s.member_share, s.identified_share)
      and t.days_with_data = 3
  ),
  1::bigint,
  'period_totals equals summarize_daily over the live days, read from the fact tables'
);
select is(
  (
    select t.discount_rate is not distinct from public.metric_value(r.store_ids, 'discount_rate', r.from_date, r.to_date) and t.discount_rate > 0
    from totals_ranges r
    cross join lateral app.period_totals(r.store_ids, r.from_date, r.to_date) t
    where r.range_name = 'a whole year'
  ),
  true,
  'period_totals discount_rate equals metric_value discount_rate, over the gross denominator'
);
select is(
  (
    select (t.days_with_data, t.invoices, t.net_amount, t.discount_amount, t.voided_invoices, t.avg_ticket, t.discount_rate)
    from fixture f
    cross join lateral app.period_totals(f.both_stores, '2024-01-01', '2024-01-31') t
  ),
  (0, null::bigint, null::numeric, null::numeric, null::bigint, null::numeric, null::numeric),
  'an empty range gives zero days with data and null sums and ratios, not zeros'
);

create temp table compare_blocks as
select g.grain, c.*
from fixture f
cross join (values ('day'), ('week'), ('month'), ('year')) as g (grain)
cross join lateral public.period_compare_by_store(f.both_stores, g.grain, f.anchor) c;

create temp table compare_reference as
select g.grain, c.*
from fixture f
cross join (values ('day'), ('week'), ('month'), ('year')) as g (grain)
cross join lateral public.period_compare(f.both_stores, g.grain, f.anchor) with ordinality as c;

select results_eq(
  $$ select c.period, c.from_date, c.to_date, c.days_with_data, c.invoices, c.net_amount, c.gross_amount, c.discount_amount, c.avg_ticket,
       c.items_per_ticket, c.avg_item_price, c.cash_share, c.voucher_share, c.member_share, c.identified_share
     from fixture f cross join lateral public.period_compare_by_store(f.both_stores, 'day', f.anchor) c where c.store_id is null $$,
  $$ select c.period, c.from_date, c.to_date, c.days_with_data, c.invoices, c.net_amount, c.gross_amount, c.discount_amount, c.avg_ticket,
       c.items_per_ticket, c.avg_item_price, c.cash_share, c.voucher_share, c.member_share, c.identified_share
     from compare_reference c where c.grain = 'day' order by c.ordinality $$,
  'the all-stores day block equals period_compare, baseline row included'
);
select results_eq(
  $$ select c.period, c.from_date, c.to_date, c.days_with_data, c.invoices, c.net_amount, c.gross_amount, c.discount_amount, c.avg_ticket,
       c.items_per_ticket, c.avg_item_price, c.cash_share, c.voucher_share, c.member_share, c.identified_share
     from fixture f cross join lateral public.period_compare_by_store(f.both_stores, 'week', f.anchor) c where c.store_id is null $$,
  $$ select c.period, c.from_date, c.to_date, c.days_with_data, c.invoices, c.net_amount, c.gross_amount, c.discount_amount, c.avg_ticket,
       c.items_per_ticket, c.avg_item_price, c.cash_share, c.voucher_share, c.member_share, c.identified_share
     from compare_reference c where c.grain = 'week' order by c.ordinality $$,
  'the all-stores week block equals period_compare'
);
select results_eq(
  $$ select c.period, c.from_date, c.to_date, c.days_with_data, c.invoices, c.net_amount, c.gross_amount, c.discount_amount, c.avg_ticket,
       c.items_per_ticket, c.avg_item_price, c.cash_share, c.voucher_share, c.member_share, c.identified_share
     from fixture f cross join lateral public.period_compare_by_store(f.both_stores, 'month', f.anchor) c where c.store_id is null $$,
  $$ select c.period, c.from_date, c.to_date, c.days_with_data, c.invoices, c.net_amount, c.gross_amount, c.discount_amount, c.avg_ticket,
       c.items_per_ticket, c.avg_item_price, c.cash_share, c.voucher_share, c.member_share, c.identified_share
     from compare_reference c where c.grain = 'month' order by c.ordinality $$,
  'the all-stores month block equals period_compare'
);
select results_eq(
  $$ select c.period, c.from_date, c.to_date, c.days_with_data, c.invoices, c.net_amount, c.gross_amount, c.discount_amount, c.avg_ticket,
       c.items_per_ticket, c.avg_item_price, c.cash_share, c.voucher_share, c.member_share, c.identified_share
     from fixture f cross join lateral public.period_compare_by_store(f.both_stores, 'year', f.anchor) c where c.store_id is null $$,
  $$ select c.period, c.from_date, c.to_date, c.days_with_data, c.invoices, c.net_amount, c.gross_amount, c.discount_amount, c.avg_ticket,
       c.items_per_ticket, c.avg_item_price, c.cash_share, c.voucher_share, c.member_share, c.identified_share
     from compare_reference c where c.grain = 'year' order by c.ordinality $$,
  'the all-stores year block equals period_compare'
);

create temp table compare_store_sums as
select
  s.grain,
  s.period,
  count(*) as store_rows,
  sum(s.days_with_data) as days_with_data,
  sum(s.invoices) as invoices,
  sum(s.net_amount) as net_amount,
  sum(s.gross_amount) as gross_amount,
  sum(s.item_discount_amount) as item_discount_amount,
  sum(s.bill_discount_amount) as bill_discount_amount,
  sum(s.voucher_amount) as voucher_amount,
  sum(s.discount_amount) as discount_amount,
  sum(s.paid_amount) as paid_amount,
  sum(s.cash_amount) as cash_amount,
  sum(s.items_sold) as items_sold,
  sum(s.voucher_invoices) as voucher_invoices,
  sum(s.member_invoices) as member_invoices,
  sum(s.identified_invoices) as identified_invoices,
  sum(s.voided_invoices) as voided_invoices,
  sum(s.voided_amount) as voided_amount,
  sum(s.edited_invoices) as edited_invoices
from compare_blocks s
where s.store_id is not null
  and s.period <> 'baseline'
group by s.grain, s.period;

create temp table compare_additivity as
select
  a.grain,
  p.store_rows = 2
    and (a.days_with_data, a.invoices, a.net_amount, a.gross_amount, a.item_discount_amount, a.bill_discount_amount, a.voucher_amount,
      a.discount_amount, a.paid_amount, a.cash_amount, a.items_sold, a.voucher_invoices, a.member_invoices, a.identified_invoices,
      a.voided_invoices, a.voided_amount, a.edited_invoices)
      is not distinct from
      (p.days_with_data, p.invoices, p.net_amount, p.gross_amount, p.item_discount_amount, p.bill_discount_amount, p.voucher_amount,
      p.discount_amount, p.paid_amount, p.cash_amount, p.items_sold, p.voucher_invoices, p.member_invoices, p.identified_invoices,
      p.voided_invoices, p.voided_amount, p.edited_invoices)
    and a.days_with_data > 0 as adds_up
from compare_blocks a
join compare_store_sums p on p.grain = a.grain and p.period = a.period
where a.store_id is null;

select is((select array_agg(adds_up) from compare_additivity where grain = 'day'), array[true, true, true], 'per-store day rows add up to the all-stores rows of current, previous and last year');
select is((select array_agg(adds_up) from compare_additivity where grain = 'week'), array[true, true, true], 'per-store week rows add up to the all-stores rows');
select is((select array_agg(adds_up) from compare_additivity where grain = 'month'), array[true, true, true], 'per-store month rows add up to the all-stores rows');
select is((select array_agg(adds_up) from compare_additivity where grain = 'year'), array[true, true, true], 'per-store year rows add up to the all-stores rows');
select is(
  (
    select array_agg(
      (c.days_with_data, c.invoices, c.net_amount, c.avg_ticket)
        is not distinct from (b.sample_days, round(b.baseline_invoices)::bigint, b.baseline_net_amount, b.baseline_avg_ticket)
        and c.days_with_data = 7
      order by c.store_id
    )
    from compare_blocks c
    cross join fixture f
    cross join lateral public.same_weekday_baseline(array[c.store_id], f.anchor, 8) b
    where c.grain = 'day'
      and c.period = 'baseline'
      and c.store_id is not null
  ),
  array[true, true],
  'each store block carries the same-weekday baseline of that store, with the Tet candidate left out'
);

create temp table series_rows as
select g.grain, s.*
from fixture f
cross join (
  values
    ('day', '2026-02-01'::date, '2026-03-31'::date),
    ('week', '2025-12-20'::date, '2026-03-31'::date),
    ('month', '2025-01-15'::date, '2026-03-31'::date),
    ('year', '2025-03-01'::date, '2026-03-31'::date),
    ('weekday', '2026-01-01'::date, '2026-03-31'::date)
) as g (grain, from_date, to_date)
cross join lateral public.period_series(f.both_stores, g.grain, g.from_date, g.to_date) s;

create temp table series_checks as
select
  s.grain,
  count(*) as bucket_rows,
  count(*) filter (
    where (s.days_with_data, s.invoices, s.net_amount, s.gross_amount, s.item_discount_amount, s.bill_discount_amount, s.voucher_amount,
      s.discount_amount, s.paid_amount, s.cash_amount, s.items_sold, s.voucher_invoices, s.member_invoices, s.identified_invoices,
      s.voided_invoices, s.voided_amount, s.edited_invoices, s.avg_ticket, s.items_per_ticket, s.avg_item_price, s.cash_share,
      s.voucher_share, s.member_share, s.identified_share, s.discount_rate)
      is distinct from
      (t.days_with_data, t.invoices, t.net_amount, t.gross_amount, t.item_discount_amount, t.bill_discount_amount, t.voucher_amount,
      t.discount_amount, t.paid_amount, t.cash_amount, t.items_sold, t.voucher_invoices, t.member_invoices, t.identified_invoices,
      t.voided_invoices, t.voided_amount, t.edited_invoices, t.avg_ticket, t.items_per_ticket, t.avg_item_price, t.cash_share,
      t.voucher_share, t.member_share, t.identified_share, t.discount_rate)
  ) as mismatches,
  count(*) filter (where s.store_id is not null) as store_rows
from series_rows s
cross join fixture f
cross join lateral app.period_totals(
  case when s.store_id is null then f.both_stores else array[s.store_id] end,
  s.bucket_start,
  s.bucket_end
) t
where s.grain in ('day', 'week', 'month', 'year')
group by s.grain;

select is((select (bucket_rows, mismatches, store_rows) from series_checks where grain = 'day'), (177::bigint, 0::bigint, 118::bigint), 'every day bucket equals period_totals of its date, for all stores and per store');
select is((select (bucket_rows, mismatches, store_rows) from series_checks where grain = 'week'), (48::bigint, 0::bigint, 32::bigint), 'every ISO week bucket, clipped to the range, equals period_totals of its range');
select is((select (bucket_rows, mismatches, store_rows) from series_checks where grain = 'month'), (45::bigint, 0::bigint, 30::bigint), 'every month bucket, the first clipped, equals period_totals of its range');
select is((select (bucket_rows, mismatches, store_rows) from series_checks where grain = 'year'), (6::bigint, 0::bigint, 4::bigint), 'every year bucket equals period_totals of its range');

create temp table weekday_reference as
select
  d.store_id,
  extract(isodow from d.business_date)::smallint as weekday,
  count(*)::integer as days_with_data,
  sum(d.invoices) as invoices,
  sum(d.net_amount) as net_amount,
  sum(d.items_sold) as items_sold,
  sum(d.cash_amount) as cash_amount,
  round(sum(d.net_amount) / nullif(sum(d.invoices), 0), 2) as avg_ticket,
  round(sum(d.cash_amount) / nullif(sum(d.paid_amount), 0), 6) as cash_share
from fixture f
cross join lateral app.daily_sales(f.both_stores, '2026-01-01', '2026-03-31') d
group by grouping sets ((extract(isodow from d.business_date)), (extract(isodow from d.business_date), d.store_id));

select is(
  (
    select (count(*), count(*) filter (
      where (s.days_with_data, s.invoices, s.net_amount, s.items_sold, s.cash_amount, s.avg_ticket, s.cash_share)
        is distinct from (w.days_with_data, w.invoices, w.net_amount, w.items_sold, w.cash_amount, w.avg_ticket, w.cash_share)
        or s.bucket_start <> '2026-01-01'::date
        or s.bucket_end <> '2026-03-31'::date
    ))
    from series_rows s
    left join weekday_reference w on w.weekday = s.weekday and w.store_id is not distinct from s.store_id
    where s.grain = 'weekday'
  ),
  (21::bigint, 0::bigint),
  'each weekday bucket covers the whole range and totals the days of that weekday, for all stores and per store'
);
select is(
  (
    select (sum(d.invoices)::numeric, sum(d.net_amount), sum(d.items_sold), sum(d.calendar_days)::numeric)
    from fixture f
    cross join lateral public.period_series(f.both_stores, 'day', '2026-03-01', '2026-03-31') d
    where d.store_id is null
  ),
  (
    select (m.invoices::numeric, m.net_amount, m.items_sold, m.calendar_days::numeric)
    from fixture f
    cross join lateral public.period_series(f.both_stores, 'month', '2026-03-01', '2026-03-31') m
    where m.store_id is null
  ),
  'the day buckets of a month sum to its month bucket'
);
select is(
  (
    select (sum(s.invoices), sum(s.net_amount), sum(s.paid_amount), sum(s.calendar_days)::integer)
    from series_rows s
    where s.grain = 'weekday'
      and s.store_id is null
  ),
  (
    select (t.invoices::numeric, t.net_amount, t.paid_amount, 90)
    from fixture f
    cross join lateral app.period_totals(f.both_stores, '2026-01-01', '2026-03-31') t
  ),
  'the weekday buckets sum to the whole range'
);
select is(
  (
    select array_agg((s.bucket_start, s.holiday_kind)::text order by s.bucket_start)
    from fixture f
    cross join lateral public.period_series(array[f.store_a], 'day', '2025-06-08', '2025-06-22') s
    where s.store_id is null
      and s.holiday_kind is not null
  ),
  array[
    '(2025-06-10,tet)', '(2025-06-11,tet)', '(2025-06-12,tet)', '(2025-06-13,tet)', '(2025-06-14,tet)', '(2025-06-20,custom)'
  ],
  'holiday_kind marks the gap inside a Tet run as tet and a custom holiday by its kind'
);
select is(
  (
    select array_agg((s.bucket_start, s.bucket_end, s.calendar_days, s.excluded_days, s.tet_days, s.iso_week)::text order by s.bucket_start)
    from fixture f
    cross join lateral public.period_series(array[f.store_a], 'week', '2025-06-08', '2025-06-22') s
    where s.store_id = f.store_a
  ),
  array['(2025-06-08,2025-06-08,1,0,0,23)', '(2025-06-09,2025-06-15,7,5,5,24)', '(2025-06-16,2025-06-22,7,1,0,25)'],
  'week buckets count excluded and Tet dates, the Tet gap included, and carry their ISO week'
);
select is(
  (
    select count(*)
    from public.period_series(
      (select array[f.store_a] from fixture f),
      'month',
      '2024-01-01',
      '2026-12-31'
    ) s
    where s.store_id is null
      and (s.excluded_days, s.tet_days) is distinct from (
        (select count(*)::integer from generate_series(s.bucket_start, s.bucket_end, interval '1 day') as d where app.is_excluded_day((select array[f.store_a] from fixture f), d::date)),
        (select count(*)::integer from generate_series(s.bucket_start, s.bucket_end, interval '1 day') as d
          where app.tet_window((select f.tenant_id from fixture f), 'VN', d::date))
      )
  ),
  0::bigint,
  'excluded_days and tet_days equal is_excluded_day and tet_window for every month of 2024 to 2026'
);
select is(
  (
    select array_agg((s.bucket_start, s.calendar_days, s.days_with_data, s.invoices is null, s.net_amount is null, s.avg_ticket is null)::text order by s.bucket_start, s.store_id nulls first)
    from fixture f
    cross join lateral public.period_series(array[f.store_a], 'month', '2024-01-01', '2024-03-31') s
  ),
  array[
    '(2024-01-01,31,0,t,t,t)', '(2024-01-01,31,0,t,t,t)',
    '(2024-02-01,29,0,t,t,t)', '(2024-02-01,29,0,t,t,t)',
    '(2024-03-01,31,0,t,t,t)', '(2024-03-01,31,0,t,t,t)'
  ],
  'an empty bucket keeps its calendar days and has null totals'
);
select throws_ok(
  $$ select * from public.period_series(array['44444444-4444-4444-8444-000000000021', '44444444-4444-4444-8444-000000000022']::uuid[], 'day', '2024-01-01', '2024-12-31') $$,
  '22023',
  null,
  'period_series refuses a call whose buckets times stores exceed 900 rows'
);
select throws_ok(
  $$ select * from public.period_series(array['44444444-4444-4444-8444-000000000021']::uuid[], 'quarter', '2026-01-01', '2026-03-31') $$,
  '22023',
  null,
  'period_series rejects an unknown grain'
);

select is(
  (
    select (count(*), count(*) filter (
      where (d.weekday, d.sample_days, d.baseline_net_amount, d.baseline_invoices, d.baseline_avg_ticket)
        is distinct from (b.weekday, b.sample_days, b.baseline_net_amount, b.baseline_invoices, b.baseline_avg_ticket)
    ))
    from fixture f
    cross join lateral public.daily_baselines(f.both_stores, '2026-02-01', '2026-03-03', 8) d
    cross join lateral public.same_weekday_baseline(f.both_stores, d.business_date, 8) b
  ),
  (31::bigint, 0::bigint),
  'daily_baselines equals same_weekday_baseline on every date of a 31-day range around Tet'
);
select throws_ok(
  $$ select * from public.daily_baselines(array['44444444-4444-4444-8444-000000000021']::uuid[], '2026-01-01', '2026-03-04', 8) $$,
  '22023',
  null,
  'daily_baselines refuses a range of 63 dates'
);

select is(
  (select sum(h.current_net_amount) from fixture f cross join lateral public.hourly_profile(f.both_stores, f.anchor, 8) h),
  (select t.net_amount from fixture f cross join lateral app.period_totals(f.both_stores, f.anchor, f.anchor) t),
  'the current hours of hourly_profile sum to the net of the day'
);
select is(
  (
    select (h.sample_days, h.baseline_net_amount, h.baseline_invoices)
    from fixture f
    cross join lateral public.hourly_profile(array[f.hourly_store], '2025-06-25', 8) h
    where h.hour_local = 10
  ),
  (4, 250.00::numeric, 2.50::numeric),
  'the baseline of an hour is the median of an even number of eligible days'
);
select is(
  (
    select array_agg((h.hour_local, h.sample_days, h.baseline_net_amount, h.current_net_amount)::text order by h.hour_local)
    from fixture f
    cross join lateral public.hourly_profile(array[f.hourly_store], '2025-06-25', 8) h
    where h.hour_local in (10, 11, 15)
  ),
  array['(10,4,250.00,120.00)', '(11,4,0.00,0)', '(15,4,0.00,80.00)'],
  'the 30 April candidate is left out of the sample and an hour without sales counts as zero'
);
select is(
  (
    select (count(*), count(*) filter (where h.current_invoices is null and h.current_net_amount is null and h.current_items_sold is null))
    from fixture f
    cross join lateral public.hourly_profile(array[f.hourly_store], '2025-06-24', 8) h
  ),
  (24::bigint, 24::bigint),
  'on a day without data all 24 hours have null current values'
);

select is(
  (
    select (count(*), count(*) filter (where c.value is distinct from public.metric_value(f.both_stores, c.metric_id, c.from_date, c.to_date)))
    from fixture f
    cross join lateral public.metric_compare(
      f.both_stores,
      array[
        'net_revenue', 'gross_revenue', 'invoices', 'avg_ticket', 'items_per_ticket', 'avg_item_price', 'cash_share', 'voucher_invoice_share',
        'member_invoice_share', 'discount_rate', 'attach_rate_topping', 'attach_rate_snack', 'size_l_share', 'sales_per_opening_hour',
        'invoices_per_opening_hour', 'peak_share_20_21', 'dead_hour_share_17_18', 'void_rate', 'edit_rate', 'removed_line_rate',
        'customer_capture_rate'
      ],
      'month',
      f.anchor
    ) c
  ),
  (63::bigint, 0::bigint),
  'metric_compare equals metric_value for each of the 21 metric ids and each of current, previous and last year'
);
select throws_ok(
  $$ select * from public.metric_compare(array['44444444-4444-4444-8444-000000000021']::uuid[], array['net_revenue', 'no_such_metric'], 'day', '2026-03-18') $$,
  '22023',
  null,
  'metric_compare passes the invalid_parameter_value of an unknown metric id through'
);

create temp table march_items as
select i.*
from fixture f
cross join lateral public.item_summary(f.both_stores, '2026-03-01', '2026-03-31', '2026-02-01', '2026-02-28') i;

select is(
  (
    select count(*)
    from fixture f
    cross join generate_series('2026-03-01'::date, '2026-03-07'::date, interval '1 day') as d
    where (select sum(i.quantity) from public.item_summary(f.both_stores, d::date, d::date) i)
      is distinct from (select t.items_sold from app.period_totals(f.both_stores, d::date, d::date) t)
  ),
  0::bigint,
  'the item quantities of each day sum to items_sold'
);
select is(
  (
    select (count(*) filter (where i.item_external_id like 'MOD-%'), (select sum(a.modifier_lines) > 0 from public.agg_daily_sales a, fixture f where a.store_id = any (f.both_stores)))
    from march_items i
  ),
  (0::bigint, true),
  'no modifier ever appears among the items, although the fixture sells modifiers'
);
select ok(
  (select abs(sum(i.net_share) - 1) <= count(*) * 0.0000005 and count(*) > 5 from march_items i),
  'the net shares sum to 1 within the rounding of their rows'
);
select is(
  (
    select count(*)
    from march_items i
    left join (
      select a.item_external_id, sum(a.quantity) as quantity, sum(a.net_amount) as net_amount
      from public.agg_item_daily a, fixture f
      where a.store_id = any (f.both_stores)
        and a.business_date between '2026-02-01' and '2026-02-28'
      group by a.item_external_id
    ) p on p.item_external_id = i.item_external_id
    where (i.compare_quantity, i.compare_net_amount) is distinct from (coalesce(p.quantity, 0), coalesce(p.net_amount, 0))
      or i.compare_net_share is distinct from round(coalesce(p.net_amount, 0) / (select sum(x.compare_net_amount) from march_items x), 6)
  ),
  0::bigint,
  'compare columns hold the compare range sums and shares, zero for an item not sold then'
);
select is(
  (
    select (
      count(*),
      count(*) filter (where (i.first_sold_on, i.last_sold_on) = (p.first_on, p.last_on)),
      count(*) filter (where i.first_sold_on < '2026-02-01')
    )
    from march_items i
    left join (
      select a.item_external_id, min(a.business_date) as first_on, max(a.business_date) as last_on
      from public.agg_item_daily a, fixture f
      where a.store_id = any (f.both_stores)
      group by a.item_external_id
    ) p on p.item_external_id = i.item_external_id
  ),
  (select (count(*), count(*), count(*)) from march_items),
  'first and last sold dates are all-time over the stores, not limited to the range'
);
select is(
  (select count(*) filter (where i.role is not null) from fixture f cross join lateral public.item_summary(f.both_stores, '2026-03-01', '2026-03-31') i),
  0::bigint,
  'role is null while no item type is mapped'
);

insert into public.item_type_roles (tenant_id, pos_account_id, item_type_external_id, role)
select f.tenant_id, f.account_b, 'TYPE-TEA', 'drink'::public.item_type_role from fixture f
union all
select f.tenant_id, f.account_a, 'TYPE-SNACK', 'snack'::public.item_type_role from fixture f;

select is(
  (
    select array_agg(distinct (i.item_type_external_id, i.role)::text order by (i.item_type_external_id, i.role)::text)
    from fixture f
    cross join lateral public.item_summary(f.both_stores, '2026-03-01', '2026-03-31') i
  ),
  array['(TYPE-COFFEE,)', '(TYPE-SNACK,snack)', '(TYPE-TEA,drink)'],
  'a mapping made in the same transaction shows at once, from the POS account of any requested store'
);

create temp table march_payments as
select p.*
from fixture f
cross join lateral public.payment_summary(f.both_stores, '2026-03-01', '2026-03-31') p;

select is(
  (select sum(p.amount) from march_payments p),
  (select t.paid_amount from fixture f cross join lateral app.period_totals(f.both_stores, '2026-03-01', '2026-03-31') t),
  'the payment amounts sum to the paid amount'
);
select is(
  (select sum(p.amount) from march_payments p where p.kind = 'cash'),
  (select t.cash_amount from fixture f cross join lateral app.period_totals(f.both_stores, '2026-03-01', '2026-03-31') t),
  'the cash kind equals cash_amount'
);
select is(
  (
    select array_agg((p.method_key, p.amount = (
      select sum(x.amount)
      from fixture f
      cross join lateral unnest(f.both_stores) as u (store_id)
      cross join lateral public.payment_summary(array[u.store_id], '2026-03-01', '2026-03-31') x
      where x.method_key = p.method_key
    ))::text order by p.method_key)
    from march_payments p
  ),
  array['(card|Card,t)', '(cash|Cash,t)', '(ewallet|E-wallet,t)'],
  'methods of two POS accounts with the same kind and name merge into one row'
);

create temp table quarter_sales as
select i.*
from public.invoices i, fixture f
where i.store_id = any (f.both_stores)
  and i.business_date between '2026-01-01' and '2026-03-31';

create temp table quarter_promotions as
select p.*
from fixture f
cross join lateral public.promotion_summary(f.both_stores, '2026-01-01', '2026-03-31') p;

select is(
  (select (sum(p.discount_amount), sum(p.invoices)::numeric) from quarter_promotions p where p.promotion_kind = 'bill'),
  (
    select (sum(s.bill_discount_amount + s.extra_discount_amount), count(*)::numeric)
    from quarter_sales s
    where s.status <> 'voided'
      and s.bill_discount_amount + s.extra_discount_amount > 0
  ),
  'the bill kind adds bill and extra discounts of the bills that carry one'
);
select is(
  (select (sum(p.discount_amount), sum(p.invoices)::numeric) from quarter_promotions p where p.promotion_kind = 'voucher'),
  (
    select (sum(s.voucher_amount), count(*)::numeric)
    from quarter_sales s
    where s.status <> 'voided'
      and (s.voucher_amount > 0 or s.voucher_code is not null)
  ),
  'the voucher kind adds voucher amounts and counts code-only vouchers'
);
select is(
  (select (sum(p.discount_amount), sum(p.lines)::numeric) from quarter_promotions p where p.promotion_kind = 'item'),
  (
    select (sum(l.discount_amount), count(*)::numeric)
    from quarter_sales s
    join public.invoice_lines l on l.invoice_id = s.id
    where s.status <> 'voided'
      and l.line_kind = 'item'
      and l.discount_amount > 0
  ),
  'the item kind adds the line discounts of the item lines of sales'
);
select is(
  (
    select (
      count(*) filter (where p.promotion_key in ('Voided bill', 'Voided voucher', 'PROMO-VOID')),
      (select sum(s.bill_discount_amount + s.extra_discount_amount) from quarter_sales s)
        > sum(p.discount_amount) filter (where p.promotion_kind = 'bill')
    )
    from quarter_promotions p
  ),
  (0::bigint, true),
  'a voided invoice adds neither its bill discount, its voucher nor its line discount'
);
select throws_ok(
  $$ select * from public.promotion_summary(array['44444444-4444-4444-8444-000000000021']::uuid[], '2026-01-01', '2026-04-03') $$,
  '22023',
  null,
  'promotion_summary refuses a range of 93 days'
);

create temp table quarter_shifts as
select r.*
from fixture f
cross join lateral public.shift_review(f.both_stores, '2026-01-01', '2026-03-31') r;

select results_eq(
  $$ select q.store_id, q.shift_id, q.shift_external_id, q.business_date, q.cashier_name, q.cash_sales_amount, q.variance_amount,
       q.trailing_shifts, q.z_score, q.over_abs_threshold, q.over_rel_threshold, q.over_z_threshold, q.reasons
     from quarter_shifts q where q.flagged order by q.business_date, q.store_id, q.shift_external_id $$,
  $$ select c.store_id, c.shift_id, c.shift_external_id, c.business_date, c.cashier_name, c.cash_sales_amount, c.variance_amount,
       c.trailing_shifts, c.z_score, c.over_abs_threshold, c.over_rel_threshold, c.over_z_threshold, c.reasons
     from fixture f cross join lateral public.cash_variance_flags(f.both_stores, '2026-01-01', '2026-03-31') c $$,
  'the flagged rows of shift_review equal cash_variance_flags row for row'
);
select is(
  (
    select (count(*), count(*) filter (where q.shift_name = 'Day shift'))
    from quarter_shifts q
  ),
  (
    select (count(*), count(*))
    from public.agg_shift_cash s, fixture f
    where s.store_id = any (f.both_stores)
      and s.business_date between '2026-01-01' and '2026-03-31'
  ),
  'every shift of the range appears once, with its name from shifts'
);
select is(
  (
    select (count(*) > 0, count(*) filter (
      where q.over_abs_threshold or q.over_rel_threshold or q.over_z_threshold or q.flagged
        or q.trailing_shifts is not null or q.z_score is not null or q.reasons <> '{}'::text[]
    ))
    from quarter_shifts q
    where q.variance_amount is null
  ),
  (true, 0::bigint),
  'a shift without a variance has null scores, false flags and no reason'
);
create temp table previous_flags as
select
  w.store_id, w.shift_id, w.shift_external_id, w.business_date, w.cashier_name, w.cash_sales_amount, w.variance_amount,
  w.trailing_shifts, w.trailing_mean_variance, w.trailing_stddev_variance, w.z_score,
  abs(w.variance_amount) > 50000 as over_abs_threshold,
  w.cash_sales_amount > 0 and abs(w.variance_amount) > 0.005 * w.cash_sales_amount as over_rel_threshold,
  coalesce(abs(w.z_score) > 2, false) as over_z_threshold,
  array_remove(array[
    case when abs(w.variance_amount) > 50000 then 'absolute' end,
    case when w.cash_sales_amount > 0 and abs(w.variance_amount) > 0.005 * w.cash_sales_amount then 'relative' end,
    case when coalesce(abs(w.z_score) > 2, false) then 'z_score' end
  ], null) as reasons
from (
  select
    s.store_id, s.shift_id, s.shift_external_id, s.business_date, s.cashier_name, s.cash_sales_amount, s.variance_amount,
    h.trailing_shifts, h.trailing_mean_variance, h.trailing_stddev_variance,
    case when h.trailing_shifts >= 3 and h.trailing_stddev_variance > 0
      then round((s.variance_amount - h.trailing_mean_variance) / h.trailing_stddev_variance, 3) end as z_score
  from public.agg_shift_cash s
  cross join fixture f
  cross join lateral (
    select
      count(*)::integer as trailing_shifts,
      round(avg(t.variance_amount), 2) as trailing_mean_variance,
      round(stddev_samp(t.variance_amount), 2) as trailing_stddev_variance
    from public.agg_shift_cash t
    where t.store_id = s.store_id
      and t.business_date between s.business_date - 56 and s.business_date - 1
      and t.variance_amount is not null
  ) h
  where s.store_id = any (f.both_stores)
    and s.business_date between f.data_from and f.data_to
    and s.variance_amount is not null
) w
where abs(w.variance_amount) > 50000
  or (w.cash_sales_amount > 0 and abs(w.variance_amount) > 0.005 * w.cash_sales_amount)
  or coalesce(abs(w.z_score) > 2, false);

select results_eq(
  $$ select c.* from fixture f cross join lateral public.cash_variance_flags(f.both_stores, f.data_from, f.data_to) c $$,
  $$ select p.* from previous_flags p order by p.business_date, p.store_id, p.shift_external_id $$,
  'the rebuilt cash_variance_flags returns what its previous body returned, in the same order'
);

select is(
  (
    select (l.quantity_ytd, l.net_ytd, l.quantity_last_ytd, l.net_last_ytd, l.quantity_28d, l.quantity_prior_28d, l.months_sold, l.quantity_lifetime)
    from fixture f
    cross join lateral public.item_lifecycle(array[f.lifecycle_store], '2028-03-01') l
    where l.item_external_id = 'LIFE-A'
  ),
  (13::numeric, 130.00::numeric, 12::numeric, 120.00::numeric, 10::numeric, 3::numeric, 5, 25::numeric),
  'in a leap year to date the year-earlier window covers the same 61 elapsed days, through 2 March'
);
select is(
  (
    select array_agg((l.item_external_id, l.quantity_ytd, l.quantity_last_ytd)::text order by l.item_external_id)
    from fixture f
    cross join lateral public.item_lifecycle(array[f.lifecycle_store], '2029-03-01') l
  ),
  array['(LIFE-A,,7.000)', '(LIFE-B,,)', '(LIFE-C,,2.000)'],
  'after a leap year the year-earlier window ends on 29 February and unsold windows are null'
);
select is(
  (
    select array_agg((l.item_external_id, l.first_sold_on, l.last_sold_on)::text order by l.net_ytd desc nulls last, l.item_external_id)
    from fixture f
    cross join lateral public.item_lifecycle(array[f.lifecycle_store], '2028-02-28') l
  ),
  array['(LIFE-A,2027-01-15,2028-01-10)', '(LIFE-B,2026-12-31,2026-12-31)'],
  'first and last sold stop at the as-of date and items sold only later are left out'
);

select is(
  (
    select (c.sales_days, c.checked_days, c.matched_days, c.unmatched_days, c.unchecked_sales_days)
    from fixture f
    cross join lateral public.store_coverage(f.both_stores, '2026-03-01', '2026-03-31') c
    where c.store_id = f.store_a
  ),
  (31, 30, 29, 1, 1),
  'coverage counts checked, matched and unchecked sales days of a store from sync_checks'
);
select is(
  (
    select (c.sales_days, c.checked_days, c.matched_days, c.unmatched_days, c.unchecked_sales_days, c.last_refreshed_at is not null)
    from fixture f
    cross join lateral public.store_coverage(f.both_stores, '2026-03-01', '2026-03-31') c
    where c.store_id = f.store_b
  ),
  (31, 1, 1, 0, 30, true),
  'coverage of a barely checked store counts its unchecked sales days'
);
select is(
  (
    select (c.opened_on, c.first_sales_on, c.history_start)
    from fixture f
    cross join lateral public.store_coverage(array[f.store_a], '2026-03-01', '2026-03-31') c
  ),
  (null::date, '2025-01-01'::date, '2025-01-01'::date),
  'without an opening date history starts at the first sale'
);

update public.stores s set opened_on = '2024-12-01' from fixture f where s.id = f.store_a;

select is(
  (
    select (c.opened_on, c.history_start)
    from fixture f
    cross join lateral public.store_coverage(array[f.store_a], '2026-03-01', '2026-03-31') c
  ),
  ('2024-12-01'::date, '2025-01-01'::date),
  'an opening date before the first sale leaves history at the first sale'
);

update public.stores s set opened_on = '2025-02-01' from fixture f where s.id = f.store_a;

select is(
  (
    select (c.opened_on, c.history_start)
    from fixture f
    cross join lateral public.store_coverage(array[f.store_a], '2026-03-01', '2026-03-31') c
  ),
  ('2025-02-01'::date, '2025-02-01'::date),
  'an opening date after the first sale starts history at the opening date'
);
select is(
  (
    select array_agg((c.store_id = f.store_b, c.stale_days)::text order by c.store_id)
    from fixture f
    cross join lateral public.store_coverage(f.both_stores, current_date - 1, current_date) c
  ),
  array['(f,0)', '(t,2)'],
  'stale_days counts the live days whose item aggregate is still missing'
);
select is(
  (
    select (c.first_sales_on, c.last_sales_on, c.history_start, c.sales_days)
    from fixture f
    cross join lateral public.store_coverage(array[f.store_c], current_date - 1, current_date) c
  ),
  (current_date, current_date, current_date, 1),
  'a store without aggregates takes its first sale from the live days'
);

select results_eq(
  $$ select t.store_id, t.net_target_amount from fixture f cross join lateral public.store_targets(array[f.store_b, f.store_a], 'month', '2026-03-01') t $$,
  $$ select f.store_a, 10000000.00::numeric from fixture f $$,
  'store_targets returns the targets of the period kind and start for the visible stores'
);

insert into public.agg_item_daily (tenant_id, store_id, business_date, item_external_id, item_name, item_type_external_id, item_type_name, quantity, net_amount, invoices)
select f.aggregate_tenant_id, f.lifecycle_store, '2028-06-01'::date, 'BULK-' || g.item_number, 'Bulk item ' || g.item_number, 'TYPE-TEA', 'Tea', 1, 1000, 1
from fixture f
cross join generate_series(1, 901) as g (item_number);

select throws_ok(
  $$ select * from public.item_summary(array['66666666-6666-4666-8666-000000000022']::uuid[], '2028-06-01', '2028-06-01') $$,
  '22023',
  null,
  'item_summary refuses a result of 901 rows after running its query'
);
select throws_ok(
  $$ select * from public.item_summary(
       array(select ('44444444-4444-4444-8444-' || lpad(g.store_number::text, 12, '0'))::uuid from generate_series(1, 51) as g (store_number)),
       '2026-03-01', '2026-03-01') $$,
  '22023',
  null,
  'a report function refuses more than 50 store ids'
);
select throws_ok(
  $$ select * from public.payment_summary(array['44444444-4444-4444-8444-000000000021']::uuid[], '2026-03-02', '2026-03-01') $$,
  '22023',
  null,
  'a report function refuses a range whose start is after its end'
);
select throws_ok(
  $$ select * from public.item_summary(array['44444444-4444-4444-8444-000000000021']::uuid[], '2026-03-01', '2026-03-02', '2026-02-01', null) $$,
  '22023',
  null,
  'item_summary refuses a compare range with only one bound'
);
select throws_ok(
  $$ select * from public.item_summary(array['44444444-4444-4444-8444-000000000021']::uuid[], '2025-01-01', '2026-02-05') $$,
  '22023',
  null,
  'item_summary refuses a range of 401 days'
);
select throws_ok(
  $$ select * from public.store_coverage(array['44444444-4444-4444-8444-000000000021']::uuid[], '2025-01-01', '2026-02-05') $$,
  '22023',
  null,
  'store_coverage refuses a range of 401 days'
);
select throws_ok(
  $$ select * from public.shift_review(array['44444444-4444-4444-8444-000000000021']::uuid[], '2026-01-01', '2026-04-03') $$,
  '22023',
  null,
  'shift_review refuses a range of 93 days'
);
select results_eq(
  $$ select s.bucket_start, s.days_with_data, s.net_amount
     from fixture f cross join lateral public.period_series(f.both_stores, 'month', '2025-01-01', '2026-03-31', false) s $$,
  $$ select s.bucket_start, s.days_with_data, s.net_amount
     from fixture f cross join lateral public.period_series(f.both_stores, 'month', '2025-01-01', '2026-03-31') s
     where s.store_id is null $$,
  'period_series without store rows returns exactly the all-stores rows'
);
select lives_ok(
  $$ select * from public.period_series(array['44444444-4444-4444-8444-000000000021', '44444444-4444-4444-8444-000000000022']::uuid[], 'day', '2024-01-01', '2024-12-31', false) $$,
  'period_series without store rows counts only the all-stores buckets against the row limit'
);
select throws_ok(
  $$ select * from public.period_series(array['44444444-4444-4444-8444-000000000021']::uuid[], 'month', '2026-01-01', '2026-03-31', null) $$,
  '22023',
  null,
  'period_series refuses a null include_stores'
);

select * from finish();
rollback;
