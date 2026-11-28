-- A customer's own data (C19; migration customer_account_deletion): a customer who never joined with a phone deletes
-- their Zalo login at once, and every customer downloads a copy of what is held about their login.
-- Techniques: decision table of the deletion (no confirmation, an open order, a refund owed, a joined customer, none of
-- these), state transition of an account (live -> deleted -> signed in again as a new customer with no stamps),
-- equivalence partitions of the data (an order with notes, its payment, invoice and events, the stamp card and member
-- code, a request with the phone typed, a staff call, a counter order attached to the card), and the security
-- properties: the export holds only the caller's rows, is recorded without its content, the deletion keeps no personal
-- data (a keyed hash and counts), a replay with the old session is refused, staff can do neither.
begin;
select plan(41);

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


insert into public.staff_shifts (tenant_id, store_id, user_id, business_date, clock_in_at, opening_cash)
select tenant_a, store_a1, staff_u, date '2026-11-25', pg_temp.at('2026-11-25 07:00'), 0 from fx;
create function pg_temp.del(p_user uuid, p_confirm boolean, p_at timestamptz default null) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.customer_delete_account(%L, %L)$q$, p_confirm, coalesce(p_at, (select noon from fx) + interval '2 hours')));
$$;
create function pg_temp.export(p_user uuid) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.customer_export_data(%L)$q$, (select noon from fx) + interval '1 hour'));
$$;
create function pg_temp.login_of(p_user uuid) returns uuid language sql volatile as $$ select id from app.customer_logins where user_id = p_user $$;
create temp table keep (name text primary key, value text);
grant select on keep to authenticated;

-- The customers' data: cust1 never joined and has a completed order with notes, a stamp card, a member code, a
-- request, a staff call and a counter order attached to the card; cust2 has an open order; cust3 is owed a refund;
-- cust4 joined with a phone.
insert into o select 'c1_order', pg_temp.order_of(pg_temp.place((select cust1_u from fx), pg_temp.req(
  jsonb_build_array(pg_temp.line('cf', 2) || jsonb_build_object('note', 'ít đá')), 58000, jsonb_build_object('note', 'Gọi tôi là Lan, 0901234567'))));
select is(pg_temp.pay(pg_temp.o('c1_order')) ->> 'state', 'paid', 'cust1''s order is paid');
select is(pg_temp.finish(pg_temp.o('c1_order')), 'completed/paid', 'and completed: two stamps and an invoice');
select is((pg_temp.call((select cust1_u from fx), format($q$select app.customer_stamp_code(%L)$q$, (select noon from fx) + interval '30 minutes')) ->> 'state'), 'issued', 'cust1 shows a member code');
insert into keep select 'code', pg_temp.call((select cust1_u from fx), format($q$select app.customer_stamp_code(%L)$q$, (select noon from fx) + interval '31 minutes')) -> 'code' ->> 'qr_payload';
insert into o select 'attached', pg_temp.order_of(pg_temp.keyed('table', jsonb_build_array(pg_temp.line('cf'))));
select is((pg_temp.call((select staff_u from fx), format($q$select app.counter_attach_member(%L, %L, 1, %L)$q$, pg_temp.o('attached'), (select value from keep where name = 'code'), (select noon from fx) + interval '32 minutes')) ->> 'state'),
  'attached', 'the counter attaches cust1 to a counter order');
select is((pg_temp.call((select cust1_u from fx), format($q$select app.customer_submit_request(%L::jsonb, %L)$q$,
  jsonb_build_object('request_id', gen_random_uuid(), 'store', 'sa-1', 'kind', 'booking', 'name', 'Lan', 'phone', '0901234567', 'party_size', 2, 'at', '2026-11-26T19:00:00+07:00'),
  (select noon from fx))) ->> 'state'), 'submitted', 'cust1 books a table');
select is((pg_temp.call((select cust1_u from fx), format($q$select app.customer_call_staff('sa-1', %L, %L)$q$, pg_temp.token('Bàn 1'), (select noon from fx) + interval '5 minutes')) ->> 'state'), 'calling', 'cust1 calls staff to the table');
insert into o select 'c2_open', pg_temp.order_of(pg_temp.place((select cust2_u from fx), pg_temp.req(pg_temp.basket(), 69000)));
insert into o select 'c3_refund', pg_temp.order_of(pg_temp.place((select cust3_u from fx), pg_temp.req(pg_temp.basket(), 69000)));
select is(pg_temp.pay(pg_temp.o('c3_refund')) ->> 'state', 'paid', 'cust3 paid');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('c3_refund'), 'cancel', 'item_unavailable') -> 'order' ->> 'payment_status'), 'refund_pending', 'then the order was cancelled: a refund is owed');
update app.customer_logins set customer_id = app.loyalty_customer_for_phone((select tenant_a from fx), '0900028004', (select noon from fx)) where user_id = (select cust4_u from fx);

