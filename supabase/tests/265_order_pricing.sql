-- The native till, step 3 (ADR-061, native-till.md 5.3, threats S1 to S4): orders are priced only by the database.
-- Line and order totals from the menu, enforced again by CHECK constraints; a client total, a price key or a total key
-- never priced anything; hidden, inactive, restricted, unoffered items and inactive options refused; the shape of a
-- request checked first, answered only with 22023, writing nothing and counting nothing.
-- Techniques: equivalence partitions and boundary values of the request (lines 0/1/30/31, quantity 0/1/20/21 and 1.5,
-- options 10/11 and repeats, notes 100/101 and 200/201, control characters, bidirectional overrides, CR LF, odd JSON
-- types, __proto__), error guessing on price tampering.
begin;
select plan(57);

-- The shared fixture of the native-order suites (263 to 268): two tenants; a native store A1 open all day taking table
-- and takeaway orders paid at the counter or by VietQR, a native store A2 taking table orders at the counter, and B1 of
-- tenant B; brand A's menu (a coffee, a milk tea with sizes, a topping group 0..2 and a required sugar group 1..1, a
-- bread that earns no stamp, a takeaway-only item), brand B's item; a table per store; three customers of A and one of B.
create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000026301'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000026302'::uuid as tenant_b,
  'cccccccc-cccc-4ccc-8ccc-000000026301'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000026302'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000026301'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000026302'::uuid as store_a2,
  'ffffffff-ffff-4fff-8fff-000000026303'::uuid as store_b1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000026301'::uuid as brand_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000026302'::uuid as brand_b,
  '99999999-9999-4999-8999-000000026301'::uuid as app_a,
  '99999999-9999-4999-8999-000000026302'::uuid as app_b,
  'eeeeeeee-eeee-4eee-8eee-000000026301'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000026302'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000026303'::uuid as staff_u,
  'eeeeeeee-eeee-4eee-8eee-000000026304'::uuid as staff_a2_u,
  'eeeeeeee-eeee-4eee-8eee-000000026305'::uuid as viewer_u,
  'eeeeeeee-eeee-4eee-8eee-000000026306'::uuid as owner_b_u,
  'eeeeeeee-eeee-4eee-8eee-000000026311'::uuid as cust1_u,
  'eeeeeeee-eeee-4eee-8eee-000000026312'::uuid as cust2_u,
  'eeeeeeee-eeee-4eee-8eee-000000026313'::uuid as cust3_u,
  'eeeeeeee-eeee-4eee-8eee-000000026314'::uuid as cust4_u,
  'eeeeeeee-eeee-4eee-8eee-000000026315'::uuid as cust5_u,
  'eeeeeeee-eeee-4eee-8eee-000000026319'::uuid as custb_u,
  timestamptz '2026-11-25 10:00:00+07' as noon;
grant select on fx to authenticated, anon;

create temp table ids (name text primary key, id uuid not null);
insert into ids values
  ('cat_drink', 'aaaaaaaa-aaaa-4aaa-8aaa-000000026351'), ('cat_food', 'aaaaaaaa-aaaa-4aaa-8aaa-000000026352'), ('cat_b', 'aaaaaaaa-aaaa-4aaa-8aaa-000000026353'),
  ('item_cf', 'aaaaaaaa-aaaa-4aaa-8aaa-000000026301'), ('item_ts', 'aaaaaaaa-aaaa-4aaa-8aaa-000000026302'), ('item_bm', 'aaaaaaaa-aaaa-4aaa-8aaa-000000026303'),
  ('item_ta', 'aaaaaaaa-aaaa-4aaa-8aaa-000000026304'), ('item_bb', 'aaaaaaaa-aaaa-4aaa-8aaa-000000026309'),
  ('cf', 'bbbbbbbb-bbbb-4bbb-8bbb-000000026311'), ('ts_m', 'bbbbbbbb-bbbb-4bbb-8bbb-000000026312'), ('ts_l', 'bbbbbbbb-bbbb-4bbb-8bbb-000000026313'),
  ('bm', 'bbbbbbbb-bbbb-4bbb-8bbb-000000026314'), ('ta', 'bbbbbbbb-bbbb-4bbb-8bbb-000000026315'), ('bb', 'bbbbbbbb-bbbb-4bbb-8bbb-000000026319'),
  ('g_top', 'cccccccc-cccc-4ccc-8ccc-000000026321'), ('g_sugar', 'cccccccc-cccc-4ccc-8ccc-000000026322'),
  ('top_tc', 'dddddddd-dddd-4ddd-8ddd-000000026331'), ('top_th', 'dddddddd-dddd-4ddd-8ddd-000000026332'),
  ('sugar_bt', 'dddddddd-dddd-4ddd-8ddd-000000026333'), ('sugar_it', 'dddddddd-dddd-4ddd-8ddd-000000026334'),
  ('table_a1', 'aaaaaaaa-aaaa-4aaa-8aaa-000000026341'), ('table_a2', 'aaaaaaaa-aaaa-4aaa-8aaa-000000026342'), ('table_b1', 'aaaaaaaa-aaaa-4aaa-8aaa-000000026343');
