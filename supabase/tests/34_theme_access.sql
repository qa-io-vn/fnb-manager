begin;
select plan(33);

create temp table fixture as
select
  '88888888-8888-4888-8888-000000000001'::uuid as tenant_id,
  '88888888-8888-4888-8888-000000000011'::uuid as account_id,
  '88888888-8888-4888-8888-000000000021'::uuid as store_a,
  '88888888-8888-4888-8888-000000000022'::uuid as store_b,
  array['88888888-8888-4888-8888-000000000021', '88888888-8888-4888-8888-000000000022']::uuid[] as both_stores,
  '99999999-9999-4999-8999-000000000001'::uuid as other_tenant_id,
  '99999999-9999-4999-8999-000000000011'::uuid as other_account_id,
  '99999999-9999-4999-8999-000000000021'::uuid as other_store,
  'eeeeeeee-eeee-4eee-8eee-000000000301'::uuid as owner_id,
  'eeeeeeee-eeee-4eee-8eee-000000000302'::uuid as store_staff_id,
  'eeeeeeee-eeee-4eee-8eee-000000000303'::uuid as publisher_id,
  'eeeeeeee-eeee-4eee-8eee-000000000304'::uuid as viewer_id,
  'eeeeeeee-eeee-4eee-8eee-000000000305'::uuid as other_owner_id;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated'::varchar, 'authenticated'::varchar, u.email::varchar
from fixture f
cross join lateral (
  values
    (f.owner_id, 'theme-owner@example.com'),
    (f.store_staff_id, 'theme-staff@example.com'),
    (f.publisher_id, 'theme-publisher@example.com'),
    (f.viewer_id, 'theme-viewer@example.com'),
    (f.other_owner_id, 'theme-other-owner@example.com')
) as u (id, email);

insert into public.tenants (id, slug, name)
select tenant_id, 'theme-pgtap-access', 'Theme Access' from fixture
union all
select other_tenant_id, 'theme-pgtap-access-other', 'Theme Access Other' from fixture;

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
select account_id, tenant_id, 'mock', 'theme-pgtap-access', 'Theme Access POS' from fixture
union all
select other_account_id, other_tenant_id, 'mock', 'theme-pgtap-access-other', 'Theme Access Other POS' from fixture;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name, opening_hours, seat_count)
select store_a, tenant_id, account_id, 'theme-access-a', 'Store A', '{"mon": [["08:00", "20:00"]]}'::jsonb, 20 from fixture
union all
select store_b, tenant_id, account_id, 'theme-access-b', 'Store B', null, null from fixture
union all
select other_store, other_tenant_id, other_account_id, 'theme-access-other', 'Store A', null, null from fixture;

insert into public.agg_daily_sales (tenant_id, store_id, business_date, invoices, gross_amount, net_amount, paid_amount, cash_amount, items_sold)
select s.tenant_id, s.store_id, d::date, 10, 400000, 400000, 400000, 100000, 15
from (
  select f.tenant_id, f.store_a as store_id from fixture f
  union all select f.tenant_id, f.store_b from fixture f
  union all select f.other_tenant_id, f.other_store from fixture f
) s
cross join generate_series('2025-03-03'::date, '2025-03-09'::date, interval '1 day') as d;

insert into public.agg_hourly_sales (tenant_id, store_id, business_date, hour_local, invoices, net_amount)
select s.tenant_id, s.store_id, d::date, h.hour_local, 5, 200000
from (
  select f.tenant_id, f.store_a as store_id from fixture f
  union all select f.tenant_id, f.store_b from fixture f
  union all select f.other_tenant_id, f.other_store from fixture f
) s
cross join generate_series('2025-03-03'::date, '2025-03-09'::date, interval '1 day') as d
cross join (values (9), (15)) as h (hour_local);

insert into public.item_type_roles (tenant_id, pos_account_id, item_type_external_id, role)
select f.tenant_id, f.account_id, 'DRINKS', 'drink'::public.item_type_role from fixture f;

insert into public.agg_item_daily (
  tenant_id, store_id, business_date, item_external_id, item_name, base_name, size_label,
  item_type_external_id, item_type_name, quantity, net_amount, invoices
)
select s.tenant_id, s.store_id, d::date, 'A1', 'Trà đào', 'Trà đào', null, 'DRINKS', 'Đồ uống', s.quantity, s.quantity * 30000, s.quantity::integer
from (
  select f.tenant_id, f.store_a as store_id, 3::numeric as quantity from fixture f
  union all select f.tenant_id, f.store_b, 2 from fixture f
  union all select f.other_tenant_id, f.other_store, 7 from fixture f
) s
cross join generate_series('2025-03-03'::date, '2025-03-09'::date, interval '1 day') as d;

