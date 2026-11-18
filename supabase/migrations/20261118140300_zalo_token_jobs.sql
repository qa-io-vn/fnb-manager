insert into public.alert_rule_catalog (rule_key, category, delivery, default_enabled, default_severity, default_roles, default_params, params_schema, default_cooldown, remind_every, notify_on_resolve, store_scoped, sort_order)
values
  ('zalo_token_failed', 'channel', 'immediate', true, 'critical', array['owner']::public.tenant_role[],
    '{}', '{}',
    interval '12 hours', interval '24 hours', true, false, 170),
  ('oa_package_expiring', 'channel', 'immediate', true, 'warning', array['owner']::public.tenant_role[],
    '{"first_notice_days": 30, "last_notice_days": 7}',
    '{"first_notice_days": {"type": "integer", "min": 8, "max": 90}, "last_notice_days": {"type": "integer", "min": 1, "max": 30}}',
    interval '24 hours', null, false, false, 180);

create table app.zalo_oauth_pending (
  brand_id uuid primary key,
  tenant_id uuid not null,
  state_sha256 text not null unique check (state_sha256 ~ '^[0-9a-f]{64}$'),
  code_verifier text not null check (code_verifier ~ '^[A-Za-z0-9._~-]{43,128}$'),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes'),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete cascade
);

create index zalo_oauth_pending_expires_at_idx on app.zalo_oauth_pending (expires_at);

comment on table app.zalo_oauth_pending is 'one pending OA authorisation per brand (fnb zalo oa authorize): the SHA-256 of its state and its PKCE code verifier, valid 10 minutes, claimed and deleted once by the zalo-oauth callback and purged by the pg_cron job zalo-oauth-purge, which runs only while a row waits; closed to every API role';
comment on column app.zalo_oauth_pending.state_sha256 is 'sha256 hex of the state sent in the permission URL; the state itself is never stored';

create table app.zalo_token_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  function_url text check (function_url is null or function_url ~ '^https?://[^[:space:]]+$'),
  request_timeout_ms integer not null default 30000 check (request_timeout_ms between 1000 and 150000),
  ticket_lifetime interval not null default interval '10 minutes' check (ticket_lifetime between interval '1 minute' and interval '1 hour'),
  updated_at timestamptz not null default now()
);

insert into app.zalo_token_settings default values;

comment on table app.zalo_token_settings is 'single row driving the pg_cron schedule of the token jobs (ADR-028): disabled until the owner runs app.enable_zalo_token_jobs(<zalo-oauth URL>)';

