-- The native till, step 1 (ADR-060, native-till.md section 3): the owned menu, its constraints, the append-only price
-- log, the one-time import from the POS catalogue, per-store availability and the sold-out switch, the menu-photos
-- policies and the menu reads of the customer app and the counter.
-- Techniques: equivalence partitions and boundaries (name 60/61, description 200/201, price 1 and 100,000,000 and one
-- past, option amount 1,000,000 and one past, select limits), a decision table of what the customer menu shows (on
-- sale x category visible x restricted x size active x offered x sold out x order type), state transitions of the
-- import (empty -> imported -> refused) and the sold-out switch (available -> sold out -> available), and authorisation
-- by role and scope (owner, store-limited owner, manager, store-limited manager, staff, viewer, other tenant, customer).
begin;
select plan(130);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000026001'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000026002'::uuid as tenant_b,
  'cccccccc-cccc-4ccc-8ccc-000000026001'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000026002'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000026001'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000026002'::uuid as store_a2,
  'ffffffff-ffff-4fff-8fff-000000026003'::uuid as store_b1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000026001'::uuid as brand_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000026002'::uuid as brand_b,
  '99999999-9999-4999-8999-000000026001'::uuid as app_a,
  '99999999-9999-4999-8999-000000026002'::uuid as app_b,
  'eeeeeeee-eeee-4eee-8eee-000000026001'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000026002'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000026003'::uuid as manager_a1_u,
  'eeeeeeee-eeee-4eee-8eee-000000026004'::uuid as viewer_u,
  'eeeeeeee-eeee-4eee-8eee-000000026005'::uuid as staff_u,
  'eeeeeeee-eeee-4eee-8eee-000000026006'::uuid as owner_a1_u,
  'eeeeeeee-eeee-4eee-8eee-000000026007'::uuid as owner_b_u,
  'eeeeeeee-eeee-4eee-8eee-000000026008'::uuid as staff_a2_u,
  'eeeeeeee-eeee-4eee-8eee-000000026011'::uuid as customer_u,
  'eeeeeeee-eeee-4eee-8eee-000000026012'::uuid as customer_b_u,
  timestamptz '2026-11-25 10:00:00+07' as noon;
grant select on fx to authenticated, anon;

-- The outcome of a statement run as a caller: rows:<n> for a command, the first column for a query, or the SQLSTATE.
-- A customer caller passes the tenant of its session.
create function pg_temp.as_user(p_user uuid, p_statement text, p_customer_tenant uuid default null)
returns text
language plpgsql
as $$
declare
  v_value text;
  v_rows integer;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated',
    'app_metadata', case when p_customer_tenant is null then '{}'::jsonb else jsonb_build_object('kind', 'customer', 'tenant_id', p_customer_tenant) end)::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    if p_statement ~* '^\s*select' then
      execute p_statement into v_value;
      v_value := coalesce(v_value, 'null');
    else
      execute p_statement;
      get diagnostics v_rows = row_count;
      v_value := 'rows:' || v_rows;
    end if;
  exception when others then
    v_value := sqlstate;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_value;
end;
$$;

-- Sets the claims of a customer session without switching role, to call an app half at a fixed instant.
create function pg_temp.customer_claims(p_user uuid, p_tenant uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated',
    'app_metadata', jsonb_build_object('kind', 'customer', 'tenant_id', p_tenant))::text, true);
$$;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'native-260-' || right(u.id::text, 4) || '@example.com',
  case when u.customer_of is null then '{}'::jsonb else jsonb_build_object('kind', 'customer', 'tenant_id', u.customer_of) end
from fx cross join lateral (values
  (fx.owner_u, null::uuid), (fx.manager_u, null), (fx.manager_a1_u, null), (fx.viewer_u, null), (fx.staff_u, null),
  (fx.owner_a1_u, null), (fx.owner_b_u, null), (fx.staff_a2_u, null), (fx.customer_u, fx.tenant_a), (fx.customer_b_u, fx.tenant_b)
) as u (id, customer_of);
insert into public.tenants (id, slug, name)
select tenant_a, 'native-260-a', 'Native 260 A' from fx union all
select tenant_b, 'native-260-b', 'Native 260 B' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'native-260-a', 'Synthetic account A' from fx union all
select account_b, tenant_b, 'mock', 'native-260-b', 'Synthetic account B' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name, opening_hours)
select store_a1, tenant_a, account_a, 'n260-a1', 'sa-1', 'Synthetic store A1', '{"wed": [["07:00", "22:00"]]}'::jsonb from fx union all
select store_a2, tenant_a, account_a, 'n260-a2', 'sa-2', 'Synthetic store A2', '{"wed": [["07:00", "22:00"]]}'::jsonb from fx union all
select store_b1, tenant_b, account_b, 'n260-b1', 'sb-1', 'Synthetic store B1', '{"wed": [["07:00", "22:00"]]}'::jsonb from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_a, m.user_id, m.role::public.tenant_role, m.store_ids
from fx cross join lateral (values
  (fx.owner_u, 'owner', null::uuid[]), (fx.manager_u, 'manager', null), (fx.manager_a1_u, 'manager', array[fx.store_a1]),
  (fx.viewer_u, 'viewer', null), (fx.staff_u, 'staff', array[fx.store_a1]), (fx.owner_a1_u, 'owner', array[fx.store_a1]),
  (fx.staff_a2_u, 'staff', array[fx.store_a2])
) as m (user_id, role, store_ids)
union all
select tenant_b, owner_b_u, 'owner', null from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_a, tenant_a, 'brand-1', 'Synthetic brand A', array[store_a1, store_a2] from fx union all
select brand_b, tenant_b, 'brand-1', 'Synthetic brand B', array[store_b1] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_a, tenant_a, brand_a, 'synthetic-260-app-a', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx union all
select app_b, tenant_b, brand_b, 'synthetic-260-app-b', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id)
select tenant_a, app_a, 'syn-zalo-260-1', customer_u from fx union all
select tenant_b, app_b, 'syn-zalo-260-2', customer_b_u from fx;

