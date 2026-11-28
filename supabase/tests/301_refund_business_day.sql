-- Defect D-1 and its rule (ADR-071, acceptance criterion 6): a refund counts on the business day it is handed back. A
-- cash refund counts on the business day of the shift whose drawer paid it out, a card or online refund on the store's
-- business day at the instant it succeeded, never before the order's own day. A refund of the order's own business day
-- edits its invoice, or voids it in full, as before; a refund of a later business day never changes the earlier day and
-- is its own negative document (status refund) of the refund's day. The day's reconciliation subtracts each refund on
-- its own day, and explains the cash of cancelled paid orders (cash_refund_owed, cancelled_cash). Every reader of the
-- sales facts sums a refund document and never counts it as an invoice, a sale or a visit.
-- Store A1 starts its business day at 04:00, so every boundary below is the store's day start, not midnight. Each suite
-- names its technique; the same rows give the oracle each time (the figures added up again straight from the orders'
-- payments and refunds, the drawers and the documents).
begin;
select plan(79);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000030101'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000030102'::uuid as tenant_b,
  'cccccccc-cccc-4ccc-8ccc-000000030101'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000030102'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000030101'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000030102'::uuid as store_a2,
  'ffffffff-ffff-4fff-8fff-000000030103'::uuid as store_b1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000030101'::uuid as brand_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000030102'::uuid as brand_b,
  '99999999-9999-4999-8999-000000030101'::uuid as app_a,
  'eeeeeeee-eeee-4eee-8eee-000000030101'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000030102'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000030103'::uuid as cashier1_u,
  'eeeeeeee-eeee-4eee-8eee-000000030104'::uuid as cashier2_u,
  'eeeeeeee-eeee-4eee-8eee-000000030105'::uuid as viewer_u,
  'eeeeeeee-eeee-4eee-8eee-000000030106'::uuid as manager_a2_u,
  'eeeeeeee-eeee-4eee-8eee-000000030107'::uuid as owner_b_u,
  'eeeeeeee-eeee-4eee-8eee-000000030111'::uuid as cust1_u,
  'eeeeeeee-eeee-4eee-8eee-000000030112'::uuid as cust2_u;
grant select on fx to authenticated;

create temp table ids (name text primary key, id uuid not null);
insert into ids values
  ('cat_a', 'aaaaaaaa-aaaa-4aaa-8aaa-000000030151'),
  ('item_cf', 'aaaaaaaa-aaaa-4aaa-8aaa-000000030101'), ('item_ts', 'aaaaaaaa-aaaa-4aaa-8aaa-000000030102'),
  ('cf', 'bbbbbbbb-bbbb-4bbb-8bbb-000000030111'), ('ts', 'bbbbbbbb-bbbb-4bbb-8bbb-000000030112'),
  ('table_a1', 'aaaaaaaa-aaaa-4aaa-8aaa-000000030141');
grant select on ids to authenticated;
create function pg_temp.id(p_name text) returns uuid language sql stable as $$ select id from ids where name = p_name $$;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'refund-day-301-' || right(u.id::text, 4) || '@example.com',
  case when u.tenant is null then '{}'::jsonb else jsonb_build_object('kind', 'customer', 'tenant_id', u.tenant) end
from fx cross join lateral (values
  (fx.owner_u, null::uuid), (fx.manager_u, null), (fx.cashier1_u, null), (fx.cashier2_u, null), (fx.viewer_u, null),
  (fx.manager_a2_u, null), (fx.owner_b_u, null), (fx.cust1_u, fx.tenant_a), (fx.cust2_u, fx.tenant_a)
) as u (id, tenant);
insert into public.tenants (id, slug, name)
select tenant_a, 'refund-day-301-a', 'Refund day 301 A' from fx union all
select tenant_b, 'refund-day-301-b', 'Refund day 301 B' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'refund-day-301-a', 'Synthetic account A' from fx union all
select account_b, tenant_b, 'mock', 'refund-day-301-b', 'Synthetic account B' from fx;
-- A1 starts its business day at 04:00 (240 minutes); A2 and B1 at midnight.
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name, business_day_start_minutes, opening_hours)
select s.id, s.tenant, s.account, s.ext, s.code, s.name, s.day_start,
  '{"mon": [["00:00", "24:00"]], "tue": [["00:00", "24:00"]], "wed": [["00:00", "24:00"]], "thu": [["00:00", "24:00"]], "fri": [["00:00", "24:00"]], "sat": [["00:00", "24:00"]], "sun": [["00:00", "24:00"]]}'::jsonb
from fx cross join lateral (values
  (fx.store_a1, fx.tenant_a, fx.account_a, 'r301-a1', 'sa-1', 'Synthetic store A1', 240),
  (fx.store_a2, fx.tenant_a, fx.account_a, 'r301-a2', 'sa-2', 'Synthetic store A2', 0),
  (fx.store_b1, fx.tenant_b, fx.account_b, 'r301-b1', 'sb-1', 'Synthetic store B1', 0)
) as s (id, tenant, account, ext, code, name, day_start);
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_a, m.user_id, m.role::public.tenant_role, m.store_ids
from fx cross join lateral (values
  (fx.owner_u, 'owner', null::uuid[]), (fx.manager_u, 'manager', null), (fx.cashier1_u, 'staff', array[fx.store_a1]),
  (fx.cashier2_u, 'staff', array[fx.store_a1]), (fx.viewer_u, 'viewer', null), (fx.manager_a2_u, 'manager', array[fx.store_a2])
) as m (user_id, role, store_ids)
union all
select tenant_b, owner_b_u, 'owner', null from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_a, tenant_a, 'brand-1', 'Synthetic brand A', array[store_a1, store_a2] from fx union all
select brand_b, tenant_b, 'brand-1', 'Synthetic brand B', array[store_b1] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_a, tenant_a, brand_a, 'synthetic-301-zapp-a', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx;
insert into public.mini_apps (tenant_id, brand_id, kind, external_id, browsable, title, header_title_vi, header_title_en,
  header_color_light, header_color_dark, text_color_light, text_color_dark)
select tenant_a, brand_a, 'customer', 'synthetic-301-mini-a', true, 'Cửa hàng mẫu', 'Cửa hàng mẫu', 'Sample store',
  '#ffffff', '#000000', 'black', 'white' from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id)
select tenant_a, app_a, 'syn-zalo-301-1', cust1_u from fx union all
select tenant_a, app_a, 'syn-zalo-301-2', cust2_u from fx;
insert into public.store_ordering_settings (store_id, tenant_id, till_mode, ordering_enabled, order_types, staff_presence_required)
select store_a1, tenant_a, 'native', true, array['table', 'takeaway'], false from fx union all
select store_a2, tenant_a, 'native', true, array['table', 'takeaway'], false from fx union all
select store_b1, tenant_b, 'native', true, array['table', 'takeaway'], false from fx;
insert into public.menu_categories (id, tenant_id, brand_id, name, sort_order)
select pg_temp.id('cat_a'), tenant_a, brand_a, 'Đồ uống', 10 from fx;
insert into public.menu_items (id, tenant_id, brand_id, category_id, name, counts_for_stamps, order_types)
select pg_temp.id('item_cf'), tenant_a, brand_a, pg_temp.id('cat_a'), 'Cà phê', true, array['table', 'takeaway'] from fx union all
select pg_temp.id('item_ts'), tenant_a, brand_a, pg_temp.id('cat_a'), 'Trà sữa', true, array['table', 'takeaway'] from fx;
insert into public.menu_item_sizes (id, tenant_id, brand_id, item_id, label, price, sort_order, is_default)
select pg_temp.id('cf'), tenant_a, brand_a, pg_temp.id('item_cf'), null, 29000, 10, true from fx union all
select pg_temp.id('ts'), tenant_a, brand_a, pg_temp.id('item_ts'), null, 35000, 10, true from fx;
insert into public.store_tables (id, tenant_id, store_id, label, area)
select pg_temp.id('table_a1'), tenant_a, store_a1, 'Bàn 1', 'Tầng 1' from fx;
create temp table tok as
select t.id, app.table_qr_token(t.tenant_id, t.id, t.qr_version) as token from public.store_tables t where t.id = pg_temp.id('table_a1');
create temp table qr as
select s.id as store_id, app.counter_qr_token(s.tenant_id, s.id, 1) as token from public.stores s join fx on s.id = fx.store_a1;

-- Helpers. Every call answers JSON or {"error": SQLSTATE}; the claims are a customer's (with kind and tenant) or a
-- member's, set for one statement. Instants are Vietnam time. Reads taken after a call in the same statement are
-- volatile functions, which see what the call wrote.
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
-- A statement run as the role authenticated with a member's claims, rolled back after: its text answer or the SQLSTATE.
create function pg_temp.as_member(p_user uuid, p_sql text) returns text language plpgsql as $$
declare
  v text;
begin
  begin
    perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    execute p_sql into v;
    raise exception using errcode = 'P0099', message = coalesce(v, 'null');
  exception when others then
    v := case when sqlstate = 'P0099' then sqlerrm else sqlstate end;
  end;
  return v;
