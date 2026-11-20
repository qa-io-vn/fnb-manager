-- ISTQB state transition testing of a bill (bill_captures, path E) at a store in staff mode, with SQL as the unit
-- under test (docs/deep-dives/bill-verification-plan.md, phases 1 and 2). States: awaiting_customer, awaiting_staff,
-- queued, confirmed, reversed, rejected, expired. Valid transitions covered:
--   (start) -> awaiting_customer             staff_submit_bill, required level 2 (default)
--   (start) -> confirmed                     staff_submit_bill, required level 0
--   (start) -> queued (over_approval)        a total above bill_manager_approval_above
--   awaiting_customer -> confirmed (level 2) customer's blind total agrees
--   awaiting_customer -> queued              customer's blind total disagrees
--   awaiting_customer -> reversed            customer disputes; deadline with silence = reverse
--   awaiting_customer -> confirmed           deadline with silence = confirm
--   queued -> confirmed | reversed           manager approves | rejects
--   confirmed -> reversed                    manager reverses within the window
--   (start) -> awaiting_staff                customer_submit_counter_claim
--   awaiting_staff -> confirmed | queued | rejected | expired
--   (start) -> confirmed (auto)              counter claim within the auto-approval limits
-- Invalid transitions (answering twice, reversing after the window, a staff member reversing) refuse and change nothing.
-- The ledger follows: a pending earn is not spendable, a confirm row makes it spendable, a clawback removes it.
begin;
select plan(53);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

-- Fixture: tenant T with stores S1 and S2 in staff mode and P in pos_sync mode, tenant U with store B.
create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000022201'::uuid as tenant_t,
  'dddddddd-dddd-4ddd-8ddd-000000022202'::uuid as tenant_u,
  'cccccccc-cccc-4ccc-8ccc-000000022201'::uuid as account_t,
  'cccccccc-cccc-4ccc-8ccc-000000022202'::uuid as account_u,
  'ffffffff-ffff-4fff-8fff-000000022201'::uuid as store_s1,
  'ffffffff-ffff-4fff-8fff-000000022202'::uuid as store_s2,
  'ffffffff-ffff-4fff-8fff-000000022203'::uuid as store_p,
  'ffffffff-ffff-4fff-8fff-000000022204'::uuid as store_b,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000022201'::uuid as brand_t,
  '99999999-9999-4999-8999-000000022201'::uuid as app_t,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000022201'::uuid as programme_t,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000022202'::uuid as programme_u,
  'eeeeeeee-eeee-4eee-8eee-000000022201'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000022202'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000022203'::uuid as staff_1,
  'eeeeeeee-eeee-4eee-8eee-000000022204'::uuid as staff_2,
  'eeeeeeee-eeee-4eee-8eee-000000022205'::uuid as staff_s2,
  'eeeeeeee-eeee-4eee-8eee-000000022206'::uuid as owner_b,
  'eeeeeeee-eeee-4eee-8eee-000000022207'::uuid as viewer_u,
  'eeeeeeee-eeee-4eee-8eee-000000022211'::uuid as login_1,
  'eeeeeeee-eeee-4eee-8eee-000000022212'::uuid as login_2,
  'eeeeeeee-eeee-4eee-8eee-000000022213'::uuid as login_3,
  timestamptz '2026-11-10 10:00+07' as t0;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'bill-22-' || right(u.id::text, 4) || '@example.com',
  case when u.customer then jsonb_build_object('kind', 'customer', 'tenant_id', fx.tenant_t, 'customer_id', null) else '{}'::jsonb end
