begin;
select plan(20);

create temp table fixture as
select
  '33333333-3333-4333-8333-000004110001'::uuid as tenant_id,
  '33333333-3333-4333-8333-000004110011'::uuid as account_id,
  '33333333-3333-4333-8333-000004110021'::uuid as store_t,
  '33333333-3333-4333-8333-000004110022'::uuid as store_bulk,
  '33333333-3333-4333-8333-000004110023'::uuid as store_early,
  '33333333-3333-4333-8333-000004110024'::uuid as store_la,
  '33333333-3333-4333-8333-000000412001'::uuid as other_tenant_id,
  '33333333-3333-4333-8333-000000412011'::uuid as other_account_id,
  '33333333-3333-4333-8333-000000412021'::uuid as other_store,
  '33333333-3333-4333-8333-000000413001'::uuid as owner_id,
  '33333333-3333-4333-8333-000000413002'::uuid as manager_id,
  '33333333-3333-4333-8333-000000413003'::uuid as publisher_id,
  '33333333-3333-4333-8333-000000413004'::uuid as other_owner_id,
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'::text as empty_fingerprint;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated'::varchar, 'authenticated'::varchar, u.email::varchar
from fixture f
cross join lateral (
  values
    (f.owner_id, 'export-owner@example.com'),
    (f.manager_id, 'export-manager@example.com'),
    (f.publisher_id, 'export-publisher@example.com'),
    (f.other_owner_id, 'export-other-owner@example.com')
) as u (id, email);

insert into public.tenants (id, slug, name)
select tenant_id, 'export-pgtap', 'Export Fixture' from fixture
union all
select other_tenant_id, 'export-pgtap-other', 'Export Fixture Other' from fixture;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select f.tenant_id, f.owner_id, 'owner'::public.tenant_role, null::uuid[] from fixture f
union all
select f.tenant_id, f.manager_id, 'manager', array[f.store_t] from fixture f
union all
select f.tenant_id, f.publisher_id, 'publisher', null from fixture f
union all
select f.other_tenant_id, f.other_owner_id, 'owner', null from fixture f;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_id, tenant_id, 'mock', 'export-pgtap', 'Export POS' from fixture
union all
select other_account_id, other_tenant_id, 'mock', 'export-pgtap-other', 'Export Other POS' from fixture;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name, timezone, business_day_start_minutes)
select f.store_t, f.tenant_id, f.account_id, 'export-t', 'Store T', 'Asia/Ho_Chi_Minh', 0 from fixture f
union all
select f.store_bulk, f.tenant_id, f.account_id, 'export-bulk', 'Store Bulk', 'Asia/Ho_Chi_Minh', 0 from fixture f
union all
select f.store_early, f.tenant_id, f.account_id, 'export-early', 'Store Early', 'Asia/Ho_Chi_Minh', 300 from fixture f
union all
select f.store_la, f.tenant_id, f.account_id, 'export-la', 'Store LA', 'America/Los_Angeles', 180 from fixture f
union all
select f.other_store, f.other_tenant_id, f.other_account_id, 'export-other', 'Store T', 'Asia/Ho_Chi_Minh', 0 from fixture f;

insert into public.invoices (id, tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, net_amount, paid_amount, status)
select v.id, f.tenant_id, f.store_t, f.account_id, v.external_id, (v.business_date + time '10:00') at time zone 'Asia/Ho_Chi_Minh', v.business_date,
  v.gross_amount, v.net_amount, v.paid_amount, v.status::public.invoice_status
from fixture f
cross join (
  values
    ('33333333-3333-4333-8333-000004110101'::uuid, 'T-1', '2025-07-01'::date, 50000.00, 45000.00, 45000.00, 'completed'),
    ('33333333-3333-4333-8333-000004110102', 'T-2', '2025-07-01', 30000.00, 30000.00, 0.00, 'voided'),
    ('33333333-3333-4333-8333-000004110103', 'T-3', '2025-07-02', 12345.67, 12345.67, 12345.67, 'edited'),
    ('33333333-3333-4333-8333-000004110104', 'T-4', '2025-07-03', 10000.00, 10000.00, 10000.00, 'completed')
) as v (id, external_id, business_date, gross_amount, net_amount, paid_amount, status);

