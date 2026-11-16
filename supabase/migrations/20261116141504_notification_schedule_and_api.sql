alter table app.notify_settings
  add column continuation_depth smallint not null default 0 check (continuation_depth between 0 and 3);

comment on column app.notify_settings.continuation_depth is 'continuation tickets posted since the last scheduled, kicked or manual ticket; app.kick_notify(''continue'') refuses a fourth';

create or replace function app.post_notify_ticket(p_reason text)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  settings app.notify_settings%rowtype;
  issued uuid;
  request bigint;
begin
  select * into settings from app.notify_settings for update;
  if not found or settings.function_url is null then
    raise exception 'post_notify_ticket needs app.notify_settings.function_url' using errcode = '22023';
  end if;
  insert into app.notify_tickets (reason, expires_at)
  values (p_reason, now() + settings.ticket_lifetime)
  returning ticket into issued;
  select net.http_post(
    url := settings.function_url,
    body := jsonb_build_object('ticket', issued),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := settings.request_timeout_ms
  ) into request;
  update app.notify_tickets t set request_id = request where t.ticket = issued;
  update app.notify_settings s
  set continuation_depth = case when p_reason = 'continue' then least(s.continuation_depth + 1, 3) else 0 end,
      updated_at = now();
  return issued;
end;
$$;

comment on function app.post_notify_ticket(text) is 'issues a ticket and posts only {"ticket": id} to the notify function through pg_net with request_timeout_ms, keeping the request id; counts a continuation in continuation_depth and resets it for any other reason; needs function_url';

create or replace function app.kick_notify(p_reason text default 'kick')
returns boolean
language plpgsql
volatile
set search_path = ''
as $$
declare
  settings app.notify_settings%rowtype;
begin
  select * into settings from app.notify_settings;
  if not found or not settings.enabled or settings.function_url is null then
    return false;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fnb-notify:kick', 0));
  if p_reason = 'continue' and (select s.continuation_depth from app.notify_settings s) >= 3 then
    return false;
  end if;
  if exists (select 1 from app.notify_tickets t where t.issued_at > now() - interval '30 seconds') then
    return false;
  end if;
  perform app.post_notify_ticket(p_reason);
  return true;
end;
$$;

comment on function app.kick_notify(text) is 'posts a ticket at once when the schedule is enabled, a function URL is set and no ticket was issued in the last 30 seconds; a continuation is refused once 3 were chained after the last other ticket; returns false and does nothing otherwise, so every step may call it before the schedule exists';

create function app.enable_notify(p_function_url text, p_schedule text default '*/5 * * * *')
returns bigint
language plpgsql
volatile
set search_path = ''
as $$
begin
  if p_function_url is null or p_function_url !~ '^https?://[^[:space:]]+$' then
    raise exception 'enable_notify needs the http(s) URL of the notify function' using errcode = '22023';
  end if;
  if p_schedule is null or btrim(p_schedule) = '' then
    raise exception 'enable_notify needs a cron schedule' using errcode = '22023';
  end if;
  update app.notify_settings
  set enabled = true, function_url = p_function_url, continuation_depth = 0, updated_at = now();
  return cron.schedule('notify', p_schedule, 'select app.notify_tick()');
end;
$$;

comment on function app.enable_notify(text, text) is 'turns the notify schedule on: stores the function URL, enables the tick and schedules the pg_cron job notify (every 5 minutes by default) running select app.notify_tick(); returns the job id; running it again updates both; 22023 for a URL that is not http(s)';

create function app.disable_notify()
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  update app.notify_settings set enabled = false, updated_at = now();
  if exists (select 1 from cron.job where jobname = 'notify') then
    perform cron.unschedule('notify');
  end if;
end;
$$;

comment on function app.disable_notify() is 'turns the notify schedule off and removes the pg_cron job notify; tickets already posted expire on their own';

create function app.evaluate_intraday_rules(p_at timestamptz, p_tenant_id uuid default null)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  candidate record;
  effective record;
  today date;
  day_start timestamptz;
  open_minutes integer;
  last_sync timestamptz;
  last_nightly timestamptz;
  hours integer;
  raised record;
  counted integer := 0;
