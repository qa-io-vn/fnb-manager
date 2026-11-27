-- The requests inbox's proposals and readings (M01; migration request_proposals_and_reads): "Đề xuất giờ khác" with a
-- message and the other time (the clock stops; the customer sees it; confirming moves the booking to it), and the
-- first owner or manager who opened a request.
-- Techniques: state transitions of a request (new -> proposed -> proposed -> confirmed; new -> proposed -> cancelled by
-- the customer; new -> declined, then no proposal), boundary values (29:59 ahead; proposed 45 minutes after the
-- request, past the 30-minute promise), equivalence partitions of the answer (a proposal without its time or message,
-- a time on a confirmation, the time asked, after closing), authorisation (staff, another tenant, an unknown id), and
-- error guessing (a replayed proposal, an old version, a proposal without its time written into the table).
begin;
select plan(30);

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


create temp table rq (name text primary key, id uuid);
grant select on rq to authenticated;
create function pg_temp.rq(p_name text) returns uuid language sql stable as $$ select id from rq where name = p_name $$;
create function pg_temp.book(p_user uuid, p_store text, p_at text) returns uuid language sql as $$
  select (pg_temp.call(p_user, format($q$select app.customer_submit_request(%L::jsonb, %L)$q$,
    jsonb_build_object('request_id', gen_random_uuid(), 'store', p_store, 'kind', 'booking', 'name', 'Lan', 'phone', '0901234567', 'party_size', 4, 'at', p_at),
    (select noon from fx))) -> 'request' ->> 'id')::uuid;
$$;
create function pg_temp.answer(p_user uuid, p_req uuid, p_status text, p_message text, p_for text default null, p_version integer default null, p_at timestamptz default null) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.manager_answer_request(%L, %L, %L, %s, %L, %L)$q$, p_req, p_status, p_message,
    coalesce(p_version, (select version from public.store_requests where id = p_req)), coalesce(p_at, (select noon from fx) + interval '5 minutes'), p_for));
$$;
create function pg_temp.inbox(p_user uuid, p_store uuid, p_at timestamptz default null) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.manager_requests(%L, null, 50, %L)$q$, p_store, coalesce(p_at, (select noon from fx) + interval '1 minute')));
$$;
update public.stores set opening_hours =
  '{"mon": [["07:00", "23:00"]], "tue": [["07:00", "23:00"]], "wed": [["07:00", "23:00"]], "thu": [["07:00", "23:00"]], "fri": [["07:00", "23:00"]], "sat": [["07:00", "23:00"]], "sun": [["07:00", "23:00"]]}'::jsonb
where id = (select store_a2 from fx);
insert into rq select 'b1', pg_temp.book((select cust1_u from fx), 'sa-2', '2026-11-26T19:00:00+07:00');
insert into rq select 'b2', pg_temp.book((select cust2_u from fx), 'sa-2', '2026-11-26T20:00:00+07:00');
insert into rq select 'b3', pg_temp.book((select cust3_u from fx), 'sa-2', '2026-11-26T21:00:00+07:00');
select is((select count(*)::int from rq where id is null), 0, 'three bookings for A2 from the app');

