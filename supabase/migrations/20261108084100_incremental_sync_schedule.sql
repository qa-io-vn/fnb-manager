create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;
create extension if not exists pg_net with schema extensions;

alter table public.sync_runs add column store_id uuid;
alter table public.sync_runs
  add foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade;
create index sync_runs_store_id_started_at_idx on public.sync_runs (store_id, started_at desc) where store_id is not null;

comment on column public.sync_runs.store_id is 'the one store the run covered (every incremental run, and a window run given a single store); null when the run covered every store it was given';

create table app.incremental_sync_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  function_url text check (function_url is null or function_url ~ '^https?://[^[:space:]]+$'),
  request_timeout_ms integer not null default 30000 check (request_timeout_ms between 1000 and 150000),
  ticket_lifetime interval not null default interval '10 minutes' check (ticket_lifetime between interval '1 minute' and interval '1 hour'),
  updated_at timestamptz not null default now()
);

insert into app.incremental_sync_settings default values;

comment on table app.incremental_sync_settings is 'single row driving the pg_cron schedule of the sync-incremental Edge Function; disabled until the owner enables it with app.enable_incremental_sync(function_url)';

create table app.incremental_sync_tickets (
  ticket uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  store_id uuid not null,
  due_at timestamptz not null,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  request_id bigint,
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

create index incremental_sync_tickets_expires_at_idx on app.incremental_sync_tickets (expires_at);
create index incremental_sync_tickets_store_id_idx on app.incremental_sync_tickets (store_id);

comment on table app.incremental_sync_tickets is 'single-use dispatch tickets: the scheduler issues one per due store and sends only its id to the Edge Function, which claims it before it does anything; an unclaimed ticket expires';

revoke all on table app.incremental_sync_settings from public, anon, authenticated, service_role;
revoke all on table app.incremental_sync_tickets from public, anon, authenticated, service_role;

create function app.opening_spans(
  p_opening_hours jsonb,
  p_timezone text,
  p_day_start_minutes integer,
  p_from timestamptz,
  p_to timestamptz
)
returns table (opens_at timestamptz, closes_at timestamptz)
language sql
stable
set search_path = ''
as $$
  with business_days as (
    select day::date as business_date
    from generate_series(
      (((p_from at time zone p_timezone) - make_interval(mins => p_day_start_minutes))::date - 2)::timestamp,
      (((p_to at time zone p_timezone) - make_interval(mins => p_day_start_minutes))::date)::timestamp,
      interval '1 day'
    ) as day
    where p_opening_hours is not null
  ),
  day_spans as (
    select
      b.business_date,
      split_part(s.span ->> 0, ':', 1)::integer * 60 + split_part(s.span ->> 0, ':', 2)::integer as open_minute,
      split_part(s.span ->> 1, ':', 1)::integer * 60 + split_part(s.span ->> 1, ':', 2)::integer as close_minute
    from business_days b
    cross join lateral (
      select p_opening_hours -> (array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])[extract(isodow from b.business_date)::integer] as spans
    ) w
    cross join lateral jsonb_array_elements(case when jsonb_typeof(w.spans) = 'array' then w.spans else '[]'::jsonb end) as s (span)
    where jsonb_typeof(s.span) = 'array'
      and coalesce(s.span ->> 0, '') ~ '^[0-9]{1,2}:[0-9]{2}$'
      and coalesce(s.span ->> 1, '') ~ '^[0-9]{1,2}:[0-9]{2}$'
  ),
  laid_out as (
    select
      business_date,
      case when open_minute < p_day_start_minutes then open_minute + 1440 else open_minute end as open_offset,
      case when close_minute <= p_day_start_minutes then close_minute + 1440 else close_minute end as close_offset
    from day_spans
  ),
  instants as (
    select
      (business_date + make_interval(mins => open_offset)) at time zone p_timezone as opens_at,
      (business_date + make_interval(mins => case when close_offset <= open_offset then close_offset + 1440 else close_offset end)) at time zone p_timezone as closes_at
    from laid_out
  )
  select i.opens_at, i.closes_at
  from instants i
  where i.closes_at > p_from
    and i.opens_at < p_to
  order by i.opens_at, i.closes_at;
$$;

