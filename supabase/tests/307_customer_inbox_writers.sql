-- C12's inbox writers (migrations customer_inbox and order_cancel_refund_messages, ADR-073; the owner's plan,
-- notifications): which event writes which item, and which events also queue a paid Zalo message.
-- Techniques: a decision table of the order events (ready at a table or for takeaway, a payment above 0 or paid by a
-- reward, a voided payment, a cancellation by the customer, the system or the shop, of an order paid or not, a refund
-- in cash, by card or online, a failed online refund) × the customer (a member with a phone or a visitor) with the
-- outcome: the item and its parameters, and the outbox message (none, order_cancelled five minutes on, order_refunded);
-- state transitions of the cancellation message (queued, held back until 5 minutes, superseded by a refund, sent);
-- boundary values of that delay (4:59 not claimed, 5:00 claimed) and of the stamp card (8 of 9, exactly 9, 10);
-- equivalence partitions of the promotions (delivered or not, with and without the marketing consent); error guessing
-- on repeated events (one item each); and the regression of takeaway_ready (its own message still queued).
begin;
select plan(68);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000030701'::uuid as tenant_a,
  'cccccccc-cccc-4ccc-8ccc-000000030701'::uuid as account_a,
  'ffffffff-ffff-4fff-8fff-000000030701'::uuid as store_a1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000030701'::uuid as brand_a,
  '99999999-9999-4999-8999-000000030701'::uuid as app_a,
  '66666666-6666-4666-8666-000000030701'::uuid as oa_a,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000030791'::uuid as programme_a,
  '77777777-7777-4777-8777-000000030701'::uuid as customer_m,
  '88888888-8888-4888-8888-000000030701'::uuid as member_m,
  'eeeeeeee-eeee-4eee-8eee-000000030703'::uuid as staff_u,
  'eeeeeeee-eeee-4eee-8eee-000000030704'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000030711'::uuid as member_u,
  'eeeeeeee-eeee-4eee-8eee-000000030712'::uuid as visitor_u;
grant select on fx to authenticated, anon;

create temp table ids (name text primary key, id uuid not null);
insert into ids values
  ('cat', 'aaaaaaaa-aaaa-4aaa-8aaa-000000030751'), ('item', 'aaaaaaaa-aaaa-4aaa-8aaa-000000030701'), ('size', 'bbbbbbbb-bbbb-4bbb-8bbb-000000030711'),
  ('table', 'aaaaaaaa-aaaa-4aaa-8aaa-000000030741');
grant select on ids to authenticated, anon;
create function pg_temp.id(p_name text) returns uuid language sql stable as $$ select id from ids where name = p_name $$;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'inbox-307-' || right(u.id::text, 4) || '@example.com', u.meta
from fx cross join lateral (values
  (fx.staff_u, '{}'::jsonb), (fx.manager_u, '{}'::jsonb),
  (fx.member_u, jsonb_build_object('kind', 'customer', 'tenant_id', fx.tenant_a)), (fx.visitor_u, jsonb_build_object('kind', 'customer', 'tenant_id', fx.tenant_a))
) as u (id, meta);
insert into public.tenants (id, slug, name, country_code) select tenant_a, 'inbox-307-a', 'Inbox 307 A', 'VN' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) select account_a, tenant_a, 'mock', 'inbox-307-a', 'Synthetic account A' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name, opening_hours)
select store_a1, tenant_a, account_a, 't307-a1', 'ib-1', 'Synthetic store A1',
  '{"mon": [["00:00", "24:00"]], "tue": [["00:00", "24:00"]], "wed": [["00:00", "24:00"]], "thu": [["00:00", "24:00"]], "fri": [["00:00", "24:00"]], "sat": [["00:00", "24:00"]], "sun": [["00:00", "24:00"]]}'::jsonb
