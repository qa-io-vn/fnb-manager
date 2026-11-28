-- The e-invoice pill follows the document that holds the order back (ADR-069, ADR-070; migration
-- einvoice_pill_holding_document): a company invoice asked for while the sale invoice has failed waits for that sale
-- invoice, so the pill says the sale invoice's state (retrying, or failed once the job gave up) instead of "Đang xuất…",
-- and names the sale invoice, which a manager then sends again; everything else reads as before.
-- Techniques: a decision table of the documents on their way (sale queued, retrying or given up × a company invoice
-- asked or not × the sale invoice issued or not), state transitions (paid → queued → failed → asked → retried → queued;
-- issued → replacing), boundary values (a failed document with and without its next attempt), error guessing (the old
-- answer: the newest document, the company invoice, queued), and security: IDOR across stores and tenants, staff refused
-- the retry only managers may send, no API role on the app function.
begin;
select plan(29);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000030301'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000030302'::uuid as tenant_b,
  'cccccccc-cccc-4ccc-8ccc-000000030301'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000030302'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000030301'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000030302'::uuid as store_a2,
  'ffffffff-ffff-4fff-8fff-000000030303'::uuid as store_b1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000030301'::uuid as brand_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000030302'::uuid as brand_b,
  'eeeeeeee-eeee-4eee-8eee-000000030301'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000030302'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000030303'::uuid as staff_u,
  'eeeeeeee-eeee-4eee-8eee-000000030304'::uuid as staff_a2_u,
  'eeeeeeee-eeee-4eee-8eee-000000030305'::uuid as owner_b_u;

create temp table ids (name text primary key, id uuid not null);
insert into ids values
  ('cat', 'aaaaaaaa-aaaa-4aaa-8aaa-000000030351'), ('item_cf', 'aaaaaaaa-aaaa-4aaa-8aaa-000000030301'),
  ('cf', 'bbbbbbbb-bbbb-4bbb-8bbb-000000030311');
create function pg_temp.id(p_name text) returns uuid language sql stable as $$ select id from ids where name = p_name $$;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'pill-303-' || right(u.id::text, 4) || '@example.com'
from fx cross join lateral (values (fx.owner_u), (fx.manager_u), (fx.staff_u), (fx.staff_a2_u), (fx.owner_b_u)) as u (id);
insert into public.tenants (id, slug, name)
select tenant_a, 'pill-303-a', 'Pill 303 A' from fx union all
select tenant_b, 'pill-303-b', 'Pill 303 B' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'pill-303-a', 'Synthetic account A' from fx union all
select account_b, tenant_b, 'mock', 'pill-303-b', 'Synthetic account B' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name, opening_hours)
select s.id, s.tenant, s.account, s.ext, s.code, s.name,
  '{"mon": [["00:00", "24:00"]], "tue": [["00:00", "24:00"]], "wed": [["00:00", "24:00"]], "thu": [["00:00", "24:00"]], "fri": [["00:00", "24:00"]], "sat": [["00:00", "24:00"]], "sun": [["00:00", "24:00"]]}'::jsonb
