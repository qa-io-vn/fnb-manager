insert into public.alert_rule_catalog (rule_key, category, delivery, default_enabled, default_severity, default_roles, default_params, params_schema, default_cooldown, remind_every, notify_on_resolve, store_scoped, sort_order)
values
  ('staff_sync_stale', 'sync', 'immediate', true, 'warning', array['manager', 'staff']::public.tenant_role[],
    '{}', '{}',
    interval '6 hours', null, false, true, 200),
  ('abnormal_voids', 'business', 'immediate', true, 'warning', array['owner', 'manager']::public.tenant_role[],
    '{"z_threshold": 2, "min_events": 3}',
    '{"z_threshold": {"type": "number", "min": 1, "max": 5}, "min_events": {"type": "integer", "min": 1, "max": 100}}',
    interval '0', null, false, true, 210),
  ('voucher_spike', 'business', 'immediate', true, 'warning', array['owner', 'manager']::public.tenant_role[],
    '{"ratio": 2, "min_vouchers": 5, "weeks": 8, "min_sample_days": 3}',
    '{"ratio": {"type": "number", "min": 1.1, "max": 10}, "min_vouchers": {"type": "integer", "min": 1, "max": 1000}, "weeks": {"type": "integer", "min": 2, "max": 12}, "min_sample_days": {"type": "integer", "min": 1, "max": 12}}',
    interval '0', null, false, true, 220),
  ('checklist_unfinished', 'operations', 'immediate', true, 'warning', array['manager', 'staff']::public.tenant_role[],
    '{"grace_minutes": 30}',
    '{"grace_minutes": {"type": "integer", "min": 0, "max": 240}}',
    interval '0', null, false, true, 230),
  ('staff_daily_digest', 'digest', 'digest', true, 'info', array['staff']::public.tenant_role[],
    '{"deadline_local": "07:00"}',
    '{"deadline_local": {"type": "time"}}',
    interval '0', null, false, false, 240),
  ('oa_inactive', 'channel', 'immediate', true, 'warning', array['owner']::public.tenant_role[],
    '{"warn_after_days": 150}',
    '{"warn_after_days": {"type": "integer", "min": 30, "max": 179}}',
    interval '7 days', interval '7 days', false, false, 250),
  ('mini_app_visits_low', 'channel', 'immediate', true, 'warning', array['owner']::public.tenant_role[],
    '{"min_visits": 10, "min_days": 7}',
    '{"min_visits": {"type": "integer", "min": 1, "max": 1000}, "min_days": {"type": "integer", "min": 1, "max": 28}}',
    interval '0', null, false, false, 260);

alter table public.outbound_messages drop constraint outbound_messages_kind_check;
alter table public.outbound_messages
  add constraint outbound_messages_kind_check check (kind is null or kind in ('digest', 'digest_correction', 'alert', 'alert_reminder', 'alert_resolved', 'test', 'link_code', 'link_notice', 'link_confirmation', 'announcement', 'request_decided', 'staff_digest'));

comment on column public.outbound_messages.kind is 'digest, digest_correction, alert, alert_reminder, alert_resolved, test, link_code, link_notice, link_confirmation, announcement (a new announcement waits in the staff app), request_decided (a request of the member was approved or refused) or staff_digest (the staff form of the daily digest); null on log rows outside the outbox';

create function app.guard_digest_roles()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.rule_key = 'daily_digest' and 'staff' = any (coalesce(new.roles, '{}'::public.tenant_role[])) then
    raise exception 'the daily digest is built as an owner or manager and never goes to staff; staff_daily_digest is theirs' using errcode = '22023';
  end if;
  if new.rule_key = 'staff_daily_digest' and new.roles is not null and not (new.roles <@ array['staff']::public.tenant_role[]) then
    raise exception 'the staff digest goes to staff only' using errcode = '22023';
  end if;
  return new;
end;
$$;

comment on function app.guard_digest_roles() is 'trigger on alert_rules, run as the writer: refuses staff among the roles of daily_digest, whose model one owner or manager builds for every member of a scope, and any role but staff for staff_daily_digest, which is built as a staff member under the tenant''s staff_revenue_visibility (22023), so staff never read figures the owner did not allow';

create trigger alert_rules_guard_digest_roles
before insert or update on public.alert_rules
for each row execute function app.guard_digest_roles();

create table public.mini_app_visits (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  mini_app_id uuid not null,
  month date not null check (extract(day from month) = 1),
  visits integer not null default 0 check (visits >= 0),
  updated_at timestamptz not null default now(),
  primary key (mini_app_id, month),
  foreign key (tenant_id, mini_app_id) references public.mini_apps (tenant_id, id) on delete cascade
);

comment on table public.mini_app_visits is 'count-only visits per Mini App and month in the tenant''s zone (ADR-022: at least 10 a month), incremented by zalo-session through zalo_session_visit; no per-person row, no device, no location; owners and managers of the tenant read it';
comment on column public.mini_app_visits.month is 'the first day of the month in the tenant''s time zone';

alter table public.mini_app_visits enable row level security;

create policy mini_app_visits_select_for_managers on public.mini_app_visits
  for select to authenticated
  using (app.has_tenant_role(tenant_id, array['owner', 'manager']::public.tenant_role[]));

