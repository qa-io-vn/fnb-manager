alter table public.notification_channels
  add column last_interaction_at timestamptz;

comment on column public.notification_channels.last_interaction_at is 'for a zalo_oa destination, when its OA user last messaged the OA, tapped a menu or button that sends a message, or followed it, as reported by oa-webhook; only moves forward; the send decision reads it against the interaction window of the zalo_oa policies; not selectable by authenticated';

alter table app.bot_poll_state
  add column webhook_secret_sha256 text unique check (webhook_secret_sha256 is null or webhook_secret_sha256 ~ '^[0-9a-f]{64}$'),
  add column webhook_set_at timestamptz,
  add constraint bot_poll_state_webhook_shape check ((webhook_secret_sha256 is null) = (webhook_set_at is null)),
  add constraint bot_poll_state_webhook_kind check (webhook_set_at is null or kind = 'zalo_bot');

comment on table app.bot_poll_state is 'per bot token name: the Telegram offset, the bot''s display name from getMe, the polling lease that keeps one getUpdates consumer per token, and the webhook mode of a Zalo Bot (the SHA-256 of the secret token given to setWebhook and when it was set), which refuses polling; no update content is kept';
comment on column app.bot_poll_state.webhook_secret_sha256 is 'sha256 hex of the X-Bot-Api-Secret-Token the bot sends to bot-webhook; the token itself is never stored';

alter table public.alert_events
  drop constraint alert_events_source_check,
  add constraint alert_events_source_check check (source in ('incremental', 'nightly', 'cli', 'scheduler', 'notify', 'actions', 'webhook'));

insert into public.alert_rule_catalog (rule_key, category, delivery, default_enabled, default_severity, default_roles, default_params, params_schema, default_cooldown, remind_every, notify_on_resolve, store_scoped, sort_order)
values
  ('zalo_webhook_unverified', 'channel', 'immediate', true, 'warning', array['owner']::public.tenant_role[],
    '{"max_per_day": 10}',
    '{"max_per_day": {"type": "integer", "min": 0, "max": 1000}}',
    interval '24 hours', null, false, false, 160);

create table public.oa_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  oa_id uuid not null,
  event_id text not null check (event_id ~ '^[0-9a-f]{64}$'),
  event_name text not null check (event_name ~ '^[a-z][a-z0-9_.]{0,63}$'),
  oa_user_id text check (oa_user_id is null or oa_user_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  occurred_at timestamptz not null,
  received_at timestamptz not null,
  signature text not null check (signature in ('raw', 'compact', 'mismatch', 'missing')),
  processed_at timestamptz,
  unique (oa_id, event_id),
  foreign key (tenant_id, oa_id) references public.oas (tenant_id, id) on delete cascade,
  check (occurred_at <= received_at)
);

create index oa_events_received_at_idx on public.oa_events (received_at);
create index oa_events_tenant_id_idx on public.oa_events (tenant_id);

comment on table public.oa_events is 'the log of OA webhook events, kept 90 days by the notify housekeeping and counted per day in app.oa_event_days: the event id, the OA, the event name, the OA user id and the times, never the message text or any other content; no API role reads it, owners read the counts through public.oa_event_counts';
comment on column public.oa_events.event_id is 'sha256 hex of the app id, OA id, event name, user id, timestamp and message id of the event, the key that drops a second delivery';
comment on column public.oa_events.oa_user_id is 'the OA user the event concerns (the sender, the follower, or the recipient of an oa_send_ event), never the per-app user id';
comment on column public.oa_events.signature is 'which serialisation of the body matched X-ZEvent-Signature (raw: the bytes as received, compact: the JSON re-serialised without spaces), or mismatch and missing, kept only while the OA is in observe mode';
comment on column public.oa_events.processed_at is 'when the follow-up (app.apply_oa_event) ran; null until then';

create table app.oa_event_days (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  oa_id uuid not null,
  day date not null,
  signature text not null check (signature in ('raw', 'compact', 'mismatch', 'missing', 'refused')),
  events integer not null default 0 check (events >= 0),
  primary key (oa_id, day, signature),
  foreign key (tenant_id, oa_id) references public.oas (tenant_id, id) on delete cascade
);