from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_a, staff_u, 'staff'::public.tenant_role, array[store_a1] from fx union all
select tenant_a, manager_u, 'manager'::public.tenant_role, array[store_a1] from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids) select brand_a, tenant_a, 'brand-1', 'Synthetic brand A', array[store_a1] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status) select app_a, tenant_a, brand_a, 'synthetic-307-app-a', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx;
insert into public.oas (id, tenant_id, brand_id, external_id, package_tier, verified, secret_name)
select oa_a, tenant_a, brand_a, 'synthetic-307-oa-a', 'tang_truong', true, 'ZALO_OA_SECRET_BRAND_1' from fx;
insert into public.customers (id, tenant_id, phone, name) select customer_m, tenant_a, '0900000' || '307', 'Synthetic member' from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status)
select programme_a, tenant_a, 'Synthetic programme', date '2026-01-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from fx;
insert into public.memberships (id, tenant_id, programme_id, customer_id, channel, joined_at, brand_id)
select member_m, tenant_a, programme_a, customer_m, 'mini_app', '2026-11-01 10:00+07'::timestamptz, brand_a from fx;
insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at)
select tenant_a, 'customer'::public.consent_subject, customer_m, 'loyalty'::public.consent_purpose, 'synthetic-v1', 'mini_app', '2026-11-01 10:00+07'::timestamptz from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id, customer_id)
select tenant_a, app_a, 'syn-zalo-307-m', member_u, customer_m from fx union all
select tenant_a, app_a, 'syn-zalo-307-v', visitor_u, null from fx;
insert into public.store_ordering_settings (store_id, tenant_id, till_mode, ordering_enabled, order_types, payment_methods, staff_presence_required, prep_minutes)
select store_a1, tenant_a, 'native', true, array['table', 'takeaway'], array['counter', 'vietqr'], false, 15 from fx;
insert into public.stamp_card_settings (brand_id, tenant_id, stamps_per_reward) select brand_a, tenant_a, 9 from fx;
insert into public.menu_categories (id, tenant_id, brand_id, name) select pg_temp.id('cat'), tenant_a, brand_a, 'Đồ uống' from fx;
insert into public.menu_items (id, tenant_id, brand_id, category_id, name, order_types) select pg_temp.id('item'), tenant_a, brand_a, pg_temp.id('cat'), 'Cà phê', array['table', 'takeaway'] from fx;
insert into public.menu_item_sizes (id, tenant_id, brand_id, item_id, price, is_default) select pg_temp.id('size'), tenant_a, brand_a, pg_temp.id('item'), 40000, true from fx;
insert into public.store_tables (id, tenant_id, store_id, label) select pg_temp.id('table'), tenant_a, store_a1, 'Bàn 1' from fx;
insert into public.staff_shifts (tenant_id, store_id, user_id, business_date, clock_in_at, opening_cash)
select tenant_a, store_a1, staff_u, date '2026-11-27', '2026-11-27 06:00+07'::timestamptz, 0 from fx union all
select tenant_a, store_a1, manager_u, date '2026-11-27', '2026-11-27 06:00+07'::timestamptz, 0 from fx;
-- Messaging on with ZBS and the two templates approved (the mock in tests).
insert into app.customer_message_settings (tenant_id, enabled, zbs_enabled) select tenant_a, true, true from fx;
insert into public.zbs_templates (tenant_id, oa_id, external_id, tag, purpose, approval_state)
select tenant_a, oa_a, 'syn-tpl-' || p, 'transaction', p, 'approved' from fx cross join (values ('order_cancelled'), ('order_refunded')) v (p);

create function pg_temp.at(p_text text) returns timestamptz language sql immutable as $$ select (p_text || '+07')::timestamptz $$;
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
-- A table order of p_qty coffees placed at p_at, paying at the counter or online (VietQR).
create function pg_temp.place(p_user uuid, p_at text, p_payment text default 'counter', p_qty integer default 1) returns uuid language sql as $$
  select (pg_temp.call(p_user, format($q$select app.customer_place_order(%L::jsonb, %L)$q$, jsonb_build_object('request_id', gen_random_uuid(), 'store', 'ib-1',
    'type', 'table', 'payment', p_payment, 'table_token', app.table_qr_token((select tenant_a from fx), pg_temp.id('table'), 1),
    'lines', jsonb_build_array(jsonb_build_object('size', pg_temp.id('size'), 'qty', p_qty)), 'expected_total', 40000 * p_qty), pg_temp.at(p_at))) -> 'order' ->> 'id')::uuid;
