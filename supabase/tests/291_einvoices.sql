-- E-invoices of native orders (ADR-063, ADR-069): the provider an owner switches on, the sale invoice queued when an
-- order becomes paid at the counter or online, the job's claims and results through the document's whole life, the
-- corrections a refund or an undone payment needs (computed when the job takes them, so nothing is counted twice),
-- the counter's pill, the managers' list with its alert and retry, and who may read and call what.
-- Techniques: state transitions of a document (queued -> issuing -> issued | failed -> issuing ... -> given up;
-- sale -> adjusted | cancelled | replaced; every claim answered once), decision tables (provider on or off x paid or not
-- x what reached the provider), boundary values (the back-off's minute, the claim's 5 minutes, the 10th attempt),
-- equivalence classes of provider rows and error classes, error guessing (a stale or forged claim, a refund while the
-- job is out, a payment undone and taken again), authorisation by role.
begin;
select plan(147);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000029101'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000029102'::uuid as tenant_b,
  'cccccccc-cccc-4ccc-8ccc-000000029101'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000029102'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000029101'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000029102'::uuid as store_a2,
  'ffffffff-ffff-4fff-8fff-000000029103'::uuid as store_b1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000029101'::uuid as brand_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000029102'::uuid as brand_b,
  '99999999-9999-4999-8999-000000029101'::uuid as app_a,
  '99999999-9999-4999-8999-000000029102'::uuid as app_b,
  'eeeeeeee-eeee-4eee-8eee-000000029101'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000029102'::uuid as owner_a1_u,
  'eeeeeeee-eeee-4eee-8eee-000000029103'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000029104'::uuid as staff_u,
  'eeeeeeee-eeee-4eee-8eee-000000029105'::uuid as staff_a2_u,
  'eeeeeeee-eeee-4eee-8eee-000000029106'::uuid as viewer_u,
  'eeeeeeee-eeee-4eee-8eee-000000029107'::uuid as owner_b_u,
  'eeeeeeee-eeee-4eee-8eee-000000029111'::uuid as cust1_u,
  'eeeeeeee-eeee-4eee-8eee-000000029112'::uuid as cust2_u,
  'eeeeeeee-eeee-4eee-8eee-000000029119'::uuid as custb_u;

create temp table ids (name text primary key, id uuid not null);
insert into ids values
  ('cat', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029151'), ('item_cf', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029101'),
  ('cf', 'bbbbbbbb-bbbb-4bbb-8bbb-000000029111'), ('table_a1', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029141'),
  ('table_a2', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029142');
create function pg_temp.id(p_name text) returns uuid language sql stable as $$ select id from ids where name = p_name $$;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'einvoice-291-' || right(u.id::text, 4) || '@example.com',
  case when u.tenant is null then '{}'::jsonb else jsonb_build_object('kind', 'customer', 'tenant_id', u.tenant) end
from fx cross join lateral (values
  (fx.owner_u, null::uuid), (fx.owner_a1_u, null), (fx.manager_u, null), (fx.staff_u, null), (fx.staff_a2_u, null), (fx.viewer_u, null),
  (fx.owner_b_u, null), (fx.cust1_u, fx.tenant_a), (fx.cust2_u, fx.tenant_a), (fx.custb_u, fx.tenant_b)
) as u (id, tenant);
insert into public.tenants (id, slug, name)
select tenant_a, 'einvoice-291-a', 'E-invoice 291 A' from fx union all
select tenant_b, 'einvoice-291-b', 'E-invoice 291 B' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'einvoice-291-a', 'Synthetic account A' from fx union all
select account_b, tenant_b, 'mock', 'einvoice-291-b', 'Synthetic account B' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name, opening_hours)
select s.id, s.tenant, s.account, s.ext, s.code, s.name,
  '{"mon": [["00:00", "24:00"]], "tue": [["00:00", "24:00"]], "wed": [["00:00", "24:00"]], "thu": [["00:00", "24:00"]], "fri": [["00:00", "24:00"]], "sat": [["00:00", "24:00"]], "sun": [["00:00", "24:00"]]}'::jsonb
from fx cross join lateral (values
  (fx.store_a1, fx.tenant_a, fx.account_a, 'e291-a1', 'sa-1', 'Synthetic store A1'),
  (fx.store_a2, fx.tenant_a, fx.account_a, 'e291-a2', 'sa-2', 'Synthetic store A2'),
  (fx.store_b1, fx.tenant_b, fx.account_b, 'e291-b1', 'sb-1', 'Synthetic store B1')
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
select app_a, tenant_a, brand_a, 'synthetic-291-zapp-a', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx union all
select app_b, tenant_b, brand_b, 'synthetic-291-zapp-b', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id)
select tenant_a, app_a, 'syn-zalo-291-1', cust1_u from fx union all
select tenant_a, app_a, 'syn-zalo-291-2', cust2_u from fx union all
select tenant_b, app_b, 'syn-zalo-291-9', custb_u from fx;
insert into public.store_ordering_settings (store_id, tenant_id, till_mode, ordering_enabled, order_types, staff_presence_required)
select store_a1, tenant_a, 'native', true, array['table'], false from fx union all
select store_a2, tenant_a, 'native', true, array['table'], false from fx union all
select store_b1, tenant_b, 'native', true, array['table'], false from fx;
insert into public.menu_categories (id, tenant_id, brand_id, name, sort_order)
select pg_temp.id('cat'), tenant_a, brand_a, 'Đồ uống', 10 from fx;
insert into public.menu_items (id, tenant_id, brand_id, category_id, name, counts_for_stamps, order_types)
select pg_temp.id('item_cf'), tenant_a, brand_a, pg_temp.id('cat'), 'Cà phê sữa', true, array['table'] from fx;
insert into public.menu_item_sizes (id, tenant_id, brand_id, item_id, label, price, sort_order, is_default)
select pg_temp.id('cf'), tenant_a, brand_a, pg_temp.id('item_cf'), null, 29000, 10, true from fx;
insert into public.store_tables (id, tenant_id, store_id, label, area)
select pg_temp.id('table_a1'), tenant_a, store_a1, 'Bàn 1', 'Tầng 1' from fx union all
select pg_temp.id('table_a2'), tenant_a, store_a2, 'Bàn 2', 'Tầng 1' from fx;
-- Cash is taken and handed back only on a shift at the store (migrations counter_payment_needs_shift and
-- cash_refund_needs_shift): the staff of both stores and the manager who refunds at A1 are clocked in.
insert into public.staff_shifts (tenant_id, store_id, user_id, business_date, clock_in_at, status)
select tenant_a, store_a1, staff_u, date '2026-11-25', timestamptz '2026-11-25 06:00+07', 'open' from fx union all
select tenant_a, store_a2, staff_a2_u, date '2026-11-25', timestamptz '2026-11-25 06:00+07', 'open' from fx union all
select tenant_a, store_a1, manager_u, date '2026-11-25', timestamptz '2026-11-25 06:00+07', 'open' from fx;

-- Helpers: a caller's claims for one statement (JSON, or {"error": SQLSTATE}); Vietnam time; orders and payments.
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
create function pg_temp.provider(p_user uuid, p_request jsonb) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.einvoice_set_provider(%L::jsonb, %L)$q$, p_request, pg_temp.at('2026-11-25 07:00')));
$$;
create function pg_temp.mock(p_mode text default 'sandbox', p_store uuid default null, p_settings jsonb default '{}') returns jsonb language sql stable as $$
  select jsonb_build_object('brand', brand_a, 'store', p_store, 'adapter', 'mock', 'mode', p_mode, 'secret_name', 'EINVOICE_KEY_BRAND_1',
    'settings', jsonb_build_object('seller_tax_code', '0312345678', 'template', '2', 'series', 'C26MAA', 'vat_rate', 'none') || p_settings) from fx;
