-- The native till, step 8 (native-till.md section 12): shifts at the counter. The counter QR code (its rotation, a
-- table's token and another store's refused), clocking in (once at a time, who may, the limits on wrong codes), the
-- blind count at clock-out against the cash the person took (payments recorded, cash handed back, a voided payment
-- left out), a difference awaiting a manager (never one's own), a recount, a forgotten shift closed by a manager.
-- Acceptance criterion 6: a store's day where the app's revenue equals the provider-confirmed online payments, the
-- card payments and the counted cash, and a day with a shortage that does not match until explained. Acceptance
-- criterion 7: a month's worked days per person equal to the hours between the recorded clock-ins and clock-outs
-- (a half day, a night across midnight, two shifts in one day, a long day capped at one, a short one, the last night of
-- the month, the next month left out, an open shift not counted), also with another standard of hours.
-- Techniques: state transitions of a shift (open -> closed; open -> awaiting_confirmation -> closed; open -> closed by
-- a manager), boundary values (the 5th and 6th wrong code, a range of 63 and 64 days, the month's first and last
-- business date), decision table of the reconciliation (matched, short, awaiting), authorisation by role and tenant,
-- error guessing (a table token at the counter, a rotated code, confirming one's own shortage).
begin;
select plan(84);

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

-- 1. Privileges -----------------------------------------------------------------------------------------------------
select ok(
  not has_function_privilege('anon', 'public.staff_clock_in(uuid, text, numeric)', 'execute')
  and not has_function_privilege('anon', 'public.manager_worked_days(uuid, date)', 'execute')
  and not has_function_privilege('service_role', 'public.manager_confirm_shift(uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.staff_clock_out(numeric)', 'execute')
  and not has_function_privilege('authenticated', 'app.shift_cash_flow(public.staff_shifts, timestamptz)', 'execute'),
  'the shift functions are for signed-in members; their helpers are internal'
);
select ok(
  not has_table_privilege('authenticated', 'public.staff_shifts', 'insert') and not has_table_privilege('authenticated', 'public.staff_shifts', 'update')
  and not has_table_privilege('anon', 'public.staff_shifts', 'select'),
  'no client writes a shift directly'
);

-- 2. The counter QR code ------------------------------------------------------------------------------------------
select is((pg_temp.mgr((select staff_u from fx), format($q$select app.manager_counter_qr(%L)$q$, (select store_a1 from fx))) ->> 'error'), '42501', 'staff cannot print the counter code');
select is((select (r ->> 'version') || '/' || (r ->> 'token' ~ '^[A-Za-z0-9_-]{22}$') from pg_temp.mgr((select manager_u from fx), format($q$select app.manager_counter_qr(%L)$q$, (select store_a1 from fx))) r), '1/true', 'a manager prints the counter code of A1 (version 1)');
insert into qr select 'a1_v1', pg_temp.mgr((select manager_u from fx), format($q$select app.manager_counter_qr(%L)$q$, (select store_a1 from fx))) ->> 'token';
select is((select (r ->> 'version') || '/' || (r ->> 'rotated') || '/' || ((r ->> 'token') <> pg_temp.qr('a1_v1')) from pg_temp.mgr((select manager_u from fx), format($q$select app.manager_counter_qr(%L, true)$q$, (select store_a1 from fx))) r), '2/true/true', 'rotating it gives version 2 and another code');
insert into qr select 'a1', pg_temp.mgr((select manager_u from fx), format($q$select app.manager_counter_qr(%L)$q$, (select store_a1 from fx))) ->> 'token';
insert into qr select 'a2', pg_temp.mgr((select owner_u from fx), format($q$select app.manager_counter_qr(%L)$q$, (select store_a2 from fx))) ->> 'token';
select is((pg_temp.mgr((select owner_b_u from fx), format($q$select app.manager_counter_qr(%L)$q$, (select store_a1 from fx))) ->> 'error'), '42501', 'an owner of another tenant cannot');

-- 3. Clocking in --------------------------------------------------------------------------------------------------
select is((pg_temp.clock_in((select staff_u from fx), (select store_a1 from fx), pg_temp.qr('a1_v1'), 500000, pg_temp.at('2026-11-25 08:00')) ->> 'refusal'), 'counter_qr_invalid', 'the rotated code no longer clocks anyone in');
select is((pg_temp.clock_in((select staff_u from fx), (select store_a1 from fx), pg_temp.token('Bàn 1'), 500000, pg_temp.at('2026-11-25 08:00')) ->> 'refusal'), 'counter_qr_invalid', 'a table''s code is not the counter''s');
select is((pg_temp.clock_in((select staff_u from fx), (select store_a1 from fx), pg_temp.qr('a2'), 500000, pg_temp.at('2026-11-25 08:00')) ->> 'refusal'), 'counter_qr_invalid', 'nor is another store''s');
select is((pg_temp.clock_in((select staff_u from fx), (select store_a1 from fx), 'bad token!', 500000, pg_temp.at('2026-11-25 08:00')) ->> 'error'), '22023', 'a malformed code is 22023');
select is((pg_temp.clock_in((select staff_u from fx), (select store_a1 from fx), pg_temp.qr('a1'), 500000.5, pg_temp.at('2026-11-25 08:00')) ->> 'error'), '22023', 'the opening cash is whole dong');
select is((pg_temp.clock_in((select staff_a2_u from fx), (select store_a1 from fx), pg_temp.qr('a1'), 0, pg_temp.at('2026-11-25 08:00')) ->> 'error'), '42501', 'staff of another store cannot clock in at A1');
select is((pg_temp.clock_in((select viewer_u from fx), (select store_a1 from fx), pg_temp.qr('a1'), 0, pg_temp.at('2026-11-25 08:00')) ->> 'error'), '42501', 'nor can a viewer');
select is((pg_temp.clock_in((select cust1_u from fx), (select store_a1 from fx), pg_temp.qr('a1'), 0, pg_temp.at('2026-11-25 08:00')) ->> 'error'), '42501', 'nor a customer');
select is(
  (select (r ->> 'state') || '/' || (r -> 'shift' ->> 'business_date') || '/' || (r -> 'shift' ->> 'opening_cash') || '/' || (r -> 'shift' ? 'expected_cash')
   from pg_temp.clock_in((select staff_u from fx), (select store_a1 from fx), pg_temp.qr('a1'), 500000, pg_temp.at('2026-11-25 08:00')) r),
  'clocked_in/2026-11-25/500000/false', 'staff clock in at 08:00 with 500,000 in the drawer'
);
select is((pg_temp.clock_in((select staff_u from fx), (select store_a1 from fx), pg_temp.qr('a1'), 0, pg_temp.at('2026-11-25 09:00')) ->> 'refusal'), 'already_clocked_in', 'once at a time');
select is(
  (select string_agg(pg_temp.clock_in((select staff_a2_u from fx), (select store_a2 from fx), 'wrong-code-' || n, 0, pg_temp.at('2026-11-25 08:00')) ->> 'refusal', ',' order by n) from generate_series(1, 6) as n),
  'counter_qr_invalid,counter_qr_invalid,counter_qr_invalid,counter_qr_invalid,counter_qr_invalid,rate_limited', 'wrong codes boundary: the 5th miss is answered, the 6th is rate_limited'
);
delete from app.code_attempts a where a.tenant_id = (select tenant_a from fx);

-- 4. The day at A1 (acceptance criterion 6, matched) ----------------------------------------------------------------
insert into o select 'cash1', pg_temp.order_of(pg_temp.place((select cust1_u from fx), pg_temp.req(pg_temp.basket(), 69000)));
insert into o select 'cash2', pg_temp.order_of(pg_temp.keyed('table', jsonb_build_array(pg_temp.line('cf', 3))));
insert into o select 'online', pg_temp.order_of(pg_temp.place((select cust2_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('ta')), 40000, jsonb_build_object('type', 'takeaway', 'table_token', null, 'payment', 'vietqr'))));
insert into o select 'card', pg_temp.order_of(pg_temp.keyed('table', jsonb_build_array(pg_temp.line('bm'), pg_temp.line('cf'))));
insert into o select 'cancelled', pg_temp.order_of(pg_temp.keyed('table', jsonb_build_array(pg_temp.line('cf'))));
insert into o select 'voided', pg_temp.order_of(pg_temp.keyed('table', jsonb_build_array(pg_temp.line('cf'))));
select is((select count(*)::int from o where id is null), 0, 'six orders of the day');
select is((pg_temp.pay(pg_temp.o('cash1')) ->> 'state'), 'paid', 'a table order of the app paid in cash (69,000)');
select is((pg_temp.pay(pg_temp.o('cash2')) ->> 'state'), 'paid', 'a counter order paid in cash (87,000)');
select is((pg_temp.pay_online(pg_temp.o('online'), 40000, true, 'syn-273-1') ->> 'state'), 'succeeded', 'a takeaway paid by VietQR (40,000)');
select is(
  (pg_temp.call((select staff_u from fx), format($q$select app.counter_record_payment(%L, 'card', 59000, %s, %L)$q$, pg_temp.o('card'),
    (select version from public.orders where id = pg_temp.o('card')), (select noon from fx) + interval '30 seconds')) ->> 'state'),
  'paid', 'a counter order paid by card (59,000)'
);
select is((pg_temp.pay(pg_temp.o('cancelled')) ->> 'state'), 'paid', 'an order paid in cash (29,000)');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('cancelled'), 'cancel', 'customer_request') -> 'order' ->> 'payment_status'), 'refund_pending', 'cancelled');
select is(
  (pg_temp.call((select staff_u from fx), format($q$select app.counter_refund(%L, 29000, 'khách đổi ý', %L)$q$, pg_temp.o('cancelled'), (select noon from fx) + interval '30 minutes')) ->> 'state'),
  'succeeded', 'and its cash handed back'
);
select is((pg_temp.pay(pg_temp.o('voided')) ->> 'state'), 'paid', 'a cash payment recorded by mistake');
select is(
  (pg_temp.call((select staff_u from fx), format($q$select app.counter_void_payment(%L, 'bấm nhầm', %L)$q$,
    (select id from public.order_payments where order_id = pg_temp.o('voided')), (select noon from fx) + interval '2 minutes')) ->> 'state'),
  'voided', 'and undone'
);
select is(pg_temp.finish(pg_temp.o('cash1')), 'completed/paid', 'completed');
select is(pg_temp.finish(pg_temp.o('cash2')), 'completed/paid', 'completed');
select is(pg_temp.finish(pg_temp.o('online')), 'completed/paid', 'completed');
select is(pg_temp.finish(pg_temp.o('card')), 'completed/paid', 'completed');
select is(
  (select (r -> 'shift' ? 'expected_cash')::text from pg_temp.call((select staff_u from fx), 'select app.staff_my_shift()') r),
  'false', 'the open shift never shows the expected cash: the count is blind'
);
select is(
  (select (r ->> 'state') || '/' || (r -> 'shift' ->> 'expected_cash') || '/' || (r -> 'shift' ->> 'counted_cash') || '/' || (r -> 'shift' ->> 'cash_difference') || '/' || (r -> 'shift' ->> 'hours')
   from pg_temp.clock_out((select staff_u from fx), 656000, pg_temp.at('2026-11-25 16:00')) r),
  'closed/656000/656000/0/8.00', 'clocking out at 16:00 with 656,000 counted: 500,000 + 69,000 + 87,000 + 29,000 - 29,000 (the voided payment left out), the shift closes'
);
select is((pg_temp.clock_out((select staff_u from fx), 656000, pg_temp.at('2026-11-25 16:05')) ->> 'refusal'), 'not_clocked_in', 'once closed there is nothing to clock out');
select is(
  (select (r ->> 'revenue') || '/' || (r ->> 'online_confirmed') || '/' || (r ->> 'card') || '/' || (r -> 'cash' ->> 'counted') || '/' || (r -> 'cash' ->> 'expected') || '/' || (r -> 'cash' ->> 'invoiced') || '/' || (r ->> 'difference') || '/' || (r ->> 'matched')
   from pg_temp.recon((select manager_u from fx), (select store_a1 from fx), date '2026-11-25') r),
  '255000/40000/59000/156000/156000/156000/0/true',
  'criterion 6: the day''s revenue on the app (255,000) equals the provider-confirmed online payments, the card payments and the cash counted at the end of the shift'
);
select is(
  (select (r ->> 'revenue')::bigint from pg_temp.recon((select manager_u from fx), (select store_a1 from fx), date '2026-11-25') r),
  (select f.net_amount::bigint from app.daily_sales_facts((select tenant_a from fx), date '2026-11-25', date '2026-11-25', array[(select store_a1 from fx)]) f),
  'criterion 6: the revenue reconciled is the revenue the reports show for the day'
);
select is((pg_temp.recon((select staff_u from fx), (select store_a1 from fx), date '2026-11-25') ->> 'error'), '42501', 'staff do not see the reconciliation');

