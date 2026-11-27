-- The native till, step 5 (ADR-061, native-till.md section 10): the stamp card on the customer's Zalo account. One stamp
-- per drink when an order completes (bread earns none, an order keyed at the counter without a customer earns none);
-- a reward (a free drink) for every 9 stamps; the reward taken off a later order as its cheapest drink and given back
-- when that order is cancelled; a free order; refunds taking back stamps in proportion to the money, voiding an unused
-- reward when the card is short and noting a shortfall when the reward was already used; the brand's settings; who
-- reads what; the append-only ledger. Acceptance criterion 4: a paid order cancelled is refunded exactly, its stamp
-- effect undone and the log names who cancelled; a completed order refunded loses its stamps, the log naming who refunded.
-- Techniques: boundary values (8, 9 and 10 stamps; 18 making two rewards at once; refunds just under and at half a
-- stamp; the setting 1, 2, 30 and 31), state transitions of a reward (available -> used -> available on cancellation;
-- available -> void on a refund) and of a refund (pending takes nothing, succeeded takes the stamps), a decision table of
-- use_reward (no reward, no drink, the full price expected, applied, free), equivalence classes of lines (drinks, bread),
-- authorisation by role and tenant, error guessing (a replayed placement, the completion hook run twice).
begin;
select plan(140);

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
-- Cash and card are taken only by a person on shift at the store (migration counter_payment_needs_shift), and cash is
-- handed back only by one (migration cash_refund_needs_shift): the staff member of A1 who records the payments of these
-- suites and the manager who refunds them are clocked in there for the whole month.
insert into public.staff_shifts (tenant_id, store_id, user_id, business_date, clock_in_at, opening_cash)
select tenant_a, store_a1, staff_u, date '2026-11-01', timestamptz '2026-11-01 00:00+07', 0 from fx union all
select tenant_a, store_a1, manager_u, date '2026-11-01', timestamptz '2026-11-01 00:00+07', 0 from fx;

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
-- A customer's order at table 1 of A1, paid at the counter unless the extra keys say otherwise.
create function pg_temp.ord(p_user uuid, p_lines jsonb, p_total integer, p_extra jsonb default '{}'::jsonb) returns uuid language sql as $$
  select pg_temp.order_of(pg_temp.place(p_user, pg_temp.req(p_lines, p_total, p_extra)));
$$;
-- Paid in cash when still unpaid, started, done and completed by the staff member of A1.
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
-- A customer's card at brand A as stamps/total earned/available rewards, or none.
create function pg_temp.card(p_user uuid) returns text language sql stable as $$
  select coalesce((
    select c.stamps || '/' || c.total_earned || '/' || (select count(*) from public.stamp_rewards r where r.card_id = c.id and r.status = 'available')
    from public.stamp_cards c join app.customer_logins l on l.id = c.customer_login_id where l.user_id = p_user), 'none');
$$;
create function pg_temp.rewards(p_user uuid) returns text language sql stable as $$
  select coalesce(string_agg(r.status, ',' order by r.issued_at, r.id), '')
  from public.stamp_rewards r join public.stamp_cards c on c.id = r.card_id join app.customer_logins l on l.id = c.customer_login_id where l.user_id = p_user;
$$;
create function pg_temp.entries(p_order uuid) returns text language sql stable as $$
  select coalesce(string_agg(kind || ':' || delta || ':' || balance_after, ',' order by id), '') from public.stamp_entries where order_id = p_order;
$$;
create function pg_temp.refund(p_user uuid, p_order uuid, p_amount numeric, p_reason text, p_at timestamptz default null) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.counter_refund(%L, %s, %L, %L)$q$, p_order, p_amount, p_reason, coalesce(p_at, (select noon from fx) + interval '30 minutes')));
$$;
create function pg_temp.cart(p_user uuid, p_lines jsonb, p_extra jsonb default '{}'::jsonb) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.customer_check_cart(%L::jsonb, %L)$q$,
    jsonb_build_object('store', 'sa-1', 'type', 'table', 'table_token', pg_temp.token('Bàn 1'), 'lines', p_lines) || p_extra, (select noon from fx)));