grant select on ids to authenticated, anon;
create function pg_temp.id(p_name text) returns uuid language sql stable as $$ select id from ids where name = p_name $$;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'native-263-' || right(u.id::text, 4) || '@example.com',
  case when u.tenant is null then '{}'::jsonb else jsonb_build_object('kind', 'customer', 'tenant_id', u.tenant) end
from fx cross join lateral (values
  (fx.owner_u, null::uuid), (fx.manager_u, null), (fx.staff_u, null), (fx.staff_a2_u, null), (fx.viewer_u, null), (fx.owner_b_u, null),
  (fx.cust1_u, fx.tenant_a), (fx.cust2_u, fx.tenant_a), (fx.cust3_u, fx.tenant_a), (fx.cust4_u, fx.tenant_a), (fx.cust5_u, fx.tenant_a), (fx.custb_u, fx.tenant_b)
) as u (id, tenant);
insert into public.tenants (id, slug, name)
select tenant_a, 'native-263-a', 'Native 263 A' from fx union all
select tenant_b, 'native-263-b', 'Native 263 B' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'native-263-a', 'Synthetic account A' from fx union all
select account_b, tenant_b, 'mock', 'native-263-b', 'Synthetic account B' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name, opening_hours)
select s.id, s.tenant, s.account, s.ext, s.code, s.name,
  '{"mon": [["00:00", "24:00"]], "tue": [["00:00", "24:00"]], "wed": [["00:00", "24:00"]], "thu": [["00:00", "24:00"]], "fri": [["00:00", "24:00"]], "sat": [["00:00", "24:00"]], "sun": [["00:00", "24:00"]]}'::jsonb
from fx cross join lateral (values
  (fx.store_a1, fx.tenant_a, fx.account_a, 'n263-a1', 'sa-1', 'Synthetic store A1'),
  (fx.store_a2, fx.tenant_a, fx.account_a, 'n263-a2', 'sa-2', 'Synthetic store A2'),
  (fx.store_b1, fx.tenant_b, fx.account_b, 'n263-b1', 'sb-1', 'Synthetic store B1')
) as s (id, tenant, account, ext, code, name);
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_a, m.user_id, m.role::public.tenant_role, m.store_ids
from fx cross join lateral (values
  (fx.owner_u, 'owner', null::uuid[]), (fx.manager_u, 'manager', null), (fx.staff_u, 'staff', array[fx.store_a1]),
  (fx.staff_a2_u, 'staff', array[fx.store_a2]), (fx.viewer_u, 'viewer', null)
) as m (user_id, role, store_ids)
union all
select tenant_b, owner_b_u, 'owner', null from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_a, tenant_a, 'brand-1', 'Synthetic brand A', array[store_a1, store_a2] from fx union all
select brand_b, tenant_b, 'brand-1', 'Synthetic brand B', array[store_b1] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_a, tenant_a, brand_a, 'synthetic-263-app-a', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx union all
select app_b, tenant_b, brand_b, 'synthetic-263-app-b', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id)
select tenant_a, app_a, 'syn-zalo-263-1', cust1_u from fx union all
select tenant_a, app_a, 'syn-zalo-263-2', cust2_u from fx union all
select tenant_a, app_a, 'syn-zalo-263-3', cust3_u from fx union all
select tenant_a, app_a, 'syn-zalo-263-4', cust4_u from fx union all
select tenant_a, app_a, 'syn-zalo-263-5', cust5_u from fx union all
select tenant_b, app_b, 'syn-zalo-263-9', custb_u from fx;

