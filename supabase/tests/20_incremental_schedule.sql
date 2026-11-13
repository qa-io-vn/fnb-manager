begin;
select plan(84);

insert into public.tenants (id, slug, name)
values ('66666666-6666-4666-8666-000000000001', 'schedule-tenant', 'Schedule Tenant');

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name, status)
values
  ('66666666-6666-4666-8666-000000000011', '66666666-6666-4666-8666-000000000001', 'mock', 'schedule-active', 'Active account', 'active'),
  ('66666666-6666-4666-8666-000000000012', '66666666-6666-4666-8666-000000000001', 'mock', 'schedule-paused', 'Paused account', 'paused'),
  ('66666666-6666-4666-8666-000000000013', '66666666-6666-4666-8666-000000000001', 'mock', 'schedule-rejected', 'Rejected account', 'auth_failed');

create temp table fixture_hours as
select
  '{"mon": [["07:00", "22:30"]], "tue": [["07:00", "22:30"]], "wed": [["07:00", "22:30"]], "thu": [["07:00", "22:30"]], "fri": [["07:00", "22:30"]], "sat": [["07:00", "22:30"]], "sun": [["07:00", "22:30"]]}'::jsonb as daily,
  '{"fri": [["18:00", "02:00"]], "sat": [["01:00", "03:00"]]}'::jsonb as late_night,
  '{"mon": [["08:00", "20:00"]], "tue": [["08:00", "20:00"]], "wed": [["08:00", "20:00"]], "thu": [["08:00", "20:00"]], "fri": [["08:00", "20:00"]], "sat": [["08:00", "20:00"]], "sun": [["08:00", "20:00"]]}'::jsonb as berlin,
  '{"mon": [["00:00", "00:00"]], "tue": [["00:00", "00:00"]], "wed": [["00:00", "00:00"]], "thu": [["00:00", "00:00"]], "fri": [["00:00", "00:00"]], "sat": [["00:00", "00:00"]], "sun": [["00:00", "00:00"]]}'::jsonb as all_day,
  '{"mon": [["07:00", "12:00"], ["14:00", "20:00"]], "tue": [], "wed": [["7am", "5pm"]]}'::jsonb as split_week,
  '{"mon": [["07:00", "12:00"], ["14:00", "20:00"]], "tue": []}'::jsonb as split_week_stored;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name, timezone, business_day_start_minutes, opening_hours, settings, active)
select v.id, '66666666-6666-4666-8666-000000000001', v.account_id, v.external_id, v.name, v.timezone, v.day_start, v.hours, v.settings, v.active
from fixture_hours h
cross join lateral (
  values
    ('66666666-6666-4666-8666-000000000021'::uuid, '66666666-6666-4666-8666-000000000011'::uuid, 'S1', 'Daily store', 'Asia/Ho_Chi_Minh', 0, h.daily, '{}'::jsonb, true),
    ('66666666-6666-4666-8666-000000000022'::uuid, '66666666-6666-4666-8666-000000000011'::uuid, 'S2', 'Late store', 'Asia/Ho_Chi_Minh', 300, h.late_night, '{}'::jsonb, true),
    ('66666666-6666-4666-8666-000000000023'::uuid, '66666666-6666-4666-8666-000000000011'::uuid, 'S3', 'Unknown hours', 'Asia/Ho_Chi_Minh', 0, null::jsonb, '{}'::jsonb, true),
    ('66666666-6666-4666-8666-000000000024'::uuid, '66666666-6666-4666-8666-000000000011'::uuid, 'S4', 'Berlin store', 'Europe/Berlin', 0, h.berlin, '{}'::jsonb, true),
    ('66666666-6666-4666-8666-000000000025'::uuid, '66666666-6666-4666-8666-000000000011'::uuid, 'S5', 'Opted out', 'Asia/Ho_Chi_Minh', 0, h.all_day, '{"incremental_sync": false}'::jsonb, true),
    ('66666666-6666-4666-8666-000000000026'::uuid, '66666666-6666-4666-8666-000000000011'::uuid, 'S6', 'Closed down', 'Asia/Ho_Chi_Minh', 0, null::jsonb, '{}'::jsonb, false),
    ('66666666-6666-4666-8666-000000000027'::uuid, '66666666-6666-4666-8666-000000000012'::uuid, 'S7', 'Paused account store', 'Asia/Ho_Chi_Minh', 0, null::jsonb, '{}'::jsonb, true),
    ('66666666-6666-4666-8666-000000000028'::uuid, '66666666-6666-4666-8666-000000000013'::uuid, 'S8', 'Rejected account store', 'Asia/Ho_Chi_Minh', 0, null::jsonb, '{}'::jsonb, true),
    ('66666666-6666-4666-8666-000000000029'::uuid, '66666666-6666-4666-8666-000000000011'::uuid, 'S9', 'Split week', 'Asia/Ho_Chi_Minh', 0, h.split_week_stored, '{}'::jsonb, true)
) as v (id, account_id, external_id, name, timezone, day_start, hours, settings, active);