$$;
-- A statement run as the authenticated role with a user's claims; answers its single value or the SQLSTATE.
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
  not has_table_privilege('authenticated', 'public.stamp_cards', 'insert') and not has_table_privilege('authenticated', 'public.stamp_cards', 'update')
  and not has_table_privilege('authenticated', 'public.stamp_rewards', 'insert') and not has_table_privilege('authenticated', 'public.stamp_rewards', 'update')
  and not has_table_privilege('authenticated', 'public.stamp_entries', 'insert') and not has_table_privilege('authenticated', 'public.stamp_entries', 'delete')
  and not has_table_privilege('anon', 'public.stamp_cards', 'select') and not has_table_privilege('anon', 'public.stamp_entries', 'select'),
  'no client writes a stamp card, a reward or the ledger, and anon reads none of them'
);
select ok(
  has_function_privilege('authenticated', 'public.customer_stamp_card()', 'execute') and not has_function_privilege('anon', 'public.customer_stamp_card()', 'execute')
  and not has_function_privilege('authenticated', 'app.stamps_on_completion(public.orders, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'app.stamp_entry(uuid, text, integer, uuid, uuid, text, uuid, text, timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'app.stamps_on_refund(public.orders, timestamptz)', 'execute'),
  'the customer reads the card through its RPC; the ledger functions are internal'
);
select ok(
  has_column_privilege('authenticated', 'public.stamp_card_settings', 'stamps_per_reward', 'update')
  and not has_column_privilege('authenticated', 'public.stamp_card_settings', 'brand_id', 'update')
  and not has_column_privilege('authenticated', 'public.stamp_card_settings', 'tenant_id', 'update'),
  'the settings can be changed but not moved to another brand'
);

-- 2. Stamps on completion -------------------------------------------------------------------------------------------
insert into o select 'c1_basket', pg_temp.ord((select cust1_u from fx), pg_temp.basket(), 69000);
select is(pg_temp.card((select cust1_u from fx)), 'none', 'a placed order earns nothing');
select is((pg_temp.pay(pg_temp.o('c1_basket')) ->> 'state'), 'paid', 'it is paid');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('c1_basket'), 'start') ->> 'state'), 'ok', 'started');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('c1_basket'), 'done') ->> 'state'), 'ok', 'served');
select is(pg_temp.card((select cust1_u from fx)), 'none', 'a paid order being served still earns nothing: the stamps come with completion');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('c1_basket'), 'complete') -> 'order' ->> 'status'), 'completed', 'completed');
select is(pg_temp.card((select cust1_u from fx)), '2/2/0', 'a milk tea and a coffee: two stamps on the card of the customer''s Zalo account');
select is(pg_temp.entries(pg_temp.o('c1_basket')), 'order_earned:2:2', 'the ledger holds the earn with the balance after it');
select is((select actor_kind || '/' || (occurred_at = (select noon from fx) + interval '1 minute') from public.stamp_entries where order_id = pg_temp.o('c1_basket')), 'system/true', 'earned by the system at the time of completion');
select is(app.stamps_on_completion((select x from public.orders x where x.id = pg_temp.o('c1_basket')), now()), 0, 'the completion hook run again earns nothing: once per order');
select is(pg_temp.card((select cust1_u from fx)), '2/2/0', 'the card is unchanged');
insert into o select 'c1_bread', pg_temp.ord((select cust1_u from fx), jsonb_build_array(pg_temp.line('bm'), pg_temp.line('cf', 2)), 88000);
select is(pg_temp.finish(pg_temp.o('c1_bread')), 'completed/paid', 'bread and two coffees, completed');
select is(pg_temp.card((select cust1_u from fx)), '4/4/0', 'two stamps: bread earns none');
insert into o select 'c1_only_bread', pg_temp.ord((select cust1_u from fx), jsonb_build_array(pg_temp.line('bm')), 30000);
select is(pg_temp.finish(pg_temp.o('c1_only_bread')), 'completed/paid', 'bread alone, completed');
select is(pg_temp.entries(pg_temp.o('c1_only_bread')), '', 'an order without a drink writes nothing to the ledger');
insert into o select 'c1_cancel', pg_temp.ord((select cust1_u from fx), jsonb_build_array(pg_temp.line('cf')), 29000);
select is((pg_temp.act((select staff_u from fx), pg_temp.o('c1_cancel'), 'cancel', 'customer_request') -> 'order' ->> 'status'), 'cancelled', 'staff cancel an unpaid order');
select is(pg_temp.entries(pg_temp.o('c1_cancel')), '', 'a cancelled order earns nothing');
insert into o select 'keyed', pg_temp.order_of(pg_temp.keyed('table', jsonb_build_array(pg_temp.line('cf', 3))));
select is(pg_temp.finish(pg_temp.o('keyed')), 'completed/paid', 'an order keyed at the counter, completed');
select is((select count(*)::int from public.stamp_entries where order_id = pg_temp.o('keyed')), 0, 'an order without a Zalo account earns no stamps');
select is(pg_temp.card((select cust1_u from fx)), '4/4/0', 'the customer still holds four');

