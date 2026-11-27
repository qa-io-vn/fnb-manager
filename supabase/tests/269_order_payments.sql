-- The native till, step 4 (ADR-061, ADR-062, native-till.md section 6): payment and refund records. "Đã thu" in cash or
-- card for the full total, its replay, refusals and authority; undoing a payment by its recorder within 10 minutes and
-- by a manager later; the refund of a cancelled paid order (acceptance criterion 4: refunded exactly, logged with who
-- cancelled and who refunded); a manager's partial refunds of a completed order; the server-only online seams (an
-- attempt per idempotency key, one at a time, at most three failed, a provider's transaction answered once, the
-- re-query listing) and an online refund failed by the provider and settled by a manager.
-- Techniques: state transitions of a payment (recorded -> voided; pending -> failed | succeeded) and of the payment
-- status (unpaid -> paid -> refund_pending -> refunded; paid -> partially_refunded -> refunded), boundary values (undo at
-- 9:59 and 10:00, the refundable amount and one dong over, the re-query at 19:59 and 20:00, the 3rd and 4th attempt),
-- authorisation by role (staff, staff of another store, manager, viewer, customer, service role).
begin;
select plan(81);

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

create temp table o as
select 'cash' as name, pg_temp.order_of(pg_temp.keyed('table', jsonb_build_array(pg_temp.line('cf')))) as id union all
select 'card', pg_temp.order_of(pg_temp.keyed('table', jsonb_build_array(pg_temp.line('bm')))) union all
select 'void', pg_temp.order_of(pg_temp.keyed('table', jsonb_build_array(pg_temp.line('cf')))) union all
select 'void_late', pg_temp.order_of(pg_temp.keyed('table', jsonb_build_array(pg_temp.line('cf')))) union all
select 'cancel_paid', pg_temp.order_of(pg_temp.keyed('table', jsonb_build_array(pg_temp.line('cf', 2)))) union all
select 'completed', pg_temp.order_of(pg_temp.keyed('table', jsonb_build_array(pg_temp.line('cf', 3)))) union all
select 'online', pg_temp.order_of(pg_temp.place((select cust1_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('ta')), 40000, jsonb_build_object('type', 'takeaway', 'table_token', null, 'payment', 'vietqr')))) union all
select 'online_cash', pg_temp.order_of(pg_temp.place((select cust2_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('ta')), 40000, jsonb_build_object('type', 'takeaway', 'table_token', null, 'payment', 'vietqr')))) union all
select 'online_fail', pg_temp.order_of(pg_temp.place((select cust3_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('ta')), 40000, jsonb_build_object('type', 'takeaway', 'table_token', null, 'payment', 'vietqr'))));
grant select on o to authenticated;
create function pg_temp.o(p_name text) returns uuid language sql stable as $$ select id from o where name = p_name $$;
create function pg_temp.st(p_name text) returns text language sql stable as $$ select status::text || '/' || payment_status::text from public.orders where id = pg_temp.o(p_name) $$;
create function pg_temp.counter(p_user uuid, p_sql text) returns jsonb language sql as $$ select pg_temp.call(p_user, p_sql) $$;
create function pg_temp.record(p_user uuid, p_order uuid, p_method text, p_amount numeric, p_at timestamptz default null, p_version integer default null) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.counter_record_payment(%L, %L, %s, %s, %L)$q$, p_order, p_method, p_amount,
    coalesce(p_version, (select o.version from public.orders o where o.id = p_order)), coalesce(p_at, (select noon from fx) + interval '1 minute')));
$$;
create function pg_temp.refund(p_user uuid, p_order uuid, p_amount numeric, p_reason text, p_at timestamptz default null) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.counter_refund(%L, %s, %L, %L)$q$, p_order, p_amount, p_reason, coalesce(p_at, (select noon from fx) + interval '30 minutes')));
$$;
select is((select count(*)::int from o where id is null), 0, 'every order of the fixture was created');

