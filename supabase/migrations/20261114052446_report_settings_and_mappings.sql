create table public.report_settings (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  menu_window_days smallint not null default 28 check (menu_window_days between 7 and 91),
  menu_popularity_factor numeric(4, 3) not null default 0.700 check (menu_popularity_factor between 0.100 and 1.000),
  menu_low_sample_items smallint not null default 10 check (menu_low_sample_items between 2 and 50),
  cash_abs_threshold numeric(14, 2) not null default 50000 check (cash_abs_threshold >= 0),
  cash_rel_threshold numeric(6, 4) not null default 0.0050 check (cash_rel_threshold between 0 and 0.1000),
  peak_hours smallint not null default 3 check (peak_hours between 1 and 6),
  dead_hour_ratio numeric(4, 3) not null default 0.500 check (dead_hour_ratio between 0.100 and 0.900),
  busy_hour_ratio numeric(4, 3) not null default 1.250 check (busy_hour_ratio between 1.050 and 3.000),
  promo_pre_weeks smallint not null default 4 check (promo_pre_weeks between 2 and 8),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.report_settings is 'report thresholds of a tenant; a tenant without a row uses the column defaults';

create table public.item_category_overrides (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  pos_account_id uuid not null,
  item_external_id text not null,
  item_type_external_id text not null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (pos_account_id, item_external_id),
  foreign key (tenant_id, pos_account_id) references public.pos_accounts (tenant_id, id) on delete cascade,
  foreign key (pos_account_id, item_type_external_id) references public.item_types (pos_account_id, external_id) on delete cascade
);

comment on column public.item_category_overrides.item_external_id is 'the item key of agg_item_daily: coalesce(invoice_lines.item_external_id, invoice_lines.item_name)';
comment on column public.item_category_overrides.item_type_external_id is 'a POS item type of the same account that replaces the item''s own type in reports';

create index item_category_overrides_tenant_id_idx on public.item_category_overrides (tenant_id);

alter table public.tenants
  add column analytics_inputs_version bigint not null default 0,
  add column analytics_inputs_changed_at timestamptz,
  add column analytics_pending_from date,
  add column analytics_pending_to date,
  add constraint tenants_analytics_pending_range check (
    (analytics_pending_from is null and analytics_pending_to is null)
    or (analytics_pending_from is not null and analytics_pending_to is not null and analytics_pending_from <= analytics_pending_to)
  );

comment on column public.tenants.analytics_inputs_version is 'incremented by every write to a mapping or rate table that refresh-time aggregates read';
comment on column public.tenants.analytics_pending_from is 'first business date whose refresh-time aggregates may still use earlier mappings; null when caught up';

alter table public.item_costs add column updated_by uuid default auth.uid() references auth.users (id) on delete set null;
alter table public.payment_fee_rates add column updated_by uuid default auth.uid() references auth.users (id) on delete set null;
alter table public.item_type_roles add column updated_by uuid default auth.uid() references auth.users (id) on delete set null;
alter table public.targets add column updated_by uuid default auth.uid() references auth.users (id) on delete set null;

update public.item_costs set updated_by = created_by;
update public.payment_fee_rates set updated_by = created_by;
update public.item_type_roles set updated_by = created_by;
update public.targets set updated_by = created_by;

create function app.set_updated_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

create function app.touch_analytics_inputs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.tenants
  set analytics_inputs_version = analytics_inputs_version + 1,
      analytics_inputs_changed_at = now(),
      analytics_pending_from = date '2023-01-01',
      analytics_pending_to = current_date + 1
  where id = case tg_op when 'DELETE' then old.tenant_id else new.tenant_id end;
  return null;
end;
$$;

create trigger report_settings_set_updated_at
before update on public.report_settings
for each row execute function app.set_updated_at();

create trigger report_settings_keep_created_by
before update on public.report_settings
for each row execute function app.keep_created_by();

create trigger item_category_overrides_set_updated_at
before update on public.item_category_overrides
for each row execute function app.set_updated_at();

create trigger item_category_overrides_keep_created_by
before update on public.item_category_overrides
for each row execute function app.keep_created_by();

create trigger item_costs_set_updated_by
before insert or update on public.item_costs
for each row execute function app.set_updated_by();

create trigger payment_fee_rates_set_updated_by
before insert or update on public.payment_fee_rates
for each row execute function app.set_updated_by();

create trigger item_type_roles_set_updated_by
before insert or update on public.item_type_roles
for each row execute function app.set_updated_by();

create trigger targets_set_updated_by
before insert or update on public.targets
for each row execute function app.set_updated_by();

create trigger report_settings_set_updated_by
before insert or update on public.report_settings
for each row execute function app.set_updated_by();

create trigger item_category_overrides_set_updated_by
before insert or update on public.item_category_overrides
for each row execute function app.set_updated_by();

create trigger item_type_roles_touch_analytics_inputs
after insert or update or delete on public.item_type_roles
for each row execute function app.touch_analytics_inputs();

create trigger item_category_overrides_touch_analytics_inputs
after insert or update or delete on public.item_category_overrides
for each row execute function app.touch_analytics_inputs();

create trigger payment_fee_rates_touch_analytics_inputs
after insert or update or delete on public.payment_fee_rates
for each row execute function app.touch_analytics_inputs();

create function app.opening_hours_present(p_opening_hours jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (
    select 1
    from jsonb_each(case when jsonb_typeof(p_opening_hours) = 'object' then p_opening_hours else '{}'::jsonb end) as d (weekday, spans)
    cross join lateral jsonb_array_elements(case when jsonb_typeof(d.spans) = 'array' then d.spans else '[]'::jsonb end) as s (span)
    where d.weekday = any (array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
      and jsonb_typeof(s.span) = 'array'
      and coalesce(s.span ->> 0, '') ~ '^[0-9]{1,2}:[0-9]{2}$'
      and coalesce(s.span ->> 1, '') ~ '^[0-9]{1,2}:[0-9]{2}$'
  );
$$;

create function app.store_report_settings(store_ids uuid[])
returns table (
  store_id uuid,
  tenant_id uuid,
  has_tenant_row boolean,
  menu_window_days integer,
  menu_popularity_factor numeric,
  menu_low_sample_items integer,
  cash_abs_threshold numeric,
  cash_rel_threshold numeric,
  z_threshold numeric,
  peak_hours integer,
  dead_hour_ratio numeric,
  busy_hour_ratio numeric,
  promo_pre_weeks integer
)
language sql
stable
security invoker
rows 10
set search_path = ''
as $$
  select
    v.store_id,
    s.tenant_id,
    r.tenant_id is not null,
    coalesce(r.menu_window_days, 28)::integer,
    coalesce(r.menu_popularity_factor, 0.700)::numeric,
    coalesce(r.menu_low_sample_items, 10)::integer,
    coalesce(r.cash_abs_threshold, 50000)::numeric,
    coalesce(r.cash_rel_threshold, 0.0050)::numeric,
    2::numeric,
    coalesce(r.peak_hours, 3)::integer,
    coalesce(r.dead_hour_ratio, 0.500)::numeric,
    coalesce(r.busy_hour_ratio, 1.250)::numeric,
    coalesce(r.promo_pre_weeks, 4)::integer
  from app.visible_stores(store_report_settings.store_ids) v
  join public.stores s on s.id = v.store_id
  left join public.report_settings r on r.tenant_id = s.tenant_id
  order by v.store_position;
$$;

create function app.item_category_map(store_ids uuid[])
returns table (pos_account_id uuid, item_key text, item_type_external_id text, item_type_name text)
language sql
stable
security invoker
set search_path = ''
as $$
  select o.pos_account_id, o.item_external_id, o.item_type_external_id, t.name
  from public.item_category_overrides o
  join public.item_types t
    on t.pos_account_id = o.pos_account_id
   and t.external_id = o.item_type_external_id
  where o.pos_account_id in (
    select s.pos_account_id
    from app.visible_stores(item_category_map.store_ids) v
    join public.stores s on s.id = v.store_id
  );
$$;

create function public.report_settings_of(store_ids uuid[])
returns table (
  store_id uuid,
  tenant_id uuid,
  has_tenant_row boolean,
  menu_window_days integer,
  menu_popularity_factor numeric,
  menu_low_sample_items integer,
  cash_abs_threshold numeric,
  cash_rel_threshold numeric,
  z_threshold numeric,
  peak_hours integer,
  dead_hour_ratio numeric,
  busy_hour_ratio numeric,
  promo_pre_weeks integer,
  seat_count integer,
  opening_hours_known boolean,
  fee_rates_configured boolean,
  costs_configured boolean,
  roles_configured boolean
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform app.require_store_ids('report_settings_of', report_settings_of.store_ids);
  return query
  select
    r.store_id,
    r.tenant_id,
    r.has_tenant_row,
    r.menu_window_days,
    r.menu_popularity_factor,
    r.menu_low_sample_items,
    r.cash_abs_threshold,
    r.cash_rel_threshold,
    r.z_threshold,
    r.peak_hours,
    r.dead_hour_ratio,
    r.busy_hour_ratio,
    r.promo_pre_weeks,
    s.seat_count,
    app.opening_hours_present(s.opening_hours),
    exists (
      select 1
      from public.payment_fee_rates f
      where f.tenant_id = s.tenant_id
        and (f.store_id is null or f.store_id = s.id)
    ),
    exists (
      select 1
      from public.item_costs c
      where c.tenant_id = s.tenant_id
        and (c.store_id is null or c.store_id = s.id)
    ),
    exists (
      select 1
      from public.item_type_roles itr
      where itr.pos_account_id = s.pos_account_id
    )
  from app.store_report_settings(report_settings_of.store_ids) with ordinality as r (
    store_id, tenant_id, has_tenant_row, menu_window_days, menu_popularity_factor, menu_low_sample_items,
    cash_abs_threshold, cash_rel_threshold, z_threshold, peak_hours, dead_hour_ratio, busy_hour_ratio,
    promo_pre_weeks, store_order
  )
  join public.stores s on s.id = r.store_id
  order by r.store_order;
end;
$$;

create function public.analytics_catch_up_status(p_tenant_id uuid)
returns table (
  tenant_id uuid,
  inputs_changed_at timestamptz,
  history_from date,
  history_to date,
  pending_from date,
  pending_to date,
  pending_days integer,
  can_refresh boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with tenant as (
    select t.id, t.analytics_inputs_changed_at, t.analytics_pending_from, t.analytics_pending_to
    from public.tenants t
    where t.id = analytics_catch_up_status.p_tenant_id
      and t.id = any ((select app.current_user_data_tenant_ids())::uuid[])
  ),
  history as (
    select min(a.business_date) as history_from
    from public.agg_daily_sales a
    join public.stores s on s.id = a.store_id
    where s.tenant_id = analytics_catch_up_status.p_tenant_id
  ),
  pending as (
    select
      tenant.*,
      history.history_from,
      greatest(tenant.analytics_pending_from, history.history_from) as effective_from
    from tenant
    cross join history
  )
  select
    p.id,
    p.analytics_inputs_changed_at,
    p.history_from,
    current_date,
    case when p.analytics_pending_to is not null and p.effective_from <= p.analytics_pending_to then p.effective_from end,
    case when p.analytics_pending_to is not null and p.effective_from <= p.analytics_pending_to then p.analytics_pending_to end,
    case
      when p.analytics_pending_to is not null and p.effective_from <= p.analytics_pending_to
        then (p.analytics_pending_to - p.effective_from + 1)::integer
      else 0
    end,
    app.has_tenant_role(p.id, array['owner', 'manager']::public.tenant_role[])
  from pending p;
$$;

alter table public.report_settings enable row level security;
alter table public.item_category_overrides enable row level security;

create policy report_settings_select_for_data_members on public.report_settings
  for select to authenticated
  using (tenant_id = any ((select app.current_user_data_tenant_ids())::uuid[]));

create policy report_settings_insert_for_unlimited_owners on public.report_settings
  for insert to authenticated
  with check (
    app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[])
    and created_by = (select auth.uid())
  );

create policy report_settings_update_for_unlimited_owners on public.report_settings
  for update to authenticated
  using (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]))
  with check (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]));