from fx cross join lateral (values
  (fx.owner_u, false), (fx.manager_u, false), (fx.staff_1, false), (fx.staff_2, false), (fx.staff_s2, false), (fx.owner_b, false), (fx.viewer_u, false),
  (fx.login_1, true), (fx.login_2, true), (fx.login_3, true)
) as u (id, customer);
insert into public.tenants (id, slug, name)
select tenant_t, 'bill-pgtap-22-t', 'Bill pgTAP T' from fx union all select tenant_u, 'bill-pgtap-22-u', 'Bill pgTAP U' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_t, tenant_t, 'mock', 'bill-22-t', 'Synthetic account T' from fx union all select account_u, tenant_u, 'mock', 'bill-22-u', 'Synthetic account U' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
select store_s1, tenant_t, account_t, 'b22-s1', 'b22-s1', 'Synthetic store S1' from fx
union all select store_s2, tenant_t, account_t, 'b22-s2', 'b22-s2', 'Synthetic store S2' from fx
union all select store_p, tenant_t, account_t, 'b22-p', 'b22-p', 'Synthetic store P' from fx
union all select store_b, tenant_u, account_u, 'b22-b', 'b22-b', 'Synthetic store B' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_t, owner_u, 'owner'::public.tenant_role, null::uuid[] from fx
union all select tenant_t, manager_u, 'manager', array[store_s1, store_p] from fx
union all select tenant_t, staff_1, 'staff', array[store_s1, store_p] from fx
union all select tenant_t, staff_2, 'staff', array[store_s1] from fx
union all select tenant_t, staff_s2, 'staff', array[store_s2] from fx
union all select tenant_t, viewer_u, 'viewer', null from fx
union all select tenant_u, owner_b, 'owner', null from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_t, tenant_t, 'brand-922', 'Synthetic brand', array[store_s1, store_s2, store_p] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_t, tenant_t, brand_t, 'synthetic-bill-app-22', 'ZALO_APP_SECRET_BRAND_922', 'active' from fx;
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
select 'customer_' || n, app.loyalty_customer_for_phone(fx.tenant_t, '09000220' || lpad(n::text, 2, '0'), fx.t0 - interval '5 days')
from fx cross join generate_series(1, 6) n;
insert into ids
select 'member_' || n, app.loyalty_join(fx.tenant_t, (select id from ids where name = 'customer_' || n), 'mini_app', fx.store_s1, fx.brand_t, 'syn-bill-22-' || n, fx.t0 - interval '5 days')
from fx cross join generate_series(1, 6) n;
insert into ids select 'customer_b', app.loyalty_customer_for_phone(tenant_u, '0900022099', t0 - interval '5 days') from fx;
insert into ids select 'member_b', app.loyalty_join(tenant_u, (select id from ids where name = 'customer_b'), 'mini_app', store_b, null, null, t0 - interval '5 days') from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id, customer_id)
select fx.tenant_t, fx.app_t, 'syn-bill-22-' || n, l.id, (select id from ids where name = 'customer_' || n)
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


-- 1. awaiting_customer -> confirmed by an agreeing blind total
select is(pg_temp.submit('b1', (select staff_1 from fx), 'member_1', (select store_s1 from fx), '000123', 60000, (select t0 from fx)) ->> 'state',
  'awaiting_customer', 'a staff bill waits for the customer (required level 2)');
select is(pg_temp.bill('b1'), 'awaiting_customer:0', 'it holds evidence level 0');
select is(pg_temp.balance('member_1'), '0/0/1/6', 'its earn is pending: one stamp and six points shown, nothing spendable');
select pg_temp.as_login((select login_1 from fx));
select is(app.customer_confirm_bill(pg_temp.id('b1'), 61000, (select t0 from fx) + interval '5 minutes') ->> 'state', 'confirmed',
  'the customer''s blind total within the tolerance (1,000) confirms it at once');
select is(pg_temp.bill('b1'), 'confirmed:2', 'two agreeing readings: level 2');
select is(pg_temp.balance('member_1'), '1/6/0/0', 'the stamp and points are spendable');
select is(app.customer_confirm_bill(pg_temp.id('b1'), 60000, (select t0 from fx) + interval '6 minutes') ->> 'refusal', 'already_answered',
  'a second answer is refused');

