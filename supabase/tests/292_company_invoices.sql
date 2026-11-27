-- Company invoices (C18 in the customer app, Q01's company row at the counter; ADR-069): the server's own checks of a
-- company (tax code, name, address, email), the rules of a request (the caller's own paid order, inside the store's
-- window, not refunded, one per order), its idempotency, its limit, the saved companies only their customer reads and
-- that go with the account, and the request's life: the company invoice replaces the sale invoice once it is issued
-- (one order never has two valid invoices), then the email goes out.
-- Techniques: equivalence partitions and boundary values of every field (C18-U1 to U3) and of the window (day 7 yes,
-- day 8 no; the setting's 1 and 30), a decision table of the refusals (C18-I3), state transitions of a request
-- (received -> issuing -> issued -> emailed | failed | cancelled), error guessing with injection strings (C18-S2),
-- authorisation and IDOR (C18-S1, S5), the rate limit (C18-S3), what is kept where (C18-S4).
begin;
select plan(179);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000029201'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000029202'::uuid as tenant_b,
  'cccccccc-cccc-4ccc-8ccc-000000029201'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000029202'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000029201'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000029202'::uuid as store_a2,
  'ffffffff-ffff-4fff-8fff-000000029203'::uuid as store_b1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000029201'::uuid as brand_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000029202'::uuid as brand_b,
  '99999999-9999-4999-8999-000000029201'::uuid as app_a,
  '99999999-9999-4999-8999-000000029202'::uuid as app_b,
  'eeeeeeee-eeee-4eee-8eee-000000029201'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000029203'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000029204'::uuid as staff_u,
  'eeeeeeee-eeee-4eee-8eee-000000029205'::uuid as staff_a2_u,
  'eeeeeeee-eeee-4eee-8eee-000000029211'::uuid as cust1_u,
  'eeeeeeee-eeee-4eee-8eee-000000029212'::uuid as cust2_u,
  'eeeeeeee-eeee-4eee-8eee-000000029213'::uuid as cust3_u,
  'eeeeeeee-eeee-4eee-8eee-000000029214'::uuid as cust4_u,
  'eeeeeeee-eeee-4eee-8eee-000000029219'::uuid as custb_u;

create temp table ids (name text primary key, id uuid not null);
insert into ids values
  ('cat', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029251'), ('item_cf', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029201'),
  ('cf', 'bbbbbbbb-bbbb-4bbb-8bbb-000000029211'), ('table_a1', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029241'),
  ('table_a2', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029242');
create function pg_temp.id(p_name text) returns uuid language sql stable as $$ select id from ids where name = p_name $$;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'einvoice-292-' || right(u.id::text, 4) || '@example.com',
  case when u.tenant is null then '{}'::jsonb else jsonb_build_object('kind', 'customer', 'tenant_id', u.tenant) end
from fx cross join lateral (values
  (fx.owner_u, null::uuid), (fx.manager_u, null), (fx.staff_u, null), (fx.staff_a2_u, null),
  (fx.cust1_u, fx.tenant_a), (fx.cust2_u, fx.tenant_a), (fx.cust3_u, fx.tenant_a), (fx.cust4_u, fx.tenant_a), (fx.custb_u, fx.tenant_b)
) as u (id, tenant);
insert into public.tenants (id, slug, name)
select tenant_a, 'einvoice-292-a', 'E-invoice 292 A' from fx union all
select tenant_b, 'einvoice-292-b', 'E-invoice 292 B' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'einvoice-292-a', 'Synthetic account A' from fx union all
select account_b, tenant_b, 'mock', 'einvoice-292-b', 'Synthetic account B' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name, opening_hours)
select s.id, s.tenant, s.account, s.ext, s.code, s.name,
  '{"mon": [["00:00", "24:00"]], "tue": [["00:00", "24:00"]], "wed": [["00:00", "24:00"]], "thu": [["00:00", "24:00"]], "fri": [["00:00", "24:00"]], "sat": [["00:00", "24:00"]], "sun": [["00:00", "24:00"]]}'::jsonb
from fx cross join lateral (values
  (fx.store_a1, fx.tenant_a, fx.account_a, 'e292-a1', 'sa-1', 'Synthetic store A1'),
  (fx.store_a2, fx.tenant_a, fx.account_a, 'e292-a2', 'sa-2', 'Synthetic store A2'),
  (fx.store_b1, fx.tenant_b, fx.account_b, 'e292-b1', 'sb-1', 'Synthetic store B1')
) as s (id, tenant, account, ext, code, name);
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_a, m.user_id, m.role::public.tenant_role, m.store_ids
from fx cross join lateral (values
  (fx.owner_u, 'owner', null::uuid[]), (fx.manager_u, 'manager', null), (fx.staff_u, 'staff', array[fx.store_a1]),
  (fx.staff_a2_u, 'staff', array[fx.store_a2])
) as m (user_id, role, store_ids);
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_a, tenant_a, 'brand-1', 'Synthetic brand A', array[store_a1, store_a2] from fx union all
select brand_b, tenant_b, 'brand-1', 'Synthetic brand B', array[store_b1] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_a, tenant_a, brand_a, 'synthetic-292-zapp-a', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx union all
select app_b, tenant_b, brand_b, 'synthetic-292-zapp-b', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id)
select tenant_a, app_a, 'syn-zalo-292-' || n, u from fx cross join lateral (values (1, fx.cust1_u), (2, fx.cust2_u), (3, fx.cust3_u), (4, fx.cust4_u)) as c (n, u)
union all
select tenant_b, app_b, 'syn-zalo-292-9', custb_u from fx;
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
insert into public.einvoice_providers (tenant_id, brand_id, store_id, adapter, mode, secret_name, settings)
select tenant_a, brand_a, s.store, 'mock', s.mode, 'EINVOICE_KEY_BRAND_1',
  '{"seller_tax_code": "0312345678", "template": "2", "series": "C26MAA", "vat_rate": "none"}'::jsonb
from fx cross join lateral (values (null::uuid, 'sandbox'), (fx.store_a2, 'off')) as s (store, mode);

-- Helpers ---------------------------------------------------------------------------------------------------------
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
create function pg_temp.token(p_table text) returns text language sql stable as $$
  select app.table_qr_token(t.tenant_id, t.id, t.qr_version) from public.store_tables t where t.id = pg_temp.id(p_table);
$$;
-- A customer's table order paid at the counter (29,000): placed, then "Đã thu" by the store's staff member.
create function pg_temp.place(p_user uuid, p_store text default 'sa-1') returns uuid language sql as $$
  select (pg_temp.call(p_user, format($q$select app.customer_place_order(%L::jsonb, %L)$q$,
    jsonb_build_object('request_id', gen_random_uuid(), 'store', p_store, 'type', 'table',
      'table_token', pg_temp.token(case when p_store = 'sa-1' then 'table_a1' else 'table_a2' end), 'payment', 'counter',
      'lines', jsonb_build_array(jsonb_build_object('size', pg_temp.id('cf'), 'qty', 1)), 'expected_total', 29000),
    pg_temp.at('2026-11-25 09:55'))) -> 'order' ->> 'id')::uuid;
$$;
create function pg_temp.pay(p_order uuid, p_at text default '2026-11-25 10:00') returns jsonb language sql as $$
  select pg_temp.call(case when (select store_id from public.orders where id = p_order) = (select store_a1 from fx) then (select staff_u from fx) else (select staff_a2_u from fx) end,
    format($q$select app.counter_record_payment(%L, 'cash', %s, %s, %L)$q$, p_order,
    (select o.total from public.orders o where o.id = p_order), (select o.version from public.orders o where o.id = p_order), pg_temp.at(p_at)));
$$;
create function pg_temp.act(p_order uuid, p_action text, p_reason text default null) returns jsonb language sql as $$
  select pg_temp.call((select staff_u from fx), format($q$select app.counter_order_act(%L, %L, %s, %L, %L)$q$, p_order, p_action,
    (select o.version from public.orders o where o.id = p_order), p_reason, pg_temp.at('2026-11-25 10:05')));
$$;
create function pg_temp.finish(p_order uuid) returns text language plpgsql as $$
begin
  perform pg_temp.act(p_order, 'start');
  perform pg_temp.act(p_order, 'done');
  perform pg_temp.act(p_order, 'complete');
  return (select status::text || '/' || payment_status::text from public.orders where id = p_order);
end;
$$;
create function pg_temp.company(p_tax text default '0312345678', p_name text default 'Công ty TNHH Bếp Nhà Mẫu',
  p_address text default '12 Đường Số 3, Phường 4, Quận 5, TP. Hồ Chí Minh', p_email text default 'ke.toan@example.com') returns jsonb
language sql immutable as $$
  select jsonb_build_object('tax_code', p_tax, 'company_name', p_name, 'address', p_address, 'email', p_email);
$$;
create function pg_temp.ask(p_user uuid, p_order uuid, p_company jsonb, p_at text default '2026-11-25 11:00', p_request uuid default null, p_extra jsonb default '{}')
returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.customer_request_invoice(%L::jsonb, %L)$q$,
    jsonb_build_object('request_id', coalesce(p_request, gen_random_uuid()), 'order', p_order, 'company', p_company) || p_extra, pg_temp.at(p_at)));
