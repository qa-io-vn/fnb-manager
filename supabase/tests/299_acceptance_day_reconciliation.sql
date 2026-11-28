-- Acceptance criterion 6 of the owner's plan, phase 1: "Doanh thu ngày trên ứng dụng khớp tổng giao dịch của cổng thanh
-- toán và tiền mặt cuối ca". A native store's business day where the app's revenue (the native invoices the reports and
-- Tổng quan ngày read) equals the online payments the provider confirmed (less the refunds it confirmed), plus the card
-- payments, plus the cash the shifts counted at the end (opening cash left out), and the days around it that must not
-- match until explained. The same rows give the oracle each time: the figures are computed again straight from the
-- payments, refunds, shifts and invoices and compared with app.manager_day_reconciliation.
-- Techniques: equivalence partitions of the money of a day (cash, card, VietQR, the Zalo wallet, a partial card refund,
-- a full online refund, a failed wallet attempt, a transfer of another amount, another store's and another tenant's
-- sales), a decision table of `matched` (amounts add up or not x a shift open x a shift awaiting confirmation: the
-- matched day, an open shift, an overage awaiting then confirmed, two offsetting drawers awaiting then confirmed, cash
-- for an order not completed yet, a refund still owed), state transitions of a day (not matched -> matched when the
-- paid order completes; awaiting -> confirmed), boundary values (an empty day; the next business day), error guessing
-- (a client never confirms a payment, a refund handed back on a later day), and authorisation by role, store and
-- tenant. A refund handed back in cash on a later business day counts on the day its drawer paid it out (defect D-1,
-- fixed by ADR-071): the order's day keeps its invoice and still matches, and the refund day's own refund document
-- matches the drawer that handed it back. 301_refund_business_day covers the rule in depth.
begin;
select plan(54);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000029901'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000029902'::uuid as tenant_b,
  'cccccccc-cccc-4ccc-8ccc-000000029901'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000029902'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000029901'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000029902'::uuid as store_a2,
  'ffffffff-ffff-4fff-8fff-000000029903'::uuid as store_b1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000029901'::uuid as brand_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000029902'::uuid as brand_b,
  '99999999-9999-4999-8999-000000029901'::uuid as app_a,
  '99999999-9999-4999-8999-000000029902'::uuid as app_b,
  'eeeeeeee-eeee-4eee-8eee-000000029901'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000029902'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000029903'::uuid as cashier1_u,
  'eeeeeeee-eeee-4eee-8eee-000000029904'::uuid as cashier2_u,
  'eeeeeeee-eeee-4eee-8eee-000000029905'::uuid as staff_a2_u,
  'eeeeeeee-eeee-4eee-8eee-000000029906'::uuid as viewer_u,
  'eeeeeeee-eeee-4eee-8eee-000000029907'::uuid as manager_a2_u,
  'eeeeeeee-eeee-4eee-8eee-000000029908'::uuid as owner_b_u,
  'eeeeeeee-eeee-4eee-8eee-000000029909'::uuid as staff_b_u,
  'eeeeeeee-eeee-4eee-8eee-000000029911'::uuid as cust1_u,
  'eeeeeeee-eeee-4eee-8eee-000000029912'::uuid as cust2_u,
  'eeeeeeee-eeee-4eee-8eee-000000029913'::uuid as cust3_u,
  'eeeeeeee-eeee-4eee-8eee-000000029914'::uuid as cust4_u;
grant select on fx to authenticated;

create temp table ids (name text primary key, id uuid not null);
insert into ids values
  ('cat_a', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029951'), ('cat_b', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029952'),
  ('item_cf', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029901'), ('item_ts', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029902'), ('item_bb', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029903'),
  ('cf', 'bbbbbbbb-bbbb-4bbb-8bbb-000000029911'), ('ts', 'bbbbbbbb-bbbb-4bbb-8bbb-000000029912'), ('bb', 'bbbbbbbb-bbbb-4bbb-8bbb-000000029913'),
  ('table_a1', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029941'), ('table_a2', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029942'), ('table_b1', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029943');
grant select on ids to authenticated;
create function pg_temp.id(p_name text) returns uuid language sql stable as $$ select id from ids where name = p_name $$;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'acceptance-299-' || right(u.id::text, 4) || '@example.com',
  case when u.tenant is null then '{}'::jsonb else jsonb_build_object('kind', 'customer', 'tenant_id', u.tenant) end
from fx cross join lateral (values
  (fx.owner_u, null::uuid), (fx.manager_u, null), (fx.cashier1_u, null), (fx.cashier2_u, null), (fx.staff_a2_u, null), (fx.viewer_u, null),
  (fx.manager_a2_u, null), (fx.owner_b_u, null), (fx.staff_b_u, null),
  (fx.cust1_u, fx.tenant_a), (fx.cust2_u, fx.tenant_a), (fx.cust3_u, fx.tenant_a), (fx.cust4_u, fx.tenant_a)
) as u (id, tenant);
insert into public.tenants (id, slug, name)
select tenant_a, 'acceptance-299-a', 'Acceptance 299 A' from fx union all
select tenant_b, 'acceptance-299-b', 'Acceptance 299 B' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'acceptance-299-a', 'Synthetic account A' from fx union all
select account_b, tenant_b, 'mock', 'acceptance-299-b', 'Synthetic account B' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name, opening_hours)
select s.id, s.tenant, s.account, s.ext, s.code, s.name,
  '{"mon": [["00:00", "24:00"]], "tue": [["00:00", "24:00"]], "wed": [["00:00", "24:00"]], "thu": [["00:00", "24:00"]], "fri": [["00:00", "24:00"]], "sat": [["00:00", "24:00"]], "sun": [["00:00", "24:00"]]}'::jsonb
from fx cross join lateral (values
  (fx.store_a1, fx.tenant_a, fx.account_a, 'a299-a1', 'sa-1', 'Synthetic store A1'),
  (fx.store_a2, fx.tenant_a, fx.account_a, 'a299-a2', 'sa-2', 'Synthetic store A2'),
  (fx.store_b1, fx.tenant_b, fx.account_b, 'a299-b1', 'sb-1', 'Synthetic store B1')
) as s (id, tenant, account, ext, code, name);
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_a, m.user_id, m.role::public.tenant_role, m.store_ids
from fx cross join lateral (values
  (fx.owner_u, 'owner', null::uuid[]), (fx.manager_u, 'manager', null), (fx.cashier1_u, 'staff', array[fx.store_a1]),
  (fx.cashier2_u, 'staff', array[fx.store_a1]), (fx.staff_a2_u, 'staff', array[fx.store_a2]), (fx.viewer_u, 'viewer', null),
  (fx.manager_a2_u, 'manager', array[fx.store_a2])
) as m (user_id, role, store_ids)
union all
select tenant_b, owner_b_u, 'owner', null from fx union all
select tenant_b, staff_b_u, 'staff', array[store_b1] from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_a, tenant_a, 'brand-1', 'Synthetic brand A', array[store_a1, store_a2] from fx union all
select brand_b, tenant_b, 'brand-1', 'Synthetic brand B', array[store_b1] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_a, tenant_a, brand_a, 'synthetic-299-zapp-a', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx union all
select app_b, tenant_b, brand_b, 'synthetic-299-zapp-b', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx;
insert into public.mini_apps (tenant_id, brand_id, kind, external_id, browsable, title, header_title_vi, header_title_en,
  header_color_light, header_color_dark, text_color_light, text_color_dark)
select tenant_a, brand_a, 'customer', 'synthetic-299-mini-a', true, 'Cửa hàng mẫu', 'Cửa hàng mẫu', 'Sample store',
  '#ffffff', '#000000', 'black', 'white' from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id)
