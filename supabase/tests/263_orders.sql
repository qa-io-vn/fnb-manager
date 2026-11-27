-- The native till, step 3 (ADR-061, native-till.md section 5): placing orders. A table order paid at the counter enters
-- the queue at once, accepted and unpaid; an order paid online waits for the server's confirmation (the payment seam)
-- and takes no number before it; every refusal is answered as data and writes nothing; the limits (open orders per
-- customer, calls per customer, the prank block); orders keyed at the counter; the cart check; the minute job; the
-- counter's queue, the busy reason and the table map; the customer's reads.
-- Techniques: equivalence partitions of requests (each refusal reason once), boundary values (pick-up at the
-- preparation time and one second before, the order amount at the limit and one dong over, the 3rd and 4th open order,
-- the 20th and 21st call, the payment window at 14:59 and 15:00), state transitions T1 to T4, error guessing (a customer
-- as the payer of record, a payment after the window, another store's table at the counter).
begin;
select plan(105);

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
-- "Đã thu" in cash at the counter of A1 by its staff member, for the order's total and current version.
create function pg_temp.pay(p_order uuid, p_at timestamptz default null) returns jsonb language sql as $$
  select pg_temp.call((select staff_u from fx), format($q$select app.counter_record_payment(%L, 'cash', %s, %s, %L)$q$, p_order,
    (select o.total from public.orders o where o.id = p_order), (select o.version from public.orders o where o.id = p_order),
    coalesce(p_at, (select noon from fx) + interval '30 seconds')));
$$;
-- The online seams as the Edge Functions call them: an attempt for the order's customer, then the provider's answer.
create function pg_temp.start_online(p_order uuid, p_key text, p_at timestamptz default null) returns jsonb language sql as $$
  select app.checkout_payment_start((select l.user_id from app.customer_logins l join public.orders o on o.customer_login_id = l.id where o.id = p_order),
    p_order, (select o.payment_method from public.orders o where o.id = p_order), p_key, coalesce(p_at, (select noon from fx) + interval '1 minute'));
$$;
create function pg_temp.confirm_online(p_payment uuid, p_amount numeric, p_ok boolean, p_ref text, p_at timestamptz default null) returns jsonb language sql as $$
  select app.checkout_payment_confirm((select p.provider from public.order_payments p where p.id = p_payment), p_ref, p_payment, p_amount, p_ok, null,
    coalesce(p_at, (select noon from fx) + interval '1 minute'));
$$;
create function pg_temp.pay_online(p_order uuid, p_amount numeric, p_ok boolean, p_ref text, p_at timestamptz default null) returns jsonb language sql as $$
  select pg_temp.confirm_online((pg_temp.start_online(p_order, 'key-' || p_ref, p_at) ->> 'payment_id')::uuid, p_amount, p_ok, p_ref, p_at);
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

-- 1. A table order paid at the counter (T2) -------------------------------------------------------------------------
create temp table o1 as select pg_temp.place((select cust1_u from fx), pg_temp.req(pg_temp.basket(), 69000)) as r;
select is((select r ->> 'state' from o1), 'placed', 'a table order paid at the counter is placed');
select is((select (r -> 'order' ->> 'status') || '/' || (r -> 'order' ->> 'payment_status') from o1), 'accepted/unpaid', 'it enters the queue at once, accepted and unpaid');
select is((select r -> 'order' ->> 'display_no' from o1), '#001', 'it takes the first number of the business day');
select is((select (r -> 'order' ->> 'total')::int from o1), 69000, 'the total is computed from the menu''s prices');
select is((select r -> 'order' -> 'table' ->> 'label' from o1), 'Bàn 1', 'the order carries the table its token names');
select is((select r -> 'order' -> 'table' ->> 'id' from o1), null, 'the customer''s answer carries no table id');
select is((select count(*)::int from public.order_lines where order_id = pg_temp.order_of((select r from o1))), 2, 'two lines are written');
select is(
  (select l.item_name || '/' || l.size_label || '/' || l.unit_price::bigint || '/' || l.options_amount::bigint || '/' || l.line_total::bigint || '/' || l.counts_for_stamps
   from public.order_lines l where l.order_id = pg_temp.order_of((select r from o1)) and l.line_no = 1),
  'Trà sữa/M/35000/5000/40000/true', 'a line keeps the name, size, price, options amount, total and stamp flag it was sold at'
);
select is(
  (select string_agg(o ->> 'name' || '=' || (o ->> 'price'), ',') from public.order_lines l, jsonb_array_elements(l.options) o where l.order_id = pg_temp.order_of((select r from o1)) and l.line_no = 1),
  'Trân châu=5000,Bình thường=0', 'the options are kept with their names and amounts, in the menu''s order'
);
select is(
  (select string_agg(action || ':' || to_state || ':' || actor_kind, ',' order by id) from public.order_events where order_id = pg_temp.order_of((select r from o1))),
  'placed:accepted:customer', 'the placement writes one event'
);
select is((select (pg_temp.place((select cust1_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('cf')), 29000)) -> 'order' ->> 'order_no')::int), 2, 'the next order takes number 2');
update public.menu_item_sizes set price = 36000 where id = pg_temp.id('ts_m');
select is((select l.unit_price::bigint from public.order_lines l where l.order_id = pg_temp.order_of((select r from o1)) and l.line_no = 1), 35000::bigint, 'a later price change never alters a placed order');
update public.menu_item_sizes set price = 35000 where id = pg_temp.id('ts_m');