-- 1. Privileges -----------------------------------------------------------------------------------------------------
select ok(
  not has_table_privilege('authenticated', 'public.order_payments', 'insert') and not has_table_privilege('authenticated', 'public.order_payments', 'update')
  and not has_table_privilege('authenticated', 'public.order_refunds', 'insert') and not has_table_privilege('authenticated', 'public.order_refunds', 'delete'),
  'no client writes a payment or a refund directly'
);
select ok(
  has_function_privilege('service_role', 'public.checkout_payment_confirm(text, text, uuid, numeric, boolean, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.checkout_payment_confirm(text, text, uuid, numeric, boolean, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.checkout_payment_start(uuid, uuid, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.checkout_refund_confirm(uuid, boolean, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.checkout_payments_pending(integer, integer)', 'execute'),
  'only the server confirms an online payment or refund (ADR-062): no client executes the checkout seams'
);

-- 2. "Đã thu" at the counter ----------------------------------------------------------------------------------------
select is((pg_temp.record((select staff_u from fx), pg_temp.o('cash'), 'cash', 29000) ->> 'state'), 'paid', 'staff record a cash payment of the full total');
select is(pg_temp.st('cash'), 'accepted/paid', 'the order is paid');
select is((select method || '/' || amount::bigint || '/' || status || '/' || (recorded_by = (select staff_u from fx)) from public.order_payments where order_id = pg_temp.o('cash')), 'cash/29000/succeeded/true', 'the payment records the method, amount and who took it');
select is((select action || ':' || reason_code || ':' || amount::bigint from public.order_events where order_id = pg_temp.o('cash') and kind = 'payment'), 'paid:cash:29000', 'the log holds the payment with its method and amount');
select is((pg_temp.record((select staff_u from fx), pg_temp.o('cash'), 'cash', 29000) ->> 'replayed'), 'true', 'recording it again is a replay');
select is((pg_temp.record((select staff_u from fx), pg_temp.o('cash'), 'card', 29000) ->> 'refusal'), 'already_paid', 'another payment of a paid order is refused');
select is((select count(*)::int from public.order_payments where order_id = pg_temp.o('cash')), 1, 'one payment row');
select is((pg_temp.record((select staff_u from fx), pg_temp.o('card'), 'card', 29999) ->> 'refusal'), 'amount_differs', 'a part of the total is refused');
select is((pg_temp.record((select staff_u from fx), pg_temp.o('card'), 'card', 30000, null, 9) ->> 'state'), 'conflict', 'a payment on a version the order no longer has is a conflict');
select is((pg_temp.record((select staff_u from fx), pg_temp.o('card'), 'voucher', 30000) ->> 'error'), '22023', 'a method other than cash or card is 22023');
select is((pg_temp.record((select staff_u from fx), pg_temp.o('card'), 'card', 30000.5) ->> 'error'), '22023', 'a fraction of a dong is 22023');
select is((pg_temp.record((select staff_a2_u from fx), pg_temp.o('card'), 'card', 30000) ->> 'error'), '42501', 'staff of another store record nothing');
select is((pg_temp.record((select viewer_u from fx), pg_temp.o('card'), 'card', 30000) ->> 'error'), '42501', 'a viewer records nothing');
select is((pg_temp.record((select cust1_u from fx), pg_temp.o('card'), 'card', 30000) ->> 'error'), '42501', 'a customer records nothing');
select is((pg_temp.record((select staff_u from fx), pg_temp.o('card'), 'card', 30000) ->> 'state'), 'paid', 'a card payment of the total is recorded');
select is((pg_temp.record((select staff_u from fx), pg_temp.o('online_cash'), 'cash', 40000) -> 'order' ->> 'status'), 'accepted', 'a customer who chose VietQR may pay cash at the counter: the order is accepted');
select is((select order_no is not null from public.orders where id = pg_temp.o('online_cash')), true, 'and takes its number then');

