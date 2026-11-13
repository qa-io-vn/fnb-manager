begin;
select plan(28);

create temp table fixture as
select
  '44444444-4444-4444-8444-000000000101'::uuid as tenant_id,
  '44444444-4444-4444-8444-000000000111'::uuid as account_id,
  '44444444-4444-4444-8444-000000000121'::uuid as store_a,
  '44444444-4444-4444-8444-000000000122'::uuid as store_b,
  array['44444444-4444-4444-8444-000000000121', '44444444-4444-4444-8444-000000000122']::uuid[] as both_stores,
  '55555555-5555-4555-8555-000000000101'::uuid as other_tenant_id,
  '55555555-5555-4555-8555-000000000111'::uuid as other_account_id,
  '55555555-5555-4555-8555-000000000121'::uuid as other_store,
  'eeeeeeee-eeee-4eee-8eee-000000000201'::uuid as owner_id,
  'eeeeeeee-eeee-4eee-8eee-000000000202'::uuid as store_staff_id,
  'eeeeeeee-eeee-4eee-8eee-000000000203'::uuid as publisher_id,
  'eeeeeeee-eeee-4eee-8eee-000000000204'::uuid as viewer_id,
  'eeeeeeee-eeee-4eee-8eee-000000000205'::uuid as other_owner_id,
  '2026-03-18'::date as anchor;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated'::varchar, 'authenticated'::varchar, u.email::varchar
from fixture f
cross join lateral (
  values
    (f.owner_id, 'report-owner@example.com'),
    (f.store_staff_id, 'report-staff@example.com'),
    (f.publisher_id, 'report-publisher@example.com'),
    (f.viewer_id, 'report-viewer@example.com'),
    (f.other_owner_id, 'report-other-owner@example.com')
) as u (id, email);

insert into public.tenants (id, slug, name)
select tenant_id, 'report-access', 'Report Access' from fixture
union all
select other_tenant_id, 'report-access-other', 'Report Access Other' from fixture;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select f.tenant_id, f.owner_id, 'owner'::public.tenant_role, null::uuid[] from fixture f
union all
select f.tenant_id, f.store_staff_id, 'staff', array[f.store_a] from fixture f
union all
select f.tenant_id, f.publisher_id, 'publisher', null from fixture f
union all
select f.tenant_id, f.viewer_id, 'viewer', null from fixture f
union all
select f.other_tenant_id, f.other_owner_id, 'owner', null from fixture f;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_id, tenant_id, 'mock', 'report-access', 'Report Access POS' from fixture
union all
select other_account_id, other_tenant_id, 'mock', 'report-access-other', 'Report Access Other POS' from fixture;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_a, tenant_id, account_id, 'access-store-a', 'Store A' from fixture
union all
select store_b, tenant_id, account_id, 'access-store-b', 'Store B' from fixture
union all
select other_store, other_tenant_id, other_account_id, 'access-store-other', 'Store A' from fixture;

insert into public.payment_methods (tenant_id, pos_account_id, external_id, name, kind)
select tenant_id, account_id, 'CASH', 'Cash', 'cash'::public.payment_kind from fixture
union all
select other_tenant_id, other_account_id, 'CASH', 'Cash', 'cash' from fixture;

create temp table access_sales as
select
  s.tenant_id,
  s.store_id,
  s.account_id,
  d.business_date,
  n.invoice_no,
  format('ACC-%s-%s-%s', s.store_code, to_char(d.business_date, 'YYYYMMDD'), n.invoice_no) as external_id,
  format('ACC-SH-%s-%s', s.store_code, to_char(d.business_date, 'YYYYMMDD')) as shift_external_id,
  (s.store_weight * 10000 + n.invoice_no * 5000)::numeric as net_amount,
  case when n.invoice_no = 1 then 2000 else 0 end::numeric as bill_discount
from fixture f
cross join lateral (
  values
    (f.tenant_id, f.store_a, f.account_id, 'A', 3),
    (f.tenant_id, f.store_b, f.account_id, 'B', 5),
    (f.other_tenant_id, f.other_store, f.other_account_id, 'O', 7)
) as s (tenant_id, store_id, account_id, store_code, store_weight)
cross join lateral (values (f.anchor - 7), (f.anchor - 1), (f.anchor)) as d (business_date)
cross join generate_series(1, 2) as n (invoice_no);

insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, shift_external_id, gross_amount, bill_discount_amount, bill_discount_name, net_amount, paid_amount)
select s.tenant_id, s.store_id, s.account_id, s.external_id, (s.business_date + time '10:00' + make_interval(hours => s.invoice_no)) at time zone 'Asia/Ho_Chi_Minh',
  s.business_date, s.shift_external_id, s.net_amount + s.bill_discount, s.bill_discount, 'Opening offer', s.net_amount, s.net_amount