end;
$$;
create function pg_temp.at(p_text text) returns timestamptz language sql immutable as $$ select (p_text || '+07')::timestamptz $$;
create function pg_temp.line(p_size text, p_qty integer default 1) returns jsonb language sql stable as $$
  select jsonb_build_object('size', pg_temp.id(p_size), 'qty', p_qty, 'options', '[]'::jsonb);
$$;
-- A table order at Bàn 1 of A1 placed by a customer with one way to pay.
create function pg_temp.place(p_user uuid, p_payment text, p_lines jsonb, p_total integer, p_at timestamptz) returns uuid language sql as $$
  select (pg_temp.call(p_user, format($q$select app.customer_place_order(%L::jsonb, %L)$q$,
    jsonb_build_object('request_id', gen_random_uuid(), 'store', 'sa-1', 'type', 'table', 'table_token', (select token from tok),
      'payment', p_payment, 'lines', p_lines, 'expected_total', p_total), p_at)) -> 'order' ->> 'id')::uuid;
$$;
-- A takeaway order keyed at A1's counter by a staff member.
create function pg_temp.keyed(p_user uuid, p_lines jsonb, p_at timestamptz) returns uuid language sql as $$
  select (pg_temp.call(p_user, format($q$select app.counter_create_order(%L, %L::jsonb, %L)$q$, (select store_a1 from fx),
    jsonb_build_object('request_id', gen_random_uuid(), 'type', 'takeaway', 'lines', p_lines), p_at)) -> 'order' ->> 'id')::uuid;
$$;
-- "Đã thu" in cash or card for the order's total, by the person at an instant.
create function pg_temp.take(p_user uuid, p_order uuid, p_method text, p_at timestamptz) returns text language sql as $$
  select pg_temp.call(p_user, format($q$select app.counter_record_payment(%L, %L, %s, %s, %L)$q$, p_order, p_method,
    (select o.total from public.orders o where o.id = p_order), (select o.version from public.orders o where o.id = p_order), p_at)) ->> 'state';
$$;
-- An online attempt opened for the order's customer and the gateway's verified answer for the order's total.
create function pg_temp.online(p_order uuid, p_ref text, p_at timestamptz) returns text language plpgsql as $$
declare
  v_order public.orders;
  v_reference text;
begin
  select o.* into v_order from public.orders o where o.id = p_order;
  v_reference := app.checkout_begin(jsonb_build_object('user_id', (select l.user_id from app.customer_logins l where l.id = v_order.customer_login_id),
    'order_id', p_order, 'method', v_order.payment_method, 'idempotency_key', 'key-' || regexp_replace(p_ref, '[^A-Za-z0-9_-]', '-', 'g'), 'for', 'customer'), p_at)
    -> 'payment' ->> 'reference';
  return app.checkout_settle(jsonb_build_object('provider_id', (select p.id from public.payment_providers p where p.brand_id = (select brand_a from fx)
      and p.method = v_order.payment_method and p.store_id is null), 'provider_ref', p_ref, 'amount', v_order.total, 'success', true)
    || case when v_order.payment_method = 'vietqr' then jsonb_build_object('candidates', jsonb_build_array(v_reference))
       else jsonb_build_object('reference', v_reference) end, p_at + interval '1 minute') ->> 'outcome';
end;
$$;
create function pg_temp.act(p_user uuid, p_order uuid, p_action text, p_at timestamptz, p_reason text default null) returns text language sql as $$
  select pg_temp.call(p_user, format($q$select app.counter_order_act(%L, %L, %s, %L, %L)$q$, p_order, p_action,
    (select o.version from public.orders o where o.id = p_order), p_reason, p_at)) ->> 'state';
$$;
-- Started, done and completed by the person, a minute apart from the instant.
create function pg_temp.finish(p_user uuid, p_order uuid, p_at timestamptz) returns text language plpgsql as $$
begin
  perform pg_temp.act(p_user, p_order, 'start', p_at);
  perform pg_temp.act(p_user, p_order, 'done', p_at + interval '1 minute');
  perform pg_temp.act(p_user, p_order, 'complete', p_at + interval '2 minutes');
  return (select status::text || '/' || payment_status::text from public.orders where id = p_order);
end;
$$;
create function pg_temp.clock_in(p_user uuid, p_opening numeric, p_at timestamptz) returns text language sql as $$
  select pg_temp.call(p_user, format($q$select app.staff_clock_in(%L, %L, %s, %L)$q$, (select store_a1 from fx), (select token from qr), p_opening, p_at)) ->> 'state';
$$;
create function pg_temp.clock_out(p_user uuid, p_counted numeric, p_at timestamptz) returns text language sql as $$
  select pg_temp.call(p_user, format($q$select app.staff_clock_out(%s, %L)$q$, p_counted, p_at)) ->> 'state';
$$;
create function pg_temp.refund(p_user uuid, p_order uuid, p_amount numeric, p_at timestamptz) returns text language sql as $$
  select pg_temp.call(p_user, format($q$select app.counter_refund(%L, %s, 'khách trả lại', %L)$q$, p_order, p_amount, p_at)) ->> 'state';
$$;
-- The gateway confirms the order's pending refund.
create function pg_temp.confirm(p_order uuid, p_ref text, p_at timestamptz) returns text language sql as $$
  select app.checkout_refund_confirm((select r.id from public.order_refunds r where r.order_id = p_order and r.status = 'pending'), true, p_ref, null, p_at) ->> 'state';
$$;
-- The documents of an order in the sales facts: business date:status:net:method=amount of each payment, by day.
create function pg_temp.facts(p_order uuid) returns text language sql volatile as $$
  select coalesce(string_agg(i.business_date || ':' || i.status || ':' || i.net_amount::bigint || coalesce(':' || p.methods, ''), ','
    order by i.business_date, i.sold_at, i.external_id collate "C"), '')
  from public.invoices i
  left join lateral (
    select string_agg(x.payment_method_external_id || '=' || x.amount::bigint, '+' order by x.sequence_no) as methods
    from public.invoice_payments x where x.invoice_id = i.id
  ) p on true
  where i.store_id = (select store_a1 from fx) and (i.external_id = 'native-' || p_order or i.external_id like 'native-' || p_order || '-refund-%');
$$;
create function pg_temp.day_of(p_order uuid) returns text language sql volatile as $$
  select string_agg(app.refund_business_date(r)::text, '/' order by r.settled_at, r.id) from public.order_refunds r where r.order_id = p_order and r.status = 'succeeded';
$$;
create function pg_temp.recon(p_user uuid, p_date date) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.manager_day_reconciliation(%L, %L)$q$, (select store_a1 from fx), p_date));
$$;
-- revenue/online/card/counted/difference/open/awaiting/matched of a day at A1, as the owner reads it.
create function pg_temp.day(p_date date) returns text language sql as $$
  select (r ->> 'revenue') || '/' || (r ->> 'online_confirmed') || '/' || (r ->> 'card') || '/' || (r -> 'cash' ->> 'counted') || '/'
    || (r ->> 'difference') || '/' || (r ->> 'shifts_open') || '/' || (r ->> 'shifts_awaiting_confirmation') || '/' || (r ->> 'matched')
  from pg_temp.recon((select owner_u from fx), p_date) r;
$$;
-- The oracle of a day: the same four figures added up straight from the rows, as a person reading the gateway's
-- statement, the card slips and the drawers would, each refund on the day it was handed back.
create function pg_temp.oracle(p_date date) returns text language sql stable as $$
  select (
      (select coalesce(sum(p.amount), 0) from public.order_payments p join public.orders o on o.id = p.order_id
       where o.store_id = (select store_a1 from fx) and o.business_date = p_date and o.status = 'completed' and p.status = 'succeeded')
      - (select coalesce(sum(r.amount), 0) from public.order_refunds r join public.orders o on o.id = r.order_id
         where o.store_id = (select store_a1 from fx) and o.status = 'completed' and r.status = 'succeeded' and app.refund_business_date(r) = p_date))::bigint
    || '/' || (
      (select coalesce(sum(p.amount), 0) from public.order_payments p join public.orders o on o.id = p.order_id
       where o.store_id = (select store_a1 from fx) and o.business_date = p_date and o.status = 'completed' and p.method in ('vietqr', 'zalo_checkout')
         and p.status = 'succeeded' and p.provider_ref is not null)
      - (select coalesce(sum(r.amount), 0) from public.order_refunds r join public.orders o on o.id = r.order_id
         where o.store_id = (select store_a1 from fx) and o.status = 'completed' and r.method in ('vietqr', 'zalo_checkout') and r.status = 'succeeded'
           and r.provider_ref is not null and app.refund_business_date(r) = p_date))::bigint
    || '/' || (
      (select coalesce(sum(p.amount), 0) from public.order_payments p join public.orders o on o.id = p.order_id
       where o.store_id = (select store_a1 from fx) and o.business_date = p_date and o.status = 'completed' and p.method = 'card' and p.status = 'succeeded')
      - (select coalesce(sum(r.amount), 0) from public.order_refunds r join public.orders o on o.id = r.order_id
         where o.store_id = (select store_a1 from fx) and o.status = 'completed' and r.method = 'card' and r.status = 'succeeded'
           and app.refund_business_date(r) = p_date))::bigint
    || '/' || (select coalesce(sum(s.counted_cash - s.opening_cash), 0)::bigint from public.staff_shifts s
      where s.store_id = (select store_a1 from fx) and s.business_date = p_date and s.status <> 'open');
