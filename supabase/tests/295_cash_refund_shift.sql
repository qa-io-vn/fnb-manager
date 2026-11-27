-- A cash refund needs an open shift at the store (migration cash_refund_needs_shift; Q02, Q03-I3): the drawer a
-- clock-out counts is the cash its person took less the cash they handed back, so cash leaves only a counted drawer.
-- Techniques: decision table of counter_refund (how the refund is settled: cash, card, online pending, a failed online
-- refund settled in cash x the caller's shift: none, at another store, awaiting confirmation, begun one second later,
-- begun at the same second, open x role: staff, manager, owner), boundary values of the clock-in instant, error
-- guessing (the order's own refusals come before the shift rule; a direct insert or update past the function; a row
-- without a recorder; a settled row edited later), and regression: a refused refund writes nothing, and the refund
-- lands in the count of the person's drawer.
begin;
select plan(33);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000029501'::uuid as tenant_a,
  'cccccccc-cccc-4ccc-8ccc-000000029501'::uuid as account_a,
  'ffffffff-ffff-4fff-8fff-000000029501'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000029502'::uuid as store_a2,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000029501'::uuid as brand_a,
  '99999999-9999-4999-8999-000000029501'::uuid as app_a,
  'eeeeeeee-eeee-4eee-8eee-000000029501'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000029502'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000029503'::uuid as cashier_u,
  'eeeeeeee-eeee-4eee-8eee-000000029504'::uuid as staff2_u,
  'eeeeeeee-eeee-4eee-8eee-000000029505'::uuid as staff3_u,
  'eeeeeeee-eeee-4eee-8eee-000000029511'::uuid as cust1_u,
  timestamptz '2026-11-25 10:00:00+07' as noon;
grant select on fx to authenticated, anon;

create temp table ids (name text primary key, id uuid not null);
insert into ids values
  ('cat_drink', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029551'), ('item_cf', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029501'), ('cf', 'bbbbbbbb-bbbb-4bbb-8bbb-000000029511'),
  ('table_a1', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029541');
grant select on ids to authenticated, anon;
create function pg_temp.id(p_name text) returns uuid language sql stable as $$ select id from ids where name = p_name $$;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'native-295-' || right(u.id::text, 4) || '@example.com',
  case when u.tenant is null then '{}'::jsonb else jsonb_build_object('kind', 'customer', 'tenant_id', u.tenant) end
from fx cross join lateral (values
  (fx.owner_u, null::uuid), (fx.manager_u, null), (fx.cashier_u, null), (fx.staff2_u, null), (fx.staff3_u, null), (fx.cust1_u, fx.tenant_a)
) as u (id, tenant);
insert into public.tenants (id, slug, name) select tenant_a, 'native-295-a', 'Native 295 A' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) select account_a, tenant_a, 'mock', 'native-295-a', 'Synthetic account A' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name, opening_hours)
select s.id, fx.tenant_a, fx.account_a, s.ext, s.code, s.name,
  '{"mon": [["00:00", "24:00"]], "tue": [["00:00", "24:00"]], "wed": [["00:00", "24:00"]], "thu": [["00:00", "24:00"]], "fri": [["00:00", "24:00"]], "sat": [["00:00", "24:00"]], "sun": [["00:00", "24:00"]]}'::jsonb
