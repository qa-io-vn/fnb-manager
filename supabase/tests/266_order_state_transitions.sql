-- The native till, step 3 (ADR-061, native-till.md 5.1 and 5.2): the order lifecycle and the payment status as a state
-- machine owned by the database. Every valid transition once (0-switch: T1 to T10), the main paths end to end
-- (1-switch: the table path paid at the counter, the takeaway paths prepaid at the counter and online), every action
-- that is not in the lifecycle from every state refused as data, replays without a second event, two devices acting on
-- one version, the payment rules (completion only when paid, takeaway started only when paid, a paid order cancelled
-- by staff with its refund due), and the append-only log.
begin;
select plan(64);

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

-- Orders in every state, keyed at the counter (no customer limits) or placed by customers.
create temp table o as
select 'table' as name, pg_temp.order_of(pg_temp.keyed('table', jsonb_build_array(pg_temp.line('cf')))) as id union all
select 'takeaway', pg_temp.order_of(pg_temp.keyed('takeaway', jsonb_build_array(pg_temp.line('cf')))) union all
select 'online', pg_temp.order_of(pg_temp.place((select cust1_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('ta')), 40000, jsonb_build_object('type', 'takeaway', 'table_token', null, 'payment', 'vietqr')))) union all
select 'cancel_me', pg_temp.order_of(pg_temp.keyed('table', jsonb_build_array(pg_temp.line('cf')))) union all
select 'paid_cancel', pg_temp.order_of(pg_temp.keyed('table', jsonb_build_array(pg_temp.line('cf')))) union all
select 'cust_accepted', pg_temp.order_of(pg_temp.place((select cust2_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('cf')), 29000))) union all
select 'cust_paid', pg_temp.order_of(pg_temp.place((select cust2_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('cf')), 29000))) union all
select 'cust_awaiting', pg_temp.order_of(pg_temp.place((select cust3_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('ta')), 40000, jsonb_build_object('type', 'takeaway', 'table_token', null, 'payment', 'vietqr'))));
grant select on o to authenticated;
create function pg_temp.o(p_name text) returns uuid language sql stable as $$ select id from o where name = p_name $$;
create function pg_temp.st(p_name text) returns text language sql stable as $$ select status::text || '/' || payment_status::text || '/v' || version from public.orders where id = pg_temp.o(p_name) $$;
create function pg_temp.ev(p_name text) returns integer language sql stable as $$ select count(*)::int from public.order_events where order_id = pg_temp.o(p_name) $$;
select is((select count(*)::int from o where id is null), 0, 'every order of the fixture was created');

-- 1. The table path paid at the counter: T2, T5, T7, T9 ----------------------------------------------------------
select is(pg_temp.st('table'), 'accepted/unpaid/v1', 'T2: a counter order starts accepted and unpaid');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('table'), 'start') ->> 'state'), 'ok', 'T5: start (Bắt đầu pha) on an unpaid table order is allowed');
select is(pg_temp.st('table'), 'preparing/unpaid/v2', 'it is preparing, the version moved');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('table'), 'done') -> 'order' ->> 'status'), 'serving', 'T7: done on a table order means serving (Đang mang ra)');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('table'), 'complete') ->> 'refusal'), 'payment_required', 'an unpaid order cannot be completed');
select is(pg_temp.st('table'), 'serving/unpaid/v3', 'the refusal changed nothing');
select is((pg_temp.pay(pg_temp.o('table')) ->> 'state'), 'paid', 'the counter records the payment');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('table'), 'complete') -> 'order' ->> 'status'), 'completed', 'T9: once paid, the order is completed');
select is(pg_temp.ev('table'), 5, 'one event per step: placed, preparing, serving, paid, completed');
select throws_ok(format($$update public.orders set payment_status = 'unpaid' where id = %L$$, pg_temp.o('table')), '23514', null, 'the database itself refuses a completed order that is unpaid');

