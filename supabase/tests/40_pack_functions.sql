begin;
select plan(43);

create temp table fixture as
select
  '33333333-3333-4333-8333-000000400001'::uuid as tenant_id,
  '33333333-3333-4333-8333-000000400011'::uuid as account_id,
  '33333333-3333-4333-8333-000000400021'::uuid as store_a,
  '33333333-3333-4333-8333-000000400022'::uuid as store_b,
  '33333333-3333-4333-8333-000000400023'::uuid as store_c,
  array['33333333-3333-4333-8333-000000400021', '33333333-3333-4333-8333-000000400022']::uuid[] as both_stores,
  '33333333-3333-4333-8333-000000401001'::uuid as other_tenant_id,
  '33333333-3333-4333-8333-000000401011'::uuid as other_account_id,
  '33333333-3333-4333-8333-000000401021'::uuid as other_store,
  '33333333-3333-4333-8333-000000402001'::uuid as owner_id,
  '33333333-3333-4333-8333-000000402002'::uuid as manager_id,
  '33333333-3333-4333-8333-000000402003'::uuid as publisher_id,
  '33333333-3333-4333-8333-000000402004'::uuid as other_owner_id,
  '2025-03-01'::date as data_from,
  '2025-05-09'::date as data_to;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated'::varchar, 'authenticated'::varchar, u.email::varchar
from fixture f
cross join lateral (
  values
    (f.owner_id, 'pack-owner@example.com'),
    (f.manager_id, 'pack-manager@example.com'),
    (f.publisher_id, 'pack-publisher@example.com'),
    (f.other_owner_id, 'pack-other-owner@example.com')
) as u (id, email);

insert into public.tenants (id, slug, name)
select tenant_id, 'pack-pgtap', 'Pack Fixture' from fixture
union all
select other_tenant_id, 'pack-pgtap-other', 'Pack Fixture Other' from fixture;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select f.tenant_id, f.owner_id, 'owner'::public.tenant_role, null::uuid[] from fixture f
union all
select f.tenant_id, f.manager_id, 'manager', array[f.store_a] from fixture f
union all
select f.tenant_id, f.publisher_id, 'publisher', null from fixture f
union all
select f.other_tenant_id, f.other_owner_id, 'owner', null from fixture f;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_id, tenant_id, 'mock', 'pack-pgtap', 'Pack POS' from fixture
union all
select other_account_id, other_tenant_id, 'mock', 'pack-pgtap-other', 'Pack Other POS' from fixture;

insert into public.stores (
  id, tenant_id, pos_account_id, external_id, code, name, address, timezone, business_day_start_minutes,
  opening_hours, seat_count, opened_on, e_invoice_status, active, first_seen_at
)
select f.store_a, f.tenant_id, f.account_id, 'pack-a', 'A-CODE', 'Store A', 'Hidden street 1', 'Asia/Ho_Chi_Minh', 0,
  '{"mon": [["07:00", "22:00"]], "tue": [["07:00", "22:00"]], "wed": [["07:00", "22:00"]], "thu": [["07:00", "22:00"]], "fri": [["07:00", "22:00"]], "sat": [["07:00", "22:00"]], "sun": [["07:00", "22:00"]]}'::jsonb,
  30, '2025-03-01'::date, 'configured'::public.e_invoice_status, true, '2025-02-01 00:00+07'::timestamptz
from fixture f
union all
select f.store_b, f.tenant_id, f.account_id, 'pack-b', 'B-CODE', 'Store B', null, 'Asia/Ho_Chi_Minh', 0,
  null, null, '2025-03-01', 'unknown', true, '2025-01-01 00:00+07'
from fixture f
union all
select f.store_c, f.tenant_id, f.account_id, 'pack-c', null, 'Store C', null, 'Asia/Ho_Chi_Minh', 0,
  null, null, null, 'unknown', false, '2025-01-15 00:00+07'
from fixture f
union all
select f.other_store, f.other_tenant_id, f.other_account_id, 'pack-other', null, 'Store A', null, 'Asia/Ho_Chi_Minh', 0,
  null, null, null, 'unknown', true, '2024-12-01 00:00+07'