create index oa_event_days_tenant_day_idx on app.oa_event_days (tenant_id, day);

comment on table app.oa_event_days is 'count-only facts of the OA webhook per OA and tenant-local day: events stored per signature outcome and calls refused in enforce mode (refused); kept after the events themselves are deleted';

revoke all on public.oa_events from anon, authenticated;
revoke all on table app.oa_event_days from public, anon, authenticated, service_role;
alter table public.oa_events enable row level security;

create function app.oa_event_is_interaction(p_event_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_event_name = 'follow' or p_event_name ~ '^user_send_[a-z0-9_]+$', false);
$$;

comment on function app.oa_event_is_interaction(text) is 'whether an OA event opens the free messaging window: follow, or any user_send_ event (a message, and a menu or button tap of type oa.query, which Zalo delivers as the user''s message)';

create function app.oa_webhook_target(p_app_external_id text, p_oa_external_id text)
returns table (oa_id uuid, tenant_id uuid, secret_name text, webhook_mode text)
language sql
stable
set search_path = ''
as $$
  select o.id, o.tenant_id, o.secret_name, o.webhook_mode
  from public.oas o
  join public.zalo_apps a on a.tenant_id = o.tenant_id and a.brand_id = o.brand_id
  where o.external_id = p_oa_external_id
    and a.external_id = p_app_external_id;
$$;

comment on function app.oa_webhook_target(text, text) is 'the OA rows an event names, by the Zalo App id and OA id of its body: the OA, its tenant, the name of the secret holding its OA secret key and its webhook mode; more than one row means the ids are configured in several tenants, which oa-webhook refuses to guess between';

create function app.oa_unverified_on(p_oa_id uuid, p_day date)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(d.events), 0)::integer
  from app.oa_event_days d
  where d.oa_id = p_oa_id
    and d.day = p_day
    and d.signature in ('mismatch', 'missing', 'refused');
$$;

comment on function app.oa_unverified_on(uuid, date) is 'the calls of one OA and tenant-local day whose signature did not match: mismatches and missing signatures stored in observe mode plus calls refused in enforce mode';

create function app.receive_oa_event(
  p_oa_id uuid,
  p_event_id text,
  p_event_name text,
  p_oa_user_id text,
  p_occurred_at timestamptz,
  p_signature text,
  p_at timestamptz
)
returns table (outcome text, event_row uuid, unverified integer)
language plpgsql
volatile
set search_path = ''
as $$
declare
  target public.oas%rowtype;
  verified boolean := p_signature in ('raw', 'compact');
  day_key date;
  created uuid;
begin
  if p_signature is null or p_signature not in ('raw', 'compact', 'mismatch', 'missing') or p_at is null then
    raise exception 'receive_oa_event needs raw, compact, mismatch or missing and an instant' using errcode = '22023';
  end if;
  select o.* into target from public.oas o where o.id = p_oa_id;
  if not found then
    raise exception 'receive_oa_event needs a configured OA' using errcode = '22023';
  end if;
  select (p_at at time zone t.timezone)::date into day_key from public.tenants t where t.id = target.tenant_id;
  if not verified then
    perform pg_advisory_xact_lock(hashtextextended('fnb-oa-webhook:' || target.id::text || ':' || day_key::text, 0));
  end if;
  if not verified and target.webhook_mode = 'enforce' then
    insert into app.oa_event_days as d (tenant_id, oa_id, day, signature, events)
    values (target.tenant_id, target.id, day_key, 'refused', 1)
    on conflict (oa_id, day, signature) do update set events = d.events + 1;
    return query select 'refused'::text, null::uuid, app.oa_unverified_on(target.id, day_key);
    return;
  end if;
  insert into public.oa_events (tenant_id, oa_id, event_id, event_name, oa_user_id, occurred_at, received_at, signature)
  values (target.tenant_id, target.id, p_event_id, p_event_name, p_oa_user_id, least(coalesce(p_occurred_at, p_at), p_at), p_at, p_signature)
  on conflict (oa_id, event_id) do nothing
  returning id into created;
  if created is null then
    return query select 'duplicate'::text, null::uuid, null::integer;
    return;
  end if;
  insert into app.oa_event_days as d (tenant_id, oa_id, day, signature, events)
  values (target.tenant_id, target.id, day_key, p_signature, 1)
  on conflict (oa_id, day, signature) do update set events = d.events + 1;
  return query select 'recorded'::text, created, case when verified then null else app.oa_unverified_on(target.id, day_key) end;
