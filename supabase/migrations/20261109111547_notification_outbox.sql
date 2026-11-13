create function app.sha256_hex(p_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(sha256(convert_to(p_value, 'UTF8')), 'hex');
$$;

comment on function app.sha256_hex(text) is 'lower-case hex SHA-256 of the UTF-8 bytes of a text; link codes and rendered bodies are stored only as such hashes';

create function app.notify_random_code(p_alphabet text, p_length integer)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet_size integer := char_length(p_alphabet);
  accepted_below integer;
  random_bytes bytea;
  byte_index integer;
  byte_value integer;
  code text := '';
begin
  if alphabet_size < 2 or alphabet_size > 128 or p_length < 1 or p_length > 32 then
    raise exception 'notify_random_code needs an alphabet of 2 to 128 characters and a length of 1 to 32' using errcode = '22023';
  end if;
  accepted_below := 256 - (256 % alphabet_size);
  while char_length(code) < p_length loop
    random_bytes := uuid_send(gen_random_uuid());
    foreach byte_index in array array[0, 1, 2, 3, 4, 5, 7, 9, 10, 11, 12, 13, 14, 15] loop
      byte_value := get_byte(random_bytes, byte_index);
      if byte_value < accepted_below and char_length(code) < p_length then
        code := code || substr(p_alphabet, byte_value % alphabet_size + 1, 1);
      end if;
    end loop;
  end loop;
  return code;
end;
$$;

comment on function app.notify_random_code(text, integer) is 'a random code of p_length characters from p_alphabet, drawn without bias from the random bytes of gen_random_uuid';

create function app.effective_alert_rule(p_tenant_id uuid, p_store_id uuid, p_rule_key text)
returns table (
  rule_key text,
  delivery text,
  enabled boolean,
  severity public.alert_severity,
  roles public.tenant_role[],
  params jsonb,
  cooldown interval,
  remind_every interval,
  notify_on_resolve boolean,
  source text
)
language sql
stable
set search_path = ''
as $$
  select
    c.rule_key,
    c.delivery,
    coalesce(s.enabled, t.enabled, c.default_enabled),
    coalesce(s.severity, t.severity, c.default_severity),
    coalesce(s.roles, t.roles, c.default_roles),
    c.default_params || coalesce(t.params, '{}'::jsonb) || coalesce(s.params, '{}'::jsonb),
    coalesce(s.cooldown, t.cooldown, c.default_cooldown),
    c.remind_every,
    c.notify_on_resolve,
    case when s.id is not null then 'store' when t.id is not null then 'tenant' else 'default' end
  from public.alert_rule_catalog c
  left join public.alert_rules t
    on t.tenant_id = p_tenant_id
   and t.store_id is null
   and t.rule_key = c.rule_key
  left join public.alert_rules s
    on p_store_id is not null
   and s.tenant_id = p_tenant_id
   and s.store_id = p_store_id
   and s.rule_key = c.rule_key
  where c.rule_key = p_rule_key;
$$;

comment on function app.effective_alert_rule(uuid, uuid, text) is 'the rule as it applies to a tenant and optionally one store: each column from the store row over the tenant row over the catalogue, params merged key by key, and source the most specific row that exists (default, tenant or store); no row for an unknown key';

create function app.effective_channel_policy(p_tenant_id uuid, p_kind public.channel_kind, p_class public.message_class)
returns public.channel_policies
language sql
stable
set search_path = ''
as $$
  select p.*
  from public.channel_policies p
  where p.channel_kind = p_kind
    and p.message_class = p_class
    and (p.tenant_id = p_tenant_id or p.tenant_id is null)
  order by p.tenant_id is null
  limit 1;
$$;

comment on function app.effective_channel_policy(uuid, public.channel_kind, public.message_class) is 'the tenant''s policy row for a channel kind and message class when it exists, else the global row; null when neither exists, which the send decision cancels as no_policy';

create function app.tenant_has_destinations(p_tenant_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.notification_channels c
    where c.tenant_id = p_tenant_id
      and c.enabled
      and c.status in ('active', 'failing')
  );
$$;

comment on function app.tenant_has_destinations(uuid) is 'whether the tenant has an active or failing, enabled destination; the tick evaluates the rules it scans for itself only for such tenants';

create function app.enqueue_message(
  p_tenant_id uuid,
  p_channel_id uuid,
  p_kind text,
  p_template_ref text,
  p_dedupe_key text,
  p_params jsonb,
  p_title text,
  p_body text,
  p_severity public.alert_severity,
  p_store_id uuid,
  p_business_date date,
  p_digest_id uuid,
  p_alert_event_id uuid,
  p_expires_at timestamptz,
  p_at timestamptz
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  destination public.notification_channels%rowtype;
  send_policy public.channel_policies%rowtype;
  created_at_value timestamptz := coalesce(p_at, now());
  created uuid;
begin
  select c.* into destination
  from public.notification_channels c
  where c.id = p_channel_id
    and c.tenant_id = p_tenant_id;
  if not found then
    raise exception 'enqueue_message needs a destination of the tenant' using errcode = '22023';
  end if;
  send_policy := app.effective_channel_policy(p_tenant_id, destination.kind, 'operational');
  insert into public.outbound_messages (
    tenant_id, channel, recipient_ref, subject_type, subject_id, purpose, template_ref, consent_record_id, status,
    created_at, kind, message_class, channel_id, store_id, digest_id, alert_event_id, business_date, severity,
    dedupe_key, params, title, body, body_sha256, expires_at
  )
  values (
    p_tenant_id,
    destination.kind::text,
    'channel:' || destination.id::text,
    case when destination.user_id is not null then 'staff'::public.consent_subject end,
    destination.user_id,
    case when destination.user_id is not null then send_policy.consent_purpose end,
    p_template_ref,
    destination.consent_record_id,
    'queued',
    created_at_value,
    p_kind,
    'operational',
    destination.id,
    p_store_id,
    p_digest_id,
    p_alert_event_id,
    p_business_date,
    p_severity,
    p_dedupe_key,
    p_params,
    p_title,
    p_body,
    app.sha256_hex(p_body),
    coalesce(p_expires_at, created_at_value + case p_kind
      when 'digest' then interval '36 hours'
      when 'link_code' then interval '15 minutes'
      when 'test' then interval '1 hour'
      when 'link_notice' then interval '1 hour'
      when 'link_confirmation' then interval '1 hour'
      else interval '24 hours'
    end)
  )
  on conflict (tenant_id, dedupe_key) where dedupe_key is not null do nothing
  returning id into created;
  if created is null then
    select o.id into created
    from public.outbound_messages o
    where o.tenant_id = p_tenant_id
      and o.dedupe_key = p_dedupe_key;
  end if;
  return created;
end;
$$;

comment on function app.enqueue_message(uuid, uuid, text, text, text, jsonb, text, text, public.alert_severity, uuid, date, uuid, uuid, timestamptz, timestamptz) is 'the one insert path of the outbox: one queued operational message to a destination of the tenant, with channel, recipient_ref, subject, purpose and consent filled from the destination and its policy, created at p_at, and expiring after the default of its kind when p_expires_at is null; a repeated dedupe key returns the first message''s id';

create function app.next_window_start(p_start time, p_end time, p_zone text, p_at timestamptz)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  with local_days as (
    select ((p_at at time zone p_zone)::date + offset_days) as local_date
    from generate_series(-1, 2) as offset_days
  ),
  spans as (
    select
      (d.local_date + p_start) at time zone p_zone as opens_at,
      (d.local_date + p_end + case when p_end <= p_start then interval '1 day' else interval '0' end) at time zone p_zone as closes_at
    from local_days d
  )
  select case
    when p_start is null then p_at
    when exists (select 1 from spans s where s.opens_at <= p_at and p_at < s.closes_at) then p_at
    else (select min(s.opens_at) from spans s where s.opens_at > p_at)
  end;
$$;

comment on function app.next_window_start(time, time, text, timestamptz) is 'p_at when it lies inside the daily window [p_start, p_end) in the zone, else the next opening; 24:00 is the end of the day, an end at or before the start crosses midnight, and a null window returns p_at';

create function app.message_decision(p_message_id uuid, p_at timestamptz)
returns table (decision text, release_at timestamptz, reason text)
language plpgsql
stable
set search_path = ''
as $$
declare
  outbox_row public.outbound_messages%rowtype;
  destination public.notification_channels%rowtype;
  send_policy public.channel_policies%rowtype;
  episode_rule_key text;
  episode_store_id uuid;
  episode_state text;
  episode_resolution text;
  message_rule_key text;
  rule_enabled boolean;
  bypass boolean;
  reader_zone text;
  opens_at timestamptz;
  period_start timestamptz;
  counted integer;
  release_instant timestamptz;
begin
  select o.* into outbox_row from public.outbound_messages o where o.id = p_message_id;
  if not found then
    return;
  end if;
  if outbox_row.expires_at is not null and outbox_row.expires_at <= p_at then
    return query select 'cancel'::text, null::timestamptz, 'expired'::text;
    return;
  end if;
  if outbox_row.alert_event_id is not null then
    select e.rule_key, e.store_id, e.state, e.resolution
    into episode_rule_key, episode_store_id, episode_state, episode_resolution
    from public.alert_events e
    where e.id = outbox_row.alert_event_id;
  end if;
  if outbox_row.kind in ('alert', 'alert_reminder') and episode_state = 'resolved' and episode_resolution is distinct from 'instant' then
    return query select 'cancel'::text, null::timestamptz, 'resolved_before_send'::text;
    return;
  end if;
  select c.* into destination from public.notification_channels c where c.id = outbox_row.channel_id;
  if not found
    or destination.status = 'disabled'
    or not destination.enabled
    or (destination.status = 'pending' and outbox_row.kind not in ('link_code', 'link_notice'))
  then
    return query select 'cancel'::text, null::timestamptz, 'destination_inactive'::text;
    return;
  end if;
  if not app.channel_kind_available(destination.kind) then
    return query select 'cancel'::text, null::timestamptz, 'unavailable'::text;
    return;
  end if;
  if outbox_row.message_class is distinct from 'operational' then
    return query select 'cancel'::text, null::timestamptz, 'class_not_enabled'::text;
    return;
  end if;
  send_policy := app.effective_channel_policy(outbox_row.tenant_id, destination.kind, outbox_row.message_class);
  if send_policy.id is null then
    return query select 'cancel'::text, null::timestamptz, 'no_policy'::text;
    return;
  end if;
  if not send_policy.allowed then
    return query select 'cancel'::text, null::timestamptz, 'not_allowed'::text;
    return;
  end if;
  if not send_policy.api_send_allowed then
    return query select 'cancel'::text, null::timestamptz, 'manual_only'::text;
    return;
  end if;
  if send_policy.requires_consent
    and destination.user_id is not null
    and outbox_row.kind not in ('link_code', 'link_notice')
    and not app.has_active_consent(outbox_row.tenant_id, 'staff', destination.user_id, send_policy.consent_purpose)
  then
    return query select 'cancel'::text, null::timestamptz, 'no_consent'::text;
    return;
  end if;
  message_rule_key := case
    when outbox_row.kind in ('digest', 'digest_correction') then 'daily_digest'
    when outbox_row.kind in ('alert', 'alert_reminder', 'alert_resolved') then episode_rule_key
  end;
  if message_rule_key is not null then
    if message_rule_key = any (destination.muted_rules) then
      return query select 'cancel'::text, null::timestamptz, 'unsubscribed'::text;
      return;
    end if;
    select r.enabled into rule_enabled
    from app.effective_alert_rule(outbox_row.tenant_id, coalesce(episode_store_id, outbox_row.store_id), message_rule_key) r;
    if not coalesce(rule_enabled, false) then
      return query select 'cancel'::text, null::timestamptz, 'unsubscribed'::text;
      return;
    end if;
  end if;
  if outbox_row.kind in ('test', 'link_code', 'link_notice', 'link_confirmation') then
    return query select 'send'::text, p_at, null::text;
    return;
  end if;
  reader_zone := coalesce(destination.timezone, (select t.timezone from public.tenants t where t.id = outbox_row.tenant_id), 'Asia/Ho_Chi_Minh');
  bypass := coalesce(send_policy.critical_bypass and outbox_row.severity = 'critical', false);
  if send_policy.window_start is not null and not bypass then
    opens_at := app.next_window_start(send_policy.window_start, send_policy.window_end, reader_zone, p_at);
    if opens_at > p_at then
      return query select 'hold'::text, opens_at, 'outside_hours'::text;
      return;
    end if;
  end if;
  if send_policy.max_per_day is not null and not bypass then
    period_start := case
      when send_policy.cap_window = 'rolling_24h' then p_at - interval '24 hours'
      else date_trunc('day', p_at at time zone reader_zone) at time zone reader_zone
    end;
    select count(*)::integer into counted
    from public.outbound_messages o
    where o.channel_id = destination.id
      and o.id <> outbox_row.id
      and o.kind in ('digest', 'digest_correction', 'alert', 'alert_reminder', 'alert_resolved')
      and o.status in ('sending', 'sent', 'delivered', 'uncertain')
      and coalesce(o.sent_at, o.claimed_at) <= p_at
      and (
        (send_policy.cap_window = 'rolling_24h' and coalesce(o.sent_at, o.claimed_at) > period_start)
        or (send_policy.cap_window <> 'rolling_24h' and coalesce(o.sent_at, o.claimed_at) >= period_start)
      );
    if counted >= send_policy.max_per_day then
      if send_policy.cap_window = 'rolling_24h' then
        select coalesce(o.sent_at, o.claimed_at) + interval '24 hours' into release_instant
        from public.outbound_messages o
        where o.channel_id = destination.id
          and o.id <> outbox_row.id
          and o.kind in ('digest', 'digest_correction', 'alert', 'alert_reminder', 'alert_resolved')
          and o.status in ('sending', 'sent', 'delivered', 'uncertain')
          and coalesce(o.sent_at, o.claimed_at) <= p_at
          and coalesce(o.sent_at, o.claimed_at) > period_start
        order by coalesce(o.sent_at, o.claimed_at)
        offset counted - send_policy.max_per_day
        limit 1;
      else
        release_instant := (date_trunc('day', p_at at time zone reader_zone) + interval '1 day') at time zone reader_zone;
      end if;
      if send_policy.window_start is not null then
        release_instant := app.next_window_start(send_policy.window_start, send_policy.window_end, reader_zone, release_instant);
      end if;
      return query select 'hold'::text, release_instant, 'daily_cap'::text;
      return;
    end if;
  end if;
  if send_policy.max_per_month is not null then
    period_start := date_trunc('month', p_at at time zone reader_zone) at time zone reader_zone;
    select count(*)::integer into counted
    from public.outbound_messages o
    where o.channel_id = destination.id
      and o.id <> outbox_row.id
      and o.kind in ('digest', 'digest_correction', 'alert', 'alert_reminder', 'alert_resolved')
      and o.status in ('sending', 'sent', 'delivered', 'uncertain')
      and coalesce(o.sent_at, o.claimed_at) >= period_start
      and coalesce(o.sent_at, o.claimed_at) <= p_at;
    if counted >= send_policy.max_per_month then
      release_instant := (date_trunc('month', p_at at time zone reader_zone) + interval '1 month') at time zone reader_zone;
      if send_policy.window_start is not null then
        release_instant := app.next_window_start(send_policy.window_start, send_policy.window_end, reader_zone, release_instant);
      end if;
      return query select 'hold'::text, release_instant, 'monthly_cap'::text;
      return;
    end if;
  end if;
  return query select 'send'::text, p_at, null::text;
end;
$$;

comment on function app.message_decision(uuid, timestamptz) is 'the send decision for a waiting message at p_at, first match wins: cancel when expired, when its episode resolved, when the destination is missing, disabled or still pending (link messages excepted), when the kind is unavailable, the class not enabled, no policy, not allowed or manual only, without the member''s consent, or unsubscribed; send test and link messages; hold outside the window in the reader''s zone, at the daily cap and at the monthly cap until the exact release instant; else send';

create function app.claim_next_message(
  p_worker text,
  p_secret_names text[],
  p_lease interval default interval '2 minutes',
  p_at timestamptz default now(),
  p_tenant_id uuid default null
)
returns table (
  message_id uuid,
  claimed_at timestamptz,
  tenant_id uuid,
  kind text,
  template_ref text,
  params jsonb,
  title text,
  body text,
  severity public.alert_severity,
  attempts smallint,
  business_date date,
  channel_id uuid,
  channel_kind public.channel_kind,
  provider text,
  secret_name text,
  address text,
  config jsonb,
  channel_label text,
  reader_timezone text,
  tenant_name text,
  currency_code text,
  store_name text,
  account_name text,
  rule_key text
)
language plpgsql
volatile
set search_path = ''
as $$
declare
  candidate record;
  verdict record;
begin
  for candidate in
    select o.id, o.channel_id
    from public.outbound_messages o
    join public.notification_channels c on c.id = o.channel_id
    where o.status in ('queued', 'held')
      and o.kind is not null
      and coalesce(o.not_before, o.created_at) <= p_at
      and c.secret_name = any (p_secret_names)
      and (p_tenant_id is null or o.tenant_id = p_tenant_id)
    order by case when o.severity = 'critical' then 0 else 1 end, coalesce(o.not_before, o.created_at), o.created_at
    limit 20
    for update of o skip locked
  loop
    continue when not pg_try_advisory_xact_lock(hashtextextended('fnb-notify:channel:' || candidate.channel_id::text, 0));
    select * into verdict from app.message_decision(candidate.id, p_at);
    continue when verdict.decision is null;
    if verdict.decision = 'hold' then
      update public.outbound_messages o
      set status = 'held', not_before = verdict.release_at, hold_reason = verdict.reason, decision = verdict.reason
      where o.id = candidate.id;
    elsif verdict.decision = 'cancel' then
      update public.outbound_messages o
      set status = 'cancelled', decision = verdict.reason
      where o.id = candidate.id;
    else
      update public.outbound_messages o
      set status = 'sending', claimed_at = p_at, lease_until = p_at + p_lease, attempts = o.attempts + 1,
          send_started_at = null, hold_reason = null, decision = 'send', last_error_code = null
      where o.id = candidate.id;
      return query
        select o.id, o.claimed_at, o.tenant_id, o.kind, o.template_ref, o.params, o.title, o.body, o.severity, o.attempts, o.business_date,
               c.id, c.kind, c.provider, c.secret_name,
               case when c.kind = 'email' then coalesce(c.address, u.email::text) else c.address end,
               c.config, c.label, coalesce(c.timezone, t.timezone), t.name, t.currency_code, s.name, a.display_name, e.rule_key
        from public.outbound_messages o
        join public.notification_channels c on c.id = o.channel_id
        join public.tenants t on t.id = o.tenant_id
        left join auth.users u on u.id = c.user_id
        left join public.stores s on s.id = o.store_id
        left join public.alert_events e on e.id = o.alert_event_id
        left join public.pos_accounts a on a.id = e.pos_account_id
        where o.id = candidate.id;
      return;
    end if;
  end loop;
end;
$$;

comment on function app.claim_next_message(text, text[], interval, timestamptz, uuid) is 'claims at most one due message whose destination''s secret name the dispatcher holds: due rows are locked with skip locked, the decision is re-taken under a per-destination advisory lock, held and cancelled rows are updated on the way, and the first message the decision sends becomes sending with a lease and is returned with what the renderer and the adapter need, the member''s login e-mail included for e-mail destinations';

create function app.begin_send(p_message_id uuid, p_claimed_at timestamptz, p_title text, p_body text, p_body_sha256 text, p_at timestamptz)
returns table (ok boolean, title text, body text)
language plpgsql
volatile
set search_path = ''
as $$
declare
  outbox_row public.outbound_messages%rowtype;
begin
  select o.* into outbox_row from public.outbound_messages o where o.id = p_message_id for update;
  if not found
    or outbox_row.status <> 'sending'
    or outbox_row.claimed_at is distinct from p_claimed_at
    or outbox_row.lease_until < p_at
  then
    return query select false, null::text, null::text;
    return;
  end if;
  if outbox_row.body is null then
    if p_body is null then
      raise exception 'begin_send needs the rendered body on the first attempt' using errcode = '22023';
    end if;
    update public.outbound_messages o
    set title = p_title,
        body = p_body,
        body_sha256 = coalesce(p_body_sha256, app.sha256_hex(p_body)),
        send_started_at = p_at
    where o.id = p_message_id;
    return query select true, p_title, p_body;
    return;
  end if;
  update public.outbound_messages o
  set send_started_at = p_at
  where o.id = p_message_id;
  return query select true, outbox_row.title, outbox_row.body;
end;
$$;

comment on function app.begin_send(uuid, timestamptz, text, text, text, timestamptz) is 'marks the start of the provider call: stores the render on the first attempt only and returns the stored text, so every retry sends the same bytes; ok is false when the claim was lost (status, claim time or lease)';

create function app.notify_backoff(p_attempt integer, p_retry_after_seconds integer, p_seed uuid)
returns interval
language sql
immutable
set search_path = ''
as $$
  with base as (
    select make_interval(mins => case
      when coalesce(p_attempt, 1) <= 1 then 1
      when p_attempt = 2 then 5
      when p_attempt = 3 then 30
      when p_attempt = 4 then 120
      else 360
    end) as delay
  ),
  jitter as (
    select coalesce(('x' || substr(md5(p_seed::text), 1, 8))::bit(32)::bigint, 0)::numeric / 4294967295 as fraction
  )
  select greatest(
    b.delay * (1 + 0.2 * j.fraction)::double precision,
    make_interval(secs => greatest(coalesce(p_retry_after_seconds, 0), 0))
  )
  from base b
  cross join jitter j;
$$;

comment on function app.notify_backoff(integer, integer, uuid) is 'delay before the next attempt: 1, 5, 30, 120 and 360 minutes for attempts 1 to 5, plus 0 to 20 percent deterministic jitter from the message id, never shorter than the provider''s retry-after';

create function app.finish_send(
  p_message_id uuid,
  p_claimed_at timestamptz,
  p_outcome text,
  p_scope text,
  p_code text,
  p_provider_message_id text,
  p_retry_after_seconds integer,
  p_idempotent boolean,
  p_at timestamptz
)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  outbox_row public.outbound_messages%rowtype;
  code text := case when p_code is null then null when p_code ~ '^[a-z0-9_]{1,40}$' then p_code else 'unknown_error' end;
  provider_id text := left(p_provider_message_id, 200);
  next_status text;
begin
  if p_outcome is null or p_outcome not in ('sent', 'retry', 'failed', 'uncertain') then
    raise exception 'finish_send needs the outcome sent, retry, failed or uncertain' using errcode = '22023';
  end if;
  if p_outcome = 'failed' and (p_scope is null or p_scope not in ('message', 'destination', 'channel')) then
    raise exception 'finish_send needs the scope message, destination or channel for a failure' using errcode = '22023';
  end if;
  select o.* into outbox_row from public.outbound_messages o where o.id = p_message_id for update;
  if not found then
    return 'missing';
  end if;
  if outbox_row.claimed_at is distinct from p_claimed_at then
    return 'lost';
  end if;
  if outbox_row.status = 'uncertain' then
    if p_outcome <> 'sent' then
      return 'lost';
    end if;
    update public.outbound_messages o
    set status = 'sent', sent_at = p_at, provider_message_id = provider_id
    where o.id = p_message_id;
    next_status := 'sent';
  elsif outbox_row.status <> 'sending' then
    return 'lost';
  else
    next_status := case
      when p_outcome = 'sent' then 'sent'
      when p_outcome = 'failed' then 'failed'
      when p_outcome = 'uncertain' and not coalesce(p_idempotent, false) then 'uncertain'
      when outbox_row.channel_id is null then 'cancelled'
      when outbox_row.attempts >= 5 then 'failed'
      else 'queued'
    end;
    update public.outbound_messages o
    set status = next_status,
        sent_at = case when next_status = 'sent' then p_at else o.sent_at end,
        provider_message_id = case when next_status = 'sent' then provider_id else o.provider_message_id end,
        last_error_code = case when next_status = 'sent' then null else coalesce(code, p_outcome) end,
        decision = case when next_status = 'cancelled' then 'destination_removed' else o.decision end,
        not_before = case when next_status = 'queued' then p_at + app.notify_backoff(outbox_row.attempts, p_retry_after_seconds, outbox_row.id) else o.not_before end,
        send_started_at = case when next_status = 'queued' then null else o.send_started_at end,
        lease_until = null
    where o.id = p_message_id;
  end if;
  if outbox_row.channel_id is not null then
    if next_status = 'sent' then
      update public.notification_channels c
      set last_ok_at = p_at,
          consecutive_failures = 0,
          status = case when c.status = 'failing' then 'active' else c.status end
      where c.id = outbox_row.channel_id;
      if outbox_row.kind in ('link_notice', 'link_code') then
        update app.notification_link_codes l
        set notice_sent_at = coalesce(l.notice_sent_at, p_at)
        where l.channel_id = outbox_row.channel_id
          and l.purpose = case when outbox_row.kind = 'link_notice' then 'bot_consent' else 'email_confirm' end;
      end if;
    else
      update public.notification_channels c
      set consecutive_failures = c.consecutive_failures + 1,
          last_error_code = coalesce(code, p_outcome),
          last_error_at = p_at,
          status = case
            when p_outcome = 'failed' and p_scope in ('destination', 'channel') and c.status in ('active', 'failing') and code = 'blocked_by_user' then 'disabled'
            when p_outcome = 'failed' and p_scope in ('destination', 'channel') and c.status in ('active', 'failing') then 'failing'
            else c.status
          end,
          disabled_reason = case
            when p_outcome = 'failed' and p_scope in ('destination', 'channel') and c.status in ('active', 'failing') and code = 'blocked_by_user' then 'blocked_by_user'
            else c.disabled_reason
          end
      where c.id = outbox_row.channel_id;
    end if;
  end if;
  return next_status;
end;
$$;

comment on function app.finish_send(uuid, timestamptz, text, text, text, text, integer, boolean, timestamptz) is 'records the provider''s answer for the claim p_claimed_at: sent; retry back to queued after app.notify_backoff, failed once five attempts are used; failed; uncertain, or queued again when the provider is idempotent; a late sent turns an uncertain row into sent; a vanished destination turns a retry into cancelled and updates no destination; a permanent destination or channel failure marks an active destination failing (disabled for blocked_by_user); returns the new status, or lost and missing';

create function app.recover_message_leases(p_at timestamptz default now(), p_tenant_id uuid default null)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  expired record;
  next_status text;
  recovered integer := 0;
begin
  for expired in
    select o.id, o.channel_id, o.channel, o.attempts, o.send_started_at, c.provider
    from public.outbound_messages o
    left join public.notification_channels c on c.id = o.channel_id
    where o.status = 'sending'
      and o.kind is not null
      and o.lease_until < p_at
      and (p_tenant_id is null or o.tenant_id = p_tenant_id)
    order by o.lease_until
    for update of o skip locked
  loop
    next_status := case
      when expired.channel_id is null and (expired.send_started_at is null or expired.channel = 'webhook') then 'cancelled'
      when expired.channel_id is null then 'uncertain'
      when expired.send_started_at is not null and expired.provider not in ('resend', 'hmac_webhook') then 'uncertain'
      when expired.attempts >= 5 then 'failed'
      else 'queued'
    end;
    update public.outbound_messages o
    set status = next_status,
        decision = case when next_status = 'cancelled' then 'destination_removed' else o.decision end,
        last_error_code = 'lease_expired',
        send_started_at = case when next_status = 'queued' then null else o.send_started_at end,
        lease_until = null
    where o.id = expired.id;
    recovered := recovered + 1;
  end loop;
  return recovered;
end;
$$;

comment on function app.recover_message_leases(timestamptz, uuid) is 'moves sending rows whose lease expired: never started back to queued, started on an idempotent provider (resend, hmac_webhook) back to queued, started on any other provider to uncertain, cancelled when the destination vanished and no duplicate can arise, and failed once five attempts are used';

create function app.expire_messages(p_at timestamptz default now(), p_tenant_id uuid default null)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  expired integer;
begin
  update public.outbound_messages o
  set status = 'cancelled',
      decision = case
        when exists (
          select 1
          from app.notify_settings s
          cross join lateral jsonb_each(s.dispatcher_secrets) as r (runtime, report)
          where jsonb_typeof(r.report) = 'object'
            and jsonb_typeof(r.report -> 'names') = 'array'
            and (r.report ->> 'at')::timestamptz >= p_at - interval '48 hours'
            and (r.report -> 'names') ? c.secret_name
        ) then 'expired'
        else 'no_dispatcher_secret'
      end
  from public.notification_channels c
  where c.id = o.channel_id
    and o.status in ('queued', 'held')
    and o.kind is not null
    and o.expires_at <= p_at
    and (p_tenant_id is null or o.tenant_id = p_tenant_id);
  get diagnostics expired = row_count;
  update public.outbound_messages o
  set title = null, body = null, params = null
  where o.kind = 'link_code'
    and o.status <> 'sending'
    and (o.body is not null or o.title is not null or o.params is not null)
    and o.expires_at <= p_at
    and (p_tenant_id is null or o.tenant_id = p_tenant_id);
  return expired;
end;
$$;

comment on function app.expire_messages(timestamptz, uuid) is 'cancels queued and held messages whose expires_at passed, as no_dispatcher_secret when no runtime reported the destination''s secret name in the last 48 hours and as expired otherwise, and clears the text of link_code messages once their code expired; returns the number cancelled';

create function app.record_dispatch(p_at timestamptz, p_runtime text, p_secret_names text[], p_counts jsonb)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  names text[];
begin
  if p_runtime is null or p_runtime not in ('edge', 'cli') then
    raise exception 'record_dispatch needs the runtime edge or cli' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct n.name order by n.name), '{}'::text[]) into names
  from unnest(coalesce(p_secret_names, '{}'::text[])) as n (name)
  where n.name ~ '^NOTIFY_[A-Z0-9_]{1,60}$';
  update app.notify_settings s
  set last_dispatch_at = p_at,
      last_dispatcher_secrets = names,
      dispatcher_secrets = s.dispatcher_secrets || jsonb_build_object(
        p_runtime,
        jsonb_build_object(
          'names', to_jsonb(names),
          'at', p_at,
          'counts', case when app.facts_are_count_only(p_counts) then coalesce(p_counts, '{}'::jsonb) else '{}'::jsonb end
        )
      ),
      updated_at = now();