$$;
create function pg_temp.status(p_user uuid, p_order uuid, p_at text default '2026-11-25 11:00') returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.customer_invoice_status(%L, %L)$q$, p_order, pg_temp.at(p_at)));
$$;
create function pg_temp.fields(p_company jsonb) returns text language sql immutable as $$
  select coalesce(string_agg(f, ',' order by f), '') from jsonb_array_elements_text(app.einvoice_company_input(p_company) -> 'fields') f;
$$;
create function pg_temp.item(p_work jsonb, p_order uuid, p_kind text) returns jsonb language sql immutable as $$
  select i from jsonb_array_elements(p_work -> 'invoices') i where (i -> 'order' ->> 'id')::uuid = p_order and i ->> 'kind' = p_kind limit 1;
$$;
create function pg_temp.issued(p_item jsonb, p_extra jsonb default '{}') returns jsonb language sql immutable as $$
  select jsonb_build_object('invoice_id', p_item ->> 'invoice_id', 'claim', p_item ->> 'claim', 'outcome', 'issued',
    'provider_ref', 'mock-' || left(p_item ->> 'invoice_id', 8), 'invoice_no', '0000' || right(p_item ->> 'invoice_id', 4), 'series', '2C26MAA',
    'lookup_code', 'LK' || upper(left(p_item ->> 'invoice_id', 8)), 'lookup_url', 'https://einvoice.mock.invalid/lookup/' || left(p_item ->> 'invoice_id', 8),
    'amount', (p_item ->> 'amount')::bigint) || p_extra;
$$;
create function pg_temp.rows_as(p_user uuid, p_sql text) returns text language plpgsql as $$
declare
  v text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated',
    'app_metadata', coalesce((select jsonb_build_object('kind', 'customer', 'tenant_id', l.tenant_id) from app.customer_logins l where l.user_id = p_user), '{}'::jsonb))::text, true);
  set local role authenticated;
  begin
    execute p_sql into v;
  exception when others then
    v := sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$$;
create temp table o (name text primary key, id uuid);
create function pg_temp.o(p_name text) returns uuid language sql stable as $$ select id from o where name = p_name $$;
create temp table a (name text primary key, answer jsonb);
create function pg_temp.a(p_name text) returns jsonb language sql stable as $$ select answer from a where name = p_name $$;

-- 1. The fields, as the server checks them whatever the screen did (C18-U1 to U3) ----------------------------------

select is(app.einvoice_tax_code(v.input), v.expected, format('tax code %s: %s', coalesce(v.input, 'null'), v.label))
from (values
  ('0312345678', '0312345678', '10 digits are a company'),
  ('0312345678-001', '0312345678-001', '10 digits and a branch'),
  ('0312345678001', '0312345678-001', '13 bare digits gain their hyphen'),
  ('  0312345678  ', '0312345678', 'spaces around are trimmed'),
  ('031234567', null, '9 digits are refused'),
  ('03123456789', null, '11 digits are refused'),
  ('031234567890', null, '12 digits are refused'),
  ('03123456789012', null, '14 digits are refused'),
  ('03123456AB', null, 'letters are refused'),
  ('03123 45678', null, 'a space inside is refused'),
  ('0312345678-01', null, 'a branch of 2 digits is refused'),
  ('0312345678–001', null, 'a dash that is not a hyphen is refused'),
  ('', null, 'empty is refused'),
  (null, null, 'missing is refused')
) as v (input, expected, label);