revoke all on public.mini_app_visits from anon, authenticated;
grant select on public.mini_app_visits to authenticated;

create function app.record_mini_app_visit(p_zalo_app_id uuid, p_kind text default 'staff', p_at timestamptz default now())
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_app record;
  v_day date;
  v_month date;
  v_visits integer;
begin
  if p_kind is null or p_kind not in ('staff', 'customer') or p_at is null then
    raise exception 'a visit is to the staff or the customer Mini App at an instant' using errcode = '22023';
  end if;
  select m.id, m.tenant_id, t.timezone into v_app
  from public.zalo_apps z
  join public.mini_apps m on m.tenant_id = z.tenant_id and m.brand_id = z.brand_id and m.kind = p_kind
  join public.tenants t on t.id = z.tenant_id
  where z.id = p_zalo_app_id;
  if not found then
    return null;
  end if;
  v_day := (p_at at time zone v_app.timezone)::date;
  v_month := v_day - (extract(day from v_day)::integer - 1);
  insert into public.mini_app_visits as v (tenant_id, mini_app_id, month, visits, updated_at)
  values (v_app.tenant_id, v_app.id, v_month, 1, now())
  on conflict (mini_app_id, month) do update
  set visits = v.visits + 1,
      updated_at = now()
  returning v.visits into v_visits;
  return v_visits;
end;
$$;

comment on function app.record_mini_app_visit(uuid, text, timestamptz) is 'adds one visit to the month (tenant zone) of the staff or customer Mini App of a Zalo App''s brand and returns the month''s count; null when the brand has no such Mini App; nothing about the visitor is kept';

create function public.zalo_session_visit(p_zalo_app_id uuid, p_kind text default 'staff')
returns integer
language sql
volatile
set search_path = ''
as $$
  select app.record_mini_app_visit(p_zalo_app_id, p_kind, now());
$$;

comment on function public.zalo_session_visit(uuid, text) is 'RPC for the zalo-session Edge Function only (service_role): app.record_mini_app_visit at the current time, once per accepted session request';

create table app.oa_follower_activity (
  oa_id uuid primary key references public.oas (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  last_sent_at timestamptz not null,
  updated_at timestamptz not null default now()
);

comment on table app.oa_follower_activity is 'per OA, when it last sent something to a follower, from the verified oa_send_ events of oa-webhook; kept after the events themselves are deleted, so oa_inactive can count the 180 days Zalo allows';

revoke all on table app.oa_follower_activity from public, anon, authenticated, service_role;

insert into app.oa_follower_activity (oa_id, tenant_id, last_sent_at)
select e.oa_id, e.tenant_id, max(e.occurred_at)
from public.oa_events e
where e.event_name ~ '^oa_send_'
  and e.signature in ('raw', 'compact')
group by e.oa_id, e.tenant_id;

create function app.record_oa_follower_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.event_name ~ '^oa_send_' and new.signature in ('raw', 'compact') then
    insert into app.oa_follower_activity as a (oa_id, tenant_id, last_sent_at)
    values (new.oa_id, new.tenant_id, new.occurred_at)
    on conflict (oa_id) do update
    set last_sent_at = greatest(a.last_sent_at, excluded.last_sent_at),
        updated_at = now();
  end if;
  return null;
end;
$$;

comment on function app.record_oa_follower_activity() is 'trigger after an OA event is stored: a verified oa_send_ event moves the OA''s last activity toward followers forward';

create trigger oa_events_record_follower_activity
after insert on public.oa_events
for each row execute function app.record_oa_follower_activity();

create function app.resolve_rule_episode(p_event_id uuid, p_resolution text, p_at timestamptz)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_event public.alert_events;
  v_effective record;
  v_queued integer;
begin
  update public.alert_events e
  set state = 'resolved',
      resolved_at = p_at,
      resolution = p_resolution
  where e.id = p_event_id
    and e.state = 'open'
  returning e.* into v_event;
  if not found then
    return 0;
  end if;
  select r.* into v_effective from app.effective_alert_rule(v_event.tenant_id, v_event.store_id, v_event.rule_key) r;
  if coalesce(v_effective.notify_on_resolve, false) and p_resolution in ('recovered', 'cleared') then
    v_queued := app.enqueue_alert_messages(v_event.id, 'alert_resolved', p_at);
    if v_queued > 0 then
      update public.alert_events e set notifications = e.notifications + v_queued where e.id = v_event.id;
    end if;
  end if;
  return 1;
end;
$$;

comment on function app.resolve_rule_episode(uuid, text, timestamptz) is 'resolves one open episode with the resolution and, for a rule with notify_on_resolve, queues the resolution notice of a recovered or cleared episode as app.reconcile_alerts does; the phase 15 rules resolve their own episodes through it; returns 1 when it resolved one';

create function app.checklist_phase_end(p_store_id uuid, p_date date, p_phase text)
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
  ),
  spans as (
    select sp.opens_at, sp.closes_at
    from s
    cross join lateral app.opening_spans(s.opening_hours, s.timezone, s.business_day_start_minutes, s.day_start, s.day_end) sp
    where sp.opens_at >= s.day_start
      and sp.opens_at < s.day_end
  )
  select case p_phase
    when 'opening' then min(sp.opens_at)
    when 'closing' then max(sp.closes_at)
    when 'midshift' then min(sp.opens_at) + (max(sp.closes_at) - min(sp.opens_at)) / 2
  end
  from spans sp;