end;
$$;

comment on function app.record_dispatch(timestamptz, text, text[], jsonb) is 'stores the end of a dispatch cycle: when, the NOTIFY_ secret names (never values) present in that runtime, per runtime, and its count-only counts';

create function app.ensure_notifications_consent(p_tenant_id uuid, p_user_id uuid, p_channel text, p_evidence jsonb, p_at timestamptz)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  kept_keys constant text[] := array['method', 'notice_version', 'notice_channel', 'channel_id', 'code_issued_at', 'notice_sent_at', 'accepted_at'];
  evidence jsonb;
  consent_id uuid;
begin
  if p_channel is null or p_channel not in ('zalo_bot', 'telegram', 'email', 'web') then
    raise exception 'ensure_notifications_consent needs the channel zalo_bot, telegram, email or web' using errcode = '22023';
  end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'object' or not (p_evidence ? 'method') or not (p_evidence ? 'notice_channel') then
    raise exception 'ensure_notifications_consent needs evidence with method and notice_channel' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tenant_members m where m.tenant_id = p_tenant_id and m.user_id = p_user_id) then
    raise exception 'ensure_notifications_consent needs a member of the tenant' using errcode = '22023';
  end if;
  select c.id into consent_id
  from public.consent_records c
  where c.tenant_id = p_tenant_id
    and c.subject_type = 'staff'
    and c.subject_id = p_user_id
    and c.purpose = 'notifications'
    and c.revoked_at is null;
  if consent_id is not null then
    return consent_id;
  end if;
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into evidence
  from jsonb_each(p_evidence) as e
  where e.key = any (kept_keys);
  insert into public.consent_records (tenant_id, subject_type, subject_id, purpose, policy_version, channel, granted_at, evidence)
  values (p_tenant_id, 'staff', p_user_id, 'notifications', 'ops-notifications-v1', p_channel, p_at, evidence)
  on conflict (tenant_id, subject_type, subject_id, purpose) where revoked_at is null do nothing
  returning id into consent_id;
  if consent_id is null then
    select c.id into consent_id
    from public.consent_records c
    where c.tenant_id = p_tenant_id
      and c.subject_type = 'staff'
      and c.subject_id = p_user_id
      and c.purpose = 'notifications'
      and c.revoked_at is null;
  end if;
  return consent_id;
