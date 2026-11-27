-- The native till, step 7 (native-till.md section 12): the requests inbox. Bookings from the customer app and the
-- website (through the service role), their replay and conflicts, the shape and every refusal, the kinds a store
-- switches on (workshop, hold, application), the limits per submitter and per store, the managers' inbox with its due
-- and overdue answers, the answers and their transitions, the customer's own list and cancellation, who reads the
-- rows, removal with the customer's account and the 180-day purge.
-- Techniques: decision table of the submission (store, kind, name, phone, party size, time, subject, note), boundary
-- values (party size 0, 1, 30, 31; the time 29 and 30 minutes and 60 days and a minute more ahead; a note of 500 and 501
-- characters; the 3rd and 4th open request; the 5th and 6th app call; the 3rd and 4th website call; the answer due at 30
-- and 31 minutes; the purge a minute before and after 180 days), state transitions of a request (new -> confirmed ->
-- cancelled; new -> declined; refused moves), authorisation by role, tenant and channel, error guessing (another
-- submitter replaying a request id, a store of another brand, a time without its offset).
begin;
select plan(104);

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

create temp table rq (name text primary key, body jsonb, id uuid);
grant select on rq to authenticated;
-- A booking for four at A1 tomorrow evening; a kind other than booking drops the party size.
create function pg_temp.rqb(p_kind text default 'booking', p_extra jsonb default '{}'::jsonb) returns jsonb language sql volatile as $$
  select (jsonb_build_object('request_id', gen_random_uuid(), 'store', 'sa-1', 'kind', p_kind, 'name', 'Khách Thử', 'phone', '0900 027 201',
    'party_size', 4, 'at', '2026-11-26T19:00:00+07:00') - case when p_kind = 'booking' then '' else 'party_size' end) || p_extra;
$$;
create function pg_temp.sub(p_user uuid, p_req jsonb, p_at timestamptz default null) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.customer_submit_request(%L::jsonb, %L)$q$, p_req, coalesce(p_at, (select noon from fx))));
$$;
create function pg_temp.web(p_key text, p_req jsonb, p_at timestamptz default null) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  begin
    v := app.web_submit_request((select brand_a from fx), p_key, p_req, coalesce(p_at, (select noon from fx)));
  exception when others then
    v := jsonb_build_object('error', sqlstate);
  end;
  return v;
end;
$$;
create function pg_temp.inbox(p_user uuid, p_status text default null, p_limit integer default 50, p_at timestamptz default null, p_store uuid default null) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.manager_requests(%L, %L, %s, %L)$q$, coalesce(p_store, (select store_a1 from fx)), p_status, coalesce(p_limit::text, 'null'),
    coalesce(p_at, (select noon from fx) + interval '5 minutes')));
$$;
create function pg_temp.answer(p_user uuid, p_id uuid, p_status text, p_message text, p_version integer default null, p_at timestamptz default null) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.manager_answer_request(%L, %L, %L, %s, %L)$q$, p_id, p_status, p_message,
    coalesce(p_version, (select r.version from public.store_requests r where r.id = p_id)), coalesce(p_at, (select noon from fx) + interval '10 minutes')));
$$;
create function pg_temp.keep(p_name text, p_answer jsonb) returns jsonb language sql as $$
  insert into rq values (p_name, null, (p_answer -> 'request' ->> 'id')::uuid) returning p_answer;
$$;
create function pg_temp.r(p_name text) returns uuid language sql stable as $$ select id from rq where name = p_name $$;
create function pg_temp.reset_limits() returns void language sql as $$
  delete from app.code_attempts a where a.tenant_id in ((select tenant_a from fx), (select tenant_b from fx));
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
  not has_function_privilege('anon', 'public.customer_submit_request(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.web_submit_request(uuid, text, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.manager_requests(uuid, text, integer)', 'execute')
  and not has_table_privilege('anon', 'public.store_requests', 'select'),
  'anon gets nothing: the website submits through its Edge Function'
);
select ok(
  has_function_privilege('service_role', 'public.web_submit_request(uuid, text, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.web_submit_request(uuid, text, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.customer_submit_request(jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.manager_answer_request(uuid, text, text, integer)', 'execute'),
  'the website''s submission is for the service role only; the app''s and the inbox are for signed-in users'
);
select ok(
  not has_table_privilege('authenticated', 'public.store_requests', 'insert') and not has_table_privilege('authenticated', 'public.store_requests', 'update')
  and not has_table_privilege('authenticated', 'public.store_requests', 'delete'),
  'no client writes a request directly'
);

