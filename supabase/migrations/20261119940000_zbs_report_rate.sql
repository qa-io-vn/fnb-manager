insert into public.alert_rule_catalog (rule_key, category, delivery, default_enabled, default_severity, default_roles, default_params, params_schema, default_cooldown, remind_every, notify_on_resolve, store_scoped, sort_order)
values
  ('zbs_report_rate', 'channel', 'immediate', true, 'warning', array['owner']::public.tenant_role[],
    '{"max_rate_percent": 1, "min_sent": 50}',
    '{"max_rate_percent": {"type": "number", "min": 0.1, "max": 2}, "min_sent": {"type": "integer", "min": 1, "max": 100000}}',
    interval '24 hours', null, false, false, 196);

create table app.zbs_quality_days (
  tenant_id uuid not null,
  oa_id uuid not null,
  day date not null,
  reported integer not null check (reported between 0 and 1000000),
  recorded_at timestamptz not null default now(),
  primary key (oa_id, day),
  foreign key (tenant_id, oa_id) references public.oas (tenant_id, id) on delete cascade
);

comment on table app.zbs_quality_days is 'per OA and tenant-local day, how many of the day''s ZBS template messages recipients reported, as the ZBS console or its quality answer shows it; counts only; read by no API role';

create function app.zbs_sent_on(p_oa_id uuid, p_day date)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer
  from public.outbound_messages o
  join public.oas a on a.id = p_oa_id
  join public.tenants t on t.id = a.tenant_id
  where o.tenant_id = a.tenant_id
    and o.subject_type = 'customer'
    and o.channel_id is null
    and o.channel = 'zalo_zbs'
    and o.status in ('sent', 'delivered')
    and o.params ->> 'oa_id' = p_oa_id::text
    and o.sent_at >= p_day::timestamp at time zone t.timezone
    and o.sent_at < (p_day + 1)::timestamp at time zone t.timezone;
$$;

comment on function app.zbs_sent_on(uuid, date) is 'the ZBS template messages of an OA sent on a tenant-local day, from the outbox';

create function app.record_zbs_reports(p_oa_id uuid, p_day date, p_reported integer, p_at timestamptz default now())
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  target public.oas%rowtype;
  effective record;
  sent integer;
  threshold numeric;
  minimum integer;
  rate_permille integer;
  raised record;
begin
  if p_day is null or p_reported is null or p_reported < 0 or p_reported > 1000000 then
    raise exception 'record_zbs_reports needs a day and a report count from 0 to 1,000,000' using errcode = '22023';
  end if;
  select o.* into target from public.oas o where o.id = p_oa_id;
  if not found then
    raise exception 'record_zbs_reports needs a configured OA' using errcode = '22023';
  end if;
  insert into app.zbs_quality_days (tenant_id, oa_id, day, reported, recorded_at)
  values (target.tenant_id, p_oa_id, p_day, p_reported, coalesce(p_at, now()))
  on conflict (oa_id, day) do update set reported = excluded.reported, recorded_at = excluded.recorded_at;
  select r.* into effective from app.effective_alert_rule(target.tenant_id, null, 'zbs_report_rate') r;
  if not coalesce(effective.enabled, false) then
    return 'disabled';
  end if;
  sent := app.zbs_sent_on(p_oa_id, p_day);
  threshold := coalesce((effective.params ->> 'max_rate_percent')::numeric, 1);
  minimum := coalesce((effective.params ->> 'min_sent')::integer, 50);
  if sent < minimum then
    return 'too_few_sent';
  end if;
  rate_permille := round(p_reported * 1000.0 / sent)::integer;
  if p_reported * 100.0 / sent <= threshold then
    return 'below_threshold';
  end if;
  select a.* into raised
  from app.raise_alert(
    target.tenant_id, 'zbs_report_rate', 'oa:' || target.id::text, 'notify', coalesce(p_at, now()),
    null, null, null, p_day,
    jsonb_build_object('sent', sent, 'reported', p_reported, 'rate_permille', rate_permille, 'max_rate_permille', round(threshold * 10)::integer),
    null, true
  ) a;
  return raised.outcome;
end;
$$;

comment on function app.record_zbs_reports(uuid, date, integer, timestamptz) is 'records how many of an OA''s template messages of a tenant-local day were reported and checks the rule zbs_report_rate (FR-NOT-39): with at least min_sent templates sent that day, a report rate above max_rate_percent (1 % by default, below the 2 % at which Zalo lowers the daily quota tier) raises an instant episode under oa:<OA row id> with the count-only facts sent, reported, rate_permille and max_rate_permille; returns the raise_alert outcome, disabled, too_few_sent or below_threshold; 22023 for a missing day, a count outside 0 to 1,000,000 or an unknown OA';

revoke all on table app.zbs_quality_days from public, anon, authenticated, service_role;
revoke all on function app.zbs_sent_on(uuid, date) from public, anon, authenticated, service_role;
revoke all on function app.record_zbs_reports(uuid, date, integer, timestamptz) from public, anon, authenticated, service_role;