-- 2. awaiting_customer -> queued (disagreement) -> confirmed by a manager
select is(pg_temp.submit('b2', (select staff_1 from fx), 'member_2', (select store_s1 from fx), '000124', 80000, (select t0 from fx)) ->> 'state',
  'awaiting_customer', 'a second bill waits');
select pg_temp.as_login((select login_2 from fx));
select is(app.customer_confirm_bill(pg_temp.id('b2'), 70000, (select t0 from fx) + interval '5 minutes') ->> 'state', 'queued',
  'a blind total 10,000 off queues the bill');
select is(pg_temp.bill('b2'), 'queued:0:disagreement', 'queued for disagreement, still level 0');
select is(pg_temp.balance('member_2'), '0/0/1/8', 'the earn stays pending while queued');
select pg_temp.as_user((select staff_1 from fx));
select is(pg_temp.try(format('select app.staff_decide_bill(%L, ''approved'', ''ok'') ->> ''state''', pg_temp.id('b2'))), 'error:42501',
  'a staff member cannot decide a queued bill');
select pg_temp.as_user((select manager_u from fx));
select is(app.staff_decide_bill(pg_temp.id('b2'), 'approved', 'checked the bill', (select t0 from fx) + interval '10 minutes') ->> 'bill_state', 'confirmed',
  'the manager approves it');
select is(pg_temp.balance('member_2'), '1/8/0/0', 'and the earn becomes spendable');

-- 3. awaiting_customer -> reversed by a dispute
select is(pg_temp.submit('b3', (select staff_1 from fx), 'member_3', (select store_s1 from fx), '000125', 55000, (select t0 from fx)) ->> 'state',
  'awaiting_customer', 'a third bill waits');
select pg_temp.as_login((select login_3 from fx));
select is(app.customer_dispute_bill(pg_temp.id('b3'), (select t0 from fx) + interval '3 minutes') ->> 'state', 'reversed', '"Không đúng" reverses it');
select is(pg_temp.bill('b3'), 'reversed:0:disputed', 'reversed as disputed');
select is(pg_temp.balance('member_3'), '0/0/0/0', 'the pending earn is clawed back');
select ok(exists (select 1 from public.alert_events e where e.tenant_id = (select tenant_t from fx) and e.rule_key = 'loyalty_staff_anomaly' and e.facts ->> 'kind' = 'disputed'),
  'the dispute alerts the owners and managers');
select is(app.customer_confirm_bill(pg_temp.id('b3'), 55000, (select t0 from fx) + interval '4 minutes') ->> 'refusal', 'already_answered',
  'a reversed bill cannot be confirmed afterwards');

-- 4. awaiting_customer -> reversed at the deadline (silence = reverse, the default)
select is(pg_temp.submit('b4', (select staff_2 from fx), 'member_4', (select store_s1 from fx), '000126', 60000, (select t0 from fx)) ->> 'state',
  'awaiting_customer', 'a fourth bill waits');
select is(app.bill_expire_pending((select tenant_t from fx), (select t0 from fx) + interval '23 hours 59 minutes') ->> 'reversed', '0',
  'one minute before the deadline nothing happens');
select is(app.bill_expire_pending((select tenant_t from fx), (select t0 from fx) + interval '24 hours') ->> 'reversed', '1',
  'at the deadline the silent bill is reversed');
select is(pg_temp.bill('b4'), 'reversed:0:timed_out', 'reversed as timed_out');
select is(pg_temp.balance('member_4'), '0/0/0/0', 'and its earn is gone');

-- 5. awaiting_customer -> confirmed at the deadline (silence = confirm), and required level 0
update public.loyalty_store_settings set bill_silence_outcome = 'confirm' where store_id = (select store_s2 from fx);
select is(pg_temp.submit('b5', (select staff_s2 from fx), 'member_5', (select store_s2 from fx), '000127', 60000, (select t0 from fx)) ->> 'state',
  'awaiting_customer', 'a bill at S2 waits');
