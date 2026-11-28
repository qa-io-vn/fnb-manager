-- Takeaway with a pick-up time, placed and paid (C17, migration takeaway_slots, ADR-072): the slot re-validated at
-- placement, the place held while the payment is open and freed when the window passes, the queue entered only once
-- paid and seen as scheduled until the preparation start, booking the next morning while closed, the customer's
-- change of pick-up time, and the security of it all.
-- Techniques: a decision table of the placement's refusals (C17-I1: passed, closed, a tampered or another day's time,
-- full, pay at the counter C17-I5, a table order with a time); state transitions of the hold (held -> paid, held ->
-- expired at 10:00 -> cancelled by the job, held -> cancelled by the customer, held -> moved; C17-I3); boundary values
-- of the hold's end (9:59, 10:00, the store's shorter window), of the preparation start (15:14:59, 15:15) and of the
-- late flag (start + 9:59, + 10:00); use cases of the queue (C17-I4) and of a pre-order for the next morning (C17-E2);
-- error guessing of the race (the second booking of the last place, C17-I2; the parallel race is
-- jobs:integration/ordering-concurrency) and of a customer holding places without an order (C17-S2); object-level
-- authorisation of the change (another customer's or tenant's order, C17-S3); the client's clock and a tampered time
-- (C17-S1); regression of table orders (C17-R1).
begin;
select plan(72);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000030501'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000030502'::uuid as tenant_b,
  'cccccccc-cccc-4ccc-8ccc-000000030501'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000030502'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000030501'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000030509'::uuid as store_b1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000030501'::uuid as brand_a,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000030502'::uuid as brand_b,
  '99999999-9999-4999-8999-000000030501'::uuid as app_a,
  '99999999-9999-4999-8999-000000030502'::uuid as app_b,
  'eeeeeeee-eeee-4eee-8eee-000000030501'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000030503'::uuid as staff_u,
  'eeeeeeee-eeee-4eee-8eee-000000030511'::uuid as cust1_u,
  'eeeeeeee-eeee-4eee-8eee-000000030512'::uuid as cust2_u,
  'eeeeeeee-eeee-4eee-8eee-000000030513'::uuid as cust3_u,
  'eeeeeeee-eeee-4eee-8eee-000000030514'::uuid as cust4_u,
  'eeeeeeee-eeee-4eee-8eee-000000030515'::uuid as cust5_u,
  'eeeeeeee-eeee-4eee-8eee-000000030516'::uuid as cust6_u,
  'eeeeeeee-eeee-4eee-8eee-000000030517'::uuid as cust7_u,
  'eeeeeeee-eeee-4eee-8eee-000000030518'::uuid as cust8_u,
  'eeeeeeee-eeee-4eee-8eee-000000030519'::uuid as custb_u;
grant select on fx to authenticated, anon;

create temp table ids (name text primary key, id uuid not null);
insert into ids values
  ('cat', 'aaaaaaaa-aaaa-4aaa-8aaa-000000030551'), ('item_ta', 'aaaaaaaa-aaaa-4aaa-8aaa-000000030501'), ('ta', 'bbbbbbbb-bbbb-4bbb-8bbb-000000030511'),
  ('table_a1', 'aaaaaaaa-aaaa-4aaa-8aaa-000000030541');
grant select on ids to authenticated, anon;
create function pg_temp.id(p_name text) returns uuid language sql stable as $$ select id from ids where name = p_name $$;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'takeaway-305-' || right(u.id::text, 4) || '@example.com',
  case when u.tenant is null then '{}'::jsonb else jsonb_build_object('kind', 'customer', 'tenant_id', u.tenant) end
