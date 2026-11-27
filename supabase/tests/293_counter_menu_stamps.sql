-- The counter's menu says which items earn a stamp (Q01 ticket; migration counter_menu_stamp_flag): counts_for_stamps
-- on every item of counter_menu and the stamp card of each brand of the store, added to an answer whose other fields
-- stay as they were.
-- Techniques: equivalence partitions of an item (a drink with one size, a drink with two sizes, a bread that earns no
-- stamp, a sold-out drink), state transitions of the flag and of the brand's card (switched off, then on again),
-- regression of the answer's shape (every key of the old answer still there, nothing renamed) and of the customer menu,
-- a use case as the oracle (the stamps the ticket computes from the flags equal what the keyed order's lines count),
-- and authorisation (staff of another store, a viewer, a customer, an unknown store, anon).
begin;
select plan(18);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000029301'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000029302'::uuid as tenant_b,
  'cccccccc-cccc-4ccc-8ccc-000000029301'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000029302'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000029301'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000029302'::uuid as store_a2,
  'ffffffff-ffff-4fff-8fff-000000029303'::uuid as store_b1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000029301'::uuid as brand_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000029302'::uuid as brand_b,
  '99999999-9999-4999-8999-000000029301'::uuid as app_a,
  'eeeeeeee-eeee-4eee-8eee-000000029301'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000029302'::uuid as staff_u,
  'eeeeeeee-eeee-4eee-8eee-000000029303'::uuid as staff_a2_u,
  'eeeeeeee-eeee-4eee-8eee-000000029304'::uuid as viewer_u,
  'eeeeeeee-eeee-4eee-8eee-000000029305'::uuid as owner_b_u,
  'eeeeeeee-eeee-4eee-8eee-000000029311'::uuid as cust_u,
  timestamptz '2026-11-25 10:00:00+07' as noon;
grant select on fx to authenticated, anon;

create temp table ids (name text primary key, id uuid not null);
insert into ids values
  ('cat_drink', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029351'), ('cat_food', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029352'),
  ('item_cf', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029301'), ('item_ts', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029302'), ('item_bm', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029303'),
  ('cf', 'bbbbbbbb-bbbb-4bbb-8bbb-000000029311'), ('ts_m', 'bbbbbbbb-bbbb-4bbb-8bbb-000000029312'), ('ts_l', 'bbbbbbbb-bbbb-4bbb-8bbb-000000029313'),
  ('bm', 'bbbbbbbb-bbbb-4bbb-8bbb-000000029314');
grant select on ids to authenticated, anon;
create function pg_temp.id(p_name text) returns uuid language sql stable as $$ select id from ids where name = p_name $$;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'native-293-' || right(u.id::text, 4) || '@example.com',
  case when u.tenant is null then '{}'::jsonb else jsonb_build_object('kind', 'customer', 'tenant_id', u.tenant) end
from fx cross join lateral (values
  (fx.manager_u, null::uuid), (fx.staff_u, null), (fx.staff_a2_u, null), (fx.viewer_u, null), (fx.owner_b_u, null), (fx.cust_u, fx.tenant_a)
) as u (id, tenant);
insert into public.tenants (id, slug, name)
select tenant_a, 'native-293-a', 'Native 293 A' from fx union all
select tenant_b, 'native-293-b', 'Native 293 B' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'native-293-a', 'Synthetic account A' from fx union all
select account_b, tenant_b, 'mock', 'native-293-b', 'Synthetic account B' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name, opening_hours)
select s.id, s.tenant, s.account, s.ext, s.code, s.name,
  '{"mon": [["00:00", "24:00"]], "tue": [["00:00", "24:00"]], "wed": [["00:00", "24:00"]], "thu": [["00:00", "24:00"]], "fri": [["00:00", "24:00"]], "sat": [["00:00", "24:00"]], "sun": [["00:00", "24:00"]]}'::jsonb
from fx cross join lateral (values
  (fx.store_a1, fx.tenant_a, fx.account_a, 'n293-a1', 'sa-1', 'Synthetic store A1'),
  (fx.store_a2, fx.tenant_a, fx.account_a, 'n293-a2', 'sa-2', 'Synthetic store A2'),
  (fx.store_b1, fx.tenant_b, fx.account_b, 'n293-b1', 'sb-1', 'Synthetic store B1')
) as s (id, tenant, account, ext, code, name);
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_a, m.user_id, m.role::public.tenant_role, m.store_ids
from fx cross join lateral (values
  (fx.manager_u, 'manager', null::uuid[]), (fx.staff_u, 'staff', array[fx.store_a1]), (fx.staff_a2_u, 'staff', array[fx.store_a2]), (fx.viewer_u, 'viewer', null)
) as m (user_id, role, store_ids)
union all
select tenant_b, owner_b_u, 'owner', null from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_a, tenant_a, 'brand-1', 'Synthetic brand A', array[store_a1, store_a2] from fx union all
select brand_b, tenant_b, 'brand-1', 'Synthetic brand B', array[store_b1] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_a, tenant_a, brand_a, 'synthetic-293-app-a', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id)
select tenant_a, app_a, 'syn-zalo-293-1', cust_u from fx;
insert into public.store_ordering_settings (store_id, tenant_id, till_mode, ordering_enabled, order_types, payment_methods, staff_presence_required)
select store_a1, tenant_a, 'native', true, array['table', 'takeaway'], array['counter'], false from fx union all
select store_a2, tenant_a, 'native', true, array['table'], array['counter'], false from fx;