-- The POS catalogue of account A, the import's source.
insert into public.item_types (tenant_id, pos_account_id, external_id, name)
select tenant_a, account_a, v.ext, v.name from fx cross join lateral (values ('T-DRINK', 'Đồ uống'), ('T-BEER', 'Bia'), ('T-FOOD', 'Món ăn')) as v (ext, name);
insert into public.items (tenant_id, pos_account_id, external_id, name, base_name, size_label, item_type_external_id, list_price, is_modifier, active)
select fx.tenant_a, fx.account_a, v.ext, v.name, v.base, v.size, v.type, v.price, v.modifier, v.active
from fx cross join lateral (values
  ('TS-M', 'Trà sữa M', 'Trà sữa', 'M', 'T-DRINK', 35000.00, false, true),
  ('TS-L', 'Trà sữa L', 'Trà sữa', 'L', 'T-DRINK', 42000.00, false, true),
  ('CF', 'Cà phê đen', 'Cà phê đen', null, 'T-DRINK', 29000.00, false, true),
  ('BEER', 'Bia lon', 'Bia lon', null, 'T-BEER', 25000.00, false, true),
  ('BANH', 'Bánh mì', 'Bánh mì', null, 'T-FOOD', 30000.00, false, true),
  ('MOD', 'Ít đá', 'Ít đá', null, 'T-DRINK', 0, true, true),
  ('OFF', 'Món ngừng', 'Món ngừng', null, 'T-FOOD', 30000.00, false, false),
  ('ZERO', 'Món giá 0', 'Món giá 0', null, 'T-FOOD', 0, false, true),
  ('TOP1', 'Trân châu', 'Trân châu', null, 'T-DRINK', 5000.00, false, true),
  ('TOP2', 'Thạch', 'Thạch', null, 'T-DRINK', 0, true, true)
) as v (ext, name, base, size, type, price, modifier, active);
insert into public.store_items (tenant_id, store_id, item_external_id, list_price) select tenant_a, store_a1, 'CF', 31000 from fx;
insert into public.item_option_groups (tenant_id, pos_account_id, external_id, name, min_select, max_select)
select tenant_a, account_a, 'G1:0', 'Topping', 0, 2 from fx union all
select tenant_a, account_a, 'G2:0', 'Đường', 1, 1 from fx;
insert into public.item_option_group_options (tenant_id, pos_account_id, group_external_id, item_external_id, sort_order)
select tenant_a, account_a, 'G1:0', 'TOP1', 0 from fx union all
select tenant_a, account_a, 'G1:0', 'TOP2', 1 from fx union all
select tenant_a, account_a, 'G2:0', 'MOD', 0 from fx;
insert into public.item_option_group_targets (tenant_id, pos_account_id, group_external_id, item_external_id)
select tenant_a, account_a, 'G1:0', 'TS-M' from fx union all
select tenant_a, account_a, 'G1:0', 'TS-L' from fx union all
select tenant_a, account_a, 'G2:0', 'ZERO' from fx;

