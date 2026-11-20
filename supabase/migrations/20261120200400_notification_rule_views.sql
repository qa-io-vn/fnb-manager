create function public.effective_alert_rules(p_tenant_id uuid, p_store_id uuid default null)
returns table (
  rule_key text,
  category text,
  delivery text,
  enabled boolean,
  severity public.alert_severity,
  roles public.tenant_role[],
  params jsonb,
  cooldown interval,
  source text,
  override_id uuid,
  tenant_override_id uuid,
  store_scoped boolean,
  sort_order integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.rule_key,
    c.category,
    c.delivery,
    coalesce(s.enabled, t.enabled, c.default_enabled),
    coalesce(s.severity, t.severity, c.default_severity),
    coalesce(s.roles, t.roles, c.default_roles),
    c.default_params || coalesce(t.params, '{}'::jsonb) || coalesce(s.params, '{}'::jsonb),
    coalesce(s.cooldown, t.cooldown, c.default_cooldown),
    case when s.id is not null then 'store' when t.id is not null then 'tenant' else 'catalogue' end,
    coalesce(s.id, t.id),
    t.id,
    c.store_scoped,
    c.sort_order
  from public.alert_rule_catalog c
  left join public.alert_rules t
    on t.tenant_id = p_tenant_id
   and t.store_id is null
   and t.rule_key = c.rule_key
  left join public.alert_rules s
    on p_store_id is not null
   and s.tenant_id = p_tenant_id
   and s.store_id = p_store_id
   and s.rule_key = c.rule_key
  order by c.sort_order, c.rule_key;
$$;

comment on function public.effective_alert_rules(uuid, uuid) is 'every catalogue rule as it applies to the tenant (and to one store when p_store_id is given), read as the caller under row-level security: enabled, severity, roles and cool-down from the store row over the tenant row over the catalogue, parameters merged key by key, source catalogue, tenant or store, override_id of the most specific override and tenant_override_id; a caller who cannot read an override sees the catalogue default instead';

create function public.effective_channel_policies(p_tenant_id uuid)
returns table (
  channel_kind public.channel_kind,
  message_class public.message_class,
  allowed boolean,
  window_start time,
  window_end time,
  max_per_day smallint,
  cap_window text,
  max_per_month smallint,
  critical_bypass boolean,
  label text,
  label_position text,
  requires_consent boolean,
  api_send_allowed boolean,
  source text,
  policy_id uuid,
  note text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (p.channel_kind, p.message_class)
    p.channel_kind,
    p.message_class,
    p.allowed,
    p.window_start,
    p.window_end,
    p.max_per_day,
    p.cap_window,
    p.max_per_month,
    p.critical_bypass,
    p.label,
    p.label_position,
    p.requires_consent,
    p.api_send_allowed,
    case when p.tenant_id is null then 'global' else 'tenant' end,
    p.id,
    p.source_note
  from public.channel_policies p
  where p.tenant_id = p_tenant_id or p.tenant_id is null
  order by p.channel_kind, p.message_class, p.tenant_id is null;
$$;

comment on function public.effective_channel_policies(uuid) is 'per channel kind and message class the policy in force for the tenant, read as the caller under row-level security: the tenant override when the caller can read it, else the global row, with its source (global or tenant), id and note';

revoke all on function public.effective_alert_rules(uuid, uuid) from public, anon, service_role;
revoke all on function public.effective_channel_policies(uuid) from public, anon, service_role;
grant execute on function public.effective_alert_rules(uuid, uuid) to authenticated;
grant execute on function public.effective_channel_policies(uuid) to authenticated;