-- 2. A booking from the app ---------------------------------------------------------------------------------------
insert into rq select 'first', pg_temp.rqb(), null;
select is((pg_temp.sub((select cust1_u from fx), (select body from rq where name = 'first')) ->> 'state'), 'submitted', 'a customer books a table for four tomorrow evening');
update rq set id = (select r.id from public.store_requests r where r.client_request_id = ((select body from rq where name = 'first') ->> 'request_id')::uuid) where name = 'first';
select is(
  (select r.kind || '/' || r.channel || '/' || r.status || '/' || r.contact_phone || '/' || r.party_size || '/' || (r.requested_for = timestamptz '2026-11-26 19:00+07') || '/' || (r.customer_login_id = (select id from app.customer_logins where user_id = (select cust1_u from fx))) || '/' || (r.client_key_sha256 is null)
   from public.store_requests r where r.id = pg_temp.r('first')),
  'booking/app/new/+84' || '900027201/4/true/true/true', 'it is a new booking of the app, the phone read as +84, with the customer''s login'
);
select is((pg_temp.sub((select cust1_u from fx), (select body from rq where name = 'first')) -> 'request' ? 'contact_phone'), false, 'the answer never echoes the phone back');
select is((pg_temp.sub((select cust1_u from fx), (select body from rq where name = 'first')) ->> 'replayed'), 'true', 'the same request again is a replay');
select is((pg_temp.sub((select cust1_u from fx), (select body from rq where name = 'first') || '{"party_size": 5}') ->> 'refusal'), 'request_conflict', 'the same request id with other details is request_conflict');
select is((pg_temp.sub((select cust2_u from fx), (select body from rq where name = 'first')) ->> 'refusal'), 'request_conflict', 'another customer replaying the request id learns nothing: request_conflict');
select is((select count(*)::int from public.store_requests r where r.client_request_id = ((select body from rq where name = 'first') ->> 'request_id')::uuid), 1, 'one row');
select is((pg_temp.sub((select cust1_u from fx), pg_temp.rqb() || '{"table": 3}') ->> 'error'), '22023', 'an unknown key is 22023');
select is((pg_temp.sub((select cust1_u from fx), pg_temp.rqb() || '{"request_id": "12"}') ->> 'error'), '22023', 'a request id that is not a UUID is 22023');
select is((pg_temp.sub((select cust1_u from fx), pg_temp.rqb() || '{"party_size": "4"}') ->> 'error'), '22023', 'a party size that is not a number is 22023');
select is((pg_temp.sub((select staff_u from fx), pg_temp.rqb()) ->> 'error'), '42501', 'a member has no customer session (42501)');