from fx cross join lateral (values
  (fx.owner_u, null::uuid), (fx.staff_u, null), (fx.cust1_u, fx.tenant_a), (fx.cust2_u, fx.tenant_a), (fx.cust3_u, fx.tenant_a), (fx.cust4_u, fx.tenant_a),
  (fx.cust5_u, fx.tenant_a), (fx.cust6_u, fx.tenant_a), (fx.cust7_u, fx.tenant_a), (fx.cust8_u, fx.tenant_a), (fx.custb_u, fx.tenant_b)
) as u (id, tenant);
insert into public.tenants (id, slug, name)
select tenant_a, 'takeaway-305-a', 'Takeaway 305 A' from fx union all
select tenant_b, 'takeaway-305-b', 'Takeaway 305 B' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'takeaway-305-a', 'Synthetic account A' from fx union all
select account_b, tenant_b, 'mock', 'takeaway-305-b', 'Synthetic account B' from fx;
-- A1 opens 07:00-23:00 Monday to Saturday (never on Sunday), its business day starting at 04:00.
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name, business_day_start_minutes, opening_hours)
select s.id, s.tenant, s.account, s.ext, s.code, s.name, 240,
  '{"mon": [["07:00", "23:00"]], "tue": [["07:00", "23:00"]], "wed": [["07:00", "23:00"]], "thu": [["07:00", "23:00"]], "fri": [["07:00", "23:00"]], "sat": [["07:00", "23:00"]]}'::jsonb
from fx cross join lateral (values
  (fx.store_a1, fx.tenant_a, fx.account_a, 't305-a1', 'tp-1', 'Synthetic store A1'),
  (fx.store_b1, fx.tenant_b, fx.account_b, 't305-b1', 'tp-9', 'Synthetic store B1')
) as s (id, tenant, account, ext, code, name);
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_a, owner_u, 'owner'::public.tenant_role, null::uuid[] from fx union all
select tenant_a, staff_u, 'staff'::public.tenant_role, array[store_a1] from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_a, tenant_a, 'brand-1', 'Synthetic brand A', array[store_a1] from fx union all
select brand_b, tenant_b, 'brand-1', 'Synthetic brand B', array[store_b1] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_a, tenant_a, brand_a, 'synthetic-305-app-a', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx union all
select app_b, tenant_b, brand_b, 'synthetic-305-app-b', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id)
select tenant_a, app_a, 'syn-zalo-305-' || right(u::text, 2), u from fx, unnest(array[cust1_u, cust2_u, cust3_u, cust4_u, cust5_u, cust6_u, cust7_u, cust8_u]) u union all
select tenant_b, app_b, 'syn-zalo-305-b', custb_u from fx;
insert into public.store_ordering_settings (store_id, tenant_id, till_mode, ordering_enabled, order_types, payment_methods, staff_presence_required,
  prep_minutes, takeaway_slot_limit, max_waiting_orders)
select store_a1, tenant_a, 'native', true, array['table', 'takeaway'], array['counter', 'vietqr'], false, 15, 2, 30 from fx union all
select store_b1, tenant_b, 'native', true, array['table', 'takeaway'], array['counter', 'vietqr'], false, 15, 2, 30 from fx;
insert into public.menu_categories (id, tenant_id, brand_id, name, sort_order) select pg_temp.id('cat'), tenant_a, brand_a, 'Đồ uống', 10 from fx;
insert into public.menu_items (id, tenant_id, brand_id, category_id, name, counts_for_stamps, order_types)
select pg_temp.id('item_ta'), tenant_a, brand_a, pg_temp.id('cat'), 'Cà phê', true, array['table', 'takeaway'] from fx;
insert into public.menu_item_sizes (id, tenant_id, brand_id, item_id, label, price, sort_order, is_default)
select pg_temp.id('ta'), tenant_a, brand_a, pg_temp.id('item_ta'), null, 40000, 10, true from fx;
insert into public.store_tables (id, tenant_id, store_id, label) select pg_temp.id('table_a1'), tenant_a, store_a1, 'Bàn 1' from fx;
insert into public.staff_shifts (tenant_id, store_id, user_id, business_date, clock_in_at, opening_cash)
select tenant_a, store_a1, staff_u, date '2026-11-27', '2026-11-27 07:00+07'::timestamptz, 0 from fx;