insert into public.invoice_lines (tenant_id, store_id, invoice_id, external_id, line_kind, item_external_id, item_name, quantity, unit_price, gross_amount, net_amount)
select f.tenant_id, f.store_t, v.invoice_id, v.external_id, v.line_kind::public.line_kind, 'ITEM', 'Item', v.quantity, v.net_amount, v.net_amount, v.net_amount
from fixture f
cross join (
  values
    ('33333333-3333-4333-8333-000004110101'::uuid, 'L1', 'item', 1.000, 40000.00),
    ('33333333-3333-4333-8333-000004110101', 'L10', 'modifier', 1.000, 0.00),
    ('33333333-3333-4333-8333-000004110101', 'L2', 'item', 2.000, 5000.00),
    ('33333333-3333-4333-8333-000004110102', 'L1', 'item', 1.000, 30000.00),
    ('33333333-3333-4333-8333-000004110103', 'L1', 'item', 0.500, 12345.67),
    ('33333333-3333-4333-8333-000004110104', 'L1', 'item', 1.000, 10000.00)
) as v (invoice_id, external_id, line_kind, quantity, net_amount);

insert into public.invoice_payments (tenant_id, store_id, invoice_id, sequence_no, business_date, payment_method_external_id, amount)
select f.tenant_id, f.store_t, v.invoice_id, v.sequence_no, v.business_date, 'CASH', v.amount
from fixture f
cross join (
  values
    ('33333333-3333-4333-8333-000004110101'::uuid, 1, '2025-07-01'::date, 20000.00),
    ('33333333-3333-4333-8333-000004110101', 2, '2025-07-02', 25000.00),
    ('33333333-3333-4333-8333-000004110103', 1, '2025-07-02', 12345.67),
    ('33333333-3333-4333-8333-000004110104', 1, '2025-07-03', 10000.00)
) as v (invoice_id, sequence_no, business_date, amount);

insert into public.shifts (id, tenant_id, store_id, external_id, opened_at, sales_amount, expected_cash_amount, cash_drawer_amount)
select v.id, f.tenant_id, v.store_id, v.external_id, v.opened_at, v.sales_amount, v.expected_cash_amount, v.cash_drawer_amount
from fixture f
cross join lateral (
  values
    ('33333333-3333-4333-8333-000004110201'::uuid, f.store_t, 'S-T-1', '2025-07-01 06:00+07'::timestamptz, 45000.00, 520000.00, 519500.00),
    ('33333333-3333-4333-8333-000004110202', f.store_t, 'S-T-2', '2025-07-02 06:00+07', 12345.67, null, null),
    ('33333333-3333-4333-8333-000004110203', f.store_t, 'S-T-3', '2025-07-03 06:00+07', 10000.00, null, null),
    ('33333333-3333-4333-8333-000004110211', f.store_early, 'S-E-1', '2025-07-03 04:30+07', 0.00, null, null),
    ('33333333-3333-4333-8333-000004110212', f.store_early, 'S-E-2', '2025-07-03 05:30+07', 0.00, null, null),
    ('33333333-3333-4333-8333-000004110221', f.store_la, 'S-L-1', '2025-03-09 09:30+00', 0.00, null, null),
    ('33333333-3333-4333-8333-000004110222', f.store_la, 'S-L-2', '2025-03-09 10:30+00', 0.00, null, null),
    ('33333333-3333-4333-8333-000004110223', f.store_la, 'S-L-3', '2025-11-02 08:30+00', 0.00, null, null),
    ('33333333-3333-4333-8333-000004110224', f.store_la, 'S-L-4', '2025-11-02 09:30+00', 0.00, null, null),
    ('33333333-3333-4333-8333-000004110225', f.store_la, 'S-L-5', '2025-11-02 11:30+00', 0.00, null, null)
) as v (id, store_id, external_id, opened_at, sales_amount, expected_cash_amount, cash_drawer_amount);