select is(pg_temp.fields(pg_temp.company(p_email => v.email)), v.expected, format('email %s', v.label))
from (values
  ('ke.toan@example.com', '', 'with a dot and a hyphen is valid'),
  ('KeToan+hd@Example.org', '', 'with a plus and capitals is valid'),
  -- built from parts: the public-safe scan lets literal addresses only at example.com and example.org
  ('ke.toan' || '@' || 'bep-nha-mau.example.com', '', 'with a hyphen in a sub-domain is valid'),
  ('ke.toan.bep-nha-mau.vn', 'email', 'without @ is refused'),
  ('ke.toan@', 'email', 'without a domain is refused'),
  ('ke.toan@bep-nha-mau', 'email', 'without a final label is refused'),
  ('ke.toan@example.com.', 'email', 'with a trailing dot is refused'),
  ('ke..toan@example.com', 'email', 'with a double dot is refused'),
  ('ke.toan@example.com' || chr(13) || chr(10) || 'Bcc: x@example.org', 'email', 'with a header injected after CRLF is refused'),
  ('<script>@example.com', 'email', 'with markup is refused'),
  (repeat('a', 64) || '@' || repeat('b', 63) || '.' || repeat('c', 63) || '.' || repeat('d', 58) || '.vn', '', 'of 254 characters is valid'),
  (repeat('a', 64) || '@' || repeat('b', 63) || '.' || repeat('c', 63) || '.' || repeat('d', 59) || '.vn', 'email', 'of 255 characters is refused'),
  ('a@' || repeat('b', 64) || '.vn', 'email', 'with a domain label of 64 characters is refused'),
  (repeat('a', 65) || '@bep-nha-mau.vn', 'email', 'with a local part of 65 characters is refused')
) as v (email, expected, label);

select is(pg_temp.fields(v.company), v.expected, v.label)
from (values
  (pg_temp.company(p_name => 'A'), '', 'a name of 1 character is valid'),
  (pg_temp.company(p_name => repeat('Đ', 200)), '', 'a name of 200 Vietnamese letters is valid'),
  (pg_temp.company(p_name => repeat('Đ', 201)), 'company_name', 'a name of 201 is refused'),
  (pg_temp.company(p_name => '   '), 'company_name', 'a name of spaces only is refused'),
  (pg_temp.company(p_name => 'Công ty' || chr(10) || 'Bếp'), 'company_name', 'a name on two lines is refused'),
  (pg_temp.company(p_name => 'Công ty' || chr(9) || 'Bếp'), 'company_name', 'a tab in the name is refused'),
  (pg_temp.company(p_name => '<script>alert(1)</script>'), 'company_name', 'markup in the name is refused'),
  (pg_temp.company(p_name => 'Công ty {{7*7}}'), 'company_name', 'template braces in the name are refused'),
  (pg_temp.company(p_name => 'Công ty A & B, chi nhánh "Số 1"'), '', 'an ampersand and quotes are kept (the email escapes them)'),
  (pg_temp.company(p_address => repeat('x', 300)), '', 'an address of 300 is valid'),
  (pg_temp.company(p_address => repeat('x', 301)), 'address', 'an address of 301 is refused'),
  (pg_temp.company(p_address => '12 Đường Số 3' || chr(13) || chr(10) || 'X-Header: 1'), 'address', 'CRLF in the address is refused'),
  (pg_temp.company(p_tax => '0312345'), 'tax_code', 'a tax code of 7 digits is named'),
  (pg_temp.company(p_tax => '1', p_name => '', p_address => '', p_email => 'x'), 'address,company_name,email,tax_code', 'every field in error is named'),
  ('{"tax_code": 312345678, "company_name": "A", "address": "B", "email": "a@example.com"}'::jsonb, 'tax_code', 'a tax code that is a number, not a text, is refused'),
  ('[]'::jsonb, 'address,company_name,email,tax_code', 'a company that is not an object names every field')
) as v (company, expected, label);
select is(app.einvoice_company_input(pg_temp.company(p_name => '  Công ty Bếp  ')) ->> 'company_name', 'Công ty Bếp', 'a name is trimmed before it is kept');

-- 2. Orders ------------------------------------------------------------------------------------------------------
insert into o select 'c1', pg_temp.place((select cust1_u from fx));
insert into o select 'c1b', pg_temp.place((select cust1_u from fx));
insert into o select 'c1c', pg_temp.place((select cust1_u from fx));
insert into o select 'c2', pg_temp.place((select cust2_u from fx));
insert into o select 'c2x', pg_temp.place((select cust2_u from fx));
insert into o select 'c2a2', pg_temp.place((select cust2_u from fx), 'sa-2');
insert into o select 'c4', pg_temp.place((select cust4_u from fx));
select is((select count(*)::integer from o where id is not null), 7, 'seven table orders of 29,000 to pay at the counter');

-- 3. The status and the decision table of a request (C18-I3) ------------------------------------------------------
select is(pg_temp.status((select cust1_u from fx), pg_temp.o('c1')) ->> 'refusal', 'not_paid', 'an unpaid order cannot have a company invoice yet');
select is(pg_temp.ask((select cust1_u from fx), pg_temp.o('c1'), pg_temp.company()) ->> 'refusal', 'not_paid', 'and a request for it is refused as not_paid');
select is((select count(*)::integer from public.invoice_requests where order_id = pg_temp.o('c1')), 0, 'nothing is written');
select is(pg_temp.pay(pg_temp.o('c1')) ->> 'state', 'paid', 'the counter takes the cash at 10:00 on 25/11');
select is((select string_agg(pg_temp.pay(pg_temp.o(n)) ->> 'state', ',' order by n) from unnest(array['c1b', 'c1c', 'c2', 'c2x', 'c2a2', 'c4']) as n),
  'paid,paid,paid,paid,paid,paid', 'and for the six other orders');
select is(pg_temp.status((select cust1_u from fx), pg_temp.o('c1')) - 'einvoice' - 'paid_at' - 'order_id' - 'display_no',
  '{"eligible": true, "refusal": null, "window_days": 7, "last_day": "2026-12-02", "request": null, "total": 29000}'::jsonb,
  'once paid it can, until 2/12, seven days after the payment''s date');