-- 3. The decision table of a submission ---------------------------------------------------------------------------
select pg_temp.reset_limits();
select is((pg_temp.sub((select cust2_u from fx), pg_temp.rqb() || '{"store": "sz-9"}') ->> 'refusal'), 'store_unknown', 'an unknown store is store_unknown');
select is((pg_temp.sub((select cust2_u from fx), pg_temp.rqb() || '{"store": "sb-1"}') ->> 'refusal'), 'store_unknown', 'a store of another brand is store_unknown');
select is((pg_temp.sub((select cust2_u from fx), pg_temp.rqb('workshop', '{"subject": "Pha chế cơ bản"}')) ->> 'refusal'), 'kind_not_offered', 'a workshop at a store that takes only bookings is kind_not_offered');
select is((pg_temp.sub((select cust2_u from fx), pg_temp.rqb() || '{"name": " "}') ->> 'refusal'), 'name_invalid', 'a blank name is name_invalid');
select is((pg_temp.sub((select cust2_u from fx), pg_temp.rqb() || '{"phone": "abc"}') ->> 'refusal'), 'phone_invalid', 'a phone that cannot be read is phone_invalid');
select pg_temp.reset_limits();
select is((pg_temp.sub((select cust2_u from fx), pg_temp.rqb() || '{"party_size": 0}') ->> 'refusal'), 'party_size_invalid', 'party size boundary: 0 is refused');
select is((pg_temp.sub((select cust2_u from fx), pg_temp.rqb() || '{"party_size": 31}') ->> 'refusal'), 'party_size_invalid', 'party size boundary: 31 is refused');
select is((pg_temp.sub((select cust2_u from fx), pg_temp.rqb() || '{"party_size": 2.5}') ->> 'refusal'), 'party_size_invalid', 'a fraction of a guest is refused');
select is((pg_temp.sub((select cust2_u from fx), pg_temp.rqb() - 'at') ->> 'refusal'), 'time_invalid', 'a booking needs a time');
select is((pg_temp.sub((select cust2_u from fx), pg_temp.rqb() || '{"at": "2026-11-26T19:00:00"}') ->> 'refusal'), 'time_invalid', 'a time without its offset is time_invalid');
select pg_temp.reset_limits();
select is((pg_temp.sub((select cust2_u from fx), pg_temp.rqb() || '{"at": "2026-11-25T10:29:00+07:00"}') ->> 'refusal'), 'time_invalid', 'time boundary: 29 minutes ahead is too soon');
select is((pg_temp.sub((select cust2_u from fx), pg_temp.rqb() || '{"at": "2026-11-25T10:30:00+07:00", "party_size": 1}') ->> 'state'), 'submitted', 'time and party size boundary: 30 minutes ahead for one guest is taken');
select is((pg_temp.sub((select cust2_u from fx), pg_temp.rqb() || '{"at": "2027-01-24T10:01:00+07:00"}') ->> 'refusal'), 'time_invalid', 'time boundary: 60 days and a minute ahead is too far');
select is((pg_temp.sub((select cust2_u from fx), pg_temp.rqb() || '{"at": "2027-01-24T10:00:00+07:00", "party_size": 30}') ->> 'state'), 'submitted', 'time and party size boundary: 60 days ahead for thirty guests is taken');
select is((pg_temp.sub((select cust2_u from fx), pg_temp.rqb() || jsonb_build_object('note', repeat('a', 501))) ->> 'refusal'), 'note_invalid', 'note boundary: 501 characters are refused');
select pg_temp.reset_limits();
select is((pg_temp.sub((select cust2_u from fx), pg_temp.rqb() || jsonb_build_object('note', repeat('a', 500))) ->> 'state'), 'submitted', 'note boundary: 500 characters are taken');
select is((pg_temp.sub((select cust2_u from fx), pg_temp.rqb()) ->> 'refusal'), 'too_many_open_requests', 'open requests boundary: with three new requests the fourth is refused');
select is((pg_temp.sub((select cust2_u from fx), pg_temp.rqb() || '{"note": "dòng 1\ndòng 2"}') ->> 'refusal'), 'too_many_open_requests', 'still refused while three are new');