-- 3. The reward at 9 stamps -----------------------------------------------------------------------------------------
insert into o select 'c2_eight', pg_temp.ord((select cust2_u from fx), jsonb_build_array(pg_temp.line('cf', 8)), 232000);
select is(pg_temp.finish(pg_temp.o('c2_eight')), 'completed/paid', 'eight coffees, completed');
select is(pg_temp.card((select cust2_u from fx)), '8/8/0', 'reward boundary: 8 stamps make no reward');
insert into o select 'c2_ninth', pg_temp.ord((select cust2_u from fx), jsonb_build_array(pg_temp.line('cf')), 29000);
select is(pg_temp.finish(pg_temp.o('c2_ninth')), 'completed/paid', 'the ninth coffee, completed');
select is(pg_temp.card((select cust2_u from fx)), '0/9/1', 'reward boundary: the 9th stamp makes a reward (the 10th drink free) and the card starts again');
select is(pg_temp.entries(pg_temp.o('c2_ninth')), 'order_earned:1:9,reward_issued:-9:0', 'the ledger shows the stamp and the 9 stamps the reward took');
select is(
  (select r.status || '/' || r.stamps || '/' || (r.issued_order_id = pg_temp.o('c2_ninth')) from public.stamp_rewards r join public.stamp_cards c on c.id = r.card_id
   join app.customer_logins l on l.id = c.customer_login_id where l.user_id = (select cust2_u from fx)),
  'available/9/true', 'the reward is available, made of 9 stamps by that order'
);
insert into o select 'c3_ten', pg_temp.ord((select cust3_u from fx), jsonb_build_array(pg_temp.line('cf', 10)), 290000);
select is(pg_temp.finish(pg_temp.o('c3_ten')), 'completed/paid', 'ten coffees at once, completed');
select is(pg_temp.card((select cust3_u from fx)), '1/10/1', 'reward boundary: 10 stamps make a reward and one stamp toward the next');
insert into o select 'c3_many', pg_temp.ord((select cust3_u from fx), jsonb_build_array(pg_temp.line('cf', 17)), 493000);
select is(pg_temp.finish(pg_temp.o('c3_many')), 'completed/paid', 'seventeen more, completed');
select is(pg_temp.card((select cust3_u from fx)), '0/27/3', '18 stamps on the card make two rewards at once');