-- 1. Reading: the first owner or manager who opens a request is recorded ------------------------------------------------
select is((select (r ->> 'new') || '/' || (r ->> 'unread') from pg_temp.inbox((select manager_u from fx), (select store_a2 from fx)) r), '3/3', 'the inbox counts three new requests, all unread');
select is((pg_temp.call((select staff_a2_u from fx), format($q$select app.manager_request_read(%L)$q$, pg_temp.rq('b1'))) ->> 'error'), '42501', 'staff cannot open a request (contacts are personal)');
select is((pg_temp.call((select owner_b_u from fx), format($q$select app.manager_request_read(%L)$q$, pg_temp.rq('b1'))) ->> 'error'), '42501', 'nor can another tenant''s owner');
select is((pg_temp.call((select manager_u from fx), format($q$select app.manager_request_read(%L)$q$, 'aaaaaaaa-aaaa-4aaa-8aaa-000000028299')) ->> 'error'), '42501', 'an unknown request answers the same');
select is(
  (select (r ->> 'state') || '/' || (r -> 'request' ->> 'contact_phone') || '/' || ((r -> 'request' ->> 'read_by')::uuid = (select manager_u from fx))
   from pg_temp.call((select manager_u from fx), format($q$select app.manager_request_read(%L, %L)$q$, pg_temp.rq('b1'), (select noon from fx) + interval '2 minutes')) r),
  'read/' || app.loyalty_normalize_phone('0901234567') || '/true', 'a manager opens it: the contact, and who read it'
);
select is((pg_temp.call((select owner_u from fx), format($q$select app.manager_request_read(%L, %L)$q$, pg_temp.rq('b1'), (select noon from fx) + interval '3 minutes')) -> 'request' ->> 'read_at')::timestamptz,
  (select noon from fx) + interval '2 minutes', 'a later opening keeps the first reading');
select is((pg_temp.inbox((select manager_u from fx), (select store_a2 from fx)) ->> 'unread'), '2', 'two unread remain');

-- 2. Proposing another time: the input partitions and boundaries ------------------------------------------------------
select is((pg_temp.answer((select manager_u from fx), pg_temp.rq('b1'), 'proposed', 'Bàn 19:00 đã kín, 19:30 được không?') ->> 'error'), '22023', 'a proposal without its time is 22023');
select is((pg_temp.answer((select manager_u from fx), pg_temp.rq('b1'), 'proposed', null, '2026-11-26T19:30:00+07:00') ->> 'error'), '22023', 'nor without a message for the customer');
select is((pg_temp.answer((select manager_u from fx), pg_temp.rq('b1'), 'confirmed', 'ok', '2026-11-26T19:30:00+07:00') ->> 'error'), '22023', 'only a proposal names a time');
select is((pg_temp.answer((select manager_u from fx), pg_temp.rq('b1'), 'proposed', 'sớm hơn', '2026-11-25T10:34:59+07:00') ->> 'refusal'), 'time_invalid', 'boundary: 29:59 ahead is too soon');
select is((pg_temp.answer((select manager_u from fx), pg_temp.rq('b1'), 'proposed', 'cùng giờ', '2026-11-26T19:00:00+07:00') ->> 'refusal'), 'time_invalid', 'the time asked is no proposal');
select is((pg_temp.answer((select manager_u from fx), pg_temp.rq('b1'), 'proposed', 'muộn', '2026-11-26T23:15:00+07:00') ->> 'refusal'), 'time_outside_hours', 'a booking proposed after closing is refused');
select is((pg_temp.answer((select staff_a2_u from fx), pg_temp.rq('b1'), 'proposed', 'x', '2026-11-26T19:30:00+07:00') ->> 'error'), '42501', 'staff cannot answer');
select is(
  (select (r ->> 'state') || '/' || (r -> 'request' ->> 'status') || '/' || (r -> 'request' ->> 'proposed_for')::timestamptz::text || '/' || (r -> 'request' ->> 'overdue')
   from pg_temp.answer((select manager_u from fx), pg_temp.rq('b1'), 'proposed', 'Bàn 19:00 đã kín, 19:30 được không?', '2026-11-26T19:30:00+07:00', null, (select noon from fx) + interval '45 minutes') r),
  'answered/proposed/' || timestamptz '2026-11-26 19:30+07' || '/false', 'boundary: proposed 45 minutes after the request, past the 30-minute promise: no longer overdue, the clock stopped'
);
select is((pg_temp.inbox((select manager_u from fx), (select store_a2 from fx), (select noon from fx) + interval '45 minutes') ->> 'overdue'), '2', 'the two still new are overdue; the proposed one is not');
select is((pg_temp.answer((select manager_u from fx), pg_temp.rq('b1'), 'proposed', 'Bàn 19:00 đã kín, 19:30 được không?', '2026-11-26T19:30:00+07:00') ->> 'replayed'), 'true', 'the same proposal again is a replay');
select is(
  (select (r -> 'requests' -> 0 ->> 'status') || '/' || (r -> 'requests' -> 0 ->> 'proposed_for')::timestamptz::text || '/' || (r -> 'requests' -> 0 ->> 'answer_message') || '/' || ((r -> 'requests' -> 0) ? 'read_by')
   from pg_temp.call((select cust1_u from fx), 'select app.customer_requests()') r),
  'proposed/' || timestamptz '2026-11-26 19:30+07' || '/Bàn 19:00 đã kín, 19:30 được không?/false', 'the customer sees the time proposed and the message, not who read it'
);