-- 4. The kinds a store switches on ----------------------------------------------------------------------------------
select is(pg_temp.rows_as((select manager_u from fx), format($q$update public.store_ordering_settings set request_kinds = '{booking,workshop,hold,application}', request_answer_minutes = 30 where store_id = %L returning array_to_string(request_kinds, ',')$q$, (select store_a1 from fx))), 'booking,workshop,hold,application', 'a manager switches on workshops, holds and applications at A1');
select is(pg_temp.rows_as((select staff_u from fx), format($q$update public.store_ordering_settings set request_kinds = '{booking}' where store_id = %L returning 1$q$, (select store_a1 from fx))), null, 'staff cannot change them');
select is(pg_temp.rows_as((select manager_u from fx), format($q$update public.store_ordering_settings set request_kinds = '{booking,party}' where store_id = %L returning 1$q$, (select store_a1 from fx))), '23514', 'an unknown kind is refused');
select pg_temp.reset_limits();
select is((pg_temp.sub((select cust3_u from fx), pg_temp.rqb('workshop')) ->> 'refusal'), 'subject_invalid', 'a workshop names which one');
select is((pg_temp.sub((select cust3_u from fx), pg_temp.rqb('workshop', '{"subject": "Pha chế cơ bản", "party_size": 2}')) ->> 'refusal'), 'party_size_invalid', 'only a booking has a party size');
select is((pg_temp.sub((select cust3_u from fx), pg_temp.rqb('hold', '{"subject": "Bánh mì"}') - 'at') ->> 'refusal'), 'time_invalid', 'a hold needs the time it is collected');
select is(pg_temp.keep('workshop', pg_temp.sub((select cust3_u from fx), pg_temp.rqb('workshop', '{"subject": "Pha chế cơ bản"}'))) ->> 'state', 'submitted', 'a workshop sign-up is taken');
select is(pg_temp.keep('application', pg_temp.sub((select cust3_u from fx), pg_temp.rqb('application', '{"subject": "Pha chế bán thời gian"}') - 'at')) ->> 'state', 'submitted', 'a job application needs no time');
select is((select kind || '/' || coalesce(party_size::text, '-') || '/' || coalesce(requested_for::text, '-') || '/' || subject from public.store_requests where id = pg_temp.r('application')), 'application/-/-/Pha chế bán thời gian', 'with the position it is for');

-- 5. The website ------------------------------------------------------------------------------------------------------
select pg_temp.reset_limits();
insert into rq select 'web', pg_temp.rqb(), null;
select is(pg_temp.keep('web_row', pg_temp.web('synthetic-client-key-0001', (select body from rq where name = 'web'))) ->> 'state', 'submitted', 'the website''s Edge Function submits a booking');
select is(
  (select r.channel || '/' || (r.customer_login_id is null) || '/' || (r.client_key_sha256 = encode(extensions.digest('synthetic-client-key-0001', 'sha256'), 'hex')) from public.store_requests r where r.id = pg_temp.r('web_row')),
  'website/true/true', 'a website request keeps only the SHA-256 of the client key and no login'
);
select is((pg_temp.web('synthetic-client-key-0001', (select body from rq where name = 'web')) ->> 'replayed'), 'true', 'the same request from the same client is a replay');
select is((pg_temp.web('synthetic-client-key-0002', (select body from rq where name = 'web')) ->> 'refusal'), 'request_conflict', 'from another client it is request_conflict');
select is((pg_temp.web('short-key-15chr', pg_temp.rqb()) ->> 'error'), '22023', 'client key boundary: 15 characters are 22023');
select is((pg_temp.web('synthetic-client-key-0001', pg_temp.rqb() || '{"store": "sb-1"}') ->> 'refusal'), 'store_unknown', 'a store of another brand is store_unknown');
select throws_ok(format($$select app.web_submit_request('aaaaaaaa-aaaa-4aaa-8aaa-000000027299', 'synthetic-client-key-0001', %L::jsonb)$$, pg_temp.rqb()), '22023', null, 'an unknown brand is 22023');
select pg_temp.reset_limits();
select is((pg_temp.web('synthetic-client-key-0003', pg_temp.rqb('booking', '{"phone": "abc"}')) ->> 'refusal'), 'phone_invalid', 'a website call counts even when refused (1)');
select is((pg_temp.web('synthetic-client-key-0003', pg_temp.rqb('booking', '{"phone": "abc"}')) ->> 'refusal'), 'phone_invalid', '(2)');
select is((pg_temp.web('synthetic-client-key-0003', pg_temp.rqb('booking', '{"phone": "abc"}')) ->> 'refusal'), 'phone_invalid', 'website limit boundary: the 3rd call in an hour is still answered');
select is((pg_temp.web('synthetic-client-key-0003', pg_temp.rqb()) ->> 'refusal'), 'rate_limited', 'website limit boundary: the 4th call in an hour is rate_limited');
select is((pg_temp.web('synthetic-client-key-0003', pg_temp.rqb()) ? 'retry_at'), true, 'with when to try again');
select is((pg_temp.web('synthetic-client-key-0004', pg_temp.rqb('booking', '{"phone": "abc"}')) ->> 'refusal'), 'phone_invalid', 'another client is not limited by the first');
update app.code_attempt_policies set scope_max = 4 where endpoint = 'request_website';
select pg_temp.reset_limits();
select is((select string_agg(pg_temp.web('synthetic-client-key-01' || n || n || n, pg_temp.rqb('booking', '{"phone": "abc"}')) ->> 'refusal', ',' order by n) from generate_series(1, 5) as n),
  'phone_invalid,phone_invalid,phone_invalid,phone_invalid,rate_limited', 'store limit: past the store''s calls in the window every client of the store is rate_limited');