from fx cross join lateral (values
  (fx.store_a1, fx.tenant_a, fx.account_a, 'p303-a1', 'sa-1', 'Synthetic store A1'),
  (fx.store_a2, fx.tenant_a, fx.account_a, 'p303-a2', 'sa-2', 'Synthetic store A2'),
  (fx.store_b1, fx.tenant_b, fx.account_b, 'p303-b1', 'sb-1', 'Synthetic store B1')
) as s (id, tenant, account, ext, code, name);
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_a, m.user_id, m.role::public.tenant_role, m.store_ids
from fx cross join lateral (values
  (fx.owner_u, 'owner', null::uuid[]), (fx.manager_u, 'manager', array[fx.store_a1]), (fx.staff_u, 'staff', array[fx.store_a1]),
  (fx.staff_a2_u, 'staff', array[fx.store_a2])
) as m (user_id, role, store_ids)
union all
select tenant_b, owner_b_u, 'owner', null from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_a, tenant_a, 'brand-1', 'Synthetic brand A', array[store_a1, store_a2] from fx union all
select brand_b, tenant_b, 'brand-1', 'Synthetic brand B', array[store_b1] from fx;
insert into public.store_ordering_settings (store_id, tenant_id, till_mode, ordering_enabled, order_types, staff_presence_required)
select store_a1, tenant_a, 'native', true, array['takeaway'], false from fx union all
select store_a2, tenant_a, 'native', true, array['takeaway'], false from fx union all
select store_b1, tenant_b, 'native', true, array['takeaway'], false from fx;
insert into public.menu_categories (id, tenant_id, brand_id, name, sort_order)
select pg_temp.id('cat'), tenant_a, brand_a, 'Đồ uống', 10 from fx;
insert into public.menu_items (id, tenant_id, brand_id, category_id, name, counts_for_stamps, order_types)
select pg_temp.id('item_cf'), tenant_a, brand_a, pg_temp.id('cat'), 'Cà phê sữa', true, array['takeaway'] from fx;
insert into public.menu_item_sizes (id, tenant_id, brand_id, item_id, label, price, sort_order, is_default)
select pg_temp.id('cf'), tenant_a, brand_a, pg_temp.id('item_cf'), null, 29000, 10, true from fx;
-- Cash is taken only on a shift at the store (migration counter_payment_needs_shift).
insert into public.staff_shifts (tenant_id, store_id, user_id, business_date, clock_in_at, status)
select tenant_a, store_a1, staff_u, (now() at time zone 'Asia/Ho_Chi_Minh')::date, now() - interval '2 hours', 'open' from fx;

-- Helpers: a caller's claims for one statement (JSON, or {"error": SQLSTATE}); Vietnam time; a counter order paid in
-- cash; a company asked for it at the counter; the pill as staff read it; the documents moved as the job records them.
create function pg_temp.call(p_user uuid, p_sql text) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  begin
    execute p_sql into v;
  exception when others then
    v := jsonb_build_object('error', sqlstate);
  end;
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$$;
-- Times are minutes from the transaction's now(): the trigger that queues a sale invoice stamps it with now().
create function pg_temp.at(p_minutes numeric) returns timestamptz language sql stable as $$ select now() + make_interval(secs => p_minutes * 60) $$;
create function pg_temp.paid() returns uuid language plpgsql as $$
declare
  v_order uuid;
begin
  v_order := (pg_temp.call((select staff_u from fx), format($q$select app.counter_create_order(%L, %L::jsonb, %L)$q$, (select store_a1 from fx),
    jsonb_build_object('request_id', gen_random_uuid(), 'type', 'takeaway',
      'lines', jsonb_build_array(jsonb_build_object('size', pg_temp.id('cf'), 'qty', 1))), pg_temp.at(-60))) -> 'order' ->> 'id')::uuid;
  perform pg_temp.call((select staff_u from fx), format($q$select app.counter_record_payment(%L, 'cash', %s, %s, %L)$q$, v_order,
    (select o.total from public.orders o where o.id = v_order), (select o.version from public.orders o where o.id = v_order), pg_temp.at(-59)));
  return v_order;
end;
$$;
create function pg_temp.ask(p_order uuid) returns text language sql as $$
  select pg_temp.call((select staff_u from fx), format($q$select app.counter_request_invoice(%L, %L::jsonb, %L)$q$, p_order,
    jsonb_build_object('request_id', gen_random_uuid(), 'company', jsonb_build_object('tax_code', '0312345678', 'company_name', 'Công ty TNHH Mẫu',
      'address', '12 Đường Mẫu, Quận 1', 'email', 'ketoan@example.com')), pg_temp.at(1))) ->> 'state';
$$;
create function pg_temp.pill(p_user uuid, p_order uuid) returns jsonb language sql as $$
  select pg_temp.call(p_user, format('select app.counter_order_einvoice(%L)', p_order));