from fx cross join lateral (values (fx.store_a1, 'n295-a1', 'sa-1', 'Synthetic store A1'), (fx.store_a2, 'n295-a2', 'sa-2', 'Synthetic store A2')) as s (id, ext, code, name);
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_a, m.user_id, m.role::public.tenant_role, m.store_ids
from fx cross join lateral (values
  (fx.owner_u, 'owner', null::uuid[]), (fx.manager_u, 'manager', null), (fx.cashier_u, 'staff', array[fx.store_a1]),
  (fx.staff2_u, 'staff', array[fx.store_a1, fx.store_a2]), (fx.staff3_u, 'staff', array[fx.store_a1])
) as m (user_id, role, store_ids);
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids) select brand_a, tenant_a, 'brand-1', 'Synthetic brand A', array[store_a1, store_a2] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status) select app_a, tenant_a, brand_a, 'synthetic-295-app-a', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id) select tenant_a, app_a, 'syn-zalo-295-1', cust1_u from fx;
insert into public.store_ordering_settings (store_id, tenant_id, till_mode, ordering_enabled, order_types, payment_methods, staff_presence_required)
select store_a1, tenant_a, 'native', true, array['table', 'takeaway'], array['counter', 'vietqr'], false from fx union all
select store_a2, tenant_a, 'native', true, array['table'], array['counter'], false from fx;
insert into public.menu_categories (id, tenant_id, brand_id, name, sort_order) select pg_temp.id('cat_drink'), tenant_a, brand_a, 'Đồ uống', 10 from fx;
insert into public.menu_items (id, tenant_id, brand_id, category_id, name, counts_for_stamps, order_types)
select pg_temp.id('item_cf'), tenant_a, brand_a, pg_temp.id('cat_drink'), 'Cà phê', true, array['table', 'takeaway'] from fx;
insert into public.menu_item_sizes (id, tenant_id, brand_id, item_id, label, price, sort_order, is_default)
select pg_temp.id('cf'), tenant_a, brand_a, pg_temp.id('item_cf'), null, 29000, 10, true from fx;
insert into public.store_tables (id, tenant_id, store_id, label, area) select pg_temp.id('table_a1'), tenant_a, store_a1, 'Bàn 1', 'Tầng 1' from fx;
-- The cashier who takes the payments of these orders is on shift at A1 all morning.
insert into public.staff_shifts (tenant_id, store_id, user_id, business_date, clock_in_at, opening_cash)
select tenant_a, store_a1, cashier_u, date '2026-11-25', timestamptz '2026-11-25 06:00+07', 0 from fx;

-- Helpers: a caller's claims for one statement (JSON, or {"error": SQLSTATE}); orders keyed and paid at A1 by the cashier;
-- the lifecycle; a refund at an instant; a shift row of a person; Vietnam time.
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
create function pg_temp.at(p_text text) returns timestamptz language sql immutable as $$ select (p_text || '+07')::timestamptz $$;
create temp table o (name text primary key, id uuid);
create function pg_temp.o(p_name text) returns uuid language sql stable as $$ select id from o where name = p_name $$;
create function pg_temp.keyed(p_qty integer default 1) returns uuid language sql as $$
  select (pg_temp.call((select cashier_u from fx), format($q$select app.counter_create_order(%L, %L::jsonb, %L)$q$, (select store_a1 from fx),
    jsonb_build_object('request_id', gen_random_uuid(), 'type', 'table', 'table_id', pg_temp.id('table_a1'), 'lines', jsonb_build_array(jsonb_build_object('size', pg_temp.id('cf'), 'qty', p_qty))),
    (select noon from fx))) -> 'order' ->> 'id')::uuid;
$$;
create function pg_temp.pay(p_order uuid, p_method text) returns text language sql as $$
  select pg_temp.call((select cashier_u from fx), format($q$select app.counter_record_payment(%L, %L, %s, %s, %L)$q$, p_order, p_method,
    (select total from public.orders where id = p_order), (select version from public.orders where id = p_order), (select noon from fx) + interval '1 minute')) ->> 'state';
$$;
create function pg_temp.act(p_user uuid, p_order uuid, p_action text, p_reason text default null) returns text language sql as $$
  select pg_temp.call(p_user, format($q$select app.counter_order_act(%L, %L, %s, %L, %L)$q$, p_order, p_action, (select version from public.orders where id = p_order), p_reason,
    (select noon from fx) + interval '2 minutes')) ->> 'state';
$$;
create function pg_temp.refund(p_user uuid, p_order uuid, p_amount numeric, p_at timestamptz) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.counter_refund(%L, %s, 'trả lại khách', %L)$q$, p_order, p_amount, p_at));
$$;
create function pg_temp.shift(p_user uuid, p_store uuid, p_in timestamptz, p_status text default 'open', p_opening numeric default 100000) returns uuid language sql as $$
  insert into public.staff_shifts (tenant_id, store_id, user_id, business_date, clock_in_at, opening_cash, clock_out_at, expected_cash, counted_cash, cash_difference, status)
  select (select tenant_a from fx), p_store, p_user, date '2026-11-25', p_in, p_opening,
    case when p_status <> 'open' then p_in + interval '1 hour' end, case when p_status <> 'open' then p_opening end,
    case when p_status <> 'open' then p_opening - 1000 end, case when p_status <> 'open' then -1000 end, p_status
  returning id;
