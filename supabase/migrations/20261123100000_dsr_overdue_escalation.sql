-- G-101, ADR-045: a data-subject request that turns overdue is escalated once and then reminded daily, and a lost
-- destination never closes the episode.
--
-- (a) app.evaluate_dsr_due_soon keeps one tenant-level episode while any open request is due soon or overdue. Until now
--     an episode that went from "due soon" to "overdue" only had its counts updated, so the owner read "0 overdue,
--     1 due soon" once and never "1 overdue". Now, while any request is overdue, the evaluator queues the rule's
--     reminder message (template alert.dsr_due_soon.reminder.v1, the overdue wording with the count and the days late of
--     the oldest request, counts only) when a request turns overdue (the episode had no overdue request at the last
--     reading), when no message was ever sent for the episode (no destination until now), and every 24 hours after the
--     last one. A request that is only due soon keeps the single early notice and no repeats. The catalogue's
--     remind_every stays null on purpose: the generic reminder of app.reconcile_alerts would repeat the due-soon-only
--     notice too. The facts gain days_late (whole days since the oldest overdue deadline) while something is overdue.
--
-- (b) app.notify_tick_rules read only tenants with an active or failing, enabled destination, so an open episode of a
--     tenant that lost every destination stayed open with stale counts and was never reread. It now reads every tenant
--     that has an open request or an open episode, destination or not: the obligation does not end with the inbox. With
--     no destination nothing is queued and last_notified_at stays null, so the first message goes out when a
--     destination exists. (The owner's notice in Settings, Alerts, that deadlines are not being sent while no
--     destination works, is a screen change and comes separately.)

