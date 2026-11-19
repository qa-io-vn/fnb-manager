begin;
select plan(54);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000006401'::uuid as tenant_m,
  'cccccccc-cccc-4ccc-8ccc-000000006401'::uuid as account_m,
  'ffffffff-ffff-4fff-8fff-000000006401'::uuid as store_m1,
  'ffffffff-ffff-4fff-8fff-000000006402'::uuid as store_m2,
  'aaaaaaaa-aaaa-4aaa-8aaa-000000006401'::uuid as programme_m,
  'eeeeeeee-eeee-4eee-8eee-000000006401'::uuid as owner_m,
  'eeeeeeee-eeee-4eee-8eee-000000006402'::uuid as manager_m1,
  'eeeeeeee-eeee-4eee-8eee-000000006403'::uuid as manager_m2,
  'eeeeeeee-eeee-4eee-8eee-000000006404'::uuid as staff_m1,
  'eeeeeeee-eeee-4eee-8eee-000000006405'::uuid as viewer_m,
  timestamptz '2026-11-10 10:00+07' as t0;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'loyalty-matching-' || right(u.id::text, 4) || '@example.com'
from fx cross join lateral unnest(array[fx.owner_m, fx.manager_m1, fx.manager_m2, fx.staff_m1, fx.viewer_m]) as u (id);

insert into public.tenants (id, slug, name) select tenant_m, 'loyalty-matching-pgtap', 'Loyalty matching pgTAP' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) select account_m, tenant_m, 'mock', 'loyalty-matching', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name, tran_no_reset_period)
select store_m1, tenant_m, account_m, 'lm-1', 'Synthetic store 1', 'daily'::public.tran_no_reset_period from fx
union all
select store_m2, tenant_m, account_m, 'lm-2', 'Synthetic store 2', 'yearly' from fx;
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_m, m.user_id, m.role::public.tenant_role, m.store_ids
from fx cross join lateral (
  values (fx.owner_m, 'owner', null::uuid[]), (fx.manager_m1, 'manager', array[fx.store_m1]), (fx.manager_m2, 'manager', array[fx.store_m2]),
         (fx.staff_m1, 'staff', array[fx.store_m1]), (fx.viewer_m, 'viewer', null::uuid[])
) as m (user_id, role, store_ids);

insert into public.loyalty_programmes (id, tenant_id, name, starts_on, notification_decision, status)
select programme_m, tenant_m, 'Synthetic programme', date '2026-11-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status from fx;

create temp table ids (name text primary key, id uuid);
insert into ids
select 'customer_' || n, app.loyalty_customer_for_phone((select tenant_m from fx), '+849000064' || lpad(n::text, 2, '0'), timestamptz '2026-11-01 08:00+07')
from generate_series(1, 9) n;
insert into ids
select 'member_' || n, app.loyalty_join((select tenant_m from fx), (select id from ids where name = 'customer_' || n), 'mini_app', (select store_m1 from fx), null, null, timestamptz '2026-11-01 09:00+07')
from generate_series(1, 8) n;

create function pg_temp.invoice(p_name text, p_store uuid, p_sold timestamptz, p_net numeric, p_receipt text default null, p_phone text default null, p_customer uuid default null, p_voucher text default null)
returns uuid
language sql
as $$
  with inserted as (
    insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, gross_amount, net_amount, paid_amount, customer_phone, customer_id, voucher_code)
    select fx.tenant_m, p_store, fx.account_m, 'lm-' || p_name, p_receipt, p_sold, (p_sold at time zone 'Asia/Ho_Chi_Minh')::date, p_net, p_net, p_net, p_phone, p_customer, p_voucher
    from fx
    returning id
  )
  insert into ids (name, id)
  select p_name, inserted.id from inserted
  returning id;
$$;

create function pg_temp.reconcile(p_at timestamptz)
returns jsonb
language sql
as $$
  select app.reconcile_loyalty((select tenant_m from fx), date '2026-11-01', date '2026-11-20', p_at);
$$;

create function pg_temp.earn_of(p_invoice text)
returns text
language sql
as $$
  select coalesce(string_agg(concat_ws(':', l.matched_path, m.name), ','), 'none')
  from public.loyalty_ledger l
  join ids m on m.id = l.membership_id
  where l.entry_kind = 'earn' and l.invoice_id = (select id from ids where name = p_invoice);
$$;