create function pg_temp.targets_at(p_at timestamptz)
returns text[]
language sql
as $$
  select coalesce(array_agg(s.external_id order by s.external_id), '{}'::text[])
  from app.incremental_sync_targets(p_at) t
  join public.stores s on s.id = t.store_id
  where t.tenant_id = '66666666-6666-4666-8666-000000000001';
$$;

select has_column('public', 'sync_runs', 'store_id', 'sync_runs records the one store an incremental run covered');
select col_is_null('public', 'sync_runs', 'store_id', 'a run over every store of an account leaves store_id null');
select fk_ok('public', 'sync_runs', array['tenant_id', 'store_id'], 'public', 'stores', array['tenant_id', 'id'], 'a run''s store belongs to the run''s tenant');

select is((select enabled from app.incremental_sync_settings), false, 'the schedule starts disabled');
select is((select count(*)::int from cron.job where jobname = 'sync-incremental'), 0, 'no pg_cron job exists until the schedule is enabled');

select is(app.store_open_at((select daily from fixture_hours), 'Asia/Ho_Chi_Minh', 0, '2026-11-06 03:00+00'), true, 'open at 10:00 store time during 07:00-22:30');
select is(app.store_open_at((select daily from fixture_hours), 'Asia/Ho_Chi_Minh', 0, '2026-11-05 23:59+00'), false, 'closed at 06:59 store time');
select is(app.store_open_at((select daily from fixture_hours), 'Asia/Ho_Chi_Minh', 0, '2026-11-06 00:00+00'), true, 'open from 07:00 store time, the opening minute included');
select is(app.store_open_at((select daily from fixture_hours), 'Asia/Ho_Chi_Minh', 0, '2026-11-06 15:30+00'), false, 'closed from 22:30 store time, the closing minute excluded');
select is(app.store_open_at((select daily from fixture_hours), 'UTC', 0, '2026-11-06 03:00+00'), false, 'the same instant is before opening in another timezone');
select is(app.store_open_at(null, 'Asia/Ho_Chi_Minh', 0, '2026-11-06 03:00+00'), null::boolean, 'unknown opening hours leave the answer unknown');

select is(app.store_open_at((select late_night from fixture_hours), 'Asia/Ho_Chi_Minh', 300, '2026-11-06 18:30+00'), true, 'a Friday span 18:00-02:00 is open at 01:30 on Saturday');
select is(app.store_open_at((select late_night from fixture_hours), 'Asia/Ho_Chi_Minh', 300, '2026-11-06 19:00+00'), false, 'and closed at 02:00 on Saturday');
select is(app.store_open_at((select late_night from fixture_hours), 'Asia/Ho_Chi_Minh', 300, '2026-11-06 10:59+00'), false, 'and not yet open at 17:59 on Friday');
select is(app.store_open_at((select late_night from fixture_hours), 'Asia/Ho_Chi_Minh', 300, '2026-11-07 18:30+00'), true, 'with a 05:00 day start a Saturday span at 01:00-03:00 is the early hours of Sunday');
select is(app.store_open_at((select late_night from fixture_hours), 'Asia/Ho_Chi_Minh', 0, '2026-11-07 18:30+00'), false, 'with a midnight day start the same span is the early hours of Saturday, so Sunday 01:30 is closed');
select is(app.store_open_at((select late_night from fixture_hours), 'Asia/Ho_Chi_Minh', 0, '2026-11-06 18:30+00'), true, 'with a midnight day start Saturday 01:30 is open twice over: the Friday span and the Saturday span');

