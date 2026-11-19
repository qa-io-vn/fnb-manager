-- ISTQB boundary value analysis on the loyalty time windows, with SQL as the
-- unit under test: the check-in code TTL (120 s), the check-in matching window
-- (2 minutes before to 15 minutes after the recording), the receipt claim
-- window (72 hours, counted in business dates) and the claim expiry (72 hours).
-- Each boundary x is tested at x - 1, x and x + 1 of its unit.
begin;
select plan(20);

update app.incremental_sync_settings set enabled = false, updated_at = '2026-01-01 00:00+00';

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000013101'::uuid as tenant_w,
  'cccccccc-cccc-4ccc-8ccc-000000013101'::uuid as account_w,
  'ffffffff-ffff-4fff-8fff-000000013101'::uuid as store_w,
  timestamptz '2026-11-10 10:00+07' as t0;

insert into public.tenants (id, slug, name) select tenant_w, 'loyalty-window-bva-pgtap', 'Loyalty window boundaries pgTAP' from fx;
insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name) select account_w, tenant_w, 'mock', 'loyalty-window-bva', 'Synthetic account' from fx;
insert into public.stores (id, tenant_id, pos_account_id, external_id, name, business_day_start_minutes) select store_w, tenant_w, account_w, 'wbva-1', 'Synthetic store', 0 from fx;
insert into public.loyalty_programmes (tenant_id, name, starts_on, notification_decision, status, welcome_stamps)
select tenant_w, 'Synthetic programme', date '2026-11-01', 'below_threshold'::public.loyalty_notification_decision, 'active'::public.loyalty_programme_status, 0 from fx;

select is(
  (select concat_ws(':', checkin_code_ttl_seconds, checkin_window_before_minutes, checkin_window_after_minutes, receipt_claim_window_hours)
   from public.loyalty_programmes where tenant_id = (select tenant_w from fx)),
  '120:2:15:72',
  'the boundaries tested below are the programme defaults: TTL 120 s, window -2/+15 minutes, claims 72 hours'
);

create temp table ids (name text primary key, id uuid);
insert into ids
select 'member_' || n,
  app.loyalty_join(fx.tenant_w, app.loyalty_customer_for_phone(fx.tenant_w, '0900000' || (400 + n)::text, fx.t0 - interval '2 days'), 'mini_app', fx.store_w, null, null, fx.t0 - interval '2 days')
from fx cross join generate_series(1, 16) n;

create function pg_temp.member(p_name text) returns uuid language sql as $$ select id from ids where name = p_name; $$;

create function pg_temp.issue(p_member text, p_at timestamptz)
returns text
language sql
as $$
  with issued as (
    select c.checkin_id, c.code from app.loyalty_issue_checkin_code(pg_temp.member(p_member), (select store_w from fx), p_at) c
  )
  insert into ids (name, id) select 'checkin_' || p_member, issued.checkin_id from issued
  returning (select code from public.pending_checkins where id = ids.id);
$$;

create function pg_temp.record(p_member text, p_at timestamptz)
returns text
language plpgsql
as $$
begin
  perform app.loyalty_record_checkin(
    (select store_w from fx),
    (select code from public.pending_checkins where id = (select id from ids where name = 'checkin_' || p_member)),
    null, null, p_at
  );
  return 'recorded';
exception when others then
  return sqlstate;
end;
$$;

create function pg_temp.invoice(p_name text, p_sold timestamptz, p_net numeric, p_receipt text default null)
returns uuid
language sql
as $$
  with inserted as (
    insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, receipt_no, sold_at, business_date, gross_amount, net_amount, paid_amount)
    select fx.tenant_w, fx.store_w, fx.account_w, 'wbva-' || p_name, p_receipt, p_sold, app.store_business_date(fx.store_w, p_sold), p_net, p_net, p_net
    from fx
    returning id
  )
  insert into ids (name, id) select p_name, inserted.id from inserted
  returning id;
$$;

-- Check-in code TTL: checkin_code_ttl_seconds = 120; a code is recorded while expires_at > now.
select pg_temp.issue('member_' || n, (select t0 from fx)) from generate_series(1, 3) n;
select is(pg_temp.record('member_1', (select t0 from fx) + interval '119 seconds'), 'recorded', 'BVA code TTL x - 1 (119 s): the code is recorded');
select is(pg_temp.record('member_2', (select t0 from fx) + interval '120 seconds'), '22023', 'BVA code TTL x (120 s): the code has expired and is refused');
select is(pg_temp.record('member_3', (select t0 from fx) + interval '121 seconds'), '22023', 'BVA code TTL x + 1 (121 s): refused');

-- Check-in matching window: invoices sold from 2 minutes before to 15 minutes after the recording.
create function pg_temp.window_case(p_member text, p_hour integer, p_offset interval)
returns text
language plpgsql
as $$
declare
  v_recorded timestamptz := (select t0 from fx) + make_interval(hours => p_hour);
