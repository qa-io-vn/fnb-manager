begin;
select plan(39);

create temp table fixture as
select
  '11111111-1111-4111-8111-111111111111'::uuid as demo_tenant_id,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid as demo_owner_id,
  '22222222-2222-4222-8222-000000000001'::uuid as tea_store_id,
  '22222222-2222-4222-8222-000000000002'::uuid as coffee_store_id,
  array['22222222-2222-4222-8222-000000000001', '22222222-2222-4222-8222-000000000002']::uuid[] as both_stores,
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid as tea_staff_id,
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid as viewer_id,
  'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid as publisher_id,
  '99999999-9999-4999-8999-999999999999'::uuid as other_tenant_id,
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid as other_owner_id,
  '88888888-8888-4888-8888-888888888888'::uuid as other_store_id,
  '77777777-7777-4777-8777-777777777777'::uuid as other_pos_account_id,
  (select max(i.business_date) + 1 from public.invoices i where i.tenant_id = '11111111-1111-4111-8111-111111111111') as seed_anchor;

insert into auth.users (id, instance_id, aud, role, email)
select tea_staff_id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated'::varchar, 'authenticated'::varchar, 'staff@example.com'::varchar from fixture
union all
select viewer_id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated'::varchar, 'authenticated'::varchar, 'viewer@example.com'::varchar from fixture
union all
select publisher_id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated'::varchar, 'authenticated'::varchar, 'publisher@example.com'::varchar from fixture
union all
select other_owner_id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated'::varchar, 'authenticated'::varchar, 'other-owner@example.com'::varchar from fixture;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select demo_tenant_id, tea_staff_id, 'staff'::public.tenant_role, array[tea_store_id] from fixture
union all
select demo_tenant_id, viewer_id, 'viewer'::public.tenant_role, null::uuid[] from fixture
union all
select demo_tenant_id, publisher_id, 'publisher'::public.tenant_role, null::uuid[] from fixture;

insert into public.tenants (id, slug, name)
select other_tenant_id, 'other-tenant', 'Other Tenant' from fixture;

insert into public.tenant_members (tenant_id, user_id, role)
select other_tenant_id, other_owner_id, 'owner' from fixture;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select other_pos_account_id, other_tenant_id, 'ipos-fabi', 'other-account', 'Other POS' from fixture;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select other_store_id, other_tenant_id, other_pos_account_id, 'store-ext-999', 'Store A' from fixture;

insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, net_amount, paid_amount)
select other_tenant_id, other_store_id, other_pos_account_id, 'tran-other-' || n, now() - interval '3 days', current_date - 3, 10000, 10000, 10000
from fixture cross join generate_series(1, 3) as n;

select app.refresh_analytics(f.other_tenant_id, current_date - 7, current_date) from fixture f;

create temp table expected as
select
  (select count(*) from public.agg_daily_sales where tenant_id = f.demo_tenant_id) as demo_daily_rows,
  (select count(*) from public.agg_daily_sales where store_id = f.tea_store_id) as tea_daily_rows,
  (select count(*) from public.agg_shift_cash where store_id = f.tea_store_id) as tea_shift_rows,
  (select sum(invoices) from public.agg_daily_sales where store_id = f.tea_store_id) as tea_invoices,
  (select count(*) from public.agg_daily_sales where tenant_id = f.other_tenant_id) as other_daily_rows,
  (select count(*) from app.daily_sales_facts(f.demo_tenant_id, current_date - 45, current_date + 1)) as demo_live_rows,
  (select max(refreshed_at) from public.agg_daily_sales where tenant_id = f.demo_tenant_id) as demo_refreshed_at,
  (select count(*) from public.analytics_refreshes where tenant_id = f.demo_tenant_id) as demo_refresh_rows,
  (select count(*) from public.analytics_refreshes where tenant_id = f.demo_tenant_id and from_date = f.seed_anchor - 1 and to_date = f.seed_anchor and finished_at is not null and rows > 0) as demo_short_refresh_rows,
  (select count(*) from public.analytics_refreshes where tenant_id = f.other_tenant_id) as other_refresh_rows
