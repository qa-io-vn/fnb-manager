-- "Đối chiếu" of a shift (Q02 frame 1; migration shift_reconciliation): the cashier reads it only once their count is
-- recorded, owners and managers of the store for another person's shift at any time; the expected cash is never shown
-- to the counting person before the count.
-- Techniques: a decision table of the read (before or after the count x own shift or another's x staff, manager, owner,
-- a manager of another store, a viewer, another tenant, a customer, an unknown or a missing id), boundary values of the
-- window (a payment at the clock-in instant in, one a second before the clock-out in, one at the clock-out out),
-- equivalence partitions of the money (cash sales, a voided payment, cash refunds, card payments and refunds, the
-- store's VietQR, another person's cash), an oracle (the expected cash equals the opening cash plus the sales less the
-- refunds and paid-outs, and the shift's own expected cash), state transitions (open -> awaiting confirmation -> closed),
-- error guessing (the blind count: no expected figure anywhere in the refused answer; a manager's own open shift), and
-- grants.
begin;
select plan(29);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000029601'::uuid as tenant_a,
  'dddddddd-dddd-4ddd-8ddd-000000029602'::uuid as tenant_b,
  'cccccccc-cccc-4ccc-8ccc-000000029601'::uuid as account_a,
  'cccccccc-cccc-4ccc-8ccc-000000029602'::uuid as account_b,
  'ffffffff-ffff-4fff-8fff-000000029601'::uuid as store_a1,
  'ffffffff-ffff-4fff-8fff-000000029602'::uuid as store_a2,
  'ffffffff-ffff-4fff-8fff-000000029603'::uuid as store_b1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000029601'::uuid as brand_a,
  '99999999-9999-4999-8999-000000029601'::uuid as app_a,
  'eeeeeeee-eeee-4eee-8eee-000000029601'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000029602'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000029603'::uuid as cashier_u,
  'eeeeeeee-eeee-4eee-8eee-000000029604'::uuid as staff2_u,
  'eeeeeeee-eeee-4eee-8eee-000000029605'::uuid as manager_a2_u,
  'eeeeeeee-eeee-4eee-8eee-000000029606'::uuid as viewer_u,
  'eeeeeeee-eeee-4eee-8eee-000000029607'::uuid as owner_b_u,
  'eeeeeeee-eeee-4eee-8eee-000000029611'::uuid as cust1_u,
  'eeeeeeee-eeee-4eee-8eee-000000029612'::uuid as cust2_u;
grant select on fx to authenticated, anon;

create temp table ids (name text primary key, id uuid not null);
insert into ids values
  ('cat_drink', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029651'), ('item_cf', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029601'), ('cf', 'bbbbbbbb-bbbb-4bbb-8bbb-000000029611'),
  ('table_a1', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029641');
grant select on ids to authenticated, anon;
create function pg_temp.id(p_name text) returns uuid language sql stable as $$ select id from ids where name = p_name $$;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'native-296-' || right(u.id::text, 4) || '@example.com',
  case when u.tenant is null then '{}'::jsonb else jsonb_build_object('kind', 'customer', 'tenant_id', u.tenant) end
from fx cross join lateral (values
  (fx.owner_u, null::uuid), (fx.manager_u, null), (fx.cashier_u, null), (fx.staff2_u, null), (fx.manager_a2_u, null), (fx.viewer_u, null), (fx.owner_b_u, null),
  (fx.cust1_u, fx.tenant_a), (fx.cust2_u, fx.tenant_a)
) as u (id, tenant);
insert into public.tenants (id, slug, name)
select tenant_a, 'native-296-a', 'Native 296 A' from fx union all
select tenant_b, 'native-296-b', 'Native 296 B' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_a, tenant_a, 'mock', 'native-296-a', 'Synthetic account A' from fx union all
select account_b, tenant_b, 'mock', 'native-296-b', 'Synthetic account B' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name, opening_hours)
select s.id, s.tenant, s.account, s.ext, s.code, s.name,
  '{"mon": [["00:00", "24:00"]], "tue": [["00:00", "24:00"]], "wed": [["00:00", "24:00"]], "thu": [["00:00", "24:00"]], "fri": [["00:00", "24:00"]], "sat": [["00:00", "24:00"]], "sun": [["00:00", "24:00"]]}'::jsonb
from fx cross join lateral (values
  (fx.store_a1, fx.tenant_a, fx.account_a, 'n296-a1', 'sa-1', 'Synthetic store A1'),
  (fx.store_a2, fx.tenant_a, fx.account_a, 'n296-a2', 'sa-2', 'Synthetic store A2'),
  (fx.store_b1, fx.tenant_b, fx.account_b, 'n296-b1', 'sb-1', 'Synthetic store B1')
) as s (id, tenant, account, ext, code, name);
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_a, m.user_id, m.role::public.tenant_role, m.store_ids
from fx cross join lateral (values
  (fx.owner_u, 'owner', null::uuid[]), (fx.manager_u, 'manager', null), (fx.cashier_u, 'staff', array[fx.store_a1]), (fx.staff2_u, 'staff', array[fx.store_a1]),
  (fx.manager_a2_u, 'manager', array[fx.store_a2]), (fx.viewer_u, 'viewer', null)
) as m (user_id, role, store_ids)
union all
select tenant_b, owner_b_u, 'owner', null from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids) select brand_a, tenant_a, 'brand-1', 'Synthetic brand A', array[store_a1, store_a2] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status) select app_a, tenant_a, brand_a, 'synthetic-296-app-a', 'ZALO_APP_SECRET_BRAND_1', 'active' from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id)
select tenant_a, app_a, 'syn-zalo-296-1', cust1_u from fx union all
select tenant_a, app_a, 'syn-zalo-296-2', cust2_u from fx;
insert into public.store_ordering_settings (store_id, tenant_id, till_mode, ordering_enabled, order_types, payment_methods, staff_presence_required)
select store_a1, tenant_a, 'native', true, array['table', 'takeaway'], array['counter', 'vietqr'], false from fx;
insert into public.menu_categories (id, tenant_id, brand_id, name, sort_order) select pg_temp.id('cat_drink'), tenant_a, brand_a, 'Đồ uống', 10 from fx;
insert into public.menu_items (id, tenant_id, brand_id, category_id, name, counts_for_stamps, order_types)
select pg_temp.id('item_cf'), tenant_a, brand_a, pg_temp.id('cat_drink'), 'Cà phê', true, array['table', 'takeaway'] from fx;
insert into public.menu_item_sizes (id, tenant_id, brand_id, item_id, label, price, sort_order, is_default)
select pg_temp.id('cf'), tenant_a, brand_a, pg_temp.id('item_cf'), null, 29000, 10, true from fx;
insert into public.store_tables (id, tenant_id, store_id, label, area) select pg_temp.id('table_a1'), tenant_a, store_a1, 'Bàn 1', 'Tầng 1' from fx;

