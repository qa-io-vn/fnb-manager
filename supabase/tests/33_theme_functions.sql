begin;
select plan(60);

create temp table fixture as
select
  '77777777-7777-4777-8777-000000000001'::uuid as tenant_id,
  '77777777-7777-4777-8777-000000000011'::uuid as account_id,
  '77777777-7777-4777-8777-000000000021'::uuid as split_store,
  '77777777-7777-4777-8777-000000000022'::uuid as overnight_store,
  '77777777-7777-4777-8777-000000000023'::uuid as early_store,
  '77777777-7777-4777-8777-000000000024'::uuid as tie_store,
  '77777777-7777-4777-8777-000000000025'::uuid as bare_store,
  '2025-03-01'::date as week_from,
  '2025-03-07'::date as week_to;

insert into public.tenants (id, slug, name)
select tenant_id, 'theme-pgtap-functions', 'Theme Functions' from fixture;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_id, tenant_id, 'mock', 'theme-pgtap-functions', 'Theme Functions POS' from fixture;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name, business_day_start_minutes, opening_hours, seat_count)
select split_store, tenant_id, account_id, 'theme-split', 'Split Store', 0,
  jsonb_build_object(
    'mon', '[["07:00","11:00"],["13:00","22:00"]]'::jsonb, 'tue', '[["07:00","11:00"],["13:00","22:00"]]'::jsonb,
    'wed', '[["07:00","11:00"],["13:00","22:00"]]'::jsonb, 'thu', '[["07:00","11:00"],["13:00","22:00"]]'::jsonb,
    'fri', '[["07:00","11:00"],["13:00","22:00"]]'::jsonb, 'sat', '[["07:00","11:00"],["13:00","22:00"]]'::jsonb,
    'sun', '[["07:00","11:00"],["13:00","22:00"]]'::jsonb
  ), 30
from fixture
union all
select overnight_store, tenant_id, account_id, 'theme-overnight', 'Overnight Store', 0,
  jsonb_build_object(
    'mon', '[["18:00","02:00"]]'::jsonb, 'tue', '[["18:00","02:00"]]'::jsonb, 'wed', '[["18:00","02:00"]]'::jsonb,
    'thu', '[["18:00","02:00"]]'::jsonb, 'fri', '[["18:00","02:00"]]'::jsonb, 'sat', '[["18:00","02:00"]]'::jsonb,
    'sun', '[["18:00","02:00"]]'::jsonb
  ), null
from fixture
union all
select early_store, tenant_id, account_id, 'theme-early', 'Early Store', 300, null, null from fixture
union all
select tie_store, tenant_id, account_id, 'theme-tie', 'Tie Store', 0, null, null from fixture
union all
select bare_store, tenant_id, account_id, 'theme-bare', 'Bare Store', 0, null, null from fixture;

insert into public.agg_daily_sales (tenant_id, store_id, business_date, invoices, gross_amount, net_amount, paid_amount, cash_amount, items_sold)
select f.tenant_id, s.store_id, d::date, s.invoices, s.net_amount, s.net_amount, s.net_amount, s.net_amount / 2, s.invoices * 1.5
from fixture f
cross join lateral (
  values
    (f.split_store, 20, 1000000::numeric),
    (f.overnight_store, 10, 500000::numeric),
    (f.bare_store, 4, 80000::numeric)
) as s (store_id, invoices, net_amount)
cross join generate_series(f.week_from, f.week_to, interval '1 day') as d;

insert into public.agg_hourly_sales (tenant_id, store_id, business_date, hour_local, invoices, net_amount)
select f.tenant_id, f.split_store, h.business_date, h.hour_local, h.invoices, h.net_amount
from fixture f
cross join lateral (
  values
    ('2025-03-03'::date, 8, 2, 100000::numeric),
    ('2025-03-03'::date, 9, 1, 50000::numeric),
    ('2025-03-03'::date, 11, 4, 300000::numeric),
    ('2025-03-03'::date, 12, 3, 200000::numeric),
    ('2025-03-03'::date, 14, 1, 20000::numeric),
    ('2025-03-08'::date, 8, 1, 50000::numeric),
    ('2025-03-08'::date, 12, 5, 400000::numeric)
) as h (business_date, hour_local, invoices, net_amount)
union all
select f.tenant_id, f.early_store, '2025-03-04'::date, h.hour_local, h.invoices, h.net_amount
from fixture f
cross join lateral (values (23, 2, 90000::numeric), (1, 1, 30000::numeric)) as h (hour_local, invoices, net_amount)
union all
select f.tenant_id, f.tie_store, '2025-03-05'::date, h.hour_local, 1, 100000
from fixture f
cross join generate_series(10, 11) as h (hour_local);

select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('range_totals', 'opening_productivity', 'hour_profile')
      and not p.prosecdef
      and p.provolatile = 's'
      and p.proconfig = array['search_path=""']
  ),
  3,
  'range_totals, opening_productivity and hour_profile are stable security invoker functions with an empty search_path'
);

select is(
  (
    select array_agg(p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')' order by p.proname)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('range_totals', 'opening_productivity', 'hour_profile')
  ),
  array[
    'hour_profile(store_ids uuid[], from_date date, to_date date, peak_hours integer, dead_hour_ratio numeric, busy_hour_ratio numeric)',
    'opening_productivity(store_ids uuid[], from_date date, to_date date)',
    'range_totals(store_ids uuid[], from_dates date[], to_dates date[])'
  ],
  'each theme function has one signature with the documented argument types'
);

