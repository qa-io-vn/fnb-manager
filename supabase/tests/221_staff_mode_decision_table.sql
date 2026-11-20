-- ISTQB decision table: confirmation mode of the store (S1 = staff, P = pos_sync) x action (record a bill, record a
-- path B check-in, show the counter QR, list recent bills, read the manager queue, a customer's path C receipt claim,
-- a customer's counter claim) x role (owner, manager of the store, staff of the store, staff of another store, viewer).
-- Expected: the role decides 42501 first (the store scope), then the mode decides which earning path answers, so
-- path E only works at staff stores and paths B and C only at pos_sync stores; the paths A to D refuse staff_mode at
-- a staff store (the decision table of loyalty_earn).
begin;
select plan(40);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

-- Fixture: tenant T with stores S1 and S2 in staff mode and P in pos_sync mode, tenant U with store B.
create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000022101'::uuid as tenant_t,
  'dddddddd-dddd-4ddd-8ddd-000000022102'::uuid as tenant_u,
  'cccccccc-cccc-4ccc-8ccc-000000022101'::uuid as account_t,
  'cccccccc-cccc-4ccc-8ccc-000000022102'::uuid as account_u,
  'ffffffff-ffff-4fff-8fff-000000022101'::uuid as store_s1,
  'ffffffff-ffff-4fff-8fff-000000022102'::uuid as store_s2,
  'ffffffff-ffff-4fff-8fff-000000022103'::uuid as store_p,
  'ffffffff-ffff-4fff-8fff-000000022104'::uuid as store_b,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000022101'::uuid as brand_t,
  '99999999-9999-4999-8999-000000022101'::uuid as app_t,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000022101'::uuid as programme_t,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000022102'::uuid as programme_u,
  'eeeeeeee-eeee-4eee-8eee-000000022101'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000022102'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000022103'::uuid as staff_1,
  'eeeeeeee-eeee-4eee-8eee-000000022104'::uuid as staff_2,
  'eeeeeeee-eeee-4eee-8eee-000000022105'::uuid as staff_s2,
  'eeeeeeee-eeee-4eee-8eee-000000022106'::uuid as owner_b,
  'eeeeeeee-eeee-4eee-8eee-000000022107'::uuid as viewer_u,
  'eeeeeeee-eeee-4eee-8eee-000000022111'::uuid as login_1,
  'eeeeeeee-eeee-4eee-8eee-000000022112'::uuid as login_2,
  'eeeeeeee-eeee-4eee-8eee-000000022113'::uuid as login_3,
  timestamptz '2026-11-10 10:00+07' as t0;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'bill-21-' || right(u.id::text, 4) || '@example.com',
  case when u.customer then jsonb_build_object('kind', 'customer', 'tenant_id', fx.tenant_t, 'customer_id', null) else '{}'::jsonb end
from fx cross join lateral (values
  (fx.owner_u, false), (fx.manager_u, false), (fx.staff_1, false), (fx.staff_2, false), (fx.staff_s2, false), (fx.owner_b, false), (fx.viewer_u, false),
  (fx.login_1, true), (fx.login_2, true), (fx.login_3, true)
) as u (id, customer);
insert into public.tenants (id, slug, name)
select tenant_t, 'bill-pgtap-21-t', 'Bill pgTAP T' from fx union all select tenant_u, 'bill-pgtap-21-u', 'Bill pgTAP U' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_t, tenant_t, 'mock', 'bill-21-t', 'Synthetic account T' from fx union all select account_u, tenant_u, 'mock', 'bill-21-u', 'Synthetic account U' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
select store_s1, tenant_t, account_t, 'b21-s1', 'b21-s1', 'Synthetic store S1' from fx
union all select store_s2, tenant_t, account_t, 'b21-s2', 'b21-s2', 'Synthetic store S2' from fx
union all select store_p, tenant_t, account_t, 'b21-p', 'b21-p', 'Synthetic store P' from fx
union all select store_b, tenant_u, account_u, 'b21-b', 'b21-b', 'Synthetic store B' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_t, owner_u, 'owner'::public.tenant_role, null::uuid[] from fx
union all select tenant_t, manager_u, 'manager', array[store_s1, store_p] from fx
union all select tenant_t, staff_1, 'staff', array[store_s1, store_p] from fx
union all select tenant_t, staff_2, 'staff', array[store_s1] from fx
union all select tenant_t, staff_s2, 'staff', array[store_s2] from fx
union all select tenant_t, viewer_u, 'viewer', null from fx
union all select tenant_u, owner_b, 'owner', null from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_t, tenant_t, 'brand-921', 'Synthetic brand', array[store_s1, store_s2, store_p] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_t, tenant_t, brand_t, 'synthetic-bill-app-21', 'ZALO_APP_SECRET_BRAND_921', 'active' from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status, welcome_stamps, stamp_min_bill_amount, point_unit_amount, points_per_unit)
select programme_t, tenant_t, 'Synthetic programme', date '2026-11-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status, 0, 50000, 10000, 1 from fx
union all
select programme_u, tenant_u, 'Synthetic programme U', date '2026-11-01', 'below_threshold', 'active', 0, 50000, 10000, 1 from fx;
update public.loyalty_store_settings
set confirmation = 'staff', bill_audit_sample_pct = 0, self_claim = true
where store_id in (select store_s1 from fx union all select store_s2 from fx);
update public.loyalty_store_settings set confirmation = 'staff', bill_audit_sample_pct = 0 where store_id = (select store_b from fx);