-- Helpers: instants in the store's zone (+07); every call answers JSON or {"error": SQLSTATE}.
create function pg_temp.at(p_text text) returns timestamptz language sql immutable as $$ select (p_text || '+07')::timestamptz $$;
create function pg_temp.local(p_at timestamptz) returns text language sql immutable as $$ select to_char(p_at at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:MI:SS') $$;
create function pg_temp.iso(p_text text) returns text language sql immutable as $$ select to_char(pg_temp.at(p_text) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') $$;
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
create function pg_temp.req(p_extra jsonb) returns jsonb language sql volatile as $$
  select jsonb_build_object('request_id', gen_random_uuid(), 'store', 'tp-1', 'type', 'takeaway', 'payment', 'vietqr',
    'lines', jsonb_build_array(jsonb_build_object('size', pg_temp.id('ta'), 'qty', 1)), 'expected_total', 40000) || p_extra;
$$;
create function pg_temp.place_req(p_user uuid, p_request jsonb, p_at text) returns jsonb language plpgsql as $$
declare
  v jsonb;
begin
  perform pg_temp.claims(p_user);
  begin
    v := app.customer_place_order(p_request, pg_temp.at(p_at));
  exception when others then
    v := jsonb_build_object('error', sqlstate);
  end;
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$$;
create function pg_temp.place(p_user uuid, p_pickup text, p_at text) returns jsonb language sql as $$
  select pg_temp.place_req(p_user, pg_temp.req(case when p_pickup is null then '{}'::jsonb else jsonb_build_object('pickup_at', pg_temp.iso(p_pickup)) end), p_at);
$$;
create function pg_temp.refusal(p_user uuid, p_pickup text, p_at text) returns text language sql as $$
  select coalesce(r ->> 'refusal', r ->> 'state', r ->> 'error') from (select pg_temp.place(p_user, p_pickup, p_at) as r) x;
$$;
create function pg_temp.change(p_user uuid, p_order uuid, p_pickup text, p_at text) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.customer_change_pickup(%L, %L, %L)$q$, p_order, pg_temp.at(p_pickup), pg_temp.at(p_at)));
$$;
create function pg_temp.order_of(p_answer jsonb) returns uuid language sql immutable as $$ select (p_answer -> 'order' ->> 'id')::uuid $$;
create function pg_temp.pay_online(p_order uuid, p_ref text, p_at text) returns jsonb language plpgsql as $$
declare
  v_start jsonb;
begin
  v_start := app.checkout_payment_start((select l.user_id from app.customer_logins l join public.orders o on o.customer_login_id = l.id where o.id = p_order),
    p_order, 'vietqr', 'key-' || p_ref, pg_temp.at(p_at));
  return app.checkout_payment_confirm((select p.provider from public.order_payments p where p.id = (v_start ->> 'payment_id')::uuid), p_ref,
    (v_start ->> 'payment_id')::uuid, (select o.total from public.orders o where o.id = p_order), true, null, pg_temp.at(p_at));
end;
$$;
create function pg_temp.board_order(p_order uuid, p_at text) returns jsonb language sql as $$
  select o from jsonb_array_elements(pg_temp.call((select staff_u from fx), format($q$select app.counter_board(%L, 0, %L)$q$, (select store_a1 from fx), pg_temp.at(p_at))) -> 'orders') o
  where (o ->> 'id')::uuid = p_order;
$$;
create function pg_temp.act(p_order uuid, p_action text, p_at text) returns jsonb language sql as $$
  select pg_temp.call((select staff_u from fx), format($q$select app.counter_order_act(%L, %L, %s, null, %L)$q$, p_order, p_action,
    (select o.version from public.orders o where o.id = p_order), pg_temp.at(p_at)));
$$;
create function pg_temp.taken(p_slot text, p_at text) returns integer language sql stable as $$
  select app.takeaway_slot_taken((select store_a1 from fx), pg_temp.at(p_slot), pg_temp.at(p_at));
$$;
create temp table o (name text primary key, id uuid);
create function pg_temp.o(p_name text) returns uuid language sql stable as $$ select id from o where name = p_name $$;