select results_eq(
  $$
    select r.days_with_data, r.invoices, r.net_amount, r.cash_share, r.avg_ticket, r.items_per_ticket
    from public.range_totals(
      array['77777777-7777-4777-8777-000000000021', '77777777-7777-4777-8777-000000000022']::uuid[],
      array['2025-03-01', '2025-03-03']::date[],
      array['2025-03-07', '2025-03-04']::date[]
    ) r
    where r.store_id is null
    order by r.range_index
  $$,
  $$
    select t.days_with_data, t.invoices, t.net_amount, t.cash_share, t.avg_ticket, t.items_per_ticket
    from (
      values (1, '2025-03-01'::date, '2025-03-07'::date), (2, '2025-03-03'::date, '2025-03-04'::date)
    ) as w (position, from_date, to_date)
    cross join lateral app.period_totals(
      array['77777777-7777-4777-8777-000000000021', '77777777-7777-4777-8777-000000000022']::uuid[],
      w.from_date,
      w.to_date
    ) t
    order by w.position
  $$,
  'range_totals gives each range the totals of app.period_totals'
);

select results_eq(
  $$
    select r.store_id, r.from_date, r.to_date, r.net_amount, r.invoices, r.discount_rate
    from public.range_totals(
      array['77777777-7777-4777-8777-000000000021', '77777777-7777-4777-8777-000000000022']::uuid[],
      array['2025-03-01', '2025-02-01']::date[],
      array['2025-03-07', '2025-02-07']::date[]
    ) r
    order by r.range_index, r.store_id nulls first
  $$,
  $$
    select c.store_id, c.from_date, c.to_date, c.net_amount, c.invoices, c.discount_rate
    from public.period_compare_by_store(
      array['77777777-7777-4777-8777-000000000021', '77777777-7777-4777-8777-000000000022']::uuid[],
      'month',
      '2025-03-07'
    ) c
    where c.period in ('current', 'previous')
    order by case c.period when 'current' then 1 else 2 end, c.store_id nulls first
  $$,
  'with the ranges of a month anchor, range_totals equals the non-baseline rows of period_compare_by_store'
);

select is(
  (
    select array[count(*) filter (where r.store_id is null), count(*) filter (where r.store_id is not null)]
    from public.range_totals(
      array['77777777-7777-4777-8777-000000000021', '77777777-7777-4777-8777-000000000022']::uuid[],
      array['2025-01-01', '2025-01-02', '2025-01-03', '2025-01-04', '2025-01-05', '2025-01-06']::date[],
      array['2025-03-01', '2025-03-02', '2025-03-03', '2025-03-04', '2025-03-05', '2025-03-06']::date[]
    ) r
  ),
  array[6::bigint, 12::bigint],
  'six ranges give a block for all stores and one row per store each'
);

select throws_ok(
  $$
    select * from public.range_totals(
      array['77777777-7777-4777-8777-000000000021']::uuid[],
      array['2025-01-01', '2025-01-02', '2025-01-03', '2025-01-04', '2025-01-05', '2025-01-06', '2025-01-07']::date[],
      array['2025-03-01', '2025-03-02', '2025-03-03', '2025-03-04', '2025-03-05', '2025-03-06', '2025-03-07']::date[]
    )
  $$,
  '22023',
  null,
  'range_totals refuses a seventh range'
);

select throws_ok(
  $$ select * from public.range_totals(array['77777777-7777-4777-8777-000000000021']::uuid[], array['2025-01-01']::date[], array['2025-01-02', '2025-01-03']::date[]) $$,
  '22023',
  null,
  'range_totals refuses start and end lists of different lengths'
);

select throws_ok(
  $$ select * from public.range_totals(array['77777777-7777-4777-8777-000000000021']::uuid[], array['2022-01-01']::date[], array['2025-01-05']::date[]) $$,
  '22023',
  null,
  'range_totals refuses a range longer than 1,100 days'
);

select is(
  (select count(*)::int from public.range_totals('{}'::uuid[], array['2025-03-01']::date[], array['2025-03-07']::date[])),
  0,
  'range_totals returns no rows for no stores'
);

select results_eq(
  $$
    select o.days_with_sales, o.opening_minutes, o.seat_count, o.seat_minutes, o.sales_per_opening_hour, o.invoices_per_opening_hour, o.revpash
    from public.opening_productivity(
      array['77777777-7777-4777-8777-000000000021', '77777777-7777-4777-8777-000000000022']::uuid[],
      '2025-03-01',
      '2025-03-07'
    ) o
  $$,
  $$
    values
      (14, 8820::bigint, null::integer, null::bigint, 71428.57::numeric, 1.4286::numeric, null::numeric),
      (7, 5460::bigint, 30, 163800::bigint, 76923.08, 1.5385, 2564.10),
      (7, 3360::bigint, null::integer, null::bigint, 62500.00, 1.2500, null::numeric)
  $$,
  'opening_productivity counts split and overnight hours, seats and RevPASH for all stores and each store'
);

select is(
  (
    select array[o.sales_per_opening_hour, o.invoices_per_opening_hour]
    from public.opening_productivity(
      array['77777777-7777-4777-8777-000000000021', '77777777-7777-4777-8777-000000000022']::uuid[],
      '2025-03-01',
      '2025-03-07'
    ) o
    where o.store_id is null
  ),
  array[
    public.metric_value(array['77777777-7777-4777-8777-000000000021', '77777777-7777-4777-8777-000000000022']::uuid[], 'sales_per_opening_hour', '2025-03-01', '2025-03-07'),
    public.metric_value(array['77777777-7777-4777-8777-000000000021', '77777777-7777-4777-8777-000000000022']::uuid[], 'invoices_per_opening_hour', '2025-03-01', '2025-03-07')
  ],
  'opening_productivity equals metric_value for both per-opening-hour metrics'
);

