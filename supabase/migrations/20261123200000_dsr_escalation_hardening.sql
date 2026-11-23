-- Hardening of app.evaluate_dsr_due_soon (ADR-045) after an independent review, each proved by a reproduction:
-- (1) an episode opened already overdue inside the 24-hour cool-down of the previous one inherits that one's
--     last_notified_at, so no "turns overdue" transition and no reminder for up to a day: the test is now "no message was
--     ever queued for the episode" (notifications = 0) besides "last_notified_at is null";
-- (2) the reminder was queued while the rule was switched off (each cancelled as unsubscribed, but counted and
--     timestamped), so after the owner switched it back on nothing went out for up to 24 hours: it is skipped while off;
-- (3) the open episode was read without a lock: it is read for update now.
-- Only these three lines of logic differ from 20261123100000_dsr_overdue_escalation.sql.

create or replace function app.evaluate_dsr_due_soon(p_tenant_id uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_days integer;
  v_enabled boolean;
  v_notifications integer;
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
  select coalesce((e.params ->> 'days')::integer, 3), coalesce(e.enabled, false) into v_days, v_enabled
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
  -- for update: two overlapping ticks (the cron tick and fnb notify tick) must not both read the same previous counts
  select e.id, coalesce((e.facts ->> 'overdue')::integer, 0), e.last_notified_at, coalesce(e.notifications, 0)
  into v_open_event, v_previous_overdue, v_last_notified, v_notifications
  from public.alert_events e
  where e.tenant_id = p_tenant_id and e.dedupe_key = 'dsr_due_soon:tenant' and e.state = 'open'
  order by e.opened_at desc
  limit 1
  for update of e;
  v_facts := jsonb_build_object('overdue', v_overdue, 'due_soon', v_soon, 'days', v_days)
    || case when v_overdue > 0 then jsonb_build_object('days_late', v_days_late) else '{}'::jsonb end;
  if v_overdue + v_soon > 0 then
    if v_open_event is null then
      select r.* into v_raised from app.raise_alert(p_tenant_id, 'dsr_due_soon', 'tenant', 'incremental', p_at, null, null, null, null, v_facts) r;
      return jsonb_build_object('dsr_alerts', case when v_raised.outcome = 'opened' then 1 else 0 end, 'overdue', v_overdue, 'due_soon', v_soon);
    end if;
    update public.alert_events e set facts = v_facts where e.id = v_open_event and e.facts is distinct from v_facts;
    -- No reminder while the rule is off (the escalation must not be spent on a message the owner switched off), and one
    -- for an episode that never had a message, whatever last_notified_at says: an episode opened inside the cool-down of
    -- the one before carries that one's last notice.
    if v_enabled and v_overdue > 0
      and (coalesce(v_previous_overdue, 0) = 0 or v_notifications = 0 or v_last_notified is null or v_last_notified + interval '24 hours' <= p_at)
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