select is(app.store_open_at((select berlin from fixture_hours), 'Europe/Berlin', 0, '2026-07-03 06:30+00'), true, 'summer time: 06:30 UTC is 08:30 in Berlin, open');
select is(app.store_open_at((select berlin from fixture_hours), 'Europe/Berlin', 0, '2026-01-09 06:30+00'), false, 'winter time: 06:30 UTC is 07:30 in Berlin, closed');
select is(app.store_open_at((select all_day from fixture_hours), 'Asia/Ho_Chi_Minh', 0, '2026-11-06 20:00+00'), true, 'a 00:00-00:00 span is open around the clock');

select is(app.store_open_at((select split_week from fixture_hours), 'Asia/Ho_Chi_Minh', 0, '2026-11-09 05:30+00'), false, 'closed between the two spans of a split day');
select is(app.store_open_at((select split_week from fixture_hours), 'Asia/Ho_Chi_Minh', 0, '2026-11-09 07:30+00'), true, 'open in the second span of a split day');
select is(app.store_open_at((select split_week from fixture_hours), 'Asia/Ho_Chi_Minh', 0, '2026-11-10 03:00+00'), false, 'an empty list closes the weekday');
select is(app.store_open_at((select split_week from fixture_hours), 'Asia/Ho_Chi_Minh', 0, '2026-11-11 03:00+00'), false, 'a malformed span is ignored instead of failing the schedule');
select is(app.store_open_at((select split_week from fixture_hours), 'Asia/Ho_Chi_Minh', 0, '2026-11-12 03:00+00'), false, 'a missing weekday key closes the weekday');

select is(app.opening_minutes_between((select daily from fixture_hours), 'Asia/Ho_Chi_Minh', 0, '2026-11-05 17:00+00', '2026-11-06 17:00+00'), 930, 'a full store-local day holds 930 opening minutes');
select is(app.opening_minutes_between((select daily from fixture_hours), 'Asia/Ho_Chi_Minh', 0, '2026-11-06 15:00+00', '2026-11-06 16:00+00'), 30, 'only the minutes before closing count');
select is(app.opening_minutes_between((select daily from fixture_hours), 'Asia/Ho_Chi_Minh', 0, '2026-11-06 15:00+00', '2026-11-07 01:00+00'), 90, 'the night does not count: 30 minutes before closing and 60 after opening');
select is(app.opening_minutes_between('{"thu": [["20:00", "02:00"]], "fri": [["01:00", "03:00"]]}'::jsonb, 'Asia/Ho_Chi_Minh', 0, '2026-11-05 05:00+00', '2026-11-06 05:00+00'), 420, 'overlapping spans of two days count once');
select is(app.opening_minutes_between(null, 'Asia/Ho_Chi_Minh', 0, '2026-11-06 03:00+00', '2026-11-06 03:45+00'), 45, 'with unknown hours every minute counts');
select is(app.opening_minutes_between((select daily from fixture_hours), 'Asia/Ho_Chi_Minh', 0, '2026-11-06 04:00+00', '2026-11-06 03:00+00'), 0, 'a reversed range holds no minute');

