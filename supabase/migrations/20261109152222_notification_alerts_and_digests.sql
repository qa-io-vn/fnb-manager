create function app.root_cause_event(p_tenant_id uuid, p_rule_key text, p_store_id uuid, p_account_id uuid, p_at timestamptz)
returns uuid
language sql
stable
set search_path = ''
as $$
  select e.id
  from public.alert_events e
  where p_rule_key in ('sync_stale', 'sync_failed', 'sync_dispatch_failed', 'zero_sales_open')
    and e.tenant_id = p_tenant_id
    and e.rule_key = 'auth_failed'
    and e.pos_account_id = coalesce(
      p_account_id,
      (select s.pos_account_id from public.stores s where s.id = p_store_id and s.tenant_id = p_tenant_id)
    )
    and (
      e.state = 'open'
      or (e.resolution <> 'instant' and e.resolved_at > p_at - interval '30 minutes')
    )
  order by e.state = 'open' desc, e.resolved_at desc nulls first, e.opened_at desc, e.id
  limit 1;
$$;

comment on function app.root_cause_event(uuid, text, uuid, uuid, timestamptz) is 'the auth_failed episode of the account (the store''s account when only the store is given) under which a sync_stale, sync_failed, sync_dispatch_failed or zero_sales_open reading is folded: an open one, or one resolved less than 30 minutes before p_at, because readings taken during the outage can still arrive just after the recovery; null for every other rule';

create function app.alert_destinations(p_tenant_id uuid, p_store_id uuid, p_account_id uuid, p_rule_key text, p_exclude_channel_id uuid default null)
returns table (channel_id uuid)
language sql
stable
set search_path = ''
as $$
  with rule as (
    select r.roles
    from app.effective_alert_rule(p_tenant_id, p_store_id, p_rule_key) r
  ),
  account_stores as (
    select coalesce(array_agg(s.id), '{}'::uuid[]) as ids
    from public.stores s
    where p_store_id is null
      and p_account_id is not null
      and s.tenant_id = p_tenant_id
      and s.pos_account_id = p_account_id
      and s.active
  ),
  excluded_member as (
    select x.user_id
    from public.notification_channels x
    where x.id = p_exclude_channel_id
      and x.tenant_id = p_tenant_id
      and x.user_id is not null
  )
  select c.id
  from public.notification_channels c
  cross join rule r
  cross join account_stores a
  left join public.tenant_members m
    on m.tenant_id = c.tenant_id
   and m.user_id = c.user_id
  where c.tenant_id = p_tenant_id
    and c.enabled
    and c.status in ('active', 'failing')
    and c.id is distinct from p_exclude_channel_id
    and not (p_rule_key = any (c.muted_rules))
    and (
      (
        c.kind = 'webhook'
        and c.user_id is null
        and case
          when p_store_id is not null then c.store_ids is null or p_store_id = any (c.store_ids)
          when p_account_id is not null then c.store_ids is null or c.store_ids && a.ids
          else c.store_ids is null
        end
      )
      or (
        m.user_id is not null
        and (
          (
            m.role = any (r.roles)
            and case
              when p_store_id is not null then
                (m.store_ids is null or p_store_id = any (m.store_ids))
                and (c.store_ids is null or p_store_id = any (c.store_ids))
              when p_account_id is not null then exists (
                select 1
                from unnest(a.ids) as account_store (id)
                where (m.store_ids is null or account_store.id = any (m.store_ids))
                  and (c.store_ids is null or account_store.id = any (c.store_ids))
              )
              else m.store_ids is null
            end
          )
          or c.user_id in (select em.user_id from excluded_member em)
        )
      )
    )
  order by c.created_at, c.id;
$$;

comment on function app.alert_destinations(uuid, uuid, uuid, text, uuid) is 'the destinations an episode of the rule reaches: active or failing, enabled, not muting the rule; a member''s destination when the member holds a role of the effective rule and both the member''s and the destination''s store scope cover the episode (the store; at least one active store of the account; an unlimited member for a tenant episode); a webhook when its store_ids cover the episode; p_exclude_channel_id leaves out the failing destination of a channel_failed episode and adds its member''s other destinations';

create function app.enqueue_alert_messages(p_event_id uuid, p_kind text, p_at timestamptz)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  episode public.alert_events%rowtype;
  base_params jsonb;
  episode_params jsonb;
  message_params jsonb;
  target record;
  suffix text;
  message_key text;
  template_name text;
  queued integer := 0;
begin
  if p_kind is null or p_kind not in ('alert', 'alert_reminder', 'alert_resolved') then
    raise exception 'enqueue_alert_messages needs the kind alert, alert_reminder or alert_resolved' using errcode = '22023';
  end if;
  if p_at is null then
    raise exception 'enqueue_alert_messages needs an instant' using errcode = '22023';
  end if;
  select e.* into episode from public.alert_events e where e.id = p_event_id;
  if not found then
    raise exception 'enqueue_alert_messages needs an existing episode' using errcode = '22023';
  end if;
  base_params := jsonb_build_object(
    'rule_key', episode.rule_key,
    'severity', episode.severity::text,
    'store_id', episode.store_id::text,
    'account_id', episode.pos_account_id::text,
    'business_date', to_char(episode.business_date, 'YYYY-MM-DD'),
    'occurrences', episode.occurrences,
    'opened_at', floor(extract(epoch from episode.opened_at))::bigint
  );
  if p_kind = 'alert_resolved' then
    base_params := base_params || jsonb_build_object('resolved_at', floor(extract(epoch from coalesce(episode.resolved_at, p_at)))::bigint);
  end if;
  select coalesce(jsonb_object_agg(f.key, f.value), '{}'::jsonb) into episode_params
  from (
    select e.key, e.value
    from jsonb_each(episode.facts) as e
    where not (base_params ? e.key)
    order by e.key
    limit greatest(24 - (select count(*) from jsonb_object_keys(base_params))::integer, 0)
  ) f;
  message_params := episode_params || base_params;
  template_name := 'alert.' || episode.rule_key || case p_kind
    when 'alert' then '.v1'
    when 'alert_reminder' then '.reminder.v1'
    else '.resolved.v1'
  end;
  for target in
    select d.channel_id
    from app.alert_destinations(episode.tenant_id, episode.store_id, episode.pos_account_id, episode.rule_key, episode.channel_id) d
  loop
    if p_kind = 'alert_resolved' and not exists (
      select 1
      from public.outbound_messages o
      where o.alert_event_id = episode.id
        and o.channel_id = target.channel_id
        and o.kind = 'alert'
        and o.status in ('sent', 'delivered')
    ) then
      continue;
    end if;
    suffix := case p_kind
      when 'alert' then 'open'
      when 'alert_resolved' then 'resolved'
      else 'remind:' || (
        1 + (
          select count(*)
          from public.outbound_messages o
          where o.alert_event_id = episode.id
            and o.channel_id = target.channel_id
            and o.kind = 'alert_reminder'
        )
      )::text
    end;
    message_key := 'alert:' || episode.id::text || ':' || target.channel_id::text || ':' || suffix;
    continue when exists (
      select 1
      from public.outbound_messages o
      where o.tenant_id = episode.tenant_id
        and o.dedupe_key = message_key
    );
    perform app.enqueue_message(
      episode.tenant_id,
      target.channel_id,
      p_kind,
      template_name,
      message_key,
      message_params,
      null,
      null,
      episode.severity,
      episode.store_id,
      episode.business_date,
      null,
      episode.id,
      p_at + interval '24 hours',
      p_at
    );
    queued := queued + 1;
  end loop;
  if queued > 0 then
    perform app.kick_notify('kick');
  end if;
  return queued;
end;
$$;