-- 2. An order paid online waits for the server's confirmation (T1, T3) -------------------------------------------
create temp table o3 as
select pg_temp.place((select cust2_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('ta')), 40000, jsonb_build_object('type', 'takeaway', 'table_token', null, 'payment', 'vietqr'))) as r;
select is((select r ->> 'state' from o3), 'awaiting_payment', 'an order paid online waits for its payment');
select is((select r -> 'order' ->> 'order_no' from o3), null, 'it takes no number before its payment');
select is((select (r -> 'order' ->> 'payment_due_at')::timestamptz from o3), (select noon from fx) + interval '15 minutes', 'its payment window is the store''s 15 minutes');
select ok(
  not has_function_privilege('authenticated', 'app.order_payment_succeeded(uuid, numeric, text, uuid, timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'app.order_payment_succeeded(uuid, numeric, text, uuid, timestamptz)', 'execute'),
  'no client can mark an order paid: the payment seam is the server''s'
);
select is(pg_temp.pay_online(pg_temp.order_of((select r from o3)), 39999, true, 'ref-263-1') ->> 'refusal', 'amount_differs', 'a provider notification of another amount is refused');
select is((select status::text || '/' || payment_status::text from public.orders where id = pg_temp.order_of((select r from o3))), 'awaiting_payment/unpaid', 'and changes nothing');
select is(pg_temp.pay_online(pg_temp.order_of((select r from o3)), 40000, true, 'ref-263-2') ->> 'state', 'succeeded', 'a verified payment of the full amount is recorded');
select is((select status::text || '/' || payment_status::text || '/' || order_no from public.orders where id = pg_temp.order_of((select r from o3))), 'accepted/paid/3', 'and the server alone accepts the order with the next number');
select is(app.checkout_payment_confirm('vietqr', 'ref-263-2', gen_random_uuid(), 40000, true, null, (select noon from fx) + interval '2 minutes') ->> 'replayed', 'true', 'a repeated notification of the same transaction is a replay');
select is(
  (select string_agg(action || ':' || to_state || ':' || actor_kind || coalesce(':' || amount::bigint, ''), ',' order by id) from public.order_events where order_id = pg_temp.order_of((select r from o3))),
  'placed:awaiting_payment:customer:40000,payment_started:unpaid:customer:40000,payment_failed:unpaid:provider:39999,payment_started:unpaid:customer:40000,paid:paid:provider:40000,payment_confirmed:accepted:provider', 'the timeline holds the placement, both attempts, the payment with its amount and the acceptance'
);
select throws_ok($$select app.order_payment_succeeded('aaaaaaaa-aaaa-4aaa-8aaa-000000026399', 1, 'customer', null, now())$$, '22023', null, 'a customer can never be the payer of record');
select throws_ok(format($$select app.order_payment_succeeded(%L, 69000, 'staff', null, now())$$, pg_temp.order_of((select r from o1))), '22023', null, 'nothing is marked paid without a payment record backing it');

-- 3. Refusals as data, nothing written --------------------------------------------------------------------------
create temp table before_refusals as select count(*) as n from public.orders where tenant_id = (select tenant_a from fx);
select is((pg_temp.place((select cust1_u from fx), pg_temp.req(pg_temp.basket(), 69000, jsonb_build_object('store', 'sa-2', 'type', 'takeaway', 'table_token', null))) ->> 'refusal'), 'ordering_off', 'a type the store does not take is refused');
update public.store_ordering_settings set paused_until = (select noon from fx) + interval '10 minutes' where store_id = (select store_a1 from fx);
select is((pg_temp.place((select cust1_u from fx), pg_temp.req(pg_temp.basket(), 69000)) ->> 'refusal'), 'paused', 'a paused store refuses with its reason');
update public.store_ordering_settings set paused_until = null where store_id = (select store_a1 from fx);
select is((pg_temp.place((select cust1_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('ta')), 40000, jsonb_build_object('type', 'takeaway', 'table_token', null))) ->> 'refusal'), 'payment_not_allowed', 'takeaway cannot be paid at the counter (it is prepaid)');
select is((pg_temp.place((select cust1_u from fx), pg_temp.req(pg_temp.basket(), 69000, jsonb_build_object('payment', 'zalo_checkout'))) ->> 'refusal'), 'payment_not_allowed', 'a payment method the store has not switched on is refused');
select is((pg_temp.place((select cust1_u from fx), pg_temp.req(pg_temp.basket(), 69000, jsonb_build_object('table_token', 'AAAAAAAAAAAAAAAAAAAAAA'))) ->> 'refusal'), 'table_unknown', 'an unknown table token is refused');
select is((pg_temp.place((select cust1_u from fx), pg_temp.req(pg_temp.basket(), 69000, jsonb_build_object('table_token', pg_temp.token('Bàn 2')))) ->> 'refusal'), 'table_unknown', 'another store''s table token is refused alike');
select is((pg_temp.place((select cust1_u from fx), pg_temp.req(pg_temp.basket(), 69000, jsonb_build_object('table_token', null))) ->> 'refusal'), 'table_unknown', 'a table order without a token is refused');
select is((pg_temp.place((select cust1_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('ta')), 40000, jsonb_build_object('type', 'takeaway', 'payment', 'vietqr'))) ->> 'refusal'), 'table_not_for_takeaway', 'a takeaway order carries no table');
select is((pg_temp.place((select cust1_u from fx), pg_temp.req(pg_temp.basket(), 69000, jsonb_build_object('pickup_at', '2026-11-25T12:00:00+07:00'))) ->> 'refusal'), 'pickup_time_invalid', 'a table order has no pick-up time');
select is((pg_temp.place((select cust1_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('ta')), 40000, jsonb_build_object('type', 'takeaway', 'table_token', null, 'payment', 'vietqr', 'pickup_at', '2026-11-25T10:09:59+07:00'))) ->> 'refusal'), 'pickup_time_invalid', 'pick-up boundary: one second before the preparation time is refused');
select is((pg_temp.place((select cust4_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('ta')), 40000, jsonb_build_object('type', 'takeaway', 'table_token', null, 'payment', 'vietqr', 'pickup_at', '2026-11-25T10:10:00+07:00'))) ->> 'state'), 'awaiting_payment', 'pick-up boundary: the preparation time itself is accepted');
select is((pg_temp.place((select cust1_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('ta')), 40000, jsonb_build_object('type', 'takeaway', 'table_token', null, 'payment', 'vietqr', 'pickup_at', '2026-11-26T09:00:00+07:00'))) ->> 'refusal'), 'pickup_time_invalid', 'a pick-up on another business day is refused');
select is(pg_temp.call((select staff_u from fx), format($$select app.counter_set_sold_out(%L, %L, true, null, %L)$$, (select store_a1 from fx), pg_temp.id('item_cf'), (select noon from fx))) ->> 'sold_out', 'true', 'staff switch the coffee sold out');
create temp table sold_out as select pg_temp.place((select cust1_u from fx), pg_temp.req(pg_temp.basket(), 69000)) as r;
select is((select r ->> 'refusal' from sold_out), 'item_unavailable', 'an order with an item just sold out is refused (acceptance criterion 2)');
select is((select r -> 'unavailable_items' from sold_out), jsonb_build_array(pg_temp.id('item_cf')), 'the refusal names the item, so the basket can say which');
select is(pg_temp.call((select staff_u from fx), format($$select app.counter_set_sold_out(%L, %L, false, null, %L)$$, (select store_a1 from fx), pg_temp.id('item_cf'), (select noon from fx))) ->> 'sold_out', 'false', 'staff make it available again');
select is((pg_temp.place((select cust1_u from fx), pg_temp.req(jsonb_build_array(jsonb_build_object('size', 'bbbbbbbb-bbbb-4bbb-8bbb-000000026398', 'qty', 1)), 1)) ->> 'refusal'), 'item_unavailable', 'an unknown size is refused');
select is((pg_temp.place((select cust1_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('bb')), 20000)) ->> 'refusal'), 'item_unavailable', 'another brand''s item is refused');
select is((pg_temp.place((select cust1_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('ta')), 40000)) ->> 'refusal'), 'item_unavailable', 'a takeaway-only item is refused in a table order');
select is((pg_temp.place((select cust1_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('ts_m')), 35000)) ->> 'refusal'), 'option_invalid', 'a required option group left out is refused');
select is((pg_temp.place((select cust1_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('ts_m', 1, array['sugar_bt', 'sugar_it'])), 35000)) ->> 'refusal'), 'option_invalid', 'more options than a group allows are refused');
select is((pg_temp.place((select cust1_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('cf', 1, array['top_tc'])), 34000)) ->> 'refusal'), 'option_invalid', 'an option of a group the item does not offer is refused');
select is((pg_temp.place((select cust1_u from fx), pg_temp.req(jsonb_build_array(jsonb_build_object('size', pg_temp.id('cf'), 'qty', 1, 'options', jsonb_build_array('dddddddd-dddd-4ddd-8ddd-000000026399'))), 29000)) ->> 'refusal'), 'option_invalid', 'an unknown option is refused');
select is((pg_temp.place((select cust4_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('ts_m', 1, array['top_tc', 'top_th', 'sugar_it'])), 40000)) ->> 'state'), 'placed', 'two toppings (the group''s maximum) and one sugar are accepted');
delete from app.code_attempts where tenant_id = (select tenant_a from fx);
create temp table changed as select pg_temp.place((select cust1_u from fx), pg_temp.req(pg_temp.basket(), 60000)) as r;
select is((select r ->> 'refusal' from changed), 'price_changed', 'a total other than the server''s is refused (S1)');
select is((select (r ->> 'total')::int from changed), 69000, 'the refusal gives the server''s total');
select ok((select r ? 'menu_version' from changed), 'and the current menu version');
update public.store_ordering_settings set max_order_amount = 68999 where store_id = (select store_a1 from fx);
select is((pg_temp.place((select cust1_u from fx), pg_temp.req(pg_temp.basket(), 69000)) ->> 'refusal'), 'amount_over_limit', 'amount boundary: one dong over the limit is refused');
update public.store_ordering_settings set max_order_amount = 69000 where store_id = (select store_a1 from fx);
select is((pg_temp.place((select cust2_u from fx), pg_temp.req(pg_temp.basket(), 69000)) ->> 'state'), 'placed', 'amount boundary: the limit itself is accepted');
update public.store_ordering_settings set max_order_amount = 2000000 where store_id = (select store_a1 from fx);
select is(
  (select count(*) from public.orders where tenant_id = (select tenant_a from fx)) - (select n from before_refusals),
  3::bigint, 'the refusals wrote nothing: only the three accepted requests made orders'
);
select is((pg_temp.place((select cust1_u from fx), pg_temp.req(pg_temp.basket(), 69000, jsonb_build_object('store', 'sb-1'))) ->> 'error'), '22023', 'a store of another brand is 22023');
select is((pg_temp.place((select manager_u from fx), pg_temp.req(pg_temp.basket(), 69000)) ->> 'error'), '42501', 'a member of the tenant is not a customer session');