begin
  perform pg_temp.issue(p_member, v_recorded - interval '30 seconds');
  perform pg_temp.record(p_member, v_recorded);
  perform pg_temp.invoice('window_' || p_member, v_recorded + p_offset, 61000);
  return app.loyalty_match_checkin((select id from ids where name = 'checkin_' || p_member), v_recorded + interval '20 minutes');
end;
$$;

select is(pg_temp.window_case('member_4', 1, interval '-3 minutes'), 'pending', 'BVA check-in window before, x + 1 (sold 3 minutes before): outside, the check-in stays pending');
select is(pg_temp.window_case('member_5', 2, interval '-2 minutes'), 'matched', 'BVA check-in window before, x (sold 2 minutes before): matched');
select is(pg_temp.window_case('member_6', 3, interval '-1 minute'), 'matched', 'BVA check-in window before, x - 1 (sold 1 minute before): matched');
select is(pg_temp.window_case('member_7', 4, interval '14 minutes'), 'matched', 'BVA check-in window after, x - 1 (sold 14 minutes after): matched');
select is(pg_temp.window_case('member_8', 5, interval '15 minutes'), 'matched', 'BVA check-in window after, x (sold 15 minutes after): matched');
select is(pg_temp.window_case('member_9', 6, interval '16 minutes'), 'pending', 'BVA check-in window after, x + 1 (sold 16 minutes after): outside, pending');
select is(
  (select string_agg(l.matched_path || ':' || i.name, ',' order by i.name) from public.loyalty_ledger l join ids i on i.id = l.invoice_id where l.entry_kind = 'earn'),
  'B:window_member_5,B:window_member_6,B:window_member_7,B:window_member_8',
  'only the four invoices inside the window earned, each on path B'
);

-- Receipt claim window: a business date no older than the business date 72 hours ago.
-- For business date 2026-11-10 the boundary x is 2026-11-14 00:00 +07 (the start of 2026-11-11 plus 72 hours).
create function pg_temp.claim(p_member text, p_date date, p_receipt text, p_at timestamptz)
returns text
language plpgsql
as $$
declare
  v_claim record;
begin
  select c.claim_id, c.status, c.reason into v_claim
  from app.loyalty_submit_claim(pg_temp.member(p_member), (select store_w from fx), p_date, p_receipt, 61000, p_at) c;
  insert into ids (name, id) values ('claim_' || p_receipt, v_claim.claim_id);
  return concat_ws(':', v_claim.status, v_claim.reason);
end;
$$;

select is(pg_temp.claim('member_10', date '2026-11-10', 'W1', timestamptz '2026-11-13 23:59+07'), 'pending', 'BVA claim window x - 1 minute: a receipt of 2026-11-10 is accepted and waits for its invoice');
select is(pg_temp.claim('member_11', date '2026-11-10', 'W2', timestamptz '2026-11-14 00:00+07'), 'rejected:outside_window', 'BVA claim window x: refused outside_window');
select is(pg_temp.claim('member_12', date '2026-11-10', 'W3', timestamptz '2026-11-14 00:01+07'), 'rejected:outside_window', 'BVA claim window x + 1 minute: refused outside_window');
select is(pg_temp.claim('member_13', date '2026-11-10', 'W4', (select t0 from fx)), 'pending', 'BVA claim window upper end x (today''s business date): accepted');
select is(pg_temp.claim('member_13', date '2026-11-11', 'W5', (select t0 from fx)), 'rejected:outside_window', 'BVA claim window upper end x + 1 (tomorrow''s business date): refused outside_window');

-- Claim expiry: a pending claim expires receipt_claim_window_hours after it was submitted.
select pg_temp.claim('member_14', date '2026-11-10', 'W6', (select t0 from fx));
select pg_temp.claim('member_15', date '2026-11-10', 'W7', (select t0 from fx));
select is(app.loyalty_match_claim((select id from ids where name = 'claim_W6'), (select t0 from fx) + interval '72 hours' - interval '1 minute'), 'pending', 'BVA claim expiry x - 1 minute: still pending');
select is(app.loyalty_match_claim((select id from ids where name = 'claim_W6'), (select t0 from fx) + interval '72 hours'), 'expired', 'BVA claim expiry x (72 hours): expired, no_matching_invoice');
select is(app.loyalty_match_claim((select id from ids where name = 'claim_W7'), (select t0 from fx) + interval '72 hours' + interval '1 minute'), 'expired', 'BVA claim expiry x + 1 minute: expired');
select pg_temp.invoice('late_receipt', (select t0 from fx) - interval '1 hour', 61000, 'W6');
select is(app.loyalty_match_claim((select id from ids where name = 'claim_W6'), (select t0 from fx) + interval '73 hours'), 'expired', 'an expired claim stays expired when its invoice arrives later');

select * from finish();
rollback;