-- 5. The next day at A1: a shortage (acceptance criterion 6, not matched) -------------------------------------------
select is((pg_temp.clock_in((select staff_u from fx), (select store_a1 from fx), pg_temp.qr('a1'), 300000, pg_temp.at('2026-11-26 08:00')) ->> 'state'), 'clocked_in', 'the next morning with 300,000');
insert into o select 'day2', pg_temp.order_of(pg_temp.keyed('table', jsonb_build_array(pg_temp.line('cf', 2)), pg_temp.at('2026-11-26 10:00')));
select is((pg_temp.pay(pg_temp.o('day2'), pg_temp.at('2026-11-26 10:01')) ->> 'state'), 'paid', 'two coffees (58,000) paid in cash');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('day2'), 'start', null, pg_temp.at('2026-11-26 10:02')) ->> 'state'), 'ok', 'started');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('day2'), 'done', null, pg_temp.at('2026-11-26 10:03')) ->> 'state'), 'ok', 'served');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('day2'), 'complete', null, pg_temp.at('2026-11-26 10:04')) ->> 'state'), 'ok', 'completed');
select is(
  (select (r ->> 'state') || '/' || (r -> 'shift' ->> 'expected_cash') || '/' || (r -> 'shift' ->> 'cash_difference') from pg_temp.clock_out((select staff_u from fx), 352000, pg_temp.at('2026-11-26 16:00')) r),
  'awaiting_confirmation/358000/-6000', 'clocking out with 352,000 against 358,000: the shift waits for a manager'
);
select is((pg_temp.clock_in((select staff_u from fx), (select store_a1 from fx), pg_temp.qr('a1'), 0, pg_temp.at('2026-11-26 17:00')) ->> 'refusal'), 'already_clocked_in', 'a shift with a difference is not closed: no new shift before a manager confirms');
select is(
  (select (r ->> 'revenue') || '/' || (r -> 'cash' ->> 'counted') || '/' || (r -> 'cash' ->> 'difference') || '/' || (r ->> 'shifts_awaiting_confirmation') || '/' || (r ->> 'difference') || '/' || (r ->> 'matched')
   from pg_temp.recon((select owner_u from fx), (select store_a1 from fx), date '2026-11-26') r),
  '58000/52000/-6000/1/6000/false', 'criterion 6: the day does not match: 6,000 short and a shift awaiting confirmation'
);
select is((pg_temp.mgr((select staff_u from fx), format($q$select app.manager_confirm_shift(%L, 'thiếu')$q$, pg_temp.shift_of((select staff_u from fx)))) ->> 'error'), '42501', 'staff cannot confirm a difference');
select is((pg_temp.mgr((select manager_u from fx), format($q$select app.manager_confirm_shift(%L, null)$q$, pg_temp.shift_of((select staff_u from fx)))) ->> 'error'), '22023', 'confirming needs a note');
create temp table day2_shift as select pg_temp.shift_of((select staff_u from fx)) as id;
grant select on day2_shift to authenticated;
select is((pg_temp.mgr((select manager_u from fx), format($q$select app.manager_confirm_shift(%L, 'Thối nhầm cho khách 6.000')$q$, (select id from day2_shift))) ->> 'state'), 'closed', 'a manager confirms the shortage with a note');
select is(
  (select s.status || '/' || (s.closed_by = (select manager_u from fx)) || '/' || s.close_note || '/' || s.cash_difference::bigint from public.staff_shifts s where s.id = (select id from day2_shift)),
  'closed/true/Thối nhầm cho khách 6.000/-6000', 'the shift is closed with who confirmed it, the note and the difference'
);
select is((pg_temp.mgr((select manager_u from fx), format($q$select app.manager_confirm_shift(%L, 'lần nữa')$q$, (select id from day2_shift))) ->> 'replayed'), 'true', 'confirming again is a replay');
select is(
  (select (r ->> 'shifts_awaiting_confirmation') || '/' || (r ->> 'difference') || '/' || (r ->> 'matched') from pg_temp.recon((select owner_u from fx), (select store_a1 from fx), date '2026-11-26') r),
  '0/6000/false', 'criterion 6: once confirmed the day still shows the 6,000 the manager explained'
);

