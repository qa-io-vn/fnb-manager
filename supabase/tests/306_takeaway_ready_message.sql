-- "Món mang đi đã xong" (migration takeaway_ready_message, ADR-072, ADR-065): when a takeaway order of a customer's
-- Zalo account turns ready, the order screen says so (in the app, always) and a customer who joined the stamp
-- programme gets a customer message through the outbox: the ZBS template order_ready between 06:00 and 22:00 when the
-- tenant's ZBS is on and the template approved (a mock in tests; off until Zalo approves it), otherwise in the app.
-- Techniques: a decision table of the message (a visitor or a member; messaging on or off; the route setting; ZBS on or
-- off; inside or outside the template hours) with the outcome queued, sent as a template or closed in the app;
-- boundary values of the hours (21:59 and 22:00 at the claim) and of the message's life (an hour after it turned
-- ready); equivalence partitions of the orders that never queue one (a table order, a takeaway keyed at the counter,
-- a cancelled one); and the privacy rule (no name, phone or text stored on the row).
begin;
select plan(25);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000030601'::uuid as tenant_a,
  'cccccccc-cccc-4ccc-8ccc-000000030601'::uuid as account_a,
  'ffffffff-ffff-4fff-8fff-000000030601'::uuid as store_a1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000030601'::uuid as brand_a,
  '99999999-9999-4999-8999-000000030601'::uuid as app_a,
  '66666666-6666-4666-8666-000000030601'::uuid as oa_a,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000030691'::uuid as programme_a,
  '77777777-7777-4777-8777-000000030601'::uuid as customer_m,
  '88888888-8888-4888-8888-000000030601'::uuid as member_m,
  'eeeeeeee-eeee-4eee-8eee-000000030603'::uuid as staff_u,
  'eeeeeeee-eeee-4eee-8eee-000000030611'::uuid as member_u,
  'eeeeeeee-eeee-4eee-8eee-000000030612'::uuid as visitor_u;
grant select on fx to authenticated, anon;

create temp table ids (name text primary key, id uuid not null);
insert into ids values
  ('cat', 'aaaaaaaa-aaaa-4aaa-8aaa-000000030651'), ('item', 'aaaaaaaa-aaaa-4aaa-8aaa-000000030601'), ('size', 'bbbbbbbb-bbbb-4bbb-8bbb-000000030611'),
  ('table', 'aaaaaaaa-aaaa-4aaa-8aaa-000000030641');
grant select on ids to authenticated, anon;
create function pg_temp.id(p_name text) returns uuid language sql stable as $$ select id from ids where name = p_name $$;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'takeaway-306-' || right(u.id::text, 4) || '@example.com', u.meta
from fx cross join lateral (values
  (fx.staff_u, '{}'::jsonb), (fx.member_u, jsonb_build_object('kind', 'customer', 'tenant_id', fx.tenant_a)), (fx.visitor_u, jsonb_build_object('kind', 'customer', 'tenant_id', fx.tenant_a))
) as u (id, meta);
insert into public.tenants (id, slug, name, country_code) select tenant_a, 'takeaway-306-a', 'Takeaway 306 A', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) select account_a, tenant_a, 'mock', 'takeaway-306-a', 'Synthetic account A' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name, opening_hours)
select store_a1, tenant_a, account_a, 't306-a1', 'tr-1', 'Synthetic store A1',
  '{"mon": [["00:00", "24:00"]], "tue": [["00:00", "24:00"]], "wed": [["00:00", "24:00"]], "thu": [["00:00", "24:00"]], "fri": [["00:00", "24:00"]], "sat": [["00:00", "24:00"]], "sun": [["00:00", "24:00"]]}'::jsonb
