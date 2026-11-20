-- Plan phase 3 controls and the shadow check, with seeded cases (ISTQB: use-case and error-guessing tests of each
-- anomaly the caps cannot stop): the per-staff anomaly report flags a staff member far above their peers, disputes,
-- disagreements, an amount outlier, a member taking most of one staff member's bills, a failed random audit and a
-- burst within one hour, and stays silent for an ordinary staff member; it reads only for owners and managers. The
-- shadow check links bills to synced invoices (matched, mismatch, no_invoice) without changing any earn and keeps
-- path A from earning a linked invoice. The store lock that serialises the caps is held by staff_submit_bill. The
-- data-subject erasure removes bills.
begin;
select plan(26);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

-- Fixture: tenant T with stores S1 and S2 in staff mode and P in pos_sync mode, tenant U with store B.
create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000022601'::uuid as tenant_t,
  'dddddddd-dddd-4ddd-8ddd-000000022602'::uuid as tenant_u,
  'cccccccc-cccc-4ccc-8ccc-000000022601'::uuid as account_t,
  'cccccccc-cccc-4ccc-8ccc-000000022602'::uuid as account_u,
  'ffffffff-ffff-4fff-8fff-000000022601'::uuid as store_s1,
  'ffffffff-ffff-4fff-8fff-000000022602'::uuid as store_s2,
  'ffffffff-ffff-4fff-8fff-000000022603'::uuid as store_p,
  'ffffffff-ffff-4fff-8fff-000000022604'::uuid as store_b,
  'bbbbbbbb-bbbb-4bbb-8bbb-000000022601'::uuid as brand_t,
  '99999999-9999-4999-8999-000000022601'::uuid as app_t,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000022601'::uuid as programme_t,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000022602'::uuid as programme_u,
  'eeeeeeee-eeee-4eee-8eee-000000022601'::uuid as owner_u,
  'eeeeeeee-eeee-4eee-8eee-000000022602'::uuid as manager_u,
  'eeeeeeee-eeee-4eee-8eee-000000022603'::uuid as staff_1,
  'eeeeeeee-eeee-4eee-8eee-000000022604'::uuid as staff_2,
  'eeeeeeee-eeee-4eee-8eee-000000022605'::uuid as staff_s2,
  'eeeeeeee-eeee-4eee-8eee-000000022606'::uuid as owner_b,
  'eeeeeeee-eeee-4eee-8eee-000000022607'::uuid as viewer_u,
  'eeeeeeee-eeee-4eee-8eee-000000022611'::uuid as login_1,
  'eeeeeeee-eeee-4eee-8eee-000000022612'::uuid as login_2,
  'eeeeeeee-eeee-4eee-8eee-000000022613'::uuid as login_3,
  timestamptz '2026-11-10 10:00+07' as t0;

insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'bill-26-' || right(u.id::text, 4) || '@example.com',
  case when u.customer then jsonb_build_object('kind', 'customer', 'tenant_id', fx.tenant_t, 'customer_id', null) else '{}'::jsonb end