-- Helpers: a caller's claims for one statement (JSON, or {"error": SQLSTATE}); Vietnam time; a keyed order; a counter
-- payment, an undo, an action and a refund at an instant; the reconciliation read.
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
create function pg_temp.as_role(p_user uuid, p_sql text) returns text language plpgsql as $$
declare
  v text;
begin
  perform pg_temp.claims(p_user);
  perform set_config('role', 'authenticated', true);
  begin
    execute p_sql into v;
  exception when others then
    v := sqlstate;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v;
end;
$$;
create function pg_temp.at(p_text text) returns timestamptz language sql immutable as $$ select (p_text || '+07')::timestamptz $$;
create temp table o (name text primary key, id uuid);
create function pg_temp.o(p_name text) returns uuid language sql stable as $$ select id from o where name = p_name $$;
create function pg_temp.keyed(p_user uuid, p_qty integer, p_at timestamptz) returns uuid language sql as $$
  select (pg_temp.call(p_user, format($q$select app.counter_create_order(%L, %L::jsonb, %L)$q$, (select store_a1 from fx),
    jsonb_build_object('request_id', gen_random_uuid(), 'type', 'table', 'table_id', pg_temp.id('table_a1'), 'lines', jsonb_build_array(jsonb_build_object('size', pg_temp.id('cf'), 'qty', p_qty))),
    p_at)) -> 'order' ->> 'id')::uuid;
