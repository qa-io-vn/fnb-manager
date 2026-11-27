-- The native till, step 6 (ADR-061, native-till.md section 11): native orders in the sales facts. The tenant's native
-- POS account and its payment methods; one invoice per completed order with the sync's columns (no receipt number, no
-- phone), item lines keyed by size, options as modifier lines, payments as the net of each method, the stamp reward as
-- a bill discount; none for an order still open or cancelled; a partial refund edits the invoice and a confirmed full
-- refund voids it, each with an invoice event; the daily facts the reports read live; the refresh of a marked date once
-- it leaves the live window, and a live date left marked; who reads the invoices; groundwork of acceptance criterion 6
-- (the day's revenue equals the payments by method, its online part the provider-confirmed transactions).
-- Techniques: equivalence classes of orders (table and takeaway, app and counter, cash, card, VietQR, a reward, free of
-- options), state transitions of the invoice (completed -> edited -> voided; a pending refund changing nothing), error
-- guessing (the completion hook run twice, a POS account key already taken), boundary of the live window (a date of the
-- live window stays marked), authorisation by role and tenant.
begin;
select plan(62);

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
-- Cash and card are taken only by a person on shift at the store (migration counter_payment_needs_shift): the staff
-- member of A1 who records the payments of these suites is clocked in there for the whole month.
insert into public.staff_shifts (tenant_id, store_id, user_id, business_date, clock_in_at, opening_cash)
select tenant_a, store_a1, staff_u, date '2026-11-01', timestamptz '2026-11-01 00:00+07', 0 from fx;

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
create function pg_temp.ord(p_user uuid, p_lines jsonb, p_total integer, p_extra jsonb default '{}'::jsonb) returns uuid language sql as $$
  select pg_temp.order_of(pg_temp.place(p_user, pg_temp.req(p_lines, p_total, p_extra)));
$$;
create function pg_temp.finish(p_order uuid) returns text language plpgsql as $$
begin
  if (select payment_status from public.orders where id = p_order) = 'unpaid' then
    perform pg_temp.pay(p_order);
  end if;
  perform pg_temp.act((select staff_u from fx), p_order, 'start');
  perform pg_temp.act((select staff_u from fx), p_order, 'done');
  perform pg_temp.act((select staff_u from fx), p_order, 'complete');
  return (select status::text || '/' || payment_status::text from public.orders where id = p_order);
end;
$$;
create function pg_temp.refund(p_user uuid, p_order uuid, p_amount numeric, p_reason text, p_at timestamptz default null) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.counter_refund(%L, %s, %L, %L)$q$, p_order, p_amount, p_reason, coalesce(p_at, (select noon from fx) + interval '30 minutes')));
$$;
create function pg_temp.inv(p_name text) returns public.invoices language sql stable as $$
  select i.* from public.invoices i where i.external_id = 'native-' || pg_temp.o(p_name);
$$;
create function pg_temp.facts() returns text language sql stable as $$
  select f.invoices || '/' || f.net_amount::bigint || '/' || f.cash_amount::bigint || '/' || f.items_sold::bigint || '/' || f.modifier_lines || '/'
    || f.bill_discount_amount::bigint || '/' || f.edited_invoices || '/' || f.voided_invoices || '/' || f.voided_amount::bigint
  from app.daily_sales_facts((select tenant_a from fx), date '2026-11-25', date '2026-11-25', array[(select store_a1 from fx)]) f;
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
  not has_function_privilege('authenticated', 'app.native_order_invoice(uuid, timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'app.native_order_invoice(uuid, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'app.native_pos_account(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.native_analytics_refresh(timestamptz, integer)', 'execute')
  and not has_function_privilege('service_role', 'app.native_analytics_refresh(timestamptz, integer)', 'execute'),
  'no client writes a native invoice or runs the refresh: only the order hooks and the minute job'
);
select ok(
  not has_table_privilege('authenticated', 'app.native_analytics_pending', 'select') and not has_table_privilege('service_role', 'app.native_analytics_pending', 'select'),
  'no API role reads the marked dates'
);