create function pg_temp.outcome_as(p_user uuid, p_statement text)
returns text
language plpgsql
as $$
declare
  v_value text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute p_statement into v_value;
  return coalesce(v_value, 'null');
exception when others then
  return sqlstate;
end;
$$;

select pg_temp.invoice('a_customer', (select store_m1 from fx), timestamptz '2026-11-10 08:00+07', 60000, '0001', null, (select id from ids where name = 'customer_1'));
select pg_temp.invoice('a_phone', (select store_m1 from fx), timestamptz '2026-11-10 08:10+07', 55000, '0002', '0900006402');
select pg_temp.invoice('a_stranger', (select store_m1 from fx), timestamptz '2026-11-10 08:20+07', 55000, '0003', '0900006499');
select is((pg_temp.reconcile(timestamptz '2026-11-10 08:30+07') ->> 'a_earned')::int, 2, 'path A earns two invoices');
select is(pg_temp.earn_of('a_customer'), 'A:member_1', 'path A matches the customer attached to the invoice');
select is(pg_temp.earn_of('a_phone'), 'A:member_2', 'path A matches a national phone number to the member''s E.164 phone');
select is(pg_temp.earn_of('a_stranger'), 'none', 'a phone without a membership earns nothing');

insert into ids select 'code_3', c.checkin_id from app.loyalty_issue_checkin_code((select id from ids where name = 'member_3'), (select store_m1 from fx), (select t0 from fx)) c;
select is(
  (select concat_ws(':', status, length(code), expires_at - created_at) from public.pending_checkins where id = (select id from ids where name = 'code_3')),
  'issued:6:00:02:00',
  'a check-in code has six digits and lives for two minutes'
);
select is(
  app.loyalty_record_checkin((select store_m1 from fx), (select code from public.pending_checkins where id = (select id from ids where name = 'code_3')), (select staff_m1 from fx), 65000, (select t0 from fx) + interval '30 seconds'),
  (select id from ids where name = 'code_3'),
  'staff record the live code with the bill amount'
);
select is((select status::text from public.pending_checkins where id = (select id from ids where name = 'code_3')), 'recorded', 'without its invoice the check-in waits');
select is((select requests from app.loyalty_fast_lane_runs where store_id = (select store_m1 from fx)), 1, 'and a fast-lane run is requested for the store');
select pg_temp.invoice('b_far', (select store_m1 from fx), (select t0 from fx) + interval '6 minutes', 40000, '0010');
select pg_temp.invoice('b_close', (select store_m1 from fx), (select t0 from fx) + interval '9 minutes', 65000, '0011');
select is((pg_temp.reconcile((select t0 from fx) + interval '20 minutes') ->> 'b_matched')::int, 1, 'the reconciliation matches the check-in');
select is(pg_temp.earn_of('b_close'), 'B:member_3', 'path B takes the invoice with the closest amount and records B');
select is(
  (select concat_ws(':', c.status, c.matched_invoice_id = (select id from ids where name = 'b_close')) from public.pending_checkins c where c.id = (select id from ids where name = 'code_3')),
  'matched:t',
  'the check-in is closed with its invoice'
);
select throws_ok(
  format('select app.loyalty_record_checkin(%L, %L)', (select store_m1 from fx), (select code from public.pending_checkins where id = (select id from ids where name = 'code_3'))),
  '22023', null,
  'a used code cannot be recorded again'
);

create function pg_temp.window_case(p_member text, p_at timestamptz, p_offset interval, p_store uuid)
returns text
language plpgsql
as $$
declare
  v_checkin uuid;
  v_code text;
begin
  select c.checkin_id, c.code into v_checkin, v_code from app.loyalty_issue_checkin_code((select id from ids where name = p_member), p_store, p_at - interval '1 minute') c;
  perform pg_temp.invoice('w_' || p_member, p_store, p_at + p_offset, 52000, null);
  perform app.loyalty_record_checkin(p_store, v_code, null, null, p_at);
  return (select status::text from public.pending_checkins where id = v_checkin);
end;
$$;

