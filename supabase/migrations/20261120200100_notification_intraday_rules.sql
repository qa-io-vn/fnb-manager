create function app.evaluate_intraday_rules(p_at timestamptz, p_tenant_id uuid default null)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  candidate record;
  effective record;
  today date;
  day_start timestamptz;
  open_minutes integer;
  last_sync timestamptz;
  last_nightly timestamptz;
  hours integer;
  raised record;
  counted integer := 0;
begin
  if p_at is null then
    raise exception 'evaluate_intraday_rules needs an instant' using errcode = '22023';
  end if;
  for candidate in
    select s.id, s.tenant_id, s.pos_account_id, s.opening_hours, s.timezone, s.business_day_start_minutes
    from public.stores s
    join public.pos_accounts a on a.id = s.pos_account_id
    where (p_tenant_id is null or s.tenant_id = p_tenant_id)
      and a.status::text not in ('paused', 'auth_failed')
      and app.tenant_has_destinations(s.tenant_id)
      and app.opening_hours_known(s.opening_hours)
      and app.incremental_sync_watched(s.id)
      and coalesce(app.store_open_at(s.opening_hours, s.timezone, s.business_day_start_minutes, p_at), false)
    order by s.tenant_id, s.id
  loop
    select r.* into effective from app.effective_alert_rule(candidate.tenant_id, candidate.id, 'zero_sales_open') r;
    continue when not coalesce(effective.enabled, false);
    today := ((p_at at time zone candidate.timezone) - make_interval(mins => candidate.business_day_start_minutes))::date;
    continue when exists (
      select 1
      from public.alert_events e
      where e.tenant_id = candidate.tenant_id
        and e.state = 'open'
        and e.dedupe_key = 'zero_sales_open:store:' || candidate.id::text || ':' || to_char(today, 'YYYY-MM-DD')
    );
    day_start := (today + make_interval(mins => candidate.business_day_start_minutes)) at time zone candidate.timezone;
    open_minutes := app.opening_minutes_between(candidate.opening_hours, candidate.timezone, candidate.business_day_start_minutes, day_start, p_at);
    continue when open_minutes < coalesce((effective.params ->> 'min_open_minutes')::integer, 120);
    last_sync := app.last_successful_sync(candidate.id, p_at);
    continue when last_sync is null
      or last_sync < p_at - make_interval(mins => coalesce((effective.params ->> 'fresh_sync_minutes')::integer, 45));
    continue when exists (
      select 1
      from public.invoices i
      where i.store_id = candidate.id
        and i.business_date = today
        and i.status <> 'voided'
    );
    continue when coalesce((effective.params ->> 'skip_holidays')::boolean, true)
      and coalesce(app.is_excluded_day(array[candidate.id], today), false);
    continue when coalesce(
      (select min(k.business_date) from public.sync_checks k where k.store_id = candidate.id),
      'infinity'::date
    ) > today - coalesce((effective.params ->> 'min_history_days')::integer, 28);
    select r.* into raised
    from app.raise_alert(candidate.tenant_id, 'zero_sales_open', 'store:' || candidate.id::text || ':' || to_char(today, 'YYYY-MM-DD'),
      'scheduler', p_at, candidate.id, candidate.pos_account_id, null, today,
      jsonb_build_object('open_minutes', open_minutes)) r;
    if raised.outcome is distinct from 'ignored_disabled' then
      counted := counted + 1;
    end if;
  end loop;

  for candidate in
    select t.id as tenant_id
    from public.tenants t
    where (p_tenant_id is null or t.id = p_tenant_id)
      and app.tenant_has_destinations(t.id)
    order by t.id
  loop
    select r.* into effective from app.effective_alert_rule(candidate.tenant_id, null, 'nightly_missing') r;
    continue when not coalesce(effective.enabled, false);
    continue when exists (
      select 1
      from public.alert_events e
      where e.tenant_id = candidate.tenant_id
        and e.state = 'open'
        and e.dedupe_key = 'nightly_missing:tenant'
    );
    continue when not exists (
      select 1 from app.alert_destinations(candidate.tenant_id, null, null, 'nightly_missing') d
    );
    select max(r.finished_at) into last_nightly
    from public.sync_runs r
    where r.tenant_id = candidate.tenant_id
      and r.kind = 'nightly'
      and r.status = 'succeeded'
      and r.finished_at <= p_at;
    continue when last_nightly is null;
    hours := coalesce((effective.params ->> 'hours')::integer, 30);
    continue when last_nightly > p_at - make_interval(hours => hours);
    select r.* into raised
    from app.raise_alert(candidate.tenant_id, 'nightly_missing', 'tenant', 'scheduler', p_at,
      null, null, null, null,
      jsonb_build_object('hours', hours, 'hours_since_nightly', floor(extract(epoch from (p_at - last_nightly)) / 3600)::integer)) r;
    if raised.outcome is distinct from 'ignored_disabled' then
      counted := counted + 1;
    end if;
  end loop;
  return counted;
end;
$$;

comment on function app.evaluate_intraday_rules(timestamptz, uuid) is 'the intraday rules of the tick, only for tenants with an active or failing, enabled destination: zero_sales_open on store:<id>:<business date> for a store with known hours, open at p_at, watched by the incremental sync, whose account is neither paused nor auth_failed, after min_open_minutes of opening time today, with a successful sync within fresh_sync_minutes, no invoice of the business date that is not voided, not an excluded day when skip_holidays, and checked history reaching min_history_days back; nightly_missing on tenant when a destination receives it, a succeeded nightly ran before and none finished in the last hours; an open episode of the key is left alone; returns the readings recorded';

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
  for candidate in
    select t.id as tenant_id
    from public.tenants t
    where (p_tenant_id is null or t.id = p_tenant_id)
      and app.tenant_has_destinations(t.id)
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

comment on function app.notify_tick_rules(timestamptz, uuid) is 'the rules half of the notify tick, the one hook later migrations replace with create or replace; third form: app.reconcile_alerts, app.import_sync_alerts, app.evaluate_channel_health, the count of app.due_digests, app.evaluate_intraday_rules, then app.evaluate_dsr_due_soon for every tenant with an active or failing, enabled destination, returned as the count-only object {reconciled, imported, channel_failed, due_digests, intraday, dsr_due_soon}';

revoke all on function app.evaluate_intraday_rules(timestamptz, uuid) from public, anon, authenticated, service_role;
revoke all on function app.notify_tick_rules(timestamptz, uuid) from public, anon, authenticated, service_role;