from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids) select tenant_a, staff_u, 'staff'::public.tenant_role, array[store_a1] from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids) select brand_a, tenant_a, 'brand-1', 'Synthetic brand A', array[store_a1] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status) select app_a, tenant_a, brand_a, 'synthetic-306-app-a', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx;
insert into public.oas (id, tenant_id, brand_id, external_id, package_tier, verified, secret_name)
select oa_a, tenant_a, brand_a, 'synthetic-306-oa-a', 'tang_truong', true, 'ZALO_OA_SECRET_BRAND_1' from fx;
-- The member joined the stamp programme with a phone (a synthetic number) and gave the loyalty consent; the visitor
-- only signed in with Zalo.
insert into public.customers (id, tenant_id, phone, name) select customer_m, tenant_a, '0900000' || '306', 'Synthetic member' from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status)
select programme_a, tenant_a, 'Synthetic programme', date '2026-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from fx;
insert into public.memberships (id, tenant_id, programme_id, customer_id, channel, joined_at, brand_id)
select member_m, tenant_a, programme_a, customer_m, 'mini_app', '2026-11-01 10:00+07'::timestamptz, brand_a from fx;
insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at)
select tenant_a, 'customer'::public.consent_subject, customer_m, 'loyalty'::public.consent_purpose, 'synthetic-v1', 'mini_app', '2026-11-01 10:00+07'::timestamptz from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id, customer_id)
select tenant_a, app_a, 'syn-zalo-306-m', member_u, customer_m from fx union all
select tenant_a, app_a, 'syn-zalo-306-v', visitor_u, null from fx;
insert into public.store_ordering_settings (store_id, tenant_id, till_mode, ordering_enabled, order_types, payment_methods, staff_presence_required, prep_minutes)
select store_a1, tenant_a, 'native', true, array['table', 'takeaway'], array['counter', 'vietqr'], false, 15 from fx;
insert into public.menu_categories (id, tenant_id, brand_id, name) select pg_temp.id('cat'), tenant_a, brand_a, 'Đồ uống' from fx;
insert into public.menu_items (id, tenant_id, brand_id, category_id, name, order_types) select pg_temp.id('item'), tenant_a, brand_a, pg_temp.id('cat'), 'Cà phê', array['table', 'takeaway'] from fx;
insert into public.menu_item_sizes (id, tenant_id, brand_id, item_id, price, is_default) select pg_temp.id('size'), tenant_a, brand_a, pg_temp.id('item'), 40000, true from fx;
insert into public.store_tables (id, tenant_id, store_id, label) select pg_temp.id('table'), tenant_a, store_a1, 'Bàn 1' from fx;
insert into public.staff_shifts (tenant_id, store_id, user_id, business_date, clock_in_at, opening_cash)
select tenant_a, store_a1, staff_u, date '2026-11-27', '2026-11-27 07:00+07'::timestamptz, 0 from fx;

create function pg_temp.at(p_text text) returns timestamptz language sql immutable as $$ select (p_text || '+07')::timestamptz $$;
create function pg_temp.claims(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated',
    'app_metadata', coalesce((select jsonb_build_object('kind', 'customer', 'tenant_id', l.tenant_id) from app.customer_logins l where l.user_id = p_user), '{}'::jsonb))::text, true);
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
-- A paid takeaway order of the customer for a pick-up at p_pickup, placed and paid at p_at, started and made ready at
-- p_ready, and collected a minute later unless p_collect is false (a customer holds at most three open orders).
create function pg_temp.ready_takeaway(p_user uuid, p_pickup text, p_at text, p_ready text, p_collect boolean default true) returns uuid language plpgsql as $$
declare
  v_order uuid;
  v_start jsonb;
