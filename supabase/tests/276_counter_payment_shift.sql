-- Cash and card at the counter need the person's open shift at the store (migration counter_payment_needs_shift; Q01-I8,
-- Q02, counter-app.md section 3): the drawer a clock-out counts holds the cash its person recorded during the shift.
-- Techniques: decision table of counter_record_payment (method cash or card x the caller's shift: open at the store,
-- none, open at another store, awaiting confirmation, closed, begun after the instant), boundary values of the
-- clock-in instant (the same second, one second before), state transitions of a shift (open -> awaiting -> closed)
-- seen by the payment rule, error guessing (a replay and the order-state refusals come before the shift rule; a direct
-- insert of a staff-recorded row past the function; an online attempt is not a counter payment), and the count:
-- a refused payment writes nothing and the clock-out counts only the cash of the shift.
begin;
select plan(27);

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

create temp table o (name text primary key, id uuid);
grant select on o to authenticated;
create function pg_temp.o(p_name text) returns uuid language sql stable as $$ select id from o where name = p_name $$;
create temp table qr (store text primary key, token text);
grant select on qr to authenticated;
create function pg_temp.at(p_text text) returns timestamptz language sql immutable as $$ select (p_text || '+07')::timestamptz $$;
create function pg_temp.qr(p_store text) returns text language sql stable as $$ select token from qr where store = p_store $$;
create function pg_temp.clock_in(p_user uuid, p_store uuid, p_token text, p_opening numeric, p_at timestamptz) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.staff_clock_in(%L, %L, %s, %L)$q$, p_store, p_token, p_opening, p_at));
$$;
create function pg_temp.clock_out(p_user uuid, p_counted numeric, p_at timestamptz) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.staff_clock_out(%s, %L)$q$, p_counted, p_at));
$$;
create function pg_temp.shift_of(p_user uuid) returns uuid language sql stable as $$
  select s.id from public.staff_shifts s where s.user_id = p_user and s.status <> 'closed';
$$;
create function pg_temp.mgr(p_user uuid, p_sql text) returns jsonb language sql as $$ select pg_temp.call(p_user, p_sql) $$;
create function pg_temp.recon(p_user uuid, p_store uuid, p_date date) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.manager_day_reconciliation(%L, %L)$q$, p_store, p_date));
$$;
create function pg_temp.days(p_user uuid, p_store uuid, p_month date) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.manager_worked_days(%L, %L)$q$, p_store, p_month));
$$;
create function pg_temp.finish(p_order uuid) returns text language plpgsql as $$
begin
  perform pg_temp.act((select staff_u from fx), p_order, 'start');
  perform pg_temp.act((select staff_u from fx), p_order, 'done');
  perform pg_temp.act((select staff_u from fx), p_order, 'complete');
  return (select status::text || '/' || payment_status::text from public.orders where id = p_order);
end;
$$;
create function pg_temp.rows_as(p_user uuid, p_sql text) returns text language plpgsql as $$
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


create function pg_temp.rec(p_user uuid, p_order uuid, p_method text, p_at timestamptz, p_amount numeric default null, p_version integer default null) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.counter_record_payment(%L, %L, %s, %s, %L)$q$, p_order, p_method,
    coalesce(p_amount, (select o.total from public.orders o where o.id = p_order)), coalesce(p_version, (select o.version from public.orders o where o.id = p_order)), p_at));
$$;
create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $$
declare
  v_hint text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return sqlstate || ':' || coalesce(v_hint, '');
end;
$$;
create function pg_temp.raw_payment(p_order uuid, p_method text, p_user uuid, p_provider text default null) returns text language sql as $$
  select format($q$insert into public.order_payments (tenant_id, store_id, order_id, method, amount, status, provider, recorded_by, requested_at, settled_at)
    select o.tenant_id, o.store_id, o.id, %L, o.total, %L, %L, %L, %L, %L from public.orders o where o.id = %L$q$,
    p_method, case when p_provider is null then 'succeeded' else 'pending' end, p_provider, p_user, pg_temp.at('2026-11-25 12:30'),
    case when p_provider is null then pg_temp.at('2026-11-25 12:30') end, p_order);