-- 3. Undoing a payment recorded by mistake ------------------------------------------------------------------------
select is((pg_temp.record((select staff_u from fx), pg_temp.o('void'), 'cash', 29000, (select noon from fx)) ->> 'state'), 'paid', 'a payment recorded by mistake');
select is((pg_temp.record((select staff_u from fx), pg_temp.o('void_late'), 'cash', 29000, (select noon from fx)) ->> 'state'), 'paid', 'another one');
create temp table pays as select p.order_id, p.id from public.order_payments p where p.order_id in (pg_temp.o('void'), pg_temp.o('void_late'));
grant select on pays to authenticated;
create function pg_temp.void(p_user uuid, p_name text, p_at timestamptz, p_reason text default 'bấm nhầm') returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.counter_void_payment(%L, %L, %L)$q$, (select id from pays where order_id = pg_temp.o(p_name)), p_reason, p_at));
$$;
select is((pg_temp.void((select staff_u from fx), 'void', (select noon from fx), null) ->> 'error'), '22023', 'an undo needs a reason');
select is((pg_temp.void((select staff_a2_u from fx), 'void', (select noon from fx)) ->> 'error'), '42501', 'staff of another store cannot undo it');
select is((pg_temp.void((select staff_u from fx), 'void', (select noon from fx) + interval '9 minutes 59 seconds') ->> 'state'), 'voided', 'undo boundary: the recorder undoes it at 9:59');
select is(pg_temp.st('void'), 'accepted/unpaid', 'the order is unpaid again');
select is((select action || ':' || to_state || ':' || amount::bigint || ':' || reason_text from public.order_events where order_id = pg_temp.o('void') and action = 'payment_voided'), 'payment_voided:unpaid:29000:bấm nhầm', 'the undo is logged with who, why and the amount');
select is((pg_temp.void((select staff_u from fx), 'void', (select noon from fx) + interval '11 minutes') ->> 'replayed'), 'true', 'undoing twice is a replay');
select is((pg_temp.void((select staff_u from fx), 'void_late', (select noon from fx) + interval '10 minutes') ->> 'refusal'), 'manager_required', 'undo boundary: at 10:00 the recorder needs a manager');
select is((pg_temp.void((select manager_u from fx), 'void_late', (select noon from fx) + interval '2 hours') ->> 'state'), 'voided', 'a manager undoes it later');

-- 4. Cancelling a paid order: the refund (acceptance criterion 4) --------------------------------------------------
select is((pg_temp.pay(pg_temp.o('cancel_paid')) ->> 'state'), 'paid', 'a table order of 58,000 is paid in cash');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('cancel_paid'), 'cancel', 'customer_request', (select noon from fx) + interval '5 minutes') -> 'order' ->> 'payment_status'), 'refund_pending', 'staff cancel it: its refund becomes due');
select is((select status || ':' || amount::bigint || ':' || method from public.order_refunds where order_id = pg_temp.o('cancel_paid')), 'due:58000:cash', 'the due refund is exactly what was paid, by the way it was paid');
select is((pg_temp.refund((select staff_u from fx), pg_temp.o('cancel_paid'), 50000, 'trả lại khách') ->> 'refusal'), 'manager_required', 'staff cannot refund another amount than the one due');
select is((pg_temp.refund((select staff_u from fx), pg_temp.o('cancel_paid'), 58000, 'trả lại khách') ->> 'state'), 'succeeded', 'staff hand back the cash due');
select is(pg_temp.st('cancel_paid'), 'cancelled/refunded', 'the order is cancelled and refunded');
select is((select m.paid::bigint || '/' || m.refunded::bigint || '/' || m.refund_open::bigint from app.order_money(pg_temp.o('cancel_paid')) m), '58000/58000/0', 'the money balances: refunded exactly what was paid');
select is(
  (select string_agg(action || ':' || coalesce(amount::bigint::text, '-') || ':' || (actor_user_id = (select staff_u from fx))::text, ',' order by id) from public.order_events where order_id = pg_temp.o('cancel_paid') and action in ('cancel', 'refund_due', 'refunded')),
  'cancel:58000:true,refund_due:58000:true,refunded:58000:true', 'the log names who cancelled and who refunded, with the amounts'
);
select is((pg_temp.refund((select staff_u from fx), pg_temp.o('cancel_paid'), 1, 'thêm') ->> 'refusal'), 'not_refundable', 'nothing more can be refunded');
select is((pg_temp.refund((select staff_u from fx), pg_temp.o('card'), 30000, 'thử') ->> 'refusal'), 'manager_required', 'staff cannot refund an order that is not cancelled');
select is((pg_temp.refund((select staff_u from fx), pg_temp.o('void'), 29000, 'thử') ->> 'refusal'), 'not_refundable', 'an unpaid order is not refundable');
select is((pg_temp.refund((select manager_u from fx), pg_temp.o('card'), 29000, null) ->> 'error'), '22023', 'a refund needs a reason');

