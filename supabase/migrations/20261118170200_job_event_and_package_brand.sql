create or replace function app.record_job_event(
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
  if p_workflow_key is null or p_workflow_key not in ('sync', 'backup', 'migrate', 'deploy_web', 'deploy_functions', 'notify', 'workflows_active', 'zalo_tokens', 'other') then
    raise exception 'record_job_event needs a workflow key of sync, backup, migrate, deploy_web, deploy_functions, notify, workflows_active, zalo_tokens or other' using errcode = '22023';
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

comment on function app.record_job_event(text, text, bigint, integer, timestamptz, timestamptz, uuid) is 'records a failed GitHub Actions run of a workflow key (sync, backup, migrate, deploy_web, deploy_functions, notify, workflows_active, zalo_tokens or other) for every tenant (or only p_tenant_id) with a destination that receives job_failed: for the sync workflow while an auth_failed episode is open, or a sync_failed or sync_stale episode was opened or seen since the run started, an instant episode with suppressed_reason root_cause_open and no message; otherwise an instant job_failed episode on workflow:<key> (critical for migrate) under the 12-hour cool-down; the run id and URL are not stored; returns one row per tenant';

create or replace function app.check_oa_package_expiry(p_at timestamptz default now(), p_tenant_id uuid default null, p_source text default 'scheduler')
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
    select o.id, o.tenant_id, o.package_tier, o.package_expires_on, b.brand_key,
      o.package_expires_on - (p_at at time zone t.timezone)::date as days_left
    from public.oas o
    join public.tenants t on t.id = o.tenant_id
    join public.brands b on b.id = o.brand_id and b.tenant_id = o.tenant_id
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
      jsonb_build_object('days_left', target.days_left, 'notice_days', notice, 'expires_on', to_char(target.package_expires_on, 'YYYY-MM-DD'), 'tier', target.package_tier, 'brand', target.brand_key),
      null, true
    ) a;
    if raised.outcome = 'opened' then
      opened := opened + 1;
    end if;
  end loop;
  return opened;
end;
$$;

comment on function app.check_oa_package_expiry(timestamptz, uuid, text) is 'raises oa_package_expiring once per OA, expiry date and notice: when the package of oas.package_expires_on has first_notice_days (30) or fewer days left in the tenant''s zone, and again at last_notice_days (7); a first reading already inside the last notice raises only that one; an expired package raises nothing; instant episodes under oa:<OA row id>:<expiry>:<notice> with count-only facts (days_left, notice_days, expires_on, tier and brand, the neutral brand key such as brand-1, so the message names the OA without a free-text name); returns how many it opened';