select is(
  (
    select array[o.opening_minutes is null, o.sales_per_opening_hour is null, o.revpash is null, o.days_with_sales = 7]
    from public.opening_productivity(array['77777777-7777-4777-8777-000000000025']::uuid[], '2025-03-01', '2025-03-07') o
    where o.store_id is null
  ),
  array[true, true, true, true],
  'a store without opening hours has no per-hour figures'
);

select is(
  (
    select array[o.days_with_sales::numeric, o.invoices::numeric, o.net_amount, o.sales_per_opening_hour]
    from public.opening_productivity(array['77777777-7777-4777-8777-000000000021']::uuid[], '2024-03-01', '2024-03-07') o
    where o.store_id is null
  ),
  array[0::numeric, null, null, null],
  'a range without sales has no totals'
);

select results_eq(
  $$
    select p.hour_local, p.hour_position, p.invoices, p.net_amount, p.avg_net_amount, p.level
    from public.hour_profile(array['77777777-7777-4777-8777-000000000021']::uuid[], '2025-03-01', '2025-03-08') p
    where p.scope = 'all'
  $$,
  $$
    values
      (8::smallint, 8::smallint, 3::bigint, 150000::numeric, 75000.00::numeric, 'peak'),
      (9::smallint, 9::smallint, 1::bigint, 50000::numeric, 25000.00::numeric, 'dead'),
      (10::smallint, 10::smallint, 0::bigint, 0::numeric, 0.00::numeric, 'dead'),
      (11::smallint, 11::smallint, 4::bigint, 300000::numeric, 150000.00::numeric, 'peak'),
      (12::smallint, 12::smallint, 8::bigint, 600000::numeric, 300000.00::numeric, 'peak'),
      (13::smallint, 13::smallint, 0::bigint, 0::numeric, 0.00::numeric, 'dead'),
      (14::smallint, 14::smallint, 1::bigint, 20000::numeric, 10000.00::numeric, 'dead'),
      (null::smallint, null::smallint, 17::bigint, 1120000::numeric, 560000.00::numeric, null)
  $$,
  'the all scope fills empty hours inside the open span, marks the three largest hours as peak and quiet hours as dead'
);

select is(
  (
    select array[p.peak_share, p.dead_share, p.net_share]
    from public.hour_profile(array['77777777-7777-4777-8777-000000000021']::uuid[], '2025-03-01', '2025-03-08') p
    where p.scope = 'all' and p.hour_local is null
  ),
  array[0.937500, 0.062500, 1.000000]::numeric[],
  'the all summary carries the peak and dead shares of net'
);

select results_eq(
  $$
    select p.scope, p.hour_local, p.level
    from public.hour_profile(array['77777777-7777-4777-8777-000000000021']::uuid[], '2025-03-01', '2025-03-08') p
    where p.scope in ('weekdays', 'weekend') and p.hour_local is not null
  $$,
  $$
    values
      ('weekdays', 8::smallint, 'busy'), ('weekdays', 9::smallint, 'normal'), ('weekdays', 10::smallint, 'quiet'),
      ('weekdays', 11::smallint, 'busy'), ('weekdays', 12::smallint, 'busy'), ('weekdays', 13::smallint, 'quiet'),
      ('weekdays', 14::smallint, 'normal'),
      ('weekend', 8::smallint, 'normal'), ('weekend', 9::smallint, 'quiet'), ('weekend', 10::smallint, 'quiet'),
      ('weekend', 11::smallint, 'quiet'), ('weekend', 12::smallint, 'busy')
  $$,
  'weekdays and the weekend are levelled by invoices per day against the busy and quiet ratios'
);

select results_eq(
  $$
    select p.weekday, p.days_with_data, p.net_amount, p.net_share
    from public.hour_profile(array['77777777-7777-4777-8777-000000000021']::uuid[], '2025-03-01', '2025-03-08') p
    where p.scope = 'weekday'
  $$,
  $$ values (1::smallint, 1, 670000::numeric, 0.598214::numeric), (6::smallint, 1, 450000::numeric, 0.401786::numeric) $$,
  'weekday rows carry each weekday''s share of the range'
);

select results_eq(
  $$
    select p.hour_local, p.invoices, p.net_amount
    from public.hour_profile(array['77777777-7777-4777-8777-000000000021']::uuid[], '2025-03-01', '2025-03-08') p
    where p.scope = 'all' and p.hour_local is not null and p.net_amount <> 0
    order by p.hour_local
  $$,
  $$
    select h.hour_local, sum(h.invoices)::bigint, sum(h.net_amount)
    from public.hour_weekday_heatmap(array['77777777-7777-4777-8777-000000000021']::uuid[], '2025-03-01', '2025-03-08') h
    group by h.hour_local
    order by h.hour_local
  $$,
  'every hour of the all scope equals the heatmap summed over the weekdays'
);

select results_eq(
  $$
    select p.weekday, p.invoices, p.net_amount
    from public.hour_profile(array['77777777-7777-4777-8777-000000000021']::uuid[], '2025-03-01', '2025-03-08') p
    where p.scope = 'weekday'
    order by p.weekday
  $$,
  $$
    select h.weekday, sum(h.invoices)::bigint, sum(h.net_amount)
    from public.hour_weekday_heatmap(array['77777777-7777-4777-8777-000000000021']::uuid[], '2025-03-01', '2025-03-08') h
    group by h.weekday
    order by h.weekday
  $$,
  'every weekday row equals the heatmap summed over the hours'
);

