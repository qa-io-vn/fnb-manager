begin;
select plan(16);

create temp table fixture as
select
  '11111111-1111-4111-8111-111111111111'::uuid as demo_tenant_id,
  '22222222-2222-4222-8222-000000000001'::uuid as tea_store_id,
  'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid as publisher_id,
  '99999999-9999-4999-8999-999999999999'::uuid as other_tenant_id,
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid as other_owner_id;

insert into auth.users (id, instance_id, aud, role, email)
select publisher_id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated'::varchar, 'authenticated'::varchar, 'publisher@example.com'::varchar from fixture
union all
select other_owner_id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated'::varchar, 'authenticated'::varchar, 'other-owner@example.com'::varchar from fixture;

insert into public.tenant_members (tenant_id, user_id, role)
select demo_tenant_id, publisher_id, 'publisher' from fixture;

insert into public.tenants (id, slug, name)
select other_tenant_id, 'other-tenant', 'Other Tenant' from fixture;

insert into public.tenant_members (tenant_id, user_id, role)
select other_tenant_id, other_owner_id, 'owner' from fixture;

grant select on fixture to authenticated;

set local role authenticated;
set local request.jwt.claims to '{"sub": "ffffffff-ffff-4fff-8fff-ffffffffffff", "role": "authenticated"}';

select lives_ok(
  $$ insert into public.strategy_reports (tenant_id, store_id, horizon, language, generated_via, title, content_markdown)
     values ('11111111-1111-4111-8111-111111111111', null, '90d', 'vi', 'skill', 'Published plan', '# Published plan') $$,
  'publisher inserts a tenant-wide plan for the own tenant'
);

select lives_ok(
  $$ insert into public.strategy_reports (tenant_id, store_id, horizon, language, generated_via, title, content_markdown)
     values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-000000000001', '30d', 'vi', 'routine', 'Store plan', '# Store plan') $$,
  'publisher inserts a store plan for a store of the own tenant'
);

select throws_ok(
  $$ insert into public.strategy_reports (tenant_id, store_id, horizon, language, generated_via, title, content_markdown)
     values ('99999999-9999-4999-8999-999999999999', null, '90d', 'vi', 'skill', 'Planted', '# Planted') $$,
  '42501',
  null,
  'publisher cannot insert a plan for another tenant'
);

select throws_ok(
  $$ insert into public.strategy_reports (tenant_id, store_id, horizon, language, generated_via, title, content_markdown, created_by)
     values ('11111111-1111-4111-8111-111111111111', null, '90d', 'vi', 'skill', 'Misattributed', '# Misattributed', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc') $$,
  '42501',
  null,
  'publisher cannot attribute a plan to another user'
);

select is((select count(*) from public.strategy_reports where title = 'Published plan'), 1::bigint, 'publisher reads the plan just published');
select is((select count(*) from public.tenants), 1::bigint, 'publisher reads the own tenant');
select is((select count(*) from public.stores), 2::bigint, 'publisher reads the stores of the own tenant');

select is((select count(*) from public.invoices), 0::bigint, 'publisher reads zero invoices');
select is((select count(*) from public.invoice_lines), 0::bigint, 'publisher reads zero invoice lines');
select is((select count(*) from public.invoice_payments), 0::bigint, 'publisher reads zero invoice payments');
select is((select count(*) from public.invoice_events), 0::bigint, 'publisher reads zero invoice events');
select is((select count(*) from public.shifts), 0::bigint, 'publisher reads zero shifts');
select is((select count(*) from public.customers), 0::bigint, 'publisher reads zero customers');
select is((select count(*) from public.item_costs), 0::bigint, 'publisher reads zero item costs');
select is((select count(*) from public.payment_fee_rates) + (select count(*) from public.targets) + (select count(*) from public.item_type_roles), 0::bigint, 'publisher reads zero rows of the other manual-input tables');

select throws_ok(
  $$ insert into public.item_costs (tenant_id, store_id, item_external_id, cost_amount, effective_from)
     values ('11111111-1111-4111-8111-111111111111', null, 'item-01', 1000, current_date) $$,
  '42501',
  null,
  'publisher cannot insert item costs'
);

select * from finish();
rollback;