$$;
-- An order keyed at the counter of a store by its staff member: one coffee (29,000), accepted and unpaid.
create function pg_temp.keyed(p_store uuid default null, p_at text default '2026-11-25 09:00') returns uuid language sql as $$
  select (pg_temp.call(case when coalesce(p_store, (select store_a1 from fx)) = (select store_a1 from fx) then (select staff_u from fx) else (select staff_a2_u from fx) end,
    format($q$select app.counter_create_order(%L, %L::jsonb, %L)$q$, coalesce(p_store, (select store_a1 from fx)),
    jsonb_build_object('request_id', gen_random_uuid(), 'type', 'table',
      'table_id', case when coalesce(p_store, (select store_a1 from fx)) = (select store_a1 from fx) then pg_temp.id('table_a1') else pg_temp.id('table_a2') end,
      'lines', jsonb_build_array(jsonb_build_object('size', pg_temp.id('cf'), 'qty', 1, 'options', '[]'::jsonb))), pg_temp.at(p_at))) -> 'order' ->> 'id')::uuid;
$$;
-- "Đã thu" in cash by the store's staff member on shift.
create function pg_temp.pay(p_order uuid, p_at text default '2026-11-25 09:01') returns jsonb language sql as $$
  select pg_temp.call(case when (select store_id from public.orders where id = p_order) = (select store_a1 from fx) then (select staff_u from fx) else (select staff_a2_u from fx) end,
    format($q$select app.counter_record_payment(%L, 'cash', %s, %s, %L)$q$, p_order,
    (select o.total from public.orders o where o.id = p_order), (select o.version from public.orders o where o.id = p_order), pg_temp.at(p_at)));
$$;
create function pg_temp.act(p_order uuid, p_action text, p_reason text default null) returns jsonb language sql as $$
  select pg_temp.call((select staff_u from fx), format($q$select app.counter_order_act(%L, %L, %s, %L, %L)$q$, p_order, p_action,
    (select o.version from public.orders o where o.id = p_order), p_reason, pg_temp.at('2026-11-25 09:30')));
$$;
create function pg_temp.finish(p_order uuid) returns text language plpgsql as $$
begin
  perform pg_temp.act(p_order, 'start');
  perform pg_temp.act(p_order, 'done');
  perform pg_temp.act(p_order, 'complete');
  return (select status::text || '/' || payment_status::text from public.orders where id = p_order);
end;
$$;
create function pg_temp.refund(p_user uuid, p_order uuid, p_amount numeric) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.counter_refund(%L, %s, 'synthetic refund', %L)$q$, p_order, p_amount, pg_temp.at('2026-11-25 10:00')));
$$;
-- The job as the Edge Function drives it.
create function pg_temp.work(p_at text, p_limit integer default 10) returns jsonb language sql as $$
  select app.einvoice_job_work(p_limit, pg_temp.at(p_at));
$$;
create function pg_temp.result(p_request jsonb, p_at text) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  begin
    v := app.einvoice_job_result(p_request, pg_temp.at(p_at));
  exception when others then
    v := jsonb_build_object('error', sqlstate);
  end;
  return v;
end;
$$;
create function pg_temp.item(p_work jsonb, p_order uuid) returns jsonb language sql immutable as $$
  select i from jsonb_array_elements(p_work -> 'invoices') i where (i -> 'order' ->> 'id')::uuid = p_order limit 1;
$$;
create function pg_temp.issued(p_item jsonb, p_extra jsonb default '{}') returns jsonb language sql immutable as $$
  select jsonb_build_object('invoice_id', p_item ->> 'invoice_id', 'claim', p_item ->> 'claim', 'outcome', 'issued',
    'provider_ref', 'mock-' || left(p_item ->> 'invoice_id', 8), 'invoice_no', '00000' || right(p_item ->> 'invoice_id', 3),
    'series', '2C26MAA', 'lookup_code', 'LK' || upper(left(p_item ->> 'invoice_id', 8)),
    'lookup_url', 'https://einvoice.mock.invalid/lookup/' || left(p_item ->> 'invoice_id', 8), 'tax_authority_code', 'M2-26-MOCK0-00000000001',
    'amount', (p_item ->> 'amount')::bigint) || p_extra;