$$;

comment on function app.checklist_phase_end(uuid, date, text) is 'when a shift phase of business day D ends at a store, from its opening hours: opening at the first opening, closing at the last close, midshift halfway between them; null on a closed day, with unknown hours or for another phase';

create function app.evaluate_staff_sync(p_at timestamptz, p_tenant_id uuid, p_source text)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  target record;
  open_event uuid;
  stale boolean;
  raised record;
  opened integer := 0;
begin
  for target in
    select s.id, s.tenant_id, s.pos_account_id
    from public.stores s
    where s.active
      and (p_tenant_id is null or s.tenant_id = p_tenant_id)
      and app.tenant_has_destinations(s.tenant_id)
    order by s.tenant_id, s.id
  loop
    stale := exists (
      select 1
      from public.alert_events e
      where e.tenant_id = target.tenant_id
        and e.state = 'open'
        and (
          (e.rule_key in ('sync_stale', 'sync_failed') and e.store_id = target.id)
          or (e.rule_key = 'auth_failed' and e.pos_account_id = target.pos_account_id)
        )
    );
    open_event := null;
    select e.id into open_event
    from public.alert_events e
    where e.tenant_id = target.tenant_id
      and e.dedupe_key = 'staff_sync_stale:store:' || target.id::text
      and e.state = 'open';
    if stale and open_event is null then
      select r.* into raised
      from app.raise_alert(target.tenant_id, 'staff_sync_stale', 'store:' || target.id::text, p_source, p_at,
        target.id, target.pos_account_id, null, null, '{}'::jsonb) r;
      if raised.outcome = 'opened' then
        opened := opened + 1;
      end if;
    elsif not stale and open_event is not null then
      perform app.resolve_rule_episode(open_event, 'recovered', p_at);
    end if;
  end loop;
  return opened;
end;
$$;

comment on function app.evaluate_staff_sync(timestamptz, uuid, text) is 'staff_sync_stale: opens store:<id> while an owner-facing sync_stale or sync_failed episode of the store, or an auth_failed episode of its POS account, is open, with no fact at all, so staff hear only that the store''s figures are not up to date; resolves it as recovered once none is open; a return inside the 6-hour cool-down is silent; returns the episodes opened';

create function app.evaluate_unfinished_checklists(p_at timestamptz, p_tenant_id uuid, p_source text)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  episode record;
  target record;
  effective record;
  grace integer;
  deadline timestamptz;
  run record;
  subject text;
  raised record;
  opened integer := 0;
begin
  for episode in
    select e.id, e.store_id, e.business_date, e.dedupe_key, e.opened_at
    from public.alert_events e
    where e.rule_key = 'checklist_unfinished'
      and e.state = 'open'
      and (p_tenant_id is null or e.tenant_id = p_tenant_id)
    order by e.opened_at, e.id
  loop
    if exists (
      select 1
      from public.checklist_runs r
      where r.template_id = split_part(episode.dedupe_key, ':', 3)::uuid
        and r.store_id = episode.store_id
        and r.business_date = episode.business_date
        and r.status = 'finished'
    ) then
      perform app.resolve_rule_episode(episode.id, 'cleared', p_at);
    elsif p_at >= episode.opened_at + interval '12 hours' then
      perform app.resolve_rule_episode(episode.id, 'day_ended', p_at);
    end if;
  end loop;

  for target in
    with in_scope as (
      select s.id as store_id, s.tenant_id, app.store_business_date(s.id, p_at) as today
      from public.stores s
      where s.active
        and (p_tenant_id is null or s.tenant_id = p_tenant_id)
        and app.tenant_has_destinations(s.tenant_id)
        and app.opening_hours_known(s.opening_hours)
    )
    select i.store_id, i.tenant_id, d.business_date, t.id as template_id, t.shift_phase, t.created_at as template_created_at,
      app.checklist_phase_end(i.store_id, d.business_date, t.shift_phase) as phase_end
    from in_scope i
    cross join lateral (values (i.today - 1), (i.today)) as d (business_date)
    join public.checklist_templates t
      on t.tenant_id = i.tenant_id
     and (t.store_id is null or t.store_id = i.store_id)
     and t.active
    order by i.tenant_id, i.store_id, d.business_date, t.id
  loop
    continue when target.phase_end is null or target.template_created_at > target.phase_end;
    select r.* into effective from app.effective_alert_rule(target.tenant_id, target.store_id, 'checklist_unfinished') r;
    continue when not coalesce(effective.enabled, false);
    grace := coalesce((effective.params ->> 'grace_minutes')::integer, 30);
    deadline := target.phase_end + make_interval(mins => grace);
    continue when deadline > p_at or deadline <= p_at - interval '12 hours';
      select r.id, r.status into run
    from public.checklist_runs r
    where r.template_id = target.template_id
      and r.store_id = target.store_id
      and r.business_date = target.business_date
    order by r.status = 'finished' desc, r.started_at desc, r.id
    limit 1;
    continue when run.status = 'finished';
    subject := 'checklist:' || target.template_id::text || ':' || target.store_id::text || ':' || to_char(target.business_date, 'YYYY-MM-DD');
    continue when exists (
      select 1
      from public.alert_events e
      where e.tenant_id = target.tenant_id
        and e.dedupe_key = 'checklist_unfinished:' || subject
    );
    select r.* into raised
    from app.raise_alert(target.tenant_id, 'checklist_unfinished', subject, p_source, p_at,
      target.store_id, null, null, target.business_date,
      jsonb_build_object(
        'shift_phase', target.shift_phase,
        'started', run.id is not null,
        'items_total', (select count(*) from public.checklist_answers a where a.run_id = run.id),
        'items_done', (select count(*) from public.checklist_answers a where a.run_id = run.id and a.done),
        'minutes_late', floor(extract(epoch from (p_at - target.phase_end)) / 60)::integer,
        'grace_minutes', grace
      )) r;
    if raised.outcome = 'opened' then
      opened := opened + 1;
    end if;
  end loop;
  return opened;
