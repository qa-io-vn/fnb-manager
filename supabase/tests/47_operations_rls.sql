begin;
select plan(111);

create temp table fx as
select
  'dddddddd-dddd-4ddd-8ddd-000000004701'::uuid as tenant_x,
  'dddddddd-dddd-4ddd-8ddd-000000004702'::uuid as tenant_y,
  'cccccccc-cccc-4ccc-8ccc-000000004701'::uuid as account_x,
  'cccccccc-cccc-4ccc-8ccc-000000004702'::uuid as account_y,
  'ffffffff-ffff-4fff-8fff-000000004701'::uuid as store_x1,
  'ffffffff-ffff-4fff-8fff-000000004702'::uuid as store_x2,
  'ffffffff-ffff-4fff-8fff-000000004703'::uuid as store_y1,
  'eeeeeeee-eeee-4eee-8eee-000000004701'::uuid as owner_x,
  'eeeeeeee-eeee-4eee-8eee-000000004702'::uuid as owner_x1,
  'eeeeeeee-eeee-4eee-8eee-000000004703'::uuid as manager_xall,
  'eeeeeeee-eeee-4eee-8eee-000000004704'::uuid as manager_x1,
  'eeeeeeee-eeee-4eee-8eee-000000004705'::uuid as staff_x1,
  'eeeeeeee-eeee-4eee-8eee-000000004706'::uuid as staff_xall,
  'eeeeeeee-eeee-4eee-8eee-000000004707'::uuid as viewer_x,
  'eeeeeeee-eeee-4eee-8eee-000000004708'::uuid as publisher_x,
  'eeeeeeee-eeee-4eee-8eee-000000004709'::uuid as owner_y,
  'eeeeeeee-eeee-4eee-8eee-000000004710'::uuid as staff_y1,
  'eeeeeeee-eeee-4eee-8eee-000000004711'::uuid as no_member,
  '11111111-1111-4111-8111-111111111111'::uuid as demo_tenant,
  '22222222-2222-4222-8222-000000000001'::uuid as demo_store_1,
  '22222222-2222-4222-8222-000000000002'::uuid as demo_store_2,
  'eeeeeeee-eeee-4eee-8eee-000000004721'::uuid as demo_owner,
  'eeeeeeee-eeee-4eee-8eee-000000004722'::uuid as demo_manager_1,
  'eeeeeeee-eeee-4eee-8eee-000000004723'::uuid as demo_staff_1,
  'eeeeeeee-eeee-4eee-8eee-000000004724'::uuid as demo_viewer,
  'eeeeeeee-eeee-4eee-8eee-000000004725'::uuid as demo_publisher_1;

insert into auth.users (id, instance_id, aud, role, email)
select u.id, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'ops-rls-' || right(u.id::text, 4) || '@example.com'
from fx
cross join lateral unnest(array[
  fx.owner_x, fx.owner_x1, fx.manager_xall, fx.manager_x1, fx.staff_x1, fx.staff_xall, fx.viewer_x, fx.publisher_x, fx.owner_y, fx.staff_y1,
  fx.no_member, fx.demo_owner, fx.demo_manager_1, fx.demo_staff_1, fx.demo_viewer, fx.demo_publisher_1
]) as u (id);

insert into public.tenants (id, slug, name)
select tenant_x, 'ops-rls-pgtap-x', 'Operations RLS pgTAP X' from fx
union all
select tenant_y, 'ops-rls-pgtap-y', 'Operations RLS pgTAP Y' from fx;

insert into public.pos_accounts (id, tenant_id, connector, account_key, display_name)
select account_x, tenant_x, 'mock', 'ops-rls-account-x', 'Synthetic account X' from fx
union all
select account_y, tenant_y, 'mock', 'ops-rls-account-y', 'Synthetic account Y' from fx;

insert into public.stores (id, tenant_id, pos_account_id, external_id, name, timezone, business_day_start_minutes)
select store_x1, tenant_x, account_x, 'ops-rls-store-x1', 'Synthetic store X1', 'Asia/Ho_Chi_Minh', 0 from fx
union all
select store_x2, tenant_x, account_x, 'ops-rls-store-x2', 'Synthetic store X2', 'America/Los_Angeles', 300 from fx
union all
select store_y1, tenant_y, account_y, 'ops-rls-store-y1', 'Synthetic store Y1', 'Asia/Ho_Chi_Minh', 0 from fx;

insert into public.tenant_members (tenant_id, user_id, role, store_ids)
select fx.tenant_x, m.user_id, m.role::public.tenant_role, m.store_ids
from fx
cross join lateral (
  values
    (fx.owner_x, 'owner', null::uuid[]),
    (fx.owner_x1, 'owner', array[fx.store_x1]),
    (fx.manager_xall, 'manager', null::uuid[]),
    (fx.manager_x1, 'manager', array[fx.store_x1]),
    (fx.staff_x1, 'staff', array[fx.store_x1]),
    (fx.staff_xall, 'staff', null::uuid[]),
    (fx.viewer_x, 'viewer', null::uuid[]),
    (fx.publisher_x, 'publisher', null::uuid[])
) as m (user_id, role, store_ids)
union all
select fx.tenant_y, m.user_id, m.role::public.tenant_role, m.store_ids
from fx
cross join lateral (
  values
    (fx.owner_y, 'owner', null::uuid[]),
    (fx.staff_y1, 'staff', array[fx.store_y1])
) as m (user_id, role, store_ids)
union all
select fx.demo_tenant, m.user_id, m.role::public.tenant_role, m.store_ids
from fx
cross join lateral (
  values
    (fx.demo_owner, 'owner', null::uuid[]),
    (fx.demo_manager_1, 'manager', array[fx.demo_store_1]),
    (fx.demo_staff_1, 'staff', array[fx.demo_store_1]),
    (fx.demo_viewer, 'viewer', null::uuid[]),
    (fx.demo_publisher_1, 'publisher', array[fx.demo_store_1])
) as m (user_id, role, store_ids);

create temp table people as
select v.label, v.id, v.sort
from fx
cross join lateral (
  values
    ('owner_x', fx.owner_x, 1), ('owner_x1', fx.owner_x1, 2), ('manager_xall', fx.manager_xall, 3), ('manager_x1', fx.manager_x1, 4),
    ('staff_x1', fx.staff_x1, 5), ('staff_xall', fx.staff_xall, 6), ('viewer_x', fx.viewer_x, 7), ('publisher_x', fx.publisher_x, 8),
    ('owner_y', fx.owner_y, 9), ('staff_y1', fx.staff_y1, 10), ('no_member', fx.no_member, 11)
) as v (label, id, sort);

create temp table points as
select v.position, v.tenant_id, v.store_id
from fx
cross join lateral (
  values (1, fx.tenant_x, fx.store_x1), (2, fx.tenant_x, fx.store_x2), (3, fx.tenant_x, null::uuid), (4, fx.tenant_y, fx.store_y1), (5, fx.tenant_y, null::uuid)
) as v (position, tenant_id, store_id);

create function pg_temp.act_as(p_user_id uuid)
returns void
language sql
as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
$$;

create function pg_temp.outcome_as(p_user uuid, p_statement text)
returns text
language plpgsql
as $$
declare
  v_rows integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute p_statement;
  get diagnostics v_rows = row_count;
  return 'rows:' || v_rows;