-- 6. Shifts at A2: one's own difference, a recount, a forgotten clock-out --------------------------------------------
select is((pg_temp.clock_in((select manager_u from fx), (select store_a2 from fx), pg_temp.qr('a2'), 0, pg_temp.at('2026-11-25 09:00')) ->> 'state'), 'clocked_in', 'a manager clocks in at A2');
select is((pg_temp.clock_out((select manager_u from fx), 1000, pg_temp.at('2026-11-25 13:00')) ->> 'state'), 'awaiting_confirmation', 'and counts 1,000 too much');
select is((pg_temp.mgr((select manager_u from fx), format($q$select app.manager_confirm_shift(%L, 'tự xác nhận')$q$, pg_temp.shift_of((select manager_u from fx)))) ->> 'refusal'), 'own_shift', 'nobody confirms their own difference');
select is(
  (select (r ->> 'state') || '/' || (r -> 'shift' ->> 'clock_out_at')::timestamptz::text from pg_temp.clock_out((select manager_u from fx), 0, pg_temp.at('2026-11-25 13:20')) r),
  'closed/' || pg_temp.at('2026-11-25 13:00')::text, 'counting again with the right amount closes it, keeping the first clock-out time'
);
select is((pg_temp.clock_in((select owner_u from fx), (select store_a2 from fx), pg_temp.qr('a2'), 0, pg_temp.at('2026-11-25 09:00')) ->> 'state'), 'clocked_in', 'the owner clocks in at A2 and forgets to clock out');
create temp table forgot as select pg_temp.shift_of((select owner_u from fx)) as id;
grant select on forgot to authenticated;
select is((pg_temp.mgr((select manager_u from fx), format($q$select app.manager_close_shift(%L, %L, 0, 'quên ra ca', %L)$q$, (select id from forgot), pg_temp.at('2026-11-25 08:59'), pg_temp.at('2026-11-26 09:00'))) ->> 'refusal'), 'clock_out_invalid', 'a clock-out before the clock-in is refused');
select is((pg_temp.mgr((select manager_u from fx), format($q$select app.manager_close_shift(%L, %L, 0, 'quên ra ca', %L)$q$, (select id from forgot), pg_temp.at('2026-11-26 10:00'), pg_temp.at('2026-11-26 09:00'))) ->> 'refusal'), 'clock_out_invalid', 'so is one in the future');
select is((pg_temp.mgr((select manager_u from fx), format($q$select app.manager_close_shift(%L, %L, 0, null, %L)$q$, (select id from forgot), pg_temp.at('2026-11-25 17:00'), pg_temp.at('2026-11-26 09:00'))) ->> 'error'), '22023', 'closing a forgotten shift needs a note');
select is((pg_temp.mgr((select owner_u from fx), format($q$select app.manager_close_shift(%L, %L, 0, 'quên ra ca', %L)$q$, (select id from forgot), pg_temp.at('2026-11-25 17:00'), pg_temp.at('2026-11-26 09:00'))) ->> 'refusal'), 'own_shift', 'nobody closes their own');
select is(
  (select (r ->> 'state') || '/' || (r -> 'shift' ->> 'hours') from pg_temp.mgr((select manager_u from fx), format($q$select app.manager_close_shift(%L, %L, 0, 'quên ra ca', %L)$q$, (select id from forgot), pg_temp.at('2026-11-25 17:00'), pg_temp.at('2026-11-26 09:00'))) r),
  'closed/8.00', 'a manager closes it at 17:00 the next morning'
);
select is((select (closed_by = (select manager_u from fx)) || '/' || close_note from public.staff_shifts where id = (select id from forgot)), 'true/quên ra ca', 'with who closed it and why');
select is((pg_temp.mgr((select manager_u from fx), format($q$select app.manager_close_shift(%L, %L, 0, 'lần nữa', %L)$q$, (select id from forgot), pg_temp.at('2026-11-25 17:00'), pg_temp.at('2026-11-26 09:00'))) ->> 'refusal'), 'not_open', 'a closed shift is not closed again');
select is(
  (select (r ->> 'open') || '/' || (r ->> 'awaiting_confirmation') || '/' || jsonb_array_length(r -> 'shifts') || '/' || (r -> 'shifts' -> 0 ? 'name')
   from pg_temp.mgr((select manager_u from fx), format($q$select app.manager_shifts(%L, '2026-11-01', '2026-11-30')$q$, (select store_a2 from fx))) r),
  '0/0/2/true', 'the shifts of A2 for the manager'
);
select is((pg_temp.mgr((select manager_u from fx), format($q$select app.manager_shifts(%L, '2026-11-01', '2027-01-03')$q$, (select store_a2 from fx))) ->> 'error'), '22023', 'range boundary: 64 days are refused');
select is(jsonb_typeof(pg_temp.mgr((select manager_u from fx), format($q$select app.manager_shifts(%L, '2026-11-01', '2027-01-02')$q$, (select store_a2 from fx))) -> 'shifts'), 'array', 'range boundary: 63 days are listed');
select is((pg_temp.mgr((select staff_a2_u from fx), format($q$select app.manager_shifts(%L, '2026-11-01', '2026-11-30')$q$, (select store_a2 from fx))) ->> 'error'), '42501', 'staff do not list the store''s shifts');

