-- ISTQB boundary value analysis and equivalence partitioning of a bill at a store in staff mode: the total (0, below a
-- point, one point, just below and at the stamp minimum, the maximum bill and just above, the RPC maximum), the
-- agreement tolerance (at and just above), the dedupe key (leading zeros, the same total, a total off by the tolerance
-- and by one more), the per-staff cap of unreviewed bills (cap - 1, cap, cap + 1, and the 70 % warning), the staff
-- amount cap, the store cap, the member's daily earns, the counter QR life (at the end of its grace, just after,
-- before its issue) and the reversal window (exactly at its end).
begin;
select plan(36);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

-- Fixture: tenant T with stores S1 and S2 in staff mode and P in pos_sync mode, tenant U with store B.
create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000022301'::uuid as tenant_t,
  'dddddddd-dddd-4ddd-8ddd-000000022302'::uuid as tenant_u,
  'cccccccc-cccc-4ccc-8ccc-000000022301'::uuid as account_t,
  'cccccccc-cccc-4ccc-8ccc-000000022302'::uuid as account_u,
  'ffffffff-ffff-4fff-8fff-000000022301'::uuid as store_s1,
  'ffffffff-ffff-4fff-8fff-000000022302'::uuid as store_s2,
  'ffffffff-ffff-4fff-8fff-000000022303'::uuid as store_p,
  'ffffffff-ffff-4fff-8fff-000000022304'::uuid as store_b,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000022301'::uuid as brand_t,
  '99999999-9999-4999-8999-000000022301'::uuid as app_t,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000022301'::uuid as programme_t,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000022302'::uuid as programme_u,
  'eeeeeeee-eeee-4eee-8eee-000000022301'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000022302'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000022303'::uuid as staff_1,
  'eeeeeeee-eeee-4eee-8eee-000000022304'::uuid as staff_2,
  'eeeeeeee-eeee-4eee-8eee-000000022305'::uuid as staff_s2,
  'eeeeeeee-eeee-4eee-8eee-000000022306'::uuid as owner_b,
  'eeeeeeee-eeee-4eee-8eee-000000022307'::uuid as viewer_u,
  'eeeeeeee-eeee-4eee-8eee-000000022311'::uuid as login_1,
  'eeeeeeee-eeee-4eee-8eee-000000022312'::uuid as login_2,
  'eeeeeeee-eeee-4eee-8eee-000000022313'::uuid as login_3,
  timestamptz '2026-11-10 10:00+07' as t0;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'bill-23-' || right(u.id::text, 4) || '@example.com',
  case when u.customer then jsonb_build_object('kind', 'customer', 'tenant_id', fx.tenant_t, 'customer_id', null) else '{}'::jsonb end
from fx cross join lateral (values
  (fx.owner_u, false), (fx.manager_u, false), (fx.staff_1, false), (fx.staff_2, false), (fx.staff_s2, false), (fx.owner_b, false), (fx.viewer_u, false),
  (fx.login_1, true), (fx.login_2, true), (fx.login_3, true)
) as u (id, customer);
insert into public.tenants (id, slug, name)
select tenant_t, 'bill-pgtap-23-t', 'Bill pgTAP T' from fx union all select tenant_u, 'bill-pgtap-23-u', 'Bill pgTAP U' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_t, tenant_t, 'mock', 'bill-23-t', 'Synthetic account T' from fx union all select account_u, tenant_u, 'mock', 'bill-23-u', 'Synthetic account U' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
select store_s1, tenant_t, account_t, 'b23-s1', 'b23-s1', 'Synthetic store S1' from fx
union all select store_s2, tenant_t, account_t, 'b23-s2', 'b23-s2', 'Synthetic store S2' from fx
union all select store_p, tenant_t, account_t, 'b23-p', 'b23-p', 'Synthetic store P' from fx
union all select store_b, tenant_u, account_u, 'b23-b', 'b23-b', 'Synthetic store B' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_t, owner_u, 'owner'::public.tenant_role, null::uuid[] from fx
union all select tenant_t, manager_u, 'manager', array[store_s1, store_p] from fx
union all select tenant_t, staff_1, 'staff', array[store_s1, store_p] from fx
union all select tenant_t, staff_2, 'staff', array[store_s1] from fx
union all select tenant_t, staff_s2, 'staff', array[store_s2] from fx
union all select tenant_t, viewer_u, 'viewer', null from fx
union all select tenant_u, owner_b, 'owner', null from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_t, tenant_t, 'brand-923', 'Synthetic brand', array[store_s1, store_s2, store_p] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_t, tenant_t, brand_t, 'synthetic-bill-app-23', 'ZALO_APP_SECRET_BRAND_923', 'active' from fx;
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
select 'customer_' || n, app.loyalty_customer_for_phone(fx.tenant_t, '09000230' || lpad(n::text, 2, '0'), fx.t0 - interval '5 days')
from fx cross join generate_series(1, 6) n;
insert into ids
select 'member_' || n, app.loyalty_join(fx.tenant_t, (select id from ids where name = 'customer_' || n), 'mini_app', fx.store_s1, fx.brand_t, 'syn-bill-23-' || n, fx.t0 - interval '5 days')
from fx cross join generate_series(1, 6) n;
insert into ids select 'customer_b', app.loyalty_customer_for_phone(tenant_u, '0900023099', t0 - interval '5 days') from fx;
insert into ids select 'member_b', app.loyalty_join(tenant_u, (select id from ids where name = 'customer_b'), 'mini_app', store_b, null, null, t0 - interval '5 days') from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id, customer_id)
select fx.tenant_t, fx.app_t, 'syn-bill-23-' || n, l.id, (select id from ids where name = 'customer_' || n)
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