select is(app.bill_expire_pending((select tenant_t from fx), (select t0 from fx) + interval '24 hours') ->> 'confirmed', '1',
  'with silence = confirm the deadline confirms it');
select is(pg_temp.bill('b5'), 'confirmed:0', 'at its own level 0');
update public.loyalty_store_settings set bill_evidence_required_level = 0 where store_id = (select store_s2 from fx);
select is(pg_temp.submit('b6', (select staff_s2 from fx), 'member_6', (select store_s2 from fx), '000128', 70000, (select t0 from fx)) ->> 'state',
  'confirmed', 'with required level 0 the staff reading confirms at once (the owner''s choice)');
select is(pg_temp.balance('member_6'), '1/7/0/0', 'spendable at once');

-- 6. (start) -> queued over the approval threshold -> reversed by a manager's rejection
update public.loyalty_store_settings set bill_manager_approval_above = 100000 where store_id = (select store_s1 from fx);
select is(pg_temp.submit('b7', (select staff_1 from fx), 'member_1', (select store_s1 from fx), '000129', 150000, (select t0 from fx) + interval '1 minute') ->> 'state',
  'queued', 'a total above the threshold waits for a manager');
select is(pg_temp.bill('b7'), 'queued:0:over_approval', 'queued as over_approval');
select pg_temp.as_user((select manager_u from fx));
select is(app.staff_decide_bill(pg_temp.id('b7'), 'rejected', 'no such bill', (select t0 from fx) + interval '20 minutes') ->> 'bill_state', 'reversed',
  'the manager rejects it');
select is(pg_temp.bill('b7'), 'reversed:0:manager_rejected', 'its pending earn is reversed');

-- 7. confirmed -> reversed by a manager within the window, not after
select is(app.staff_reverse_bill(pg_temp.id('b1'), 'wrong member', (select t0 from fx) + interval '5 minutes' + interval '481 minutes') ->> 'refusal', 'window_passed',
  'after reverse_window_minutes (480) a reversal is refused');
select pg_temp.as_user((select staff_1 from fx));
select is(pg_temp.try(format('select app.staff_reverse_bill(%L, ''x'') ->> ''state''', pg_temp.id('b1'))), 'error:42501', 'a staff member cannot reverse');
select pg_temp.as_user((select manager_u from fx));
select is(app.staff_reverse_bill(pg_temp.id('b1'), 'wrong member', (select t0 from fx) + interval '1 hour') ->> 'state', 'reversed', 'within the window it is reversed');
select is(pg_temp.balance('member_1'), '0/0/0/0', 'the member loses the stamp and points');

-- 8. Counter claims: awaiting_staff -> confirmed (agreeing totals)
select pg_temp.as_user((select staff_1 from fx));
create temp table qr as select app.staff_counter_code((select store_s1 from fx), (select t0 from fx) + interval '2 hours') ->> 'qr_payload' as payload;
select pg_temp.as_login((select login_2 from fx));
select is(app.customer_submit_counter_claim((select payload from qr), 'C-1', 90000, (select t0 from fx) + interval '2 hours 30 seconds') ->> 'state', 'awaiting_staff',
  'a counter claim waits for a staff member');
insert into ids select 'c1', id from public.bill_captures where bill_no = 'C-1';
select pg_temp.as_user((select staff_2 from fx));
select is(app.staff_answer_counter_claim(pg_temp.id('c1'), 90000, null, (select t0 from fx) + interval '2 hours 1 minute') ->> 'state', 'confirmed',
  'the staff member''s blind total agrees: confirmed');
select is(pg_temp.bill('c1'), 'confirmed:2', 'at level 2');

