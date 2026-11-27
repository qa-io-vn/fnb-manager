-- The member code of the Zalo account's stamp card and the counter's scan (C20, Q01; migration stamp_member_codes):
-- the customer's rotating code (a 128-bit token in the QR and an 8-digit number with a Luhn check digit, 10 minutes,
-- only hashes kept), the counter's lookup (the shortened name and the stamps, nothing else) and the attach to a counter
-- order whose drinks then earn stamps on completion, once.
-- Techniques: state transitions of a code (issued -> revoked by the next / expired) and of an attach (none ->
-- attached -> replay; refused for another holder, an app order, a cancelled order, after 30 minutes), boundary values
-- (9:59 and 10:00 after the issue; the 5th and 6th miss; the 30th and 31st code; 30:00 and 30:01 after completion),
-- equivalence partitions of what is typed (the QR, the bare token, 8 digits with a space, a wrong check digit, a
-- malformed code), decision table of the caller (staff of the store, of another store, a viewer, a customer, another
-- tenant), and the security properties: guessing limits per person and store, no PII in the answer, IDOR (the
-- attached customer neither reads nor cancels the order), no direct write past the functions.
begin;
select plan(61);

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


create temp table codes (name text primary key, payload text, number text, token text);
grant select on codes to authenticated;
create function pg_temp.issue(p_user uuid, p_name text, p_at timestamptz) returns jsonb language plpgsql as $$
declare
  v jsonb := pg_temp.call(p_user, format($q$select app.customer_stamp_code(%L)$q$, p_at));
begin
  if v ->> 'state' = 'issued' then
    insert into codes values (p_name, v -> 'code' ->> 'qr_payload', v -> 'code' ->> 'number', substr(v -> 'code' ->> 'qr_payload', 13))
    on conflict (name) do update set payload = excluded.payload, number = excluded.number, token = excluded.token;
  end if;
  return v;
end;
$$;
create function pg_temp.c(p_name text, p_part text default 'payload') returns text language sql stable as $$
  select case p_part when 'number' then number when 'token' then token else payload end from codes where name = p_name;
$$;
create function pg_temp.lookup(p_user uuid, p_store uuid, p_code text, p_at timestamptz) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.counter_member_lookup(%L, %L, %L)$q$, p_store, p_code, p_at));
$$;
create function pg_temp.attach(p_user uuid, p_order uuid, p_code text, p_at timestamptz, p_version integer default null) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.counter_attach_member(%L, %L, %s, %L)$q$, p_order, p_code,
    coalesce(p_version, (select o.version from public.orders o where o.id = p_order)), p_at));
$$;
create function pg_temp.misses() returns text language sql volatile as $$
  select coalesce(string_agg(a.subject_kind || '=' || a.attempts, ',' order by a.subject_kind), 'none')
  from app.code_attempts a where a.endpoint = 'counter_member_lookup' and a.tenant_id = (select tenant_a from fx);
$$;
create function pg_temp.complete_at(p_order uuid, p_at timestamptz) returns text language plpgsql as $$
begin
  perform pg_temp.pay(p_order, p_at - interval '3 minutes');
  perform pg_temp.act((select staff_u from fx), p_order, 'start', null, p_at - interval '2 minutes');
  perform pg_temp.act((select staff_u from fx), p_order, 'done', null, p_at - interval '1 minute');
  perform pg_temp.act((select staff_u from fx), p_order, 'complete', null, p_at);
  return (select status::text from public.orders where id = p_order);
end;
$$;
create function pg_temp.card(p_user uuid) returns jsonb language sql as $$ select pg_temp.call(p_user, 'select app.customer_stamp_card()') $$;
-- The staff member who takes the cash and the manager who hands it back are on shift at A1 (migrations
-- counter_payment_needs_shift and cash_refund_needs_shift).
insert into public.staff_shifts (tenant_id, store_id, user_id, business_date, clock_in_at, opening_cash)
select tenant_a, store_a1, staff_u, date '2026-11-25', pg_temp.at('2026-11-25 07:00'), 0 from fx union all
select tenant_a, store_a1, manager_u, date '2026-11-25', pg_temp.at('2026-11-25 07:00'), 0 from fx;