from fixture f;

insert into public.payment_methods (tenant_id, pos_account_id, external_id, name, kind)
select f.tenant_id, f.account_id, m.external_id, m.name, m.kind::public.payment_kind
from fixture f
cross join (values ('CASH', 'Cash', 'cash'), ('CARD', 'Card', 'card')) as m (external_id, name, kind);

insert into public.item_type_roles (tenant_id, pos_account_id, item_type_external_id, role)
select f.tenant_id, f.account_id, r.type_id, r.role::public.item_type_role
from fixture f
cross join (values ('TYPE-DRINK', 'drink'), ('TYPE-SNACK', 'snack')) as r (type_id, role);

create temp table sale_plan as
select
  s.store_id,
  s.store_code,
  f.data_from + d.day_offset as business_date,
  n.invoice_no,
  d.day_offset * 5 + n.invoice_no * 3 + s.store_offset * 7 as seed
from fixture f
cross join lateral (values (f.store_a, 'A', 0), (f.store_b, 'B', 1)) as s (store_id, store_code, store_offset)
cross join generate_series(0, f.data_to - f.data_from) as d (day_offset)
cross join generate_series(1, 3) as n (invoice_no);

create temp table sales_fixture as
select
  p.*,
  format('PACK-%s-%s-%s', p.store_code, to_char(p.business_date, 'YYYYMMDD'), p.invoice_no) as external_id,
  p.seed % 4 as drink_no,
  case when p.seed % 3 = 0 then 'L' else 'M' end as drink_size,
  30000 + (p.seed % 4) * 5000 as drink_price,
  p.seed % 4 = 0 as with_snack,
  case when p.seed % 13 = 0 then 5000 else 0 end as voucher_amount,
  (case when p.seed % 37 = 0 then 'voided' when p.seed % 19 = 0 then 'edited' else 'completed' end)::public.invoice_status as sale_status,
  case when p.seed % 5 = 0 then 'member-' || (p.seed % 7)::text end as customer_phone,
  case when p.seed % 2 = 0 then 'CASH' else 'CARD' end as method,
  make_time(9 + p.seed % 12, 0, 0) as sold_time
from sale_plan p;

insert into public.invoices (
  tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, customer_phone,
  gross_amount, voucher_amount, voucher_code, net_amount, paid_amount, status
)
select
  f.tenant_id, s.store_id, f.account_id, s.external_id, (s.business_date + s.sold_time) at time zone 'Asia/Ho_Chi_Minh', s.business_date,
  s.customer_phone, s.drink_price + case when s.with_snack then 15000 else 0 end, s.voucher_amount,
  case when s.voucher_amount > 0 then 'VOUCHER' end,
  s.drink_price + case when s.with_snack then 15000 else 0 end - s.voucher_amount,
  s.drink_price + case when s.with_snack then 15000 else 0 end - s.voucher_amount,
  s.sale_status
from sales_fixture s
cross join fixture f;

insert into public.invoice_lines (
  tenant_id, store_id, invoice_id, external_id, line_kind, item_external_id, item_name, base_name, size_label,
  item_type_external_id, item_type_name, quantity, unit_price, gross_amount, net_amount
)
select
  f.tenant_id, s.store_id, i.id, 'L1', 'item'::public.line_kind,
  format('DRINK-%s-%s', s.drink_no, s.drink_size), format('Drink %s (%s)', s.drink_no, s.drink_size), format('Drink %s', s.drink_no), s.drink_size,
  'TYPE-DRINK', 'Drinks', 1, s.drink_price, s.drink_price, s.drink_price
from sales_fixture s
cross join fixture f
join public.invoices i on i.store_id = s.store_id and i.external_id = s.external_id
union all
select f.tenant_id, s.store_id, i.id, 'L2', 'item', 'SNACK', 'Snack', 'Snack', null, 'TYPE-SNACK', 'Snacks', 1, 15000, 15000, 15000
from sales_fixture s
cross join fixture f
join public.invoices i on i.store_id = s.store_id and i.external_id = s.external_id
where s.with_snack;

