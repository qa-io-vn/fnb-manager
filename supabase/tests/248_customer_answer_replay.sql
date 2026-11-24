-- G-92. ISTQB techniques: a decision table for a customer's answer sent a second time (blind total, dispute, counter
-- claim; same or different input; after the first outcome changed; an answer from before the migration; another
-- member's bill), state transitions of the bill across the replay (nothing is written twice), boundary values of the
-- wallet's counter claims (the 7-day window at exactly 7 days and one second inside it, the limit of 20, the QR's grace
-- passed) and a privilege check. Synthetic tenant, phones and logins only.
begin;
select plan(33);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000024801'::uuid as tenant_t,
  'cccccccc-cccc-4ccc-8ccc-000000024801'::uuid as account_t,
  'ffffffff-ffff-4fff-8fff-000000024801'::uuid as store_s1,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000024801'::uuid as brand_t,
  '99999999-9999-4999-8999-000000024801'::uuid as app_t,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000024801'::uuid as programme_t,
  'eeeeeeee-eeee-4eee-8eee-000000024801'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000024802'::uuid as staff_1,
  'eeeeeeee-eeee-4eee-8eee-000000024811'::uuid as login_1,
  'eeeeeeee-eeee-4eee-8eee-000000024812'::uuid as login_2,
  'eeeeeeee-eeee-4eee-8eee-000000024813'::uuid as login_3,
  timestamptz '2026-11-10 10:00+07' as t0;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'replay-248-' || right(u.id::text, 4) || '@example.com',
  case when u.customer then jsonb_build_object('kind', 'customer', 'tenant_id', fx.tenant_t, 'customer_id', null) else '{}'::jsonb end
from fx cross join lateral (values (fx.manager_u, false), (fx.staff_1, false), (fx.login_1, true), (fx.login_2, true), (fx.login_3, true)) as u (id, customer);
insert into public.tenants (id, slug, name) select tenant_t, 'replay-pgtap-248', 'Replay pgTAP' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) select account_t, tenant_t, 'mock', 'replay-248', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name) select store_s1, tenant_t, account_t, 'r248-s1', 'r248-s1', 'Synthetic store S1' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_t, manager_u, 'manager'::public.tenant_role, array[store_s1] from fx
union all select tenant_t, staff_1, 'staff', array[store_s1] from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids) select brand_t, tenant_t, 'brand-948', 'Synthetic brand', array[store_s1] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_t, tenant_t, brand_t, 'synthetic-replay-app-248', 'ZALO_APP_SECRET_BRAND_948', 'active' from fx;
insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status, welcome_stamps, stamp_min_bill_amount, point_unit_amount, points_per_unit)
select programme_t, tenant_t, 'Synthetic programme', date '2026-11-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status, 0, 50000, 10000, 1 from fx;
update public.loyalty_store_settings set confirmation = 'staff', bill_audit_sample_pct = 0, self_claim = true where store_id = (select store_s1 from fx);

create temp table ids (name text primary key, id uuid);
insert into ids
select 'customer_' || n, app.loyalty_customer_for_phone(fx.tenant_t, '09000248' || lpad(n::text, 2, '0'), fx.t0 - interval '5 days')
from fx cross join generate_series(1, 3) n;
insert into ids
select 'member_' || n, app.loyalty_join(fx.tenant_t, (select id from ids where name = 'customer_' || n), 'mini_app', fx.store_s1, fx.brand_t, 'syn-replay-248-' || n, fx.t0 - interval '5 days')
from fx cross join generate_series(1, 3) n;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id, customer_id)
select fx.tenant_t, fx.app_t, 'syn-replay-248-' || n, l.id, (select id from ids where name = 'customer_' || n)
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
-- a staff-recorded bill for a member (staff_scan), kept under p_name
create function pg_temp.submit(p_name text, p_member text, p_bill text, p_total numeric, p_at timestamptz) returns jsonb language plpgsql as $$
declare
  v_code text := (select i.code from app.loyalty_issue_checkin_code(pg_temp.id(p_member), (select store_s1 from fx), p_at - interval '10 seconds') i);
  v jsonb;
begin
  perform pg_temp.as_user((select staff_1 from fx));
  v := app.staff_submit_bill((select store_s1 from fx), v_code, p_bill, p_total, p_at);
  insert into ids values (p_name, (v ->> 'bill_id')::uuid);
  return v;
