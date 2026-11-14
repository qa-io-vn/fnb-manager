create function app.item_cost_periods(store_ids uuid[])
returns table (
  for_store_id uuid,
  item_external_id text,
  store_scoped boolean,
  valid_from date,
  valid_until date,
  cost_amount numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with visible as (
    select v.store_id as visible_id, s.tenant_id as visible_tenant
    from app.visible_stores(item_cost_periods.store_ids) v
    join public.stores s on s.id = v.store_id
  ),
  scoped as (
    select
      vis.visible_id,
      c.item_external_id as cost_item,
      c.store_id is not null as is_store_row,
      c.effective_from,
      c.cost_amount as amount
    from visible vis
    join public.item_costs c
      on c.tenant_id = vis.visible_tenant
     and (c.store_id = vis.visible_id or c.store_id is null)
  )
  select
    sc.visible_id,
    sc.cost_item,
    sc.is_store_row,
    sc.effective_from,
    lead(sc.effective_from) over (partition by sc.visible_id, sc.cost_item, sc.is_store_row order by sc.effective_from),
    sc.amount
  from scoped sc;
$$;

create function app.effective_item_types(store_ids uuid[], from_date date, to_date date)
returns table (
  item_key text,
  pos_account_id uuid,
  item_type_external_id text,
  item_type_name text,
  category_source text,
  role public.item_type_role
)
language sql
stable
security invoker
set search_path = ''
as $$
  with visible as (
    select v.store_id as visible_id, v.store_position, s.pos_account_id as account_id
    from app.visible_stores(effective_item_types.store_ids) v
    join public.stores s on s.id = v.store_id
  ),
  store_items as (
    select
      a.item_external_id as key,
      vis.store_position,
      vis.account_id,
      max(a.item_type_external_id) as pos_type,
      max(a.item_type_name) as pos_type_name
    from public.agg_item_daily a
    join visible vis on vis.visible_id = a.store_id
    where a.business_date between effective_item_types.from_date and effective_item_types.to_date
    group by a.item_external_id, vis.store_position, vis.account_id
  ),
  pos_types as (
    select si.key, max(si.pos_type) as pos_type, max(si.pos_type_name) as pos_type_name
    from store_items si
    group by si.key
  ),
  first_store as (
    select distinct on (si.key) si.key, si.account_id
    from store_items si
    order by si.key, si.store_position
  )
  select
    f.key,
    f.account_id,
    coalesce(m.item_type_external_id, pt.pos_type),
    case when m.item_key is not null then m.item_type_name else pt.pos_type_name end,
    case
      when m.item_key is not null then 'override'
      when pt.pos_type is null then 'none'
      else 'pos'
    end,
    (
      select r.role
      from visible vr
      join public.item_type_roles r
        on r.pos_account_id = vr.account_id
       and r.item_type_external_id = coalesce(m.item_type_external_id, pt.pos_type)
      order by (vr.account_id = f.account_id) desc, vr.store_position
      limit 1
    )
  from first_store f
  join pos_types pt on pt.key = f.key
  left join app.item_category_map(effective_item_types.store_ids) m
    on m.pos_account_id = f.account_id
   and m.item_key = f.key;
$$;

create function public.menu_engineering(
  store_ids uuid[],
  as_of_date date,
  window_days integer default null,
  popularity_factor numeric default null,
  low_sample_items integer default null
)
returns table (
  role public.item_type_role,
  role_mapped boolean,
  item_external_id text,
  item_name text,
  item_type_external_id text,
  item_type_name text,
  category_source text,
  quantity numeric,
  net_amount numeric,
  menu_mix_pct numeric,
  popularity_threshold_pct numeric,
  avg_unit_price numeric,
  unit_cost numeric,
  margin_axis numeric,
  margin_threshold numeric,
  provisional boolean,
  low_sample boolean,
  menu_class text,
  window_from date,
  window_days_used integer,
  popularity_factor_used numeric,
  low_sample_items_used integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  used_window integer;
  used_factor numeric;
  used_low integer;
  window_start date;
  returned_rows bigint;
begin
  perform app.require_store_ids('menu_engineering', menu_engineering.store_ids);
  if menu_engineering.as_of_date is null then
    raise exception using errcode = '22023', message = 'menu_engineering needs an as_of_date';
  end if;
  if menu_engineering.window_days is not null and menu_engineering.window_days not between 7 and 91 then
    raise exception using errcode = '22023', message = 'menu_engineering needs window_days between 7 and 91';
  end if;
  if menu_engineering.popularity_factor is not null and menu_engineering.popularity_factor not between 0.1 and 1 then
    raise exception using errcode = '22023', message = 'menu_engineering needs popularity_factor between 0.1 and 1';
  end if;
  if menu_engineering.low_sample_items is not null and menu_engineering.low_sample_items not between 2 and 50 then
    raise exception using errcode = '22023', message = 'menu_engineering needs low_sample_items between 2 and 50';
  end if;
  if cardinality(menu_engineering.store_ids) = 0 then
    return;
  end if;

  select
    coalesce(menu_engineering.window_days, r.menu_window_days),
    coalesce(menu_engineering.popularity_factor, r.menu_popularity_factor),
    coalesce(menu_engineering.low_sample_items, r.menu_low_sample_items)
  into used_window, used_factor, used_low
  from app.store_report_settings(menu_engineering.store_ids) with ordinality as r (
    store_id, tenant_id, has_tenant_row, menu_window_days, menu_popularity_factor, menu_low_sample_items,
    cash_abs_threshold, cash_rel_threshold, z_threshold, peak_hours, dead_hour_ratio, busy_hour_ratio,
    promo_pre_weeks, settings_position
  )
  order by r.settings_position
  limit 1;
  if used_window is null then
    return;
  end if;
  window_start := menu_engineering.as_of_date - used_window + 1;

  return query
  with visible as (
    select v.store_id as visible_id, v.store_position, s.pos_account_id as account_id
    from app.visible_stores(menu_engineering.store_ids) v
    join public.stores s on s.id = v.store_id
  ),
  periods as (
    select * from app.item_cost_periods(menu_engineering.store_ids)
  ),
  overrides as (
    select * from app.item_category_map(menu_engineering.store_ids)
  ),
  store_days as (
    select
      a.store_id as day_store_id,
      a.item_external_id as key,
      a.item_name as row_name,
      a.item_type_external_id as row_type_id,
      a.item_type_name as row_type_name,
      a.quantity as row_quantity,
      a.net_amount as row_net,
      coalesce(sp.cost_amount, tp.cost_amount) as day_cost
    from public.agg_item_daily a
    join visible vis on vis.visible_id = a.store_id
    left join periods sp
      on sp.for_store_id = a.store_id
     and sp.item_external_id = a.item_external_id
     and sp.store_scoped
     and a.business_date >= sp.valid_from
     and (sp.valid_until is null or a.business_date < sp.valid_until)
    left join periods tp
      on tp.for_store_id = a.store_id
     and tp.item_external_id = a.item_external_id
     and not tp.store_scoped
     and a.business_date >= tp.valid_from
     and (tp.valid_until is null or a.business_date < tp.valid_until)
    where a.business_date between window_start and menu_engineering.as_of_date
  ),
  store_items as (
    select
      d.day_store_id as item_store_id,
      d.key as item_key,
      vis.store_position as item_position,
      vis.account_id as item_account_id,
      max(d.row_type_id) as pos_type,
      max(d.row_type_name) as pos_type_name
    from store_days d
    join visible vis on vis.visible_id = d.day_store_id
    group by d.day_store_id, d.key, vis.store_position, vis.account_id
  ),
  store_types as (
    select
      si.item_store_id as typed_store_id,
      si.item_key as typed_key,
      si.item_position as typed_position,
      coalesce(o.item_type_external_id, si.pos_type) as type_id,
      case when o.item_key is not null then o.item_type_name else si.pos_type_name end as type_name,
      case
        when o.item_key is not null then 'override'
        when si.pos_type is null then 'none'
        else 'pos'
      end as source,
      r.role as mapped_role
    from store_items si
    left join overrides o
      on o.pos_account_id = si.item_account_id
     and o.item_key = si.item_key
    left join public.item_type_roles r
      on r.pos_account_id = si.item_account_id
     and r.item_type_external_id = coalesce(o.item_type_external_id, si.pos_type)
  ),
  per_item as (
    select
      coalesce(st.mapped_role, 'other'::public.item_type_role) as item_role,
      d.key,
      max(d.row_name) as name,
      sum(d.row_quantity) as item_quantity,
      sum(d.row_net) as item_net,
      bool_or(d.day_cost is null) as without_cost,
      sum(d.row_quantity * d.day_cost) as cost_total,
      bool_and(st.mapped_role is not null) as mapped,
      (array_agg(st.type_id order by st.typed_position))[1] as type_id,
      (array_agg(st.type_name order by st.typed_position))[1] as type_name,
      (array_agg(st.source order by st.typed_position))[1] as source
    from store_days d
    join store_types st
      on st.typed_store_id = d.day_store_id
     and st.typed_key = d.key
    group by coalesce(st.mapped_role, 'other'::public.item_type_role), d.key
  ),
  role_flags as (
    select p.item_role as flag_role, bool_or(p.without_cost) as role_provisional, count(*) < used_low as role_low_sample
    from per_item p
    group by p.item_role
  ),
  axes as (
    select
      p.*,
      rf.role_provisional,
      rf.role_low_sample,
      case
        when rf.role_provisional then p.item_net / nullif(p.item_quantity, 0)
        else (p.item_net - p.cost_total) / nullif(p.item_quantity, 0)
      end as axis
    from per_item p
    join role_flags rf on rf.flag_role = p.item_role
  ),
  role_totals as (
    select
      x.item_role as total_role,
      count(*) as item_count,
      sum(x.item_quantity) as role_quantity,
      sum(x.axis * x.item_quantity) / nullif(sum(x.item_quantity), 0) as threshold
    from axes x
    group by x.item_role
  )
  select
    x.item_role,
    x.mapped,
    x.key,
    x.name,
    x.type_id,
    x.type_name,
    x.source,
    x.item_quantity,
    x.item_net,
    round(100 * x.item_quantity / nullif(rt.role_quantity, 0), 3),
    round(100 * used_factor / rt.item_count, 3),
    round(x.item_net / nullif(x.item_quantity, 0), 2),
    case when x.without_cost then null else round(x.cost_total / nullif(x.item_quantity, 0), 2) end,
    round(x.axis, 2),
    round(rt.threshold, 2),
    x.role_provisional,
    x.role_low_sample,
    case
      when x.item_quantity / nullif(rt.role_quantity, 0) >= used_factor / rt.item_count and x.axis >= rt.threshold then 'star'
      when x.item_quantity / nullif(rt.role_quantity, 0) >= used_factor / rt.item_count then 'plowhorse'
      when x.axis >= rt.threshold then 'puzzle'
      else 'dog'
    end,
    window_start,
    used_window,
    used_factor,
    used_low
  from axes x
  join role_totals rt on rt.total_role = x.item_role
  order by x.item_role, x.item_quantity desc, x.key collate "C";

  get diagnostics returned_rows = row_count;
  perform app.require_report_rows('menu_engineering', returned_rows);
end;
$$;

create function public.item_margins(store_ids uuid[], from_date date, to_date date)
returns table (
  item_external_id text,
  item_name text,
  base_name text,
  size_label text,
  item_type_external_id text,
  item_type_name text,
  role public.item_type_role,
  quantity numeric,
  net_amount numeric,
  costed_quantity numeric,
  costed_net_amount numeric,
  cost_amount numeric,
  unit_cost_latest numeric,
  margin_amount numeric,
  margin_rate numeric,
  cost_coverage numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  max_days constant integer := 400;
  returned_rows bigint;
begin
  perform app.require_store_ids('item_margins', item_margins.store_ids);
  perform app.require_date_range('item_margins', item_margins.from_date, item_margins.to_date, max_days);
  if cardinality(item_margins.store_ids) = 0 then
    return;
  end if;

  return query
  with visible as (
    select v.store_id as visible_id, v.store_position
    from app.visible_stores(item_margins.store_ids) v
  ),
  periods as (
    select * from app.item_cost_periods(item_margins.store_ids)
  ),
  store_days as (
    select
      a.item_external_id as key,
      a.item_name as row_name,
      a.base_name as row_base,
      a.size_label as row_size,
      a.quantity as row_quantity,
      a.net_amount as row_net,
      coalesce(sp.cost_amount, tp.cost_amount) as day_cost
    from public.agg_item_daily a
    join visible vis on vis.visible_id = a.store_id
    left join periods sp
      on sp.for_store_id = a.store_id
     and sp.item_external_id = a.item_external_id
     and sp.store_scoped
     and a.business_date >= sp.valid_from
     and (sp.valid_until is null or a.business_date < sp.valid_until)
    left join periods tp
      on tp.for_store_id = a.store_id
     and tp.item_external_id = a.item_external_id
     and not tp.store_scoped
     and a.business_date >= tp.valid_from
     and (tp.valid_until is null or a.business_date < tp.valid_until)
    where a.business_date between item_margins.from_date and item_margins.to_date
  ),
  latest_costs as (
    select distinct on (p.item_external_id)
      p.item_external_id as cost_item,
      p.cost_amount as latest_amount
    from periods p
    join visible vis on vis.visible_id = p.for_store_id
    where item_margins.to_date >= p.valid_from
      and (p.valid_until is null or item_margins.to_date < p.valid_until)
    order by p.item_external_id, vis.store_position, p.store_scoped desc
  ),
  per_item as (
    select
      d.key,
      max(d.row_name) as name,
      max(d.row_base) as base,
      max(d.row_size) as size,
      sum(d.row_quantity) as item_quantity,
      sum(d.row_net) as item_net,
      count(d.day_cost) as costed_days,
      coalesce(sum(d.row_quantity) filter (where d.day_cost is not null), 0) as costed_qty,
      coalesce(sum(d.row_net) filter (where d.day_cost is not null), 0) as costed_net,
      round(sum(d.row_quantity * d.day_cost), 2) as cost_total
    from store_days d
    group by d.key
  ),
  types as (
    select * from app.effective_item_types(item_margins.store_ids, item_margins.from_date, item_margins.to_date)
  )
  select
    p.key,
    p.name,
    p.base,
    p.size,
    t.item_type_external_id,
    t.item_type_name,
    t.role,
    p.item_quantity,
    p.item_net,
    p.costed_qty,
    p.costed_net,
    p.cost_total,
    lc.latest_amount,
    case when p.costed_days > 0 then p.costed_net - p.cost_total end,
    case when p.costed_days > 0 then round((p.costed_net - p.cost_total) / nullif(p.costed_net, 0), 6) end,
    round(p.costed_net / nullif(p.item_net, 0), 6)
  from per_item p
  left join types t on t.item_key = p.key
  left join latest_costs lc on lc.cost_item = p.key
  order by p.item_net desc, p.key collate "C";

  get diagnostics returned_rows = row_count;
  perform app.require_report_rows('item_margins', returned_rows);
end;
$$;

create function public.item_attach(store_ids uuid[], from_date date, to_date date)
returns table (
  item_external_id text,
  item_name text,
  drink_invoices bigint,
  topping_base_invoices bigint,
  topping_invoices bigint,
  snack_base_invoices bigint,
  snack_invoices bigint,
  topping_rate numeric,
  snack_rate numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  max_days constant integer := 92;
  returned_rows bigint;
begin
  perform app.require_store_ids('item_attach', item_attach.store_ids);
  perform app.require_date_range('item_attach', item_attach.from_date, item_attach.to_date, max_days);
  if cardinality(item_attach.store_ids) = 0 then
    return;
  end if;

  return query
  with visible as (
    select v.store_id as visible_id, s.pos_account_id as account_id
    from app.visible_stores(item_attach.store_ids) v
    join public.stores s on s.id = v.store_id
  ),
  mapped as (
    select
      vis.visible_id as mapped_store,
      coalesce(bool_or(r.role = 'topping'), false) as maps_topping,
      coalesce(bool_or(r.role = 'snack'), false) as maps_snack
    from visible vis
    left join public.item_type_roles r on r.pos_account_id = vis.account_id
    group by vis.visible_id
  ),
  overrides as (
    select * from app.item_category_map(item_attach.store_ids)
  ),
  lines as (
    select
      inv.invoice_id as line_invoice,
      inv.store_id as line_store,
      coalesce(l.item_external_id, l.item_name) as key,
      l.item_name as line_name,
      r.role as line_role
    from app.sales_invoices(null, item_attach.from_date, item_attach.to_date, item_attach.store_ids) inv
    join visible vis on vis.visible_id = inv.store_id
    cross join lateral (
      select il.item_external_id, il.item_name, il.item_type_external_id
      from public.invoice_lines il
      where il.invoice_id = inv.invoice_id
        and il.line_kind = 'item'
    ) l
    left join overrides o
      on o.pos_account_id = inv.pos_account_id
     and o.item_key = coalesce(l.item_external_id, l.item_name)
    left join public.item_type_roles r
      on r.pos_account_id = inv.pos_account_id
     and r.item_type_external_id = coalesce(o.item_type_external_id, l.item_type_external_id)
    where inv.status <> 'voided'
  ),
  invoices as (
    select
      ln.line_invoice,
      ln.line_store,
      bool_or(ln.line_role = 'drink') as has_drink,
      bool_or(ln.line_role = 'topping') as has_topping,
      bool_or(ln.line_role = 'snack') as has_snack
    from lines ln
    group by ln.line_invoice, ln.line_store
  ),
  drink_invoices as (
    select i.*, m.maps_topping, m.maps_snack
    from invoices i
    join mapped m on m.mapped_store = i.line_store
    where i.has_drink
  ),
  summary as (
    select
      null::text as key,
      null::text as name,
      count(*) as drinks,
      count(*) filter (where d.maps_topping) as topping_base,
      count(*) filter (where d.maps_topping and d.has_topping) as with_topping,
      count(*) filter (where d.maps_snack) as snack_base,
      count(*) filter (where d.maps_snack and d.has_snack) as with_snack,
      0 as position
    from drink_invoices d
  ),
  per_drink as (
    select
      ln.key,
      max(ln.line_name) as name,
      count(distinct d.line_invoice) as drinks,
      count(distinct d.line_invoice) filter (where d.maps_topping) as topping_base,
      count(distinct d.line_invoice) filter (where d.maps_topping and d.has_topping) as with_topping,
      count(distinct d.line_invoice) filter (where d.maps_snack) as snack_base,
      count(distinct d.line_invoice) filter (where d.maps_snack and d.has_snack) as with_snack,
      1 as position
    from lines ln
    join drink_invoices d on d.line_invoice = ln.line_invoice
    where ln.line_role = 'drink'
    group by ln.key
  ),
  combined as (
    select * from summary
    union all
    select * from per_drink
  )
  select
    c.key,
    c.name,
    c.drinks,
    c.topping_base,
    c.with_topping,
    c.snack_base,
    c.with_snack,
    round(c.with_topping::numeric / nullif(c.topping_base, 0), 6),
    round(c.with_snack::numeric / nullif(c.snack_base, 0), 6)
  from combined c
  order by c.position, c.drinks desc, c.key collate "C";

  get diagnostics returned_rows = row_count;
  perform app.require_report_rows('item_attach', returned_rows);
end;
$$;

create or replace function public.item_summary(
  store_ids uuid[],
  from_date date,
  to_date date,
  compare_from date default null,
  compare_to date default null
)
returns table (
  item_external_id text,
  item_name text,
  base_name text,
  size_label text,
  item_type_external_id text,
  item_type_name text,
  role public.item_type_role,
  quantity numeric,
  net_amount numeric,
  invoices bigint,
  days_sold integer,
  net_share numeric,
  compare_quantity numeric,
  compare_net_amount numeric,
  compare_net_share numeric,
  first_sold_on date,
  last_sold_on date
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  max_range_days constant integer := 400;
  has_compare boolean := item_summary.compare_from is not null;
  returned_rows bigint;
begin
  perform app.require_store_ids('item_summary', item_summary.store_ids);
  perform app.require_date_range('item_summary', item_summary.from_date, item_summary.to_date, max_range_days);
  perform app.require_compare_range('item_summary', item_summary.compare_from, item_summary.compare_to, max_range_days);

  return query
  with store_rows as (
    select
      a.item_external_id as item_key,
      a.store_id as row_store_id,
      a.business_date as sold_on,
      a.item_name as row_item_name,
      a.base_name as row_base_name,
      a.size_label as row_size_label,
      a.item_type_external_id as row_type_id,
      a.item_type_name as row_type_name,
      a.quantity as row_quantity,
      a.net_amount as row_net_amount,
      a.invoices as row_invoices,
      a.business_date between item_summary.from_date and item_summary.to_date as in_current,
      coalesce(a.business_date between item_summary.compare_from and item_summary.compare_to, false) as in_compare
    from public.agg_item_daily a
    where a.store_id = any (item_summary.store_ids)
      and (
        a.business_date between item_summary.from_date and item_summary.to_date
        or a.business_date between item_summary.compare_from and item_summary.compare_to
      )
  ),
  per_item as (
    select
      r.item_key,
      bool_or(r.in_current) as sold_in_current,
      max(r.row_item_name) filter (where r.in_current) as current_item_name,
      max(r.row_item_name) filter (where r.in_compare) as compare_item_name,
      max(r.row_base_name) filter (where r.in_current) as current_base_name,
      max(r.row_base_name) filter (where r.in_compare) as compare_base_name,
      max(r.row_size_label) filter (where r.in_current) as current_size_label,
      max(r.row_size_label) filter (where r.in_compare) as compare_size_label,
      max(r.row_type_id) filter (where r.in_current) as current_type_id,
      max(r.row_type_id) filter (where r.in_compare) as compare_type_id,
      max(r.row_type_name) filter (where r.in_current) as current_type_name,
      max(r.row_type_name) filter (where r.in_compare) as compare_type_name,
      coalesce(sum(r.row_quantity) filter (where r.in_current), 0) as item_quantity,
      coalesce(sum(r.row_net_amount) filter (where r.in_current), 0) as item_net_amount,
      coalesce(sum(r.row_invoices) filter (where r.in_current), 0) as item_invoices,
      (count(distinct r.sold_on) filter (where r.in_current))::integer as item_days_sold,
      coalesce(sum(r.row_quantity) filter (where r.in_compare), 0) as item_compare_quantity,
      coalesce(sum(r.row_net_amount) filter (where r.in_compare), 0) as item_compare_net_amount
    from store_rows r
    group by r.item_key
  ),
  labelled as (
    select
      p.*,
      case when p.sold_in_current then p.current_type_id else p.compare_type_id end as chosen_type_id
    from per_item p
  ),
  range_totals as (
    select sum(p.item_net_amount) as current_net_total, sum(p.item_compare_net_amount) as compare_net_total
    from per_item p
  ),
  accounts as (
    select v.store_id as account_store_id, v.store_position, s.pos_account_id
    from app.visible_stores(item_summary.store_ids) v
    join public.stores s on s.id = v.store_id
  ),
  first_sellers as (
    select distinct on (r.item_key) r.item_key, ac.pos_account_id as seller_account_id
    from store_rows r
    join accounts ac on ac.account_store_id = r.row_store_id
    order by r.item_key, ac.store_position
  ),
  overrides as (
    select fs.item_key, m.item_type_external_id as override_type_id, m.item_type_name as override_type_name
    from first_sellers fs
    join app.item_category_map(item_summary.store_ids) m
      on m.pos_account_id = fs.seller_account_id
     and m.item_key = fs.item_key
  ),
  effective as (
    select
      l.*,
      coalesce(o.override_type_id, l.chosen_type_id) as effective_type_id,
      case
        when o.item_key is not null then o.override_type_name
        when l.sold_in_current then l.current_type_name
        else l.compare_type_name
      end as effective_type_name
    from labelled l
    left join overrides o on o.item_key = l.item_key
  ),
  sold_dates as (
    select a.item_external_id as item_key, min(a.business_date) as first_on, max(a.business_date) as last_on
    from public.agg_item_daily a
    where a.store_id = any (item_summary.store_ids)
      and a.item_external_id in (select p.item_key from per_item p)
    group by a.item_external_id
  )
  select
    l.item_key,
    case when l.sold_in_current then l.current_item_name else l.compare_item_name end,
    case when l.sold_in_current then l.current_base_name else l.compare_base_name end,
    case when l.sold_in_current then l.current_size_label else l.compare_size_label end,
    l.effective_type_id,
    l.effective_type_name,
    (
      select r.role
      from accounts ac
      join public.item_type_roles r
        on r.pos_account_id = ac.pos_account_id
        and r.item_type_external_id = l.effective_type_id
      order by ac.store_position
      limit 1
    ),
    l.item_quantity,
    l.item_net_amount,
    l.item_invoices,
    l.item_days_sold,
    round(l.item_net_amount / nullif(t.current_net_total, 0), 6),
    case when has_compare then l.item_compare_quantity end,
    case when has_compare then l.item_compare_net_amount end,
    case when has_compare then round(l.item_compare_net_amount / nullif(t.compare_net_total, 0), 6) end,
    sd.first_on,
    sd.last_on
  from effective l
  cross join range_totals t
  left join sold_dates sd on sd.item_key = l.item_key
  order by l.item_net_amount desc, l.item_quantity desc, l.item_key collate "C";

  get diagnostics returned_rows = row_count;
  perform app.require_report_rows('item_summary', returned_rows);
end;
$$;

revoke all on function app.item_cost_periods(uuid[]) from public;
revoke all on function app.effective_item_types(uuid[], date, date) from public;
revoke all on function public.menu_engineering(uuid[], date, integer, numeric, integer) from public, anon;
revoke all on function public.item_margins(uuid[], date, date) from public, anon;
revoke all on function public.item_attach(uuid[], date, date) from public, anon;

grant execute on function app.item_cost_periods(uuid[]) to authenticated, service_role;
grant execute on function app.effective_item_types(uuid[], date, date) to authenticated, service_role;
grant execute on function public.menu_engineering(uuid[], date, integer, numeric, integer) to authenticated, service_role;
grant execute on function public.item_margins(uuid[], date, date) to authenticated, service_role;
grant execute on function public.item_attach(uuid[], date, date) to authenticated, service_role;