from fixture f;

grant select on fixture, expected to authenticated;

set local role authenticated;
set local request.jwt.claims to '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';

select is((select count(*) from public.agg_daily_sales where tenant_id = (select demo_tenant_id from fixture)), (select demo_daily_rows from expected), 'demo owner reads every demo daily row');
select is((select count(*) from public.agg_daily_sales where tenant_id = (select other_tenant_id from fixture)), 0::bigint, 'demo owner reads no daily row of the other tenant');
select is((select count(*) from public.v_recent_daily_sales where tenant_id = (select demo_tenant_id from fixture)), (select demo_live_rows from expected), 'demo owner reads every demo row of the live daily view');
select is((select count(*) from public.v_recent_daily_sales where tenant_id = (select other_tenant_id from fixture)), 0::bigint, 'demo owner reads no live row of the other tenant');
select is((select count(*) from public.analytics_refreshes where tenant_id = (select other_tenant_id from fixture)), 0::bigint, 'demo owner reads no refresh log of the other tenant');
select is((select count(*) from public.dim_calendar), 2922::bigint, 'authenticated members read the calendar');
select cmp_ok((select invoices from public.period_summary((select both_stores from fixture), (select seed_anchor from fixture) - 7, (select seed_anchor from fixture) - 1)), '>', 0::bigint, 'demo owner summarises the demo stores');

select throws_ok(
  $$ insert into public.agg_daily_sales (tenant_id, store_id, business_date) values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-000000000001', current_date + 30) $$,
  '42501',
  null,
  'owner cannot write aggregate rows'
);
select throws_ok(
  $$ select app.refresh_analytics('11111111-1111-4111-8111-111111111111', current_date - 1, current_date) $$,
  '42501',
  null,
  'owner cannot call app.refresh_analytics directly'
);
select lives_ok(
  $$ select public.refresh_my_analytics(seed_anchor - 7, seed_anchor) from fixture $$,
  'owner refreshes the own tenant through the wrapper'
);
select cmp_ok(
  (select public.refresh_my_analytics(seed_anchor - 1, seed_anchor, '11111111-1111-4111-8111-111111111111') from fixture),
  '>',
  0::bigint,
  'the wrapper accepts the own tenant explicitly and returns the rows written'
);
select is(
  (select count(*) from public.analytics_refreshes where tenant_id = (select demo_tenant_id from fixture) and from_date = (select seed_anchor from fixture) - 1 and to_date = (select seed_anchor from fixture) and finished_at is not null and rows > 0),
  (select demo_short_refresh_rows + 1 from expected),
  'the wrapper logs the refresh'
);
select throws_ok(
  $$ select public.refresh_my_analytics(current_date - 92, current_date) $$,
  'P0001',
  null,
  'the wrapper rejects a range longer than 92 days'
);
select lives_ok(
  $$ select public.refresh_my_analytics(current_date - 91, current_date) $$,
  'the wrapper accepts a range of exactly 92 days'
);
select throws_ok(
  $$ select public.refresh_my_analytics(current_date - 1, current_date, '99999999-9999-4999-8999-999999999999') $$,
  '42501',
  null,
  'the wrapper rejects another tenant'
);

set local request.jwt.claims to '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';

select is((select count(*) from public.agg_daily_sales), (select tea_daily_rows from expected), 'tea staff reads the tea store daily rows only');
select is((select count(distinct store_id) from public.agg_hourly_sales), 1::bigint, 'tea staff reads hourly rows of a single store');
select is((select count(*) from public.agg_shift_cash), (select tea_shift_rows from expected), 'tea staff reads the tea store shifts only');
select is((select count(*) from public.agg_item_daily where store_id = (select coffee_store_id from fixture)), 0::bigint, 'tea staff reads no coffee bar item row');
select is((select invoices from public.period_summary((select both_stores from fixture), (select seed_anchor from fixture) - 7, (select seed_anchor from fixture) - 1)), (select tea_invoices from expected), 'period_summary over both stores returns only the tea store for tea staff');
select is((select count(distinct store_id) from public.v_recent_daily_sales), 1::bigint, 'the live view shows tea staff a single store');
select throws_ok(
  $$ select public.refresh_my_analytics(current_date - 1, current_date) $$,
  '42501',
  null,
  'staff cannot refresh analytics'
);