$$;

insert into qr select 'a1', pg_temp.mgr((select manager_u from fx), format($q$select app.manager_counter_qr(%L)$q$, (select store_a1 from fx))) ->> 'token';
insert into qr select 'a2', pg_temp.mgr((select manager_u from fx), format($q$select app.manager_counter_qr(%L)$q$, (select store_a2 from fx))) ->> 'token';
insert into o select 'k' || n, pg_temp.order_of(pg_temp.keyed('table', jsonb_build_array(pg_temp.line('cf')), pg_temp.at('2026-11-25 08:30'))) from generate_series(1, 8) as n;
insert into o select 'a2', (pg_temp.call((select manager_u from fx), format($q$select app.counter_create_order(%L, %L::jsonb, %L)$q$, (select store_a2 from fx),
  jsonb_build_object('request_id', gen_random_uuid(), 'type', 'table', 'table_id', pg_temp.id('table_a2'), 'lines', jsonb_build_array(pg_temp.line('cf'))), pg_temp.at('2026-11-25 08:30'))) -> 'order' ->> 'id')::uuid;
select is((select count(*)::int from o where id is null), 0, 'nine counter orders of 29,000 (eight at A1, one at A2)');

-- 1. No shift: refused with a code, nothing written --------------------------------------------------------------
select is((pg_temp.rec((select staff_u from fx), pg_temp.o('k1'), 'cash', pg_temp.at('2026-11-25 08:40')) ->> 'refusal'), 'shift_required', 'cash by staff who did not clock in is shift_required');
select is((pg_temp.rec((select staff_u from fx), pg_temp.o('k1'), 'card', pg_temp.at('2026-11-25 08:40')) ->> 'refusal'), 'shift_required', 'so is card');
select is(
  (select count(*)::int || '/' || (select version || '/' || payment_status::text from public.orders where id = pg_temp.o('k1')) from public.order_payments where order_id = pg_temp.o('k1')),
  '0/1/unpaid', 'a refused payment writes nothing: no payment row, the order''s version and payment status unchanged'
);
select is((pg_temp.rec((select owner_u from fx), pg_temp.o('k1'), 'cash', pg_temp.at('2026-11-25 08:40')) ->> 'refusal'), 'shift_required', 'the owner is not exempt');
select is((pg_temp.rec((select staff_u from fx), pg_temp.o('k1'), 'cash', pg_temp.at('2026-11-25 08:40'), 30000) ->> 'refusal'), 'amount_differs', 'the order''s own refusals come first: another amount');
select is((pg_temp.rec((select staff_u from fx), pg_temp.o('k1'), 'cash', pg_temp.at('2026-11-25 08:40'), null, 7) ->> 'state'), 'conflict', 'and a moved version');
select is((pg_temp.rec((select staff_a2_u from fx), pg_temp.o('k1'), 'cash', pg_temp.at('2026-11-25 08:40')) ->> 'error'), '42501', 'staff of another store are refused before any of it');

-- 2. On shift: the clock-in instant is the boundary ----------------------------------------------------------------
select is((pg_temp.clock_in((select staff_u from fx), (select store_a1 from fx), pg_temp.qr('a1'), 100000, pg_temp.at('2026-11-25 09:00')) ->> 'state'), 'clocked_in', 'staff clock in at A1 at 09:00 with 100,000');
select is((pg_temp.rec((select staff_u from fx), pg_temp.o('k2'), 'cash', pg_temp.at('2026-11-25 08:59:59')) ->> 'refusal'), 'shift_required', 'boundary: a payment one second before the clock-in is refused');
select is((pg_temp.rec((select staff_u from fx), pg_temp.o('k2'), 'cash', pg_temp.at('2026-11-25 09:00')) ->> 'state'), 'paid', 'boundary: at the clock-in instant it is taken');
select is((pg_temp.rec((select staff_u from fx), pg_temp.o('k1'), 'cash', pg_temp.at('2026-11-25 10:00')) ->> 'state'), 'paid', 'cash during the shift');
select is((pg_temp.rec((select staff_u from fx), pg_temp.o('k3'), 'card', pg_temp.at('2026-11-25 10:05')) ->> 'state'), 'paid', 'card during the shift');
select is((select recorded_by = (select staff_u from fx) from public.order_payments where order_id = pg_temp.o('k1')), true, 'the payment names who took it');