$$;
create function pg_temp.pay_online(p_order uuid, p_at text) returns jsonb language plpgsql as $$
declare
  v_start jsonb;
begin
  v_start := app.checkout_payment_start((select l.user_id from app.customer_logins l join public.orders o on o.customer_login_id = l.id where o.id = p_order),
    p_order, 'vietqr', 'key-' || replace(p_order::text, '-', ''), pg_temp.at(p_at));
  return app.checkout_payment_confirm('vietqr', 'ref-' || replace(p_order::text, '-', ''), (v_start ->> 'payment_id')::uuid,
    (select total from public.orders where id = p_order), true, null, pg_temp.at(p_at));
end;
$$;
create function pg_temp.act(p_user uuid, p_order uuid, p_action text, p_at text, p_reason text default null) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.counter_order_act(%L, %L, %s, %L, %L)$q$, p_order, p_action,
    (select o.version from public.orders o where o.id = p_order), p_reason, pg_temp.at(p_at)));
$$;
create function pg_temp.pay_cash(p_order uuid, p_at text, p_method text default 'cash') returns jsonb language sql as $$
  select pg_temp.call((select staff_u from fx), format($q$select app.counter_record_payment(%L, %L, %s, %s, %L)$q$, p_order, p_method,
    (select o.total from public.orders o where o.id = p_order), (select o.version from public.orders o where o.id = p_order), pg_temp.at(p_at)));
$$;
create function pg_temp.refund(p_user uuid, p_order uuid, p_amount numeric, p_at text) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.counter_refund(%L, %s, 'synthetic reason', %L)$q$, p_order, p_amount, pg_temp.at(p_at)));
$$;
create function pg_temp.items(p_login_user uuid, p_order uuid default null) returns text language sql stable as $$
  select coalesce(string_agg(i.kind, ',' order by i.seq), '')
  from app.customer_inbox i join app.customer_logins l on l.id = i.customer_login_id
  where l.user_id = p_login_user and (p_order is null or i.order_id = p_order);
$$;
create function pg_temp.item(p_order uuid, p_kind text) returns app.customer_inbox language sql stable as $$
  select i.* from app.customer_inbox i where i.order_id = p_order and i.kind = p_kind order by i.seq desc limit 1;
$$;
create function pg_temp.message(p_kind text, p_order uuid) returns public.outbound_messages language sql stable as $$
  select o.* from public.outbound_messages o where o.tenant_id = (select tenant_a from fx) and o.kind = p_kind and o.params ->> 'order_id' = p_order::text
  order by o.created_at desc limit 1;
$$;
create function pg_temp.claim(p_at timestamptz) returns jsonb language sql as $$
  select to_jsonb(c) from app.claim_next_customer_message('pgtap-307', array['consultation', 'template'], interval '2 minutes', p_at, (select tenant_a from fx)) c;
$$;
create temp table o (name text primary key, id uuid);
create function pg_temp.o(p_name text) returns uuid language sql stable as $$ select id from o where name = p_name $$;

-- 1. A table order: paid at the counter, brought to the table ---------------------------------------------------------
insert into o select 'table', pg_temp.place((select member_u from fx), '2026-11-27 09:00');
select is(pg_temp.items((select member_u from fx)), '', 'placing an order writes nothing to the inbox');
select is(pg_temp.pay_cash(pg_temp.o('table'), '2026-11-27 09:01') ->> 'state', 'paid', 'the counter takes the cash');
select is((select row(i.kind, i.topic, i.params ->> 'amount', i.params ->> 'method', i.created_at = pg_temp.at('2026-11-27 09:01'))::text from pg_temp.item(pg_temp.o('table'), 'order_receipt') i),
  row('order_receipt', 'orders', '40000', 'cash', true)::text, 'a payment above 0 writes the receipt item with the amount, the method and the payment''s time');