$$;
create function pg_temp.refund_row(p_order uuid) returns text language sql stable as $$
  select string_agg(r.status || ':' || r.method || ':' || r.amount::bigint || ':' || coalesce((r.recorded_by = (select staff2_u from fx))::text, 'none'), ',' order by r.requested_at, r.id)
  from public.order_refunds r where r.order_id = p_order;
$$;

-- Orders of A1: c1 a cash order cancelled (its 29,000 due), done1 a completed cash order of two coffees, card1 a completed
-- card order, online1 a VietQR order of the app paid online and cancelled (its refund due through the provider).
insert into o select 'c1', pg_temp.keyed();
insert into o select 'done1', pg_temp.keyed(2);
insert into o select 'card1', pg_temp.keyed();
select is(pg_temp.pay(pg_temp.o('c1'), 'cash') || pg_temp.pay(pg_temp.o('done1'), 'cash') || pg_temp.pay(pg_temp.o('card1'), 'card'), 'paidpaidpaid', 'three counter orders are paid by the cashier on shift');
select is(pg_temp.act((select cashier_u from fx), pg_temp.o('c1'), 'cancel', 'customer_request'), 'ok', 'c1 is cancelled: its cash refund is due');
select is(
  (select string_agg(pg_temp.act((select cashier_u from fx), x.id, a.action), ',' order by x.n, a.k)
   from (values (1, pg_temp.o('done1')), (2, pg_temp.o('card1'))) as x (n, id) cross join (values (1, 'start'), (2, 'done'), (3, 'complete')) as a (k, action)),
  'ok,ok,ok,ok,ok,ok', 'done1 and card1 are completed'
);
insert into o select 'online1', (pg_temp.call((select cust1_u from fx), format($q$select app.customer_place_order(%L::jsonb, %L)$q$,
  jsonb_build_object('request_id', gen_random_uuid(), 'store', 'sa-1', 'type', 'takeaway', 'payment', 'vietqr', 'expected_total', 29000,
    'lines', jsonb_build_array(jsonb_build_object('size', pg_temp.id('cf'), 'qty', 1))), (select noon from fx))) -> 'order' ->> 'id')::uuid;
select is(
  (select app.checkout_payment_confirm('vietqr', 'ref-295-1', (app.checkout_payment_start((select cust1_u from fx), pg_temp.o('online1'), 'vietqr', 'key-295-online1', (select noon from fx)) ->> 'payment_id')::uuid,
    29000, true, null, (select noon from fx) + interval '1 minute') ->> 'state'),
  'succeeded', 'the app order is paid by VietQR'
);
select is(pg_temp.act((select manager_u from fx), pg_temp.o('online1'), 'cancel', 'store_busy'), 'ok', 'and cancelled: its refund is due through the provider');