create temp table bulk_plan as
select
  f.store_bulk as store_id,
  '2025-08-01'::date + d.day_offset as business_date,
  n.invoice_no,
  d.day_offset * 11 + n.invoice_no * 7 as seed
from fixture f
cross join generate_series(0, 30) as d (day_offset)
cross join generate_series(1, 4) as n (invoice_no);

insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, net_amount, paid_amount, status)
select f.tenant_id, b.store_id, f.account_id, format('B-%s-%s', b.business_date, b.invoice_no), (b.business_date + time '23:30') at time zone 'Asia/Ho_Chi_Minh', b.business_date,
  20000 + b.seed * 10.25, 20000 + b.seed * 10.25 - (b.seed % 3) * 1000, 20000 + b.seed * 10.25 - (b.seed % 3) * 1000,
  (case when b.seed % 17 = 0 then 'voided' when b.seed % 13 = 0 then 'edited' else 'completed' end)::public.invoice_status
from bulk_plan b
cross join fixture f;

insert into public.invoice_lines (tenant_id, store_id, invoice_id, external_id, line_kind, item_external_id, item_name, quantity, unit_price, gross_amount, net_amount)
select i.tenant_id, i.store_id, i.id, 'L' || n, 'item', 'ITEM-' || n, 'Item ' || n, n * 0.25, i.net_amount / n, i.net_amount / n, round(i.net_amount / (n + 1), 2)
from public.invoices i
cross join generate_series(1, 3) as n
where i.store_id = (select store_bulk from fixture);

insert into public.invoice_payments (tenant_id, store_id, invoice_id, sequence_no, business_date, payment_method_external_id, amount)
select i.tenant_id, i.store_id, i.id, 1, i.business_date + case when i.external_id like '%-4' then 1 else 0 end, 'CASH', i.paid_amount
from public.invoices i
where i.store_id = (select store_bulk from fixture)
  and i.status <> 'voided';

insert into public.shifts (tenant_id, store_id, external_id, opened_at, sales_amount, expected_cash_amount, cash_drawer_amount)
select f.tenant_id, f.store_bulk, 'B-SHIFT-' || d, ('2025-08-01'::date + d + time '06:00') at time zone 'Asia/Ho_Chi_Minh', 1000 * d,
  case when d % 2 = 0 then 100000 end, case when d % 2 = 0 then 100000 - d * 10.5 end
from fixture f
cross join generate_series(0, 30) as d;

select app.refresh_analytics(f.tenant_id, '2025-03-01', '2025-11-30') from fixture f;

grant select on fixture to authenticated;

select results_eq(
  $$
    select (
      p.proname::text || ':' || pg_get_function_identity_arguments(p.oid) || ':' || p.provolatile::text || ':' || coalesce(array_to_string(p.proconfig, ','), '-')
      || ':' || has_function_privilege('authenticated', p.oid, 'execute')::text || ':' || has_function_privilege('service_role', p.oid, 'execute')::text
      || ':' || has_function_privilege('anon', p.oid, 'execute')::text
    ) collate "default"
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname in ('minor_units', 'fingerprint')
    order by p.proname
  $$,
  $$
    values
      ('fingerprint:lines text:i:search_path="":true:true:false'),
      ('minor_units:amount numeric, scale integer:i:search_path="":true:true:false')
  $$,
  'the two helpers are immutable with an empty search_path, for authenticated and service_role and not anon'
);

select is(
  array[app.minor_units(12.34, 2), app.minor_units(-0.5, 2), app.minor_units(1.5, 3), app.minor_units(0, 2), app.fingerprint(null), app.fingerprint('')],
  array['1234', '-50', '1500', '0', (select empty_fingerprint from fixture), (select empty_fingerprint from fixture)],
  'minor units are integers as text and an absent text fingerprints as the empty one'
);

set local role authenticated;
set local request.jwt.claims to '{"sub": "33333333-3333-4333-8333-000000413001", "role": "authenticated"}';