$$;
create function pg_temp.fail(p_order uuid, p_kind text, p_gave_up boolean) returns uuid language sql as $$
  update public.e_invoices e
  set state = 'failed', attempts = case when p_gave_up then 10 else 1 end, round_attempts = case when p_gave_up then 10 else 1 end,
    last_error_class = case when p_gave_up then 'rejected_data' else 'timeout' end, last_attempt_at = pg_temp.at(-50),
    next_attempt_at = case when p_gave_up then null else pg_temp.at(30) end,
    gave_up_at = case when p_gave_up then pg_temp.at(-50) end
  where e.order_id = p_order and e.kind = p_kind and e.state = 'queued'
  returning e.id;
$$;
create function pg_temp.issue(p_order uuid) returns uuid language sql as $$
  update public.e_invoices e
  set state = 'issued', mode = 'sandbox', provider_ref = 'mock-303-' || left(e.id::text, 8), invoice_no = '000303', invoice_series = '2C26MAA',
    amount = 29000, attempts = 1, round_attempts = 1, last_attempt_at = pg_temp.at(-50), issued_at = pg_temp.at(-50),
    settled_at = pg_temp.at(-50)
  where e.order_id = p_order and e.kind = 'sale' and e.state = 'queued'
  returning e.id;
$$;
create function pg_temp.doc(p_order uuid, p_kind text) returns uuid language sql stable as $$
  select e.id from public.e_invoices e where e.order_id = p_order and e.kind = p_kind and e.state <> 'cancelled';
$$;
create temp table o (name text primary key, id uuid);
create function pg_temp.o(p_name text) returns uuid language sql stable as $$ select id from o where name = p_name $$;

select pg_temp.call((select owner_u from fx), format($q$select app.einvoice_set_provider(%L::jsonb, %L)$q$,
  jsonb_build_object('brand', (select brand_a from fx), 'adapter', 'mock', 'mode', 'sandbox', 'secret_name', 'EINVOICE_KEY_BRAND_1',
    'settings', jsonb_build_object('seller_tax_code', '0312345678', 'template', '2', 'series', 'C26MAA', 'vat_rate', 'none')), pg_temp.at(-120)));
insert into o values ('k1', pg_temp.paid()), ('k2', pg_temp.paid()), ('k3', pg_temp.paid()), ('k4', pg_temp.paid()), ('k5', pg_temp.paid());

-- 1. One document on its way, or both queued: as before ------------------------------------------------------------

select is(pg_temp.pill((select staff_u from fx), pg_temp.o('k1')) ->> 'state', 'pending', 'a paid order: its sale invoice is on its way (Đang xuất…)');
select is(pg_temp.ask(pg_temp.o('k1')), 'received', 'a company invoice is asked for it at the counter');
select is(pg_temp.pill((select staff_u from fx), pg_temp.o('k1')) ->> 'state', 'pending', 'both queued: still Đang xuất…');
select is(pg_temp.pill((select staff_u from fx), pg_temp.o('k1')) -> 'invoice' ->> 'kind', 'replacement', 'naming the newest, the company invoice, as before');

-- 2. The sale invoice failing, then a company invoice asked (the fix) --------------------------------------------------

select isnt(pg_temp.fail(pg_temp.o('k2'), 'sale', false), null, 'k2''s sale invoice fails once; the job will try again');
select is(pg_temp.pill((select staff_u from fx), pg_temp.o('k2')) ->> 'state', 'retrying', 'the pill says so (Chưa xuất được)');
select is(pg_temp.ask(pg_temp.o('k2')), 'received', 'a company invoice is asked meanwhile');
select is((select e.kind || ':' || e.state from public.e_invoices e where e.order_id = pg_temp.o('k2') and e.state in ('queued', 'issuing', 'failed')
  order by e.queued_at desc, e.id limit 1), 'replacement:queued',
  'the newest document on its way is the queued company invoice (what the pill read before)');
select is(app.einvoice_ready((select e from public.e_invoices e where e.id = pg_temp.doc(pg_temp.o('k2'), 'replacement')), pg_temp.at(5)), false,
  'which waits for the sale invoice and is not taken by the job');