-- 2. Orders of one business day --------------------------------------------------------------------------------------
insert into o select 'cash_table', pg_temp.ord((select cust1_u from fx), pg_temp.basket(), 69000);
insert into o select 'online', pg_temp.ord((select cust2_u from fx), jsonb_build_array(pg_temp.line('ta')), 40000, jsonb_build_object('type', 'takeaway', 'table_token', null, 'payment', 'vietqr'));
insert into o select 'card_keyed', pg_temp.order_of(pg_temp.keyed('table', jsonb_build_array(pg_temp.line('bm'), pg_temp.line('cf', 2))));
insert into o select 'nine', pg_temp.ord((select cust3_u from fx), jsonb_build_array(pg_temp.line('cf', 9)), 261000);
insert into o select 'open', pg_temp.ord((select cust4_u from fx), jsonb_build_array(pg_temp.line('cf')), 29000);
insert into o select 'cancelled', pg_temp.ord((select cust5_u from fx), jsonb_build_array(pg_temp.line('cf')), 29000);
select is((select count(*)::int from o where id is null), 0, 'every order of the fixture was placed');
select is((select count(*)::int from public.pos_accounts a join fx on a.tenant_id = fx.tenant_a where a.connector = 'native'), 0, 'no native POS account before the first completed order');
select is(pg_temp.finish(pg_temp.o('cash_table')), 'completed/paid', 'a table order of the app (69,000) paid in cash, completed');
select is(
  (select a.connector || '/' || a.account_key || '/' || a.display_name from public.pos_accounts a join fx on a.tenant_id = fx.tenant_a where a.connector = 'native'),
  'native/native/Native till', 'the first completed order creates the tenant''s native POS account'
);
select is(
  (select string_agg(m.external_id || ':' || m.kind || ':' || m.name, ',' order by m.external_id) from public.payment_methods m join public.pos_accounts a on a.id = m.pos_account_id join fx on a.tenant_id = fx.tenant_a where a.connector = 'native'),
  'card:card:Thẻ,cash:cash:Tiền mặt,vietqr:bank_transfer:Chuyển khoản VietQR,zalo_checkout:ewallet:Ví điện tử (Zalo)', 'with its four payment methods and their kinds'
);
select is((select count(*)::int from public.stores s join public.pos_accounts a on a.id = s.pos_account_id where a.connector = 'native' and a.tenant_id = (select tenant_a from fx)), 0, 'no store points at it, so the sync never pulls it');
select is((pg_temp.pay_online(pg_temp.o('online'), 40000, true, 'syn-271-1') ->> 'state'), 'succeeded', 'a takeaway of the app paid by VietQR');
select is(pg_temp.finish(pg_temp.o('online')), 'completed/paid', 'picked up');
select is(
  (pg_temp.call((select staff_u from fx), format($q$select app.counter_record_payment(%L, 'card', 88000, %s, %L)$q$, pg_temp.o('card_keyed'),
    (select version from public.orders where id = pg_temp.o('card_keyed')), (select noon from fx) + interval '30 seconds')) ->> 'state'),
  'paid', 'an order keyed at the counter (bread and two coffees, 88,000) paid by card'
);
select is(pg_temp.finish(pg_temp.o('card_keyed')), 'completed/paid', 'completed');
select is(pg_temp.finish(pg_temp.o('nine')), 'completed/paid', 'nine coffees (261,000) in cash, completed: a stamp reward');
insert into o select 'reward', pg_temp.ord((select cust3_u from fx), jsonb_build_array(pg_temp.line('cf', 2)), 29000, '{"use_reward": true}');
select is(pg_temp.finish(pg_temp.o('reward')), 'completed/paid', 'two coffees with the reward (29,000) in cash, completed');
select is((pg_temp.pay(pg_temp.o('open')) ->> 'state'), 'paid', 'an order paid but not completed');
select is((pg_temp.pay(pg_temp.o('cancelled')) ->> 'state'), 'paid', 'another paid');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('cancelled'), 'cancel', 'customer_request') -> 'order' ->> 'status'), 'cancelled', 'and cancelled');