select is(pg_temp.act((select staff_u from fx), pg_temp.o('table'), 'start', '2026-11-27 09:02') ->> 'state', 'ok', 'the counter starts it');
select is(pg_temp.items((select member_u from fx), pg_temp.o('table')), 'order_receipt', 'starting it writes nothing (C06 shows the steps)');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('table'), 'done', '2026-11-27 09:10') -> 'order' ->> 'status'), 'serving', 'it is brought to the table');
select is((select row(i.kind, i.params ->> 'order_type')::text from pg_temp.item(pg_temp.o('table'), 'order_ready') i), row('order_ready', 'table')::text,
  'serving at the table writes order_ready (in the app only)');
select is((select count(*)::integer from public.outbound_messages where tenant_id = (select tenant_a from fx)), 0, 'and no Zalo message: a table order never gets one for its steps');
select is(pg_temp.act((select staff_u from fx), pg_temp.o('table'), 'complete', '2026-11-27 09:30') ->> 'state', 'ok', 'it is completed');
select is(pg_temp.items((select member_u from fx), pg_temp.o('table')), 'order_receipt,order_ready', 'completing writes no order item');

-- 2. The stamps of that order and the card's boundaries ---------------------------------------------------------------
select is((select row(i.kind, i.topic, i.params ->> 'added', i.params ->> 'stamps', i.params ->> 'left', i.order_id)::text
  from app.customer_inbox i where i.dedupe_key like 'stamp:%' order by i.seq desc limit 1),
  row('stamp', 'offers', '1', '1', '8', null::uuid)::text, 'the completion''s stamp writes stamp: added 1, 1 on the card, 8 to go');
insert into o select 'seven', pg_temp.place((select member_u from fx), '2026-11-27 09:40', 'counter', 7);
select is(pg_temp.pay_cash(pg_temp.o('seven'), '2026-11-27 09:41') ->> 'state', 'paid', 'a second order of 7 coffees is paid');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('seven'), 'start', '2026-11-27 09:42') ->> 'state')
  || (pg_temp.act((select staff_u from fx), pg_temp.o('seven'), 'done', '2026-11-27 09:43') ->> 'state')
  || (pg_temp.act((select staff_u from fx), pg_temp.o('seven'), 'complete', '2026-11-27 09:44') ->> 'state'), 'okokok', 'and completed');
select is((select row(i.kind, i.params ->> 'stamps', i.params ->> 'left')::text from app.customer_inbox i where i.dedupe_key like 'stamp:%' order by i.seq desc limit 1),
  row('stamp', '8', '1')::text, 'boundary: 8 of 9 is still a stamp item, one to go');
insert into o select 'one', pg_temp.place((select member_u from fx), '2026-11-27 09:50');
select is((pg_temp.pay_cash(pg_temp.o('one'), '2026-11-27 09:51') ->> 'state') || (pg_temp.act((select staff_u from fx), pg_temp.o('one'), 'start', '2026-11-27 09:52') ->> 'state')
  || (pg_temp.act((select staff_u from fx), pg_temp.o('one'), 'done', '2026-11-27 09:53') ->> 'state') || (pg_temp.act((select staff_u from fx), pg_temp.o('one'), 'complete', '2026-11-27 09:54') ->> 'state'),
  'paidokokok', 'one more coffee is completed');
select is((select row(i.kind, i.params ->> 'added', i.params ->> 'rewards', i.params ->> 'stamps')::text from app.customer_inbox i where i.dedupe_key like 'stamp:%' order by i.seq desc limit 1),
  row('reward', '1', '1', '0')::text, 'boundary: exactly 9 completes the card: one reward item (1 reward, 0 on the new card), no stamp item');
insert into o select 'two', pg_temp.place((select member_u from fx), '2026-11-27 10:00', 'counter', 10);
select is((pg_temp.pay_cash(pg_temp.o('two'), '2026-11-27 10:01') ->> 'state') || (pg_temp.act((select staff_u from fx), pg_temp.o('two'), 'start', '2026-11-27 10:02') ->> 'state')
  || (pg_temp.act((select staff_u from fx), pg_temp.o('two'), 'done', '2026-11-27 10:03') ->> 'state') || (pg_temp.act((select staff_u from fx), pg_temp.o('two'), 'complete', '2026-11-27 10:04') ->> 'state'),
  'paidokokok', 'ten coffees are completed');
