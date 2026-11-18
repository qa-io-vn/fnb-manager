alter table public.tenants
  add column staff_revenue_visibility text not null default 'all' check (staff_revenue_visibility in ('none', 'store_totals', 'all'));

comment on column public.tenants.staff_revenue_visibility is 'what members with role staff may read of revenue (FR-STF-13): none (no invoice, line, payment, shift, sync check or aggregate row, so report functions and metric_value return nothing), store_totals (as none, plus today''s net revenue and invoice count of their stores through today_store_totals) or all (every revenue row of their stores); owners, managers and viewers are not affected; written by an owner with an unlimited scope through set_staff_revenue_visibility';

create or replace function app.stamp_tenant_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.legal_form, new.default_language, new.staff_revenue_visibility)
       is distinct from (old.legal_form, old.default_language, old.staff_revenue_visibility) then
    new.profile_updated_at := now();
    new.profile_updated_by := (select auth.uid());
  end if;
  return new;
end;
$$;

create function app.current_user_revenue_store_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(s.id), '{}'::uuid[])
  from public.stores s
  join public.tenant_members m on m.tenant_id = s.tenant_id
  join public.tenants t on t.id = m.tenant_id
  where m.user_id = (select auth.uid())
    and m.role = any (app.data_roles())
    and (m.role <> 'staff' or t.staff_revenue_visibility = 'all')
    and (m.store_ids is null or s.id = any (m.store_ids));
$$;

comment on function app.current_user_revenue_store_ids() is 'stores whose revenue rows the caller may read: the stores in scope of a data role, without those of a staff membership unless the tenant''s staff_revenue_visibility is all';

alter policy invoices_select_for_data_store_readers on public.invoices
  using (store_id = any ((select app.current_user_revenue_store_ids())::uuid[]));
alter policy invoice_lines_select_for_data_store_readers on public.invoice_lines
  using (store_id = any ((select app.current_user_revenue_store_ids())::uuid[]));
alter policy invoice_payments_select_for_data_store_readers on public.invoice_payments
  using (store_id = any ((select app.current_user_revenue_store_ids())::uuid[]));
alter policy invoice_events_select_for_data_store_readers on public.invoice_events
  using (store_id = any ((select app.current_user_revenue_store_ids())::uuid[]));
alter policy shifts_select_for_data_store_readers on public.shifts
  using (store_id = any ((select app.current_user_revenue_store_ids())::uuid[]));
alter policy sync_checks_select_for_data_store_readers on public.sync_checks
  using (store_id = any ((select app.current_user_revenue_store_ids())::uuid[]));
alter policy agg_daily_sales_select_for_data_store_readers on public.agg_daily_sales
  using (store_id = any ((select app.current_user_revenue_store_ids())::uuid[]));
alter policy agg_hourly_sales_select_for_data_store_readers on public.agg_hourly_sales
  using (store_id = any ((select app.current_user_revenue_store_ids())::uuid[]));
alter policy agg_item_daily_select_for_data_store_readers on public.agg_item_daily
  using (store_id = any ((select app.current_user_revenue_store_ids())::uuid[]));
alter policy agg_category_daily_select_for_data_store_readers on public.agg_category_daily
  using (store_id = any ((select app.current_user_revenue_store_ids())::uuid[]));
alter policy agg_payment_daily_select_for_data_store_readers on public.agg_payment_daily
  using (store_id = any ((select app.current_user_revenue_store_ids())::uuid[]));
alter policy agg_shift_cash_select_for_data_store_readers on public.agg_shift_cash
  using (store_id = any ((select app.current_user_revenue_store_ids())::uuid[]));
alter policy agg_size_mix_daily_select_for_data_store_readers on public.agg_size_mix_daily
  using (store_id = any ((select app.current_user_revenue_store_ids())::uuid[]));
alter policy agg_modifier_prefs_daily_select_for_data_store_readers on public.agg_modifier_prefs_daily
  using (store_id = any ((select app.current_user_revenue_store_ids())::uuid[]));
alter policy agg_basket_pairs_28d_select_for_data_store_readers on public.agg_basket_pairs_28d
  using (store_id = any ((select app.current_user_revenue_store_ids())::uuid[]));
alter policy agg_attach_daily_select_for_data_store_readers on public.agg_attach_daily
  using (store_id = any ((select app.current_user_revenue_store_ids())::uuid[]));