comment on function app.enqueue_alert_messages(uuid, text, timestamptz) is 'fans an episode out to app.alert_destinations: one alert, alert_reminder or alert_resolved message per destination, dedupe key alert:<episode>:<destination>:open, :remind:<n> or :resolved, template alert.<rule>[.reminder|.resolved].v1, count-only params (the episode''s facts plus rule_key, severity, store_id, account_id, business_date, occurrences, opened_at and, for a resolution, resolved_at as Unix seconds), expiring after 24 hours; a resolution goes only to destinations whose opening message was sent or delivered; kicks the dispatcher when anything was queued and returns the count';

create function app.raise_alert(
  p_tenant_id uuid,
  p_rule_key text,
  p_subject_key text,
  p_source text,
  p_occurred_at timestamptz,
  p_store_id uuid default null,
  p_account_id uuid default null,
  p_channel_id uuid default null,
  p_business_date date default null,
  p_facts jsonb default '{}'::jsonb,
  p_severity public.alert_severity default null,
  p_instant boolean default false
)
returns table (event_id uuid, outcome text, messages integer)
language plpgsql
volatile
set search_path = ''
as $$
declare
  effective record;
  reading_facts jsonb := coalesce(p_facts, '{}'::jsonb);
  dedupe text;
  existing public.alert_events%rowtype;
  root uuid;
  previous_notice timestamptz;
  created uuid;
  queued integer := 0;
begin
  if p_tenant_id is null or p_occurred_at is null or p_subject_key is null or p_subject_key !~ '^[a-z0-9_:.-]{1,150}$' then
    raise exception 'raise_alert needs a tenant, a subject key of lower-case tokens and an instant' using errcode = '22023';
  end if;
  select r.* into effective from app.effective_alert_rule(p_tenant_id, p_store_id, p_rule_key) r;
  if not found then
    raise exception 'raise_alert needs a rule key of the catalogue' using errcode = '22023';
  end if;
  if effective.delivery <> 'immediate' then
    raise exception 'raise_alert takes immediate rules only; digest rules become lines of the digest' using errcode = '22023';
  end if;
  if not app.facts_are_count_only(reading_facts) then
    raise exception 'raise_alert takes count-only facts' using errcode = '22023';
  end if;
  if not coalesce(effective.enabled, false) then
    return query select null::uuid, 'ignored_disabled'::text, 0;
    return;
  end if;
  dedupe := p_rule_key || ':' || p_subject_key;
  perform pg_advisory_xact_lock(hashtextextended('fnb-notify:alert:' || p_tenant_id::text || ':' || dedupe, 0));
  root := app.root_cause_event(p_tenant_id, p_rule_key, p_store_id, p_account_id, p_occurred_at);
  if root is not null then
    update public.alert_events e
    set folded_occurrences = e.folded_occurrences + 1,
        last_seen_at = greatest(e.last_seen_at, p_occurred_at)
    where e.id = root;
    return query select root, 'folded'::text, 0;
    return;
  end if;
  select e.* into existing
  from public.alert_events e
  where e.tenant_id = p_tenant_id
    and e.dedupe_key = dedupe
    and e.state = 'open'
  for update;
  if found then
    update public.alert_events e
    set occurrences = e.occurrences + 1,
        last_seen_at = greatest(e.last_seen_at, p_occurred_at),
        facts = case when app.facts_are_count_only(e.facts || reading_facts) then e.facts || reading_facts else e.facts end
    where e.id = existing.id;
    if effective.remind_every is not null
      and existing.last_notified_at is not null
      and existing.last_notified_at + effective.remind_every <= p_occurred_at
    then
      queued := app.enqueue_alert_messages(existing.id, 'alert_reminder', p_occurred_at);
      update public.alert_events e
      set last_notified_at = p_occurred_at,
          notifications = e.notifications + queued
      where e.id = existing.id;
      return query select existing.id, 'reminded'::text, queued;
      return;
    end if;
    return query select existing.id, 'repeated'::text, 0;
    return;
  end if;
  insert into public.alert_events (
    tenant_id, rule_key, dedupe_key, store_id, pos_account_id, channel_id, business_date, severity, opened_at, last_seen_at, source, facts
  )
  values (
    p_tenant_id, p_rule_key, dedupe, p_store_id, p_account_id, p_channel_id, p_business_date,
    coalesce(p_severity, effective.severity), p_occurred_at, p_occurred_at, p_source, reading_facts
  )
  returning id into created;
  select max(e.last_notified_at) into previous_notice
  from public.alert_events e
  where e.tenant_id = p_tenant_id
    and e.dedupe_key = dedupe
    and e.id <> created;
  if previous_notice is not null and previous_notice + effective.cooldown > p_occurred_at then
    update public.alert_events e
    set suppressed_reason = 'cool_down',
        last_notified_at = previous_notice
    where e.id = created;
  else
    queued := app.enqueue_alert_messages(created, 'alert', p_occurred_at);
    update public.alert_events e
    set last_notified_at = case when queued > 0 then p_occurred_at end,
        notifications = queued,
        suppressed_reason = case when queued = 0 then 'no_destination' end
    where e.id = created;
  end if;
  if coalesce(p_instant, false) then
    update public.alert_events e
    set state = 'resolved',
        resolved_at = p_occurred_at,
        resolution = 'instant'
    where e.id = created;
  end if;
  return query select created, 'opened'::text, queued;
end;
$$;

comment on function app.raise_alert(uuid, text, text, text, timestamptz, uuid, uuid, uuid, date, jsonb, public.alert_severity, boolean) is 'records one reading of an immediate rule as an episode under the dedupe key <rule>:<subject>, serialised by an advisory lock on the key: ignored when the rule is disabled (ignored_disabled); folded into the account''s auth_failed episode when app.root_cause_event finds one (folded); counted on the open episode, with a reminder once remind_every has passed since the last notice (repeated, reminded); otherwise a new episode that opens silently inside the cool-down of the key''s last notice (keeping that notice time) or fans out to its destinations (no_destination when none), resolved at once when p_instant; 22023 for an unknown or digest rule, a malformed subject or facts that are not count-only';

create function app.record_runner_notification(
  p_kind text,
  p_severity text,
  p_tenant_id uuid,
  p_account_id uuid,
  p_store_id uuid,
  p_run_id uuid,
  p_facts jsonb,
  p_occurred_at timestamptz,
  p_source text
)
returns table (event_id uuid, outcome text, messages integer)
language plpgsql
volatile
set search_path = ''
as $$
declare
  account uuid := p_account_id;
  store_row record;
  reading_facts jsonb;
  run_kind text;
  effective record;
  needed integer;
  streak integer;
  threshold integer;
  minutes numeric;
  scope text;
  day date;
  day_start timestamptz;
  day_end timestamptz;
