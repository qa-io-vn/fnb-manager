begin;
select plan(8);

insert into auth.users (id, instance_id, aud, role, email)
values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'viewer@example.com'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other-owner@example.com');

insert into public.tenant_members (tenant_id, user_id, role)
values ('11111111-1111-4111-8111-111111111111', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'viewer');

insert into public.tenants (id, slug, name)
values ('99999999-9999-4999-8999-999999999999', 'other-tenant', 'Other Tenant');

insert into public.tenant_members (tenant_id, user_id, role)
values ('99999999-9999-4999-8999-999999999999', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'owner');

set local role authenticated;
set local request.jwt.claims to '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date)
     values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-000000000001', '33333333-3333-4333-8333-000000000001', 'tran-forged', now(), current_date) $$,
  '42501',
  null,
  'authenticated owner cannot insert invoices'
);

select throws_ok(
  $$ update public.invoices set net_amount = 0 where external_id like 'tran-TEA-%' $$,
  '42501',
  null,
  'authenticated owner cannot update invoices'
);

select lives_ok(
  $$ insert into public.item_costs (tenant_id, store_id, item_external_id, cost_amount, effective_from)
     values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-000000000001', 'item-01', 12000, current_date) $$,
  'owner inserts an item cost for the own tenant'
);

select throws_ok(
  $$ insert into public.item_costs (tenant_id, store_id, item_external_id, cost_amount, effective_from)
     values ('99999999-9999-4999-8999-999999999999', null, 'item-01', 12000, current_date) $$,
  '42501',
  null,
  'owner cannot insert an item cost for another tenant'
);

select lives_ok(
  $$ insert into public.targets (tenant_id, store_id, period_kind, period_start, net_target_amount)
     values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-000000000001', 'week', date_trunc('week', current_date)::date, 60000000) $$,
  'owner inserts a weekly target for the own tenant'
);

select lives_ok(
  $$ insert into public.strategy_reports (tenant_id, store_id, horizon, language, generated_via, title, content_markdown)
     values ('11111111-1111-4111-8111-111111111111', null, '90d', 'en', 'pasted', 'Demo plan', '# Demo plan') $$,
  'owner inserts a strategy report for the own tenant'
);

set local request.jwt.claims to '{"sub": "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.item_costs (tenant_id, store_id, item_external_id, cost_amount, effective_from)
     values ('11111111-1111-4111-8111-111111111111', null, 'item-02', 12000, current_date) $$,
  '42501',
  null,
  'viewer cannot insert item costs'
);

select cmp_ok((select count(*) from public.item_costs), '>', 0::bigint, 'viewer can read item costs of the tenant');

select * from finish();
rollback;
