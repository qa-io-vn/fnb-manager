begin;
select plan(25);

-- Earlier runs (real or from other tests) must not decide the throttle here; the delete is rolled back.
delete from app.storage_maintenance_runs;

-- A small table stands in for a bloated one; the thresholds are parameters so the test needs no 4 MiB of rows.
create table public.zz_storage_probe (id integer primary key, a integer, b integer);
create index zz_storage_probe_a_idx on public.zz_storage_probe (a);
create index zz_storage_probe_b_idx on public.zz_storage_probe (b);
insert into public.zz_storage_probe select g, g, g from generate_series(1, 2000) g;

select has_table('app', 'storage_maintenance_runs', 'the log table exists');
select has_function('app', 'maintain_storage', array['boolean', 'timestamp with time zone', 'bigint', 'numeric', 'regclass'], 'the maintenance function exists');

-- Access: nobody but the owner role reaches either of them.
select ok(not has_function_privilege('anon', 'app.maintain_storage(boolean,timestamptz,bigint,numeric,regclass)', 'execute'), 'anon cannot run it');
select ok(not has_function_privilege('authenticated', 'app.maintain_storage(boolean,timestamptz,bigint,numeric,regclass)', 'execute'), 'authenticated cannot run it');
select ok(not has_function_privilege('service_role', 'app.maintain_storage(boolean,timestamptz,bigint,numeric,regclass)', 'execute'), 'service_role cannot run it');
select ok(not has_table_privilege('anon', 'app.storage_maintenance_runs', 'select'), 'anon cannot read the log');
select ok(not has_table_privilege('authenticated', 'app.storage_maintenance_runs', 'select'), 'authenticated cannot read the log');

-- Decision table: window and throttle (all times Vietnam, UTC+7).
select is((app.maintain_storage(false, '2026-11-21 00:00:00+07', 0, 0, 'public.zz_storage_probe'::regclass)) ->> 'reason', 'outside_window', '00:00 is before the window');
select is((app.maintain_storage(false, '2026-11-21 01:59:59+07', 0, 0, 'public.zz_storage_probe'::regclass)) ->> 'reason', 'outside_window', '01:59 is just before the window');
select is((app.maintain_storage(false, '2026-11-21 06:00:00+07', 0, 0, 'public.zz_storage_probe'::regclass)) ->> 'reason', 'outside_window', '06:00 is just after the window');
select is((select count(*)::int from app.storage_maintenance_runs), 0, 'a refused run writes no log row');

select is((app.maintain_storage(false, '2026-11-21 02:00:00+07', 0, 0, 'public.zz_storage_probe'::regclass)) ->> 'ran', 'true', '02:00 is inside the window');
select is((select count(*)::int from app.storage_maintenance_runs), 1, 'a run writes one log row');
select ok(
  exists (select 1 from app.storage_maintenance_runs r, jsonb_array_elements(r.tables) t where t ->> 'table' = 'zz_storage_probe'),
  'the probe table was rebuilt'
);

select is((app.maintain_storage(false, '2026-11-21 03:00:00+07', 0, 0, 'public.zz_storage_probe'::regclass)) ->> 'reason', 'recent', 'a second run the same night is refused');
select is((app.maintain_storage(false, '2026-11-26 05:59:59+07', 0, 0, 'public.zz_storage_probe'::regclass)) ->> 'reason', 'recent', '5 days 3 hours 59 minutes later is still recent');
select is((app.maintain_storage(false, '2026-11-27 02:00:00+07', 0, 0, 'public.zz_storage_probe'::regclass)) ->> 'ran', 'true', 'exactly 6 days after the first run it runs again');

-- Thresholds: nothing qualifies when the minimum size or the ratio is too high.
select is(((app.maintain_storage(true, '2026-12-05 03:00:00+07', 1000000000, 0, 'public.zz_storage_probe'::regclass)) -> 'tables')::text, '[]', 'a huge minimum index size rebuilds nothing');
select is(((app.maintain_storage(true, '2026-12-05 03:00:00+07', 0, 1000000, 'public.zz_storage_probe'::regclass)) -> 'tables')::text, '[]', 'a huge index-to-table ratio rebuilds nothing');
select ok(
  jsonb_array_length((app.maintain_storage(true, '2026-12-05 03:00:00+07', 0, 0, 'public.zz_storage_probe'::regclass)) -> 'tables') >= 1,
  'minimum 0 and ratio 0 rebuild at least the probe'
);

-- The default thresholds leave a small healthy table alone.
select is(
  (select count(*)::int from jsonb_array_elements((app.maintain_storage(true, '2026-12-06 03:00:00+07', 4194304, 3, 'public.zz_storage_probe'::regclass)) -> 'tables') t where t ->> 'table' = 'zz_storage_probe'),
  0,
  'the default thresholds skip the small probe table'
);

-- Forcing ignores the window and the throttle.
select is((app.maintain_storage(true, '2026-12-06 12:00:00+07', 1000000000, 0, 'public.zz_storage_probe'::regclass)) ->> 'ran', 'true', 'force ignores the window and the throttle');

-- The rebuild keeps the data and the indexes.
select is((select count(*)::int from public.zz_storage_probe), 2000, 'every probe row is still there');
select is(
  (select count(*)::int from pg_index where indrelid = 'public.zz_storage_probe'::regclass and indisvalid),
  3,
  'the primary key and both indexes are valid'
);

-- The scheduler's housekeeping calls it and never fails because of it.
select lives_ok($$select app.prune_incremental_sync_history()$$, 'the housekeeping still runs');

select * from finish();
rollback;