select is((select row(i.kind, i.params ->> 'added', i.params ->> 'rewards', i.params ->> 'stamps')::text from app.customer_inbox i where i.dedupe_key like 'stamp:%' order by i.seq desc limit 1),
  row('reward', '10', '1', '1')::text, 'boundary: 10 stamps on an empty card make one reward and leave 1');
select is((select count(*)::integer from public.outbound_messages where tenant_id = (select tenant_a from fx)), 0, 'stamps never queue a Zalo message (in the app only, no cost)');

-- 3. Cancellations ----------------------------------------------------------------------------------------------------
insert into o select 'own', pg_temp.place((select member_u from fx), '2026-11-27 11:00', 'vietqr');
select is(pg_temp.call((select member_u from fx), format($q$select app.customer_cancel_order(%L, %L)$q$, pg_temp.o('own'), pg_temp.at('2026-11-27 11:01'))) ->> 'state',
  'cancelled', 'the customer cancels their own unpaid order');
select is(pg_temp.items((select member_u from fx), pg_temp.o('own')), '', 'their own cancellation writes nothing');
insert into o select 'timeout', pg_temp.place((select member_u from fx), '2026-11-27 11:10', 'vietqr');
select ok((app.ordering_tick(pg_temp.at('2026-11-27 11:30')) ->> 'payment_timeouts')::integer >= 1, 'the minute job cancels an unpaid online order after its window');
select is((select row(i.params ->> 'reason', i.params ->> 'by', i.params ? 'refund_due')::text from pg_temp.item(pg_temp.o('timeout'), 'order_cancelled') i),
  row('payment_timeout', 'system', false)::text, 'a cancellation by the system writes order_cancelled with its reason and no refund');
insert into o select 'unpaid', pg_temp.place((select member_u from fx), '2026-11-27 11:40');
select is(pg_temp.act((select staff_u from fx), pg_temp.o('unpaid'), 'cancel', '2026-11-27 11:41', 'item_unavailable') ->> 'state', 'ok', 'the shop cancels an unpaid order');
select is((select row(i.params ->> 'reason', i.params ->> 'by', i.params ? 'refund_due')::text from pg_temp.item(pg_temp.o('unpaid'), 'order_cancelled') i),
  row('item_unavailable', 'staff', false)::text, 'order_cancelled with the shop''s reason and nothing to refund');
select is((select count(*)::integer from public.outbound_messages where tenant_id = (select tenant_a from fx)), 0, 'an unpaid cancellation queues no Zalo message: no money to give back');

-- A paid order cancelled by the shop: the message waits five minutes; cash handed back in that time replaces it.
insert into o select 'cash', pg_temp.place((select member_u from fx), '2026-11-27 12:00');
select is(pg_temp.pay_cash(pg_temp.o('cash'), '2026-11-27 12:01') ->> 'state', 'paid', 'a paid order');
select is(pg_temp.act((select staff_u from fx), pg_temp.o('cash'), 'cancel', '2026-11-27 12:02', 'store_busy') ->> 'state', 'ok', 'is cancelled by the shop');
select is((select row(i.params ->> 'reason', i.params ->> 'refund_due')::text from pg_temp.item(pg_temp.o('cash'), 'order_cancelled') i),
  row('store_busy', '40000')::text, 'order_cancelled names the refund due');
select is((select row(m.status, m.channel, m.message_class::text, m.recipient_ref, m.params ->> 'amount', m.not_before = pg_temp.at('2026-11-27 12:07'), m.title, m.body)::text
  from pg_temp.message('order_cancelled', pg_temp.o('cash')) m),
  row('queued', 'mini_app', 'transactional', 'membership:' || (select member_m from fx), '40000', true, null::text, null::text)::text,
  'and the member gets order_cancelled queued five minutes on, opaque and without text');
select is(pg_temp.claim(pg_temp.at('2026-11-27 12:06:59')), null, 'boundary: at 4:59 it is not claimed');
select is(pg_temp.refund((select staff_u from fx), pg_temp.o('cash'), 40000, '2026-11-27 12:05') ->> 'state', 'succeeded', 'the cash is handed back at 12:05');
select is((select row(i.params ->> 'amount', i.params ->> 'method', i.params ->> 'refunded_on')::text from pg_temp.item(pg_temp.o('cash'), 'order_refunded') i),
  row('40000', 'cash', '2026-11-27')::text, 'the refund writes order_refunded with the amount, the method and the day');
