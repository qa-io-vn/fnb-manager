-- Online payment (ADR-062, ADR-067, ADR-068): the providers an owner switches on and the stores' methods that follow,
-- the attempts checkout-order opens for a customer's order or a counter order (replayed by key, resumed under a new
-- key, refused when not the caller's), Zalo's order id linked, and the one settlement of verified provider news: a
-- transfer without a reference ignored, an unknown reference, a partial transfer, a late one and a second one kept for
-- a manager and never applied, the exact one paying and accepting the order once (acceptance criteria 1 and 3), a
-- wallet failure, a wallet payment of a cancelled order turned into a due refund the job sends back (criterion 4);
-- the expiry of attempts, the job's work list, notes and tickets; the manager queue and its resolution.
-- Techniques: decision tables (attempt state x order state x amount x timing), state transitions of an attempt
-- (pending -> succeeded | failed) and of a refund (due -> pending -> succeeded), boundary values (the window's last
-- second and the next; the amount and one dong less), equivalence classes of provider rows, authorisation by role.
begin;
select plan(99);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000029001'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000029002'::uuid as tenant_b,
  'cccccccc-cccc-4ccc-8ccc-000000029001'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000029002'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000029001'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000029002'::uuid as store_a2,
  'ffffffff-ffff-4fff-8fff-000000029003'::uuid as store_b1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000029001'::uuid as brand_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000029002'::uuid as brand_b,
  '99999999-9999-4999-8999-000000029001'::uuid as app_a,
  '99999999-9999-4999-8999-000000029002'::uuid as app_b,
  'eeeeeeee-eeee-4eee-8eee-000000029001'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000029002'::uuid as owner_a1_u,
  'eeeeeeee-eeee-4eee-8eee-000000029003'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000029004'::uuid as staff_u,
  'eeeeeeee-eeee-4eee-8eee-000000029005'::uuid as staff_a2_u,
  'eeeeeeee-eeee-4eee-8eee-000000029006'::uuid as viewer_u,
  'eeeeeeee-eeee-4eee-8eee-000000029007'::uuid as owner_b_u,
  'eeeeeeee-eeee-4eee-8eee-000000029011'::uuid as cust1_u,
  'eeeeeeee-eeee-4eee-8eee-000000029012'::uuid as cust2_u,
  'eeeeeeee-eeee-4eee-8eee-000000029013'::uuid as cust3_u,
  'eeeeeeee-eeee-4eee-8eee-000000029014'::uuid as cust4_u,
  'eeeeeeee-eeee-4eee-8eee-000000029019'::uuid as custb_u,
  timestamptz '2026-11-25 10:00:00+07' as noon;