-- 1. The customer's code -------------------------------------------------------------------------------------------
select is(
  (select (r ->> 'state') || '/' || ((r -> 'code' ->> 'qr_payload') ~ '^fnb-stamp:1:[A-Za-z0-9_-]{22}$') || '/' || ((r -> 'code' ->> 'number') ~ '^[0-9]{8}$')
     || '/' || ((r -> 'code' ->> 'display_number') = left(r -> 'code' ->> 'number', 4) || ' ' || right(r -> 'code' ->> 'number', 4))
     || '/' || ((r -> 'code' ->> 'expires_at')::timestamptz - (r -> 'code' ->> 'issued_at')::timestamptz)::text
     || '/' || ((r -> 'code' ->> 'refresh_at')::timestamptz - (r -> 'code' ->> 'issued_at')::timestamptz)::text
   from pg_temp.issue((select cust1_u from fx), 'old', (select noon from fx) - interval '2 minutes') r),
  'issued/true/true/true/00:10:00/00:09:00', 'a customer gets a QR of a 128-bit token and an 8-digit number, valid 10 minutes, to refresh after 9'
);
select is(app.luhn_check_digit(left(pg_temp.c('old', 'number'), 7)), right(pg_temp.c('old', 'number'), 1)::integer, 'the 8th digit is the Luhn check digit of the first seven');
select is(app.luhn_check_digit('7992739871'), 3, 'the Luhn check digit of a known number');
select is(
  (select count(*)::int from app.stamp_member_codes m
   where m.token_sha256 = app.stamp_code_hash('token', pg_temp.c('old', 'token')) and m.number_sha256 = app.stamp_code_hash('number', pg_temp.c('old', 'number'))
     and m.token_sha256 <> pg_temp.c('old', 'token') and m.number_sha256 <> pg_temp.c('old', 'number')),
  1, 'only the hashes are kept, never the token or the number'
);
select is((pg_temp.issue((select cust1_u from fx), 'c1', (select noon from fx) - interval '1 minute') ->> 'state'), 'issued', 'a new code a minute later');
select is((select count(*)::int from app.stamp_member_codes where customer_login_id = (select id from app.customer_logins where user_id = (select cust1_u from fx)) and revoked_at is null), 1,
  'which revokes the earlier one: one live code per customer');
select is((pg_temp.lookup((select staff_u from fx), (select store_a1 from fx), pg_temp.c('old'), (select noon from fx)) ->> 'refusal'), 'code_unknown', 'the revoked code no longer works (a screenshot dies with the rotation)');
delete from app.code_attempts a where a.tenant_id = (select tenant_a from fx);

-- 2. The counter's lookup: what it sees and nothing more ---------------------------------------------------------
select is(
  (select (r ->> 'state') || '/' || coalesce(r -> 'member' ->> 'name', 'null') || '/' || (r -> 'member' ->> 'stamps') || '/' || (r -> 'member' ->> 'stamps_per_reward') || '/' || (r -> 'member' ->> 'rewards_available')
   from pg_temp.lookup((select staff_u from fx), (select store_a1 from fx), pg_temp.c('c1'), (select noon from fx)) r),
  'found/null/0/9/0', 'the QR scanned at A1: the stamps toward the 9 of a reward; no name for a Zalo account that never joined with a phone'
);
select is(
  (select string_agg(k, ',' order by k) from jsonb_object_keys(pg_temp.lookup((select staff_u from fx), (select store_a1 from fx), pg_temp.c('c1'), (select noon from fx)) -> 'member') k),
  'code_expires_at,name,rewards_available,stamps,stamps_per_reward', 'the counter sees exactly these: never a phone, an id or a full name'
);
select is((pg_temp.lookup((select staff_u from fx), (select store_a1 from fx), left(pg_temp.c('c1', 'number'), 4) || ' ' || right(pg_temp.c('c1', 'number'), 4), (select noon from fx)) ->> 'state'), 'found', 'the 8 digits read aloud, with the space');
select is((pg_temp.lookup((select manager_u from fx), (select store_a2 from fx), pg_temp.c('c1', 'token'), (select noon from fx)) ->> 'state'), 'found', 'the bare token at A2, another store of the brand');
select is((pg_temp.lookup((select staff_u from fx), (select store_a1 from fx), pg_temp.c('c1'), (select noon from fx) + interval '8 minutes 59 seconds') ->> 'state'), 'found', 'boundary: valid 9:59 after the issue');
select is((pg_temp.lookup((select staff_u from fx), (select store_a1 from fx), pg_temp.c('c1'), (select noon from fx) + interval '9 minutes') ->> 'refusal'), 'code_unknown', 'boundary: expired 10:00 after the issue');
delete from app.code_attempts a where a.tenant_id = (select tenant_a from fx);