-- 2. The takeaway paths: prepaid, T1, T3, T6, T8 ------------------------------------------------------------------
select is((pg_temp.act((select staff_u from fx), pg_temp.o('takeaway'), 'start') ->> 'refusal'), 'payment_required', 'an unpaid takeaway order cannot be started (takeaway is prepaid)');
select is((pg_temp.pay(pg_temp.o('takeaway')) ->> 'state'), 'paid', 'paid at the counter');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('takeaway'), 'start') ->> 'state'), 'ok', 'then started');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('takeaway'), 'done') -> 'order' ->> 'status'), 'ready', 'T6: done on a takeaway order means ready (Sẵn sàng)');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('takeaway'), 'complete') -> 'order' ->> 'status'), 'completed', 'T8: picked up, completed');
select is(pg_temp.st('online'), 'awaiting_payment/unpaid/v1', 'T1: an online order awaits its payment');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('online'), 'start') ->> 'refusal'), 'not_allowed', 'staff cannot start an order awaiting its payment');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('online'), 'complete') ->> 'refusal'), 'not_allowed', 'nor complete it');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('online'), 'done') ->> 'refusal'), 'not_allowed', 'nor finish it');
select is((app.order_payment_succeeded(pg_temp.o('online'), 40000, 'provider', null, (select noon from fx) + interval '2 minutes') ->> 'status'), 'accepted', 'T3: only the server''s confirmation accepts it');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('online'), 'start') ->> 'state'), 'ok', 'a paid takeaway order is started');

-- 3. Cancellations: T4 and T10 -------------------------------------------------------------------------------------
select is((pg_temp.call((select cust3_u from fx), format($$select app.customer_cancel_order(%L, %L)$$, pg_temp.o('cust_awaiting'), (select noon from fx))) ->> 'state'), 'cancelled', 'T4: the customer backs out of an order awaiting payment');
select is((select cancel_actor || '/' || cancel_reason from public.orders where id = pg_temp.o('cust_awaiting')), 'customer/customer_cancelled', 'the cancellation records who and why');
select is((pg_temp.call((select cust3_u from fx), format($$select app.customer_cancel_order(%L, %L)$$, pg_temp.o('cust_awaiting'), (select noon from fx))) ->> 'replayed'), 'true', 'cancelling twice is a replay');
select is((pg_temp.call((select cust2_u from fx), format($$select app.customer_cancel_order(%L, %L)$$, pg_temp.o('cust_accepted'), (select noon from fx))) ->> 'state'), 'cancelled', 'T10: the customer cancels an accepted order still unpaid');
select is((pg_temp.pay(pg_temp.o('cust_paid')) ->> 'state'), 'paid', 'another customer order is paid at the counter');
select is((pg_temp.call((select cust2_u from fx), format($$select app.customer_cancel_order(%L, %L)$$, pg_temp.o('cust_paid'), (select noon from fx))) ->> 'refusal'), 'contact_store', 'a paid order is cancelled only by staff: the customer is sent to the counter');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('cancel_me'), 'cancel') ->> 'error'), '22023', 'a staff cancellation needs a reason code');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('cancel_me'), 'cancel', 'other') ->> 'error'), '22023', 'other needs a text');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('cancel_me'), 'cancel', 'bored') ->> 'error'), '22023', 'an unknown reason is refused');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('cancel_me'), 'cancel', 'other:' || repeat('x', 201)) ->> 'error'), '22023', 'a reason text over 200 characters is refused');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('cancel_me'), 'cancel', 'other:Khách đổi ý') -> 'order' ->> 'status'), 'cancelled', 'T10: staff cancel an accepted order with a reason');
select is((select cancel_reason || '/' || cancel_note || '/' || cancel_actor || '/' || (cancelled_by = (select staff_u from fx)) from public.orders where id = pg_temp.o('cancel_me')), 'other/Khách đổi ý/staff/true', 'the log names the reason, the text and who cancelled');
select is((pg_temp.pay(pg_temp.o('paid_cancel')) ->> 'state'), 'paid', 'a counter order is paid');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('paid_cancel'), 'cancel', 'customer_request') -> 'order' ->> 'payment_status'), 'refund_pending', 'cancelling a paid order makes its refund due');
select is(
  (select string_agg(action || ':' || to_state || coalesce(':' || amount::bigint, ''), ',' order by id) from public.order_events where order_id = pg_temp.o('paid_cancel') and id > (select min(id) from public.order_events where order_id = pg_temp.o('paid_cancel'))),
  'paid:paid:29000,cancel:cancelled:29000,refund_due:refund_pending:29000', 'every cancel and refund is logged with the amount'
);
select is((pg_temp.pay(pg_temp.o('paid_cancel')) ->> 'refusal'), 'not_payable', 'a cancelled order is not paid again');