insert into public.store_ordering_settings (store_id, tenant_id, till_mode, ordering_enabled, order_types, payment_methods, staff_presence_required)
select store_a1, tenant_a, 'native', true, array['table', 'takeaway'], array['counter', 'vietqr'], false from fx union all
select store_a2, tenant_a, 'native', true, array['table'], array['counter'], false from fx union all
select store_b1, tenant_b, 'native', true, array['table'], array['counter'], false from fx;

insert into public.menu_categories (id, tenant_id, brand_id, name, sort_order)
select pg_temp.id('cat_drink'), tenant_a, brand_a, 'Đồ uống', 10 from fx union all
select pg_temp.id('cat_food'), tenant_a, brand_a, 'Đồ ăn', 20 from fx union all
select pg_temp.id('cat_b'), tenant_b, brand_b, 'Đồ uống', 10 from fx;
insert into public.menu_items (id, tenant_id, brand_id, category_id, name, counts_for_stamps, order_types)
select pg_temp.id(v.item), fx.tenant_a, fx.brand_a, pg_temp.id(v.cat), v.name, v.stamps, v.types
from fx cross join lateral (values
  ('item_cf', 'cat_drink', 'Cà phê', true, array['table', 'takeaway']),
  ('item_ts', 'cat_drink', 'Trà sữa', true, array['table', 'takeaway']),
  ('item_bm', 'cat_food', 'Bánh mì', false, array['table', 'takeaway']),
  ('item_ta', 'cat_drink', 'Cà phê mang đi', true, array['takeaway'])
) as v (item, cat, name, stamps, types)
union all
select pg_temp.id('item_bb'), tenant_b, brand_b, pg_temp.id('cat_b'), 'Món B', true, array['table'] from fx;
insert into public.menu_item_sizes (id, tenant_id, brand_id, item_id, label, price, sort_order, is_default)
select pg_temp.id(v.size), fx.tenant_a, fx.brand_a, pg_temp.id(v.item), v.label, v.price, v.sort, v.dflt
from fx cross join lateral (values
  ('cf', 'item_cf', null, 29000, 10, true), ('ts_m', 'item_ts', 'M', 35000, 10, true), ('ts_l', 'item_ts', 'L', 42000, 20, false),
  ('bm', 'item_bm', null, 30000, 10, true), ('ta', 'item_ta', null, 40000, 10, true)
) as v (size, item, label, price, sort, dflt)
union all
select pg_temp.id('bb'), tenant_b, brand_b, pg_temp.id('item_bb'), null, 20000, 10, true from fx;
insert into public.menu_option_groups (id, tenant_id, brand_id, name, min_select, max_select, sort_order)
select pg_temp.id('g_top'), tenant_a, brand_a, 'Topping', 0, 2, 10 from fx union all
select pg_temp.id('g_sugar'), tenant_a, brand_a, 'Đường', 1, 1, 20 from fx;
insert into public.menu_options (id, tenant_id, brand_id, group_id, name, price_delta, sort_order)
select pg_temp.id(v.opt), fx.tenant_a, fx.brand_a, pg_temp.id(v.grp), v.name, v.price, v.sort
from fx cross join lateral (values
  ('top_tc', 'g_top', 'Trân châu', 5000, 10), ('top_th', 'g_top', 'Thạch', 0, 20),
  ('sugar_bt', 'g_sugar', 'Bình thường', 0, 10), ('sugar_it', 'g_sugar', 'Ít đường', 0, 20)
) as v (opt, grp, name, price, sort);
insert into public.menu_item_option_groups (tenant_id, brand_id, item_id, group_id, sort_order)
select tenant_a, brand_a, pg_temp.id('item_ts'), pg_temp.id('g_top'), 10 from fx union all
select tenant_a, brand_a, pg_temp.id('item_ts'), pg_temp.id('g_sugar'), 20 from fx;
insert into public.store_tables (id, tenant_id, store_id, label, area)
select pg_temp.id('table_a1'), tenant_a, store_a1, 'Bàn 1', 'Tầng 1' from fx union all
select pg_temp.id('table_a2'), tenant_a, store_a2, 'Bàn 2', null from fx union all
select pg_temp.id('table_b1'), tenant_b, store_b1, 'Bàn B', null from fx;
create temp table tok as
select t.label, app.table_qr_token(t.tenant_id, t.id, t.qr_version) as token from public.store_tables t where t.id in (select id from ids);
grant select on tok to authenticated, anon;
create function pg_temp.token(p_label text) returns text language sql stable as $$ select token from tok where label = p_label $$;