begin
  v_order := (pg_temp.call(p_user, format($q$select app.customer_place_order(%L::jsonb, %L)$q$, jsonb_build_object('request_id', gen_random_uuid(), 'store', 'tr-1',
    'type', 'takeaway', 'payment', 'vietqr', 'lines', jsonb_build_array(jsonb_build_object('size', pg_temp.id('size'), 'qty', 1)), 'expected_total', 40000,
    'pickup_at', to_char(pg_temp.at(p_pickup) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), pg_temp.at(p_at))) -> 'order' ->> 'id')::uuid;
  v_start := app.checkout_payment_start((select l.user_id from app.customer_logins l join public.orders o on o.customer_login_id = l.id where o.id = v_order),
    v_order, 'vietqr', 'key-' || replace(v_order::text, '-', ''), pg_temp.at(p_at));
  perform app.checkout_payment_confirm('vietqr', 'ref-' || replace(v_order::text, '-', ''), (v_start ->> 'payment_id')::uuid, 40000, true, null, pg_temp.at(p_at));
  perform pg_temp.call((select staff_u from fx), format($q$select app.counter_order_act(%L, 'start', %s, null, %L)$q$, v_order, (select o.version from public.orders o where o.id = v_order), pg_temp.at(p_ready)));
  perform pg_temp.call((select staff_u from fx), format($q$select app.counter_order_act(%L, 'done', %s, null, %L)$q$, v_order, (select o.version from public.orders o where o.id = v_order), pg_temp.at(p_ready)));
  if p_collect then
    perform pg_temp.call((select staff_u from fx), format($q$select app.counter_order_act(%L, 'complete', %s, null, %L)$q$, v_order, (select o.version from public.orders o where o.id = v_order), pg_temp.at(p_ready) + interval '1 minute'));
  end if;
  return v_order;
end;
$$;
create function pg_temp.message(p_order uuid) returns public.outbound_messages language sql stable as $$
  select o.* from public.outbound_messages o where o.tenant_id = (select tenant_a from fx) and o.dedupe_key = 'customer:takeaway_ready:order:' || p_order::text;
$$;
create function pg_temp.claim(p_at text) returns jsonb language sql as $$
  select to_jsonb(c) from app.claim_next_customer_message('pgtap-306', array['consultation', 'template'], interval '2 minutes', pg_temp.at(p_at), (select tenant_a from fx)) c;
$$;
create temp table o (name text primary key, id uuid);
create function pg_temp.o(p_name text) returns uuid language sql stable as $$ select id from o where name = p_name $$;

-- 1. Messaging off: the app alone ----------------------------------------------------------------------------------
insert into o select 'off', pg_temp.ready_takeaway((select member_u from fx), '2026-11-27 15:00', '2026-11-27 14:05', '2026-11-27 14:50', false);
select is((select status::text from public.orders where id = pg_temp.o('off')), 'ready', 'a paid takeaway is made ready at the counter');
select is((pg_temp.call((select member_u from fx), format($q$select app.customer_order(%L, %L)$q$, pg_temp.o('off'), pg_temp.at('2026-11-27 14:51'))) -> 'order' ->> 'status'),
  'ready', 'the customer''s order screen shows it ready: in the app, always');
select is((select count(*)::integer from public.outbound_messages where tenant_id = (select tenant_a from fx)), 0, 'with the tenant''s customer messages off nothing is queued');

-- 2. Messaging on, ZBS off: queued, then closed in the app -----------------------------------------------------------
insert into app.customer_message_settings (tenant_id, enabled, zbs_enabled) select tenant_a, true, false from fx;
insert into o select 'zbs_off', pg_temp.ready_takeaway((select member_u from fx), '2026-11-27 15:15', '2026-11-27 14:06', '2026-11-27 15:00');
select is((select row(m.kind, m.channel, m.status, m.recipient_ref, m.message_class::text, m.template_ref, m.title, m.body)::text from pg_temp.message(pg_temp.o('zbs_off')) m),
  row('takeaway_ready', 'mini_app', 'queued', 'membership:' || (select member_m from fx), 'transactional', 'customer.takeaway_ready.v1', null::text, null::text)::text,
  'a member''s ready order queues one takeaway_ready message on the in-app channel, with an opaque recipient and no text');
select is((select to_char(m.expires_at at time zone 'Asia/Ho_Chi_Minh', 'HH24:MI') from pg_temp.message(pg_temp.o('zbs_off')) m),
  '16:00', 'it lives an hour after the order turned ready (15:00)');
select is((select m.params ->> 'order_id' from pg_temp.message(pg_temp.o('zbs_off')) m), pg_temp.o('zbs_off')::text, 'its parameters name the order, nothing personal');
select is(pg_temp.claim('2026-11-27 15:01'), null, 'with ZBS off no adapter is handed anything');
select is((select row(m.status, m.channel, m.decision, m.cost_amount)::text from pg_temp.message(pg_temp.o('zbs_off')) m),
  row('sent', 'mini_app', 'templates_disabled', 0::numeric(14,2))::text, 'and the message is closed in the app at no cost (ZBS off)');

-- 3. ZBS on with the approved template (the mock in tests) ---------------------------------------------------------
update app.customer_message_settings set zbs_enabled = true where tenant_id = (select tenant_a from fx);
insert into public.zbs_templates (tenant_id, oa_id, external_id, tag, purpose, approval_state)
select tenant_a, oa_a, 'syn-tpl-order-ready', 'transaction', 'order_ready', 'approved' from fx;
insert into o select 'day', pg_temp.ready_takeaway((select member_u from fx), '2026-11-27 15:30', '2026-11-27 14:07', '2026-11-27 15:20');
create temp table day_claim as select pg_temp.claim('2026-11-27 15:21') as c;
select is((select c ->> 'route' || ' ' || (c ->> 'template_purpose') || ' ' || (c ->> 'template_external_id') from day_claim), 'template order_ready syn-tpl-order-ready',
  'between 06:00 and 22:00 it goes as the approved ZBS template order_ready');
select is((select (c ->> 'recipient_kind') || ' ' || (c ->> 'recipient') from day_claim), 'phone 84900000306', 'to the member''s phone in international digits');
select is((select c -> 'parameters' from day_claim),
  jsonb_build_object('customer_name', 'Synthetic member', 'store_name', 'Synthetic store A1', 'order_no', (select app.order_display_no(order_no) from public.orders where id = pg_temp.o('day')), 'pickup_time', '15:30'),
  'its parameters are resolved at send time: the name, the store, the order number and the pick-up time');
select is((select row(m.status, m.channel, m.template_ref)::text from pg_temp.message(pg_temp.o('day')) m), row('sending', 'zalo_zbs', 'zbs.order_ready.v1')::text, 'the row is sending on ZBS');
select ok(app.begin_customer_send((select (c ->> 'message_id')::uuid from day_claim), (select (c ->> 'claimed_at')::timestamptz from day_claim), pg_temp.at('2026-11-27 15:21')), 'the dispatcher begins the send');
select is(app.finish_customer_send((select (c ->> 'message_id')::uuid from day_claim), (select (c ->> 'claimed_at')::timestamptz from day_claim), 'sent', null, 'mock-zbs-306', null, pg_temp.at('2026-11-27 15:21')),
  'sent', 'the mock ZBS accepts it and the message is sent');
select ok(not exists (select 1 from public.outbound_messages o where o.tenant_id = (select tenant_a from fx)
  and (o::text like '%Synthetic member%' or o::text like '%900000306%')), 'neither the name nor the phone is stored on any row');

-- 4. After 22:00: the app alone ---------------------------------------------------------------------------------------
insert into o select 'late', pg_temp.ready_takeaway((select member_u from fx), '2026-11-27 22:15', '2026-11-27 21:30', '2026-11-27 21:59');
select is(pg_temp.claim('2026-11-27 21:59') ->> 'route', 'template', 'boundary: claimed at 21:59 it still goes by ZBS');
update public.outbound_messages set status = 'cancelled', decision = 'pgtap' where id = (select id from pg_temp.message(pg_temp.o('late')));
insert into o select 'night', pg_temp.ready_takeaway((select member_u from fx), '2026-11-27 22:30', '2026-11-27 21:31', '2026-11-27 22:00');
select is(pg_temp.claim('2026-11-27 22:00'), null, 'boundary: at 22:00 nothing is handed to ZBS');
select is((select row(m.status, m.channel, m.decision)::text from pg_temp.message(pg_temp.o('night')) m), row('sent', 'mini_app', 'outside_hours')::text,
  'the message is closed in the app: ZBS would wait for 06:00, longer than its hour');
update app.customer_message_settings set order_ready_route = 'in_app' where tenant_id = (select tenant_a from fx);
insert into o select 'in_app', pg_temp.ready_takeaway((select member_u from fx), '2026-11-27 16:00', '2026-11-27 14:09', '2026-11-27 15:40');
select is(pg_temp.claim('2026-11-27 15:41'), null, 'a tenant that keeps "takeaway ready" in the app sends no ZBS');
select is((select row(m.status, m.decision)::text from pg_temp.message(pg_temp.o('in_app')) m), row('sent', 'in_app_only')::text, 'its message closes in the app');
update app.customer_message_settings set order_ready_route = 'template' where tenant_id = (select tenant_a from fx);

-- 5. Orders that never queue one ---------------------------------------------------------------------------------------
insert into o select 'visitor', pg_temp.ready_takeaway((select visitor_u from fx), '2026-11-27 16:15', '2026-11-27 14:10', '2026-11-27 16:00');
select is((select count(*)::integer from public.outbound_messages m where m.dedupe_key = 'customer:takeaway_ready:order:' || pg_temp.o('visitor')::text), 0, 'a visitor who never joined gets the order screen only: no message to queue');
insert into o select 'table', (pg_temp.call((select member_u from fx), format($q$select app.customer_place_order(%L::jsonb, %L)$q$, jsonb_build_object('request_id', gen_random_uuid(), 'store', 'tr-1',
  'type', 'table', 'payment', 'counter', 'table_token', app.table_qr_token((select tenant_a from fx), pg_temp.id('table'), 1),
  'lines', jsonb_build_array(jsonb_build_object('size', pg_temp.id('size'), 'qty', 1)), 'expected_total', 40000), pg_temp.at('2026-11-27 14:11'))) -> 'order' ->> 'id')::uuid;
select is((pg_temp.call((select staff_u from fx), format($q$select app.counter_order_act(%L, 'start', 1, null, %L)$q$, pg_temp.o('table'), pg_temp.at('2026-11-27 14:12'))) ->> 'state')
  || (pg_temp.call((select staff_u from fx), format($q$select app.counter_order_act(%L, 'done', 2, null, %L)$q$, pg_temp.o('table'), pg_temp.at('2026-11-27 14:13'))) -> 'order' ->> 'status'),
  'okserving', 'a table order is brought to the table');
select is((select count(*)::integer from public.outbound_messages m where m.dedupe_key = 'customer:takeaway_ready:order:' || pg_temp.o('table')::text), 0, 'and gets no Zalo message (table orders never do)');
insert into o select 'keyed', (pg_temp.call((select staff_u from fx), format($q$select app.counter_create_order(%L, %L::jsonb, %L)$q$, (select store_a1 from fx),
  jsonb_build_object('request_id', gen_random_uuid(), 'type', 'takeaway', 'lines', jsonb_build_array(jsonb_build_object('size', pg_temp.id('size'), 'qty', 1))),
  pg_temp.at('2026-11-27 14:14'))) -> 'order' ->> 'id')::uuid;
select is((select count(*)::integer from public.outbound_messages where tenant_id = (select tenant_a from fx) and params ->> 'order_id' = pg_temp.o('keyed')::text), 0,
  'a takeaway keyed at the counter has no customer to message');
select is(
  (select count(*)::integer from (values ('anon'), ('authenticated'), ('service_role')) r (role)
   where has_function_privilege(r.role, 'app.enqueue_takeaway_ready()', 'execute')),
  0, 'no API role runs the trigger function');

select * from finish();
rollback;
