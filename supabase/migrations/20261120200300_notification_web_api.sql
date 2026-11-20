create table app.notification_test_sends (
  channel_id uuid not null references public.notification_channels (id) on delete cascade,
  sent_at timestamptz not null default now()
);

create index notification_test_sends_channel_idx on app.notification_test_sends (channel_id, sent_at desc);

comment on table app.notification_test_sends is 'the rate limit of public.send_test_message: one row per test requested from the web, kept with its destination; at most 5 an hour and 1 a minute per destination';

revoke all on table app.notification_test_sends from public, anon, authenticated, service_role;

create function app.notification_web_member(p_tenant_id uuid)
returns public.tenant_members
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_member public.tenant_members%rowtype;
begin
  if p_tenant_id is null then
    raise exception 'a tenant is required' using errcode = '22023';
  end if;
  select m.* into v_member
  from public.tenant_members m
  where m.tenant_id = p_tenant_id
    and m.user_id = (select auth.uid());
  if not found then
    raise exception 'only a signed-in member of the tenant manages notifications' using errcode = '42501';
  end if;
  if v_member.role = 'publisher' then
    raise exception 'a publisher login receives no digest or alert' using errcode = '42501';
  end if;
  return v_member;
end;
$$;

comment on function app.notification_web_member(uuid) is 'the caller''s membership for the Settings → Cảnh báo functions: 22023 without a tenant, 42501 for a caller who is not signed in, not a member, or a publisher';

create function app.email_hint(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_email is null or position('@' in p_email) < 2 then null
    else left(left(p_email, 1) || '…@' || split_part(p_email, '@', 2), 40)
  end;
$$;

comment on function app.email_hint(text) is 'what a screen shows for an e-mail address: its first character, an ellipsis and the domain, at most 40 characters';

create function public.notify_overview(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_member public.tenant_members%rowtype;
  v_user uuid := (select auth.uid());
  v_wide boolean;
  v_owner boolean;
  v_settings app.notify_settings%rowtype;
  v_destinations jsonb;
  v_visible uuid[];
  v_month_start timestamptz;
  v_zone text;
begin
  v_member := app.notification_web_member(p_tenant_id);
  v_wide := v_member.role in ('owner', 'manager') and v_member.store_ids is null;
  v_owner := v_member.role = 'owner' and v_member.store_ids is null;
  select s.* into v_settings from app.notify_settings s;
  select t.timezone into v_zone from public.tenants t where t.id = p_tenant_id;
  v_month_start := date_trunc('month', now() at time zone coalesce(v_zone, 'Asia/Ho_Chi_Minh')) at time zone coalesce(v_zone, 'Asia/Ho_Chi_Minh');
  select coalesce(array_agg(c.id), '{}') into v_visible
  from public.notification_channels c
  where c.tenant_id = p_tenant_id
    and (v_wide or c.user_id = v_user);
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'kind', c.kind,
      'provider', c.provider,
      'label', c.label,
      'status', c.status,
      'enabled', c.enabled,
      'disabled_reason', c.disabled_reason,
      'address_hint', c.address_hint,
      'mine', c.user_id is not distinct from v_user,
      'has_member', c.user_id is not null,
      'member_role', (select m.role from public.tenant_members m where m.tenant_id = c.tenant_id and m.user_id = c.user_id),
      'member_email', case when v_owner then (select u.email from auth.users u where u.id = c.user_id) end,
      'store_ids', c.store_ids,
      'muted_rules', to_jsonb(c.muted_rules),
      'timezone', c.timezone,
      'linked_at', c.linked_at,
      'last_ok_at', c.last_ok_at,
      'last_error_code', c.last_error_code,
      'last_error_at', c.last_error_at,
      'consecutive_failures', c.consecutive_failures,
      'secret_reported', c.secret_name = any (v_settings.last_dispatcher_secrets)
    ) order by c.created_at, c.id), '[]'::jsonb)
  into v_destinations
  from public.notification_channels c
  where c.id = any (v_visible);
  return jsonb_build_object(
    'role', v_member.role,
    'store_limited', v_member.store_ids is not null,
    'schedule_enabled', coalesce(v_settings.enabled, false),
    'last_tick_at', v_settings.last_tick_at,
    'last_dispatch_at', v_settings.last_dispatch_at,
    'dispatcher_secrets', case when v_owner then to_jsonb(coalesce(v_settings.last_dispatcher_secrets, '{}'::text[])) else '[]'::jsonb end,
    'destinations', v_destinations,
    'held_24h', (select count(*) from public.outbound_messages o where o.channel_id = any (v_visible) and o.status = 'held' and o.created_at > now() - interval '24 hours'),
    'uncertain_24h', (select count(*) from public.outbound_messages o where o.channel_id = any (v_visible) and o.status = 'uncertain' and o.created_at > now() - interval '24 hours'),
    'failed_24h', (select count(*) from public.outbound_messages o where o.channel_id = any (v_visible) and o.status = 'failed' and o.created_at > now() - interval '24 hours'),
    'pending_links', (select count(*) from public.notification_channels c where c.id = any (v_visible) and c.status = 'pending'),
    'zalo_bot_month', (
      select count(*)
      from public.outbound_messages o
      where o.tenant_id = p_tenant_id
        and o.channel = 'zalo_bot'
        and o.status in ('sent', 'delivered', 'uncertain')
        and o.sent_at >= v_month_start
        and (v_wide or o.channel_id = any (v_visible))
    ),
    'zalo_bot_quota', 3000
  );