end;
$$;

comment on function app.receive_oa_event(uuid, text, text, text, timestamptz, text, timestamptz) is 'the decision of oa-webhook for one event of a configured OA, taken against the OA''s current webhook mode: a matching signature (raw or compact) is stored; a mismatch or a missing signature is stored in observe mode and refused in enforce mode, where only the day''s refused count moves; a second delivery of a stored event id is a duplicate and changes nothing; returns recorded, duplicate or refused, the new event row, and for an unverified call the day''s unverified count; the event time is never later than p_at; 22023 for an unknown OA or outcome';

create function app.apply_oa_event(p_event_row uuid, p_at timestamptz)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  event public.oa_events%rowtype;
begin
  update public.oa_events e
  set processed_at = p_at
  where e.id = p_event_row
    and e.processed_at is null
  returning e.* into event;
  if not found then
    return 'already_processed';
  end if;
  if event.oa_user_id is null then
    return 'no_user';
  end if;
  if app.oa_event_is_interaction(event.event_name) then
    update public.notification_channels c
    set last_interaction_at = event.occurred_at
    where c.tenant_id = event.tenant_id
      and c.kind = 'zalo_oa'
      and c.address = event.oa_user_id
      and (c.last_interaction_at is null or c.last_interaction_at < event.occurred_at);
    return 'interaction';
  end if;
  if event.event_name = 'unfollow' then
    update public.notification_channels c
    set status = 'disabled', disabled_reason = 'blocked_by_user'
    where c.tenant_id = event.tenant_id
      and c.kind = 'zalo_oa'
      and c.address = event.oa_user_id
      and c.status <> 'disabled';
    return 'unfollow';
  end if;
  return 'ignored';
end;
$$;

comment on function app.apply_oa_event(uuid, timestamptz) is 'the follow-up of one stored OA event, run once (processed_at): an interaction (app.oa_event_is_interaction) moves last_interaction_at of the tenant''s zalo_oa destinations of that OA user forward to the event time; an unfollow disables them as blocked_by_user; any other event changes nothing; returns interaction, unfollow, ignored, no_user or already_processed';

create function app.raise_oa_webhook_alert(p_oa_id uuid, p_unverified integer, p_at timestamptz)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  target public.oas%rowtype;
  effective record;
  threshold integer;
  day_key date;
  raised record;
begin
  select o.* into target from public.oas o where o.id = p_oa_id;
  if not found or p_unverified is null or p_at is null then
    return 'none';
  end if;
  select r.* into effective from app.effective_alert_rule(target.tenant_id, null, 'zalo_webhook_unverified') r;
  threshold := coalesce((effective.params ->> 'max_per_day')::integer, 10);
  if p_unverified <> threshold + 1 then
    return 'not_crossed';
  end if;
  select (p_at at time zone t.timezone)::date into day_key from public.tenants t where t.id = target.tenant_id;
  select a.* into raised
  from app.raise_alert(
    target.tenant_id, 'zalo_webhook_unverified', 'oa:' || target.id::text, 'webhook', p_at,
    null, null, null, day_key,
    jsonb_build_object('unverified', p_unverified, 'max_per_day', threshold, 'mode', target.webhook_mode),
    null, true
  ) a;
  return raised.outcome;
end;
$$;

comment on function app.raise_oa_webhook_alert(uuid, integer, timestamptz) is 'raises zalo_webhook_unverified for an OA once its unverified calls of the tenant-local day (app.oa_unverified_on, as returned by app.receive_oa_event) pass max_per_day, exactly when the count reaches max_per_day + 1, as an instant episode under oa:<OA row id> with count-only facts; the rule''s cool-down keeps repeats on the following days quiet; returns the app.raise_alert outcome, not_crossed or none';