-- 4. Limits: open orders, calls per customer, pranks ---------------------------------------------------------------
create temp table c3 as
select n, pg_temp.place((select cust3_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('cf')), 29000)) as r from generate_series(1, 4) as n;
select is((select string_agg(coalesce(r ->> 'refusal', r ->> 'state'), ',' order by n) from c3), 'placed,placed,placed,too_many_open_orders', 'open-order boundary: the 3rd open order is placed, the 4th refused');
select is((pg_temp.act((select staff_u from fx), pg_temp.order_of(r), 'cancel', 'suspected_prank') ->> 'customer_blocked'), 'false', 'a first suspected prank blocks nobody') from c3 where n = 1;
select is((pg_temp.act((select staff_u from fx), pg_temp.order_of(r), 'cancel', 'suspected_prank') ->> 'customer_blocked'), 'false', 'a second blocks nobody') from c3 where n = 2;
select is((pg_temp.act((select staff_u from fx), pg_temp.order_of(r), 'cancel', 'suspected_prank') ->> 'customer_blocked'), 'true', 'the third within 7 days blocks the customer') from c3 where n = 3;
select is((select (blocked_until - (select noon from fx) - interval '1 minute')::text from public.customer_order_blocks where customer_login_id = (select id from app.customer_logins where user_id = (select cust3_u from fx))), '7 days', 'for 7 days');
select is((pg_temp.place((select cust3_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('cf')), 29000)) ->> 'refusal'), 'blocked', 'a blocked customer cannot order');
select pg_temp.claims((select staff_u from fx));
set local role authenticated;
select is((select count(*)::int from public.customer_order_blocks), 0, 'staff do not see blocks');
reset role;
select pg_temp.claims((select viewer_u from fx));
set local role authenticated;
select is((select count(*)::int from public.customer_order_blocks), 0, 'nor does a viewer');
reset role;
select set_config('request.jwt.claims', '', true);
select pg_temp.claims((select manager_u from fx));
set local role authenticated;
delete from public.customer_order_blocks;
reset role;
select set_config('request.jwt.claims', '', true);
select is((pg_temp.place((select cust3_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('cf')), 29000)) ->> 'state'), 'placed', 'a manager lifts the block by deleting it');
delete from app.code_attempts where tenant_id = (select tenant_a from fx);
create temp table burst as
select n, pg_temp.place((select cust1_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('cf')), 1)) as r from generate_series(1, 21) as n;
select is((select r ->> 'refusal' from burst where n = 20), 'price_changed', 'call boundary: the 20th call in 15 minutes is answered');
select is((select r ->> 'refusal' from burst where n = 21), 'rate_limited', 'call boundary: the 21st is rate_limited (S9)');
select is((select (r ->> 'retry_at')::timestamptz from burst where n = 21), (select noon from fx) + interval '15 minutes', 'with the time the lock ends');
select is((pg_temp.place((select cust1_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('cf')), 29000), (select noon from fx) + interval '15 minutes') ->> 'state'), 'placed', 'at the lock''s end the customer orders again');
delete from app.code_attempts where tenant_id = (select tenant_a from fx);