exception when others then
  return sqlstate;
end;
$$;

create function pg_temp.flag(p_value boolean)
returns text
language sql
immutable
as $$
  select case when p_value then 'T' else 'F' end;
$$;

create function pg_temp.helpers_as(p_user uuid)
returns text
language plpgsql
as $$
declare
  v_result text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  select string_agg(pg_temp.flag(app.ops_can_read(p.tenant_id, p.store_id)), '' order by p.position)
    || '|' || string_agg(pg_temp.flag(app.ops_can_write_own(p.tenant_id, p.store_id)), '' order by p.position)
    || '|' || string_agg(pg_temp.flag(app.ops_can_manage(p.tenant_id, p.store_id)), '' order by p.position)
  into v_result
  from points p;
  return v_result;
end;
$$;

create function pg_temp.claims_allow(p_memberships jsonb, p_tenant uuid, p_store uuid, p_roles text[])
returns boolean
language sql
immutable
as $$
  select exists (
    select 1
    from jsonb_array_elements(p_memberships) e
    where (e ->> 'tenant_id')::uuid = p_tenant
      and e ->> 'role' = any (p_roles)
      and case
        when p_store is null then jsonb_typeof(e -> 'store_ids') = 'null'
        else jsonb_typeof(e -> 'store_ids') = 'null' or (e -> 'store_ids') ? p_store::text
      end
  );
$$;

create temp table claims as
select
  pe.label,
  app.custom_access_token_claims(jsonb_build_object('user_id', pe.id, 'claims', jsonb_build_object('sub', pe.id, 'role', 'authenticated'))) -> 'claims' -> 'memberships' as memberships
from people pe;

create temp table claims_answers as
select
  c.label,
  string_agg(pg_temp.flag(pg_temp.claims_allow(c.memberships, p.tenant_id, p.store_id, array['owner', 'manager', 'staff'])), '' order by p.position)
    || '|' || string_agg(pg_temp.flag(pg_temp.claims_allow(c.memberships, p.tenant_id, p.store_id, array['owner', 'manager', 'staff'])), '' order by p.position)
    || '|' || string_agg(pg_temp.flag(pg_temp.claims_allow(c.memberships, p.tenant_id, p.store_id, array['owner', 'manager'])), '' order by p.position) as answer
from claims c
cross join points p
group by c.label;

create temp table expected_helpers as
select *
from (
  values
    ('owner_x', 'TTTFF|TTTFF|TTTFF'),
    ('owner_x1', 'TFFFF|TFFFF|TFFFF'),
    ('manager_xall', 'TTTFF|TTTFF|TTTFF'),
    ('manager_x1', 'TFFFF|TFFFF|TFFFF'),
    ('staff_x1', 'TFFFF|TFFFF|FFFFF'),
    ('staff_xall', 'TTTFF|TTTFF|FFFFF'),
    ('viewer_x', 'FFFFF|FFFFF|FFFFF'),
    ('publisher_x', 'FFFFF|FFFFF|FFFFF'),
    ('owner_y', 'FFFTT|FFFTT|FFFTT'),
    ('staff_y1', 'FFFTF|FFFTF|FFFFF'),
    ('no_member', 'FFFFF|FFFFF|FFFFF')
) as v (label, answer);

create table public.ops_template_pgtap (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  store_id uuid not null,
  label text not null,
  note text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, store_id) references public.stores (tenant_id, id) on delete cascade
);

create trigger ops_template_pgtap_set_updated_at before update on public.ops_template_pgtap for each row execute function app.set_updated_at();
create trigger ops_template_pgtap_keep_created_by before update on public.ops_template_pgtap for each row execute function app.keep_created_by();

alter table public.ops_template_pgtap enable row level security;

create policy ops_template_pgtap_select_for_operations on public.ops_template_pgtap
  for select to authenticated
  using (store_id = any ((select app.current_user_ops_store_ids())::uuid[]));
create policy ops_template_pgtap_insert_own on public.ops_template_pgtap
  for insert to authenticated
  with check (app.ops_can_write_own(tenant_id, store_id) and created_by = (select auth.uid()));
create policy ops_template_pgtap_update_own_or_managed on public.ops_template_pgtap
  for update to authenticated
  using (app.ops_can_manage(tenant_id, store_id) or (created_by = (select auth.uid()) and app.ops_can_write_own(tenant_id, store_id)))
  with check (app.ops_can_manage(tenant_id, store_id) or (created_by = (select auth.uid()) and app.ops_can_write_own(tenant_id, store_id)));
create policy ops_template_pgtap_delete_managed on public.ops_template_pgtap
  for delete to authenticated
  using (app.ops_can_manage(tenant_id, store_id));

revoke all on public.ops_template_pgtap from anon;
grant select, insert, update, delete on public.ops_template_pgtap to authenticated;

insert into public.ops_template_pgtap (tenant_id, store_id, label, created_by)
select fx.tenant_x, fx.store_x1, 't1', fx.staff_x1 from fx
union all
select fx.tenant_x, fx.store_x2, 't2', fx.staff_xall from fx
union all
select fx.tenant_x, fx.store_x1, 't3', fx.manager_x1 from fx
union all
select fx.tenant_y, fx.store_y1, 't4', fx.staff_y1 from fx;

create function pg_temp.template_as(p_user uuid)
returns text
language plpgsql
as $$
declare
  v_labels text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  select coalesce(string_agg(t.label, ',' order by t.label collate "C"), '-') into v_labels from public.ops_template_pgtap t;
  return v_labels;
end;
$$;

create function pg_temp.template_id(p_label text)
returns uuid
language sql
as $$
  select t.id from public.ops_template_pgtap t where t.label = p_label;
$$;

insert into public.invoices (tenant_id, store_id, pos_account_id, external_id, sold_at, business_date, gross_amount, net_amount, paid_amount, status)
select fx.tenant_x, s.store_id, fx.account_x, 'ops-rls-' || s.store_code || '-' || v.n, now(),
  ((now() at time zone s.timezone) - make_interval(mins => s.day_start))::date - v.days_back,
  v.amount, v.amount, v.amount, v.status::public.invoice_status
from fx
cross join lateral (
  values (fx.store_x1, 'x1', 'Asia/Ho_Chi_Minh', 0), (fx.store_x2, 'x2', 'America/Los_Angeles', 300)
) as s (store_id, store_code, timezone, day_start)
cross join lateral (
  values
    ('x1', 1, 10000, 'completed', 0), ('x1', 2, 20000, 'completed', 0), ('x1', 3, 30000, 'edited', 0), ('x1', 4, 99000, 'voided', 0),
    ('x1', 5, 50000, 'completed', 1), ('x2', 6, 15000, 'completed', 0), ('x2', 7, 25000, 'completed', 0)
) as v (store_code, n, amount, status, days_back)
where v.store_code = s.store_code
union all
select fx.tenant_y, fx.store_y1, fx.account_y, 'ops-rls-y1-8', now(), (now() at time zone 'Asia/Ho_Chi_Minh')::date, 70000, 70000, 70000, 'completed'
from fx;