end;
$$;

comment on function app.ensure_notifications_consent(uuid, uuid, text, jsonb, timestamptz) is 'the member''s active notifications consent, recorded at their own acceptance when none is active (policy ops-notifications-v1); evidence keeps only method, notice_version, notice_channel, channel_id, code_issued_at, notice_sent_at and accepted_at, never a chat id or address';

create function app.issue_link_code(p_channel_id uuid, p_purpose text, p_at timestamptz)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  destination public.notification_channels%rowtype;
  code text;
  code_hash text;
begin
  if p_purpose is null or p_purpose not in ('bot_link', 'email_confirm') then
    raise exception 'issue_link_code needs the purpose bot_link or email_confirm' using errcode = '22023';
  end if;
  select c.* into destination from public.notification_channels c where c.id = p_channel_id for update;
  if not found or destination.status <> 'pending' then
    raise exception 'issue_link_code needs a pending destination' using errcode = '22023';
  end if;
  if p_purpose = 'bot_link' then
    if destination.kind not in ('zalo_bot', 'telegram') then
      raise exception 'issue_link_code: a bot code needs a zalo_bot or telegram destination' using errcode = '22023';
    end if;
    code := 'FNB-' || app.notify_random_code('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 8);
    code_hash := app.sha256_hex(destination.secret_name || ':' || code);
  else
    if destination.kind <> 'email' then
      raise exception 'issue_link_code: an e-mail code needs an email destination' using errcode = '22023';
    end if;
    code := app.notify_random_code('0123456789', 6);
    code_hash := app.sha256_hex(destination.id::text || ':' || code);
  end if;
  delete from app.notification_link_codes l where l.channel_id = destination.id;
  insert into app.notification_link_codes (channel_id, purpose, code_sha256, issued_at, expires_at)
  values (destination.id, p_purpose, code_hash, p_at, p_at + interval '15 minutes');
  return code;
end;
$$;

comment on function app.issue_link_code(uuid, text, timestamptz) is 'issues a code for a pending destination, valid 15 minutes, and returns it once: FNB- plus 8 characters for a bot, 6 digits for an e-mail confirmation; only its hash is stored and any earlier code of the destination is replaced';

create function app.complete_channel_link(p_kind public.channel_kind, p_secret_name text, p_code text, p_address text, p_address_hint text, p_at timestamptz)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  code text := upper(btrim(p_code));
  pending record;
  destination public.notification_channels%rowtype;
  acceptance_hash text;
begin
  if code is null or code !~ '^FNB-[A-Z0-9]{8}$' or p_address is null or btrim(p_address) = '' then
    return null;
  end if;
  select l.channel_id, l.issued_at into pending
  from app.notification_link_codes l
  join public.notification_channels c on c.id = l.channel_id
  where l.code_sha256 = app.sha256_hex(p_secret_name || ':' || code)
    and l.purpose = 'bot_link'
    and l.expires_at > p_at
    and c.kind = p_kind
    and c.secret_name = p_secret_name
    and c.status = 'pending'
  for update of l;
  if not found then
    return null;
  end if;
  acceptance_hash := app.sha256_hex(p_secret_name || ':' || p_address);
  update public.notification_channels c
  set address = p_address, address_hint = p_address_hint
  where c.id = pending.channel_id
  returning c.* into destination;
  delete from app.notification_link_codes l
  where l.channel_id = destination.id
     or l.code_sha256 = acceptance_hash;
  insert into app.notification_link_codes (channel_id, purpose, code_sha256, issued_at, expires_at)
  values (destination.id, 'bot_consent', acceptance_hash, pending.issued_at, p_at + interval '24 hours');
  perform app.enqueue_message(
    destination.tenant_id, destination.id, 'link_notice', 'link_notice.v1',
    'link_notice:' || destination.id::text || ':' || floor(extract(epoch from p_at))::bigint::text,
    '{}'::jsonb, null, null, null, null, null, null, null, p_at + interval '1 hour', p_at
  );
  return destination.id;
end;
$$;

comment on function app.complete_channel_link(public.channel_kind, text, text, text, text, timestamptz) is 'called by a poller for a private bot message holding a code: on a match it stores the chat id and hint on the still pending destination, replaces the code by an acceptance waiting 24 hours, and enqueues one link_notice; returns the destination, or null when nothing matches (the chat id is then not kept)';

create function app.accept_channel_link(p_kind public.channel_kind, p_secret_name text, p_address text, p_at timestamptz)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  pending record;
  destination public.notification_channels%rowtype;
  consent_id uuid;
begin
  if p_address is null or btrim(p_address) = '' then
    return null;
  end if;
  select l.channel_id, l.issued_at, l.notice_sent_at into pending
  from app.notification_link_codes l
  join public.notification_channels c on c.id = l.channel_id
  where l.code_sha256 = app.sha256_hex(p_secret_name || ':' || p_address)
    and l.purpose = 'bot_consent'
    and l.expires_at > p_at
    and l.notice_sent_at is not null
    and l.notice_sent_at <= p_at
    and c.kind = p_kind
    and c.secret_name = p_secret_name
    and c.address = p_address
    and c.status = 'pending'
  for update of l;
  if not found then
    return null;
  end if;
  select c.* into destination from public.notification_channels c where c.id = pending.channel_id for update;
  consent_id := app.ensure_notifications_consent(
    destination.tenant_id,
    destination.user_id,
    destination.kind::text,
    jsonb_build_object(
      'method', 'bot_reply',
      'notice_version', 'ops-notifications-v1',
      'notice_channel', 'bot_chat',
      'channel_id', destination.id,
      'code_issued_at', pending.issued_at,
      'notice_sent_at', pending.notice_sent_at,
      'accepted_at', p_at
    ),
    p_at
  );
  update public.notification_channels c
  set status = 'active', linked_at = p_at, consent_record_id = consent_id
  where c.id = destination.id;
  delete from app.notification_link_codes l where l.channel_id = destination.id;
  perform app.enqueue_message(
    destination.tenant_id, destination.id, 'link_confirmation', 'link_confirmation.v1',
    'link_confirmation:' || destination.id::text || ':' || floor(extract(epoch from p_at))::bigint::text,
    '{}'::jsonb, null, null, null, null, null, null, null, p_at + interval '1 hour', p_at
  );
  return destination.id;
end;
$$;

comment on function app.accept_channel_link(public.channel_kind, text, text, timestamptz) is 'called by a poller for the member''s "ĐỒNG Ý" reply in a chat whose notice was sent: activates the destination, records the member''s notifications consent with evidence bot_reply in the bot chat, and enqueues one link_confirmation; returns the destination, or null when the chat has no acceptance waiting';

create function app.confirm_email_link(p_channel_id uuid, p_code text, p_at timestamptz)
returns boolean
language plpgsql
volatile
set search_path = ''
as $$
declare
  pending app.notification_link_codes%rowtype;
  destination public.notification_channels%rowtype;
  consent_id uuid;
begin
  select l.* into pending
  from app.notification_link_codes l
  join public.notification_channels c on c.id = l.channel_id
  where l.channel_id = p_channel_id
    and l.purpose = 'email_confirm'
    and l.expires_at > p_at
    and c.kind = 'email'
    and c.status = 'pending'
  for update of l;
  if not found then
    return false;
  end if;
  if p_code is null or app.sha256_hex(p_channel_id::text || ':' || btrim(p_code)) <> pending.code_sha256 then
    if pending.attempts + 1 >= 5 then
      delete from public.notification_channels c where c.id = p_channel_id;
    else
      update app.notification_link_codes l set attempts = l.attempts + 1 where l.channel_id = p_channel_id;
    end if;
    return false;
  end if;
  select c.* into destination from public.notification_channels c where c.id = p_channel_id for update;
  consent_id := app.ensure_notifications_consent(
    destination.tenant_id,
    destination.user_id,
    'email',
    jsonb_build_object(
      'method', 'email_code',
      'notice_version', 'ops-notifications-v1',
      'notice_channel', 'email',
      'channel_id', destination.id,
      'code_issued_at', pending.issued_at,
      'notice_sent_at', pending.notice_sent_at,
      'accepted_at', p_at
    ),
    p_at
  );
  update public.notification_channels c
  set status = 'active', linked_at = p_at, consent_record_id = consent_id
  where c.id = destination.id;
  delete from app.notification_link_codes l where l.channel_id = destination.id;
  update public.outbound_messages o
  set title = null, body = null, params = null
  where o.channel_id = destination.id
    and o.kind = 'link_code'
    and o.status <> 'sending';
  perform app.enqueue_message(
    destination.tenant_id, destination.id, 'link_confirmation', 'link_confirmation.v1',
    'link_confirmation:' || destination.id::text || ':' || floor(extract(epoch from p_at))::bigint::text,
    '{}'::jsonb, null, null, null, null, null, null, null, p_at + interval '1 hour', p_at
  );
  return true;
end;
$$;

comment on function app.confirm_email_link(uuid, text, timestamptz) is 'checks the 6-digit code the member handed back from the code e-mail: on a match activates the destination, records the notifications consent with evidence email_code, clears the code from the link_code message and enqueues one link_confirmation; the fifth wrong code deletes the pending destination';

create function app.withdraw_notifications(p_tenant_id uuid, p_user_id uuid, p_at timestamptz)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  cancelled integer;
begin
  update public.consent_records c
  set revoked_at = greatest(p_at, c.granted_at)
  where c.tenant_id = p_tenant_id
    and c.subject_type = 'staff'
    and c.subject_id = p_user_id
    and c.purpose = 'notifications'
    and c.revoked_at is null;
  update public.outbound_messages o
  set status = 'cancelled', decision = 'no_consent'
  from public.notification_channels c
  where c.id = o.channel_id
    and c.tenant_id = p_tenant_id
    and c.user_id = p_user_id
    and o.status in ('queued', 'held');
  get diagnostics cancelled = row_count;
  delete from app.notification_link_codes l
  using public.notification_channels c
  where c.id = l.channel_id
    and c.tenant_id = p_tenant_id
    and c.user_id = p_user_id;
  delete from public.notification_channels c
  where c.tenant_id = p_tenant_id
    and c.user_id = p_user_id
    and c.status = 'pending';
  update public.notification_channels c
  set status = 'disabled', disabled_reason = 'consent_withdrawn'
  where c.tenant_id = p_tenant_id
    and c.user_id = p_user_id
    and c.status <> 'disabled';
  return cancelled;
end;
$$;

comment on function app.withdraw_notifications(uuid, uuid, timestamptz) is 'the member withdraws the notifications consent: revokes it, cancels the open messages of every destination of the member, deletes destinations still pending a link and disables the others as consent_withdrawn, in one transaction; returns the number of messages cancelled';

create function app.take_poll_lease(p_secret_name text, p_kind public.channel_kind, p_worker text, p_lease interval, p_at timestamptz)
returns boolean
language plpgsql
volatile
set search_path = ''
as $$
declare
  taken boolean;
begin
  if p_kind not in ('zalo_bot', 'telegram') or not app.notify_secret_name_valid(p_kind, p_secret_name) then
    raise exception 'take_poll_lease needs a zalo_bot or telegram secret name of that kind' using errcode = '22023';
  end if;
  if p_lease is null or p_lease <= interval '0' or p_lease > interval '10 minutes' then
    raise exception 'take_poll_lease needs a lease of more than 0 and at most 10 minutes' using errcode = '22023';
  end if;
  insert into app.bot_poll_state as b (secret_name, kind, poller, poll_lease_until, polled_at)
  values (p_secret_name, p_kind, p_worker, p_at + p_lease, p_at)
  on conflict (secret_name) do update
  set poller = excluded.poller, poll_lease_until = excluded.poll_lease_until, polled_at = excluded.polled_at
  where b.poll_lease_until is null
     or b.poll_lease_until <= p_at
     or b.poller is not distinct from excluded.poller
  returning true into taken;
  return coalesce(taken, false);
end;
$$;

comment on function app.take_poll_lease(text, public.channel_kind, text, interval, timestamptz) is 'takes or renews the polling lease of one bot token when it is free, expired or already the caller''s, so one getUpdates consumer per token runs at a time; false when another worker holds it';

create function app.release_poll_lease(p_secret_name text, p_worker text)
returns void
language sql
volatile
set search_path = ''
as $$
  update app.bot_poll_state b
  set poller = null, poll_lease_until = null
  where b.secret_name = p_secret_name
    and b.poller = p_worker;
$$;

comment on function app.release_poll_lease(text, text) is 'releases the polling lease of a bot token when the caller holds it';

create or replace function app.cancel_destination_messages()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.tenants t where t.id = old.tenant_id) then
    update public.outbound_messages o
    set status = 'cancelled', decision = 'destination_removed'
    where o.channel_id = old.id
      and o.status in ('queued', 'held');
  end if;
  return old;
