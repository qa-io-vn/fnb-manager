create or replace function app.raise_alert(
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
  recovery_told boolean := false;
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
  if previous_notice is not null then
    recovery_told := exists (
      select 1
      from public.alert_events e
      join public.outbound_messages o on o.alert_event_id = e.id
      where e.tenant_id = p_tenant_id
        and e.dedupe_key = dedupe
        and e.id <> created
        and o.kind = 'alert_resolved'
        and o.status in ('queued', 'held', 'sending', 'sent', 'delivered', 'uncertain')
        and o.created_at >= previous_notice
    );
  end if;
  if previous_notice is not null and previous_notice + effective.cooldown > p_occurred_at and not recovery_told then
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

comment on function app.raise_alert(uuid, text, text, text, timestamptz, uuid, uuid, uuid, date, jsonb, public.alert_severity, boolean) is 'records one reading of an immediate rule as an episode under the dedupe key <rule>:<subject>, serialised by an advisory lock on the key: ignored when the rule is disabled (ignored_disabled); folded into the account''s auth_failed episode when app.root_cause_event finds one (folded); counted on the open episode, with a reminder once remind_every has passed since the last notice (repeated, reminded); otherwise a new episode that opens silently inside the cool-down of the key''s last notice (keeping that notice time), unless a recovery notice of the key was queued or sent after that notice, so a condition that returns after the owner was told it recovered is announced again; else it fans out to its destinations (no_destination when none); resolved at once when p_instant; 22023 for an unknown or digest rule, a malformed subject or facts that are not count-only';

create or replace function app.record_runner_notification(
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
      and (
        e.dedupe_key = 'sync_stale:store:' || p_store_id::text
        or (e.rule_key = 'auth_failed' and e.pos_account_id = account)
      )
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

comment on function app.record_runner_notification(text, text, uuid, uuid, uuid, uuid, jsonb, timestamptz, text) is 'the phase 7 Notifier mapping (OutboxNotifier): checks that the store and the account belong to the tenant (22023), keeps only count-only facts, and raises auth_failed on account:<id>; run_failed of an incremental run as sync_failed on store:<id> once the store''s latest min_consecutive_incremental incremental runs all failed (below_threshold before), of a window run as sync_failed on account:<id>:<kind>; sync_stale over the tenant''s threshold as sync_stale on store:<id> (scope now) or, for the nightly''s previous-day reading, as an instant store_day:<id>:<date> episode unless a store:<id> episode, or an auth_failed episode of the store''s POS account, overlapped that business day (covered: the owner already heard of that outage); the runner''s label, message and severity are not stored';

create or replace function app.reconcile_alerts(p_at timestamptz default now(), p_tenant_id uuid default null)
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
  account_status text;
  last_sync timestamptz;
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
      account_status := null;
      select a.status::text into account_status
      from public.pos_accounts a
      where a.id = episode.pos_account_id;
      if account_status is null or account_status = 'paused' then
        resolution_value := 'superseded';
      elsif account_status <> 'auth_failed' then
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
      last_sync := app.last_successful_sync(episode.store_id, p_at);
      if not coalesce(schedule_enabled, false) and schedule_changed_at >= episode.opened_at then
        resolution_value := 'schedule_disabled';
      elsif not app.incremental_sync_watched(episode.store_id) then
        resolution_value := 'superseded';
      elsif not exists (
          select 1
          from app.sync_alerts a
          where a.store_id = episode.store_id
            and a.kind = 'sync_stale'
            and a.resolved_at is null
            and a.last_seen_at > coalesce(last_sync, '-infinity'::timestamptz)
        )
        and coalesce(app.sync_gap_minutes(episode.store_id, p_at), 0) <= threshold
      then
        resolution_value := case when coalesce(last_sync > episode.opened_at, false) then 'recovered' else 'superseded' end;
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

comment on function app.reconcile_alerts(timestamptz, uuid) is 'the first step of the tick''s rules: resolves open episodes whose condition cleared or stopped being watched (auth_failed as recovered when the account is active or error again, as superseded when it was paused instead; sync_failed after a succeeded run of the store, or of the account and kind, started after the opening; sync_stale as schedule_disabled when the incremental schedule was switched off after the opening, as superseded while the sync no longer watches the store (inactive, opted out, paused account), and once no open sync_alerts row newer than the last successful sync remains and the gap is within the threshold as recovered when a successful sync ended after the opening, else as superseded; sync_dispatch_failed when its sync_alerts row resolved; zero_sales_open at a sale or the end of the business day; nightly_missing at a succeeded nightly; digest_failed once the digest is built; channel_failed at a later sent message on the destination), enqueues the resolution notice of a rule with notify_on_resolve for a recovered or cleared episode to each destination whose opening message was delivered (never for superseded, so nothing claims a recovery that did not happen), and sends the reminder of a still open episode once remind_every has passed since its last notice unless a root cause is open; returns the number of episodes resolved or reminded';

revoke all on function app.raise_alert(uuid, text, text, text, timestamptz, uuid, uuid, uuid, date, jsonb, public.alert_severity, boolean) from public;
revoke all on function app.record_runner_notification(text, text, uuid, uuid, uuid, uuid, jsonb, timestamptz, text) from public;
revoke all on function app.reconcile_alerts(timestamptz, uuid) from public;