create temp table ids (name text primary key, id uuid not null);
insert into ids values
  ('cat', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029051'), ('item_cf', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029001'),
  ('item_ts', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029002'), ('cf', 'bbbbbbbb-bbbb-4bbb-8bbb-000000029011'),
  ('ts', 'bbbbbbbb-bbbb-4bbb-8bbb-000000029012'), ('table_a1', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029041');
create function pg_temp.id(p_name text) returns uuid language sql stable as $$ select id from ids where name = p_name $$;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'payments-290-' || right(u.id::text, 4) || '@example.com',
  case when u.tenant is null then '{}'::jsonb else jsonb_build_object('kind', 'customer', 'tenant_id', u.tenant) end
from fx cross join lateral (values
  (fx.owner_u, null::uuid), (fx.owner_a1_u, null), (fx.manager_u, null), (fx.staff_u, null), (fx.staff_a2_u, null), (fx.viewer_u, null),
  (fx.owner_b_u, null), (fx.cust1_u, fx.tenant_a), (fx.cust2_u, fx.tenant_a), (fx.cust3_u, fx.tenant_a), (fx.cust4_u, fx.tenant_a),
  (fx.custb_u, fx.tenant_b)
) as u (id, tenant);
insert into public.tenants (id, slug, name)
select tenant_a, 'payments-290-a', 'Payments 290 A' from fx union all
select tenant_b, 'payments-290-b', 'Payments 290 B' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'payments-290-a', 'Synthetic account A' from fx union all
select account_b, tenant_b, 'mock', 'payments-290-b', 'Synthetic account B' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name, opening_hours)
select s.id, s.tenant, s.account, s.ext, s.code, s.name,
  '{"mon": [["00:00", "24:00"]], "tue": [["00:00", "24:00"]], "wed": [["00:00", "24:00"]], "thu": [["00:00", "24:00"]], "fri": [["00:00", "24:00"]], "sat": [["00:00", "24:00"]], "sun": [["00:00", "24:00"]]}'::jsonb
from fx cross join lateral (values
  (fx.store_a1, fx.tenant_a, fx.account_a, 'p290-a1', 'sa-1', 'Synthetic store A1'),
  (fx.store_a2, fx.tenant_a, fx.account_a, 'p290-a2', 'sa-2', 'Synthetic store A2'),
  (fx.store_b1, fx.tenant_b, fx.account_b, 'p290-b1', 'sb-1', 'Synthetic store B1')
) as s (id, tenant, account, ext, code, name);
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_a, m.user_id, m.role::public.tenant_role, m.store_ids
from fx cross join lateral (values
  (fx.owner_u, 'owner', null::uuid[]), (fx.owner_a1_u, 'owner', array[fx.store_a1]), (fx.manager_u, 'manager', null),
  (fx.staff_u, 'staff', array[fx.store_a1]), (fx.staff_a2_u, 'staff', array[fx.store_a2]), (fx.viewer_u, 'viewer', null)
) as m (user_id, role, store_ids)
union all
select tenant_b, owner_b_u, 'owner', null from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_a, tenant_a, 'brand-1', 'Synthetic brand A', array[store_a1, store_a2] from fx union all
select brand_b, tenant_b, 'brand-1', 'Synthetic brand B', array[store_b1] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_a, tenant_a, brand_a, 'synthetic-290-zapp-a', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx union all
select app_b, tenant_b, brand_b, 'synthetic-290-zapp-b', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx;
insert into public.mini_apps (tenant_id, brand_id, kind, external_id, browsable, title, header_title_vi, header_title_en,
  header_color_light, header_color_dark, text_color_light, text_color_dark)
select tenant_a, brand_a, 'customer', 'synthetic-290-mini-a', true, 'Cửa hàng mẫu', 'Cửa hàng mẫu', 'Sample store',
  '#ffffff', '#000000', 'black', 'white' from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id)
select tenant_a, app_a, 'syn-zalo-290-1', cust1_u from fx union all
select tenant_a, app_a, 'syn-zalo-290-2', cust2_u from fx union all
select tenant_a, app_a, 'syn-zalo-290-3', cust3_u from fx union all
select tenant_a, app_a, 'syn-zalo-290-4', cust4_u from fx union all
select tenant_b, app_b, 'syn-zalo-290-9', custb_u from fx;
insert into public.store_ordering_settings (store_id, tenant_id, till_mode, ordering_enabled, order_types, staff_presence_required)
select store_a1, tenant_a, 'native', true, array['table', 'takeaway'], false from fx union all
select store_a2, tenant_a, 'native', true, array['table'], false from fx union all
select store_b1, tenant_b, 'native', true, array['table'], false from fx;
insert into public.menu_categories (id, tenant_id, brand_id, name, sort_order)
select pg_temp.id('cat'), tenant_a, brand_a, 'Đồ uống', 10 from fx;
insert into public.menu_items (id, tenant_id, brand_id, category_id, name, counts_for_stamps, order_types)
select pg_temp.id('item_cf'), tenant_a, brand_a, pg_temp.id('cat'), 'Cà phê', true, array['table', 'takeaway'] from fx union all
select pg_temp.id('item_ts'), tenant_a, brand_a, pg_temp.id('cat'), 'Trà sữa', true, array['table', 'takeaway'] from fx;
insert into public.menu_item_sizes (id, tenant_id, brand_id, item_id, label, price, sort_order, is_default)
select pg_temp.id('cf'), tenant_a, brand_a, pg_temp.id('item_cf'), null, 29000, 10, true from fx union all
select pg_temp.id('ts'), tenant_a, brand_a, pg_temp.id('item_ts'), null, 35000, 10, true from fx;
insert into public.store_tables (id, tenant_id, store_id, label, area)
select pg_temp.id('table_a1'), tenant_a, store_a1, 'Bàn 1', 'Tầng 1' from fx;
create temp table tok as
select app.table_qr_token(t.tenant_id, t.id, t.qr_version) as token from public.store_tables t where t.id = pg_temp.id('table_a1');