$$;
create function pg_temp.failed(p_item jsonb, p_class text) returns jsonb language sql immutable as $$
  select jsonb_build_object('invoice_id', p_item ->> 'invoice_id', 'claim', p_item ->> 'claim', 'outcome', 'failed', 'error_class', p_class);
$$;
create function pg_temp.docs(p_order uuid) returns text language sql stable as $$
  select coalesce(string_agg(e.kind || ':' || e.state || coalesce(':' || e.amount::bigint, ''), ', '
    order by array_position(array['sale', 'replacement', 'adjustment', 'cancellation'], e.kind), (e.state = 'cancelled') desc, e.id), '')
  from public.e_invoices e where e.order_id = p_order;
$$;
create function pg_temp.rls_count(p_user uuid, p_table text) returns bigint language plpgsql as $$
declare
  v bigint;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  execute format('select count(*) from public.%I where tenant_id in (select tenant_a from fx union select tenant_b from fx)', p_table) into v;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$$;
grant select on fx to authenticated;
create temp table o (name text primary key, id uuid);
create function pg_temp.o(p_name text) returns uuid language sql stable as $$ select id from o where name = p_name $$;
create temp table w (name text primary key, answer jsonb);
create function pg_temp.w(p_name text) returns jsonb language sql stable as $$ select answer from w where name = p_name $$;

-- 1. The provider ---------------------------------------------------------------------------------------------------

select is(pg_temp.provider((select owner_u from fx), pg_temp.mock()) ->> 'state', 'saved', 'an owner with every store switches the mock provider on in sandbox');
select is(pg_temp.provider((select owner_u from fx), pg_temp.mock()) ->> 'state', 'unchanged', 'the same settings again change nothing');
select is(pg_temp.provider((select owner_u from fx), pg_temp.mock()) -> 'provider' ->> 'secret_name', 'EINVOICE_KEY_BRAND_1', 'the row names the secret, never holds it');
select is(pg_temp.provider((select manager_u from fx), pg_temp.mock()) ->> 'error', '42501', 'a manager does not set the provider');
select is(pg_temp.provider((select owner_a1_u from fx), pg_temp.mock()) ->> 'error', '42501', 'nor an owner without every store of the brand');
select is(pg_temp.provider((select owner_b_u from fx), pg_temp.mock()) ->> 'error', '42501', 'nor another tenant''s owner');
select is(pg_temp.provider((select cust1_u from fx), pg_temp.mock()) ->> 'error', '42501', 'nor a customer');
select is(pg_temp.provider((select owner_u from fx), pg_temp.mock() || '{"secret_name": "EINVOICE_KEY_A1B2C3D4E5F6"}') ->> 'error', '22023',
  'a secret name shaped like a pasted key is refused');
select is(pg_temp.provider((select owner_u from fx), pg_temp.mock() || '{"secret_name": "PAYMENT_BANK_BRAND_1"}') ->> 'error', '22023',
  'a secret of another kind is refused');
select is(pg_temp.provider((select owner_u from fx), pg_temp.mock('live')) ->> 'error', '22023', 'the mock never runs live');
select is(pg_temp.provider((select owner_u from fx), pg_temp.mock() || '{"adapter": "easyinvoice"}') ->> 'error', '22023', 'an adapter the job cannot run is refused');
select is(pg_temp.provider((select owner_u from fx), pg_temp.mock('sandbox', null, '{"series": "C26TAA"}')) ->> 'error', '22023',
  'a series that is not of a cash register (fourth character M) is refused');
select is(pg_temp.provider((select owner_u from fx), pg_temp.mock('sandbox', null, '{"vat_rate": "10"}')) ->> 'error', '22023',
  'a sales invoice (template 2) carries no VAT rate');
select is(pg_temp.provider((select owner_u from fx), pg_temp.mock('sandbox', null, '{"template": "1", "vat_rate": "none"}')) ->> 'error', '22023',
  'a VAT invoice (template 1) needs its rate');
select is(pg_temp.provider((select owner_u from fx), pg_temp.mock('sandbox', null, '{"seller_tax_code": "031234567"}')) ->> 'error', '22023',
  'a seller tax code of 9 digits is refused');
select is(pg_temp.provider((select owner_u from fx), pg_temp.mock('sandbox', null, '{"password": "x"}')) ->> 'error', '22023',
  'a setting that is not public or not known is refused');
select is(pg_temp.provider((select owner_u from fx), pg_temp.mock('sandbox', (select store_b1 from fx))) ->> 'error', '22023', 'a store of another brand is refused');
select is(pg_temp.provider((select owner_u from fx), pg_temp.mock('off', (select store_a2 from fx))) ->> 'state', 'saved',
  'a store row switches e-invoicing off at A2 (the most specific row decides)');
select is((select count(*) from public.einvoice_provider_changes c join public.einvoice_providers p on p.id = c.provider_id where p.brand_id = (select brand_a from fx)),
  2::bigint, 'each change is logged once (the unchanged repeat is not)');
select throws_ok($$update public.einvoice_provider_changes set after = '{}'$$, '42501', null, 'the change log is append-only');
select throws_ok($$insert into public.einvoice_providers (tenant_id, brand_id, adapter, mode, secret_name, settings)
  select tenant_b, brand_b, 'mock', 'sandbox', 'EINVOICE_KEY_A1B2C3D4E5F6', '{"seller_tax_code": "0312345678", "template": "2", "series": "C26MAA", "vat_rate": "none"}' from fx$$,
  '23514', null, 'the table itself refuses a pasted key, whoever writes');
select is(pg_temp.rls_count((select owner_u from fx), 'einvoice_providers'), 2::bigint, 'an owner reads the brand''s provider rows');
select is(pg_temp.rls_count((select owner_a1_u from fx), 'einvoice_providers'), 0::bigint, 'an owner of one store reads neither (the brand row and A2''s)');
select is(pg_temp.rls_count((select staff_u from fx), 'einvoice_providers') + pg_temp.rls_count((select viewer_u from fx), 'einvoice_providers')
  + pg_temp.rls_count((select owner_b_u from fx), 'einvoice_providers'), 0::bigint, 'staff, viewers and another tenant read none');

