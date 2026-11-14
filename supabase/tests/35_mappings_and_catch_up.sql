begin;
select plan(29);

create temp table fixture as
select
  'dddddddd-dddd-4ddd-8ddd-000000000001'::uuid as tenant_id,
  'dddddddd-dddd-4ddd-8ddd-000000000011'::uuid as account_id,
  'dddddddd-dddd-4ddd-8ddd-000000000012'::uuid as second_account_id,
  'dddddddd-dddd-4ddd-8ddd-000000000021'::uuid as store_a,
  'dddddddd-dddd-4ddd-8ddd-000000000022'::uuid as store_b,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000000001'::uuid as other_tenant_id,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000000011'::uuid as other_account_id,
  'cccccccc-cccc-4ccc-8ccc-000000000001'::uuid as defaults_tenant_id,
  'eeeeeeee-eeee-4eee-8eee-000000000401'::uuid as owner_id,
  'eeeeeeee-eeee-4eee-8eee-000000000402'::uuid as manager_id,
  'eeeeeeee-eeee-4eee-8eee-000000000403'::uuid as store_owner_id,
  'eeeeeeee-eeee-4eee-8eee-000000000404'::uuid as store_manager_id,
  'eeeeeeee-eeee-4eee-8eee-000000000405'::uuid as staff_id,
  'eeeeeeee-eeee-4eee-8eee-000000000406'::uuid as viewer_id,
  'eeeeeeee-eeee-4eee-8eee-000000000407'::uuid as publisher_id,
  'eeeeeeee-eeee-4eee-8eee-000000000408'::uuid as other_owner_id;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated'::varchar, 'authenticated'::varchar, u.email::varchar
from fixture f
cross join lateral (
  values
    (f.owner_id, 'mapping-owner@example.com'),
    (f.manager_id, 'mapping-manager@example.com'),
    (f.store_owner_id, 'mapping-store-owner@example.com'),
    (f.store_manager_id, 'mapping-store-manager@example.com'),
    (f.staff_id, 'mapping-staff@example.com'),
    (f.viewer_id, 'mapping-viewer@example.com'),
    (f.publisher_id, 'mapping-publisher@example.com'),
    (f.other_owner_id, 'mapping-other-owner@example.com')
) as u (id, email);

insert into public.tenants (id, slug, name)
select tenant_id, 'theme-pgtap-mappings', 'Mappings' from fixture
union all
select other_tenant_id, 'theme-pgtap-mappings-other', 'Mappings Other' from fixture
union all
select defaults_tenant_id, 'theme-pgtap-mappings-defaults', 'Mappings Defaults' from fixture;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select f.tenant_id, f.owner_id, 'owner'::public.tenant_role, null::uuid[] from fixture f
union all select f.tenant_id, f.manager_id, 'manager', null from fixture f
union all select f.tenant_id, f.store_owner_id, 'owner', array[f.store_a] from fixture f
union all select f.tenant_id, f.store_manager_id, 'manager', array[f.store_a] from fixture f
union all select f.tenant_id, f.staff_id, 'staff', null from fixture f
union all select f.tenant_id, f.viewer_id, 'viewer', null from fixture f
union all select f.tenant_id, f.publisher_id, 'publisher', null from fixture f
union all select f.other_tenant_id, f.other_owner_id, 'owner', null from fixture f;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_id, tenant_id, 'mock', 'theme-pgtap-mappings', 'Mappings POS' from fixture
union all
select second_account_id, tenant_id, 'mock', 'theme-pgtap-mappings-2', 'Mappings POS 2' from fixture
union all
select other_account_id, other_tenant_id, 'mock', 'theme-pgtap-mappings-other', 'Mappings Other POS' from fixture;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name)
select store_a, tenant_id, account_id, 'mapping-a', 'Store A' from fixture
union all
select store_b, tenant_id, account_id, 'mapping-b', 'Store B' from fixture;

insert into public.item_types (tenant_id, pos_account_id, external_id, name)
select f.tenant_id, t.account_id, t.external_id, t.name
from fixture f
cross join lateral (
  values (f.account_id, 'DRINKS', 'Trà sữa'), (f.account_id, 'SNACKS', 'Đồ ăn vặt'), (f.second_account_id, 'OTHER', 'Khác')
) as t (account_id, external_id, name);

insert into public.payment_methods (tenant_id, pos_account_id, external_id, name, kind)
select tenant_id, account_id, 'WALLET', 'Ví', 'ewallet'::public.payment_kind from fixture;

insert into public.agg_daily_sales (tenant_id, store_id, business_date, invoices, net_amount)
select f.tenant_id, f.store_a, '2025-03-01'::date, 1, 1000 from fixture f;

grant select on fixture to authenticated;

insert into public.report_settings (tenant_id)
select defaults_tenant_id from fixture;