-- 3. State transitions after a proposal ------------------------------------------------------------------------------
select is((pg_temp.answer((select manager_u from fx), pg_temp.rq('b1'), 'proposed', '19:45 thì sao?', '2026-11-26T19:45:00+07:00') -> 'request' ->> 'proposed_for')::timestamptz,
  timestamptz '2026-11-26 19:45+07', 'proposed again: another time');
select is((pg_temp.answer((select manager_u from fx), pg_temp.rq('b1'), 'confirmed', 'Đã giữ chỗ 19:45', null, 1) ->> 'state'), 'conflict', 'confirming on an old version is a conflict');
select is(
  (select (r -> 'request' ->> 'status') || '/' || (r -> 'request' ->> 'requested_for')::timestamptz::text || '/' || (r -> 'request' ->> 'proposed_for')::timestamptz::text
   from pg_temp.answer((select manager_u from fx), pg_temp.rq('b1'), 'confirmed', 'Đã giữ chỗ 19:45') r),
  'confirmed/' || timestamptz '2026-11-26 19:45+07' || '/' || timestamptz '2026-11-26 19:45+07', 'the customer agreed: confirmed, and the booking moves to 19:45'
);
select is((pg_temp.answer((select manager_u from fx), pg_temp.rq('b1'), 'proposed', 'đổi nữa', '2026-11-26T20:00:00+07:00') ->> 'refusal'), 'not_allowed', 'a confirmed request is not proposed again');
select is((pg_temp.answer((select manager_u from fx), pg_temp.rq('b2'), 'proposed', '20:30 nhé', '2026-11-26T20:30:00+07:00') -> 'request' ->> 'status'), 'proposed', 'another booking is proposed a time');
select is((pg_temp.call((select cust2_u from fx), format($q$select app.customer_cancel_request(%L)$q$, pg_temp.rq('b2'))) ->> 'state'), 'cancelled', 'the customer declines it by cancelling');
select is((pg_temp.answer((select manager_u from fx), pg_temp.rq('b3'), 'declined', 'Hết chỗ') -> 'request' ->> 'status'), 'declined', 'a third is declined');
select is((pg_temp.answer((select manager_u from fx), pg_temp.rq('b3'), 'proposed', 'hay 22:00?', '2026-11-26T22:00:00+07:00') ->> 'refusal'), 'not_allowed', 'a declined request is not proposed a time');
select is((select read_by = (select manager_u from fx) from public.store_requests where id = pg_temp.rq('b3')), true, 'answering counts as reading');
select throws_ok(
  format($q$update public.store_requests set status = 'proposed', proposed_for = null where id = %L$q$, pg_temp.rq('b3')),
  '23514', null, 'the table refuses a proposal without its time, whoever writes it'
);
select ok(
  has_function_privilege('authenticated', 'public.manager_request_read(uuid)', 'execute') and not has_function_privilege('anon', 'public.manager_request_read(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.manager_answer_request(uuid, text, text, integer, timestamptz)', 'execute')
  and to_regprocedure('public.manager_answer_request(uuid, text, text, integer)') is null
  and not has_function_privilege('service_role', 'public.manager_request_read(uuid)', 'execute'),
  'the inbox RPCs are for signed-in callers; manager_answer_request takes the time proposed'
);

select * from finish();
rollback;