-- 3. The invoices -----------------------------------------------------------------------------------------------------
select is(
  (select count(*)::int from public.invoices i join fx on i.tenant_id = fx.tenant_a),
  5, 'one invoice for each completed order'
);
select is((select count(*)::int from public.invoices i where i.external_id in ('native-' || pg_temp.o('open'), 'native-' || pg_temp.o('cancelled'))), 0, 'none for an order still open or cancelled');
select is(
  (select (i.pos_account_id = a.id) || '/' || (i.store_id = (select store_a1 from fx)) || '/' || i.business_date || '/' || (i.sold_at = o2.completed_at) || '/' || (i.opened_at = o2.placed_at)
   from pg_temp.inv('cash_table') i join public.pos_accounts a on a.tenant_id = i.tenant_id and a.account_key = 'native' join public.orders o2 on o2.id = pg_temp.o('cash_table')),
  'true/true/2026-11-25/true/true', 'the invoice belongs to the store under the native account, on the order''s business day, sold at completion'
);
select is(
  (select coalesce(i.receipt_no, 'none') || '/' || coalesce(i.customer_phone, 'none') || '/' || i.sale_type || '/' || i.source_external_id || '/' || i.source_name || '/' || i.table_name || '/' || i.area_name
   from pg_temp.inv('cash_table') i),
  'none/none/table/native-app/Ứng dụng/Bàn 1/Tầng 1', 'no receipt number and no phone (the phone loyalty paths cannot match it), its type, source and table'
);
select is(
  (select i.gross_amount::bigint || '/' || i.bill_discount_amount::bigint || '/' || i.net_amount::bigint || '/' || i.paid_amount::bigint || '/' || i.status || '/' || i.primary_payment_method_external_id || '/' || i.primary_payment_method_name || '/' || (i.raw ->> 'order_no' ~ '^#[0-9]{3}$')
   from pg_temp.inv('cash_table') i),
  '69000/0/69000/69000/completed/cash/Tiền mặt/true', 'its amounts, status, main payment method and the order number in raw'
);
select is(
  (select string_agg(l.external_id || ':' || l.line_kind || ':' || coalesce(l.parent_line_external_id, '-') || ':' || l.item_name || ':' || l.quantity::int || ':' || l.unit_price::bigint || ':' || l.net_amount::bigint, ',' order by l.external_id)
   from public.invoice_lines l where l.invoice_id = (pg_temp.inv('cash_table')).id),
  '1:item:-:Trà sữa M:1:35000:35000,1.1:modifier:1:Trân châu:1:5000:5000,1.2:modifier:1:Bình thường:1:0:0,2:item:-:Cà phê:1:29000:29000',
  'item lines per order line and the options as modifier lines of their line'
);
select is(
  (select (l.item_external_id = pg_temp.id('ts_m')::text) || '/' || l.base_name || '/' || l.size_label || '/' || l.item_type_name || '/' || (l.item_type_external_id = pg_temp.id('cat_drink')::text)
   from public.invoice_lines l where l.invoice_id = (pg_temp.inv('cash_table')).id and l.external_id = '1'),
  'true/Trà sữa/M/Đồ uống/true', 'an item line is keyed by its size, with the item as base name and the menu category as item type'
);
select is((select sum(l.net_amount)::bigint from public.invoice_lines l where l.invoice_id = (pg_temp.inv('cash_table')).id), 69000::bigint, 'the lines add up to the gross amount');
select is(
  (select string_agg(p.sequence_no || ':' || p.payment_method_external_id || ':' || p.payment_method_name || ':' || p.amount::bigint || ':' || p.business_date, ',') from public.invoice_payments p where p.invoice_id = (pg_temp.inv('cash_table')).id),
  '1:cash:Tiền mặt:69000:2026-11-25', 'the payment by its method'
);
select is(
  (select i.sale_type || '/' || i.source_external_id || '/' || coalesce(i.table_name, 'none') || '/' || i.primary_payment_method_external_id || '/' || p.reference_no || '/' || p.amount::bigint
   from pg_temp.inv('online') i join public.invoice_payments p on p.invoice_id = i.id),
  'takeaway/native-app/none/vietqr/syn-271-1/40000', 'a VietQR takeaway carries the provider''s transaction reference'
);
select is(
  (select i.source_external_id || '/' || i.source_name || '/' || i.net_amount::bigint || '/' || i.primary_payment_method_external_id from pg_temp.inv('card_keyed') i),
  'native-counter/Quầy/88000/card', 'an order keyed at the counter, paid by card'
);
select is(
  (select i.gross_amount::bigint || '/' || i.bill_discount_amount::bigint || '/' || i.bill_discount_name || '/' || i.net_amount::bigint || '/' || i.paid_amount::bigint from pg_temp.inv('reward') i),
  '58000/29000/Phần thưởng tích điểm/29000/29000', 'the stamp reward is a bill discount'
);
select is(app.native_order_invoice(pg_temp.o('cash_table'), now()), (pg_temp.inv('cash_table')).id, 'the completion hook run again answers the same invoice');
select is(
  (select count(*)::int || '/' || (select count(*) from public.invoice_lines l where l.invoice_id = i.id) || '/' || (select count(*) from public.invoice_payments p where p.invoice_id = i.id)
   from public.invoices i where i.external_id = 'native-' || pg_temp.o('cash_table') group by i.id),
  '1/4/1', 'with no second invoice, line or payment'
);
select is(app.native_order_invoice(pg_temp.o('open'), now()), null, 'an order that is not completed has no invoice');