select tenant_a, app_a, 'syn-zalo-299-1', cust1_u from fx union all
select tenant_a, app_a, 'syn-zalo-299-2', cust2_u from fx union all
select tenant_a, app_a, 'syn-zalo-299-3', cust3_u from fx union all
select tenant_a, app_a, 'syn-zalo-299-4', cust4_u from fx;
insert into public.store_ordering_settings (store_id, tenant_id, till_mode, ordering_enabled, order_types, staff_presence_required)
select store_a1, tenant_a, 'native', true, array['table', 'takeaway'], false from fx union all
select store_a2, tenant_a, 'native', true, array['table', 'takeaway'], false from fx union all
select store_b1, tenant_b, 'native', true, array['table', 'takeaway'], false from fx;
insert into public.menu_categories (id, tenant_id, brand_id, name, sort_order)
select pg_temp.id('cat_a'), tenant_a, brand_a, 'Đồ uống', 10 from fx union all
select pg_temp.id('cat_b'), tenant_b, brand_b, 'Đồ uống', 10 from fx;
insert into public.menu_items (id, tenant_id, brand_id, category_id, name, counts_for_stamps, order_types)
select pg_temp.id('item_cf'), tenant_a, brand_a, pg_temp.id('cat_a'), 'Cà phê', true, array['table', 'takeaway'] from fx union all
select pg_temp.id('item_ts'), tenant_a, brand_a, pg_temp.id('cat_a'), 'Trà sữa', true, array['table', 'takeaway'] from fx union all
select pg_temp.id('item_bb'), tenant_b, brand_b, pg_temp.id('cat_b'), 'Món B', true, array['table', 'takeaway'] from fx;
insert into public.menu_item_sizes (id, tenant_id, brand_id, item_id, label, price, sort_order, is_default)
select pg_temp.id('cf'), tenant_a, brand_a, pg_temp.id('item_cf'), null, 29000, 10, true from fx union all
select pg_temp.id('ts'), tenant_a, brand_a, pg_temp.id('item_ts'), null, 35000, 10, true from fx union all
select pg_temp.id('bb'), tenant_b, brand_b, pg_temp.id('item_bb'), null, 20000, 10, true from fx;
insert into public.store_tables (id, tenant_id, store_id, label, area)
select pg_temp.id('table_a1'), tenant_a, store_a1, 'Bàn 1', 'Tầng 1' from fx union all
select pg_temp.id('table_a2'), tenant_a, store_a2, 'Bàn 2', 'Tầng 1' from fx union all
select pg_temp.id('table_b1'), tenant_b, store_b1, 'Bàn B', 'Tầng 1' from fx;
create temp table tok as
select t.id, app.table_qr_token(t.tenant_id, t.id, t.qr_version) as token from public.store_tables t where t.id = pg_temp.id('table_a1');
create temp table qr as
select s.id as store_id, app.counter_qr_token(s.tenant_id, s.id, 1) as token from public.stores s join fx on s.id in (fx.store_a1, fx.store_a2, fx.store_b1);

-- Helpers. Every call answers JSON or {"error": SQLSTATE}; the claims are a customer's (with kind and tenant) or a
-- member's, set for one statement. Instants are Vietnam time on the given business date.
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
create function pg_temp.line(p_size text, p_qty integer default 1) returns jsonb language sql stable as $$
  select jsonb_build_object('size', pg_temp.id(p_size), 'qty', p_qty, 'options', '[]'::jsonb);
$$;
-- A table order at Bàn 1 of A1 placed by a customer with one way to pay.
create function pg_temp.place(p_user uuid, p_payment text, p_lines jsonb, p_total integer, p_at timestamptz) returns uuid language sql as $$
  select (pg_temp.call(p_user, format($q$select app.customer_place_order(%L::jsonb, %L)$q$,
    jsonb_build_object('request_id', gen_random_uuid(), 'store', 'sa-1', 'type', 'table', 'table_token', (select token from tok),
      'payment', p_payment, 'lines', p_lines, 'expected_total', p_total), p_at)) -> 'order' ->> 'id')::uuid;