insert into public.menu_categories (id, tenant_id, brand_id, name, sort_order)
select pg_temp.id('cat_drink'), tenant_a, brand_a, 'Đồ uống', 10 from fx union all
select pg_temp.id('cat_food'), tenant_a, brand_a, 'Đồ ăn', 20 from fx;
insert into public.menu_items (id, tenant_id, brand_id, category_id, name, counts_for_stamps, order_types, sort_order)
select pg_temp.id(v.item), fx.tenant_a, fx.brand_a, pg_temp.id(v.cat), v.name, v.stamps, array['table', 'takeaway'], v.sort
from fx cross join lateral (values
  ('item_cf', 'cat_drink', 'Cà phê', true, 10),
  ('item_ts', 'cat_drink', 'Trà sữa', true, 20),
  ('item_bm', 'cat_food', 'Bánh mì', false, 10)
) as v (item, cat, name, stamps, sort);
insert into public.menu_item_sizes (id, tenant_id, brand_id, item_id, label, price, sort_order, is_default)
select pg_temp.id(v.size), fx.tenant_a, fx.brand_a, pg_temp.id(v.item), v.label, v.price, v.sort, v.dflt
from fx cross join lateral (values
  ('cf', 'item_cf', null, 29000, 10, true), ('ts_m', 'item_ts', 'M', 35000, 10, true), ('ts_l', 'item_ts', 'L', 42000, 20, false),
  ('bm', 'item_bm', null, 30000, 10, true)
) as v (size, item, label, price, sort, dflt);

-- Helpers: a caller's claims for one statement (JSON, or {"error": SQLSTATE}); the counter menu of a store at noon; one
-- item of it by name.
create function pg_temp.claims(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated',
    'app_metadata', coalesce((select jsonb_build_object('kind', 'customer', 'tenant_id', l.tenant_id) from app.customer_logins l where l.user_id = p_user), '{}'::jsonb))::text, true);
$$;
create function pg_temp.call(p_user uuid, p_sql text) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  perform pg_temp.claims(p_user);
  begin
    execute p_sql into v;
  exception when others then
    v := jsonb_build_object('error', sqlstate);
  end;
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$$;
create function pg_temp.menu(p_user uuid, p_store uuid) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.counter_menu(%L, %L)$q$, p_store, (select noon from fx)));
$$;
create function pg_temp.item(p_menu jsonb, p_name text) returns jsonb language sql immutable as $$
  select i from jsonb_array_elements(p_menu -> 'items') i where i ->> 'name' = p_name;