select is(pg_temp.window_case('member_4', timestamptz '2026-11-11 09:00+07', interval '-2 minutes', (select store_m1 from fx)), 'matched', 'an invoice exactly two minutes before the check-in matches');
select is(pg_temp.window_case('member_5', timestamptz '2026-11-11 11:00+07', interval '-2 minutes -1 second', (select store_m1 from fx)), 'recorded', 'one second earlier does not');
select is(pg_temp.window_case('member_6', timestamptz '2026-11-11 13:00+07', interval '15 minutes', (select store_m1 from fx)), 'matched', 'an invoice exactly fifteen minutes after matches');
select is(pg_temp.window_case('member_7', timestamptz '2026-11-11 15:00+07', interval '15 minutes 1 second', (select store_m1 from fx)), 'recorded', 'an invoice fifteen minutes and one second after is outside the window');
select is(
  (select row(r ->> 'b_matched', r ->> 'b_pending')::text from pg_temp.reconcile(timestamptz '2026-11-11 16:00+07') r),
  '(0,2)',
  'so the reconciliation matches neither check-in outside the window'
);
select is(pg_temp.earn_of('w_member_5') || '|' || pg_temp.earn_of('w_member_7'), 'none|none', 'and they earn nothing');
select is((pg_temp.reconcile(timestamptz '2026-11-12 15:30+07') ->> 'expired_checkins')::int, 2, 'recorded check-ins without an invoice expire after the pending hours');

insert into ids select 'code_8', c.checkin_id from app.loyalty_issue_checkin_code((select id from ids where name = 'member_8'), (select store_m2 from fx), timestamptz '2026-11-12 10:00+07') c;
select pg_temp.invoice('q_1', (select store_m2 from fx), timestamptz '2026-11-12 10:03+07', 48000, '0101');
select pg_temp.invoice('q_2', (select store_m2 from fx), timestamptz '2026-11-12 10:05+07', 72000, '0102');
select app.loyalty_record_checkin((select store_m2 from fx), (select code from public.pending_checkins where id = (select id from ids where name = 'code_8')), null, null, timestamptz '2026-11-12 10:01+07');
select is((select status::text from public.pending_checkins where id = (select id from ids where name = 'code_8')), 'queued', 'two candidates without an amount go to the manager queue');
select is(
  (select concat_ws(':', reason, matched_path, cardinality(candidate_invoice_ids), state) from public.loyalty_queue where checkin_id = (select id from ids where name = 'code_8')),
  'two_candidates:B:2:open',
  'the queue lists the double-candidate case'
);
select is(pg_temp.earn_of('q_1') || '|' || pg_temp.earn_of('q_2'), 'none|none', 'and nothing is guessed');

insert into ids select 'queue_8', q.id from public.loyalty_queue q where q.checkin_id = (select id from ids where name = 'code_8');
grant select on fx, ids to authenticated;
set local role authenticated;
select is(pg_temp.outcome_as((select manager_m2 from fx), 'select count(*)::text from public.loyalty_queue'), '1', 'a manager of the store reads the queue');
select is(pg_temp.outcome_as((select staff_m1 from fx), 'select count(*)::text from public.loyalty_queue'), '0', 'staff read no queue item');
select is(pg_temp.outcome_as((select viewer_m from fx), 'select count(*)::text from public.loyalty_queue'), '0', 'a viewer reads no queue item');
select is(
  pg_temp.outcome_as((select staff_m1 from fx), format('select public.resolve_loyalty_queue_item(%L, %L, %L)::text', (select id from ids where name = 'queue_8'), (select id from ids where name = 'q_2'), 'customer showed the receipt')),
  '42501',
  'staff cannot resolve a queue item'
);
select is(
  pg_temp.outcome_as((select manager_m1 from fx), format('select public.resolve_loyalty_queue_item(%L, %L, %L)::text', (select id from ids where name = 'queue_8'), (select id from ids where name = 'q_2'), 'customer showed the receipt')),
  '42501',
  'nor can a manager of another store'
);
select is(
  pg_temp.outcome_as((select manager_m2 from fx), format('select public.resolve_loyalty_queue_item(%L, %L, %L)::text', (select id from ids where name = 'queue_8'), (select id from ids where name = 'b_close'), 'not a candidate')),
  '22023',
  'the choice is one of the candidates'
);
select is(
  pg_temp.outcome_as((select manager_m2 from fx), format('select public.resolve_loyalty_queue_item(%L, %L, %L) ->> %L', (select id from ids where name = 'queue_8'), (select id from ids where name = 'q_2'), 'customer showed the receipt', 'state')),
  'resolved',
  'a manager of the store resolves it'
);
reset role;
select is(pg_temp.earn_of('q_2'), 'B:member_8', 'the chosen invoice earns on path B');
select is(
  (select l.approved_by = (select manager_m2 from fx) from public.loyalty_ledger l where l.invoice_id = (select id from ids where name = 'q_2') and l.entry_kind = 'earn'),
  true,
  'with the manager as approver'
);
select is((select status::text from public.pending_checkins where id = (select id from ids where name = 'code_8')), 'matched', 'and the check-in is matched');