select is(pg_temp.pill((select staff_u from fx), pg_temp.o('k2')) ->> 'state', 'retrying', 'so the pill keeps saying the sale invoice is retried, not Đang xuất…');
select is(pg_temp.pill((select staff_u from fx), pg_temp.o('k2')) -> 'invoice' ->> 'id', pg_temp.doc(pg_temp.o('k2'), 'sale')::text, 'and names the sale invoice');
select is((select (p ->> 'attempts') || ' ' || (p ->> 'next_attempt_at')::timestamptz::text from (select pg_temp.pill((select staff_u from fx), pg_temp.o('k2')) as p) q),
  '1 ' || pg_temp.at(30)::text, 'with its attempts and next attempt');
select is(pg_temp.pill((select staff_u from fx), pg_temp.o('k2')) -> 'request' ->> 'status', 'received', 'the company request is still answered beside it');

select isnt(pg_temp.fail(pg_temp.o('k3'), 'sale', true), null, 'k3''s sale invoice is given up (rejected data)');
select is(pg_temp.ask(pg_temp.o('k3')), 'received', 'and a company invoice is asked');
select is(pg_temp.pill((select staff_u from fx), pg_temp.o('k3')) ->> 'state', 'failed', 'the pill says failed, not Đang xuất…');
select is(pg_temp.pill((select staff_u from fx), pg_temp.o('k3')) -> 'invoice' ->> 'id', pg_temp.doc(pg_temp.o('k3'), 'sale')::text, 'naming the failed sale invoice');
select is(pg_temp.call((select staff_u from fx), format('select app.manager_retry_einvoice(%L, %L)',
  pg_temp.pill((select staff_u from fx), pg_temp.o('k3')) -> 'invoice' ->> 'id', pg_temp.at(5))) ->> 'error', '42501',
  'staff cannot send it again (managers only)');
select is(pg_temp.call((select manager_u from fx), format('select app.manager_retry_einvoice(%L, %L)',
  pg_temp.pill((select staff_u from fx), pg_temp.o('k3')) -> 'invoice' ->> 'id', pg_temp.at(5))) ->> 'state', 'queued',
  'a manager sends the invoice the pill names again');
select is(pg_temp.pill((select staff_u from fx), pg_temp.o('k3')) ->> 'state', 'pending', 'and the pill says Đang xuất… once it is queued');

-- 3. A failed document with and without its next attempt (boundary); the sale invoice issued (as before) -------------

select isnt(pg_temp.fail(pg_temp.o('k4'), 'sale', true), null, 'k4''s sale invoice is given up, no company invoice asked');
select is(pg_temp.pill((select staff_u from fx), pg_temp.o('k4')) ->> 'state', 'failed', 'without a next attempt: failed');
select isnt(pg_temp.issue(pg_temp.o('k5')), null, 'k5''s sale invoice is issued');
select is(pg_temp.ask(pg_temp.o('k5')), 'received', 'a company invoice is asked');
select isnt(pg_temp.fail(pg_temp.o('k5'), 'replacement', true), null, 'and given up');
select is((select (p ->> 'state') || ' ' || (p ->> 'replacing') || ' ' || (p -> 'invoice' ->> 'kind')
  from (select pg_temp.pill((select staff_u from fx), pg_temp.o('k5')) as p) q), 'issued true sale',
  'the order still holds its valid sale invoice: issued, a company invoice replacing it');

-- 4. Security ---------------------------------------------------------------------------------------------------------

select is(pg_temp.pill((select staff_a2_u from fx), pg_temp.o('k3')) ->> 'error', '42501', 'staff of another store are refused the pill (IDOR)');
select is(pg_temp.pill((select owner_b_u from fx), pg_temp.o('k3')) ->> 'error', '42501', 'so is another tenant''s owner');
select ok(not has_function_privilege('anon', 'app.einvoice_pill(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.einvoice_pill(uuid)', 'execute')
  and not has_function_privilege('service_role', 'app.einvoice_pill(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.counter_order_einvoice(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.counter_order_einvoice(uuid)', 'execute'),
  'no API role executes the pill itself; only authenticated reaches it through the counter''s RPC');

select * from finish();
rollback;