end;
$$;

comment on function app.evaluate_unfinished_checklists(timestamptz, uuid, text) is 'checklist_unfinished: for each active checklist of a store with known opening hours (its own and the tenant-wide ones) on the store''s business days today and yesterday, once grace_minutes have passed since its shift phase ended (app.checklist_phase_end) and for at most 12 hours after that, when no run of it for that day is finished: one episode per checklist, store and day (checklist:<template>:<store>:<date>) to the staff and managers of the store, with count-only facts (shift_phase, started, items_total, items_done, minutes_late, grace_minutes), never the checklist''s title; a checklist created after its phase ended is left out; an open episode is resolved as cleared when the run is finished, else as day_ended 12 hours after it opened; returns the episodes opened';

create function app.evaluate_abnormal_voids(p_at timestamptz, p_tenant_id uuid, p_source text)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  target record;
  effective record;
  z numeric;
  min_events integer;
  today date;
  shift record;
  subject text;
  raised record;
  opened integer := 0;
begin
  for target in
    select s.id, s.tenant_id
    from public.stores s
    where s.active
      and (p_tenant_id is null or s.tenant_id = p_tenant_id)
      and app.tenant_has_destinations(s.tenant_id)
    order by s.tenant_id, s.id
  loop
    select r.* into effective from app.effective_alert_rule(target.tenant_id, target.id, 'abnormal_voids') r;
    continue when not coalesce(effective.enabled, false);
    z := coalesce((effective.params ->> 'z_threshold')::numeric, 2);
    min_events := coalesce((effective.params ->> 'min_events')::integer, 3);
    today := app.store_business_date(target.id, p_at);
    continue when not exists (
      select 1
      from public.agg_shift_cash a
      where a.store_id = target.id
        and a.business_date between today - 1 and today
        and a.closed_at is not null
    );
    for shift in
      select a.shift_id, a.business_date, a.orders, a.voids, a.removed_lines, a.void_z_score, a.removed_z_score,
        coalesce(a.void_z_score > z and a.voids >= min_events, false) as over_voids,
        coalesce(a.removed_z_score > z and a.removed_lines >= min_events, false) as over_removed
      from public.shift_adjustments(array[target.id], today - 1, today, z) a
      where a.closed_at is not null
        and a.closed_at <= p_at
      order by a.closed_at, a.shift_id
    loop
      continue when not (shift.over_voids or shift.over_removed);
      subject := 'shift:' || shift.shift_id::text;
      continue when exists (
        select 1
        from public.alert_events e
        where e.tenant_id = target.tenant_id
          and e.dedupe_key = 'abnormal_voids:' || subject
      );
      select r.* into raised
      from app.raise_alert(target.tenant_id, 'abnormal_voids', subject, p_source, p_at,
        target.id, null, null, shift.business_date,
        jsonb_build_object(
          'shift_number', app.shift_number(shift.shift_id),
          'orders', shift.orders,
          'voids', shift.voids,
          'removed_lines', shift.removed_lines,
          'void_z', round(shift.void_z_score, 2),
          'removed_z', round(shift.removed_z_score, 2),
          'over_voids', shift.over_voids,
          'over_removed', shift.over_removed
        ),
        null, true) r;
      if raised.outcome = 'opened' then
        opened := opened + 1;
      end if;
    end loop;
  end loop;
  return opened;
end;
$$;

comment on function app.evaluate_abnormal_voids(timestamptz, uuid, text) is 'abnormal_voids: the closed shifts of a store''s business days today and yesterday from public.shift_adjustments (phase 10b), whose void rate or removed-line rate scores above z_threshold against the store''s shifts of the 56 days before with at least min_events voids or removed lines: one instant episode per shift (shift:<id>) to the owners and the store''s managers, with count-only facts (shift_number as Ca {n}, orders, voids, removed_lines, void_z, removed_z, over_voids, over_removed), never an amount, a cashier or a shift name; a shift already raised is not raised again; returns the episodes opened';