create policy report_settings_delete_for_unlimited_owners on public.report_settings
  for delete to authenticated
  using (app.has_store_scope(tenant_id, null, array['owner']::public.tenant_role[]));

create policy item_category_overrides_select_for_data_members on public.item_category_overrides
  for select to authenticated
  using (tenant_id = any ((select app.current_user_data_tenant_ids())::uuid[]));

create policy item_category_overrides_insert_for_tenant_managers on public.item_category_overrides
  for insert to authenticated
  with check (
    app.can_manage_store_scope(tenant_id, null)
    and created_by = (select auth.uid())
  );

create policy item_category_overrides_update_for_tenant_managers on public.item_category_overrides
  for update to authenticated
  using (app.can_manage_store_scope(tenant_id, null))
  with check (app.can_manage_store_scope(tenant_id, null));

create policy item_category_overrides_delete_for_tenant_managers on public.item_category_overrides
  for delete to authenticated
  using (app.can_manage_store_scope(tenant_id, null));

grant select, insert, update, delete on public.report_settings, public.item_category_overrides to authenticated;

revoke all on function app.set_updated_by() from public;
revoke all on function app.touch_analytics_inputs() from public, anon, authenticated, service_role;
revoke all on function app.opening_hours_present(jsonb) from public;
revoke all on function app.store_report_settings(uuid[]) from public;
revoke all on function app.item_category_map(uuid[]) from public;
revoke all on function public.report_settings_of(uuid[]) from public, anon;
revoke all on function public.analytics_catch_up_status(uuid) from public, anon;

grant execute on function app.opening_hours_present(jsonb) to authenticated, service_role;
grant execute on function app.store_report_settings(uuid[]) to authenticated, service_role;
grant execute on function app.item_category_map(uuid[]) to authenticated, service_role;
grant execute on function public.report_settings_of(uuid[]) to authenticated, service_role;
grant execute on function public.analytics_catch_up_status(uuid) to authenticated, service_role;
