begin;
select plan(11);

create temp table fixture as
select
  '11111111-1111-4111-8111-111111111111'::uuid as demo_tenant_id,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid as demo_owner_id,
  '22222222-2222-4222-8222-000000000001'::uuid as tea_store_id,
  '22222222-2222-4222-8222-000000000002'::uuid as coffee_store_id,
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid as tea_staff_id,
  '99999999-9999-4999-8999-999999999999'::uuid as other_tenant_id,
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc'::uuid as other_owner_id,
  '88888888-8888-4888-8888-888888888888'::uuid as other_store_id,
  '77777777-7777-4777-8777-777777777777'::uuid as other_pos_account_id;

insert into auth.users (id, instance_id, aud, role, email)
select tea_staff_id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated'::varchar, 'authenticated'::varchar, 'staff@example.com'::varchar from fixture
union all
select other_owner_id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated'::varchar, 'authenticated'::varchar, 'other-owner@example.com'::varchar from fixture;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select demo_tenant_id, tea_staff_id, 'staff', array[tea_store_id] from fixture;

insert into public.tenants (id, slug, name)
select other_tenant_id, 'other-tenant', 'Other Tenant' from fixture;

insert into public.tenant_members (tenant_id, user_id, role)
select other_tenant_id, other_owner_id, 'owner' from fixture;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select other_pos_account_id, other_tenant_id, 'ipos-fabi', 'other-account', 'Other POS' from fixture;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select other_store_id, other_tenant_id, other_pos_account_id, 'store-ext-999', 'Store A' from fixture;

insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, net_amount, paid_amount)
select other_tenant_id, other_store_id, other_pos_account_id, 'tran-other-' || n, now(), current_date, 10000, 10000, 10000
from fixture cross join generate_series(1, 3) as n;

create temp table expected as
select
  (select count(*) from public.invoices where tenant_id = f.demo_tenant_id) as demo_invoices,
  (select count(*) from public.invoices where store_id = f.tea_store_id) as tea_invoices,
  (select count(*) from public.invoices where tenant_id = f.other_tenant_id) as other_invoices
from fixture f;

grant select on fixture, expected to authenticated;

set local role authenticated;
set local request.jwt.claims to '{"sub": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "role": "authenticated"}';

select is((select count(*) from public.invoices), (select demo_invoices from expected), 'demo owner sees every demo invoice');
select is((select count(*) from public.invoices where tenant_id = (select other_tenant_id from fixture)), 0::bigint, 'demo owner sees no invoice of the other tenant');
select is((select count(*) from public.tenants), 1::bigint, 'demo owner sees only the demo tenant');
select is((select count(*) from public.stores), 2::bigint, 'demo owner sees both demo stores');
select is((select count(*) from public.invoice_lines where tenant_id = (select other_tenant_id from fixture)), 0::bigint, 'demo owner sees no lines of the other tenant');
select cmp_ok((select count(*) from public.shifts), '>', 0::bigint, 'demo owner sees demo shifts');

set local request.jwt.claims to '{"sub": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "role": "authenticated"}';

select is((select count(*) from public.invoices), (select tea_invoices from expected), 'tea staff sees exactly the tea store invoices');
select is((select count(distinct store_id) from public.invoices), 1::bigint, 'tea staff sees invoices of a single store');
select is((select count(*) from public.stores), 1::bigint, 'tea staff sees a single store');
select is((select count(*) from public.invoices where store_id = (select coffee_store_id from fixture)), 0::bigint, 'tea staff sees no coffee bar invoice');

set local request.jwt.claims to '{"sub": "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "role": "authenticated"}';

select is((select count(*) from public.invoices), (select other_invoices from expected), 'other owner sees only the other tenant invoices');

select * from finish();
rollback;