-- 4. Using the reward ---------------------------------------------------------------------------------------------
select is(
  (select (r ->> 'reward') || '/' || (r ->> 'subtotal') || '/' || (r ->> 'discount_amount') || '/' || (r ->> 'total') from pg_temp.cart((select cust2_u from fx), pg_temp.basket(), '{"use_reward": true}') r),
  'applied/69000/29000/40000', 'the cart check shows the reward taken off as the cheapest drink''s size price (a coffee, 29,000) of 69,000'
);
select is(
  (select (r ->> 'reward') || '/' || (r ->> 'total') from pg_temp.cart((select cust1_u from fx), pg_temp.basket(), '{"use_reward": true}') r),
  'no_reward/69000', 'a customer without a reward is told so and sees the full price'
);
select is(
  (select coalesce(r ->> 'reward', 'none') || '/' || (r ->> 'discount_amount') || '/' || (r ->> 'total') from pg_temp.cart((select cust2_u from fx), pg_temp.basket()) r),
  'none/0/69000', 'without use_reward the reward is kept for later'
);
select is((pg_temp.place((select cust2_u from fx), pg_temp.req(pg_temp.basket(), 69000, '{"use_reward": true}')) ->> 'refusal'), 'price_changed', 'decision table: the reward with the full price expected is price_changed');
select is(
  (select (r ->> 'total') || '/' || (r ->> 'discount_amount') from pg_temp.place((select cust2_u from fx), pg_temp.req(pg_temp.basket(), 69000, '{"use_reward": true}')) r),
  '40000/29000', 'with the total and the discount the server would apply'
);
select is((pg_temp.place((select cust2_u from fx), pg_temp.req(pg_temp.basket(), 40000, '{"use_reward": "yes"}')) ->> 'error'), '22023', 'use_reward is true or false (22023)');
select is((pg_temp.place((select cust1_u from fx), pg_temp.req(pg_temp.basket(), 40000, '{"use_reward": true}')) ->> 'refusal'), 'no_reward', 'decision table: no reward on the card is no_reward');
select is((pg_temp.place((select cust2_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('bm')), 1000, '{"use_reward": true}')) ->> 'refusal'), 'reward_not_applicable', 'decision table: a basket without a drink is reward_not_applicable');
select is(pg_temp.card((select cust2_u from fx)), '0/9/1', 'the refusals kept the reward');
create temp table rq as select pg_temp.req(pg_temp.basket(), 40000, '{"use_reward": true}') as r;
insert into o select 'c2_reward', pg_temp.order_of(pg_temp.place((select cust2_u from fx), (select r from rq)));
select is(
  (select status || '/' || payment_status || '/' || subtotal::bigint || '/' || discount_amount::bigint || '/' || total::bigint from public.orders where id = pg_temp.o('c2_reward')),
  'accepted/unpaid/69000/29000/40000', 'decision table: the reward applied, the order costs 40,000'
);
select is(pg_temp.rewards((select cust2_u from fx)), 'used', 'the reward is used');
select is((select count(*)::int from public.stamp_rewards where used_order_id = pg_temp.o('c2_reward')), 1, 'on that order');
select is(pg_temp.entries(pg_temp.o('c2_reward')), 'reward_used:0:0', 'the ledger records it');
select is((pg_temp.place((select cust2_u from fx), (select r from rq)) ->> 'replayed'), 'true', 'the same request again is a replay');
select is((select count(*)::int from public.stamp_entries where order_id = pg_temp.o('c2_reward')), 1, 'which uses nothing more');
select is((pg_temp.place((select cust2_u from fx), pg_temp.req(pg_temp.basket(), 40000, '{"use_reward": true}')) ->> 'refusal'), 'no_reward', 'a used reward cannot be used again');
select is(pg_temp.finish(pg_temp.o('c2_reward')), 'completed/paid', 'the order is paid (40,000) and completed');
select is(pg_temp.card((select cust2_u from fx)), '1/10/0', 'two drinks, one of them free: one stamp');