select is(
  (
    select (
      e.store_id, e.invoices, e.voided_invoices, e.sales_net_amount, e.invoice_fingerprint,
      e.lines, e.line_net_amount, e.line_fingerprint,
      e.payments, e.payment_amount, e.payment_fingerprint,
      e.shifts, e.shift_sales_amount, e.shift_fingerprint
    )
    from fixture f
    cross join lateral public.export_control_totals(array[f.store_t], '2025-07-01', '2025-07-02') e
  ),
  (
    (select store_t from fixture), 3::bigint, 1::bigint, 57345.67::numeric, 'a7399fc0eaea2679b536f8502eed461deb4614fd09b0d5afd1816e7f7c0d286f'::text,
    5::bigint, 87345.67::numeric, '6e58777fcf34ad78f9f724779a383ee919096f60d22056e6e61d3868988834bb'::text,
    3::bigint, 57345.67::numeric, 'ceabcfb369e775fc13a42fb2fe5cab48b03eec571ff6a8c319dbe8fac8eacddb'::text,
    2::bigint, 57345.67::numeric, 'cfadcccb028cd7be796a8d544d7cce900f897eea6e8fbd495c4f3c5335ae19b7'::text
  ),
  'the tiny fixture gives the pinned counts, sums and fingerprints that the exporter''s tests share'
);

select is(
  (
    select (e.invoices, e.lines, e.payments, e.payment_amount, e.payment_fingerprint, e.shifts)
    from fixture f
    cross join lateral public.export_control_totals(array[f.store_t], '2025-07-01', '2025-07-01') e
  ),
  (2::bigint, 4::bigint, 1::bigint, 20000.00::numeric, '09b524851eafd5c92941519a1770d3bea04cbaf9d02d09529c8f2e468b6f7ff5'::text, 1::bigint),
  'payments are selected by their own business date and lines by their invoice''s'
);

select is(
  (
    select (e.invoices, e.lines, e.payments, e.shifts)
    from fixture f
    cross join lateral public.export_control_totals(array[f.store_t], '2025-07-02', '2025-07-02') e
  ),
  (1::bigint, 1::bigint, 2::bigint, 1::bigint),
  'a payment dated after its invoice counts on its own day'
);

select results_eq(
  $$
    select e.store_id, e.invoices, e.voided_invoices, e.sales_net_amount, e.invoice_fingerprint
    from fixture f
    cross join lateral public.export_control_totals(array[f.store_bulk], '2025-08-01', '2025-08-31') e
  $$,
  $$
    select i.store_id, count(*), count(*) filter (where i.status = 'voided'), sum(i.net_amount) filter (where i.status <> 'voided'),
      encode(sha256(convert_to(string_agg(
        i.id || '|' || i.status || '|' || round(i.net_amount * 100)::bigint || '|' || round(i.gross_amount * 100)::bigint || '|' || round(i.paid_amount * 100)::bigint || '|' || to_char(i.business_date, 'YYYY-MM-DD'),
        chr(10) order by i.id::text collate "C"
      ), 'UTF8')), 'hex')
    from public.invoices i
    where i.store_id = (select store_bulk from fixture)
      and i.business_date between '2025-08-01' and '2025-08-31'
    group by i.store_id
  $$,
  'invoice counts, sales and the fingerprint equal the invoices table over a month'
);

select results_eq(
  $$
    select e.lines, e.line_net_amount, e.line_fingerprint
    from fixture f
    cross join lateral public.export_control_totals(array[f.store_bulk], '2025-08-01', '2025-08-31') e
  $$,
  $$
    select count(*), sum(l.net_amount),
      encode(sha256(convert_to(string_agg(
        l.invoice_id || '|' || l.external_id || '|' || l.line_kind || '|' || round(l.quantity * 1000)::bigint || '|' || round(l.net_amount * 100)::bigint,
        chr(10) order by l.invoice_id::text collate "C", l.external_id collate "C"
      ), 'UTF8')), 'hex')
    from public.invoice_lines l
    join public.invoices i on i.id = l.invoice_id
    where i.store_id = (select store_bulk from fixture)
      and i.business_date between '2025-08-01' and '2025-08-31'
  $$,
  'line counts, net and the fingerprint equal the lines of the month''s invoices'
);