end;
$$;
create function pg_temp.bill(p_name text) returns text language sql as $$
  select concat_ws(':', b.state, b.evidence_level, b.queue_reason, b.reversal_reason) from public.bill_captures b where b.id = pg_temp.id(p_name);
$$;
create function pg_temp.written(p_name text) returns text language sql as $$
  select (select count(*) from public.bill_confirmations c where c.bill_id = pg_temp.id(p_name) and c.source = 'customer') || '/'
    || (select count(*) from public.loyalty_ledger l where l.bill_id = pg_temp.id(p_name));
$$;

-- 1. A blind total sent twice
select pg_temp.submit('b1', 'member_1', '000801', 60000, (select t0 from fx));
select pg_temp.as_login((select login_1 from fx));
select is(app.customer_confirm_bill(pg_temp.id('b1'), 61000, (select t0 from fx) + interval '5 minutes'),
  '{"state": "confirmed", "refusal": null, "evidence_level": 2, "replayed": false}'::jsonb,
  'the first agreeing blind total confirms the bill');
select is(app.customer_confirm_bill(pg_temp.id('b1'), 61000, (select t0 from fx) + interval '6 minutes'),
  '{"state": "confirmed", "refusal": null, "evidence_level": 2, "replayed": true}'::jsonb,
  'the same answer sent again (its answer was lost) gets the first outcome back');
select is(app.customer_confirm_bill(pg_temp.id('b1'), 90000, (select t0 from fx) + interval '7 minutes'),
  '{"state": "confirmed", "refusal": null, "evidence_level": 2, "replayed": true}'::jsonb,
  'a different total sent the second time changes nothing: the first answer stands and nothing new is learned');
select is(pg_temp.bill('b1') || ' ' || pg_temp.written('b1'), 'confirmed:2 1/2',
  'the bill keeps its state and level, with one customer answer and one earn and its confirm row');

select pg_temp.submit('b2', 'member_1', '000802', 80000, (select t0 from fx));
select pg_temp.as_login((select login_1 from fx));
select is(app.customer_confirm_bill(pg_temp.id('b2'), 70000, (select t0 from fx) + interval '5 minutes') ->> 'state', 'queued',
  'a disagreeing blind total queues another bill');
select pg_temp.as_user((select manager_u from fx));
select is(app.staff_decide_bill(pg_temp.id('b2'), 'approved', 'checked', (select t0 from fx) + interval '10 minutes') ->> 'bill_state', 'confirmed',
  'a manager then approves it');
select pg_temp.as_login((select login_1 from fx));
select is((select (r ->> 'state') || ':' || (r ->> 'replayed') from (select app.customer_confirm_bill(pg_temp.id('b2'), 70000, (select t0 from fx) + interval '11 minutes') as r) s),
  'queued:true',
  'the replay gives the outcome the customer was given, not the manager''s later decision');

-- 2. A dispute sent twice, and the crossings
select pg_temp.submit('b3', 'member_1', '000803', 55000, (select t0 from fx));
select pg_temp.as_login((select login_1 from fx));
select is(app.customer_dispute_bill(pg_temp.id('b3'), (select t0 from fx) + interval '3 minutes'),
  '{"state": "reversed", "refusal": null, "replayed": false}'::jsonb, 'the first dispute reverses the bill');
select is(app.customer_dispute_bill(pg_temp.id('b3'), (select t0 from fx) + interval '4 minutes'),
  '{"state": "reversed", "refusal": null, "replayed": true}'::jsonb, 'the same dispute sent again gets reversed back');
select is(app.customer_confirm_bill(pg_temp.id('b3'), 55000, (select t0 from fx) + interval '5 minutes') ->> 'refusal', 'already_answered',
  'a total after a dispute is still refused');
select pg_temp.submit('b4', 'member_1', '000804', 60000, (select t0 from fx));
select pg_temp.as_login((select login_1 from fx));
select is(app.customer_confirm_bill(pg_temp.id('b4'), 60000, (select t0 from fx) + interval '5 minutes') ->> 'state', 'confirmed', 'another bill is confirmed');
select is(app.customer_dispute_bill(pg_temp.id('b4'), (select t0 from fx) + interval '6 minutes') ->> 'refusal', 'already_answered',
  'a dispute after a total is still refused');

-- 3. Neither another member nor an answer from before the migration gets a replay
select pg_temp.as_login((select login_2 from fx));
select is(app.customer_confirm_bill(pg_temp.id('b1'), 61000, (select t0 from fx) + interval '8 minutes') ->> 'refusal', 'unknown_bill',
  'another member sending the same answer learns nothing about the bill');
