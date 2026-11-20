begin;
select plan(24);

create temp table fx as
select
  'ffffffff-ffff-4fff-8fff-000181000001'::uuid as tenant_1,
  'ffffffff-ffff-4fff-8fff-000181000002'::uuid as tenant_quiet,
  'ffffffff-ffff-4fff-8fff-000181000101'::uuid as owner_1,
  'ffffffff-ffff-4fff-8fff-000181000102'::uuid as owner_quiet,
  'ffffffff-ffff-4fff-8fff-000181000201'::uuid as account_1,
  'ffffffff-ffff-4fff-8fff-000181000202'::uuid as account_quiet,
  'ffffffff-ffff-4fff-8fff-000181000301'::uuid as s1,
  'ffffffff-ffff-4fff-8fff-000181000302'::uuid as s_late,
  'ffffffff-ffff-4fff-8fff-000181000303'::uuid as s_quiet;

create temp table outside_counts as
select
  (select count(*) from public.alert_events where tenant_id not in (select tenant_1 from fx union all select tenant_quiet from fx)) as episodes,
  (select count(*) from public.outbound_messages where tenant_id not in (select tenant_1 from fx union all select tenant_quiet from fx)) as messages;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', u.email
from fx cross join lateral (values (fx.owner_1, 'intraday-owner-1@example.com'), (fx.owner_quiet, 'intraday-owner-q@example.com')) as u (id, email);

insert into public.tenants (id, slug, name, timezone)
select tenant_1, 'notify-it-pgtap-intraday-1', 'Notify pgTAP intraday 1', 'Asia/Ho_Chi_Minh' from fx
union all
select tenant_quiet, 'notify-it-pgtap-intraday-q', 'Notify pgTAP intraday quiet', 'Asia/Ho_Chi_Minh' from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_1, owner_1, 'owner'::public.tenant_role, null::uuid[] from fx
union all
select tenant_quiet, owner_quiet, 'owner'::public.tenant_role, null::uuid[] from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_1, tenant_1, 'mock', 'intraday-pgtap-account-1', 'Synthetic account 1' from fx
union all
select account_quiet, tenant_quiet, 'mock', 'intraday-pgtap-account-q', 'Synthetic account quiet' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name, timezone, business_day_start_minutes, opening_hours)
select v.id, v.tenant_id, v.account_id, v.external_id, v.name, v.zone, v.day_start, v.hours::jsonb
from fx
cross join lateral (
  values
    (fx.s1, fx.tenant_1, fx.account_1, 's1', 'Synthetic store 1', 'Asia/Ho_Chi_Minh', 0,
      '{"mon": [["07:00", "22:00"]], "tue": [["07:00", "22:00"]], "wed": [["07:00", "22:00"]], "thu": [["07:00", "22:00"]], "fri": [["07:00", "22:00"]], "sat": [["07:00", "22:00"]], "sun": [["07:00", "22:00"]]}'),
    (fx.s_late, fx.tenant_1, fx.account_1, 's-late', 'Synthetic late store', 'Europe/Berlin', 300,
      '{"mon": [["00:00", "24:00"]], "tue": [["00:00", "24:00"]], "wed": [["00:00", "24:00"]], "thu": [["00:00", "24:00"]], "fri": [["00:00", "24:00"]], "sat": [["00:00", "24:00"]], "sun": [["00:00", "24:00"]]}'),
    (fx.s_quiet, fx.tenant_quiet, fx.account_quiet, 's-quiet', 'Synthetic quiet store', 'Asia/Ho_Chi_Minh', 0,
      '{"mon": [["07:00", "22:00"]], "tue": [["07:00", "22:00"]], "wed": [["07:00", "22:00"]], "thu": [["07:00", "22:00"]], "fri": [["07:00", "22:00"]], "sat": [["07:00", "22:00"]], "sun": [["07:00", "22:00"]]}')
) as v (id, tenant_id, account_id, external_id, name, zone, day_start, hours);

insert into public.sync_checks (tenant_id, store_id, business_date)
select s.tenant_id, s.id, d.day::date
from public.stores s
cross join generate_series('2026-10-01'::date, '2026-11-19'::date, interval '1 day') as d (day)
where s.id in (select s1 from fx union all select s_late from fx union all select s_quiet from fx);