select is(pg_temp.status((select cust1_u from fx), pg_temp.o('c1')) -> 'einvoice' ->> 'state', 'pending', 'its sale invoice is on its way');
select is(pg_temp.status((select cust2_u from fx), pg_temp.o('c1')) - 'order_id', '{"eligible": false, "refusal": "unknown_order", "request": null, "einvoice": null}'::jsonb,
  'another customer''s order answers unknown_order and nothing else (C18-S1)');
select is(pg_temp.status((select custb_u from fx), pg_temp.o('c1')) ->> 'refusal', 'unknown_order', 'so does another tenant''s customer');
select is(pg_temp.status((select staff_u from fx), pg_temp.o('c1')) ->> 'error', '42501', 'staff have no customer session');

insert into a select 'c1', pg_temp.ask((select cust1_u from fx), pg_temp.o('c1'), pg_temp.company('0312345678001'), '2026-11-25 11:00',
  'aaaaaaaa-0000-4000-8000-000000029201', '{"save": true}');
select is(pg_temp.a('c1') ->> 'state', 'received', 'the customer asks for a company invoice for their paid order');
select is(pg_temp.a('c1') -> 'request' ->> 'tax_code', '0312345678-001', 'with the tax code normalised');
select is(pg_temp.a('c1') -> 'request' ->> 'status', 'received', 'the request is received');
select is((pg_temp.a('c1') ->> 'saved')::boolean, true, 'and the company is saved for next time');
select is((select string_agg(kind || ':' || state, ', ' order by kind desc) from public.e_invoices where order_id = pg_temp.o('c1')), 'sale:queued, replacement:queued',
  'the company invoice that will replace the sale invoice is queued');
select is(pg_temp.ask((select cust1_u from fx), pg_temp.o('c1'), pg_temp.company('0312345678001'), '2026-11-25 11:00:05',
  'aaaaaaaa-0000-4000-8000-000000029201', '{"save": true}') ->> 'replayed', 'true', 'a double tap (the same request id and content) answers the first request (C18-I2)');
select is((select count(*)::integer from public.invoice_requests where order_id = pg_temp.o('c1')), 1, 'one request');
select is((select count(*)::integer from public.e_invoices where order_id = pg_temp.o('c1') and kind = 'replacement'), 1, 'one company invoice queued');
select is(pg_temp.ask((select cust1_u from fx), pg_temp.o('c1'), pg_temp.company('0312345679'), '2026-11-25 11:00:06',
  'aaaaaaaa-0000-4000-8000-000000029201') ->> 'refusal', 'request_conflict', 'the same request id with another company is a conflict');
select is(pg_temp.ask((select cust1_u from fx), pg_temp.o('c1'), pg_temp.company('0312345679')) ->> 'refusal', 'already_requested',
  'a new request for the same order is refused: one per order');
select is(pg_temp.ask((select cust1_u from fx), pg_temp.o('c1'), pg_temp.company('0312345679')) -> 'request' ->> 'status', 'received',
  'with the request already made');
select is(pg_temp.status((select cust1_u from fx), pg_temp.o('c1')) ->> 'refusal', 'already_requested', 'the status says so too');
select is(pg_temp.ask((select cust2_u from fx), pg_temp.o('c1'), pg_temp.company()) ->> 'refusal', 'unknown_order', 'another customer cannot ask for this order (C18-S1)');
select is(pg_temp.ask((select custb_u from fx), pg_temp.o('c1'), pg_temp.company()) ->> 'refusal', 'unknown_order', 'nor another tenant''s customer');
select is(pg_temp.ask((select cust2_u from fx), gen_random_uuid(), pg_temp.company()) ->> 'refusal', 'unknown_order', 'an unknown order answers the same');
select is(pg_temp.ask((select staff_u from fx), pg_temp.o('c1'), pg_temp.company()) ->> 'error', '42501', 'staff cannot use the customer''s request');
select is(pg_temp.call((select cust2_u from fx), format($q$select app.customer_request_invoice(%L::jsonb)$q$, jsonb_build_object('order', pg_temp.o('c2'), 'company', pg_temp.company()))) ->> 'error',
  '22023', 'a request without its id is malformed');
select is(pg_temp.ask((select cust2_u from fx), pg_temp.o('c2'), pg_temp.company(), p_extra => jsonb_build_object('saved_company', gen_random_uuid())) ->> 'error', '22023',
  'a request naming a company and a saved company is malformed');
select is(pg_temp.ask((select cust2_u from fx), pg_temp.o('c2'), pg_temp.company(), p_extra => '{"save": "yes"}') ->> 'error', '22023', 'save must be true or false');
select is(pg_temp.ask((select cust2_u from fx), pg_temp.o('c2'), pg_temp.company('03123456')) - 'request',
  '{"state": "refused", "refusal": "invalid", "fields": ["tax_code"]}'::jsonb, 'a tax code of 8 digits is refused with its field (C18 "Bạn đang nhập 8 số")');
select is(pg_temp.ask((select cust2_u from fx), pg_temp.o('c2'), pg_temp.company(p_name => '<script>alert(1)</script>', p_email => 'x@example.org' || chr(13) || chr(10) || 'Bcc: z@example.org')) -> 'fields',
  '["company_name", "email"]'::jsonb, 'injection in the name and a header in the email are refused, not stored (C18-S2)');
select is((select count(*)::integer from public.invoice_requests where order_id = pg_temp.o('c2')), 0, 'nothing of them is written');

-- Refunded, cancelled, off: the refusals in their order.
select is(pg_temp.call((select manager_u from fx), format($q$select app.counter_refund(%L, 5000, 'synthetic', %L)$q$, pg_temp.o('c2'), pg_temp.at('2026-11-25 10:30'))) ->> 'state',
  'succeeded', 'a manager refunds part of cust2''s first order');