select is(
  (select concat_ws(':', status, coalesce(reason, '-')) from app.loyalty_submit_claim((select id from ids where name = 'member_4'), (select store_m1 from fx), date '2026-11-13', '0042', 70000, timestamptz '2026-11-13 12:00+07')),
  'pending:-',
  'a claim before its invoice is synced waits'
);
select is(
  (select concat_ws(':', status, reason) from app.loyalty_submit_claim((select id from ids where name = 'member_5'), (select store_m1 from fx), date '2026-11-13', '42', 70000, timestamptz '2026-11-13 12:05+07')),
  'rejected:already_claimed',
  'the same receipt claimed by a second phone is rejected, leading zeros aside'
);
select pg_temp.invoice('c_receipt', (select store_m1 from fx), timestamptz '2026-11-13 11:40+07', 70000, '0042');
select is((pg_temp.reconcile(timestamptz '2026-11-13 12:30+07') ->> 'c_matched')::int, 1, 'the reconciliation matches the claim once the invoice is synced');
select is(pg_temp.earn_of('c_receipt'), 'C:member_4', 'path C credits the claimant and records C');
select is(
  (select concat_ws(':', status, reason) from app.loyalty_submit_claim((select id from ids where name = 'member_4'), (select store_m1 from fx), date '2026-11-13', '0042', 70000, timestamptz '2026-11-13 13:00+07')),
  'rejected:already_claimed',
  'a receipt claimed twice is rejected'
);
select pg_temp.invoice('c_synced', (select store_m1 from fx), timestamptz '2026-11-13 12:40+07', 88000, '0043');
select is(
  (select concat_ws(':', status, coalesce(reason, '-'), entry_id is not null) from app.loyalty_submit_claim((select id from ids where name = 'member_6'), (select store_m1 from fx), date '2026-11-13', '0043', 88000, timestamptz '2026-11-13 13:00+07')),
  'matched:-:t',
  'a claim of an invoice already synced matches at once'
);
select pg_temp.invoice('c_amount', (select store_m1 from fx), timestamptz '2026-11-13 12:45+07', 91000, '0044');
select is(
  (select concat_ws(':', status, reason) from app.loyalty_submit_claim((select id from ids where name = 'member_7'), (select store_m1 from fx), date '2026-11-13', '0044', 19000, timestamptz '2026-11-13 13:00+07')),
  'rejected:amount_mismatch',
  'a claim needs the exact amount'
);
select is(
  (select string_agg(concat_ws(':', c.status, coalesce(c.reason, '-')), ',') from unnest(array['0098', '0097']) r (receipt)
   cross join lateral app.loyalty_submit_claim((select id from ids where name = 'member_7'), (select store_m1 from fx), date '2026-11-13', r.receipt, 55000, timestamptz '2026-11-13 13:00+07') c),
  'pending:-,pending:-',
  'the same phone files a second and a third claim that day'
);
select is(
  (select concat_ws(':', status, reason) from app.loyalty_submit_claim((select id from ids where name = 'member_7'), (select store_m1 from fx), date '2026-11-13', '0099', 55000, timestamptz '2026-11-13 13:00+07')),
  'rejected:daily_cap',
  'at most three claims a phone a day'
);
select is(
  (select concat_ws(':', status, reason) from app.loyalty_submit_claim((select id from ids where name = 'member_8'), (select store_m1 from fx), date '2026-11-09', '0001', 60000, timestamptz '2026-11-13 13:00+07')),
  'rejected:outside_window',
  'a receipt older than 72 hours cannot be claimed'
);
select is(
  (select concat_ws(':', status, reason) from app.loyalty_submit_claim((select id from ids where name = 'member_8'), (select store_m1 from fx), date '2026-11-10', '0002', 55000, timestamptz '2026-11-12 13:00+07')),
  'rejected:already_earned',
  'a receipt that already earned on another path is rejected'
);
select pg_temp.invoice('c_dup_1', (select store_m2 from fx), timestamptz '2026-11-13 09:00+07', 45000, '7');
select pg_temp.invoice('c_dup_2', (select store_m2 from fx), timestamptz '2026-11-13 18:00+07', 45000, '7');
select is(
  (select concat_ws(':', status, coalesce(reason, '-')) from app.loyalty_submit_claim((select id from ids where name = 'member_8'), (select store_m2 from fx), date '2026-11-13', '7', 45000, timestamptz '2026-11-13 19:00+07')),
  'queued:-',
  'two invoices with the same receipt number and amount go to the queue'
);
select is(
  (select concat_ws(':', status, coalesce(reason, '-')) from app.loyalty_submit_claim((select id from ids where name = 'member_1'), (select store_m2 from fx), date '2026-11-13', '0500', 45000, timestamptz '2026-11-13 19:00+07')),
  'pending:-',
  'a claim of an unknown receipt waits'
);
select is((pg_temp.reconcile(timestamptz '2026-11-16 19:00+07') ->> 'expired_claims')::int, 3, 'pending claims expire when their window ends');
select is((select reason from public.receipt_claims where receipt_no = '0500'), 'no_matching_invoice', 'the expired claim says why');