end;
$$;

comment on function app.cancel_destination_messages() is 'trigger before a destination is deleted: cancels its queued and held messages as destination_removed, so the foreign key never leaves a waiting message without a destination; a message being sent is left to app.finish_send and the lease recovery; nothing to cancel when the whole tenant is being deleted';

create function app.redact_outbound_for_subject(p_tenant_id uuid, p_subject_type public.consent_subject, p_subject_id uuid)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  redacted integer;
begin
  update public.outbound_messages o
  set title = null,
      body = null,
      params = null,
      subject_id = null,
      recipient_ref = 'redacted',
      channel_id = case
        when o.channel_id is not null and not exists (select 1 from public.notification_channels c where c.id = o.channel_id) then null
        else o.channel_id
      end,
      status = case when o.status in ('queued', 'held') then 'cancelled' else o.status end,
      decision = case when o.status in ('queued', 'held') then 'destination_removed' else o.decision end
  where o.tenant_id = p_tenant_id
    and o.subject_type = p_subject_type
    and o.subject_id = p_subject_id
    and o.status <> 'sending';
  get diagnostics redacted = row_count;
  return redacted;
end;
$$;

comment on function app.redact_outbound_for_subject(uuid, public.consent_subject, uuid) is 'redacts the subject''s outbound rows to counts, template and timestamps: clears title, body, params and subject_id, sets recipient_ref to redacted, clears a destination already deleted and cancels waiting rows; rows being sent are skipped and the daily housekeeping redacts them later; the consent ledger is untouched';

