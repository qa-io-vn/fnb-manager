begin;
select plan(42);

insert into public.tenants (id, slug, name)
values ('66666666-6666-4666-8666-000000000101', 'freshness-tenant', 'Freshness Tenant');

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
values
  ('66666666-6666-4666-8666-000000000111', '66666666-6666-4666-8666-000000000101', 'mock', 'freshness-account', 'Freshness account'),
  ('66666666-6666-4666-8666-000000000112', '66666666-6666-4666-8666-000000000101', 'mock', 'freshness-quiet', 'Quiet account');

insert into public.stores (id, tenant_id, pos_account_id, external_id, name, timezone, business_day_start_minutes, opening_hours)
values
  ('66666666-6666-4666-8666-000000000121', '66666666-6666-4666-8666-000000000101', '66666666-6666-4666-8666-000000000111', 'F1', 'Watched store', 'Asia/Ho_Chi_Minh', 0,
    '{"mon": [["07:00", "22:30"]], "tue": [["07:00", "22:30"]], "wed": [["07:00", "22:30"]], "thu": [["07:00", "22:30"]], "fri": [["07:00", "22:30"]], "sat": [["07:00", "22:30"]], "sun": [["07:00", "22:30"]]}'::jsonb),
  ('66666666-6666-4666-8666-000000000122', '66666666-6666-4666-8666-000000000101', '66666666-6666-4666-8666-000000000111', 'F2', 'Sister store', 'Asia/Ho_Chi_Minh', 0, null),
  ('66666666-6666-4666-8666-000000000123', '66666666-6666-4666-8666-000000000101', '66666666-6666-4666-8666-000000000112', 'F3', 'Never synced', 'Asia/Ho_Chi_Minh', 0, null);

insert into public.sync_runs (tenant_id, pos_account_id, store_id, kind, range_start, range_end, started_at, finished_at, status)
values
  ('66666666-6666-4666-8666-000000000101', '66666666-6666-4666-8666-000000000111', '66666666-6666-4666-8666-000000000121', 'incremental', '2026-11-04', '2026-11-06', '2026-11-06 02:59+00', '2026-11-06 03:00+00', 'succeeded'),
  ('66666666-6666-4666-8666-000000000101', '66666666-6666-4666-8666-000000000111', '66666666-6666-4666-8666-000000000122', 'incremental', '2026-11-04', '2026-11-06', '2026-11-06 03:59+00', '2026-11-06 04:00+00', 'succeeded'),
  ('66666666-6666-4666-8666-000000000101', '66666666-6666-4666-8666-000000000111', null, 'master_data', null, null, '2026-11-06 04:29+00', '2026-11-06 04:30+00', 'succeeded'),
  ('66666666-6666-4666-8666-000000000101', '66666666-6666-4666-8666-000000000111', '66666666-6666-4666-8666-000000000121', 'incremental', '2026-11-04', '2026-11-06', '2026-11-06 04:44+00', '2026-11-06 04:45+00', 'failed'),
  ('66666666-6666-4666-8666-000000000101', '66666666-6666-4666-8666-000000000111', '66666666-6666-4666-8666-000000000121', 'incremental', '2026-11-04', '2026-11-06', '2026-11-06 04:49+00', '2026-11-06 04:50+00', 'partial');

select is(app.last_successful_sync('66666666-6666-4666-8666-000000000121', '2026-11-06 05:00+00'), '2026-11-06 03:00+00'::timestamptz, 'the last success ignores failed, partial and master-data runs and the sister store''s own runs');
select is(app.sync_gap_minutes('66666666-6666-4666-8666-000000000121', '2026-11-06 05:00+00'), 120, 'two hours of opening time since the last success at 10:00 store time');
select is(app.sync_gap_minutes('66666666-6666-4666-8666-000000000122', '2026-11-06 05:00+00'), 60, 'the sister store counts its own run and, with unknown hours, every minute');
select is(app.sync_gap_minutes('66666666-6666-4666-8666-000000000123', '2026-11-06 05:00+00'), null::integer, 'a store that was never synced has no gap');
select is(app.sync_gap_minutes('66666666-6666-4666-8666-000000000121', '2026-11-06 02:00+00'), null::integer, 'no gap before the first success either');