-- Helpers. Claims of a customer session or a member, set without switching role, to call the app halves at fixed
-- instants; every helper answers JSON or {"error": SQLSTATE} and clears the claims.
create function pg_temp.claims(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated',
    'app_metadata', coalesce((select jsonb_build_object('kind', 'customer', 'tenant_id', l.tenant_id) from app.customer_logins l where l.user_id = p_user), '{}'::jsonb))::text, true);
$$;
create function pg_temp.line(p_size text, p_qty integer default 1, p_options text[] default '{}') returns jsonb language sql stable as $$
  select jsonb_build_object('size', pg_temp.id(p_size), 'qty', p_qty, 'options', coalesce((select jsonb_agg(pg_temp.id(o)) from unnest(p_options) o), '[]'::jsonb));
$$;
create function pg_temp.req(p_lines jsonb, p_total integer, p_extra jsonb default '{}'::jsonb) returns jsonb language sql volatile as $$
  select jsonb_build_object('request_id', gen_random_uuid(), 'store', 'sa-1', 'type', 'table', 'table_token', pg_temp.token('Bàn 1'),
    'payment', 'counter', 'lines', p_lines, 'expected_total', p_total) || p_extra;
$$;
create function pg_temp.place(p_user uuid, p_request jsonb, p_at timestamptz default null) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  perform pg_temp.claims(p_user);
  begin
    v := app.customer_place_order(p_request, coalesce(p_at, (select noon from fx)));
  exception when others then
    v := jsonb_build_object('error', sqlstate);
  end;
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
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
create function pg_temp.act(p_user uuid, p_order uuid, p_action text, p_reason text default null, p_at timestamptz default null, p_version integer default null)
returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  perform pg_temp.claims(p_user);
  begin
    v := app.counter_order_act(p_order, p_action, coalesce(p_version, (select o.version from public.orders o where o.id = p_order), 1), p_reason,
      coalesce(p_at, (select noon from fx) + interval '1 minute'));
  exception when others then
    v := jsonb_build_object('error', sqlstate);
  end;
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$$;
create function pg_temp.order_of(p_answer jsonb) returns uuid language sql immutable as $$ select (p_answer -> 'order' ->> 'id')::uuid $$;
create function pg_temp.pay(p_order uuid, p_at timestamptz default null) returns jsonb language sql as $$
  select app.order_payment_succeeded(p_order, (select o.total from public.orders o where o.id = p_order), 'staff', (select staff_u from fx),
    coalesce(p_at, (select noon from fx) + interval '30 seconds'));
$$;
-- A milk tea M with pearls and normal sugar (40,000) and a coffee (29,000): 69,000.
create function pg_temp.basket() returns jsonb language sql stable as $$
  select jsonb_build_array(pg_temp.line('ts_m', 1, array['top_tc', 'sugar_bt']), pg_temp.line('cf'));