update app.code_attempt_policies set scope_max = 100 where endpoint = 'request_website';
select pg_temp.reset_limits();
select is((select string_agg(coalesce(pg_temp.sub((select cust4_u from fx), pg_temp.rqb('booking', '{"phone": "abc"}')) ->> 'refusal', 'x'), ',' order by n) from generate_series(1, 6) as n),
  'phone_invalid,phone_invalid,phone_invalid,phone_invalid,phone_invalid,rate_limited', 'app limit boundary: the 5th call of a customer in a day is answered, the 6th rate_limited');
select pg_temp.reset_limits();

-- 6. The managers' inbox ----------------------------------------------------------------------------------------
select is(
  (select (r ->> 'new')::int || '/' || jsonb_array_length(r -> 'requests') || '/' || (r -> 'requests' -> 0 ->> 'status') || '/' || (r -> 'requests' -> 0 ? 'contact_phone') from pg_temp.inbox((select manager_u from fx)) r),
  '7/7/new/true', 'the manager''s inbox of A1: the seven new requests, with the contact'
);
select is(
  (select string_agg(x ->> 'overdue', ',') from jsonb_array_elements(pg_temp.inbox((select manager_u from fx), null, 50, (select noon from fx) + interval '30 minutes') -> 'requests') x where (x ->> 'id')::uuid = pg_temp.r('first')),
  'false', 'answer due boundary: at 30 minutes a new request is not yet overdue'
);
select is(
  (select string_agg(x ->> 'overdue', ',') from jsonb_array_elements(pg_temp.inbox((select manager_u from fx), null, 50, (select noon from fx) + interval '30 minutes 1 second') -> 'requests') x where (x ->> 'id')::uuid = pg_temp.r('first')),
  'true', 'answer due boundary: past 30 minutes it is overdue'
);
select is((pg_temp.inbox((select manager_u from fx), null, 50, (select noon from fx) + interval '31 minutes') ->> 'overdue'), '7', 'and counted');
select is(jsonb_array_length(pg_temp.inbox((select manager_u from fx), 'confirmed') -> 'requests'), 0, 'a status filter');
select is(jsonb_array_length(pg_temp.inbox((select manager_u from fx), null, 2) -> 'requests'), 2, 'a limit');
select is((pg_temp.inbox((select manager_u from fx), 'open') ->> 'error'), '22023', 'an unknown status is 22023');
select is((pg_temp.inbox((select manager_u from fx), null, 0) ->> 'error'), '22023', 'limit boundary: 0 is 22023');
select is((pg_temp.inbox((select manager_u from fx), null, 201) ->> 'error'), '22023', 'limit boundary: 201 is 22023');
select is((pg_temp.inbox((select staff_u from fx)) ->> 'error'), '42501', 'staff have no inbox');
select is((pg_temp.inbox((select viewer_u from fx)) ->> 'error'), '42501', 'nor does a viewer');
select is((pg_temp.inbox((select owner_b_u from fx)) ->> 'error'), '42501', 'nor an owner of another tenant');
select is((pg_temp.inbox((select cust1_u from fx)) ->> 'error'), '42501', 'nor a customer');
select is((pg_temp.inbox((select owner_u from fx), null, 50, null, (select store_a2 from fx)) -> 'requests'), '[]'::jsonb, 'another store''s inbox is its own');