$$;
create function pg_temp.pay(p_user uuid, p_order uuid, p_method text, p_at timestamptz) returns text language sql as $$
  select pg_temp.call(p_user, format($q$select app.counter_record_payment(%L, %L, %s, %s, %L)$q$, p_order, p_method,
    (select total from public.orders where id = p_order), (select version from public.orders where id = p_order), p_at)) ->> 'state';
$$;
create function pg_temp.act(p_user uuid, p_order uuid, p_action text, p_reason text, p_at timestamptz) returns text language sql as $$
  select pg_temp.call(p_user, format($q$select app.counter_order_act(%L, %L, %s, %L, %L)$q$, p_order, p_action, (select version from public.orders where id = p_order), p_reason, p_at)) ->> 'state';
$$;
create function pg_temp.refund(p_user uuid, p_order uuid, p_amount numeric, p_at timestamptz) returns text language sql as $$
  select pg_temp.call(p_user, format($q$select app.counter_refund(%L, %s, 'khách đổi ý', %L)$q$, p_order, p_amount, p_at)) ->> 'state';
$$;
create function pg_temp.recon(p_user uuid, p_shift uuid, p_at timestamptz default null) returns jsonb language sql as $$
  select pg_temp.call(p_user, format($q$select app.staff_shift_reconciliation(%L, %L)$q$, p_shift, coalesce(p_at, pg_temp.at('2026-11-25 12:30'))));
$$;
create function pg_temp.app_order(p_user uuid) returns uuid language sql as $$
  select (pg_temp.call(p_user, format($q$select app.customer_place_order(%L::jsonb, %L)$q$,
    jsonb_build_object('request_id', gen_random_uuid(), 'store', 'sa-1', 'type', 'takeaway', 'payment', 'vietqr', 'expected_total', 29000,
      'lines', jsonb_build_array(jsonb_build_object('size', pg_temp.id('cf'), 'qty', 1))), pg_temp.at('2026-11-25 11:50'))) -> 'order' ->> 'id')::uuid;
$$;
create function pg_temp.pay_online(p_order uuid, p_ref text, p_at timestamptz) returns text language sql as $$
  select app.checkout_payment_confirm('vietqr', p_ref,
    (app.checkout_payment_start((select l.user_id from app.customer_logins l join public.orders x on x.customer_login_id = l.id where x.id = p_order), p_order, 'vietqr', 'key-' || p_ref, pg_temp.at('2026-11-25 11:55')) ->> 'payment_id')::uuid,
    29000, true, null, p_at) ->> 'state';
$$;

-- The morning at A1: the cashier and staff2 clock in at 07:00, with 1,000,000 and nothing in their drawers.
insert into ids values ('sh_cashier', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029661'), ('sh_staff2', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029662'), ('sh_manager', 'aaaaaaaa-aaaa-4aaa-8aaa-000000029663');
insert into public.staff_shifts (id, tenant_id, store_id, user_id, business_date, clock_in_at, opening_cash)
select pg_temp.id('sh_cashier'), tenant_a, store_a1, cashier_u, date '2026-11-25', pg_temp.at('2026-11-25 07:00'), 1000000 from fx union all
select pg_temp.id('sh_staff2'), tenant_a, store_a1, staff2_u, date '2026-11-25', pg_temp.at('2026-11-25 07:00'), 0 from fx;

