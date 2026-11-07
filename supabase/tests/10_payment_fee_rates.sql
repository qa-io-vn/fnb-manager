begin;
select plan(14);

create temp table fixture as
select
  '11111111-1111-4111-8111-111111111111'::uuid as demo_tenant_id,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid as demo_owner_id,
  '22222222-2222-4222-8222-000000000001'::uuid as tea_store_id,
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid as tea_manager_id,
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd'::uuid as viewer_id,
  '99999999-9999-4999-8999-999999999999'::uuid as other_tenant_id,
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid as other_owner_id,
  '88888888-8888-4888-8888-888888888888'::uuid as other_store_id,
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

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select other_store_id, other_tenant_id, other_pos_account_id, 'store-ext-999', 'Store A' from fixture;

grant select on fixture to authenticated;

select is((select count(*) from public.payment_fee_rates), 1::bigint, 'seed holds one payment fee rate');

set local role authenticated;
set local request.jwt.claims to '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';

select lives_ok(
  $$ insert into public.payment_fee_rates (tenant_id, store_id, payment_method_external_id, fee_pct, effective_from)
     values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-000000000001', 'pm-02', 1.5, current_date) $$,
  'owner inserts a store fee rate for the own tenant'
);

select throws_ok(
  $$ insert into public.payment_fee_rates (tenant_id, store_id, payment_method_external_id, fee_pct, effective_from)
     values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-000000000001', 'pm-02', 1.5, current_date) $$,
  '23505',
  null,
  'a second rate for the same scope, method and date is rejected'
);

select throws_ok(
  $$ insert into public.payment_fee_rates (tenant_id, store_id, payment_method_external_id, fee_pct, effective_from)
     values ('99999999-9999-4999-8999-999999999999', null, 'pm-02', 1.5, current_date) $$,
  '42501',
  null,
  'owner cannot insert a fee rate for another tenant'
);

select throws_ok(
  $$ insert into public.payment_fee_rates (tenant_id, store_id, payment_method_external_id, fee_pct, effective_from)
     values ('11111111-1111-4111-8111-111111111111', '88888888-8888-4888-8888-888888888888', 'pm-02', 1.5, current_date) $$,
  '42501',
  null,
  'owner cannot insert a fee rate for a store of another tenant'
);

select throws_ok(
  $$ insert into public.payment_fee_rates (tenant_id, store_id, payment_method_external_id, fee_pct, effective_from, created_by)
     values ('11111111-1111-4111-8111-111111111111', null, 'pm-03', 0.5, current_date + 1, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc') $$,
  '42501',
  null,
  'owner cannot attribute a fee rate to another user'
);

select lives_ok(
  $$ insert into public.payment_fee_rates (tenant_id, store_id, payment_method_external_id, fee_pct, effective_from)
     values ('11111111-1111-4111-8111-111111111111', null, 'pm-03', 0.5, current_date + 1) $$,
  'owner inserts a fee rate without naming created_by'
);

select is(
  (select created_by from public.payment_fee_rates where payment_method_external_id = 'pm-03' and effective_from = current_date + 1),
  (select demo_owner_id from fixture),
  'created_by defaults to the authenticated user'
);

update public.payment_fee_rates
set created_by = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', fee_pct = 0.75
where payment_method_external_id = 'pm-03' and effective_from = current_date + 1;

select is(
  (select created_by from public.payment_fee_rates where payment_method_external_id = 'pm-03' and effective_from = current_date + 1),
  (select demo_owner_id from fixture),
  'created_by survives an update that tries to change it'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.payment_fee_rates (tenant_id, store_id, payment_method_external_id, fee_pct, effective_from)
     values ('11111111-1111-4111-8111-111111111111', null, 'pm-01', 0, current_date) $$,
  '42501',
  null,
  'store-limited manager cannot insert a tenant-wide fee rate'
);

select lives_ok(
  $$ insert into public.payment_fee_rates (tenant_id, store_id, payment_method_external_id, fee_pct, effective_from)
     values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-000000000001', 'pm-01', 0, current_date) $$,
  'store-limited manager inserts a fee rate for the own store'
);

set local request.jwt.claims to '{"sub": "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.payment_fee_rates (tenant_id, store_id, payment_method_external_id, fee_pct, effective_from)
     values ('11111111-1111-4111-8111-111111111111', null, 'pm-01', 0, current_date + 2) $$,
  '42501',
  null,
  'viewer cannot insert fee rates'
);

select cmp_ok((select count(*) from public.payment_fee_rates), '>', 0::bigint, 'viewer can read fee rates of the tenant');

set local request.jwt.claims to '{"sub": "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "role": "authenticated"}';

select is((select count(*) from public.payment_fee_rates), 0::bigint, 'other owner sees no demo fee rate');

select * from finish();
rollback;