-- 7. Answers ----------------------------------------------------------------------------------------------------------
select is((pg_temp.answer((select manager_u from fx), pg_temp.r('first'), 'confirmed', 'Hẹn gặp anh chị lúc 19:00') ->> 'state'), 'answered', 'a manager confirms the booking');
select is(
  (select r.status || '/' || r.version || '/' || (r.answered_by = (select manager_u from fx)) || '/' || (r.answered_at = (select noon from fx) + interval '10 minutes') || '/' || r.answer_message from public.store_requests r where r.id = pg_temp.r('first')),
  'confirmed/2/true/true/Hẹn gặp anh chị lúc 19:00', 'the answer records who, when and the message'
);
select is((pg_temp.answer((select manager_u from fx), pg_temp.r('first'), 'confirmed', 'Hẹn gặp anh chị lúc 19:00', 1) ->> 'replayed'), 'true', 'the same answer again is a replay');
select is((pg_temp.answer((select manager_u from fx), pg_temp.r('first'), 'cancelled', 'Quán đóng cửa đột xuất', 1) ->> 'state'), 'conflict', 'an answer on a version the request no longer has is a conflict');
select is((pg_temp.answer((select manager_u from fx), pg_temp.r('workshop'), 'declined', null) ->> 'error'), '22023', 'declining needs a message for the customer');
select is((pg_temp.answer((select manager_u from fx), pg_temp.r('workshop'), 'done', 'x') ->> 'error'), '22023', 'an unknown answer is 22023');
select is((pg_temp.answer((select manager_u from fx), pg_temp.r('workshop'), 'declined', 'Lớp đã đủ người') ->> 'state'), 'answered', 'a manager declines the workshop sign-up');
select is((pg_temp.answer((select manager_u from fx), pg_temp.r('workshop'), 'confirmed', null) ->> 'refusal'), 'not_allowed', 'state transition: a declined request cannot be confirmed');
select is((pg_temp.answer((select staff_u from fx), pg_temp.r('application'), 'confirmed', null) ->> 'error'), '42501', 'staff cannot answer');
select is((pg_temp.answer((select owner_b_u from fx), pg_temp.r('application'), 'confirmed', null) ->> 'error'), '42501', 'nor an owner of another tenant');
select is((pg_temp.answer((select manager_u from fx), 'aaaaaaaa-aaaa-4aaa-8aaa-000000027298', 'confirmed', null, 1) ->> 'error'), '42501', 'an unknown request is 42501, like another store''s');
select is((pg_temp.answer((select owner_u from fx), pg_temp.r('first'), 'cancelled', 'Quán đóng cửa đột xuất') ->> 'state'), 'answered', 'state transition: a confirmed booking is cancelled by the owner');
select is((select r.status || '/' || r.cancelled_by_kind || '/' || (r.answered_by = (select owner_u from fx)) from public.store_requests r where r.id = pg_temp.r('first')), 'cancelled/staff/true', 'cancelled by the staff side, with who');
select is((pg_temp.answer((select owner_u from fx), pg_temp.r('first'), 'confirmed', null) ->> 'refusal'), 'not_allowed', 'state transition: a cancelled request is final');

