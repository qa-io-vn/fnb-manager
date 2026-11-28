-- Acceptance criterion 1 of the owner's plan, phase 1: "Quét QR ở 3 bàn khác nhau, đặt và trả bằng cả 3 cách; đơn hiện ở
-- quầy đúng số bàn, đúng tùy chọn". Three tables of one store, each scanned by its own customer, who orders three times,
-- once with each way to pay (at the counter, by VietQR transfer, by the Zalo wallet), each order with its own sizes,
-- quantities and options. The counter's board shows an order paid at the counter at once and an order paid online only
-- once the gateway confirmed it, each with the table whose code was scanned and the options chosen; the table map
-- counts them per table; the invoices the reports read keep the same table and the options as modifier lines.
-- Techniques: a decision table (3 tables x 3 ways to pay, all nine combinations), equivalence partitions of the lines
-- (a size, a quantity of 2, no option, one option per group, a required group, a priced topping, two toppings), state
-- transitions of an order (accepted unpaid -> paid -> completed; awaiting payment -> accepted paid -> completed), and an
-- oracle: every order on the board, every table on the map and every invoice is compared with what the customer asked
-- for, kept in a table of its own before any order is placed.
begin;
select plan(13);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000029801'::uuid as tenant_a,
  'cccccccc-cccc-4ccc-8ccc-000000029801'::uuid as account_a,
  'ffffffff-ffff-4fff-8fff-000000029801'::uuid as store_a1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000029801'::uuid as brand_a,
  '99999999-9999-4999-8999-000000029801'::uuid as app_a,
  'eeeeeeee-eeee-4eee-8eee-000000029801'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000029802'::uuid as cashier_u,
  'eeeeeeee-eeee-4eee-8eee-000000029811'::uuid as cust1_u,
  'eeeeeeee-eeee-4eee-8eee-000000029812'::uuid as cust2_u,
  'eeeeeeee-eeee-4eee-8eee-000000029813'::uuid as cust3_u;
grant select on fx to authenticated;

create temp table ids (name text primary key, id uuid not null);
insert into ids values
  ('cat', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029851'), ('item_cf', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029801'), ('item_ts', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029802'),
  ('cf', 'bbbbbbbb-bbbb-4bbb-8bbb-000000029811'), ('ts_m', 'bbbbbbbb-bbbb-4bbb-8bbb-000000029812'), ('ts_l', 'bbbbbbbb-bbbb-4bbb-8bbb-000000029813'),
  ('g_sugar', 'cccccccc-cccc-4ccc-8ccc-000000029821'), ('g_ice', 'cccccccc-cccc-4ccc-8ccc-000000029822'), ('g_top', 'cccccccc-cccc-4ccc-8ccc-000000029823'),
  ('sugar_normal', 'dddddddd-dddd-4ddd-8ddd-000000029831'), ('sugar_less', 'dddddddd-dddd-4ddd-8ddd-000000029832'),
  ('ice_less', 'dddddddd-dddd-4ddd-8ddd-000000029833'), ('ice_none', 'dddddddd-dddd-4ddd-8ddd-000000029834'),
  ('top_pearl', 'dddddddd-dddd-4ddd-8ddd-000000029835'), ('top_jelly', 'dddddddd-dddd-4ddd-8ddd-000000029836'),
  ('t1', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029841'), ('t2', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029842'), ('t3', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029843');
grant select on ids to authenticated;
create function pg_temp.id(p_name text) returns uuid language sql stable as $$ select id from ids where name = p_name $$;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'acceptance-298-' || right(u.id::text, 4) || '@example.com',
  case when u.customer then jsonb_build_object('kind', 'customer', 'tenant_id', fx.tenant_a) else '{}'::jsonb end
from fx cross join lateral (values (fx.owner_u, false), (fx.cashier_u, false), (fx.cust1_u, true), (fx.cust2_u, true), (fx.cust3_u, true)) as u (id, customer);
insert into public.tenants (id, slug, name) select tenant_a, 'acceptance-298-a', 'Acceptance 298 A' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) select account_a, tenant_a, 'mock', 'acceptance-298-a', 'Synthetic account A' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name, opening_hours)
select store_a1, tenant_a, account_a, 'a298-a1', 'sa-1', 'Synthetic store A1',
  '{"mon": [["00:00", "24:00"]], "tue": [["00:00", "24:00"]], "wed": [["00:00", "24:00"]], "thu": [["00:00", "24:00"]], "fri": [["00:00", "24:00"]], "sat": [["00:00", "24:00"]], "sun": [["00:00", "24:00"]]}'::jsonb