from access_sales s;

insert into public.invoice_lines (tenant_id, store_id, invoice_id, external_id, line_kind, item_external_id, item_name, item_type_external_id, quantity, unit_price, gross_amount, net_amount)
select s.tenant_id, s.store_id, i.id, 'L1', 'item', 'ITEM-1', 'Item one', 'TYPE-1', 1, s.net_amount + s.bill_discount, s.net_amount + s.bill_discount, s.net_amount + s.bill_discount
from access_sales s
join public.invoices i on i.store_id = s.store_id and i.external_id = s.external_id;

insert into public.invoice_payments (tenant_id, store_id, invoice_id, sequence_no, business_date, payment_method_external_id, amount)
select s.tenant_id, s.store_id, i.id, 1, s.business_date, 'CASH', s.net_amount
from access_sales s
join public.invoices i on i.store_id = s.store_id and i.external_id = s.external_id;

insert into public.shifts (tenant_id, store_id, external_id, name, cashier_name, opened_at, closed_at, opening_float_amount, expected_cash_amount, cash_drawer_amount)
select s.tenant_id, s.store_id, s.shift_external_id, 'Day shift', 'Cashier', (s.business_date + time '06:00') at time zone 'Asia/Ho_Chi_Minh',
  (s.business_date + time '22:00') at time zone 'Asia/Ho_Chi_Minh', 100000, 100000 + sum(s.net_amount), 100000 + sum(s.net_amount)
from access_sales s
group by s.tenant_id, s.store_id, s.shift_external_id, s.business_date;

insert into public.targets (tenant_id, store_id, period_kind, period_start, net_target_amount)
select tenant_id, store_a, 'month'::public.period_kind, '2026-03-01'::date, 5000000 from fixture
union all
select other_tenant_id, other_store, 'month', '2026-03-01', 7000000 from fixture;

select app.refresh_analytics(f.tenant_id, f.anchor - 7, f.anchor) from fixture f;
select app.refresh_analytics(f.other_tenant_id, f.anchor - 7, f.anchor) from fixture f;

create temp table store_a_expected as
select t.net_amount, t.invoices, (select sum(a.net_amount) from public.agg_item_daily a, fixture f where a.store_id = f.store_a and a.business_date between f.anchor - 1 and f.anchor) as item_net_amount
from fixture f
cross join lateral app.period_totals(array[f.store_a], f.anchor, f.anchor) t;

create temp table report_signatures as
select r.signature::regprocedure as function_oid
from (
  values
    ('public.period_compare_by_store(uuid[], text, date)'),
    ('public.period_series(uuid[], text, date, date, boolean)'),
    ('public.daily_baselines(uuid[], date, date, integer)'),
    ('public.hourly_profile(uuid[], date, integer)'),
    ('public.metric_compare(uuid[], text[], text, date)'),
    ('public.item_summary(uuid[], date, date, date, date)'),
    ('public.payment_summary(uuid[], date, date, date, date)'),
    ('public.promotion_summary(uuid[], date, date)'),
    ('public.shift_review(uuid[], date, date, numeric, numeric)'),
    ('public.item_lifecycle(uuid[], date)'),
    ('public.store_coverage(uuid[], date, date)'),
    ('public.store_targets(uuid[], public.period_kind, date)')
) as r (signature);

create temp table helper_signatures as
select r.signature::regprocedure as function_oid
from (
  values
    ('app.period_bounds(text, date)'),
    ('app.period_totals(uuid[], date, date)'),
    ('app.shift_variance_scores(uuid[], date, date, numeric, numeric)'),
    ('app.visible_stores(uuid[])'),
    ('app.require_store_ids(text, uuid[])'),
    ('app.require_date_range(text, date, date, integer)'),
    ('app.require_compare_range(text, date, date, integer)'),
    ('app.require_report_rows(text, bigint)')
) as r (signature);

select is(
  (select count(*) from report_signatures r where has_function_privilege('anon', r.function_oid, 'execute')),
  0::bigint,
  'anon cannot execute any of the 12 report functions'
);
select is(
  (select count(*) from report_signatures r where has_function_privilege('authenticated', r.function_oid, 'execute')),
  12::bigint,
  'authenticated can execute each of the 12 report functions'
);
select is(
  (select count(*) from report_signatures r where has_function_privilege('service_role', r.function_oid, 'execute')),
  12::bigint,
  'service_role can execute each of the 12 report functions'
);
select is(
  (select count(*) from helper_signatures h where has_function_privilege('anon', h.function_oid, 'execute')),
  0::bigint,
  'anon cannot execute the app helpers behind the report functions'
);

grant select on fixture, store_a_expected to authenticated;