-- 1. The decision table of the deletion ----------------------------------------------------------------------------
select is((pg_temp.del((select cust1_u from fx), false) ->> 'error'), '22023', 'without the confirmation nothing happens (22023)');
select is((pg_temp.del((select cust1_u from fx), null) ->> 'error'), '22023', 'nor with a null one');
select is((select (r ->> 'refusal') || '/' || (r ->> 'orders') from pg_temp.del((select cust2_u from fx), true) r), 'open_orders/1', 'an open order holds the deletion back');
select is((pg_temp.del((select cust3_u from fx), true) ->> 'refusal'), 'refund_pending', 'so does a refund the store owes');
select is((pg_temp.del((select cust4_u from fx), true) ->> 'refusal'), 'member_request', 'a customer who joined with a phone goes through the deletion request');
select is((select count(*)::int from app.customer_logins where user_id in ((select cust2_u from fx), (select cust3_u from fx), (select cust4_u from fx))), 3, 'the refused ones keep everything');
select is((pg_temp.del((select staff_u from fx), true) ->> 'error'), '42501', 'staff have no customer account to delete');

-- 2. The export (C19 "Tải bản sao dữ liệu") --------------------------------------------------------------------------
create temp table ex as select pg_temp.export((select cust1_u from fx)) as j;
grant select on ex to authenticated;
select is(
  (select string_agg(k, ',' order by k collate "C") from jsonb_object_keys((select j from ex)) k),
  'attached_orders,consents,counts,customer,deletion_request,generated_at,inbox,invoice_requests,login,memberships,not_kept,order_blocks,orders,requests,saved_companies,staff_calls,stamp_card',
  'the export names every kind of data held (the inbox of C12 since migration customer_inbox)'
);
select is(
  (select (j -> 'login' ->> 'zalo_user_id') || '/' || jsonb_array_length(j -> 'orders') || '/' || jsonb_array_length(j -> 'attached_orders') || '/' || jsonb_array_length(j -> 'requests')
     || '/' || (j -> 'requests' -> 0 ->> 'contact_phone') || '/' || jsonb_array_length(j -> 'staff_calls') || '/' || (j -> 'stamp_card' ->> 'stamps') || '/' || jsonb_array_length(j -> 'stamp_card' -> 'entries')
   from ex),
  'syn-zalo-263-1/1/1/1/' || app.loyalty_normalize_phone('0901234567') || '/1/2/1', 'cust1''s own login, order, attached order, request with the phone typed, staff call and stamp card with its ledger'
);
select is((select (j -> 'orders' -> 0 ->> 'note') || '/' || (j -> 'orders' -> 0 -> 'money' ->> 'paid') from ex), 'Gọi tôi là Lan, 0901234567/58000', 'the order as the customer sees it, with the money');
select is((select position(pg_temp.o('c2_open')::text in (select j::text from ex)) + position('syn-zalo-263-2' in (select j::text from ex))), 0, 'nothing of another customer');
select is((select count(*)::int || '/' || string_agg(c.column_name, ',' order by c.column_name) from information_schema.columns c where c.table_schema = 'app' and c.table_name = 'customer_data_exports'),
  '5/counts,customer_login_id,exported_at,id,tenant_id', 'the export is recorded with its counts only, never its content (ADR-054)');
select is((select (counts ->> 'orders') || '/' || (counts ->> 'requests') from app.customer_data_exports where customer_login_id = pg_temp.login_of((select cust1_u from fx))), '1/1', 'with the counts');
select is((pg_temp.export((select staff_u from fx)) ->> 'error'), '42501', 'staff export no customer''s data');
select is((select (j -> 'customer' ->> 'phone') || '/' || jsonb_array_length(j -> 'orders') from (select pg_temp.export((select cust4_u from fx)) as j) x), app.loyalty_normalize_phone('0900028004') || '/0', 'a joined customer''s export holds their profile with the phone');

-- 3. The deletion ---------------------------------------------------------------------------------------------------
insert into keep select 'login', pg_temp.login_of((select cust1_u from fx))::text;
insert into keep select 'events', count(*)::text from public.order_events where order_id = pg_temp.o('c1_order');
insert into keep select 'invoice', (select net_amount::bigint::text from public.invoices where external_id = 'native-' || pg_temp.o('c1_order'));
create temp table gone as select pg_temp.del((select cust1_u from fx), true) as j;
grant select on gone to authenticated;
select is(
  (select (j ->> 'state') || '/' || (j -> 'counts' ->> 'orders_unlinked') || '/' || (j -> 'counts' ->> 'attached_orders_unlinked') || '/' || (j -> 'counts' ->> 'stamp_cards') || '/' || (j -> 'counts' ->> 'requests')
     || '/' || (j -> 'counts' ->> 'staff_calls_unlinked') || '/' || (j -> 'counts' ->> 'order_notes_cleared') || '/' || (j -> 'counts' ->> 'line_notes_cleared') || '/' || (j -> 'counts' ->> 'auth_users')
   from gone),
  'deleted/1/1/1/1/1/1/1/1', 'cust1 deletes their account: the counts of what went or lost its link'
);
select is((select count(*)::int from app.customer_logins where id = (select value::uuid from keep where name = 'login')) + (select count(*)::int from auth.users where id = (select cust1_u from fx)), 0, 'the login and its Auth user are gone');
select is((select count(*)::int from public.stamp_cards where customer_login_id = (select value::uuid from keep where name = 'login')) + (select count(*)::int from app.stamp_member_codes where customer_login_id = (select value::uuid from keep where name = 'login')), 0,
  'the stamp card and the member codes are gone');