insert into ids select 'code_expired', c.checkin_id from app.loyalty_issue_checkin_code((select id from ids where name = 'member_1'), (select store_m1 from fx), timestamptz '2026-11-17 10:00+07') c;
select throws_ok(
  format('select app.loyalty_record_checkin(%L, %L, null, null, %L)', (select store_m1 from fx), (select code from public.pending_checkins where id = (select id from ids where name = 'code_expired')), timestamptz '2026-11-17 10:03+07'),
  '22023', null,
  'an expired code cannot be recorded'
);
select is((pg_temp.reconcile(timestamptz '2026-11-17 10:05+07') ->> 'expired_codes')::int, 1, 'the reconciliation expires stale codes');

insert into public.coupons (tenant_id, programme_id, reward_key, name, cost_stamps)
select tenant_m, programme_m, 'free-drink', 'Free drink', 8 from fx;
insert into public.redemptions (tenant_id, store_id, membership_id, coupon_id, code, held_at, hold_expires_at)
select fx.tenant_m, fx.store_m1, m.id, c.id, 'SYN-D1', timestamptz '2026-11-18 09:00+07', timestamptz '2026-11-19 09:00+07'
from fx, ids m, public.coupons c where m.name = 'member_2' and c.tenant_id = fx.tenant_m;
select pg_temp.invoice('d_voucher', (select store_m1 from fx), timestamptz '2026-11-18 09:30+07', 51000, '0201', null, null, ' syn-d1 ');
select is((pg_temp.reconcile(timestamptz '2026-11-18 10:00+07') ->> 'd_earned')::int, 1, 'path D earns the invoice carrying the member''s voucher');
select is(pg_temp.earn_of('d_voucher'), 'D:member_2', 'and records D');
select is((select state::text from public.redemptions where code = 'SYN-D1'), 'confirmed', 'the redemption is confirmed by the synced invoice');

create temp table rows_before as
select (select count(*) from public.loyalty_ledger where tenant_id = (select tenant_m from fx)) as ledger,
       (select count(*) from public.loyalty_queue where tenant_id = (select tenant_m from fx)) as queue;
select is(
  (pg_temp.reconcile(timestamptz '2026-11-18 11:00+07') - 'expired_codes' - 'expired_checkins' - 'expired_claims' - array['callback_confirmed', 'callback_earned', 'pool_codes_used', 'rail_evidence']),
  '{"a_earned": 0, "b_queued": 0, "c_queued": 0, "d_earned": 0, "a_refused": 0, "b_matched": 0, "b_pending": 0, "c_matched": 0, "c_pending": 0, "d_refused": 0, "b_rejected": 0, "c_rejected": 0, "d_confirmed": 0, "discount_earned": 0, "mismatch_alerts": 0, "mismatches_found": 0, "discount_confirmed": 0}'::jsonb,
  're-running the reconciliation finds nothing to do'
);
select is(
  (select row((select count(*) from public.loyalty_ledger where tenant_id = (select tenant_m from fx)), (select count(*) from public.loyalty_queue where tenant_id = (select tenant_m from fx)))::text),
  (select row(ledger, queue)::text from rows_before),
  'and adds no row'
);

select * from finish();
rollback;