$$;
-- An order keyed at a counter by a staff member.
create function pg_temp.keyed(p_user uuid, p_store uuid, p_type text, p_lines jsonb, p_at timestamptz) returns uuid language sql as $$
  select (pg_temp.call(p_user, format($q$select app.counter_create_order(%L, %L::jsonb, %L)$q$, p_store,
    jsonb_build_object('request_id', gen_random_uuid(), 'type', p_type, 'lines', p_lines)
      || case when p_type = 'table' then jsonb_build_object('table_id', (select t.id from public.store_tables t where t.store_id = p_store limit 1)) else '{}'::jsonb end,
    p_at)) -> 'order' ->> 'id')::uuid;
$$;
-- "Đã thu" in cash or card for the order's total, by the person at an instant.
create function pg_temp.take(p_user uuid, p_order uuid, p_method text, p_at timestamptz) returns text language sql as $$
  select pg_temp.call(p_user, format($q$select app.counter_record_payment(%L, %L, %s, %s, %L)$q$, p_order, p_method,
    (select o.total from public.orders o where o.id = p_order), (select o.version from public.orders o where o.id = p_order), p_at)) ->> 'state';
$$;
-- An online attempt opened for the order's customer and the provider's verified answer, as the Edge Functions call them.
create function pg_temp.online(p_order uuid, p_amount numeric, p_success boolean, p_ref text, p_at timestamptz) returns text language plpgsql as $$
declare
  v_order public.orders;
  v_attempt jsonb;
  v_reference text;
begin
  select o.* into v_order from public.orders o where o.id = p_order;
  v_attempt := app.checkout_begin(jsonb_build_object('user_id', (select l.user_id from app.customer_logins l where l.id = v_order.customer_login_id),
    'order_id', p_order, 'method', v_order.payment_method, 'idempotency_key', 'key-' || regexp_replace(p_ref, '[^A-Za-z0-9_-]', '-', 'g'), 'for', 'customer'), p_at);
  v_reference := v_attempt -> 'payment' ->> 'reference';
  return app.checkout_settle(jsonb_build_object('provider_id', (select p.id from public.payment_providers p where p.brand_id = (select brand_a from fx)
      and p.method = v_order.payment_method and p.store_id is null), 'provider_ref', p_ref, 'amount', p_amount, 'success', p_success)
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
create function pg_temp.clock_in(p_user uuid, p_store uuid, p_opening numeric, p_at timestamptz) returns text language sql as $$
  select pg_temp.call(p_user, format($q$select app.staff_clock_in(%L, %L, %s, %L)$q$, p_store, (select token from qr where store_id = p_store), p_opening, p_at)) ->> 'state';
$$;
create function pg_temp.clock_out(p_user uuid, p_counted numeric, p_at timestamptz) returns text language sql as $$
  select pg_temp.call(p_user, format($q$select app.staff_clock_out(%s, %L)$q$, p_counted, p_at)) ->> 'state';
$$;
-- Reads taken after a call in the same statement: a volatile function sees what the call wrote, a plain subquery of
-- the statement does not (it keeps the statement's snapshot).
create function pg_temp.state(p_order uuid) returns text language sql volatile as $$
  select status::text || ':' || payment_status::text from public.orders where id = p_order;
$$;
create function pg_temp.invoice(p_order uuid) returns text language sql volatile as $$
  select status::text || ':' || net_amount::bigint from public.invoices where external_id = 'native-' || p_order;
$$;
create function pg_temp.refund_of(p_order uuid) returns uuid language sql volatile as $$
  select r.id from public.order_refunds r where r.order_id = p_order order by r.requested_at desc limit 1;
$$;
create function pg_temp.methods(p_store uuid) returns text language sql volatile as $$
  select array_to_string(payment_methods, ',') from public.store_ordering_settings where store_id = p_store;
$$;
create function pg_temp.open_shift(p_user uuid) returns uuid language sql stable as $$
  select s.id from public.staff_shifts s where s.user_id = p_user and s.status <> 'closed';
$$;
create function pg_temp.recon(p_user uuid, p_store uuid, p_date date) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.manager_day_reconciliation(%L, %L)$q$, p_store, p_date));
$$;
-- revenue/online/card/counted/difference/open/awaiting/matched of a day at A1, as the owner reads it.
create function pg_temp.summary(p_date date) returns text language sql as $$
  select (r ->> 'revenue') || '/' || (r ->> 'online_confirmed') || '/' || (r ->> 'card') || '/' || (r -> 'cash' ->> 'counted') || '/'
    || (r ->> 'difference') || '/' || (r ->> 'shifts_open') || '/' || (r ->> 'shifts_awaiting_confirmation') || '/' || (r ->> 'matched')
  from pg_temp.recon((select owner_u from fx), (select store_a1 from fx), p_date) r;