select results_eq(
  $$
    select p.hour_local, p.hour_position, p.net_amount
    from public.hour_profile(array['77777777-7777-4777-8777-000000000023']::uuid[], '2025-03-04', '2025-03-04') p
    where p.scope = 'all' and p.hour_local is not null
  $$,
  $$ values (23::smallint, 18::smallint, 90000::numeric), (0::smallint, 19::smallint, 0::numeric), (1::smallint, 20::smallint, 30000::numeric) $$,
  'hours after midnight follow the evening hours when the business day starts at 05:00'
);

select is(
  (
    select array_agg(p.level order by p.hour_position)
    from public.hour_profile(array['77777777-7777-4777-8777-000000000024']::uuid[], '2025-03-05', '2025-03-05', 1) p
    where p.scope = 'all' and p.hour_local is not null
  ),
  array['peak', 'normal'],
  'a tie for the last peak hour goes to the earlier hour'
);

select is(
  (
    select array[count(*) filter (where p.level = 'peak'), max(p.peak_hours_used)]
    from public.hour_profile(array['77777777-7777-4777-8777-000000000021']::uuid[], '2025-03-01', '2025-03-08', 4, 0.3, 2.0) p
  ),
  array[4::bigint, 4::bigint],
  'explicit thresholds win over the tenant settings and are reported as used'
);

insert into public.report_settings (tenant_id, peak_hours, dead_hour_ratio, busy_hour_ratio)
select tenant_id, 2, 0.3, 2.0 from fixture;

select is(
  (
    select array[
      count(*) filter (where p.level = 'peak'),
      count(*) filter (where p.level = 'dead'),
      count(*) filter (where p.level = 'busy')
    ]
    from public.hour_profile(array['77777777-7777-4777-8777-000000000021']::uuid[], '2025-03-01', '2025-03-08') p
  ),
  array[2::bigint, 3::bigint, 2::bigint],
  'without arguments hour_profile applies the tenant''s report settings'
);

select is(
  (
    select array[max(p.peak_hours_used)::numeric, max(p.dead_hour_ratio_used), max(p.busy_hour_ratio_used)]
    from public.hour_profile(array['77777777-7777-4777-8777-000000000021']::uuid[], '2025-03-01', '2025-03-08') p
  ),
  array[2, 0.300, 2.000]::numeric[],
  'the used columns carry the tenant''s thresholds'
);

delete from public.report_settings where tenant_id = (select tenant_id from fixture);

select throws_ok(
  $$ select * from public.hour_profile(array['77777777-7777-4777-8777-000000000021']::uuid[], '2024-01-01', '2025-03-08') $$,
  '22023',
  null,
  'hour_profile refuses more than 400 days'
);

select throws_ok(
  $$ select * from public.hour_profile(array['77777777-7777-4777-8777-000000000021']::uuid[], '2025-03-01', '2025-03-08', 7) $$,
  '22023',
  null,
  'hour_profile refuses more than six peak hours'
);

select throws_ok(
  $$ select * from public.hour_profile(array['77777777-7777-4777-8777-000000000021']::uuid[], '2025-03-01', '2025-03-08', null, 0.95) $$,
  '22023',
  null,
  'hour_profile refuses a quiet-hour ratio above 0.9'
);

select is(
  (select count(*)::int from public.hour_profile(array['77777777-7777-4777-8777-000000000021']::uuid[], '2024-03-01', '2024-03-08')),
  0,
  'hour_profile returns no rows for a range without hourly sales'
);

select is(
  (select count(*)::int from public.hour_profile('{}'::uuid[], '2025-03-01', '2025-03-08')),
  0,
  'hour_profile returns no rows for no stores'
);

select ok(
  (
    select bool_and(p.hour_local is not null)
    from public.hour_profile(array['77777777-7777-4777-8777-000000000021']::uuid[], '2025-03-01', '2025-03-08') p
    where p.scope in ('all', 'weekdays', 'weekend') and p.hour_position is not null
  ),
  'every hour row carries its local hour'
);

select is(
  (
    select array_agg(p.scope || coalesce(':' || p.hour_position, '') || coalesce(':w' || p.weekday, '') order by o)
    from public.hour_profile(array['77777777-7777-4777-8777-000000000024']::uuid[], '2025-03-05', '2025-03-05') with ordinality as p (
      scope, weekday, hour_local, hour_position, days_with_data, invoices, net_amount, avg_net_amount, avg_invoices,
      net_share, level, peak_share, dead_share, peak_hours_used, dead_hour_ratio_used, busy_hour_ratio_used, o
    )
  ),
  array['all:10', 'all:11', 'all', 'weekdays:10', 'weekdays:11', 'weekdays', 'weekday:w3'],
  'rows come in scope order with each summary after its hours and weekdays last'
);

select ok(
  (
    select bool_and(p.level is null)
    from public.hour_profile(array['77777777-7777-4777-8777-000000000021']::uuid[], '2025-03-01', '2025-03-08') p
    where p.hour_local is null
  ),
  'summary and weekday rows have no level'
);

insert into public.item_types (tenant_id, pos_account_id, external_id, name)
select f.tenant_id, f.account_id, t.external_id, t.name
from fixture f
cross join lateral (
  values ('T-DRINK', 'Trà sữa'), ('T-TOP', 'Topping'), ('T-SNACK', 'Đồ ăn vặt'), ('T-NEW', 'Món mới')
) as t (external_id, name);