-- Helpers: a caller's claims for one statement (JSON, or {"error": SQLSTATE}); a table order of the store by a customer.
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
create function pg_temp.at(p_minutes numeric) returns timestamptz language sql stable as $$ select noon + make_interval(secs => p_minutes * 60) from fx $$;
create function pg_temp.place(p_user uuid, p_payment text, p_size text default 'cf') returns uuid language sql as $$
  select (pg_temp.call(p_user, format($q$select app.customer_place_order(%L::jsonb, %L)$q$,
    jsonb_build_object('request_id', gen_random_uuid(), 'store', 'sa-1', 'type', 'table', 'table_token', (select token from tok),
      'payment', p_payment, 'lines', jsonb_build_array(jsonb_build_object('size', pg_temp.id(p_size), 'qty', 1)),
      'expected_total', (select s.price from public.menu_item_sizes s where s.id = pg_temp.id(p_size))::integer), pg_temp.at(0))) -> 'order' ->> 'id')::uuid;
$$;
create function pg_temp.provider(p_user uuid, p_request jsonb) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.checkout_set_provider(%L::jsonb, %L)$q$, p_request, pg_temp.at(-60)));
$$;
create function pg_temp.vietqr(p_mode text default 'sandbox', p_store uuid default null) returns jsonb language sql stable as $$
  select jsonb_build_object('brand', brand_a, 'store', p_store, 'method', 'vietqr', 'adapter', 'mock', 'mode', p_mode, 'secret_name', 'PAYMENT_BANK_BRAND_1',
    'settings', jsonb_build_object('bank_bin', '970400', 'bank_name', 'Ngân hàng mẫu', 'account_number', '0123456789', 'account_name', 'CUA HANG MAU',
      'reference_prefix', 'FNB')) from fx;
$$;
create function pg_temp.begin(p_user uuid, p_order uuid, p_method text, p_key text, p_minutes numeric default 1, p_for text default 'customer')
returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  begin
    v := app.checkout_begin(jsonb_build_object('user_id', p_user, 'order_id', p_order, 'method', p_method, 'idempotency_key', p_key, 'for', p_for), pg_temp.at(p_minutes));
  exception when others then
    v := jsonb_build_object('error', sqlstate);
  end;
  return v;
end;
$$;
create function pg_temp.settle(p_method text, p_ref text, p_amount numeric, p_success boolean, p_extra jsonb default '{}', p_minutes numeric default 2)
returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  begin
    v := app.checkout_settle(jsonb_build_object('provider_id', (select p.id from public.payment_providers p where p.brand_id = (select brand_a from fx)
      and p.method = p_method and p.store_id is null), 'provider_ref', p_ref, 'amount', p_amount, 'success', p_success) || p_extra, pg_temp.at(p_minutes));
  exception when others then
    v := jsonb_build_object('error', sqlstate);
  end;
  return v;
end;
$$;
create function pg_temp.order_row(p_order uuid) returns public.orders language sql stable as $$ select * from public.orders where id = p_order $$;
create function pg_temp.rls_count(p_user uuid, p_table text) returns bigint language plpgsql as $$
declare
  v bigint;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute format('select count(*) from public.%I', p_table) into v;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$$;

-- 1. Providers --------------------------------------------------------------------------------------------------

select is(pg_temp.provider((select owner_u from fx), pg_temp.vietqr()) ->> 'state', 'saved', 'an owner with every store switches the mock VietQR on in sandbox');
select matches(pg_temp.provider((select owner_u from fx), pg_temp.vietqr()) ->> 'webhook_path', '^bank-webhook/[0-9a-f-]{36}$',
  'the answer names the bank-webhook path to give the bank service (unchanged the second time)');
select is((select payment_methods from public.store_ordering_settings where store_id = (select store_a1 from fx)), array['counter', 'vietqr'],
  'every store of the brand now offers VietQR');
select is(pg_temp.provider((select owner_u from fx), jsonb_build_object('brand', (select brand_a from fx), 'method', 'zalo_checkout', 'mode', 'sandbox',
  'secret_name', 'ZALO_CHECKOUT_KEY_BRAND_1', 'settings', jsonb_build_object('wallet_method', 'ZALOPAY'))) ->> 'state', 'saved', 'and the Checkout SDK with ZaloPay forced');
select is((select payment_methods from public.store_ordering_settings where store_id = (select store_a2 from fx)), array['counter', 'zalo_checkout', 'vietqr'],
  'the methods follow in their fixed order');