$$;
-- The oracle: the same day computed straight from the rows, as a person adding up the gateway's statement, the card
-- slips and the drawers would.
create function pg_temp.oracle(p_store uuid, p_date date) returns text language sql stable as $$
  select (
      select coalesce(sum(i.net_amount), 0)::bigint from public.invoices i join public.pos_accounts a on a.id = i.pos_account_id and a.connector = 'native'
      where i.store_id = p_store and i.business_date = p_date and i.status <> 'voided')
    || '/' || (
      (select coalesce(sum(p.amount), 0) from public.order_payments p join public.orders o on o.id = p.order_id
       where o.store_id = p_store and o.business_date = p_date and o.status = 'completed' and p.method in ('vietqr', 'zalo_checkout')
         and p.status = 'succeeded' and p.provider_ref is not null)
      - (select coalesce(sum(r.amount), 0) from public.order_refunds r join public.orders o on o.id = r.order_id
         where o.store_id = p_store and o.business_date = p_date and o.status = 'completed' and r.method in ('vietqr', 'zalo_checkout')
           and r.status = 'succeeded' and r.provider_ref is not null))::bigint
    || '/' || (
      (select coalesce(sum(p.amount), 0) from public.order_payments p join public.orders o on o.id = p.order_id
       where o.store_id = p_store and o.business_date = p_date and o.status = 'completed' and p.method = 'card' and p.status = 'succeeded')
      - (select coalesce(sum(r.amount), 0) from public.order_refunds r join public.orders o on o.id = r.order_id
         where o.store_id = p_store and o.business_date = p_date and o.status = 'completed' and r.method = 'card' and r.status = 'succeeded'))::bigint
    || '/' || (select coalesce(sum(s.counted_cash - s.opening_cash), 0)::bigint from public.staff_shifts s
      where s.store_id = p_store and s.business_date = p_date and s.status <> 'open');
$$;

-- 0. The store's providers: VietQR and the Zalo wallet in sandbox --------------------------------------------------
select is(
  pg_temp.call((select owner_u from fx), format($q$select app.checkout_set_provider(%L::jsonb, %L)$q$,
    jsonb_build_object('brand', (select brand_a from fx), 'method', 'vietqr', 'adapter', 'mock', 'mode', 'sandbox', 'secret_name', 'PAYMENT_BANK_BRAND_1',
      'settings', jsonb_build_object('bank_bin', '970400', 'bank_name', 'Ngân hàng mẫu', 'account_number', '0123456789', 'account_name', 'CUA HANG MAU',
        'reference_prefix', 'FNB')), pg_temp.at('2026-10-01 08:00'))) ->> 'state'
  || '/' || (pg_temp.call((select owner_u from fx), format($q$select app.checkout_set_provider(%L::jsonb, %L)$q$,
    jsonb_build_object('brand', (select brand_a from fx), 'method', 'zalo_checkout', 'mode', 'sandbox', 'secret_name', 'ZALO_CHECKOUT_KEY_BRAND_1',
      'settings', jsonb_build_object('wallet_method', 'ZALOPAY')), pg_temp.at('2026-10-01 08:00'))) ->> 'state')
  || '/' || pg_temp.methods((select store_a1 from fx)),
  'saved/saved/counter,zalo_checkout,vietqr', 'the owner switches VietQR and the Zalo wallet on in the gateway''s sandbox'
);

-- 1. A full day at A1 (2026-10-05): two cashiers, every way to pay, two refunds; it matches ---------------------------
create temp table o (name text primary key, id uuid);
grant select on o to authenticated;
create function pg_temp.o(p_name text) returns uuid language sql stable as $$ select id from o where name = p_name $$;

select is(pg_temp.clock_in((select cashier1_u from fx), (select store_a1 from fx), 500000, pg_temp.at('2026-10-05 07:00')), 'clocked_in', 'cashier 1 clocks in at 07:00 with 500,000');
insert into o values ('cash1', pg_temp.place((select cust1_u from fx), 'counter', jsonb_build_array(pg_temp.line('cf')), 29000, pg_temp.at('2026-10-05 07:30')));
insert into o values ('card', pg_temp.keyed((select cashier1_u from fx), (select store_a1 from fx), 'table', jsonb_build_array(pg_temp.line('ts'), pg_temp.line('cf')), pg_temp.at('2026-10-05 08:00')));
insert into o values ('qr', pg_temp.place((select cust2_u from fx), 'vietqr', jsonb_build_array(pg_temp.line('cf')), 29000, pg_temp.at('2026-10-05 09:00')));
insert into o values ('wallet', pg_temp.place((select cust3_u from fx), 'zalo_checkout', jsonb_build_array(pg_temp.line('ts')), 35000, pg_temp.at('2026-10-05 10:00')));
insert into o values ('wallet_failed', pg_temp.place((select cust4_u from fx), 'zalo_checkout', jsonb_build_array(pg_temp.line('ts')), 35000, pg_temp.at('2026-10-05 10:30')));
insert into o values ('qr_short', pg_temp.place((select cust1_u from fx), 'vietqr', jsonb_build_array(pg_temp.line('cf')), 29000, pg_temp.at('2026-10-05 11:00')));
select is((select count(*)::int from o where id is null), 0, 'six orders of the morning are placed');
select is(
  pg_temp.take((select cashier1_u from fx), pg_temp.o('cash1'), 'cash', pg_temp.at('2026-10-05 07:31')) || '/'
  || pg_temp.take((select cashier1_u from fx), pg_temp.o('card'), 'card', pg_temp.at('2026-10-05 08:01')),
  'paid/paid', 'a table order of the app paid in cash (29,000) and a counter order paid by card (64,000)'
);
select is(
  pg_temp.online(pg_temp.o('qr'), 29000, true, 'mock:tx-299-1', pg_temp.at('2026-10-05 09:01')) || '/'
  || pg_temp.online(pg_temp.o('wallet'), 35000, true, 'ztx-299-1', pg_temp.at('2026-10-05 10:01')),
  'confirmed/confirmed', 'a VietQR transfer (29,000) and a wallet payment (35,000) confirmed by the gateway'
);
select is(
  pg_temp.online(pg_temp.o('wallet_failed'), 35000, false, 'ztx-299-2', pg_temp.at('2026-10-05 10:31')) || '/'
  || pg_temp.state(pg_temp.o('wallet_failed')),
  'failed/awaiting_payment:unpaid', 'a failed wallet attempt pays nothing: the order still waits'
);
select is(
  (select r ->> 'reason' from (select app.checkout_settle(jsonb_build_object('provider_id', (select p.id from public.payment_providers p where p.brand_id = (select brand_a from fx) and p.method = 'vietqr' and p.store_id is null),
     'provider_ref', 'mock:tx-299-2', 'amount', 28000, 'success', true, 'candidates', jsonb_build_array((app.checkout_begin(jsonb_build_object('user_id', (select cust1_u from fx),
       'order_id', pg_temp.o('qr_short'), 'method', 'vietqr', 'idempotency_key', 'key-299-short', 'for', 'customer'), pg_temp.at('2026-10-05 11:01')) -> 'payment' ->> 'reference'))),
     pg_temp.at('2026-10-05 11:02')) as r) x) || '/' || pg_temp.state(pg_temp.o('qr_short')),
  'amount_differs/awaiting_payment:unpaid', 'a transfer 1,000 short is kept for a manager and pays nothing'
);
select is(
  pg_temp.finish((select cashier1_u from fx), pg_temp.o('cash1'), pg_temp.at('2026-10-05 07:40')) || ','
  || pg_temp.finish((select cashier1_u from fx), pg_temp.o('card'), pg_temp.at('2026-10-05 08:10')) || ','
  || pg_temp.finish((select cashier1_u from fx), pg_temp.o('qr'), pg_temp.at('2026-10-05 09:10')) || ','
  || pg_temp.finish((select cashier1_u from fx), pg_temp.o('wallet'), pg_temp.at('2026-10-05 10:10')),
  'completed/paid,completed/paid,completed/paid,completed/paid', 'the four paid orders of the morning are served and completed'
);
select is(pg_temp.clock_out((select cashier1_u from fx), 529000, pg_temp.at('2026-10-05 12:00')), 'closed',
  'cashier 1 counts 529,000 at 12:00 (500,000 + 29,000 in cash): the shift closes');