$$;
-- An order keyed at the counter of A1 by its staff member (no customer limits apply).
create function pg_temp.keyed(p_type text, p_lines jsonb, p_at timestamptz default null, p_request uuid default null) returns jsonb language sql as $$
  select pg_temp.call((select staff_u from fx), format($q$select app.counter_create_order(%L, %L::jsonb, %L)$q$, (select store_a1 from fx),
    jsonb_build_object('request_id', coalesce(p_request, gen_random_uuid()), 'type', p_type, 'lines', p_lines)
      || case when p_type = 'table' then jsonb_build_object('table_id', pg_temp.id('table_a1')) else '{}'::jsonb end,
    coalesce(p_at, (select noon from fx))));
$$;

-- 1. Prices come only from the menu (S1, S2, S3) -------------------------------------------------------------------
create temp table p1 as
select pg_temp.place((select cust1_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('ts_l', 3, array['top_tc', 'top_th', 'sugar_it']), pg_temp.line('bm', 2)), 201000)) as r;
select is((select r ->> 'state' from p1), 'placed', 'a basket priced by the menu is placed');
select is(
  (select string_agg(l.quantity || 'x(' || l.unit_price::bigint || '+' || l.options_amount::bigint || ')=' || l.line_total::bigint, ',' order by l.line_no) from public.order_lines l where l.order_id = pg_temp.order_of((select r from p1))),
  '3x(42000+5000)=141000,2x(30000+0)=60000', 'each line is quantity x (size price + options) from the menu'
);
select is((select subtotal::bigint || '/' || discount_amount::bigint || '/' || total::bigint from public.orders where id = pg_temp.order_of((select r from p1))), '201000/0/201000', 'the order total is the sum of its lines');
select throws_ok(
  format($$update public.orders set total = 1 where id = %L$$, pg_temp.order_of((select r from p1))),
  '23514', null, 'the database refuses a total that is not the subtotal less the discount'
);
select throws_ok(
  format($$update public.order_lines set line_total = 1 where order_id = %L$$, pg_temp.order_of((select r from p1))),
  '23514', null, 'and a line total that is not quantity x (price + options)'
);
create temp table counts_before as select count(*) as n from public.orders where tenant_id = (select tenant_a from fx);
select is((pg_temp.place((select cust2_u from fx), pg_temp.req(pg_temp.basket(), 1)) ->> 'refusal'), 'price_changed', 'a lower total from the client is refused (S1)');
select is((pg_temp.place((select cust2_u from fx), pg_temp.req(pg_temp.basket(), 69001)) ->> 'refusal'), 'price_changed', 'a higher total too');
select is((pg_temp.place((select cust2_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('cf') || jsonb_build_object('price', 1)), 1)) ->> 'error'), '22023', 'a line carrying a price of its own is refused before anything is read');
select is((pg_temp.place((select cust2_u from fx), pg_temp.req(pg_temp.basket(), 69000, jsonb_build_object('total', 1))) ->> 'error'), '22023', 'a request carrying a total key is refused');
update public.menu_items set visible = false where id = pg_temp.id('item_bm');
select is((pg_temp.place((select cust2_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('bm')), 30000)) ->> 'refusal'), 'item_unavailable', 'a hidden item is refused (S2)');
update public.menu_items set visible = true where id = pg_temp.id('item_bm');
update public.menu_item_sizes set active = false where id = pg_temp.id('ts_l');
select is((pg_temp.place((select cust2_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('ts_l', 1, array['sugar_bt'])), 42000)) ->> 'refusal'), 'item_unavailable', 'an inactive size is refused');
update public.menu_item_sizes set active = true where id = pg_temp.id('ts_l');
update public.menu_categories set visible = false where id = pg_temp.id('cat_food');
select is((pg_temp.place((select cust2_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('bm')), 30000)) ->> 'refusal'), 'item_unavailable', 'an item of a hidden category is refused');
update public.menu_categories set visible = true where id = pg_temp.id('cat_food');
update public.menu_options set active = false where id = pg_temp.id('top_tc');
select is((pg_temp.place((select cust2_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('ts_m', 1, array['top_tc', 'sugar_bt'])), 40000)) ->> 'refusal'), 'option_invalid', 'an inactive option is refused (S3)');
update public.menu_options set active = true where id = pg_temp.id('top_tc');
insert into public.menu_store_items (tenant_id, store_id, item_id, offered) select tenant_a, store_a1, pg_temp.id('item_bm'), false from fx;
select is((pg_temp.place((select cust2_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('bm')), 30000)) ->> 'refusal'), 'item_unavailable', 'an item the store does not offer is refused');
delete from public.menu_store_items where item_id = pg_temp.id('item_bm');
update public.menu_items set restricted = true, visible = false where id = pg_temp.id('item_bm');
select is((pg_temp.place((select cust2_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('bm')), 30000)) ->> 'refusal'), 'item_unavailable', 'a restricted item is refused');
update public.menu_items set restricted = false, visible = true where id = pg_temp.id('item_bm');
select is((select count(*) from public.orders where tenant_id = (select tenant_a from fx)), (select n from counts_before), 'no refused request wrote an order');