create temp table today_dates as
select s.id as store_id, ((now() at time zone s.timezone) - make_interval(mins => s.business_day_start_minutes))::date as business_date
from public.stores s, fx
where s.id in (fx.store_x1, fx.store_x2, fx.store_y1);

create function pg_temp.totals_as(p_user uuid)
returns text
language plpgsql
as $$
declare
  v_rows text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  select coalesce(string_agg(
           case t.store_id when fx.store_x1 then 'x1' when fx.store_x2 then 'x2' when fx.store_y1 then 'y1' else 'other' end
           || ':' || t.net_amount || ':' || t.invoices || ':' || (t.business_date = d.business_date),
           ',' order by t.store_id), '-')
  into v_rows
  from public.today_store_totals() t
  cross join fx
  left join today_dates d on d.store_id = t.store_id;
  return v_rows;
end;
$$;

create temp table window_dates as
select
  array[fx.demo_store_1, fx.demo_store_2] as stores,
  max(i.business_date) - 6 as from_date,
  max(i.business_date) as to_date
from fx
join public.invoices i on i.tenant_id = fx.demo_tenant
group by fx.demo_store_1, fx.demo_store_2;

create temp table revenue_relations as
select unnest(array[
  'invoices', 'invoice_lines', 'invoice_payments', 'invoice_events', 'shifts', 'sync_checks',
  'agg_daily_sales', 'agg_hourly_sales', 'agg_item_daily', 'agg_category_daily', 'agg_payment_daily', 'agg_shift_cash',
  'agg_size_mix_daily', 'agg_modifier_prefs_daily', 'agg_basket_pairs_28d', 'agg_attach_daily',
  'v_recent_daily_sales', 'v_recent_hourly_sales'
]) as relation;

create function pg_temp.counts_for(p_store_ids uuid[])
returns jsonb
language plpgsql
as $$
declare
  v_counts jsonb := '{}'::jsonb;
  v_relation text;
  v_count bigint;
begin
  for v_relation in select relation from revenue_relations loop
    execute format('select count(*) from public.%I where store_id = any ($1)', v_relation) into v_count using p_store_ids;
    v_counts := v_counts || jsonb_build_object(v_relation, v_count);
  end loop;
  return v_counts;
end;
$$;

create function pg_temp.counts_as(p_user uuid)
returns jsonb
language plpgsql
as $$
declare
  v_counts jsonb := '{}'::jsonb;
  v_relation text;
  v_count bigint;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  for v_relation in select relation from revenue_relations loop
    execute format('select count(*) from public.%I', v_relation) into v_count;
    v_counts := v_counts || jsonb_build_object(v_relation, v_count);
  end loop;
  return v_counts;
end;
$$;

create temp table expected_counts as
select
  pg_temp.counts_for(array[fx.demo_store_1]) as store_1,
  pg_temp.counts_for(array[fx.demo_store_1, fx.demo_store_2]) as both_stores,
  (select jsonb_object_agg(relation, 0) from revenue_relations) as nothing
from fx;

create temp table probes as
select
  p.proname::text as name,
  case
    when a.missing is not null then format('select %L::text', 'unmapped:' || a.missing)
    when p.proretset then format('select (%s)::text from public.%I(%s) r', c.expr, p.proname, a.list)
    else format('select coalesce(abs(public.%I(%s)), 0)::text', p.proname, a.list)
  end as statement
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join window_dates w
cross join lateral (
  select
    string_agg(format('%I => %L', x.name, x.value), ', ' order by x.pos) as list,
    string_agg(x.name, ',') filter (where x.value is null) as missing
  from (
    select
      i as pos,
      p.proargnames[i] as name,
      case p.proargnames[i]
        when 'store_ids' then w.stores::text
        when 'from_date' then w.from_date::text
        when 'to_date' then w.to_date::text
        when 'as_of_date' then w.to_date::text
        when 'as_of' then w.to_date::text
        when 'anchor' then w.to_date::text
        when 'target_date' then w.to_date::text
        when 'month_start' then date_trunc('month', w.to_date)::date::text
        when 'period_start' then date_trunc('month', w.to_date)::date::text
        when 'calendar_year' then extract(year from w.to_date)::integer::text
        when 'grain' then 'week'
        when 'metric_id' then 'net_revenue'
        when 'metric_ids' then '{net_revenue,invoices}'
        when 'from_dates' then '{' || w.from_date || '}'
        when 'to_dates' then '{' || w.to_date || '}'
        when 'promotion_kind' then 'item'
        when 'promotion_key' then 'promo-01'
        when 'comparator' then 'baseline'
        when 'period_kind' then 'month'
      end as value
    from generate_series(1, p.pronargs - p.pronargdefaults) as i
  ) x
) a
cross join lateral (
  select string_agg(format('coalesce(sum(abs(r.%I)), 0)', o.name), ' + ' order by o.pos) as expr
  from unnest(p.proallargtypes, p.proargmodes::text[], p.proargnames) with ordinality as o (type_oid, mode, name, pos)
  where o.mode = 't'
    and o.type_oid = any (array['numeric'::regtype, 'smallint'::regtype, 'integer'::regtype, 'bigint'::regtype]::oid[])
    and o.name ~ '(_amount$|^amount$|^value$|invoices$|^orders$|quantity$|items_sold$|^revpash$|_per_opening_hour$|_share$|^share$|^lift_rate$|^avg_ticket$|^avg_item_price$|^items_per_ticket$)'
    and o.name !~ '(target|threshold)'
) c
where n.nspname = 'public'
  and p.proargnames[1] = 'store_ids'
  and has_function_privilege('authenticated', p.oid, 'execute')
  and ((p.proretset and c.expr is not null) or (not p.proretset and p.prorettype = 'numeric'::regtype));

create function pg_temp.revenue_as(p_user uuid)
returns jsonb
language plpgsql
as $$
declare
  v_result jsonb := '{}'::jsonb;
  v_probe record;
  v_value text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  for v_probe in select name, statement from probes order by name loop
    begin
      execute v_probe.statement into v_value;
    exception when others then
      v_value := 'error:' || sqlstate;
    end;
    v_result := v_result || jsonb_build_object(v_probe.name, v_value);
  end loop;
  return v_result;
end;
$$;

create function pg_temp.nonzero(p_values jsonb)
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(e.key order by e.key), '{}'::text[])
  from jsonb_each_text(p_values) e
  where e.value !~ '^-?[0-9]+(\.[0-9]+)?$' or e.value::numeric <> 0;
$$;

create temp table revenue_baseline (label text primary key, value jsonb not null);

grant select on fx, people, points, claims, claims_answers, expected_helpers, today_dates, window_dates, revenue_relations, expected_counts, probes to authenticated, anon;
grant select, insert on revenue_baseline to authenticated;


create function pg_temp.answer_as(p_user uuid, p_tenant uuid, p_store uuid)
returns text
language plpgsql
as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  return pg_temp.flag(app.ops_can_read(p_tenant, p_store)) || pg_temp.flag(app.ops_can_write_own(p_tenant, p_store)) || pg_temp.flag(app.ops_can_manage(p_tenant, p_store));
end;
$$;