select is(pg_temp.provider((select manager_u from fx), pg_temp.vietqr()) ->> 'error', '42501', 'a manager does not set providers');
select is(pg_temp.provider((select owner_a1_u from fx), pg_temp.vietqr()) ->> 'error', '42501', 'nor an owner without every store of the brand');
select is(pg_temp.provider((select owner_b_u from fx), pg_temp.vietqr()) ->> 'error', '42501', 'nor another tenant''s owner');
select is(pg_temp.provider((select cust1_u from fx), pg_temp.vietqr()) ->> 'error', '42501', 'nor a customer');
select is(pg_temp.provider((select owner_u from fx), pg_temp.vietqr() || jsonb_build_object('secret_name', 'PAYMENT_BANK_A1B2C3D4E5F6G7H8')) ->> 'error', '22023',
  'a secret name shaped like a pasted key is refused');
select is(pg_temp.provider((select owner_u from fx), pg_temp.vietqr('live')) ->> 'error', '22023', 'a mock never runs live');
select is(pg_temp.provider((select owner_u from fx), pg_temp.vietqr() || jsonb_build_object('settings', jsonb_build_object('bank_bin', '970400'))) ->> 'error', '22023',
  'incomplete VietQR settings are refused');
select is(pg_temp.provider((select owner_u from fx), pg_temp.vietqr() || jsonb_build_object('settings', (pg_temp.vietqr() -> 'settings') || '{"api_key": "x"}')) ->> 'error', '22023',
  'a setting that is not public (or not known) is refused');
select is(pg_temp.provider((select owner_u from fx), jsonb_build_object('brand', (select brand_a from fx), 'store', (select store_a1 from fx), 'method', 'zalo_checkout',
  'mode', 'live', 'secret_name', 'ZALO_CHECKOUT_KEY_BRAND_1')) ->> 'error', '22023', 'the Checkout SDK is per brand, never per store');
select is(pg_temp.provider((select owner_u from fx), pg_temp.vietqr('sandbox', (select store_b1 from fx))) ->> 'error', '22023', 'a store of another brand is refused');
select is((select count(*) from public.payment_provider_changes c join public.payment_providers p on p.id = c.provider_id where p.brand_id = (select brand_a from fx)),
  2::bigint, 'each change is logged once (the unchanged repeat is not)');
select throws_ok($$update public.payment_provider_changes set after = '{}'$$, '42501', null, 'the change log is append-only');
select is(pg_temp.provider((select owner_u from fx), pg_temp.vietqr('off', (select store_a2 from fx))) ->> 'state', 'saved', 'an owner switches VietQR off for one store');
select is((select payment_methods from public.store_ordering_settings where store_id = (select store_a2 from fx)), array['counter', 'zalo_checkout'],
  'that store stops offering it');
select is((select payment_methods from public.store_ordering_settings where store_id = (select store_a1 from fx)), array['counter', 'zalo_checkout', 'vietqr'],
  'the other store keeps it');
select is(pg_temp.call((select staff_u from fx), format('select app.counter_payment_methods(%L)', (select store_a1 from fx))) -> 'methods',
  '["zalo_checkout", "vietqr"]'::jsonb, 'the counter reads the online methods of its store');
select is(pg_temp.call((select staff_u from fx), format('select app.counter_payment_methods(%L)', (select store_a1 from fx))) ->> 'vietqr_mode', 'sandbox',
  'with the VietQR mode');
select is(pg_temp.call((select staff_a2_u from fx), format('select app.counter_payment_methods(%L)', (select store_a1 from fx))) ->> 'error', '42501',
  'staff of another store do not');
select is(pg_temp.rls_count((select owner_u from fx), 'payment_providers'), 3::bigint, 'an owner reads the brand''s provider rows');
select is(pg_temp.rls_count((select staff_u from fx), 'payment_providers'), 0::bigint, 'staff read none');
select is(pg_temp.rls_count((select viewer_u from fx), 'payment_providers'), 0::bigint, 'a viewer reads none');
select is(pg_temp.rls_count((select owner_b_u from fx), 'payment_providers'), 0::bigint, 'another tenant reads none');

-- 2. Opening attempts -----------------------------------------------------------------------------------------------

create temp table o (name text primary key, id uuid);
insert into o values ('q1', pg_temp.place((select cust1_u from fx), 'vietqr'));
select is((pg_temp.order_row((select id from o where name = 'q1'))).status::text, 'awaiting_payment', 'a VietQR order waits for its payment');