-- The cashier's money: o1 (29,000 cash at the clock-in instant), o2 (58,000 cash), o3 (29,000 cash, undone), o5 (29,000
-- cash, cancelled and handed back), o4 (29,000 card), o6 (29,000 card, cancelled and refunded on the card); staff2's o8
-- (29,000 cash); the store's app orders o7 (VietQR at 11:59:59) and o9 (VietQR at 12:00:00).
insert into o select 'o1', pg_temp.keyed((select cashier_u from fx), 1, pg_temp.at('2026-11-25 06:55'));
insert into o select 'o2', pg_temp.keyed((select cashier_u from fx), 2, pg_temp.at('2026-11-25 07:10'));
insert into o select 'o3', pg_temp.keyed((select cashier_u from fx), 1, pg_temp.at('2026-11-25 07:20'));
insert into o select 'o4', pg_temp.keyed((select cashier_u from fx), 1, pg_temp.at('2026-11-25 07:30'));
insert into o select 'o5', pg_temp.keyed((select cashier_u from fx), 1, pg_temp.at('2026-11-25 07:40'));
insert into o select 'o6', pg_temp.keyed((select cashier_u from fx), 1, pg_temp.at('2026-11-25 07:50'));
insert into o select 'o8', pg_temp.keyed((select staff2_u from fx), 1, pg_temp.at('2026-11-25 08:00'));
select is(
  pg_temp.pay((select cashier_u from fx), pg_temp.o('o1'), 'cash', pg_temp.at('2026-11-25 07:00')) || ',' || pg_temp.pay((select cashier_u from fx), pg_temp.o('o2'), 'cash', pg_temp.at('2026-11-25 07:11'))
    || ',' || pg_temp.pay((select cashier_u from fx), pg_temp.o('o3'), 'cash', pg_temp.at('2026-11-25 07:21')) || ',' || pg_temp.pay((select cashier_u from fx), pg_temp.o('o4'), 'card', pg_temp.at('2026-11-25 07:31'))
    || ',' || pg_temp.pay((select cashier_u from fx), pg_temp.o('o5'), 'cash', pg_temp.at('2026-11-25 07:41')) || ',' || pg_temp.pay((select cashier_u from fx), pg_temp.o('o6'), 'card', pg_temp.at('2026-11-25 07:51'))
    || ',' || pg_temp.pay((select staff2_u from fx), pg_temp.o('o8'), 'cash', pg_temp.at('2026-11-25 08:01')),
  'paid,paid,paid,paid,paid,paid,paid', 'seven counter payments, the first at the clock-in instant'
);
select is(
  (pg_temp.call((select cashier_u from fx), format($q$select app.counter_void_payment(%L, 'bấm nhầm', %L)$q$,
    (select p.id from public.order_payments p where p.order_id = pg_temp.o('o3')), pg_temp.at('2026-11-25 07:25'))) ->> 'state'),
  'voided', 'the cashier undoes o3''s payment'
);
select is(
  pg_temp.act((select cashier_u from fx), pg_temp.o('o5'), 'cancel', 'customer_request', pg_temp.at('2026-11-25 08:10')) || ',' || pg_temp.refund((select cashier_u from fx), pg_temp.o('o5'), 29000, pg_temp.at('2026-11-25 08:11'))
    || ',' || pg_temp.act((select cashier_u from fx), pg_temp.o('o6'), 'cancel', 'customer_request', pg_temp.at('2026-11-25 08:20')) || ',' || pg_temp.refund((select cashier_u from fx), pg_temp.o('o6'), 29000, pg_temp.at('2026-11-25 08:21')),
  'ok,succeeded,ok,succeeded', 'o5 is cancelled and its cash handed back, o6 cancelled and refunded on the card'
);
insert into o select 'o7', pg_temp.app_order((select cust1_u from fx));
insert into o select 'o9', pg_temp.app_order((select cust2_u from fx));
select is(pg_temp.pay_online(pg_temp.o('o7'), 'ref-296-7', pg_temp.at('2026-11-25 11:59:59')) || ',' || pg_temp.pay_online(pg_temp.o('o9'), 'ref-296-9', pg_temp.at('2026-11-25 12:00:00')),
  'succeeded,succeeded', 'two app orders paid by VietQR, one second before noon and at noon');