insert into public.item_costs (tenant_id, store_id, item_external_id, cost_amount, effective_from)
select f.tenant_id, null::uuid, 'A1', 12000, '2025-01-01'::date from fixture f
union all
select f.other_tenant_id, null, 'A1', 1000, '2025-01-01' from fixture f;

update public.tenants
set analytics_pending_from = null, analytics_pending_to = null
where id = (select tenant_id from fixture);

select ok(
  has_function_privilege('authenticated', 'app.opening_hours_present(jsonb)', 'execute')
  and has_function_privilege('service_role', 'app.opening_hours_present(jsonb)', 'execute'),
  'app.opening_hours_present is executable by authenticated and service_role'
);

select ok(
  not has_function_privilege('authenticated', 'app.opening_hours_known(jsonb)', 'execute'),
  'the phase 7 helper app.opening_hours_known stays private'
);

select ok(
  not has_function_privilege('authenticated', 'app.touch_analytics_inputs()', 'execute')
  and not has_function_privilege('anon', 'app.touch_analytics_inputs()', 'execute')
  and not has_function_privilege('service_role', 'app.touch_analytics_inputs()', 'execute'),
  'no API role executes app.touch_analytics_inputs'
);

select ok(
  (
    select bool_and(has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute'))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('report_settings_of', 'analytics_catch_up_status', 'range_totals', 'opening_productivity', 'hour_profile')
  ),
  'authenticated may call the new public functions and anon may not'
);

select ok(
  (
    select bool_and(has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute'))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname, p.proname) in (
      ('public', 'menu_engineering'), ('public', 'item_margins'), ('public', 'item_attach'),
      ('app', 'item_cost_periods'), ('app', 'effective_item_types')
    )
  ),
  'authenticated may call the menu functions and their helpers and anon may not'
);

grant select on fixture to authenticated;

set local role authenticated;
set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000000301", "role": "authenticated"}';

select is(
  (
    select array_agg(r.store_id::text || ':' || r.roles_configured || ':' || r.opening_hours_known || ':' || coalesce(r.seat_count::text, '-') order by r.store_id)
    from public.report_settings_of((select both_stores from fixture)) r
  ),
  array[
    '88888888-8888-4888-8888-000000000021:true:true:20',
    '88888888-8888-4888-8888-000000000022:true:false:-'
  ],
  'the owner reads the settings of both stores without a privilege error'
);

select is(
  (select count(*)::int from public.report_settings_of((select array[other_store] from fixture))),
  0,
  'the owner reads no settings of another tenant''s store'
);

select ok(
  (
    select count(*) = 3 and bool_and(r.net_amount = case when r.store_id is null then 5600000 else 2800000 end)
    from public.range_totals((select both_stores from fixture), array['2025-03-03']::date[], array['2025-03-09']::date[]) r
  ),
  'the owner gets range totals for all stores and each store'
);

select ok(
  (
    select count(*) = 1 and bool_and(r.store_id is null and r.days_with_data = 0 and r.net_amount is null)
    from public.range_totals((select array[other_store] from fixture), array['2025-03-03']::date[], array['2025-03-09']::date[]) r
  ),
  'another tenant''s store gives an empty block and no store row'
);

select is(
  (select count(*)::int from public.hour_profile((select array[other_store] from fixture), '2025-03-03', '2025-03-09')),
  0,
  'hour_profile returns nothing for another tenant''s store'
);

select ok(
  (
    select bool_and(o.days_with_sales = 0) and count(*) = 1
    from public.opening_productivity((select array[other_store] from fixture), '2025-03-03', '2025-03-09') o
  ),
  'opening_productivity sees no day of another tenant''s store'
);

select is(
  (
    select array[c.pending_days::text, c.can_refresh::text, (c.history_from = '2025-03-03')::text]
    from public.analytics_catch_up_status((select tenant_id from fixture)) c
  ),
  array['0', 'true', 'true'],
  'the owner reads the catch-up status of the tenant and may refresh'
);

select is(
  (select count(*)::int from public.analytics_catch_up_status((select other_tenant_id from fixture))),
  0,
  'the catch-up status of another tenant has no row'
);

select is(
  (
    select (m.quantity, m.unit_cost, m.role)
    from public.menu_engineering((select both_stores from fixture), '2025-03-09', 7) m
  ),
  (35::numeric, 12000.00::numeric, 'drink'::public.item_type_role),
  'the owner sees the item of both stores with the tenant''s own cost'
);

select is(
  (
    select count(*)::int
    from public.menu_engineering((select array[other_store] from fixture), '2025-03-09', 7)
  ),
  0,
  'menu_engineering returns nothing for another tenant''s store'
);

select is(
  (
    select count(*)::int
    from public.item_margins((select array[other_store] from fixture), '2025-03-03', '2025-03-09')
  ),
  0,
  'item_margins returns nothing for another tenant''s store'
);

select is(
  (
    select array_agg(coalesce(a.item_external_id, '-') || ':' || a.drink_invoices)
    from public.item_attach((select array[other_store] from fixture), '2025-03-03', '2025-03-09') a
  ),
  array['-:0'],
  'item_attach counts no invoice of another tenant''s store'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000000302", "role": "authenticated"}';

select is(
  (select array_agg(r.store_id) from public.report_settings_of((select both_stores from fixture)) r),
  (select array[store_a] from fixture),
  'a member limited to one store reads the settings of that store only'
);

select ok(
  (
    select count(*) = 2 and bool_and(r.net_amount = 2800000)
    from public.range_totals((select both_stores from fixture), array['2025-03-03']::date[], array['2025-03-09']::date[]) r
  ),
  'a member limited to one store gets totals of that store only'
);

select is(
  (select c.can_refresh from public.analytics_catch_up_status((select tenant_id from fixture)) c),
  false,
  'staff read the catch-up status but may not refresh'
);

select is(
  (
    select (i.quantity, i.cost_amount)
    from public.item_margins((select both_stores from fixture), '2025-03-03', '2025-03-09') i
  ),
  (21::numeric, 252000.00::numeric),
  'a member limited to one store gets the margins of that store only'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000000304", "role": "authenticated"}';

select ok(
  (
    select count(*) filter (where p.hour_local is not null) > 0
    from public.hour_profile((select both_stores from fixture), '2025-03-03', '2025-03-09') p
  ),
  'a viewer reads the hour profile'
);

select is(
  (select c.can_refresh from public.analytics_catch_up_status((select tenant_id from fixture)) c),
  false,
  'a viewer may not refresh'
);

select is(
  (
    select count(*)::int
    from public.menu_engineering((select both_stores from fixture), '2025-03-09', 7)
  ),
  1,
  'a viewer reads the menu matrix'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000000303", "role": "authenticated"}';

select ok(
  (
    select count(*) = 2 and bool_and(not r.has_tenant_row and not r.roles_configured and r.menu_window_days = 28)
    from public.report_settings_of((select both_stores from fixture)) r
  ),
  'the publisher gets the default settings and no configured flags'
);

select ok(
  (
    select count(*) = 3 and bool_and(r.net_amount is null)
    from public.range_totals((select both_stores from fixture), array['2025-03-03']::date[], array['2025-03-09']::date[]) r
  ),
  'the publisher gets rows without sales'
);

select is(
  (select count(*)::int from public.analytics_catch_up_status((select tenant_id from fixture))),
  0,
  'the publisher reads no catch-up status'
);

select is(
  (
    select (
      (select count(*)::int from public.menu_engineering((select both_stores from fixture), '2025-03-09', 7)),
      (select count(*)::int from public.item_margins((select both_stores from fixture), '2025-03-03', '2025-03-09'))
    )
  ),
  (0, 0),
  'the publisher reads no item'
);

reset role;
set local role anon;

select throws_ok(
  $$ select * from public.report_settings_of(array['88888888-8888-4888-8888-000000000021']::uuid[]) $$,
  '42501',
  null,
  'anon calling report_settings_of is refused'
);

select throws_ok(
  $$ select * from public.hour_profile(array['88888888-8888-4888-8888-000000000021']::uuid[], '2025-03-03', '2025-03-09') $$,
  '42501',
  null,
  'anon calling hour_profile is refused'
);

select throws_ok(
  $$ select * from public.menu_engineering(array['88888888-8888-4888-8888-000000000021']::uuid[], '2025-03-09') $$,
  '42501',
  null,
  'anon calling menu_engineering is refused'
);

select throws_ok(
  $$ select * from public.item_margins(array['88888888-8888-4888-8888-000000000021']::uuid[], '2025-03-03', '2025-03-09') $$,
  '42501',
  null,
  'anon calling item_margins is refused'
);

select throws_ok(
  $$ select * from public.item_attach(array['88888888-8888-4888-8888-000000000021']::uuid[], '2025-03-03', '2025-03-09') $$,
  '42501',
  null,
  'anon calling item_attach is refused'
);

select * from finish();
rollback;