select is(pg_temp.targets_at('2026-11-06 03:00+00'), array['S1', 'S3'], 'Friday 10:00: the open store and the store with unknown hours; closed, opted-out, inactive, paused and auth_failed stores are left out');
select is(pg_temp.targets_at('2026-11-06 18:30+00'), array['S2', 'S3', 'S4'], 'Saturday 01:30: the late store by its day start, and Berlin at 19:30');
select is(pg_temp.targets_at('2026-11-06 15:40+00'), array['S1', 'S2', 'S3', 'S4'], 'ten minutes after closing the daily store still gets its closing run');
select is(pg_temp.targets_at('2026-11-06 16:05+00'), array['S2', 'S3', 'S4'], 'thirty-five minutes after closing it is no longer due');
select is(pg_temp.targets_at('2026-11-06 19:00+00'), array['S2', 'S3', 'S4'], 'the tick at the closing minute is the closing run of the late store and of Berlin');
select is(pg_temp.targets_at('2026-11-06 19:30+00'), array['S3'], 'half an hour later only the store with unknown hours is due');

select ok(
  app.opening_hours_valid((select daily from fixture_hours))
    and app.opening_hours_valid((select late_night from fixture_hours))
    and app.opening_hours_valid((select all_day from fixture_hours))
    and app.opening_hours_valid('{"mon": [["7:00", "24:00"]], "tue": []}')
    and app.opening_hours_valid('{}')
    and app.opening_hours_valid(null),
  'well-formed hours, a 24:00 close, an empty object and null are valid opening hours'
);
select is(
  (
    select count(*)::int
    from (
      values
        ('{"mon": [["7:00am", "10:00pm"]]}'::jsonb),
        ('null'::jsonb),
        ('[]'::jsonb),
        ('{"monday": [["07:00", "22:00"]]}'::jsonb),
        ('{"mon": [["07:00"]]}'::jsonb),
        ('{"mon": [["07:00", "25:00"]]}'::jsonb),
        ('{"mon": ["07:00", "22:00"]}'::jsonb),
        ('{"mon": {"open": "07:00"}}'::jsonb),
        ('{"mon": [["07:00:00", "22:00:00"]]}'::jsonb)
    ) as v (hours)
    where not app.opening_hours_valid(v.hours)
  ),
  9,
  'opening hours are invalid with a 12-hour time, JSON null, an array, an unknown key, a half span, an hour past 24, a bare pair, an object or seconds'
);
select throws_ok(
  $$insert into public.stores (tenant_id, pos_account_id, external_id, name, opening_hours)
    values ('66666666-6666-4666-8666-000000000001', '66666666-6666-4666-8666-000000000011', 'SX', 'Unreadable hours', '{"mon": [["7:00am", "10:00pm"]]}')$$,
  '23514',
  'new row for relation "stores" violates check constraint "stores_opening_hours_valid"',
  'stores refuses opening hours the schedule could not read'
);
select is(app.store_due_for_incremental('{}'::jsonb, 'Asia/Ho_Chi_Minh', 0, '2026-11-06 20:00+00'), true, 'hours entered without a single span count as unknown, so every tick syncs the store');
select is(app.opening_minutes_between('{"mon": [], "tue": []}'::jsonb, 'Asia/Ho_Chi_Minh', 0, '2026-11-06 03:00+00', '2026-11-06 04:00+00'), 60, 'and every minute of them counts for the dead-man''s switch');
select is(app.store_open_at('{"sun": []}'::jsonb, 'Asia/Ho_Chi_Minh', 0, '2026-11-06 03:00+00'), null::boolean, 'whether such a store is open stays unknown');
select is(app.store_due_for_incremental('{"mon": [["07:00", "22:01"]]}'::jsonb, 'Asia/Ho_Chi_Minh', 0, '2026-11-09 15:30:00.4+00'), true, 'a store that closed one minute after a tick gets its closing run from the next tick, which ran 0.4 s late');
select is(app.store_due_for_incremental('{"mon": [["07:00", "22:01"]]}'::jsonb, 'Asia/Ho_Chi_Minh', 0, '2026-11-09 16:00:00.4+00'), false, 'and is not due at the tick after that');
select is(app.store_due_for_incremental((select daily from fixture_hours), 'Asia/Ho_Chi_Minh', 0, '2026-11-06 00:00:00.4+00'), true, 'a tick 0.4 s after opening finds the store due');