insert into public.notification_channels (tenant_id, kind, provider, label, user_id, address, secret_name, status, linked_at, consent_record_id)
select tenant_1, 'zalo_bot', 'zalo_bot', 'owner zalo', owner_1, 'synthetic-chat-181', 'NOTIFY_ZALO_BOT_TOKEN_IT', 'active', '2026-11-01 00:00+00',
  app.ensure_notifications_consent(tenant_1, owner_1, 'zalo_bot', '{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, '2026-11-01 00:00+00')
from fx;

insert into public.sync_runs (tenant_id, pos_account_id, store_id, store_ids, kind, range_start, range_end, started_at, finished_at, status)
select fx.tenant_1, fx.account_1, s.id, array[s.id], 'incremental'::public.sync_kind, '2026-11-20'::date, '2026-11-20'::date, f.at - interval '1 minute', f.at, 'succeeded'::public.sync_status
from fx
cross join lateral (values (fx.s1), (fx.s_late)) as s (id)
cross join lateral (values ('2026-11-20 01:50+00'::timestamptz), ('2026-11-20 02:51+00'::timestamptz)) as f (at)
union all
select fx.tenant_quiet, fx.account_quiet, fx.s_quiet, array[fx.s_quiet], 'incremental'::public.sync_kind, '2026-11-20'::date, '2026-11-20'::date, '2026-11-20 02:50+00', '2026-11-20 02:51+00', 'succeeded'::public.sync_status from fx
union all
select fx.tenant_1, fx.account_1, null::uuid, null::uuid[], 'nightly'::public.sync_kind, '2026-11-18'::date, '2026-11-18'::date, '2026-11-19 19:50+00', '2026-11-19 20:00+00', 'succeeded'::public.sync_status from fx;

update public.stores set opening_hours = null where id = (select s_late from fx);

create function pg_temp.reading(p_at timestamptz)
returns integer
language plpgsql
as $$
declare
  counted integer;
begin
  delete from public.alert_events where tenant_id = (select tenant_1 from fx) and rule_key in ('zero_sales_open', 'nightly_missing');
  counted := app.evaluate_intraday_rules(p_at, (select tenant_1 from fx));
  return counted;
end;
$$;

select is(pg_temp.reading('2026-11-20 03:00+00'), 1, 'zero_sales_open: every condition holds at 10:00 local, one reading');
select is(
  (select dedupe_key from public.alert_events where tenant_id = (select tenant_1 from fx) and state = 'open'),
  'zero_sales_open:store:' || (select s1 from fx)::text || ':2026-11-20',
  'the episode is keyed by store and business date'
);
select is(app.evaluate_intraday_rules('2026-11-20 03:05+00', (select tenant_1 from fx)), 0, 'an open episode of the key is left alone');

select is(pg_temp.reading('2026-11-20 01:59+00'), 0, 'boundary: 119 open minutes is below the 120-minute minimum');
select is(pg_temp.reading('2026-11-20 02:00+00'), 1, 'boundary: 120 open minutes reaches the minimum');
select is(pg_temp.reading('2026-11-20 16:00+00'), 0, 'a closed store (23:00 local) gives no reading');
select is(pg_temp.reading('2026-11-20 03:36+00'), 1, 'boundary: a sync exactly 45 minutes old is still fresh');
select is(pg_temp.reading('2026-11-20 03:37+00'), 0, 'boundary: a sync 46 minutes old is stale and gives no reading');

update public.stores set opening_hours = null where id = (select s1 from fx);
select is(pg_temp.reading('2026-11-20 03:00+00'), 0, 'unknown opening hours give no reading');
update public.stores s set opening_hours = (select opening_hours from public.stores where id = (select s_quiet from fx)) where s.id = (select s1 from fx);

insert into public.holidays (tenant_id, country_code, holiday_date, name, kind)
select tenant_1, 'VN', '2026-11-20', 'Synthetic holiday', 'custom' from fx;
select is(pg_temp.reading('2026-11-20 03:00+00'), 0, 'an excluded day gives no reading while skip_holidays is on');
delete from public.holidays where tenant_id = (select tenant_1 from fx);

delete from public.sync_checks where store_id = (select s1 from fx) and business_date < '2026-10-24';
select is(pg_temp.reading('2026-11-20 03:00+00'), 0, 'too little checked history (27 days) gives no reading');
insert into public.sync_checks (tenant_id, store_id, business_date)
select tenant_1, s1, '2026-10-23' from fx;
select is(pg_temp.reading('2026-11-20 03:00+00'), 1, 'boundary: 28 days of checked history is enough');

update public.pos_accounts set status = 'paused' where id = (select account_1 from fx);
select is(pg_temp.reading('2026-11-20 03:00+00'), 0, 'a paused account gives no reading');
update public.pos_accounts set status = 'auth_failed' where id = (select account_1 from fx);
select is(pg_temp.reading('2026-11-20 03:00+00'), 0, 'an auth_failed account gives no reading');
update public.pos_accounts set status = 'active' where id = (select account_1 from fx);

insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, status)
select tenant_1, s1, account_1, 'intraday-voided-1', '2026-11-20 02:30+00', '2026-11-20', 'voided' from fx;
select is(pg_temp.reading('2026-11-20 03:00+00'), 1, 'a voided invoice is not a sale');
insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date)
select tenant_1, s1, account_1, 'intraday-sale-1', '2026-11-20 02:40+00', '2026-11-20' from fx;
select is(pg_temp.reading('2026-11-20 03:00+00'), 0, 'a sale of the business date gives no reading');
delete from public.invoices where store_id = (select s1 from fx);

