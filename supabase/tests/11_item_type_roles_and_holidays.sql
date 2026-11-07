begin;
select plan(21);

create temp table fixture as
select
  '11111111-1111-4111-8111-111111111111'::uuid as demo_tenant_id,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid as demo_owner_id,
  '33333333-3333-4333-8333-000000000001'::uuid as tea_pos_account_id,
  '22222222-2222-4222-8222-000000000001'::uuid as tea_store_id,
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid as tea_manager_id,
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid as viewer_id,
  '99999999-9999-4999-8999-999999999999'::uuid as other_tenant_id,
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid as other_owner_id,
  '77777777-7777-4777-8777-777777777777'::uuid as other_pos_account_id;

insert into auth.users (id, instance_id, aud, role, email)
select tea_manager_id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated'::varchar, 'authenticated'::varchar, 'manager@example.com'::varchar from fixture
union all
select viewer_id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated'::varchar, 'authenticated'::varchar, 'viewer@example.com'::varchar from fixture
union all
select other_owner_id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated'::varchar, 'authenticated'::varchar, 'other-owner@example.com'::varchar from fixture;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select demo_tenant_id, tea_manager_id, 'manager'::public.tenant_role, array[tea_store_id] from fixture
union all
select demo_tenant_id, viewer_id, 'viewer'::public.tenant_role, null::uuid[] from fixture;

insert into public.tenants (id, slug, name)
select other_tenant_id, 'other-tenant', 'Other Tenant' from fixture;

insert into public.tenant_members (tenant_id, user_id, role)
select other_tenant_id, other_owner_id, 'owner' from fixture;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select other_pos_account_id, other_tenant_id, 'ipos-fabi', 'other-account', 'Other POS' from fixture;

grant select on fixture to authenticated;

select is((select count(*) from public.item_type_roles), 8::bigint, 'seed assigns a role to every demo item type of both POS accounts');
select is((select count(*) from public.item_type_roles where role = 'drink'), 6::bigint, 'seed marks the tea and coffee types as drinks');

select is((select count(*) from public.holidays where tenant_id is not null), 0::bigint, 'seed holds only global holidays');
select is((select count(*) from public.holidays where holiday_date = '2026-02-17' and kind = 'tet'), 1::bigint, 'Lunar New Year 2026 is flagged as Tet');
select is((select count(*) from public.holidays where kind = 'tet' and holiday_date between '2026-02-16' and '2026-02-21'), 6::bigint, 'the Tet 2026 window runs from the eve to day five');
select is((select count(*) from public.holidays where kind = 'tet' and holiday_date between '2024-02-08' and '2024-02-14'), 7::bigint, 'the Tet 2024 window includes the 30th of the last lunar month');
select is(
  (select count(distinct extract(year from holiday_date)) from public.holidays where kind = 'public' and extract(month from holiday_date) = 9 and extract(day from holiday_date) = 2),
  5::bigint,
  '2 September is a public holiday in every seeded year'
);
select is((select count(*) from public.holidays where name = 'Hung Kings Commemoration Day'), 5::bigint, 'Hung Kings Commemoration Day is seeded for every year');

set local role authenticated;
set local request.jwt.claims to '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';

select lives_ok(
  $$ insert into public.item_type_roles (tenant_id, pos_account_id, item_type_external_id, role)
     values ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-000000000001', 'type-05', 'topping') $$,
  'owner inserts an item type role for the own POS account'
);

select throws_ok(
  $$ insert into public.item_type_roles (tenant_id, pos_account_id, item_type_external_id, role)
     values ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-000000000001', 'type-05', 'food') $$,
  '23505',
  null,
  'a second role for the same item type is rejected'
);

select throws_ok(
  $$ insert into public.item_type_roles (tenant_id, pos_account_id, item_type_external_id, role)
     values ('99999999-9999-4999-8999-999999999999', '77777777-7777-4777-8777-777777777777', 'type-01', 'drink') $$,
  '42501',
  null,
  'owner cannot insert an item type role for another tenant'
);

select throws_ok(
  $$ insert into public.item_type_roles (tenant_id, pos_account_id, item_type_external_id, role)
     values ('11111111-1111-4111-8111-111111111111', '77777777-7777-4777-8777-777777777777', 'type-01', 'drink') $$,
  '23503',
  null,
  'owner cannot pair the own tenant with a POS account of another tenant'
);

select lives_ok(
  $$ insert into public.holidays (tenant_id, country_code, holiday_date, name, kind)
     values ('11111111-1111-4111-8111-111111111111', 'VN', current_date + 10, 'Shop anniversary', 'custom') $$,
  'owner inserts a custom holiday for the own tenant'
);

select throws_ok(
  $$ insert into public.holidays (tenant_id, country_code, holiday_date, name, kind)
     values (null, 'VN', current_date + 11, 'Planted global holiday', 'public') $$,
  '42501',
  null,
  'owner cannot insert a global holiday'
);

select throws_ok(
  $$ insert into public.holidays (tenant_id, country_code, holiday_date, name, kind)
     values ('99999999-9999-4999-8999-999999999999', 'VN', current_date + 12, 'Planted', 'custom') $$,
  '42501',
  null,
  'owner cannot insert a holiday for another tenant'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.item_type_roles (tenant_id, pos_account_id, item_type_external_id, role)
     values ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-000000000001', 'type-06', 'food') $$,
  '42501',
  null,
  'store-limited manager cannot write tenant-wide item type roles'
);

set local request.jwt.claims to '{"sub": "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.item_type_roles (tenant_id, pos_account_id, item_type_external_id, role)
     values ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-000000000001', 'type-06', 'food') $$,
  '42501',
  null,
  'viewer cannot insert item type roles'
);

select is((select count(*) from public.item_type_roles), 9::bigint, 'viewer reads the item type roles of the tenant');
select is((select count(*) from public.holidays where tenant_id is not null), 1::bigint, 'viewer reads the custom holiday of the own tenant');
select is((select count(*) from public.holidays where tenant_id is null), 61::bigint, 'viewer reads every global holiday');

set local request.jwt.claims to '{"sub": "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "role": "authenticated"}';

select is((select count(*) from public.holidays where tenant_id is not null), 0::bigint, 'other owner sees no custom holiday of the demo tenant');

select * from finish();
rollback;