$$;
create function pg_temp.as_role(p_user uuid, p_sql text) returns text language plpgsql as $$
declare
  v text;
begin
  perform pg_temp.claims(p_user);
  perform set_config('role', 'authenticated', true);
  begin
    execute p_sql into v;
  exception when others then
    v := sqlstate;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$$;

-- 1. The flag per item: the partitions -------------------------------------------------------------------------------
select is(
  (select string_agg((i ->> 'name') || '=' || (i ->> 'counts_for_stamps'), ', ' order by i ->> 'name') from jsonb_array_elements(pg_temp.menu((select staff_u from fx), (select store_a1 from fx)) -> 'items') i),
  'Bánh mì=false, Cà phê=true, Trà sữa=true', 'every item of the counter menu says whether it earns a stamp: the drinks do, the bread does not'
);
select is(
  (select jsonb_typeof(pg_temp.item(m, 'Trà sữa') -> 'counts_for_stamps') || '/' || jsonb_array_length(pg_temp.item(m, 'Trà sữa') -> 'sizes')
   from pg_temp.menu((select staff_u from fx), (select store_a1 from fx)) m),
  'boolean/2', 'a drink with two sizes carries one boolean flag for the item and keeps both sizes'
);
insert into public.menu_store_items (tenant_id, store_id, item_id, offered, sold_out_until)
select tenant_a, store_a1, pg_temp.id('item_cf'), true, noon + interval '1 hour' from fx;
select is(
  (select (pg_temp.item(m, 'Cà phê') ->> 'available') || '/' || (pg_temp.item(m, 'Cà phê') ->> 'counts_for_stamps') from pg_temp.menu((select staff_u from fx), (select store_a1 from fx)) m),
  'false/true', 'a sold-out drink still says it earns a stamp'
);
delete from public.menu_store_items where store_id = (select store_a1 from fx);

-- 2. Regression of the answer's shape ----------------------------------------------------------------------------------
select is(
  (select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(pg_temp.menu((select staff_u from fx), (select store_a1 from fx))) k),
  'business_date,day_ends_at,items,option_groups,ordering,stamp_cards,store_id', 'the answer keeps every field it had and gains stamp_cards'
);
select is(
  (select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(pg_temp.item(pg_temp.menu((select staff_u from fx), (select store_a1 from fx)), 'Trà sữa')) k),
  'available,brand_id,category,counts_for_stamps,id,name,option_group_ids,order_types,sizes,sold_out_until', 'an item keeps every field it had and gains counts_for_stamps'
);
select is(
  (select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(pg_temp.item(pg_temp.menu((select staff_u from fx), (select store_a1 from fx)), 'Trà sữa') -> 'sizes' -> 0) k),
  'id,is_default,label,price', 'a size is answered as before'
);
select is(
  (select string_agg((i ->> 'name') || '=' || (i ->> 'counts_for_stamps'), ', ' order by i ->> 'name')
   from jsonb_array_elements(pg_temp.call((select cust_u from fx), format($q$select app.customer_menu('sa-1', null, %L)$q$, (select noon from fx))) -> 'categories') c
   cross join lateral jsonb_array_elements(c -> 'items') i),
  'Bánh mì=false, Cà phê=true, Trà sữa=true', 'regression: the customer menu carries the same flag'
);