insert into public.invoice_payments (tenant_id, store_id, invoice_id, sequence_no, business_date, payment_method_external_id, amount)
select f.tenant_id, s.store_id, i.id, 1, s.business_date, s.method, i.net_amount
from sales_fixture s
cross join fixture f
join public.invoices i on i.store_id = s.store_id and i.external_id = s.external_id;

select app.refresh_analytics(f.tenant_id, f.data_from, f.data_to) from fixture f;

update public.tenants
set analytics_pending_from = null, analytics_pending_to = null
where id = (select tenant_id from fixture);

insert into public.holidays (tenant_id, country_code, holiday_date, name, kind)
select h.tenant_id, h.country_code, h.holiday_date, h.name, h.kind::public.holiday_kind
from fixture f
cross join lateral (
  values
    (null::uuid, 'VN', '2031-04-30'::date, 'Fixture victory day', 'public'),
    (null, 'VN', '2031-09-02', 'Fixture national day', 'public'),
    (null, 'TH', '2031-04-13', 'Fixture other country', 'public'),
    (f.tenant_id, 'VN', '2031-02-01', 'Fixture store anniversary', 'custom'),
    (f.tenant_id, 'VN', '2031-02-01', 'beta lower case', 'custom'),
    (f.tenant_id, 'VN', '2031-04-30', 'Fixture victory day', 'public'),
    (f.tenant_id, 'VN', '2031-04-30', 'Alpha day', 'custom'),
    (f.other_tenant_id, 'VN', '2031-03-03', 'Other tenant day', 'custom')
) as h (tenant_id, country_code, holiday_date, name, kind);

create temp table trackable as
select t.metric_id, t.id_position
from unnest(array[
  'net_revenue', 'gross_revenue', 'invoices', 'avg_ticket', 'items_per_ticket', 'avg_item_price',
  'cash_share', 'voucher_invoice_share', 'member_invoice_share', 'discount_rate',
  'attach_rate_topping', 'attach_rate_snack', 'size_l_share',
  'sales_per_opening_hour', 'invoices_per_opening_hour',
  'edit_rate', 'removed_line_rate', 'customer_capture_rate'
]::text[]) with ordinality as t (metric_id, id_position);

create temp table windows as
select w.from_date, w.to_date, w.range_position
from unnest(
  array['2025-03-01', '2025-04-01', '2025-02-01']::date[],
  array['2025-03-28', '2025-05-09', '2025-02-28']::date[]
) with ordinality as w (from_date, to_date, range_position);

create temp table window_args as
select
  (select array_agg(t.metric_id order by t.id_position) from trackable t) as metric_ids,
  (select array_agg(w.from_date order by w.range_position) from windows w) as from_dates,
  (select array_agg(w.to_date order by w.range_position) from windows w) as to_dates;

create temp table fences (step text primary key, fence text not null);
create temp table owner_store_a (range_index smallint, from_date date, to_date date, metric_id text, value numeric);

grant select on fixture, trackable, windows, window_args to authenticated;
grant select, insert on fences, owner_store_a to authenticated;

select results_eq(
  $$
    select (
      p.proname::text || ':' || pg_get_function_identity_arguments(p.oid) || ':' || p.provolatile::text || ':' || p.prosecdef::text || ':' || coalesce(array_to_string(p.proconfig, ','), '-')
      || ':' || has_function_privilege('authenticated', p.oid, 'execute')::text || ':' || has_function_privilege('anon', p.oid, 'execute')::text
    ) collate "default"
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('store_profiles', 'metric_windows', 'holiday_calendar', 'pack_fence', 'export_control_totals')
    order by p.proname
  $$,
  $$
    values
      ('export_control_totals:store_ids uuid[], from_date date, to_date date:s:false:search_path="":true:false'),
      ('holiday_calendar:store_ids uuid[], from_date date, to_date date:s:false:search_path="":true:false'),
      ('metric_windows:store_ids uuid[], metric_ids text[], from_dates date[], to_dates date[]:s:false:search_path="":true:false'),
      ('pack_fence:store_ids uuid[]:s:false:search_path="":true:false'),
      ('store_profiles:store_ids uuid[]:s:false:search_path="":true:false')
  $$,
  'the five functions have one signature each, are stable and security invoker with an empty search_path, for authenticated and not anon'
);