-- 1. C17-I1: the decision table of the placement, Friday 14:05, prep 15, slot 15, limit 2 ------------------------
select is(pg_temp.refusal((select cust1_u from fx), '2026-11-27 14:15', '2026-11-27 14:05'), 'slot_passed', 'a slot before now plus the preparation time: slot_passed');
select is(pg_temp.refusal((select cust1_u from fx), '2026-11-27 14:19:59', '2026-11-27 14:05'), 'slot_passed', 'boundary: one second before 14:20 is passed');
select is(pg_temp.refusal((select cust1_u from fx), '2026-11-27 14:20', '2026-11-27 14:05'), 'pickup_time_invalid', 'boundary: 14:20 is soon enough but not a slot start');
select is(pg_temp.refusal((select cust1_u from fx), '2026-11-27 14:37', '2026-11-27 14:05'), 'pickup_time_invalid', 'C17-S1: a tampered time (14:37) is no slot and is refused');
select is(pg_temp.refusal((select cust1_u from fx), '2026-11-27 14:30:30', '2026-11-27 14:05'), 'pickup_time_invalid', 'a time with seconds is no slot either');
select is(pg_temp.refusal((select cust1_u from fx), '2026-11-27 23:00', '2026-11-27 14:05'), 'closed', 'the closing time is no pick-up: closed');
select is(pg_temp.refusal((select cust1_u from fx), '2026-11-29 08:00', '2026-11-27 14:05'), 'closed', 'Sunday, a day the store never opens: closed');
select is(pg_temp.refusal((select cust1_u from fx), '2026-11-28 08:00', '2026-11-27 14:05'), 'pickup_time_invalid', 'tomorrow while today still has slots: not the day offered');
select is((pg_temp.place_req((select cust1_u from fx), pg_temp.req(jsonb_build_object('pickup_at', pg_temp.iso('2026-11-27 14:30'), 'payment', 'counter')), '2026-11-27 14:05')) ->> 'refusal',
  'payment_not_allowed', 'C17-I5: a takeaway paid at the counter is refused by the server, even with a free slot');
select is((pg_temp.place_req((select cust1_u from fx), jsonb_build_object('request_id', gen_random_uuid(), 'store', 'tp-1', 'type', 'table', 'payment', 'counter',
    'table_token', app.table_qr_token((select tenant_a from fx), pg_temp.id('table_a1'), 1), 'lines', jsonb_build_array(jsonb_build_object('size', pg_temp.id('ta'), 'qty', 1)),
    'expected_total', 40000, 'pickup_at', pg_temp.iso('2026-11-27 14:30')), '2026-11-27 14:05')) ->> 'refusal',
  'pickup_time_invalid', 'a table order carries no pick-up time');
select is((pg_temp.place_req((select cust1_u from fx), pg_temp.req(jsonb_build_object('pickup_at', pg_temp.iso('2026-11-27 14:30'), 'now', '2026-11-27T07:00:00Z')), '2026-11-27 14:05')) ->> 'error',
  '22023', 'C17-S1: a request that brings its own clock is refused by its shape');
select is((select count(*)::integer from public.orders where store_id = (select store_a1 from fx)), 0, 'the refusals wrote nothing');
insert into o select 'first', pg_temp.order_of(pg_temp.place((select cust1_u from fx), '2026-11-27 14:30', '2026-11-27 14:05'));
select is((select status::text || ' ' || pg_temp.local(pickup_at) || ' ' || business_date || ' ' || pg_temp.local(payment_due_at) from public.orders where id = pg_temp.o('first')),
  'awaiting_payment 2026-11-27 14:30:00 2026-11-27 2026-11-27 14:15:00', 'the first slot 14:30 is booked, held until 14:15 (10 minutes), on today''s business date');
select is((select order_no is null from public.orders where id = pg_temp.o('first')), true, 'an unpaid hold takes no number');
insert into o select 'asap', pg_temp.order_of(pg_temp.place((select cust2_u from fx), null, '2026-11-27 14:05'));
select is((select coalesce(pg_temp.local(pickup_at), 'none') || ' ' || pg_temp.local(payment_due_at) from public.orders where id = pg_temp.o('asap')),
  'none 2026-11-27 14:20:00', '"Càng sớm có thể" has no pick-up time and the store''s 15-minute window');