select is(pg_temp.clock_in((select cashier2_u from fx), (select store_a1 from fx), 300000, pg_temp.at('2026-10-05 12:00')), 'clocked_in', 'cashier 2 takes over with 300,000');
insert into o values ('cash2', pg_temp.place((select cust1_u from fx), 'counter', jsonb_build_array(pg_temp.line('cf', 2)), 58000, pg_temp.at('2026-10-05 13:00')));
insert into o values ('cash3', pg_temp.keyed((select cashier2_u from fx), (select store_a1 from fx), 'takeaway', jsonb_build_array(pg_temp.line('cf')), pg_temp.at('2026-10-05 14:00')));
insert into o values ('wallet_refunded', pg_temp.place((select cust4_u from fx), 'zalo_checkout', jsonb_build_array(pg_temp.line('ts')), 35000, pg_temp.at('2026-10-05 15:00')));
select is(
  pg_temp.take((select cashier2_u from fx), pg_temp.o('cash2'), 'cash', pg_temp.at('2026-10-05 13:01')) || '/'
  || pg_temp.take((select cashier2_u from fx), pg_temp.o('cash3'), 'cash', pg_temp.at('2026-10-05 14:01')) || '/'
  || pg_temp.online(pg_temp.o('wallet_refunded'), 35000, true, 'ztx-299-3', pg_temp.at('2026-10-05 15:01')),
  'paid/paid/confirmed', 'the afternoon: 58,000 and 29,000 in cash, 35,000 by the wallet'
);
select is(
  pg_temp.finish((select cashier2_u from fx), pg_temp.o('cash2'), pg_temp.at('2026-10-05 13:10')) || ','
  || pg_temp.finish((select cashier2_u from fx), pg_temp.o('cash3'), pg_temp.at('2026-10-05 14:10')) || ','
  || pg_temp.finish((select cashier2_u from fx), pg_temp.o('wallet_refunded'), pg_temp.at('2026-10-05 15:10')),
  'completed/paid,completed/paid,completed/paid', 'completed'
);
select is(
  (select r ->> 'state' from pg_temp.call((select manager_u from fx), format($q$select app.counter_refund(%L, 35000, 'khách trả lại món', %L)$q$,
    pg_temp.o('wallet_refunded'), pg_temp.at('2026-10-05 16:00'))) r)
  || '/' || (app.checkout_refund_confirm(pg_temp.refund_of(pg_temp.o('wallet_refunded')), true, 'zrefund-299-1', null, pg_temp.at('2026-10-05 16:05')) ->> 'state')
  || '/' || pg_temp.invoice(pg_temp.o('wallet_refunded')),
  'pending/succeeded/voided:35000', 'a manager refunds the wallet order in full; the gateway confirms the refund and the invoice is voided'
);
select is(
  (select r ->> 'state' from pg_temp.call((select manager_u from fx), format($q$select app.counter_refund(%L, 29000, 'một ly bị đổ', %L)$q$,
    pg_temp.o('card'), pg_temp.at('2026-10-05 16:30'))) r)
  || '/' || pg_temp.invoice(pg_temp.o('card')),
  'succeeded/edited:35000', 'a manager hands 29,000 back on the card terminal: the invoice is edited to 35,000'
);
select is(pg_temp.clock_out((select cashier2_u from fx), 387000, pg_temp.at('2026-10-05 20:00')), 'closed',
  'cashier 2 counts 387,000 at 20:00 (300,000 + 58,000 + 29,000): the shift closes');