select is((select row(m.status, m.decision)::text from pg_temp.message('order_cancelled', pg_temp.o('cash')) m), row('cancelled', 'superseded')::text,
  'the waiting cancellation message is superseded by the refund');
select is((select count(*)::integer from pg_temp.message('order_refunded', pg_temp.o('cash')) m where m.id is not null), 0,
  'cash handed back at the counter queues no refund message: the customer is there');

-- An online payment cancelled by the shop: the cancellation goes after 5 minutes, then the refund when the provider settles.
insert into o select 'online', pg_temp.place((select member_u from fx), '2026-11-27 13:00', 'vietqr');
select is(pg_temp.pay_online(pg_temp.o('online'), '2026-11-27 13:01') ->> 'state', 'succeeded', 'an order paid online');
select is(pg_temp.act((select staff_u from fx), pg_temp.o('online'), 'cancel', '2026-11-27 13:02', 'item_unavailable') ->> 'state', 'ok', 'is cancelled by the shop');
create temp table cancel_claim as select pg_temp.claim(pg_temp.at('2026-11-27 13:07')) as c;
select is((select (c ->> 'kind') || ' ' || (c ->> 'route') || ' ' || (c ->> 'template_purpose') from cancel_claim), 'order_cancelled template order_cancelled',
  'boundary: at 5:00 it is claimed as the ZBS template order_cancelled');
select is((select c -> 'parameters' from cancel_claim),
  jsonb_build_object('customer_name', 'Synthetic member', 'store_name', 'Synthetic store A1', 'order_no', (select app.order_display_no(order_no) from public.orders where id = pg_temp.o('online')), 'amount', 40000),
  'with the name, the store, the number and the amount resolved at send time');
select is(app.finish_customer_send((select (c ->> 'message_id')::uuid from cancel_claim), (select (c ->> 'claimed_at')::timestamptz from cancel_claim), 'sent', null, 'mock-zbs-307-1', null, pg_temp.at('2026-11-27 13:07')),
  'sent', 'the mock ZBS takes it');
create temp table online_refund as select pg_temp.refund((select staff_u from fx), pg_temp.o('online'), 40000, '2026-11-27 13:10') as r;
select is((select r ->> 'state' from online_refund), 'pending', 'the refund of an online payment waits for the provider');
select is(pg_temp.items((select member_u from fx), pg_temp.o('online')), 'order_receipt,order_cancelled', 'a pending refund writes nothing yet');
select is(app.checkout_refund_confirm((select (r ->> 'refund_id')::uuid from online_refund), true, 'rf-307-1', null, pg_temp.at('2026-11-28 09:15')) ->> 'state', 'succeeded',
  'the provider settles it the next morning');
select is((select row(i.params ->> 'amount', i.params ->> 'method', i.params ->> 'refunded_on')::text from pg_temp.item(pg_temp.o('online'), 'order_refunded') i),
  row('40000', 'vietqr', '2026-11-28')::text, 'order_refunded with the amount, the method and the day the money went back');
create temp table refund_claim as select pg_temp.claim(pg_temp.at('2026-11-28 09:16')) as c;
select is((select (c ->> 'kind') || ' ' || (c ->> 'template_purpose') || ' ' || (c -> 'parameters' ->> 'amount') || ' ' || (c -> 'parameters' ->> 'refund_date') from refund_claim),
  'order_refunded order_refunded 40000 28/11/2026', 'the refund goes as the template order_refunded with the amount and the date the money went back');

-- A card refund of a completed order by a manager (criterion 4, step 3), and a voided payment.
select is(pg_temp.refund((select manager_u from fx), pg_temp.o('seven'), 40000, '2026-11-27 14:00') ->> 'state', 'succeeded', 'a manager refunds one coffee of the completed order');
select is((select m.kind || ' ' || m.status || ' ' || (m.params ->> 'amount') from pg_temp.message('order_refunded', pg_temp.o('seven')) m), null,
  'it was paid in cash and handed back in cash: no message');