select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    cross join lateral unnest(coalesce(p.proallargtypes, p.proargtypes::oid[] || p.prorettype)) as t (type_id)
    where n.nspname = 'public'
      and p.proname in (
        'store_profiles', 'store_coverage', 'report_settings_of', 'metric_windows', 'period_series', 'month_pace',
        'forecast_accuracy', 'hour_weekday_heatmap', 'hour_profile', 'item_summary', 'menu_engineering', 'item_margins',
        'basket_pairs', 'modifier_summary', 'payment_summary', 'promotion_summary', 'shift_review', 'holiday_calendar'
      )
      and t.type_id in ('double precision'::regtype, 'real'::regtype)
  ),
  0,
  'no function the pack calls takes or returns double precision or real'
);

set local role authenticated;
set local request.jwt.claims to '{"sub": "33333333-3333-4333-8333-000000402001", "role": "authenticated"}';

select results_eq(
  $$
    select w.range_index, w.from_date, w.to_date, w.metric_id, w.value
    from fixture f, window_args a
    cross join lateral public.metric_windows(f.both_stores, a.metric_ids, a.from_dates, a.to_dates) w
  $$,
  $$
    select r.range_position::smallint, r.from_date, r.to_date, t.metric_id, public.metric_value(f.both_stores, t.metric_id, r.from_date, r.to_date)
    from fixture f
    cross join windows r
    cross join trackable t
    order by r.range_position, t.id_position
  $$,
  'metric_windows equals metric_value for every trackable id over three ranges, ordered by range then id'
);

select ok(
  (
    select count(*) filter (where w.value is not null) >= 30
      and count(*) filter (where w.range_index = 3 and w.value is not null) = 0
      and count(*) = 54
    from fixture f, window_args a
    cross join lateral public.metric_windows(f.both_stores, a.metric_ids, a.from_dates, a.to_dates) w
  ),
  'the fixture measures most metrics in the two ranges with sales and none in the range before them'
);

insert into owner_store_a
select w.*
from fixture f, window_args a
cross join lateral public.metric_windows(array[f.store_a], a.metric_ids, a.from_dates, a.to_dates) w;

select throws_ok(
  $$ select * from public.metric_windows(array['33333333-3333-4333-8333-000000400021']::uuid[], array_fill('net_revenue'::text, array[26]), array['2025-03-01']::date[], array['2025-03-28']::date[]) $$,
  '22023',
  'metric_windows needs 1 to 25 metric ids',
  'metric_windows refuses 26 metric ids'
);

select throws_ok(
  $$ select * from public.metric_windows(array['33333333-3333-4333-8333-000000400021']::uuid[], array['net_revenue'], array_fill('2025-03-01'::date, array[13]), array_fill('2025-03-28'::date, array[13])) $$,
  '22023',
  'metric_windows needs 1 to 12 ranges and as many to_dates as from_dates',
  'metric_windows refuses 13 ranges'
);

select throws_ok(
  $$ select * from public.metric_windows(array['33333333-3333-4333-8333-000000400021']::uuid[], array['net_revenue'], array['2025-03-01', '2025-04-01']::date[], array['2025-03-28']::date[]) $$,
  '22023',
  'metric_windows needs 1 to 12 ranges and as many to_dates as from_dates',
  'metric_windows refuses lists of different lengths'
);

select throws_ok(
  $$ select * from public.metric_windows(array['33333333-3333-4333-8333-000000400021']::uuid[], array['net_revenue'], array['2025-03-01', '2025-03-10']::date[], array['2025-03-28', '2025-03-01']::date[]) $$,
  '22023',
  'metric_windows needs a date range whose start is not after its end',
  'metric_windows refuses a reversed range'
);