-- 2. Shape: only 22023, nothing read, nothing written (S4) -------------------------------------------------------
create function pg_temp.shape(p_request jsonb) returns text language sql as $$ select coalesce(pg_temp.place((select cust3_u from fx), p_request) ->> 'error', 'answered') $$;
select is(pg_temp.shape(v.req), v.expected, v.label)
from (values
  ('"just a string"'::jsonb, '22023', 'a request that is not an object'),
  (pg_temp.req(pg_temp.basket(), 69000, '{"extra": 1}'), '22023', 'an unknown key'),
  (pg_temp.req(pg_temp.basket(), 69000, '{"__proto__": {"admin": true}}'), '22023', 'a __proto__ key'),
  (pg_temp.req(pg_temp.basket(), 69000, '{"request_id": "not-a-uuid"}'), '22023', 'a request_id that is not a UUID'),
  (pg_temp.req(pg_temp.basket(), 69000) - 'request_id', '22023', 'no request_id'),
  (pg_temp.req(pg_temp.basket(), 69000, '{"type": "delivery"}'), '22023', 'the type delivery'),
  (pg_temp.req('[]'::jsonb, 0), '22023', 'lines boundary: no line'),
  (pg_temp.req((select jsonb_agg(pg_temp.line('cf')) from generate_series(1, 31)), 899000), '22023', 'lines boundary: 31 lines'),
  (pg_temp.req('["cf"]'::jsonb, 29000), '22023', 'a line that is not an object'),
  (pg_temp.req(jsonb_build_array(pg_temp.line('cf', 0)), 0), '22023', 'quantity boundary: 0'),
  (pg_temp.req(jsonb_build_array(pg_temp.line('cf', 21)), 609000), '22023', 'quantity boundary: 21'),
  (pg_temp.req(jsonb_build_array(pg_temp.line('cf') || '{"qty": 1.5}'), 43500), '22023', 'a fractional quantity'),
  (pg_temp.req(jsonb_build_array(pg_temp.line('cf') || '{"qty": "2"}'), 58000), '22023', 'a quantity as text'),
  (pg_temp.req(jsonb_build_array(pg_temp.line('cf') || '{"qty": -1}'), 0), '22023', 'a negative quantity'),
  (pg_temp.req(jsonb_build_array(pg_temp.line('cf') || '{"size": "cf"}'), 29000), '22023', 'a size that is not a UUID'),
  (pg_temp.req(jsonb_build_array(pg_temp.line('cf') || jsonb_build_object('options', (select jsonb_agg(gen_random_uuid()) from generate_series(1, 11)))), 29000), '22023', 'options boundary: 11 options'),
  (pg_temp.req(jsonb_build_array(pg_temp.line('ts_m', 1, array['top_tc', 'top_tc', 'sugar_bt'])), 45000), '22023', 'an option named twice'),
  (pg_temp.req(jsonb_build_array(pg_temp.line('cf') || '{"options": ["x"]}'), 29000), '22023', 'an option that is not a UUID'),
  (pg_temp.req(jsonb_build_array(pg_temp.line('cf') || jsonb_build_object('note', repeat('n', 101))), 29000), '22023', 'line note boundary: 101 characters'),
  (pg_temp.req(jsonb_build_array(pg_temp.line('cf') || jsonb_build_object('note', 'ít' || chr(13) || chr(10) || 'đá')), 29000), '22023', 'a line note with CR LF'),
  (pg_temp.req(pg_temp.basket(), 69000, jsonb_build_object('note', repeat('n', 201))), '22023', 'order note boundary: 201 characters'),
  (pg_temp.req(pg_temp.basket(), 69000, jsonb_build_object('note', 'abc' || chr(8238) || 'def')), '22023', 'an order note with a right-to-left override'),
  (pg_temp.req(pg_temp.basket(), 69000, jsonb_build_object('note', 'tab' || chr(9))), '22023', 'an order note with a tab'),
  (pg_temp.req(pg_temp.basket(), 69000, '{"expected_total": 69000.5}'), '22023', 'a fractional expected total'),
  (pg_temp.req(pg_temp.basket(), 69000, '{"expected_total": "69000"}'), '22023', 'an expected total as text'),
  (pg_temp.req(pg_temp.basket(), 69000) - 'expected_total', '22023', 'no expected total'),
  (pg_temp.req(pg_temp.basket(), 69000, '{"payment": "cash"}'), '22023', 'an unknown payment method'),
  (pg_temp.req(pg_temp.basket(), 69000, '{"pickup_at": "tomorrow"}'), '22023', 'a pick-up time that is not an instant'),
  (pg_temp.req(pg_temp.basket(), 69000, '{"table_token": 42}'), '22023', 'a table token that is not a string'),
  (pg_temp.req(pg_temp.basket(), 69000, jsonb_build_object('table_token', 'bad token!')), '22023', 'a malformed table token'),
  (pg_temp.req(pg_temp.basket(), 69000, '{"store": 1}'), '22023', 'a store that is not a string')
) as v (req, expected, label);
select is((select count(*) from public.orders where tenant_id = (select tenant_a from fx)), (select n from counts_before), 'no malformed request wrote anything');
select is((select count(*)::int from app.code_attempts where tenant_id = (select tenant_a from fx) and subject_id = (select cust3_u from fx)), 0, 'and none counted against the customer''s call limit');