from fx cross join lateral (values
  (fx.owner_u, false), (fx.manager_u, false), (fx.staff_1, false), (fx.staff_2, false), (fx.staff_s2, false), (fx.owner_b, false), (fx.viewer_u, false),
  (fx.login_1, true), (fx.login_2, true), (fx.login_3, true)
) as u (id, customer);
insert into public.tenants (id, slug, name)
select tenant_t, 'bill-pgtap-26-t', 'Bill pgTAP T' from fx union all select tenant_u, 'bill-pgtap-26-u', 'Bill pgTAP U' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_t, tenant_t, 'mock', 'bill-26-t', 'Synthetic account T' from fx union all select account_u, tenant_u, 'mock', 'bill-26-u', 'Synthetic account U' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, code, name)
select store_s1, tenant_t, account_t, 'b26-s1', 'b26-s1', 'Synthetic store S1' from fx
union all select store_s2, tenant_t, account_t, 'b26-s2', 'b26-s2', 'Synthetic store S2' from fx
union all select store_p, tenant_t, account_t, 'b26-p', 'b26-p', 'Synthetic store P' from fx
union all select store_b, tenant_u, account_u, 'b26-b', 'b26-b', 'Synthetic store B' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_t, owner_u, 'owner'::public.tenant_role, null::uuid[] from fx
union all select tenant_t, manager_u, 'manager', array[store_s1, store_p] from fx
union all select tenant_t, staff_1, 'staff', array[store_s1, store_p] from fx
union all select tenant_t, staff_2, 'staff', array[store_s1] from fx
union all select tenant_t, staff_s2, 'staff', array[store_s2] from fx
union all select tenant_t, viewer_u, 'viewer', null from fx
union all select tenant_u, owner_b, 'owner', null from fx;
insert into public.brands (id, tenant_id, brand_key, display_name, store_ids)
select brand_t, tenant_t, 'brand-926', 'Synthetic brand', array[store_s1, store_s2, store_p] from fx;
insert into public.zalo_apps (id, tenant_id, brand_id, external_id, secret_name, status)
select app_t, tenant_t, brand_t, 'synthetic-bill-app-26', 'ZALO_APP_SECRET_BRAND_926', 'active' from fx;
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
select 'customer_' || n, app.loyalty_customer_for_phone(fx.tenant_t, '09000260' || lpad(n::text, 2, '0'), fx.t0 - interval '5 days')
from fx cross join generate_series(1, 6) n;
insert into ids
select 'member_' || n, app.loyalty_join(fx.tenant_t, (select id from ids where name = 'customer_' || n), 'mini_app', fx.store_s1, fx.brand_t, 'syn-bill-26-' || n, fx.t0 - interval '5 days')
from fx cross join generate_series(1, 6) n;
insert into ids select 'customer_b', app.loyalty_customer_for_phone(tenant_u, '0900026099', t0 - interval '5 days') from fx;
insert into ids select 'member_b', app.loyalty_join(tenant_u, (select id from ids where name = 'customer_b'), 'mini_app', store_b, null, null, t0 - interval '5 days') from fx;
insert into app.customer_logins (tenant_id, zalo_app_id, zalo_user_id, user_id, customer_id)
select fx.tenant_t, fx.app_t, 'syn-bill-26-' || n, l.id, (select id from ids where name = 'customer_' || n)
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


grant select on fx, ids to authenticated;
create function pg_temp.r(p_answer jsonb) returns text language sql as $$
  select coalesce('error:' || (p_answer ->> 'error'), p_answer ->> 'refusal', p_answer ->> 'state');
$$;
create temp table seeded (name text, outcome text);

-- Day 1 at S1: staff 1 records twelve bills of members 1 to 4, one of them 1,900,000; staff 2 records four, three of member 5
insert into seeded
select 'staff1-' || n, pg_temp.r(pg_temp.submit('s1b' || n, (select staff_1 from fx), 'member_' || (1 + (n - 1) / 3), (select store_s1 from fx), 'AN-' || n,
  case when n = 12 then 1900000 else 60000 end, (select t0 from fx) + make_interval(mins => n)))
from generate_series(1, 12) n;
insert into seeded
select 'staff2-' || n, pg_temp.r(pg_temp.submit('s2b' || n, (select staff_2 from fx), case when n <= 3 then 'member_5' else 'member_6' end, (select store_s1 from fx), 'AN2-' || n,
  60000, (select t0 from fx) + make_interval(mins => 30 + n)))
from generate_series(1, 3) n;
select is((select count(*)::integer from seeded where outcome in ('awaiting_customer', 'queued')), 15, 'fifteen bills seeded');