create function app.redact_member_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.tenants t where t.id = old.tenant_id) then
    perform app.redact_outbound_for_subject(old.tenant_id, 'staff', old.user_id);
  end if;
  return old;
end;
$$;

comment on function app.redact_member_notifications() is 'trigger after a member is removed from tenant_members: redacts the member''s outbound rows at once (PDPL Art. 25(2)(c)); their destinations go with the composite foreign key; nothing to redact when the whole tenant is being deleted';

create trigger tenant_members_redact_notifications
after delete on public.tenant_members
for each row execute function app.redact_member_notifications();

create function app.notify_housekeeping(p_at timestamptz, p_tenant_id uuid default null)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  settings app.notify_settings%rowtype;
  batch integer;
  messages_deleted integer := 0;
  bodies_cleared integer;
  episodes_deleted integer;
  digests_deleted integer;
  link_codes_deleted integer;
  pending_deleted integer;
  rows_redacted integer := 0;
  cron_deleted integer := 0;
  former record;
begin
  select * into settings from app.notify_settings;
  loop
    delete from public.outbound_messages o
    where o.id in (
      select x.id
      from public.outbound_messages x
      where x.kind is not null
        and x.status in ('sent', 'delivered', 'failed', 'cancelled')
        and coalesce(x.sent_at, x.created_at) < p_at - make_interval(days => settings.retention_days)
        and (p_tenant_id is null or x.tenant_id = p_tenant_id)
      limit 5000
    );
    get diagnostics batch = row_count;
    messages_deleted := messages_deleted + batch;
    exit when batch < 5000;
  end loop;
  update public.outbound_messages o
  set title = null, body = null
  where o.kind is not null
    and o.status in ('sent', 'delivered', 'failed', 'cancelled', 'uncertain')
    and (o.title is not null or o.body is not null)
    and coalesce(o.sent_at, o.created_at) < p_at - make_interval(days => settings.body_retention_days)
    and (p_tenant_id is null or o.tenant_id = p_tenant_id);
  get diagnostics bodies_cleared = row_count;
  delete from public.alert_events e
  where e.state = 'resolved'
    and e.resolved_at < p_at - make_interval(days => settings.retention_days)
    and (p_tenant_id is null or e.tenant_id = p_tenant_id);
  get diagnostics episodes_deleted = row_count;
  delete from public.digests d
  where d.business_date < (p_at at time zone 'UTC')::date - settings.retention_days
    and (p_tenant_id is null or d.tenant_id = p_tenant_id);
  get diagnostics digests_deleted = row_count;
  delete from app.notification_link_codes l
  using public.notification_channels c
  where c.id = l.channel_id
    and l.expires_at + interval '1 day' < p_at
    and (p_tenant_id is null or c.tenant_id = p_tenant_id);
  get diagnostics link_codes_deleted = row_count;
  delete from public.notification_channels c
  where c.status = 'pending'
    and c.kind in ('zalo_bot', 'telegram')
    and c.address is not null
    and not exists (
      select 1
      from app.notification_link_codes l
      where l.channel_id = c.id
        and l.expires_at > p_at
    )
    and (p_tenant_id is null or c.tenant_id = p_tenant_id);
  get diagnostics pending_deleted = row_count;
  for former in
    select distinct o.tenant_id, o.subject_id
    from public.outbound_messages o
    where o.subject_type = 'staff'
      and o.subject_id is not null
      and o.status <> 'sending'
      and (p_tenant_id is null or o.tenant_id = p_tenant_id)
      and not exists (
        select 1 from public.tenant_members m where m.tenant_id = o.tenant_id and m.user_id = o.subject_id
      )
  loop
    rows_redacted := rows_redacted + app.redact_outbound_for_subject(former.tenant_id, 'staff', former.subject_id);
  end loop;
  if p_tenant_id is null then
    delete from cron.job_run_details d where d.end_time < p_at - interval '7 days';
    get diagnostics cron_deleted = row_count;
    update app.notify_settings set last_housekeeping_at = p_at, updated_at = now();
  end if;
  return jsonb_build_object(
    'messages_deleted', messages_deleted,
    'bodies_cleared', bodies_cleared,
    'episodes_deleted', episodes_deleted,
    'digests_deleted', digests_deleted,
    'link_codes_deleted', link_codes_deleted,
    'pending_destinations_deleted', pending_deleted,
    'rows_redacted', rows_redacted,
    'cron_details_deleted', cron_deleted
  );