insert into public.item_type_roles (tenant_id, pos_account_id, item_type_external_id, role)
select f.tenant_id, f.account_id, r.type_id, r.role::public.item_type_role
from fixture f
cross join lateral (values ('T-DRINK', 'drink'), ('T-TOP', 'topping'), ('T-SNACK', 'snack')) as r (type_id, role);

insert into public.agg_item_daily (
  tenant_id, store_id, business_date, item_external_id, item_name, base_name, size_label,
  item_type_external_id, item_type_name, quantity, net_amount, invoices
)
select f.tenant_id, i.store_id, d::date, i.item_id, i.item_name, i.item_name, null, i.type_id, i.type_name, i.quantity, i.net_amount, i.quantity::integer
from fixture f
cross join generate_series('2025-03-01'::date, '2025-03-28'::date, interval '1 day') as d
cross join lateral (
  values
    (f.split_store, 'D1', 'Trà đào', 'T-DRINK', 'Trà sữa', 10::numeric, 400000::numeric),
    (f.split_store, 'D2', 'Trà vải', 'T-DRINK', 'Trà sữa', 4::numeric, 120000::numeric),
    (f.split_store, 'D3', 'Sữa tươi', 'T-DRINK', 'Trà sữa', 1::numeric, 45000::numeric),
    (f.split_store, 'S1', 'Hướng dương', 'T-SNACK', 'Đồ ăn vặt', 3::numeric, 45000::numeric),
    (f.split_store, 'N1', 'Bánh flan', 'T-NEW', 'Món mới', 2::numeric, 50000::numeric),
    (f.overnight_store, 'D1', 'Trà đào', 'T-DRINK', 'Trà sữa', 5::numeric, 200000::numeric)
) as i (store_id, item_id, item_name, type_id, type_name, quantity, net_amount);

select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname, p.proname) in (
        ('public', 'menu_engineering'), ('public', 'item_margins'), ('public', 'item_attach'),
        ('app', 'item_cost_periods'), ('app', 'effective_item_types')
      )
      and not p.prosecdef
      and p.provolatile = 's'
      and p.proconfig = array['search_path=""']
  ),
  5,
  'the menu functions and their helpers are stable security invoker functions with an empty search_path'
);

select is(
  (
    select array_agg(p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')' order by p.proname)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('menu_engineering', 'item_margins', 'item_attach')
  ),
  array[
    'item_attach(store_ids uuid[], from_date date, to_date date)',
    'item_margins(store_ids uuid[], from_date date, to_date date)',
    'menu_engineering(store_ids uuid[], as_of_date date, window_days integer, popularity_factor numeric, low_sample_items integer)'
  ],
  'each menu function has one signature with the documented argument types'
);

select results_eq(
  $$
    select m.role, m.item_external_id, m.item_name, m.quantity, m.net_amount, m.menu_mix_pct, m.popularity_threshold_pct,
      m.avg_unit_price, m.unit_cost, m.margin_axis, m.margin_threshold, m.provisional, m.low_sample, m.menu_class
    from public.menu_engineering(array['77777777-7777-4777-8777-000000000021']::uuid[], '2025-03-28') m
    order by m.role, m.item_external_id
  $$,
  $$
    select m.role, m.item_external_id, m.item_name, m.quantity, m.net_amount, m.menu_mix_pct, m.popularity_threshold_pct,
      m.avg_unit_price, m.unit_cost, m.margin_axis, m.margin_threshold, m.provisional, m.low_sample, m.menu_class
    from public.menu_matrix(array['77777777-7777-4777-8777-000000000021']::uuid[], '2025-03-28') m
    order by m.role, m.item_external_id
  $$,
  'with default settings, no override and no cost menu_engineering equals menu_matrix row for row'
);

select is(
  (
    select array_agg(
      m.item_external_id || ':' || m.role || ':' || m.menu_class || ':' || m.role_mapped || ':' || m.category_source || ':' || m.low_sample
      order by o
    )
    from public.menu_engineering(array['77777777-7777-4777-8777-000000000021']::uuid[], '2025-03-28') with ordinality as m (
      role, role_mapped, item_external_id, item_name, item_type_external_id, item_type_name, category_source, quantity, net_amount,
      menu_mix_pct, popularity_threshold_pct, avg_unit_price, unit_cost, margin_axis, margin_threshold, provisional, low_sample,
      menu_class, window_from, window_days_used, popularity_factor_used, low_sample_items_used, o
    )
  ),
  array[
    'D1:drink:star:true:pos:true',
    'D2:drink:plowhorse:true:pos:true',
    'D3:drink:puzzle:true:pos:true',
    'S1:snack:star:true:pos:true',
    'N1:other:star:false:pos:true'
  ],
  'rows come by role then quantity; an item whose type has no role is in other and not role-mapped'
);

select is(
  (
    select (m.popularity_threshold_pct, m.margin_threshold, m.provisional, m.window_from, m.window_days_used, m.popularity_factor_used, m.low_sample_items_used)
    from public.menu_engineering(array['77777777-7777-4777-8777-000000000021']::uuid[], '2025-03-28') m
    where m.item_external_id = 'D1'
  ),
  (23.333::numeric, 37666.67::numeric, true, '2025-03-01'::date, 28, 0.700::numeric, 10),
  'without a settings row the window is 28 days, the factor 0.7 and the minimum 10, and an uncosted role is placed on price'
);