insert into o select 'full_1', pg_temp.order_of(pg_temp.place((select cust3_u from fx), '2026-11-27 15:00', '2026-11-27 14:05'));
insert into o select 'full_2', pg_temp.order_of(pg_temp.place((select cust4_u from fx), '2026-11-27 15:00', '2026-11-27 14:05'));
create temp table full_3 as select pg_temp.place((select cust5_u from fx), '2026-11-27 15:00', '2026-11-27 14:06') as r;
select is((select r ->> 'refusal' from full_3), 'slot_full', 'C17-I2: the third booking of a slot of two is refused: the second of two customers for the last place lost');
select is((select pg_temp.local((r ->> 'pickup_at')::timestamptz) from full_3), '2026-11-27 15:00:00', 'the refusal names the time asked, so the app can say "Giờ 15:00 vừa hết chỗ"');
select is(pg_temp.taken('2026-11-27 15:00', '2026-11-27 14:06'), 2, 'the slot gave its two places, no more');

-- 2. C17-I3: the hold's states ---------------------------------------------------------------------------------------
select is(pg_temp.taken('2026-11-27 14:30', '2026-11-27 14:14:59'), 1, 'boundary: at 14:14:59 the hold of 14:05 still holds its place');
select is(pg_temp.taken('2026-11-27 14:30', '2026-11-27 14:15'), 0, 'boundary: at 14:15 (10 minutes) the place is free again');
select is((pg_temp.call((select cust4_u from fx), format($q$select app.customer_cancel_order(%L, %L)$q$, pg_temp.o('full_2'), pg_temp.at('2026-11-27 14:07'))) ->> 'state'), 'cancelled', 'a customer backs out of a hold');
select is(pg_temp.taken('2026-11-27 15:00', '2026-11-27 14:07'), 1, 'and its place is free at once');
select is((pg_temp.pay_online(pg_temp.o('full_1'), 'syn-305-1', '2026-11-27 14:08')) ->> 'state', 'succeeded', 'a hold paid inside its window');
select is((select status::text || ' ' || order_no from public.orders where id = pg_temp.o('full_1')), 'accepted 1', 'is accepted with its number');
update public.store_ordering_settings set payment_window_minutes = 5 where store_id = (select store_a1 from fx);
insert into o select 'short', pg_temp.order_of(pg_temp.place((select cust5_u from fx), '2026-11-27 16:00', '2026-11-27 14:05'));
select is((select pg_temp.local(payment_due_at) from public.orders where id = pg_temp.o('short')), '2026-11-27 14:10:00', 'a store with a 5-minute payment window holds the place 5 minutes');
update public.store_ordering_settings set payment_window_minutes = 15 where store_id = (select store_a1 from fx);
select is((app.ordering_tick(pg_temp.at('2026-11-27 14:15')) ->> 'payment_timeouts')::integer, 2, 'the minute job cancels the holds whose window passed (14:30''s and the 5-minute one)');
select is((select status::text || '/' || cancel_reason from public.orders where id = pg_temp.o('first')), 'cancelled/payment_timeout', 'cancelled as a payment timeout, nothing charged');
select is(pg_temp.taken('2026-11-27 15:00', '2026-11-27 16:00'), 1, 'and keeps its place for good, while the unpaid one''s window passed');
select is((app.ordering_tick(pg_temp.at('2026-11-27 14:20')) ->> 'payment_timeouts')::integer, 1, 'and at 14:20 the store''s window of the "Càng sớm" order');

-- 3. C17-I4: the queue -------------------------------------------------------------------------------------------------
insert into o select 'sched', pg_temp.order_of(pg_temp.place((select cust6_u from fx), '2026-11-27 15:30', '2026-11-27 14:21'));
select is(pg_temp.board_order(pg_temp.o('sched'), '2026-11-27 14:22'), null, 'an order waiting for its payment is not in the counter''s queue');
select is((pg_temp.pay_online(pg_temp.o('sched'), 'syn-305-2', '2026-11-27 14:24')) ->> 'state', 'succeeded', 'paid at 14:24');
create temp table sched_board as select pg_temp.board_order(pg_temp.o('sched'), '2026-11-27 14:25') as b;
select is((select (b ->> 'scheduled')::boolean from sched_board), true, 'once paid it enters the queue, scheduled');
select is((select pg_temp.local((b ->> 'start_at')::timestamptz) || ' ' || pg_temp.local((b ->> 'pickup_at')::timestamptz) from sched_board),
  '2026-11-27 15:15:00 2026-11-27 15:30:00', 'its preparation starts at the pick-up less the preparation time: 15:15 for 15:30');