end;
$$;

comment on function app.notify_housekeeping(timestamptz, uuid) is 'retention, once a day from the tick: deletes finished queue rows after retention_days (at least 366) in batches of 5,000, never queued, held, sending or uncertain ones; clears bodies after body_retention_days; deletes resolved episodes and digests after retention_days, link codes a day after expiry and pending bot destinations whose chat id was never accepted; redacts rows of former members; prunes cron.job_run_details after 7 days on an unscoped run; returns counts';

create function app.issue_notify_ticket(p_reason text default 'manual')
returns uuid
language sql
volatile
set search_path = ''
as $$
  insert into app.notify_tickets (reason, expires_at)
  values (p_reason, now() + coalesce((select s.ticket_lifetime from app.notify_settings s), interval '10 minutes'))
  returning ticket;
$$;

comment on function app.issue_notify_ticket(text) is 'issues one ticket living ticket_lifetime and returns it, whether or not the schedule is enabled, so an operator can post it to the notify function by hand';

create function app.post_notify_ticket(p_reason text)
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
  select * into settings from app.notify_settings;
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
  return issued;
end;
$$;

comment on function app.post_notify_ticket(text) is 'issues a ticket and posts only {"ticket": id} to the notify function through pg_net with request_timeout_ms, keeping the request id; needs function_url';