insert into public.report_settings (tenant_id, menu_window_days, menu_popularity_factor, menu_low_sample_items)
select tenant_id, 14, 0.5, 2 from fixture;

select is(
  (
    select array_agg(m.item_external_id || ':' || m.quantity || ':' || m.menu_class || ':' || m.low_sample || ':' || m.popularity_threshold_pct order by m.role, m.item_external_id)
    from public.menu_engineering(array['77777777-7777-4777-8777-000000000021']::uuid[], '2025-03-28') m
  ),
  array['D1:140.000:star:false:16.667', 'D2:56.000:plowhorse:false:16.667', 'D3:14.000:puzzle:false:16.667', 'S1:42.000:star:true:50.000', 'N1:28.000:star:true:50.000'],
  'a tenant settings row sets the window, the popularity factor and the low-sample minimum'
);

select is(
  (
    select (m.window_from, m.window_days_used, m.popularity_factor_used, m.low_sample_items_used, m.low_sample)
    from public.menu_engineering(array['77777777-7777-4777-8777-000000000021']::uuid[], '2025-03-28', 21, 0.9, 3) m
    where m.item_external_id = 'D1'
  ),
  ('2025-03-08'::date, 21, 0.9::numeric, 3, false),
  'arguments win over the settings row'
);

delete from public.report_settings where tenant_id = (select tenant_id from fixture);

insert into public.item_category_overrides (tenant_id, pos_account_id, item_external_id, item_type_external_id)
select tenant_id, account_id, 'D3', 'T-SNACK' from fixture;

select is(
  (
    select array_agg(m.item_external_id || ':' || m.role || ':' || m.item_type_external_id || ':' || m.item_type_name || ':' || m.category_source || ':' || m.popularity_threshold_pct order by m.role, m.item_external_id)
    from public.menu_engineering(array['77777777-7777-4777-8777-000000000021']::uuid[], '2025-03-28') m
    where m.role in ('drink', 'snack')
  ),
  array[
    'D1:drink:T-DRINK:Trà sữa:pos:35.000',
    'D2:drink:T-DRINK:Trà sữa:pos:35.000',
    'D3:snack:T-SNACK:Đồ ăn vặt:override:35.000',
    'S1:snack:T-SNACK:Đồ ăn vặt:pos:35.000'
  ],
  'an override written in the transaction moves the item to the role of its new type at once'
);

select is(
  (
    select array_agg(i.item_external_id || ':' || i.item_type_external_id || ':' || i.role order by i.item_external_id)
    from public.item_margins(array['77777777-7777-4777-8777-000000000021']::uuid[], '2025-03-01', '2025-03-28') i
    where i.item_external_id in ('D2', 'D3')
  ),
  array['D2:T-DRINK:drink', 'D3:T-SNACK:snack'],
  'item_margins reports the effective type and role'
);

delete from public.item_category_overrides where tenant_id = (select tenant_id from fixture);

insert into public.item_costs (tenant_id, store_id, item_external_id, cost_amount, effective_from)
select f.tenant_id, c.store_id, c.item_id, c.amount, c.effective_from
from fixture f
cross join lateral (
  values
    (null::uuid, 'D1', 25000::numeric, '2025-01-01'::date),
    (f.split_store, 'D1', 30000::numeric, '2025-03-15'::date),
    (null::uuid, 'D1', 26000::numeric, '2025-03-20'::date),
    (null::uuid, 'D2', 20000::numeric, '2025-01-01'::date),
    (null::uuid, 'D3', 25000::numeric, '2025-01-01'::date),
    (null::uuid, 'S1', 8000::numeric, '2025-01-01'::date),
    (null::uuid, 'N1', 20000::numeric, '2025-01-01'::date)
) as c (store_id, item_id, amount, effective_from);

select is(
  (
    select array_agg(m.item_external_id || ':' || m.unit_cost || ':' || m.margin_axis || ':' || m.margin_threshold || ':' || m.provisional || ':' || m.menu_class order by m.item_external_id)
    from public.menu_engineering(array['77777777-7777-4777-8777-000000000021']::uuid[], '2025-03-28') m
    where m.role = 'drink'
  ),
  array[
    'D1:27500.00:12500.00:12333.33:false:star',
    'D2:20000.00:10000.00:12333.33:false:plowhorse',
    'D3:25000.00:20000.00:12333.33:false:puzzle'
  ],
  'each store-day takes the cost valid on its date, a store row winning over a newer tenant-wide row'
);

select is(
  (
    select count(*)::int
    from public.menu_engineering(array['77777777-7777-4777-8777-000000000021', '77777777-7777-4777-8777-000000000022']::uuid[], '2025-03-28') m
    join public.item_margins(array['77777777-7777-4777-8777-000000000021', '77777777-7777-4777-8777-000000000022']::uuid[], '2025-03-01', '2025-03-28') i
      using (item_external_id)
    where m.unit_cost is distinct from round(i.cost_amount / nullif(i.costed_quantity, 0), 2)
  ),
  0,
  'the menu unit cost equals the margins cost over the costed quantity for the same stores and days'
);

select is(
  (
    select (i.quantity, i.costed_quantity, i.cost_amount, i.unit_cost_latest, i.margin_amount, i.cost_coverage)
    from public.item_margins(array['77777777-7777-4777-8777-000000000021', '77777777-7777-4777-8777-000000000022']::uuid[], '2025-03-01', '2025-03-28') i
    where i.item_external_id = 'D1'
  ),
  (420::numeric, 420::numeric, 11245000.00::numeric, 30000::numeric, 5555000.00::numeric, 1.000000::numeric),
  'item_margins costs each store-day by its date and reads the latest cost at the first store'
);