-- staff 2's fourth bill is confirmed at once and sampled for audit, then fails it
update public.loyalty_store_settings set bill_evidence_required_level = 0, bill_audit_sample_pct = 100 where store_id = (select store_s1 from fx);
select is(pg_temp.r(pg_temp.submit('audited', (select staff_2 from fx), 'member_6', (select store_s1 from fx), 'AN2-4', 60000, (select t0 from fx) + interval '40 minutes')), 'confirmed', 'a bill confirmed at level 0');
update public.loyalty_store_settings set bill_evidence_required_level = 2, bill_audit_sample_pct = 0 where store_id = (select store_s1 from fx);
select is((select state from public.bill_audits where bill_id = pg_temp.id('audited')), 'open', 'is sampled into an open audit');
select pg_temp.as_user((select manager_u from fx));
select is((app.staff_bill_queue((select store_s1 from fx), (select t0 from fx) + interval '41 minutes') -> 'audits' -> 0 ->> 'bill_no'), 'AN2-4', 'the audit is in the manager queue');
select is(app.staff_close_bill_audit((select id from public.bill_audits where bill_id = pg_temp.id('audited')), 'failed', 'no such bill in the drawer', (select t0 from fx) + interval '45 minutes') ->> 'state',
  'failed', 'the manager fails the audit');
select is(pg_temp.bill('audited'), 'reversed:0:audit_failed', 'a failed audit reverses the bill');

-- Customers of staff 1: one dispute, two disagreements
select pg_temp.as_login((select login_1 from fx));
select is(app.customer_dispute_bill(pg_temp.id('s1b1'), (select t0 from fx) + interval '50 minutes') ->> 'state', 'reversed', 'member 1 disputes a bill');
select pg_temp.as_login((select login_2 from fx));
select is(app.customer_confirm_bill(pg_temp.id('s1b4'), 30000, (select t0 from fx) + interval '50 minutes') ->> 'state', 'queued', 'member 2 disagrees');
select pg_temp.as_login((select login_3 from fx));
select is(app.customer_confirm_bill(pg_temp.id('s1b7'), 20000, (select t0 from fx) + interval '50 minutes') ->> 'state', 'queued', 'member 3 disagrees');

-- Day 2 at S2: staff S2 records one bill an hour for six hours, then six in one hour
insert into seeded
select 'burst-' || n, pg_temp.r(pg_temp.submit(null, (select staff_s2 from fx), 'member_' || (1 + (n - 1) % 6), (select store_s2 from fx), 'BU-' || n, 60000,
  (select t0 from fx) + interval '1 day' + case when n <= 6 then make_interval(hours => n - 6) else make_interval(hours => 1, mins => n) end))
from generate_series(1, 12) n;
select is((select count(*)::integer from seeded where name like 'burst-%' and outcome = 'awaiting_customer'), 12, 'twelve bills of the burst day');

create temp table report as
select * from public.bill_anomaly_report(array[(select store_s1 from fx), (select store_s2 from fx)], date '2026-11-10', date '2026-11-11') limit 0;
select pg_temp.as_user((select manager_u from fx));
insert into report select * from public.bill_anomaly_report(array[(select store_s1 from fx), (select store_s2 from fx)], date '2026-11-10', date '2026-11-11');
select is((select bills from report where staff_user_id = (select staff_1 from fx)), 12, 'staff 1: twelve bills');
select ok((select flags @> array['peer_outlier', 'disputes', 'disagreements', 'amount_outliers'] from report where staff_user_id = (select staff_1 from fx)),
  'staff 1 is flagged: far above the peer median, a dispute, disagreements and an amount outlier');
select is((select disputes || '/' || disagreements || '/' || amount_outliers from report where staff_user_id = (select staff_1 from fx)), '1/2/1', 'with the counts');
select ok((select flags @> array['one_member', 'audit_failed'] from report where staff_user_id = (select staff_2 from fx)),
  'staff 2 is flagged: one member took most of the bills, and an audit failed');