create table app.zalo_token_tickets (
  ticket uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  brand_id uuid not null,
  kind text not null check (kind in ('oa', 'developer')),
  source text not null default 'schedule' check (source in ('schedule', 'manual')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  request_id bigint,
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete cascade
);

create index zalo_token_tickets_expires_at_idx on app.zalo_token_tickets (expires_at);
create index zalo_token_tickets_brand_kind_idx on app.zalo_token_tickets (brand_id, kind);

comment on table app.zalo_token_tickets is 'single-use tickets of the token schedule (ADR-028): one per due token, posted by id only to zalo-oauth, which claims it before it does anything; an unclaimed ticket expires';

revoke all on table app.zalo_oauth_pending from public, anon, authenticated, service_role;
revoke all on table app.zalo_token_settings from public, anon, authenticated, service_role;
revoke all on table app.zalo_token_tickets from public, anon, authenticated, service_role;

create function app.zalo_token_refresh_after(p_kind text)
returns interval
language sql
immutable
set search_path = ''
as $$
  select case p_kind
    when 'oa' then interval '11 hours'
    when 'developer' then interval '20 hours'
  end;
$$;

comment on function app.zalo_token_refresh_after(text) is 'the age after which a token pair is refreshed: 11 hours for the OA pair (its access token lives 25 hours, so a 12-hourly run keeps a spare attempt), 20 hours for the Mini App developer pair (rotated daily; its refresh token lives one month)';

create function app.zalo_token_targets(p_kind text, p_tenant_id uuid default null, p_brand_key text default null)
returns table (tenant_id uuid, tenant_slug text, brand_id uuid, brand_key text, app_external_id text, app_secret_name text, has_token boolean)
language sql
stable
set search_path = ''
as $$
  select b.tenant_id, t.slug, b.id, b.brand_key, z.external_id, z.secret_name,
    exists (select 1 from public.zalo_tokens k where k.brand_id = b.id and k.kind = p_kind)
  from public.brands b
  join public.tenants t on t.id = b.tenant_id
  join public.zalo_apps z on z.brand_id = b.id and z.status = 'active'
  where p_kind in ('oa', 'developer')
    and (p_kind = 'developer' or exists (select 1 from public.oas o where o.brand_id = b.id))
    and (p_tenant_id is null or b.tenant_id = p_tenant_id)
    and (p_brand_key is null or b.brand_key = p_brand_key)
  order by t.slug, b.brand_key;
$$;

comment on function app.zalo_token_targets(text, uuid, text) is 'the brands a token job of the kind serves, in tenant slug and brand key order: an active Zalo App, and an OA for the oa kind; has_token says whether a pair is stored yet';

create function app.purge_oa_authorizations(p_at timestamptz default now())
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  purged integer;
begin
  delete from app.zalo_oauth_pending p where p.expires_at <= p_at;
  get diagnostics purged = row_count;
  if not exists (select 1 from app.zalo_oauth_pending)
     and exists (select 1 from cron.job j where j.jobname = 'zalo-oauth-purge') then
    perform cron.unschedule('zalo-oauth-purge');
  end if;
  return purged;
end;
$$;

comment on function app.purge_oa_authorizations(timestamptz) is 'the body of the pg_cron job zalo-oauth-purge: deletes the pending authorisations past their 10 minutes and removes the job once none is left; returns how many it deleted';

create function app.begin_oa_authorization(p_brand_id uuid, p_state_sha256 text, p_code_verifier text, p_at timestamptz default now())
returns table (expires_at timestamptz, app_external_id text, oa_external_id text)
language plpgsql
volatile
set search_path = ''
as $$
declare
  target record;
  valid_until timestamptz;
begin
  if p_at is null then
    raise exception 'begin_oa_authorization needs an instant' using errcode = '22023';
  end if;
  select b.tenant_id, z.external_id as app_id, o.external_id as oa_id into target
  from public.brands b
  join public.zalo_apps z on z.brand_id = b.id and z.status = 'active'
  join public.oas o on o.brand_id = b.id
  where b.id = p_brand_id;
  if not found then
    raise exception 'begin_oa_authorization needs a brand with an active Zalo App and an OA' using errcode = '22023';
  end if;
  perform app.purge_oa_authorizations(p_at);
  valid_until := p_at + interval '10 minutes';
  insert into app.zalo_oauth_pending as p (brand_id, tenant_id, state_sha256, code_verifier, created_at, expires_at)
  values (p_brand_id, target.tenant_id, p_state_sha256, p_code_verifier, p_at, valid_until)
  on conflict (brand_id) do update
    set state_sha256 = excluded.state_sha256,
        code_verifier = excluded.code_verifier,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at;
  if not exists (select 1 from cron.job j where j.jobname = 'zalo-oauth-purge') then
    perform cron.schedule('zalo-oauth-purge', '* * * * *', 'select app.purge_oa_authorizations()');
  end if;
  return query select valid_until, target.app_id::text, target.oa_id::text;
end;
$$;

comment on function app.begin_oa_authorization(uuid, text, text, timestamptz) is 'keeps the PKCE code verifier and the state hash of a new OA authorisation for 10 minutes, replacing the brand''s pending one, and schedules the purge job; returns the expiry and the Zalo App and OA ids the permission URL needs; 22023 for a brand without an active Zalo App or an OA';

create function app.claim_oa_authorization(p_state_sha256 text, p_at timestamptz default now())
returns table (outcome text, tenant_id uuid, brand_id uuid, brand_key text, code_verifier text, app_external_id text, app_secret_name text, oa_external_id text)
language plpgsql
volatile
set search_path = ''
as $$
declare
  claimed app.zalo_oauth_pending%rowtype;
begin
  delete from app.zalo_oauth_pending p
  where p.state_sha256 = p_state_sha256
  returning p.* into claimed;
  if not found then
    return query select 'unknown'::text, null::uuid, null::uuid, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;
  if p_at is null or claimed.expires_at <= p_at then
    return query select 'expired'::text, null::uuid, null::uuid, null::text, null::text, null::text, null::text, null::text;
    return;
  end if;
  return query
  select 'claimed'::text, b.tenant_id, b.id, b.brand_key, claimed.code_verifier, z.external_id, z.secret_name, o.external_id
  from public.brands b
  join public.zalo_apps z on z.brand_id = b.id and z.status = 'active'
  join public.oas o on o.brand_id = b.id
  where b.id = claimed.brand_id;
  if not found then
    return query select 'unknown'::text, null::uuid, null::uuid, null::text, null::text, null::text, null::text, null::text;
  end if;
end;
$$;

comment on function app.claim_oa_authorization(text, timestamptz) is 'claims a pending authorisation once by the SHA-256 of its state and deletes it: claimed with the code verifier, the brand and its Zalo App and OA, expired after its 10 minutes, or unknown for any other state (a wrong, used or purged one)';

create function app.save_zalo_tokens(
  p_brand_id uuid,
  p_kind text,
  p_access_token text,
  p_access_expires_at timestamptz,
  p_refresh_token text,
  p_refresh_expires_at timestamptz,
  p_at timestamptz default now()
)
returns bigint
language plpgsql
volatile
set search_path = ''
as $$
declare
  owner_tenant uuid;
  saved bigint;
begin
  if p_kind is null or p_kind not in ('oa', 'developer') or p_at is null
     or p_access_expires_at is null or p_access_expires_at <= p_at
     or (p_refresh_expires_at is not null and p_refresh_expires_at <= p_at) then
    raise exception 'save_zalo_tokens needs a kind (oa or developer), an instant and expiries after it' using errcode = '22023';
  end if;
  select b.tenant_id into owner_tenant from public.brands b where b.id = p_brand_id;
  if not found then
    raise exception 'save_zalo_tokens needs an existing brand' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fnb-zalo-token:' || p_brand_id::text || ':' || p_kind, 0));
  insert into public.zalo_tokens as k (tenant_id, brand_id, kind, access_token, access_expires_at, refresh_token, refresh_expires_at, refreshed_at)
  values (owner_tenant, p_brand_id, p_kind, p_access_token, p_access_expires_at, p_refresh_token, p_refresh_expires_at, p_at)
  on conflict (brand_id, kind) do update
    set access_token = excluded.access_token,
        access_expires_at = excluded.access_expires_at,
        refresh_token = excluded.refresh_token,
        refresh_expires_at = excluded.refresh_expires_at,
        refreshed_at = excluded.refreshed_at
  returning k.version into saved;
  return saved;
end;
$$;

comment on function app.save_zalo_tokens(uuid, text, text, timestamptz, text, timestamptz, timestamptz) is 'stores a token pair obtained outside a refresh (the OA authorisation, the first developer pair) under the token lock, inserting the brand''s row or replacing its pair; returns the row''s version';

create function app.lock_zalo_token(p_brand_id uuid, p_kind text, p_refresh_after interval default null, p_at timestamptz default now())
returns table (token_id uuid, version bigint, refreshed_at timestamptz, access_expires_at timestamptz, due boolean, refresh_token text)
language plpgsql
volatile
set search_path = ''
as $$
declare
  stored public.zalo_tokens%rowtype;
  threshold interval;
  is_due boolean;
begin
  if p_brand_id is null or p_kind is null or p_kind not in ('oa', 'developer') or p_at is null then
    raise exception 'lock_zalo_token needs a brand, a kind (oa or developer) and an instant' using errcode = '22023';
  end if;
  threshold := coalesce(p_refresh_after, app.zalo_token_refresh_after(p_kind));
  if threshold < interval '0' then
    raise exception 'lock_zalo_token needs a refresh age of zero or more' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fnb-zalo-token:' || p_brand_id::text || ':' || p_kind, 0));
  select k.* into stored
  from public.zalo_tokens k
  where k.brand_id = p_brand_id
    and k.kind = p_kind
  for update;
  if not found then
    return;
  end if;
  is_due := stored.refreshed_at <= p_at - threshold;
  return query select stored.id, stored.version, stored.refreshed_at, stored.access_expires_at, is_due,
    case when is_due then stored.refresh_token end;
end;
$$;

comment on function app.lock_zalo_token(uuid, text, interval, timestamptz) is 'the single-row lock of the token jobs, held until the caller''s transaction ends: waits for the brand''s token lock (an advisory lock, so two sessions serialise even before a row exists) and the row lock, then reads the row again and says whether it is due (older than p_refresh_after, by default app.zalo_token_refresh_after); the refresh token is returned only when due; no row when no pair is stored';

create function app.store_zalo_token_refresh(
  p_token_id uuid,
  p_version bigint,
  p_access_token text,
  p_access_expires_at timestamptz,
  p_refresh_token text,
  p_refresh_expires_at timestamptz,
  p_at timestamptz default now()
)
returns bigint
language plpgsql
volatile
set search_path = ''
as $$
declare
  stored bigint;
begin
  if p_at is null or p_access_expires_at is null or p_access_expires_at <= p_at
     or (p_refresh_expires_at is not null and p_refresh_expires_at <= p_at) then
    raise exception 'store_zalo_token_refresh needs an instant and expiries after it' using errcode = '22023';
  end if;
  update public.zalo_tokens k
  set access_token = p_access_token,
      access_expires_at = p_access_expires_at,
      refresh_token = p_refresh_token,
      refresh_expires_at = p_refresh_expires_at,
      refreshed_at = p_at
  where k.id = p_token_id
    and k.version = p_version
  returning k.version into stored;
  return stored;
end;
$$;

comment on function app.store_zalo_token_refresh(uuid, bigint, text, timestamptz, text, timestamptz, timestamptz) is 'writes a refreshed pair in one update, only over the version read under app.lock_zalo_token; returns the new version, or null when the row was rewritten meanwhile';

create function app.raise_zalo_token_alert(p_brand_id uuid, p_kind text, p_reason text, p_error_code integer, p_source text, p_at timestamptz default now())
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  target public.brands%rowtype;
  raised record;
begin
  if p_kind is null or p_kind not in ('oa', 'developer')
     or p_reason is null or p_reason not in ('refused', 'not_configured', 'unanswered')
     or p_source is null or p_source not in ('cli', 'actions', 'scheduler')
     or p_at is null then
    raise exception 'raise_zalo_token_alert needs a kind, a reason (refused, not_configured or unanswered), a source (cli, actions or scheduler) and an instant' using errcode = '22023';
  end if;
  select b.* into target from public.brands b where b.id = p_brand_id;
  if not found then
    return 'none';
  end if;
  select a.* into raised
  from app.raise_alert(
    target.tenant_id, 'zalo_token_failed', p_kind || ':' || target.id::text, p_source, p_at,
    null, null, null, null,
    jsonb_strip_nulls(jsonb_build_object('kind', p_kind, 'brand', target.brand_key, 'reason', p_reason, 'error_code', p_error_code)),
    null, false
  ) a;
  return raised.outcome;
end;
$$;

comment on function app.raise_zalo_token_alert(uuid, text, text, integer, text, timestamptz) is 'raises zalo_token_failed for a brand''s OA or developer pair under <kind>:<brand id>, with count-only facts (kind, brand key, reason, Zalo''s error code): an open episode counts repeats silently until a stored pair resolves it (app.resolve_zalo_token_alert); returns the app.raise_alert outcome, or none for an unknown brand';

create function app.resolve_zalo_token_alert(p_brand_id uuid, p_kind text, p_at timestamptz default now())
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  owner_tenant uuid;
  dedupe text;
  episode public.alert_events%rowtype;
  effective record;
  queued integer := 0;
begin
  if p_kind is null or p_kind not in ('oa', 'developer') or p_at is null then
    raise exception 'resolve_zalo_token_alert needs a kind (oa or developer) and an instant' using errcode = '22023';
  end if;
  select b.tenant_id into owner_tenant from public.brands b where b.id = p_brand_id;
  if not found then
    return 0;
  end if;
  dedupe := 'zalo_token_failed:' || p_kind || ':' || p_brand_id::text;
  perform pg_advisory_xact_lock(hashtextextended('fnb-notify:alert:' || owner_tenant::text || ':' || dedupe, 0));
  select e.* into episode
  from public.alert_events e
  where e.tenant_id = owner_tenant
    and e.dedupe_key = dedupe
    and e.state = 'open'
  for update;
  if not found then
    return 0;
  end if;
  update public.alert_events e
  set state = 'resolved',
      resolved_at = greatest(p_at, e.opened_at),
      resolution = 'recovered'
  where e.id = episode.id;
  select r.* into effective from app.effective_alert_rule(owner_tenant, null, 'zalo_token_failed') r;
  if coalesce(effective.notify_on_resolve, false) then
    queued := app.enqueue_alert_messages(episode.id, 'alert_resolved', p_at);
    if queued > 0 then
      update public.alert_events e set notifications = e.notifications + queued where e.id = episode.id;
    end if;
  end if;
  return 1;
end;
$$;

comment on function app.resolve_zalo_token_alert(uuid, text, timestamptz) is 'resolves the open zalo_token_failed episode of a brand''s pair as recovered once a pair is stored again, and queues the recovery notice to the destinations that received the alert; returns 1 when an episode was resolved, else 0';

create function app.check_oa_package_expiry(p_at timestamptz default now(), p_tenant_id uuid default null, p_source text default 'scheduler')
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  target record;
  effective record;
  first_days integer;
  last_days integer;
  notice integer;
  subject text;
  raised record;
  opened integer := 0;
begin
  if p_at is null or p_source is null or p_source not in ('cli', 'actions', 'scheduler') then
    raise exception 'check_oa_package_expiry needs an instant and a source (cli, actions or scheduler)' using errcode = '22023';
  end if;
  for target in
    select o.id, o.tenant_id, o.package_tier, o.package_expires_on,
      o.package_expires_on - (p_at at time zone t.timezone)::date as days_left
    from public.oas o
    join public.tenants t on t.id = o.tenant_id
    where o.package_expires_on is not null
      and (p_tenant_id is null or o.tenant_id = p_tenant_id)
    order by o.tenant_id, o.id
  loop
    continue when target.days_left < 0;
    select r.* into effective from app.effective_alert_rule(target.tenant_id, null, 'oa_package_expiring') r;
    first_days := coalesce((effective.params ->> 'first_notice_days')::integer, 30);
    last_days := coalesce((effective.params ->> 'last_notice_days')::integer, 7);
    notice := case
      when target.days_left <= least(first_days, last_days) then least(first_days, last_days)
      when target.days_left <= greatest(first_days, last_days) then greatest(first_days, last_days)
    end;
    continue when notice is null;
    subject := 'oa:' || target.id::text || ':' || to_char(target.package_expires_on, 'YYYY-MM-DD') || ':' || notice::text;
    perform pg_advisory_xact_lock(hashtextextended('fnb-notify:alert:' || target.tenant_id::text || ':oa_package_expiring:' || subject, 0));
    continue when exists (
      select 1
      from public.alert_events e
      where e.tenant_id = target.tenant_id
        and e.dedupe_key = 'oa_package_expiring:' || subject
    );
    select a.* into raised
    from app.raise_alert(
      target.tenant_id, 'oa_package_expiring', subject, p_source, p_at,
      null, null, null, null,
      jsonb_build_object('days_left', target.days_left, 'notice_days', notice, 'expires_on', to_char(target.package_expires_on, 'YYYY-MM-DD'), 'tier', target.package_tier),
      null, true
    ) a;
    if raised.outcome = 'opened' then
      opened := opened + 1;
    end if;
  end loop;
  return opened;
end;
$$;

comment on function app.check_oa_package_expiry(timestamptz, uuid, text) is 'raises oa_package_expiring once per OA, expiry date and notice: when the package of oas.package_expires_on has first_notice_days (30) or fewer days left in the tenant''s zone, and again at last_notice_days (7); a first reading already inside the last notice raises only that one; an expired package raises nothing; instant episodes under oa:<OA row id>:<expiry>:<notice> with count-only facts; returns how many it opened';

create function app.zalo_tokens_due(p_at timestamptz default now())
returns table (tenant_id uuid, brand_id uuid, kind text)
language sql
stable
set search_path = ''
as $$
  select k.tenant_id, k.brand_id, k.kind
  from public.zalo_tokens k
  join public.zalo_apps z on z.brand_id = k.brand_id and z.status = 'active'
  where k.refreshed_at <= p_at - app.zalo_token_refresh_after(k.kind)
    and (k.kind = 'developer' or exists (select 1 from public.oas o where o.brand_id = k.brand_id))
  order by k.tenant_id, k.brand_id, k.kind;
$$;

comment on function app.zalo_tokens_due(timestamptz) is 'the stored pairs older than their refresh age (app.zalo_token_refresh_after) whose brand has an active Zalo App, and an OA for an OA pair';

create function app.dispatch_zalo_tokens(p_at timestamptz default now())
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  settings app.zalo_token_settings%rowtype;
  target record;
  issued uuid;
  request bigint;
  dispatched integer := 0;
begin
  delete from app.zalo_token_tickets t where t.expires_at <= now();
  select * into settings from app.zalo_token_settings;
  if not found or not settings.enabled or settings.function_url is null then
    return 0;
  end if;
  perform app.check_oa_package_expiry(p_at, null, 'scheduler');
  for target in
    select d.tenant_id, d.brand_id, d.kind
    from app.zalo_tokens_due(p_at) d
    where not exists (
      select 1 from app.zalo_token_tickets t where t.brand_id = d.brand_id and t.kind = d.kind
    )
  loop
    insert into app.zalo_token_tickets (tenant_id, brand_id, kind, source, expires_at)
    values (target.tenant_id, target.brand_id, target.kind, 'schedule', now() + settings.ticket_lifetime)
    returning ticket into issued;
    select net.http_post(
      url := settings.function_url,
      body := jsonb_build_object('ticket', issued),
      headers := jsonb_build_object('Content-Type', 'application/json'),
      timeout_milliseconds := settings.request_timeout_ms
    ) into request;
    update app.zalo_token_tickets t set request_id = request where t.ticket = issued;
    dispatched := dispatched + 1;
  end loop;
  return dispatched;
end;
$$;

comment on function app.dispatch_zalo_tokens(timestamptz) is 'the pg_cron job body of zalo-tokens: drops expired tickets, then, only while the schedule is enabled, checks the OA package expiries and issues one ticket per due pair that has none waiting, posted by id to zalo-oauth through pg_net; p_at simulates the tick time for tests';

create function app.claim_zalo_token_ticket(p_ticket uuid)
returns table (tenant_id uuid, brand_id uuid, kind text, source text)
language sql
volatile
set search_path = ''
as $$
  delete from app.zalo_token_tickets t
  where t.ticket = p_ticket
    and t.expires_at > now()
  returning t.tenant_id, t.brand_id, t.kind, t.source;
$$;

comment on function app.claim_zalo_token_ticket(uuid) is 'claims a token ticket once: returns its brand, kind and source and deletes it, or nothing when the ticket is unknown, used or expired';

create function app.issue_zalo_token_ticket(p_brand_id uuid, p_kind text)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  issued uuid;
begin
  if p_kind is null or p_kind not in ('oa', 'developer') then
    raise exception 'issue_zalo_token_ticket needs the kind oa or developer' using errcode = '22023';
  end if;
  insert into app.zalo_token_tickets (tenant_id, brand_id, kind, source, expires_at)
  select b.tenant_id, b.id, p_kind, 'manual', now() + coalesce((select s.ticket_lifetime from app.zalo_token_settings s), interval '10 minutes')
  from public.brands b
  where b.id = p_brand_id
  returning ticket into issued;
  if issued is null then
    raise exception 'issue_zalo_token_ticket needs the id of an existing brand' using errcode = '22023';
  end if;
  return issued;
end;
$$;

comment on function app.issue_zalo_token_ticket(uuid, text) is 'issues one manual ticket for a brand''s pair, whether or not the schedule is enabled, so an operator can post it to zalo-oauth; the age rule still decides whether it refreshes';

create function app.enable_zalo_token_jobs(p_function_url text, p_schedule text default '41 * * * *')
returns bigint
language plpgsql
volatile
set search_path = ''
as $$
begin
  if p_function_url is null or p_function_url !~ '^https?://[^[:space:]]+$' then
    raise exception 'enable_zalo_token_jobs needs the http(s) URL of the zalo-oauth function' using errcode = '22023';
  end if;
  update app.zalo_token_settings
  set enabled = true, function_url = p_function_url, updated_at = now();
  return cron.schedule('zalo-tokens', p_schedule, 'select app.dispatch_zalo_tokens()');
end;
$$;

comment on function app.enable_zalo_token_jobs(text, text) is 'turns the token schedule on: stores the zalo-oauth URL and schedules the pg_cron job zalo-tokens (hourly at minute 41 by default; a pair is refreshed only once it passes its refresh age); running it again updates both';

create function app.disable_zalo_token_jobs()
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  update app.zalo_token_settings set enabled = false, updated_at = now();
  if exists (select 1 from cron.job j where j.jobname = 'zalo-tokens') then
    perform cron.unschedule('zalo-tokens');
  end if;
end;
$$;

comment on function app.disable_zalo_token_jobs() is 'turns the token schedule off and removes the pg_cron job; waiting tickets expire on their own, and the workflow zalo-tokens.yml keeps refreshing';

revoke all on function app.zalo_token_refresh_after(text) from public, anon, authenticated, service_role;
revoke all on function app.zalo_token_targets(text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function app.purge_oa_authorizations(timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.begin_oa_authorization(uuid, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.claim_oa_authorization(text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.save_zalo_tokens(uuid, text, text, timestamptz, text, timestamptz, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.lock_zalo_token(uuid, text, interval, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.store_zalo_token_refresh(uuid, bigint, text, timestamptz, text, timestamptz, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.raise_zalo_token_alert(uuid, text, text, integer, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.resolve_zalo_token_alert(uuid, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.check_oa_package_expiry(timestamptz, uuid, text) from public, anon, authenticated, service_role;
revoke all on function app.zalo_tokens_due(timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.dispatch_zalo_tokens(timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.claim_zalo_token_ticket(uuid) from public, anon, authenticated, service_role;
revoke all on function app.issue_zalo_token_ticket(uuid, text) from public, anon, authenticated, service_role;
revoke all on function app.enable_zalo_token_jobs(text, text) from public, anon, authenticated, service_role;
revoke all on function app.disable_zalo_token_jobs() from public, anon, authenticated, service_role;
