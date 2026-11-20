-- Security tests of the staff confirmation mode (OWASP ASVS V4 access control, API1/API5, replay, enumeration,
-- privacy): row level security per role and session kind, a customer can neither write the tables nor confirm a
-- bill of another member nor answer their own counter claim as staff, staff of one store or tenant cannot act in
-- another, replayed member codes and counter QRs are refused, guessing is locked out, a manager cannot approve
-- their own bill, staff phones never earn, and no answer or audit row carries a phone or the staff total for the
-- customer.
begin;
select plan(30);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

-- Fixture: tenant T with stores S1 and S2 in staff mode and P in pos_sync mode, tenant U with store B.
create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000022401'::uuid as tenant_t,
  'dddddddd-dddd-4ddd-8ddd-000000022402'::uuid as tenant_u,
  'cccccccc-cccc-4ccc-8ccc-000000022401'::uuid as account_t,
  'cccccccc-cccc-4ccc-8ccc-000000022402'::uuid as account_u,
  'ffffffff-ffff-4fff-8fff-000000022401'::uuid as store_s1,
  'ffffffff-ffff-4fff-8fff-000000022402'::uuid as store_s2,
  'ffffffff-ffff-4fff-8fff-000000022403'::uuid as store_p,
  'ffffffff-ffff-4fff-8fff-000000022404'::uuid as store_b,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000022401'::uuid as brand_t,
  '99999999-9999-4999-8999-000000022401'::uuid as app_t,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000022401'::uuid as programme_t,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000022402'::uuid as programme_u,
  'eeeeeeee-eeee-4eee-8eee-000000022401'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000022402'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000022403'::uuid as staff_1,
  'eeeeeeee-eeee-4eee-8eee-000000022404'::uuid as staff_2,
  'eeeeeeee-eeee-4eee-8eee-000000022405'::uuid as staff_s2,
  'eeeeeeee-eeee-4eee-8eee-000000022406'::uuid as owner_b,
  'eeeeeeee-eeee-4eee-8eee-000000022407'::uuid as viewer_u,
  'eeeeeeee-eeee-4eee-8eee-000000022411'::uuid as login_1,
  'eeeeeeee-eeee-4eee-8eee-000000022412'::uuid as login_2,
  'eeeeeeee-eeee-4eee-8eee-000000022413'::uuid as login_3,
  timestamptz '2026-11-10 10:00+07' as t0;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'bill-24-' || right(u.id::text, 4) || '@example.com',
  case when u.customer then jsonb_build_object('kind', 'customer', 'tenant_id', fx.tenant_t, 'customer_id', null) else '{}'::jsonb end
from fx cross join lateral (values
  (fx.owner_u, false), (fx.manager_u, false), (fx.staff_1, false), (fx.staff_2, false), (fx.staff_s2, false), (fx.owner_b, false), (fx.viewer_u, false),
  (fx.login_1, true), (fx.login_2, true), (fx.login_3, true)
) as u (id, customer);
insert into public.tenants (id, slug, name)
select tenant_t, 'bill-pgtap-24-t', 'Bill pgTAP T' from fx union all select tenant_u, 'bill-pgtap-24-u', 'Bill pgTAP U' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_t, tenant_t, 'mock', 'bill-24-t', 'Synthetic account T' from fx union all select account_u, tenant_u, 'mock', 'bill-24-u', 'Synthetic account U' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
select store_s1, tenant_t, account_t, 'b24-s1', 'b24-s1', 'Synthetic store S1' from fx
union all select store_s2, tenant_t, account_t, 'b24-s2', 'b24-s2', 'Synthetic store S2' from fx
union all select store_p, tenant_t, account_t, 'b24-p', 'b24-p', 'Synthetic store P' from fx
union all select store_b, tenant_u, account_u, 'b24-b', 'b24-b', 'Synthetic store B' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_t, owner_u, 'owner'::public.tenant_role, null::uuid[] from fx
union all select tenant_t, manager_u, 'manager', array[store_s1, store_p] from fx
union all select tenant_t, staff_1, 'staff', array[store_s1, store_p] from fx
union all select tenant_t, staff_2, 'staff', array[store_s1] from fx
union all select tenant_t, staff_s2, 'staff', array[store_s2] from fx
union all select tenant_t, viewer_u, 'viewer', null from fx
union all select tenant_u, owner_b, 'owner', null from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_t, tenant_t, 'brand-924', 'Synthetic brand', array[store_s1, store_s2, store_p] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_t, tenant_t, brand_t, 'synthetic-bill-app-24', 'ZALO_APP_SECRET_BRAND_924', 'active' from fx;
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
select 'customer_' || n, app.loyalty_customer_for_phone(fx.tenant_t, '09000240' || lpad(n::text, 2, '0'), fx.t0 - interval '5 days')
from fx cross join generate_series(1, 6) n;
insert into ids
select 'member_' || n, app.loyalty_join(fx.tenant_t, (select id from ids where name = 'customer_' || n), 'mini_app', fx.store_s1, fx.brand_t, 'syn-bill-24-' || n, fx.t0 - interval '5 days')
from fx cross join generate_series(1, 6) n;
insert into ids select 'customer_b', app.loyalty_customer_for_phone(tenant_u, '0900024099', t0 - interval '5 days') from fx;
insert into ids select 'member_b', app.loyalty_join(tenant_u, (select id from ids where name = 'customer_b'), 'mini_app', store_b, null, null, t0 - interval '5 days') from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id, customer_id)
select fx.tenant_t, fx.app_t, 'syn-bill-24-' || n, l.id, (select id from ids where name = 'customer_' || n)
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