insert into public.stores (id, tenant_id, pos_account_id, external_id, name, timezone, business_day_start_minutes, opening_hours)
values ('66666666-6666-4666-8666-000000000030', '66666666-6666-4666-8666-000000000001', '66666666-6666-4666-8666-000000000011', 'S10', 'Hours without a span', 'Asia/Ho_Chi_Minh', 0, '{"mon": [], "sun": []}');
select is(pg_temp.targets_at('2026-11-06 19:30+00'), array['S10', 'S3'], 'a store whose hours hold no span is dispatched around the clock like one with unknown hours');
delete from public.stores where id = '66666666-6666-4666-8666-000000000030';

select is(app.dispatch_incremental_sync('2026-11-06 03:00+00'), 0, 'dispatch does nothing while the schedule is disabled');
select is((select count(*)::int from app.incremental_sync_tickets where tenant_id = '66666666-6666-4666-8666-000000000001'), 0, 'and issues no ticket');
select throws_ok($$select app.enable_incremental_sync('ftp://example.com/sync')$$, '22023', 'enable_incremental_sync needs the http(s) URL of the sync-incremental function', 'enabling refuses a URL that is not http(s)');

insert into public.sync_runs (tenant_id, pos_account_id, store_id, store_ids, kind, range_start, range_end, started_at, finished_at, status)
values ('66666666-6666-4666-8666-000000000001', '66666666-6666-4666-8666-000000000011', '66666666-6666-4666-8666-000000000021', array['66666666-6666-4666-8666-000000000021'::uuid], 'incremental', '2026-11-04', '2026-11-06', '2026-11-06 00:29+00', '2026-11-06 00:30+00', 'succeeded');

select isnt(app.enable_incremental_sync('http://kong:8000/functions/v1/sync-incremental'), null::bigint, 'enabling schedules a pg_cron job');
select results_eq(
  $$select schedule, command from cron.job where jobname = 'sync-incremental'$$,
  $$values ('*/30 * * * *'::text, 'select app.dispatch_incremental_sync()'::text)$$,
  'the job dispatches every 30 minutes'
);
select ok(app.dispatch_incremental_sync('2026-11-06 03:00+00') >= 2, 'an enabled dispatch posts one ticket per due store');
select results_eq(
  $$select s.external_id, t.source, t.due_at, t.request_id is not null, t.expires_at > now()
    from app.incremental_sync_tickets t join public.stores s on s.id = t.store_id
    where t.tenant_id = '66666666-6666-4666-8666-000000000001' order by s.external_id$$,
  $$values ('S1'::text, 'schedule'::text, '2026-11-06 03:00+00'::timestamptz, true, true), ('S3', 'schedule', '2026-11-06 03:00+00'::timestamptz, true, true)$$,
  'each due store gets one scheduled ticket stamped with the tick and its pg_net request'
);
select is(
  (
    select count(*)::int
    from net.http_request_queue q
    join app.incremental_sync_tickets t on t.request_id = q.id
    where t.tenant_id = '66666666-6666-4666-8666-000000000001'
      and q.method = 'POST'
      and q.url = 'http://kong:8000/functions/v1/sync-incremental'
      and convert_from(q.body, 'UTF8')::jsonb = jsonb_build_object('ticket', t.ticket)
      and q.headers ->> 'Content-Type' = 'application/json'
      and q.timeout_milliseconds = 30000
  ),
  2,
  'the request carries the ticket id and nothing else: no API key, no credential'
);