-- 5. Cancelling an order that used a reward (acceptance criterion 4) and free orders ------------------------------
insert into o select 'c3_cancel', pg_temp.ord((select cust3_u from fx), jsonb_build_array(pg_temp.line('cf', 2)), 29000, '{"use_reward": true}');
select is((select total::bigint from public.orders where id = pg_temp.o('c3_cancel')), 29000::bigint, 'two coffees with a reward: 29,000');
select is(pg_temp.card((select cust3_u from fx)), '0/27/2', 'one of the three rewards is used');
select is((pg_temp.pay(pg_temp.o('c3_cancel')) ->> 'state'), 'paid', 'paid in cash');
select is(
  (pg_temp.act((select staff_u from fx), pg_temp.o('c3_cancel'), 'cancel', 'customer_request', (select noon from fx) + interval '5 minutes') -> 'order' ->> 'payment_status'),
  'refund_pending', 'criterion 4: staff cancel the paid order; its refund is due'
);
select is((select status || ':' || amount::bigint || ':' || method from public.order_refunds where order_id = pg_temp.o('c3_cancel')), 'due:29000:cash', 'criterion 4: the refund due is exactly what was paid, the way it was paid');
select is((pg_temp.refund((select staff_u from fx), pg_temp.o('c3_cancel'), 29000, 'khách đổi ý') ->> 'state'), 'succeeded', 'staff hand it back');
select is((select m.paid::bigint || '/' || m.refunded::bigint || '/' || m.refund_open::bigint from app.order_money(pg_temp.o('c3_cancel')) m), '29000/29000/0', 'criterion 4: refunded exactly what was paid');
select is((select status || '/' || payment_status from public.orders where id = pg_temp.o('c3_cancel')), 'cancelled/refunded', 'the order is cancelled and refunded');
select is(pg_temp.card((select cust3_u from fx)), '0/27/3', 'criterion 4: the stamp effect of the order is undone: the reward it used is back on the card');
select is(pg_temp.entries(pg_temp.o('c3_cancel')), 'reward_used:0:0,reward_returned:0:0', 'the ledger shows the reward used and returned and no stamp earned by the cancelled order');
select is(
  (select string_agg(action || ':' || coalesce(amount::bigint::text, '-') || ':' || actor_kind || ':' || (actor_user_id = (select staff_u from fx))::text, ',' order by id)
   from public.order_events where order_id = pg_temp.o('c3_cancel') and action in ('cancel', 'refund_due', 'refunded')),
  'cancel:29000:staff:true,refund_due:29000:staff:true,refunded:29000:staff:true', 'criterion 4: the log names who cancelled and who refunded, with the amounts'
);
select is((select (cancelled_by = (select staff_u from fx)) || '/' || cancel_reason from public.orders where id = pg_temp.o('c3_cancel')), 'true/customer_request', 'and the order records who cancelled it and why');
insert into o select 'c3_free', pg_temp.ord((select cust3_u from fx), jsonb_build_array(pg_temp.line('cf')), 0, '{"use_reward": true}');
select is(
  (select status || '/' || payment_status || '/' || total::bigint || '/' || (paid_at is not null) || '/' || (order_no is not null) from public.orders where id = pg_temp.o('c3_free')),
  'accepted/paid/0/true/true', 'decision table: a coffee with a reward is free, accepted and paid at once with its number'
);
select is((select action || ':' || reason_code || ':' || amount::bigint from public.order_events where order_id = pg_temp.o('c3_free') and kind = 'payment'), 'paid:reward:0', 'logged as paid by the reward');
select is((select count(*)::int from public.order_payments where order_id = pg_temp.o('c3_free')), 0, 'with no payment record: no money changed hands');
select is(
  (pg_temp.call((select staff_u from fx), format($q$select app.counter_record_payment(%L, 'cash', 29000, %s, %L)$q$, pg_temp.o('c3_free'),
    (select version from public.orders where id = pg_temp.o('c3_free')), (select noon from fx))) ->> 'refusal'),
  'already_paid', 'nothing can be collected for it'
);
select is(pg_temp.finish(pg_temp.o('c3_free')), 'completed/paid', 'the free order is completed');
select is(pg_temp.entries(pg_temp.o('c3_free')), 'reward_used:0:0', 'the free drink earns no stamp');
select is(pg_temp.card((select cust3_u from fx)), '0/27/2', 'two rewards are left');
insert into o select 'c3_free_cancel', pg_temp.ord((select cust3_u from fx), jsonb_build_array(pg_temp.line('cf')), 0, '{"use_reward": true}');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('c3_free_cancel'), 'cancel', 'customer_request') -> 'order' ->> 'payment_status'), 'unpaid', 'a free order cancelled has nothing to hand back');
select is((select count(*)::int from public.order_refunds where order_id = pg_temp.o('c3_free_cancel')), 0, 'no refund is opened');
select is(pg_temp.card((select cust3_u from fx)), '0/27/2', 'and its reward is back');