create function public.oa_event_counts(p_tenant_id uuid, p_from date, p_to date)
returns table (oa_id uuid, day date, signature text, events integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.tenant_role[]) then
    raise exception 'the OA webhook counts are read by the tenant''s owners' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then
    raise exception 'oa_event_counts needs a range of at most 400 days' using errcode = '22023';
  end if;
  return query
  select d.oa_id, d.day, d.signature, d.events
  from app.oa_event_days d
  where d.tenant_id = p_tenant_id
    and d.day between p_from and p_to
  order by d.day, d.oa_id, d.signature;
end;
$$;

comment on function public.oa_event_counts(uuid, date, date) is 'the OA webhook''s count-only facts of one tenant for the owners: per OA, tenant-local day and signature outcome (raw, compact, mismatch, missing, refused), the number of events; never an event, user id or text; 42501 for anyone but an owner of the tenant, 22023 for a range over 400 days';

create function app.set_bot_webhook(p_secret_name text, p_secret_sha256 text, p_at timestamptz)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  if not app.notify_secret_name_valid('zalo_bot', p_secret_name) or p_secret_sha256 is null or p_secret_sha256 !~ '^[0-9a-f]{64}$' or p_at is null then
    raise exception 'set_bot_webhook needs a zalo_bot secret name, the sha256 hex of the secret token and an instant' using errcode = '22023';
  end if;
  insert into app.bot_poll_state as b (secret_name, kind, webhook_secret_sha256, webhook_set_at)
  values (p_secret_name, 'zalo_bot', p_secret_sha256, p_at)
  on conflict (secret_name) do update
  set webhook_secret_sha256 = excluded.webhook_secret_sha256,
      webhook_set_at = excluded.webhook_set_at,
      poller = null,
      poll_lease_until = null;
end;
$$;

comment on function app.set_bot_webhook(text, text, timestamptz) is 'puts a Zalo Bot in webhook mode after setWebhook succeeded: stores the sha256 hex of the secret token bot-webhook will check, drops any polling lease, and from then on app.take_poll_lease refuses the bot; 22023 for a name that is not a zalo_bot secret name or a hash that is not 64 hex characters';

create function app.bot_webhook_target(p_secret_sha256 text)
returns table (secret_name text, kind public.channel_kind)
language sql
stable
set search_path = ''
as $$
  select b.secret_name, b.kind
  from app.bot_poll_state b
  where b.webhook_secret_sha256 = p_secret_sha256
    and b.webhook_set_at is not null;
$$;

comment on function app.bot_webhook_target(text) is 'the bot in webhook mode whose secret token hashes to p_secret_sha256, or no row; bot-webhook answers 401 without a row';

create or replace function app.take_poll_lease(p_secret_name text, p_kind public.channel_kind, p_worker text, p_lease interval, p_at timestamptz)
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
  if exists (select 1 from app.bot_poll_state b where b.secret_name = p_secret_name and b.webhook_set_at is not null) then
    return false;
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

comment on function app.take_poll_lease(text, public.channel_kind, text, interval, timestamptz) is 'takes or renews the polling lease of one bot token when it is free, expired or already the caller''s, so one getUpdates consumer per token runs at a time; false when another worker holds it, and always false for a bot in webhook mode, because Zalo treats polling and a webhook as exclusive';

create function app.stop_bot_chat(p_kind public.channel_kind, p_secret_name text, p_address text, p_at timestamptz)
returns table (channel_id uuid, tenant_id uuid)
language plpgsql
volatile
set search_path = ''
as $$
declare
  member record;