-- 5. Orders keyed at the counter ----------------------------------------------------------------------------------
create temp table k1 as select pg_temp.call((select staff_u from fx), format($$select app.counter_create_order(%L, %L::jsonb, %L)$$,
  (select store_a1 from fx), jsonb_build_object('request_id', 'aaaaaaaa-aaaa-4aaa-8aaa-000000026361', 'type', 'table', 'table_id', pg_temp.id('table_a1'), 'lines', jsonb_build_array(pg_temp.line('bm', 2))), (select noon from fx))) as r;
select is((select (r ->> 'state') || '/' || (r -> 'order' ->> 'status') || '/' || (r -> 'order' ->> 'payment_status') || '/' || (r -> 'order' ->> 'source') from k1), 'placed/accepted/unpaid/counter', 'staff key an order at the counter: accepted and unpaid');
select is((select (r -> 'order' ->> 'total')::int from k1), 60000, 'priced from the menu like any order');
select is((select r -> 'order' -> 'table' ->> 'id' from k1), pg_temp.id('table_a1')::text, 'the counter''s answer carries the table id');
select is((select created_by from public.orders where id = pg_temp.order_of((select r from k1))), (select staff_u from fx), 'the order records who keyed it');
select is(pg_temp.call((select staff_u from fx), format($$select app.counter_create_order(%L, %L::jsonb, %L)$$,
  (select store_a1 from fx), jsonb_build_object('request_id', 'aaaaaaaa-aaaa-4aaa-8aaa-000000026361', 'type', 'table', 'table_id', pg_temp.id('table_a1'), 'lines', jsonb_build_array(pg_temp.line('bm', 2))), (select noon from fx))) ->> 'replayed',
  'true', 'the same request from the counter is a replay');