create function app.set_staff_revenue_visibility(p_tenant_id uuid, p_visibility text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not app.has_store_scope(p_tenant_id, null, array['owner']::public.tenant_role[]) then
    raise exception 'only an owner with every store may set the staff revenue visibility' using errcode = '42501';
  end if;
  if p_visibility is null or p_visibility not in ('none', 'store_totals', 'all') then
    raise exception 'the staff revenue visibility is none, store_totals or all' using errcode = '22023';
  end if;
  update public.tenants t
  set staff_revenue_visibility = p_visibility
  where t.id = p_tenant_id;
  return p_visibility;
end;
$$;

comment on function app.set_staff_revenue_visibility(uuid, text) is 'sets tenants.staff_revenue_visibility as an owner with an unlimited scope and returns the level; the profile stamps record who changed it';

create function app.today_store_totals()
returns table (store_id uuid, business_date date, net_amount numeric, invoices bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, d.business_date, coalesce(sum(x.net_amount), 0), coalesce(sum(x.invoices), 0)::bigint
  from public.tenant_members m
  join public.tenants t on t.id = m.tenant_id
  join public.stores s on s.tenant_id = m.tenant_id and (m.store_ids is null or s.id = any (m.store_ids))
  cross join lateral (
    select ((now() at time zone s.timezone) - make_interval(mins => s.business_day_start_minutes))::date as business_date
  ) d
  left join lateral app.daily_sales(array[s.id], d.business_date, d.business_date) x on true
  where m.user_id = (select auth.uid())
    and m.role = any (app.data_roles())
    and (m.role <> 'staff' or t.staff_revenue_visibility in ('store_totals', 'all'))
  group by s.id, d.business_date
  order by s.id;
$$;

comment on function app.today_store_totals() is 'today''s net revenue and invoice count (voided invoices excluded, as Hôm nay counts them) of each store in the caller''s scope, by each store''s own business date; a staff membership gets rows only when its tenant''s staff_revenue_visibility is store_totals or all, the publisher none; security definer so that it is the only revenue a staff member reads with store_totals';

create function public.set_staff_revenue_visibility(p_tenant_id uuid, p_visibility text)
returns text
language sql
volatile
set search_path = ''
as $$
  select app.set_staff_revenue_visibility(p_tenant_id, p_visibility);
$$;

comment on function public.set_staff_revenue_visibility(uuid, text) is 'RPC: app.set_staff_revenue_visibility';

create function public.today_store_totals()
returns table (store_id uuid, business_date date, net_amount numeric, invoices bigint)
language sql
stable
set search_path = ''
as $$
  select t.store_id, t.business_date, t.net_amount, t.invoices from app.today_store_totals() t;
$$;

comment on function public.today_store_totals() is 'RPC for the staff app''s home card: app.today_store_totals';

create function app.ops_can_read(tenant_id uuid, store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_store_scope(ops_can_read.tenant_id, ops_can_read.store_id, array['owner', 'manager', 'staff']::public.tenant_role[]);
$$;

comment on function app.ops_can_read(uuid, uuid) is 'operations RLS: an owner, manager or staff member of the tenant with the store in scope; a null store needs an unlimited scope; viewers and publishers never';

create function app.ops_can_write_own(tenant_id uuid, store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_store_scope(ops_can_write_own.tenant_id, ops_can_write_own.store_id, array['owner', 'manager', 'staff']::public.tenant_role[]);
$$;

comment on function app.ops_can_write_own(uuid, uuid) is 'operations RLS: may write the caller''s own operations rows of the store (owner, manager or staff with the store in scope); policies pair it with created_by = auth.uid()';

create function app.ops_can_manage(tenant_id uuid, store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_store_scope(ops_can_manage.tenant_id, ops_can_manage.store_id, array['owner', 'manager']::public.tenant_role[]);
$$;

comment on function app.ops_can_manage(uuid, uuid) is 'operations RLS: may manage every operations row of the store (owner or manager with the store in scope)';

create function app.current_user_ops_store_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(s.id), '{}'::uuid[])
  from public.stores s
  join public.tenant_members m on m.tenant_id = s.tenant_id
  where m.user_id = (select auth.uid())
    and m.role = any (array['owner', 'manager', 'staff']::public.tenant_role[])
    and (m.store_ids is null or s.id = any (m.store_ids));
$$;

comment on function app.current_user_ops_store_ids() is 'operations RLS: the stores for which app.ops_can_read is true, as one array the read policies of operations tables evaluate once per statement';

revoke all on function app.current_user_revenue_store_ids() from public, anon;
revoke all on function app.set_staff_revenue_visibility(uuid, text) from public, anon, service_role;
revoke all on function app.today_store_totals() from public, anon, service_role;
revoke all on function public.set_staff_revenue_visibility(uuid, text) from public, anon, service_role;
revoke all on function public.today_store_totals() from public, anon, service_role;
revoke all on function app.ops_can_read(uuid, uuid) from public, anon;
revoke all on function app.ops_can_write_own(uuid, uuid) from public, anon;
revoke all on function app.ops_can_manage(uuid, uuid) from public, anon;
revoke all on function app.current_user_ops_store_ids() from public, anon;

grant execute on function app.current_user_revenue_store_ids() to authenticated;
grant execute on function app.set_staff_revenue_visibility(uuid, text) to authenticated;
grant execute on function app.today_store_totals() to authenticated;
grant execute on function public.set_staff_revenue_visibility(uuid, text) to authenticated;
grant execute on function public.today_store_totals() to authenticated;
grant execute on function app.ops_can_read(uuid, uuid) to authenticated;
grant execute on function app.ops_can_write_own(uuid, uuid) to authenticated;
grant execute on function app.ops_can_manage(uuid, uuid) to authenticated;
grant execute on function app.current_user_ops_store_ids() to authenticated;