create temp table claimed as
select * from app.claim_incremental_sync_ticket((
  select t.ticket from app.incremental_sync_tickets t where t.store_id = '66666666-6666-4666-8666-000000000021'
));
select results_eq(
  $$select store_id, source from claimed$$,
  $$values ('66666666-6666-4666-8666-000000000021'::uuid, 'schedule'::text)$$,
  'the function claims its ticket and learns the store'
);
select is((select count(*)::int from app.incremental_sync_tickets where store_id = '66666666-6666-4666-8666-000000000021'), 0, 'a claimed ticket is gone, so it cannot be replayed');

select results_eq(
  $$select kind, minutes, opened_at, occurrences, resolved_at is null from app.sync_alerts where store_id = '66666666-6666-4666-8666-000000000021'$$,
  $$values ('sync_stale'::text, 150, '2026-11-06 03:00+00'::timestamptz, 1, true)$$,
  'the tick itself opened a sync_stale alert for the store that went 150 minutes of opening time without a sync, whatever the function does'
);
select is((select count(*)::int from app.sync_alerts a join public.stores s on s.id = a.store_id where s.tenant_id = '66666666-6666-4666-8666-000000000001' and a.store_id <> '66666666-6666-4666-8666-000000000021'), 0, 'stores never synced raise nothing');
select ok(app.evaluate_incremental_sync_alerts('2026-11-06 03:05+00') >= 1, 'the next evaluation finds the store still stale');
select results_eq(
  $$select minutes, occurrences, last_seen_at from app.sync_alerts where store_id = '66666666-6666-4666-8666-000000000021' and resolved_at is null$$,
  $$values (155, 2, '2026-11-06 03:05+00'::timestamptz)$$,
  'and refreshes the one open alert instead of opening another'
);
insert into public.sync_runs (tenant_id, pos_account_id, store_id, store_ids, kind, range_start, range_end, started_at, finished_at, status)
values ('66666666-6666-4666-8666-000000000001', '66666666-6666-4666-8666-000000000011', '66666666-6666-4666-8666-000000000021', array['66666666-6666-4666-8666-000000000021'::uuid], 'incremental', '2026-11-04', '2026-11-06', '2026-11-06 03:09+00', '2026-11-06 03:10+00', 'succeeded');
select lives_ok($$select app.evaluate_incremental_sync_alerts('2026-11-06 03:30+00')$$, 'after a successful run a later tick evaluates the store again');
select is((select resolved_at from app.sync_alerts where store_id = '66666666-6666-4666-8666-000000000021'), '2026-11-06 03:30+00'::timestamptz, 'and its alert is resolved at that tick');

update app.incremental_sync_tickets set expires_at = now() - interval '1 second' where store_id = '66666666-6666-4666-8666-000000000023';
insert into app.incremental_sync_tickets (tenant_id, store_id, due_at, expires_at, source)
values ('66666666-6666-4666-8666-000000000001', '66666666-6666-4666-8666-000000000024', now() - interval '20 minutes', now() - interval '10 minutes', 'manual');
select is(app.record_unclaimed_incremental_sync_tickets(), 1, 'an expired scheduled ticket nobody claimed is recorded; an expired manual one is not');
select results_eq(
  $$select kind, http_status, error, occurrences from app.sync_alerts where store_id = '66666666-6666-4666-8666-000000000023' and resolved_at is null$$,
  $$values ('dispatch_failed'::text, null::integer, 'no answer recorded'::text, 1)$$,
  'as a dispatch_failed alert of its store, with what pg_net kept of the call'
);
select is((select count(*)::int from app.incremental_sync_tickets where store_id in ('66666666-6666-4666-8666-000000000023', '66666666-6666-4666-8666-000000000024')), 0, 'both expired tickets are dropped');
insert into net._http_response (id, status_code, content, timed_out, created)
values (-660001, 503, '{"error":"the database is unavailable"}', false, now());
insert into app.incremental_sync_tickets (tenant_id, store_id, due_at, expires_at, request_id)
values ('66666666-6666-4666-8666-000000000001', '66666666-6666-4666-8666-000000000023', now() - interval '20 minutes', now() - interval '10 minutes', -660001);
select is(app.record_unclaimed_incremental_sync_tickets(), 1, 'a later expired ticket of the same store is recorded too');
select results_eq(
  $$select http_status, error, occurrences from app.sync_alerts where store_id = '66666666-6666-4666-8666-000000000023' and resolved_at is null$$,
  $$values (503, 'answered without claiming the ticket'::text, 2)$$,
  'on the same open alert, with the status the function answered'
);
select is(
  (select count(*)::int from app.claim_incremental_sync_ticket(app.issue_incremental_sync_ticket('66666666-6666-4666-8666-000000000023'))),
  1,
  'a ticket of that store is claimed again'
);
select isnt((select resolved_at from app.sync_alerts where store_id = '66666666-6666-4666-8666-000000000023' and kind = 'dispatch_failed'), null::timestamptz, 'and the claim resolves its dispatch_failed alert');