select is(pg_temp.call((select staff_u from fx), format($$select app.counter_create_order(%L, %L::jsonb, %L)$$,
  (select store_a1 from fx), jsonb_build_object('request_id', gen_random_uuid(), 'type', 'takeaway', 'table_id', pg_temp.id('table_a1'), 'lines', jsonb_build_array(pg_temp.line('cf'))), (select noon from fx))) ->> 'refusal',
  'table_not_for_takeaway', 'a counter takeaway order carries no table');
select is(pg_temp.call((select staff_u from fx), format($$select app.counter_create_order(%L, %L::jsonb, %L)$$,
  (select store_a1 from fx), jsonb_build_object('request_id', gen_random_uuid(), 'type', 'table', 'table_id', pg_temp.id('table_a2'), 'lines', jsonb_build_array(pg_temp.line('cf'))), (select noon from fx))) ->> 'refusal',
  'table_unknown', 'a table of another store is refused at the counter');
select is(pg_temp.call((select staff_a2_u from fx), format($$select app.counter_create_order(%L, %L::jsonb, %L)$$,
  (select store_a1 from fx), jsonb_build_object('request_id', gen_random_uuid(), 'type', 'takeaway', 'lines', jsonb_build_array(pg_temp.line('cf'))), (select noon from fx))) ->> 'error',
  '42501', 'staff of another store key no order here');