create temp table a (name text primary key, answer jsonb);
insert into a values ('q1', pg_temp.begin((select cust1_u from fx), (select id from o where name = 'q1'), 'vietqr', 'key-290-q1-a'));
select is((select answer ->> 'state' from a where name = 'q1'), 'pending', 'checkout_begin opens a pending attempt');
select matches((select answer -> 'payment' ->> 'reference' from a where name = 'q1'), '^FNB[2-9A-HJ-NP-Z]{8}$', 'with a reference of the provider''s prefix');
select is((select (answer -> 'payment' ->> 'amount')::integer from a where name = 'q1'), 29000, 'of the order''s total');
select is((select (answer -> 'payment' ->> 'expires_at')::timestamptz from a where name = 'q1'), (pg_temp.order_row((select id from o where name = 'q1'))).payment_due_at,
  'expiring with the order''s payment window');
select is((select answer -> 'provider' ->> 'secret_name' from a where name = 'q1'), 'PAYMENT_BANK_BRAND_1', 'naming the secret, never holding it');
select is((select answer -> 'order' ->> 'store_name' from a where name = 'q1'), 'Synthetic store A1', 'with the store''s name for the sheet');
select is((select jsonb_array_length(answer -> 'order' -> 'lines') from a where name = 'q1'), 1, 'and the order''s lines');
select is(pg_temp.begin((select cust1_u from fx), (select id from o where name = 'q1'), 'vietqr', 'key-290-q1-a') -> 'payment' ->> 'id',
  (select answer -> 'payment' ->> 'id' from a where name = 'q1'), 'the same key answers the same attempt');
select is(pg_temp.begin((select cust1_u from fx), (select id from o where name = 'q1'), 'vietqr', 'key-290-q1-b') -> 'payment' ->> 'reference',
  (select answer -> 'payment' ->> 'reference' from a where name = 'q1'), 'a new key resumes the pending attempt with its reference');
select is(pg_temp.begin((select cust1_u from fx), (select id from o where name = 'q1'), 'vietqr', 'key-290-q1-b') ->> 'resumed', 'true', 'and says so');
select is((select count(*) from public.order_payments where order_id = (select id from o where name = 'q1')), 1::bigint, 'one attempt for all three calls');
select is(pg_temp.begin((select cust2_u from fx), (select id from o where name = 'q1'), 'vietqr', 'key-290-q1-c') ->> 'refusal', 'unknown_order',
  'another customer''s order is unknown');
select is(pg_temp.begin((select cust1_u from fx), (select id from o where name = 'q1'), 'zalo_checkout', 'key-290-q1-d') ->> 'refusal', 'method_differs',
  'another method than the order''s is refused');
select is(pg_temp.begin((select cust1_u from fx), (select id from o where name = 'q1'), 'vietqr', 'short') ->> 'error', '22023', 'a key under 8 characters is refused');
select is(pg_temp.begin((select staff_u from fx), (select id from o where name = 'q1'), 'vietqr', 'key-290-q1-e', 1, 'counter') ->> 'refusal', 'not_payable',
  'the counter does not open a QR for an order waiting for the customer''s own payment');
select is(app.checkout_link(jsonb_build_object('user_id', (select cust1_u from fx), 'order_id', (select id from o where name = 'q1'),
  'payment_id', (select answer -> 'payment' ->> 'id' from a where name = 'q1'), 'platform_order_id', 'zorder-290-1')) ->> 'state', 'linked',
  'Zalo''s order id of the bank-transfer popup is linked');
select is(app.checkout_link(jsonb_build_object('user_id', (select cust2_u from fx), 'order_id', (select id from o where name = 'q1'),
  'payment_id', (select answer -> 'payment' ->> 'id' from a where name = 'q1'), 'platform_order_id', 'zorder-290-x')) ->> 'refusal', 'unknown_payment',
  'not by another customer');
select is((select platform_order_id from app.payment_attempts where payment_id = (select (answer -> 'payment' ->> 'id')::uuid from a where name = 'q1')),
  'zorder-290-1', 'whose link changed nothing');

-- 3. Settling a VietQR ------------------------------------------------------------------------------------------------

select is(pg_temp.settle('vietqr', 'mock:tx-290-0', 29000, true, '{"candidates": []}') ->> 'outcome', 'ignored', 'a transfer without a reference is not ours');
select is(pg_temp.settle('vietqr', 'mock:tx-290-1', 29000, true, '{"candidates": ["FNB22222222"]}') ->> 'reason', 'unknown_reference',
  'a reference nobody issued goes to the manager queue');