-- 3. A shift at another store does not count ---------------------------------------------------------------------
select is((pg_temp.clock_in((select manager_u from fx), (select store_a2 from fx), pg_temp.qr('a2'), 0, pg_temp.at('2026-11-25 09:00')) ->> 'state'), 'clocked_in', 'a manager of every store clocks in at A2');
select is((pg_temp.rec((select manager_u from fx), pg_temp.o('k4'), 'cash', pg_temp.at('2026-11-25 10:10')) ->> 'refusal'), 'shift_required', 'and cannot take cash at A1');
select is((pg_temp.rec((select manager_u from fx), pg_temp.o('a2'), 'cash', pg_temp.at('2026-11-25 10:10')) ->> 'state'), 'paid', 'but takes it at A2');

-- 4. After the clock-out: awaiting confirmation, then closed ------------------------------------------------------
select is(
  (select (r ->> 'state') || '/' || (r -> 'shift' ->> 'expected_cash') from pg_temp.clock_out((select staff_u from fx), 150000, pg_temp.at('2026-11-25 11:00')) r),
  'awaiting_confirmation/158000', 'the clock-out counts the opening cash and the two cash payments (158,000), not the card or the refused ones'
);
select is((pg_temp.rec((select staff_u from fx), pg_temp.o('k5'), 'cash', pg_temp.at('2026-11-25 11:30')) ->> 'refusal'), 'shift_required', 'a shift awaiting a manager takes no more cash');
select is((pg_temp.rec((select staff_u from fx), pg_temp.o('k1'), 'cash', pg_temp.at('2026-11-25 11:30')) ->> 'replayed'), 'true', 'recording a paid order again is still a replay');
select is((pg_temp.mgr((select owner_u from fx), format($q$select app.manager_confirm_shift(%L, 'thiếu 8.000', %L)$q$, pg_temp.shift_of((select staff_u from fx)), pg_temp.at('2026-11-25 11:40'))) ->> 'state'), 'closed', 'the owner confirms the difference');
select is((pg_temp.rec((select staff_u from fx), pg_temp.o('k5'), 'card', pg_temp.at('2026-11-25 12:00')) ->> 'refusal'), 'shift_required', 'a closed shift takes no card either');

-- 5. The trigger holds past the function ----------------------------------------------------------------------------
select is(pg_temp.hint_of(pg_temp.raw_payment(pg_temp.o('k6'), 'cash', (select staff_u from fx))), '42501:shift_required', 'a staff-recorded cash row without an open shift is refused by the table itself');
select is(pg_temp.hint_of(pg_temp.raw_payment(pg_temp.o('k6'), 'card', (select owner_u from fx))), '42501:shift_required', 'so is a card row');
select is(pg_temp.hint_of(pg_temp.raw_payment(pg_temp.o('k7'), 'cash', null)), 'ok', 'a row without a recorder (a fixture or a migration) is not checked');
select is(pg_temp.hint_of(pg_temp.raw_payment(pg_temp.o('k8'), 'vietqr', (select staff_u from fx), 'mock')), 'ok', 'an online attempt is not a counter payment');
select ok(
  not has_function_privilege('authenticated', 'app.counter_shift_open(uuid, uuid, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'app.counter_shift_open(uuid, uuid, timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'app.counter_shift_open(uuid, uuid, timestamptz)', 'execute')
  and exists (select 1 from pg_trigger t where t.tgrelid = 'public.order_payments'::regclass and t.tgname = 'order_payments_need_shift' and not t.tgisinternal),
  'the shift rule is internal and the trigger is on the table'
);

select * from finish();
rollback;