-- 1. The decision table: cash without an open shift at the store is refused, nothing written ----------------------------
select is((pg_temp.refund((select staff2_u from fx), pg_temp.o('c1'), 29000, pg_temp.at('2026-11-25 11:00')) ->> 'refusal'), 'shift_required', 'staff without a shift cannot hand back the cash due');
select is(
  pg_temp.refund_row(pg_temp.o('c1')) || '/' || (select payment_status::text from public.orders where id = pg_temp.o('c1'))
    || '/' || (select count(*) from public.order_events where order_id = pg_temp.o('c1') and action = 'refunded'),
  'due:cash:29000:none/refund_pending/0', 'the refused refund writes nothing: still due, no recorder, no event'
);
do $$ begin perform pg_temp.shift((select staff2_u from fx), (select store_a2 from fx), pg_temp.at('2026-11-25 09:00')); end $$;
select is((pg_temp.refund((select staff2_u from fx), pg_temp.o('c1'), 29000, pg_temp.at('2026-11-25 11:00')) ->> 'refusal'), 'shift_required', 'a shift at another store does not count');
delete from public.staff_shifts where user_id = (select staff2_u from fx);
do $$ begin perform pg_temp.shift((select staff2_u from fx), (select store_a1 from fx), pg_temp.at('2026-11-25 09:00'), 'awaiting_confirmation'); end $$;
select is((pg_temp.refund((select staff2_u from fx), pg_temp.o('c1'), 29000, pg_temp.at('2026-11-25 11:00')) ->> 'refusal'), 'shift_required', 'nor a shift already counted, awaiting a manager');
delete from public.staff_shifts where user_id = (select staff2_u from fx);
do $$ begin perform pg_temp.shift((select staff2_u from fx), (select store_a1 from fx), pg_temp.at('2026-11-25 11:00:01')); end $$;
select is((pg_temp.refund((select staff2_u from fx), pg_temp.o('c1'), 29000, pg_temp.at('2026-11-25 11:00')) ->> 'refusal'), 'shift_required', 'boundary: a shift begun one second after the refund does not count');
update public.staff_shifts set clock_in_at = pg_temp.at('2026-11-25 11:00') where user_id = (select staff2_u from fx);
select is((pg_temp.refund((select staff2_u from fx), pg_temp.o('c1'), 29000, pg_temp.at('2026-11-25 11:00')) ->> 'state'), 'succeeded', 'boundary: a shift begun at the same second does');
select is(
  pg_temp.refund_row(pg_temp.o('c1')) || '/' || (select payment_status::text from public.orders where id = pg_temp.o('c1')),
  'succeeded:cash:29000:true/refunded', 'the cash refund is recorded with who handed it back'
);

-- 2. Managers and owners are not exempt; the order's own refusals come first ---------------------------------------------
select is((pg_temp.refund((select staff3_u from fx), pg_temp.o('done1'), 29000, pg_temp.at('2026-11-25 11:05')) ->> 'refusal'), 'manager_required', 'staff without a shift on a completed order: manager_required comes first');
select is((pg_temp.refund((select manager_u from fx), pg_temp.o('done1'), 58001, pg_temp.at('2026-11-25 11:05')) ->> 'refusal'), 'amount_over_refundable', 'and so does an amount over what was paid');
select is((pg_temp.refund((select manager_u from fx), pg_temp.o('c1'), 1, pg_temp.at('2026-11-25 11:05')) ->> 'refusal'), 'not_refundable', 'and a refunded order');
select is((pg_temp.refund((select manager_u from fx), pg_temp.o('done1'), 29000, pg_temp.at('2026-11-25 11:05')) ->> 'refusal'), 'shift_required', 'a manager without a shift cannot hand back cash of a completed order');
select is((pg_temp.refund((select owner_u from fx), pg_temp.o('done1'), 29000, pg_temp.at('2026-11-25 11:05')) ->> 'refusal'), 'shift_required', 'nor can the owner');
select is((select count(*)::int from public.order_refunds where order_id = pg_temp.o('done1')), 0, 'no refund row was written');

-- 3. Card and online refunds touch no drawer: not gated -------------------------------------------------------------------
select is((pg_temp.refund((select owner_u from fx), pg_temp.o('card1'), 29000, pg_temp.at('2026-11-25 11:10')) ->> 'state'), 'succeeded', 'the owner refunds a card order without a shift: handed back on the terminal');
select is(pg_temp.refund_row(pg_temp.o('card1')), 'succeeded:card:29000:false', 'recorded as a card refund');
select is((pg_temp.refund((select staff3_u from fx), pg_temp.o('online1'), 29000, pg_temp.at('2026-11-25 11:10')) ->> 'state'), 'pending', 'staff without a shift send the due VietQR refund back through the provider: pending');
select is((app.checkout_refund_confirm((select id from public.order_refunds where order_id = pg_temp.o('online1')), false, null, 'timeout', pg_temp.at('2026-11-25 11:20')) ->> 'state'), 'failed', 'the provider fails it');
select is((pg_temp.refund((select manager_u from fx), pg_temp.o('online1'), 29000, pg_temp.at('2026-11-25 11:30')) ->> 'refusal'), 'shift_required', 'a manager settling the failed online refund in cash needs a shift');
select is(pg_temp.refund_row(pg_temp.o('online1')), 'failed:vietqr:29000:false', 'the failed refund is left as it was');
do $$ begin perform pg_temp.shift((select manager_u from fx), (select store_a1 from fx), pg_temp.at('2026-11-25 11:25'), 'open', 500000); end $$;
select is((pg_temp.refund((select manager_u from fx), pg_temp.o('online1'), 29000, pg_temp.at('2026-11-25 11:30')) ->> 'method'), 'cash', 'on shift the manager hands it back in cash');
select is((pg_temp.refund((select manager_u from fx), pg_temp.o('done1'), 29000, pg_temp.at('2026-11-25 11:35')) ->> 'state'), 'succeeded', 'and refunds a coffee of the completed order in cash');

