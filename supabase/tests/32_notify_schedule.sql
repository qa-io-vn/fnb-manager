begin;
select plan(20);

create temp table fx as
select
  'ffffffff-ffff-4fff-8fff-000032000001'::uuid as tenant_1,
  'ffffffff-ffff-4fff-8fff-000032000101'::uuid as owner_1,
  'ffffffff-ffff-4fff-8fff-000032000201'::uuid as account_1,
  'ffffffff-ffff-4fff-8fff-000032000301'::uuid as s1,
  'ffffffff-ffff-4fff-8fff-000032000302'::uuid as s2;

create temp table outside_counts as
select
  (select count(*) from public.alert_events where tenant_id <> (select tenant_1 from fx)) as episodes,
  (select count(*) from public.outbound_messages where tenant_id <> (select tenant_1 from fx)) as messages;

insert into auth.users (id, instance_id, aud, role, email)
select owner_1, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'schedule-owner-1@example.com' from fx;

insert into public.tenants (id, slug, name, timezone)
select tenant_1, 'notify-it-pgtap-schedule-1', 'Notify pgTAP schedule 1', 'Asia/Ho_Chi_Minh' from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select tenant_1, owner_1, 'owner'::public.tenant_role, null::uuid[] from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_1, tenant_1, 'mock', 'schedule-pgtap-account-1', 'Synthetic account 1' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name, timezone, business_day_start_minutes, opening_hours)
select v.id, fx.tenant_1, fx.account_1, v.external_id, v.name, 'Asia/Ho_Chi_Minh', 0, v.hours::jsonb
from fx
cross join lateral (
  values
    (fx.s1, 's1', 'Synthetic store 1', '{"mon": [["07:00", "22:00"]], "tue": [["07:00", "22:00"]], "wed": [["07:00", "22:00"]], "thu": [["07:00", "22:00"]], "fri": [["07:00", "22:00"]], "sat": [["07:00", "22:00"]], "sun": [["07:00", "22:00"]]}'),
    (fx.s2, 's2', 'Synthetic store 2', null)
) as v (id, external_id, name, hours);

insert into public.sync_checks (tenant_id, store_id, business_date)
select fx.tenant_1, s.id, d.day::date
from fx
cross join lateral (values (fx.s1), (fx.s2)) as s (id)
cross join generate_series('2026-10-01'::date, '2026-11-19'::date, interval '1 day') as d (day);

insert into public.notification_channels (tenant_id, kind, provider, label, user_id, address, secret_name, status, linked_at, consent_record_id)
select tenant_1, 'zalo_bot', 'zalo_bot', 'owner zalo', owner_1, 'synthetic-chat-321', 'NOTIFY_ZALO_BOT_TOKEN_IT', 'active', '2026-11-01 00:00+00',
  app.ensure_notifications_consent(tenant_1, owner_1, 'zalo_bot', '{"method": "bot_reply", "notice_channel": "bot_chat"}'::jsonb, '2026-11-01 00:00+00')
from fx;

insert into public.sync_runs (tenant_id, pos_account_id, store_id, store_ids, kind, range_start, range_end, started_at, finished_at, status)
select tenant_1, account_1, s1, array[s1], 'incremental'::public.sync_kind, '2026-11-20'::date, '2026-11-20'::date, '2026-11-20 02:50+00'::timestamptz, '2026-11-20 02:51+00'::timestamptz, 'succeeded'::public.sync_status from fx
union all
select tenant_1, account_1, null::uuid, null::uuid[], 'nightly'::public.sync_kind, '2026-11-17'::date, '2026-11-17'::date, '2026-11-17 20:23+00'::timestamptz, '2026-11-18 20:00+00'::timestamptz, 'succeeded'::public.sync_status from fx;

update app.notify_settings set enabled = false, function_url = null, continuation_depth = 0;
select cron.unschedule('notify') from cron.job where jobname = 'notify';

select is((select count(*)::integer from cron.job where jobname = 'notify'), 0, 'no notify job until the schedule is enabled');
select is(
  (select row(t ->> 'enabled', t ? 'ticket_posted')::text from app.notify_tick('2026-11-20 03:00+00', true, (select tenant_1 from fx)) t),
  row('false', false)::text,
  'a tick while disabled returns early and posts nothing'
);
select throws_ok($$ select app.enable_notify('ftp://example.com/notify') $$, '22023', null, 'enable_notify refuses a URL that is not http(s)');
select ok(app.enable_notify('http://127.0.0.1:9/functions/v1/notify') > 0, 'enable_notify schedules the job and returns its id');
select is((select count(*)::integer from cron.job where jobname = 'notify' and command = 'select app.notify_tick()'), 1, 'exactly one notify job runs the tick');
select lives_ok($$ select app.enable_notify('http://127.0.0.1:9/functions/v1/notify', '*/10 * * * *') $$, 'enable_notify runs again');
select is((select schedule from cron.job where jobname = 'notify'), '*/10 * * * *', 'running enable_notify again updates the schedule of the one job');

delete from app.notify_tickets;
select ok(app.kick_notify('kick'), 'a kick posts a ticket while enabled');
select ok(not app.kick_notify('kick'), 'a second kick inside 30 seconds is throttled');
delete from app.notify_tickets;
select ok(app.kick_notify('continue'), 'first continuation');
delete from app.notify_tickets;
select ok(app.kick_notify('continue'), 'second continuation');
delete from app.notify_tickets;
select ok(app.kick_notify('continue'), 'third continuation');
delete from app.notify_tickets;
select ok(not app.kick_notify('continue'), 'a fourth chained continuation is refused');
delete from app.notify_tickets;
select ok(app.kick_notify('kick'), 'another kick starts a new chain');

select is(app.evaluate_intraday_rules('2026-11-20 00:30+00', (select tenant_1 from fx)), 0, 'nothing before the minimum open minutes or the nightly limit');
select is(app.evaluate_intraday_rules('2026-11-20 03:00+00', (select tenant_1 from fx)), 2, 'zero sales while open and a missing nightly each record one reading');
select is(
  (select array_agg(e.dedupe_key order by e.dedupe_key) from public.alert_events e where e.tenant_id = (select tenant_1 from fx) and e.state = 'open'),
  array['nightly_missing:tenant', 'zero_sales_open:store:' || (select s1 from fx)::text || ':2026-11-20'],
  'one zero_sales_open episode for the store with hours, none for the store without, and one nightly_missing episode'
);
select is(app.evaluate_intraday_rules('2026-11-20 03:05+00', (select tenant_1 from fx)), 0, 'open episodes are not raised again');

select app.disable_notify();
select is((select count(*)::integer from cron.job where jobname = 'notify'), 0, 'disable_notify removes the job');

select app.notify_tick(now(), false);
select is(
  (select row(
    (select count(*) from public.alert_events where tenant_id <> (select tenant_1 from fx)),
    (select count(*) from public.outbound_messages where tenant_id <> (select tenant_1 from fx))
  )::text),
  (select row(episodes, messages)::text from outside_counts),
  'an unfiltered tick leaves the episodes and messages of every other tenant unchanged'
);

select * from finish();
rollback;