select results_eq(
  $$
    select e.payments, e.payment_amount, e.payment_fingerprint, e.shifts, e.shift_sales_amount, e.shift_fingerprint
    from fixture f
    cross join lateral public.export_control_totals(array[f.store_bulk], '2025-08-01', '2025-08-31') e
  $$,
  $$
    select p.payment_count, p.payment_amount, p.payment_fingerprint, s.shift_count, s.shift_sales, s.shift_fingerprint
    from (
      select count(*) as payment_count, sum(p.amount) as payment_amount,
        encode(sha256(convert_to(string_agg(
          p.invoice_id || '|' || p.sequence_no || '|' || round(p.amount * 100)::bigint,
          chr(10) order by p.invoice_id::text collate "C", p.sequence_no
        ), 'UTF8')), 'hex') as payment_fingerprint
      from public.invoice_payments p
      where p.store_id = (select store_bulk from fixture)
        and p.business_date between '2025-08-01' and '2025-08-31'
    ) p
    cross join (
      select count(*) as shift_count, sum(s.sales_amount) as shift_sales,
        encode(sha256(convert_to(string_agg(
          s.id || '|' || round(s.sales_amount * 100)::bigint || '|' || coalesce(round(s.cash_variance_amount * 100)::bigint::text, ''),
          chr(10) order by s.id::text collate "C"
        ), 'UTF8')), 'hex') as shift_fingerprint
      from public.shifts s
      where s.store_id = (select store_bulk from fixture)
        and (s.opened_at at time zone 'Asia/Ho_Chi_Minh')::date between '2025-08-01' and '2025-08-31'
    ) s
  $$,
  'payment and shift counts, sums and fingerprints equal the payments and shifts tables over a month'
);

select ok(
  (
    select e.payments < (select count(*) from public.invoice_payments p where p.store_id = (select store_bulk from fixture))
      and e.voided_invoices > 0
      and e.shift_fingerprint <> (select empty_fingerprint from fixture)
    from fixture f
    cross join lateral public.export_control_totals(array[f.store_bulk], '2025-08-01', '2025-08-31') e
  ),
  'the month leaves out payments dated into the next month and counts voided invoices'
);

select results_eq(
  $$
    select d::date, (select e.shifts from fixture f cross join lateral public.export_control_totals(array[f.store_early], d::date, d::date) e)
    from generate_series('2025-07-01'::date, '2025-07-04'::date, interval '1 day') as d
    order by 1
  $$,
  $$
    select d::date, (select count(*) from public.agg_shift_cash a where a.store_id = (select store_early from fixture) and a.business_date = d::date)
    from generate_series('2025-07-01'::date, '2025-07-04'::date, interval '1 day') as d
    order by 1
  $$,
  'with a 05:00 day start each shift falls on the business date of agg_shift_cash'
);

select is(
  (
    select array_agg(d::date || ':' || (select e.shifts from fixture f cross join lateral public.export_control_totals(array[f.store_early], d::date, d::date) e) order by d)
    from generate_series('2025-07-02'::date, '2025-07-03'::date, interval '1 day') as d
  ),
  array['2025-07-02:1', '2025-07-03:1'],
  'a shift opened at 04:30 belongs to the day before and one opened at 05:30 to its own day'
);

select results_eq(
  $$
    select d::date, (select e.shifts from fixture f cross join lateral public.export_control_totals(array[f.store_la], d::date, d::date) e)
    from (
      select generate_series('2025-03-07'::date, '2025-03-10'::date, interval '1 day') as d
      union all
      select generate_series('2025-10-31'::date, '2025-11-03'::date, interval '1 day')
    ) days
    order by 1
  $$,
  $$
    select d::date, (select count(*) from public.agg_shift_cash a where a.store_id = (select store_la from fixture) and a.business_date = d::date)
    from (
      select generate_series('2025-03-07'::date, '2025-03-10'::date, interval '1 day') as d
      union all
      select generate_series('2025-10-31'::date, '2025-11-03'::date, interval '1 day')
    ) days
    order by 1
  $$,
  'in America/Los_Angeles with a 03:00 day start the business dates equal agg_shift_cash across both clock changes'
);