select is(pg_temp.settle('vietqr', 'mock:tx-290-2', 28000, true,
  jsonb_build_object('candidates', jsonb_build_array((select answer -> 'payment' ->> 'reference' from a where name = 'q1')))) ->> 'reason', 'amount_differs',
  'a transfer 1,000 short is partial: kept for a manager');
select is((pg_temp.order_row((select id from o where name = 'q1'))).payment_status::text, 'unpaid', 'which pays nothing');
select is((select status from public.order_payments where id = (select (answer -> 'payment' ->> 'id')::uuid from a where name = 'q1')), 'pending',
  'and leaves the attempt waiting for the right amount');
select is(pg_temp.settle('vietqr', 'mock:tx-290-3', 29000, true,
  jsonb_build_object('candidates', jsonb_build_array('FNB33333333', (select answer -> 'payment' ->> 'reference' from a where name = 'q1')))) ->> 'outcome', 'confirmed',
  'the exact amount with the reference pays the order (criterion 1)');
select is((pg_temp.order_row((select id from o where name = 'q1'))).status::text, 'accepted', 'which is accepted');
select ok((pg_temp.order_row((select id from o where name = 'q1'))).order_no is not null, 'with its number');
select is(pg_temp.settle('vietqr', 'mock:tx-290-3', 29000, true,
  jsonb_build_object('candidates', jsonb_build_array((select answer -> 'payment' ->> 'reference' from a where name = 'q1')))) ->> 'outcome', 'replayed',
  'the same notification again is a replay');
select is(pg_temp.settle('vietqr', 'mock:tx-290-4', 29000, true,
  jsonb_build_object('candidates', jsonb_build_array((select answer -> 'payment' ->> 'reference' from a where name = 'q1')))) ->> 'reason', 'duplicate',
  'a second transfer for the paid order goes to a manager, never paid twice (criterion 3)');
select is((select count(*) from public.order_payments where order_id = (select id from o where name = 'q1') and status = 'succeeded'), 1::bigint,
  'one succeeded payment');
select is(pg_temp.settle('vietqr', 'mock:tx-290-4', 29000, true) ->> 'state', 'exception', 'a repeat of the queued one answers its first outcome');
select is(pg_temp.settle('vietqr', 'mock:tx-290-5', -1, true) ->> 'error', '22023', 'a negative amount is malformed');

insert into o values ('q2', pg_temp.place((select cust2_u from fx), 'vietqr'));
insert into a values ('q2', pg_temp.begin((select cust2_u from fx), (select id from o where name = 'q2'), 'vietqr', 'key-290-q2-a'));
select is(pg_temp.settle('vietqr', 'mock:tx-290-6', 29000, true,
  jsonb_build_object('candidates', jsonb_build_array((select answer -> 'payment' ->> 'reference' from a where name = 'q2'))), 15.01) ->> 'reason', 'late',
  'the exact amount a second after the window is late: kept for a manager');
select is((pg_temp.order_row((select id from o where name = 'q2'))).payment_status::text, 'unpaid', 'and never pays the order');

insert into o values ('q3', pg_temp.place((select cust3_u from fx), 'vietqr'));
insert into a values ('q3', pg_temp.begin((select cust3_u from fx), (select id from o where name = 'q3'), 'vietqr', 'key-290-q3-a'));
select is(pg_temp.call((select cust3_u from fx), format('select app.customer_cancel_order(%L, %L)', (select id from o where name = 'q3'), pg_temp.at(1.5))) ->> 'state',
  'cancelled', 'the customer leaves midway and cancels');
select is(pg_temp.settle('vietqr', 'mock:tx-290-7', 29000, true,
  jsonb_build_object('candidates', jsonb_build_array((select answer -> 'payment' ->> 'reference' from a where name = 'q3')))) ->> 'reason', 'late',
  'money for the cancelled order is never applied (criterion 3)');

-- 4. Settling the Checkout SDK -------------------------------------------------------------------------------------

insert into o values ('w1', pg_temp.place((select cust4_u from fx), 'zalo_checkout', 'ts'));
insert into a values ('w1', pg_temp.begin((select cust4_u from fx), (select id from o where name = 'w1'), 'zalo_checkout', 'key-290-w1-a'));
select matches((select answer -> 'payment' ->> 'reference' from a where name = 'w1'), '^ZC[2-9A-HJ-NP-Z]{8}$', 'a wallet attempt has a ZC reference');
select is((select answer -> 'provider' ->> 'app_id' from a where name = 'w1'), 'synthetic-290-mini-a', 'and the customer Mini App''s id');
select is(pg_temp.settle('zalo_checkout', 'ztx-290-1', 35000, false,
  jsonb_build_object('reference', (select answer -> 'payment' ->> 'reference' from a where name = 'w1'), 'reason', 'result -1: declined')) ->> 'outcome', 'failed',
  'a failed callback fails the attempt');