-- 6. Refunds take back stamps (acceptance criterion 4) --------------------------------------------------------------
insert into o select 'c4_three', pg_temp.ord((select cust4_u from fx), jsonb_build_array(pg_temp.line('cf', 3)), 87000);
select is(pg_temp.finish(pg_temp.o('c4_three')), 'completed/paid', 'three coffees (87,000), completed');
select is(pg_temp.card((select cust4_u from fx)), '3/3/0', 'three stamps');
select is((pg_temp.refund((select manager_u from fx), pg_temp.o('c4_three'), 29000, 'một ly bị đổ') ->> 'state'), 'succeeded', 'criterion 4: a manager refunds one coffee of the completed order');
select is(pg_temp.card((select cust4_u from fx)), '2/3/0', 'criterion 4: its stamp is taken back');
select is((pg_temp.refund((select manager_u from fx), pg_temp.o('c4_three'), 1000, 'bớt giá') ->> 'state'), 'succeeded', 'a refund of 1,000 more');
select is(pg_temp.card((select cust4_u from fx)), '2/3/0', '30,000 of 87,000 is still one stamp of three');
select is((pg_temp.refund((select manager_u from fx), pg_temp.o('c4_three'), 57000, 'hoàn hết') ->> 'state'), 'succeeded', 'the rest is refunded');
select is(pg_temp.card((select cust4_u from fx)), '0/3/0', 'a full refund takes back every stamp of the order');
select is(pg_temp.entries(pg_temp.o('c4_three')), 'order_earned:3:3,order_reversed:-1:2,order_reversed:-2:0', 'the ledger shows each reversal with the balance after it');
select is(
  (select string_agg(action || ':' || amount::bigint || ':' || (actor_user_id = (select manager_u from fx))::text, ',' order by id) from public.order_events where order_id = pg_temp.o('c4_three') and action = 'refunded'),
  'refunded:29000:true,refunded:1000:true,refunded:57000:true', 'criterion 4: the log names the manager and the amount of every refund'
);
insert into o select 'c4_half', pg_temp.ord((select cust4_u from fx), jsonb_build_array(pg_temp.line('cf', 2)), 58000);
select is(pg_temp.finish(pg_temp.o('c4_half')), 'completed/paid', 'two coffees (58,000), completed');
select is((pg_temp.refund((select manager_u from fx), pg_temp.o('c4_half'), 14499, 'bớt giá') ->> 'state'), 'succeeded', 'a refund of 14,499');
select is(pg_temp.card((select cust4_u from fx)), '2/5/0', 'rounding boundary: just under half a stamp takes none');
select is((pg_temp.refund((select manager_u from fx), pg_temp.o('c4_half'), 1, 'bớt giá') ->> 'state'), 'succeeded', 'one dong more');
select is(pg_temp.card((select cust4_u from fx)), '1/5/0', 'rounding boundary: half a stamp (14,500 of 58,000 for two) takes one');
insert into o select 'c5_nine', pg_temp.ord((select cust5_u from fx), jsonb_build_array(pg_temp.line('cf', 9)), 261000);
select is(pg_temp.finish(pg_temp.o('c5_nine')), 'completed/paid', 'nine coffees, completed');
select is(pg_temp.card((select cust5_u from fx)), '0/9/1', 'a reward');
select is((pg_temp.refund((select manager_u from fx), pg_temp.o('c5_nine'), 261000, 'hoàn hết') ->> 'state'), 'succeeded', 'the whole order is refunded');
select is(pg_temp.card((select cust5_u from fx)), '0/9/0', 'the unused reward its stamps made is voided');
select is(pg_temp.rewards((select cust5_u from fx)), 'void', 'state transition: available to void');
select is(pg_temp.entries(pg_temp.o('c5_nine')), 'order_earned:9:9,reward_issued:-9:0,reward_voided:9:9,order_reversed:-9:0', 'the ledger: earned, taken by the reward, the reward voided, the stamps taken back');
select is((pg_temp.place((select cust5_u from fx), pg_temp.req(jsonb_build_array(pg_temp.line('cf')), 0, '{"use_reward": true}')) ->> 'refusal'), 'no_reward', 'a voided reward cannot be used');
select is((pg_temp.refund((select manager_u from fx), pg_temp.o('c2_eight'), 232000, 'hoàn hết') ->> 'state'), 'succeeded', 'a manager refunds eight coffees whose stamps already became a used reward');
select is(pg_temp.card((select cust2_u from fx)), '0/10/0', 'what the card holds is taken back');
select is((select delta || '/' || note from public.stamp_entries where order_id = pg_temp.o('c2_eight') and kind = 'order_reversed'), '-1/shortfall 7', 'the rest is noted as a shortfall: a used reward cannot be taken back');
select is(pg_temp.rewards((select cust2_u from fx)), 'used', 'the used reward stays used');
insert into o select 'c1_online', pg_temp.ord((select cust1_u from fx), jsonb_build_array(pg_temp.line('ta')), 40000, jsonb_build_object('type', 'takeaway', 'table_token', null, 'payment', 'vietqr'));
select is((pg_temp.pay_online(pg_temp.o('c1_online'), 40000, true, 'syn-270-1') ->> 'state'), 'succeeded', 'a takeaway paid by VietQR');
select is(pg_temp.finish(pg_temp.o('c1_online')), 'completed/paid', 'picked up');
select is(pg_temp.card((select cust1_u from fx)), '5/5/0', 'a stamp');
select is((pg_temp.refund((select manager_u from fx), pg_temp.o('c1_online'), 40000, 'hoàn tiền') ->> 'state'), 'pending', 'a manager refunds it online: pending until the provider confirms');
select is(pg_temp.card((select cust1_u from fx)), '5/5/0', 'state transition: a pending refund takes nothing back yet');
select is(
  (app.checkout_refund_confirm((select id from public.order_refunds where order_id = pg_temp.o('c1_online')), true, 'syn-270-rf', null, (select noon from fx) + interval '40 minutes') ->> 'state'),
  'succeeded', 'the provider confirms the refund'
);
select is(pg_temp.card((select cust1_u from fx)), '4/5/0', 'state transition: the confirmed refund takes the stamp back');