create function pg_temp.ops_stores_as(p_user uuid)
returns text
language plpgsql
as $$
declare
  v_stores text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  select coalesce(string_agg(case s.id when fx.store_x1 then 'x1' when fx.store_x2 then 'x2' when fx.store_y1 then 'y1' else 'other' end, ',' order by s.id), '-')
  into v_stores
  from unnest(app.current_user_ops_store_ids()) as s (id)
  cross join fx;
  return v_stores;
end;
$$;

select is(
  (
    select array_agg(p.proname::text || ':' || p.prosecdef || ':' || p.provolatile::text || ':' || coalesce(array_to_string(p.proconfig, ','), '-') order by p.proname)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app'
      and p.proname in ('ops_can_read', 'ops_can_write_own', 'ops_can_manage', 'current_user_ops_store_ids', 'current_user_revenue_store_ids', 'today_store_totals', 'set_staff_revenue_visibility')
  ),
  array['current_user_ops_store_ids:true:s:search_path=""', 'current_user_revenue_store_ids:true:s:search_path=""', 'ops_can_manage:true:s:search_path=""',
        'ops_can_read:true:s:search_path=""', 'ops_can_write_own:true:s:search_path=""', 'set_staff_revenue_visibility:true:v:search_path=""',
        'today_store_totals:true:s:search_path=""'],
  'the operations and revenue helpers are security definer with an empty search_path, the read helpers stable'
);
select is(
  (
    select array_agg(p.proname::text || ':' || p.prosecdef || ':' || p.provolatile::text || ':' || coalesce(array_to_string(p.proconfig, ','), '-') order by p.proname)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('today_store_totals', 'set_staff_revenue_visibility')
  ),
  array['set_staff_revenue_visibility:false:v:search_path=""', 'today_store_totals:false:s:search_path=""'],
  'the two RPC wrappers run as the caller with an empty search_path'
);
select is(
  (
    select count(*)::integer
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where ((n.nspname = 'app' and p.proname in ('ops_can_read', 'ops_can_write_own', 'ops_can_manage', 'current_user_ops_store_ids', 'current_user_revenue_store_ids', 'today_store_totals', 'set_staff_revenue_visibility'))
        or (n.nspname = 'public' and p.proname in ('today_store_totals', 'set_staff_revenue_visibility')))
      and a.privilege_type = 'EXECUTE'
      and (a.grantee = 0 or a.grantee = 'anon'::regrole)
  ),
  0,
  'none of them is executable by public or anon'
);
select ok(
  has_function_privilege('authenticated', 'app.ops_can_read(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'app.ops_can_write_own(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'app.ops_can_manage(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'app.current_user_ops_store_ids()', 'execute')
  and has_function_privilege('authenticated', 'app.current_user_revenue_store_ids()', 'execute')
  and has_function_privilege('authenticated', 'public.today_store_totals()', 'execute')
  and has_function_privilege('authenticated', 'public.set_staff_revenue_visibility(uuid, text)', 'execute'),
  'authenticated executes the helpers its policies call and the two RPCs'
);
select ok(
  not has_function_privilege('service_role', 'public.today_store_totals()', 'execute')
  and not has_function_privilege('service_role', 'public.set_staff_revenue_visibility(uuid, text)', 'execute'),
  'the service role, which has no membership, calls neither RPC'
);
select is(
  (
    select array_agg(n.nspname || '.' || p.proname order by n.nspname || '.' || p.proname collate "C")
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app') and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute')
  ),
  array['app.accept_staff_notice', 'app.acknowledge_handover', 'app.acknowledge_incident', 'app.add_staff', 'app.brand_in_scope',
        'app.can_manage_staff', 'app.can_manage_store_scope', 'app.can_manage_stores', 'app.can_publish_store_scope', 'app.can_publish_stores',
        'app.can_read_store', 'app.current_customer_id', 'app.current_customer_membership_ids', 'app.current_customer_tenant_id', 'app.current_user_channel_ids',
        'app.current_user_data_store_ids', 'app.current_user_data_tenant_ids', 'app.current_user_loyalty_manager_store_ids', 'app.current_user_loyalty_store_ids', 'app.current_user_loyalty_tenant_ids',
        'app.current_user_ops_store_ids', 'app.current_user_revenue_store_ids', 'app.current_user_store_ids', 'app.current_user_tenant_ids', 'app.deactivate_staff',
        'app.decide_request', 'app.has_store_scope', 'app.has_tenant_role', 'app.identified_metric_scope', 'app.issue_pairing_code',
        'app.link_my_phone', 'app.mark_announcement_read', 'app.menu_photo_writable', 'app.my_staff_notice', 'app.ops_can_manage',
        'app.ops_can_read', 'app.ops_can_write_own', 'app.ops_photo_readable', 'app.ops_photo_writable', 'app.publish_announcement',
        'app.reactivate_staff', 'app.reopen_cash_count', 'app.resolve_incident', 'app.resolve_loyalty_queue_item', 'app.save_checklist_template',
        'app.set_announcement_pin', 'app.set_checklist_template_active', 'app.set_ops_photo_retention_days', 'app.set_staff_contact_instructions', 'app.set_staff_revenue_visibility',
        'app.today_store_totals', 'app.update_staff', 'app.withdraw_staff_ops_consent', 'public.bill_anomaly_report', 'public.checkout_set_provider', 'public.counter_ack_call',
        'public.counter_board', 'public.counter_create_order', 'public.counter_menu', 'public.counter_order', 'public.counter_order_act',
        'public.counter_payment_methods', 'public.counter_record_payment', 'public.counter_refund', 'public.counter_set_pause', 'public.counter_set_sold_out', 'public.counter_table_map',
        'public.counter_void_payment', 'public.customer_call_staff', 'public.customer_cancel_order', 'public.customer_cancel_request', 'public.customer_check_cart',
        'public.customer_confirm_bill', 'public.customer_coupons', 'public.customer_dispute_bill', 'public.customer_home', 'public.customer_member_code',
        'public.customer_menu', 'public.customer_menu_version', 'public.customer_order', 'public.customer_orders', 'public.customer_pending_bills',
        'public.customer_place_order', 'public.customer_redeem', 'public.customer_request_deletion', 'public.customer_requests', 'public.customer_stamp_card',
        'public.customer_stop_marketing', 'public.customer_submit_claim', 'public.customer_submit_counter_claim', 'public.customer_submit_request', 'public.customer_table',
        'public.customer_vouchers', 'public.customer_wallet', 'public.dsr_correct', 'public.dsr_delete', 'public.dsr_deletion_preview',
        'public.dsr_due_soon', 'public.dsr_export', 'public.dsr_lookup', 'public.import_menu_from_pos', 'public.loyalty_member_lookup',
        'public.loyalty_members_page', 'public.manager_answer_request', 'public.manager_approve_blocked_signin', 'public.manager_blocked_signins', 'public.manager_close_shift', 'public.manager_confirm_shift', 'public.manager_counter_qr',
        'public.manager_day_reconciliation', 'public.manager_dismiss_blocked_signin', 'public.manager_payment_exceptions', 'public.manager_requests',
        'public.manager_resolve_payment_exception', 'public.manager_shifts', 'public.manager_worked_days', 'public.my_follow_oa',
        'public.my_notifications', 'public.notify_overview', 'public.oa_event_counts', 'public.phone_masked', 'public.publish_legal_document',
        'public.publish_strategy_plan', 'public.refresh_my_analytics', 'public.remove_destination', 'public.resend_message', 'public.retire_legal_document',
        'public.rotate_table_qr', 'public.send_test_message', 'public.set_loyalty_adjust_limits', 'public.set_loyalty_store_settings', 'public.set_my_muted_rules',
        'public.set_store_till_mode', 'public.staff_answer_counter_claim', 'public.staff_bill_queue', 'public.staff_clock_in', 'public.staff_clock_out',
        'public.staff_close_bill_audit', 'public.staff_confirm_redemption', 'public.staff_counter_claims', 'public.staff_counter_code', 'public.staff_decide_bill',
        'public.staff_decide_loyalty_request', 'public.staff_loyalty_queue', 'public.staff_member_lookup', 'public.staff_my_loyalty_requests', 'public.staff_my_shift',
        'public.staff_recent_bills', 'public.staff_record_checkin', 'public.staff_request', 'public.staff_reverse_bill', 'public.staff_submit_bill',
        'public.staff_verify_redemption', 'public.staff_void_redemption', 'public.start_bot_link', 'public.start_channel_link', 'public.stop_my_notifications',
        'public.table_qr_links', 'public.update_destination'],
  'the only security definer functions a member may call are the membership helpers, the roster, pairing, staff notice and phone functions, settings and legal functions, today_store_totals, the phase 14b checklist editor, acknowledgement, reopening, photo retention and photo policy functions, the phase 15 announcement and request writers, the member''s own notification settings, the Settings → Cảnh báo functions and resend, the loyalty and customer-session membership helpers, the loyalty queue resolution, the customer and staff loyalty RPCs, the masked member reads of Khách hàng, the owner''s data-subject deletion and the strategy plan publisher with its two scope helpers, so no other function reads revenue past RLS'
);
select col_type_is('public', 'tenants', 'staff_revenue_visibility', 'text', 'tenants.staff_revenue_visibility is text');
select col_default_is('public', 'tenants', 'staff_revenue_visibility', 'all', 'staff see their stores'' revenue until the owner restricts it');
select col_not_null('public', 'tenants', 'staff_revenue_visibility', 'tenants.staff_revenue_visibility is not null');
select ok(
  has_column_privilege('authenticated', 'public.tenants', 'staff_revenue_visibility', 'select')
  and not has_column_privilege('authenticated', 'public.tenants', 'staff_revenue_visibility', 'update'),
  'members read the level and write it only through the function'
);
select throws_ok(
  $q$ update public.tenants set staff_revenue_visibility = 'everything' where id = 'dddddddd-dddd-4ddd-8ddd-000000004701' $q$,
  '23514', null,
  'the level is none, store_totals or all, for every writer'
);
select is(
  (select array_agg(p.tablename::text || ':' || p.cmd order by p.tablename collate "C") from pg_policies p where p.schemaname = 'public' and p.qual like '%current_user_revenue_store_ids%'),
  array['agg_attach_daily:SELECT', 'agg_basket_pairs_28d:SELECT', 'agg_category_daily:SELECT', 'agg_daily_sales:SELECT', 'agg_hourly_sales:SELECT',
        'agg_item_daily:SELECT', 'agg_modifier_prefs_daily:SELECT', 'agg_payment_daily:SELECT', 'agg_shift_cash:SELECT', 'agg_size_mix_daily:SELECT',
        'cash_counts:SELECT', 'invoice_events:SELECT', 'invoice_lines:SELECT', 'invoice_payments:SELECT', 'invoices:SELECT', 'shifts:SELECT', 'sync_checks:SELECT'],
  'the sales facts, shifts, sync checks, every aggregate and the counts of other members in cash_counts are read through current_user_revenue_store_ids'
);
select is(
  (select count(*)::integer from pg_policies p
   where p.schemaname = 'public'
     and p.tablename in ('agg_attach_daily', 'agg_basket_pairs_28d', 'agg_category_daily', 'agg_daily_sales', 'agg_hourly_sales', 'agg_item_daily',
                         'agg_modifier_prefs_daily', 'agg_payment_daily', 'agg_shift_cash', 'agg_size_mix_daily', 'invoice_events', 'invoice_lines',
                         'invoice_payments', 'invoices', 'shifts', 'sync_checks')),
  16,
  'each revenue table keeps exactly one policy, so no other policy reopens it'
);
select is(
  (
    select array_agg(t.table_name order by t.table_name collate "C")
    from (
      select distinct c.table_name::text as table_name
      from information_schema.columns c
      join pg_class k on k.relname = c.table_name and k.relkind = 'r'
      join pg_namespace n on n.oid = k.relnamespace and n.nspname = c.table_schema
      where c.table_schema = 'public'
        and c.data_type = 'numeric'
        and c.column_name ~ '(amount|price)$'
        and not exists (
          select 1 from pg_policies p
          where p.schemaname = 'public' and p.tablename = c.table_name and p.qual like '%current_user_revenue_store_ids%'
        )
    ) t
  ),
  array['coupons', 'item_costs', 'items', 'loyalty_audit_events', 'loyalty_ledger',
        'loyalty_liability_daily', 'loyalty_programmes', 'loyalty_store_settings', 'menu_item_sizes', 'menu_price_changes',
        'order_events', 'order_lines', 'order_payments', 'order_refunds', 'orders',
        'outbound_messages', 'packages', 'payment_exceptions', 'payment_fee_rates', 'pending_checkins', 'receipt_claims',
        'store_items', 'store_ordering_settings', 'targets'],
  'every other table with an amount or a price holds costs, menu prices, fees, targets, message costs, loyalty amounts or the native till''s orders that staff never read directly (the counter functions show a store''s orders to its staff), not revenue'
);

set local role authenticated;

select is(pg_temp.helpers_as((select owner_x from fx)), (select answer from expected_helpers where label = 'owner_x'), 'an unlimited owner: every store of the tenant and tenant-wide rows, read, own writes and management');
select is(pg_temp.helpers_as((select owner_x1 from fx)), (select answer from expected_helpers where label = 'owner_x1'), 'a store-limited owner: their store only, no tenant-wide row');
select is(pg_temp.helpers_as((select manager_xall from fx)), (select answer from expected_helpers where label = 'manager_xall'), 'an unlimited manager manages every store');
select is(pg_temp.helpers_as((select manager_x1 from fx)), (select answer from expected_helpers where label = 'manager_x1'), 'a manager of one store manages that store only');
select is(pg_temp.helpers_as((select staff_x1 from fx)), (select answer from expected_helpers where label = 'staff_x1'), 'staff of one store read and write their own rows there and manage nothing');
select is(pg_temp.helpers_as((select staff_xall from fx)), (select answer from expected_helpers where label = 'staff_xall'), 'staff of every store read and write their own rows in every store and manage nothing');
select is(pg_temp.helpers_as((select viewer_x from fx)), (select answer from expected_helpers where label = 'viewer_x'), 'a viewer reads no operations data');
select is(pg_temp.helpers_as((select publisher_x from fx)), (select answer from expected_helpers where label = 'publisher_x'), 'the publisher reads no operations data');
select is(pg_temp.helpers_as((select owner_y from fx)), (select answer from expected_helpers where label = 'owner_y'), 'another tenant''s owner gets their own tenant only');
select is(pg_temp.helpers_as((select staff_y1 from fx)), (select answer from expected_helpers where label = 'staff_y1'), 'another tenant''s staff get their own store only');
select is(pg_temp.helpers_as((select no_member from fx)), (select answer from expected_helpers where label = 'no_member'), 'a login without membership gets nothing');
select is(
  (select array_agg(c.label || '=' || c.answer order by pe.sort) from claims_answers c join people pe on pe.label = c.label),
  (select array_agg(pe.label || '=' || pg_temp.helpers_as(pe.id) order by pe.sort) from people pe),
  'the role and store claims of the access-token hook give the same answer as the helpers for every member, store and capability'
);
select is(
  (select string_agg(pg_temp.answer_as(pe.id, fx.tenant_x, fx.store_y1) || pg_temp.answer_as(pe.id, fx.tenant_y, fx.store_x1), '' order by pe.sort) from people pe cross join fx),
  repeat('F', 66),
  'a store named with another tenant is refused by every helper for every member, an unlimited owner included'
);
select is(
  (select array_agg(pe.label || '=' || pg_temp.ops_stores_as(pe.id) order by pe.sort) from people pe),
  array['owner_x=x1,x2', 'owner_x1=x1', 'manager_xall=x1,x2', 'manager_x1=x1', 'staff_x1=x1', 'staff_xall=x1,x2', 'viewer_x=-', 'publisher_x=-',
        'owner_y=y1', 'staff_y1=y1', 'no_member=-'],
  'current_user_ops_store_ids lists exactly the stores ops_can_read allows, for one statement-wide evaluation'
);

select is(
  array[pg_temp.template_as((select owner_x from fx)), pg_temp.template_as((select manager_xall from fx)), pg_temp.template_as((select owner_x1 from fx)), pg_temp.template_as((select manager_x1 from fx))],
  array['t1,t2,t3', 't1,t2,t3', 't1,t3', 't1,t3'],
  'template: owners and managers read the rows of the stores in their scope'
);
select is(
  array[pg_temp.template_as((select staff_x1 from fx)), pg_temp.template_as((select staff_xall from fx))],
  array['t1,t3', 't1,t2,t3'],
  'template: staff read the rows of their stores, not of another store'
);
select is(
  array[pg_temp.template_as((select viewer_x from fx)), pg_temp.template_as((select publisher_x from fx)), pg_temp.template_as((select no_member from fx))],
  array['-', '-', '-'],
  'template: viewers, the publisher and a login without membership read nothing'
);
select is(
  array[pg_temp.template_as((select owner_y from fx)), pg_temp.template_as((select staff_y1 from fx))],
  array['t4', 't4'],
  'template: no read crosses tenants'
);
select is(pg_temp.outcome_as((select staff_x1 from fx), $q$ insert into public.ops_template_pgtap (tenant_id, store_id, label) select tenant_x, store_x1, 't5' from fx $q$), 'rows:1', 'template: staff insert their own row in their store');
select is(pg_temp.outcome_as((select staff_x1 from fx), $q$ insert into public.ops_template_pgtap (tenant_id, store_id, label) select tenant_x, store_x2, 't6' from fx $q$), '42501', 'template: staff cannot insert in another store');
select is(pg_temp.outcome_as((select staff_x1 from fx), $q$ insert into public.ops_template_pgtap (tenant_id, store_id, label, created_by) select tenant_x, store_x1, 't6', manager_x1 from fx $q$), '42501', 'template: staff cannot insert a row in someone else''s name');
select is(pg_temp.outcome_as((select staff_x1 from fx), $q$ insert into public.ops_template_pgtap (tenant_id, store_id, label) select tenant_y, store_x1, 't6' from fx $q$), '42501', 'template: a row naming another tenant is refused');
select is(pg_temp.outcome_as((select staff_x1 from fx), $q$ update public.ops_template_pgtap set note = 'own' where label = 't1' $q$), 'rows:1', 'template: staff update their own row');
select is(pg_temp.outcome_as((select staff_x1 from fx), $q$ update public.ops_template_pgtap set note = 'other' where label = 't3' $q$), 'rows:0', 'template: staff cannot update a manager''s row of their store');
select is(pg_temp.outcome_as((select staff_x1 from fx), $q$ update public.ops_template_pgtap set note = 'other' where label = 't2' $q$), 'rows:0', 'template: nor a row of another store');
select is(pg_temp.outcome_as((select staff_x1 from fx), $q$ update public.ops_template_pgtap set store_id = (select store_x2 from fx) where label = 't1' $q$), '42501', 'template: staff cannot move their row to another store');
select is(pg_temp.outcome_as((select staff_x1 from fx), $q$ update public.ops_template_pgtap set created_by = (select manager_x1 from fx) where label = 't5' $q$), 'rows:1', 'template: an update of created_by is accepted');
select is(
  (select t.created_by = fx.staff_x1 from public.ops_template_pgtap t, fx where t.label = 't5'),
  true,
  'template: but created_by stays frozen'
);
select is(pg_temp.outcome_as((select staff_x1 from fx), $q$ delete from public.ops_template_pgtap where label = 't1' $q$), 'rows:0', 'template: staff delete nothing, not even their own row');
select is(pg_temp.outcome_as((select manager_x1 from fx), $q$ update public.ops_template_pgtap set note = 'checked' where label = 't1' $q$), 'rows:1', 'template: a manager updates a staff row of their store');
select is(pg_temp.outcome_as((select manager_x1 from fx), $q$ update public.ops_template_pgtap set note = 'checked' where label = 't2' $q$), 'rows:0', 'template: but not a row of another store');
select is(pg_temp.outcome_as((select manager_x1 from fx), $q$ update public.ops_template_pgtap set store_id = (select store_x2 from fx) where label = 't3' $q$), '42501', 'template: nor move a row out of their scope');
select is(pg_temp.outcome_as((select manager_x1 from fx), $q$ delete from public.ops_template_pgtap where label = 't1' $q$), 'rows:1', 'template: a manager deletes a row of their store');
select is(pg_temp.outcome_as((select owner_x from fx), $q$ delete from public.ops_template_pgtap where label = 't2' $q$), 'rows:1', 'template: an owner deletes in any store of the tenant');
select is(pg_temp.outcome_as((select viewer_x from fx), $q$ insert into public.ops_template_pgtap (tenant_id, store_id, label) select tenant_x, store_x1, 't6' from fx $q$), '42501', 'template: a viewer writes nothing');
select is(pg_temp.outcome_as((select viewer_x from fx), $q$ update public.ops_template_pgtap set note = 'viewer' $q$), 'rows:0', 'template: a viewer updates nothing');
select is(pg_temp.outcome_as((select publisher_x from fx), $q$ insert into public.ops_template_pgtap (tenant_id, store_id, label) select tenant_x, store_x1, 't6' from fx $q$), '42501', 'template: the publisher writes nothing');
select is(pg_temp.outcome_as((select owner_y from fx), $q$ insert into public.ops_template_pgtap (tenant_id, store_id, label) select tenant_x, store_x1, 't6' from fx $q$), '42501', 'template: another tenant''s owner cannot write here');
select is(pg_temp.outcome_as((select owner_y from fx), $q$ update public.ops_template_pgtap set note = 'other tenant' where label = 't3' $q$), 'rows:0', 'template: nor update a row here');
select is(pg_temp.outcome_as((select staff_y1 from fx), $q$ delete from public.ops_template_pgtap where label = 't4' $q$), 'rows:0', 'template: staff of the other tenant delete nothing either');
select is(pg_temp.outcome_as((select no_member from fx), $q$ insert into public.ops_template_pgtap (tenant_id, store_id, label) select tenant_x, store_x1, 't6' from fx $q$), '42501', 'template: a login without membership writes nothing');

reset role;
set local role anon;
select throws_ok('select count(*) from public.ops_template_pgtap', '42501', null, 'template: anon reads nothing');
select throws_ok($q$ select app.ops_can_read('dddddddd-dddd-4ddd-8ddd-000000004701', 'ffffffff-ffff-4fff-8fff-000000004701') $q$, '42501', null, 'anon cannot call the operations helpers');
select throws_ok('select * from public.today_store_totals()', '42501', null, 'anon cannot read today''s totals');
select throws_ok($q$ select public.set_staff_revenue_visibility('dddddddd-dddd-4ddd-8ddd-000000004701', 'all') $q$, '42501', null, 'anon cannot set the staff revenue visibility');
reset role;

select is(
  (select array_agg(distinct p.tablename::text) from pg_policies p
   where p.schemaname = 'public' and (coalesce(p.qual, '') || coalesce(p.with_check, '')) ~ '(ops_can_|current_user_ops_store_ids)'),
  array['announcement_receipts', 'announcement_recipients', 'announcements', 'approval_requests', 'cash_counts', 'checklist_answers', 'checklist_corrections',
        'checklist_items', 'checklist_runs', 'checklist_templates', 'incidents', 'ops_template_pgtap', 'shift_handovers'],
  'the operations tables: 14b and 15 add each of theirs here'
);
select is(
  (
    select count(*)::integer
    from (select distinct p.tablename from pg_policies p where p.schemaname = 'public' and (coalesce(p.qual, '') || coalesce(p.with_check, '')) ~ '(ops_can_|current_user_ops_store_ids)') t
    where (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename) <> 4
       or exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename and p.roles <> array['authenticated']::name[])
       or not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename and p.cmd = 'SELECT' and p.qual like '%current_user_ops_store_ids%')
       or not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename and p.cmd = 'INSERT' and p.with_check like '%ops_can_write_own%' and p.with_check like '%created_by = ( SELECT auth.uid()%')
       or not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename and p.cmd = 'UPDATE' and p.qual like '%ops_can_manage%' and p.qual like '%ops_can_write_own%' and p.with_check like '%ops_can_manage%')
       or not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename and p.cmd = 'DELETE' and p.qual like '%ops_can_manage%' and p.qual not like '%ops_can_write_own%')
  ),
  0,
  'every operations table carries the four template policies for authenticated only: read in scope, insert own, update own or managed, delete managed'
);