grant select on fx, ids to authenticated;
select is(pg_temp.r(pg_temp.submit('b1', (select staff_1 from fx), 'member_1', (select store_s1 from fx), 'SEC-1', 60000, (select t0 from fx))), 'awaiting_customer', 'a bill of member 1');

-- Direct writes are closed to every API role
select pg_temp.as_login((select login_1 from fx));
set local role authenticated;
select throws_ok(format($q$ insert into public.bill_confirmations (tenant_id, bill_id, source, entered_total, agrees) values (%L, %L, 'customer', 60000, true) $q$,
  (select tenant_t from fx), pg_temp.id('b1')), '42501', null, 'a customer cannot insert a reading');
select throws_ok(format($q$ update public.bill_captures set state = 'confirmed' where id = %L $q$, pg_temp.id('b1')), '42501', null, 'a customer cannot update a bill');
select is((select count(*)::integer from public.bill_captures), 0, 'a customer reads no bill row directly (only through the RPCs)');
reset role;
select pg_temp.as_user((select staff_1 from fx));
set local role authenticated;
select throws_ok(format($q$ update public.bill_captures set total = 1 where id = %L $q$, pg_temp.id('b1')), '42501', null, 'a staff member cannot update a bill');
select throws_ok($q$ select count(*) from public.loyalty_counter_codes $q$, '42501', null, 'nobody reads the counter tokens');
select is((select count(*)::integer from public.bill_captures), 1, 'the recording staff member reads their own bill');
reset role;
select pg_temp.as_user((select staff_2 from fx));
set local role authenticated;
select is((select count(*)::integer from public.bill_captures), 0, 'another staff member of the store does not read it');
reset role;
select pg_temp.as_user((select owner_b from fx));
set local role authenticated;
select is((select count(*)::integer from public.bill_captures) + (select count(*)::integer from public.loyalty_audit_events), 0, 'an owner of another tenant reads nothing');
reset role;
select pg_temp.as_user((select manager_u from fx));
set local role authenticated;
select is((select count(*)::integer from public.bill_captures), 1, 'the store''s manager reads it');
select ok((select count(*) from public.loyalty_audit_events) >= 1, 'and its audit trail');
reset role;

-- A customer cannot confirm another member's bill, nor confirm their counter claim as staff
select pg_temp.as_login((select login_2 from fx));
select is(app.customer_confirm_bill(pg_temp.id('b1'), 60000, (select t0 from fx) + interval '1 minute') ->> 'refusal', 'unknown_bill', 'another member''s bill reads unknown_bill');
select is(app.customer_dispute_bill(pg_temp.id('b1'), (select t0 from fx) + interval '1 minute') ->> 'refusal', 'unknown_bill', 'and cannot be disputed');
select is(pg_temp.bill('b1'), 'awaiting_customer:0', 'the bill is unchanged');
select pg_temp.as_user((select staff_1 from fx));
create temp table qr as select app.staff_counter_code((select store_s1 from fx), (select t0 from fx) + interval '1 hour') ->> 'qr_payload' as payload;
select pg_temp.as_login((select login_2 from fx));
select is(app.customer_submit_counter_claim((select payload from qr), 'SEC-C1', 60000, (select t0 from fx) + interval '1 hour 5 seconds') ->> 'state', 'awaiting_staff', 'a counter claim of member 2');
insert into ids select 'c1', id from public.bill_captures where bill_no = 'SEC-C1';
select is(pg_temp.try(format('select app.staff_answer_counter_claim(%L, 60000, null) ->> ''state''', pg_temp.id('c1'))), 'error:42501', 'the customer cannot answer it as staff');
select is(pg_temp.try(format('select app.staff_submit_bill(%L, ''123456'', ''X'', 60000) ->> ''state''', (select store_s1 from fx))), 'error:42501', 'nor record a bill');

-- Replays
select is(app.customer_submit_counter_claim((select payload from qr), 'SEC-C2', 60000, (select t0 from fx) + interval '1 hour 10 seconds') ->> 'refusal', 'code_used',
  'the same member replaying the counter QR is refused');
select is(app.customer_submit_counter_claim(replace((select payload from qr), 'b24-s1', 'b24-s2'), 'SEC-C3', 60000, (select t0 from fx) + interval '1 hour 10 seconds') ->> 'refusal', 'wrong_store',
  'the token under another store''s code is refused');