select throws_ok(
  $$ select * from public.metric_windows(array['33333333-3333-4333-8333-000000400021']::uuid[], array['net_revenue'], array['2024-01-01']::date[], array['2025-02-04']::date[]) $$,
  '22023',
  'metric_windows covers at most 400 days, not 401',
  'metric_windows refuses a range of 401 days'
);

select throws_ok(
  $$ select * from public.metric_windows(array['33333333-3333-4333-8333-000000400021']::uuid[], array['net_revenue', 'net_sales'], array['2025-03-01']::date[], array['2025-03-28']::date[]) $$,
  '22023',
  'metric_value does not compute ''net_sales''',
  'an id metric_value does not compute raises metric_value''s own error'
);

select throws_ok(
  $$ select * from public.metric_windows(array['33333333-3333-4333-8333-000000400021']::uuid[], array['net_revenue', null], array['2025-03-01']::date[], array['2025-03-28']::date[]) $$,
  '22023',
  'metric_windows needs 1 to 25 metric ids',
  'metric_windows refuses a null metric id'
);

select is(
  (
    select count(*)::int
    from public.metric_windows(array[]::uuid[], array['net_revenue', 'net_sales'], array['2025-03-01']::date[], array['2025-03-28']::date[])
  ),
  0,
  'metric_windows returns nothing for an empty store list, before any metric is computed'
);

select results_eq(
  $$
    select r.label, r.store_id
    from fixture f
    cross join lateral public.store_profiles(array[f.store_a, f.store_b, f.store_c, f.store_a]) r
  $$,
  $$
    select v.label, v.store_id
    from fixture f
    cross join lateral (values ('S3'::text, f.store_a), ('S1', f.store_b), ('S2', f.store_c)) as v (label, store_id)
  $$,
  'labels rank the tenant''s stores by first_seen_at, the inactive store keeping its place, rows in the order asked without repeats'
);

select is(
  (
    select (r.tenant_id, r.name, r.timezone, r.business_day_start_minutes, r.opened_on, r.opening_hours -> 'mon', r.seat_count, r.e_invoice_status, r.currency_code, r.country_code)
    from fixture f
    cross join lateral public.store_profiles(array[f.store_a]) r
  ),
  (
    (select tenant_id from fixture), 'Store A'::text, 'Asia/Ho_Chi_Minh'::text, 0, '2025-03-01'::date, '[["07:00", "22:00"]]'::jsonb, 30,
    'configured'::public.e_invoice_status, 'VND'::text, 'VN'::text
  ),
  'a profile carries the store''s name, zone, day start, opening date and hours, seats, e-invoicing and the tenant''s currency and country'
);

select ok(
  (
    select not (p.proargnames && array['address', 'code', 'external_id', 'pos_account_id', 'raw', 'settings'])
    from pg_proc p
    where p.oid = 'public.store_profiles(uuid[])'::regprocedure
  ),
  'store_profiles returns no address, store code, POS id or raw payload'
);

select is(
  (select count(*)::int from fixture f cross join lateral public.store_profiles(array[]::uuid[])),
  0,
  'store_profiles returns nothing for an empty store list'
);

select results_eq(
  $$
    select h.holiday_date, h.name, h.kind
    from fixture f
    cross join lateral public.holiday_calendar(f.both_stores, '2031-01-01', '2031-12-31') h
  $$,
  $$
    values
      ('2031-02-01'::date, 'Fixture store anniversary'::text, 'custom'::public.holiday_kind),
      ('2031-02-01', 'beta lower case', 'custom'),
      ('2031-04-30', 'Alpha day', 'custom'),
      ('2031-04-30', 'Fixture victory day', 'public'),
      ('2031-09-02', 'Fixture national day', 'public')
  $$,
  'holiday_calendar gives the global rows of the tenant''s country and the tenant''s own, once each, by date then name in byte order'
);