select is(
  (select string_agg(t.staff_revenue_visibility, ',' order by t.id) from public.tenants t, fx where t.id in (fx.tenant_x, fx.tenant_y)),
  'all,all',
  'a new tenant starts at all: staff read every revenue row of their stores until the owner restricts it'
);
update public.tenants set staff_revenue_visibility = 'none' where id in (select tenant_x from fx union all select tenant_y from fx);

set local role authenticated;

select pg_temp.act_as((select staff_x1 from fx));
select is((select t.staff_revenue_visibility from public.tenants t), 'none', 'staff read their tenant''s level to choose their cards');
select is(
  array[pg_temp.totals_as((select staff_x1 from fx)), pg_temp.totals_as((select staff_xall from fx)), pg_temp.totals_as((select staff_y1 from fx))],
  array['-', '-', '-'],
  'none: staff get no row from today_store_totals'
);
select is(pg_temp.totals_as((select owner_x from fx)), 'x1:60000.00:3:true,x2:40000.00:2:true', 'an owner gets today''s net and invoices of each store by the store''s own business date, voided and earlier invoices left out');
select is(pg_temp.totals_as((select manager_x1 from fx)), 'x1:60000.00:3:true', 'a manager of one store gets that store only');
select is(pg_temp.totals_as((select viewer_x from fx)), 'x1:60000.00:3:true,x2:40000.00:2:true', 'a viewer keeps reading the totals of their stores');
select is(
  array[pg_temp.totals_as((select publisher_x from fx)), pg_temp.totals_as((select no_member from fx))],
  array['-', '-'],
  'the publisher and a login without membership get nothing'
);
select is(pg_temp.totals_as((select owner_y from fx)), 'y1:70000.00:1:true', 'another tenant''s owner gets only their own store');