-- 3. The boundaries that are accepted -----------------------------------------------------------------------------
select is((pg_temp.place((select cust3_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('cf', 1)), 29000)) ->> 'state'), 'placed', 'quantity boundary: 1');
select is((pg_temp.place((select cust3_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('cf', 20)), 580000)) ->> 'state'), 'placed', 'quantity boundary: 20');
create temp table thirty as select pg_temp.place((select cust4_u from fx), pg_temp.req((select jsonb_agg(pg_temp.line('cf')) from generate_series(1, 30)), 870000)) as r;
select is((select r ->> 'state' from thirty), 'placed', 'lines boundary: 30 lines');
select is((select count(*)::int from public.order_lines where order_id = pg_temp.order_of((select r from thirty))), 30, 'all 30 lines are kept');
create temp table noted as
select pg_temp.place((select cust4_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('cf') || jsonb_build_object('note', '  ' || repeat('n', 100) || '  ')), 29000,
  jsonb_build_object('note', repeat('o', 200)))) as r;
select is((select r ->> 'state' from noted), 'placed', 'note boundaries: 100 (line, once trimmed) and 200 (order) characters');
select is((select char_length(note) from public.order_lines where order_id = pg_temp.order_of((select r from noted))), 100, 'a line note is kept trimmed');
select is((pg_temp.place((select cust5_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('cf') || '{"note": "   "}'), 29000)) -> 'order' -> 'lines' -> 0 ->> 'note'), null, 'a blank note is kept as none');
select is((pg_temp.place((select cust5_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('cf') || '{"options": null}'), 29000)) ->> 'state'), 'placed', 'options may be null for an item without groups');

select * from finish();
rollback;