create function app.evaluate_voucher_spikes(p_at timestamptz, p_tenant_id uuid, p_source text)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  target record;
  effective record;
  ratio numeric;
  min_vouchers integer;
  weeks integer;
  min_samples integer;
  today date;
  on_day date;
  subject text;
  vouchers integer;
  invoice_count integer;
  samples integer;
  base_vouchers numeric;
  base_share numeric;
  over_count boolean;
  over_share boolean;
  raised record;
  opened integer := 0;
begin
  for target in
    select s.id, s.tenant_id
    from public.stores s
    where s.active
      and (p_tenant_id is null or s.tenant_id = p_tenant_id)
      and app.tenant_has_destinations(s.tenant_id)
    order by s.tenant_id, s.id
  loop
    select r.* into effective from app.effective_alert_rule(target.tenant_id, target.id, 'voucher_spike') r;
    continue when not coalesce(effective.enabled, false);
    ratio := coalesce((effective.params ->> 'ratio')::numeric, 2);
    min_vouchers := coalesce((effective.params ->> 'min_vouchers')::integer, 5);
    weeks := coalesce((effective.params ->> 'weeks')::integer, 8);
    min_samples := coalesce((effective.params ->> 'min_sample_days')::integer, 3);
    today := app.store_business_date(target.id, p_at);
    foreach on_day in array array[today - 1, today] loop
      subject := 'store:' || target.id::text || ':' || to_char(on_day, 'YYYY-MM-DD');
      continue when exists (
        select 1
        from public.alert_events e
        where e.tenant_id = target.tenant_id
          and e.dedupe_key = 'voucher_spike:' || subject
      );
      select
        (count(*) filter (where i.voucher_amount > 0 or i.voucher_code is not null))::integer,
        count(*)::integer
      into vouchers, invoice_count
      from public.invoices i
      where i.store_id = target.id
        and i.business_date = on_day
        and i.status <> 'voided';
      continue when vouchers < min_vouchers;
      select count(*)::integer, avg(x.day_vouchers), avg(x.day_share)
      into samples, base_vouchers, base_share
      from (
        select
          w.on_date,
          count(*) filter (where i.voucher_amount > 0 or i.voucher_code is not null) as day_vouchers,
          (count(*) filter (where i.voucher_amount > 0 or i.voucher_code is not null))::numeric / count(*) as day_share
        from generate_series(1, weeks) as g (n)
        cross join lateral (select on_day - 7 * g.n as on_date) w
        join public.invoices i
          on i.store_id = target.id
         and i.business_date = w.on_date
         and i.status <> 'voided'
        group by w.on_date
      ) x;
      continue when samples < min_samples;
      over_count := vouchers > ratio * base_vouchers;
      over_share := invoice_count > 0 and vouchers::numeric / invoice_count > ratio * base_share;
      continue when not (over_count or over_share);
      select r.* into raised
      from app.raise_alert(target.tenant_id, 'voucher_spike', subject, p_source, p_at,
        target.id, null, null, on_day,
        jsonb_build_object(
          'vouchers', vouchers,
          'invoices', invoice_count,
          'share', round(vouchers::numeric / invoice_count, 4),
          'baseline_vouchers', round(base_vouchers, 1),
          'baseline_share', round(base_share, 4),
          'sample_days', samples,
          'ratio', ratio,
          'over_count', over_count,
          'over_share', over_share
        ),
        null, true) r;
      if raised.outcome = 'opened' then
        opened := opened + 1;
      end if;
    end loop;
  end loop;
  return opened;
end;
$$;

comment on function app.evaluate_voucher_spikes(timestamptz, uuid, text) is 'voucher_spike: for a store''s business days today (so far) and yesterday, the invoices with a voucher (voucher amount or code, voided invoices left out) against the same weekday of the weeks before (days with sales only, at least min_sample_days): at least min_vouchers and either the count above ratio times the baseline''s mean count or the share above ratio times its mean share; one instant episode per store and day (store:<id>:<date>) to the owners and the store''s managers, with count-only facts (vouchers, invoices, share, baseline_vouchers, baseline_share, sample_days, ratio, over_count, over_share), never an amount or a voucher code; a day already raised is not raised again; returns the episodes opened';

create function app.evaluate_oa_activity(p_at timestamptz, p_tenant_id uuid, p_source text)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  target record;
  effective record;
  warn integer;
  days integer;
  subject text;
  open_event uuid;
  raised record;
  opened integer := 0;
begin
  for target in
    select o.id, o.tenant_id, o.created_at, a.last_sent_at
    from public.oas o
    left join app.oa_follower_activity a on a.oa_id = o.id
    where (p_tenant_id is null or o.tenant_id = p_tenant_id)
      and app.tenant_has_destinations(o.tenant_id)
    order by o.tenant_id, o.id
  loop
    select r.* into effective from app.effective_alert_rule(target.tenant_id, null, 'oa_inactive') r;
    continue when not coalesce(effective.enabled, false);
    warn := coalesce((effective.params ->> 'warn_after_days')::integer, 150);
    days := floor(extract(epoch from (p_at - coalesce(target.last_sent_at, target.created_at))) / 86400)::integer;
    subject := 'oa:' || target.id::text;
    open_event := null;
    select e.id into open_event
    from public.alert_events e
    where e.tenant_id = target.tenant_id
      and e.dedupe_key = 'oa_inactive:' || subject
      and e.state = 'open';
    if days >= warn then
      select r.* into raised
      from app.raise_alert(target.tenant_id, 'oa_inactive', subject, p_source, p_at,
        null, null, null, null,
        jsonb_build_object(
          'days_inactive', days,
          'warn_after_days', warn,
          'lock_after_days', 180,
          'days_left', greatest(180 - days, 0),
          'activity_recorded', target.last_sent_at is not null
        )) r;
      if raised.outcome = 'opened' then
        opened := opened + 1;
      end if;
    elsif open_event is not null then
      perform app.resolve_rule_episode(open_event, 'recovered', p_at);
    end if;
  end loop;
  return opened;
