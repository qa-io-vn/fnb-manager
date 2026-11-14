create function public.basket_pairs(
  store_ids uuid[],
  from_date date,
  to_date date,
  min_pair_invoices integer default 3,
  max_pairs integer default 50
)
returns table (
  item_a_external_id text,
  item_a_name text,
  item_b_external_id text,
  item_b_name text,
  pair_invoices integer,
  invoices_a integer,
  invoices_b integer,
  window_invoices integer,
  support_a numeric,
  support_b numeric,
  confidence_a_to_b numeric,
  confidence_b_to_a numeric,
  lift numeric
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
  perform app.require_store_ids('basket_pairs', basket_pairs.store_ids);
  perform app.require_date_range('basket_pairs', basket_pairs.from_date, basket_pairs.to_date, max_days);
  if basket_pairs.min_pair_invoices is null or basket_pairs.min_pair_invoices not between 1 and 50 then
    raise exception using errcode = '22023', message = 'basket_pairs needs min_pair_invoices between 1 and 50';
  end if;
  if basket_pairs.max_pairs is null or basket_pairs.max_pairs not between 1 and 900 then
    raise exception using errcode = '22023', message = 'basket_pairs needs max_pairs between 1 and 900';
  end if;
  if cardinality(basket_pairs.store_ids) = 0 then
    return;
  end if;

  return query
  with visible as (
    select v.store_id as visible_id
    from app.visible_stores(basket_pairs.store_ids) v
  ),
  item_lines as (
    select
      inv.invoice_id as line_invoice,
      coalesce(l.item_external_id, l.item_name) as key,
      l.item_name as line_name
    from app.sales_invoices(null, basket_pairs.from_date, basket_pairs.to_date, basket_pairs.store_ids) inv
    join visible vis on vis.visible_id = inv.store_id
    cross join lateral (
      select il.item_external_id, il.item_name
      from public.invoice_lines il
      where il.invoice_id = inv.invoice_id
        and il.line_kind = 'item'
    ) l
    where inv.status <> 'voided'
  ),
  invoice_items as (
    select distinct li.line_invoice, li.key
    from item_lines li
  ),
  window_total as (
    select count(distinct ii.line_invoice) as total
    from invoice_items ii
  ),
  item_totals as (
    select ii.key, count(*) as item_invoices
    from invoice_items ii
    group by ii.key
  ),
  item_names as (
    select li.key, max(li.line_name) as name
    from item_lines li
    group by li.key
  ),
  pairs as (
    select a.key as key_a, b.key as key_b, count(*) as together
    from invoice_items a
    join invoice_items b
      on b.line_invoice = a.line_invoice
     and b.key collate "C" > a.key collate "C"
    group by a.key, b.key
    having count(*) >= basket_pairs.min_pair_invoices
  ),
  scored as (
    select
      p.key_a,
      na.name as name_a,
      p.key_b,
      nb.name as name_b,
      p.together,
      ta.item_invoices as invoices_of_a,
      tb.item_invoices as invoices_of_b,
      w.total,
      round(
        (p.together::numeric / w.total)
        / ((ta.item_invoices::numeric / w.total) * (tb.item_invoices::numeric / w.total)),
        4
      ) as pair_lift
    from pairs p
    cross join window_total w
    join item_totals ta on ta.key = p.key_a
    join item_totals tb on tb.key = p.key_b
    join item_names na on na.key = p.key_a
    join item_names nb on nb.key = p.key_b
  )
  select
    sc.key_a,
    sc.name_a,
    sc.key_b,
    sc.name_b,
    sc.together::integer,
    sc.invoices_of_a::integer,
    sc.invoices_of_b::integer,
    sc.total::integer,
    round(sc.invoices_of_a::numeric / sc.total, 6),
    round(sc.invoices_of_b::numeric / sc.total, 6),
    round(sc.together::numeric / sc.invoices_of_a, 6),
    round(sc.together::numeric / sc.invoices_of_b, 6),
    sc.pair_lift
  from scored sc
  order by sc.together desc, sc.pair_lift desc, sc.key_a collate "C", sc.key_b collate "C"
  limit basket_pairs.max_pairs;

  get diagnostics returned_rows = row_count;
  perform app.require_report_rows('basket_pairs', returned_rows);
end;
$$;

create function public.modifier_summary(
  store_ids uuid[],
  from_date date,
  to_date date,
  compare_from date default null,
  compare_to date default null
)
returns table (
  modifier_name text,
  lines bigint,
  share numeric,
  compare_lines bigint,
  compare_share numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  max_range_days constant integer := 400;
  has_compare boolean := modifier_summary.compare_from is not null;
  returned_rows bigint;
begin
  perform app.require_store_ids('modifier_summary', modifier_summary.store_ids);
  perform app.require_date_range('modifier_summary', modifier_summary.from_date, modifier_summary.to_date, max_range_days);
  perform app.require_compare_range('modifier_summary', modifier_summary.compare_from, modifier_summary.compare_to, max_range_days);
  if cardinality(modifier_summary.store_ids) = 0 then
    return;
  end if;

  return query
  with visible as (
    select v.store_id as visible_id
    from app.visible_stores(modifier_summary.store_ids) v
  ),
  modifier_rows as (
    select
      a.modifier_name as name,
      a.count as row_lines,
      a.business_date between modifier_summary.from_date and modifier_summary.to_date as in_current,
      coalesce(a.business_date between modifier_summary.compare_from and modifier_summary.compare_to, false) as in_compare
    from public.agg_modifier_prefs_daily a
    join visible vis on vis.visible_id = a.store_id
    where a.business_date between modifier_summary.from_date and modifier_summary.to_date
       or a.business_date between modifier_summary.compare_from and modifier_summary.compare_to
  ),
  per_name as (
    select
      r.name,
      coalesce(sum(r.row_lines) filter (where r.in_current), 0)::bigint as current_lines,
      coalesce(sum(r.row_lines) filter (where r.in_compare), 0)::bigint as compare_count
    from modifier_rows r
    group by r.name
  ),
  totals as (
    select sum(p.current_lines) as current_total, sum(p.compare_count) as compare_total
    from per_name p
  )
  select
    p.name,
    p.current_lines,
    round(p.current_lines / nullif(t.current_total, 0), 6),
    case when has_compare then p.compare_count end,
    case when has_compare then round(p.compare_count / nullif(t.compare_total, 0), 6) end
  from per_name p
  cross join totals t
  order by p.current_lines desc, p.name collate "C";

  get diagnostics returned_rows = row_count;
  perform app.require_report_rows('modifier_summary', returned_rows);
end;
$$;

create or replace function public.cash_variance_flags(
  store_ids uuid[],
  from_date date,
  to_date date,
  abs_threshold numeric default null,
  rel_threshold numeric default null
)
returns table (
  store_id uuid,
  shift_id uuid,
  shift_external_id text,
  business_date date,
  cashier_name text,
  cash_sales_amount numeric,
  variance_amount numeric,
  trailing_shifts integer,
  trailing_mean_variance numeric,
  trailing_stddev_variance numeric,
  z_score numeric,
  over_abs_threshold boolean,
  over_rel_threshold boolean,
  over_z_threshold boolean,
  reasons text[]
)
language sql
stable
security invoker
set search_path = ''
as $$
  with first_settings as (
    select r.cash_abs_threshold, r.cash_rel_threshold
    from app.store_report_settings(cash_variance_flags.store_ids) with ordinality as r (
      store_id, tenant_id, has_tenant_row, menu_window_days, menu_popularity_factor, menu_low_sample_items,
      cash_abs_threshold, cash_rel_threshold, z_threshold, peak_hours, dead_hour_ratio, busy_hour_ratio,
      promo_pre_weeks, settings_position
    )
    order by r.settings_position
    limit 1
  ),
  thresholds as (
    select
      coalesce(cash_variance_flags.abs_threshold, (select fs.cash_abs_threshold from first_settings fs)) as used_abs,
      coalesce(cash_variance_flags.rel_threshold, (select fs.cash_rel_threshold from first_settings fs)) as used_rel
  )
  select
    s.store_id,
    s.shift_id,
    s.shift_external_id,
    s.business_date,
    s.cashier_name,
    s.cash_sales_amount,
    s.variance_amount,
    v.trailing_shifts,
    v.trailing_mean_variance,
    v.trailing_stddev_variance,
    v.z_score,
    v.over_abs_threshold,
    v.over_rel_threshold,
    v.over_z_threshold,
    v.reasons
  from thresholds th
  cross join lateral app.shift_variance_scores(
    cash_variance_flags.store_ids,
    cash_variance_flags.from_date,
    cash_variance_flags.to_date,
    th.used_abs,
    th.used_rel
  ) v
  join public.agg_shift_cash s on s.shift_id = v.shift_id
  where s.store_id = any (cash_variance_flags.store_ids)
    and s.business_date between cash_variance_flags.from_date and cash_variance_flags.to_date
    and (v.over_abs_threshold or v.over_rel_threshold or v.over_z_threshold)
  order by s.business_date, s.store_id, s.shift_external_id;
$$;

create or replace function public.shift_review(
  store_ids uuid[],
  from_date date,
  to_date date,
  abs_threshold numeric default null,
  rel_threshold numeric default null
)
returns table (
  store_id uuid,
  shift_id uuid,
  shift_external_id text,
  shift_name text,
  business_date date,
  cashier_name text,
  opened_at timestamptz,
  closed_at timestamptz,
  orders integer,
  sales_amount numeric,
  cash_sales_amount numeric,
  opening_float_amount numeric,
  expected_cash_amount numeric,
  drawer_amount numeric,
  variance_amount numeric,
  trailing_shifts integer,
  z_score numeric,
  over_abs_threshold boolean,
  over_rel_threshold boolean,
  over_z_threshold boolean,
  flagged boolean,
  reasons text[]
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  max_range_days constant integer := 92;
  used_abs numeric;
  used_rel numeric;
  returned_rows bigint;
begin
  perform app.require_store_ids('shift_review', shift_review.store_ids);
  perform app.require_date_range('shift_review', shift_review.from_date, shift_review.to_date, max_range_days);

  select r.cash_abs_threshold, r.cash_rel_threshold
  into used_abs, used_rel
  from app.store_report_settings(shift_review.store_ids) with ordinality as r (
    store_id, tenant_id, has_tenant_row, menu_window_days, menu_popularity_factor, menu_low_sample_items,
    cash_abs_threshold, cash_rel_threshold, z_threshold, peak_hours, dead_hour_ratio, busy_hour_ratio,
    promo_pre_weeks, settings_position
  )
  order by r.settings_position
  limit 1;
  used_abs := coalesce(shift_review.abs_threshold, used_abs);
  used_rel := coalesce(shift_review.rel_threshold, used_rel);

  return query
  select
    s.store_id,
    s.shift_id,
    s.shift_external_id,
    sh.name,
    s.business_date,
    s.cashier_name,
    s.opened_at,
    s.closed_at,
    s.orders,
    s.sales_amount,
    s.cash_sales_amount,
    s.opening_float_amount,
    s.expected_cash_amount,
    s.drawer_amount,
    s.variance_amount,
    v.trailing_shifts,
    v.z_score,
    coalesce(v.over_abs_threshold, false),
    coalesce(v.over_rel_threshold, false),
    coalesce(v.over_z_threshold, false),
    coalesce(v.over_abs_threshold or v.over_rel_threshold or v.over_z_threshold, false),
    coalesce(v.reasons, '{}'::text[])
  from public.agg_shift_cash s
  left join public.shifts sh on sh.id = s.shift_id
  left join app.shift_variance_scores(
    shift_review.store_ids,
    shift_review.from_date,
    shift_review.to_date,
    used_abs,
    used_rel
  ) v on v.shift_id = s.shift_id
  where s.store_id = any (shift_review.store_ids)
    and s.business_date between shift_review.from_date and shift_review.to_date
  order by s.business_date, s.store_id, s.opened_at, s.shift_external_id collate "C";

  get diagnostics returned_rows = row_count;
  perform app.require_report_rows('shift_review', returned_rows);
end;
$$;

revoke all on function public.basket_pairs(uuid[], date, date, integer, integer) from public, anon;
revoke all on function public.modifier_summary(uuid[], date, date, date, date) from public, anon;
revoke all on function public.cash_variance_flags(uuid[], date, date, numeric, numeric) from public, anon;
revoke all on function public.shift_review(uuid[], date, date, numeric, numeric) from public, anon;

grant execute on function public.basket_pairs(uuid[], date, date, integer, integer) to authenticated, service_role;
grant execute on function public.modifier_summary(uuid[], date, date, date, date) to authenticated, service_role;
grant execute on function public.cash_variance_flags(uuid[], date, date, numeric, numeric) to authenticated, service_role;
grant execute on function public.shift_review(uuid[], date, date, numeric, numeric) to authenticated, service_role;