select is((pg_temp.call((select staff_u from fx), format($q$select app.counter_board(%L, 0, %L)$q$, (select store_a1 from fx), pg_temp.at('2026-11-27 14:25'))) -> 'counts' ->> 'scheduled')::integer,
  2, 'the board counts the paid bookings still ahead as scheduled (15:00 and 15:30)');
select is((pg_temp.board_order(pg_temp.o('sched'), '2026-11-27 15:14:59') ->> 'scheduled')::boolean, true, 'boundary: at 15:14:59 it is still scheduled');
select is((pg_temp.board_order(pg_temp.o('sched'), '2026-11-27 15:15') ->> 'scheduled')::boolean, false, 'boundary: at 15:15 it enters the normal flow');
select is((pg_temp.board_order(pg_temp.o('sched'), '2026-11-27 15:24:59') ->> 'late')::boolean, false, 'boundary: late counts from the start, not the payment: not late at 15:24:59');
select is((pg_temp.board_order(pg_temp.o('sched'), '2026-11-27 15:25') ->> 'late')::boolean, true, 'boundary: late at 15:25, 10 minutes after the start');
select is((select pg_temp.local((pg_temp.call((select cust6_u from fx), format($q$select app.customer_order(%L, %L)$q$, pg_temp.o('sched'), pg_temp.at('2026-11-27 14:25'))) -> 'order' ->> 'ready_estimate_at')::timestamptz)),
  '2026-11-27 15:30:00', 'the customer sees it ready at the pick-up time');
update public.store_ordering_settings set max_waiting_orders = 3 where store_id = (select store_a1 from fx);
insert into public.orders (tenant_id, brand_id, store_id, source, order_type, business_date, order_no, status, payment_status, payment_method, subtotal, total,
  request_id, request_hash, placed_at, accepted_at, created_by)
select tenant_a, brand_a, store_a1, 'counter', 'takeaway', date '2026-11-27', 90 + n, 'accepted', 'unpaid', 'counter', 40000, 40000, gen_random_uuid(),
  repeat('a', 64), pg_temp.at('2026-11-27 14:00'), pg_temp.at('2026-11-27 14:00'), staff_u
from fx, generate_series(1, 2) n;
select is((app.ordering_state((select store_a1 from fx), null, pg_temp.at('2026-11-27 14:30')) ->> 'accepting')::boolean, true,
  'two due orders and one booked for later: the store of three is not busy (the later one does not count)');
select is(app.ordering_state((select store_a1 from fx), null, pg_temp.at('2026-11-27 15:15')) ->> 'reason', 'busy', 'at its start it counts and the store is busy');
delete from public.orders where store_id = (select store_a1 from fx) and source = 'counter';
update public.store_ordering_settings set max_waiting_orders = 30 where store_id = (select store_a1 from fx);
select is((pg_temp.act(pg_temp.o('sched'), 'start', '2026-11-27 14:40')) ->> 'state', 'ok', 'staff may start a booked order early');
select is((pg_temp.act(pg_temp.o('sched'), 'done', '2026-11-27 14:55')) -> 'order' ->> 'status', 'ready', 'and mark it ready at the counter');

-- 4. C17-E2: closed, booked for the next morning ----------------------------------------------------------------------
select is(pg_temp.refusal((select cust7_u from fx), null, '2026-11-27 23:30'), 'closed_now', 'closed at 23:30: "Càng sớm" is refused');
select is(pg_temp.refusal((select cust7_u from fx), '2026-11-27 23:45', '2026-11-27 23:30'), 'closed', 'a time tonight, after the closing, is closed');
select is(pg_temp.refusal((select cust7_u from fx), '2026-11-28 06:45', '2026-11-27 23:30'), 'closed', 'a time before the next opening is closed');
insert into o select 'morning', pg_temp.order_of(pg_temp.place((select cust7_u from fx), '2026-11-28 07:30', '2026-11-27 23:30'));
select is((select status::text || ' ' || business_date || ' ' || pg_temp.local(payment_due_at) from public.orders where id = pg_temp.o('morning')),
  'awaiting_payment 2026-11-28 2026-11-27 23:40:00', 'Saturday 07:30 is booked while closed, on Saturday''s business date, held 10 minutes');