select is(
  (
    select i.unit_cost_latest
    from public.item_margins(array['77777777-7777-4777-8777-000000000022', '77777777-7777-4777-8777-000000000021']::uuid[], '2025-03-01', '2025-03-28') i
    where i.item_external_id = 'D1'
  ),
  26000::numeric,
  'the latest cost follows the order of the requested stores'
);

delete from public.item_costs c using fixture f where c.tenant_id = f.tenant_id and c.item_external_id = 'D2';

select is(
  (
    select array_agg(m.item_external_id || ':' || coalesce(m.unit_cost::text, '-') || ':' || (m.margin_axis = m.avg_unit_price) || ':' || m.provisional order by m.item_external_id)
    from public.menu_engineering(array['77777777-7777-4777-8777-000000000021']::uuid[], '2025-03-28') m
    where m.role = 'drink'
  ),
  array['D1:27500.00:true:true', 'D2:-:true:true', 'D3:25000.00:true:true'],
  'one drink without a cost makes the role provisional and places every drink on price'
);

select is(
  (
    select (i.costed_quantity, i.cost_amount, i.margin_amount, i.margin_rate, i.cost_coverage, i.unit_cost_latest)
    from public.item_margins(array['77777777-7777-4777-8777-000000000021']::uuid[], '2025-03-01', '2025-03-28') i
    where i.item_external_id = 'D2'
  ),
  (0::numeric, null::numeric, null::numeric, null::numeric, 0.000000::numeric, null::numeric),
  'an item without any cost has a null cost, a null margin and no coverage'
);

insert into public.item_costs (tenant_id, store_id, item_external_id, cost_amount, effective_from)
select tenant_id, null, 'D2', 20000, '2025-03-15' from fixture;

select is(
  (
    select (i.costed_quantity, i.costed_net_amount, i.cost_amount, i.margin_amount, i.margin_rate, i.cost_coverage)
    from public.item_margins(array['77777777-7777-4777-8777-000000000021']::uuid[], '2025-03-01', '2025-03-28') i
    where i.item_external_id = 'D2'
  ),
  (56::numeric, 1680000::numeric, 1120000.00::numeric, 560000.00::numeric, 0.333333::numeric, 0.500000::numeric),
  'a tenant-wide cost starting mid-range costs only the days from its start'
);

select throws_ok(
  $$ select * from public.menu_engineering(array['77777777-7777-4777-8777-000000000021']::uuid[], '2025-03-28', 92) $$,
  '22023',
  'menu_engineering needs window_days between 7 and 91',
  'menu_engineering refuses a window of 92 days'
);

select throws_ok(
  $$ select * from public.item_margins(array['77777777-7777-4777-8777-000000000021']::uuid[], '2024-02-22', '2025-03-28') $$,
  '22023',
  null,
  'item_margins refuses a range of 401 days'
);

select throws_ok(
  $$ select * from public.item_attach(array['77777777-7777-4777-8777-000000000021']::uuid[], '2025-01-01', '2025-04-03') $$,
  '22023',
  null,
  'item_attach refuses a range of 93 days'
);

create temp table seed as
select
  '11111111-1111-4111-8111-111111111111'::uuid as tenant_id,
  '22222222-2222-4222-8222-000000000001'::uuid as tea_store,
  '22222222-2222-4222-8222-000000000002'::uuid as coffee_store,
  '33333333-3333-4333-8333-000000000001'::uuid as tea_account,
  array['22222222-2222-4222-8222-000000000001', '22222222-2222-4222-8222-000000000002']::uuid[] as both_stores,
  (a.anchor - 7)::date as from_date,
  (a.anchor - 1)::date as to_date
from (select max(i.business_date) + 1 as anchor from public.invoices i where i.tenant_id = '11111111-1111-4111-8111-111111111111') as a;

delete from public.item_category_overrides where tenant_id = (select tenant_id from seed);

update public.item_type_roles r
set role = 'topping'
from seed s
where r.pos_account_id = s.tea_account
  and r.item_type_external_id = 'type-04';

select app.refresh_analytics(s.tenant_id, s.from_date, s.to_date) from seed s;

select results_eq(
  $$
    select m.role, m.item_external_id, m.item_name, m.quantity, m.net_amount, m.menu_mix_pct, m.popularity_threshold_pct,
      m.avg_unit_price, m.unit_cost, m.margin_axis, m.margin_threshold, m.provisional, m.low_sample, m.menu_class
    from seed s cross join lateral public.menu_engineering(s.both_stores, s.to_date) m
    order by m.role, m.item_external_id
  $$,
  $$
    select m.role, m.item_external_id, m.item_name, m.quantity, m.net_amount, m.menu_mix_pct, m.popularity_threshold_pct,
      m.avg_unit_price, m.unit_cost, m.margin_axis, m.margin_threshold, m.provisional, m.low_sample, m.menu_class
    from seed s cross join lateral public.menu_matrix(s.both_stores, s.to_date) m
    order by m.role, m.item_external_id
  $$,
  'with costs in force before the window and two POS accounts mapping a type to different roles, menu_engineering equals menu_matrix'
);

select is(
  (
    select array_agg(m.item_external_id || ':' || m.role order by m.item_external_id, m.role)
    from seed s
    cross join lateral public.menu_engineering(array[s.coffee_store, s.tea_store], s.to_date) m
    where m.item_external_id = 'item-13'
  ),
  array['item-13:topping', 'item-13:snack'],
  'an item takes the role of each store''s POS account, so it appears once per role whatever the store order'
);

