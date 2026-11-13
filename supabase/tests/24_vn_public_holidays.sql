begin;
select plan(9);

create temp table fixture as
select
  '44444444-4444-4444-8444-000000000401'::uuid as tenant_id,
  '44444444-4444-4444-8444-000000000411'::uuid as account_id,
  '44444444-4444-4444-8444-000000000421'::uuid as store_id;

insert into public.tenants (id, slug, name)
select tenant_id, 'holiday-fixture', 'Holiday Fixture' from fixture;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_id, tenant_id, 'mock', 'holiday-fixture', 'Holiday Fixture POS' from fixture;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_id, tenant_id, account_id, 'holiday-store', 'Store A' from fixture;

create temp table vn_global as
select h.*
from public.holidays h
where h.tenant_id is null
  and h.country_code = 'VN';

select is((select count(*) from vn_global), 61::bigint, 'the migration ships 61 global Vietnamese holiday rows');
select is(
  (select (count(*) filter (where kind = 'public'), count(*) filter (where kind = 'tet')) from vn_global),
  (30::bigint, 31::bigint),
  'they are 30 public holidays and 31 Tet days'
);
select is(
  (
    select array_agg((y.year_no, y.public_days, y.tet_days)::text order by y.year_no)
    from (
      select extract(year from g.holiday_date)::integer as year_no,
        count(*) filter (where g.kind = 'public') as public_days,
        count(*) filter (where g.kind = 'tet') as tet_days
      from vn_global g
      group by extract(year from g.holiday_date)
    ) y
  ),
  array['(2024,6,7)', '(2025,6,6)', '(2026,6,6)', '(2027,6,6)', '(2028,6,6)'],
  'every year 2024 to 2028 has six public holidays and a Tet run, seven days when the last lunar month has thirty'
);
select is(
  (select array_agg(g.holiday_date order by g.holiday_date) from vn_global g where g.kind = 'tet' and extract(year from g.holiday_date) = 2026),
  array['2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21']::date[],
  'Tet 2026 runs from the last day of the lunar year to day five'
);
select is(
  (
    select array[
      app.tet_window(f.tenant_id, 'VN', '2026-02-15'),
      app.tet_window(f.tenant_id, 'VN', '2026-02-16'),
      app.tet_window(f.tenant_id, 'VN', '2026-02-21'),
      app.tet_window(f.tenant_id, 'VN', '2026-02-22')
    ]
    from fixture f
  ),
  array[false, true, true, false],
  'the Tet 2026 window starts on the eve and ends after day five'
);
select is(
  (select count(*) - count(distinct (h.tenant_id, h.country_code, h.holiday_date, h.name)) from public.holidays h),
  0::bigint,
  'no holiday repeats its tenant, country, date and name'
);
select is(
  (
    select count(*)
    from public.holidays h
    where h.country_code = 'VN'
      and h.kind in ('public', 'tet')
      and h.tenant_id is not null
  ),
  0::bigint,
  'every statutory and Tet row is global, with a null tenant'
);
select is(
  (select array_agg(g.holiday_date order by g.holiday_date) from vn_global g where g.name = 'Hung Kings Commemoration Day'),
  array['2024-04-18', '2025-04-07', '2026-04-26', '2027-04-16', '2028-04-04']::date[],
  'the Hung Kings Commemoration Day follows the lunar calendar of each year'
);
select is(
  (
    select array[
      app.is_excluded_day(array[f.store_id], '2026-09-01'),
      app.is_excluded_day(array[f.store_id], '2026-09-02'),
      app.is_excluded_day(array[f.store_id], '2026-09-03'),
      app.is_excluded_day(array[f.store_id], '2028-01-25')
    ]
    from fixture f
  ),
  array[true, true, false, true],
  'a store of any Vietnamese tenant excludes the global holidays from its baselines'
);

select * from finish();
rollback;