set local role authenticated;
set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000000201", "role": "authenticated"}';

select is(
  (
    select array[
      (select count(*) filter (where c.store_id is not null) = 8 and bool_and(c.net_amount is not null) filter (where c.period = 'current') from public.period_compare_by_store(f.both_stores, 'day', f.anchor) c),
      (select count(*) filter (where s.store_id is not null) = 4 and bool_and(s.days_with_data > 0) from public.period_series(f.both_stores, 'day', f.anchor - 1, f.anchor) s),
      (select bool_and(b.sample_days = 1) from public.daily_baselines(f.both_stores, f.anchor, f.anchor, 8) b),
      (select sum(h.current_net_amount) > 0 and bool_and(h.sample_days = 1) from public.hourly_profile(f.both_stores, f.anchor, 8) h),
      (select bool_and(m.value is not null) from public.metric_compare(f.both_stores, array['net_revenue', 'invoices'], 'day', f.anchor) m where m.period <> 'last_year'),
      (select count(*) = 1 from public.item_summary(f.both_stores, f.anchor - 1, f.anchor) i),
      (select count(*) = 1 from public.payment_summary(f.both_stores, f.anchor - 1, f.anchor) p),
      (select count(*) = 1 from public.promotion_summary(f.both_stores, f.anchor - 1, f.anchor) p),
      (select count(*) = 4 from public.shift_review(f.both_stores, f.anchor - 1, f.anchor) r),
      (select count(*) = 1 from public.item_lifecycle(f.both_stores, f.anchor) l),
      (select count(*) = 2 from public.store_coverage(f.both_stores, f.anchor - 1, f.anchor) c),
      (select count(*) = 1 from public.store_targets(f.both_stores, 'month', '2026-03-01') t)
    ]
    from fixture f
  ),
  array[true, true, true, true, true, true, true, true, true, true, true, true],
  'the owner reads the own stores through each of the 12 report functions'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000000205", "role": "authenticated"}';

select is(
  (
    select (count(*) filter (where c.store_id is not null), bool_and(c.net_amount is null), count(*))
    from fixture f cross join lateral public.period_compare_by_store(f.both_stores, 'day', f.anchor) c
  ),
  (0::bigint, true, 4::bigint),
  'another tenant gets only an empty all-stores block from period_compare_by_store'
);
select is(
  (
    select (count(*) filter (where s.store_id is not null), bool_and(s.days_with_data = 0 and s.net_amount is null and s.checked_days = 0))
    from fixture f cross join lateral public.period_series(f.both_stores, 'day', f.anchor - 1, f.anchor) s
  ),
  (0::bigint, true),
  'another tenant gets no store rows and no data from period_series'
);
select is(
  (select bool_and(b.sample_days = 0 and b.baseline_net_amount is null) from fixture f cross join lateral public.daily_baselines(f.both_stores, f.anchor, f.anchor, 8) b),
  true,
  'another tenant gets no baseline from daily_baselines'
);
select is(
  (
    select bool_and(h.current_net_amount is null and h.current_invoices is null and h.sample_days = 0 and h.baseline_net_amount is null)
    from fixture f cross join lateral public.hourly_profile(f.both_stores, f.anchor, 8) h
  ),
  true,
  'another tenant gets no hour of hourly_profile'
);
select is(
  (select bool_and(m.value is null) from fixture f cross join lateral public.metric_compare(f.both_stores, array['net_revenue', 'invoices'], 'day', f.anchor) m),
  true,
  'another tenant gets no value from metric_compare'
);
select is((select count(*) from fixture f cross join lateral public.item_summary(f.both_stores, f.anchor - 1, f.anchor) i), 0::bigint, 'another tenant gets no item from item_summary');
select is((select count(*) from fixture f cross join lateral public.payment_summary(f.both_stores, f.anchor - 1, f.anchor) p), 0::bigint, 'another tenant gets no payment method from payment_summary');
select is((select count(*) from fixture f cross join lateral public.promotion_summary(f.both_stores, f.anchor - 1, f.anchor) p), 0::bigint, 'another tenant gets no promotion from promotion_summary');
select is((select count(*) from fixture f cross join lateral public.shift_review(f.both_stores, f.anchor - 1, f.anchor) r), 0::bigint, 'another tenant gets no shift from shift_review');
select is((select count(*) from fixture f cross join lateral public.item_lifecycle(f.both_stores, f.anchor) l), 0::bigint, 'another tenant gets no item from item_lifecycle');
select is((select count(*) from fixture f cross join lateral public.store_coverage(f.both_stores, f.anchor - 1, f.anchor) c), 0::bigint, 'another tenant gets no store from store_coverage');
select is((select count(*) from fixture f cross join lateral public.store_targets(f.both_stores, 'month', '2026-03-01') t), 0::bigint, 'another tenant gets no target from store_targets');
select is(
  (
    select (
      (select count(*) from fixture f cross join lateral public.store_coverage(array[f.other_store] || f.both_stores, f.anchor - 1, f.anchor) c),
      (select c.net_amount from fixture f cross join lateral public.period_compare_by_store(array[f.other_store] || f.both_stores, 'day', f.anchor) c where c.store_id is null and c.period = 'current')
        = (select c.net_amount from fixture f cross join lateral public.period_compare_by_store(array[f.other_store], 'day', f.anchor) c where c.store_id = f.other_store and c.period = 'current')
    )
  ),
  (1::bigint, true),
  'the other owner reads the own store, and stores of another tenant in the same call add nothing'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000000202", "role": "authenticated"}';

select is(
  (
    select (array_agg(distinct c.store_id) filter (where c.store_id is not null) = array[f.store_a], (array_agg(c.net_amount) filter (where c.store_id is null and c.period = 'current'))[1])
    from fixture f cross join lateral public.period_compare_by_store(f.both_stores, 'day', f.anchor) c
    group by f.store_a
  ),
  (true, (select net_amount from store_a_expected)),
  'a store-limited member gets per-store rows for the visible store only, and totals of that store'
);
select is(
  (
    select (array_agg(distinct s.store_id) filter (where s.store_id is not null) = array[f.store_a], sum(s.invoices) filter (where s.store_id is null and s.bucket_start = f.anchor))
    from fixture f cross join lateral public.period_series(f.both_stores, 'day', f.anchor - 1, f.anchor) s
    group by f.store_a
  ),
  (true, (select invoices::numeric from store_a_expected)),
  'a store-limited member gets period_series rows of the visible store only'
);
select is(
  (select array_agg(c.store_id) from fixture f cross join lateral public.store_coverage(f.both_stores, f.anchor - 1, f.anchor) c),
  (select array[f.store_a] from fixture f),
  'a store-limited member gets coverage of the visible store only'
);
select is(
  (select sum(i.net_amount) from fixture f cross join lateral public.item_summary(f.both_stores, f.anchor - 1, f.anchor) i),
  (select item_net_amount from store_a_expected),
  'a store-limited member gets item sales of the visible store only'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000000203", "role": "authenticated"}';

select is(
  (
    select (count(*) filter (where c.store_id is not null), bool_and(c.net_amount is null and coalesce(c.days_with_data, 0) = 0))
    from fixture f cross join lateral public.period_compare_by_store(f.both_stores, 'day', f.anchor) c
  ),
  (8::bigint, true),
  'the publisher sees the stores but every total of period_compare_by_store is null'
);
select is(
  (
    select (
      (select bool_and(s.days_with_data = 0) from fixture f cross join lateral public.period_series(f.both_stores, 'day', f.anchor - 1, f.anchor) s),
      (select bool_and(m.value is null) from fixture f cross join lateral public.metric_compare(f.both_stores, array['net_revenue', 'invoices'], 'day', f.anchor) m),
      (select bool_and(h.current_net_amount is null) from fixture f cross join lateral public.hourly_profile(f.both_stores, f.anchor, 8) h)
    )
  ),
  (true, true, true),
  'the publisher reads zero sales from period_series, metric_compare and hourly_profile'
);
select is(
  (
    select (
      (select count(*) from fixture f cross join lateral public.item_summary(f.both_stores, f.anchor - 1, f.anchor) i),
      (select count(*) from fixture f cross join lateral public.payment_summary(f.both_stores, f.anchor - 1, f.anchor) p)
    )
  ),
  (0::bigint, 0::bigint),
  'the publisher reads no item and no payment row'
);
select is(
  (
    select (
      (select count(*) from fixture f cross join lateral public.promotion_summary(f.both_stores, f.anchor - 1, f.anchor) p),
      (select count(*) from fixture f cross join lateral public.shift_review(f.both_stores, f.anchor - 1, f.anchor) r)
    )
  ),
  (0::bigint, 0::bigint),
  'the publisher reads no promotion and no shift row'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000000204", "role": "authenticated"}';

select is(
  (
    select (count(distinct c.store_id), bool_and(c.net_amount is not null) filter (where c.period = 'current'))
    from fixture f cross join lateral public.period_compare_by_store(f.both_stores, 'day', f.anchor) c
  ),
  (2::bigint, true),
  'a viewer reads every store of the tenant'
);

reset role;
set local role anon;

select throws_ok(
  $$ select * from public.period_compare_by_store(array['44444444-4444-4444-8444-000000000121']::uuid[], 'day', '2026-03-18') $$,
  '42501',
  null,
  'anon calling a report function is refused'
);

select * from finish();
rollback;