create function app.claim_notify_ticket(p_ticket uuid)
returns table (reason text, issued_at timestamptz)
language sql
volatile
set search_path = ''
as $$
  delete from app.notify_tickets t
  where t.ticket = p_ticket
    and t.expires_at > now()
  returning t.reason, t.issued_at;
$$;

comment on function app.claim_notify_ticket(uuid) is 'claims a notify ticket once: returns its reason and issue time and deletes it, or returns nothing when the ticket is unknown, used or expired';

create function app.kick_notify(p_reason text default 'kick')
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
  if exists (select 1 from app.notify_tickets t where t.issued_at > now() - interval '30 seconds') then
    return false;
  end if;
  perform app.post_notify_ticket(p_reason);
  return true;
end;
$$;

comment on function app.kick_notify(text) is 'posts a ticket at once when the schedule is enabled, a function URL is set and no ticket was issued in the last 30 seconds; returns false and does nothing otherwise, so every step may call it before the schedule exists';

create function app.notify_tick_rules(p_at timestamptz, p_tenant_id uuid default null)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
begin
  return '{}'::jsonb;
end;
$$;

comment on function app.notify_tick_rules(timestamptz, uuid) is 'the rules half of the notify tick, the one hook later migrations replace with create or replace: in this first form it evaluates nothing and returns an empty count-only object';