-- 5. A manager refunds a completed order in parts ------------------------------------------------------------------
select is((pg_temp.pay(pg_temp.o('completed')) ->> 'state'), 'paid', 'a table order of 87,000 is paid');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('completed'), 'start') ->> 'state'), 'ok', 'started');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('completed'), 'done') ->> 'state'), 'ok', 'served');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('completed'), 'complete') ->> 'state'), 'ok', 'completed');
select is((pg_temp.refund((select manager_u from fx), pg_temp.o('completed'), 29000, 'một ly bị đổ') ->> 'state'), 'succeeded', 'a manager refunds one drink of a completed order');
select is(pg_temp.st('completed'), 'completed/partially_refunded', 'the order stays completed, partially refunded');
select is((pg_temp.refund((select manager_u from fx), pg_temp.o('completed'), 58001, 'tất cả') ->> 'refusal'), 'amount_over_refundable', 'refund boundary: one dong over what remains is refused');
select is((pg_temp.refund((select manager_u from fx), pg_temp.o('completed'), 58000, 'tất cả') ->> 'state'), 'succeeded', 'refund boundary: what remains is refunded');
select is(pg_temp.st('completed'), 'completed/refunded', 'fully refunded');
select is((pg_temp.void((select manager_u from fx), 'void_late', (select noon from fx)) ->> 'replayed'), 'true', 'a voided payment stays voided');

-- 6. Online payments through the server-only seams ------------------------------------------------------------------
select is((app.checkout_payment_start((select cust2_u from fx), pg_temp.o('online'), 'vietqr', 'key-269-0', (select noon from fx)) ->> 'refusal'), 'unknown_order', 'another customer cannot start a payment of the order');
select throws_ok(format($$select app.checkout_payment_start(%L, %L, 'vietqr', 'short')$$, (select cust1_u from fx), pg_temp.o('online')), '22023', null, 'an idempotency key of 5 characters is 22023');
select is((app.checkout_payment_start((select cust1_u from fx), pg_temp.o('online'), 'zalo_checkout', 'key-269-1', (select noon from fx)) ->> 'refusal'), 'method_differs', 'a method other than the one chosen is refused');
create temp table a1 as select pg_temp.start_online(pg_temp.o('online'), 'key-269-1', (select noon from fx)) as a;
select is((select a ->> 'state' from a1), 'pending', 'an attempt is opened');
select is((select (a ->> 'amount')::int from a1), 40000, 'for the order''s total');
select is((pg_temp.start_online(pg_temp.o('online'), 'key-269-1', (select noon from fx)) ->> 'replayed'), 'true', 'the same idempotency key answers the same attempt');
select is((pg_temp.start_online(pg_temp.o('online'), 'key-269-2', (select noon from fx)) ->> 'refusal'), 'attempt_pending', 'one attempt at a time');
select is((select count(*)::int from app.checkout_payments_pending(interval '20 minutes', 50, (select noon from fx) + interval '19 minutes 59 seconds') where order_id = pg_temp.o('online')), 0, 're-query boundary: at 19:59 the attempt is not yet asked about');
select is((select count(*)::int from app.checkout_payments_pending(interval '20 minutes', 50, (select noon from fx) + interval '20 minutes') where order_id = pg_temp.o('online')), 1, 're-query boundary: at 20:00 it is');
select is((app.checkout_payment_confirm('zalo_checkout', 'ref-269-x', ((select a from a1) ->> 'payment_id')::uuid, 40000, true, null, (select noon from fx)) ->> 'refusal'), 'unknown_payment', 'another provider cannot confirm the attempt');
select is((pg_temp.confirm_online(((select a from a1) ->> 'payment_id')::uuid, 40000, false, 'ref-269-1') ->> 'state'), 'failed', 'a failed payment fails the attempt');
select is(pg_temp.st('online'), 'awaiting_payment/unpaid', 'the order still waits');
select is((pg_temp.confirm_online(((select a from a1) ->> 'payment_id')::uuid, 40000, true, 'ref-269-2') ->> 'refusal'), 'not_pending', 'a settled attempt cannot be confirmed again under another transaction');
select is((pg_temp.pay_online(pg_temp.o('online'), 40000, true, 'ref-269-3') ->> 'state'), 'succeeded', 'a second attempt succeeds');
select is(pg_temp.st('online'), 'accepted/paid', 'the order is paid and accepted');
select is((app.checkout_payment_confirm('vietqr', 'ref-269-3', gen_random_uuid(), 1, false, null, now()) ->> 'replayed'), 'true', 'a repeated notification of a transaction answers its first outcome, whatever it says');
select is((pg_temp.pay_online(pg_temp.o('online_fail'), 40000, false, 'ref-269-f1') ->> 'state') || (pg_temp.pay_online(pg_temp.o('online_fail'), 40000, false, 'ref-269-f2') ->> 'state') || (pg_temp.pay_online(pg_temp.o('online_fail'), 40000, false, 'ref-269-f3') ->> 'state'), 'failedfailedfailed', 'three failed attempts');
select is((pg_temp.start_online(pg_temp.o('online_fail'), 'key-269-f4') ->> 'refusal'), 'too_many_attempts', 'a fourth is refused');