end;
$$;

comment on function app.evaluate_oa_activity(timestamptz, uuid, text) is 'oa_inactive: for each OA, the days since it last sent something to a follower (app.oa_follower_activity, else since the OA was configured); from warn_after_days (150 of the 180 days Zalo allows) an episode on oa:<id> to the owners with count-only facts (days_inactive, warn_after_days, lock_after_days, days_left, activity_recorded), repeated while it lasts with a reminder every 7 days; resolved as recovered once the OA is active again; returns the episodes opened';

create function app.evaluate_mini_app_visits(p_at timestamptz, p_tenant_id uuid, p_source text)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  target record;
  effective record;
  min_visits integer;
  min_days integer;
  local_day date;
  month_start date;
  days_elapsed integer;
  days_in_month integer;
  visits integer;
  projected integer;
  subject text;
  episode record;
  raised record;
  opened integer := 0;
begin
  for target in
    select m.id, m.tenant_id, m.kind, t.timezone
    from public.mini_apps m
    join public.tenants t on t.id = m.tenant_id
    where (p_tenant_id is null or m.tenant_id = p_tenant_id)
      and app.tenant_has_destinations(m.tenant_id)
      and exists (select 1 from public.mini_app_visits v where v.mini_app_id = m.id)
    order by m.tenant_id, m.id
  loop
    select r.* into effective from app.effective_alert_rule(target.tenant_id, null, 'mini_app_visits_low') r;
    continue when not coalesce(effective.enabled, false);
    min_visits := coalesce((effective.params ->> 'min_visits')::integer, 10);
    min_days := coalesce((effective.params ->> 'min_days')::integer, 7);
    local_day := (p_at at time zone target.timezone)::date;
    month_start := local_day - (extract(day from local_day)::integer - 1);
    days_elapsed := local_day - month_start + 1;
    days_in_month := (month_start + interval '1 month')::date - month_start;
    visits := coalesce((select v.visits from public.mini_app_visits v where v.mini_app_id = target.id and v.month = month_start), 0);
    projected := floor(visits::numeric * days_in_month / days_elapsed)::integer;
    subject := 'mini_app:' || target.id::text || ':' || to_char(month_start, 'YYYY-MM');
    for episode in
      select e.id, e.dedupe_key
      from public.alert_events e
      where e.tenant_id = target.tenant_id
        and e.rule_key = 'mini_app_visits_low'
        and e.state = 'open'
        and e.dedupe_key like 'mini_app_visits_low:mini_app:' || target.id::text || ':%'
    loop
      if episode.dedupe_key <> 'mini_app_visits_low:' || subject then
        perform app.resolve_rule_episode(episode.id, 'superseded', p_at);
      elsif days_elapsed < min_days or projected >= min_visits then
        perform app.resolve_rule_episode(episode.id, 'cleared', p_at);
      end if;
    end loop;
    continue when days_elapsed < min_days or projected >= min_visits;
    continue when exists (
      select 1
      from public.alert_events e
      where e.tenant_id = target.tenant_id
        and e.dedupe_key = 'mini_app_visits_low:' || subject
        and e.state = 'resolved'
    );
    select r.* into raised
    from app.raise_alert(target.tenant_id, 'mini_app_visits_low', subject, p_source, p_at,
      null, null, null, null,
      jsonb_build_object(
        'app_kind', target.kind,
        'visits', visits,
        'projected', projected,
        'min_visits', min_visits,
        'days_elapsed', days_elapsed,
        'days_in_month', days_in_month
      )) r;
    if raised.outcome = 'opened' then
      opened := opened + 1;
    end if;
  end loop;
  return opened;
end;
$$;

comment on function app.evaluate_mini_app_visits(timestamptz, uuid, text) is 'mini_app_visits_low: for each Mini App with visits on record, the month''s visits (tenant zone) projected over the whole month; from min_days into the month, a projection under min_visits (10, ADR-022) opens mini_app:<id>:<month> to the owners with count-only facts (app_kind, visits, projected, min_visits, days_elapsed, days_in_month), repeated with fresh figures while it lasts; resolved as cleared when the projection recovers and as superseded when the month is over; once cleared it is not raised again that month; returns the episodes opened';

create function app.evaluate_staff_rules(p_at timestamptz default now(), p_tenant_id uuid default null, p_source text default 'scheduler')
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  sync_count integer;
  checklist_count integer;
  void_count integer;
  voucher_count integer;
  oa_count integer;
  visit_count integer;