$$;
create function pg_temp.mine(p_date date) returns text language sql as $$
  select (r ->> 'revenue') || '/' || (r ->> 'online_confirmed') || '/' || (r ->> 'card') || '/' || (r -> 'cash' ->> 'counted')
  from pg_temp.recon((select owner_u from fx), p_date) r;
$$;
create function pg_temp.pay_status(p_order uuid) returns text language sql volatile as $$
  select payment_status::text from public.orders where id = p_order;
$$;
create function pg_temp.open_days() returns text language sql volatile as $$
  select string_agg(s.business_date::text, ',' order by s.clock_in_at) from public.staff_shifts s where s.store_id = (select store_a1 from fx) and s.status = 'open';
$$;
create temp table o (name text primary key, id uuid);
grant select on o to authenticated;
create function pg_temp.o(p_name text) returns uuid language sql stable as $$ select id from o where name = p_name $$;

-- 0. The store's gateways: VietQR and the Zalo wallet in sandbox ---------------------------------------------------
select is(
  pg_temp.call((select owner_u from fx), format($q$select app.checkout_set_provider(%L::jsonb, %L)$q$,
    jsonb_build_object('brand', (select brand_a from fx), 'method', 'vietqr', 'adapter', 'mock', 'mode', 'sandbox', 'secret_name', 'PAYMENT_BANK_BRAND_1',
      'settings', jsonb_build_object('bank_bin', '970400', 'bank_name', 'Ngân hàng mẫu', 'account_number', '0123456789', 'account_name', 'CUA HANG MAU',
        'reference_prefix', 'FNB')), pg_temp.at('2026-08-31 08:00'))) ->> 'state'
  || '/' || (pg_temp.call((select owner_u from fx), format($q$select app.checkout_set_provider(%L::jsonb, %L)$q$,
    jsonb_build_object('brand', (select brand_a from fx), 'method', 'zalo_checkout', 'mode', 'sandbox', 'secret_name', 'ZALO_CHECKOUT_KEY_BRAND_1',
      'settings', jsonb_build_object('wallet_method', 'ZALOPAY')), pg_temp.at('2026-08-31 08:00'))) ->> 'state'),
  'saved/saved', 'the owner switches VietQR and the Zalo wallet on in the gateway''s sandbox'
);

-- 1. Boundary values at the store's day start (04:00) --------------------------------------------------------------
-- Technique: boundary value analysis (three values: one second before the day start, the start itself, one second
-- after) for a card refund, which counts on the store's business day at the instant; and for cash, whose day is the
-- drawer's, the two values around the start applied to the clock-in of the drawer that hands the cash back.
select is(pg_temp.clock_in((select cashier1_u from fx), 0, pg_temp.at('2026-09-01 08:00')), 'clocked_in', 'cashier 1 opens 2026-09-01');
insert into o values ('b1', pg_temp.keyed((select cashier1_u from fx), jsonb_build_array(pg_temp.line('cf')), pg_temp.at('2026-09-01 09:00')));
insert into o values ('b2', pg_temp.keyed((select cashier1_u from fx), jsonb_build_array(pg_temp.line('cf')), pg_temp.at('2026-09-01 09:10')));
insert into o values ('b3', pg_temp.keyed((select cashier1_u from fx), jsonb_build_array(pg_temp.line('cf')), pg_temp.at('2026-09-01 09:20')));
select is(
  pg_temp.take((select cashier1_u from fx), pg_temp.o('b1'), 'card', pg_temp.at('2026-09-01 09:01')) || '/'
  || pg_temp.take((select cashier1_u from fx), pg_temp.o('b2'), 'card', pg_temp.at('2026-09-01 09:11')) || '/'
  || pg_temp.take((select cashier1_u from fx), pg_temp.o('b3'), 'card', pg_temp.at('2026-09-01 09:21')) || '/'
  || pg_temp.finish((select cashier1_u from fx), pg_temp.o('b1'), pg_temp.at('2026-09-01 09:30')) || '/'
  || pg_temp.finish((select cashier1_u from fx), pg_temp.o('b2'), pg_temp.at('2026-09-01 09:30')) || '/'
  || pg_temp.finish((select cashier1_u from fx), pg_temp.o('b3'), pg_temp.at('2026-09-01 09:30')) || '/'
  || pg_temp.clock_out((select cashier1_u from fx), 0, pg_temp.at('2026-09-01 12:00')),
  'paid/paid/paid/completed/paid/completed/paid/completed/paid/closed', 'three coffees paid by card (29,000 each) and completed on 2026-09-01'
);
select is(
  pg_temp.refund((select manager_u from fx), pg_temp.o('b1'), 29000, pg_temp.at('2026-09-02 03:59:59')) || '/'
  || pg_temp.refund((select manager_u from fx), pg_temp.o('b2'), 29000, pg_temp.at('2026-09-02 04:00:00')) || '/'
  || pg_temp.refund((select manager_u from fx), pg_temp.o('b3'), 29000, pg_temp.at('2026-09-02 04:00:01')),
  'succeeded/succeeded/succeeded', 'a manager hands each back on the card terminal: at 03:59:59, 04:00:00 and 04:00:01 the next morning'
);
select is(pg_temp.day_of(pg_temp.o('b1')) || ',' || pg_temp.day_of(pg_temp.o('b2')) || ',' || pg_temp.day_of(pg_temp.o('b3')),
  '2026-09-01,2026-09-02,2026-09-02', 'boundary: one second before the day start is still the order''s day; the start and one second after are the next day');
select is(pg_temp.facts(pg_temp.o('b1')), '2026-09-01:voided:29000', 'one second before the start: a refund of the same day voids the invoice, as before');
select is(pg_temp.facts(pg_temp.o('b2')), '2026-09-01:completed:29000:card=29000,2026-09-02:refund:-29000:card=-29000',
  'at the start: the invoice keeps its amount and status, and the refund is its own negative card document of 2026-09-02');
select is(pg_temp.facts(pg_temp.o('b3')), '2026-09-01:completed:29000:card=29000,2026-09-02:refund:-29000:card=-29000',
  'one second after the start: the same');
select is(pg_temp.day(date '2026-09-01') || ' ' || pg_temp.day(date '2026-09-02'),
  '58000/0/58000/0/0/0/0/true -58000/0/-58000/0/0/0/0/true', 'criterion 6: both days match, the refunds of the second day on the second day');

select is(pg_temp.clock_in((select cashier1_u from fx), 100000, pg_temp.at('2026-09-05 08:00')), 'clocked_in', 'cashier 1 opens 2026-09-05 with 100,000');
insert into o values ('c1', pg_temp.keyed((select cashier1_u from fx), jsonb_build_array(pg_temp.line('cf')), pg_temp.at('2026-09-05 09:00')));
insert into o values ('c2', pg_temp.keyed((select cashier1_u from fx), jsonb_build_array(pg_temp.line('cf')), pg_temp.at('2026-09-05 09:05')));
select is(
  pg_temp.take((select cashier1_u from fx), pg_temp.o('c1'), 'cash', pg_temp.at('2026-09-05 09:01')) || '/'
  || pg_temp.take((select cashier1_u from fx), pg_temp.o('c2'), 'cash', pg_temp.at('2026-09-05 09:06')) || '/'
  || pg_temp.finish((select cashier1_u from fx), pg_temp.o('c1'), pg_temp.at('2026-09-05 09:10')) || '/'
  || pg_temp.finish((select cashier1_u from fx), pg_temp.o('c2'), pg_temp.at('2026-09-05 09:15')) || '/'
  || pg_temp.clock_out((select cashier1_u from fx), 158000, pg_temp.at('2026-09-05 12:00')),
  'paid/paid/completed/paid/completed/paid/closed', 'two coffees paid in cash; the drawer of 158,000 matches'
);
select is(
  pg_temp.clock_in((select owner_u from fx), 100000, pg_temp.at('2026-09-06 03:59:59')) || '/'
  || pg_temp.clock_in((select manager_u from fx), 100000, pg_temp.at('2026-09-06 04:00:00')) || '/'
  || pg_temp.open_days(),
  'clocked_in/clocked_in/2026-09-05,2026-09-06', 'the owner''s drawer opens one second before the day start (2026-09-05), the manager''s at the start (2026-09-06)'
);
select is(
  pg_temp.refund((select owner_u from fx), pg_temp.o('c1'), 29000, pg_temp.at('2026-09-06 04:30')) || '/'
  || pg_temp.refund((select manager_u from fx), pg_temp.o('c2'), 29000, pg_temp.at('2026-09-06 04:30')) || '/'
  || pg_temp.day_of(pg_temp.o('c1')) || '/' || pg_temp.day_of(pg_temp.o('c2')),
  'succeeded/succeeded/2026-09-05/2026-09-06', 'at the same instant, cash counts on the day of the drawer that paid it out, not the instant''s day'
);
select is(pg_temp.facts(pg_temp.o('c1')) || ' | ' || pg_temp.facts(pg_temp.o('c2')),
  '2026-09-05:voided:29000 | 2026-09-05:completed:29000:cash=29000,2026-09-06:refund:-29000:cash=-29000',
  'the owner''s drawer of 2026-09-05 voids its order; the manager''s of 2026-09-06 writes a cash refund document of that day');