create temp table attach_summary as
select a.*
from seed s
cross join lateral public.item_attach(s.both_stores, s.from_date, s.to_date) a
where a.item_external_id is null;

select results_eq(
  $$ select drink_invoices::bigint, topping_base_invoices, topping_invoices, snack_base_invoices, snack_invoices from attach_summary $$,
  $$
    select
      sum(a.drink_invoices)::bigint,
      coalesce(sum(a.drink_invoices) filter (where a.attach_rate_topping is not null), 0)::bigint,
      coalesce(sum(a.topping_invoices) filter (where a.attach_rate_topping is not null), 0)::bigint,
      coalesce(sum(a.drink_invoices) filter (where a.attach_rate_snack is not null), 0)::bigint,
      coalesce(sum(a.snack_invoices) filter (where a.attach_rate_snack is not null), 0)::bigint
    from public.agg_attach_daily a, seed s
    where a.store_id = any (s.both_stores) and a.business_date between s.from_date and s.to_date
  $$,
  'the attach summary equals the attach aggregate over the measured store-days'
);

select is(
  (select (topping_rate, snack_rate) from attach_summary),
  (
    select (
      public.metric_value(s.both_stores, 'attach_rate_topping', s.from_date, s.to_date),
      public.metric_value(s.both_stores, 'attach_rate_snack', s.from_date, s.to_date)
    )
    from seed s
  ),
  'the attach rates equal metric_value'
);

select is(
  (
    select (a.topping_base_invoices, a.topping_rate, a.snack_base_invoices, a.snack_rate)
    from attach_summary a
  ),
  (
    select (tea.drink_invoices, tea.topping_rate, coffee.drink_invoices, coffee.snack_rate)
    from seed s
    cross join lateral public.item_attach(array[s.tea_store], s.from_date, s.to_date) tea
    cross join lateral public.item_attach(array[s.coffee_store], s.from_date, s.to_date) coffee
    where tea.item_external_id is null and coffee.item_external_id is null
  ),
  'a store whose account does not map a role neither dilutes nor feeds its rate'
);

select is(
  (
    select (a.topping_base_invoices, a.topping_invoices, a.topping_rate)
    from seed s
    cross join lateral public.item_attach(array[s.coffee_store], s.from_date, s.to_date) a
    where a.item_external_id is null
  ),
  (0::bigint, 0::bigint, null::numeric),
  'a role no requested account maps gives a null rate'
);

select ok(
  (
    select count(*) > 0 and bool_and(a.item_external_id between 'item-01' and 'item-12')
    from seed s
    cross join lateral public.item_attach(s.both_stores, s.from_date, s.to_date) a
    where a.item_external_id is not null
  ),
  'every item row of item_attach is a drink'
);

insert into public.item_category_overrides (tenant_id, pos_account_id, item_external_id, item_type_external_id)
select tenant_id, tea_account, 'item-15', 'type-03' from seed;

select ok(
  (
    select count(*) = 1
    from seed s
    cross join lateral public.item_attach(array[s.tea_store], s.from_date, s.to_date) a
    where a.item_external_id = 'item-15'
  ),
  'an override that makes an item a drink adds its row to item_attach at once'
);

delete from public.item_category_overrides where tenant_id = (select tenant_id from seed);

create temp table before_modifiers as
select
  (select array_agg(i.item_external_id || ':' || i.quantity order by i.item_external_id) from seed s cross join lateral public.item_summary(s.both_stores, s.from_date, s.to_date) i) as summary_items,
  (select array_agg(m.role || ':' || m.item_external_id || ':' || m.quantity order by m.role, m.item_external_id) from seed s cross join lateral public.menu_engineering(s.both_stores, s.to_date, 7) m) as menu_items,
  (select array_agg(i.item_external_id || ':' || i.quantity order by i.item_external_id) from seed s cross join lateral public.item_margins(s.both_stores, s.from_date, s.to_date) i) as margin_items,
  (select array_agg(coalesce(a.item_external_id, '-') || ':' || a.drink_invoices order by a.item_external_id nulls first) from seed s cross join lateral public.item_attach(s.both_stores, s.from_date, s.to_date) a) as attach_items;

update public.invoice_lines l
set item_external_id = 'item-05', item_name = 'Peach Tea (M)', item_type_external_id = 'type-02'
from seed s
where l.tenant_id = s.tenant_id
  and l.line_kind = 'modifier';

select app.refresh_analytics(s.tenant_id, s.from_date, s.to_date) from seed s;

select is(
  (
    select (
      (select array_agg(i.item_external_id || ':' || i.quantity order by i.item_external_id) from seed s cross join lateral public.item_summary(s.both_stores, s.from_date, s.to_date) i),
      (select array_agg(m.role || ':' || m.item_external_id || ':' || m.quantity order by m.role, m.item_external_id) from seed s cross join lateral public.menu_engineering(s.both_stores, s.to_date, 7) m),
      (select array_agg(i.item_external_id || ':' || i.quantity order by i.item_external_id) from seed s cross join lateral public.item_margins(s.both_stores, s.from_date, s.to_date) i),
      (select array_agg(coalesce(a.item_external_id, '-') || ':' || a.drink_invoices order by a.item_external_id nulls first) from seed s cross join lateral public.item_attach(s.both_stores, s.from_date, s.to_date) a)
    )
  ),
  (select (summary_items, menu_items, margin_items, attach_items) from before_modifiers),
  'modifier lines named and typed like an item never count as that item'
);

select * from finish();
rollback;