begin
  if p_kind is null or p_kind not in ('auth_failed', 'run_failed', 'sync_stale') then
    raise exception 'record_runner_notification needs the kind auth_failed, run_failed or sync_stale' using errcode = '22023';
  end if;
  if p_severity is not null and p_severity not in ('info', 'warning', 'critical') then
    raise exception 'record_runner_notification needs the severity info, warning or critical' using errcode = '22023';
  end if;
  if p_source is null or p_source not in ('incremental', 'nightly', 'cli', 'scheduler', 'notify', 'actions') then
    raise exception 'record_runner_notification needs the source incremental, nightly or cli' using errcode = '22023';
  end if;
  if p_occurred_at is null or p_tenant_id is null or not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    raise exception 'record_runner_notification needs a tenant and an instant' using errcode = '22023';
  end if;
  if p_store_id is not null then
    select s.id, s.pos_account_id, s.timezone, s.business_day_start_minutes into store_row
    from public.stores s
    where s.id = p_store_id
      and s.tenant_id = p_tenant_id;
    if not found then
      raise exception 'record_runner_notification needs a store of the tenant' using errcode = '22023';
    end if;
    if account is null then
      account := store_row.pos_account_id;
    elsif account <> store_row.pos_account_id then
      raise exception 'record_runner_notification needs the store''s own POS account' using errcode = '22023';
    end if;
  end if;
  if account is not null and not exists (
    select 1 from public.pos_accounts a where a.id = account and a.tenant_id = p_tenant_id
  ) then
    raise exception 'record_runner_notification needs a POS account of the tenant' using errcode = '22023';
  end if;
  select coalesce(jsonb_object_agg(f.key, f.value), '{}'::jsonb) into reading_facts
  from (
    select e.key, e.value
    from jsonb_each(case when jsonb_typeof(p_facts) = 'object' then p_facts else '{}'::jsonb end) as e
    where e.key ~ '^[a-z][a-z0-9_]{0,40}$'
      and (
        jsonb_typeof(e.value) in ('number', 'boolean', 'null')
        or (jsonb_typeof(e.value) = 'string' and (e.value #>> '{}') ~ '^[a-z0-9_:.-]{1,40}$')
      )
    order by e.key
    limit 18
  ) f;

  if p_kind = 'auth_failed' then
    if account is null then
      raise exception 'record_runner_notification needs a POS account for auth_failed' using errcode = '22023';
    end if;
    reading_facts := reading_facts || jsonb_build_object(
      'store_count', (select count(*) from public.stores s where s.pos_account_id = account and s.active)
    );
    return query
      select r.event_id, r.outcome, r.messages
      from app.raise_alert(p_tenant_id, 'auth_failed', 'account:' || account::text, p_source, p_occurred_at,
        null, account, null, null, reading_facts, null, false) r;
    return;
  end if;

  if p_kind = 'run_failed' then
    if p_run_id is not null then
      select r.kind::text into run_kind
      from public.sync_runs r
      where r.id = p_run_id
        and r.tenant_id = p_tenant_id;
      if not found then
        raise exception 'record_runner_notification needs a sync run of the tenant' using errcode = '22023';
      end if;
    end if;
    run_kind := coalesce(
      run_kind,
      reading_facts ->> 'kind',
      case when p_store_id is not null and reading_facts ? 'stage' then 'incremental' end
    );
    if run_kind is null or run_kind not in ('incremental', 'nightly', 'backfill', 'master_data', 'reconciliation') then
      raise exception 'record_runner_notification cannot tell the kind of the failed run' using errcode = '22023';
    end if;
    if run_kind = 'incremental' then
      if p_store_id is null then
        raise exception 'record_runner_notification needs the store of a failed incremental run' using errcode = '22023';
      end if;
      select r.* into effective from app.effective_alert_rule(p_tenant_id, p_store_id, 'sync_failed') r;
      if not coalesce(effective.enabled, false) then
        return query select null::uuid, 'ignored_disabled'::text, 0;
        return;
      end if;
      needed := greatest(coalesce((effective.params ->> 'min_consecutive_incremental')::integer, 2), 1);
      with latest as (
        select r.status, row_number() over (order by r.started_at desc, r.id desc) as position
        from public.sync_runs r
        where r.store_id = p_store_id
          and r.kind = 'incremental'
          and r.status <> 'running'
          and r.started_at <= p_occurred_at
        order by r.started_at desc, r.id desc
        limit 50
      )
      select coalesce(min(l.position) filter (where l.status <> 'failed') - 1, count(*))::integer into streak
      from latest l;
      if streak < needed then
        return query select null::uuid, 'below_threshold'::text, 0;
        return;
      end if;
      reading_facts := reading_facts || jsonb_build_object('kind', 'incremental', 'consecutive_failures', streak);
      return query
        select r.event_id, r.outcome, r.messages
        from app.raise_alert(p_tenant_id, 'sync_failed', 'store:' || p_store_id::text, p_source, p_occurred_at,
          p_store_id, account, null, null, reading_facts, null, false) r;
      return;
    end if;
    if account is null then
      raise exception 'record_runner_notification needs the POS account of a failed window run' using errcode = '22023';
    end if;
    reading_facts := reading_facts || jsonb_build_object('kind', run_kind);
    return query
      select r.event_id, r.outcome, r.messages
      from app.raise_alert(p_tenant_id, 'sync_failed', 'account:' || account::text || ':' || run_kind, p_source, p_occurred_at,
        null, account, null, null, reading_facts, null, false) r;
    return;
  end if;

  if p_store_id is null then
    raise exception 'record_runner_notification needs the store of a sync_stale reading' using errcode = '22023';
  end if;
  select r.* into effective from app.effective_alert_rule(p_tenant_id, p_store_id, 'sync_stale') r;
  if not coalesce(effective.enabled, false) then
    return query select null::uuid, 'ignored_disabled'::text, 0;
    return;
  end if;
  threshold := coalesce((effective.params ->> 'threshold_minutes')::integer, 90);
  if jsonb_typeof(reading_facts -> 'minutes_without_sync') <> 'number' then
    raise exception 'record_runner_notification needs minutes_without_sync for sync_stale' using errcode = '22023';
  end if;
  minutes := (reading_facts ->> 'minutes_without_sync')::numeric;
  if minutes <= threshold then
    return query select null::uuid, 'below_threshold'::text, 0;
    return;
  end if;
  scope := coalesce(reading_facts ->> 'scope', 'now');
  reading_facts := reading_facts || jsonb_build_object('threshold_minutes', threshold, 'scope', scope);
  if scope = 'now' then
    return query
      select r.event_id, r.outcome, r.messages
      from app.raise_alert(p_tenant_id, 'sync_stale', 'store:' || p_store_id::text, p_source, p_occurred_at,
        p_store_id, account, null, null, reading_facts, null, false) r;
    return;
  end if;
  if scope <> 'previous_day' then
    raise exception 'record_runner_notification needs the scope now or previous_day for sync_stale' using errcode = '22023';
  end if;
  begin
    day := to_date(reading_facts ->> 'business_date', 'YYYY-MM-DD');
  exception
    when others then
      day := null;
  end;
  if day is null or to_char(day, 'YYYY-MM-DD') is distinct from reading_facts ->> 'business_date' then
    raise exception 'record_runner_notification needs the business_date of a previous-day reading' using errcode = '22023';
  end if;
  day_start := (day + make_interval(mins => store_row.business_day_start_minutes)) at time zone store_row.timezone;
  day_end := ((day + 1) + make_interval(mins => store_row.business_day_start_minutes)) at time zone store_row.timezone;
  if exists (
    select 1
    from public.alert_events e
    where e.tenant_id = p_tenant_id
      and e.dedupe_key = 'sync_stale:store:' || p_store_id::text
      and e.opened_at < day_end
      and coalesce(e.resolved_at, 'infinity'::timestamptz) > day_start
  ) then
    return query select null::uuid, 'covered'::text, 0;
    return;
  end if;
  return query
    select r.event_id, r.outcome, r.messages
    from app.raise_alert(p_tenant_id, 'sync_stale', 'store_day:' || p_store_id::text || ':' || to_char(day, 'YYYY-MM-DD'), p_source, p_occurred_at,
      p_store_id, account, null, day, reading_facts, null, true) r;
end;
$$;

comment on function app.record_runner_notification(text, text, uuid, uuid, uuid, uuid, jsonb, timestamptz, text) is 'the phase 7 Notifier mapping (OutboxNotifier): checks that the store and the account belong to the tenant (22023), keeps only count-only facts, and raises auth_failed on account:<id>; run_failed of an incremental run as sync_failed on store:<id> once the store''s latest min_consecutive_incremental incremental runs all failed (below_threshold before), of a window run as sync_failed on account:<id>:<kind>; sync_stale over the tenant''s threshold as sync_stale on store:<id> (scope now) or, for the nightly''s previous-day reading, as an instant store_day:<id>:<date> episode unless a store:<id> episode overlapped that business day (covered); the runner''s label, message and severity are not stored';

create function app.reconcile_alerts(p_at timestamptz default now(), p_tenant_id uuid default null)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  schedule_enabled boolean;
  schedule_changed_at timestamptz;
  episode record;
  effective record;
  resolution_value text;
  threshold integer;
  queued integer;
  changed integer := 0;
begin
  select s.enabled, s.updated_at into schedule_enabled, schedule_changed_at
  from app.incremental_sync_settings s;
  for episode in
    select e.*
    from public.alert_events e
    where e.state = 'open'
      and (p_tenant_id is null or e.tenant_id = p_tenant_id)
    order by e.opened_at, e.id
    for update of e skip locked
  loop
    select r.* into effective from app.effective_alert_rule(episode.tenant_id, episode.store_id, episode.rule_key) r;
    resolution_value := null;
    if episode.rule_key = 'auth_failed' then
      if not exists (
        select 1 from public.pos_accounts a where a.id = episode.pos_account_id and a.status = 'auth_failed'
      ) then
        resolution_value := 'recovered';
      end if;
    elsif episode.rule_key = 'sync_failed' then
      if split_part(episode.dedupe_key, ':', 2) = 'store' then
        if exists (
          select 1
          from public.stores s
          join public.sync_runs r on r.pos_account_id = s.pos_account_id
          where s.id = episode.store_id
            and r.status = 'succeeded'
            and r.kind <> 'master_data'
            and r.started_at > episode.opened_at
            and r.started_at <= p_at
            and app.sync_run_covers_store(r.store_id, r.store_ids, s.id)
        ) then
          resolution_value := 'recovered';
        end if;
      elsif exists (
        select 1
        from public.sync_runs r
        where r.pos_account_id = episode.pos_account_id
          and r.kind::text = split_part(episode.dedupe_key, ':', 4)
          and r.status = 'succeeded'
          and r.started_at > episode.opened_at
          and r.started_at <= p_at
      ) then
        resolution_value := 'recovered';
      end if;
    elsif episode.rule_key = 'sync_stale' then
      threshold := coalesce((effective.params ->> 'threshold_minutes')::integer, 90);
      if not coalesce(schedule_enabled, false) and schedule_changed_at >= episode.opened_at then
        resolution_value := 'schedule_disabled';
      elsif not exists (
          select 1
          from app.sync_alerts a
          where a.store_id = episode.store_id
            and a.kind = 'sync_stale'
            and a.resolved_at is null
            and a.last_seen_at > coalesce(app.last_successful_sync(episode.store_id, p_at), '-infinity'::timestamptz)
        )
        and coalesce(app.sync_gap_minutes(episode.store_id, p_at), 0) <= threshold
      then
        resolution_value := 'recovered';
      end if;
    elsif episode.rule_key = 'sync_dispatch_failed' then
      if not exists (
        select 1
        from app.sync_alerts a
        where a.store_id = episode.store_id
          and a.kind = 'dispatch_failed'
          and a.resolved_at is null
      ) then
        resolution_value := 'cleared';
      end if;
    elsif episode.rule_key = 'zero_sales_open' then
      if exists (
        select 1
        from public.invoices i
        where i.store_id = episode.store_id
          and i.business_date = episode.business_date
          and i.status <> 'voided'
      ) then
        resolution_value := 'cleared';
      elsif exists (
        select 1
        from public.stores s
        where s.id = episode.store_id
          and p_at >= ((episode.business_date + 1) + make_interval(mins => s.business_day_start_minutes)) at time zone s.timezone
      ) then
        resolution_value := 'day_ended';
      end if;
    elsif episode.rule_key = 'nightly_missing' then
      if exists (
        select 1
        from public.sync_runs r
        where r.tenant_id = episode.tenant_id
          and r.kind = 'nightly'
          and r.status = 'succeeded'
          and r.finished_at > episode.opened_at
          and r.finished_at <= p_at
      ) then
        resolution_value := 'recovered';
      end if;
    elsif episode.rule_key = 'digest_failed' then
      if exists (
        select 1
        from public.digests d
        where d.tenant_id = episode.tenant_id
          and d.business_date = episode.business_date
          and d.scope_key = split_part(episode.dedupe_key, ':', 3)
          and d.state = 'built'
      ) then
        resolution_value := 'cleared';
      end if;
    elsif episode.rule_key = 'channel_failed' then
      if exists (
        select 1
        from public.outbound_messages o
        where o.channel_id = episode.channel_id
          and o.status in ('sent', 'delivered')
          and o.sent_at > episode.opened_at
          and o.sent_at <= p_at
      ) then
        resolution_value := 'recovered';
      end if;
    end if;

    if resolution_value is not null then
      update public.alert_events e
      set state = 'resolved',
          resolved_at = p_at,
          resolution = resolution_value
      where e.id = episode.id;
      queued := 0;
      if coalesce(effective.notify_on_resolve, false) and resolution_value in ('recovered', 'cleared') then
        queued := app.enqueue_alert_messages(episode.id, 'alert_resolved', p_at);
        if queued > 0 then
          update public.alert_events e set notifications = e.notifications + queued where e.id = episode.id;
        end if;
      end if;
      changed := changed + 1;
    elsif coalesce(effective.enabled, false)
      and effective.remind_every is not null
      and episode.last_notified_at is not null
      and episode.last_notified_at + effective.remind_every <= p_at
      and app.root_cause_event(episode.tenant_id, episode.rule_key, episode.store_id, episode.pos_account_id, p_at) is null
    then
      queued := app.enqueue_alert_messages(episode.id, 'alert_reminder', p_at);
      update public.alert_events e
      set last_notified_at = p_at,
          notifications = e.notifications + queued
      where e.id = episode.id;
      changed := changed + 1;
    end if;
  end loop;
  return changed;
end;
$$;

comment on function app.reconcile_alerts(timestamptz, uuid) is 'the first step of the tick''s rules: resolves open episodes whose condition cleared (auth_failed when the account is no longer auth_failed; sync_failed after a succeeded run of the store, or of the account and kind, started after the opening; sync_stale when no open sync_alerts row newer than the last successful sync remains and the gap is within the threshold, or as schedule_disabled when the incremental schedule was switched off after the opening; sync_dispatch_failed when its sync_alerts row resolved; zero_sales_open at a sale or the end of the business day; nightly_missing at a succeeded nightly; digest_failed once the digest is built; channel_failed at a later sent message on the destination), enqueues the resolution notice of a rule with notify_on_resolve to each destination whose opening message was delivered, and sends the reminder of a still open episode once remind_every has passed since its last notice unless a root cause is open; returns the number of episodes resolved or reminded';

create function app.import_sync_alerts(p_at timestamptz default now(), p_tenant_id uuid default null)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  alert record;
  current_event public.alert_events%rowtype;
  threshold integer;
  imported integer := 0;
begin
  for alert in
    select a.id, a.tenant_id, a.store_id, a.kind, a.last_seen_at, a.occurrences, a.minutes, a.http_status, s.pos_account_id
    from app.sync_alerts a
    join public.stores s on s.id = a.store_id
    where a.resolved_at is null
      and (p_tenant_id is null or a.tenant_id = p_tenant_id)
      and app.tenant_has_destinations(a.tenant_id)
    order by a.id
  loop
    select e.* into current_event
    from public.alert_events e
    where e.tenant_id = alert.tenant_id
      and e.state = 'open'
      and e.dedupe_key = (case alert.kind when 'sync_stale' then 'sync_stale' else 'sync_dispatch_failed' end) || ':store:' || alert.store_id::text;
    continue when found and current_event.last_seen_at >= alert.last_seen_at;
    if alert.kind = 'sync_stale' then
      select coalesce((r.params ->> 'threshold_minutes')::integer, 90) into threshold
      from app.effective_alert_rule(alert.tenant_id, alert.store_id, 'sync_stale') r;
      continue when coalesce(alert.minutes, 0) <= threshold;
      continue when coalesce(app.last_successful_sync(alert.store_id, p_at) > alert.last_seen_at, false);
      continue when coalesce(app.sync_gap_minutes(alert.store_id, p_at), 0) <= threshold;
      perform app.raise_alert(alert.tenant_id, 'sync_stale', 'store:' || alert.store_id::text, 'scheduler', alert.last_seen_at,
        alert.store_id, alert.pos_account_id, null, null,
        jsonb_build_object('minutes_without_sync', alert.minutes, 'threshold_minutes', threshold, 'scope', 'now', 'sync_alert_occurrences', alert.occurrences));
    else
      select coalesce((r.params ->> 'min_occurrences')::integer, 2) into threshold
      from app.effective_alert_rule(alert.tenant_id, alert.store_id, 'sync_dispatch_failed') r;
      continue when alert.occurrences < threshold;
      perform app.raise_alert(alert.tenant_id, 'sync_dispatch_failed', 'store:' || alert.store_id::text, 'scheduler', alert.last_seen_at,
        alert.store_id, alert.pos_account_id, null, null,
        jsonb_build_object('sync_alert_occurrences', alert.occurrences, 'http_status', alert.http_status));
    end if;
    update app.sync_alerts a set notified_at = coalesce(a.notified_at, p_at) where a.id = alert.id;
    imported := imported + 1;
  end loop;
  return imported;
end;
$$;

comment on function app.import_sync_alerts(timestamptz, uuid) is 'imports phase 7''s open app.sync_alerts rows for tenants with destinations: a sync_stale row over the tenant''s threshold becomes a reading of sync_stale:store:<id> (the key the runners use, so both views share one episode) unless a successful sync ended after its reading or the gap at p_at is back within the threshold; a dispatch_failed row with at least min_occurrences becomes sync_dispatch_failed:store:<id>; a row whose reading the open episode already saw is skipped; sets notified_at on the rows it raised and returns their count; the row''s error text is never read';

create function app.evaluate_channel_health(p_at timestamptz, p_tenant_id uuid default null)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  destination record;
  raised record;
  counted integer := 0;
begin
  for destination in
    select c.id, c.tenant_id, c.kind, c.last_error_code, c.last_error_at
    from public.notification_channels c
    where (c.status = 'failing' or (c.status = 'disabled' and c.disabled_reason = 'blocked_by_user'))
      and (p_tenant_id is null or c.tenant_id = p_tenant_id)
      and not exists (
        select 1
        from public.alert_events e
        where e.tenant_id = c.tenant_id
          and e.dedupe_key = 'channel_failed:channel:' || c.id::text
          and (e.state = 'open' or e.opened_at >= coalesce(c.last_error_at, '-infinity'::timestamptz))
      )
    order by c.tenant_id, c.created_at, c.id
  loop
    select r.* into raised
    from app.raise_alert(destination.tenant_id, 'channel_failed', 'channel:' || destination.id::text, 'notify', p_at,
      null, null, destination.id, null,
      jsonb_build_object('channel_kind', destination.kind::text, 'error_code', destination.last_error_code)) r;
    if raised.outcome <> 'ignored_disabled' then
      counted := counted + 1;
    end if;
  end loop;
  return counted;
end;
$$;

comment on function app.evaluate_channel_health(timestamptz, uuid) is 'raises channel_failed once per failure of a destination: for every destination app.finish_send turned failing, or disabled as blocked_by_user, without an open channel_failed episode and without one opened since its last error; the alert goes to the member''s other destinations and to the owners''; returns the number raised';

create function app.record_job_event(
  p_workflow_key text,
  p_conclusion text,
  p_run_id bigint,
  p_run_attempt integer,
  p_started_at timestamptz,
  p_at timestamptz,
  p_tenant_id uuid default null
)
returns table (tenant_id uuid, outcome text, messages integer)
language plpgsql
volatile
set search_path = ''
as $$
declare
  target record;
  raised record;
  reading_facts jsonb;
  since timestamptz;
begin
  if p_workflow_key is null or p_workflow_key not in ('sync', 'backup', 'migrate', 'deploy_web', 'deploy_functions', 'notify', 'workflows_active', 'other') then
    raise exception 'record_job_event needs a workflow key of sync, backup, migrate, deploy_web, deploy_functions, notify, workflows_active or other' using errcode = '22023';
  end if;
  if p_conclusion is null or p_conclusion not in ('failure', 'timed_out', 'startup_failure') then
    raise exception 'record_job_event needs the conclusion failure, timed_out or startup_failure' using errcode = '22023';
  end if;
  if p_at is null then
    raise exception 'record_job_event needs an instant' using errcode = '22023';
  end if;
  reading_facts := jsonb_build_object('workflow', p_workflow_key, 'conclusion', p_conclusion, 'run_attempt', p_run_attempt);
  since := coalesce(p_started_at, p_at);
  for target in
    select t.id
    from public.tenants t
    where (p_tenant_id is null or t.id = p_tenant_id)
      and exists (
        select 1 from app.effective_alert_rule(t.id, null, 'job_failed') r where r.enabled
      )
      and exists (
        select 1 from app.alert_destinations(t.id, null, null, 'job_failed') d
      )
    order by t.id
  loop
    if p_workflow_key = 'sync' and exists (
      select 1
      from public.alert_events e
      where e.tenant_id = target.id
        and (
          (e.rule_key = 'auth_failed' and e.state = 'open')
          or (e.rule_key in ('sync_failed', 'sync_stale') and (e.opened_at >= since or e.last_seen_at >= since))
        )
    ) then
      insert into public.alert_events (
        tenant_id, rule_key, dedupe_key, severity, state, opened_at, last_seen_at, resolved_at, resolution, suppressed_reason, source, facts
      )
      select target.id, 'job_failed', 'job_failed:workflow:sync', r.severity, 'resolved', p_at, p_at, p_at, 'instant', 'root_cause_open', 'actions', reading_facts
      from app.effective_alert_rule(target.id, null, 'job_failed') r;
      return query select target.id, 'root_cause_open'::text, 0;
    else
      select r.* into raised
      from app.raise_alert(target.id, 'job_failed', 'workflow:' || p_workflow_key, 'actions', p_at,
        null, null, null, null, reading_facts,
        case when p_workflow_key = 'migrate' then 'critical'::public.alert_severity end, true) r;
      return query select target.id, raised.outcome, raised.messages;
    end if;
  end loop;
end;
$$;

comment on function app.record_job_event(text, text, bigint, integer, timestamptz, timestamptz, uuid) is 'records a failed GitHub Actions run for every tenant (or only p_tenant_id) with a destination that receives job_failed: for the sync workflow while an auth_failed episode is open, or a sync_failed or sync_stale episode was opened or seen since the run started, an instant episode with suppressed_reason root_cause_open and no message; otherwise an instant job_failed episode on workflow:<key> (critical for migrate) under the 12-hour cool-down; the run id and URL are not stored; returns one row per tenant';

create function app.store_day_close_at(p_store_id uuid, p_date date)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  with s as (
    select
      st.opening_hours,
      st.timezone,
      st.business_day_start_minutes,
      (p_date + make_interval(mins => st.business_day_start_minutes)) at time zone st.timezone as day_start,
      ((p_date + 1) + make_interval(mins => st.business_day_start_minutes)) at time zone st.timezone as day_end
    from public.stores st
    where st.id = p_store_id
  )
  select case
    when not app.opening_hours_known(s.opening_hours) then s.day_end
    else coalesce(
      (
        select max(sp.closes_at)
        from app.opening_spans(s.opening_hours, s.timezone, s.business_day_start_minutes, s.day_start, s.day_end) sp
        where sp.opens_at >= s.day_start
          and sp.opens_at < s.day_end
      ),
      s.day_start
    )
  end
  from s;
$$;

comment on function app.store_day_close_at(uuid, date) is 'when the store closes business day D: the end of the last opening span that opens within D''s business day, the end of the business day when the opening hours are unknown, and the start of the business day on a scheduled closed day';

create function app.store_day_shift_state(p_store_id uuid, p_date date)
returns table (open_shifts integer, last_closed_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select
    (count(*) filter (where sh.closed_at is null))::integer,
    max(sh.closed_at)
  from public.stores st
  join public.shifts sh
    on sh.store_id = st.id
   and sh.opened_at >= (p_date + make_interval(mins => st.business_day_start_minutes)) at time zone st.timezone
   and sh.opened_at < ((p_date + 1) + make_interval(mins => st.business_day_start_minutes)) at time zone st.timezone
  where st.id = p_store_id;
$$;

comment on function app.store_day_shift_state(uuid, date) is 'the shifts of business day D (opened within its business day): how many are still open and when the last one closed';

create function app.store_day_settled_at(p_store_id uuid, p_date date, p_grace interval default interval '30 minutes')
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when app.opening_hours_known(s.opening_hours) and app.opening_minutes(s.opening_hours, p_date) = 0
      then app.store_day_close_at(s.id, p_date)
    when sh.open_shifts > 0 then null
    else (
      select min(r.finished_at)
      from public.sync_runs r
      where r.pos_account_id = s.pos_account_id
        and r.status = 'succeeded'
        and r.kind <> 'master_data'
        and r.started_at >= greatest(app.store_day_close_at(s.id, p_date), coalesce(sh.last_closed_at, '-infinity'::timestamptz)) + coalesce(p_grace, interval '30 minutes')
        and r.range_start <= p_date
        and r.range_end >= p_date
        and app.sync_run_covers_store(r.store_id, r.store_ids, s.id)
    )
  end
  from public.stores s
  cross join lateral app.store_day_shift_state(s.id, p_date) sh
  where s.id = p_store_id;
$$;

comment on function app.store_day_settled_at(uuid, date, interval) is 'when the store settled business day D: the end of the first successful sales run covering the store and D that started at least p_grace after the later of the store''s close of D and the last shift close of D; null while a shift of D is open or no such run exists; a scheduled closed day is settled at its start';

create index outbound_messages_channel_digest_date_idx
  on public.outbound_messages (channel_id, business_date)
  where kind in ('digest', 'digest_correction') and channel_id is not null;

comment on index public.outbound_messages_channel_digest_date_idx is 'the digest and correction messages of a destination by business date, so app.due_digests finds at every tick which destinations already had a date''s digest';

create function app.due_digests(p_at timestamptz, p_tenant_id uuid default null)
returns table (
  tenant_id uuid,
  business_date date,
  scope_key text,
  store_ids uuid[],
  all_stores boolean,
  trigger text,
  due_at timestamptz,
  run_as uuid,
  channel_ids uuid[],
  store_facts jsonb
)
language sql
stable
set search_path = ''
as $$
  with digest_rule as (
    select t.id as tenant_id, r.roles, r.params
    from public.tenants t
    cross join lateral app.effective_alert_rule(t.id, null, 'daily_digest') r
    where (p_tenant_id is null or t.id = p_tenant_id)
      and r.enabled
      and exists (
        select 1
        from public.notification_channels x
        where x.tenant_id = t.id
          and x.user_id is not null
          and x.kind <> 'webhook'
          and x.enabled
          and x.status in ('active', 'failing')
      )
  ),
  destinations as (
    select
      c.id as channel_id,
      c.tenant_id,
      c.user_id,
      c.linked_at,
      c.store_ids as channel_store_ids,
      m.store_ids as member_store_ids,
      dr.params
    from digest_rule dr
    join public.notification_channels c on c.tenant_id = dr.tenant_id
    join public.tenant_members m on m.tenant_id = c.tenant_id and m.user_id = c.user_id
    where c.user_id is not null
      and c.kind <> 'webhook'
      and c.enabled
      and c.status in ('active', 'failing')
      and not ('daily_digest' = any (c.muted_rules))
      and m.role = any (dr.roles)
  ),
  scoped as (
    select d.*, sc.ids, sc.today, sc.link_date
    from destinations d
    cross join lateral (
      select
        array_agg(s.id order by s.id::text) as ids,
        min(((p_at at time zone s.timezone) - make_interval(mins => s.business_day_start_minutes))::date) as today,
        min(((coalesce(d.linked_at, p_at) at time zone s.timezone) - make_interval(mins => s.business_day_start_minutes))::date) as link_date
      from public.stores s
      where s.tenant_id = d.tenant_id
        and s.active
        and (d.member_store_ids is null or s.id = any (d.member_store_ids))
        and (d.channel_store_ids is null or s.id = any (d.channel_store_ids))
    ) sc
    where sc.ids is not null
  ),
  candidates as (
    select sd.*, cd.business_date
    from scoped sd
    cross join lateral (values (sd.today), (sd.today - 1)) as cd (business_date)
    where cd.business_date >= sd.link_date - 1
      and not exists (
        select 1
        from public.outbound_messages o
        where o.channel_id = sd.channel_id
          and o.kind in ('digest', 'digest_correction')
          and o.business_date = cd.business_date
          and o.status <> 'cancelled'
      )
  ),
  scope_groups as (
    select
      c.tenant_id,
      c.business_date,
      md5(array_to_string(c.ids, ',')) as scope_key,
      c.ids as store_ids,
      bool_and(c.channel_store_ids is null) as all_stores,
      (array_agg(c.user_id order by c.user_id::text))[1] as run_as,
      array_agg(c.channel_id order by c.channel_id::text) as channel_ids,
      (array_agg(c.params))[1] as params
    from candidates c
    group by c.tenant_id, c.business_date, c.ids
  ),
  store_days as (
    select
      g.tenant_id,
      g.business_date,
      g.scope_key,
      s.id as store_id,
      case when app.opening_hours_known(s.opening_hours) then app.opening_minutes(s.opening_hours, g.business_date) end as opening_minutes,
      app.store_day_close_at(s.id, g.business_date) as close_at,
      sh.open_shifts,
      sh.last_closed_at,
      app.store_day_settled_at(
        s.id,
        g.business_date,
        make_interval(mins => coalesce((g.params ->> 'settle_grace_minutes')::integer, 30))
      ) as settled_raw,
      ((g.business_date + 1) + make_interval(mins => s.business_day_start_minutes)) at time zone s.timezone as day_end,
      greatest(
        ((g.business_date + 1) + make_interval(mins => s.business_day_start_minutes)) at time zone s.timezone,
        ((g.business_date + 1) + coalesce((g.params ->> 'deadline_local')::time, time '06:30')) at time zone s.timezone
      ) as deadline
    from scope_groups g
    join public.stores s on s.id = any (g.store_ids)
    cross join lateral app.store_day_shift_state(s.id, g.business_date) sh
  ),
  store_states as (
    select
      sd.*,
      case when sd.settled_raw <= p_at then sd.settled_raw end as settled_at
    from store_days sd
  ),
  evaluated as (
    select
      g.tenant_id,
      g.business_date,
      g.scope_key,
      g.store_ids,
      g.all_stores,
      g.run_as,
      g.channel_ids,
      g.params,
      bool_and(ss.settled_at is not null) as all_settled,
      bool_and(ss.settled_at is not null or ss.deadline <= p_at) as past_deadline,
      bool_and(coalesce(ss.opening_minutes = 0, false)) as all_closed,
      max(ss.settled_at) as last_settled,
      max(ss.deadline) filter (where ss.settled_at is null) as last_deadline,
      jsonb_agg(
        jsonb_build_object(
          'store_id', ss.store_id,
          'opening_minutes', ss.opening_minutes,
          'close_at', ss.close_at,
          'last_shift_closed_at', ss.last_closed_at,
          'open_shifts', ss.open_shifts,
          'settled_at', ss.settled_at,
          'day_ended', p_at >= ss.day_end
        )
        order by ss.store_id::text
      ) as store_facts,
      exists (
        select 1
        from public.sync_checks k
        where k.store_id = any (g.store_ids)
          and k.business_date <= g.business_date
      ) as has_history
    from scope_groups g
    join store_states ss
      on ss.tenant_id = g.tenant_id
     and ss.business_date = g.business_date
     and ss.scope_key = g.scope_key
    group by g.tenant_id, g.business_date, g.scope_key, g.store_ids, g.all_stores, g.run_as, g.channel_ids, g.params
  ),
  classified as (
    select
      e.*,
      case
        when d.state = 'built' then 'built'
        when d.state = 'failed' and (d.attempts >= 5 or d.next_attempt_at > p_at) then 'waiting'
        when not e.has_history then 'skipped'
        when coalesce((e.params ->> 'skip_closed_days')::boolean, true) and e.all_closed then 'skipped'
        when e.all_settled then 'settled'
        when e.past_deadline then 'deadline'
        else 'pending'
      end as status
    from evaluated e
    left join public.digests d
      on d.tenant_id = e.tenant_id
     and d.business_date = e.business_date
     and d.scope_key = e.scope_key
  ),
  newest as (
    select
      c.*,
      row_number() over (partition by c.tenant_id, c.scope_key order by c.business_date desc) as position
    from classified c
    where c.status in ('built', 'waiting', 'settled', 'deadline')
  )
  select
    n.tenant_id,
    n.business_date,
    n.scope_key,
    n.store_ids,
    n.all_stores,
    n.status,
    case when n.status = 'settled' then n.last_settled else greatest(n.last_settled, n.last_deadline) end,
    n.run_as,
    n.channel_ids,
    n.store_facts
  from newest n
  where n.position = 1
    and n.status in ('settled', 'deadline')
  order by n.tenant_id, n.business_date, n.scope_key;
$$;

comment on function app.due_digests(timestamptz, uuid) is 'the digests due at p_at, one row per tenant, business date and scope: destinations (active or failing, enabled, of a member whose role the daily_digest rule names, not muting it, never a webhook) grouped by scope (the member''s visible active stores narrowed by the destination''s store_ids) for the dates today and yesterday of the scope''s earliest store, never before the day before the earliest link, leaving out a destination that already has a digest message for that date; due when every store settled D (trigger settled) or every unsettled store passed the later of its business-day end and deadline_local on D + 1 (trigger deadline); skipped when built, when a failed build waits or gave up, without sync history, or when every store is scheduled closed; only the newest due date per scope, and none older than a date already built or waiting; store_facts holds per store opening_minutes, close_at, last_shift_closed_at, open_shifts, settled_at and day_ended';

create function app.digest_scope_check(p_tenant_id uuid, p_scope_key text, p_store_ids uuid[])
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_tenant_id is null or p_store_ids is null or cardinality(p_store_ids) not between 1 and 50 or array_position(p_store_ids, null) is not null then
    raise exception 'a digest needs a tenant and 1 to 50 store ids' using errcode = '22023';
  end if;
  if (select count(distinct x.id) from unnest(p_store_ids) as x (id)) <> cardinality(p_store_ids) then
    raise exception 'a digest''s store ids must be distinct' using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(p_store_ids) as x (id)
    where not exists (select 1 from public.stores s where s.id = x.id and s.tenant_id = p_tenant_id)
  ) then
    raise exception 'a digest''s stores must belong to its tenant' using errcode = '22023';
  end if;
  if p_scope_key is distinct from md5((select string_agg(x.id::text, ',' order by x.id::text) from unnest(p_store_ids) as x (id))) then
    raise exception 'a digest''s scope_key must be the md5 of its sorted store ids joined by commas' using errcode = '22023';
  end if;
end;
$$;

comment on function app.digest_scope_check(uuid, text, uuid[]) is 'raises 22023 unless the store ids are 1 to 50 distinct stores of the tenant and the scope key is the md5 of their sorted ids joined by commas';

create function app.complete_digest(
  p_tenant_id uuid,
  p_business_date date,
  p_scope_key text,
  p_store_ids uuid[],
  p_all_stores boolean,
  p_trigger text,
  p_data_state text,
  p_model jsonb,
  p_model_version integer,
  p_fingerprint text,
  p_built_as uuid,
  p_at timestamptz
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  sorted uuid[];
  completed uuid;
begin
  perform app.digest_scope_check(p_tenant_id, p_scope_key, p_store_ids);
  if p_business_date is null or p_at is null or p_all_stores is null then
    raise exception 'complete_digest needs a business date, an instant and all_stores' using errcode = '22023';
  end if;
  if p_trigger is null or p_trigger not in ('settled', 'deadline', 'manual') then
    raise exception 'complete_digest needs the trigger settled, deadline or manual' using errcode = '22023';
  end if;
  if p_data_state is null or p_data_state not in ('verified', 'unverified', 'unmatched', 'partial', 'no_data') then
    raise exception 'complete_digest needs the data state verified, unverified, unmatched, partial or no_data' using errcode = '22023';
  end if;
  if p_model is null or jsonb_typeof(p_model) <> 'object' or p_model_version is null or p_model_version not between 1 and 32767 then
    raise exception 'complete_digest needs a model object and its version' using errcode = '22023';
  end if;
  if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'complete_digest needs a SHA-256 hex fingerprint' using errcode = '22023';
  end if;
  if p_built_as is not null and not exists (
    select 1 from public.tenant_members m where m.tenant_id = p_tenant_id and m.user_id = p_built_as
  ) then
    raise exception 'complete_digest needs a member of the tenant as the builder' using errcode = '22023';
  end if;
  select array_agg(x.id order by x.id::text) into sorted from unnest(p_store_ids) as x (id);
  perform pg_advisory_xact_lock(hashtextextended('fnb-notify:digest:' || p_tenant_id::text || ':' || p_scope_key || ':' || to_char(p_business_date, 'YYYY-MM-DD'), 0));
  insert into public.digests as d (
    tenant_id, business_date, scope_key, store_ids, all_stores, state, trigger, data_state, model, model_version, fingerprint, built_as, built_at
  )
  values (
    p_tenant_id, p_business_date, p_scope_key, sorted, p_all_stores, 'built', p_trigger, p_data_state, p_model, p_model_version, p_fingerprint, p_built_as, p_at
  )
  on conflict on constraint digests_tenant_id_business_date_scope_key_key do update
  set store_ids = excluded.store_ids,
      all_stores = excluded.all_stores,
      state = 'built',
      trigger = excluded.trigger,
      data_state = excluded.data_state,
      model = excluded.model,
      model_version = excluded.model_version,
      fingerprint = excluded.fingerprint,
      built_as = excluded.built_as,
      built_at = excluded.built_at,
      next_attempt_at = null,
      last_error_code = null
  where d.state = 'failed'
  returning d.id into completed;
  return completed;
end;
$$;

comment on function app.complete_digest(uuid, date, text, uuid[], boolean, text, text, jsonb, integer, text, uuid, timestamptz) is 'stores a built digest under the advisory lock fnb-notify:digest:<tenant>:<scope_key>:<date>: inserts it, or turns a failed row into the built one, and returns its id; returns null when the digest was already built (another builder won, and the caller stops); 22023 for a scope key that is not the md5 of the sorted store ids, stores of another tenant, an unknown trigger or data state, a model that is not an object, a malformed fingerprint or a builder who is not a member';

create function app.enqueue_digest_message(
  p_digest_id uuid,
  p_channel_id uuid,
  p_revision integer,
  p_kind text,
  p_title text,
  p_body text,
  p_at timestamptz
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  digest public.digests%rowtype;
  digest_severity public.alert_severity;
begin
  if p_kind is null or p_kind not in ('digest', 'digest_correction') then
    raise exception 'enqueue_digest_message needs the kind digest or digest_correction' using errcode = '22023';
  end if;
  if p_revision is null or (p_kind = 'digest' and p_revision <> 0) or (p_kind = 'digest_correction' and p_revision <> 1) then
    raise exception 'enqueue_digest_message needs revision 0 for a digest and 1 for its correction' using errcode = '22023';
  end if;
  if p_body is null or p_at is null then
    raise exception 'enqueue_digest_message needs the rendered body and an instant' using errcode = '22023';
  end if;
  select d.* into digest from public.digests d where d.id = p_digest_id;
  if not found or digest.state <> 'built' then
    raise exception 'enqueue_digest_message needs a built digest' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.notification_channels c where c.id = p_channel_id and c.tenant_id = digest.tenant_id
  ) then
    raise exception 'enqueue_digest_message needs a destination of the digest''s tenant' using errcode = '22023';
  end if;
  select r.severity into digest_severity from app.effective_alert_rule(digest.tenant_id, null, 'daily_digest') r;
  return app.enqueue_message(
    digest.tenant_id,
    p_channel_id,
    p_kind,
    p_kind || '.v1',
    'digest:' || digest.id::text || ':' || p_channel_id::text || ':r' || p_revision::text,
    jsonb_build_object('revision', p_revision, 'store_count', cardinality(digest.store_ids)),
    p_title,
    p_body,
    digest_severity,
    case when cardinality(digest.store_ids) = 1 then digest.store_ids[1] end,
    digest.business_date,
    digest.id,
    null,
    p_at + case when p_kind = 'digest' then interval '36 hours' else interval '24 hours' end,
    p_at
  );
end;
$$;

comment on function app.enqueue_digest_message(uuid, uuid, integer, text, text, text, timestamptz) is 'enqueues the pre-rendered digest (revision 0) or correction (revision 1) of a built digest for one destination of its tenant: dedupe key digest:<digest>:<destination>:r<revision>, template digest.v1 or digest_correction.v1, the store of a one-store scope, expiring after 36 hours (a correction after 24); a repeat returns the first message''s id';

create function app.fail_digest(
  p_tenant_id uuid,
  p_business_date date,
  p_scope_key text,
  p_store_ids uuid[],
  p_error_code text,
  p_at timestamptz
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  code text := case when p_error_code ~ '^[a-z0-9_]{1,40}$' then p_error_code else 'build_failed' end;
  sorted uuid[];
  failed_id uuid;
  failed_attempts integer;
begin
  perform app.digest_scope_check(p_tenant_id, p_scope_key, p_store_ids);
  if p_business_date is null or p_at is null then
    raise exception 'fail_digest needs a business date and an instant' using errcode = '22023';
  end if;
  select array_agg(x.id order by x.id::text) into sorted from unnest(p_store_ids) as x (id);
  perform pg_advisory_xact_lock(hashtextextended('fnb-notify:digest:' || p_tenant_id::text || ':' || p_scope_key || ':' || to_char(p_business_date, 'YYYY-MM-DD'), 0));
  insert into public.digests as d (
    tenant_id, business_date, scope_key, store_ids, all_stores, state, attempts, next_attempt_at, last_error_code
  )
  values (
    p_tenant_id, p_business_date, p_scope_key, sorted, false, 'failed', 1, p_at + interval '5 minutes', code
  )
  on conflict on constraint digests_tenant_id_business_date_scope_key_key do update
  set attempts = least(d.attempts + 1, 10),
      next_attempt_at = p_at + case least(d.attempts + 1, 10)
        when 1 then interval '5 minutes'
        when 2 then interval '15 minutes'
        when 3 then interval '60 minutes'
        when 4 then interval '120 minutes'
      end,
      last_error_code = excluded.last_error_code
  where d.state = 'failed'
  returning d.id, d.attempts into failed_id, failed_attempts;
  if failed_id is null then
    return null;
  end if;
  if failed_attempts = 5 then
    perform app.raise_alert(p_tenant_id, 'digest_failed', 'digest:' || p_scope_key || ':' || to_char(p_business_date, 'YYYY-MM-DD'), 'notify', p_at,
      null, null, null, p_business_date,
      jsonb_build_object('attempts', failed_attempts, 'scope_key', p_scope_key, 'store_count', cardinality(p_store_ids)));
  end if;
  return failed_id;
end;
$$;

comment on function app.fail_digest(uuid, date, text, uuid[], text, timestamptz) is 'records a failed build under the digest''s advisory lock: a failed row with attempts + 1, last_error_code (build_failed when the code is not a short token) and the next attempt after 5, 15, 60 and 120 minutes; the fifth failure raises digest_failed and stops the retries until a manual build; returns the row''s id, or null when the digest was already built';

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
begin
  reconciled := app.reconcile_alerts(p_at, p_tenant_id);
  imported := app.import_sync_alerts(p_at, p_tenant_id);
  channel_failures := app.evaluate_channel_health(p_at, p_tenant_id);
  select count(*)::integer into due from app.due_digests(p_at, p_tenant_id);
  return jsonb_build_object(
    'reconciled', reconciled,
    'imported', imported,
    'channel_failed', channel_failures,
    'due_digests', due
  );
end;
$$;

comment on function app.notify_tick_rules(timestamptz, uuid) is 'the rules half of the notify tick, the one hook later migrations replace with create or replace; second form: app.reconcile_alerts, then app.import_sync_alerts, then app.evaluate_channel_health, then the count of app.due_digests, returned as the count-only object {reconciled, imported, channel_failed, due_digests}';

revoke all on function app.root_cause_event(uuid, text, uuid, uuid, timestamptz) from public;
revoke all on function app.alert_destinations(uuid, uuid, uuid, text, uuid) from public;
revoke all on function app.enqueue_alert_messages(uuid, text, timestamptz) from public;
revoke all on function app.raise_alert(uuid, text, text, text, timestamptz, uuid, uuid, uuid, date, jsonb, public.alert_severity, boolean) from public;
revoke all on function app.record_runner_notification(text, text, uuid, uuid, uuid, uuid, jsonb, timestamptz, text) from public;
revoke all on function app.reconcile_alerts(timestamptz, uuid) from public;
revoke all on function app.import_sync_alerts(timestamptz, uuid) from public;
revoke all on function app.evaluate_channel_health(timestamptz, uuid) from public;
revoke all on function app.record_job_event(text, text, bigint, integer, timestamptz, timestamptz, uuid) from public;
revoke all on function app.store_day_close_at(uuid, date) from public;
revoke all on function app.store_day_shift_state(uuid, date) from public;
revoke all on function app.store_day_settled_at(uuid, date, interval) from public;
revoke all on function app.due_digests(timestamptz, uuid) from public;
revoke all on function app.digest_scope_check(uuid, text, uuid[]) from public;
revoke all on function app.complete_digest(uuid, date, text, uuid[], boolean, text, text, jsonb, integer, text, uuid, timestamptz) from public;
revoke all on function app.enqueue_digest_message(uuid, uuid, integer, text, text, text, timestamptz) from public;
revoke all on function app.fail_digest(uuid, date, text, uuid[], text, timestamptz) from public;
revoke all on function app.notify_tick_rules(timestamptz, uuid) from public;