-- The same day at A2 and at tenant B's store: their cash must not reach A1's day.
select is(pg_temp.clock_in((select staff_a2_u from fx), (select store_a2 from fx), 0, pg_temp.at('2026-10-05 09:00')), 'clocked_in', 'staff of A2 clock in at A2');
insert into o values ('a2', pg_temp.keyed((select staff_a2_u from fx), (select store_a2 from fx), 'takeaway', jsonb_build_array(pg_temp.line('ts')), pg_temp.at('2026-10-05 09:30')));
select is(
  pg_temp.take((select staff_a2_u from fx), pg_temp.o('a2'), 'cash', pg_temp.at('2026-10-05 09:31')) || '/'
  || pg_temp.finish((select staff_a2_u from fx), pg_temp.o('a2'), pg_temp.at('2026-10-05 09:40')) || '/'
  || pg_temp.clock_out((select staff_a2_u from fx), 35000, pg_temp.at('2026-10-05 17:00')),
  'paid/completed/paid/closed', 'A2 sells 35,000 in cash and closes its drawer'
);
select is(pg_temp.clock_in((select staff_b_u from fx), (select store_b1 from fx), 0, pg_temp.at('2026-10-05 09:00')), 'clocked_in', 'tenant B''s staff clock in at B1');
insert into o values ('b1', (pg_temp.call((select staff_b_u from fx), format($q$select app.counter_create_order(%L, %L::jsonb, %L)$q$, (select store_b1 from fx),
  jsonb_build_object('request_id', gen_random_uuid(), 'type', 'takeaway', 'lines', jsonb_build_array(jsonb_build_object('size', pg_temp.id('bb'), 'qty', 1, 'options', '[]'::jsonb))),
  pg_temp.at('2026-10-05 09:30'))) -> 'order' ->> 'id')::uuid);
select is(
  pg_temp.take((select staff_b_u from fx), pg_temp.o('b1'), 'cash', pg_temp.at('2026-10-05 09:31')) || '/'
  || pg_temp.finish((select staff_b_u from fx), pg_temp.o('b1'), pg_temp.at('2026-10-05 09:40')) || '/'
  || pg_temp.clock_out((select staff_b_u from fx), 20000, pg_temp.at('2026-10-05 17:00')),
  'paid/completed/paid/closed', 'B1 sells 20,000 in cash and closes its drawer'
);

select is(pg_temp.summary(date '2026-10-05'), '215000/64000/35000/116000/0/0/0/true',
  'criterion 6: A1''s revenue 215,000 equals the gateway''s 64,000 (29,000 + 35,000 + 35,000 - 35,000 refunded), the card''s 35,000 and the 116,000 counted at the end of both shifts');
select is(
  (select (r ->> 'revenue') || '/' || (r ->> 'online_confirmed') || '/' || (r ->> 'card') || '/' || (r -> 'cash' ->> 'counted') from pg_temp.recon((select owner_u from fx), (select store_a1 from fx), date '2026-10-05') r),
  pg_temp.oracle((select store_a1 from fx), date '2026-10-05'),
  'criterion 6: each figure equals the one added up straight from the invoices, the gateway''s confirmed transactions and refunds, the card payments and the closed drawers'
);
select is(
  (select (r ->> 'revenue')::bigint from pg_temp.recon((select owner_u from fx), (select store_a1 from fx), date '2026-10-05') r),
  (select f.net_amount::bigint from app.daily_sales_facts((select tenant_a from fx), date '2026-10-05', date '2026-10-05', array[(select store_a1 from fx)]) f),
  'criterion 6: the revenue reconciled is the revenue the reports show for the day'
);
select is(
  (select (r ->> 'revenue')::bigint from pg_temp.recon((select owner_u from fx), (select store_a1 from fx), date '2026-10-05') r),
  (select coalesce(sum(round(i.net_amount)), 0)::bigint from public.invoices i where i.store_id = (select store_a1 from fx) and i.business_date = '2026-10-05' and i.status <> 'voided'),
  'criterion 6: and the revenue Tổng quan ngày adds up (every invoice of the store and day but the voided ones)'
);
select is(
  (select r -> 'by_method' from pg_temp.recon((select owner_u from fx), (select store_a1 from fx), date '2026-10-05') r),
  '{"card": 35000, "cash": 116000, "vietqr": 29000, "zalo_checkout": 35000}'::jsonb,
  'by method the invoices hold the counter''s cash and card and each gateway''s money; the voided wallet order holds none'
);
select is(
  (select (r -> 'cash' ->> 'invoiced') || '/' || (r -> 'cash' ->> 'expected') || '/' || (r ->> 'paid_not_completed') from pg_temp.recon((select owner_u from fx), (select store_a1 from fx), date '2026-10-05') r),
  '116000/116000/0', 'the cash invoiced equals what the counter expected in the drawers, and nothing was paid for an order still open'
);
select is(
  (select coalesce(sum(p.amount), 0)::bigint from public.order_payments p where p.store_id = (select store_a1 from fx) and p.method in ('vietqr', 'zalo_checkout')
     and p.status = 'succeeded' and p.provider_ref is null),
  0::bigint, 'no online payment counts as paid without the gateway''s transaction reference (no fake paid)'
);
select is(pg_temp.summary(date '2026-10-04'), '0/0/0/0/0/0/0/true', 'boundary: the day before, with no sale and no shift, is 0 everywhere and matched');
select is(
  (select (r ->> 'revenue') || '/' || (r -> 'cash' ->> 'counted') || '/' || (r ->> 'matched') from pg_temp.recon((select manager_u from fx), (select store_a2 from fx), date '2026-10-05') r),
  '35000/35000/true', 'A2''s day holds only its own 35,000 and matches on its own'
);