select is((pg_temp.order_row((select id from o where name = 'w1'))).status::text, 'awaiting_payment', 'the order still waits (retry or pay at the counter)');
insert into a values ('w1b', pg_temp.begin((select cust4_u from fx), (select id from o where name = 'w1'), 'zalo_checkout', 'key-290-w1-b', 3));
select isnt((select answer -> 'payment' ->> 'reference' from a where name = 'w1b'), (select answer -> 'payment' ->> 'reference' from a where name = 'w1'),
  'a retry after a failure opens a new attempt with a new reference');
select is(pg_temp.settle('zalo_checkout', 'ztx-290-2', 35000, true,
  jsonb_build_object('reference', 'ZC22222222', 'platform_order_id', 'zorder-290-2')) ->> 'reason', 'unknown_reference',
  'a verified payment naming no attempt of ours is kept for a manager');
select is(pg_temp.settle('zalo_checkout', 'ztx-290-3', 35000, true,
  jsonb_build_object('reference', (select answer -> 'payment' ->> 'reference' from a where name = 'w1b'), 'platform_order_id', 'zorder-290-3'), 4) ->> 'outcome', 'confirmed',
  'a verified wallet payment pays and accepts the order (criterion 1)');
select is((select platform_order_id from app.payment_attempts where payment_id = (select (answer -> 'payment' ->> 'id')::uuid from a where name = 'w1b')),
  'zorder-290-3', 'Zalo''s order id is kept from the callback');

-- A wallet paid after its order was cancelled: the money is a due refund that the job sends back (criterion 4).
insert into o values ('w2', pg_temp.place((select cust1_u from fx), 'zalo_checkout', 'ts'));
insert into a values ('w2', pg_temp.begin((select cust1_u from fx), (select id from o where name = 'w2'), 'zalo_checkout', 'key-290-w2-a'));
select is(pg_temp.call((select cust1_u from fx), format('select app.customer_cancel_order(%L, %L)', (select id from o where name = 'w2'), pg_temp.at(1.5))) ->> 'state',
  'cancelled', 'a wallet order cancelled while its sheet is open');
select is(pg_temp.settle('zalo_checkout', 'ztx-290-4', 35000, true,
  jsonb_build_object('reference', (select answer -> 'payment' ->> 'reference' from a where name = 'w2'))) ->> 'refund_due', 'true',
  'the wallet payment that still arrives becomes a due refund');
select is((select status from public.order_refunds where order_id = (select id from o where name = 'w2')), 'due', 'of the whole amount, due');
select is((select jsonb_array_length(app.checkout_job_work(20, pg_temp.at(5)) -> 'refunds')), 1, 'the job lists it with the transaction to refund');
select is((select status from public.order_refunds where order_id = (select id from o where name = 'w2')), 'pending', 'having asked the provider for it');
select is(app.checkout_job_note(jsonb_build_object('kind', 'refund', 'refund_id', (select id from public.order_refunds where order_id = (select id from o where name = 'w2')),
  'provider_refund_id', 'zrefund-290-1'), pg_temp.at(5)) ->> 'state', 'noted', 'the job notes the provider''s refund id');
select is((select jsonb_array_length(app.checkout_job_work(20, pg_temp.at(6)) -> 'refunds')), 0, 'and does not ask again before its next try');
select is((select jsonb_array_length(app.checkout_job_work(20, pg_temp.at(10.5)) -> 'refunds')), 1, 'but after it, to follow the refund');
select is(app.checkout_refund_confirm((select id from public.order_refunds where order_id = (select id from o where name = 'w2')), true, 'zrefund-290-1', null, pg_temp.at(11))
  ->> 'order_payment_status', 'refunded', 'the provider''s confirmation settles it: refunded exactly');

-- 5. The counter's VietQR for a walk-in ------------------------------------------------------------------------------

insert into o values ('c1', (pg_temp.call((select staff_u from fx), format($q$select app.counter_create_order(%L, %L::jsonb, %L)$q$, (select store_a1 from fx),
  jsonb_build_object('request_id', gen_random_uuid(), 'type', 'takeaway', 'lines', jsonb_build_array(jsonb_build_object('size', pg_temp.id('cf'), 'qty', 2)))::text,
  pg_temp.at(0))) -> 'order' ->> 'id')::uuid);