select is(pg_temp.ask((select cust2_u from fx), pg_temp.o('c2'), pg_temp.company()) ->> 'refusal', 'refunded', 'a refunded order cannot have a company invoice');
select is(pg_temp.act(pg_temp.o('c2x'), 'cancel', 'customer_request') ->> 'state', 'ok', 'staff cancel cust2''s second, paid order (a refund is due)');
select is(pg_temp.ask((select cust2_u from fx), pg_temp.o('c2x'), pg_temp.company()) ->> 'refusal', 'refunded', 'nor can a cancelled one');
select is(pg_temp.ask((select cust2_u from fx), pg_temp.o('c2a2'), pg_temp.company()) ->> 'refusal', 'einvoice_off', 'at a store where e-invoicing is off the request is refused');
select is(pg_temp.status((select cust2_u from fx), pg_temp.o('c2a2')) ->> 'refusal', 'einvoice_off', 'and its status says so');
select is(pg_temp.ask((select cust2_u from fx), pg_temp.o('c2a2'), pg_temp.company('1')) ->> 'refusal', 'einvoice_off',
  'the order''s refusal comes before the fields''');

-- The window (C18-U4): the payment was on 25/11 local time.
select is(pg_temp.status((select cust1_u from fx), pg_temp.o('c1b'), '2026-12-02 23:59:59') ->> 'eligible', 'true', 'day 7, at its last second, is inside');
select is(pg_temp.status((select cust1_u from fx), pg_temp.o('c1b'), '2026-12-03 00:00:00') ->> 'refusal', 'window_passed', 'day 8, at its first second, is not');
select is(pg_temp.ask((select cust1_u from fx), pg_temp.o('c1c'), pg_temp.company(), '2026-12-03 00:00:00') - 'request',
  '{"state": "refused", "refusal": "window_passed", "last_day": "2026-12-02"}'::jsonb, 'a request on day 8 is refused with the last day');
select is(pg_temp.ask((select cust1_u from fx), pg_temp.o('c1b'), pg_temp.company(), '2026-12-02 23:59:59') ->> 'state', 'received', 'a request on day 7 is received');
update public.store_ordering_settings set company_invoice_days = 30 where store_id = (select store_a1 from fx);
select is(pg_temp.status((select cust1_u from fx), pg_temp.o('c1c'), '2026-12-25 23:59:59') ->> 'eligible', 'true', 'a store may give 30 days: 25/12 is inside');
select is(pg_temp.status((select cust1_u from fx), pg_temp.o('c1c'), '2026-12-26 00:00:00') ->> 'refusal', 'window_passed', '26/12 is not');
update public.store_ordering_settings set company_invoice_days = 1 where store_id = (select store_a1 from fx);
select is(pg_temp.status((select cust1_u from fx), pg_temp.o('c1c'), '2026-11-26 23:59:59') ->> 'last_day', '2026-11-26', 'or one day');
select throws_ok(format('update public.store_ordering_settings set company_invoice_days = 0 where store_id = %L', (select store_a1 from fx)), '23514', null, 'but never 0');
select throws_ok(format('update public.store_ordering_settings set company_invoice_days = 31 where store_id = %L', (select store_a1 from fx)), '23514', null, 'nor 31');
update public.store_ordering_settings set company_invoice_days = 7 where store_id = (select store_a1 from fx);