select is(
  pg_temp.clock_out((select owner_u from fx), 71000, pg_temp.at('2026-09-06 05:00')) || '/' || pg_temp.clock_out((select manager_u from fx), 71000, pg_temp.at('2026-09-06 05:00'))
  || ' ' || pg_temp.day(date '2026-09-05') || ' ' || pg_temp.day(date '2026-09-06'),
  'closed/closed 29000/0/0/29000/0/0/0/true -29000/0/0/-29000/0/0/0/true', 'criterion 6: each drawer closes and both days match'
);

-- 2. Same day against a later day, for cash, card and online ------------------------------------------------------
-- Technique: decision table (the refund's method: cash, card, VietQR or the Zalo wallet x its day: the order's or a
-- later one -> the order's invoice edited, or a refund document of the later day, and the day each figure lands on),
-- with equivalence partitions of the ways to pay.
select is(pg_temp.clock_in((select cashier1_u from fx), 0, pg_temp.at('2026-09-08 08:00')), 'clocked_in', 'cashier 1 opens 2026-09-08');
insert into o values ('s_cash', pg_temp.keyed((select cashier1_u from fx), jsonb_build_array(pg_temp.line('ts'), pg_temp.line('cf')), pg_temp.at('2026-09-08 09:00')));
insert into o values ('s_card', pg_temp.keyed((select cashier1_u from fx), jsonb_build_array(pg_temp.line('ts'), pg_temp.line('cf')), pg_temp.at('2026-09-08 09:05')));
insert into o values ('s_online', pg_temp.place((select cust1_u from fx), 'vietqr', jsonb_build_array(pg_temp.line('ts'), pg_temp.line('cf')), 64000, pg_temp.at('2026-09-08 09:10')));
insert into o values ('l_cash', pg_temp.keyed((select cashier1_u from fx), jsonb_build_array(pg_temp.line('ts'), pg_temp.line('cf')), pg_temp.at('2026-09-08 09:30')));
insert into o values ('l_card', pg_temp.keyed((select cashier1_u from fx), jsonb_build_array(pg_temp.line('ts'), pg_temp.line('cf')), pg_temp.at('2026-09-08 09:35')));
insert into o values ('l_online', pg_temp.place((select cust2_u from fx), 'zalo_checkout', jsonb_build_array(pg_temp.line('ts'), pg_temp.line('cf')), 64000, pg_temp.at('2026-09-08 09:40')));
select is(
  pg_temp.take((select cashier1_u from fx), pg_temp.o('s_cash'), 'cash', pg_temp.at('2026-09-08 09:01')) || '/'
  || pg_temp.take((select cashier1_u from fx), pg_temp.o('s_card'), 'card', pg_temp.at('2026-09-08 09:06')) || '/'
  || pg_temp.online(pg_temp.o('s_online'), 'mock:tx-301-1', pg_temp.at('2026-09-08 09:11')) || '/'
  || pg_temp.take((select cashier1_u from fx), pg_temp.o('l_cash'), 'cash', pg_temp.at('2026-09-08 09:31')) || '/'
  || pg_temp.take((select cashier1_u from fx), pg_temp.o('l_card'), 'card', pg_temp.at('2026-09-08 09:36')) || '/'
  || pg_temp.online(pg_temp.o('l_online'), 'ztx-301-1', pg_temp.at('2026-09-08 09:41')),
  'paid/paid/confirmed/paid/paid/confirmed', 'six orders of 64,000: two in cash, two by card, one by VietQR and one by the wallet'
);
select is(
  (select string_agg(pg_temp.finish((select cashier1_u from fx), o.id, pg_temp.at('2026-09-08 10:00')), ',' order by o.name) from o where o.name in ('s_cash', 's_card', 's_online', 'l_cash', 'l_card', 'l_online')),
  'completed/paid,completed/paid,completed/paid,completed/paid,completed/paid,completed/paid', 'all six are served and completed'
);
select is(
  pg_temp.clock_in((select manager_u from fx), 100000, pg_temp.at('2026-09-08 13:00')) || '/'
  || pg_temp.refund((select manager_u from fx), pg_temp.o('s_cash'), 29000, pg_temp.at('2026-09-08 14:00')) || '/'
  || pg_temp.refund((select manager_u from fx), pg_temp.o('s_card'), 29000, pg_temp.at('2026-09-08 14:05')) || '/'
  || pg_temp.refund((select manager_u from fx), pg_temp.o('s_online'), 29000, pg_temp.at('2026-09-08 14:10')) || '/'
  || pg_temp.confirm(pg_temp.o('s_online'), 'mock:rf-301-1', pg_temp.at('2026-09-08 14:15')),
  'clocked_in/succeeded/succeeded/pending/succeeded', 'the same day, a manager on shift refunds 29,000 of the s orders in cash, by card and by VietQR (the gateway confirms)'
);
select is(
  pg_temp.facts(pg_temp.o('s_cash')) || ' | ' || pg_temp.facts(pg_temp.o('s_card')) || ' | ' || pg_temp.facts(pg_temp.o('s_online')),
  '2026-09-08:edited:35000:cash=35000 | 2026-09-08:edited:35000:card=35000 | 2026-09-08:edited:35000:vietqr=35000',
  'decision table, same day: each invoice is edited to 35,000 in its own method, and no refund document is written'
);
select is(
  (select count(*)::int from public.invoice_events e where e.store_id = (select store_a1 from fx) and e.source = 'native_refund' and e.kind = 'edited'
     and e.invoice_external_id in ('native-' || pg_temp.o('s_cash'), 'native-' || pg_temp.o('s_card'), 'native-' || pg_temp.o('s_online'))),
  3, 'each same-day refund is an invoice event, as before'
);
select is(
  pg_temp.clock_out((select manager_u from fx), 71000, pg_temp.at('2026-09-08 20:00')) || '/' || pg_temp.clock_out((select cashier1_u from fx), 128000, pg_temp.at('2026-09-08 20:00'))
  || ' ' || pg_temp.day(date '2026-09-08'),
  'closed/closed 297000/99000/99000/99000/0/0/0/true', 'criterion 6: 2026-09-08 matches: 297,000 = 99,000 online + 99,000 card + 99,000 counted'
);
select is(
  pg_temp.clock_in((select manager_u from fx), 100000, pg_temp.at('2026-09-09 08:00')) || '/'
  || pg_temp.refund((select manager_u from fx), pg_temp.o('l_cash'), 29000, pg_temp.at('2026-09-09 09:00')) || '/'
  || pg_temp.refund((select manager_u from fx), pg_temp.o('l_card'), 29000, pg_temp.at('2026-09-09 09:05')) || '/'
  || pg_temp.refund((select manager_u from fx), pg_temp.o('l_online'), 29000, pg_temp.at('2026-09-09 09:10')) || '/'
  || pg_temp.confirm(pg_temp.o('l_online'), 'zrf-301-1', pg_temp.at('2026-09-09 09:15')) || '/'
  || pg_temp.clock_out((select manager_u from fx), 71000, pg_temp.at('2026-09-09 12:00')),
  'clocked_in/succeeded/succeeded/pending/succeeded/closed', 'the next day the l orders get 29,000 back in cash, by card and by the wallet, and the drawer matches'
);
select is(
  pg_temp.facts(pg_temp.o('l_cash')) || ' | ' || pg_temp.facts(pg_temp.o('l_card')) || ' | ' || pg_temp.facts(pg_temp.o('l_online')),
  '2026-09-08:completed:64000:cash=64000,2026-09-09:refund:-29000:cash=-29000 | 2026-09-08:completed:64000:card=64000,2026-09-09:refund:-29000:card=-29000 | '
  || '2026-09-08:completed:64000:zalo_checkout=64000,2026-09-09:refund:-29000:zalo_checkout=-29000',
  'decision table, later day: the invoices keep 64,000 and each refund is a negative document of 2026-09-09 in its method'
);
select is(
  (select count(*)::int from public.invoices i where i.store_id = (select store_a1 from fx) and i.external_id in ('native-' || pg_temp.o('l_cash'), 'native-' || pg_temp.o('l_card'), 'native-' || pg_temp.o('l_online'))
     and i.status = 'completed' and i.synced_at = pg_temp.at('2026-09-08 10:02'))
  || '/' || (select count(*) from public.invoice_events e where e.invoice_external_id like 'native-' || pg_temp.o('l_cash') || '%'
     or e.invoice_external_id like 'native-' || pg_temp.o('l_card') || '%' or e.invoice_external_id like 'native-' || pg_temp.o('l_online') || '%'),
  '3/0', 'a later day never changes the earlier one: the three invoices were not written again (last written at completion) and no event touches them'
);
select is(pg_temp.day(date '2026-09-08') || ' ' || pg_temp.day(date '2026-09-09'),
  '297000/99000/99000/99000/0/0/0/true -87000/-29000/-29000/-29000/0/0/0/true',
  'criterion 6: 2026-09-08 still matches, and 2026-09-09 matches with each refund on its own day: the gateway''s, the card''s and the drawer''s');
select is(pg_temp.mine(date '2026-09-08') || ' ' || pg_temp.mine(date '2026-09-09'), pg_temp.oracle(date '2026-09-08') || ' ' || pg_temp.oracle(date '2026-09-09'),
  'criterion 6: each figure equals the one added up straight from the payments, the refunds by the day they were handed back and the closed drawers');
select is((pg_temp.recon((select owner_u from fx), date '2026-09-09') -> 'by_method'), '{"card": -29000, "cash": -29000, "zalo_checkout": -29000}'::jsonb,
  'by method, 2026-09-09 holds the three refunds in their own methods');

-- 3. Partial, then full, over two days ---------------------------------------------------------------------------
-- Technique: state transition testing of the order's invoice (completed -> edited by a same-day refund -> unchanged,
-- with a refund document, by the later-day rest) and of the order's payment status (paid -> partially_refunded ->
-- refunded), with the invalid transition after it (a refund of a refunded order is refused).
insert into o values ('p', pg_temp.keyed((select cashier1_u from fx), jsonb_build_array(pg_temp.line('ts'), pg_temp.line('cf')), pg_temp.at('2026-09-11 09:00')));
select is(
  pg_temp.clock_in((select cashier1_u from fx), 0, pg_temp.at('2026-09-11 08:00')) || '/'
  || pg_temp.take((select cashier1_u from fx), pg_temp.o('p'), 'card', pg_temp.at('2026-09-11 09:01')) || '/'
  || pg_temp.finish((select cashier1_u from fx), pg_temp.o('p'), pg_temp.at('2026-09-11 09:05')) || '/'
  || pg_temp.clock_out((select cashier1_u from fx), 0, pg_temp.at('2026-09-11 12:00')),
  'clocked_in/paid/completed/paid/closed', 'an order of 64,000 paid by card on 2026-09-11'
);
select is(
  pg_temp.refund((select manager_u from fx), pg_temp.o('p'), 29000, pg_temp.at('2026-09-11 15:00')) || '/' || pg_temp.facts(pg_temp.o('p'))
  || '/' || pg_temp.pay_status(pg_temp.o('p')),
  'succeeded/2026-09-11:edited:35000:card=35000/partially_refunded', 'state transition: a partial refund the same day edits the invoice to 35,000'
);
select is(
  pg_temp.refund((select manager_u from fx), pg_temp.o('p'), 35000, pg_temp.at('2026-09-12 10:00')) || '/' || pg_temp.facts(pg_temp.o('p'))
  || '/' || pg_temp.pay_status(pg_temp.o('p')),
  'succeeded/2026-09-11:edited:35000:card=35000,2026-09-12:refund:-35000:card=-35000/refunded',
  'state transition: the rest the next day is a document of 2026-09-12; the invoice stays edited (never voided by a later day) and the order is refunded'
);
select is(pg_temp.refund((select manager_u from fx), pg_temp.o('p'), 1000, pg_temp.at('2026-09-12 11:00')), 'refused', 'invalid transition: nothing is left to refund');
select is(
  pg_temp.day(date '2026-09-11') || ' ' || pg_temp.day(date '2026-09-12') || ' '
  || (select sum(i.net_amount)::bigint from public.invoices i where i.store_id = (select store_a1 from fx) and i.status <> 'voided' and i.external_id like 'native-' || pg_temp.o('p') || '%'),
  '35000/0/35000/0/0/0/0/true -35000/0/-35000/0/0/0/0/true 0', 'criterion 6: both days match, and over both days the order holds nothing'
);