-- 4. Regression: the refunds land in the counted drawers --------------------------------------------------------------------
select is(
  (select (pg_temp.call((select staff2_u from fx), format($q$select app.staff_clock_out(%s, %L)$q$, 71000, pg_temp.at('2026-11-25 12:00'))) -> 'shift' ->> 'status')),
  'closed', 'staff2 counts 71,000: the opening 100,000 less the 29,000 handed back, and the shift closes'
);
select is(
  (select (r -> 'shift' ->> 'expected_cash') || '/' || (r ->> 'state')
   from pg_temp.call((select manager_u from fx), format($q$select app.staff_clock_out(%s, %L)$q$, 442000, pg_temp.at('2026-11-25 12:00'))) r),
  '442000/closed', 'the manager''s drawer: 500,000 less the two cash refunds of 29,000'
);

-- 5. The trigger guards every other writer ------------------------------------------------------------------------------
create function pg_temp.hint_of(p_sql text) returns text language plpgsql as $f$
declare
  v_hint text;
begin
  execute p_sql;
  return 'written';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return sqlstate || ':' || coalesce(v_hint, '');
end;
$f$;
select is(
  pg_temp.hint_of(format($q$insert into public.order_refunds (tenant_id, store_id, order_id, method, amount, status, reason, requested_by, requested_at, recorded_by, settled_at)
    values (%L, %L, %L, 'cash', 1000, 'succeeded', 'past the function', %L, %L, %L, %L)$q$,
    (select tenant_a from fx), (select store_a1 from fx), pg_temp.o('done1'), (select staff3_u from fx), pg_temp.at('2026-11-25 12:10'), (select staff3_u from fx), pg_temp.at('2026-11-25 12:10'))),
  '42501:shift_required', 'a cash refund recorded by a person without a shift is refused whoever writes it, with the hint shift_required'
);
select lives_ok(
  format($q$insert into public.order_refunds (tenant_id, store_id, order_id, method, amount, status, reason, requested_at, settled_at)
    values (%L, %L, %L, 'cash', 1000, 'succeeded', 'fixture without a recorder', %L, %L)$q$,
    (select tenant_a from fx), (select store_a1 from fx), pg_temp.o('done1'), pg_temp.at('2026-11-25 12:10'), pg_temp.at('2026-11-25 12:10')),
  'a row without a recorder (a fixture, a migration) is not checked'
);
select is(
  pg_temp.hint_of(format($q$update public.order_refunds set method = 'cash' where order_id = %L and method = 'card'$q$, pg_temp.o('card1'))),
  '42501:shift_required', 'an update turning a settled card refund into cash, recorded by someone without a shift, is refused'
);
select lives_ok(
  format($q$update public.order_refunds set reason = left(reason || ' (ghi chú)', 200) where order_id = %L and method = 'cash' and recorded_by = %L$q$, pg_temp.o('c1'), (select staff2_u from fx)),
  'a cash refund settled on a shift that has since closed can still be annotated: only a new settlement is checked'
);
select ok(
  not has_function_privilege('authenticated', 'app.order_refunds_need_shift()', 'execute') and not has_function_privilege('anon', 'app.order_refunds_need_shift()', 'execute')
  and exists (select 1 from pg_trigger t where t.tgrelid = 'public.order_refunds'::regclass and t.tgname = 'order_refunds_need_shift' and not t.tgisinternal)
  and has_function_privilege('authenticated', 'public.counter_refund(uuid, numeric, text)', 'execute') and not has_function_privilege('anon', 'public.counter_refund(uuid, numeric, text)', 'execute'),
  'the trigger is in place, its function is no API role''s, and counter_refund keeps its grants'
);

select * from finish();
rollback;