-- 4. The day in the reports (acceptance criterion 6, groundwork) ------------------------------------------------------
select is(pg_temp.facts(), '5/487000/359000/17/2/29000/0/0/0', 'the daily facts the reports read live hold the five orders: 487,000, 359,000 in cash, 17 items, 2 options, the reward');
select is(
  (select sum(p.amount)::bigint from public.invoice_payments p join public.invoices i on i.id = p.invoice_id where i.store_id = (select store_a1 from fx) and i.business_date = '2026-11-25' and i.status <> 'voided'),
  487000::bigint, 'criterion 6: the day''s revenue equals its payments'
);
select is(
  (select string_agg(x.method || ':' || x.amount, ',' order by x.method) from (
     select p.method, (sum(p.amount) - coalesce((select sum(r.amount) from public.order_refunds r join public.orders o2 on o2.id = r.order_id where o2.store_id = (select store_a1 from fx) and o2.status = 'completed' and r.status = 'succeeded' and r.method = p.method), 0))::bigint as amount
     from public.order_payments p join public.orders o2 on o2.id = p.order_id
     where o2.store_id = (select store_a1 from fx) and o2.business_date = '2026-11-25' and o2.status = 'completed' and p.status = 'succeeded'
     group by p.method) x),
  'card:88000,cash:359000,vietqr:40000', 'criterion 6: by method it is the counter''s cash and card and the online payments'
);
select is(
  (select sum(p.amount)::bigint from public.order_payments p join public.orders o2 on o2.id = p.order_id
   where o2.store_id = (select store_a1 from fx) and o2.status = 'completed' and p.method in ('vietqr', 'zalo_checkout') and p.status = 'succeeded' and p.provider_ref is not null),
  40000::bigint, 'criterion 6: the online part is exactly the transactions the provider confirmed'
);

-- 5. Refunds edit and void the invoice ------------------------------------------------------------------------------
select is((pg_temp.refund((select manager_u from fx), pg_temp.o('card_keyed'), 30000, 'bánh hỏng') ->> 'state'), 'succeeded', 'a manager refunds the bread (30,000) of the card order');
select is((select i.status || '/' || i.net_amount::bigint || '/' || i.paid_amount::bigint from pg_temp.inv('card_keyed') i), 'edited/58000/58000', 'state transition: the invoice is edited to 58,000');
select is((select string_agg(p.payment_method_external_id || ':' || p.amount::bigint, ',') from public.invoice_payments p where p.invoice_id = (pg_temp.inv('card_keyed')).id), 'card:58000', 'its card payment is the net of the payment and the refund');
select is(
  (select e.kind || '/' || e.amount::bigint || '/' || e.reason || '/' || e.source || '/' || (e.invoice_id = (pg_temp.inv('card_keyed')).id) from public.invoice_events e where e.invoice_external_id = 'native-' || pg_temp.o('card_keyed')),
  'edited/30000/bánh hỏng/native_refund/true', 'the refund is an invoice event with its amount and reason'
);
select is((pg_temp.refund((select manager_u from fx), pg_temp.o('online'), 40000, 'khách trả hàng') ->> 'state'), 'pending', 'a manager refunds the VietQR takeaway: pending with the provider');
select is((select i.status || '/' || i.net_amount::bigint from pg_temp.inv('online') i), 'completed/40000', 'state transition: a pending refund changes nothing yet');
select is(
  (app.checkout_refund_confirm((select id from public.order_refunds where order_id = pg_temp.o('online')), true, 'syn-271-rf', null, (select noon from fx) + interval '40 minutes') ->> 'state'),
  'succeeded', 'the provider confirms it'
);
select is((select i.status || '/' || i.net_amount::bigint || '/' || (select count(*) from public.invoice_payments p where p.invoice_id = i.id) from pg_temp.inv('online') i), 'voided/40000/0', 'state transition: a full refund voids the invoice, keeping what was voided');
select is((select e.kind || '/' || e.amount::bigint from public.invoice_events e where e.invoice_external_id = 'native-' || pg_temp.o('online')), 'voided/40000', 'logged as a void');
select is(pg_temp.facts(), '4/417000/359000/16/2/29000/1/1/40000', 'the day now reads 417,000 with one edited and one voided invoice');
select is((pg_temp.refund((select staff_u from fx), pg_temp.o('cancelled'), 29000, 'khách đổi ý') ->> 'state'), 'succeeded', 'the cancelled order is refunded in cash');
select is((select count(*)::int from public.invoice_events e where e.invoice_external_id = 'native-' || pg_temp.o('cancelled')), 0, 'the refund of a cancelled order touches no invoice');