create function pg_temp.r(p_answer jsonb) returns text language sql as $$
  select coalesce('error:' || (p_answer ->> 'error'), p_answer ->> 'refusal', p_answer ->> 'state');
$$;

-- Totals at S1 (member_1 for refusals only; refusals write nothing)
select is(pg_temp.r(pg_temp.submit(null, (select staff_1 from fx), 'member_1', (select store_s1 from fx), 'T-1', 0, (select t0 from fx))), 'error:22023', 'a total of 0 is malformed');
select is(pg_temp.r(pg_temp.submit(null, (select staff_1 from fx), 'member_1', (select store_s1 from fx), 'T-2', -1, (select t0 from fx))), 'error:22023', 'a negative total is malformed');
select is(pg_temp.r(pg_temp.submit(null, (select staff_1 from fx), 'member_1', (select store_s1 from fx), 'T-3', 100000000.01, (select t0 from fx))), 'error:22023', 'above 100,000,000 is malformed');
select is(pg_temp.r(pg_temp.submit(null, (select staff_1 from fx), 'member_1', (select store_s1 from fx), 'T-4', 9999, (select t0 from fx))), 'below_minimum', '9,999 earns neither a stamp nor a point');
select is(pg_temp.r(pg_temp.submit(null, (select staff_1 from fx), 'member_1', (select store_s1 from fx), 'T-5', 2000000.01, (select t0 from fx))), 'over_bill_limit', 'just above max_bill_amount (2,000,000) is refused');
select is(pg_temp.r(pg_temp.submit(null, (select staff_1 from fx), 'member_1', (select store_s1 from fx), 'with space', 60000, (select t0 from fx))), 'error:22023', 'a bill number with a space is malformed');
select is(pg_temp.r(pg_temp.submit(null, (select staff_1 from fx), 'member_1', (select store_s1 from fx), repeat('9', 41), 60000, (select t0 from fx))), 'error:22023', 'a bill number of 41 characters is malformed');
select is((select count(*)::integer from public.bill_captures where store_id = (select store_s1 from fx)), 0, 'no refused bill was stored');
select is(pg_temp.r(pg_temp.submit('t10000', (select staff_1 from fx), 'member_1', (select store_s1 from fx), 'T-6', 10000, (select t0 from fx))), 'awaiting_customer', '10,000 earns one point');
select is((select stamp_delta || '/' || point_delta from public.loyalty_ledger where bill_id = pg_temp.id('t10000')), '0/1', 'one point, no stamp');
select is(pg_temp.r(pg_temp.submit('t49999', (select staff_1 from fx), 'member_2', (select store_s1 from fx), 'T-7', 49999, (select t0 from fx))), 'awaiting_customer', '49,999 is recorded');
select is((select stamp_delta || '/' || point_delta from public.loyalty_ledger where bill_id = pg_temp.id('t49999')), '0/4', 'just below the stamp minimum: four points, no stamp');
select is(pg_temp.r(pg_temp.submit('t50000', (select staff_1 from fx), 'member_2', (select store_s1 from fx), 'T-8', 50000, (select t0 from fx))), 'awaiting_customer', '50,000 is recorded');
select is((select stamp_delta || '/' || point_delta from public.loyalty_ledger where bill_id = pg_temp.id('t50000')), '1/5', 'at the stamp minimum: a stamp and five points');
select is(pg_temp.r(pg_temp.submit(null, (select staff_1 from fx), 'member_2', (select store_s1 from fx), 'T-9', 2000000, (select t0 from fx))), 'queued', 'exactly max_bill_amount is accepted, and waits for a manager above 1,000,000');

-- Tolerance (1,000)
select pg_temp.as_login((select login_1 from fx));
select is(app.customer_confirm_bill(pg_temp.id('t10000'), 11000, (select t0 from fx) + interval '1 minute') ->> 'state', 'confirmed', 'a blind total exactly 1,000 off agrees');
select pg_temp.as_login((select login_2 from fx));
select is(app.customer_confirm_bill(pg_temp.id('t49999'), 51000, (select t0 from fx) + interval '1 minute') ->> 'state', 'queued', '1,001 off disagrees');