from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_a, owner_u, 'owner'::public.tenant_role, null::uuid[] from fx union all
select tenant_a, cashier_u, 'staff'::public.tenant_role, array[store_a1] from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids) select brand_a, tenant_a, 'brand-1', 'Synthetic brand A', array[store_a1] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_a, tenant_a, brand_a, 'synthetic-298-zapp-a', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx;
insert into public.mini_apps (tenant_id, brand_id, kind, external_id, browsable, title, header_title_vi, header_title_en,
  header_color_light, header_color_dark, text_color_light, text_color_dark)
select tenant_a, brand_a, 'customer', 'synthetic-298-mini-a', true, 'Cửa hàng mẫu', 'Cửa hàng mẫu', 'Sample store', '#ffffff', '#000000', 'black', 'white' from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id)
select tenant_a, app_a, 'syn-zalo-298-' || n, u from fx cross join lateral (values (1, fx.cust1_u), (2, fx.cust2_u), (3, fx.cust3_u)) as c (n, u);
insert into public.store_ordering_settings (store_id, tenant_id, till_mode, ordering_enabled, order_types, staff_presence_required)
select store_a1, tenant_a, 'native', true, array['table', 'takeaway'], false from fx;
insert into public.menu_categories (id, tenant_id, brand_id, name, sort_order) select pg_temp.id('cat'), tenant_a, brand_a, 'Đồ uống', 10 from fx;
insert into public.menu_items (id, tenant_id, brand_id, category_id, name, counts_for_stamps, order_types)
select pg_temp.id('item_cf'), tenant_a, brand_a, pg_temp.id('cat'), 'Cà phê', true, array['table', 'takeaway'] from fx union all
select pg_temp.id('item_ts'), tenant_a, brand_a, pg_temp.id('cat'), 'Trà sữa', true, array['table', 'takeaway'] from fx;
insert into public.menu_item_sizes (id, tenant_id, brand_id, item_id, label, price, sort_order, is_default)
select pg_temp.id(v.size), fx.tenant_a, fx.brand_a, pg_temp.id(v.item), v.label, v.price, v.sort, v.dflt
from fx cross join lateral (values ('cf', 'item_cf', null, 29000, 10, true), ('ts_m', 'item_ts', 'M', 35000, 10, true), ('ts_l', 'item_ts', 'L', 42000, 20, false))
  as v (size, item, label, price, sort, dflt);
insert into public.menu_option_groups (id, tenant_id, brand_id, name, min_select, max_select, sort_order)
select pg_temp.id(v.grp), fx.tenant_a, fx.brand_a, v.name, v.lo, v.hi, v.sort
from fx cross join lateral (values ('g_sugar', 'Đường', 1, 1, 10), ('g_ice', 'Đá', 0, 1, 20), ('g_top', 'Topping', 0, 2, 30)) as v (grp, name, lo, hi, sort);
insert into public.menu_options (id, tenant_id, brand_id, group_id, name, price_delta, sort_order)
select pg_temp.id(v.opt), fx.tenant_a, fx.brand_a, pg_temp.id(v.grp), v.name, v.price, v.sort
from fx cross join lateral (values
  ('sugar_normal', 'g_sugar', 'Bình thường', 0, 10), ('sugar_less', 'g_sugar', 'Ít đường', 0, 20),
  ('ice_less', 'g_ice', 'Ít đá', 0, 10), ('ice_none', 'g_ice', 'Không đá', 0, 20),
  ('top_pearl', 'g_top', 'Trân châu', 5000, 10), ('top_jelly', 'g_top', 'Thạch', 0, 20)
) as v (opt, grp, name, price, sort);
insert into public.menu_item_option_groups (tenant_id, brand_id, item_id, group_id, sort_order)
select tenant_a, brand_a, pg_temp.id('item_ts'), pg_temp.id('g_sugar'), 10 from fx union all
select tenant_a, brand_a, pg_temp.id('item_ts'), pg_temp.id('g_ice'), 20 from fx union all
select tenant_a, brand_a, pg_temp.id('item_ts'), pg_temp.id('g_top'), 30 from fx union all
select tenant_a, brand_a, pg_temp.id('item_cf'), pg_temp.id('g_ice'), 20 from fx;
insert into public.store_tables (id, tenant_id, store_id, label, area, sort_order)
select pg_temp.id(v.t), fx.tenant_a, fx.store_a1, v.label, v.area, v.sort
from fx cross join lateral (values ('t1', 'Bàn 1', 'Tầng 1', 1), ('t2', 'Bàn 2', 'Tầng 2', 2), ('t3', 'Bàn 3', 'Sân', 3)) as v (t, label, area, sort);