insert into public.sync_runs (tenant_id, pos_account_id, store_id, store_ids, kind, range_start, range_end, started_at, finished_at, status)
values
  ('66666666-6666-4666-8666-000000000001', '66666666-6666-4666-8666-000000000011', '66666666-6666-4666-8666-000000000022', array['66666666-6666-4666-8666-000000000022'::uuid], 'incremental', '2026-01-01', '2026-01-03', now() - interval '40 days', now() - interval '40 days', 'succeeded'),
  ('66666666-6666-4666-8666-000000000001', '66666666-6666-4666-8666-000000000011', '66666666-6666-4666-8666-000000000022', array['66666666-6666-4666-8666-000000000022'::uuid], 'incremental', '2026-01-01', '2026-01-03', now() - interval '60 days', now() - interval '60 days', 'failed'),
  ('66666666-6666-4666-8666-000000000001', '66666666-6666-4666-8666-000000000011', '66666666-6666-4666-8666-000000000022', array['66666666-6666-4666-8666-000000000022'::uuid], 'incremental', '2026-01-01', '2026-01-03', now() - interval '100 days', now() - interval '100 days', 'partial'),
  ('66666666-6666-4666-8666-000000000001', '66666666-6666-4666-8666-000000000011', null, null, 'nightly', '2026-01-01', '2026-01-14', now() - interval '100 days', now() - interval '100 days', 'succeeded');
insert into cron.job_run_details (jobid, runid, command, status, start_time, end_time)
values (-66, -660001, 'select app.dispatch_incremental_sync()', 'succeeded', now() - interval '8 days', now() - interval '8 days'),
  (-66, -660002, 'select app.dispatch_incremental_sync()', 'succeeded', now() - interval '1 day', now() - interval '1 day');
insert into app.sync_alerts (tenant_id, store_id, kind, opened_at, last_seen_at, resolved_at)
values ('66666666-6666-4666-8666-000000000001', '66666666-6666-4666-8666-000000000022', 'sync_stale', now() - interval '101 days', now() - interval '101 days', now() - interval '100 days');
select lives_ok($$select app.prune_incremental_sync_history()$$, 'the retention step runs');
select results_eq(
  $$select kind::text, status::text from public.sync_runs where store_id = '66666666-6666-4666-8666-000000000022' or (store_id is null and range_start = '2026-01-01' and tenant_id = '66666666-6666-4666-8666-000000000001') order by started_at$$,
  $$values ('nightly'::text, 'succeeded'::text), ('incremental', 'failed')$$,
  'it keeps incremental runs 35 days, 90 when they did not succeed, and leaves other runs alone'
);
select is((select count(*)::int from cron.job_run_details where jobid = -66), 1, 'it keeps pg_cron''s run log 7 days');
select is((select count(*)::int from app.sync_alerts where store_id = '66666666-6666-4666-8666-000000000022'), 0, 'and resolved alerts 90 days');