end;
$$;

comment on function public.notify_overview(uuid) is 'Settings → Cảnh báo at a glance for the signed-in member: the destinations (owners and managers with every store see the tenant''s, every other member their own) with kind, provider, label, status, enabled, the address hint, health, scope, muted rules and zone, never the address, secret name or configuration; the member''s login e-mail for unlimited owners only; whether the schedule is on, the last tick and dispatch, the NOTIFY_ names the last dispatcher reported (unlimited owners only), held, uncertain and failed messages of 24 hours, pending links and this month''s Zalo Bot count against the Basic plan''s 3,000; 42501 for a non-member or a publisher';

create function public.start_channel_link(p_tenant_id uuid, p_kind public.channel_kind, p_label text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_member public.tenant_members%rowtype;
  v_user uuid := (select auth.uid());
  v_at timestamptz := now();
  v_secret text;
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_channel public.notification_channels%rowtype;
  v_existing boolean;
  v_starts smallint;
  v_code text;
  v_expires timestamptz;
  v_email text;
  v_consent uuid;
begin
  v_member := app.notification_web_member(p_tenant_id);
  if p_kind is null or p_kind not in ('zalo_bot', 'telegram', 'email') then
    raise exception 'start_channel_link links a Zalo Bot, Telegram or e-mail destination; webhooks are added from the command line' using errcode = '22023';
  end if;
  if v_label is not null and char_length(v_label) > 60 then
    raise exception 'a destination label has at most 60 characters' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('notify-bot-link:' || p_tenant_id::text || ':' || v_user::text, 0));
  insert into app.notification_link_starts as s (tenant_id, user_id, window_started_at, starts)
  values (p_tenant_id, v_user, v_at, 1)
  on conflict (tenant_id, user_id) do update
  set window_started_at = case
        when s.window_started_at <= excluded.window_started_at - interval '1 hour' or s.window_started_at > excluded.window_started_at
          then excluded.window_started_at
        else s.window_started_at
      end,
      starts = case
        when s.window_started_at <= excluded.window_started_at - interval '1 hour' or s.window_started_at > excluded.window_started_at
          then 1
        else s.starts + 1
      end
  where s.window_started_at <= excluded.window_started_at - interval '1 hour'
     or s.window_started_at > excluded.window_started_at
     or s.starts < 5
  returning s.starts into v_starts;
  if v_starts is null then
    raise exception 'at most 5 links an hour' using errcode = '22023', hint = 'rate_limited';
  end if;

  if p_kind = 'email' then
    select u.email into v_email from auth.users u where u.id = v_user;
    if v_email is null or position('@' in v_email) < 2 then
      raise exception 'the login has no e-mail address to send to' using errcode = '22023';
    end if;
    v_secret := coalesce(
      (select c.secret_name from public.notification_channels c
       where c.tenant_id = p_tenant_id and c.kind = 'email'
       group by c.secret_name order by count(*) desc, c.secret_name limit 1),
      'NOTIFY_EMAIL_API_KEY'
    );
    select c.* into v_channel
    from public.notification_channels c
    where c.tenant_id = p_tenant_id and c.user_id = v_user and c.kind = 'email' and c.secret_name = v_secret
    for update;
    v_existing := found;
    if v_existing and v_channel.disabled_reason = 'owner_request' then
      raise exception 'the owner removed this e-mail destination, so only the owner adds it again' using errcode = '42501';
    end if;
    v_consent := app.ensure_notifications_consent(
      p_tenant_id, v_user, 'email',
      jsonb_build_object('method', 'web_session', 'notice_version', 'ops-notifications-v1', 'notice_channel', 'web', 'accepted_at', v_at),
      v_at
    );
    if not v_existing then
      insert into public.notification_channels (tenant_id, kind, provider, label, user_id, address_hint, secret_name, status, linked_at, consent_record_id)
      values (p_tenant_id, 'email', 'brevo', coalesce(v_label, 'E-mail'), v_user, app.email_hint(v_email), v_secret, 'active', v_at, v_consent)
      returning * into v_channel;
    else
      update public.notification_channels c
      set status = 'active',
          disabled_reason = null,
          enabled = true,
          label = coalesce(v_label, c.label),
          address_hint = app.email_hint(v_email),
          linked_at = v_at,
          consent_record_id = v_consent,
          consecutive_failures = 0,
          last_error_code = null,
          last_error_at = null
      where c.id = v_channel.id
      returning c.* into v_channel;
    end if;
    return jsonb_build_object('channel_id', v_channel.id, 'status', v_channel.status, 'link_code', null, 'expires_at', null, 'bot_name', null);
  end if;

  if exists (
    select 1 from public.notification_channels c
    where c.tenant_id = p_tenant_id and c.user_id = v_user and c.kind = p_kind and c.status in ('active', 'failing')
  ) then
    raise exception 'this chat is already linked' using errcode = '23505';
  end if;
  if p_kind = 'zalo_bot' then
    v_secret := app.member_bot_secret_name(p_tenant_id, v_user);
  else
    v_secret := coalesce(
      (select c.secret_name from public.notification_channels c
       where c.tenant_id = p_tenant_id and c.kind = 'telegram'
       group by c.secret_name order by count(*) desc, c.secret_name limit 1),
      'NOTIFY_TELEGRAM_BOT_TOKEN'
    );
  end if;
  select c.* into v_channel
  from public.notification_channels c
  where c.tenant_id = p_tenant_id and c.user_id = v_user and c.kind = p_kind and c.secret_name = v_secret
  for update;
  v_existing := found;
  if v_existing and v_channel.disabled_reason = 'owner_request' then
    raise exception 'the owner removed this link, so only the owner links it again' using errcode = '42501';
  end if;
  if not v_existing then
    insert into public.notification_channels (tenant_id, kind, provider, label, user_id, secret_name, status)
    values (p_tenant_id, p_kind, p_kind::text, coalesce(v_label, case p_kind when 'zalo_bot' then 'Zalo Bot' else 'Telegram' end), v_user, v_secret, 'pending')
    returning * into v_channel;
  elsif v_channel.status = 'disabled' then
    update public.notification_channels c
    set status = 'pending', disabled_reason = null, enabled = true, address = null, address_hint = null,
        linked_at = null, consent_record_id = null, consecutive_failures = 0, last_error_code = null, last_error_at = null,
        label = coalesce(v_label, c.label)
    where c.id = v_channel.id
    returning c.* into v_channel;
  end if;
  v_code := app.issue_link_code(v_channel.id, 'bot_link', v_at);
  select l.expires_at into v_expires from app.notification_link_codes l where l.channel_id = v_channel.id;
  perform app.kick_notify('kick');
  return jsonb_build_object(
    'channel_id', v_channel.id,
    'status', v_channel.status,
    'link_code', v_code,
    'expires_at', v_expires,
    'bot_name', (select b.bot_name from app.bot_poll_state b where b.secret_name = v_secret)
  );