-- 2. Queueing: an order becomes paid -------------------------------------------------------------------------------

insert into o select 'k1', pg_temp.keyed();
select is(pg_temp.docs(pg_temp.o('k1')), '', 'an accepted unpaid counter order has no e-invoice');
select is(pg_temp.call((select staff_u from fx), format('select app.counter_order_einvoice(%L)', pg_temp.o('k1'))) ->> 'state', 'none',
  'the pill says there is nothing to invoice yet');
select is(pg_temp.pay(pg_temp.o('k1')) ->> 'state', 'paid', 'the counter records the cash');
select is(pg_temp.docs(pg_temp.o('k1')), 'sale:queued', 'the paid order''s sale invoice is queued at once');
select is((select reason || '/' || (provider_id = (select p.id from public.einvoice_providers p where p.brand_id = (select brand_a from fx) and p.store_id is null))::text
  from public.e_invoices where order_id = pg_temp.o('k1')), 'paid/true', 'for the payment, at the brand''s provider');
select is(pg_temp.pay(pg_temp.o('k1')) ->> 'replayed', 'true', 'recording the same payment again is a replay');
select is(pg_temp.docs(pg_temp.o('k1')), 'sale:queued', 'and queues nothing more');
select is(pg_temp.call((select staff_u from fx), format('select app.counter_order_einvoice(%L)', pg_temp.o('k1'))) ->> 'state', 'pending',
  'the pill says "Đang xuất…"');
insert into o select 'a2', pg_temp.keyed((select store_a2 from fx));
select is(pg_temp.pay(pg_temp.o('a2')) ->> 'state', 'paid', 'an order at A2, where e-invoicing is off, is paid');
select is(pg_temp.docs(pg_temp.o('a2')), '', 'and queues no e-invoice');
select is(pg_temp.call((select staff_a2_u from fx), format('select app.counter_order_einvoice(%L)', pg_temp.o('a2'))) ->> 'state', 'off', 'its pill says off');

-- Paid online: the server-only confirmation of a verified provider payment (the seam checkout_settle uses).
insert into public.payment_providers (tenant_id, brand_id, method, adapter, mode, secret_name, settings)
select tenant_a, brand_a, 'vietqr', 'mock', 'sandbox', 'PAYMENT_BANK_BRAND_1',
  '{"bank_bin": "970400", "bank_name": "Ngân hàng mẫu", "account_number": "0123456789", "account_name": "CUA HANG MAU", "reference_prefix": "FNB"}'::jsonb from fx;
update public.store_ordering_settings set payment_methods = array['counter', 'vietqr'] where store_id = (select store_a1 from fx);
insert into o select 'web', (pg_temp.call((select cust1_u from fx), format($q$select app.customer_place_order(%L::jsonb, %L)$q$,
  jsonb_build_object('request_id', gen_random_uuid(), 'store', 'sa-1', 'type', 'table',
    'table_token', (select app.table_qr_token(t.tenant_id, t.id, t.qr_version) from public.store_tables t where t.id = pg_temp.id('table_a1')),
    'payment', 'vietqr', 'lines', jsonb_build_array(jsonb_build_object('size', pg_temp.id('cf'), 'qty', 1)), 'expected_total', 29000),
  pg_temp.at('2026-11-25 09:10'))) -> 'order' ->> 'id')::uuid;
insert into w select 'web_start', app.checkout_payment_start((select cust1_u from fx), pg_temp.o('web'), 'vietqr', 'key-291-web-1', pg_temp.at('2026-11-25 09:11'));
select is(pg_temp.docs(pg_temp.o('web')), '', 'an order awaiting its online payment has no e-invoice');
select is(app.checkout_payment_confirm('vietqr', 'mock:291-web', (pg_temp.w('web_start') ->> 'payment_id')::uuid, 29000, true, null, pg_temp.at('2026-11-25 09:12')) ->> 'state',
  'succeeded', 'the verified bank notification pays it');
select is(pg_temp.docs(pg_temp.o('web')), 'sale:queued', 'and its sale invoice is queued');

-- 3. The job: claims, results and the document's states --------------------------------------------------------------

insert into w select 'w1', pg_temp.work('2026-11-25 09:20');
select is(jsonb_array_length(pg_temp.w('w1') -> 'invoices'), 2, 'the job takes the two queued sale invoices (A2''s has none, and the provider is on)');
select is((select pg_temp.item(pg_temp.w('w1'), pg_temp.o('k1')) ->> 'action') || '/' || (pg_temp.item(pg_temp.w('w1'), pg_temp.o('k1')) ->> 'query_first')
  || '/' || (pg_temp.item(pg_temp.w('w1'), pg_temp.o('k1')) ->> 'amount'), 'issue/false/29000', 'each to issue, the first time without asking first, for what the order holds');
select is((select sum((l ->> 'amount')::integer)::integer from jsonb_array_elements(pg_temp.item(pg_temp.w('w1'), pg_temp.o('k1')) -> 'lines') l), 29000,
  'its lines add up to the amount');
select is(pg_temp.item(pg_temp.w('w1'), pg_temp.o('k1')) -> 'lines' -> 0 ->> 'name', 'Cà phê sữa', 'a line names what was sold');
select is((pg_temp.item(pg_temp.w('w1'), pg_temp.o('k1')) -> 'buyer'), 'null'::jsonb, 'a sale invoice of a cash register has no buyer');
select is(pg_temp.item(pg_temp.w('w1'), pg_temp.o('k1')) -> 'provider' ->> 'secret_name', 'EINVOICE_KEY_BRAND_1', 'the provider row names the secret, never holds it');
select is(pg_temp.item(pg_temp.w('w1'), pg_temp.o('web')) -> 'payment_methods', '["vietqr"]'::jsonb, 'the online order''s payment method travels with it');
select is((select state || '/' || attempts from public.e_invoices where order_id = pg_temp.o('k1')), 'issuing/1', 'a claimed document is issuing, one attempt');
select is(jsonb_array_length(pg_temp.work('2026-11-25 09:20') -> 'invoices'), 0, 'a second run at the same moment takes nothing that is claimed');
select is(pg_temp.result(pg_temp.issued(pg_temp.item(pg_temp.w('w1'), pg_temp.o('k1'))) || jsonb_build_object('claim', gen_random_uuid()), '2026-11-25 09:20:30') ->> 'state',
  'stale', 'a result under another claim is stale');