select is(
  (
    select array_agg(d::date || ':' || (select e.shifts from fixture f cross join lateral public.export_control_totals(array[f.store_la], d::date, d::date) e) order by d)
    from (
      select generate_series('2025-03-08'::date, '2025-03-09'::date, interval '1 day') as d
      union all
      select generate_series('2025-11-01'::date, '2025-11-02'::date, interval '1 day')
    ) days
  ),
  array['2025-03-08:1', '2025-03-09:1', '2025-11-01:2', '2025-11-02:1'],
  'the hand-computed business dates hold around the spring and autumn changes'
);

select lives_ok(
  $$ select * from public.export_control_totals(array['33333333-3333-4333-8333-000004110021']::uuid[], '2025-07-01', '2025-09-30') $$,
  'export_control_totals accepts 92 days'
);

select throws_ok(
  $$ select * from public.export_control_totals(array['33333333-3333-4333-8333-000004110021']::uuid[], '2025-07-01', '2025-10-01') $$,
  '22023',
  'export_control_totals covers at most 92 days, not 93',
  'export_control_totals refuses 93 days'
);

select results_eq(
  $$
    select e.store_id
    from fixture f
    cross join lateral public.export_control_totals(array[f.store_bulk, f.other_store, f.store_t, f.store_bulk], '2025-07-01', '2025-07-02') e
  $$,
  $$ select v.store_id from fixture f cross join lateral (values (f.store_bulk), (f.store_t)) as v (store_id) $$,
  'the owner gets one row per visible store in the order asked, and none for another tenant''s store'
);

set local request.jwt.claims to '{"sub": "33333333-3333-4333-8333-000000413002", "role": "authenticated"}';

select results_eq(
  $$
    select e.store_id, e.invoices, e.invoice_fingerprint
    from fixture f
    cross join lateral public.export_control_totals(array[f.store_bulk, f.store_t], '2025-07-01', '2025-07-02') e
  $$,
  $$ select store_t, 3::bigint, 'a7399fc0eaea2679b536f8502eed461deb4614fd09b0d5afd1816e7f7c0d286f'::text from fixture $$,
  'a store-limited manager gets the own store only'
);

set local request.jwt.claims to '{"sub": "33333333-3333-4333-8333-000000413003", "role": "authenticated"}';

select ok(
  (
    select count(*) = 2
      and bool_and(e.invoices = 0 and e.voided_invoices = 0 and e.lines = 0 and e.payments = 0 and e.shifts = 0)
      and bool_and(e.sales_net_amount = 0 and e.line_net_amount = 0 and e.payment_amount = 0 and e.shift_sales_amount = 0)
      and bool_and(
        e.invoice_fingerprint = f.empty_fingerprint and e.line_fingerprint = f.empty_fingerprint
        and e.payment_fingerprint = f.empty_fingerprint and e.shift_fingerprint = f.empty_fingerprint
      )
    from fixture f
    cross join lateral public.export_control_totals(array[f.store_t, f.store_bulk], '2025-07-01', '2025-08-31') e
  ),
  'the publisher gets zero counts, zero sums and empty fingerprints'
);

set local request.jwt.claims to '{"sub": "33333333-3333-4333-8333-000000413004", "role": "authenticated"}';

select is(
  (select count(*)::int from fixture f cross join lateral public.export_control_totals(array[f.store_t, f.store_bulk], '2025-07-01', '2025-08-31') e),
  0,
  'another tenant''s owner gets no row for the stores'
);

reset role;
set local role anon;

select throws_ok(
  $$ select app.fingerprint('x') $$,
  '42501',
  null,
  'anon calling app.fingerprint is refused'
);

select * from finish();
rollback;