create temp table ids (name text primary key, id uuid);
insert into ids
select 'customer_' || n, app.loyalty_customer_for_phone(fx.tenant_t, '09000210' || lpad(n::text, 2, '0'), fx.t0 - interval '5 days')
from fx cross join generate_series(1, 6) n;
insert into ids
select 'member_' || n, app.loyalty_join(fx.tenant_t, (select id from ids where name = 'customer_' || n), 'mini_app', fx.store_s1, fx.brand_t, 'syn-bill-21-' || n, fx.t0 - interval '5 days')
from fx cross join generate_series(1, 6) n;
insert into ids select 'customer_b', app.loyalty_customer_for_phone(tenant_u, '0900021099', t0 - interval '5 days') from fx;
insert into ids select 'member_b', app.loyalty_join(tenant_u, (select id from ids where name = 'customer_b'), 'mini_app', store_b, null, null, t0 - interval '5 days') from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id, customer_id)
select fx.tenant_t, fx.app_t, 'syn-bill-21-' || n, l.id, (select id from ids where name = 'customer_' || n)
from fx cross join lateral (values (1, fx.login_1), (2, fx.login_2), (3, fx.login_3)) as l (n, id);

create function pg_temp.as_user(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.as_login(p_login uuid) returns void language sql security definer set search_path = '' as $$
  select set_config('request.jwt.claims', json_build_object(
    'sub', p_login, 'role', 'authenticated',
    'app_metadata', json_build_object('kind', 'customer', 'tenant_id', l.tenant_id, 'customer_id', l.customer_id)
  )::text, true)
  from app.customer_logins l where l.user_id = p_login;
$$;
create function pg_temp.id(p_name text) returns uuid language sql as $$ select id from ids where name = p_name $$;
create function pg_temp.code(p_member text, p_store uuid, p_at timestamptz) returns text language sql as $$
  select i.code from app.loyalty_issue_checkin_code(pg_temp.id(p_member), p_store, p_at) i;
$$;
-- Records a bill as a user: the answer, or {"error": SQLSTATE}; the bill id is kept under p_name.
create function pg_temp.submit(p_name text, p_user uuid, p_member text, p_store uuid, p_bill text, p_total numeric, p_at timestamptz)
returns jsonb language plpgsql as $$
declare
  v_code text := pg_temp.code(p_member, p_store, p_at - interval '10 seconds');
  v jsonb;
begin
  perform pg_temp.as_user(p_user);
  v := app.staff_submit_bill(p_store, v_code, p_bill, p_total, p_at);
  if v ->> 'bill_id' is not null and p_name is not null then
    insert into ids values (p_name, (v ->> 'bill_id')::uuid) on conflict (name) do update set id = excluded.id;
  end if;
  return v;
exception when others then
  return jsonb_build_object('error', sqlstate);
end;
$$;
create function pg_temp.try(p_sql text) returns text language plpgsql as $$
declare
  v text;
begin
  execute p_sql into v;
  return coalesce(v, 'null');
exception when others then
  return 'error:' || sqlstate;
end;
$$;
create function pg_temp.bill(p_name text) returns text language sql as $$
  select concat_ws(':', b.state, b.evidence_level, b.queue_reason, b.reversal_reason) from public.bill_captures b where b.id = pg_temp.id(p_name);
$$;
create function pg_temp.balance(p_member text) returns text language sql as $$
  select concat_ws('/', b.stamps, b.points, b.pending_stamps, b.pending_points) from app.loyalty_balance(pg_temp.id(p_member), null) b;
$$;


create temp table seq (n integer);
insert into seq values (0);
create function pg_temp.next() returns integer language sql as $$ update seq set n = n + 1 returning n $$;
create function pg_temp.member_for(p_role text) returns text language sql as $$
  select case p_role when 'owner' then 'member_1' when 'manager' then 'member_2' when 'staff' then 'member_3' when 'other_staff' then 'member_4' else 'member_5' end;
$$;
create function pg_temp.user_for(p_role text) returns uuid language sql as $$
  select case p_role when 'owner' then owner_u when 'manager' then manager_u when 'staff' then staff_1 when 'other_staff' then staff_s2 else viewer_u end from fx;
$$;

create function pg_temp.act(p_mode text, p_action text, p_role text) returns text language plpgsql as $$
declare
  v_store uuid := case p_mode when 'staff' then (select store_s1 from fx) else (select store_p from fx) end;
  v_at timestamptz := (select t0 from fx) + make_interval(mins => pg_temp.next());
  v_user uuid := pg_temp.user_for(p_role);
  v jsonb;
  v_code text;
begin
  if p_action = 'bill' then
    v := pg_temp.submit(null, v_user, pg_temp.member_for(p_role), v_store, 'DT-' || pg_temp.next(), 60000, v_at);
    return coalesce('error:' || (v ->> 'error'), v ->> 'refusal', v ->> 'state');
  end if;
  if p_action = 'checkin' then
    v_code := pg_temp.code(case p_role when 'owner' then 'member_4' when 'manager' then 'member_5' else 'member_6' end, v_store, v_at - interval '10 seconds');
    perform pg_temp.as_user(v_user);
    v := app.staff_record_checkin(v_store, null, v_code, null, v_at);
    return coalesce(v ->> 'refusal', v ->> 'state');
  end if;
  perform pg_temp.as_user(v_user);
  if p_action = 'counter_code' then
    v := app.staff_counter_code(v_store, v_at);
    return coalesce(v ->> 'refusal', v ->> 'state');
  elsif p_action = 'recent' then
    return app.staff_recent_bills(v_store, v_at) ->> 'mode';
  elsif p_action = 'queue' then
    return jsonb_typeof(app.staff_bill_queue(v_store, v_at) -> 'bills');
  end if;
  raise exception 'unknown action %', p_action;
exception when others then
  return 'error:' || sqlstate;
end;
$$;

create temp table cases (mode text, action text, role text, expected text);
insert into cases values
  ('staff', 'bill', 'owner', 'awaiting_customer'),
  ('staff', 'bill', 'manager', 'awaiting_customer'),
  ('staff', 'bill', 'staff', 'awaiting_customer'),
  ('staff', 'bill', 'other_staff', 'error:42501'),
  ('staff', 'bill', 'viewer', 'error:42501'),
  ('pos_sync', 'bill', 'owner', 'not_staff_mode'),
  ('pos_sync', 'bill', 'manager', 'not_staff_mode'),
  ('pos_sync', 'bill', 'staff', 'not_staff_mode'),
  ('pos_sync', 'bill', 'other_staff', 'error:42501'),
  ('pos_sync', 'bill', 'viewer', 'error:42501'),
  ('staff', 'checkin', 'owner', 'staff_mode'),
  ('staff', 'checkin', 'manager', 'staff_mode'),
  ('staff', 'checkin', 'staff', 'staff_mode'),
  ('staff', 'checkin', 'other_staff', 'error:42501'),
  ('pos_sync', 'checkin', 'owner', 'pending'),
  ('pos_sync', 'checkin', 'manager', 'pending'),
  ('pos_sync', 'checkin', 'staff', 'pending'),
  ('pos_sync', 'checkin', 'other_staff', 'error:42501'),
  ('staff', 'counter_code', 'owner', 'ready'),
  ('staff', 'counter_code', 'staff', 'ready'),
  ('staff', 'counter_code', 'other_staff', 'error:42501'),
  ('staff', 'counter_code', 'viewer', 'error:42501'),
  ('pos_sync', 'counter_code', 'owner', 'not_available'),
  ('pos_sync', 'counter_code', 'staff', 'not_available'),
  ('staff', 'recent', 'owner', 'staff'),
  ('staff', 'recent', 'staff', 'staff'),
  ('staff', 'recent', 'other_staff', 'error:42501'),
  ('pos_sync', 'recent', 'manager', 'pos_sync'),
  ('staff', 'queue', 'owner', 'array'),
  ('staff', 'queue', 'manager', 'array'),
  ('staff', 'queue', 'staff', 'error:42501'),
  ('staff', 'queue', 'viewer', 'error:42501');

select is(pg_temp.act(mode, action, role), expected, format('%s store, %s, %s', mode, action, role))
from cases order by action, mode, role;

-- The customer's paths: C at a pos_sync store, the counter QR at a staff store, never the other way round.
select pg_temp.as_login((select login_1 from fx));
select is(app.customer_submit_claim('b21-s1', 'DT-C1', 60000, null, (select t0 from fx) + interval '2 hours') ->> 'reason', 'staff_mode',
  'staff store: a path C receipt claim is answered staff_mode and stored nowhere');
select is((select count(*)::integer from public.receipt_claims where store_id = (select store_s1 from fx)), 0, 'no receipt claim row at the staff store');
select is(app.customer_submit_claim('b21-p', 'DT-C2', 60000, null, (select t0 from fx) + interval '2 hours') ->> 'state', 'pending',
  'pos_sync store: the receipt claim waits for the invoice as before');
select pg_temp.as_user((select staff_1 from fx));
create temp table qr as select app.staff_counter_code((select store_s1 from fx), (select t0 from fx) + interval '3 hours') ->> 'qr_payload' as payload;
select pg_temp.as_login((select login_1 from fx));
select is(app.customer_submit_counter_claim((select payload from qr), 'DT-C3', 60000, (select t0 from fx) + interval '3 hours 10 seconds') ->> 'state', 'awaiting_staff',
  'staff store with self claims: the counter claim waits for staff');
update public.loyalty_store_settings set self_claim = false where store_id = (select store_s1 from fx);
select pg_temp.as_login((select login_2 from fx));
select is(app.customer_submit_counter_claim((select payload from qr), 'DT-C4', 60000, (select t0 from fx) + interval '3 hours 20 seconds') ->> 'refusal', 'not_available',
  'self claims turned off: not_available');

-- The POS path A at a staff store refuses staff_mode; at a pos_sync store it earns.
insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, gross_amount, net_amount, paid_amount, customer_phone)
select tenant_t, s.store, account_t, 'dt-inv-' || s.n, 'DT-INV-' || s.n, t0, date '2026-11-10', 60000, 60000, 60000, '0900021006'
from fx cross join lateral (values (1, fx.store_s1), (2, fx.store_p)) as s (n, store);
select is((select e.refusal from app.loyalty_earn((select id from public.invoices where external_id = 'dt-inv-1'), pg_temp.id('member_6'), 'A', (select t0 from fx)) e),
  'staff_mode', 'path A at a staff store: refused staff_mode');
select is((select e.refusal is null and e.entry_id is not null from app.loyalty_earn((select id from public.invoices where external_id = 'dt-inv-2'), pg_temp.id('member_6'), 'A', (select t0 from fx)) e),
  true, 'path A at a pos_sync store: earned as before');
select is((select reason from public.loyalty_refusals where invoice_id = (select id from public.invoices where external_id = 'dt-inv-1')), 'staff_mode',
  'the refusal is kept for the shift anomaly report');

select * from finish();
rollback;