-- 6. The aggregates of a past date ------------------------------------------------------------------------------------
select is((select count(*)::int from app.native_analytics_pending m where m.tenant_id = (select tenant_a from fx) and m.business_date = '2026-11-25'), 1, 'the business day is marked for the refresh');
insert into app.native_analytics_pending (tenant_id, business_date, marked_at) select tenant_b, app.analytics_live_from(), now() from fx;
select is((select count(*)::int from public.agg_daily_sales a where a.store_id = (select store_a1 from fx)), 0, 'no aggregate before the refresh');
select cmp_ok(app.native_analytics_refresh(now(), 10), '>=', 1, 'the refresh runs the marked dates that left the live window');
select is(
  (select a.invoices || '/' || a.net_amount::bigint || '/' || a.cash_amount::bigint || '/' || a.voided_invoices || '/' || a.edited_invoices from public.agg_daily_sales a where a.store_id = (select store_a1 from fx) and a.business_date = '2026-11-25'),
  '4/417000/359000/1/1', 'the stored aggregate of the day equals what the reports read live'
);
select is(
  (select string_agg(a.payment_method_external_id || ':' || a.kind || ':' || a.amount::bigint, ',' order by a.payment_method_external_id) from public.agg_payment_daily a where a.store_id = (select store_a1 from fx) and a.business_date = '2026-11-25'),
  'card:card:58000,cash:cash:359000', 'the payments by method with their kinds from the native account'
);
select is((select count(*)::int from app.native_analytics_pending m where m.tenant_id = (select tenant_a from fx)), 0, 'the mark is removed');
select is((select count(*)::int from app.native_analytics_pending m where m.tenant_id = (select tenant_b from fx)), 1, 'live window boundary: a date the reports still read live stays marked');
select ok((app.ordering_tick(now()) ? 'analytics_dates_refreshed'), 'the minute job runs the refresh');

-- 7. Who reads the native invoices ------------------------------------------------------------------------------------
select is(pg_temp.rows_as((select owner_u from fx), 'select count(*) from public.invoices'), '5', 'the owner reads the store''s native invoices with the other sales');
select is(pg_temp.rows_as((select viewer_u from fx), 'select count(*) from public.invoice_lines'), (select count(*)::text from public.invoice_lines l join fx on l.tenant_id = fx.tenant_a), 'a viewer reads their lines');
select is(pg_temp.rows_as((select owner_b_u from fx), 'select count(*) from public.invoices'), '0', 'another tenant reads none');
select is(pg_temp.rows_as((select cust1_u from fx), 'select count(*) from public.invoices'), '0', 'a customer reads none');
select is(pg_temp.rows_as((select owner_u from fx), 'select count(*) from public.pos_accounts where connector = ''native'''), '1', 'the owner sees the native POS account beside the POS''s');

-- 8. A POS account key already taken -------------------------------------------------------------------------------
update public.pos_accounts set connector = 'mock' where tenant_id = (select tenant_a from fx) and account_key = 'native';
select throws_ok(format($$select app.native_pos_account(%L)$$, (select tenant_a from fx)), '23505', null, 'an account key native held by another connector is never reused for native invoices');

select * from finish();
rollback;