-- 3. Guessing: mistyped numbers are free, unknown codes count, 5 misses lock the person --------------------------------
select is(
  (pg_temp.lookup((select staff_u from fx), (select store_a1 from fx), left(pg_temp.c('c1', 'number'), 7) || ((right(pg_temp.c('c1', 'number'), 1)::integer + 1) % 10)::text, (select noon from fx)) ->> 'refusal')
    || '/' || pg_temp.misses(),
  'code_mistyped/none', 'a number with a wrong check digit is code_mistyped and not counted (no such number can match)'
);
select is((pg_temp.lookup((select staff_u from fx), (select store_a1 from fx), 'abc', (select noon from fx)) ->> 'error'), '22023', 'a malformed code is 22023');
select is((pg_temp.lookup((select staff_u from fx), (select store_a1 from fx), repeat('9', 22), (select noon from fx)) ->> 'error'), '22023', 'twenty-two digits are neither a token nor a number');
select is(
  (select string_agg(pg_temp.lookup((select staff_u from fx), (select store_a1 from fx), 'fnb-stamp:1:' || rpad('guess' || n, 22, 'x'), (select noon from fx)) ->> 'refusal', ',' order by n) from generate_series(1, 6) n),
  'code_unknown,code_unknown,code_unknown,code_unknown,code_unknown,rate_limited', 'boundary: the 5th unknown code is answered, the 6th is rate_limited'
);
select is((pg_temp.lookup((select staff_u from fx), (select store_a1 from fx), pg_temp.c('c1'), (select noon from fx)) ->> 'refusal'), 'rate_limited', 'then even a live code waits for the lock');
select is((pg_temp.lookup((select manager_u from fx), (select store_a1 from fx), pg_temp.c('c1'), (select noon from fx)) ->> 'state'), 'found', 'the lock is the person''s: another member of the store still looks up');
delete from app.code_attempts a where a.tenant_id = (select tenant_a from fx);

-- 4. Who may look up, and where -------------------------------------------------------------------------------------
select is((pg_temp.lookup((select staff_a2_u from fx), (select store_a1 from fx), pg_temp.c('c1'), (select noon from fx)) ->> 'error'), '42501', 'staff of another store cannot look up at A1');
select is((pg_temp.lookup((select viewer_u from fx), (select store_a1 from fx), pg_temp.c('c1'), (select noon from fx)) ->> 'error'), '42501', 'nor a viewer');
select is((pg_temp.lookup((select cust2_u from fx), (select store_a1 from fx), pg_temp.c('c1'), (select noon from fx)) ->> 'error'), '42501', 'nor a customer');
select is((pg_temp.lookup((select owner_b_u from fx), (select store_b1 from fx), pg_temp.c('c1'), (select noon from fx)) ->> 'refusal'), 'code_unknown', 'a code of another tenant''s brand is unknown at its store');
select is((pg_temp.issue((select custb_u from fx), 'b', (select noon from fx)) ->> 'state'), 'issued', 'a customer of brand B gets a code');
select is((pg_temp.lookup((select staff_u from fx), (select store_a1 from fx), pg_temp.c('b'), (select noon from fx)) ->> 'refusal'), 'code_unknown', 'which is unknown at A1');
update public.store_ordering_settings set till_mode = 'ipos' where store_id = (select store_a2 from fx);
select is((pg_temp.lookup((select staff_a2_u from fx), (select store_a2 from fx), pg_temp.c('c1'), (select noon from fx)) ->> 'refusal'), 'not_native', 'an ipos store has no member lookup');
update public.store_ordering_settings set till_mode = 'native' where store_id = (select store_a2 from fx);
delete from app.code_attempts a where a.tenant_id = (select tenant_a from fx);