insert into app.incremental_sync_tickets (ticket, tenant_id, store_id, due_at, issued_at, expires_at)
values ('66666666-6666-4666-8666-000000000091', '66666666-6666-4666-8666-000000000001', '66666666-6666-4666-8666-000000000022', now() - interval '20 minutes', now() - interval '20 minutes', now() - interval '10 minutes');
select is((select count(*)::int from app.claim_incremental_sync_ticket('66666666-6666-4666-8666-000000000091')), 0, 'an expired ticket is refused');
select is((select count(*)::int from app.claim_incremental_sync_ticket('66666666-6666-4666-8666-000000000092')), 0, 'an unknown ticket is refused');

select is(
  (select source from app.claim_incremental_sync_ticket(app.issue_incremental_sync_ticket('66666666-6666-4666-8666-000000000023'))),
  'manual',
  'an operator can issue a manual ticket for one store'
);
select throws_ok($$select app.issue_incremental_sync_ticket('66666666-6666-4666-8666-000000000099')$$, '22023', 'issue_incremental_sync_ticket needs the id of an existing store', 'a manual ticket needs a real store');

select lives_ok($$select app.disable_incremental_sync()$$, 'disabling the schedule works');
select is((select count(*)::int from cron.job where jobname = 'sync-incremental'), 0, 'disabling removes the pg_cron job');
select is(app.dispatch_incremental_sync('2026-11-06 03:00+00'), 0, 'a dispatch after disabling posts nothing');

select is(
  (
    select count(*)::int
    from (values ('anon'), ('authenticated'), ('service_role')) as r (role_name)
    cross join (
      values
        ('app.dispatch_incremental_sync(timestamptz)'),
        ('app.enable_incremental_sync(text, text)'),
        ('app.disable_incremental_sync()'),
        ('app.claim_incremental_sync_ticket(uuid)'),
        ('app.issue_incremental_sync_ticket(uuid)'),
        ('app.incremental_sync_targets(timestamptz)'),
        ('app.store_due_for_incremental(jsonb, text, integer, timestamptz, interval)'),
        ('app.store_open_at(jsonb, text, integer, timestamptz)'),
        ('app.opening_spans(jsonb, text, integer, timestamptz, timestamptz)'),
        ('app.opening_minutes_between(jsonb, text, integer, timestamptz, timestamptz)'),
        ('app.last_successful_sync(uuid, timestamptz)'),
        ('app.sync_gap_minutes(uuid, timestamptz)'),
        ('app.longest_sync_gap_minutes(uuid, timestamptz, timestamptz)'),
        ('app.record_unclaimed_incremental_sync_tickets()'),
        ('app.evaluate_incremental_sync_alerts(timestamptz)'),
        ('app.prune_incremental_sync_history()'),
        ('app.incremental_sync_watched(uuid)'),
        ('app.store_watched_for_sync(boolean, jsonb, text)'),
        ('app.opening_hours_known(jsonb)'),
        ('app.sync_run_covers_store(uuid, uuid[], uuid)'),
        ('app.sync_run_reached_business_date(date, timestamptz, text, integer)'),
        ('app.stale_analytics_dates(uuid, date, date)')
    ) as f (signature)
    where has_function_privilege(r.role_name, f.signature, 'execute')
  ),
  0,
  'no API role may run the scheduler or freshness functions'
);
select is(
  (
    select count(*)::int
    from (values ('anon'), ('authenticated'), ('service_role')) as r (role_name)
    cross join (values ('app.incremental_sync_settings'), ('app.incremental_sync_tickets'), ('app.sync_alerts')) as t (table_name)
    cross join (values ('select'), ('insert'), ('update'), ('delete')) as p (privilege)
    where has_table_privilege(r.role_name, t.table_name, p.privilege)
  ),
  0,
  'no API role may read or write the schedule settings, the tickets or the alerts'
);
select ok(
  has_function_privilege('authenticated', 'app.opening_hours_valid(jsonb)', 'execute')
    and has_function_privilege('service_role', 'app.opening_hours_valid(jsonb)', 'execute'),
  'a role that may one day write stores can run the opening-hours check its constraint calls'
);

select * from finish();
rollback;