create function pg_temp.member_code_twice() returns text language plpgsql as $$
declare
  v_code text := pg_temp.code('member_2', (select store_s1 from fx), (select t0 from fx) + interval '2 hours');
begin
  perform pg_temp.as_user((select staff_1 from fx));
  perform app.staff_submit_bill((select store_s1 from fx), v_code, 'SEC-2', 60000, (select t0 from fx) + interval '2 hours 10 seconds');
  return app.staff_submit_bill((select store_s1 from fx), v_code, 'SEC-3', 60000, (select t0 from fx) + interval '2 hours 20 seconds') ->> 'refusal';
end;
$$;
select is(pg_temp.member_code_twice(), 'code_used', 'a member code that recorded a bill cannot record another');

-- Guessing: five unknown member codes lock the staff member; five unknown counter tokens lock the customer
create function pg_temp.guess_member_codes() returns text language plpgsql as $$
declare
  v text;
begin
  perform pg_temp.as_user((select staff_2 from fx));
  for i in 1..6 loop
    v := app.staff_submit_bill((select store_s1 from fx), lpad((900000 + i)::text, 6, '0'), 'G-' || i, 60000, (select t0 from fx) + interval '3 hours' + make_interval(secs => i)) ->> 'refusal';
  end loop;
  return v;
end;
$$;
select is(pg_temp.guess_member_codes(), 'locked', 'the sixth guess of a member code is locked out');
create function pg_temp.guess_tokens() returns text language plpgsql as $$
declare
  v text;
begin
  perform pg_temp.as_login((select login_3 from fx));
  for i in 1..6 loop
    v := app.customer_submit_counter_claim('fnb-counter:1:b24-s1:' || repeat(chr(65 + i), 12), 'G-C' || i, 60000, (select t0 from fx) + interval '3 hours' + make_interval(secs => i)) ->> 'refusal';
  end loop;
  return v;
end;
$$;
select is(pg_temp.guess_tokens(), 'locked', 'the sixth guess of a counter token is locked out');

-- Staff of one store or tenant cannot act in another
select is(pg_temp.r(pg_temp.submit(null, (select staff_1 from fx), 'member_b', (select store_b from fx), 'SEC-B', 60000, (select t0 from fx))), 'error:42501', 'staff of tenant T cannot record in tenant U');
select pg_temp.as_user((select owner_b from fx));
select is(pg_temp.try(format('select app.staff_reverse_bill(%L, ''x'') ->> ''state''', pg_temp.id('b1'))), 'error:42501', 'an owner of tenant U cannot reverse a bill of T');

-- A manager cannot approve their own queued bill; the owner can
update public.loyalty_store_settings set bill_manager_approval_above = 100000 where store_id = (select store_s1 from fx);
select is(pg_temp.r(pg_temp.submit('own', (select manager_u from fx), 'member_3', (select store_s1 from fx), 'SEC-4', 150000, (select t0 from fx))), 'queued', 'the manager records a large bill');
select pg_temp.as_user((select manager_u from fx));
select is(app.staff_decide_bill(pg_temp.id('own'), 'approved', 'mine', (select t0 from fx) + interval '1 minute') ->> 'refusal', 'own_bill', 'and cannot approve it');
select pg_temp.as_user((select owner_u from fx));
select is(app.staff_decide_bill(pg_temp.id('own'), 'approved', 'checked', (select t0 from fx) + interval '2 minutes') ->> 'bill_state', 'confirmed', 'the owner can');

-- Staff phones never earn
insert into public.loyalty_staff_phones (tenant_id, phone) select tenant_t, '0900024006' from fx;
select is(pg_temp.r(pg_temp.submit(null, (select staff_1 from fx), 'member_6', (select store_s1 from fx), 'SEC-5', 60000, (select t0 from fx))), 'staff_phone', 'a staff phone is refused');

-- Privacy: no phone in answers or audit rows, no staff total for the customer
select ok(
  (select bool_and(position('0900024' in x) = 0 and position('84900024' in x) = 0) from (
    select pg_temp.submit(null, (select staff_2 from fx), 'member_4', (select store_s1 from fx), 'SEC-6', 70000, (select t0 from fx) + interval '4 hours')::text as x
    union all select (select app.staff_recent_bills((select store_s1 from fx), (select t0 from fx) + interval '4 hours')::text)
    union all select (select string_agg(details::text, ' ') from public.loyalty_audit_events where tenant_id = (select tenant_t from fx))
  ) a),
  'the staff answers, the bill list and the audit details carry no phone number'
);
select pg_temp.as_login((select login_1 from fx));
select ok(
  (select position('60000' in app.customer_pending_bills((select t0 from fx) + interval '5 minutes')::text) = 0
     and not (app.customer_pending_bills((select t0 from fx) + interval '5 minutes') -> 0 ? 'total')),
  'the customer''s list of bills to confirm never shows the staff total'
);

select * from finish();
rollback;