-- 5. Attaching a member to a counter order (state transitions and the decision table) -------------------------------
insert into o select 'k1', pg_temp.order_of(pg_temp.keyed('table', jsonb_build_array(pg_temp.line('cf', 2), pg_temp.line('bm'))));
insert into o select 'k2', pg_temp.order_of(pg_temp.keyed('table', jsonb_build_array(pg_temp.line('cf'))));
insert into o select 'app', pg_temp.order_of(pg_temp.place((select cust2_u from fx), pg_temp.req(pg_temp.basket(), 69000)));
select is((pg_temp.call((select staff_u from fx), format($q$select app.counter_order(%L)$q$, pg_temp.o('k1'))) ->> 'member_attached'), 'false', 'a counter order starts without a member');
select is(
  (select (r ->> 'state') || '/' || (r ->> 'stamps') || '/' || (r -> 'order' ->> 'member_attached') || '/' || (r -> 'order' ->> 'version')
   from pg_temp.attach((select staff_u from fx), pg_temp.o('k1'), pg_temp.c('c1'), (select noon from fx) + interval '1 minute') r),
  'attached/2/true/2', 'the counter attaches the customer: two coffees will earn two stamps (the bread none); the version moves'
);
select is(
  (select e.kind || '/' || e.action || '/' || e.actor_kind || '/' || (e.actor_user_id = (select staff_u from fx)) from public.order_events e where e.order_id = pg_temp.o('k1') and e.kind = 'member'),
  'member/member_attached/staff/true', 'the attach is an order event with who did it'
);
select is((pg_temp.attach((select staff_u from fx), pg_temp.o('k1'), pg_temp.c('c1'), (select noon from fx) + interval '2 minutes') ->> 'replayed'), 'true', 'the same member again is a replay');
select is((pg_temp.issue((select cust3_u from fx), 'c3', (select noon from fx)) ->> 'state'), 'issued', 'another customer''s code');
update app.customer_logins set customer_id = app.loyalty_customer_for_phone((select tenant_a from fx), '0900027901', (select noon from fx)) where user_id = (select cust3_u from fx);
update public.customers set name = '  Nguyễn Thị Lan  ' where id = (select customer_id from app.customer_logins where user_id = (select cust3_u from fx));
select is((pg_temp.lookup((select staff_u from fx), (select store_a1 from fx), pg_temp.c('c3'), (select noon from fx) + interval '1 minute') -> 'member' ->> 'name'), 'Lan', 'a customer who joined with a phone shows the last word of their name only');
select is((pg_temp.attach((select staff_u from fx), pg_temp.o('k1'), pg_temp.c('c3'), (select noon from fx) + interval '2 minutes') ->> 'refusal'), 'already_attached', 'an attached order is never attached to someone else');
select is((pg_temp.attach((select staff_u from fx), pg_temp.o('k2'), pg_temp.c('c3'), (select noon from fx) + interval '2 minutes', 7) ->> 'state'), 'conflict', 'a version the order no longer has is a conflict');
select is((pg_temp.attach((select staff_u from fx), pg_temp.o('app'), pg_temp.c('c3'), (select noon from fx) + interval '2 minutes') ->> 'refusal'), 'has_customer', 'an order of the app already belongs to its customer');
select is((pg_temp.attach((select staff_u from fx), pg_temp.o('k2'), left(pg_temp.c('c3', 'number'), 7) || ((right(pg_temp.c('c3', 'number'), 1)::integer + 1) % 10)::text, (select noon from fx) + interval '2 minutes') ->> 'refusal')
  || '/' || pg_temp.misses(), 'code_mistyped/none', 'a mistyped number at the attach is not counted either');