set local request.jwt.claims to '{"sub": "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "role": "authenticated"}';

select is((select count(*) from public.agg_daily_sales), (select demo_daily_rows from expected), 'viewer reads every demo daily row');
select throws_ok(
  $$ select public.refresh_my_analytics(current_date - 1, current_date) $$,
  '42501',
  null,
  'viewer cannot refresh analytics'
);

set local request.jwt.claims to '{"sub": "ffffffff-ffff-4fff-8fff-ffffffffffff", "role": "authenticated"}';

select is(
  (select count(*) from public.agg_daily_sales) + (select count(*) from public.agg_hourly_sales) + (select count(*) from public.agg_item_daily) + (select count(*) from public.agg_category_daily) + (select count(*) from public.agg_payment_daily),
  0::bigint,
  'publisher reads zero rows of the sales aggregates'
);
select is(
  (select count(*) from public.agg_shift_cash) + (select count(*) from public.agg_size_mix_daily) + (select count(*) from public.agg_modifier_prefs_daily) + (select count(*) from public.agg_basket_pairs_28d) + (select count(*) from public.agg_attach_daily),
  0::bigint,
  'publisher reads zero rows of the menu and cash aggregates'
);
select is((select count(*) from public.analytics_refreshes), 0::bigint, 'publisher reads no refresh log');
select is((select count(*) from public.v_recent_daily_sales), 0::bigint, 'publisher reads nothing from the live view');
select is((select invoices from public.period_summary((select both_stores from fixture), (select seed_anchor from fixture) - 7, (select seed_anchor from fixture) - 1)), 0::bigint, 'period_summary returns zero invoices to the publisher');

set local request.jwt.claims to '{"sub": "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "role": "authenticated"}';

select is((select count(*) from public.agg_daily_sales), (select other_daily_rows from expected), 'other owner reads only the other tenant daily rows');
select is((select count(*) from public.agg_daily_sales where tenant_id = (select demo_tenant_id from fixture)), 0::bigint, 'other owner reads zero demo aggregate rows');
select is((select invoices from public.period_summary((select both_stores from fixture), (select seed_anchor from fixture) - 7, (select seed_anchor from fixture) - 1)), 0::bigint, 'other owner summarises the demo stores to zero');
select is((select public.refresh_my_analytics(current_date - 7, current_date)), 2::bigint, 'other owner refreshes the own tenant: one daily and one hourly row');

reset role;

select is((select count(*) from public.analytics_refreshes where tenant_id = (select demo_tenant_id from fixture)), (select demo_refresh_rows + 3 from expected), 'the demo log grew by the three owner refreshes and the other owner refresh did not touch it');
select is((select count(*) from public.analytics_refreshes where tenant_id = (select other_tenant_id from fixture)), (select other_refresh_rows + 1 from expected), 'the other owner refresh is logged for the other tenant');

set local role anon;

select throws_ok('select count(*) from public.agg_daily_sales', '42501', null, 'anon cannot read aggregates');
select throws_ok('select count(*) from public.v_recent_daily_sales', '42501', null, 'anon cannot read the live view');
select throws_ok('select count(*) from public.dim_calendar', '42501', null, 'anon cannot read the calendar');
select throws_ok($$ select * from public.period_summary(array['22222222-2222-4222-8222-000000000001']::uuid[], current_date - 7, current_date) $$, '42501', null, 'anon cannot call the query functions');

select * from finish();
rollback;