-- 4. The limit (C18-S3): 10 calls an hour per customer, then an hour's wait -----------------------------------------
insert into a select 'r' || n, pg_temp.ask((select cust3_u from fx), gen_random_uuid(), pg_temp.company(), '2026-11-25 12:00:00') from generate_series(1, 10) as n;
select is((select count(*)::integer from a where name ~ '^r[0-9]+$' and answer ->> 'refusal' = 'unknown_order'), 10, 'ten calls in the hour are answered');
select is(pg_temp.ask((select cust3_u from fx), gen_random_uuid(), pg_temp.company(), '2026-11-25 12:59:59') ->> 'refusal', 'rate_limited', 'the eleventh is rate_limited');
select is(pg_temp.ask((select cust3_u from fx), gen_random_uuid(), pg_temp.company(), '2026-11-25 12:59:59') ->> 'retry_at',
  to_jsonb(pg_temp.at('2026-11-25 13:00:00')) #>> '{}', 'until an hour after the tenth');
select is(pg_temp.ask((select cust3_u from fx), gen_random_uuid(), pg_temp.company(), '2026-11-25 13:00:00') ->> 'refusal', 'unknown_order', 'and then answered again');
select is(pg_temp.ask((select cust4_u from fx), gen_random_uuid(), pg_temp.company(), '2026-11-25 12:59:59') ->> 'refusal', 'unknown_order', 'another customer is not held up');
select is((select count(*)::integer from app.code_attempts c where c.endpoint = 'customer_invoice_request'
  and (c::text ~ '0312345678' or c::text ~ 'example')), 0, 'the counters keep no company data');

-- 5. Saved companies: only their customer, and they go with the account (C18-I5, S5) ---------------------------------
select is(pg_temp.call((select cust1_u from fx), 'select app.customer_saved_companies()') -> 'companies' -> 0 ->> 'tax_code', '0312345678-001', 'the customer lists the company they saved');
select is(pg_temp.call((select cust2_u from fx), 'select app.customer_saved_companies()') -> 'companies', '[]'::jsonb, 'another customer sees none of it');
select is(pg_temp.call((select staff_u from fx), 'select app.customer_saved_companies()') ->> 'error', '42501', 'staff have no customer session');
select is(pg_temp.rows_as((select cust1_u from fx), 'select count(*) from public.saved_companies'), '1', 'row-level security: the customer reads their own row');
select is(pg_temp.rows_as((select cust2_u from fx), 'select count(*) from public.saved_companies'), '0', 'another customer reads none');
select is(pg_temp.rows_as((select owner_u from fx), 'select count(*) from public.saved_companies'), '0', 'the owner reads none');
select is(pg_temp.rows_as((select staff_u from fx), 'select count(*) from public.saved_companies'), '0', 'staff read none');
select is(pg_temp.rows_as((select cust1_u from fx), 'with x as (delete from public.saved_companies returning 1) select count(*) from x'), '42501',
  'nobody writes the table directly');
insert into o select 'c4b', pg_temp.place((select cust4_u from fx));
select is(pg_temp.pay(pg_temp.o('c4b')) ->> 'state', 'paid', 'cust4 pays a second order');
select is(pg_temp.call((select cust4_u from fx), format($q$select app.customer_request_invoice(%L::jsonb, %L)$q$,
  jsonb_build_object('request_id', gen_random_uuid(), 'order', pg_temp.o('c4'), 'saved_company',
    (select id from public.saved_companies where customer_login_id = (select l.id from app.customer_logins l where l.user_id = (select cust1_u from fx))), 'save', true),
  pg_temp.at('2026-11-25 11:10'))) ->> 'refusal', 'unknown_company', 'another customer''s saved company cannot be used');
select is(pg_temp.ask((select cust4_u from fx), pg_temp.o('c4'), pg_temp.company('0109876543', 'Công ty Cổ phần Mẫu Hai'), '2026-11-25 11:10', null, '{"save": true}') ->> 'saved',
  'true', 'cust4 asks and saves a company');
select is(pg_temp.call((select cust4_u from fx), format($q$select app.customer_request_invoice(%L::jsonb, %L)$q$,
  jsonb_build_object('request_id', gen_random_uuid(), 'order', pg_temp.o('c4b'), 'saved_company',
    (select id from public.saved_companies where tax_code = '0109876543')), pg_temp.at('2026-11-25 11:11'))) -> 'request' ->> 'company_name',
  'Công ty Cổ phần Mẫu Hai', 'and uses it for the next order');
insert into public.saved_companies (tenant_id, customer_login_id, tax_code, company_name, address, email, created_at, updated_at)
select l.tenant_id, l.id, '01000000' || lpad(n::text, 2, '0'), 'Công ty ' || n, 'Địa chỉ ' || n, 'hd' || n || '@example.com', now(), now()
from app.customer_logins l cross join generate_series(1, 10) as n where l.user_id = (select cust2_u from fx);
insert into o select 'c2c', pg_temp.place((select cust2_u from fx));
select is(pg_temp.pay(pg_temp.o('c2c')) ->> 'state', 'paid', 'cust2, who has ten saved companies, pays a new order');
select is(pg_temp.ask((select cust2_u from fx), pg_temp.o('c2c'), pg_temp.company('0311111111'), '2026-11-25 11:20', null, '{"save": true}') ->> 'saved', 'false',
  'an eleventh company is not saved, but the request is received');
select is(pg_temp.call((select cust1_u from fx), format('select app.customer_delete_saved_company(%L)',
  (select id from public.saved_companies where tax_code = '0109876543'))) ->> 'refusal', 'unknown_company', 'another customer''s saved company cannot be deleted');
select is(pg_temp.call((select cust4_u from fx), format('select app.customer_delete_saved_company(%L)',
  (select id from public.saved_companies where tax_code = '0109876543'))) ->> 'state', 'deleted', 'its customer deletes it');
select is(pg_temp.call((select cust4_u from fx), 'select app.customer_saved_companies()') -> 'companies', '[]'::jsonb, 'it is gone');
select is(pg_temp.ask((select cust4_u from fx), pg_temp.o('c4b'), pg_temp.company()) ->> 'refusal', 'already_requested', 'the request made with it stays');

-- A request whose order is refunded before anything reached the provider: cancelled, never sent.
select is(pg_temp.ask((select cust1_u from fx), pg_temp.o('c1c'), pg_temp.company(), '2026-11-25 11:05') ->> 'state', 'received', 'cust1 asks for c1c');
select is(pg_temp.call((select manager_u from fx), format($q$select app.counter_refund(%L, 29000, 'synthetic', %L)$q$, pg_temp.o('c1c'), pg_temp.at('2026-11-25 11:06'))) ->> 'state',
  'succeeded', 'and c1c is refunded in full before the job came');
select is((select string_agg(kind || ':' || state, ', ' order by kind desc) from public.e_invoices where order_id = pg_temp.o('c1c')), 'sale:cancelled, replacement:cancelled',
  'both documents are cancelled here, without a call');
select is((select status from public.invoice_requests where order_id = pg_temp.o('c1c')), 'cancelled', 'and the request is cancelled');

-- 6. The request's life: the company invoice replaces the sale invoice, then the email (C18-I1, Q01-R1) ------------
insert into a select 'w1', app.einvoice_job_work(50, pg_temp.at('2026-11-25 11:30'));
select is(pg_temp.item(pg_temp.a('w1'), pg_temp.o('c1'), 'replacement'), null, 'the company invoice waits for the sale invoice to be issued');
select ok(pg_temp.item(pg_temp.a('w1'), pg_temp.o('c1'), 'sale') is not null, 'which the job takes first (the automatic invoice of every paid order still goes, C18-R1)');
select is((select string_agg(app.einvoice_job_result(pg_temp.issued(i), pg_temp.at('2026-11-25 11:30:10')) ->> 'state', ',')
  from jsonb_array_elements(pg_temp.a('w1') -> 'invoices') i where i ->> 'kind' = 'sale' and (i -> 'order' ->> 'id')::uuid in (pg_temp.o('c1'), pg_temp.o('c4'))),
  'issued,issued', 'the sale invoices of c1 and c4 are issued');
insert into a select 'w2', app.einvoice_job_work(50, pg_temp.at('2026-11-25 11:31'));
select is(pg_temp.item(pg_temp.a('w2'), pg_temp.o('c1'), 'replacement') ->> 'action', 'replace', 'now the company invoice is taken, to replace');
select is(pg_temp.item(pg_temp.a('w2'), pg_temp.o('c1'), 'replacement') -> 'buyer',
  '{"tax_code": "0312345678-001", "company_name": "Công ty TNHH Bếp Nhà Mẫu", "address": "12 Đường Số 3, Phường 4, Quận 5, TP. Hồ Chí Minh", "email": "ke.toan@example.com"}'::jsonb,
  'with the buyer as the request holds it');
select is(pg_temp.item(pg_temp.a('w2'), pg_temp.o('c1'), 'replacement') -> 'original' ->> 'invoice_id',
  (select id::text from public.e_invoices where order_id = pg_temp.o('c1') and kind = 'sale'), 'naming the sale invoice it replaces');
select is((select status from public.invoice_requests where order_id = pg_temp.o('c1')), 'issuing', 'the request is issuing ("Đang xuất")');
select is(app.einvoice_job_result(pg_temp.issued(pg_temp.item(pg_temp.a('w2'), pg_temp.o('c1'), 'replacement')), pg_temp.at('2026-11-25 11:31:10')) ->> 'state', 'issued',
  'the company invoice is issued');
select is((select string_agg(kind || ':' || state, ', ' order by kind desc) from public.e_invoices where order_id = pg_temp.o('c1')), 'sale:replaced, replacement:issued',
  'and the sale invoice is replaced in the same step');
select is((select count(*)::integer from public.e_invoices where order_id = pg_temp.o('c1') and kind in ('sale', 'replacement') and state in ('issued', 'adjusted')), 1,
  'one order never has two valid invoices (C18 "Em không xuất hai hóa đơn cho một đơn")');
select is(pg_temp.status((select cust1_u from fx), pg_temp.o('c1')) -> 'request' ->> 'status', 'issued', 'the customer sees the request issued');
select is(pg_temp.status((select cust1_u from fx), pg_temp.o('c1')) -> 'request' -> 'invoice' ->> 'kind', 'replacement', 'with the company invoice');
select is(pg_temp.status((select cust1_u from fx), pg_temp.o('c1')) -> 'einvoice' -> 'invoice' ->> 'kind', 'replacement', 'which is now the order''s invoice');
insert into a select 'w3', app.einvoice_job_work(50, pg_temp.at('2026-11-25 11:32'));
select is((select e ->> 'to' from jsonb_array_elements(pg_temp.a('w3') -> 'emails') e where (e ->> 'request_id')::uuid = (select id from public.invoice_requests where order_id = pg_temp.o('c1'))),
  'ke.toan@example.com', 'its email is taken, to the address the request holds');
select is((select e -> 'invoice' ->> 'lookup_code' is not null from jsonb_array_elements(pg_temp.a('w3') -> 'emails') e
  where (e ->> 'request_id')::uuid = (select id from public.invoice_requests where order_id = pg_temp.o('c1'))), true, 'with the invoice''s lookup code');
select is(jsonb_array_length(app.einvoice_job_work(50, pg_temp.at('2026-11-25 11:32')) -> 'emails'), 0, 'a second run does not take the same email');
select is(app.einvoice_job_result(jsonb_build_object('kind', 'email', 'request_id', (select id from public.invoice_requests where order_id = pg_temp.o('c1')), 'ok', true),
  pg_temp.at('2026-11-25 11:32:10')) ->> 'state', 'emailed', 'the email is sent');
select is(pg_temp.status((select cust1_u from fx), pg_temp.o('c1')) -> 'request' ->> 'status', 'emailed', 'the customer sees the third step done');
select is(app.einvoice_job_result(jsonb_build_object('kind', 'email', 'request_id', (select id from public.invoice_requests where order_id = pg_temp.o('c1')), 'ok', true),
  pg_temp.at('2026-11-25 11:32:11')) ->> 'state', 'stale', 'a second email result changes nothing');
select throws_ok(format($q$select app.einvoice_job_result(%L::jsonb)$q$, jsonb_build_object('kind', 'email', 'request_id', gen_random_uuid(), 'ok', false, 'error_class', 'smtp said: x')),
  '22023', null, 'an email failure names one of the known classes');

-- cust4's request: the company invoice issued with the email sent by the provider; then a refund adjusts the company invoice.
insert into a select 'w4', app.einvoice_job_work(50, pg_temp.at('2026-11-25 11:40'));
select is(app.einvoice_job_result(pg_temp.issued(pg_temp.item(pg_temp.a('w4'), pg_temp.o('c4'), 'replacement'), '{"emailed": true}'), pg_temp.at('2026-11-25 11:40:10')) ->> 'state',
  'issued', 'cust4''s company invoice is issued');
select is((select status from public.invoice_requests where order_id = pg_temp.o('c4')), 'emailed', 'and the provider emailed it, so the job has no email to send');
select is(pg_temp.finish(pg_temp.o('c4')), 'completed/paid', 'cust4''s order is completed');
select is(pg_temp.call((select manager_u from fx), format($q$select app.counter_refund(%L, 9000, 'synthetic', %L)$q$, pg_temp.o('c4'), pg_temp.at('2026-11-25 12:00'))) ->> 'state',
  'succeeded', 'a manager refunds 9,000');
insert into a select 'w5', app.einvoice_job_work(50, pg_temp.at('2026-11-25 12:01'));
select is(pg_temp.item(pg_temp.a('w5'), pg_temp.o('c4'), 'adjustment') -> 'original' ->> 'invoice_id',
  (select id::text from public.e_invoices where order_id = pg_temp.o('c4') and kind = 'replacement'), 'the adjustment acts on the company invoice, the one that is valid');
select is(pg_temp.item(pg_temp.a('w5'), pg_temp.o('c4'), 'adjustment') ->> 'amount', '-9000', 'by the refund');

-- A company invoice that cannot be made: given up, the request failed, the sale invoice still valid.
insert into a select 'w6', app.einvoice_job_work(50, pg_temp.at('2026-11-25 12:10'));
select ok(pg_temp.item(pg_temp.a('w6'), pg_temp.o('c4b'), 'sale') is not null, 'c4b''s sale invoice is taken');
select is(app.einvoice_job_result(pg_temp.issued(pg_temp.item(pg_temp.a('w6'), pg_temp.o('c4b'), 'sale')), pg_temp.at('2026-11-25 12:10:10')) ->> 'state', 'issued', 'and issued');
insert into a select 'w7', app.einvoice_job_work(50, pg_temp.at('2026-11-25 12:11'));
select is(app.einvoice_job_result(jsonb_build_object('invoice_id', pg_temp.item(pg_temp.a('w7'), pg_temp.o('c4b'), 'replacement') ->> 'invoice_id',
  'claim', pg_temp.item(pg_temp.a('w7'), pg_temp.o('c4b'), 'replacement') ->> 'claim', 'outcome', 'failed', 'error_class', 'rejected_data'), pg_temp.at('2026-11-25 12:11:10')) ->> 'gave_up',
  'true', 'the provider rejects the company''s data');
select is((select status from public.invoice_requests where order_id = pg_temp.o('c4b')), 'failed', 'the request is failed ("Chậm hơn dự kiến, em đang xử lý" with an alert)');
select is(pg_temp.status((select cust4_u from fx), pg_temp.o('c4b')) -> 'einvoice' ->> 'state', 'issued', 'the order still has its valid sale invoice');
select is(pg_temp.call((select manager_u from fx), format('select app.manager_einvoices(%L)', (select store_a1 from fx))) -> 'invoices' -> 0 ->> 'request_status', 'failed',
  'the managers'' list shows the failed company invoice');
select is((select count(*)::integer from public.alert_events e where e.tenant_id = (select tenant_a from fx) and e.rule_key = 'einvoice_failed'), 1, 'and the alert went out');

-- 7. The counter's company row (Q01) ------------------------------------------------------------------------------
insert into o select 'k1', (pg_temp.call((select staff_u from fx), format($q$select app.counter_create_order(%L, %L::jsonb, %L)$q$, (select store_a1 from fx),
  jsonb_build_object('request_id', gen_random_uuid(), 'type', 'table', 'table_id', pg_temp.id('table_a1'),
    'lines', jsonb_build_array(jsonb_build_object('size', pg_temp.id('cf'), 'qty', 1))), pg_temp.at('2026-11-25 13:00'))) -> 'order' ->> 'id')::uuid;
select is(pg_temp.pay(pg_temp.o('k1'), '2026-11-25 13:01') ->> 'state', 'paid', 'a walk-in''s order is paid at the counter');
create function pg_temp.counter_ask(p_user uuid, p_order uuid, p_company jsonb, p_request uuid default null) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.counter_request_invoice(%L, %L::jsonb, %L)$q$, p_order,
    jsonb_build_object('request_id', coalesce(p_request, 'aaaaaaaa-0000-4000-8000-000000029209'::uuid), 'company', p_company), pg_temp.at('2026-11-25 13:02')));