-- 7. The brand's settings -------------------------------------------------------------------------------------------
create temp table ins as select format('insert into public.stamp_card_settings (brand_id, tenant_id, stamps_per_reward) values (%L, %L, %%s) returning stamps_per_reward', brand_a, tenant_a) as q from fx;
grant select on ins to authenticated;
select is(pg_temp.rows_as((select manager_u from fx), format((select q from ins), 1)), '23514', 'setting boundary: one stamp per reward is refused');
select is(pg_temp.rows_as((select staff_u from fx), format((select q from ins), 5)), '42501', 'staff cannot set the stamp card');
select is(pg_temp.rows_as((select viewer_u from fx), format((select q from ins), 5)), '42501', 'nor can a viewer');
select is(pg_temp.rows_as((select owner_b_u from fx), format((select q from ins), 5)), '42501', 'nor an owner of another tenant');
select is(pg_temp.rows_as((select manager_u from fx), format((select q from ins), 5)), '5', 'a manager sets 5 stamps per reward for the brand');
select is(pg_temp.rows_as((select manager_u from fx), 'update public.stamp_card_settings set stamps_per_reward = 31 returning stamps_per_reward'), '23514', 'setting boundary: 31 is refused');
select is(pg_temp.rows_as((select manager_u from fx), 'update public.stamp_card_settings set stamps_per_reward = 30 returning stamps_per_reward'), '30', 'setting boundary: 30 is accepted');
select is(pg_temp.rows_as((select manager_u from fx), 'update public.stamp_card_settings set stamps_per_reward = 2 returning stamps_per_reward'), '2', 'setting boundary: 2 is accepted');
select is(pg_temp.rows_as((select manager_u from fx), 'update public.stamp_card_settings set stamps_per_reward = 5 returning stamps_per_reward'), '5', 'and back to 5');
select is(pg_temp.rows_as((select owner_b_u from fx), 'update public.stamp_card_settings set stamps_per_reward = 9 returning stamps_per_reward'), null, 'an owner of another tenant changes nothing');
insert into o select 'c1_fifth', pg_temp.ord((select cust1_u from fx), jsonb_build_array(pg_temp.line('cf')), 29000);
select is(pg_temp.finish(pg_temp.o('c1_fifth')), 'completed/paid', 'a coffee, completed');
select is(pg_temp.card((select cust1_u from fx)), '0/6/1', 'with 5 stamps per reward the 5th stamp makes a reward');
select is((select max(r.stamps) from public.stamp_rewards r where r.issued_order_id = pg_temp.o('c1_fifth')), 5, 'made of 5 stamps');
select is(pg_temp.rows_as((select manager_u from fx), 'update public.stamp_card_settings set enabled = false returning enabled'), 'false', 'a manager turns the stamp card off');
insert into o select 'c1_off', pg_temp.ord((select cust1_u from fx), jsonb_build_array(pg_temp.line('cf')), 29000);
select is(pg_temp.finish(pg_temp.o('c1_off')), 'completed/paid', 'another coffee, completed');
select is(pg_temp.card((select cust1_u from fx)), '0/6/1', 'a card that is off earns nothing and keeps its reward');
select is(pg_temp.rows_as((select manager_u from fx), 'update public.stamp_card_settings set enabled = true returning enabled'), 'true', 'on again');