-- 8. The customer's side ----------------------------------------------------------------------------------------------
select is(
  (select jsonb_array_length(r -> 'requests') || '/' || (r -> 'requests' -> 0 ->> 'kind') || '/' || (r -> 'requests' -> 0 ->> 'status') || '/' || (r -> 'requests' -> 0 ->> 'answer_message') || '/' || (r -> 'requests' -> 0 ? 'contact_phone')
   from pg_temp.call((select cust1_u from fx), 'select app.customer_requests()') r),
  '1/booking/cancelled/Quán đóng cửa đột xuất/false', 'the customer sees their own request with its answer, never the phone'
);
select is(jsonb_array_length(pg_temp.call((select cust3_u from fx), 'select app.customer_requests()') -> 'requests'), 2, 'each customer sees only their own');
select is((pg_temp.call((select cust3_u from fx), format($q$select app.customer_cancel_request(%L)$q$, pg_temp.r('application'))) ->> 'state'), 'cancelled', 'a customer cancels their own application');
select is((select status || '/' || cancelled_by_kind from public.store_requests where id = pg_temp.r('application')), 'cancelled/customer', 'cancelled by the customer');
select is((pg_temp.call((select cust3_u from fx), format($q$select app.customer_cancel_request(%L)$q$, pg_temp.r('application'))) ->> 'replayed'), 'true', 'a second cancel is a replay');
select is((pg_temp.call((select cust3_u from fx), format($q$select app.customer_cancel_request(%L)$q$, pg_temp.r('workshop'))) ->> 'refusal'), 'not_allowed', 'a declined request cannot be cancelled');
select is((pg_temp.call((select cust2_u from fx), format($q$select app.customer_cancel_request(%L)$q$, pg_temp.r('workshop'))) ->> 'refusal'), 'unknown_request', 'another customer''s request is unknown_request');
select is((pg_temp.call((select staff_u from fx), 'select app.customer_requests()') ->> 'error'), '42501', 'a member has no customer requests (42501)');

-- 9. Who reads the rows -------------------------------------------------------------------------------------------
select is(pg_temp.rows_as((select manager_u from fx), 'select count(*) from public.store_requests'), (select count(*)::text from public.store_requests r join fx on r.tenant_id = fx.tenant_a), 'a manager reads the requests of the stores in scope');
select is(pg_temp.rows_as((select viewer_u from fx), 'select count(*) from public.store_requests'), '0', 'a viewer reads none: they carry the customers'' contacts');
select is(pg_temp.rows_as((select staff_u from fx), 'select count(*) from public.store_requests'), '0', 'nor do staff');
select is(pg_temp.rows_as((select owner_b_u from fx), 'select count(*) from public.store_requests'), '0', 'nor another tenant');
select is(pg_temp.rows_as((select cust2_u from fx), 'select count(*) from public.store_requests'), '0', 'nor a customer (only through the RPCs)');

-- 10. Removal and retention ---------------------------------------------------------------------------------------
select is((select count(*)::int from public.store_requests r join app.customer_logins l on l.id = r.customer_login_id where l.user_id = (select cust2_u from fx)), 3, 'a customer with three requests');
select lives_ok(format($$delete from app.customer_logins where user_id = %L$$, (select cust2_u from fx)), 'deletes their account');
select is((select count(*)::int from public.store_requests r join fx on r.tenant_id = fx.tenant_a), 4, 'their requests and the contacts in them go with it: four of seven are left');
select is(((app.ordering_tick(timestamptz '2026-11-26 19:00:00+07' + interval '180 days' - interval '1 minute')) ->> 'requests_purged')::int, 1, 'the application, dated by its creation the day before, is purged 180 days later');
select is((select count(*)::int from public.store_requests where id = pg_temp.r('first')), 1, 'purge boundary: a minute before 180 days after its date a booking is kept');
select is(((app.ordering_tick(timestamptz '2026-11-26 19:00:00+07' + interval '180 days' + interval '1 minute')) ->> 'requests_purged')::int, 3, 'purge boundary: a minute after, the bookings and the workshop of that date are purged');
select is((select count(*)::int from public.store_requests r join fx on r.tenant_id = fx.tenant_a), 0, 'none of the fixture''s requests is left');

select * from finish();
rollback;
