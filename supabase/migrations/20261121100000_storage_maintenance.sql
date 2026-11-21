-- Keeps the Free-plan database small: rebuilds bloated indexes.
-- Repeated syncs and upserts leave index pages half empty; on a measured local database the indexes held
-- 43 MB for 3.4 MB of invoices. `reindex table` rebuilds them from the live rows only.

create table app.storage_maintenance_runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  database_bytes bigint not null check (database_bytes >= 0),
  freed_index_bytes bigint not null default 0,
  tables jsonb not null default '[]'::jsonb,
  skipped jsonb not null default '[]'::jsonb
);

comment on table app.storage_maintenance_runs is 'one row per run of app.maintain_storage(): the database size before it, the index bytes the rebuild freed, the tables it rebuilt (schema, name, index bytes before and after) and the ones it skipped because another session held a lock';

revoke all on table app.storage_maintenance_runs from public, anon, authenticated, service_role;

create function app.maintain_storage(
  p_force boolean default false,
  p_at timestamptz default now(),
  p_min_index_bytes bigint default 4194304,
  p_index_to_table_ratio numeric default 3,
  p_only regclass default null
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  last_run timestamptz;
  local_hour integer;
  size_before bigint;
  target record;
  rebuilt jsonb := '[]'::jsonb;
  skipped jsonb := '[]'::jsonb;
  index_after bigint;
  freed bigint := 0;
begin
  if not p_force then
    select max(r.ran_at) into last_run from app.storage_maintenance_runs r;
    if last_run is not null and last_run > p_at - interval '6 days' then
      return jsonb_build_object('ran', false, 'reason', 'recent');
    end if;
    local_hour := extract(hour from p_at at time zone 'Asia/Ho_Chi_Minh');
    if local_hour < 2 or local_hour > 5 then
      return jsonb_build_object('ran', false, 'reason', 'outside_window');
    end if;
  end if;

  size_before := pg_database_size(current_database());
  perform set_config('lock_timeout', '5s', true);

  for target in
    select n.nspname as schema_name, c.relname as table_name, c.oid as table_oid, pg_indexes_size(c.oid) as index_bytes
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'r'
      and n.nspname in ('public', 'app')
      and (p_only is null or c.oid = p_only)
      and pg_indexes_size(c.oid) >= p_min_index_bytes
      and pg_indexes_size(c.oid) >= p_index_to_table_ratio * pg_table_size(c.oid)
    order by pg_indexes_size(c.oid) desc, c.relname
    limit 10
  loop
    begin
      execute format('reindex table %I.%I', target.schema_name, target.table_name);
      index_after := pg_indexes_size(target.table_oid);
      freed := freed + greatest(target.index_bytes - index_after, 0);
      rebuilt := rebuilt || jsonb_build_array(jsonb_build_object(
        'schema', target.schema_name, 'table', target.table_name,
        'index_bytes_before', target.index_bytes, 'index_bytes_after', index_after));
    exception when lock_not_available then
      skipped := skipped || jsonb_build_array(jsonb_build_object(
        'schema', target.schema_name, 'table', target.table_name, 'reason', 'lock_not_available'));
    end;
  end loop;

  insert into app.storage_maintenance_runs (ran_at, database_bytes, freed_index_bytes, tables, skipped)
  values (p_at, size_before, freed, rebuilt, skipped);
  delete from app.storage_maintenance_runs r where r.ran_at < p_at - interval '400 days';

  return jsonb_build_object('ran', true, 'freed_index_bytes', freed, 'tables', rebuilt, 'skipped', skipped);
end;
$$;

comment on function app.maintain_storage(boolean, timestamptz, bigint, numeric, regclass) is 'rebuilds the indexes of up to ten tables in public and app whose indexes are at least p_min_index_bytes (4 MiB) and at least p_index_to_table_ratio (3) times the table (or only the table p_only, when given), waiting at most 5 seconds for each lock and skipping a table it cannot lock; unless p_force it runs at most once in 6 days and only between 02:00 and 05:59 Vietnam time; logs one row in app.storage_maintenance_runs and returns what it did';

revoke all on function app.maintain_storage(boolean, timestamptz, bigint, numeric, regclass) from public;

-- The scheduler's housekeeping calls it. A failure here must never stop a sync tick.
create or replace function app.prune_incremental_sync_history()
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  delete from public.sync_runs r
  where r.kind = 'incremental'
    and r.started_at < now() - case when r.status = 'succeeded' then interval '35 days' else interval '90 days' end;
  delete from cron.job_run_details d
  where d.end_time < now() - interval '7 days';
  delete from app.sync_alerts a
  where a.resolved_at < now() - interval '90 days';
  delete from public.analytics_refreshes r
  where r.started_at < now() - interval '35 days'
    and exists (
      select 1
      from public.analytics_refreshes newer
      where newer.tenant_id = r.tenant_id
        and newer.started_at > r.started_at
    );
  begin
    perform app.maintain_storage();
  exception when others then
    null;
  end;
end;
$$;

comment on function app.prune_incremental_sync_history() is 'retention for what the schedule adds every tick: incremental sync_runs after 35 days (90 when not succeeded), cron.job_run_details after 7 days, resolved sync_alerts after 90 days, analytics_refreshes after 35 days except each tenant''s newest; then app.maintain_storage(), which acts at most weekly in the night window and whose failure is ignored';