select is(
  (
    select array[
      s.menu_window_days::numeric, s.menu_popularity_factor, s.menu_low_sample_items, s.cash_abs_threshold,
      s.cash_rel_threshold, s.peak_hours, s.dead_hour_ratio, s.busy_hour_ratio, s.promo_pre_weeks, s.z_threshold
    ]
    from app.store_report_settings((select array[store_a] from fixture)) s
  ),
  (
    select array[
      i.menu_window_days::numeric, i.menu_popularity_factor, i.menu_low_sample_items, i.cash_abs_threshold,
      i.cash_rel_threshold, i.peak_hours, i.dead_hour_ratio, i.busy_hour_ratio, i.promo_pre_weeks, 2
    ]
    from public.report_settings i
    where i.tenant_id = (select defaults_tenant_id from fixture)
  ),
  'app.store_report_settings falls back to exactly the column defaults of report_settings'
);

select is(
  (select array[analytics_inputs_version::text, coalesce(analytics_pending_from::text, '-')] from public.tenants where id = (select tenant_id from fixture)),
  array['0', '-'],
  'a new tenant starts at version 0 with nothing pending'
);

set local role authenticated;

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000000402", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.report_settings (tenant_id, peak_hours) values ('dddddddd-dddd-4ddd-8ddd-000000000001', 4) $$,
  '42501',
  null,
  'a manager may not create the tenant''s report settings'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000000403", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.report_settings (tenant_id, peak_hours) values ('dddddddd-dddd-4ddd-8ddd-000000000001', 4) $$,
  '42501',
  null,
  'an owner limited to one store may not create the tenant''s report settings'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000000401", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.report_settings (tenant_id, peak_hours, created_by) values ('dddddddd-dddd-4ddd-8ddd-000000000001', 4, 'eeeeeeee-eeee-4eee-8eee-000000000402') $$,
  '42501',
  null,
  'nobody may create a row in another member''s name'
);

select lives_ok(
  $$ insert into public.report_settings (tenant_id, peak_hours, updated_by) values ('dddddddd-dddd-4ddd-8ddd-000000000001', 4, 'eeeeeeee-eeee-4eee-8eee-000000000402') $$,
  'the unlimited owner creates the report settings'
);

select is(
  (select array[created_by, updated_by] from public.report_settings where tenant_id = (select tenant_id from fixture)),
  (select array[owner_id, owner_id] from fixture),
  'updated_by is the caller even when the request names another member'
);

with changed as (
  update public.report_settings set peak_hours = 5, updated_by = 'eeeeeeee-eeee-4eee-8eee-000000000403'
  where tenant_id = (select tenant_id from fixture)
  returning updated_by
)
select is(
  (select array_agg(updated_by) from changed),
  (select array[owner_id] from fixture),
  'an update keeps updated_by on the caller'
);