comment on function app.opening_spans(jsonb, text, integer, timestamptz, timestamptz) is 'opening spans of stores.opening_hours that overlap [p_from, p_to), as instants: a weekday key holds the spans of the business dates of that weekday, a time before the business-day start belongs to the next calendar day, and a close at or before the open runs past midnight; malformed spans are ignored and null hours give no span';

create function app.store_open_at(
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
    when p_opening_hours is null then null
    else exists (
      select 1
      from app.opening_spans(p_opening_hours, p_timezone, p_day_start_minutes, p_at, p_at + interval '1 microsecond') s
      where s.opens_at <= p_at
        and p_at < s.closes_at
    )
  end;
$$;

comment on function app.store_open_at(jsonb, text, integer, timestamptz) is 'whether the store is open at the instant, in store-local time; null when its opening hours were never entered';

create function app.opening_minutes_between(
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
    when p_opening_hours is null then floor(extract(epoch from (p_to - p_from)) / 60)::integer
    else coalesce((select floor(sum(extract(epoch from (m.island_end - m.island_start))) / 60)::integer from merged m), 0)
  end;
$$;

comment on function app.opening_minutes_between(jsonb, text, integer, timestamptz, timestamptz) is 'whole minutes of opening time between two instants, overlapping spans counted once; every minute counts when the opening hours were never entered';

create function app.store_due_for_incremental(
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
  select p_opening_hours is null
    or coalesce(app.store_open_at(p_opening_hours, p_timezone, p_day_start_minutes, p_at), false)
    or app.opening_minutes_between(p_opening_hours, p_timezone, p_day_start_minutes, p_at - p_interval, p_at) > 0;
$$;

comment on function app.store_due_for_incremental(jsonb, text, integer, timestamptz, interval) is 'whether a scheduler tick at p_at syncs the store: it is open at the tick, it was open during the interval before it (the tick after closing collects the last sales), or its opening hours are unknown (then every tick syncs it)';

create function app.incremental_sync_targets(p_at timestamptz default now())
returns table (tenant_id uuid, store_id uuid, hours_known boolean, open_now boolean)
language sql
stable
set search_path = ''
as $$
  select
    s.tenant_id,
    s.id,
    s.opening_hours is not null,
    coalesce(app.store_open_at(s.opening_hours, s.timezone, s.business_day_start_minutes, p_at), true)
  from public.stores s
  join public.pos_accounts a on a.id = s.pos_account_id
  where s.active
    and a.status::text not in ('paused', 'auth_failed')
    and not coalesce(s.settings @> '{"incremental_sync": false}'::jsonb, false)
    and app.store_due_for_incremental(s.opening_hours, s.timezone, s.business_day_start_minutes, p_at)
  order by s.tenant_id, s.id;
$$;

comment on function app.incremental_sync_targets(timestamptz) is 'stores a scheduler tick at p_at dispatches: active stores of accounts that are neither paused nor auth_failed, not opted out with stores.settings incremental_sync false, and due by app.store_due_for_incremental';

create function app.claim_incremental_sync_ticket(p_ticket uuid)
returns table (tenant_id uuid, store_id uuid, due_at timestamptz)
language sql
volatile
set search_path = ''
as $$
  delete from app.incremental_sync_tickets t
  where t.ticket = p_ticket
    and t.expires_at > now()
  returning t.tenant_id, t.store_id, t.due_at;
$$;

comment on function app.claim_incremental_sync_ticket(uuid) is 'claims a dispatch ticket once: returns its store and deletes it, or returns nothing when the ticket is unknown, used or expired';

create function app.dispatch_incremental_sync(p_at timestamptz default now())
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
  delete from app.incremental_sync_tickets where expires_at <= now();
  select * into settings from app.incremental_sync_settings;
  if not found or not settings.enabled or settings.function_url is null then
    return 0;
  end if;
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

comment on function app.dispatch_incremental_sync(timestamptz) is 'the pg_cron job body: drops expired tickets, then, only while the schedule is enabled, issues one ticket per due store and posts it to the Edge Function through pg_net; p_at simulates the tick time for tests';

create function app.enable_incremental_sync(p_function_url text, p_schedule text default '*/30 * * * *')
returns bigint
language plpgsql
volatile
set search_path = ''
as $$
begin
  if p_function_url is null or p_function_url !~ '^https?://[^[:space:]]+$' then
    raise exception 'enable_incremental_sync needs the http(s) URL of the sync-incremental function' using errcode = '22023';
  end if;
  update app.incremental_sync_settings
  set enabled = true, function_url = p_function_url, updated_at = now();
  return cron.schedule('sync-incremental', p_schedule, 'select app.dispatch_incremental_sync()');
end;
$$;

comment on function app.enable_incremental_sync(text, text) is 'turns the schedule on: stores the function URL and schedules the pg_cron job sync-incremental (every 30 minutes by default); running it again updates both';

create function app.disable_incremental_sync()
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  update app.incremental_sync_settings set enabled = false, updated_at = now();
  if exists (select 1 from cron.job where jobname = 'sync-incremental') then
    perform cron.unschedule('sync-incremental');
  end if;
end;
$$;

comment on function app.disable_incremental_sync() is 'turns the schedule off and removes the pg_cron job; pending tickets expire on their own';

create function app.last_successful_sync(p_store_id uuid, p_at timestamptz default now())
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
    and (r.store_id is null or r.store_id = p_store_id)
    and r.finished_at <= p_at;
$$;

comment on function app.last_successful_sync(uuid, timestamptz) is 'end of the last successful sales run covering the store at or before p_at: an incremental run of the store or a window run of its account';

create function app.sync_gap_minutes(p_store_id uuid, p_at timestamptz default now())
returns integer
language sql
stable
set search_path = ''
as $$
  select app.opening_minutes_between(
    s.opening_hours,
    s.timezone,
    s.business_day_start_minutes,
    greatest(last_sync.finished_at, p_at - interval '7 days'),
    p_at
  )
  from public.stores s
  cross join lateral (select app.last_successful_sync(s.id, p_at) as finished_at) last_sync
  where s.id = p_store_id
    and last_sync.finished_at is not null;
$$;

comment on function app.sync_gap_minutes(uuid, timestamptz) is 'minutes of opening time since the last successful sync of the store, looking back at most 7 days; null when the store was never synced; the dead-man''s switch fires above 90';

create function app.longest_sync_gap_minutes(p_store_id uuid, p_from timestamptz, p_to timestamptz)
returns integer
language sql
stable
set search_path = ''
as $$
  with store as (
    select s.id, s.pos_account_id, s.opening_hours, s.timezone, s.business_day_start_minutes
    from public.stores s
    where s.id = p_store_id
      and app.last_successful_sync(s.id, p_to) is not null
  ),
  points as (
    select p_from as at
    from store
    union
    select r.finished_at
    from store st
    join public.sync_runs r on r.pos_account_id = st.pos_account_id
    where r.status = 'succeeded'
      and r.kind <> 'master_data'
      and (r.store_id is null or r.store_id = st.id)
      and r.finished_at > p_from
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

comment on function app.longest_sync_gap_minutes(uuid, timestamptz, timestamptz) is 'the longest stretch of opening time between p_from and p_to without a successful sync of the store, in minutes; null when the store was never synced by p_to; the nightly run checks the last business day with it';

revoke all on function app.opening_spans(jsonb, text, integer, timestamptz, timestamptz) from public;
revoke all on function app.store_open_at(jsonb, text, integer, timestamptz) from public;
revoke all on function app.opening_minutes_between(jsonb, text, integer, timestamptz, timestamptz) from public;
revoke all on function app.store_due_for_incremental(jsonb, text, integer, timestamptz, interval) from public;
revoke all on function app.incremental_sync_targets(timestamptz) from public;
revoke all on function app.claim_incremental_sync_ticket(uuid) from public;
revoke all on function app.dispatch_incremental_sync(timestamptz) from public;
revoke all on function app.enable_incremental_sync(text, text) from public;
revoke all on function app.disable_incremental_sync() from public;
revoke all on function app.last_successful_sync(uuid, timestamptz) from public;
revoke all on function app.sync_gap_minutes(uuid, timestamptz) from public;
revoke all on function app.longest_sync_gap_minutes(uuid, timestamptz, timestamptz) from public;