create function pg_temp.call(p_user uuid, p_sql text) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated',
    'app_metadata', coalesce((select jsonb_build_object('kind', 'customer', 'tenant_id', l.tenant_id) from app.customer_logins l where l.user_id = p_user), '{}'::jsonb))::text, true);
  begin
    execute p_sql into v;
  exception when others then
    v := jsonb_build_object('error', sqlstate);
  end;
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$$;
create function pg_temp.at(p_text text) returns timestamptz language sql immutable as $$ select (p_text || '+07')::timestamptz $$;
-- Option names in one order, the same way on both sides of every comparison.
create function pg_temp.names(p_names text[]) returns text language sql immutable as $$
  select coalesce(array_to_string(array(select n from unnest(p_names) n order by n), '+'), '');
$$;

-- What each customer asks for at their table: the oracle every later reading is compared with.
create temp table asked (name text primary key, customer uuid, table_key text, payment text, size text, qty integer, options text[], total integer, id uuid);
grant select on asked to authenticated;
insert into asked (name, customer, table_key, payment, size, qty, options, total)
select v.name, case v.table_key when 't1' then fx.cust1_u when 't2' then fx.cust2_u else fx.cust3_u end, v.table_key, v.payment, v.size, v.qty, v.options, v.total
from fx cross join (values
  ('t1-counter', 't1', 'counter', 'ts_m', 1, array['sugar_less', 'ice_none'], 35000),
  ('t1-vietqr', 't1', 'vietqr', 'ts_l', 1, array['sugar_normal', 'top_pearl'], 47000),
  ('t1-wallet', 't1', 'zalo_checkout', 'cf', 1, array['ice_less'], 29000),
  ('t2-counter', 't2', 'counter', 'cf', 1, array['ice_none'], 29000),
  ('t2-vietqr', 't2', 'vietqr', 'ts_m', 1, array['sugar_less', 'top_pearl', 'top_jelly'], 40000),
  ('t2-wallet', 't2', 'zalo_checkout', 'ts_l', 1, array['sugar_normal', 'ice_less'], 42000),
  ('t3-counter', 't3', 'counter', 'ts_l', 2, array['sugar_less', 'top_pearl'], 94000),
  ('t3-vietqr', 't3', 'vietqr', 'cf', 2, array[]::text[], 58000),
  ('t3-wallet', 't3', 'zalo_checkout', 'ts_m', 1, array['sugar_normal'], 35000)
) as v (name, table_key, payment, size, qty, options, total);
-- The expected line of an asked order, worded as the board's line below.
create function pg_temp.expected(p_name text) returns text language sql stable as $$
  select t.label || '|' || i.name || coalesce(' ' || s.label, '') || ' x' || a.qty || ' (' || pg_temp.names(array(select o.name from public.menu_options o where o.id in (select pg_temp.id(k) from unnest(a.options) k))) || ')|' || a.payment
  from asked a join public.store_tables t on t.id = pg_temp.id(a.table_key) join public.menu_item_sizes s on s.id = pg_temp.id(a.size) join public.menu_items i on i.id = s.item_id
  where a.name = p_name;
