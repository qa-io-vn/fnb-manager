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

revoke all on function app.post_notify_ticket(text) from public, anon, authenticated, service_role;
revoke all on function app.kick_notify(text) from public, anon, authenticated, service_role;
revoke all on function app.enable_notify(text, text) from public, anon, authenticated, service_role;
revoke all on function app.disable_notify() from public, anon, authenticated, service_role;