select is(pg_temp.docs(pg_temp.o('k1')), 'sale:issuing:29000', 'and changes nothing');
select is(pg_temp.result(pg_temp.failed(pg_temp.item(pg_temp.w('w1'), pg_temp.o('k1')), 'timeout'), '2026-11-25 09:20:30') ->> 'state', 'failed',
  'a timeout fails the attempt');
select is((select next_attempt_at from public.e_invoices where order_id = pg_temp.o('k1')), pg_temp.at('2026-11-25 09:21:30'),
  'the next attempt is a minute later (the first back-off)');
select is(pg_temp.call((select staff_u from fx), format('select app.counter_order_einvoice(%L)', pg_temp.o('k1'))) ->> 'state', 'retrying',
  'the pill says "Chưa xuất được. Hệ thống tự thử lại, đơn vẫn hoàn tất."');
select is(pg_temp.result(pg_temp.failed(pg_temp.item(pg_temp.w('w1'), pg_temp.o('k1')), 'timeout'), '2026-11-25 09:20:31') ->> 'state', 'stale',
  'the same claim answered twice is stale the second time');
select is(pg_temp.item(pg_temp.work('2026-11-25 09:21:29'), pg_temp.o('k1')), null, 'one second before its time it is not taken again');
insert into w select 'w2', pg_temp.work('2026-11-25 09:21:30');
select is((pg_temp.item(pg_temp.w('w2'), pg_temp.o('k1')) ->> 'query_first')::boolean, true,
  'at its time it is taken again, and the job asks the provider first (a lost answer never makes a second invoice)');