-- Dedupe key: store + business date + bill number without leading zeros
select is(pg_temp.r(pg_temp.submit('k1', (select staff_2 from fx), 'member_3', (select store_s1 from fx), '000777', 60000, (select t0 from fx))), 'awaiting_customer', 'bill 000777 is recorded');
select is(pg_temp.r(pg_temp.submit(null, (select staff_2 from fx), 'member_4', (select store_s1 from fx), '777', 60000, (select t0 from fx))), 'bill_used', 'the same bill as 777 with the same total: bill_used');
select is(pg_temp.r(pg_temp.submit(null, (select staff_2 from fx), 'member_4', (select store_s1 from fx), '0777', 61000, (select t0 from fx))), 'bill_used', 'a total 1,000 off is the same reading: bill_used');
select is(pg_temp.r(pg_temp.submit(null, (select staff_2 from fx), 'member_4', (select store_s1 from fx), '777', 61001, (select t0 from fx))), 'bill_conflict', 'a total 1,001 off is a conflict');
select is((select severity::text from public.alert_events where tenant_id = (select tenant_t from fx) and facts ->> 'kind' = 'bill_conflict'), 'critical', 'a conflict raises a critical alert');
select is(pg_temp.r(pg_temp.submit(null, (select staff_2 from fx), 'member_4', (select store_s2 from fx), '777', 60000, (select t0 from fx))), 'error:42501', 'staff of S1 cannot record at S2');
select is(pg_temp.r(pg_temp.submit(null, (select staff_s2 from fx), 'member_4', (select store_s2 from fx), '777', 60000, (select t0 from fx))), 'awaiting_customer', 'the same number at another store is another bill');
select is(pg_temp.r(pg_temp.submit(null, (select staff_2 from fx), 'member_4', (select store_s1 from fx), '777', 60000, (select t0 from fx) + interval '1 day')), 'awaiting_customer', 'and on another business day too');

-- Staff caps at S2: three unreviewed bills, the warning at 70 % (the third), then the cap
update public.loyalty_store_settings set bill_staff_shift_cap = 3 where store_id = (select store_s2 from fx);
select is(pg_temp.r(pg_temp.submit(null, (select staff_s2 from fx), 'member_5', (select store_s2 from fx), 'S-2', 60000, (select t0 from fx))), 'awaiting_customer', 'cap - 1: the second unreviewed bill');
select ok(not exists (select 1 from public.alert_events where tenant_id = (select tenant_t from fx) and facts ->> 'kind' = 'cap_warning'), 'no warning below 70 %');
select is(pg_temp.r(pg_temp.submit(null, (select staff_s2 from fx), 'member_6', (select store_s2 from fx), 'S-3', 60000, (select t0 from fx))), 'awaiting_customer', 'cap: the third');
select ok(exists (select 1 from public.alert_events where tenant_id = (select tenant_t from fx) and facts ->> 'kind' = 'cap_warning'), 'the warning fires at 70 % of the cap');
select is(pg_temp.r(pg_temp.submit(null, (select staff_s2 from fx), 'member_6', (select store_s2 from fx), 'S-4', 60000, (select t0 from fx))), 'staff_shift_cap', 'cap + 1 is refused');

-- Staff amount cap at S1 for staff_1 (bills of 10,000 and 49,999 and 50,000 and 2,000,000 so far = 2,109,999)
update public.loyalty_store_settings set staff_amount_per_day = 2169999 where store_id = (select store_s1 from fx);
select is(pg_temp.r(pg_temp.submit(null, (select staff_1 from fx), 'member_3', (select store_s1 from fx), 'A-1', 60000, (select t0 from fx))), 'awaiting_customer', 'exactly the amount cap is allowed');
select is(pg_temp.r(pg_temp.submit(null, (select staff_1 from fx), 'member_3', (select store_s1 from fx), 'A-2', 10000, (select t0 from fx))), 'staff_amount_cap', 'one bill more is refused');

-- Member's daily earns (3): member_3 holds two (k1 and A-1)
select is(pg_temp.r(pg_temp.submit(null, (select staff_2 from fx), 'member_3', (select store_s1 from fx), 'M-1', 60000, (select t0 from fx))), 'awaiting_customer', 'the third earn of the day');
select is(pg_temp.r(pg_temp.submit(null, (select staff_2 from fx), 'member_3', (select store_s1 from fx), 'M-2', 60000, (select t0 from fx))), 'daily_limit', 'the fourth is refused');

-- Counter QR life: issued at t, 90 s, plus 120 s of grace
select pg_temp.as_user((select staff_1 from fx));
create temp table qr as select app.staff_counter_code((select store_s1 from fx), (select t0 from fx) + interval '5 hours') ->> 'qr_payload' as payload;
select pg_temp.as_login((select login_1 from fx));
select is(app.customer_submit_counter_claim((select payload from qr), 'Q-1', 60000, (select t0 from fx) + interval '5 hours 210 seconds') ->> 'state', 'awaiting_staff',
  'exactly at the end of the grace the claim is accepted');
select pg_temp.as_login((select login_2 from fx));
select is(app.customer_submit_counter_claim((select payload from qr), 'Q-2', 60000, (select t0 from fx) + interval '5 hours 210.001 seconds') ->> 'refusal', 'code_expired',
  'a millisecond later it is stale');

select * from finish();
rollback;