begin
  if p_at is null then
    raise exception 'evaluate_intraday_rules needs an instant' using errcode = '22023';
  end if;
  for candidate in
    select s.id, s.tenant_id, s.pos_account_id, s.opening_hours, s.timezone, s.business_day_start_minutes
    from public.stores s
    join public.pos_accounts a on a.id = s.pos_account_id
    where (p_tenant_id is null or s.tenant_id = p_tenant_id)
      and a.status::text not in ('paused', 'auth_failed')
      and app.tenant_has_destinations(s.tenant_id)
      and app.opening_hours_known(s.opening_hours)
      and app.incremental_sync_watched(s.id)
      and coalesce(app.store_open_at(s.opening_hours, s.timezone, s.business_day_start_minutes, p_at), false)
    order by s.tenant_id, s.id
  loop
    select r.* into effective from app.effective_alert_rule(candidate.tenant_id, candidate.id, 'zero_sales_open') r;
    continue when not coalesce(effective.enabled, false);
    today := ((p_at at time zone candidate.timezone) - make_interval(mins => candidate.business_day_start_minutes))::date;
    continue when exists (
      select 1
      from public.alert_events e
      where e.tenant_id = candidate.tenant_id
        and e.state = 'open'
        and e.dedupe_key = 'zero_sales_open:store:' || candidate.id::text || ':' || to_char(today, 'YYYY-MM-DD')
    );
    day_start := (today + make_interval(mins => candidate.business_day_start_minutes)) at time zone candidate.timezone;
    open_minutes := app.opening_minutes_between(candidate.opening_hours, candidate.timezone, candidate.business_day_start_minutes, day_start, p_at);
    continue when open_minutes < coalesce((effective.params ->> 'min_open_minutes')::integer, 120);
    last_sync := app.last_successful_sync(candidate.id, p_at);
    continue when last_sync is null
      or last_sync < p_at - make_interval(mins => coalesce((effective.params ->> 'fresh_sync_minutes')::integer, 45));
    continue when exists (
      select 1
      from public.invoices i
      where i.store_id = candidate.id
        and i.business_date = today
        and i.status <> 'voided'
    );
    continue when coalesce((effective.params ->> 'skip_holidays')::boolean, true)
      and coalesce(app.is_excluded_day(array[candidate.id], today), false);
    continue when coalesce(
      (select min(k.business_date) from public.sync_checks k where k.store_id = candidate.id),
      'infinity'::date
    ) > today - coalesce((effective.params ->> 'min_history_days')::integer, 28);
    select r.* into raised
    from app.raise_alert(candidate.tenant_id, 'zero_sales_open', 'store:' || candidate.id::text || ':' || to_char(today, 'YYYY-MM-DD'),
      'scheduler', p_at, candidate.id, candidate.pos_account_id, null, today,
      jsonb_build_object('open_minutes', open_minutes)) r;
    if raised.outcome is distinct from 'ignored_disabled' then
      counted := counted + 1;
    end if;
  end loop;

  for candidate in
    select t.id as tenant_id
    from public.tenants t
    where (p_tenant_id is null or t.id = p_tenant_id)
      and app.tenant_has_destinations(t.id)
    order by t.id
  loop
    select r.* into effective from app.effective_alert_rule(candidate.tenant_id, null, 'nightly_missing') r;
    continue when not coalesce(effective.enabled, false);
    continue when exists (
      select 1
      from public.alert_events e
      where e.tenant_id = candidate.tenant_id
        and e.state = 'open'
        and e.dedupe_key = 'nightly_missing:tenant'
    );
    continue when not exists (
      select 1 from app.alert_destinations(candidate.tenant_id, null, null, 'nightly_missing') d
    );
    select max(r.finished_at) into last_nightly
    from public.sync_runs r
    where r.tenant_id = candidate.tenant_id
      and r.kind = 'nightly'
      and r.status = 'succeeded'
      and r.finished_at <= p_at;
    continue when last_nightly is null;
    hours := coalesce((effective.params ->> 'hours')::integer, 30);
    continue when last_nightly > p_at - make_interval(hours => hours);
    select r.* into raised
    from app.raise_alert(candidate.tenant_id, 'nightly_missing', 'tenant', 'scheduler', p_at,
      null, null, null, null,
      jsonb_build_object('hours', hours, 'hours_since_nightly', floor(extract(epoch from (p_at - last_nightly)) / 3600)::integer)) r;
    if raised.outcome is distinct from 'ignored_disabled' then
      counted := counted + 1;
    end if;
  end loop;
  return counted;
end;
$$;

comment on function app.evaluate_intraday_rules(timestamptz, uuid) is 'the intraday rules of the tick, only for tenants with an active or failing, enabled destination: zero_sales_open on store:<id>:<business date> for a store with known hours, open at p_at, watched by the incremental sync, whose account is neither paused nor auth_failed, after min_open_minutes of opening time today, with a successful sync within fresh_sync_minutes, no invoice of the business date that is not voided, not an excluded day when skip_holidays, and checked history reaching min_history_days back; nightly_missing on tenant when a destination receives it, a succeeded nightly ran before and none finished in the last hours; an open episode of the key is left alone; returns the readings recorded';

create or replace function app.notify_tick_rules(p_at timestamptz, p_tenant_id uuid default null)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  reconciled integer;
  imported integer;
  channel_failures integer;
  due integer;
  intraday integer;
begin
  reconciled := app.reconcile_alerts(p_at, p_tenant_id);
  imported := app.import_sync_alerts(p_at, p_tenant_id);
  channel_failures := app.evaluate_channel_health(p_at, p_tenant_id);
  select count(*)::integer into due from app.due_digests(p_at, p_tenant_id);
  intraday := app.evaluate_intraday_rules(p_at, p_tenant_id);
  return jsonb_build_object(
    'reconciled', reconciled,
    'imported', imported,
    'channel_failed', channel_failures,
    'due_digests', due,
    'intraday', intraday
  );
end;
$$;

comment on function app.notify_tick_rules(timestamptz, uuid) is 'the rules half of the notify tick, the one hook later migrations replace with create or replace; third form: app.reconcile_alerts, app.import_sync_alerts, app.evaluate_channel_health, the count of app.due_digests, then app.evaluate_intraday_rules, returned as the count-only object {reconciled, imported, channel_failed, due_digests, intraday}';

revoke all on function app.post_notify_ticket(text) from public;
revoke all on function app.kick_notify(text) from public;
revoke all on function app.enable_notify(text, text) from public;
revoke all on function app.disable_notify() from public;
revoke all on function app.evaluate_intraday_rules(timestamptz, uuid) from public;
revoke all on function app.notify_tick_rules(timestamptz, uuid) from public;