-- 7. A month's worked days (acceptance criterion 7) ---------------------------------------------------------------------
insert into public.staff_roster (tenant_id, display_name, role, store_ids, status, user_id, paired_at)
select tenant_a, 'Nhân viên Thử', 'staff', array[store_a2], 'active', staff_a2_u, now() from fx;
insert into public.staff_shifts (tenant_id, store_id, user_id, business_date, clock_in_at, clock_out_at, expected_cash, counted_cash, cash_difference, status, closed_at)
select fx.tenant_a, fx.store_a2, fx.staff_a2_u, app.store_business_date(fx.store_a2, pg_temp.at(v.f)), pg_temp.at(v.f), pg_temp.at(v.t), 0, 0, 0, 'closed', pg_temp.at(v.t)
from fx cross join (values
  ('2026-11-03 08:00', '2026-11-03 12:00'),
  ('2026-11-04 22:00', '2026-11-05 06:00'),
  ('2026-11-05 08:00', '2026-11-05 11:00'),
  ('2026-11-05 14:00', '2026-11-05 19:00'),
  ('2026-11-06 07:00', '2026-11-06 17:00'),
  ('2026-11-07 09:00', '2026-11-07 11:30'),
  ('2026-11-30 22:00', '2026-12-01 02:00'),
  ('2026-12-01 08:00', '2026-12-01 16:00')
) as v (f, t);
insert into public.staff_shifts (tenant_id, store_id, user_id, business_date, clock_in_at)
select tenant_a, store_a2, staff_a2_u, '2026-11-27', pg_temp.at('2026-11-27 08:00') from fx;
create temp table wd as select pg_temp.days((select manager_u from fx), (select store_a2 from fx), date '2026-11-15') as r;
create function pg_temp.person(p_user uuid) returns jsonb language sql stable as $$
  select x from wd cross join jsonb_array_elements(wd.r -> 'people') x where (x ->> 'user_id')::uuid = p_user;