select is((select count(*)::integer from report where staff_user_id = (select staff_s2 from fx)), 0, 'the manager of S1 does not see S2');
truncate report;
select pg_temp.as_user((select owner_u from fx));
insert into report select * from public.bill_anomaly_report(array[(select store_s1 from fx), (select store_s2 from fx)], date '2026-11-10', date '2026-11-11');
select is((select flags from report where staff_user_id = (select staff_s2 from fx)), array['burst']::text[], 'the owner sees staff S2 flagged only for the burst');
truncate report;
select pg_temp.as_user((select staff_1 from fx));
insert into report select * from public.bill_anomaly_report(array[(select store_s1 from fx)], date '2026-11-10', date '2026-11-11');
select pg_temp.as_user((select viewer_u from fx));
insert into report select * from public.bill_anomaly_report(array[(select store_s1 from fx)], date '2026-11-10', date '2026-11-11');
select is((select count(*)::integer from report), 0, 'staff and viewers get no row');
select ok(exists (select 1 from public.alert_events where tenant_id = (select tenant_t from fx) and rule_key = 'loyalty_staff_anomaly' and facts ->> 'kind' = 'audit_failed'),
  'the failed audit alerted the owners and managers');

-- Shadow check, day 3 at S1: bills SH-1 (an invoice agrees), SH-2 (its invoice differs), SH-3 (no invoice)
insert into seeded
select 'shadow-' || n, pg_temp.r(pg_temp.submit('sh' || n, (select staff_2 from fx), 'member_' || n, (select store_s1 from fx), 'SH-' || n, 60000,
  (select t0 from fx) + interval '2 days'))
from generate_series(1, 3) n;
insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, gross_amount, net_amount, paid_amount)
select tenant_t, store_s1, account_t, 'sh-inv-' || n, 'SH-' || n, t0 + interval '2 days', date '2026-11-12', v, v, v
from fx cross join lateral (values (1, 60000), (2, 90000)) as i (n, v);
select is(app.loyalty_shadow_reconcile((select tenant_t from fx), date '2026-11-12', date '2026-11-12', (select t0 from fx) + interval '2 days 1 hour') ->> 'shadow_flagged', '1',
  'an hour later: one matched, one mismatch, the third not yet judged');
select is(app.loyalty_shadow_reconcile((select tenant_t from fx), date '2026-11-12', date '2026-11-12', (select t0 from fx) + interval '2 days 3 hours') ->> 'shadow_flagged', '1',
  'two hours later the bill without an invoice is flagged too');
select is((select string_agg(bill_no || ':' || shadow_state, ',' order by bill_no) from public.bill_captures where bill_no like 'SH-%'), 'SH-1:matched,SH-2:mismatch,SH-3:no_invoice',
  'matched, mismatch, no_invoice');
select is((select string_agg(state, ',' order by bill_no) from public.bill_captures where bill_no like 'SH-%'), 'awaiting_customer,awaiting_customer,awaiting_customer',
  'the shadow check changes no bill');
update public.loyalty_store_settings set confirmation = 'pos_sync' where store_id = (select store_s1 from fx);
select is((select e.refusal from app.loyalty_earn((select id from public.invoices where external_id = 'sh-inv-1'), pg_temp.id('member_4'), 'A', (select t0 from fx) + interval '3 days') e),
  'already_earned', 'back in pos_sync, path A cannot earn an invoice a bill already stands for');
update public.loyalty_store_settings set confirmation = 'staff' where store_id = (select store_s1 from fx);

-- The store lock serialising the caps and the dedupe key
select pg_temp.as_user((select staff_s2 from fx));
select ok(pg_temp.r(pg_temp.submit(null, (select staff_s2 from fx), 'member_5', (select store_s2 from fx), 'LK-1', 60000, (select t0 from fx) + interval '4 days')) = 'awaiting_customer'
  and exists (
    select 1 from pg_locks l
    where l.locktype = 'advisory' and l.pid = pg_backend_pid() and l.objsubid = 1
      and ((l.classid::bigint << 32) | l.objid::bigint) = (hashtextextended('fnb-bill:' || (select store_s2 from fx)::text, 0) & x'FFFFFFFFFFFFFFFF'::bigint)
  ), 'recording a bill holds the store''s transaction lock, so parallel bills are counted one after another');

-- Erasure
select is((app.erase_loyalty_membership(pg_temp.id('member_1')) ->> 'bill_captures')::integer > 0, true, 'the erasure removes the member''s bills');
select is((select count(*)::integer from public.loyalty_audit_events where membership_id = pg_temp.id('member_1')), 0, 'and blanks the member in the audit trail');

select * from finish();
rollback;