-- 4. Several refunds over three days -----------------------------------------------------------------------------
-- Technique: equivalence partitions of the number of later days (one, two) and of refunds on one day (one, two), with
-- the three days' reconciliation as the oracle.
insert into o values ('m', pg_temp.keyed((select cashier1_u from fx), jsonb_build_array(pg_temp.line('ts', 3)), pg_temp.at('2026-09-14 09:00')));
select is(
  pg_temp.clock_in((select cashier1_u from fx), 0, pg_temp.at('2026-09-14 08:00')) || '/'
  || pg_temp.take((select cashier1_u from fx), pg_temp.o('m'), 'cash', pg_temp.at('2026-09-14 09:01')) || '/'
  || pg_temp.finish((select cashier1_u from fx), pg_temp.o('m'), pg_temp.at('2026-09-14 09:05')) || '/'
  || pg_temp.clock_out((select cashier1_u from fx), 105000, pg_temp.at('2026-09-14 12:00')),
  'clocked_in/paid/completed/paid/closed', 'three milk teas (105,000) paid in cash on 2026-09-14'
);
select is(
  pg_temp.clock_in((select manager_u from fx), 100000, pg_temp.at('2026-09-15 08:00')) || '/'
  || pg_temp.refund((select manager_u from fx), pg_temp.o('m'), 35000, pg_temp.at('2026-09-15 09:00')) || '/'
  || pg_temp.clock_out((select manager_u from fx), 65000, pg_temp.at('2026-09-15 12:00')) || '/'
  || pg_temp.clock_in((select manager_u from fx), 100000, pg_temp.at('2026-09-16 08:00')) || '/'
  || pg_temp.refund((select manager_u from fx), pg_temp.o('m'), 35000, pg_temp.at('2026-09-16 09:00')) || '/'
  || pg_temp.refund((select manager_u from fx), pg_temp.o('m'), 35000, pg_temp.at('2026-09-16 10:00')) || '/'
  || pg_temp.clock_out((select manager_u from fx), 30000, pg_temp.at('2026-09-16 12:00')),
  'clocked_in/succeeded/closed/clocked_in/succeeded/succeeded/closed', 'one tea handed back in cash on 2026-09-15, two on 2026-09-16, each drawer matching'
);
select is(pg_temp.facts(pg_temp.o('m')),
  '2026-09-14:completed:105000:cash=105000,2026-09-15:refund:-35000:cash=-35000,2026-09-16:refund:-35000:cash=-35000,2026-09-16:refund:-35000:cash=-35000',
  'the invoice keeps 105,000 and each refund is its own document of its day, two on 2026-09-16');
select is(
  pg_temp.day(date '2026-09-14') || ' ' || pg_temp.day(date '2026-09-15') || ' ' || pg_temp.day(date '2026-09-16')
  || ' ' || pg_temp.pay_status(pg_temp.o('m')),
  '105000/0/0/105000/0/0/0/true -35000/0/0/-35000/0/0/0/true -70000/0/0/-70000/0/0/0/true refunded', 'criterion 6: the three days match'
);
select is(
  (select string_agg(m.business_date::text, ',' order by m.business_date) from app.native_analytics_pending m
   where m.tenant_id = (select tenant_a from fx) and m.business_date between '2026-09-14' and '2026-09-16'),
  '2026-09-14,2026-09-15,2026-09-16', 'the order''s day and each refund day are marked for the analytics refresh'
);