select results_eq(
  $$
    select h.holiday_date, h.name, h.kind
    from fixture f
    cross join lateral public.holiday_calendar(array[f.store_a], '2026-01-01', '2026-12-31') h
  $$,
  $$
    select d.holiday_date, d.name, d.kind
    from (
      select distinct h.holiday_date, h.name, h.kind
      from public.holidays h
      where h.tenant_id is null
        and h.country_code = 'VN'
        and h.holiday_date between '2026-01-01' and '2026-12-31'
    ) d
    order by d.holiday_date, d.name collate "C", d.kind
  $$,
  'holiday_calendar gives exactly the global calendar of the country over a year without the tenant''s own days'
);

select is(
  (select count(*)::int from fixture f cross join lateral public.holiday_calendar(array[f.other_store], '2031-01-01', '2031-12-31')),
  0,
  'the owner gets no holiday through another tenant''s store'
);

select throws_ok(
  $$ select * from public.holiday_calendar(array['33333333-3333-4333-8333-000000400021']::uuid[], '2031-01-01', '2032-02-05') $$,
  '22023',
  'holiday_calendar covers at most 400 days, not 401',
  'holiday_calendar refuses 401 days'
);

insert into fences select 'start', public.pack_fence(f.both_stores) from fixture f;

select is(
  (select public.pack_fence(f.both_stores) from fixture f),
  (select fence from fences where step = 'start'),
  'two fences with nothing changed in between are equal'
);

select ok(
  (select fence ~ '^[0-9a-f]{64}$' from fences where step = 'start'),
  'the fence is a lowercase hex SHA-256'
);

reset role;
insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, net_amount, paid_amount, synced_at)
select f.tenant_id, f.store_a, f.account_id, 'PACK-LIVE-1', now(), current_date - 1, 40000, 40000, 40000, clock_timestamp()
from fixture f;
set local role authenticated;
insert into fences select 'invoice', public.pack_fence(f.both_stores) from fixture f;

reset role;
insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, net_amount, paid_amount, synced_at)
select f.tenant_id, f.store_a, f.account_id, 'PACK-LIVE-1', now(), current_date - 1, 45000, 45000, 45000, clock_timestamp()
from fixture f
on conflict (store_id, external_id) do update
set gross_amount = excluded.gross_amount, net_amount = excluded.net_amount, paid_amount = excluded.paid_amount, synced_at = excluded.synced_at;
set local role authenticated;
insert into fences select 'upsert', public.pack_fence(f.both_stores) from fixture f;

reset role;
insert into public.analytics_refreshes (tenant_id, from_date, to_date, started_at, finished_at, rows)
select f.tenant_id, current_date - 1, current_date - 1, clock_timestamp(), clock_timestamp(), 0
from fixture f;
set local role authenticated;
insert into fences select 'refresh', public.pack_fence(f.both_stores) from fixture f;

reset role;
insert into public.sync_checks (tenant_id, store_id, business_date, is_matched, checked_at)
select f.tenant_id, f.store_b, current_date - 1, true, clock_timestamp()
from fixture f;
set local role authenticated;
insert into fences select 'sync_check', public.pack_fence(f.both_stores) from fixture f;

reset role;
insert into public.item_costs (tenant_id, store_id, item_external_id, cost_amount, effective_from)
select f.tenant_id, null, 'DRINK-1-M', 12000, '2025-01-01'
from fixture f;
set local role authenticated;
insert into fences select 'item_cost', public.pack_fence(f.both_stores) from fixture f;

reset role;
insert into public.targets (tenant_id, store_id, period_kind, period_start, net_target_amount)
select f.tenant_id, f.store_b, 'month', '2025-05-01', 9000000
from fixture f;
set local role authenticated;
insert into fences select 'target', public.pack_fence(f.both_stores) from fixture f;

reset role;
insert into public.item_type_roles (tenant_id, pos_account_id, item_type_external_id, role)
select f.tenant_id, f.account_id, 'TYPE-TOPPING', 'topping'
from fixture f;
set local role authenticated;
insert into fences select 'role_mapping', public.pack_fence(f.both_stores) from fixture f;