insert into o select 'void', pg_temp.place((select member_u from fx), '2026-11-27 15:00');
select is(pg_temp.pay_cash(pg_temp.o('void'), '2026-11-27 15:01') ->> 'state', 'paid', 'a payment recorded by mistake');
select is(pg_temp.call((select staff_u from fx), format($q$select app.counter_void_payment((select p.id from public.order_payments p where p.order_id = %L), 'wrong order', %L)$q$,
  pg_temp.o('void'), pg_temp.at('2026-11-27 15:02'))) ->> 'state', 'voided', 'is voided');
select is(pg_temp.items((select member_u from fx), pg_temp.o('void')), '', 'its receipt item is withdrawn');

-- 4. A visitor: the app only ---------------------------------------------------------------------------------------------
insert into o select 'visitor', pg_temp.place((select visitor_u from fx), '2026-11-27 16:00');
select is((pg_temp.pay_cash(pg_temp.o('visitor'), '2026-11-27 16:01') ->> 'state') || (pg_temp.act((select staff_u from fx), pg_temp.o('visitor'), 'cancel', '2026-11-27 16:02', 'store_busy') ->> 'state'),
  'paidok', 'a visitor''s paid order is cancelled by the shop');
select is(pg_temp.items((select visitor_u from fx)), 'order_receipt,order_cancelled', 'the visitor has the items');
select is((select count(*)::integer from public.outbound_messages where tenant_id = (select tenant_a from fx) and params ->> 'order_id' = pg_temp.o('visitor')::text), 0,
  'and no Zalo message: without a phone there is no one to message');

-- 5. Regression: a takeaway ready keeps its own message (migration takeaway_ready_message) -----------------------------
insert into o select 'takeaway', (pg_temp.call((select member_u from fx), format($q$select app.customer_place_order(%L::jsonb, %L)$q$, jsonb_build_object('request_id', gen_random_uuid(),
  'store', 'ib-1', 'type', 'takeaway', 'payment', 'vietqr', 'lines', jsonb_build_array(jsonb_build_object('size', pg_temp.id('size'), 'qty', 1)), 'expected_total', 40000,
  'pickup_at', '2026-11-27T10:30:00Z'), pg_temp.at('2026-11-27 17:00'))) -> 'order' ->> 'id')::uuid;
select is(pg_temp.pay_online(pg_temp.o('takeaway'), '2026-11-27 17:01') ->> 'state', 'succeeded', 'a takeaway booked for 17:30 is paid');
select is((pg_temp.act((select staff_u from fx), pg_temp.o('takeaway'), 'start', '2026-11-27 17:15') ->> 'state') || (pg_temp.act((select staff_u from fx), pg_temp.o('takeaway'), 'done', '2026-11-27 17:25') -> 'order' ->> 'status'),
  'okready', 'and made ready');
select is((select row(i.kind, i.params ->> 'order_type')::text from pg_temp.item(pg_temp.o('takeaway'), 'order_ready') i), row('order_ready', 'takeaway')::text,
  'a takeaway made ready writes order_ready');
select is((select m.dedupe_key || ' ' || m.status from public.outbound_messages m where m.dedupe_key = 'customer:takeaway_ready:order:' || pg_temp.o('takeaway')::text),
  'customer:takeaway_ready:order:' || pg_temp.o('takeaway')::text || ' queued', 'and still queues its takeaway_ready message, unchanged');

-- 6. Promotions: only delivered, only with the marketing consent ---------------------------------------------------------
update app.customer_message_settings set promotions_enabled = true where tenant_id = (select tenant_a from fx);
select is(app.enqueue_customer_message((select tenant_a from fx), (select member_m from fx), 'win_back', 'syn-307-1', jsonb_build_object('inactive_days', 45), (select store_a1 from fx),
  null, pg_temp.at('2026-11-27 18:00')), null, 'without the marketing consent no promotion is even queued');
insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at)
select tenant_a, 'customer'::public.consent_subject, customer_m, 'marketing'::public.consent_purpose, 'synthetic-v1', 'mini_app', pg_temp.at('2026-11-27 18:00') from fx;
create temp table promo as select app.enqueue_customer_message((select tenant_a from fx), (select member_m from fx), 'win_back', 'syn-307-2', jsonb_build_object('inactive_days', 45),
  (select store_a1 from fx), null, pg_temp.at('2026-11-27 18:01')) as id;
select is((select count(*)::integer from app.customer_inbox where params ->> 'offer' = 'win_back'), 0, 'a promotion queued is not yet in the inbox');
select is(pg_temp.claim(pg_temp.at('2026-11-27 18:02')), null, 'with no approved win_back template it closes in the app');
select is((select row(i.kind, i.topic, i.params ->> 'offer', i.params ->> 'inactive_days', i.dedupe_key)::text from app.customer_inbox i where i.params ->> 'offer' = 'win_back'),
  row('offer', 'offers', 'win_back', '45', 'message:' || (select id from promo))::text, 'once delivered it is an offer item of the member''s login');
create temp table campaign as select app.customer_inbox_offer((select tenant_a from fx), (select l.id from app.customer_logins l where l.user_id = (select member_u from fx)),
  'weekend-1', 'Ưu đãi cuối tuần', 'Giảm giá cho khách ghé trước 10 giờ', pg_temp.at('2026-11-27 18:10')) as id;
select is((select row(i.kind, i.title, i.line, i.params ->> 'offer')::text from app.customer_inbox i where i.id = (select id from campaign)),
  row('offer', 'Ưu đãi cuối tuần', 'Giảm giá cho khách ghé trước 10 giờ', 'campaign')::text, 'a campaign item carries its title and line (GA-066)');
select is(app.customer_inbox_offer((select tenant_a from fx), (select l.id from app.customer_logins l where l.user_id = (select member_u from fx)),
  'weekend-1', 'Ưu đãi cuối tuần', 'Lần hai', pg_temp.at('2026-11-27 18:11')), null, 'the same campaign again writes nothing (one item per key)');
select is(app.customer_inbox_offer((select tenant_a from fx), (select l.id from app.customer_logins l where l.user_id = (select visitor_u from fx)),
  'weekend-1', 'Ưu đãi cuối tuần', 'Giảm giá', pg_temp.at('2026-11-27 18:12')), null, 'a visitor (no consent possible) gets no campaign item');
update public.consent_records set revoked_at = pg_temp.at('2026-11-27 18:20') where subject_id = (select customer_m from fx) and purpose = 'marketing';
select is(app.customer_inbox_offer((select tenant_a from fx), (select l.id from app.customer_logins l where l.user_id = (select member_u from fx)),
  'weekend-2', 'Ưu đãi tuần sau', 'Giảm giá', pg_temp.at('2026-11-27 18:21')), null, 'after "Dừng nhận tin" no campaign item is written');
select throws_ok($$select app.customer_inbox_offer((select tenant_a from fx), gen_random_uuid(), 'Bad Key', 'x', 'y')$$, '22023', null, 'a malformed campaign key is refused');

-- 7. Repeated events and the grants ---------------------------------------------------------------------------------------
select is(app.customer_inbox_add((select tenant_a from fx), (select l.id from app.customer_logins l where l.user_id = (select member_u from fx)), 'order_ready',
  'order:' || pg_temp.o('table')::text || ':ready', '{}'::jsonb, pg_temp.o('table'), null, null, pg_temp.at('2026-11-27 19:00')), null,
  'error guessing: the same event again writes no second item');
select is(
  (select count(*)::integer from (values ('anon'), ('authenticated'), ('service_role')) r (role)
   cross join (values ('app.customer_order_notices()'), ('app.customer_stamp_notices()'), ('app.customer_offer_notices()'),
     ('app.customer_inbox_add(uuid, uuid, text, text, jsonb, uuid, text, text, timestamptz)'), ('app.customer_inbox_offer(uuid, uuid, text, text, text, timestamptz)'),
     ('app.customer_order_membership(public.orders)')) f (fn)
   where has_function_privilege(r.role, f.fn, 'execute')),
  0, 'no API role runs the trigger functions or the writers');

select * from finish();
rollback;