-- 2. Who reads a day ---------------------------------------------------------------------------------------------
select is(
  (pg_temp.recon((select cashier1_u from fx), (select store_a1 from fx), date '2026-10-05') ->> 'error') || '/'
  || (pg_temp.recon((select viewer_u from fx), (select store_a1 from fx), date '2026-10-05') ->> 'error') || '/'
  || (pg_temp.recon((select manager_a2_u from fx), (select store_a1 from fx), date '2026-10-05') ->> 'error') || '/'
  || (pg_temp.recon((select owner_b_u from fx), (select store_a1 from fx), date '2026-10-05') ->> 'error') || '/'
  || (pg_temp.recon((select cust1_u from fx), (select store_a1 from fx), date '2026-10-05') ->> 'error'),
  '42501/42501/42501/42501/42501', 'staff, a viewer, a manager of another store, another tenant''s owner and a customer do not read the day'
);
select is(pg_temp.recon((select owner_u from fx), (select store_a1 from fx), null) ->> 'error', '22023', 'a day needs a business date');
select ok(
  not has_function_privilege('anon', 'public.manager_day_reconciliation(uuid, date)', 'execute')
  and not has_function_privilege('authenticated', 'app.manager_day_reconciliation(uuid, date, timestamptz)', 'execute'),
  'anon has no reconciliation, and nobody calls the internal half directly'
);

-- 3. The decision table of a day that must not match ------------------------------------------------------------
-- 2026-10-06: an open shift, then an overage that waits for a manager and is confirmed.
select is(pg_temp.clock_in((select cashier1_u from fx), (select store_a1 from fx), 200000, pg_temp.at('2026-10-06 07:00')), 'clocked_in', 'cashier 1 opens 2026-10-06 with 200,000');
insert into o values ('d2', pg_temp.keyed((select cashier1_u from fx), (select store_a1 from fx), 'takeaway', jsonb_build_array(pg_temp.line('cf')), pg_temp.at('2026-10-06 08:00')));
select is(
  pg_temp.take((select cashier1_u from fx), pg_temp.o('d2'), 'cash', pg_temp.at('2026-10-06 08:01')) || '/' || pg_temp.finish((select cashier1_u from fx), pg_temp.o('d2'), pg_temp.at('2026-10-06 08:05')),
  'paid/completed/paid', 'a coffee sold in cash'
);
select is(pg_temp.summary(date '2026-10-06'), '29000/0/0/0/29000/1/0/false', 'decision table: a shift still open: nothing counted yet, not matched');
select is(pg_temp.clock_out((select cashier1_u from fx), 231000, pg_temp.at('2026-10-06 12:00')), 'awaiting_confirmation', 'cashier 1 counts 2,000 too much');
select is(pg_temp.summary(date '2026-10-06'), '29000/0/0/31000/-2000/0/1/false', 'decision table: an overage awaiting a manager: not matched');
select is(pg_temp.call((select manager_u from fx), format($q$select app.manager_confirm_shift(%L, 'Khách đưa dư, chưa trả lại')$q$, pg_temp.open_shift((select cashier1_u from fx)))) ->> 'state',
  'closed', 'a manager confirms the overage with a note');
select is(pg_temp.summary(date '2026-10-06'), '29000/0/0/31000/-2000/0/0/false', 'decision table: once confirmed the day still shows the 2,000 over: not matched');

-- 2026-10-07: two drawers off in opposite directions: the amounts add up, the day waits for both confirmations.
select is(
  pg_temp.clock_in((select cashier1_u from fx), (select store_a1 from fx), 100000, pg_temp.at('2026-10-07 07:00')) || '/'
  || pg_temp.clock_in((select cashier2_u from fx), (select store_a1 from fx), 100000, pg_temp.at('2026-10-07 07:00')),
  'clocked_in/clocked_in', 'two cashiers open 2026-10-07 with 100,000 each'
);
insert into o values ('d3a', pg_temp.keyed((select cashier1_u from fx), (select store_a1 from fx), 'takeaway', jsonb_build_array(pg_temp.line('cf')), pg_temp.at('2026-10-07 08:00')));
insert into o values ('d3b', pg_temp.keyed((select cashier2_u from fx), (select store_a1 from fx), 'takeaway', jsonb_build_array(pg_temp.line('ts')), pg_temp.at('2026-10-07 08:00')));
select is(
  pg_temp.take((select cashier1_u from fx), pg_temp.o('d3a'), 'cash', pg_temp.at('2026-10-07 08:01')) || '/' || pg_temp.finish((select cashier1_u from fx), pg_temp.o('d3a'), pg_temp.at('2026-10-07 08:05')) || '/'
  || pg_temp.take((select cashier2_u from fx), pg_temp.o('d3b'), 'cash', pg_temp.at('2026-10-07 08:01')) || '/' || pg_temp.finish((select cashier2_u from fx), pg_temp.o('d3b'), pg_temp.at('2026-10-07 08:05')) || '/'
  || pg_temp.clock_out((select cashier1_u from fx), 119000, pg_temp.at('2026-10-07 12:00')) || '/'
  || pg_temp.clock_out((select cashier2_u from fx), 145000, pg_temp.at('2026-10-07 12:00')),
  'paid/completed/paid/paid/completed/paid/awaiting_confirmation/awaiting_confirmation', 'one drawer 10,000 short, the other 10,000 over'
);
select is(pg_temp.summary(date '2026-10-07'), '64000/0/0/64000/0/0/2/false', 'decision table: the amounts add up but two shifts await a manager: not matched');
select is(
  (pg_temp.call((select manager_u from fx), format($q$select app.manager_confirm_shift(%L, 'Thối nhầm')$q$, pg_temp.open_shift((select cashier1_u from fx)))) ->> 'state') || '/'
  || (pg_temp.call((select manager_u from fx), format($q$select app.manager_confirm_shift(%L, 'Thối nhầm')$q$, pg_temp.open_shift((select cashier2_u from fx)))) ->> 'state') || '/'
  || pg_temp.summary(date '2026-10-07'),
  'closed/closed/64000/0/0/64000/0/0/0/true', 'decision table: as built, two confirmed offsetting drawers make the day match (each shift keeps its own difference)'
);