$$;
select is((select (r ->> 'month') || '/' || (r ->> 'standard_days') || '/' || (r ->> 'standard_day_hours') from wd), '2026-11/28/8.00', 'the month''s worked days at A2, against the standard of 28 days of 8 hours');
select is(
  (select string_agg((d ->> 'date') || '=' || (d ->> 'hours') || 'h:' || (d ->> 'days'), ',' order by d ->> 'date') from jsonb_array_elements(pg_temp.person((select staff_a2_u from fx)) -> 'days') d),
  '2026-11-03=4.00h:0.50,2026-11-04=8.00h:1.00,2026-11-05=8.00h:1.00,2026-11-06=10.00h:1.00,2026-11-07=2.50h:0.31,2026-11-30=4.00h:0.50',
  'criterion 7: each day from the recorded times: a half day, a night across midnight on its start date, two shifts in one day, a long day capped at one, a short one, the month''s last night'
);
select is(
  (select (p ->> 'hours') || '/' || (p ->> 'worked_days') || '/' || (p ->> 'open_shifts') || '/' || (p ->> 'name') from pg_temp.person((select staff_a2_u from fx)) p),
  '36.50/4.31/1/Nhân viên Thử', 'criterion 7: the month is 36.5 hours and 4.31 worked days; the December shift is left out and the open shift is not counted until closed'
);
select is(
  (select (p ->> 'worked_days')::numeric from pg_temp.person((select staff_a2_u from fx)) p),
  (select sum(least(1, round(x.h / 8, 2))) from (
     select s.business_date, sum(extract(epoch from s.clock_out_at - s.clock_in_at)) / 3600 as h
     from public.staff_shifts s
     where s.user_id = (select staff_a2_u from fx) and s.store_id = (select store_a2 from fx) and s.clock_out_at is not null and s.business_date between '2026-11-01' and '2026-11-30'
     group by s.business_date) x),
  'criterion 7: the worked days equal those computed straight from the recorded clock-ins and clock-outs'
);
select is(
  (select (p ->> 'hours') || '/' || (p ->> 'worked_days') from pg_temp.person((select manager_u from fx)) p),
  '4.00/0.50', 'the manager''s own short shift counts too'
);
select is(pg_temp.rows_as((select manager_u from fx), format($q$update public.store_ordering_settings set standard_day_hours = 6 where store_id = %L returning (standard_day_hours::int)::text$q$, (select store_a2 from fx))), '6', 'a manager sets 6 hours per day at A2');
select is(
  (select (x ->> 'worked_days') from jsonb_array_elements(pg_temp.days((select manager_u from fx), (select store_a2 from fx), date '2026-11-01') -> 'people') x where (x ->> 'user_id')::uuid = (select staff_a2_u from fx)),
  '4.76', 'with 6 hours a day the same hours make 4.76 days'
);
select is((select jsonb_array_length(r -> 'people') from (select pg_temp.days((select manager_u from fx), (select store_a2 from fx), date '2026-12-31') as r) q), 1, 'December holds only its own shift');
select is((pg_temp.days((select staff_a2_u from fx), (select store_a2 from fx), date '2026-11-15') ->> 'error'), '42501', 'staff do not read everyone''s days');
select is((pg_temp.days((select viewer_u from fx), (select store_a2 from fx), date '2026-11-15') ->> 'error'), '42501', 'nor does a viewer');
select is(
  (select m ->> 'worked_days' from pg_temp.call((select staff_a2_u from fx), $q$select app.staff_my_shift('2026-11-15')$q$) r cross join jsonb_array_elements(r -> 'months') x cross join jsonb_array_elements(x -> 'people') m),
  '4.76', 'a staff member reads their own month'
);
select is((pg_temp.call((select cust1_u from fx), 'select app.staff_my_shift()') ->> 'error'), '42501', 'a customer has no shifts (42501)');

-- 8. Who reads the rows -------------------------------------------------------------------------------------------
select is(pg_temp.rows_as((select staff_a2_u from fx), 'select count(*) from public.staff_shifts'), '9', 'staff read only their own shifts');
select is(pg_temp.rows_as((select manager_u from fx), 'select count(*) from public.staff_shifts'), (select count(*)::text from public.staff_shifts s join fx on s.tenant_id = fx.tenant_a), 'a manager reads every shift of the stores in scope');
select is(pg_temp.rows_as((select viewer_u from fx), 'select count(*) from public.staff_shifts'), '0', 'a viewer reads none');
select is(pg_temp.rows_as((select owner_b_u from fx), 'select count(*) from public.staff_shifts'), '0', 'nor another tenant');
select is((pg_temp.clock_out((select cust1_u from fx), 0, pg_temp.at('2026-11-25 16:00')) ->> 'error'), '42501', 'a customer cannot clock out (42501)');

select * from finish();
rollback;