update public.bill_confirmations set answered_state = null where bill_id = pg_temp.id('b4') and source = 'customer';
select pg_temp.as_login((select login_1 from fx));
select is(app.customer_confirm_bill(pg_temp.id('b4'), 60000, (select t0 from fx) + interval '9 minutes') ->> 'refusal', 'already_answered',
  'an answer kept before answered_state existed still answers already_answered');
select throws_ok(
  format('update public.bill_confirmations set answered_state = %L where bill_id = %L and source = %L', 'confirmed', pg_temp.id('b1'), 'staff'),
  '23514', null, 'only the customer''s reading carries an answered_state');

-- 4. A counter claim sent twice
select pg_temp.as_user((select staff_1 from fx));
create temp table qr as select app.staff_counter_code((select store_s1 from fx), (select t0 from fx) + interval '2 hours') ->> 'qr_payload' as payload;
select pg_temp.as_login((select login_2 from fx));
create temp table first_claim as
select app.customer_submit_counter_claim((select payload from qr), 'C-1', 90000, (select t0 from fx) + interval '2 hours 30 seconds') as answer;
select is((select (answer ->> 'state') || ':' || (answer ->> 'replayed') from first_claim), 'awaiting_staff:false', 'a counter claim waits for a staff member');
select is(app.customer_submit_counter_claim((select payload from qr), 'C-1', 90000, (select t0 from fx) + interval '2 hours 40 seconds'),
  (select answer || '{"replayed": true}'::jsonb from first_claim),
  'the same claim sent again gets the first outcome back: the same bill, the same deadline');
select is(app.customer_submit_counter_claim((select payload from qr), ' c-1 ', 95000, (select t0 from fx) + interval '2 hours 50 seconds') ->> 'bill_id',
  (select answer ->> 'bill_id' from first_claim),
  'the bill number is read by its key (case and spaces), and a different total changes nothing');
select is(app.customer_submit_counter_claim((select payload from qr), 'C-2', 50000, (select t0 from fx) + interval '2 hours 55 seconds') ->> 'refusal', 'code_used',
  'another bill number with the same QR is still refused');
select is(app.customer_submit_counter_claim((select payload from qr), 'C-1', 90000, (select t0 from fx) + interval '3 hours') ->> 'replayed', 'true',
  'the replay still answers once the QR and its grace have passed');
select is(app.customer_submit_counter_claim((select payload from qr), 'C-3', 50000, (select t0 from fx) + interval '3 hours') ->> 'refusal', 'code_expired',
  'while a new bill with that QR is refused as expired');
select is((select count(*)::int from public.bill_captures b where b.membership_id = pg_temp.id('member_2') and b.source = 'counter_claim'), 1,
  'one bill was recorded however often the claim was sent');

update public.loyalty_store_settings set auto_approve_max_amount = 60000, auto_approve_per_day = 5 where store_id = (select store_s1 from fx);
select pg_temp.as_user((select staff_1 from fx));
create temp table qr2 as select app.staff_counter_code((select store_s1 from fx), (select t0 from fx) + interval '4 hours') ->> 'qr_payload' as payload;
select pg_temp.as_login((select login_3 from fx));
create temp table auto_claim as
select app.customer_submit_counter_claim((select payload from qr2), 'A-1', 55000, (select t0 from fx) + interval '4 hours 10 seconds') as answer;
select is((select concat_ws(':', answer ->> 'state', answer ->> 'stamps_earned', answer ->> 'points_earned', answer ->> 'replayed') from auto_claim),
  'confirmed:1:5:false', 'a claim within the auto-approval limit is confirmed at once with its stamp and points');
select is(app.customer_submit_counter_claim((select payload from qr2), 'A-1', 55000, (select t0 from fx) + interval '4 hours 20 seconds'),
  (select answer || '{"replayed": true}'::jsonb from auto_claim),
  'sent again it gets the same confirmation, stamps and points back');
select is((select count(*)::int from public.loyalty_ledger l join public.bill_captures b on b.id = l.bill_id where b.bill_no = 'A-1' and l.entry_kind = 'earn'), 1,
  'and earns once');

-- 5. The wallet's counter claims
select pg_temp.as_login((select login_2 from fx));
select is((select (claims -> 0 ->> 'waiting_until')::timestamptz from (select app.customer_wallet((select t0 from fx) + interval '2 hours 1 minute') -> 'counter_claims' as claims) s),
  (select (answer ->> 'expires_at')::timestamptz from first_claim),
  'while it waits, a claim shows until when the staff can answer it');