-- 4. Every action that is not in the lifecycle is refused as data ------------------------------------------------
select is(coalesce(pg_temp.act((select staff_u from fx), pg_temp.o(v.name), v.action, case when v.action = 'cancel' then 'customer_request' end) ->> 'refusal', 'replayed:' || (pg_temp.act((select staff_u from fx), pg_temp.o(v.name), v.action, case when v.action = 'cancel' then 'customer_request' end) ->> 'replayed')), v.expected,
  format('%s on a %s order: %s', v.action, v.state, v.expected))
from (values
  ('online', 'preparing', 'complete', 'not_allowed'),
  ('online', 'preparing', 'cancel', 'not_allowed'),
  ('online', 'preparing', 'start', 'replayed:true'),
  ('takeaway', 'completed', 'start', 'already_completed'),
  ('takeaway', 'completed', 'done', 'already_completed'),
  ('takeaway', 'completed', 'cancel', 'already_completed'),
  ('takeaway', 'completed', 'complete', 'replayed:true'),
  ('cancel_me', 'cancelled', 'start', 'already_cancelled'),
  ('cancel_me', 'cancelled', 'done', 'already_cancelled'),
  ('cancel_me', 'cancelled', 'complete', 'already_cancelled'),
  ('cancel_me', 'cancelled', 'cancel', 'replayed:true')
) as v (name, state, action, expected);
select is((pg_temp.act((select staff_u from fx), pg_temp.o('online'), 'done') -> 'order' ->> 'status'), 'ready', 'the online takeaway order is done');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('online'), 'start') ->> 'refusal'), 'not_allowed', 'start on a ready order: not_allowed');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('online'), 'cancel', 'customer_request') ->> 'refusal'), 'not_allowed', 'cancel on a ready order: not_allowed (cancelled only from awaiting payment or accepted)');
select is((pg_temp.call((select cust1_u from fx), format($$select app.customer_cancel_order(%L, %L)$$, pg_temp.o('online'), (select noon from fx))) ->> 'refusal'), 'not_allowed', 'the customer cannot cancel a ready order');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('online'), 'launch') ->> 'error'), '22023', 'an unknown action is 22023');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('online'), 'complete', null, null, 0) ->> 'error'), '22023', 'a version below 1 is 22023');

-- 5. Two devices, one version: a conflict, never an undo ---------------------------------------------------------
create temp table d as select pg_temp.order_of(pg_temp.keyed('table', jsonb_build_array(pg_temp.line('cf')))) as id;
create temp table seen as select version from public.orders where id = (select id from d);
select is((pg_temp.act((select staff_u from fx), (select id from d), 'start', null, null, (select version from seen)) ->> 'state'), 'ok', 'device one starts the order with the version it saw');
select is((pg_temp.act((select manager_u from fx), (select id from d), 'cancel', 'store_busy', null, (select version from seen)) ->> 'state'), 'conflict', 'device two, acting on the same old version, gets a conflict');
select is((select status::text from public.orders where id = (select id from d)), 'preparing', 'and the order stays as device one left it');
select is((pg_temp.act((select manager_u from fx), (select id from d), 'start', null, null, (select version from seen)) ->> 'replayed'), 'true', 'repeating device one''s action with the old version is a replay, not a conflict');
select is((select count(*)::int from public.order_events where order_id = (select id from d)), 2, 'a replay writes no second event');
select ok((select change_seq from public.orders where id = (select id from d)) > (select min(change_seq) from public.orders where tenant_id = (select tenant_a from fx)), 'every change moves the change cursor');

-- 6. The log is append-only for every role --------------------------------------------------------------------------
select throws_ok(format($$update public.order_events set amount = 0 where order_id = %L$$, pg_temp.o('paid_cancel')), '42501', null, 'an order event cannot be changed, even by the owner of the database');
select throws_ok(format($$delete from public.order_events where order_id = %L$$, pg_temp.o('paid_cancel')), '42501', null, 'nor deleted');
select throws_ok($$truncate public.order_events$$, '42501', null, 'nor truncated');

select * from finish();
rollback;