begin
  if p_at is null or p_source is null or p_source not in ('incremental', 'nightly', 'scheduler', 'cli') then
    raise exception 'evaluate_staff_rules needs an instant and the source incremental, nightly, scheduler or cli' using errcode = '22023';
  end if;
  sync_count := app.evaluate_staff_sync(p_at, p_tenant_id, p_source);
  checklist_count := app.evaluate_unfinished_checklists(p_at, p_tenant_id, p_source);
  void_count := app.evaluate_abnormal_voids(p_at, p_tenant_id, p_source);
  voucher_count := app.evaluate_voucher_spikes(p_at, p_tenant_id, p_source);
  oa_count := app.evaluate_oa_activity(p_at, p_tenant_id, p_source);
  visit_count := app.evaluate_mini_app_visits(p_at, p_tenant_id, p_source);
  return jsonb_build_object(
    'staff_sync_stale', sync_count,
    'checklist_unfinished', checklist_count,
    'abnormal_voids', void_count,
    'voucher_spike', voucher_count,
    'oa_inactive', oa_count,
    'mini_app_visits_low', visit_count
  );
end;
$$;

comment on function app.evaluate_staff_rules(timestamptz, uuid, text) is 'the phase 15 staff rules and activity monitors in one call, for every tenant with an active or failing, enabled destination or only p_tenant_id: staff_sync_stale, checklist_unfinished, abnormal_voids, voucher_spike, oa_inactive and mini_app_visits_low, each with its own episodes; run after each incremental sync of the tenant (source incremental) and by the nightly job (source nightly); the rules'' episodes and cool-downs are those of app.raise_alert; returns the count-only object of episodes opened per rule; 22023 for another source';