-- 1. Before the count: the decision table --------------------------------------------------------------------------------
select is(
  (select (r ->> 'state') || '/' || (r ->> 'refusal') || '/' || coalesce(r ->> 'reconciliation', 'null') || '/' || (r -> 'shift' ->> 'status') from pg_temp.recon((select cashier_u from fx), pg_temp.id('sh_cashier')) r),
  'refused/count_required/null/open', 'the cashier before counting: count_required, with the open shift'
);
select ok(
  (select position('expected' in r::text) = 0 and position('1087000' in r::text) = 0 and position('116000' in r::text) = 0 from pg_temp.recon((select cashier_u from fx), pg_temp.id('sh_cashier')) r),
  'the blind count: the refused answer holds no expected cash, no sales total, nothing to count against'
);
select is((pg_temp.recon((select staff2_u from fx), pg_temp.id('sh_cashier')) ->> 'error'), '42501', 'another staff member of the store cannot read the cashier''s shift');
select is(
  (select (r ->> 'state') || '/' || (r -> 'reconciliation' ->> 'counted') || '/' || (r -> 'reconciliation' ->> 'expected_cash') || '/' || coalesce(r -> 'reconciliation' ->> 'counted_cash', 'null')
     || '/' || coalesce(r -> 'reconciliation' ->> 'matched', 'null') || '/' || coalesce(r -> 'shift' ->> 'expected_cash', 'null')
   from pg_temp.recon((select manager_u from fx), pg_temp.id('sh_cashier'), pg_temp.at('2026-11-25 11:00')) r),
  'ok/false/1087000/null/null/null', 'a manager reads the open shift at any time: the figures so far, nothing counted'
);
select is((pg_temp.recon((select owner_u from fx), pg_temp.id('sh_cashier')) ->> 'state'), 'ok', 'so does the owner');
select is((pg_temp.recon((select manager_a2_u from fx), pg_temp.id('sh_cashier')) ->> 'error'), '42501', 'a manager of another store cannot');
select is((pg_temp.recon((select viewer_u from fx), pg_temp.id('sh_cashier')) ->> 'error'), '42501', 'nor a viewer');
select is((pg_temp.recon((select owner_b_u from fx), pg_temp.id('sh_cashier')) ->> 'error'), '42501', 'nor another tenant''s owner');
select is((pg_temp.recon((select cust1_u from fx), pg_temp.id('sh_cashier')) ->> 'error'), '42501', 'nor a customer');
select is((pg_temp.recon((select manager_u from fx), 'aaaaaaaa-aaaa-4aaa-8aaa-000000029699') ->> 'error'), '42501', 'an unknown shift answers as one out of reach');
select is((pg_temp.recon((select manager_u from fx), null) ->> 'error'), '22023', 'no shift id is 22023');