insert into a values ('c1', pg_temp.begin((select staff_u from fx), (select id from o where name = 'c1'), 'vietqr', 'key-290-c1-a', 1, 'counter'));
select is((select answer ->> 'state' from a where name = 'c1'), 'pending', 'staff of the store open a VietQR for a counter order');
select is((select (answer -> 'payment' ->> 'expires_at')::timestamptz from a where name = 'c1'), pg_temp.at(16), 'expiring after the store''s window');
select is(pg_temp.begin((select staff_a2_u from fx), (select id from o where name = 'c1'), 'vietqr', 'key-290-c1-b', 1, 'counter') ->> 'refusal', 'unknown_order',
  'staff of another store do not');
select is(pg_temp.begin((select staff_u from fx), (select id from o where name = 'c1'), 'zalo_checkout', 'key-290-c1-c', 1, 'counter') ->> 'error', '22023',
  'the counter opens no wallet');
select is(pg_temp.settle('vietqr', 'mock:tx-290-8', 58000, true,
  jsonb_build_object('candidates', jsonb_build_array((select answer -> 'payment' ->> 'reference' from a where name = 'c1')))) ->> 'outcome', 'confirmed',
  'the walk-in''s exact transfer pays the counter order');
select is((pg_temp.order_row((select id from o where name = 'c1'))).payment_status::text, 'paid', 'which the counter sees as paid');

-- 6. Expiry, the job's ticket --------------------------------------------------------------------------------------

select is(app.checkout_expire_attempts(pg_temp.at(16)), 2,
  'past their windows, the late VietQR attempt and the cancelled order''s are failed as expired');
select is((select failure_reason from public.order_payments where id = (select (answer -> 'payment' ->> 'id')::uuid from a where name = 'q2')), 'expired',
  'with the reason');
select is(app.checkout_tick(pg_temp.at(17)) ->> 'dispatched', '0', 'the tick wakes no function while the job is not enabled');
select is(app.checkout_job_claim('aaaaaaaa-aaaa-4aaa-8aaa-000000029098'), false, 'an unknown ticket is not claimed');
insert into app.checkout_job_tickets (ticket, issued_at, expires_at) values ('aaaaaaaa-aaaa-4aaa-8aaa-000000029097', now(), now() + interval '5 minutes');
select is(app.checkout_job_claim('aaaaaaaa-aaaa-4aaa-8aaa-000000029097'), true, 'a ticket is claimed once');
select is(app.checkout_job_claim('aaaaaaaa-aaaa-4aaa-8aaa-000000029097'), false, 'and only once');

-- 7. The manager queue -------------------------------------------------------------------------------------------

select is((pg_temp.call((select manager_u from fx), format('select app.manager_payment_exceptions(%L, %L, 50)', (select store_a1 from fx), 'open'))) ->> 'open', '6',
  'the manager sees the six pieces of money that were not applied');
select is(pg_temp.call((select staff_u from fx), format('select app.manager_payment_exceptions(%L, %L, 50)', (select store_a1 from fx), 'open')) ->> 'error', '42501',
  'staff do not');
select is(pg_temp.rls_count((select staff_u from fx), 'payment_exceptions'), 0::bigint, 'nor read the table');
select is(pg_temp.call((select manager_u from fx), format('select app.manager_resolve_payment_exception(%L, %L, %L)',
  (select id from public.payment_exceptions where provider_ref = 'mock:tx-290-2'), 'refunded', '')) ->> 'error', '22023', 'a resolution needs a note');
select is(pg_temp.call((select manager_u from fx), format('select app.manager_resolve_payment_exception(%L, %L, %L)',
  (select id from public.payment_exceptions where provider_ref = 'mock:tx-290-2'), 'refunded', 'Đã chuyển trả 28.000đ')) ->> 'state', 'refunded',
  'a manager records the partial transfer as handed back');
select is(pg_temp.call((select manager_u from fx), format('select app.manager_resolve_payment_exception(%L, %L, %L)',
  (select id from public.payment_exceptions where provider_ref = 'mock:tx-290-2'), 'dismissed', 'x')) ->> 'refusal', 'already_resolved',
  'a second, different resolution is refused');
select is((select count(*) from public.order_events where order_id = (select id from o where name = 'q1') and action = 'payment_exception_refunded'), 1::bigint,
  'and the order''s log names who resolved it');

select * from finish();
rollback;