update public.store_ordering_settings set till_mode = 'ipos' where store_id = (select store_b1 from fx);
select is(pg_temp.call((select owner_b_u from fx), format($$select app.counter_create_order(%L, %L::jsonb, %L)$$,
  (select store_b1 from fx), jsonb_build_object('request_id', gen_random_uuid(), 'type', 'table', 'table_id', pg_temp.id('table_b1'), 'lines', jsonb_build_array(pg_temp.line('bb'))), (select noon from fx))) ->> 'refusal',
  'not_native', 'an ipos store keys no order here');

-- 6. The cart check -----------------------------------------------------------------------------------------------
select is((pg_temp.call((select cust1_u from fx), format($$select app.customer_check_cart(%L::jsonb, %L)$$, jsonb_build_object('store', 'sa-1', 'type', 'table', 'lines', pg_temp.basket()), (select noon from fx))) ->> 'total')::int, 69000, 'the cart check prices the basket without writing');
select is(pg_temp.call((select staff_u from fx), format($$select app.counter_set_sold_out(%L, %L, true, null, %L)$$, (select store_a1 from fx), pg_temp.id('item_cf'), (select noon from fx))) ->> 'sold_out', 'true', 'the coffee goes sold out again');
select is((pg_temp.call((select cust1_u from fx), format($$select app.customer_check_cart(%L::jsonb, %L)$$, jsonb_build_object('store', 'sa-1', 'type', 'table', 'lines', pg_temp.basket()), (select noon from fx) + interval '1 minute')) -> 'unavailable_items'), jsonb_build_array(pg_temp.id('item_cf')), 'and names an item that just went');