-- 2. After the count -----------------------------------------------------------------------------------------------------
select is(
  (pg_temp.call((select cashier_u from fx), format($q$select app.staff_clock_out(1080000, %L)$q$, pg_temp.at('2026-11-25 12:00'))) ->> 'state'),
  'awaiting_confirmation', 'the cashier counts 1,080,000 at noon: short, awaiting a manager'
);
select is(
  (select r -> 'reconciliation' from pg_temp.recon((select cashier_u from fx), pg_temp.id('sh_cashier')) r),
  jsonb_build_object('from', pg_temp.at('2026-11-25 07:00'), 'until', pg_temp.at('2026-11-25 12:00'), 'counted', true, 'opening_cash', 1000000,
    'cash_sales', jsonb_build_object('count', 3, 'total', 116000), 'cash_refunds', jsonb_build_object('count', 1, 'total', 29000),
    'paid_outs', jsonb_build_object('count', 0, 'total', 0), 'expected_cash', 1087000, 'counted_cash', 1080000, 'cash_difference', -7000, 'matched', false,
    'not_in_drawer', jsonb_build_object('card', jsonb_build_object('count', 2, 'total', 58000), 'card_refunds', jsonb_build_object('count', 1, 'total', 29000),
      'vietqr', jsonb_build_object('count', 1, 'total', 29000), 'zalo_checkout', jsonb_build_object('count', 0, 'total', 0))),
  'after the count the cashier reads it all: the cash at the clock-in instant in, the undone payment and staff2''s cash out, the refund, the card, and the store''s VietQR of 11:59:59 but not the one at noon'
);
select is(
  (select ((r -> 'reconciliation' ->> 'opening_cash')::bigint + (r -> 'reconciliation' -> 'cash_sales' ->> 'total')::bigint - (r -> 'reconciliation' -> 'cash_refunds' ->> 'total')::bigint
     - (r -> 'reconciliation' -> 'paid_outs' ->> 'total')::bigint)::text || '/' || (select expected_cash::bigint from public.staff_shifts where id = pg_temp.id('sh_cashier'))
   from pg_temp.recon((select cashier_u from fx), pg_temp.id('sh_cashier')) r),
  '1087000/1087000', 'oracle: opening + cash sales - cash refunds - paid-outs is the expected cash the count was compared with'
);
select is(
  (select (r -> 'shift' ->> 'expected_cash') || '/' || ((r -> 'shift') ? 'user_id')::text from pg_temp.recon((select cashier_u from fx), pg_temp.id('sh_cashier')) r),
  '1087000/false', 'the cashier sees their shift as staff_my_shift shows it to them'
);
select is((pg_temp.recon((select staff2_u from fx), pg_temp.id('sh_cashier')) ->> 'error'), '42501', 'another staff member still cannot read it after the count');
select is(
  (select (r -> 'shift' ->> 'user_id')::uuid = (select cashier_u from fx) from pg_temp.recon((select manager_u from fx), pg_temp.id('sh_cashier')) r),
  true, 'a manager reads the counted shift with whose it is'
);
select is(
  (pg_temp.call((select manager_u from fx), format($q$select app.manager_confirm_shift(%L, 'thối nhầm', %L)$q$, pg_temp.id('sh_cashier'), pg_temp.at('2026-11-25 12:10'))) ->> 'state'),
  'closed', 'the manager confirms the difference'
);
select is(
  (select (r ->> 'state') || '/' || (r -> 'shift' ->> 'status') || '/' || (r -> 'reconciliation' ->> 'cash_difference') from pg_temp.recon((select cashier_u from fx), pg_temp.id('sh_cashier')) r),
  'ok/closed/-7000', 'the closed shift still reads the same'
);
select is((pg_temp.recon((select staff2_u from fx), pg_temp.id('sh_staff2')) ->> 'refusal'), 'count_required', 'staff2''s own shift, still open, is refused to staff2');

-- 3. A manager on shift counts blind too ---------------------------------------------------------------------------------
insert into public.staff_shifts (id, tenant_id, store_id, user_id, business_date, clock_in_at, opening_cash)
select pg_temp.id('sh_manager'), tenant_a, store_a1, manager_u, date '2026-11-25', pg_temp.at('2026-11-25 12:20'), 500000 from fx;
select is((pg_temp.recon((select manager_u from fx), pg_temp.id('sh_manager')) ->> 'refusal'), 'count_required', 'a manager reading their own open shift gets count_required like any cashier');
select is((pg_temp.recon((select owner_u from fx), pg_temp.id('sh_manager')) -> 'reconciliation' ->> 'expected_cash'), '500000', 'the owner reads the manager''s open shift');
select is(
  (pg_temp.call((select manager_u from fx), format($q$select app.staff_clock_out(500000, %L)$q$, pg_temp.at('2026-11-25 12:40'))) ->> 'state')
    || '/' || (pg_temp.recon((select manager_u from fx), pg_temp.id('sh_manager'), pg_temp.at('2026-11-25 12:45')) -> 'reconciliation' ->> 'matched'),
  'closed/true', 'once counted (matched), the manager reads their own'
);

-- 4. Grants ---------------------------------------------------------------------------------------------------------------
select ok(
  has_function_privilege('authenticated', 'public.staff_shift_reconciliation(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.staff_shift_reconciliation(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.staff_shift_reconciliation(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'app.staff_shift_reconciliation(uuid, timestamptz)', 'execute'),
  'the RPC is for signed-in callers only; anon, the service role and the app half get nothing'
);
select is(
  pg_temp.as_role((select cashier_u from fx), format($q$select public.staff_shift_reconciliation(%L) -> 'reconciliation' ->> 'expected_cash'$q$, pg_temp.id('sh_cashier'))),
  '1087000', 'the wrapper answers through the API role'
);

select * from finish();
rollback;