select is(pg_temp.outcome_as((select owner_x1 from fx), $q$ select public.set_staff_revenue_visibility(tenant_x, 'all') from fx $q$), '42501', 'a store-limited owner cannot set the level');
select is(pg_temp.outcome_as((select manager_xall from fx), $q$ select public.set_staff_revenue_visibility(tenant_x, 'all') from fx $q$), '42501', 'a manager, even unlimited, cannot set the level');
select is(pg_temp.outcome_as((select staff_xall from fx), $q$ select public.set_staff_revenue_visibility(tenant_x, 'all') from fx $q$), '42501', 'staff cannot set the level');
select is(pg_temp.outcome_as((select viewer_x from fx), $q$ select public.set_staff_revenue_visibility(tenant_x, 'all') from fx $q$), '42501', 'a viewer cannot set the level');
select is(pg_temp.outcome_as((select publisher_x from fx), $q$ select public.set_staff_revenue_visibility(tenant_x, 'all') from fx $q$), '42501', 'the publisher cannot set the level');
select is(pg_temp.outcome_as((select owner_y from fx), $q$ select public.set_staff_revenue_visibility(tenant_x, 'all') from fx $q$), '42501', 'another tenant''s owner cannot set the level');
select is(pg_temp.outcome_as((select owner_x from fx), $q$ select public.set_staff_revenue_visibility(tenant_x, 'everything') from fx $q$), '22023', 'an unknown level is refused');
select is(pg_temp.outcome_as((select owner_x from fx), $q$ select public.set_staff_revenue_visibility(tenant_x, null) from fx $q$), '22023', 'a missing level is refused');
select is(pg_temp.outcome_as((select owner_x from fx), $q$ update public.tenants set staff_revenue_visibility = 'all' where id = (select tenant_x from fx) $q$), '42501', 'an owner cannot write the column directly');
select is(pg_temp.outcome_as((select owner_x from fx), $q$ select public.set_staff_revenue_visibility(tenant_x, 'store_totals') from fx $q$), 'rows:1', 'an owner with every store sets store_totals');
reset role;
select is(
  (select t.staff_revenue_visibility || ':' || (t.profile_updated_by = fx.owner_x) from public.tenants t, fx where t.id = fx.tenant_x),
  'store_totals:true',
  'the level is stored and the profile stamps name the owner'
);
select is((select t.staff_revenue_visibility from public.tenants t, fx where t.id = fx.tenant_y), 'none', 'the other tenant keeps its own level');
set local role authenticated;