update public.stores s set opening_hours = (select opening_hours from public.stores where id = (select s_quiet from fx)), timezone = 'Europe/Berlin', business_day_start_minutes = 300
where s.id = (select s1 from fx);
insert into public.sync_runs (tenant_id, pos_account_id, store_id, store_ids, kind, range_start, range_end, started_at, finished_at, status)
select tenant_1, account_1, s1, array[s1], 'incremental'::public.sync_kind, '2026-11-20', '2026-11-20', '2026-11-20 10:49+00', '2026-11-20 10:50+00', 'succeeded'::public.sync_status from fx;
select is(pg_temp.reading('2026-11-20 11:00+00'), 1, 'a store in Europe/Berlin with a 05:00 day start is read at 12:00 local');
select is(
  (select dedupe_key from public.alert_events where tenant_id = (select tenant_1 from fx) and state = 'open'),
  'zero_sales_open:store:' || (select s1 from fx)::text || ':2026-11-20',
  'its business date is the local date after the 05:00 start'
);
update public.stores s set timezone = 'Asia/Ho_Chi_Minh', business_day_start_minutes = 0 where s.id = (select s1 from fx);

update public.stores set opening_hours = null where id = (select s1 from fx);
select is(pg_temp.reading('2026-11-21 01:59:59+00'), 0, 'nightly_missing: one second before 30 hours nothing is raised');
select is(pg_temp.reading('2026-11-21 02:00+00'), 1, 'nightly_missing: at 30 hours without a succeeded nightly one episode opens');
select is(
  (select dedupe_key from public.alert_events where tenant_id = (select tenant_1 from fx) and state = 'open'),
  'nightly_missing:tenant',
  'the nightly_missing episode is keyed by tenant'
);
insert into public.sync_runs (tenant_id, pos_account_id, store_id, store_ids, kind, range_start, range_end, started_at, finished_at, status)
select tenant_1, account_1, null, null, 'nightly'::public.sync_kind, '2026-11-20', '2026-11-20', '2026-11-21 02:10+00', '2026-11-21 02:20+00', 'succeeded'::public.sync_status from fx;
create temp table reconciled as select app.reconcile_alerts('2026-11-21 02:30+00', (select tenant_1 from fx)) as resolved;
select is(
  (select state || ':' || resolution from public.alert_events where tenant_id = (select tenant_1 from fx) and rule_key = 'nightly_missing'),
  'resolved:recovered',
  'a succeeded nightly resolves nightly_missing'
);

select is(app.evaluate_intraday_rules('2026-11-20 03:00+00', (select tenant_quiet from fx)), 0, 'a tenant without destinations gets no reading');

create temp table unfiltered as select app.notify_tick(now(), false) as summary;
select is(
  (select row(
    (select count(*) from public.alert_events where tenant_id not in (select tenant_1 from fx union all select tenant_quiet from fx)),
    (select count(*) from public.outbound_messages where tenant_id not in (select tenant_1 from fx union all select tenant_quiet from fx))
  )::text),
  (select row(episodes, messages)::text from outside_counts),
  'an unfiltered tick leaves the episodes and messages of every other tenant unchanged'
);

select * from finish();
rollback;