-- 7. The minute job: online payments that never came --------------------------------------------------------------
create temp table o9 as
select pg_temp.place((select cust5_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('ta')), 40000, jsonb_build_object('type', 'takeaway', 'table_token', null, 'payment', 'vietqr'))) as r;
create temp table o9_attempt as select pg_temp.start_online(pg_temp.order_of((select r from o9)), 'key-263-9', (select noon from fx) + interval '5 minutes') as a;
select is((app.ordering_tick((select noon from fx) + interval '14 minutes 59 seconds') ->> 'payment_timeouts')::int, 0, 'payment boundary: at 14:59 the order still waits');
select is((app.ordering_tick((select noon from fx) + interval '15 minutes') ->> 'payment_timeouts')::int >= 1, true, 'payment boundary: at 15:00 the job cancels it');
select is((select status::text || '/' || cancel_reason || '/' || cancel_actor || '/' || coalesce(order_no::text, 'none') from public.orders where id = pg_temp.order_of((select r from o9))), 'cancelled/payment_timeout/system/none', 'cancelled by the system, without a number');
select is(pg_temp.confirm_online(((select a from o9_attempt) ->> 'payment_id')::uuid, 40000, true, 'ref-263-9', (select noon from fx) + interval '16 minutes') ->> 'refund_due', 'true', 'a payment arriving after the window is kept as a due refund');
select is((select payment_status::text || '/' || (select string_agg(status || ':' || amount::bigint, ',') from public.order_refunds r where r.order_id = o.id) from public.orders o where o.id = pg_temp.order_of((select r from o9))), 'refund_pending/due:40000', 'the cancelled order shows the refund it owes');
select ok(not exists (select 1 from cron.job where jobname = 'ordering-tick'), 'the minute job is created off');