insert into public.sync_runs (tenant_id, pos_account_id, store_id, kind, range_start, range_end, started_at, finished_at, status)
values ('66666666-6666-4666-8666-000000000101', '66666666-6666-4666-8666-000000000111', null, 'nightly', '2026-10-23', '2026-11-05', '2026-11-06 04:10+00', '2026-11-06 04:15+00', 'succeeded');

select is(app.sync_gap_minutes('66666666-6666-4666-8666-000000000121', '2026-11-06 05:00+00'), 45, 'a window run of the account counts for each of its stores');
select is(app.sync_gap_minutes('66666666-6666-4666-8666-000000000122', '2026-11-06 05:00+00'), 45, 'including the sister store');

select is(app.sync_gap_minutes('66666666-6666-4666-8666-000000000121', '2026-11-06 16:00+00'), 675, 'from 11:15 to the 22:30 close the gap grows, and stops growing after closing');
select is(app.sync_gap_minutes('66666666-6666-4666-8666-000000000121', '2026-11-06 23:30+00'), 675, 'the night adds nothing before the 07:00 opening');
select is(app.sync_gap_minutes('66666666-6666-4666-8666-000000000121', '2026-11-07 00:30+00'), 705, 'thirty minutes after opening the gap has grown by thirty');
select ok(app.sync_gap_minutes('66666666-6666-4666-8666-000000000121', '2026-11-06 05:00+00') <= 90 and app.sync_gap_minutes('66666666-6666-4666-8666-000000000121', '2026-11-06 16:00+00') > 90, 'the 90-minute dead-man threshold is crossed during the afternoon');

select is(
  app.longest_sync_gap_minutes('66666666-6666-4666-8666-000000000121', '2026-11-05 17:00+00', '2026-11-06 17:00+00'),
  675,
  'the longest stretch of the business day without a success runs from 11:15 to the close'
);
select is(
  app.longest_sync_gap_minutes('66666666-6666-4666-8666-000000000121', '2026-11-05 17:00+00', '2026-11-06 03:30+00'),
  180,
  'before noon the longest stretch is from opening to the first success'
);
select is(
  app.longest_sync_gap_minutes('66666666-6666-4666-8666-000000000123', '2026-11-05 17:00+00', '2026-11-06 17:00+00'),
  null::integer,
  'a store that was never synced has no longest gap'
);

insert into public.sync_runs (tenant_id, pos_account_id, store_id, store_ids, kind, range_start, range_end, started_at, finished_at, status)
values ('66666666-6666-4666-8666-000000000101', '66666666-6666-4666-8666-000000000111', null, array['66666666-6666-4666-8666-000000000121', '66666666-6666-4666-8666-000000000122']::uuid[], 'backfill', '2026-10-01', '2026-10-31', '2026-11-06 08:00+00', '2026-11-06 08:59+00', 'succeeded');
select is(app.sync_gap_minutes('66666666-6666-4666-8666-000000000121', '2026-11-06 09:00+00'), 285, 'a backfill of an older month is no sync of the store''s current days');
insert into public.sync_runs (tenant_id, pos_account_id, store_id, store_ids, kind, range_start, range_end, started_at, finished_at, status)
values ('66666666-6666-4666-8666-000000000101', '66666666-6666-4666-8666-000000000111', '66666666-6666-4666-8666-000000000122', array['66666666-6666-4666-8666-000000000122']::uuid[], 'backfill', '2026-11-06', '2026-11-06', '2026-11-06 09:00+00', '2026-11-06 09:05+00', 'succeeded');
select is(app.sync_gap_minutes('66666666-6666-4666-8666-000000000121', '2026-11-06 09:10+00'), 295, 'a window run given only the sister store does not count for this store');
select is(app.sync_gap_minutes('66666666-6666-4666-8666-000000000122', '2026-11-06 09:10+00'), 5, 'and counts for the sister store');
insert into public.sync_runs (tenant_id, pos_account_id, store_id, store_ids, kind, range_start, range_end, started_at, finished_at, status)
values ('66666666-6666-4666-8666-000000000101', '66666666-6666-4666-8666-000000000111', null, array['66666666-6666-4666-8666-000000000121', '66666666-6666-4666-8666-000000000122']::uuid[], 'nightly', '2026-10-24', '2026-11-05', '2026-11-06 09:10+00', '2026-11-06 09:20+00', 'succeeded');
select is(app.sync_gap_minutes('66666666-6666-4666-8666-000000000121', '2026-11-06 09:30+00'), 10, 'a window run that listed the store and reached the day before its business date counts');
select is(app.longest_sync_gap_minutes('66666666-6666-4666-8666-000000000121', '2026-11-05 17:00+00', '2026-11-06 09:30+00'), 305, 'and the backfill and the sister store''s run leave the longest stretch at 11:15 to 16:20');