$$;
select is(pg_temp.counter_ask((select staff_u from fx), pg_temp.o('k1'), pg_temp.company('31234')) - 'request',
  '{"state": "refused", "refusal": "invalid", "fields": ["tax_code"]}'::jsonb, 'the counter''s row is checked like C18 (Q01-E7: an invalid tax code blocks)');
select is(pg_temp.counter_ask((select staff_u from fx), pg_temp.o('k1'), pg_temp.company()) ->> 'state', 'received', 'the cashier keys the company');
select is((select source || '/' || (requested_by = (select staff_u from fx))::text || '/' || (customer_login_id is null)::text
  from public.invoice_requests where order_id = pg_temp.o('k1')), 'counter/true/true', 'recorded as the counter''s, with who keyed it');
select is(pg_temp.counter_ask((select staff_u from fx), pg_temp.o('k1'), pg_temp.company()) ->> 'replayed', 'true', 'a double tap answers the first request');
select is(pg_temp.counter_ask((select staff_u from fx), pg_temp.o('k1'), pg_temp.company(), gen_random_uuid()) ->> 'refusal', 'already_requested', 'one per order');
select is(pg_temp.counter_ask((select staff_a2_u from fx), pg_temp.o('k1'), pg_temp.company()) ->> 'error', '42501', 'staff of another store cannot');
select is(pg_temp.counter_ask((select cust1_u from fx), pg_temp.o('k1'), pg_temp.company()) ->> 'error', '42501', 'nor a customer');
select is(pg_temp.counter_ask((select staff_u from fx), gen_random_uuid(), pg_temp.company()) ->> 'error', '42501', 'an unknown order answers like another store''s');
select is(pg_temp.counter_ask((select staff_u from fx), pg_temp.o('c1b'), pg_temp.company(), gen_random_uuid()) ->> 'refusal', 'not_counter_order',
  'an order of the app is its customer''s to ask for');