select is((select count(*)::int from public.store_requests where contact_phone = app.loyalty_normalize_phone('0901234567')), 0, 'the request with the phone typed is gone');
select is(
  (select (customer_login_id is null) || '/' || coalesce(note, 'none') || '/' || status::text || '/' || payment_status::text || '/' || total::bigint from public.orders where id = pg_temp.o('c1_order')),
  'true/none/completed/paid/58000', 'the order stays as a money record, without the customer and the note they typed'
);
select is((select count(*)::int from public.order_lines where order_id = pg_temp.o('c1_order') and note is not null), 0, 'the line notes are cleared too');
select is((select count(*)::int from public.order_payments where order_id = pg_temp.o('c1_order') and status = 'succeeded'), 1, 'the payment record stays');
select is((select net_amount::bigint::text from public.invoices where external_id = 'native-' || pg_temp.o('c1_order')), (select value from keep where name = 'invoice'), 'the store''s invoice stays as it was (the law keeps invoices)');
select is((select count(*)::text from public.order_events where order_id = pg_temp.o('c1_order')), (select value from keep where name = 'events'), 'the append-only order log stays');
select is((select member_login_id is null from public.orders where id = pg_temp.o('attached')), true, 'the counter order attached to the card lost the link');
select is((select count(*)::int from public.table_calls where store_id = (select store_a1 from fx) and customer_login_id is null), 1, 'the staff call stays for the store, without the customer');
select is(
  (select count(*)::int || '/' || bool_and(login_hash ~ '^[0-9a-f]{64}$') || '/' || bool_and(login_hash <> encode(extensions.digest('syn-zalo-263-1', 'sha256'), 'hex')) || '/' || bool_and((counts ->> 'requests') = '1')
   from app.customer_login_erasures where tenant_id = (select tenant_a from fx)),
  '1/true/true/true', 'the proof of the deletion: a keyed hash (not a plain hash of the Zalo id) and the counts'
);
select is((select string_agg(c.column_name, ',' order by c.column_name) from information_schema.columns c where c.table_schema = 'app' and c.table_name = 'customer_login_erasures'),
  'counts,erased_at,id,login_hash,tenant_id', 'which holds no name, phone or id in the clear');
select is((pg_temp.del((select cust1_u from fx), true) ->> 'error'), '42501', 'a replayed deletion with the old session finds no customer (42501)');
select is((pg_temp.export((select cust1_u from fx)) ->> 'error'), '42501', 'nor does an export');
select is((select customer_login_id = pg_temp.login_of((select cust2_u from fx)) from public.orders where id = pg_temp.o('c2_open')), true, 'another customer''s order keeps its link');

-- 4. The same Zalo account comes back as a new customer -------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select 'eeeeeeee-eeee-4eee-8eee-000000028099', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'native-280-back@example.com',
  jsonb_build_object('kind', 'customer', 'tenant_id', tenant_a) from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id)
select tenant_a, app_a, 'syn-zalo-263-1', 'eeeeeeee-eeee-4eee-8eee-000000028099' from fx;
select is((pg_temp.call('eeeeeeee-eeee-4eee-8eee-000000028099', 'select app.customer_stamp_card()') ->> 'stamps'), '0', 'signing in again makes a new customer with no stamps (C19-I5)');

-- 5. Privileges -----------------------------------------------------------------------------------------------------
select ok(
  has_function_privilege('authenticated', 'public.customer_delete_account(boolean)', 'execute') and not has_function_privilege('anon', 'public.customer_delete_account(boolean)', 'execute')
  and not has_function_privilege('service_role', 'public.customer_delete_account(boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.customer_export_data()', 'execute') and not has_function_privilege('anon', 'public.customer_export_data()', 'execute')
  and not has_function_privilege('authenticated', 'app.customer_delete_account(boolean, timestamptz)', 'execute')
  and not has_table_privilege('authenticated', 'app.customer_login_erasures', 'select') and not has_table_privilege('service_role', 'app.customer_data_exports', 'select'),
  'the two RPCs are for signed-in callers; their halves and records are internal'
);

select * from finish();
rollback;