-- 8. The counter's queue, busy and the table map ------------------------------------------------------------------
create temp table board_1 as select pg_temp.call((select staff_u from fx), format($$select app.counter_board(%L, 0, %L)$$, (select store_a1 from fx), (select noon from fx) + interval '20 minutes')) as r;
select ok((select jsonb_array_length(r -> 'orders') from board_1) > 0, 'the board lists the store''s orders');
select is((select count(*)::int from board_1, jsonb_array_elements(r -> 'orders') o where o ->> 'status' = 'awaiting_payment'), 0, 'never one still waiting for its online payment');
select is((select count(*)::int from board_1, jsonb_array_elements(r -> 'orders') o where o ->> 'status' = 'cancelled' and o ->> 'order_no' is null), 0, 'nor an online attempt that was never paid');
select ok((select seen_at from app.ordering_presence where store_id = (select store_a1 from fx) and user_id = (select staff_u from fx)) = (select noon from fx) + interval '20 minutes', 'the board records the counter''s presence');
select is((select r -> 'counts' ->> 'unpaid' from board_1)::int > 0, true, 'the counts show the unpaid orders');
select is((select (o ->> 'late')::boolean from board_1, jsonb_array_elements(r -> 'orders') o where (o ->> 'id')::uuid = pg_temp.order_of((select r from o1))), true, 'an order accepted 20 minutes ago is late (10 minutes)');
select is((select (o ->> 'late')::boolean from board_1, jsonb_array_elements(r -> 'orders') o where o ->> 'status' = 'accepted' and (o ->> 'accepted_at')::timestamptz = (select noon from fx) + interval '15 minutes' limit 1), false, 'one accepted 5 minutes ago is not');
create temp table board_2 as select pg_temp.call((select staff_u from fx), format($$select app.counter_board(%L, %s, %L)$$, (select store_a1 from fx), (select r ->> 'cursor' from board_1), (select noon from fx) + interval '20 minutes')) as r;
select is((select jsonb_array_length(r -> 'orders') from board_2), 0, 'polling from the cursor answers nothing new');
select is((pg_temp.act((select staff_u from fx), pg_temp.order_of((select r from o1)), 'start') ->> 'state'), 'ok', 'staff start an order');
create temp table board_3 as select pg_temp.call((select staff_u from fx), format($$select app.counter_board(%L, %s, %L)$$, (select store_a1 from fx), (select r ->> 'cursor' from board_1), (select noon from fx) + interval '21 minutes')) as r;
select is((select string_agg(o ->> 'status', ',') from board_3, jsonb_array_elements(r -> 'orders') o), 'preparing', 'the next poll answers exactly the changed order');
select is(pg_temp.call((select staff_a2_u from fx), format($$select app.counter_board(%L, 0, %L)$$, (select store_a1 from fx), (select noon from fx))) ->> 'error', '42501', 'staff of another store read no board');
select ok((select (t ->> 'open_orders')::int from (select pg_temp.call((select staff_u from fx), format($$select app.counter_table_map(%L, %L)$$, (select store_a1 from fx), (select noon from fx))) as r) m, jsonb_array_elements(m.r -> 'tables') t where t ->> 'label' = 'Bàn 1') > 0, 'the table map counts the table''s open orders');
update public.store_ordering_settings set max_waiting_orders = 3 where store_id = (select store_a1 from fx);
select is(app.ordering_state((select store_a1 from fx), 'table', (select noon from fx)) ->> 'reason', 'busy', 'busy: accepted orders not started reach max_waiting_orders');
update public.store_ordering_settings set max_waiting_orders = 30 where store_id = (select store_a1 from fx);

-- 9. The customer's reads and the till mode ------------------------------------------------------------------------
select is((pg_temp.call((select cust1_u from fx), format($$select app.customer_orders(null, %L)$$, (select noon from fx))) -> 'orders' -> 0 ->> 'status') is not null, true, 'the customer lists their orders');
create temp table listed as select o ->> 'id' as id from jsonb_array_elements(pg_temp.call((select cust1_u from fx), format($$select app.customer_orders(null, %L)$$, (select noon from fx) + interval '30 minutes')) -> 'orders') o;
select is((select count(*)::int from listed where id::uuid not in (select o.id from public.orders o join app.customer_logins l on l.id = o.customer_login_id where l.user_id = (select cust1_u from fx))), 0, 'and only their own');
select is(
  (select string_agg(e ->> 'to', ',') from jsonb_array_elements(pg_temp.call((select cust1_u from fx), format($$select app.customer_order(%L, %L)$$, pg_temp.order_of((select r from o1)), (select noon from fx))) -> 'order' -> 'timeline') e),
  'accepted,preparing', 'the order screen shows the timeline'
);
select is(
  (select count(*)::int from jsonb_array_elements(pg_temp.call((select cust1_u from fx), format($$select app.customer_order(%L, %L)$$, pg_temp.order_of((select r from o1)), (select noon from fx))) -> 'order' -> 'timeline') e where e ->> 'actor_user_id' is not null),
  0, 'without the staff member''s identity'
);
select is(pg_temp.call((select owner_u from fx), format($$select app.set_store_till_mode(%L, 'ipos')$$, (select store_a1 from fx))) ->> 'error', '22023', 'a store with open orders cannot go back to ipos');

select * from finish();
rollback;