$$;
-- An order of the board (or of the customer's answer) worded the same way.
create function pg_temp.worded(p_order jsonb) returns text language sql immutable as $$
  select (p_order -> 'table' ->> 'label') || '|' || (
    select string_agg((l ->> 'item_name') || coalesce(' ' || (l ->> 'size_label'), '') || ' x' || (l ->> 'quantity') || ' ('
      || pg_temp.names(array(select op ->> 'name' from jsonb_array_elements(l -> 'options') op)) || ')', ';' order by (l ->> 'line_no')::int)
    from jsonb_array_elements(p_order -> 'lines') l) || '|' || (p_order ->> 'payment_method');
$$;
create function pg_temp.board() returns jsonb language sql as $$
  select pg_temp.call((select cashier_u from fx), format($q$select app.counter_board(%L, 0, %L)$q$, (select store_a1 from fx), pg_temp.at('2026-10-12 10:30')));
$$;

-- 1. The gateway's sandbox, a cashier on shift --------------------------------------------------------------------
select is(
  (pg_temp.call((select owner_u from fx), format($q$select app.checkout_set_provider(%L::jsonb, %L)$q$,
    jsonb_build_object('brand', (select brand_a from fx), 'method', 'vietqr', 'adapter', 'mock', 'mode', 'sandbox', 'secret_name', 'PAYMENT_BANK_BRAND_1',
      'settings', jsonb_build_object('bank_bin', '970400', 'bank_name', 'Ngân hàng mẫu', 'account_number', '0123456789', 'account_name', 'CUA HANG MAU',
        'reference_prefix', 'FNB')), pg_temp.at('2026-10-12 08:00'))) ->> 'state')
  || '/' || (pg_temp.call((select owner_u from fx), format($q$select app.checkout_set_provider(%L::jsonb, %L)$q$,
    jsonb_build_object('brand', (select brand_a from fx), 'method', 'zalo_checkout', 'mode', 'sandbox', 'secret_name', 'ZALO_CHECKOUT_KEY_BRAND_1',
      'settings', jsonb_build_object('wallet_method', 'ZALOPAY')), pg_temp.at('2026-10-12 08:00'))) ->> 'state')
  || '/' || (pg_temp.call((select cashier_u from fx), format($q$select app.staff_clock_in(%L, %L, 0, %L)$q$, (select store_a1 from fx),
    app.counter_qr_token((select tenant_a from fx), (select store_a1 from fx), 1), pg_temp.at('2026-10-12 08:30'))) ->> 'state'),
  'saved/saved/clocked_in', 'the owner switches VietQR and the Zalo wallet on in sandbox; the cashier clocks in'
);

-- 2. Nine orders: three tables, each paying all three ways ------------------------------------------------------------
update asked a set id = (pg_temp.call(a.customer, format($q$select app.customer_place_order(%L::jsonb, %L)$q$,
  jsonb_build_object('request_id', gen_random_uuid(), 'store', 'sa-1', 'type', 'table',
    'table_token', (select app.table_qr_token(t.tenant_id, t.id, t.qr_version) from public.store_tables t where t.id = pg_temp.id(a.table_key)),
    'payment', a.payment,
    'lines', jsonb_build_array(jsonb_build_object('size', pg_temp.id(a.size), 'qty', a.qty, 'options', (select coalesce(jsonb_agg(pg_temp.id(k)), '[]'::jsonb) from unnest(a.options) k))),
    'expected_total', a.total),
  pg_temp.at('2026-10-12 10:00') + (a.name ~ 'counter')::int * interval '1 second')) -> 'order' ->> 'id')::uuid;
select is(
  (select string_agg(a.name || ':' || o.status::text || ':' || (o.order_no is not null)::text || ':' || o.total::bigint, ',' order by a.name)
   from asked a join public.orders o on o.id = a.id),
  't1-counter:accepted:true:35000,t1-vietqr:awaiting_payment:false:47000,t1-wallet:awaiting_payment:false:29000,'
  || 't2-counter:accepted:true:29000,t2-vietqr:awaiting_payment:false:40000,t2-wallet:awaiting_payment:false:42000,'
  || 't3-counter:accepted:true:94000,t3-vietqr:awaiting_payment:false:58000,t3-wallet:awaiting_payment:false:35000',
  'nine orders priced by the server as the customers expected: paying at the counter is accepted with a number at once, an online one waits for its payment'
);
select is(
  (select string_agg(pg_temp.worded(x), ',' order by pg_temp.worded(x)) from jsonb_array_elements(pg_temp.board() -> 'orders') x),
  (select string_agg(pg_temp.expected(a.name), ',' order by pg_temp.expected(a.name)) from asked a where a.payment = 'counter'),
  'before any online payment the counter shows the three counter orders, each at its table with its options, and no order the gateway has not confirmed'
);

-- 3. The gateway confirms the six online payments ------------------------------------------------------------------
select is(
  (select string_agg(app.checkout_settle(
     jsonb_build_object('provider_id', (select p.id from public.payment_providers p where p.brand_id = (select brand_a from fx) and p.method = a.payment and p.store_id is null),
       'provider_ref', 'tx-298-' || a.name, 'amount', a.total, 'success', true)
     || case when a.payment = 'vietqr' then jsonb_build_object('candidates', jsonb_build_array(b.answer -> 'payment' ->> 'reference'))
        else jsonb_build_object('reference', b.answer -> 'payment' ->> 'reference') end,
     pg_temp.at('2026-10-12 10:05')) ->> 'outcome', ',' order by a.name)
   from asked a
   cross join lateral (select app.checkout_begin(jsonb_build_object('user_id', a.customer, 'order_id', a.id, 'method', a.payment,
     'idempotency_key', 'key-298-' || a.name, 'for', 'customer'), pg_temp.at('2026-10-12 10:02')) as answer) b
   where a.payment <> 'counter'),
  'confirmed,confirmed,confirmed,confirmed,confirmed,confirmed', 'each VietQR transfer and wallet payment is confirmed by the gateway'
);
select is(
  (select string_agg(pg_temp.worded(x) || '|' || (x ->> 'status') || ':' || (x ->> 'payment_status'), ',' order by pg_temp.worded(x)) from jsonb_array_elements(pg_temp.board() -> 'orders') x),
  (select string_agg(pg_temp.expected(a.name) || '|accepted:' || case when a.payment = 'counter' then 'unpaid' else 'paid' end, ',' order by pg_temp.expected(a.name)) from asked a),
  'criterion 1: all nine orders are on the counter''s board with the right table, items, sizes, quantities and options; the online ones paid, the counter ones waiting for the cash'
);
select is(
  (select count(*)::int from jsonb_array_elements(pg_temp.board() -> 'orders') x join asked a on a.id = (x ->> 'id')::uuid
   where (x -> 'table' ->> 'id')::uuid = pg_temp.id(a.table_key)),
  9, 'criterion 1: each order is at the table whose QR code its customer scanned'
);
select is((pg_temp.board() -> 'counts' ->> 'unpaid'), '3', 'the board counts the three orders still to be paid at the counter');
select is(
  (select string_agg((t ->> 'label') || '=' || (t ->> 'open_orders'), ',' order by t ->> 'label')
   from jsonb_array_elements(pg_temp.call((select cashier_u from fx), format($q$select app.counter_table_map(%L, %L)$q$, (select store_a1 from fx), pg_temp.at('2026-10-12 10:30'))) -> 'tables') t),
  'Bàn 1=3,Bàn 2=3,Bàn 3=3', 'the table map shows three open orders at each table'
);

-- 4. The counter takes the cash and completes every order ---------------------------------------------------------
select is(
  (select string_agg(pg_temp.call((select cashier_u from fx), format($q$select app.counter_record_payment(%L, 'cash', %s, %s, %L)$q$, a.id, a.total,
     (select o.version from public.orders o where o.id = a.id), pg_temp.at('2026-10-12 10:40'))) ->> 'state', ',' order by a.name)
   from asked a where a.payment = 'counter'),
  'paid,paid,paid', 'the cashier takes the cash of the three counter orders'
);
create function pg_temp.act(p_order uuid, p_action text, p_at timestamptz) returns text language sql as $$
  select pg_temp.call((select cashier_u from fx), format($q$select app.counter_order_act(%L, %L, %s, null, %L)$q$, p_order, p_action,
    (select o.version from public.orders o where o.id = p_order), p_at)) ->> 'state';
$$;
select is(
  (select string_agg(pg_temp.act(a.id, 'start', pg_temp.at('2026-10-12 10:45')) || pg_temp.act(a.id, 'done', pg_temp.at('2026-10-12 10:50'))
     || pg_temp.act(a.id, 'complete', pg_temp.at('2026-10-12 10:55')), ',' order by a.name) from asked a),
  'okokok,okokok,okokok,okokok,okokok,okokok,okokok,okokok,okokok', 'each order is started, served at its table and completed'
);
select is(
  (select string_agg(x ->> 'status' || ':' || (x ->> 'payment_status'), ',') from jsonb_array_elements(pg_temp.board() -> 'orders') x),
  'completed:paid,completed:paid,completed:paid,completed:paid,completed:paid,completed:paid,completed:paid,completed:paid,completed:paid',
  'all nine are completed and paid'
);

-- 5. The sales facts keep the table and the options ----------------------------------------------------------------
select is(
  (select string_agg(i.table_name || '|' || (
     select string_agg(l.item_name || ' x' || l.quantity::int || ' (' || pg_temp.names(array(select m.item_name from public.invoice_lines m where m.invoice_id = i.id
       and m.parent_line_external_id = l.external_id and m.line_kind = 'modifier')) || ')', ';' order by l.external_id)
     from public.invoice_lines l where l.invoice_id = i.id and l.line_kind = 'item') || '|'
     || case i.primary_payment_method_external_id when 'cash' then 'counter' else i.primary_payment_method_external_id end, ',' order by 1)
   from public.invoices i join asked a on i.external_id = 'native-' || a.id),
  (select string_agg(pg_temp.expected(a.name), ',' order by 1) from asked a),
  'criterion 1: each invoice keeps the table, the items with their sizes, the options as modifier lines and the way it was paid'
);
select is(
  (select string_agg(m || '=' || total, ',' order by m) from (
     select p.payment_method_external_id as m, sum(p.amount)::bigint as total from public.invoice_payments p join public.invoices i on i.id = p.invoice_id
     join asked a on i.external_id = 'native-' || a.id group by 1) q),
  'cash=158000,vietqr=145000,zalo_checkout=106000', 'by way of paying: 158,000 in cash, 145,000 by VietQR and 106,000 by the wallet'
);

select * from finish();
rollback;