-- 8. Who reads what -------------------------------------------------------------------------------------------------
select is(
  (select (r ->> 'stamps') || '/' || (r ->> 'stamps_per_reward') || '/' || jsonb_array_length(r -> 'rewards') || '/' || (r ->> 'enabled') || '/' || (r ->> 'total_earned')
   from pg_temp.call((select cust1_u from fx), 'select app.customer_stamp_card()') r),
  '0/5/1/true/6', 'the customer reads the card: stamps, how many make a reward, the rewards, the stamps ever earned'
);
select is(
  (select (r -> 'history' -> 0 ->> 'kind') || '/' || (r -> 'history' -> 0 ->> 'order_no' is not null) || '/' || jsonb_array_length(r -> 'history')
   from pg_temp.call((select cust1_u from fx), 'select app.customer_stamp_card()') r),
  'reward_issued/true/6', 'with the latest entries first (six: four earns, a reversal, the reward) and the order numbers'
);
select is(
  (select (r ->> 'stamps') || '/' || jsonb_array_length(r -> 'rewards') || '/' || jsonb_array_length(r -> 'history') || '/' || (r ->> 'stamps_per_reward')
   from pg_temp.call((select custb_u from fx), 'select app.customer_stamp_card()') r),
  '0/0/0/9', 'a customer of another brand sees an empty card of that brand with its default of 9'
);
select is((pg_temp.call((select staff_u from fx), 'select app.customer_stamp_card()') ->> 'error'), '42501', 'a member has no customer card (42501)');
select is(
  pg_temp.rows_as((select viewer_u from fx), 'select count(*) from public.stamp_entries'),
  (select count(*)::text from public.stamp_entries e join fx on e.tenant_id = fx.tenant_a), 'a viewer reads the ledger of the tenant'
);
select is(pg_temp.rows_as((select manager_u from fx), 'select count(*) from public.stamp_cards'), '5', 'a manager reads the five cards');
select is(pg_temp.rows_as((select staff_u from fx), 'select count(*) from public.stamp_cards'), '0', 'staff read no card');
select is(pg_temp.rows_as((select owner_b_u from fx), 'select count(*) from public.stamp_entries'), '0', 'another tenant reads nothing');
select is(pg_temp.rows_as((select cust1_u from fx), 'select count(*) from public.stamp_rewards'), '0', 'a customer reads the card only through the RPC');

-- 9. The ledger holds -----------------------------------------------------------------------------------------------
select is(
  (select count(*)::int from public.stamp_cards c join fx on c.tenant_id = fx.tenant_a
   where c.stamps <> (select coalesce(sum(e.delta), 0) from public.stamp_entries e where e.card_id = c.id)
      or c.stamps <> (select e.balance_after from public.stamp_entries e where e.card_id = c.id order by e.id desc limit 1)),
  0, 'every card holds the sum of its ledger, which is the balance after its last entry'
);
select is(
  (select count(*)::int from public.stamp_cards c join fx on c.tenant_id = fx.tenant_a
   where c.total_earned <> (select coalesce(sum(e.delta), 0) from public.stamp_entries e where e.card_id = c.id and e.kind = 'order_earned')),
  0, 'and the stamps ever earned are the sum of its earns'
);
select throws_ok(format($$update public.stamp_entries set delta = 100 where order_id = %L$$, pg_temp.o('c1_basket')), '42501', null, 'a ledger entry cannot be changed, even by the owner of the database');
select throws_ok(format($$delete from public.stamp_entries where order_id = %L$$, pg_temp.o('c1_basket')), '42501', null, 'nor deleted');
select throws_ok($$truncate public.stamp_entries$$, '42501', null, 'nor truncated');
select lives_ok(format($$delete from app.customer_logins where user_id = %L$$, (select cust5_u from fx)), 'a customer''s login can still be removed');
select is((select count(*)::int from public.stamp_cards c where not exists (select 1 from app.customer_logins l where l.id = c.customer_login_id)), 0, 'with its card');
select is((select count(*)::int from public.stamp_entries e where not exists (select 1 from public.stamp_cards c where c.id = e.card_id)), 0, 'its rewards and its ledger');

select * from finish();
rollback;