select throws_ok(
  $$ update public.report_settings set peak_hours = 9 where tenant_id = 'dddddddd-dddd-4ddd-8ddd-000000000001' $$,
  '23514',
  null,
  'the table refuses more than six peak hours'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000000402", "role": "authenticated"}';

with changed as (update public.report_settings set peak_hours = 2 where tenant_id = (select tenant_id from fixture) returning 1)
select is(
  (select count(*)::int from changed),
  0,
  'a manager changes no report settings'
);

with removed as (delete from public.report_settings where tenant_id = (select tenant_id from fixture) returning 1)
select is(
  (select count(*)::int from removed),
  0,
  'a manager deletes no report settings'
);

select is(
  (select peak_hours from public.report_settings where tenant_id = (select tenant_id from fixture)),
  5::smallint,
  'a manager reads the report settings'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000000405", "role": "authenticated"}';

with changed as (update public.report_settings set peak_hours = 2 where tenant_id = (select tenant_id from fixture) returning 1)
select is(
  (select count(*)::int from changed),
  0,
  'staff change no report settings'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000000407", "role": "authenticated"}';

select is(
  (select count(*)::int from public.report_settings where tenant_id = (select tenant_id from fixture)),
  0,
  'the publisher reads no report settings'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000000408", "role": "authenticated"}';

with changed as (update public.report_settings set peak_hours = 2 where tenant_id = (select tenant_id from fixture) returning 1)
select is(
  (select count(*)::int from changed),
  0,
  'another tenant''s owner changes no report settings'
);

select throws_ok(
  $$ insert into public.item_category_overrides (tenant_id, pos_account_id, item_external_id, item_type_external_id) values ('dddddddd-dddd-4ddd-8ddd-000000000001', 'dddddddd-dddd-4ddd-8ddd-000000000011', 'ITEM-9', 'SNACKS') $$,
  '42501',
  null,
  'another tenant''s owner may not map an item'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000000404", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.item_category_overrides (tenant_id, pos_account_id, item_external_id, item_type_external_id) values ('dddddddd-dddd-4ddd-8ddd-000000000001', 'dddddddd-dddd-4ddd-8ddd-000000000011', 'ITEM-1', 'SNACKS') $$,
  '42501',
  null,
  'a manager limited to one store may not map an item'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000000406", "role": "authenticated"}';

select throws_ok(
  $$ insert into public.item_category_overrides (tenant_id, pos_account_id, item_external_id, item_type_external_id) values ('dddddddd-dddd-4ddd-8ddd-000000000001', 'dddddddd-dddd-4ddd-8ddd-000000000011', 'ITEM-1', 'SNACKS') $$,
  '42501',
  null,
  'a viewer may not map an item'
);

set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000000402", "role": "authenticated"}';

select lives_ok(
  $$ insert into public.item_category_overrides (tenant_id, pos_account_id, item_external_id, item_type_external_id) values ('dddddddd-dddd-4ddd-8ddd-000000000001', 'dddddddd-dddd-4ddd-8ddd-000000000011', 'ITEM-1', 'SNACKS') $$,
  'an unlimited manager maps an item to another type of its account'
);

select throws_ok(
  $$ insert into public.item_category_overrides (tenant_id, pos_account_id, item_external_id, item_type_external_id) values ('dddddddd-dddd-4ddd-8ddd-000000000001', 'dddddddd-dddd-4ddd-8ddd-000000000011', 'ITEM-2', 'OTHER') $$,
  '23503',
  null,
  'an item may not move to a type of another POS account'
);

select is(
  (select array[created_by, updated_by] from public.item_category_overrides where item_external_id = 'ITEM-1'),
  (select array[manager_id, manager_id] from fixture),
  'the override records who created and last changed it'
);

select is(
  (select array_agg(m.item_key || '>' || m.item_type_external_id || ':' || m.item_type_name) from app.item_category_map((select array[store_a, store_b] from fixture)) m),
  array['ITEM-1>SNACKS:Đồ ăn vặt'],
  'app.item_category_map lists the overrides of the visible stores'' accounts with the target type''s name'
);

reset role;

select is(
  (
    select array[
      analytics_inputs_version::text,
      analytics_pending_from::text,
      (analytics_pending_to = current_date + 1)::text,
      (analytics_inputs_changed_at is not null)::text
    ]
    from public.tenants where id = (select tenant_id from fixture)
  ),
  array['1', '2023-01-01', 'true', 'true'],
  'mapping an item moves the version and marks the whole history pending'
);

update public.tenants set analytics_pending_from = null, analytics_pending_to = null where id = (select tenant_id from fixture);

set local role authenticated;
set local request.jwt.claims to '{"sub": "eeeeeeee-eeee-4eee-8eee-000000000401", "role": "authenticated"}';

insert into public.item_type_roles (tenant_id, pos_account_id, item_type_external_id, role)
values ('dddddddd-dddd-4ddd-8ddd-000000000001', 'dddddddd-dddd-4ddd-8ddd-000000000011', 'DRINKS', 'drink');

select is(
  (
    select array[c.pending_from::text, (c.pending_to = current_date + 1)::text, (c.pending_days = current_date + 1 - date '2025-03-01' + 1)::text]
    from public.analytics_catch_up_status((select tenant_id from fixture)) c
  ),
  array['2025-03-01', 'true', 'true'],
  'a role change marks every day from the first aggregate date pending'
);

insert into public.payment_fee_rates (tenant_id, store_id, payment_method_external_id, fee_pct, effective_from)
values ('dddddddd-dddd-4ddd-8ddd-000000000001', null, 'WALLET', 1.1, '2023-01-01');

delete from public.item_category_overrides where item_external_id = 'ITEM-1';

reset role;

select is(
  (select analytics_inputs_version from public.tenants where id = (select tenant_id from fixture)),
  4::bigint,
  'a role, a fee rate and a removed override each move the version'
);

select is(
  (select analytics_inputs_version from public.tenants where id = (select other_tenant_id from fixture)),
  0::bigint,
  'another tenant''s version does not move'
);

select is(
  (select updated_by from public.payment_fee_rates where tenant_id = (select tenant_id from fixture)),
  (select owner_id from fixture),
  'a fee rate records who last changed it'
);

select throws_ok(
  $$ update public.tenants set analytics_pending_from = '2025-03-02', analytics_pending_to = '2025-03-01' where id = 'dddddddd-dddd-4ddd-8ddd-000000000001' $$,
  '23514',
  null,
  'the pending range never runs backwards'
);

select throws_ok(
  $$ update public.tenants set analytics_pending_from = '2025-03-02', analytics_pending_to = null where id = 'dddddddd-dddd-4ddd-8ddd-000000000001' $$,
  '23514',
  null,
  'the pending range has both ends or none'
);

select * from finish();
rollback;