select is(app.incremental_sync_watched('66666666-6666-4666-8666-000000000121'), true, 'an active store of an active account that did not opt out is watched');
update public.stores set settings = '{"incremental_sync": false}' where id = '66666666-6666-4666-8666-000000000121';
select is(app.incremental_sync_watched('66666666-6666-4666-8666-000000000121'), false, 'a store opted out of the incremental sync is not watched');
select is(app.sync_gap_minutes('66666666-6666-4666-8666-000000000121', '2026-11-06 16:00+00'), null::integer, 'so it has no gap for an incremental run to report');
select is(app.longest_sync_gap_minutes('66666666-6666-4666-8666-000000000121', '2026-11-05 17:00+00', '2026-11-06 17:00+00'), null::integer, 'and no longest gap for the nightly check');
select is((select sync_resumed_at from public.stores where id = '66666666-6666-4666-8666-000000000121'), null::timestamptz, 'opting out marks no resume');
update public.stores set settings = '{"incremental_sync": true}' where id = '66666666-6666-4666-8666-000000000121';
select is((select sync_resumed_at from public.stores where id = '66666666-6666-4666-8666-000000000121'), now(), 'opting back in marks the moment the store is watched again');
update public.stores set sync_resumed_at = null where id = '66666666-6666-4666-8666-000000000121';
update public.stores set settings = '{"incremental_sync": true, "note": "kept"}' where id = '66666666-6666-4666-8666-000000000121';
select is((select sync_resumed_at from public.stores where id = '66666666-6666-4666-8666-000000000121'), null::timestamptz, 'a settings change that keeps the store watched marks nothing');
update public.stores set active = false where id = '66666666-6666-4666-8666-000000000122';
select is(app.sync_gap_minutes('66666666-6666-4666-8666-000000000122', '2026-11-06 16:00+00'), null::integer, 'an inactive store is not watched');
update public.stores set active = true where id = '66666666-6666-4666-8666-000000000122';
select is((select sync_resumed_at from public.stores where id = '66666666-6666-4666-8666-000000000122'), now(), 'reactivating a store marks its resume');
update public.stores set sync_resumed_at = null where pos_account_id = '66666666-6666-4666-8666-000000000111';
update public.pos_accounts set status = 'paused' where id = '66666666-6666-4666-8666-000000000111';
select is(app.sync_gap_minutes('66666666-6666-4666-8666-000000000121', '2026-11-06 16:00+00'), null::integer, 'a store of a paused account is not watched');
select is((select count(*)::int from public.stores where pos_account_id = '66666666-6666-4666-8666-000000000111' and sync_resumed_at is not null), 0, 'pausing marks no resume');
update public.pos_accounts set status = 'active' where id = '66666666-6666-4666-8666-000000000111';
select is((select count(*)::int from public.stores where pos_account_id = '66666666-6666-4666-8666-000000000111' and sync_resumed_at = now()), 2, 'resuming the account marks every one of its stores');

update public.stores set sync_resumed_at = '2026-11-06 14:00+00' where id = '66666666-6666-4666-8666-000000000121';
select is(app.sync_gap_minutes('66666666-6666-4666-8666-000000000121', '2026-11-06 15:00+00'), 60, 'opening time before the store was watched again does not count: an hour since the 21:00 resume, not the afternoon');
select is(app.longest_sync_gap_minutes('66666666-6666-4666-8666-000000000121', '2026-11-05 17:00+00', '2026-11-06 17:00+00'), 90, 'and the nightly check measures that day from the resume, 21:00 to the 22:30 close');
select is(app.longest_sync_gap_minutes('66666666-6666-4666-8666-000000000121', '2026-11-06 05:00+00', '2026-11-06 13:00+00'), null::integer, 'a stretch that ended before the resume has nothing to measure');
update public.stores set sync_resumed_at = null where pos_account_id = '66666666-6666-4666-8666-000000000111';