select is((pg_temp.attach((select staff_u from fx), pg_temp.o('k2'), 'fnb-stamp:1:' || rpad('nobody', 22, 'y'), (select noon from fx) + interval '2 minutes') ->> 'refusal') || '/' || pg_temp.misses(),
  'code_unknown/caller=1,store=1', 'an unknown code at the attach counts as a miss of the person and the store');
select is((pg_temp.attach((select staff_a2_u from fx), pg_temp.o('k2'), pg_temp.c('c3'), (select noon from fx) + interval '2 minutes') ->> 'error'), '42501', 'staff of another store cannot attach');
select is((pg_temp.call((select cust1_u from fx), format($q$select app.customer_order(%L)$q$, pg_temp.o('k1'))) ->> 'refusal'), 'unknown_order', 'the attached customer does not own the order: they cannot read it');
select is((pg_temp.call((select cust1_u from fx), format($q$select app.customer_cancel_order(%L)$q$, pg_temp.o('k1'))) ->> 'refusal'), 'unknown_order', 'nor cancel it');

-- 6. Stamps on completion, the card's list, a refund --------------------------------------------------------------
select is(
  (select (r -> 'attached' -> 0 ->> 'order_no') || '/' || (r -> 'attached' -> 0 ->> 'stamps') || '/' || (r -> 'attached' -> 0 ->> 'status') || '/' || jsonb_array_length(r -> 'attached')
   from pg_temp.card((select cust1_u from fx)) r),
  (select app.order_display_no(order_no) from public.orders where id = pg_temp.o('k1')) || '/2/accepted/1', 'the customer sees the order attached to their card and the two stamps it will earn (C20 frame 5)'
);
select is((select jsonb_array_length(pg_temp.card((select cust2_u from fx)) -> 'attached')), 0, 'another customer sees nothing of it');
select is(pg_temp.complete_at(pg_temp.o('k1'), (select noon from fx) + interval '20 minutes'), 'completed', 'the order is paid and completed');
select is((select (r ->> 'stamps') || '/' || (r ->> 'total_earned') from pg_temp.card((select cust1_u from fx)) r), '2/2', 'and its two coffees are on the customer''s card');
select is((select count(*)::int from public.stamp_entries e where e.order_id = pg_temp.o('k1') and e.kind = 'order_earned'), 1, 'earned once');
select is(
  (pg_temp.call((select manager_u from fx), format($q$select app.counter_refund(%L, %s, 'trả lại', %L)$q$, pg_temp.o('k1'), (select total from public.orders where id = pg_temp.o('k1')), (select noon from fx) + interval '25 minutes')) ->> 'state'),
  'succeeded', 'a manager refunds the order in full'
);
select is((pg_temp.card((select cust1_u from fx)) ->> 'stamps'), '0', 'and its stamps leave the card (criterion 4 for an attached order)');

-- 7. Attaching after completion: within 30 minutes the stamps come at once (boundary values) --------------------------
insert into o select 'k3', pg_temp.order_of(pg_temp.keyed('table', jsonb_build_array(pg_temp.line('cf'))));
insert into o select 'k4', pg_temp.order_of(pg_temp.keyed('table', jsonb_build_array(pg_temp.line('cf'))));
insert into o select 'k5', pg_temp.order_of(pg_temp.keyed('table', jsonb_build_array(pg_temp.line('cf'))));
select is(pg_temp.complete_at(pg_temp.o('k3'), (select noon from fx) + interval '10 minutes'), 'completed', 'a coffee completed at 10:10 without a member');
select is(pg_temp.complete_at(pg_temp.o('k4'), (select noon from fx) + interval '10 minutes'), 'completed', 'another one');
select is((pg_temp.issue((select cust1_u from fx), 'late', (select noon from fx) + interval '35 minutes') ->> 'state'), 'issued', 'the customer shows a fresh code');
select is((select (r ->> 'state') || '/' || (r ->> 'stamps') || '/' || (r ->> 'stamps_earned_now') from pg_temp.attach((select staff_u from fx), pg_temp.o('k3'), pg_temp.c('late'), (select noon from fx) + interval '40 minutes') r),
  'attached/1/true', 'boundary: attached 30 minutes after completion, its stamp is earned at once');