-- 1. Structure and privileges --------------------------------------------------------------------------------------
select ok(
  (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('menu_categories', 'menu_items', 'menu_item_sizes', 'menu_option_groups', 'menu_options',
     'menu_item_option_groups', 'menu_store_items', 'menu_price_changes', 'menu_imports', 'store_ordering_settings', 'ordering_closures',
     'item_option_groups', 'item_option_group_options', 'item_option_group_targets')),
  'every new public table has row level security'
);
select ok(
  not has_table_privilege('authenticated', 'app.menu_versions', 'select') and not has_table_privilege('authenticated', 'app.ordering_presence', 'select')
  and not has_table_privilege('service_role', 'app.menu_versions', 'select'),
  'no API role reads the menu versions or the presence'
);
select ok(
  not has_table_privilege('authenticated', 'public.menu_price_changes', 'insert') and not has_table_privilege('authenticated', 'public.menu_price_changes', 'update')
  and not has_table_privilege('authenticated', 'public.menu_price_changes', 'delete') and not has_table_privilege('authenticated', 'public.menu_imports', 'insert'),
  'no client writes the price log or the import record'
);
select ok(
  not has_table_privilege('authenticated', 'public.item_option_groups', 'insert') and not has_table_privilege('authenticated', 'public.item_option_group_targets', 'delete'),
  'the POS option groups are written by the sync only'
);
select ok(
  not has_function_privilege('authenticated', 'app.customer_menu(text, text, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'app.import_menu_from_pos(uuid, uuid, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.customer_menu(text, text)', 'execute')
  and not has_function_privilege('anon', 'public.counter_menu(uuid)', 'execute'),
  'the app halves are closed to clients and anon executes no wrapper'
);

-- 2. The one-time import -----------------------------------------------------------------------------------------
select is(pg_temp.as_user((select manager_u from fx), format($$select public.import_menu_from_pos(%L, %L)::text$$, (select brand_a from fx), (select store_a1 from fx))), '42501', 'a manager cannot import the menu');
select is(pg_temp.as_user((select owner_a1_u from fx), format($$select public.import_menu_from_pos(%L, %L)::text$$, (select brand_a from fx), (select store_a1 from fx))), '42501', 'an owner without every store of the brand cannot import');
select is(pg_temp.as_user((select owner_b_u from fx), format($$select public.import_menu_from_pos(%L, %L)::text$$, (select brand_a from fx), (select store_a1 from fx))), '42501', 'another tenant''s owner cannot import');
select is(pg_temp.as_user((select owner_u from fx), format($$select public.import_menu_from_pos(%L, %L)::text$$, (select brand_a from fx), (select store_b1 from fx))), '22023', 'a store of another brand is refused');
create temp table import_1 as select pg_temp.as_user((select owner_u from fx), format($$select public.import_menu_from_pos(%L, %L)::text$$, (select brand_a from fx), (select store_a1 from fx)))::jsonb as r;
select is((select r ->> 'state' from import_1), 'imported', 'an owner with every store imports the menu');
select is((select r -> 'counts' from import_1), '{"items": 4, "sizes": 5, "options": 2, "categories": 3, "restricted": 1, "option_groups": 1}'::jsonb, 'the import answers its counts');
select is(
  (select string_agg(c.name, ',' order by c.sort_order) from public.menu_categories c where c.brand_id = (select brand_a from fx)),
  'Bia,Đồ uống,Món ăn', 'one category per POS item type, in name order'
);
select is(
  (select string_agg(coalesce(z.label, '-') || '=' || z.price::bigint || case when z.is_default then '*' else '' end, ',' order by z.sort_order)
   from public.menu_item_sizes z join public.menu_items i on i.id = z.item_id where i.name = 'Trà sữa'),
  'M=35000*,L=42000', 'two POS sizes of one base name become one item with two sizes, the cheapest the default'
);
select is((select z.price from public.menu_item_sizes z join public.menu_items i on i.id = z.item_id where i.name = 'Cà phê đen'), 31000.00, 'the store''s POS price wins over the item''s');
select is((select coalesce(z.label, 'null') from public.menu_item_sizes z join public.menu_items i on i.id = z.item_id where i.name = 'Cà phê đen'), 'null', 'a single size has no label');
select is((select visible::text || '/' || restricted::text from public.menu_items where name = 'Bia lon'), 'false/true', 'beer is restricted and hidden');
select ok((select bool_and(visible) from public.menu_items where brand_id = (select brand_a from fx) and not restricted), 'every other imported item is on sale');
select ok(
  not exists (select 1 from public.menu_items i join public.menu_item_sizes z on z.item_id = i.id where z.source_item_external_id in ('MOD', 'OFF', 'ZERO', 'TOP1', 'TOP2')),
  'modifiers, inactive and unpriced items and option items are not imported as items'
);
select is(
  (select g.name || ' ' || g.min_select || '-' || g.max_select || ': ' || string_agg(o.name || '=' || o.price_delta::bigint, ',' order by o.sort_order)
   from public.menu_option_groups g join public.menu_options o on o.group_id = g.id where g.brand_id = (select brand_a from fx) group by g.id),
  'Topping 0-2: Trân châu=5000,Thạch=0', 'the POS option group targeting an imported item becomes a group whose options cost their POS price'
);
select is(
  (select string_agg(i.name, ',') from public.menu_item_option_groups l join public.menu_items i on i.id = l.item_id where i.tenant_id = (select tenant_a from fx)),
  'Trà sữa', 'the group is linked to the items it targets'
);
select is((select counts ->> 'items' from public.menu_imports where brand_id = (select brand_a from fx)) || '/' || (select imported_by::text from public.menu_imports where brand_id = (select brand_a from fx)), '4/' || (select owner_u from fx)::text, 'the import is recorded with who ran it');
select is(pg_temp.as_user((select owner_u from fx), format($$select public.import_menu_from_pos(%L, %L) ->> 'refusal'$$, (select brand_a from fx), (select store_a1 from fx))), 'already_imported', 'a second import is refused as data');
insert into public.menu_categories (tenant_id, brand_id, name) select tenant_b, brand_b, 'Đồ uống' from fx;
insert into public.menu_items (tenant_id, brand_id, category_id, name)
select tenant_b, brand_b, (select id from public.menu_categories where brand_id = (select brand_b from fx)), 'Món tự thêm' from fx;
select is(pg_temp.as_user((select owner_b_u from fx), format($$select public.import_menu_from_pos(%L, %L) ->> 'refusal'$$, (select brand_b from fx), (select store_b1 from fx))), 'menu_not_empty', 'an import into a menu that has items is refused as data');

-- 3. The price log -------------------------------------------------------------------------------------------------
select is((select count(*)::int from public.menu_price_changes where brand_id = (select brand_a from fx) and old_price is null), 7, 'the import logs every size price and option amount it set');
update public.menu_item_sizes set price = 37000 where label = 'M';
select is(
  (select subject_name || ':' || old_price::bigint || '->' || new_price::bigint from public.menu_price_changes where new_price = 37000),
  'Trà sữa (M):35000->37000', 'a price change is logged with the old and new price'
);
select is(
  pg_temp.as_user((select manager_u from fx), $$update public.menu_options set price_delta = 6000 where name = 'Trân châu'$$), 'rows:1', 'a manager changes an option amount'
);
select is((select changed_by from public.menu_price_changes where new_price = 6000), (select manager_u from fx), 'the log names who changed the price');
update public.menu_item_sizes set sort_order = 15 where label = 'M';
select is((select count(*)::int from public.menu_price_changes where brand_id = (select brand_a from fx)), 9, 'a change that keeps the price writes no log row');
select throws_ok($$update public.menu_price_changes set new_price = 1$$, '42501', null, 'the price log refuses an update, even to the owner of the database');
select throws_ok($$delete from public.menu_price_changes$$, '42501', null, 'the price log refuses a delete');
select throws_ok($$truncate public.menu_price_changes$$, '42501', null, 'the price log refuses a truncate');
delete from public.menu_items where name = 'Bánh mì';
select is((select count(*)::int from public.menu_price_changes where subject_name = 'Bánh mì'), 1, 'deleting an item keeps its price log');
select is(pg_temp.as_user((select viewer_u from fx), 'select count(*) from public.menu_price_changes'), '9', 'a viewer reads the price log');
select is(pg_temp.as_user((select staff_u from fx), 'select count(*) from public.menu_price_changes'), '0', 'staff read no price log');

-- 4. Constraints: partitions and boundaries ------------------------------------------------------------------------
create function pg_temp.outcome(p_statement text)
returns text language plpgsql as $$
begin
  execute p_statement;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;
select is(pg_temp.outcome(v.stmt), v.expected, v.label)
from (values
  ($$update public.menu_items set name = repeat('a', 60) where name = 'Cà phê đen'$$, 'ok', 'an item name of 60 characters is kept'),
  ($$update public.menu_items set name = repeat('a', 61) where name = repeat('a', 60)$$, '23514', 'an item name of 61 characters is refused'),
  ($$update public.menu_items set name = 'Cà phê đen' where name = repeat('a', 60)$$, 'ok', 'the name is set back'),
  ($$update public.menu_items set description = repeat('d', 200) where name = 'Cà phê đen'$$, 'ok', 'a description of 200 characters is kept'),
  ($$update public.menu_items set description = repeat('d', 201) where name = 'Cà phê đen'$$, '23514', 'a description of 201 characters is refused'),
  ($$update public.menu_items set description = 'hai' || chr(10) || 'dòng' where name = 'Cà phê đen'$$, '23514', 'a description with a line break is refused'),
  ($$update public.menu_items set description = 'xem www.example.com' where name = 'Cà phê đen'$$, '23514', 'a description with a link is refused'),
  ($$update public.menu_items set description = 'gọi 0901 234 567' where name = 'Cà phê đen'$$, '23514', 'a description with a phone number is refused'),
  ($$update public.menu_items set description = 'Giảm 20.000đ cho đơn 100.000đ' where name = 'Cà phê đen'$$, 'ok', 'a description with prices is kept'),
  ($$update public.menu_items set labels = array['best_seller', 'new'] where name = 'Cà phê đen'$$, 'ok', 'both labels are kept'),
  ($$update public.menu_items set labels = array['hot'] where name = 'Cà phê đen'$$, '23514', 'an unknown label is refused'),
  ($$update public.menu_items set labels = array['new', 'new'] where name = 'Cà phê đen'$$, '23514', 'a label twice is refused'),
  ($$update public.menu_items set visible = true where name = 'Bia lon'$$, '23514', 'a restricted item can never be on sale'),
  ($$update public.menu_items set order_types = array['delivery'] where name = 'Cà phê đen'$$, '23514', 'delivery is not an order type of the native till yet'),
  ($$update public.menu_item_sizes set price = 1 where label = 'L'$$, 'ok', 'a price of 1 dong is kept'),
  ($$update public.menu_item_sizes set price = 0 where label = 'L'$$, '23514', 'a price of 0 is refused'),
  ($$update public.menu_item_sizes set price = 100000000 where label = 'L'$$, 'ok', 'a price of 100,000,000 is kept'),
  ($$update public.menu_item_sizes set price = 100000001 where label = 'L'$$, '23514', 'a price of 100,000,001 is refused'),
  ($$update public.menu_item_sizes set price = 42000.5 where label = 'L'$$, '23514', 'a price with a fraction is refused'),
  ($$update public.menu_item_sizes set price = 42000 where label = 'L'$$, 'ok', 'the price is set back'),
  ($$update public.menu_item_sizes set label = 'm' where label = 'L'$$, '23505', 'two sizes of an item with one label (any case) are refused'),
  ($$update public.menu_item_sizes set is_default = true where label = 'L'$$, '23505', 'an item has one default size'),
  ($$update public.menu_options set price_delta = 1000000 where name = 'Thạch'$$, 'ok', 'an option amount of 1,000,000 is kept'),
  ($$update public.menu_options set price_delta = 1000001 where name = 'Thạch'$$, '23514', 'an option amount of 1,000,001 is refused'),
  ($$update public.menu_options set price_delta = -1 where name = 'Thạch'$$, '23514', 'a negative option amount is refused'),
  ($$update public.menu_option_groups set min_select = 3 where name = 'Topping'$$, '23514', 'a group needing more than it allows is refused'),
  ($$update public.menu_option_groups set max_select = 21 where name = 'Topping'$$, '23514', 'a group of 21 choices is refused'),
  ($$update public.menu_option_groups set max_select = 0 where name = 'Topping'$$, '23514', 'a group of 0 choices is refused'),
  ($$update public.menu_items set category_id = (select id from public.menu_categories where brand_id = 'bbbbbbbb-bbbb-4bbb-8bbb-000000026002') where name = 'Cà phê đen'$$, '23503', 'an item cannot move into another brand''s category'),
  ($$update public.menu_items set brand_id = 'bbbbbbbb-bbbb-4bbb-8bbb-000000026002' where name = 'Cà phê đen'$$, '22023', 'an item keeps its brand'),
  ($$delete from public.menu_categories where name = 'Đồ uống' and brand_id = 'bbbbbbbb-bbbb-4bbb-8bbb-000000026001'$$, '23503', 'a category that holds items cannot be deleted')
) as v (stmt, expected, label);

-- 5. Who writes the menu ----------------------------------------------------------------------------------------
select is(pg_temp.as_user((select manager_u from fx), $$update public.menu_items set sort_order = 5 where name = 'Cà phê đen'$$), 'rows:1', 'a manager with every store of the brand edits an item');
select is(pg_temp.as_user((select manager_a1_u from fx), $$update public.menu_items set sort_order = 6 where name = 'Cà phê đen'$$), 'rows:0', 'a manager of one of the brand''s two stores edits nothing of its menu');
select is(pg_temp.as_user((select owner_a1_u from fx), $$update public.menu_item_sizes set price = 1000 where label = 'L'$$), 'rows:0', 'an owner of one of the two stores changes no price');
select is(pg_temp.as_user((select viewer_u from fx), $$update public.menu_items set sort_order = 6 where name = 'Cà phê đen'$$), 'rows:0', 'a viewer edits nothing');
select is(pg_temp.as_user((select owner_b_u from fx), $$update public.menu_items set sort_order = 6 where name = 'Cà phê đen'$$), 'rows:0', 'another tenant''s owner edits nothing');
select is(pg_temp.as_user((select viewer_u from fx), 'select count(*) from public.menu_items where brand_id = ''bbbbbbbb-bbbb-4bbb-8bbb-000000026001'''), '3', 'a viewer reads the menu');
select is(pg_temp.as_user((select staff_u from fx), 'select count(*) from public.menu_items'), '0', 'staff read the menu only through the counter functions');
select is(pg_temp.as_user((select customer_u from fx), 'select count(*) from public.menu_items', (select tenant_a from fx)), '0', 'a customer session reads no menu row directly');
select is(
  pg_temp.as_user((select manager_u from fx), format($$insert into public.menu_categories (tenant_id, brand_id, name) values (%L, %L, 'Bánh ngọt')$$, (select tenant_a from fx), (select brand_a from fx))),
  'rows:1', 'a manager adds a category'
);
select is(
  pg_temp.as_user((select manager_u from fx), format($$insert into public.menu_categories (tenant_id, brand_id, name, created_by) values (%L, %L, 'Khác', %L)$$, (select tenant_a from fx), (select brand_a from fx), (select owner_u from fx))),
  '42501', 'the author of a row is not written by the client'
);
select is(
  pg_temp.as_user((select manager_u from fx), $$update public.menu_items set source_item_external_id = 'X' where name = 'Cà phê đen'$$),
  '42501', 'the import provenance is not writable'
);
select is(
  pg_temp.as_user((select manager_a1_u from fx), format($$insert into public.menu_store_items (tenant_id, store_id, item_id, offered) values (%L, %L, (select id from public.menu_items where name = 'Cà phê đen'), false)$$, (select tenant_a from fx), (select store_a1 from fx))),
  'rows:1', 'a store-limited manager switches an item off at its own store'
);
select is(
  pg_temp.as_user((select manager_a1_u from fx), format($$insert into public.menu_store_items (tenant_id, store_id, item_id, offered) values (%L, %L, (select id from public.menu_items where name = 'Cà phê đen'), false)$$, (select tenant_a from fx), (select store_a2 from fx))),
  '42501', 'a store-limited manager cannot switch an item off at another store'
);
select is(
  pg_temp.outcome(format($$insert into public.menu_store_items (tenant_id, store_id, item_id) values (%L, %L, (select id from public.menu_items where name = 'Món tự thêm'))$$, (select tenant_a from fx), (select store_a1 from fx))),
  '23503', 'an item of another brand cannot be offered at the store'
);
delete from public.menu_store_items;

-- 6. The customer menu: what it shows ---------------------------------------------------------------------------
insert into public.store_ordering_settings (store_id, tenant_id, till_mode, ordering_enabled, order_types, staff_presence_required)
select store_a1, tenant_a, 'native', true, array['table', 'takeaway'], false from fx union all
select store_a2, tenant_a, 'ipos', true, array['table'], false from fx;
insert into public.menu_items (tenant_id, brand_id, category_id, name, order_types)
select tenant_a, brand_a, (select id from public.menu_categories where name = 'Đồ uống' and brand_id = brand_a), 'Món mang đi', array['takeaway'] from fx;
insert into public.menu_item_sizes (tenant_id, brand_id, item_id, price, is_default)
select tenant_a, brand_a, (select id from public.menu_items where name = 'Món mang đi'), 40000, true from fx;
insert into public.menu_items (tenant_id, brand_id, category_id, name, visible)
select tenant_a, brand_a, (select id from public.menu_categories where name = 'Đồ uống' and brand_id = brand_a), 'Món tạm ẩn', false from fx;
insert into public.menu_item_sizes (tenant_id, brand_id, item_id, price) select tenant_a, brand_a, (select id from public.menu_items where name = 'Món tạm ẩn'), 40000 from fx;
insert into public.menu_categories (tenant_id, brand_id, name, visible) select tenant_a, brand_a, 'Mục ẩn', false from fx;
insert into public.menu_items (tenant_id, brand_id, category_id, name)
select tenant_a, brand_a, (select id from public.menu_categories where name = 'Mục ẩn'), 'Món mục ẩn' from fx;
insert into public.menu_item_sizes (tenant_id, brand_id, item_id, price) select tenant_a, brand_a, (select id from public.menu_items where name = 'Món mục ẩn'), 40000 from fx;
insert into public.menu_items (tenant_id, brand_id, category_id, name)
select tenant_a, brand_a, (select id from public.menu_categories where name = 'Đồ uống' and brand_id = brand_a), 'Món cỡ tắt' from fx;
insert into public.menu_item_sizes (tenant_id, brand_id, item_id, price, active) select tenant_a, brand_a, (select id from public.menu_items where name = 'Món cỡ tắt'), 40000, false from fx;
insert into public.menu_store_items (tenant_id, store_id, item_id, offered)
select tenant_a, store_a1, (select id from public.menu_items where name = 'Cà phê đen'), false from fx;

select pg_temp.customer_claims((select customer_u from fx), (select tenant_a from fx));
create temp table menu_any as select app.customer_menu('sa-1', null, (select noon from fx)) as m;
create temp table menu_table as select app.customer_menu('sa-1', 'table', (select noon from fx)) as m;
create temp table menu_ipos as select app.customer_menu('sa-2', null, (select noon from fx)) as m;
select set_config('request.jwt.claims', '', true);
create temp table shown as
select i ->> 'name' as name, i -> 'sizes' as sizes, i -> 'option_group_ids' as groups, (i ->> 'id')::uuid as id
from menu_any, jsonb_array_elements(m -> 'categories') c, jsonb_array_elements(c -> 'items') i;

select is((select string_agg(name, ',' order by name) from shown), 'Món mang đi,Trà sữa', 'the menu shows the items on sale and available: rule all-true');
select ok(not exists (select 1 from shown where name = 'Món tạm ẩn'), 'rule: an item not on sale is left out');
select ok(not exists (select 1 from shown where name = 'Món mục ẩn'), 'rule: an item of a hidden category is left out');
select ok(not exists (select 1 from shown where name = 'Bia lon'), 'rule: a restricted item is left out');
select ok(not exists (select 1 from shown where name = 'Món cỡ tắt'), 'rule: an item without an active size is left out');
select ok(not exists (select 1 from shown where name = 'Cà phê đen'), 'rule: an item the store does not offer is left out');
select ok(
  (select m -> 'unavailable_items' from menu_any) ? (select id::text from public.menu_items where name = 'Cà phê đen'),
  'an item on sale that the store does not offer is listed as unavailable'
);
select is(
  (select string_agg(i ->> 'name', ',') from menu_table, jsonb_array_elements(m -> 'categories') c, jsonb_array_elements(c -> 'items') i),
  'Trà sữa', 'rule: a takeaway-only item is left out of the table menu'
);
select is((select sizes from shown where name = 'Trà sữa'), (select jsonb_agg(jsonb_build_object('id', z.id, 'label', z.label, 'price', z.price::bigint, 'is_default', z.is_default) order by z.sort_order) from public.menu_item_sizes z join public.menu_items i on i.id = z.item_id where i.name = 'Trà sữa'), 'every size price on the menu equals the menu''s price');
select is((select jsonb_array_length(groups) from shown where name = 'Trà sữa'), 1, 'an item names its option groups');
select is(
  (select g -> 'options' -> 0 ->> 'price_delta' from menu_any, jsonb_array_elements(m -> 'option_groups') g),
  '6000', 'the option groups carry their options with the amounts'
);
select is((select m -> 'ordering' ->> 'accepting' from menu_any), 'true', 'the menu carries the ordering state');
select is((select jsonb_array_length(m -> 'categories') || '/' || jsonb_array_length(m -> 'unavailable_items') from menu_ipos), '0/0', 'an ipos store answers no item');
select is((select m -> 'ordering' ->> 'reason' from menu_ipos), 'ordering_off', 'an ipos store takes no order');
select is(pg_temp.as_user((select customer_u from fx), $$select public.customer_menu('sa-1', 'delivery')::text$$, (select tenant_a from fx)), '22023', 'a malformed order type is 22023');
select is(pg_temp.as_user((select customer_u from fx), $$select public.customer_menu('sb-1')::text$$, (select tenant_a from fx)), '22023', 'a store of another brand is 22023');
select is(pg_temp.as_user((select customer_b_u from fx), $$select public.customer_menu('sa-1')::text$$, (select tenant_b from fx)), '22023', 'a customer of another tenant''s app is 22023');
select is(pg_temp.as_user((select manager_u from fx), $$select public.customer_menu('sa-1')::text$$), '42501', 'a member of the tenant is not a customer session');
select ok(pg_temp.as_user((select customer_u from fx), $$select public.customer_menu('sa-1') ->> 'menu_version'$$, (select tenant_a from fx)) ~ '^[0-9]+$', 'the public RPC answers a customer session');

-- 7. The sold-out switch and the version poll (acceptance criterion 2, the database side) -----------------------------
delete from public.menu_store_items;
select pg_temp.customer_claims((select customer_u from fx), (select tenant_a from fx));
create temp table poll_0 as select app.customer_menu_version('sa-1', now()) as v;
select set_config('request.jwt.claims', '', true);
select is(
  pg_temp.as_user((select staff_u from fx), format($$select public.counter_set_sold_out(%L, %L::uuid, true) ->> 'sold_out'$$, (select store_a1 from fx), (select id from public.menu_items where name = 'Trà sữa'))),
  'true', 'staff switch an item sold out at the counter'
);
select pg_temp.customer_claims((select customer_u from fx), (select tenant_a from fx));
create temp table poll_1 as select app.customer_menu_version('sa-1', now()) as v, app.customer_menu('sa-1', null, now()) as m;
select set_config('request.jwt.claims', '', true);
select ok((select (v ->> 'menu_version')::bigint from poll_1) > (select (v ->> 'menu_version')::bigint from poll_0), 'the switch moves the menu version');
select ok((select v -> 'unavailable_items' from poll_1) ? (select id::text from public.menu_items where name = 'Trà sữa'), 'the very next poll lists the item as unavailable');
select ok(not exists (select 1 from poll_1, jsonb_array_elements(m -> 'categories') c, jsonb_array_elements(c -> 'items') i where i ->> 'name' = 'Trà sữa'), 'the very next menu leaves the item out');
select is(
  (select sold_out_until from public.menu_store_items where item_id = (select id from public.menu_items where name = 'Trà sữa')),
  app.store_business_day_end((select store_a1 from fx), now()), 'sold out by default until the end of the business day'
);
select is((select sold_out_by from public.menu_store_items where item_id = (select id from public.menu_items where name = 'Trà sữa')), (select staff_u from fx), 'the switch records who set it');
update public.menu_store_items set sold_out_until = (select noon from fx) + interval '1 hour';
select is((select bool_or(available) from app.menu_rows((select store_a1 from fx), (select brand_a from fx), (select noon from fx) + interval '59 minutes 59 seconds') where item_name = 'Trà sữa'), false, 'sold-out boundary: one second before its end the item is unavailable');
select is((select bool_or(available) from app.menu_rows((select store_a1 from fx), (select brand_a from fx), (select noon from fx) + interval '1 hour') where item_name = 'Trà sữa'), true, 'sold-out boundary: at its end the item is available');
select is((select bool_or(available) from app.menu_rows((select store_a2 from fx), (select brand_a from fx), (select noon from fx)) where item_name = 'Trà sữa'), true, 'sold out at one store only');
select is(
  pg_temp.as_user((select staff_u from fx), format($$select public.counter_set_sold_out(%L, %L::uuid, false) ->> 'sold_out'$$, (select store_a1 from fx), (select id from public.menu_items where name = 'Trà sữa'))),
  'false', 'staff make the item available again'
);
select is(pg_temp.as_user((select staff_u from fx), format($$select public.counter_set_sold_out(%L, %L::uuid, true, now() + interval '7 days 1 second')::text$$, (select store_a1 from fx), (select id from public.menu_items where name = 'Trà sữa'))), '22023', 'sold out for more than 7 days is refused');
select is(pg_temp.as_user((select staff_u from fx), format($$select public.counter_set_sold_out(%L, %L::uuid, true, now() - interval '1 second')::text$$, (select store_a1 from fx), (select id from public.menu_items where name = 'Trà sữa'))), '22023', 'sold out until a past time is refused');
select is(pg_temp.as_user((select staff_u from fx), format($$select public.counter_set_sold_out(%L, %L::uuid, false, now() + interval '1 hour')::text$$, (select store_a1 from fx), (select id from public.menu_items where name = 'Trà sữa'))), '22023', 'making an item available takes no time');
select is(pg_temp.as_user((select staff_u from fx), format($$select public.counter_set_sold_out(%L, %L::uuid, true)::text$$, (select store_a1 from fx), (select id from public.menu_items where name = 'Món tự thêm'))), '22023', 'an item of another tenant''s menu is refused');
select is(pg_temp.as_user((select staff_u from fx), format($$select public.counter_set_sold_out(%L, %L::uuid, true)::text$$, (select store_a2 from fx), (select id from public.menu_items where name = 'Trà sữa'))), '42501', 'staff of another store cannot switch the item there');
select is(pg_temp.as_user((select viewer_u from fx), format($$select public.counter_set_sold_out(%L, %L::uuid, true)::text$$, (select store_a1 from fx), (select id from public.menu_items where name = 'Trà sữa'))), '42501', 'a viewer cannot switch an item');
select is(pg_temp.as_user((select customer_u from fx), format($$select public.counter_set_sold_out(%L, %L::uuid, true)::text$$, (select store_a1 from fx), (select id from public.menu_items where name = 'Trà sữa')), (select tenant_a from fx)), '42501', 'a customer session cannot switch an item');

-- 8. The counter menu --------------------------------------------------------------------------------------------
select is(pg_temp.as_user((select staff_u from fx), format($$select jsonb_array_length(public.counter_menu(%L) -> 'items')$$, (select store_a1 from fx))), '3', 'staff read every item on sale of the store');
select is(pg_temp.as_user((select staff_u from fx), format($$select jsonb_array_length(public.counter_menu(%L) -> 'option_groups')$$, (select store_a1 from fx))), '1', 'the counter menu carries the option groups');
select is(pg_temp.as_user((select staff_a2_u from fx), format($$select public.counter_menu(%L)::text$$, (select store_a1 from fx))), '42501', 'staff of another store read nothing');
select is(pg_temp.as_user((select viewer_u from fx), format($$select public.counter_menu(%L)::text$$, (select store_a1 from fx))), '42501', 'a viewer is not counter staff');
select is(pg_temp.as_user((select staff_u from fx), $$select public.counter_menu('ffffffff-ffff-4fff-8fff-000000026099')::text$$), '42501', 'an unknown store answers as one out of scope');

-- 9. The menu-photos bucket ------------------------------------------------------------------------------------
select is(
  (select b.public::text || ':' || b.file_size_limit || ':' || array_to_string(b.allowed_mime_types, ',') from storage.buckets b where b.id = 'menu-photos'),
  'true:307200:image/webp,image/jpeg,image/png', 'menu-photos is public-read, 300 kB a file, images only'
);
create function pg_temp.photo(p_tenant uuid, p_brand uuid, p_suffix text)
returns text language sql immutable as $$ select p_tenant::text || '/' || p_brand::text || '/bbbbbbbb-bbbb-4bbb-8bbb-000000000001' || p_suffix $$;
create function pg_temp.upload(p_user uuid, p_name text)
returns text language sql as $$
  select pg_temp.as_user(p_user, format('insert into storage.objects (bucket_id, name, owner_id, metadata) values (%L, %L, %L, %L)', 'menu-photos', p_name, p_user, '{"size": 2048, "mimetype": "image/webp"}'));
$$;
select is(pg_temp.upload((select owner_u from fx), pg_temp.photo((select tenant_a from fx), (select brand_a from fx), '.webp')), 'rows:1', 'an owner uploads a photo to the brand''s prefix');
select is(pg_temp.upload((select manager_u from fx), pg_temp.photo((select tenant_a from fx), (select brand_a from fx), '-thumb.webp')), 'rows:1', 'a manager with every store uploads a thumbnail');
select is(pg_temp.upload((select manager_a1_u from fx), pg_temp.photo((select tenant_a from fx), (select brand_a from fx), '-thumb.jpg')), '42501', 'a manager of one of the brand''s stores uploads nothing');
select is(pg_temp.upload((select staff_u from fx), pg_temp.photo((select tenant_a from fx), (select brand_a from fx), '.jpg')), '42501', 'staff upload no photo');
select is(pg_temp.upload((select owner_b_u from fx), pg_temp.photo((select tenant_a from fx), (select brand_a from fx), '.png')), '42501', 'another tenant''s owner cannot write into this prefix');
select is(pg_temp.upload((select owner_u from fx), pg_temp.photo((select tenant_a from fx), (select brand_b from fx), '.webp')), '42501', 'another tenant''s brand under this tenant is refused');
select is(pg_temp.upload((select owner_u from fx), (select tenant_a from fx)::text || '/notes.txt'), '42501', 'a path of another shape is refused');
select lives_ok(format($$update public.menu_items set photo_path = %L where name = 'Trà sữa'$$, pg_temp.photo((select tenant_a from fx), (select brand_a from fx), '.webp')), 'an item takes a photo under its tenant and brand');
select throws_ok(format($$update public.menu_items set photo_path = %L where name = 'Trà sữa'$$, pg_temp.photo((select tenant_b from fx), (select brand_b from fx), '.webp')), '23514', null, 'a photo under another tenant is refused');

select * from finish();
rollback;