select is((pg_temp.pay_online(pg_temp.o('morning'), 'syn-305-3', '2026-11-27 23:33')) ->> 'state', 'succeeded', 'paid at 23:33');
select is((select status::text || ' ' || order_no from public.orders where id = pg_temp.o('morning')), 'accepted 1', 'it takes the first number of Saturday, not Friday''s next');
select is((pg_temp.board_order(pg_temp.o('morning'), '2026-11-27 23:34') ->> 'scheduled')::boolean, true, 'the counter sees it scheduled');
select is((pg_temp.call((select cust7_u from fx), format($q$select app.customer_order(%L, %L)$q$, pg_temp.o('morning'), pg_temp.at('2026-11-27 23:34'))) -> 'order' ->> 'pickup_at')::timestamptz,
  pg_temp.at('2026-11-28 07:30'), 'and the customer''s order shows the pick-up time');
select is(pg_temp.refusal((select cust8_u from fx), '2026-11-28 07:00', '2026-11-27 23:30'), 'awaiting_payment', 'the opening itself (07:00) is bookable from the night before');
insert into public.ordering_closures (tenant_id, store_id, starts_on, ends_on, reason) select tenant_a, store_a1, date '2026-11-28', date '2026-11-28', 'Synthetic closure' from fx;
select is(pg_temp.refusal((select cust8_u from fx), '2026-11-28 07:15', '2026-11-27 23:30'), 'closed', 'a closed Saturday is closed for bookings too');
delete from public.ordering_closures where store_id = (select store_a1 from fx);

-- 5. The change of pick-up time and C17-S3 --------------------------------------------------------------------------
insert into o select 'move', pg_temp.order_of(pg_temp.place((select cust2_u from fx), '2026-11-27 16:00', '2026-11-27 14:30'));
create temp table moved as select pg_temp.change((select cust2_u from fx), pg_temp.o('move'), '2026-11-27 16:15', '2026-11-27 14:31') as r;
select is((select r ->> 'state' from moved), 'changed', 'the customer moves their unpaid booking to 16:15');
select is((select pg_temp.local(pickup_at) || ' v' || version || ' ' || pg_temp.local(payment_due_at) from public.orders where id = pg_temp.o('move')),
  '2026-11-27 16:15:00 v2 2026-11-27 14:40:00', 'the order holds 16:15, its version moved and its hold keeps its end');
select is((select action || ':' || actor_kind from public.order_events where order_id = pg_temp.o('move') order by id desc limit 1), 'pickup_changed:customer', 'the change is in the order''s log');
select is(pg_temp.taken('2026-11-27 16:00', '2026-11-27 14:32') || '/' || pg_temp.taken('2026-11-27 16:15', '2026-11-27 14:32'), '0/1', 'the old place is given back, the new one taken');
select is((pg_temp.change((select cust2_u from fx), pg_temp.o('move'), '2026-11-27 16:15', '2026-11-27 14:32')) ->> 'replayed', 'true', 'the same time again is a replay');
select is((pg_temp.change((select cust1_u from fx), pg_temp.o('move'), '2026-11-27 16:30', '2026-11-27 14:32')) ->> 'refusal', 'unknown_order', 'C17-S3: another customer cannot move it (as an unknown order)');
select is((pg_temp.change((select custb_u from fx), pg_temp.o('move'), '2026-11-27 16:30', '2026-11-27 14:32')) ->> 'refusal', 'unknown_order', 'nor a customer of another tenant');
select is((select pg_temp.local(pickup_at) from public.orders where id = pg_temp.o('move')), '2026-11-27 16:15:00', 'and the booking is unchanged');
select is((pg_temp.change((select cust2_u from fx), pg_temp.o('move'), '2026-11-27 14:45', '2026-11-27 14:33')) ->> 'refusal', 'slot_passed', 'a time already passed is refused');
select is((pg_temp.change((select cust2_u from fx), pg_temp.o('move'), '2026-11-27 15:00', '2026-11-27 14:33')) -> 'order' ->> 'pickup_at' is not null
  and (pg_temp.change((select cust2_u from fx), pg_temp.o('move'), '2026-11-27 23:15', '2026-11-27 14:33')) ->> 'refusal' = 'closed', true, 'a free earlier slot is taken; the closing hour is closed');