create function app.notify_tick(p_at timestamptz default now(), p_post boolean default true, p_tenant_id uuid default null)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  settings app.notify_settings%rowtype;
  tickets_expired integer := 0;
  tickets_unclaimed integer := 0;
  recovered integer;
  expired integer;
  rules jsonb;
  housekeeping jsonb;
  due_messages integer;
  pending_links integer;
  due_digests integer;
  posted boolean := false;
  summary jsonb;
begin
  if p_tenant_id is null then
    with gone as (
      delete from app.notify_tickets t
      where t.expires_at <= now()
      returning t.request_id
    )
    select count(*)::integer, count(g.request_id)::integer into tickets_expired, tickets_unclaimed
    from gone g;
    if tickets_unclaimed > 0 then
      update app.notify_settings
      set tickets_expired_unclaimed = tickets_expired_unclaimed + tickets_unclaimed,
          last_ticket_expired_at = now(),
          updated_at = now();
    end if;
  end if;
  recovered := app.recover_message_leases(p_at, p_tenant_id);
  expired := app.expire_messages(p_at, p_tenant_id);
  select * into settings from app.notify_settings;
  if p_post and not coalesce(settings.enabled, false) then
    return jsonb_build_object(
      'enabled', false,
      'tickets_expired', tickets_expired,
      'tickets_expired_unclaimed', tickets_unclaimed,
      'leases_recovered', recovered,
      'messages_expired', expired
    );
  end if;
  rules := coalesce(app.notify_tick_rules(p_at, p_tenant_id), '{}'::jsonb);
  if settings.last_housekeeping_at is null or settings.last_housekeeping_at <= p_at - interval '20 hours' then
    housekeeping := app.notify_housekeeping(p_at, p_tenant_id);
  end if;
  select count(*)::integer into due_messages
  from public.outbound_messages o
  where o.status in ('queued', 'held')
    and o.kind is not null
    and coalesce(o.not_before, o.created_at) <= p_at
    and (p_tenant_id is null or o.tenant_id = p_tenant_id);
  select count(*)::integer into pending_links
  from app.notification_link_codes l
  join public.notification_channels c on c.id = l.channel_id
  where l.purpose in ('bot_link', 'bot_consent')
    and l.expires_at > p_at
    and (p_tenant_id is null or c.tenant_id = p_tenant_id);
  due_digests := case when jsonb_typeof(rules -> 'due_digests') = 'number' then (rules ->> 'due_digests')::integer else 0 end;
  if p_post
    and coalesce(settings.enabled, false)
    and settings.function_url is not null
    and due_messages + pending_links + due_digests > 0
    and not exists (select 1 from app.notify_tickets t where t.issued_at > now() - interval '4 minutes')
  then
    perform app.post_notify_ticket('schedule');
    posted := true;
  end if;
  summary := jsonb_build_object(
    'enabled', coalesce(settings.enabled, false),
    'tickets_expired', tickets_expired,
    'tickets_expired_unclaimed', tickets_unclaimed,
    'leases_recovered', recovered,
    'messages_expired', expired,
    'due_messages', due_messages,
    'pending_links', pending_links,
    'housekeeping', housekeeping is not null,
    'ticket_posted', posted
  ) || rules;
  if p_tenant_id is null then
    update app.notify_settings
    set last_tick_at = now(), last_tick_summary = summary, updated_at = now();
  end if;
  return summary;
end;
$$;

comment on function app.notify_tick(timestamptz, boolean, uuid) is 'the SQL half of a notify cycle and the pg_cron job body: drops expired tickets (counting posted ones as unclaimed), recovers leases and expires messages, returns early when p_post and the schedule is disabled, otherwise runs app.notify_tick_rules, housekeeping once 20 hours have passed, counts due messages and pending bot links, posts a schedule ticket when p_post, work is due and no ticket was issued in the last 4 minutes, and records a count-only summary; a tenant filter scopes every scan and leaves the shared state alone';

revoke all on function app.sha256_hex(text) from public;
revoke all on function app.notify_random_code(text, integer) from public;
revoke all on function app.effective_alert_rule(uuid, uuid, text) from public;
revoke all on function app.effective_channel_policy(uuid, public.channel_kind, public.message_class) from public;
revoke all on function app.tenant_has_destinations(uuid) from public;
revoke all on function app.enqueue_message(uuid, uuid, text, text, text, jsonb, text, text, public.alert_severity, uuid, date, uuid, uuid, timestamptz, timestamptz) from public;
revoke all on function app.next_window_start(time, time, text, timestamptz) from public;
revoke all on function app.message_decision(uuid, timestamptz) from public;
revoke all on function app.claim_next_message(text, text[], interval, timestamptz, uuid) from public;
revoke all on function app.begin_send(uuid, timestamptz, text, text, text, timestamptz) from public;
revoke all on function app.notify_backoff(integer, integer, uuid) from public;
revoke all on function app.finish_send(uuid, timestamptz, text, text, text, text, integer, boolean, timestamptz) from public;
revoke all on function app.recover_message_leases(timestamptz, uuid) from public;
revoke all on function app.expire_messages(timestamptz, uuid) from public;
revoke all on function app.record_dispatch(timestamptz, text, text[], jsonb) from public;
revoke all on function app.ensure_notifications_consent(uuid, uuid, text, jsonb, timestamptz) from public;
revoke all on function app.issue_link_code(uuid, text, timestamptz) from public;
revoke all on function app.complete_channel_link(public.channel_kind, text, text, text, text, timestamptz) from public;
revoke all on function app.accept_channel_link(public.channel_kind, text, text, timestamptz) from public;
revoke all on function app.confirm_email_link(uuid, text, timestamptz) from public;
revoke all on function app.withdraw_notifications(uuid, uuid, timestamptz) from public;
revoke all on function app.take_poll_lease(text, public.channel_kind, text, interval, timestamptz) from public;
revoke all on function app.release_poll_lease(text, text) from public;
revoke all on function app.redact_outbound_for_subject(uuid, public.consent_subject, uuid) from public;
revoke all on function app.redact_member_notifications() from public;
revoke all on function app.notify_housekeeping(timestamptz, uuid) from public;
revoke all on function app.issue_notify_ticket(text) from public;
revoke all on function app.post_notify_ticket(text) from public;
revoke all on function app.claim_notify_ticket(uuid) from public;
revoke all on function app.kick_notify(text) from public;
revoke all on function app.notify_tick_rules(timestamptz, uuid) from public;
revoke all on function app.notify_tick(timestamptz, boolean, uuid) from public;