end;
$$;

comment on function public.start_channel_link(uuid, public.channel_kind, text) is 'the signed-in member links their own destination from Settings → Cảnh báo, after the page showed the notice ops-notifications-v1: for zalo_bot and telegram it reuses their pending or self-stopped destination or creates one, issues a code valid 15 minutes that is returned once and kept only as a hash, and wakes the dispatcher; the destination turns active, and the consent is recorded, only at the member''s own ĐỒNG Ý in the chat; for email it activates the member''s login address at once and records the notifications consent with method web_session; returns channel_id, status, link_code, expires_at and bot_name, never an address; 22023 for webhook or another kind, a long label or past 5 links an hour (hint rate_limited), 23505 when that chat is already linked, 42501 for a non-member, a publisher or a link the owner removed';

create function app.notification_destination_for_caller(p_channel_id uuid, p_allow_wide_managers boolean)
returns public.notification_channels
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_channel public.notification_channels%rowtype;
  v_user uuid := (select auth.uid());
begin
  select c.* into v_channel from public.notification_channels c where c.id = p_channel_id;
  if not found then
    raise exception 'no such destination for this login' using errcode = '42501';
  end if;
  if v_channel.user_id is not distinct from v_user and v_user is not null then
    perform app.notification_web_member(v_channel.tenant_id);
    return v_channel;
  end if;
  if app.has_store_scope(v_channel.tenant_id, null, case when p_allow_wide_managers then array['owner', 'manager'] else array['owner'] end::public.tenant_role[]) then
    return v_channel;
  end if;
  raise exception 'only the destination''s member or an owner with every store changes it' using errcode = '42501';