select is((pg_temp.change((select cust6_u from fx), pg_temp.o('sched'), '2026-11-27 16:45', '2026-11-27 14:34')) ->> 'refusal', 'not_changeable', 'a paid order cannot be moved by the customer');
select is((pg_temp.change((select cust2_u from fx), pg_temp.o('move'), '2026-11-27 16:30', '2026-11-27 14:40')) ->> 'refusal', 'not_changeable', 'boundary: at the end of the hold it cannot be moved');
insert into o select 'busy_mover', pg_temp.order_of(pg_temp.place((select cust3_u from fx), '2026-11-27 17:00', '2026-11-27 14:41'));
create temp table moves as
select n, pg_temp.change((select cust3_u from fx), pg_temp.o('busy_mover'), case when n % 2 = 0 then '2026-11-27 17:00' else '2026-11-27 17:15' end, '2026-11-27 14:42') ->> 'state' as s
from generate_series(1, 11) n;
select is((select string_agg(s, ',' order by n) from moves), 'changed,changed,changed,changed,changed,changed,changed,changed,changed,changed,refused',
  'ten changes in 15 minutes pass, the eleventh is rate limited');
select is((pg_temp.call((select staff_u from fx), format($q$select app.customer_change_pickup(%L, %L, %L)$q$, pg_temp.o('busy_mover'), pg_temp.at('2026-11-27 17:30'), pg_temp.at('2026-11-27 14:43'))) ->> 'error'),
  '42501', 'a staff login is no customer session');
select ok(not has_function_privilege('anon', 'public.customer_change_pickup(uuid, timestamptz)', 'execute') and has_function_privilege('authenticated', 'public.customer_change_pickup(uuid, timestamptz)', 'execute'),
  'the change is for signed-in customers only');

-- 6. C17-S2, the server's clock and C17-R1 ------------------------------------------------------------------------------
select is(
  (select string_agg(p.proname || ':' || p.provolatile::text, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname ~ 'slot|hold' or p.proname = 'customer_change_pickup')),
  'customer_change_pickup:v,customer_takeaway_slots:s', 'C17-S2: no function holds a place without an order: the slots are a read, the change moves an order''s own place');
select is(pg_temp.refusal((select cust8_u from fx), '2026-11-27 14:45', '2026-11-27 14:31'), 'slot_passed',
  'C17-S1: the server''s clock decides: 14:45 chosen at 14:20 on the phone is passed when it reaches the server at 14:31');
insert into o select 'h1', pg_temp.order_of(pg_temp.place((select cust8_u from fx), '2026-11-27 18:00', '2026-11-27 14:50'));
insert into o select 'h2', pg_temp.order_of(pg_temp.place((select cust8_u from fx), '2026-11-27 18:15', '2026-11-27 14:50'));
select is(pg_temp.refusal((select cust8_u from fx), '2026-11-27 18:30', '2026-11-27 14:50'), 'too_many_open_orders',
  'C17-S2: one customer holds at most three open orders, so at most three places (the Saturday booking is the first)');
select is((pg_temp.place_req((select cust1_u from fx), jsonb_build_object('request_id', gen_random_uuid(), 'store', 'tp-1', 'type', 'table', 'payment', 'counter',
    'table_token', app.table_qr_token((select tenant_a from fx), pg_temp.id('table_a1'), 1), 'lines', jsonb_build_array(jsonb_build_object('size', pg_temp.id('ta'), 'qty', 1)),
    'expected_total', 40000), '2026-11-27 14:50')) -> 'order' ->> 'status', 'accepted', 'C17-R1: a table order is placed and accepted at once, as before');

select * from finish();
rollback;