select is(pg_temp.totals_as((select staff_x1 from fx)), 'x1:60000.00:3:true', 'store_totals: staff get today''s totals of their own store');
select is(pg_temp.totals_as((select staff_xall from fx)), 'x1:60000.00:3:true,x2:40000.00:2:true', 'store_totals: staff of every store get each store''s totals');
select is(pg_temp.totals_as((select staff_y1 from fx)), '-', 'store_totals of one tenant gives nothing to staff of another tenant');
select pg_temp.act_as((select staff_x1 from fx));
select is(
  (select (select count(*) from public.invoices) + (select count(*) from public.agg_daily_sales) + coalesce((select public.metric_value(array[fx.store_x1], 'net_revenue', d.business_date, d.business_date) from fx, today_dates d where d.store_id = fx.store_x1), 0))::integer,
  0,
  'store_totals: the tables, aggregates and metric_value still give staff nothing'
);

select is(pg_temp.outcome_as((select owner_x from fx), $q$ select public.set_staff_revenue_visibility(tenant_x, 'all') from fx $q$), 'rows:1', 'an owner sets all');
select is(pg_temp.totals_as((select staff_x1 from fx)), 'x1:60000.00:3:true', 'all: staff keep their store''s totals');
select pg_temp.act_as((select staff_x1 from fx));
select is(
  (select count(*)::integer || ':' || sum(i.net_amount) filter (where i.status <> 'voided' and i.business_date = d.business_date) from public.invoices i, today_dates d, fx where d.store_id = fx.store_x1),
  '5:60000.00',
  'all: staff read every invoice of their store, and today''s match today_store_totals'
);
select is(pg_temp.outcome_as((select owner_x from fx), $q$ select public.set_staff_revenue_visibility(tenant_x, 'none') from fx $q$), 'rows:1', 'an owner sets none again');
select is(pg_temp.totals_as((select staff_x1 from fx)), '-', 'none: the totals are gone at the next call');