select is((pg_temp.attach((select staff_u from fx), pg_temp.o('k4'), pg_temp.c('late'), (select noon from fx) + interval '40 minutes 1 second') ->> 'refusal'), 'too_late', 'boundary: 30 minutes and a second after completion is too late');
select is((pg_temp.card((select cust1_u from fx)) ->> 'stamps'), '1', 'the card holds the one stamp');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('k5'), 'cancel', 'customer_request', (select noon from fx) + interval '41 minutes') ->> 'state'), 'ok', 'an order cancelled');
select is((pg_temp.attach((select staff_u from fx), pg_temp.o('k5'), pg_temp.c('late'), (select noon from fx) + interval '42 minutes') ->> 'refusal'), 'not_attachable', 'a cancelled order takes no member');

-- 8. The customer's limits and the brand's switch ------------------------------------------------------------------
update public.stamp_card_settings set enabled = false where brand_id = (select brand_a from fx);
insert into public.stamp_card_settings (brand_id, tenant_id, enabled) select brand_a, tenant_a, false from fx on conflict (brand_id) do nothing;
select is((pg_temp.issue((select cust4_u from fx), 'off', (select noon from fx)) ->> 'refusal'), 'stamps_off', 'a brand whose stamp card is off gives no code');
delete from public.stamp_card_settings where brand_id = (select brand_a from fx);
select is((select count(*)::int from generate_series(1, 28) n where pg_temp.call((select cust5_u from fx), format($q$select app.customer_stamp_code(%L)$q$, (select noon from fx) + make_interval(secs => n))) ->> 'state' = 'issued'), 28, '28 codes in a minute are issued');
select is(
  (select string_agg(coalesce(pg_temp.call((select cust5_u from fx), format($q$select app.customer_stamp_code(%L)$q$, (select noon from fx) + make_interval(secs => n))) ->> 'refusal', 'issued'), ',' order by n)
   from generate_series(29, 31) n),
  'issued,issued,rate_limited', 'boundary: after 28 earlier codes the 29th and 30th codes in 15 minutes are issued, the 31st is rate_limited'
);
select is((pg_temp.call((select staff_u from fx), format($q$select app.customer_stamp_code(%L)$q$, (select noon from fx))) ->> 'error'), '42501', 'a member of staff has no customer code');

-- 9. Privileges -----------------------------------------------------------------------------------------------------
select ok(
  not has_table_privilege('authenticated', 'app.stamp_member_codes', 'select') and not has_table_privilege('service_role', 'app.stamp_member_codes', 'select')
  and not has_function_privilege('authenticated', 'app.counter_member_lookup(uuid, text, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'app.stamp_code_find(uuid, uuid, text, timestamptz)', 'execute')
  and has_function_privilege('authenticated', 'public.customer_stamp_code()', 'execute') and not has_function_privilege('anon', 'public.customer_stamp_code()', 'execute')
  and has_function_privilege('authenticated', 'public.counter_member_lookup(uuid, text)', 'execute') and not has_function_privilege('anon', 'public.counter_member_lookup(uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.counter_attach_member(uuid, text, integer)', 'execute') and not has_function_privilege('service_role', 'public.counter_attach_member(uuid, text, integer)', 'execute'),
  'the codes are read by no API role; the three RPCs are for signed-in callers only, their halves internal'
);
select throws_ok(
  format($q$update public.orders set member_login_id = (select id from app.customer_logins where user_id = %L) where id = %L$q$, (select cust1_u from fx), pg_temp.o('app')),
  '23514', null, 'the table never attaches a member to an order of the app, whoever writes it'
);

select * from finish();
rollback;