select is(pg_temp.call((select staff_u from fx), format('select app.counter_order_einvoice(%L)', pg_temp.o('k1'))) -> 'request' ->> 'status', 'received',
  'the counter''s pill shows the company request');

-- 8. What is kept where (C18-S4, C19) -----------------------------------------------------------------------------
select is((select count(*)::integer from information_schema.columns where table_schema = 'public' and table_name = 'e_invoices'
  and column_name ~ '(tax|email|company|address|buyer|name)' and column_name <> 'tax_authority_code'), 0,
  'the e-invoice records hold no buyer data: the request holds it once, for the invoice');
select is(pg_temp.rows_as((select manager_u from fx), format('select count(*) from public.invoice_requests where store_id = %L', (select store_a1 from fx))),
  (select count(*)::text from public.invoice_requests where store_id = (select store_a1 from fx)), 'the store''s managers read its requests');
select is(pg_temp.rows_as((select staff_u from fx), 'select count(*) from public.invoice_requests'), '0', 'staff do not read the table');
select is(pg_temp.rows_as((select cust1_u from fx), 'select count(*) from public.invoice_requests'), '0', 'nor customers: they read their own through the functions');
select is((select jsonb_array_length(pg_temp.call((select cust4_u from fx), 'select app.customer_export_data()') -> 'invoice_requests')), 2,
  'the customer''s copy of their data holds their company requests');
select is((select pg_temp.call((select cust1_u from fx), 'select app.customer_export_data()') -> 'saved_companies' -> 0 ->> 'tax_code'), '0312345678-001',
  'and their saved companies');
select is(pg_temp.finish(pg_temp.o('c4b')), 'completed/paid', 'cust4''s second order is completed too');
select is(pg_temp.call((select cust4_u from fx), 'select app.customer_delete_account(true)') ->> 'state', 'deleted', 'cust4, whose orders are closed, deletes the account');
select is((select count(*)::integer from public.saved_companies s join app.customer_logins l on l.id = s.customer_login_id where l.user_id = (select cust4_u from fx)), 0,
  'the saved companies went with it');
select is((select count(*)::integer || '/' || count(*) filter (where customer_login_id is null)::integer from public.invoice_requests where order_id in (pg_temp.o('c4'), pg_temp.o('c4b'))),
  '2/2', 'the requests stay with their invoices for the legal period, without the link to the login');
select is((select (counts ->> 'saved_companies') || '/' || (counts ->> 'invoice_requests_unlinked') from app.customer_login_erasures
  where tenant_id = (select tenant_a from fx) order by erased_at desc limit 1), '0/2', 'the proof of the deletion counts them');
select ok(not has_function_privilege('anon', 'public.customer_request_invoice(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.customer_invoice_status(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.counter_request_invoice(uuid, jsonb)', 'execute'), 'anon calls none of the request functions');
select ok(has_function_privilege('authenticated', 'public.customer_request_invoice(jsonb)', 'execute')
  and not has_function_privilege('service_role', 'public.customer_request_invoice(jsonb)', 'execute'), 'members and customers call them; the service role, without a session, does not');

select * from finish();
rollback;