reset role;
update public.tenants set staff_revenue_visibility = 'none' where id = (select demo_tenant from fx);
set local role authenticated;

insert into revenue_baseline
select 'owner', pg_temp.revenue_as((select demo_owner from fx))
union all select 'manager', pg_temp.revenue_as((select demo_manager_1 from fx))
union all select 'viewer', pg_temp.revenue_as((select demo_viewer from fx));

select is(
  (
    select coalesce(array_agg(core.name order by core.name), '{}'::text[])
    from unnest(array['export_control_totals', 'hour_weekday_heatmap', 'item_summary', 'metric_compare', 'metric_value', 'metric_windows', 'month_pace',
                      'opening_productivity', 'payment_summary', 'period_compare', 'period_compare_by_store', 'period_series', 'period_summary',
                      'range_totals', 'shift_review']) as core (name)
    where core.name = any (pg_temp.nonzero((select value from revenue_baseline where label = 'manager')))
  ),
  array['export_control_totals', 'hour_weekday_heatmap', 'item_summary', 'metric_compare', 'metric_value', 'metric_windows', 'month_pace',
        'opening_productivity', 'payment_summary', 'period_compare', 'period_compare_by_store', 'period_series', 'period_summary', 'range_totals', 'shift_review'],
  'the demo window holds revenue for a manager in the core report functions, so the checks below are not empty'
);
select is((select count(*)::integer from probes where statement like '%unmapped:%'), 0, 'every report function taking store_ids has its arguments mapped');

select is(pg_temp.counts_as((select demo_staff_1 from fx)), (select nothing from expected_counts), 'none: staff read no row from the sales facts, shifts, sync checks, aggregates or live views');
select is(pg_temp.nonzero(pg_temp.revenue_as((select demo_staff_1 from fx))), '{}'::text[], 'none: every report function and metric_value return no revenue to staff');
select is(pg_temp.counts_as((select demo_manager_1 from fx)), (select store_1 from expected_counts), 'none: a manager of one store reads that store''s rows as before');
select is(pg_temp.counts_as((select demo_owner from fx)), (select both_stores from expected_counts), 'none: an owner reads every store''s rows as before');
select is(pg_temp.counts_as((select demo_viewer from fx)), (select both_stores from expected_counts), 'none: a viewer reads every store''s rows as before');

reset role;
update public.tenants set staff_revenue_visibility = 'store_totals' where id = (select demo_tenant from fx);
set local role authenticated;

select is(pg_temp.counts_as((select demo_staff_1 from fx)), (select nothing from expected_counts), 'store_totals: staff still read no revenue row');
select is(pg_temp.nonzero(pg_temp.revenue_as((select demo_staff_1 from fx))), '{}'::text[], 'store_totals: report functions still return no revenue to staff');
select is(pg_temp.revenue_as((select demo_owner from fx)), (select value from revenue_baseline where label = 'owner'), 'store_totals: an owner''s report functions are unchanged');
select is(pg_temp.revenue_as((select demo_manager_1 from fx)), (select value from revenue_baseline where label = 'manager'), 'store_totals: a manager''s report functions are unchanged');
select is(pg_temp.revenue_as((select demo_viewer from fx)), (select value from revenue_baseline where label = 'viewer'), 'store_totals: a viewer''s report functions are unchanged');

reset role;
update public.tenants set staff_revenue_visibility = 'all' where id = (select demo_tenant from fx);
set local role authenticated;

select is(pg_temp.counts_as((select demo_staff_1 from fx)), (select store_1 from expected_counts), 'all: staff read their store''s rows, exactly what a manager of that store reads');
select is(pg_temp.revenue_as((select demo_staff_1 from fx)), pg_temp.revenue_as((select demo_manager_1 from fx)), 'all: every report function and metric_value give staff what they give a manager of the same store');
select is(pg_temp.counts_as((select demo_manager_1 from fx)), (select store_1 from expected_counts), 'all: a manager of one store reads the same rows');
select is(pg_temp.counts_as((select demo_owner from fx)), (select both_stores from expected_counts), 'all: an owner reads the same rows');
select is(pg_temp.counts_as((select demo_viewer from fx)), (select both_stores from expected_counts), 'all: a viewer reads the same rows');
select is(pg_temp.revenue_as((select demo_owner from fx)), (select value from revenue_baseline where label = 'owner'), 'all: an owner''s report functions are unchanged');
select is(pg_temp.revenue_as((select demo_viewer from fx)), (select value from revenue_baseline where label = 'viewer'), 'all: a viewer''s report functions are unchanged');
select is(
  array[pg_temp.counts_as((select demo_publisher_1 from fx)) = (select nothing from expected_counts), cardinality(pg_temp.nonzero(pg_temp.revenue_as((select demo_publisher_1 from fx)))) = 0],
  array[true, true],
  'all: the publisher still reads no revenue'
);

reset role;
delete from public.tenant_members m using fx where m.tenant_id = fx.tenant_x and m.user_id = fx.staff_x1;
set local role authenticated;
select is(
  pg_temp.flag(pg_temp.claims_allow((select memberships from claims where label = 'staff_x1'), (select tenant_x from fx), (select store_x1 from fx), array['owner', 'manager', 'staff']))
    || ':' || pg_temp.helpers_as((select staff_x1 from fx)),
  'T:FFFFF|FFFFF|FFFFF',
  'after a removal the claims of a token minted before still name the store, but the helpers read the membership rows and refuse at the next request'
);
reset role;

select * from finish();
rollback;