reset role;
insert into public.holidays (tenant_id, country_code, holiday_date, name, kind)
select f.tenant_id, 'VN', '2031-06-01', 'Fixture fence day', 'custom'
from fixture f;
set local role authenticated;
insert into fences select 'tenant_holiday', public.pack_fence(f.both_stores) from fixture f;

reset role;
insert into public.report_settings (tenant_id, peak_hours)
select f.tenant_id, 4
from fixture f;
set local role authenticated;
insert into fences select 'report_settings', public.pack_fence(f.both_stores) from fixture f;

reset role;
update public.stores
set opening_hours = '{"mon": [["08:00", "21:00"]]}'::jsonb
where id = (select store_b from fixture);
set local role authenticated;
insert into fences select 'opening_hours', public.pack_fence(f.both_stores) from fixture f;

select results_eq(
  $$
    select c.step, c.fence <> p.fence
    from (values
      (1, 'invoice', 'start'), (2, 'upsert', 'invoice'), (3, 'refresh', 'upsert'), (4, 'sync_check', 'refresh'),
      (5, 'item_cost', 'sync_check'), (6, 'target', 'item_cost'), (7, 'role_mapping', 'target'),
      (8, 'tenant_holiday', 'role_mapping'), (9, 'report_settings', 'tenant_holiday'), (10, 'opening_hours', 'report_settings')
    ) as s (position, step, previous)
    join fences c on c.step = s.step
    join fences p on p.step = s.previous
    order by s.position
  $$,
  $$
    values
      ('invoice'::text, true), ('upsert', true), ('refresh', true), ('sync_check', true), ('item_cost', true),
      ('target', true), ('role_mapping', true), ('tenant_holiday', true), ('report_settings', true), ('opening_hours', true)
  $$,
  'every watched change moves the fence: a live invoice and its upsert, a refresh, a sync check, a cost, a target, a role mapping, a tenant holiday, report settings and opening hours'
);

select is(
  (select count(distinct fence)::int from fences),
  11,
  'no two fences of the sequence are equal'
);

set local request.jwt.claims to '{"sub": "33333333-3333-4333-8333-000000402002", "role": "authenticated"}';

select results_eq(
  $$
    select r.label, r.store_id
    from fixture f
    cross join lateral public.store_profiles(array[f.store_a, f.store_b, f.store_c]) r
  $$,
  $$ select 'S1'::text, store_a from fixture $$,
  'a store-limited manager gets a profile of the own store only, ranked among the stores the manager sees'
);

select results_eq(
  $$
    select w.range_index, w.metric_id, w.value
    from fixture f, window_args a
    cross join lateral public.metric_windows(f.both_stores, a.metric_ids, a.from_dates, a.to_dates) w
  $$,
  $$ select o.range_index, o.metric_id, o.value from owner_store_a o join trackable t on t.metric_id = o.metric_id order by o.range_index, t.id_position $$,
  'a store-limited manager asking for both stores gets the values of the own store'
);

select results_eq(
  $$
    select h.holiday_date, h.name
    from fixture f
    cross join lateral public.holiday_calendar(f.both_stores, '2031-01-01', '2031-12-31') h
  $$,
  $$
    values
      ('2031-02-01'::date, 'Fixture store anniversary'::text), ('2031-02-01', 'beta lower case'), ('2031-04-30', 'Alpha day'),
      ('2031-04-30', 'Fixture victory day'), ('2031-06-01', 'Fixture fence day'), ('2031-09-02', 'Fixture national day')
  $$,
  'a store-limited manager gets the tenant''s calendar'
);

select ok(
  (select f.fence ~ '^[0-9a-f]{64}$' and f.fence <> (select fence from fences where step = 'opening_hours') from fixture x cross join lateral (select public.pack_fence(x.both_stores) as fence) f),
  'a store-limited manager gets a fence over the own store only'
);

set local request.jwt.claims to '{"sub": "33333333-3333-4333-8333-000000402003", "role": "authenticated"}';

