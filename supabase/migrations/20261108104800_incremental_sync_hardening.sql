alter table public.sync_runs add column store_ids uuid[];

comment on column public.sync_runs.store_ids is 'the stores a sales run covered: the store of an incremental run, every store given to a window run; null on master-data runs and on runs recorded before this column, which count as covering every store of their account';

alter table public.stores add column sync_resumed_at timestamptz;

comment on column public.stores.sync_resumed_at is 'when the incremental sync last started watching the store again: the store was reactivated or opted back in, or its POS account left paused; the dead-man''s switch counts no opening time before it';

alter table app.incremental_sync_settings
  add column stale_after_minutes integer not null default 90 check (stale_after_minutes between 30 and 1440);

comment on column app.incremental_sync_settings.stale_after_minutes is 'minutes of opening time without a successful sync after which each tick opens a sync_stale alert; the runners use the same 90';

create function app.opening_time_valid(p_value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_value ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' or p_value = '24:00', false);
$$;

comment on function app.opening_time_valid(text) is 'whether a text is an opening time stores.opening_hours accepts: H:MM or HH:MM from 0:00 to 23:59, or 24:00';

create function app.opening_hours_valid(p_opening_hours jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_opening_hours is null or (
    jsonb_typeof(p_opening_hours) = 'object'
    and not exists (
      select 1
      from jsonb_each(case when jsonb_typeof(p_opening_hours) = 'object' then p_opening_hours else '{}'::jsonb end) as d (weekday, spans)
      where d.weekday <> all (array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
        or jsonb_typeof(d.spans) <> 'array'
        or exists (
          select 1
          from jsonb_array_elements(case when jsonb_typeof(d.spans) = 'array' then d.spans else '[]'::jsonb end) as s (span)
          where jsonb_typeof(s.span) <> 'array'
            or jsonb_array_length(case when jsonb_typeof(s.span) = 'array' then s.span else '[]'::jsonb end) <> 2
            or not app.opening_time_valid(case when jsonb_typeof(s.span) = 'array' then s.span ->> 0 end)
            or not app.opening_time_valid(case when jsonb_typeof(s.span) = 'array' then s.span ->> 1 end)
        )
    )
  );
$$;

comment on function app.opening_hours_valid(jsonb) is 'the shape stores.opening_hours must have: null, or an object whose keys are weekdays mon..sun, each holding a list of [open, close] pairs of opening times';

create function app.opening_hours_known(p_opening_hours jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (
    select 1
    from jsonb_each(case when jsonb_typeof(p_opening_hours) = 'object' then p_opening_hours else '{}'::jsonb end) as d (weekday, spans)
    cross join lateral jsonb_array_elements(case when jsonb_typeof(d.spans) = 'array' then d.spans else '[]'::jsonb end) as s (span)
    where d.weekday = any (array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
      and jsonb_typeof(s.span) = 'array'
      and coalesce(s.span ->> 0, '') ~ '^[0-9]{1,2}:[0-9]{2}$'
      and coalesce(s.span ->> 1, '') ~ '^[0-9]{1,2}:[0-9]{2}$'
  );
$$;

comment on function app.opening_hours_known(jsonb) is 'whether the opening hours hold at least one span app.opening_spans lays out; null, an empty object or lists without a usable span count as unknown hours';

alter table public.stores
  add constraint stores_opening_hours_valid check (app.opening_hours_valid(opening_hours));

create or replace function app.store_open_at(
  p_opening_hours jsonb,
  p_timezone text,
  p_day_start_minutes integer,
  p_at timestamptz
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when not app.opening_hours_known(p_opening_hours) then null
    else exists (
      select 1
      from app.opening_spans(p_opening_hours, p_timezone, p_day_start_minutes, p_at, p_at + interval '1 microsecond') s
      where s.opens_at <= p_at
        and p_at < s.closes_at
    )
  end;
$$;

comment on function app.store_open_at(jsonb, text, integer, timestamptz) is 'whether the store is open at the instant, in store-local time; null when its opening hours are unknown (never entered, or entered without a usable span)';

create or replace function app.opening_minutes_between(
  p_opening_hours jsonb,
  p_timezone text,
  p_day_start_minutes integer,
  p_from timestamptz,
  p_to timestamptz
)
returns integer
language sql
stable
set search_path = ''
as $$
  with clipped as (
    select greatest(s.opens_at, p_from) as starts_at, least(s.closes_at, p_to) as ends_at
    from app.opening_spans(p_opening_hours, p_timezone, p_day_start_minutes, p_from, p_to) s
  ),
  ordered as (
    select
      starts_at,
      ends_at,
      max(ends_at) over (order by starts_at, ends_at rows between unbounded preceding and 1 preceding) as reached
    from clipped
  ),
  islands as (
    select
      starts_at,
      ends_at,
      count(*) filter (where reached is null or starts_at > reached) over (order by starts_at, ends_at) as island
    from ordered
  ),
  merged as (
    select min(starts_at) as island_start, max(ends_at) as island_end
    from islands
    group by island
  )
  select case
    when p_to <= p_from then 0
    when not app.opening_hours_known(p_opening_hours) then floor(extract(epoch from (p_to - p_from)) / 60)::integer
    else coalesce((select floor(sum(extract(epoch from (m.island_end - m.island_start))) / 60)::integer from merged m), 0)
  end;
$$;

comment on function app.opening_minutes_between(jsonb, text, integer, timestamptz, timestamptz) is 'whole minutes of opening time between two instants, overlapping spans counted once; every minute counts when the opening hours are unknown';

create or replace function app.store_due_for_incremental(
  p_opening_hours jsonb,
  p_timezone text,
  p_day_start_minutes integer,
  p_at timestamptz,
  p_interval interval default interval '30 minutes'
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select not app.opening_hours_known(p_opening_hours)
    or exists (
      select 1
      from app.opening_spans(p_opening_hours, p_timezone, p_day_start_minutes, p_at - p_interval, p_at + interval '1 microsecond') s
    );
$$;

comment on function app.store_due_for_incremental(jsonb, text, integer, timestamptz, interval) is 'whether a scheduler tick at p_at syncs the store: it is open at the tick, it was open at any moment of the interval before it (the tick after closing collects the last sales, however soon after a tick the store closed), or its opening hours are unknown (then every tick syncs it)';

create function app.store_watched_for_sync(p_active boolean, p_settings jsonb, p_account_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_active, false)
    and coalesce(p_account_status, '') <> 'paused'
    and not coalesce(p_settings @> '{"incremental_sync": false}'::jsonb, false);
$$;

comment on function app.store_watched_for_sync(boolean, jsonb, text) is 'the one rule for which stores the incremental sync and its dead-man''s switch watch: an active store, of an account that is not paused, not opted out with stores.settings incremental_sync false';

create function app.incremental_sync_watched(p_store_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select app.store_watched_for_sync(s.active, s.settings, a.status::text)
    from public.stores s
    join public.pos_accounts a on a.id = s.pos_account_id
    where s.id = p_store_id
  ), false);
$$;

comment on function app.incremental_sync_watched(uuid) is 'app.store_watched_for_sync for one store by id; false for an unknown store';

create or replace function app.incremental_sync_targets(p_at timestamptz default now())
returns table (tenant_id uuid, store_id uuid, hours_known boolean, open_now boolean)
language sql
stable
set search_path = ''
as $$
  select
    s.tenant_id,
    s.id,
    app.opening_hours_known(s.opening_hours),
    coalesce(app.store_open_at(s.opening_hours, s.timezone, s.business_day_start_minutes, p_at), true)
  from public.stores s
  join public.pos_accounts a on a.id = s.pos_account_id
  where app.store_watched_for_sync(s.active, s.settings, a.status::text)
    and a.status::text <> 'auth_failed'
    and app.store_due_for_incremental(s.opening_hours, s.timezone, s.business_day_start_minutes, p_at)
  order by s.tenant_id, s.id;
$$;

comment on function app.incremental_sync_targets(timestamptz) is 'stores a scheduler tick at p_at dispatches: stores app.store_watched_for_sync watches, except those of auth_failed accounts, that are due by app.store_due_for_incremental';

create function app.mark_store_sync_resumed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.store_watched_for_sync(old.active, old.settings, null)
    and app.store_watched_for_sync(new.active, new.settings, null) then
    new.sync_resumed_at := now();
  end if;
  return new;
end;
$$;

create trigger stores_mark_sync_resumed
before update of active, settings on public.stores
for each row execute function app.mark_store_sync_resumed();

create function app.mark_account_sync_resumed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.stores s
  set sync_resumed_at = now()
  where s.pos_account_id = new.id;
  return null;
end;
$$;

create trigger pos_accounts_mark_sync_resumed
after update of status on public.pos_accounts
for each row
when (old.status::text = 'paused' and new.status::text <> 'paused')
execute function app.mark_account_sync_resumed();

comment on function app.mark_store_sync_resumed() is 'sets stores.sync_resumed_at when an update makes the store active and opted in again';
comment on function app.mark_account_sync_resumed() is 'sets stores.sync_resumed_at on every store of a POS account that leaves paused';

create function app.sync_run_covers_store(p_run_store_id uuid, p_run_store_ids uuid[], p_store_id uuid)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_run_store_ids is not null then p_store_id = any (p_run_store_ids)
    when p_run_store_id is not null then p_run_store_id = p_store_id
    else true
  end;
$$;

comment on function app.sync_run_covers_store(uuid, uuid[], uuid) is 'whether a sync run covered the store: listed in store_ids, else its store_id, else (older rows without either) every store of the account';

create function app.sync_run_reached_business_date(p_range_end date, p_finished_at timestamptz, p_timezone text, p_day_start_minutes integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_range_end >= ((p_finished_at at time zone p_timezone) - make_interval(mins => p_day_start_minutes))::date - 1, false);
$$;

comment on function app.sync_run_reached_business_date(date, timestamptz, text, integer) is 'whether a run''s range reached the day before the store''s business date at the run''s end, the nightly run''s yesterday; a backfill of an older range is no sync of the store''s current days';

create or replace function app.last_successful_sync(p_store_id uuid, p_at timestamptz default now())
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select max(r.finished_at)
  from public.stores s
  join public.sync_runs r on r.pos_account_id = s.pos_account_id
  where s.id = p_store_id
    and r.status = 'succeeded'
    and r.kind <> 'master_data'
    and r.finished_at <= p_at
    and app.sync_run_covers_store(r.store_id, r.store_ids, s.id)
    and app.sync_run_reached_business_date(r.range_end, r.finished_at, s.timezone, s.business_day_start_minutes);
$$;

comment on function app.last_successful_sync(uuid, timestamptz) is 'end of the last successful sales run that covered the store and reached its current business days, at or before p_at: an incremental run of the store, or a window run given the store whose range ended no earlier than the day before the store''s business date at the run''s end';

create or replace function app.sync_gap_minutes(p_store_id uuid, p_at timestamptz default now())
returns integer
language sql
stable
set search_path = ''
as $$
  select app.opening_minutes_between(
    s.opening_hours,
    s.timezone,
    s.business_day_start_minutes,
    least(greatest(last_sync.finished_at, s.sync_resumed_at, p_at - interval '7 days'), p_at),
    p_at
  )
  from public.stores s
  cross join lateral (select app.last_successful_sync(s.id, p_at) as finished_at) last_sync
  where s.id = p_store_id
    and app.incremental_sync_watched(s.id)
    and last_sync.finished_at is not null;
$$;

comment on function app.sync_gap_minutes(uuid, timestamptz) is 'minutes of opening time since the last successful sync of the store or, when later, since the sync started watching it again, looking back at most 7 days; null when the store is not watched (inactive, paused account, opted out) or was never synced; the dead-man''s switch fires above 90';

create or replace function app.longest_sync_gap_minutes(p_store_id uuid, p_from timestamptz, p_to timestamptz)
returns integer
language sql
stable
set search_path = ''
as $$
  with store as (
    select
      s.id,
      s.pos_account_id,
      s.opening_hours,
      s.timezone,
      s.business_day_start_minutes,
      least(greatest(p_from, s.sync_resumed_at), p_to) as watched_from
    from public.stores s
    where s.id = p_store_id
      and app.incremental_sync_watched(s.id)
      and app.last_successful_sync(s.id, p_to) is not null
  ),
  points as (
    select st.watched_from as at
    from store st
    union
    select r.finished_at
    from store st
    join public.sync_runs r on r.pos_account_id = st.pos_account_id
    where r.status = 'succeeded'
      and r.kind <> 'master_data'
      and app.sync_run_covers_store(r.store_id, r.store_ids, st.id)
      and app.sync_run_reached_business_date(r.range_end, r.finished_at, st.timezone, st.business_day_start_minutes)
      and r.finished_at > st.watched_from
      and r.finished_at < p_to
    union
    select p_to
    from store
  ),
  gaps as (
    select at as gap_start, lead(at) over (order by at) as gap_end
    from points
  )
  select max(app.opening_minutes_between(st.opening_hours, st.timezone, st.business_day_start_minutes, g.gap_start, g.gap_end))
  from gaps g
  cross join store st
  where g.gap_end is not null;
$$;

comment on function app.longest_sync_gap_minutes(uuid, timestamptz, timestamptz) is 'the longest stretch of opening time between p_from (or the moment the sync started watching the store again, when later) and p_to without a successful sync of the store, in minutes; null when the store is not watched or was never synced by p_to; the nightly run checks the last business day with it';

create table app.sync_alerts (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  store_id uuid not null,
  kind text not null check (kind in ('sync_stale', 'dispatch_failed')),
  opened_at timestamptz not null,
  last_seen_at timestamptz not null,
  resolved_at timestamptz,
  occurrences integer not null default 1 check (occurrences > 0),
  minutes integer,
  http_status integer,
  error text,
  notified_at timestamptz,
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

create unique index sync_alerts_open_store_kind_idx on app.sync_alerts (store_id, kind) where resolved_at is null;
create index sync_alerts_resolved_at_idx on app.sync_alerts (resolved_at) where resolved_at is not null;

comment on table app.sync_alerts is 'alerts the scheduler raises at every tick without the Edge Function: sync_stale while a watched store is over the dead-man threshold, dispatch_failed when a scheduled ticket expired unclaimed (pg_net could not deliver it, or the function answered without claiming it); one open row per store and kind, resolved when the condition clears; notified_at is for the phase 12 channels';

revoke all on table app.sync_alerts from public, anon, authenticated, service_role;

create function app.record_unclaimed_incremental_sync_tickets()
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  recorded integer;
begin
  with expired as (
    delete from app.incremental_sync_tickets t
    where t.expires_at <= now()
    returning t.tenant_id, t.store_id, t.source, t.request_id, t.issued_at
  ),
  answers as (
    select
      e.tenant_id,
      e.store_id,
      e.issued_at,
      r.status_code,
      case
        when r.id is null then 'no answer recorded'
        when r.timed_out then 'timed out'
        when r.error_msg is not null then left(r.error_msg, 200)
        else 'answered without claiming the ticket'
      end as error
    from expired e
    left join net._http_response r on r.id = e.request_id
    where e.source = 'schedule'
  ),
  per_store as (
    select
      a.tenant_id,
      a.store_id,
      count(*)::integer as occurrences,
      (array_agg(a.status_code order by a.issued_at desc))[1] as status_code,
      (array_agg(a.error order by a.issued_at desc))[1] as error
    from answers a
    group by a.tenant_id, a.store_id
  )
  insert into app.sync_alerts (tenant_id, store_id, kind, opened_at, last_seen_at, occurrences, http_status, error)
  select p.tenant_id, p.store_id, 'dispatch_failed', now(), now(), p.occurrences, p.status_code, p.error
  from per_store p
  on conflict (store_id, kind) where resolved_at is null
  do update set
    last_seen_at = excluded.last_seen_at,
    occurrences = app.sync_alerts.occurrences + excluded.occurrences,
    http_status = excluded.http_status,
    error = excluded.error;
  get diagnostics recorded = row_count;
  return recorded;
end;
$$;

comment on function app.record_unclaimed_incremental_sync_tickets() is 'drops expired tickets and records every scheduled one among them as a dispatch_failed alert of its store, with the HTTP status or error pg_net kept for the request';

create function app.evaluate_incremental_sync_alerts(p_at timestamptz default now())
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  threshold integer;
  stale integer;
begin
  select coalesce((select c.stale_after_minutes from app.incremental_sync_settings c), 90) into threshold;
  insert into app.sync_alerts (tenant_id, store_id, kind, opened_at, last_seen_at, minutes)
  select g.tenant_id, g.store_id, 'sync_stale', p_at, p_at, g.minutes
  from (
    select s.tenant_id, s.id as store_id, app.sync_gap_minutes(s.id, p_at) as minutes
    from public.stores s
    where s.active
  ) g
  where g.minutes > threshold
  on conflict (store_id, kind) where resolved_at is null
  do update set
    last_seen_at = excluded.last_seen_at,
    minutes = excluded.minutes,
    occurrences = app.sync_alerts.occurrences + 1;
  get diagnostics stale = row_count;
  update app.sync_alerts a
  set resolved_at = p_at
  where a.kind = 'sync_stale'
    and a.resolved_at is null
    and a.last_seen_at < p_at;
  return stale;
end;
$$;

comment on function app.evaluate_incremental_sync_alerts(timestamptz) is 'the dead-man''s switch on the database side: opens or refreshes a sync_stale alert for every watched store whose app.sync_gap_minutes at p_at is over the threshold, and resolves the open ones that no longer are';

create function app.prune_incremental_sync_history()
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
end;
$$;

comment on function app.prune_incremental_sync_history() is 'retention for what the schedule adds every tick: incremental sync_runs after 35 days (90 when not succeeded), cron.job_run_details after 7 days, resolved sync_alerts after 90 days, analytics_refreshes after 35 days except each tenant''s newest';

create or replace function app.claim_incremental_sync_ticket(p_ticket uuid)
returns table (tenant_id uuid, store_id uuid, due_at timestamptz, source text)
language sql
volatile
set search_path = ''
as $$
  with claimed as (
    delete from app.incremental_sync_tickets t
    where t.ticket = p_ticket
      and t.expires_at > now()
    returning t.tenant_id, t.store_id, t.due_at, t.source
  ),
  cleared as (
    update app.sync_alerts a
    set resolved_at = now()
    from claimed c
    where a.store_id = c.store_id
      and a.kind = 'dispatch_failed'
      and a.resolved_at is null
    returning a.id
  )
  select c.tenant_id, c.store_id, c.due_at, c.source
  from claimed c;
$$;

comment on function app.claim_incremental_sync_ticket(uuid) is 'claims a dispatch ticket once: returns its store and source, deletes it and resolves the store''s open dispatch_failed alert, or returns nothing when the ticket is unknown, used or expired';

create or replace function app.dispatch_incremental_sync(p_at timestamptz default now())
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  settings app.incremental_sync_settings%rowtype;
  target record;
  issued uuid;
  request bigint;
  dispatched integer := 0;
begin
  perform app.record_unclaimed_incremental_sync_tickets();
  perform app.prune_incremental_sync_history();
  select * into settings from app.incremental_sync_settings;
  if not found or not settings.enabled or settings.function_url is null then
    return 0;
  end if;
  perform app.evaluate_incremental_sync_alerts(p_at);
  for target in select * from app.incremental_sync_targets(p_at) loop
    insert into app.incremental_sync_tickets (tenant_id, store_id, due_at, expires_at)
    values (target.tenant_id, target.store_id, p_at, now() + settings.ticket_lifetime)
    returning ticket into issued;
    select net.http_post(
      url := settings.function_url,
      body := jsonb_build_object('ticket', issued),
      headers := jsonb_build_object('Content-Type', 'application/json'),
      timeout_milliseconds := settings.request_timeout_ms
    ) into request;
    update app.incremental_sync_tickets set request_id = request where ticket = issued;
    dispatched := dispatched + 1;
  end loop;
  return dispatched;
end;
$$;

comment on function app.dispatch_incremental_sync(timestamptz) is 'the pg_cron job body: records expired scheduled tickets as dispatch_failed alerts and drops them, prunes the schedule''s history, then, only while the schedule is enabled, evaluates the dead-man''s switch for every watched store and issues one ticket per due store, posted to the Edge Function through pg_net; p_at simulates the tick time for tests';

create or replace function app.disable_incremental_sync()
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  update app.incremental_sync_settings set enabled = false, updated_at = now();
  update app.sync_alerts set resolved_at = now() where resolved_at is null;
  if exists (select 1 from cron.job where jobname = 'sync-incremental') then
    perform cron.unschedule('sync-incremental');
  end if;
end;
$$;

comment on function app.disable_incremental_sync() is 'turns the schedule off, removes the pg_cron job and resolves the open sync alerts; pending tickets expire on their own';

create function app.stale_analytics_dates(p_store_id uuid, p_from date, p_to date)
returns table (business_date date)
language sql
stable
set search_path = ''
as $$
  select c.business_date
  from public.sync_checks c
  where c.store_id = p_store_id
    and c.business_date between p_from and p_to
    and not exists (
      select 1
      from public.analytics_refreshes r
      where r.tenant_id = c.tenant_id
        and r.finished_at is not null
        and r.started_at >= c.checked_at
        and c.business_date between r.from_date and r.to_date
    )
  order by c.business_date;
$$;

comment on function app.stale_analytics_dates(uuid, date, date) is 'business dates of the store in the range whose sync_checks row was written after the start of every finished analytics refresh that covered the date: a run committed the date and never completed its refresh, so the next incremental run refreshes it without pulling it again';

drop policy sync_runs_select_for_data_members on public.sync_runs;

create policy sync_runs_select_for_data_members on public.sync_runs
  for select to authenticated
  using (
    tenant_id = any ((select app.current_user_data_tenant_ids())::uuid[])
    and case
      when store_ids is not null then store_ids && (select app.current_user_data_store_ids())::uuid[]
      when store_id is not null then store_id = any ((select app.current_user_data_store_ids())::uuid[])
      else true
    end
  );

revoke all on function app.opening_time_valid(text) from public;
revoke all on function app.opening_hours_valid(jsonb) from public;
revoke all on function app.opening_hours_known(jsonb) from public;
revoke all on function app.store_watched_for_sync(boolean, jsonb, text) from public;
revoke all on function app.incremental_sync_watched(uuid) from public;
revoke all on function app.mark_store_sync_resumed() from public;
revoke all on function app.mark_account_sync_resumed() from public;
revoke all on function app.sync_run_covers_store(uuid, uuid[], uuid) from public;
revoke all on function app.sync_run_reached_business_date(date, timestamptz, text, integer) from public;
revoke all on function app.record_unclaimed_incremental_sync_tickets() from public;
revoke all on function app.evaluate_incremental_sync_alerts(timestamptz) from public;
revoke all on function app.prune_incremental_sync_history() from public;
revoke all on function app.stale_analytics_dates(uuid, date, date) from public;

grant execute on function app.opening_time_valid(text) to authenticated, service_role;
grant execute on function app.opening_hours_valid(jsonb) to authenticated, service_role;