create or replace function app.evaluate_dsr_due_soon(p_tenant_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_days integer;
  v_overdue integer;
  v_soon integer;
  v_days_late integer;
  v_open_event uuid;
  v_previous_overdue integer;
  v_last_notified timestamptz;
  v_facts jsonb;
  v_raised record;
  v_queued integer := 0;
begin
  select coalesce((e.params ->> 'days')::integer, 3) into v_days
  from app.effective_alert_rule(p_tenant_id, null, 'dsr_due_soon') e;
  if v_days is null then
    return jsonb_build_object('dsr_alerts', 0);
  end if;
  -- oldest_overdue is the earliest of the deadlines that have passed (the first reply while unanswered, the
  -- completion); it is null for a request that is not overdue.
  select
    count(*) filter (where d.oldest_overdue is not null),
    count(*) filter (
      where d.oldest_overdue is null
        and ((d.responded_at is null and d.first_response_due_at <= p_at + make_interval(days => v_days)) or d.completion_due_at <= p_at + make_interval(days => v_days))
    ),
    coalesce(floor(extract(epoch from (p_at - min(d.oldest_overdue))) / 86400), 0)::integer
  into v_overdue, v_soon, v_days_late
  from (
    select
      r.responded_at,
      r.first_response_due_at,
      r.completion_due_at,
      least(
        case when r.responded_at is null and r.first_response_due_at < p_at then r.first_response_due_at end,
        case when r.completion_due_at < p_at then r.completion_due_at end
      ) as oldest_overdue
    from public.data_subject_requests r
    where r.tenant_id = p_tenant_id and r.status in ('received', 'in_progress')
  ) d;
  select e.id, coalesce((e.facts ->> 'overdue')::integer, 0), e.last_notified_at
  into v_open_event, v_previous_overdue, v_last_notified
  from public.alert_events e
  where e.tenant_id = p_tenant_id and e.dedupe_key = 'dsr_due_soon:tenant' and e.state = 'open'
  order by e.opened_at desc
  limit 1;
  v_facts := jsonb_build_object('overdue', v_overdue, 'due_soon', v_soon, 'days', v_days)
    || case when v_overdue > 0 then jsonb_build_object('days_late', v_days_late) else '{}'::jsonb end;
  if v_overdue + v_soon > 0 then
    if v_open_event is null then
      select r.* into v_raised from app.raise_alert(p_tenant_id, 'dsr_due_soon', 'tenant', 'incremental', p_at, null, null, null, null, v_facts) r;
      return jsonb_build_object('dsr_alerts', case when v_raised.outcome = 'opened' then 1 else 0 end, 'overdue', v_overdue, 'due_soon', v_soon);
    end if;
    update public.alert_events e set facts = v_facts where e.id = v_open_event and e.facts is distinct from v_facts;
    if v_overdue > 0
      and (coalesce(v_previous_overdue, 0) = 0 or v_last_notified is null or v_last_notified + interval '24 hours' <= p_at)
    then
      v_queued := app.enqueue_alert_messages(v_open_event, 'alert_reminder', p_at);
      if v_queued > 0 then
        update public.alert_events e
        set last_notified_at = p_at, notifications = e.notifications + v_queued
        where e.id = v_open_event;
      end if;
    end if;
  elsif v_open_event is not null then
    perform app.resolve_rule_episode(v_open_event, 'cleared', p_at);
  end if;
  return jsonb_build_object('dsr_alerts', 0, 'overdue', v_overdue, 'due_soon', v_soon, 'reminders', v_queued);
end;
$$;

comment on function app.evaluate_dsr_due_soon(uuid, timestamptz) is 'the dsr_due_soon alert rule of a tenant: opens one tenant-level episode when an open data-subject request has a deadline overdue or within the rule''s days (3 by default), keeps its counts current while it stays open (and days_late, the whole days since the oldest overdue deadline, while something is overdue) and resolves it when nothing is due; while a request is overdue it queues the reminder message (the overdue wording) when a request turns overdue, when no message was ever sent for the episode, and every 24 hours after the last one, to the rule''s destinations; a request that is only due soon gets the single early notice and no repeats; the facts are counts only (ADR-045)';

revoke all on function app.evaluate_dsr_due_soon(uuid, timestamptz) from public, anon, authenticated, service_role;

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
  dsr integer := 0;
  candidate record;
begin
  reconciled := app.reconcile_alerts(p_at, p_tenant_id);
  imported := app.import_sync_alerts(p_at, p_tenant_id);
  channel_failures := app.evaluate_channel_health(p_at, p_tenant_id);
  select count(*)::integer into due from app.due_digests(p_at, p_tenant_id);
  intraday := app.evaluate_intraday_rules(p_at, p_tenant_id);
  -- Every tenant with an open request or an open episode is read, whether or not a destination works: the
  -- obligation does not end with the inbox (ADR-045).
  for candidate in
    select t.id as tenant_id
    from public.tenants t
    where (p_tenant_id is null or t.id = p_tenant_id)
      and (
        exists (select 1 from public.data_subject_requests r where r.tenant_id = t.id and r.status in ('received', 'in_progress'))
        or exists (select 1 from public.alert_events e where e.tenant_id = t.id and e.dedupe_key = 'dsr_due_soon:tenant' and e.state = 'open')
      )
    order by t.id
  loop
    dsr := dsr + coalesce((app.evaluate_dsr_due_soon(candidate.tenant_id, p_at) ->> 'dsr_alerts')::integer, 0);
  end loop;
  return jsonb_build_object(
    'reconciled', reconciled,
    'imported', imported,
    'channel_failed', channel_failures,
    'due_digests', due,
    'intraday', intraday,
    'dsr_due_soon', dsr
  );
end;
$$;

comment on function app.notify_tick_rules(timestamptz, uuid) is 'the rules half of the notify tick, the one hook later migrations replace with create or replace; third form: app.reconcile_alerts, app.import_sync_alerts, app.evaluate_channel_health, the count of due digests, the intraday rules and app.evaluate_dsr_due_soon for every tenant with an open data-subject request or an open dsr_due_soon episode, whether or not a destination works (ADR-045); counts only';

revoke all on function app.notify_tick_rules(timestamptz, uuid) from public, anon, authenticated, service_role;
