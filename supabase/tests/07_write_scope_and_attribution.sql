begin;
select plan(16);

create temp table fixture as
select
  '11111111-1111-4111-8111-111111111111'::uuid as demo_tenant_id,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid as demo_owner_id,
  '22222222-2222-4222-8222-000000000001'::uuid as tea_store_id,
  '22222222-2222-4222-8222-000000000002'::uuid as coffee_store_id,
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'::uuid as tea_manager_id,
  '99999999-9999-4999-8999-999999999999'::uuid as other_tenant_id,
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid as other_owner_id,
  '88888888-8888-4888-8888-888888888888'::uuid as other_store_id,
  '77777777-7777-4777-8777-777777777777'::uuid as other_pos_account_id;

insert into auth.users (id, instance_id, aud, role, email)
select tea_manager_id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated'::varchar, 'authenticated'::varchar, 'manager@example.com'::varchar from fixture
union all
select other_owner_id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated'::varchar, 'authenticated'::varchar, 'other-owner@example.com'::varchar from fixture;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select demo_tenant_id, tea_manager_id, 'manager', array[tea_store_id] from fixture;

insert into public.tenants (id, slug, name)
select other_tenant_id, 'other-tenant', 'Other Tenant' from fixture;

insert into public.tenant_members (tenant_id, user_id, role)
select other_tenant_id, other_owner_id, 'owner' from fixture;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select other_pos_account_id, other_tenant_id, 'ipos-fabi', 'other-account', 'Other POS' from fixture;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select other_store_id, other_tenant_id, other_pos_account_id, 'store-ext-999', 'Store A' from fixture;

grant select on fixture to authenticated;

select throws_ok(
  $$ insert into public.targets (tenant_id, store_id, period_kind, period_start, net_target_amount)
     values ('11111111-1111-4111-8111-111111111111', '88888888-8888-4888-8888-888888888888', 'month', date_trunc('month', current_date)::date, 1000000) $$,
  '23503',
  null,
  'service-level writes cannot pair a tenant with a store of another tenant'
);

set local role authenticated;
set local request.jwt.claims to '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.targets (tenant_id, store_id, period_kind, period_start, net_target_amount)
     values ('11111111-1111-4111-8111-111111111111', '88888888-8888-4888-8888-888888888888', 'month', date_trunc('month', current_date)::date, 1000000) $$,
  '42501',
  null,
  'owner cannot insert a target for a store of another tenant'
);

select throws_ok(
  $$ insert into public.item_costs (tenant_id, store_id, item_external_id, cost_amount, effective_from)
     values ('11111111-1111-4111-8111-111111111111', '88888888-8888-4888-8888-888888888888', 'item-01', 1000, current_date) $$,
  '42501',
  null,
  'owner cannot insert an item cost for a store of another tenant'
);

select throws_ok(
  $$ insert into public.strategy_reports (tenant_id, store_id, horizon, language, generated_via, title, content_markdown)
     values ('11111111-1111-4111-8111-111111111111', '88888888-8888-4888-8888-888888888888', '90d', 'en', 'pasted', 'Planted', '# Planted') $$,
  '42501',
  null,
  'owner cannot insert a strategy report for a store of another tenant'
);

select throws_ok(
  $$ insert into public.item_costs (tenant_id, store_id, item_external_id, cost_amount, effective_from, created_by)
     values ('11111111-1111-4111-8111-111111111111', null, 'item-14', 1000, current_date + 1, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc') $$,
  '42501',
  null,
  'owner cannot attribute an item cost to another user'
);

select lives_ok(
  $$ insert into public.item_costs (tenant_id, store_id, item_external_id, cost_amount, effective_from)
     values ('11111111-1111-4111-8111-111111111111', null, 'item-14', 1000, current_date + 1) $$,
  'owner inserts an item cost without naming created_by'
);

select is(
  (select created_by from public.item_costs where item_external_id = 'item-14' and effective_from = current_date + 1),
  (select demo_owner_id from fixture),
  'created_by defaults to the authenticated user'
);

update public.item_costs
set created_by = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', cost_amount = 2000
where item_external_id = 'item-14' and effective_from = current_date + 1;

select is(
  (select created_by from public.item_costs where item_external_id = 'item-14' and effective_from = current_date + 1),
  (select demo_owner_id from fixture),
  'created_by survives an update that tries to change it'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.targets (tenant_id, store_id, period_kind, period_start, net_target_amount)
     values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-000000000002', 'week', date_trunc('week', current_date)::date, 1) $$,
  '42501',
  null,
  'store-limited manager cannot insert a target for a store outside the scope'
);

select lives_ok(
  $$ insert into public.targets (tenant_id, store_id, period_kind, period_start, net_target_amount)
     values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-000000000001', 'week', date_trunc('week', current_date)::date, 60000000) $$,
  'store-limited manager inserts a target for the own store'
);

select throws_ok(
  $$ insert into public.item_costs (tenant_id, store_id, item_external_id, cost_amount, effective_from)
     values ('11111111-1111-4111-8111-111111111111', null, 'item-15', 1000, current_date) $$,
  '42501',
  null,
  'store-limited manager cannot insert a tenant-wide item cost'
);

select lives_ok(
  $$ insert into public.item_costs (tenant_id, store_id, item_external_id, cost_amount, effective_from)
     values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-000000000001', 'item-15', 1000, current_date) $$,
  'store-limited manager inserts an item cost for the own store'
);

update public.targets set net_target_amount = 1
where store_id = '22222222-2222-4222-8222-000000000002';

delete from public.targets
where store_id = '22222222-2222-4222-8222-000000000002';

reset role;

select is(
  (select count(*) from public.targets where store_id = (select coffee_store_id from fixture)),
  1::bigint,
  'store-limited manager deletes no target of another store'
);

select is(
  (select net_target_amount from public.targets where store_id = (select coffee_store_id from fixture)),
  250000000::numeric(14, 2),
  'store-limited manager updates no target of another store'
);

set local role authenticated;
set local request.jwt.claims to '{"sub": "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "role": "authenticated"}';

select is((select count(*) from public.targets), 0::bigint, 'other owner sees no planted target');
select is((select count(*) from public.item_costs), 0::bigint, 'other owner sees no planted item cost');

select * from finish();
rollback;