insert into public.sync_checks (tenant_id, store_id, business_date, checked_at)
values
  ('66666666-6666-4666-8666-000000000101', '66666666-6666-4666-8666-000000000121', '2026-11-04', '2026-11-06 03:00+00'),
  ('66666666-6666-4666-8666-000000000101', '66666666-6666-4666-8666-000000000121', '2026-11-05', '2026-11-06 03:00+00'),
  ('66666666-6666-4666-8666-000000000101', '66666666-6666-4666-8666-000000000121', '2026-11-06', '2026-11-06 05:00+00'),
  ('66666666-6666-4666-8666-000000000101', '66666666-6666-4666-8666-000000000122', '2026-11-06', '2026-11-06 05:00+00');
insert into public.analytics_refreshes (tenant_id, from_date, to_date, started_at, finished_at, rows)
values
  ('66666666-6666-4666-8666-000000000101', '2026-11-04', '2026-11-05', '2026-11-06 03:01+00', '2026-11-06 03:01+00', 10),
  ('66666666-6666-4666-8666-000000000101', '2026-11-06', '2026-11-06', '2026-11-06 04:00+00', '2026-11-06 04:00+00', 5),
  ('66666666-6666-4666-8666-000000000101', '2026-11-06', '2026-11-06', '2026-11-06 05:30+00', null, null);
select results_eq(
  $$select business_date from app.stale_analytics_dates('66666666-6666-4666-8666-000000000121', '2026-11-01', '2026-11-08')$$,
  $$values ('2026-11-06'::date)$$,
  'only the date whose check is newer than every finished refresh covering it is stale; an unfinished refresh does not count'
);
select results_eq(
  $$select business_date from app.stale_analytics_dates('66666666-6666-4666-8666-000000000121', '2026-11-01', '2026-11-05')$$,
  $$select null::date where false$$,
  'the range limits the dates looked at'
);
insert into public.analytics_refreshes (tenant_id, from_date, to_date, started_at, finished_at, rows)
values ('66666666-6666-4666-8666-000000000101', '2026-11-01', '2026-11-08', '2026-11-06 05:00+00', '2026-11-06 05:00+00', 40);
select is((select count(*)::int from app.stale_analytics_dates('66666666-6666-4666-8666-000000000121', '2026-11-01', '2026-11-08')), 0, 'a tenant refresh that started with the check covers it, for every store of the tenant');
select is((select count(*)::int from app.stale_analytics_dates('66666666-6666-4666-8666-000000000122', '2026-11-01', '2026-11-08')), 0, 'including the sister store');

insert into auth.users (id, instance_id, aud, role, email)
values ('66666666-6666-4666-8666-000000000191', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'freshness-manager@example.com');
insert into public.tenant_members (tenant_id, user_id, role, store_ids)
values ('66666666-6666-4666-8666-000000000101', '66666666-6666-4666-8666-000000000191', 'manager', array['66666666-6666-4666-8666-000000000121'::uuid]);
set local role authenticated;
set local request.jwt.claims to '{"sub": "66666666-6666-4666-8666-000000000191", "role": "authenticated"}';
select is((select count(*)::int from public.sync_runs where store_id = '66666666-6666-4666-8666-000000000122'), 0, 'a manager of one store sees no run of the sister store alone, incremental or window');
select is((select count(*)::int from public.sync_runs where store_id = '66666666-6666-4666-8666-000000000121'), 3, 'and every run of their own store');
select is((select count(*)::int from public.sync_runs where store_id is null and store_ids is not null), 2, 'and the window runs that covered their store with others');
select is((select count(*)::int from public.sync_runs where store_id is null and store_ids is null), 2, 'and the account-wide runs recorded without a store list');
reset role;

select * from finish();
rollback;