end;
$$;

comment on function app.notification_destination_for_caller(uuid, boolean) is 'the destination when the caller is its member (not a publisher) or an owner with every store (also a manager with every store when p_allow_wide_managers); 42501 otherwise, the same for a destination that does not exist';

create function public.update_destination(
  p_channel_id uuid,
  p_enabled boolean default null,
  p_label text default null,
  p_store_ids uuid[] default null,
  p_clear_store_ids boolean default false,
  p_muted_rules text[] default null,
  p_timezone text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_channel public.notification_channels%rowtype;
  v_member_scope uuid[];
  v_label text := nullif(btrim(coalesce(p_label, '')), '');
  v_muted text[];
begin
  v_channel := app.notification_destination_for_caller(p_channel_id, false);
  if p_label is not null and (v_label is null or char_length(v_label) > 60) then
    raise exception 'a destination label has 1 to 60 characters' using errcode = '22023';
  end if;
  if p_store_ids is not null then
    if p_clear_store_ids then
      raise exception 'give store ids or clear them, not both' using errcode = '22023';
    end if;
    if cardinality(p_store_ids) = 0 or cardinality(p_store_ids) > 50 then
      raise exception 'a store narrowing holds 1 to 50 stores' using errcode = '22023';
    end if;
    if exists (
      select 1 from unnest(p_store_ids) as s (id)
      where not exists (select 1 from public.stores st where st.id = s.id and st.tenant_id = v_channel.tenant_id)
    ) then
      raise exception 'a store of the narrowing is not a store of the tenant' using errcode = '22023';
    end if;
    if v_channel.user_id is not null then
      select m.store_ids into v_member_scope from public.tenant_members m where m.tenant_id = v_channel.tenant_id and m.user_id = v_channel.user_id;
      if v_member_scope is not null and not (p_store_ids <@ v_member_scope) then
        raise exception 'store ids may only narrow the member''s own stores' using errcode = '22023';
      end if;
    end if;
  end if;
  if p_muted_rules is not null then
    select coalesce(array_agg(distinct r order by r), '{}') into v_muted from unnest(p_muted_rules) as r;
    if exists (select 1 from unnest(v_muted) as r where not exists (select 1 from public.alert_rule_catalog c where c.rule_key = r)) then
      raise exception 'a muted rule is not a catalogue rule' using errcode = '22023';
    end if;
  end if;
  if p_timezone is not null and not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_timezone) then
    raise exception 'the reader''s zone must be an IANA time zone' using errcode = '22023';
  end if;
  update public.notification_channels c
  set enabled = coalesce(p_enabled, c.enabled),
      label = coalesce(v_label, c.label),
      store_ids = case when p_clear_store_ids then null when p_store_ids is not null then p_store_ids else c.store_ids end,
      muted_rules = coalesce(v_muted, c.muted_rules),
      timezone = coalesce(p_timezone, c.timezone)
  where c.id = v_channel.id
  returning c.* into v_channel;
  return jsonb_build_object(
    'id', v_channel.id,
    'label', v_channel.label,
    'enabled', v_channel.enabled,
    'status', v_channel.status,
    'store_ids', v_channel.store_ids,
    'muted_rules', to_jsonb(v_channel.muted_rules),
    'timezone', v_channel.timezone
  );
end;
$$;

comment on function public.update_destination(uuid, boolean, text, uuid[], boolean, text[], text) is 'the destination''s member, or an owner with every store for any destination, changes its enabled flag, label (1 to 60 characters), store narrowing (only within the member''s own stores; p_clear_store_ids removes it), muted catalogue rules and reader zone (IANA); a null argument keeps the value; returns the changed row without address, secret or configuration; 22023 for bad input, 42501 for anyone else';