-- 5. An order completed just before the day start ----------------------------------------------------------------
-- Technique: error guessing at the boundary: a night shift sells and completes at 03:55 (the business day of
-- 2026-09-18); just after the day start the cash goes back from the night drawer (its day: the order's, so the invoice
-- is voided) while a card refund at the same instant counts on 2026-09-19.
select is(
  pg_temp.clock_in((select cashier1_u from fx), 0, pg_temp.at('2026-09-18 22:00')) || '/' || pg_temp.clock_in((select manager_u from fx), 50000, pg_temp.at('2026-09-18 22:00')),
  'clocked_in/clocked_in', 'a cashier and a manager open the night of 2026-09-18'
);
insert into o values ('n1', pg_temp.keyed((select cashier1_u from fx), jsonb_build_array(pg_temp.line('cf')), pg_temp.at('2026-09-19 03:50')));
insert into o values ('n2', pg_temp.keyed((select cashier1_u from fx), jsonb_build_array(pg_temp.line('cf')), pg_temp.at('2026-09-19 03:51')));
select is(
  pg_temp.take((select cashier1_u from fx), pg_temp.o('n1'), 'cash', pg_temp.at('2026-09-19 03:52')) || '/'
  || pg_temp.take((select cashier1_u from fx), pg_temp.o('n2'), 'card', pg_temp.at('2026-09-19 03:52')) || '/'
  || pg_temp.finish((select cashier1_u from fx), pg_temp.o('n1'), pg_temp.at('2026-09-19 03:53')) || '/'
  || pg_temp.finish((select cashier1_u from fx), pg_temp.o('n2'), pg_temp.at('2026-09-19 03:55')) || '/'
  || (select string_agg(o2.business_date::text, ',' order by o2.placed_at) from public.orders o2 where o2.id in (pg_temp.o('n1'), pg_temp.o('n2'))),
  'paid/paid/completed/paid/completed/paid/2026-09-18,2026-09-18', 'two coffees, cash and card, completed at 03:55 and 03:57: both of 2026-09-18'
);
select is(
  pg_temp.refund((select manager_u from fx), pg_temp.o('n1'), 29000, pg_temp.at('2026-09-19 04:00:30')) || '/'
  || pg_temp.refund((select manager_u from fx), pg_temp.o('n2'), 29000, pg_temp.at('2026-09-19 04:00:30')) || '/'
  || pg_temp.facts(pg_temp.o('n1')) || '/' || pg_temp.facts(pg_temp.o('n2')),
  'succeeded/succeeded/2026-09-18:voided:29000/2026-09-18:completed:29000:card=29000,2026-09-19:refund:-29000:card=-29000',
  'at 04:00:30 the night drawer''s cash voids its order (same day); the card refund is a document of 2026-09-19'
);
select is(
  pg_temp.clock_out((select cashier1_u from fx), 29000, pg_temp.at('2026-09-19 05:00')) || '/' || pg_temp.clock_out((select manager_u from fx), 21000, pg_temp.at('2026-09-19 05:00'))
  || ' ' || pg_temp.day(date '2026-09-18') || ' ' || pg_temp.day(date '2026-09-19'),
  'closed/closed 29000/0/29000/0/0/0/0/true -29000/0/-29000/0/0/0/0/true', 'criterion 6: the night and the next day both match'
);

-- 6. The writers and the hook run again; a refund of an order not completed -----------------------------------------
-- Technique: error guessing: the document writers and the refund hook run a second time (idempotency: nothing new is
-- written, no event is logged), and a refund settled while an order is still being made, on a later business day than
-- its placing, which writes nothing in the sales facts (the counter cannot complete an order with money handed back).
select is(pg_temp.clock_in((select cashier1_u from fx), 0, pg_temp.at('2026-09-21 22:00')), 'clocked_in', 'cashier 1 opens the night of 2026-09-21');
insert into o values ('e1', pg_temp.keyed((select cashier1_u from fx), jsonb_build_array(pg_temp.line('ts'), pg_temp.line('cf')), pg_temp.at('2026-09-22 03:30')));
insert into o values ('e2', pg_temp.keyed((select cashier1_u from fx), jsonb_build_array(pg_temp.line('ts'), pg_temp.line('cf')), pg_temp.at('2026-09-22 03:40')));
select is(
  pg_temp.take((select cashier1_u from fx), pg_temp.o('e1'), 'card', pg_temp.at('2026-09-22 03:31')) || '/'
  || pg_temp.finish((select cashier1_u from fx), pg_temp.o('e1'), pg_temp.at('2026-09-22 03:32')) || '/'
  || pg_temp.refund((select manager_u from fx), pg_temp.o('e1'), 29000, pg_temp.at('2026-09-22 04:10')) || '/' || pg_temp.facts(pg_temp.o('e1')),
  'paid/completed/paid/succeeded/2026-09-21:completed:64000:card=64000,2026-09-22:refund:-29000:card=-29000',
  'an order of 2026-09-21 completed at 03:34 gets 29,000 back by card at 04:10: a document of 2026-09-22'
);
select is(
  (select app.native_refund_documents(pg_temp.o('e1'), pg_temp.at('2026-09-22 05:00')) || '/' || (app.native_order_invoice(pg_temp.o('e1'), pg_temp.at('2026-09-22 05:00')) is not null)::text)
  || '/' || pg_temp.facts(pg_temp.o('e1')),
  '0/true/2026-09-21:completed:64000:card=64000,2026-09-22:refund:-29000:card=-29000', 'idempotent: the writers run again write nothing new'
);
select is(
  (select count(*)::int from (select app.order_after_refund(x, pg_temp.at('2026-09-22 05:00')) from public.orders x where x.id = pg_temp.o('e1')) y)
  || '/' || pg_temp.facts(pg_temp.o('e1'))
  || '/' || (select count(*) from public.invoice_events e where e.invoice_external_id like 'native-' || pg_temp.o('e1') || '%'),
  '1/2026-09-21:completed:64000:card=64000,2026-09-22:refund:-29000:card=-29000/0', 'the refund hook run again changes nothing and logs no event'
);
select is(
  pg_temp.take((select cashier1_u from fx), pg_temp.o('e2'), 'card', pg_temp.at('2026-09-22 03:41')) || '/'
  || pg_temp.refund((select manager_u from fx), pg_temp.o('e2'), 29000, pg_temp.at('2026-09-22 04:15')) || '/'
  || coalesce(nullif(pg_temp.facts(pg_temp.o('e2')), ''), 'none') || '/' || pg_temp.act((select cashier1_u from fx), pg_temp.o('e2'), 'start', pg_temp.at('2026-09-22 04:20')),
  'paid/succeeded/none/refused', 'a refund of an order still being made writes no document; the order cannot go on with money handed back'
);
select is(
  pg_temp.clock_out((select cashier1_u from fx), 0, pg_temp.at('2026-09-22 05:00')) || ' ' || pg_temp.day(date '2026-09-21') || ' ' || pg_temp.day(date '2026-09-22'),
  'closed 64000/0/64000/0/0/0/0/true -29000/0/-29000/0/0/0/0/true', 'criterion 6: both days match'
);

-- 7. The cash of a cancelled paid order -------------------------------------------------------------------------
-- Technique: decision table of a cancelled cash order (its refund still owed, handed back the same day, handed back the
-- next day) -> cash_refund_owed, cancelled_cash and the difference they explain; matched is unchanged (an explanation
-- is not a match).
select is(pg_temp.clock_in((select cashier1_u from fx), 0, pg_temp.at('2026-09-24 08:00')), 'clocked_in', 'cashier 1 opens 2026-09-24 with an empty drawer');
insert into o values ('k1', pg_temp.keyed((select cashier1_u from fx), jsonb_build_array(pg_temp.line('cf')), pg_temp.at('2026-09-24 09:00')));
insert into o values ('k2', pg_temp.keyed((select cashier1_u from fx), jsonb_build_array(pg_temp.line('cf')), pg_temp.at('2026-09-24 09:10')));
select is(
  pg_temp.take((select cashier1_u from fx), pg_temp.o('k1'), 'cash', pg_temp.at('2026-09-24 09:01')) || '/'
  || pg_temp.act((select cashier1_u from fx), pg_temp.o('k1'), 'cancel', pg_temp.at('2026-09-24 09:05'), 'customer_request') || '/'
  || pg_temp.take((select cashier1_u from fx), pg_temp.o('k2'), 'cash', pg_temp.at('2026-09-24 09:11')) || '/'
  || pg_temp.act((select cashier1_u from fx), pg_temp.o('k2'), 'cancel', pg_temp.at('2026-09-24 09:12'), 'customer_request') || '/'
  || pg_temp.refund((select cashier1_u from fx), pg_temp.o('k2'), 29000, pg_temp.at('2026-09-24 09:15')) || '/'
  || pg_temp.clock_out((select cashier1_u from fx), 29000, pg_temp.at('2026-09-24 12:00')),
  'paid/ok/paid/ok/succeeded/closed', 'two coffees paid in cash are cancelled; the second is handed back at once, the first is still owed when the drawer is counted'
);
select is(
  (select (r ->> 'cash_refund_owed') || '/' || (r ->> 'cancelled_cash') || '/' || (r ->> 'difference') || '/' || (r ->> 'matched')
   from pg_temp.recon((select owner_u from fx), date '2026-09-24') r) || '/' || coalesce(nullif(pg_temp.facts(pg_temp.o('k1')) || pg_temp.facts(pg_temp.o('k2')), ''), 'no invoice'),
  '29000/29000/-29000/false/no invoice', 'still owed: the day is short of nothing but holds 29,000 owed back, which explains its difference; a cancelled order has no invoice'
);
select is(
  pg_temp.clock_in((select cashier2_u from fx), 100000, pg_temp.at('2026-09-25 08:00')) || '/'
  || pg_temp.refund((select cashier2_u from fx), pg_temp.o('k1'), 29000, pg_temp.at('2026-09-25 09:00')) || '/'
  || pg_temp.clock_out((select cashier2_u from fx), 71000, pg_temp.at('2026-09-25 12:00')),
  'clocked_in/succeeded/closed', 'the next day cashier 2 hands the 29,000 back from a drawer that matches'
);
select is(
  (select (r ->> 'cash_refund_owed') || '/' || (r ->> 'cancelled_cash') || '/' || (r ->> 'difference') from pg_temp.recon((select owner_u from fx), date '2026-09-24') r)
  || ' ' || (select (r ->> 'cash_refund_owed') || '/' || (r ->> 'cancelled_cash') || '/' || (r ->> 'difference') from pg_temp.recon((select owner_u from fx), date '2026-09-25') r),
  '0/29000/-29000 0/-29000/29000', 'handed back the next day: nothing is owed any more, and cancelled_cash still explains each day''s difference'
);
select is(
  (select ((r ->> 'difference')::bigint + (r ->> 'cancelled_cash')::bigint)::text from pg_temp.recon((select owner_u from fx), date '2026-09-24') r)
  || '/' || (select ((r ->> 'difference')::bigint + (r ->> 'cancelled_cash')::bigint)::text from pg_temp.recon((select owner_u from fx), date '2026-09-25') r),
  '0/0', 'the oracle: difference + cancelled_cash = 0 on both days'
);