begin
  if p_address is null or btrim(p_address) = '' then
    return;
  end if;
  for member in
    select distinct c.tenant_id, c.user_id
    from public.notification_channels c
    where c.kind = p_kind
      and c.secret_name = p_secret_name
      and c.address = p_address
      and c.user_id is not null
      and c.status in ('active', 'failing')
  loop
    return query
    select c.id, c.tenant_id
    from public.notification_channels c
    where c.kind = p_kind
      and c.secret_name = p_secret_name
      and c.address = p_address
      and c.tenant_id = member.tenant_id
      and c.user_id = member.user_id
      and c.status in ('active', 'failing');
    perform app.withdraw_notifications(member.tenant_id, member.user_id, p_at);
  end loop;
end;
$$;

comment on function app.stop_bot_chat(public.channel_kind, text, text, timestamptz) is 'the member''s "DỪNG" reply in a linked bot chat: for every member whose active or failing destination is this chat, withdraws the notifications consent through app.withdraw_notifications (consent revoked, waiting messages cancelled, destinations disabled as consent_withdrawn); returns the destinations of the chat that were linked, so the caller confirms once; nothing for a chat that is not linked';

create function app.record_bot_reply(p_channel_ids uuid[], p_template text, p_status text, p_error_code text, p_provider_message_id text, p_at timestamptz)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  logged integer;
begin
  if p_template is null or p_template !~ '^[a-z][a-z0-9_]{0,40}\.v[0-9]{1,3}$' or p_status is null or p_status not in ('sent', 'failed', 'uncertain') or p_at is null then
    raise exception 'record_bot_reply needs a versioned template, sent, failed or uncertain, and an instant' using errcode = '22023';
  end if;
  insert into public.outbound_messages (tenant_id, channel, recipient_ref, subject_type, subject_id, purpose, template_ref, sent_at, status, provider_message_id, channel_id, last_error_code, created_at)
  select c.tenant_id, c.kind::text, 'channel:' || c.id::text, 'staff', c.user_id, 'notifications', p_template,
    case when p_status = 'sent' then p_at end, p_status, left(p_provider_message_id, 200), c.id, p_error_code, p_at
  from public.notification_channels c
  where c.id = any (p_channel_ids);
  get diagnostics logged = row_count;
  return logged;
end;
$$;

comment on function app.record_bot_reply(uuid[], text, text, text, text, timestamptz) is 'logs a reply bot-webhook sent straight to a chat outside the outbox (the "DỪNG" confirmation) as one log row per destination, with the opaque recipient channel:<id>, the template and the outcome, never the text';

create or replace function app.notify_housekeeping(p_at timestamptz, p_tenant_id uuid default null)
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
  oa_events_deleted integer;
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
  delete from public.oa_events e
  where e.received_at < p_at - interval '90 days'
    and (p_tenant_id is null or e.tenant_id = p_tenant_id);
  get diagnostics oa_events_deleted = row_count;
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
    'cron_details_deleted', cron_deleted,
    'oa_events_deleted', oa_events_deleted
  );
end;
$$;

comment on function app.notify_housekeeping(timestamptz, uuid) is 'retention, once a day from the tick: deletes finished queue rows after retention_days (at least 366) in batches of 5,000, never queued, held, sending or uncertain ones; clears bodies after body_retention_days; deletes resolved episodes and digests after retention_days, link codes a day after expiry, pending bot destinations whose chat id was never accepted and OA webhook events after 90 days (their day counts stay in app.oa_event_days); redacts rows of former members; prunes cron.job_run_details after 7 days on an unscoped run; returns counts';

revoke all on function app.oa_event_is_interaction(text) from public, anon, authenticated, service_role;
revoke all on function app.oa_webhook_target(text, text) from public, anon, authenticated, service_role;
revoke all on function app.oa_unverified_on(uuid, date) from public, anon, authenticated, service_role;
revoke all on function app.receive_oa_event(uuid, text, text, text, timestamptz, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.apply_oa_event(uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.raise_oa_webhook_alert(uuid, integer, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.set_bot_webhook(text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.bot_webhook_target(text) from public, anon, authenticated, service_role;
revoke all on function app.stop_bot_chat(public.channel_kind, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.record_bot_reply(uuid[], text, text, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.oa_event_counts(uuid, date, date) from public, anon, service_role;

grant execute on function public.oa_event_counts(uuid, date, date) to authenticated;