create function public.remove_destination(p_channel_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_channel public.notification_channels%rowtype;
  v_open integer;
begin
  v_channel := app.notification_destination_for_caller(p_channel_id, false);
  select count(*)::integer into v_open
  from public.outbound_messages o
  where o.channel_id = v_channel.id and o.status in ('queued', 'held');
  delete from public.notification_channels c where c.id = v_channel.id;
  return v_open;
end;
$$;

comment on function public.remove_destination(uuid) is 'the destination''s member, or an owner with every store, removes it: its queued and held messages are cancelled as destination_removed by the delete trigger and the row is deleted; the member''s notifications consent stays; returns the number of messages cancelled; 42501 for anyone else';

create function public.send_test_message(p_channel_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_channel public.notification_channels%rowtype;
  v_at timestamptz := now();
  v_created uuid;
begin
  v_channel := app.notification_destination_for_caller(p_channel_id, true);
  if v_channel.kind = 'webhook' then
    raise exception 'tests to a webhook are sent from the command line' using errcode = '22023';
  end if;
  if v_channel.status not in ('active', 'failing') or not v_channel.enabled then
    raise exception 'only an active, enabled destination receives a test' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('notify-test:' || v_channel.id::text, 0));
  if exists (select 1 from app.notification_test_sends t where t.channel_id = v_channel.id and t.sent_at > v_at - interval '1 minute')
     or (select count(*) from app.notification_test_sends t where t.channel_id = v_channel.id and t.sent_at > v_at - interval '1 hour') >= 5 then
    raise exception 'at most one test a minute and 5 an hour per destination' using errcode = '22023', hint = 'rate_limited';
  end if;
  insert into app.notification_test_sends (channel_id, sent_at) values (v_channel.id, v_at);
  delete from app.notification_test_sends t where t.channel_id = v_channel.id and t.sent_at < v_at - interval '1 day';
  v_created := app.enqueue_message(
    v_channel.tenant_id, v_channel.id, 'test', 'test.v1',
    'test:' || v_channel.id::text || ':' || gen_random_uuid()::text,
    '{}'::jsonb, null, null, 'info'::public.alert_severity, null, null, null, null,
    v_at + interval '1 hour', v_at
  );
  perform app.kick_notify('kick');
  return v_created;
end;
$$;

comment on function public.send_test_message(uuid) is 'queues a test message to an active, enabled destination for its member or an owner or manager with every store, then wakes the dispatcher; a test ignores the window and the caps but never the consent or the destination''s state; at most one a minute and 5 an hour per destination (22023 with hint rate_limited); 22023 for a webhook or an inactive destination, 42501 for anyone else; returns the message id';

create function public.notify_message_status(p_message_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id,
    'status', o.status,
    'decision', o.decision,
    'hold_reason', o.hold_reason,
    'not_before', o.not_before,
    'sent_at', o.sent_at,
    'last_error_code', o.last_error_code
  )
  from public.outbound_messages o
  where o.id = p_message_id;
$$;

comment on function public.notify_message_status(uuid) is 'the status of one outbox message as the caller''s row-level security lets them read it (null otherwise): status, decision, hold reason, release time, sent time and error code, never the text';

revoke all on function app.notification_web_member(uuid) from public, anon, authenticated, service_role;
revoke all on function app.email_hint(text) from public, anon, authenticated, service_role;
revoke all on function app.notification_destination_for_caller(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.notify_overview(uuid) from public, anon, service_role;
revoke all on function public.start_channel_link(uuid, public.channel_kind, text) from public, anon, service_role;
revoke all on function public.update_destination(uuid, boolean, text, uuid[], boolean, text[], text) from public, anon, service_role;
revoke all on function public.remove_destination(uuid) from public, anon, service_role;
revoke all on function public.send_test_message(uuid) from public, anon, service_role;
revoke all on function public.notify_message_status(uuid) from public, anon, service_role;
grant execute on function public.notify_overview(uuid) to authenticated;
grant execute on function public.start_channel_link(uuid, public.channel_kind, text) to authenticated;
grant execute on function public.update_destination(uuid, boolean, text, uuid[], boolean, text[], text) to authenticated;
grant execute on function public.remove_destination(uuid) to authenticated;
grant execute on function public.send_test_message(uuid) to authenticated;
grant execute on function public.notify_message_status(uuid) to authenticated;