-- 2026-10-08: cash taken for an order not completed at the end of the day; it matches once the order completes.
select is(pg_temp.clock_in((select cashier1_u from fx), (select store_a1 from fx), 0, pg_temp.at('2026-10-08 20:00')), 'clocked_in', 'cashier 1 opens 2026-10-08 with an empty drawer');
insert into o values ('d4', pg_temp.keyed((select cashier1_u from fx), (select store_a1 from fx), 'table', jsonb_build_array(pg_temp.line('cf')), pg_temp.at('2026-10-08 21:00')));
select is(
  pg_temp.take((select cashier1_u from fx), pg_temp.o('d4'), 'cash', pg_temp.at('2026-10-08 21:01')) || '/' || pg_temp.clock_out((select cashier1_u from fx), 29000, pg_temp.at('2026-10-08 22:00')),
  'paid/closed', 'a table pays 29,000 in cash and the drawer matches, but the order is still being served'
);
select is(
  pg_temp.summary(date '2026-10-08') || '/' || (pg_temp.recon((select owner_u from fx), (select store_a1 from fx), date '2026-10-08') ->> 'paid_not_completed'),
  '0/0/0/29000/-29000/0/0/false/29000', 'decision table: cash for an order not completed: not matched, and paid_not_completed explains the 29,000'
);
select is(
  pg_temp.finish((select cashier1_u from fx), pg_temp.o('d4'), pg_temp.at('2026-10-09 00:30')) || '/' || pg_temp.summary(date '2026-10-08'),
  'completed/paid/29000/0/0/29000/0/0/0/true', 'state transition: completed after midnight, the order stays on its own day and the day matches'
);

-- 2026-10-09: a cancelled cash order whose refund is still owed when the drawer is counted.
select is(pg_temp.clock_in((select cashier1_u from fx), (select store_a1 from fx), 0, pg_temp.at('2026-10-09 07:00')), 'clocked_in', 'cashier 1 opens 2026-10-09 with an empty drawer');
insert into o values ('d5', pg_temp.keyed((select cashier1_u from fx), (select store_a1 from fx), 'table', jsonb_build_array(pg_temp.line('cf')), pg_temp.at('2026-10-09 08:00')));
select is(
  pg_temp.take((select cashier1_u from fx), pg_temp.o('d5'), 'cash', pg_temp.at('2026-10-09 08:01')) || '/'
  || pg_temp.act((select cashier1_u from fx), pg_temp.o('d5'), 'cancel', pg_temp.at('2026-10-09 08:05'), 'customer_request') || '/'
  || pg_temp.clock_out((select cashier1_u from fx), 29000, pg_temp.at('2026-10-09 12:00')) || '/' || pg_temp.summary(date '2026-10-09'),
  'paid/ok/closed/0/0/0/29000/-29000/0/0/false', 'decision table: a refund still owed keeps the 29,000 in the drawer and the day does not match'
);
select is(
  (select (r ->> 'cash_refund_owed') || '/' || (r ->> 'cancelled_cash') || '/' || ((r ->> 'difference')::bigint + (r ->> 'cancelled_cash')::bigint)
   from pg_temp.recon((select owner_u from fx), (select store_a1 from fx), date '2026-10-09') r),
  '29000/29000/0', 'criterion 6: the day explains its difference: 29,000 in cash still owed back for the cancelled order, the drawer''s cash of cancelled orders'
);

-- 2026-10-10 and 2026-10-11: a completed cash order refunded in cash on the next business day.
select is(pg_temp.clock_in((select cashier1_u from fx), (select store_a1 from fx), 0, pg_temp.at('2026-10-10 07:00')), 'clocked_in', 'cashier 1 opens 2026-10-10 with an empty drawer');
insert into o values ('d6', pg_temp.keyed((select cashier1_u from fx), (select store_a1 from fx), 'takeaway', jsonb_build_array(pg_temp.line('cf')), pg_temp.at('2026-10-10 08:00')));
select is(
  pg_temp.take((select cashier1_u from fx), pg_temp.o('d6'), 'cash', pg_temp.at('2026-10-10 08:01')) || '/' || pg_temp.finish((select cashier1_u from fx), pg_temp.o('d6'), pg_temp.at('2026-10-10 08:05')) || '/'
  || pg_temp.clock_out((select cashier1_u from fx), 29000, pg_temp.at('2026-10-10 12:00')) || '/' || pg_temp.summary(date '2026-10-10'),
  'paid/completed/paid/closed/29000/0/0/29000/0/0/0/true', '2026-10-10 matches when it closes'
);
select is(
  pg_temp.clock_in((select manager_u from fx), (select store_a1 from fx), 100000, pg_temp.at('2026-10-11 07:00')) || '/'
  || (pg_temp.call((select manager_u from fx), format($q$select app.counter_refund(%L, 29000, 'khách đổi ý hôm sau', %L)$q$, pg_temp.o('d6'), pg_temp.at('2026-10-11 09:00'))) ->> 'state') || '/'
  || pg_temp.clock_out((select manager_u from fx), 71000, pg_temp.at('2026-10-11 12:00')),
  'clocked_in/succeeded/closed', 'the next morning a manager on shift hands the 29,000 back from a drawer that then matches'
);
select is(pg_temp.summary(date '2026-10-10'), '29000/0/0/29000/0/0/0/true', 'criterion 6: 2026-10-10 still matches after the refund of the next day');
select is((pg_temp.recon((select owner_u from fx), (select store_a1 from fx), date '2026-10-11') ->> 'matched'), 'true', 'criterion 6: and 2026-10-11, whose drawer handed the refund back, matches too');

select * from finish();
rollback;