create function app.due_staff_digests(p_at timestamptz, p_tenant_id uuid default null)
returns table (
  tenant_id uuid,
  business_date date,
  scope_key text,
  store_ids uuid[],
  visibility text,
  run_as uuid,
  channel_ids uuid[],
  due_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  with digest_rule as (
    select t.id as tenant_id, t.staff_revenue_visibility as visibility, r.params
    from public.tenants t
    cross join lateral app.effective_alert_rule(t.id, null, 'staff_daily_digest') r
    where (p_tenant_id is null or t.id = p_tenant_id)
      and r.enabled
      and 'staff' = any (r.roles)
  ),
  destinations as (
    select
      c.id as channel_id,
      c.tenant_id,
      c.user_id,
      c.linked_at,
      c.store_ids as channel_store_ids,
      m.store_ids as member_store_ids,
      dr.visibility,
      dr.params
    from digest_rule dr
    join public.notification_channels c on c.tenant_id = dr.tenant_id
    join public.tenant_members m on m.tenant_id = c.tenant_id and m.user_id = c.user_id
    where m.role = 'staff'
      and c.kind <> 'webhook'
      and c.enabled
      and c.status in ('active', 'failing')
      and not ('staff_daily_digest' = any (c.muted_rules))
      and app.has_active_consent(c.tenant_id, 'staff', c.user_id, 'notifications')
  ),
  scoped as (
    select d.*, sc.ids, sc.yesterday, sc.link_date
    from destinations d
    cross join lateral (
      select
        array_agg(s.id order by s.id::text) as ids,
        min(((p_at at time zone s.timezone) - make_interval(mins => s.business_day_start_minutes))::date) - 1 as yesterday,
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
    select sd.*
    from scoped sd
    where sd.yesterday >= sd.link_date - 1
      and not exists (
        select 1
        from public.outbound_messages o
        where o.channel_id = sd.channel_id
          and o.kind = 'staff_digest'
          and o.business_date = sd.yesterday
          and o.status <> 'cancelled'
      )
  ),
  scope_groups as (
    select
      c.tenant_id,
      c.yesterday as business_date,
      md5(array_to_string(c.ids, ',')) as scope_key,
      c.ids as store_ids,
      c.visibility,
      (array_agg(c.user_id order by c.user_id::text))[1] as run_as,
      array_agg(c.channel_id order by c.channel_id::text) as channel_ids,
      (array_agg(c.params))[1] as params
    from candidates c
    group by c.tenant_id, c.yesterday, c.ids, c.visibility
  ),
  timed as (
    select
      g.*,
      (
        select max(greatest(
          ((g.business_date + 1) + make_interval(mins => s.business_day_start_minutes)) at time zone s.timezone,
          ((g.business_date + 1) + coalesce((g.params ->> 'deadline_local')::time, time '07:00')) at time zone s.timezone
        ))
        from public.stores s
        where s.id = any (g.store_ids)
      ) as due_at,
      (
        select bool_and(app.opening_hours_known(s.opening_hours) and app.opening_minutes(s.opening_hours, g.business_date) = 0)
        from public.stores s
        where s.id = any (g.store_ids)
      ) as all_closed
    from scope_groups g
  )
  select t.tenant_id, t.business_date, t.scope_key, t.store_ids, t.visibility, t.run_as, t.channel_ids, t.due_at
  from timed t
  where t.due_at <= p_at
    and not t.all_closed
  order by t.tenant_id, t.business_date, t.scope_key;
$$;

comment on function app.due_staff_digests(timestamptz, uuid) is 'the staff digests due at p_at: destinations of members with role staff (never an owner, manager or viewer, so a staff scope never shares a model with one) when staff_daily_digest is enabled, not muted and the member holds the notifications consent, grouped by tenant and store set (the member''s active stores narrowed by the destination); for yesterday of the scope''s earliest store, not before the day before the earliest link, once every store passed the later of its business-day end and deadline_local on the next day, unless every store was scheduled closed, and only for destinations without a staff_digest message of that date; visibility is the tenant''s staff_revenue_visibility, and the builder renders the model as run_as, so RLS gives it only the figures the owner allows';

create function app.enqueue_staff_digest_message(
  p_channel_id uuid,
  p_business_date date,
  p_store_ids uuid[],
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
  destination record;
  effective record;
  v_visibility text;
begin
  if p_business_date is null or p_body is null or p_at is null then
    raise exception 'enqueue_staff_digest_message needs a business date, the rendered body and an instant' using errcode = '22023';
  end if;
  select c.id, c.tenant_id, c.user_id, c.muted_rules, m.role, m.store_ids into destination
  from public.notification_channels c
  join public.tenant_members m on m.tenant_id = c.tenant_id and m.user_id = c.user_id
  where c.id = p_channel_id;
  if not found or destination.role <> 'staff' then
    raise exception 'the staff digest goes to a destination of a staff member only' using errcode = '22023';
  end if;
  if p_store_ids is null or cardinality(p_store_ids) not between 1 and 50 or array_position(p_store_ids, null) is not null
     or exists (
       select 1
       from unnest(p_store_ids) as x (id)
       where not exists (select 1 from public.stores s where s.id = x.id and s.tenant_id = destination.tenant_id)
          or (destination.store_ids is not null and not (x.id = any (destination.store_ids)))
     ) then
    raise exception 'the staff digest covers 1 to 50 stores of the member''s scope' using errcode = '22023';
  end if;
  select r.* into effective from app.effective_alert_rule(destination.tenant_id, null, 'staff_daily_digest') r;
  if not coalesce(effective.enabled, false) or 'staff_daily_digest' = any (destination.muted_rules) then
    return null;
  end if;
  select t.staff_revenue_visibility into v_visibility from public.tenants t where t.id = destination.tenant_id;
  return app.enqueue_message(
    destination.tenant_id,
    destination.id,
    'staff_digest',
    'staff_digest.v1',
    'staff_digest:' || destination.id::text || ':' || to_char(p_business_date, 'YYYY-MM-DD'),
    jsonb_build_object('store_count', cardinality(p_store_ids), 'visibility', v_visibility, 'business_date', to_char(p_business_date, 'YYYY-MM-DD')),
    p_title,
    p_body,
    effective.severity,
    case when cardinality(p_store_ids) = 1 then p_store_ids[1] end,
    p_business_date,
    null,
    null,
    p_at + interval '24 hours',
    p_at
  );
end;
$$;

comment on function app.enqueue_staff_digest_message(uuid, date, uuid[], text, text, timestamptz) is 'enqueues the pre-rendered staff form of the daily digest for one destination of a staff member (22023 for any other destination or for stores outside the member''s scope): dedupe key staff_digest:<destination>:<date>, template staff_digest.v1, count-only parameters (store_count, visibility, business_date), expiring after 24 hours; null when the rule is disabled for the tenant or muted on the destination; a repeat returns the first message''s id';

revoke all on function app.guard_digest_roles() from public, anon, authenticated, service_role;
revoke all on function app.record_mini_app_visit(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.zalo_session_visit(uuid, text) from public, anon, authenticated;
revoke all on function app.record_oa_follower_activity() from public, anon, authenticated, service_role;
revoke all on function app.resolve_rule_episode(uuid, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function app.checklist_phase_end(uuid, date, text) from public, anon, authenticated, service_role;
revoke all on function app.evaluate_staff_sync(timestamptz, uuid, text) from public, anon, authenticated, service_role;
revoke all on function app.evaluate_unfinished_checklists(timestamptz, uuid, text) from public, anon, authenticated, service_role;
revoke all on function app.evaluate_abnormal_voids(timestamptz, uuid, text) from public, anon, authenticated, service_role;
revoke all on function app.evaluate_voucher_spikes(timestamptz, uuid, text) from public, anon, authenticated, service_role;
revoke all on function app.evaluate_oa_activity(timestamptz, uuid, text) from public, anon, authenticated, service_role;
revoke all on function app.evaluate_mini_app_visits(timestamptz, uuid, text) from public, anon, authenticated, service_role;
revoke all on function app.evaluate_staff_rules(timestamptz, uuid, text) from public, anon, authenticated, service_role;
revoke all on function app.due_staff_digests(timestamptz, uuid) from public, anon, authenticated, service_role;
revoke all on function app.enqueue_staff_digest_message(uuid, date, uuid[], text, text, timestamptz) from public, anon, authenticated, service_role;

grant execute on function app.record_mini_app_visit(uuid, text, timestamptz) to service_role;
grant execute on function public.zalo_session_visit(uuid, text) to service_role;