select pg_temp.as_user((select staff_1 from fx));
select app.staff_answer_counter_claim((select (answer ->> 'bill_id')::uuid from first_claim), 90000, null, (select t0 from fx) + interval '2 hours 2 minutes');
insert into public.bill_captures (tenant_id, store_id, membership_id, source, business_date, bill_no, bill_key, total, state, confirm_by, confirmed_at, created_at)
select fx.tenant_t, fx.store_s1, pg_temp.id('member_2'), 'counter_claim', (fx.t0 + interval '5 hours' - w.age)::date, w.bill_no, app.bill_key(w.bill_no), 50000,
  'confirmed', fx.t0 + interval '5 hours' - w.age + interval '6 hours', fx.t0 + interval '5 hours' - w.age + interval '1 hour', fx.t0 + interval '5 hours' - w.age
from fx cross join (values ('W-OLD', interval '7 days'), ('W-EDGE', interval '7 days' - interval '1 second')) as w (bill_no, age);
insert into public.bill_captures (tenant_id, store_id, membership_id, source, business_date, bill_no, bill_key, total, state, queue_reason, confirm_by, created_at)
select fx.tenant_t, fx.store_s1, pg_temp.id('member_2'), 'counter_claim', (fx.t0 - interval '30 days')::date, 'W-QUEUED', 'W-QUEUED', 50000,
  'queued', 'disagreement', fx.t0 - interval '30 days' + interval '6 hours', fx.t0 - interval '30 days'
from fx;
select pg_temp.as_login((select login_2 from fx));
create temp table wallet_2 as select app.customer_wallet((select t0 from fx) + interval '5 hours') -> 'counter_claims' as claims;
select is((select array_agg(e ->> 'bill_no' order by n) from wallet_2, jsonb_array_elements(claims) with ordinality as x (e, n)),
  array['C-1', 'W-EDGE', 'W-QUEUED'],
  'the wallet lists the member''s counter claims newest first: sent within 7 days, or still waiting however old; not one sent exactly 7 days ago');
select is((select array_agg(k order by k) from wallet_2, jsonb_object_keys(claims -> 0) as k),
  array['bill_no', 'decided_at', 'id', 'state', 'store_name', 'submitted_at', 'waiting_until'],
  'each claim carries its number, store, times and state, and never a total');
select is((select concat_ws(':', claims -> 0 ->> 'state', claims -> 0 ->> 'store_name', (claims -> 0 -> 'waiting_until') = 'null'::jsonb, (claims -> 0 ->> 'decided_at') is not null) from wallet_2),
  'confirmed:Synthetic store S1:t:t',
  'once answered, a claim has a decision time and no waiting time');

insert into public.bill_captures (tenant_id, store_id, membership_id, source, business_date, bill_no, bill_key, total, state, confirm_by, confirmed_at, created_at)
select fx.tenant_t, fx.store_s1, pg_temp.id('member_2'), 'counter_claim', fx.t0::date, 'L-' || n, 'L-' || n, 50000,
  'confirmed', fx.t0 + interval '4 hours' + make_interval(mins => n) + interval '6 hours', fx.t0 + interval '4 hours' + make_interval(mins => n + 1), fx.t0 + interval '4 hours' + make_interval(mins => n)
from fx cross join generate_series(1, 25) as n;
select is((select jsonb_array_length(app.customer_wallet((select t0 from fx) + interval '5 hours') -> 'counter_claims')), 20,
  'at most 20 claims are listed');
select pg_temp.as_login((select login_3 from fx));
select is((select array_agg(e ->> 'bill_no') from jsonb_array_elements(app.customer_wallet((select t0 from fx) + interval '5 hours') -> 'counter_claims') as e),
  array['A-1'],
  'another member sees only their own claims');
select pg_temp.as_login((select login_1 from fx));
select is(app.customer_wallet((select t0 from fx) + interval '5 hours') -> 'counter_claims', '[]'::jsonb,
  'a member with only staff-recorded bills has no counter claims listed');

select is((select count(*)::int from unnest(array['anon', 'authenticated']) as r (role)
   where has_function_privilege(r.role, 'app.customer_counter_claims(timestamptz)', 'execute')),
  0, 'no API role runs app.customer_counter_claims directly');

select * from finish();
rollback;