select is(pg_temp.result(pg_temp.failed(pg_temp.item(pg_temp.w('w2'), pg_temp.o('k1')), 'unavailable'), '2026-11-25 09:21:40') ->> 'next_attempt_at',
  to_jsonb(pg_temp.at('2026-11-25 09:23:40')) #>> '{}', 'a second failure waits two minutes');
insert into w select 'w3', pg_temp.work('2026-11-25 09:23:40');
select is(pg_temp.result(pg_temp.issued(pg_temp.item(pg_temp.w('w3'), pg_temp.o('k1'))), '2026-11-25 09:23:45') ->> 'state', 'issued', 'the third attempt is issued');
select is((select state || '/' || attempts || '/' || provider_ref || '/' || lookup_code || '/' || coalesce(last_error_class, '-')
  from public.e_invoices where order_id = pg_temp.o('k1')), 'issued/3/mock-' || left((pg_temp.item(pg_temp.w('w3'), pg_temp.o('k1')) ->> 'invoice_id'), 8)
  || '/LK' || upper(left((pg_temp.item(pg_temp.w('w3'), pg_temp.o('k1')) ->> 'invoice_id'), 8)) || '/-', 'with the provider''s reference and lookup code, the error cleared');
select is(pg_temp.call((select staff_u from fx), format('select app.counter_order_einvoice(%L)', pg_temp.o('k1'))) ->> 'state', 'issued', 'the pill says "Đã xuất"');
select is(pg_temp.call((select staff_u from fx), format('select app.counter_order_einvoice(%L)', pg_temp.o('k1'))) -> 'invoice' ->> 'lookup_url',
  'https://einvoice.mock.invalid/lookup/' || left((pg_temp.item(pg_temp.w('w3'), pg_temp.o('k1')) ->> 'invoice_id'), 8), 'with the lookup address');
select is(pg_temp.result(pg_temp.issued(pg_temp.item(pg_temp.w('w3'), pg_temp.o('k1'))), '2026-11-25 09:23:46') ->> 'state', 'stale',
  'an issued document cannot be issued again (the claim is spent)');
select is(pg_temp.result(pg_temp.issued(pg_temp.item(pg_temp.w('w1'), pg_temp.o('web')), '{"lookup_url": "http://einvoice.mock.invalid/x"}'), '2026-11-25 09:21:00') ->> 'error',
  '23514', 'a lookup address that is not https is refused');
select is(pg_temp.result(pg_temp.issued(pg_temp.item(pg_temp.w('w1'), pg_temp.o('web'))) - 'provider_ref', '2026-11-25 09:21:00') ->> 'error', '22023',
  'an issued result without the provider''s reference is refused');
select is(pg_temp.result(jsonb_build_object('invoice_id', gen_random_uuid(), 'claim', gen_random_uuid(), 'outcome', 'issued', 'provider_ref', 'x'), '2026-11-25 09:21:00') ->> 'error',
  '22023', 'a result for an unknown document is refused');
select is(pg_temp.result(pg_temp.failed(pg_temp.item(pg_temp.w('w1'), pg_temp.o('web')), 'the-provider-said: Nguyen Van A 0312345678'), '2026-11-25 09:21:00') ->> 'state',
  'failed', 'a failure with an unknown class is kept');
select is((select last_error_class from public.e_invoices where order_id = pg_temp.o('web')), 'unknown', 'as the class unknown, never the text');

-- A claim that lapses: two runs of the job never record one document twice.
insert into w select 'w4', pg_temp.work('2026-11-25 09:30');
select is(pg_temp.item(pg_temp.work('2026-11-25 09:34:59'), pg_temp.o('web')), null, 'a claim holds for 5 minutes: 4:59 later nobody else takes it');
insert into w select 'w5', pg_temp.work('2026-11-25 09:35');
select ok(pg_temp.item(pg_temp.w('w5'), pg_temp.o('web')) ->> 'claim' <> pg_temp.item(pg_temp.w('w4'), pg_temp.o('web')) ->> 'claim',
  'at 5:00 a second run takes it under a new claim');
select is(pg_temp.result(pg_temp.issued(pg_temp.item(pg_temp.w('w4'), pg_temp.o('web'))), '2026-11-25 09:35:10') ->> 'state', 'stale',
  'the first run''s late answer is stale');
select is(pg_temp.result(pg_temp.issued(pg_temp.item(pg_temp.w('w5'), pg_temp.o('web'))), '2026-11-25 09:35:11') ->> 'state', 'issued',
  'the second run''s answer (found by asking first) is recorded');
select is((select count(*)::integer from public.e_invoices where order_id = pg_temp.o('web')), 1, 'one document for the order, whatever the runs did');

-- Giving up: 10 attempts of a round for errors that may pass, at once for the others.
insert into o select 'k2', pg_temp.keyed();
select is(pg_temp.pay(pg_temp.o('k2')) ->> 'state', 'paid', 'a second counter order is paid');
create function pg_temp.fail_once(p_order uuid, p_at timestamptz) returns jsonb language plpgsql as $$
declare
  v_item jsonb := pg_temp.item(app.einvoice_job_work(10, p_at), p_order);
begin
  return app.einvoice_job_result(pg_temp.failed(v_item, 'unavailable'), p_at);
end;
$$;
insert into w select 'g' || n, pg_temp.fail_once(pg_temp.o('k2'), pg_temp.at('2026-11-25 10:00') + make_interval(hours => n)) from generate_series(1, 9) as n;
select is((select state || '/' || attempts || '/' || (gave_up_at is null)::text from public.e_invoices where order_id = pg_temp.o('k2')), 'failed/9/true',
  'nine failures keep it retrying');
select is(pg_temp.fail_once(pg_temp.o('k2'), pg_temp.at('2026-11-25 20:00')) ->> 'gave_up', 'true', 'the tenth gives up');
select is(pg_temp.call((select staff_u from fx), format('select app.counter_order_einvoice(%L)', pg_temp.o('k2'))) ->> 'state', 'failed', 'the pill says failed');
select ok(exists (select 1 from public.alert_events e where e.tenant_id = (select tenant_a from fx) and e.rule_key = 'einvoice_failed'),
  'giving up raises einvoice_failed to owners and managers');
select ok((select bool_and(app.facts_are_count_only(e.facts)) from public.alert_events e where e.tenant_id = (select tenant_a from fx) and e.rule_key = 'einvoice_failed'),
  'with count-only facts');
select is(pg_temp.item(pg_temp.work('2026-11-26 09:00'), pg_temp.o('k2')), null, 'a given-up document is not taken again');
select is(pg_temp.call((select manager_u from fx), format('select app.manager_einvoices(%L)', (select store_a1 from fx))) ->> 'gave_up', '1',
  'the managers'' list counts it');
select is(pg_temp.call((select manager_u from fx), format('select app.manager_einvoices(%L)', (select store_a1 from fx))) -> 'invoices' -> 0 ->> 'last_error_class',
  'unavailable', 'with its error class');
select is(pg_temp.call((select staff_u from fx), format('select app.manager_einvoices(%L)', (select store_a1 from fx))) ->> 'error', '42501', 'staff do not read the list');
select is(pg_temp.call((select manager_u from fx), format('select app.manager_einvoices(%L, %L)', (select store_a1 from fx), 'broken')) ->> 'error', '22023',
  'an unknown filter is refused');
select is(pg_temp.call((select staff_u from fx), format('select app.manager_retry_einvoice(%L)', (select id from public.e_invoices where order_id = pg_temp.o('k2')))) ->> 'error',
  '42501', 'staff cannot retry it');
select is(pg_temp.call((select manager_u from fx), format('select app.manager_retry_einvoice(%L)', (select id from public.e_invoices where order_id = pg_temp.o('k2')))) ->> 'state',
  'queued', 'a manager sends it again');
insert into w select 'w6', pg_temp.work('2026-11-26 09:01');
select is((pg_temp.item(pg_temp.w('w6'), pg_temp.o('k2')) ->> 'query_first')::boolean, true, 'it is taken at once, asking the provider first');
select is(pg_temp.result(pg_temp.failed(pg_temp.item(pg_temp.w('w6'), pg_temp.o('k2')), 'rejected_data'), '2026-11-26 09:01:05') ->> 'gave_up', 'true',
  'rejected data gives up at once (a person must fix it)');
select is(pg_temp.call((select manager_u from fx), format('select app.manager_retry_einvoice(%L)', (select id from public.e_invoices where order_id = pg_temp.o('k1')))) ->> 'refusal',
  'not_failed', 'an issued document is not retried');

-- 4. Corrections: refunds and undone payments -----------------------------------------------------------------------

select is(pg_temp.finish(pg_temp.o('k1')), 'completed/paid', 'the first order is made, served and completed');
select is(pg_temp.refund((select manager_u from fx), pg_temp.o('k1'), 10000) ->> 'state', 'succeeded', 'a manager refunds 10,000 in cash');
select is(pg_temp.docs(pg_temp.o('k1')), 'sale:issued:29000, adjustment:queued', 'an adjustment is queued for the issued invoice');
select is(pg_temp.refund((select manager_u from fx), pg_temp.o('k1'), 5000) ->> 'state', 'succeeded', 'and 5,000 more before the job comes');
select is(pg_temp.docs(pg_temp.o('k1')), 'sale:issued:29000, adjustment:queued', 'still one queued adjustment');
insert into w select 'w7', pg_temp.work('2026-11-25 10:05');
select is((pg_temp.item(pg_temp.w('w7'), pg_temp.o('k1')) ->> 'action') || '/' || (pg_temp.item(pg_temp.w('w7'), pg_temp.o('k1')) ->> 'amount')
  || '/' || (pg_temp.item(pg_temp.w('w7'), pg_temp.o('k1')) -> 'original' ->> 'amount'), 'adjust/-15000/29000',
  'the job adjusts by both refunds at once, against the 29,000 the provider holds');
select is(pg_temp.result(pg_temp.issued(pg_temp.item(pg_temp.w('w7'), pg_temp.o('k1'))), '2026-11-25 10:05:05') ->> 'state', 'issued', 'the adjustment is issued');
select is(pg_temp.docs(pg_temp.o('k1')), 'sale:adjusted:29000, adjustment:issued:-15000', 'the sale invoice is adjusted');
select is(app.einvoice_provider_amount(app.einvoice_live(pg_temp.o('k1'))), 14000::numeric, 'the provider holds 14,000, what the order holds');
select is(pg_temp.refund((select manager_u from fx), pg_temp.o('k1'), 14000) ->> 'state', 'succeeded', 'the rest is refunded');
select is(pg_temp.docs(pg_temp.o('k1')), 'sale:adjusted:29000, adjustment:issued:-15000, cancellation:queued', 'a cancellation is queued');
insert into w select 'w8', pg_temp.work('2026-11-25 10:10');
select is((pg_temp.item(pg_temp.w('w8'), pg_temp.o('k1')) ->> 'action') || '/' || (pg_temp.item(pg_temp.w('w8'), pg_temp.o('k1')) ->> 'amount'), 'cancel/-14000',
  'which cancels the 14,000 left');
select is(pg_temp.result(pg_temp.issued(pg_temp.item(pg_temp.w('w8'), pg_temp.o('k1'))), '2026-11-25 10:10:05') ->> 'state', 'issued', 'the cancellation is issued');
select is(pg_temp.call((select staff_u from fx), format('select app.counter_order_einvoice(%L)', pg_temp.o('k1'))) ->> 'state', 'cancelled', 'the pill says cancelled');

-- A refund while the job is out: the correction waits for the sale invoice, then cancels exactly what it holds.
insert into o select 'k3', pg_temp.keyed();
select is(pg_temp.pay(pg_temp.o('k3'), '2026-11-25 10:20') ->> 'state', 'paid', 'a third order is paid');
insert into w select 'w9', pg_temp.work('2026-11-25 10:21');
select is(pg_temp.act(pg_temp.o('k3'), 'cancel', 'customer_request') ->> 'state', 'ok', 'while its invoice is out, staff cancel the paid order');
select is(pg_temp.refund((select staff_u from fx), pg_temp.o('k3'), 29000) ->> 'state', 'succeeded', 'and hand the cash back');
select is(pg_temp.docs(pg_temp.o('k3')), 'sale:issuing:29000, cancellation:queued', 'a cancellation is queued behind the invoice on its way');
select is(pg_temp.item(pg_temp.work('2026-11-25 10:21:10'), pg_temp.o('k3')), null, 'it is not taken while the invoice is out');
select is(pg_temp.result(pg_temp.issued(pg_temp.item(pg_temp.w('w9'), pg_temp.o('k3'))), '2026-11-25 10:21:20') ->> 'state', 'issued', 'the invoice comes back issued');
insert into w select 'w10', pg_temp.work('2026-11-25 10:22');
select is((pg_temp.item(pg_temp.w('w10'), pg_temp.o('k3')) ->> 'action') || '/' || (pg_temp.item(pg_temp.w('w10'), pg_temp.o('k3')) ->> 'amount'), 'cancel/-29000',
  'then the cancellation is taken for the whole invoice');
select is(pg_temp.result(pg_temp.issued(pg_temp.item(pg_temp.w('w10'), pg_temp.o('k3')), '{"action": "adjust"}'), '2026-11-25 10:22:05') ->> 'state', 'issued',
  'a provider that cannot cancel adjusts to zero instead');
select is(pg_temp.docs(pg_temp.o('k3')), 'sale:adjusted:29000, cancellation:issued:-29000', 'the sale invoice is adjusted to nothing');
select is(app.einvoice_provider_amount(app.einvoice_live(pg_temp.o('k3'))), 0::numeric, 'the provider holds nothing for it');

-- An undone payment: nothing sent is cancelled here; something sent is cancelled at the provider, unless paid again.
insert into o select 'k4', pg_temp.keyed();
select is(pg_temp.pay(pg_temp.o('k4'), '2026-11-25 10:30') ->> 'state', 'paid', 'a fourth order is paid');
select is(pg_temp.call((select staff_u from fx), format($q$select app.counter_void_payment(%L, 'wrong order', %L)$q$,
  (select id from public.order_payments where order_id = pg_temp.o('k4')), pg_temp.at('2026-11-25 10:31'))) ->> 'state', 'voided', 'the cashier undoes the payment');
select is(pg_temp.docs(pg_temp.o('k4')), 'sale:cancelled', 'the sale invoice that never reached the provider is cancelled here');
select is((select cancel_reason from public.e_invoices where order_id = pg_temp.o('k4')), 'order_unpaid', 'because the order is unpaid');
select is(pg_temp.pay(pg_temp.o('k4'), '2026-11-25 10:32') ->> 'state', 'paid', 'it is paid again');
select is(pg_temp.docs(pg_temp.o('k4')), 'sale:cancelled, sale:queued', 'and a new sale invoice is queued');
insert into w select 'w11', pg_temp.work('2026-11-25 10:33');
select is(pg_temp.result(pg_temp.issued(pg_temp.item(pg_temp.w('w11'), pg_temp.o('k4'))), '2026-11-25 10:33:05') ->> 'state', 'issued', 'which is issued');
select is(pg_temp.call((select staff_u from fx), format($q$select app.counter_void_payment(%L, 'wrong again', %L)$q$,
  (select id from public.order_payments where order_id = pg_temp.o('k4') and status = 'succeeded'), pg_temp.at('2026-11-25 10:34'))) ->> 'state', 'voided',
  'the payment is undone once more');
select is(pg_temp.docs(pg_temp.o('k4')), 'sale:cancelled, sale:issued:29000, cancellation:queued', 'now the issued invoice needs a cancellation');
select is(pg_temp.pay(pg_temp.o('k4'), '2026-11-25 10:35') ->> 'state', 'paid', 'but the order is paid again before the job comes');
select is(pg_temp.item(pg_temp.work('2026-11-25 10:36'), pg_temp.o('k4')), null, 'so the job has nothing to send');
select is(pg_temp.docs(pg_temp.o('k4')), 'sale:cancelled, sale:issued:29000, cancellation:cancelled', 'the correction is settled here and the invoice stays valid');

-- The provider switched off: what is queued waits, and goes once it is on again.
insert into o select 'k5', pg_temp.keyed();
select is(pg_temp.provider((select owner_u from fx), pg_temp.mock('off')) ->> 'state', 'saved', 'the owner switches the provider off');
select is(pg_temp.pay(pg_temp.o('k5'), '2026-11-25 10:40') ->> 'state', 'paid', 'an order paid meanwhile');
select is(pg_temp.docs(pg_temp.o('k5')), '', 'queues nothing');
select is(pg_temp.provider((select owner_u from fx), pg_temp.mock()) ->> 'state', 'saved', 'the provider is on again');
select is(pg_temp.docs(pg_temp.o('k3')) || ' | ' || pg_temp.docs(pg_temp.o('k5')), 'sale:adjusted:29000, cancellation:issued:-29000 | ',
  'and nothing is invented for what was paid while it was off (the owner keys those in the provider''s portal)');

-- 5. Reading and grants ------------------------------------------------------------------------------------------------

select is(pg_temp.call((select staff_a2_u from fx), format('select app.counter_order_einvoice(%L)', pg_temp.o('k1'))) ->> 'error', '42501',
  'staff of another store do not read the pill');
select is(pg_temp.call((select cust1_u from fx), format('select app.counter_order_einvoice(%L)', pg_temp.o('k1'))) ->> 'error', '42501', 'nor a customer');
select is(pg_temp.call((select staff_u from fx), format('select app.counter_order_einvoice(%L)', gen_random_uuid())) ->> 'error', '42501',
  'an unknown order answers like another store''s');
select is(pg_temp.rls_count((select owner_u from fx), 'e_invoices'), (select count(*) from public.e_invoices e where e.tenant_id = (select tenant_a from fx)),
  'an owner reads every e-invoice of the tenant');
select is(pg_temp.rls_count((select viewer_u from fx), 'e_invoices'), (select count(*) from public.e_invoices e where e.tenant_id = (select tenant_a from fx)),
  'so does a viewer (no buyer data is on them)');
select is(pg_temp.rls_count((select staff_u from fx), 'e_invoices') + pg_temp.rls_count((select owner_b_u from fx), 'e_invoices'), 0::bigint,
  'staff and another tenant read none');
select ok(not has_function_privilege('authenticated', 'public.einvoice_job_work(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.einvoice_job_result(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.einvoice_job_claim(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.einvoice_job_work(integer)', 'execute'), 'the job''s functions are not for members or anon');
select ok(has_function_privilege('service_role', 'public.einvoice_job_work(integer)', 'execute')
  and has_function_privilege('service_role', 'public.einvoice_job_result(jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.einvoice_job_claim(uuid)', 'execute'), 'only the service role calls them');
select ok(not has_function_privilege('service_role', 'app.einvoice_reconcile(uuid, text, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'app.einvoice_reconcile(uuid, text, timestamptz)', 'execute'), 'no API role reaches the reconciliation itself');
select ok(not has_table_privilege('authenticated', 'public.e_invoices', 'insert') and not has_table_privilege('authenticated', 'public.e_invoices', 'update')
  and not has_table_privilege('authenticated', 'public.e_invoices', 'delete'), 'members write no e-invoice directly');
select is(app.einvoice_job_claim(gen_random_uuid()), false, 'an unknown ticket is refused');

-- 6. Foreign keys: a cascaded delete of an order, a store, a provider, a request, a login or a user never scans -------
select is(
  (select coalesce(string_agg(c.conrelid::regclass || ' (' || (select string_agg(a.attname, ', ' order by k.n)
     from unnest(c.conkey) with ordinality k (attnum, n) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) || ')', '; '), 'none')
   from pg_constraint c
   where c.contype = 'f'
     and c.conrelid in ('public.e_invoices'::regclass, 'public.invoice_requests'::regclass, 'public.saved_companies'::regclass,
       'public.einvoice_providers'::regclass, 'public.einvoice_provider_changes'::regclass)
     and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indpred is null
       and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] = c.conkey::int2[])),
  'none', 'every foreign key of the e-invoice tables has a whole index led by its columns');
select has_index('public', 'e_invoices', 'e_invoices_tenant_order_idx', array['tenant_id', 'order_id'], 'e_invoices (tenant_id, order_id) is indexed');
select has_index('public', 'e_invoices', 'e_invoices_tenant_store_idx', array['tenant_id', 'store_id'], 'e_invoices (tenant_id, store_id) is indexed');
select has_index('public', 'e_invoices', 'e_invoices_tenant_request_idx', array['tenant_id', 'request_id'], 'e_invoices (tenant_id, request_id) is indexed');
select has_index('public', 'e_invoices', 'e_invoices_tenant_provider_idx', array['tenant_id', 'provider_id'], 'e_invoices (tenant_id, provider_id) is indexed');
select has_index('public', 'invoice_requests', 'invoice_requests_tenant_order_idx', array['tenant_id', 'order_id'], 'invoice_requests (tenant_id, order_id) is indexed');
select has_index('public', 'invoice_requests', 'invoice_requests_tenant_store_idx', array['tenant_id', 'store_id'], 'invoice_requests (tenant_id, store_id) is indexed');
select has_index('public', 'invoice_requests', 'invoice_requests_tenant_einvoice_idx', array['tenant_id', 'einvoice_id'], 'invoice_requests (tenant_id, einvoice_id) is indexed');

select * from finish();
rollback;