-- 7. An online refund settled by the provider ------------------------------------------------------------------------
select is((pg_temp.act((select manager_u from fx), pg_temp.o('online'), 'cancel', 'store_busy') -> 'order' ->> 'payment_status'), 'refund_pending', 'cancelling the paid online order makes its refund due');
select is((pg_temp.refund((select staff_u from fx), pg_temp.o('online'), 40000, 'quán đông') ->> 'state'), 'pending', 'staff send the due refund back through the provider: pending');
create temp table rf as select id from public.order_refunds where order_id = pg_temp.o('online');
select is((app.checkout_refund_confirm((select id from rf), false, null, 'timeout', (select noon from fx) + interval '40 minutes') ->> 'state'), 'failed', 'the provider fails the refund');
select is(pg_temp.st('online'), 'cancelled/refund_pending', 'the money is still owed: the order stays refund_pending');
select is((pg_temp.refund((select staff_u from fx), pg_temp.o('online'), 40000, 'trả tiền mặt') ->> 'refusal'), 'manager_required', 'a failed online refund needs a manager');
select is((pg_temp.refund((select manager_u from fx), pg_temp.o('online'), 40000, 'trả tiền mặt') ->> 'method'), 'cash', 'a manager hands it back in cash');
select is(pg_temp.st('online'), 'cancelled/refunded', 'and the order is refunded');
select is((app.checkout_refund_confirm((select id from rf), true, 'rf-1', null, (select noon from fx) + interval '50 minutes') ->> 'replayed'), 'true', 'a late provider answer on a settled refund is a replay');

-- 8. What the answers show ----------------------------------------------------------------------------------------
select is((pg_temp.call((select staff_u from fx), format($$select app.counter_order(%L, %L)$$, pg_temp.o('cancel_paid'), (select noon from fx))) -> 'money' -> 'refunds' -> 0 ->> 'recorded_by'), (select staff_u from fx)::text, 'the counter sees who recorded a refund');
select is((pg_temp.call((select cust1_u from fx), format($$select app.customer_order(%L, %L)$$, pg_temp.o('online'), (select noon from fx))) -> 'order' -> 'money' ->> 'refunded'), '40000', 'the customer sees the amount refunded');
select is((pg_temp.call((select cust1_u from fx), format($$select app.customer_order(%L, %L)$$, pg_temp.o('online'), (select noon from fx))) -> 'order' -> 'money' -> 'refunds' -> 0 ->> 'recorded_by'), null, 'but not who handled it');

select * from finish();
rollback;