select results_eq(
  $$
    select r.label, r.store_id
    from fixture f
    cross join lateral public.store_profiles(f.both_stores) r
  $$,
  $$ select v.label, v.store_id from fixture f cross join lateral (values ('S3'::text, f.store_a), ('S1', f.store_b)) as v (label, store_id) $$,
  'the publisher reads the profiles and the labels of the stores'
);

select ok(
  (
    select count(*) = 54 and bool_and(w.value is null)
    from fixture f, window_args a
    cross join lateral public.metric_windows(f.both_stores, a.metric_ids, a.from_dates, a.to_dates) w
  ),
  'the publisher gets every metric window without a value'
);

select is(
  (select count(*)::int from fixture f cross join lateral public.holiday_calendar(f.both_stores, '2031-01-01', '2031-12-31')),
  6,
  'the publisher reads the calendar'
);

select ok(
  (select public.pack_fence(f.both_stores) ~ '^[0-9a-f]{64}$' from fixture f),
  'the publisher gets a fence without a privilege error'
);

set local request.jwt.claims to '{"sub": "33333333-3333-4333-8333-000000402004", "role": "authenticated"}';

select is(
  (select count(*)::int from fixture f cross join lateral public.store_profiles(f.both_stores)),
  0,
  'another tenant''s owner gets no profile of the stores'
);

select ok(
  (
    select count(*) = 54 and bool_and(w.value is null)
    from fixture f, window_args a
    cross join lateral public.metric_windows(f.both_stores, a.metric_ids, a.from_dates, a.to_dates) w
  ),
  'another tenant''s owner gets no value of the stores'
);

select results_eq(
  $$
    select h.holiday_date, h.name
    from fixture f
    cross join lateral public.holiday_calendar(array[f.other_store, f.store_a], '2031-01-01', '2031-12-31') h
  $$,
  $$
    values ('2031-03-03'::date, 'Other tenant day'::text), ('2031-04-30', 'Fixture victory day'), ('2031-09-02', 'Fixture national day')
  $$,
  'another tenant''s owner gets the global days and the own tenant''s days only'
);

select is(
  (select count(*)::int from fixture f cross join lateral public.holiday_calendar(f.both_stores, '2031-01-01', '2031-12-31')),
  0,
  'another tenant''s owner gets no holiday through stores the owner cannot see'
);

select ok(
  (
    select public.pack_fence(f.both_stores) = public.pack_fence(array[]::uuid[])
    from fixture f
  ),
  'another tenant''s owner gets the fence of no store'
);

select results_eq(
  $$
    select r.label, r.store_id
    from fixture f
    cross join lateral public.store_profiles(array[f.other_store]) r
  $$,
  $$ select 'S1'::text, other_store from fixture $$,
  'another tenant''s owner labels the own store'
);

reset role;
set local role anon;

select throws_ok(
  $$ select * from public.store_profiles(array['33333333-3333-4333-8333-000000400021']::uuid[]) $$,
  '42501',
  null,
  'anon calling store_profiles is refused'
);

select throws_ok(
  $$ select * from public.metric_windows(array['33333333-3333-4333-8333-000000400021']::uuid[], array['net_revenue'], array['2025-03-01']::date[], array['2025-03-28']::date[]) $$,
  '42501',
  null,
  'anon calling metric_windows is refused'
);

select throws_ok(
  $$ select * from public.holiday_calendar(array['33333333-3333-4333-8333-000000400021']::uuid[], '2031-01-01', '2031-12-31') $$,
  '42501',
  null,
  'anon calling holiday_calendar is refused'
);

select throws_ok(
  $$ select public.pack_fence(array['33333333-3333-4333-8333-000000400021']::uuid[]) $$,
  '42501',
  null,
  'anon calling pack_fence is refused'
);

select throws_ok(
  $$ select * from public.export_control_totals(array['33333333-3333-4333-8333-000000400021']::uuid[], '2025-03-01', '2025-03-31') $$,
  '42501',
  null,
  'anon calling export_control_totals is refused'
);

select * from finish();
rollback;