-- 9. awaiting_staff -> queued -> rejected (no earn was ever written)
select pg_temp.as_login((select login_3 from fx));
select is(app.customer_submit_counter_claim((select payload from qr), 'C-2', 50000, (select t0 from fx) + interval '2 hours 40 seconds') ->> 'state', 'awaiting_staff',
  'another claim waits');
insert into ids select 'c2', id from public.bill_captures where bill_no = 'C-2';
select pg_temp.as_user((select staff_2 from fx));
select is(app.staff_answer_counter_claim(pg_temp.id('c2'), 30000, null, (select t0 from fx) + interval '2 hours 2 minutes') ->> 'state', 'queued',
  'disagreeing totals queue it');
select is((select count(*)::integer from public.loyalty_ledger where bill_id = pg_temp.id('c2')), 0, 'a queued counter claim has no earn yet');
select pg_temp.as_user((select manager_u from fx));
select is(app.staff_decide_bill(pg_temp.id('c2'), 'rejected', 'amount does not match', (select t0 from fx) + interval '2 hours 5 minutes') ->> 'bill_state', 'rejected',
  'the manager rejects it: rejected without an earn');

-- 10. awaiting_staff -> rejected by staff, and -> expired at the deadline (a fresh QR: one claim per member and QR)
select pg_temp.as_user((select staff_1 from fx));
drop table qr;
create temp table qr as select app.staff_counter_code((select store_s1 from fx), (select t0 from fx) + interval '2 hours 4 minutes') ->> 'qr_payload' as payload;
select pg_temp.as_login((select login_2 from fx));
select is(app.customer_submit_counter_claim((select payload from qr), 'C-3', 52000, (select t0 from fx) + interval '2 hours 4 minutes 10 seconds') ->> 'state', 'awaiting_staff',
  'a third claim waits');
insert into ids select 'c3', id from public.bill_captures where bill_no = 'C-3';
select pg_temp.as_user((select staff_2 from fx));
select is(app.staff_answer_counter_claim(pg_temp.id('c3'), null, 'not our bill', (select t0 from fx) + interval '2 hours 5 minutes') ->> 'state', 'rejected',
  'a staff member rejects it with a reason');
select pg_temp.as_login((select login_3 from fx));
select is(app.customer_submit_counter_claim((select payload from qr), 'C-4', 60000, (select t0 from fx) + interval '2 hours 4 minutes 20 seconds') ->> 'state', 'awaiting_staff',
  'a fourth claim waits');
select is(app.bill_expire_pending((select tenant_t from fx), (select t0 from fx) + interval '8 hours 5 minutes') ->> 'expired', '1',
  'six hours later nobody answered: it expires');
select is((select state from public.bill_captures where bill_no = 'C-4'), 'expired', 'expired without an earn');

-- 11. (start) -> confirmed by auto-approval, within its daily count
update public.loyalty_store_settings set auto_approve_max_amount = 60000, auto_approve_per_day = 1 where store_id = (select store_s1 from fx);
select pg_temp.as_user((select staff_1 from fx));
drop table qr;
create temp table qr as select app.staff_counter_code((select store_s1 from fx), (select t0 from fx) + interval '9 hours') ->> 'qr_payload' as payload;
select pg_temp.as_login((select login_1 from fx));
select is(app.customer_submit_counter_claim((select payload from qr), 'C-5', 55000, (select t0 from fx) + interval '9 hours 10 seconds') ->> 'state', 'confirmed',
  'a claim within auto_approve_max_amount is confirmed at once');
select is((select auto_approved::text || ':' || evidence_level from public.bill_captures where bill_no = 'C-5'), 'true:0', 'auto-approved at level 0');
select pg_temp.as_login((select login_2 from fx));
select is(app.customer_submit_counter_claim((select payload from qr), 'C-6', 50000, (select t0 from fx) + interval '9 hours 20 seconds') ->> 'state', 'awaiting_staff',
  'once auto_approve_per_day is used the next claim waits for staff');

select * from finish();
rollback;