-- 3. The flag and the brand's card change: state transitions ------------------------------------------------------------
update public.menu_items set counts_for_stamps = false where id = pg_temp.id('item_ts');
select is((pg_temp.item(pg_temp.menu((select staff_u from fx), (select store_a1 from fx)), 'Trà sữa') ->> 'counts_for_stamps'), 'false', 'a manager switches the milk tea off stamps: the counter menu follows at once');
update public.menu_items set counts_for_stamps = true where id = pg_temp.id('item_ts');
select is(
  (pg_temp.menu((select staff_u from fx), (select store_a1 from fx)) -> 'stamp_cards'),
  jsonb_build_array(jsonb_build_object('brand_id', (select brand_a from fx), 'enabled', true, 'stamps_per_reward', 9)),
  'a brand without stamp settings: its card is on with 9 stamps to a reward'
);
insert into public.stamp_card_settings (tenant_id, brand_id, enabled, stamps_per_reward)
select tenant_a, brand_a, false, 5 from fx;
select is(
  (pg_temp.menu((select staff_u from fx), (select store_a1 from fx)) -> 'stamp_cards' -> 0 ->> 'enabled') || '/' || (pg_temp.menu((select staff_u from fx), (select store_a1 from fx)) -> 'stamp_cards' -> 0 ->> 'stamps_per_reward'),
  'false/5', 'the card switched off: the ticket can say no stamps will be earned'
);
update public.stamp_card_settings set enabled = true where brand_id = (select brand_a from fx);
select is((pg_temp.menu((select staff_u from fx), (select store_a1 from fx)) -> 'stamp_cards' -> 0 ->> 'enabled'), 'true', 'and on again');

-- 4. Use case: the ticket's count equals what the keyed order's lines count ---------------------------------------------
create temp table keyed as
select pg_temp.call((select staff_u from fx), format($q$select app.counter_create_order(%L, %L::jsonb, %L)$q$, (select store_a1 from fx),
  jsonb_build_object('request_id', gen_random_uuid(), 'type', 'takeaway', 'lines', jsonb_build_array(
    jsonb_build_object('size', pg_temp.id('cf'), 'qty', 2), jsonb_build_object('size', pg_temp.id('ts_l'), 'qty', 1), jsonb_build_object('size', pg_temp.id('bm'), 'qty', 3))),
  (select noon from fx))) as answer;
select is(
  (select sum(case when (i ->> 'counts_for_stamps')::boolean then l.qty else 0 end)::int
   from (values ('cf', 2), ('ts_l', 1), ('bm', 3)) as l (size, qty)
   cross join lateral jsonb_array_elements(pg_temp.menu((select staff_u from fx), (select store_a1 from fx)) -> 'items') i
   where exists (select 1 from jsonb_array_elements(i -> 'sizes') z where (z ->> 'id')::uuid = pg_temp.id(l.size))),
  (select sum(l.quantity) filter (where l.counts_for_stamps)::int from public.order_lines l where l.order_id = ((select answer from keyed) -> 'order' ->> 'id')::uuid),
  'two coffees, a large milk tea and three breads: the ticket counts 3 stamps from the flags, as the order''s lines do'
);
select is(
  (select sum(case when (x ->> 'counts_for_stamps')::boolean then (x ->> 'quantity')::int else 0 end)::int from jsonb_array_elements((select answer from keyed) -> 'order' -> 'lines') x),
  3, 'and as the order answer''s lines show it'
);

-- 5. Authorisation ---------------------------------------------------------------------------------------------------
select is((pg_temp.menu((select staff_a2_u from fx), (select store_a1 from fx)) ->> 'error'), '42501', 'staff of another store read nothing');
select is((pg_temp.menu((select viewer_u from fx), (select store_a1 from fx)) ->> 'error'), '42501', 'nor a viewer');
select is((pg_temp.menu((select cust_u from fx), (select store_a1 from fx)) ->> 'error'), '42501', 'nor a customer session');
select is((pg_temp.menu((select owner_b_u from fx), (select store_a1 from fx)) ->> 'error'), '42501', 'nor another tenant''s owner');
select ok(
  not has_function_privilege('anon', 'public.counter_menu(uuid)', 'execute') and has_function_privilege('authenticated', 'public.counter_menu(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.counter_menu(uuid, timestamptz)', 'execute')
  and pg_temp.as_role((select manager_u from fx), format($q$select (public.counter_menu(%L) -> 'items' -> 0 ? 'counts_for_stamps')::text$q$, (select store_a1 from fx))) = 'true',
  'the public wrapper is for signed-in members only, anon has nothing, and it answers the flag through the API role'
);

select * from finish();
rollback;