-- 8. The sales facts and reports of both days ----------------------------------------------------------------------
-- Technique: oracle testing over 2026-09-08 and 2026-09-09 (suite 2): the totals of both days equal what the orders
-- were paid less what was handed back; a refund document is in every sum and in no count (equivalence partitions of
-- the readers: daily and hourly facts, the aggregates, the reports, the export proof, member share and capture).
select is(
  (select string_agg(f.business_date || ':' || f.invoices || '/' || f.net_amount::bigint || '/' || f.paid_amount::bigint || '/' || f.cash_amount::bigint || '/'
     || f.items_sold::bigint || '/' || f.edited_invoices || '/' || f.voided_invoices, ' ' order by f.business_date)
   from app.daily_sales_facts((select tenant_a from fx), '2026-09-08', '2026-09-09', array[(select store_a1 from fx)]) f),
  '2026-09-08:6/297000/297000/99000/12/3/0 2026-09-09:0/-87000/-87000/-29000/0/0/0',
  'the daily facts: 2026-09-09 counts no invoice and no item, and sums -87,000 (-29,000 of it cash)'
);
select is(
  (select sum(f.net_amount)::bigint || '/' || sum(f.invoices) from app.daily_sales_facts((select tenant_a from fx), '2026-09-08', '2026-09-09', array[(select store_a1 from fx)]) f),
  (select ((select sum(p.amount) from public.order_payments p join public.orders x on x.id = p.order_id
            where x.store_id = (select store_a1 from fx) and x.business_date = '2026-09-08' and p.status = 'succeeded')
         - (select sum(r.amount) from public.order_refunds r join public.orders x on x.id = r.order_id
            where x.store_id = (select store_a1 from fx) and x.business_date = '2026-09-08' and r.status = 'succeeded'))::bigint
     || '/' || (select count(*) from public.orders x where x.store_id = (select store_a1 from fx) and x.business_date = '2026-09-08' and x.status = 'completed')),
  'oracle: over both days the revenue is what the orders were paid less what was handed back (210,000), and the invoices are the completed orders (6)'
);
select is(
  (select string_agg(h.hour_local || ':' || h.invoices || ':' || h.net_amount::bigint, ',' order by h.hour_local)
   from app.hourly_sales_facts((select tenant_a from fx), '2026-09-09', '2026-09-09', array[(select store_a1 from fx)]) h),
  '9:0:-87000', 'the hourly facts put the refunds in the hour they were handed back, as no invoice'
);
select ok(
  exists (select 1 from app.native_analytics_pending m where m.tenant_id = (select tenant_a from fx) and m.business_date = '2026-09-09'),
  'the refund day is marked for the analytics refresh'
);
select ok(app.refresh_analytics((select tenant_a from fx), '2026-09-08', '2026-09-09') > 0, 'the aggregates of both days are refreshed');
select is(
  (select string_agg(a.business_date || ':' || a.invoices || '/' || a.net_amount::bigint || '/' || a.paid_amount::bigint || '/' || a.cash_amount::bigint || '/'
     || a.items_sold::bigint || '/' || a.edited_invoices || '/' || a.voided_invoices, ' ' order by a.business_date)
   from public.agg_daily_sales a where a.store_id = (select store_a1 from fx) and a.business_date between '2026-09-08' and '2026-09-09'),
  '2026-09-08:6/297000/297000/99000/12/3/0 2026-09-09:0/-87000/-87000/-29000/0/0/0', 'the daily aggregate equals the facts'
);
select is(
  (select string_agg(a.business_date || ':' || a.payment_method_external_id || '=' || a.invoices || '/' || a.amount::bigint, ' ' order by a.business_date, a.payment_method_external_id)
   from public.agg_payment_daily a where a.store_id = (select store_a1 from fx) and a.business_date between '2026-09-08' and '2026-09-09'),
  '2026-09-08:card=2/99000 2026-09-08:cash=2/99000 2026-09-08:vietqr=1/35000 2026-09-08:zalo_checkout=1/64000 '
  || '2026-09-09:card=0/-29000 2026-09-09:cash=0/-29000 2026-09-09:zalo_checkout=0/-29000',
  'the payment aggregate sums each refund in its method and counts it as no invoice'
);
select is(
  (select sum(d.invoices) || '/' || sum(d.net_amount)::bigint from app.daily_sales(array[(select store_a1 from fx)], '2026-09-08', '2026-09-09') d)
  || '/' || (pg_temp.call((select owner_u from fx), format($q$select to_jsonb(public.metric_value(array[%L]::uuid[], 'avg_ticket', '2026-09-08', '2026-09-09'))$q$, (select store_a1 from fx))) #>> '{}'),
  '6/210000/35000.00', 'the reports read 6 invoices, 210,000 and an average ticket of 35,000 over both days'
);
select is(
  (pg_temp.call((select owner_u from fx), format($q$select to_jsonb(e) from public.export_control_totals(array[%L]::uuid[], '2026-09-08', '2026-09-09') e$q$, (select store_a1 from fx))) - array['invoice_fingerprint', 'line_fingerprint', 'payment_fingerprint', 'shift_fingerprint', 'store_id']),
  '{"invoices": 9, "voided_invoices": 0, "refund_invoices": 3, "sales_net_amount": 210000.00, "lines": 12, "line_net_amount": 384000.00, "payments": 9, "payment_amount": 210000.00, "shifts": 0, "shift_sales_amount": 0}'::jsonb,
  'the export proof counts the 3 refund documents among its 9 rows and sums them'
);
select is(
  (select (e ->> 'invoices')::int - (e ->> 'voided_invoices')::int - (e ->> 'refund_invoices')::int
   from pg_temp.call((select owner_u from fx), format($q$select to_jsonb(e) from public.export_control_totals(array[%L]::uuid[], '2026-09-08', '2026-09-09') e$q$, (select store_a1 from fx))) e),
  (select sum(a.invoices)::int from public.agg_daily_sales a where a.store_id = (select store_a1 from fx) and a.business_date between '2026-09-08' and '2026-09-09'),
  'the export''s daily summary adds up: rows less voided less refund documents = the invoices it counts'
);
select is(
  pg_temp.call((select owner_u from fx), format($q$select jsonb_agg(m.business_date || ':' || m.invoices order by m.business_date) from public.member_share_by_shift(array[%L]::uuid[], '2026-09-08', '2026-09-09') m$q$, (select store_a1 from fx))),
  '["2026-09-08:6"]'::jsonb, 'member share by shift: a day of refunds alone has no invoice to share'
);
select is(
  (pg_temp.call((select owner_u from fx), format($q$select to_jsonb(d.invoices) from public.data_quality_summary(array[%L]::uuid[], '2026-09-09', '2026-09-09') d$q$, (select store_a1 from fx))) #>> '{}')
  || '/' || (pg_temp.call((select owner_u from fx), format($q$select to_jsonb(c.invoices) from public.customer_metrics(array[%L]::uuid[], '2026-09-08', '2026-09-09') c$q$, (select store_a1 from fx))) #>> '{}'),
  '0/6', 'data quality and the capture rate count no refund document as an invoice'
);
select is(
  (select count(*)::int from public.invoices i where i.store_id = (select store_a1 from fx) and i.status = 'refund'
     and (i.receipt_no is not null or i.customer_phone is not null or i.customer_id is not null or exists (select 1 from public.invoice_lines l where l.invoice_id = i.id))),
  0, 'a refund document carries no receipt number, phone, customer or line'
);

-- 9. E-invoices (ADR-069): the correction of a later-day refund -------------------------------------------------
-- Technique: state transition of the order's e-invoices across two days (sale issued -> adjustment queued by the
-- refund -> issued by the job on the refund day; the sale invoice adjusted, its amount kept), compared with the sales
-- facts of the same two days.
select is(
  pg_temp.call((select owner_u from fx), format($q$select app.einvoice_set_provider(%L::jsonb, %L)$q$,
    jsonb_build_object('brand', (select brand_a from fx), 'store', null, 'adapter', 'mock', 'mode', 'sandbox', 'secret_name', 'EINVOICE_KEY_BRAND_1',
      'settings', jsonb_build_object('seller_tax_code', '0312345678', 'template', '2', 'series', 'C26MAA', 'vat_rate', 'none')), pg_temp.at('2026-09-27 08:00'))) ->> 'state',
  'saved', 'the owner switches the mock e-invoice provider on in sandbox'
);
create temp table w (name text primary key, answer jsonb);
create function pg_temp.item(p_name text, p_order uuid) returns jsonb language sql stable as $$
  select i from w cross join lateral jsonb_array_elements(w.answer -> 'invoices') i where w.name = p_name and (i -> 'order' ->> 'id')::uuid = p_order limit 1;
$$;
create function pg_temp.issued(p_item jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_object('invoice_id', p_item ->> 'invoice_id', 'claim', p_item ->> 'claim', 'outcome', 'issued',
    'provider_ref', 'mock-' || left(p_item ->> 'invoice_id', 8), 'invoice_no', '00000' || right(p_item ->> 'invoice_id', 3),
    'series', '2C26MAA', 'lookup_code', 'LK' || upper(left(p_item ->> 'invoice_id', 8)),
    'lookup_url', 'https://einvoice.mock.invalid/lookup/' || left(p_item ->> 'invoice_id', 8), 'tax_authority_code', 'M2-26-MOCK0-00000000001',
    'amount', (p_item ->> 'amount')::bigint);
$$;
create function pg_temp.einvoices(p_order uuid) returns text language sql volatile as $$
  select coalesce(string_agg(e.kind || ':' || e.state || coalesce(':' || e.amount::bigint, '') || coalesce('@' || (e.issued_at at time zone 'Asia/Ho_Chi_Minh')::date, ''), ', '
    order by array_position(array['sale', 'replacement', 'adjustment', 'cancellation'], e.kind), e.id), '')
  from public.e_invoices e where e.order_id = p_order;
$$;
insert into o values ('ei', pg_temp.keyed((select cashier1_u from fx), jsonb_build_array(pg_temp.line('ts'), pg_temp.line('cf')), pg_temp.at('2026-09-28 09:00')));
select is(
  pg_temp.clock_in((select cashier1_u from fx), 0, pg_temp.at('2026-09-28 08:00')) || '/'
  || pg_temp.take((select cashier1_u from fx), pg_temp.o('ei'), 'cash', pg_temp.at('2026-09-28 09:01')) || '/'
  || pg_temp.finish((select cashier1_u from fx), pg_temp.o('ei'), pg_temp.at('2026-09-28 09:05')) || '/'
  || pg_temp.clock_out((select cashier1_u from fx), 64000, pg_temp.at('2026-09-28 12:00')) || '/' || pg_temp.einvoices(pg_temp.o('ei')),
  'clocked_in/paid/completed/paid/closed/sale:queued', 'an order of 64,000 paid in cash on 2026-09-28 queues its sale e-invoice'
);
insert into w select 'w1', app.einvoice_job_work(10, pg_temp.at('2026-09-28 09:30'));
select is(
  (app.einvoice_job_result(pg_temp.issued(pg_temp.item('w1', pg_temp.o('ei'))), pg_temp.at('2026-09-28 09:31')) ->> 'state') || '/' || pg_temp.einvoices(pg_temp.o('ei')),
  'issued/sale:issued:64000@2026-09-28', 'the job issues it on 2026-09-28 for 64,000'
);
select is(
  pg_temp.clock_in((select manager_u from fx), 100000, pg_temp.at('2026-09-29 08:00')) || '/'
  || pg_temp.refund((select manager_u from fx), pg_temp.o('ei'), 29000, pg_temp.at('2026-09-29 09:00')) || '/' || pg_temp.einvoices(pg_temp.o('ei'))
  || '/' || pg_temp.facts(pg_temp.o('ei')),
  'clocked_in/succeeded/sale:issued:64000@2026-09-28, adjustment:queued/2026-09-28:completed:64000:cash=64000,2026-09-29:refund:-29000:cash=-29000',
  'the next day''s refund queues one correction; the sale invoice, like the invoice of 2026-09-28, keeps its 64,000'
);
insert into w select 'w2', app.einvoice_job_work(10, pg_temp.at('2026-09-29 09:05'));
select is(
  (pg_temp.item('w2', pg_temp.o('ei')) ->> 'action') || '/' || (pg_temp.item('w2', pg_temp.o('ei')) ->> 'amount') || '/'
  || (app.einvoice_job_result(pg_temp.issued(pg_temp.item('w2', pg_temp.o('ei'))), pg_temp.at('2026-09-29 09:06')) ->> 'state') || '/' || pg_temp.einvoices(pg_temp.o('ei')),
  'adjust/-29000/issued/sale:adjusted:64000@2026-09-28, adjustment:issued:-29000@2026-09-29',
  'consistent with the rule: the correction is its own document of the refund day, by the refund''s amount, as the refund document of 2026-09-29 is'
);
select is(pg_temp.clock_out((select manager_u from fx), 71000, pg_temp.at('2026-09-29 12:00')) || ' ' || pg_temp.day(date '2026-09-28') || ' ' || pg_temp.day(date '2026-09-29'),
  'closed 64000/0/0/64000/0/0/0/true -29000/0/0/-29000/0/0/0/true', 'criterion 6: both days match');

-- 10. Who reads, who writes ---------------------------------------------------------------------------------------
-- Technique: authorisation by role, store and tenant (OWASP ASVS V4): the reconciliation of the refund day, the refund
-- documents under row-level security, and the internal functions closed to every API role.
select is(
  (pg_temp.recon((select cashier1_u from fx), date '2026-09-09') ->> 'error') || '/'
  || (pg_temp.recon((select viewer_u from fx), date '2026-09-09') ->> 'error') || '/'
  || (pg_temp.recon((select manager_a2_u from fx), date '2026-09-09') ->> 'error') || '/'
  || (pg_temp.recon((select owner_b_u from fx), date '2026-09-09') ->> 'error') || '/'
  || (pg_temp.recon((select cust1_u from fx), date '2026-09-09') ->> 'error'),
  '42501/42501/42501/42501/42501', 'staff, a viewer, a manager of another store, another tenant''s owner and a customer do not read the refund day'
);
select is(
  pg_temp.as_member((select owner_b_u from fx), format($q$select count(*)::text from public.invoices where store_id = %L and status = 'refund'$q$, (select store_a1 from fx))) || '/'
  || pg_temp.as_member((select manager_a2_u from fx), format($q$select count(*)::text from public.invoices where store_id = %L and status = 'refund'$q$, (select store_a1 from fx))) || '/'
  || pg_temp.as_member((select owner_u from fx), format($q$select count(*)::text from public.invoices where store_id = %L and status = 'refund'$q$, (select store_a1 from fx))),
  '0/0/13', 'another tenant''s owner and another store''s manager read none of A1''s refund documents; its owner reads all 13'
);
select is(
  (select string_agg(f.sig || '=' || (has_function_privilege('anon', f.sig, 'execute') or has_function_privilege('authenticated', f.sig, 'execute')
     or has_function_privilege('service_role', f.sig, 'execute') or has_function_privilege('public', f.sig, 'execute'))::text, ',' order by f.sig)
   from (values ('app.refund_business_date(public.order_refunds)'), ('app.native_refund_documents(uuid, timestamptz)'), ('app.native_order_invoice(uuid, timestamptz)'),
     ('app.native_order_refunded(public.orders, timestamptz)'), ('app.manager_day_reconciliation(uuid, date, timestamptz)')) as f (sig)),
  'app.manager_day_reconciliation(uuid, date, timestamptz)=false,app.native_order_invoice(uuid, timestamptz)=false,app.native_order_refunded(public.orders, timestamptz)=false,'
  || 'app.native_refund_documents(uuid, timestamptz)=false,app.refund_business_date(public.order_refunds)=false',
  'no API role executes the internal functions of the rule'
);
select is(
  pg_temp.as_member((select owner_u from fx), format($q$select app.native_refund_documents(%L, now())::text$q$, pg_temp.o('l_cash'))) || '/'
  || pg_temp.as_member((select owner_u from fx), format($q$select app.manager_day_reconciliation(%L, '2026-09-09')::text$q$, (select store_a1 from fx))),
  '42501/42501', 'even the store''s owner, as the role authenticated, cannot call them directly'
);
select ok(
  not has_function_privilege('anon', 'public.manager_day_reconciliation(uuid, date)', 'execute')
  and has_function_privilege('authenticated', 'public.manager_day_reconciliation(uuid, date)', 'execute')
  and not has_function_privilege('anon', 'public.export_control_totals(uuid[], date, date)', 'execute')
  and has_function_privilege('authenticated', 'public.export_control_totals(uuid[], date, date)', 'execute'),
  'the reconciliation and the export proof are for members only, as before'
);
select is(
  (select count(*)::int from public.invoices i where i.status = 'refund' and i.tenant_id = (select tenant_b from fx))
  || '/' || (select count(*)::int from public.invoices i where i.status = 'refund' and i.store_id = (select store_a2 from fx)),
  '0/0', 'isolation: no refund document reaches another tenant or another store'
);

select * from finish();
rollback;
