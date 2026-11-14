begin;
select plan(34);

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

create function pg_temp.item_summary_before(
  store_ids uuid[],
  from_date date,
  to_date date,
  compare_from date default null,
  compare_to date default null
)
returns table (
  item_external_id text,
  item_name text,
  base_name text,
  size_label text,
  item_type_external_id text,
  item_type_name text,
  role public.item_type_role,
  quantity numeric,
  net_amount numeric,
  invoices bigint,
  days_sold integer,
  net_share numeric,
  compare_quantity numeric,
  compare_net_amount numeric,
  compare_net_share numeric,
  first_sold_on date,
  last_sold_on date
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  max_range_days constant integer := 400;
  has_compare boolean := item_summary_before.compare_from is not null;
  returned_rows bigint;
begin
  perform app.require_store_ids('item_summary', item_summary_before.store_ids);
  perform app.require_date_range('item_summary', item_summary_before.from_date, item_summary_before.to_date, max_range_days);
  perform app.require_compare_range('item_summary', item_summary_before.compare_from, item_summary_before.compare_to, max_range_days);

  return query
  with store_rows as (
    select
      a.item_external_id as item_key,
      a.business_date as sold_on,
      a.item_name as row_item_name,
      a.base_name as row_base_name,
      a.size_label as row_size_label,
      a.item_type_external_id as row_type_id,
      a.item_type_name as row_type_name,
      a.quantity as row_quantity,
      a.net_amount as row_net_amount,
      a.invoices as row_invoices,
      a.business_date between item_summary_before.from_date and item_summary_before.to_date as in_current,
      coalesce(a.business_date between item_summary_before.compare_from and item_summary_before.compare_to, false) as in_compare
    from public.agg_item_daily a
    where a.store_id = any (item_summary_before.store_ids)
      and (
        a.business_date between item_summary_before.from_date and item_summary_before.to_date
        or a.business_date between item_summary_before.compare_from and item_summary_before.compare_to
      )
  ),
  per_item as (
    select
      r.item_key,
      bool_or(r.in_current) as sold_in_current,
      max(r.row_item_name) filter (where r.in_current) as current_item_name,
      max(r.row_item_name) filter (where r.in_compare) as compare_item_name,
      max(r.row_base_name) filter (where r.in_current) as current_base_name,
      max(r.row_base_name) filter (where r.in_compare) as compare_base_name,
      max(r.row_size_label) filter (where r.in_current) as current_size_label,
      max(r.row_size_label) filter (where r.in_compare) as compare_size_label,
      max(r.row_type_id) filter (where r.in_current) as current_type_id,
      max(r.row_type_id) filter (where r.in_compare) as compare_type_id,
      max(r.row_type_name) filter (where r.in_current) as current_type_name,
      max(r.row_type_name) filter (where r.in_compare) as compare_type_name,
      coalesce(sum(r.row_quantity) filter (where r.in_current), 0) as item_quantity,
      coalesce(sum(r.row_net_amount) filter (where r.in_current), 0) as item_net_amount,
      coalesce(sum(r.row_invoices) filter (where r.in_current), 0) as item_invoices,
      (count(distinct r.sold_on) filter (where r.in_current))::integer as item_days_sold,
      coalesce(sum(r.row_quantity) filter (where r.in_compare), 0) as item_compare_quantity,
      coalesce(sum(r.row_net_amount) filter (where r.in_compare), 0) as item_compare_net_amount
    from store_rows r
    group by r.item_key
  ),
  labelled as (
    select
      p.*,
      case when p.sold_in_current then p.current_type_id else p.compare_type_id end as chosen_type_id
    from per_item p
  ),
  range_totals as (
    select sum(p.item_net_amount) as current_net_total, sum(p.item_compare_net_amount) as compare_net_total
    from per_item p
  ),
  accounts as (
    select v.store_position, s.pos_account_id
    from app.visible_stores(item_summary_before.store_ids) v
    join public.stores s on s.id = v.store_id
  ),
  sold_dates as (
    select a.item_external_id as item_key, min(a.business_date) as first_on, max(a.business_date) as last_on
    from public.agg_item_daily a
    where a.store_id = any (item_summary_before.store_ids)
      and a.item_external_id in (select p.item_key from per_item p)
    group by a.item_external_id
  )
  select
    l.item_key,
    case when l.sold_in_current then l.current_item_name else l.compare_item_name end,
    case when l.sold_in_current then l.current_base_name else l.compare_base_name end,
    case when l.sold_in_current then l.current_size_label else l.compare_size_label end,
    l.chosen_type_id,
    case when l.sold_in_current then l.current_type_name else l.compare_type_name end,
    (
      select r.role
      from accounts ac
      join public.item_type_roles r
        on r.pos_account_id = ac.pos_account_id
        and r.item_type_external_id = l.chosen_type_id
      order by ac.store_position
      limit 1
    ),
    l.item_quantity,
    l.item_net_amount,
    l.item_invoices,
    l.item_days_sold,
    round(l.item_net_amount / nullif(t.current_net_total, 0), 6),
    case when has_compare then l.item_compare_quantity end,
    case when has_compare then l.item_compare_net_amount end,
    case when has_compare then round(l.item_compare_net_amount / nullif(t.compare_net_total, 0), 6) end,
    sd.first_on,
    sd.last_on
  from labelled l
  cross join range_totals t
  left join sold_dates sd on sd.item_key = l.item_key
  order by l.item_net_amount desc, l.item_quantity desc, l.item_key collate "C";

  get diagnostics returned_rows = row_count;
  perform app.require_report_rows('item_summary', returned_rows);
end;
$$;

create temp table seeded as
select
  '11111111-1111-4111-8111-111111111111'::uuid as tenant_id,
  '22222222-2222-4222-8222-000000000001'::uuid as tea_store,
  '22222222-2222-4222-8222-000000000002'::uuid as coffee_store,
  '33333333-3333-4333-8333-000000000001'::uuid as tea_account,
  (a.anchor - 7)::date as from_date,
  (a.anchor - 1)::date as to_date
from (select max(i.business_date) + 1 as anchor from public.invoices i where i.tenant_id = '11111111-1111-4111-8111-111111111111') as a;

delete from public.item_category_overrides where tenant_id = (select tenant_id from seeded);

select results_eq(
  $$ select i.* from seeded s cross join lateral public.item_summary(array[s.tea_store, s.coffee_store], s.from_date, s.to_date, s.from_date - 7, s.from_date - 1) i $$,
  $$ select i.* from seeded s cross join lateral pg_temp.item_summary_before(array[s.tea_store, s.coffee_store], s.from_date, s.to_date, s.from_date - 7, s.from_date - 1) i $$,
  'without overrides the rebuilt item_summary equals its phase 9 body for both stores with a comparison'
);

select results_eq(
  $$ select i.* from seeded s cross join lateral public.item_summary(array[s.coffee_store], s.to_date, s.to_date) i $$,
  $$ select i.* from seeded s cross join lateral pg_temp.item_summary_before(array[s.coffee_store], s.to_date, s.to_date) i $$,
  'without overrides the rebuilt item_summary equals its phase 9 body for one store and one day'
);

insert into public.item_category_overrides (tenant_id, pos_account_id, item_external_id, item_type_external_id)
select tenant_id, tea_account, 'item-15', 'type-03' from seeded;

select is(
  (
    select (
      (select (i.item_type_external_id, i.item_type_name, i.role)::text from public.item_summary(array[s.tea_store, s.coffee_store], s.from_date, s.to_date) i where i.item_external_id = 'item-15'),
      (select (i.item_type_external_id, i.item_type_name, i.role)::text from public.item_margins(array[s.tea_store, s.coffee_store], s.from_date, s.to_date) i where i.item_external_id = 'item-15'),
      (select (m.item_type_external_id, m.item_type_name, m.role, m.category_source)::text from public.menu_engineering(array[s.tea_store], s.to_date, 7) m where m.item_external_id = 'item-15')
    )
    from seeded s
  ),
  ('(type-03,Coffee,drink)'::text, '(type-03,Coffee,drink)'::text, '(type-03,Coffee,drink,override)'::text),
  'the next statement after an override shows the item under its new category in item_summary, item_margins and menu_engineering'
);

select is(
  (
    select (
      (select (i.item_type_external_id, i.role)::text from public.item_summary(array[s.coffee_store, s.tea_store], s.from_date, s.to_date) i where i.item_external_id = 'item-15'),
      (select (i.item_type_external_id, i.role)::text from public.item_margins(array[s.coffee_store, s.tea_store], s.from_date, s.to_date) i where i.item_external_id = 'item-15')
    )
    from seeded s
  ),
  ('(type-04,snack)'::text, '(type-04,snack)'::text),
  'one row per item takes the override of the POS account of the first requested store that sold it'
);

select is(
  (
    select (
      (select array_agg(m.role || ':' || m.item_type_external_id || ':' || m.category_source order by m.role) from public.menu_engineering(array[s.tea_store, s.coffee_store], s.to_date, 7) m where m.item_external_id = 'item-15'),
      (select array_agg(m.role || ':' || m.item_type_external_id || ':' || m.category_source order by m.role) from public.menu_engineering(array[s.coffee_store, s.tea_store], s.to_date, 7) m where m.item_external_id = 'item-15')
    )
    from seeded s
  ),
  (array['drink:type-03:override', 'snack:type-04:pos'], array['drink:type-03:override', 'snack:type-04:pos']),
  'menu_engineering applies an override to the sales of its own POS account only, whatever the store order'
);

select * from finish();
rollback;
