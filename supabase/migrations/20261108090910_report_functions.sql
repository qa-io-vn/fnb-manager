create function app.visible_stores(store_ids uuid[])
returns table (store_id uuid, store_position bigint)
language sql
stable
security invoker
rows 10
set search_path = ''
as $$
  select s.id, r.first_position
  from (
    select u.requested_id, min(u.requested_position) as first_position
    from unnest(visible_stores.store_ids) with ordinality as u (requested_id, requested_position)
    group by u.requested_id
  ) r
  join public.stores s on s.id = r.requested_id
  order by r.first_position;
$$;

create function app.require_store_ids(function_name text, store_ids uuid[])
returns void
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if require_store_ids.store_ids is null or cardinality(require_store_ids.store_ids) > 50 then
    raise exception using
      errcode = '22023',
      message = format('%s needs store_ids with 0 to 50 store ids', require_store_ids.function_name);
  end if;
end;
$$;

create function app.require_date_range(function_name text, from_date date, to_date date, max_days integer)
returns void
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if require_date_range.from_date is null
    or require_date_range.to_date is null
    or require_date_range.from_date > require_date_range.to_date then
    raise exception using
      errcode = '22023',
      message = format('%s needs a date range whose start is not after its end', require_date_range.function_name);
  end if;
  if require_date_range.to_date - require_date_range.from_date + 1 > require_date_range.max_days then
    raise exception using
      errcode = '22023',
      message = format(
        '%s covers at most %s days, not %s',
        require_date_range.function_name,
        require_date_range.max_days,
        require_date_range.to_date - require_date_range.from_date + 1
      );
  end if;
end;
$$;

create function app.require_compare_range(function_name text, compare_from date, compare_to date, max_days integer)
returns void
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  if require_compare_range.compare_from is null and require_compare_range.compare_to is null then
    return;
  end if;
  if require_compare_range.compare_from is null or require_compare_range.compare_to is null then
    raise exception using
      errcode = '22023',
      message = format('%s needs compare_from and compare_to together', require_compare_range.function_name);
  end if;
  perform app.require_date_range(
    require_compare_range.function_name,
    require_compare_range.compare_from,
    require_compare_range.compare_to,
    require_compare_range.max_days
  );
end;
$$;

create function app.require_report_rows(function_name text, result_rows bigint)
returns void
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  max_rows constant integer := 900;
begin
  if require_report_rows.result_rows > max_rows then
    raise exception using
      errcode = '22023',
      message = format('%s returns at most %s rows, this call needs %s', require_report_rows.function_name, max_rows, require_report_rows.result_rows),
      hint = 'Ask for fewer stores, a shorter range or a coarser grain.';
  end if;
end;
$$;

create function app.period_bounds(grain text, anchor date)
returns table (period text, from_date date, to_date date)
language plpgsql
immutable
security invoker
rows 4
set search_path = ''
as $$
declare
  baseline_weeks constant integer := 8;
  current_start date;
  previous_start date;
  previous_period_end date;
  last_year_start date;
  last_year_period_end date;
  elapsed_days integer;
begin
  if period_bounds.anchor is null then
    raise exception using
      errcode = '22023',
      message = 'period_bounds needs an anchor date';
  end if;

  case period_bounds.grain
    when 'day' then
      current_start := period_bounds.anchor;
      previous_start := period_bounds.anchor - 1;
      previous_period_end := previous_start;
      last_year_start := period_bounds.anchor - 364;
      last_year_period_end := last_year_start;
    when 'week' then
      current_start := period_bounds.anchor - (extract(isodow from period_bounds.anchor)::integer - 1);
      previous_start := current_start - 7;
      previous_period_end := previous_start + 6;
      last_year_start := current_start - 364;
      last_year_period_end := last_year_start + 6;
    when 'month' then
      current_start := make_date(extract(year from period_bounds.anchor)::integer, extract(month from period_bounds.anchor)::integer, 1);
      previous_start := (current_start - interval '1 month')::date;
      previous_period_end := current_start - 1;
      last_year_start := (current_start - interval '1 year')::date;
      last_year_period_end := (last_year_start + interval '1 month' - interval '1 day')::date;
    when 'year' then
      current_start := make_date(extract(year from period_bounds.anchor)::integer, 1, 1);
      previous_start := (current_start - interval '1 year')::date;
      previous_period_end := current_start - 1;
      last_year_start := previous_start;
      last_year_period_end := previous_period_end;
    else
      raise exception using
        errcode = '22023',
        message = format('period_bounds grain must be day, week, month or year, not %s', coalesce(period_bounds.grain, 'null'));
  end case;
  elapsed_days := period_bounds.anchor - current_start;

  period := 'current';
  from_date := current_start;
  to_date := period_bounds.anchor;
  return next;

  period := 'previous';
  from_date := previous_start;
  to_date := least(previous_start + elapsed_days, previous_period_end);
  return next;

  period := 'last_year';
  from_date := last_year_start;
  to_date := least(last_year_start + elapsed_days, last_year_period_end);
  return next;

  if period_bounds.grain = 'day' then
    period := 'baseline';
    from_date := period_bounds.anchor - 7 * baseline_weeks;
    to_date := period_bounds.anchor - 7;
    return next;
  end if;
end;
$$;

create function app.period_totals(store_ids uuid[], from_date date, to_date date)
returns table (
  days_with_data integer,
  invoices bigint,
  net_amount numeric,
  gross_amount numeric,
  item_discount_amount numeric,
  bill_discount_amount numeric,
  voucher_amount numeric,
  discount_amount numeric,
  paid_amount numeric,
  cash_amount numeric,
  items_sold numeric,
  voucher_invoices bigint,
  member_invoices bigint,
  identified_invoices bigint,
  voided_invoices bigint,
  voided_amount numeric,
  edited_invoices bigint,
  avg_ticket numeric,
  items_per_ticket numeric,
  avg_item_price numeric,
  cash_share numeric,
  voucher_share numeric,
  member_share numeric,
  identified_share numeric,
  discount_rate numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with totals as (
    select
      count(*) as days_with_data,
      sum(d.invoices) as invoices,
      sum(d.net_amount) as net_amount,
      sum(d.gross_amount) as gross_amount,
      sum(d.item_discount_amount) as item_discount_amount,
      sum(d.bill_discount_amount) as bill_discount_amount,
      sum(d.voucher_amount) as voucher_amount,
      sum(d.item_discount_amount + d.bill_discount_amount + d.voucher_amount) as discount_amount,
      sum(d.paid_amount) as paid_amount,
      sum(d.cash_amount) as cash_amount,
      sum(d.items_sold) as items_sold,
      sum(d.voucher_invoices) as voucher_invoices,
      sum(d.member_invoices) as member_invoices,
      sum(d.identified_invoices) as identified_invoices,
      sum(d.voided_invoices) as voided_invoices,
      sum(d.voided_amount) as voided_amount,
      sum(d.edited_invoices) as edited_invoices
    from app.daily_sales(period_totals.store_ids, period_totals.from_date, period_totals.to_date) d
  )
  select
    t.days_with_data::integer,
    t.invoices,
    t.net_amount,
    t.gross_amount,
    t.item_discount_amount,
    t.bill_discount_amount,
    t.voucher_amount,
    t.discount_amount,
    t.paid_amount,
    t.cash_amount,
    t.items_sold,
    t.voucher_invoices,
    t.member_invoices,
    t.identified_invoices,
    t.voided_invoices,
    t.voided_amount,
    t.edited_invoices,
    round(t.net_amount / nullif(t.invoices, 0), 2),
    round(t.items_sold / nullif(t.invoices, 0), 4),
    round(t.net_amount / nullif(t.items_sold, 0), 2),
    round(t.cash_amount / nullif(t.paid_amount, 0), 6),
    round(t.voucher_invoices::numeric / nullif(t.invoices, 0), 6),
    round(t.member_invoices::numeric / nullif(t.invoices, 0), 6),
    round(t.identified_invoices::numeric / nullif(t.invoices, 0), 6),
    round(t.discount_amount / nullif(t.gross_amount, 0), 6)
  from totals t;
$$;

create function app.shift_variance_scores(store_ids uuid[], from_date date, to_date date, abs_threshold numeric, rel_threshold numeric)
returns table (
  shift_id uuid,
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
  with window_shifts as (
    select s.store_id, s.shift_id, s.business_date, s.cash_sales_amount, s.variance_amount
    from public.agg_shift_cash s
    where s.store_id = any (shift_variance_scores.store_ids)
      and s.business_date between shift_variance_scores.from_date and shift_variance_scores.to_date
      and s.variance_amount is not null
  ),
  scored as (
    select
      w.*,
      h.trailing_shifts,
      h.trailing_mean_variance,
      h.trailing_stddev_variance,
      case
        when h.trailing_shifts >= 3 and h.trailing_stddev_variance > 0
        then round((w.variance_amount - h.trailing_mean_variance) / h.trailing_stddev_variance, 3)
      end as z_score
    from window_shifts w
    cross join lateral (
      select
        count(*)::integer as trailing_shifts,
        round(avg(t.variance_amount), 2) as trailing_mean_variance,
        round(stddev_samp(t.variance_amount), 2) as trailing_stddev_variance
      from public.agg_shift_cash t
      where t.store_id = w.store_id
        and t.business_date between w.business_date - 56 and w.business_date - 1
        and t.variance_amount is not null
    ) h
  ),
  flagged as (
    select
      sc.*,
      abs(sc.variance_amount) > shift_variance_scores.abs_threshold as over_abs_threshold,
      sc.cash_sales_amount > 0 and abs(sc.variance_amount) > shift_variance_scores.rel_threshold * sc.cash_sales_amount as over_rel_threshold,
      coalesce(abs(sc.z_score) > 2, false) as over_z_threshold
    from scored sc
  )
  select
    f.shift_id,
    f.trailing_shifts,
    f.trailing_mean_variance,
    f.trailing_stddev_variance,
    f.z_score,
    f.over_abs_threshold,
    f.over_rel_threshold,
    f.over_z_threshold,
    array_remove(array[
      case when f.over_abs_threshold then 'absolute' end,
      case when f.over_rel_threshold then 'relative' end,
      case when f.over_z_threshold then 'z_score' end
    ], null)
  from flagged f;
$$;

create or replace function public.cash_variance_flags(
  store_ids uuid[],
  from_date date,
  to_date date,
  abs_threshold numeric default 50000,
  rel_threshold numeric default 0.005
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
  from app.shift_variance_scores(store_ids, from_date, to_date, abs_threshold, rel_threshold) v
  join public.agg_shift_cash s on s.shift_id = v.shift_id
  where s.store_id = any (cash_variance_flags.store_ids)
    and s.business_date between cash_variance_flags.from_date and cash_variance_flags.to_date
    and (v.over_abs_threshold or v.over_rel_threshold or v.over_z_threshold)
  order by s.business_date, s.store_id, s.shift_external_id;
$$;

create function public.period_compare_by_store(store_ids uuid[], grain text, anchor date)
returns table (
  store_id uuid,
  period text,
  from_date date,
  to_date date,
  days_with_data integer,
  invoices bigint,
  net_amount numeric,
  gross_amount numeric,
  item_discount_amount numeric,
  bill_discount_amount numeric,
  voucher_amount numeric,
  discount_amount numeric,
  paid_amount numeric,
  cash_amount numeric,
  items_sold numeric,
  voucher_invoices bigint,
  member_invoices bigint,
  identified_invoices bigint,
  voided_invoices bigint,
  voided_amount numeric,
  edited_invoices bigint,
  avg_ticket numeric,
  items_per_ticket numeric,
  avg_item_price numeric,
  cash_share numeric,
  voucher_share numeric,
  member_share numeric,
  identified_share numeric,
  discount_rate numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  baseline_weeks constant integer := 8;
begin
  perform app.require_store_ids('period_compare_by_store', period_compare_by_store.store_ids);
  perform app.period_bounds(period_compare_by_store.grain, period_compare_by_store.anchor);
  if cardinality(period_compare_by_store.store_ids) = 0 then
    return;
  end if;

  return query
  with blocks as (
    select null::uuid as block_store_id, 0::bigint as block_position, period_compare_by_store.store_ids as block_store_ids
    union all
    select v.store_id, v.store_position, array[v.store_id]
    from app.visible_stores(period_compare_by_store.store_ids) v
  ),
  bounds as (
    select b.period as bound_period, b.from_date as bound_from, b.to_date as bound_to, b.bound_position
    from app.period_bounds(period_compare_by_store.grain, period_compare_by_store.anchor)
      with ordinality as b (period, from_date, to_date, bound_position)
  ),
  block_rows as (
    select
      k.block_store_id, k.block_position, b.bound_position, b.bound_period, b.bound_from, b.bound_to,
      t.days_with_data, t.invoices, t.net_amount, t.gross_amount, t.item_discount_amount, t.bill_discount_amount,
      t.voucher_amount, t.discount_amount, t.paid_amount, t.cash_amount, t.items_sold, t.voucher_invoices,
      t.member_invoices, t.identified_invoices, t.voided_invoices, t.voided_amount, t.edited_invoices,
      t.avg_ticket, t.items_per_ticket, t.avg_item_price, t.cash_share, t.voucher_share, t.member_share,
      t.identified_share, t.discount_rate
    from blocks k
    cross join bounds b
    cross join lateral app.period_totals(k.block_store_ids, b.bound_from, b.bound_to) t
    where b.bound_period <> 'baseline'
    union all
    select
      k.block_store_id, k.block_position, b.bound_position, b.bound_period, b.bound_from, b.bound_to,
      w.sample_days, round(w.baseline_invoices)::bigint, w.baseline_net_amount, null::numeric, null::numeric, null::numeric,
      null::numeric, null::numeric, null::numeric, null::numeric, null::numeric, null::bigint,
      null::bigint, null::bigint, null::bigint, null::numeric, null::bigint,
      w.baseline_avg_ticket, null::numeric, null::numeric, null::numeric, null::numeric, null::numeric,
      null::numeric, null::numeric
    from blocks k
    cross join bounds b
    cross join lateral public.same_weekday_baseline(k.block_store_ids, period_compare_by_store.anchor, baseline_weeks) w
    where b.bound_period = 'baseline'
  )
  select
    r.block_store_id, r.bound_period, r.bound_from, r.bound_to,
    r.days_with_data, r.invoices, r.net_amount, r.gross_amount, r.item_discount_amount, r.bill_discount_amount,
    r.voucher_amount, r.discount_amount, r.paid_amount, r.cash_amount, r.items_sold, r.voucher_invoices,
    r.member_invoices, r.identified_invoices, r.voided_invoices, r.voided_amount, r.edited_invoices,
    r.avg_ticket, r.items_per_ticket, r.avg_item_price, r.cash_share, r.voucher_share, r.member_share,
    r.identified_share, r.discount_rate
  from block_rows r
  order by r.block_position, r.bound_position;
end;
$$;

create function public.period_series(store_ids uuid[], grain text, from_date date, to_date date)
returns table (
  store_id uuid,
  bucket_start date,
  bucket_end date,
  iso_year integer,
  iso_week smallint,
  weekday smallint,
  calendar_days integer,
  excluded_days integer,
  tet_days integer,
  holiday_kind text,
  checked_days integer,
  matched_days integer,
  days_with_data integer,
  invoices bigint,
  net_amount numeric,
  gross_amount numeric,
  item_discount_amount numeric,
  bill_discount_amount numeric,
  voucher_amount numeric,
  discount_amount numeric,
  paid_amount numeric,
  cash_amount numeric,
  items_sold numeric,
  voucher_invoices bigint,
  member_invoices bigint,
  identified_invoices bigint,
  voided_invoices bigint,
  voided_amount numeric,
  edited_invoices bigint,
  avg_ticket numeric,
  items_per_ticket numeric,
  avg_item_price numeric,
  cash_share numeric,
  voucher_share numeric,
  member_share numeric,
  identified_share numeric,
  discount_rate numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  max_range_days constant integer := 1100;
  bucket_count integer;
  visible_store_count integer;
begin
  perform app.require_store_ids('period_series', period_series.store_ids);
  perform app.require_date_range('period_series', period_series.from_date, period_series.to_date, max_range_days);
  if period_series.grain is null or period_series.grain not in ('day', 'week', 'month', 'year', 'weekday') then
    raise exception using
      errcode = '22023',
      message = format('period_series grain must be day, week, month, year or weekday, not %s', coalesce(period_series.grain, 'null'));
  end if;
  if cardinality(period_series.store_ids) = 0 then
    return;
  end if;

  select count(*)::integer into visible_store_count from app.visible_stores(period_series.store_ids);
  bucket_count := case period_series.grain
    when 'day' then period_series.to_date - period_series.from_date + 1
    when 'weekday' then 7
    when 'week' then
      ((period_series.to_date - extract(isodow from period_series.to_date)::integer)
        - (period_series.from_date - extract(isodow from period_series.from_date)::integer)) / 7 + 1
    when 'month' then
      (extract(year from period_series.to_date)::integer * 12 + extract(month from period_series.to_date)::integer)
        - (extract(year from period_series.from_date)::integer * 12 + extract(month from period_series.from_date)::integer) + 1
    else extract(year from period_series.to_date)::integer - extract(year from period_series.from_date)::integer + 1
  end;
  perform app.require_report_rows('period_series', bucket_count::bigint * (visible_store_count + 1));

  return query
  with blocks as (
    select null::uuid as block_store_id, 0::bigint as block_position
    union all
    select v.store_id, v.store_position
    from app.visible_stores(period_series.store_ids) v
  ),
  calendar as (
    select
      g.calendar_date,
      case period_series.grain
        when 'day' then g.calendar_date
        when 'week' then greatest(g.calendar_date - (extract(isodow from g.calendar_date)::integer - 1), period_series.from_date)
        when 'month' then greatest(make_date(extract(year from g.calendar_date)::integer, extract(month from g.calendar_date)::integer, 1), period_series.from_date)
        when 'year' then greatest(make_date(extract(year from g.calendar_date)::integer, 1, 1), period_series.from_date)
        else period_series.from_date
      end as series_start,
      case
        when period_series.grain in ('day', 'weekday') then extract(isodow from g.calendar_date)::smallint
        else 0::smallint
      end as series_weekday
    from (
      select period_series.from_date + o.day_offset as calendar_date
      from generate_series(0, period_series.to_date - period_series.from_date) as o (day_offset)
    ) g
  ),
  buckets as (
    select
      c.series_start,
      c.series_weekday,
      case when period_series.grain = 'weekday' then period_series.to_date else max(c.calendar_date) end as series_end,
      count(*)::integer as series_calendar_days
    from calendar c
    group by c.series_start, c.series_weekday
    union all
    select period_series.from_date, w.missing_weekday::smallint, period_series.to_date, 0
    from generate_series(1, 7) as w (missing_weekday)
    where period_series.grain = 'weekday'
      and not exists (select 1 from calendar c where c.series_weekday = w.missing_weekday)
  ),
  scopes as (
    select distinct t.id as scope_tenant_id, t.country_code as scope_country_code
    from app.visible_stores(period_series.store_ids) v
    join public.stores s on s.id = v.store_id
    join public.tenants t on t.id = s.tenant_id
  ),
  scoped_holidays as (
    select sc.scope_tenant_id, h.holiday_date as scoped_date, h.kind as scoped_kind
    from scopes sc
    join public.holidays h
      on h.country_code = sc.scope_country_code
      and (h.tenant_id is null or h.tenant_id = sc.scope_tenant_id)
    where h.holiday_date between period_series.from_date - 14 and period_series.to_date + 14
  ),
  tet_spans as (
    select first_day.scoped_date as span_start, last_day.scoped_date as span_end
    from scoped_holidays first_day
    join scoped_holidays last_day
      on last_day.scope_tenant_id = first_day.scope_tenant_id
      and last_day.scoped_kind = 'tet'
      and last_day.scoped_date between first_day.scoped_date and first_day.scoped_date + 14
    where first_day.scoped_kind = 'tet'
  ),
  date_flags as (
    select
      c.series_start,
      c.series_weekday,
      exists (select 1 from tet_spans w where c.calendar_date between w.span_start and w.span_end) as in_tet,
      (select min(h.scoped_kind) from scoped_holidays h where h.scoped_date = c.calendar_date) as first_kind
    from calendar c
  ),
  bucket_flags as (
    select
      f.series_start,
      f.series_weekday,
      (count(*) filter (where f.in_tet or f.first_kind is not null))::integer as series_excluded_days,
      (count(*) filter (where f.in_tet))::integer as series_tet_days,
      max(case when f.in_tet then 'tet' else f.first_kind::text end) as series_holiday_kind
    from date_flags f
    group by f.series_start, f.series_weekday
  ),
  day_rows as (
    select
      d.store_id as day_store_id,
      c.series_start,
      c.series_weekday,
      d.invoices as day_invoices,
      d.net_amount as day_net_amount,
      d.gross_amount as day_gross_amount,
      d.item_discount_amount as day_item_discount_amount,
      d.bill_discount_amount as day_bill_discount_amount,
      d.voucher_amount as day_voucher_amount,
      d.paid_amount as day_paid_amount,
      d.cash_amount as day_cash_amount,
      d.items_sold as day_items_sold,
      d.voucher_invoices as day_voucher_invoices,
      d.member_invoices as day_member_invoices,
      d.identified_invoices as day_identified_invoices,
      d.voided_invoices as day_voided_invoices,
      d.voided_amount as day_voided_amount,
      d.edited_invoices as day_edited_invoices
    from app.daily_sales(period_series.store_ids, period_series.from_date, period_series.to_date) d
    join calendar c on c.calendar_date = d.business_date
  ),
  bucket_totals as (
    select
      r.day_store_id as total_store_id,
      r.series_start,
      r.series_weekday,
      count(*)::integer as total_days,
      sum(r.day_invoices) as total_invoices,
      sum(r.day_net_amount) as total_net_amount,
      sum(r.day_gross_amount) as total_gross_amount,
      sum(r.day_item_discount_amount) as total_item_discount_amount,
      sum(r.day_bill_discount_amount) as total_bill_discount_amount,
      sum(r.day_voucher_amount) as total_voucher_amount,
      sum(r.day_item_discount_amount + r.day_bill_discount_amount + r.day_voucher_amount) as total_discount_amount,
      sum(r.day_paid_amount) as total_paid_amount,
      sum(r.day_cash_amount) as total_cash_amount,
      sum(r.day_items_sold) as total_items_sold,
      sum(r.day_voucher_invoices) as total_voucher_invoices,
      sum(r.day_member_invoices) as total_member_invoices,
      sum(r.day_identified_invoices) as total_identified_invoices,
      sum(r.day_voided_invoices) as total_voided_invoices,
      sum(r.day_voided_amount) as total_voided_amount,
      sum(r.day_edited_invoices) as total_edited_invoices
    from day_rows r
    group by grouping sets ((r.series_start, r.series_weekday), (r.series_start, r.series_weekday, r.day_store_id))
  ),
  bucket_checks as (
    select
      k.store_id as check_store_id,
      c.series_start,
      c.series_weekday,
      count(*)::integer as series_checked_days,
      (count(*) filter (where k.is_matched))::integer as series_matched_days
    from public.sync_checks k
    join calendar c on c.calendar_date = k.business_date
    where k.store_id = any (period_series.store_ids)
      and k.business_date between period_series.from_date and period_series.to_date
    group by grouping sets ((c.series_start, c.series_weekday), (c.series_start, c.series_weekday, k.store_id))
  )
  select
    k.block_store_id,
    b.series_start,
    b.series_end,
    case when period_series.grain in ('day', 'week') then extract(isoyear from b.series_start)::integer end,
    case when period_series.grain in ('day', 'week') then extract(week from b.series_start)::smallint end,
    nullif(b.series_weekday, 0::smallint),
    b.series_calendar_days,
    coalesce(fl.series_excluded_days, 0),
    coalesce(fl.series_tet_days, 0),
    case when period_series.grain = 'day' then fl.series_holiday_kind end,
    coalesce(ch.series_checked_days, 0),
    coalesce(ch.series_matched_days, 0),
    coalesce(t.total_days, 0),
    t.total_invoices,
    t.total_net_amount,
    t.total_gross_amount,
    t.total_item_discount_amount,
    t.total_bill_discount_amount,
    t.total_voucher_amount,
    t.total_discount_amount,
    t.total_paid_amount,
    t.total_cash_amount,
    t.total_items_sold,
    t.total_voucher_invoices,
    t.total_member_invoices,
    t.total_identified_invoices,
    t.total_voided_invoices,
    t.total_voided_amount,
    t.total_edited_invoices,
    round(t.total_net_amount / nullif(t.total_invoices, 0), 2),
    round(t.total_items_sold / nullif(t.total_invoices, 0), 4),
    round(t.total_net_amount / nullif(t.total_items_sold, 0), 2),
    round(t.total_cash_amount / nullif(t.total_paid_amount, 0), 6),
    round(t.total_voucher_invoices::numeric / nullif(t.total_invoices, 0), 6),
    round(t.total_member_invoices::numeric / nullif(t.total_invoices, 0), 6),
    round(t.total_identified_invoices::numeric / nullif(t.total_invoices, 0), 6),
    round(t.total_discount_amount / nullif(t.total_gross_amount, 0), 6)
  from buckets b
  cross join blocks k
  left join bucket_flags fl
    on fl.series_start = b.series_start
    and fl.series_weekday = b.series_weekday
  left join bucket_totals t
    on t.series_start = b.series_start
    and t.series_weekday = b.series_weekday
    and t.total_store_id is not distinct from k.block_store_id
  left join bucket_checks ch
    on ch.series_start = b.series_start
    and ch.series_weekday = b.series_weekday
    and ch.check_store_id is not distinct from k.block_store_id
  order by b.series_start, b.series_weekday, k.block_position;
end;
$$;

create function public.daily_baselines(store_ids uuid[], from_date date, to_date date, weeks integer default 8)
returns table (
  business_date date,
  weekday smallint,
  sample_days integer,
  baseline_net_amount numeric,
  baseline_invoices numeric,
  baseline_avg_ticket numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  max_dates constant integer := 62;
  max_weeks constant integer := 26;
begin
  perform app.require_store_ids('daily_baselines', daily_baselines.store_ids);
  perform app.require_date_range('daily_baselines', daily_baselines.from_date, daily_baselines.to_date, max_dates);
  if daily_baselines.weeks is null or daily_baselines.weeks < 1 or daily_baselines.weeks > max_weeks then
    raise exception using
      errcode = '22023',
      message = format('daily_baselines needs weeks between 1 and %s', max_weeks);
  end if;
  if cardinality(daily_baselines.store_ids) = 0 then
    return;
  end if;

  return query
  with targets as (
    select daily_baselines.from_date + o.day_offset as target_date
    from generate_series(0, daily_baselines.to_date - daily_baselines.from_date) as o (day_offset)
  ),
  candidates as (
    select t.target_date, t.target_date - 7 * k.week_number as candidate_date
    from targets t
    cross join generate_series(1, daily_baselines.weeks) as k (week_number)
  ),
  candidate_dates as materialized (
    select distinct c.candidate_date
    from candidates c
  ),
  eligible_dates as (
    select cd.candidate_date
    from candidate_dates cd
    where not app.is_excluded_day(daily_baselines.store_ids, cd.candidate_date)
  ),
  daily as (
    select d.business_date as sales_date, sum(d.net_amount) as day_net_amount, sum(d.invoices) as day_invoices
    from app.daily_sales(daily_baselines.store_ids, daily_baselines.from_date - 7 * daily_baselines.weeks, daily_baselines.to_date - 7) d
    group by d.business_date
  ),
  samples as (
    select c.target_date as sample_target, dy.day_net_amount, dy.day_invoices
    from candidates c
    join eligible_dates e on e.candidate_date = c.candidate_date
    join daily dy on dy.sales_date = c.candidate_date
  )
  select
    t.target_date,
    extract(isodow from t.target_date)::smallint,
    count(s.sample_target)::integer,
    round((percentile_cont(0.5) within group (order by s.day_net_amount))::numeric, 2),
    round((percentile_cont(0.5) within group (order by s.day_invoices::numeric))::numeric, 2),
    round((percentile_cont(0.5) within group (order by s.day_net_amount / nullif(s.day_invoices, 0)))::numeric, 2)
  from targets t
  left join samples s on s.sample_target = t.target_date
  group by t.target_date
  order by t.target_date;
end;
$$;

create function public.hourly_profile(store_ids uuid[], target_date date, weeks integer default 8)
returns table (
  hour_local smallint,
  current_invoices integer,
  current_net_amount numeric,
  current_items_sold numeric,
  sample_days integer,
  baseline_invoices numeric,
  baseline_net_amount numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  max_weeks constant integer := 26;
begin
  perform app.require_store_ids('hourly_profile', hourly_profile.store_ids);
  if hourly_profile.target_date is null then
    raise exception using
      errcode = '22023',
      message = 'hourly_profile needs a target date';
  end if;
  if hourly_profile.weeks is null or hourly_profile.weeks < 1 or hourly_profile.weeks > max_weeks then
    raise exception using
      errcode = '22023',
      message = format('hourly_profile needs weeks between 1 and %s', max_weeks);
  end if;
  if cardinality(hourly_profile.store_ids) = 0 then
    return;
  end if;

  return query
  with hours as (
    select h::smallint as profile_hour
    from generate_series(0, 23) as h
  ),
  target_day as (
    select exists (
      select 1
      from app.daily_sales(hourly_profile.store_ids, hourly_profile.target_date, hourly_profile.target_date) d
    ) as has_rows
  ),
  current_hours as (
    select h.hour_local as profile_hour, sum(h.invoices) as hour_invoices, sum(h.net_amount) as hour_net_amount, sum(h.items_sold) as hour_items_sold
    from app.hourly_sales(hourly_profile.store_ids, hourly_profile.target_date, hourly_profile.target_date) h
    group by h.hour_local
  ),
  candidate_days as (
    select hourly_profile.target_date - 7 * k.week_number as candidate_date
    from generate_series(1, hourly_profile.weeks) as k (week_number)
  ),
  days_with_rows as (
    select distinct d.business_date as sales_date
    from app.daily_sales(hourly_profile.store_ids, hourly_profile.target_date - 7 * hourly_profile.weeks, hourly_profile.target_date - 7) d
  ),
  eligible_days as materialized (
    select c.candidate_date
    from candidate_days c
    join days_with_rows r on r.sales_date = c.candidate_date
    where not app.is_excluded_day(hourly_profile.store_ids, c.candidate_date)
  ),
  past_hours as (
    select h.business_date as sales_date, h.hour_local as profile_hour, sum(h.invoices) as hour_invoices, sum(h.net_amount) as hour_net_amount
    from app.hourly_sales(hourly_profile.store_ids, hourly_profile.target_date - 7 * hourly_profile.weeks, hourly_profile.target_date - 7) h
    group by h.business_date, h.hour_local
  ),
  samples as (
    select hr.profile_hour, coalesce(p.hour_invoices, 0) as sample_invoices, coalesce(p.hour_net_amount, 0) as sample_net_amount
    from eligible_days e
    cross join hours hr
    left join past_hours p on p.sales_date = e.candidate_date and p.profile_hour = hr.profile_hour
  ),
  baselines as (
    select
      s.profile_hour,
      round((percentile_cont(0.5) within group (order by s.sample_invoices))::numeric, 2) as baseline_hour_invoices,
      round((percentile_cont(0.5) within group (order by s.sample_net_amount))::numeric, 2) as baseline_hour_net_amount
    from samples s
    group by s.profile_hour
  )
  select
    hr.profile_hour,
    case when td.has_rows then coalesce(c.hour_invoices, 0)::integer end,
    case when td.has_rows then coalesce(c.hour_net_amount, 0) end,
    case when td.has_rows then coalesce(c.hour_items_sold, 0) end,
    (select count(*) from eligible_days)::integer,
    b.baseline_hour_invoices,
    b.baseline_hour_net_amount
  from hours hr
  cross join target_day td
  left join current_hours c on c.profile_hour = hr.profile_hour
  left join baselines b on b.profile_hour = hr.profile_hour
  order by hr.profile_hour;
end;
$$;

create function public.metric_compare(store_ids uuid[], metric_ids text[], grain text, anchor date)
returns table (metric_id text, period text, from_date date, to_date date, value numeric)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  max_metric_ids constant integer := 25;
begin
  perform app.require_store_ids('metric_compare', metric_compare.store_ids);
  if metric_compare.metric_ids is null or cardinality(metric_compare.metric_ids) not between 1 and max_metric_ids then
    raise exception using
      errcode = '22023',
      message = format('metric_compare needs 1 to %s metric ids', max_metric_ids);
  end if;
  perform app.period_bounds(metric_compare.grain, metric_compare.anchor);
  if cardinality(metric_compare.store_ids) = 0 then
    return;
  end if;

  return query
  select
    m.requested_id,
    b.bound_period,
    b.bound_from,
    b.bound_to,
    public.metric_value(metric_compare.store_ids, m.requested_id, b.bound_from, b.bound_to)
  from unnest(metric_compare.metric_ids) with ordinality as m (requested_id, id_position)
  cross join app.period_bounds(metric_compare.grain, metric_compare.anchor)
    with ordinality as b (bound_period, bound_from, bound_to, bound_position)
  where b.bound_period <> 'baseline'
  order by m.id_position, b.bound_position;
end;
$$;

create function public.item_summary(
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
    select v.store_position, s.pos_account_id
    from app.visible_stores(item_summary.store_ids) v
    join public.stores s on s.id = v.store_id
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
    l.chosen_type_id,
    case when l.sold_in_current then l.current_type_name else l.compare_type_name end,
    (
      select r.role
      from accounts ac
      join public.item_type_roles r
        on r.pos_account_id = ac.pos_account_id
        and r.item_type_external_id = l.chosen_type_id
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
  from labelled l
  cross join range_totals t
  left join sold_dates sd on sd.item_key = l.item_key
  order by l.item_net_amount desc, l.item_quantity desc, l.item_key collate "C";

  get diagnostics returned_rows = row_count;
  perform app.require_report_rows('item_summary', returned_rows);
end;
$$;

create function public.payment_summary(
  store_ids uuid[],
  from_date date,
  to_date date,
  compare_from date default null,
  compare_to date default null
)
returns table (
  method_key text,
  kind public.payment_kind,
  payment_method_name text,
  invoices bigint,
  amount numeric,
  share numeric,
  fee_amount numeric,
  fee_estimate_amount numeric,
  compare_amount numeric,
  compare_share numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  max_range_days constant integer := 400;
  has_compare boolean := payment_summary.compare_from is not null;
  returned_rows bigint;
begin
  perform app.require_store_ids('payment_summary', payment_summary.store_ids);
  perform app.require_date_range('payment_summary', payment_summary.from_date, payment_summary.to_date, max_range_days);
  perform app.require_compare_range('payment_summary', payment_summary.compare_from, payment_summary.compare_to, max_range_days);

  return query
  with store_rows as (
    select
      a.kind as row_kind,
      coalesce(a.payment_method_name, a.payment_method_external_id) as row_method_name,
      a.invoices as row_invoices,
      a.amount as row_amount,
      a.fee_amount as row_fee_amount,
      a.fee_estimate_amount as row_fee_estimate_amount,
      a.business_date between payment_summary.from_date and payment_summary.to_date as in_current,
      coalesce(a.business_date between payment_summary.compare_from and payment_summary.compare_to, false) as in_compare
    from public.agg_payment_daily a
    where a.store_id = any (payment_summary.store_ids)
      and (
        a.business_date between payment_summary.from_date and payment_summary.to_date
        or a.business_date between payment_summary.compare_from and payment_summary.compare_to
      )
  ),
  per_method as (
    select
      r.row_kind as method_kind,
      r.row_method_name as method_name,
      coalesce(sum(r.row_invoices) filter (where r.in_current), 0) as method_invoices,
      coalesce(sum(r.row_amount) filter (where r.in_current), 0) as method_amount,
      coalesce(sum(r.row_fee_amount) filter (where r.in_current), 0) as method_fee_amount,
      coalesce(sum(r.row_fee_estimate_amount) filter (where r.in_current), 0) as method_fee_estimate_amount,
      coalesce(sum(r.row_amount) filter (where r.in_compare), 0) as method_compare_amount
    from store_rows r
    group by r.row_kind, r.row_method_name
  ),
  range_totals as (
    select sum(p.method_amount) as current_amount_total, sum(p.method_compare_amount) as compare_amount_total
    from per_method p
  )
  select
    p.method_kind::text || '|' || p.method_name,
    p.method_kind,
    p.method_name,
    p.method_invoices,
    p.method_amount,
    round(p.method_amount / nullif(t.current_amount_total, 0), 6),
    p.method_fee_amount,
    p.method_fee_estimate_amount,
    case when has_compare then p.method_compare_amount end,
    case when has_compare then round(p.method_compare_amount / nullif(t.compare_amount_total, 0), 6) end
  from per_method p
  cross join range_totals t
  order by p.method_amount desc, (p.method_kind::text || '|' || p.method_name) collate "C";

  get diagnostics returned_rows = row_count;
  perform app.require_report_rows('payment_summary', returned_rows);
end;
$$;

create function public.promotion_summary(store_ids uuid[], from_date date, to_date date)
returns table (
  promotion_kind text,
  promotion_key text,
  promotion_name text,
  invoices bigint,
  lines bigint,
  discount_amount numeric,
  first_used_on date,
  last_used_on date,
  days_used integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  max_range_days constant integer := 92;
  returned_rows bigint;
begin
  perform app.require_store_ids('promotion_summary', promotion_summary.store_ids);
  perform app.require_date_range('promotion_summary', promotion_summary.from_date, promotion_summary.to_date, max_range_days);

  return query
  with sales as (
    select
      i.id as sale_id,
      i.business_date as sold_on,
      i.bill_discount_amount + i.extra_discount_amount as bill_amount,
      i.bill_discount_name as bill_name,
      i.voucher_amount as voucher_value,
      i.voucher_amount > 0 or i.voucher_code is not null as with_voucher,
      i.voucher_name as voucher_label,
      i.voucher_code as voucher_reference
    from public.invoices i
    where i.store_id = any (promotion_summary.store_ids)
      and i.business_date between promotion_summary.from_date and promotion_summary.to_date
      and i.status <> 'voided'
  ),
  uses as (
    select
      'item'::text as use_kind,
      l.line_key as use_key,
      l.line_name as use_name,
      s.sale_id,
      s.sold_on,
      l.line_count as use_lines,
      l.line_discount as use_discount
    from sales s
    cross join lateral (
      select
        coalesce(il.promotion_external_id, il.promotion_name, 'unnamed') as line_key,
        max(il.promotion_name) as line_name,
        count(*) as line_count,
        sum(il.discount_amount) as line_discount
      from public.invoice_lines il
      where il.invoice_id = s.sale_id
        and il.line_kind = 'item'
        and il.discount_amount > 0
      group by coalesce(il.promotion_external_id, il.promotion_name, 'unnamed')
    ) l
    union all
    select 'bill'::text, coalesce(s.bill_name, 'unnamed'), s.bill_name, s.sale_id, s.sold_on, null::bigint, s.bill_amount
    from sales s
    where s.bill_amount > 0
    union all
    select 'voucher'::text, coalesce(s.voucher_label, s.voucher_reference, 'unnamed'), s.voucher_label, s.sale_id, s.sold_on, null::bigint, s.voucher_value
    from sales s
    where s.with_voucher
  )
  select
    u.use_kind,
    u.use_key,
    max(u.use_name),
    count(distinct u.sale_id),
    sum(u.use_lines)::bigint,
    sum(u.use_discount),
    min(u.sold_on),
    max(u.sold_on),
    (count(distinct u.sold_on))::integer
  from uses u
  group by u.use_kind, u.use_key
  order by sum(u.use_discount) desc, u.use_kind collate "C", u.use_key collate "C";

  get diagnostics returned_rows = row_count;
  perform app.require_report_rows('promotion_summary', returned_rows);
end;
$$;

create function public.shift_review(
  store_ids uuid[],
  from_date date,
  to_date date,
  abs_threshold numeric default 50000,
  rel_threshold numeric default 0.005
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
  returned_rows bigint;
begin
  perform app.require_store_ids('shift_review', shift_review.store_ids);
  perform app.require_date_range('shift_review', shift_review.from_date, shift_review.to_date, max_range_days);

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
    shift_review.abs_threshold,
    shift_review.rel_threshold
  ) v on v.shift_id = s.shift_id
  where s.store_id = any (shift_review.store_ids)
    and s.business_date between shift_review.from_date and shift_review.to_date
  order by s.business_date, s.store_id, s.opened_at, s.shift_external_id collate "C";

  get diagnostics returned_rows = row_count;
  perform app.require_report_rows('shift_review', returned_rows);
end;
$$;

create function public.item_lifecycle(store_ids uuid[], as_of_date date)
returns table (
  item_external_id text,
  item_name text,
  item_type_external_id text,
  item_type_name text,
  role public.item_type_role,
  first_sold_on date,
  last_sold_on date,
  months_sold integer,
  quantity_28d numeric,
  quantity_prior_28d numeric,
  quantity_ytd numeric,
  quantity_last_ytd numeric,
  net_ytd numeric,
  net_last_ytd numeric,
  quantity_lifetime numeric,
  net_lifetime numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  year_start date;
  last_year_start date;
  last_year_end date;
  returned_rows bigint;
begin
  perform app.require_store_ids('item_lifecycle', item_lifecycle.store_ids);
  if item_lifecycle.as_of_date is null then
    raise exception using
      errcode = '22023',
      message = 'item_lifecycle needs an as-of date';
  end if;
  select b.from_date, b.to_date
  into last_year_start, last_year_end
  from app.period_bounds('year', item_lifecycle.as_of_date) b
  where b.period = 'last_year';
  year_start := make_date(extract(year from item_lifecycle.as_of_date)::integer, 1, 1);

  return query
  with item_rows as (
    select
      a.item_external_id as item_key,
      a.business_date as sold_on,
      a.item_name as row_item_name,
      a.item_type_external_id as row_type_id,
      a.item_type_name as row_type_name,
      a.quantity as row_quantity,
      a.net_amount as row_net_amount
    from public.agg_item_daily a
    where a.store_id = any (item_lifecycle.store_ids)
      and a.business_date <= item_lifecycle.as_of_date
  ),
  per_item as (
    select
      r.item_key,
      max(r.row_item_name) as item_label,
      max(r.row_type_id) as type_id,
      max(r.row_type_name) as type_name,
      min(r.sold_on) as first_on,
      max(r.sold_on) as last_on,
      (count(distinct extract(year from r.sold_on) * 12 + extract(month from r.sold_on)))::integer as months_with_sales,
      sum(r.row_quantity) filter (where r.sold_on between item_lifecycle.as_of_date - 27 and item_lifecycle.as_of_date) as recent_quantity,
      sum(r.row_quantity) filter (where r.sold_on between item_lifecycle.as_of_date - 55 and item_lifecycle.as_of_date - 28) as prior_quantity,
      sum(r.row_quantity) filter (where r.sold_on between year_start and item_lifecycle.as_of_date) as year_quantity,
      sum(r.row_quantity) filter (where r.sold_on between last_year_start and last_year_end) as last_year_quantity,
      sum(r.row_net_amount) filter (where r.sold_on between year_start and item_lifecycle.as_of_date) as year_net,
      sum(r.row_net_amount) filter (where r.sold_on between last_year_start and last_year_end) as last_year_net,
      sum(r.row_quantity) as lifetime_quantity,
      sum(r.row_net_amount) as lifetime_net
    from item_rows r
    group by r.item_key
  ),
  accounts as (
    select v.store_position, s.pos_account_id
    from app.visible_stores(item_lifecycle.store_ids) v
    join public.stores s on s.id = v.store_id
  )
  select
    p.item_key,
    p.item_label,
    p.type_id,
    p.type_name,
    (
      select r.role
      from accounts ac
      join public.item_type_roles r
        on r.pos_account_id = ac.pos_account_id
        and r.item_type_external_id = p.type_id
      order by ac.store_position
      limit 1
    ),
    p.first_on,
    p.last_on,
    p.months_with_sales,
    p.recent_quantity,
    p.prior_quantity,
    p.year_quantity,
    p.last_year_quantity,
    p.year_net,
    p.last_year_net,
    p.lifetime_quantity,
    p.lifetime_net
  from per_item p
  order by p.year_net desc nulls last, p.item_key collate "C";

  get diagnostics returned_rows = row_count;
  perform app.require_report_rows('item_lifecycle', returned_rows);
end;
$$;

create function public.store_coverage(store_ids uuid[], from_date date, to_date date)
returns table (
  store_id uuid,
  opened_on date,
  first_sales_on date,
  last_sales_on date,
  history_start date,
  store_as_of_date date,
  sales_days integer,
  checked_days integer,
  matched_days integer,
  unmatched_days integer,
  unchecked_sales_days integer,
  stale_days integer,
  last_refreshed_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  max_range_days constant integer := 400;
  live_from date := app.analytics_live_from();
begin
  perform app.require_store_ids('store_coverage', store_coverage.store_ids);
  perform app.require_date_range('store_coverage', store_coverage.from_date, store_coverage.to_date, max_range_days);

  return query
  with requested as (
    select
      v.store_id as coverage_store_id,
      v.store_position,
      s.tenant_id as store_tenant_id,
      s.opened_on as store_opened_on,
      ((now() at time zone s.timezone) - make_interval(mins => s.business_day_start_minutes))::date - 1 as store_as_of
    from app.visible_stores(store_coverage.store_ids) v
    join public.stores s on s.id = v.store_id
  ),
  aggregate_sales as (
    select
      q.coverage_store_id as sales_store_id,
      (select min(a.business_date) from public.agg_daily_sales a where a.store_id = q.coverage_store_id and a.invoices > 0) as aggregate_first,
      (select max(a.business_date) from public.agg_daily_sales a where a.store_id = q.coverage_store_id and a.invoices > 0) as aggregate_last
    from requested q
  ),
  live_sales as (
    select
      d.store_id as sales_store_id,
      min(d.business_date) filter (where d.invoices > 0) as live_first,
      max(d.business_date) filter (where d.invoices > 0) as live_last
    from app.daily_sales(store_coverage.store_ids, live_from, current_date + 1) d
    group by d.store_id
  ),
  range_days as (
    select
      d.store_id as day_store_id,
      d.business_date as day_date,
      d.invoices as day_invoices,
      d.items_sold as day_items_sold,
      d.paid_amount as day_paid_amount
    from app.daily_sales(store_coverage.store_ids, store_coverage.from_date, store_coverage.to_date) d
  ),
  range_checks as (
    select c.store_id as check_store_id, c.business_date as check_date, c.is_matched
    from public.sync_checks c
    where c.store_id = any (store_coverage.store_ids)
      and c.business_date between store_coverage.from_date and store_coverage.to_date
  ),
  hot_items as (
    select a.store_id as item_store_id, a.business_date as item_date, sum(a.quantity) as item_quantity
    from public.agg_item_daily a
    where a.store_id = any (store_coverage.store_ids)
      and a.business_date between greatest(store_coverage.from_date, live_from) and store_coverage.to_date
    group by a.store_id, a.business_date
  ),
  hot_payments as (
    select a.store_id as payment_store_id, a.business_date as payment_date, sum(a.amount) as payment_amount
    from public.agg_payment_daily a
    where a.store_id = any (store_coverage.store_ids)
      and a.business_date between greatest(store_coverage.from_date, live_from) and store_coverage.to_date
    group by a.store_id, a.business_date
  ),
  hot_days as (
    select rd.day_store_id as hot_store_id, rd.day_date as hot_date
    from range_days rd
    where rd.day_date >= live_from
    union
    select hi.item_store_id, hi.item_date from hot_items hi
    union
    select hp.payment_store_id, hp.payment_date from hot_payments hp
  ),
  stale as (
    select h.hot_store_id as stale_store_id, count(*)::integer as stale_count
    from hot_days h
    left join range_days rd on rd.day_store_id = h.hot_store_id and rd.day_date = h.hot_date
    left join hot_items hi on hi.item_store_id = h.hot_store_id and hi.item_date = h.hot_date
    left join hot_payments hp on hp.payment_store_id = h.hot_store_id and hp.payment_date = h.hot_date
    where coalesce(hi.item_quantity, 0) <> coalesce(rd.day_items_sold, 0)
      or coalesce(hp.payment_amount, 0) <> coalesce(rd.day_paid_amount, 0)
      or (coalesce(rd.day_invoices, 0) > 0 and hi.item_store_id is null and hp.payment_store_id is null)
    group by h.hot_store_id
  ),
  sales_counts as (
    select
      rd.day_store_id as counted_store_id,
      (count(*) filter (where rd.day_invoices > 0))::integer as counted_sales_days,
      (count(*) filter (
        where rd.day_invoices > 0
          and not exists (select 1 from range_checks rc where rc.check_store_id = rd.day_store_id and rc.check_date = rd.day_date)
      ))::integer as counted_unchecked_days
    from range_days rd
    group by rd.day_store_id
  ),
  check_counts as (
    select
      rc.check_store_id as counted_store_id,
      count(*)::integer as counted_checked_days,
      (count(*) filter (where rc.is_matched))::integer as counted_matched_days
    from range_checks rc
    group by rc.check_store_id
  )
  select
    q.coverage_store_id,
    q.store_opened_on,
    coalesce(ag.aggregate_first, ls.live_first),
    coalesce(ag.aggregate_last, ls.live_last),
    greatest(q.store_opened_on, coalesce(ag.aggregate_first, ls.live_first)),
    q.store_as_of,
    coalesce(sc.counted_sales_days, 0),
    coalesce(cc.counted_checked_days, 0),
    coalesce(cc.counted_matched_days, 0),
    coalesce(cc.counted_checked_days, 0) - coalesce(cc.counted_matched_days, 0),
    coalesce(sc.counted_unchecked_days, 0),
    coalesce(st.stale_count, 0),
    (select max(r.finished_at) from public.analytics_refreshes r where r.tenant_id = q.store_tenant_id)
  from requested q
  left join aggregate_sales ag on ag.sales_store_id = q.coverage_store_id
  left join live_sales ls on ls.sales_store_id = q.coverage_store_id
  left join sales_counts sc on sc.counted_store_id = q.coverage_store_id
  left join check_counts cc on cc.counted_store_id = q.coverage_store_id
  left join stale st on st.stale_store_id = q.coverage_store_id
  order by q.store_position;
end;
$$;

create function public.store_targets(store_ids uuid[], period_kind public.period_kind, period_start date)
returns table (store_id uuid, net_target_amount numeric)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  perform app.require_store_ids('store_targets', store_targets.store_ids);
  if store_targets.period_kind is null or store_targets.period_start is null then
    raise exception using
      errcode = '22023',
      message = 'store_targets needs a period kind and a period start';
  end if;

  return query
  select t.store_id, t.net_target_amount
  from app.visible_stores(store_targets.store_ids) v
  join public.targets t
    on t.store_id = v.store_id
    and t.period_kind = store_targets.period_kind
    and t.period_start = store_targets.period_start
  order by v.store_position;
end;
$$;

revoke all on function app.visible_stores(uuid[]) from public;
revoke all on function app.require_store_ids(text, uuid[]) from public;
revoke all on function app.require_date_range(text, date, date, integer) from public;
revoke all on function app.require_compare_range(text, date, date, integer) from public;
revoke all on function app.require_report_rows(text, bigint) from public;
revoke all on function app.period_bounds(text, date) from public;
revoke all on function app.period_totals(uuid[], date, date) from public;
revoke all on function app.shift_variance_scores(uuid[], date, date, numeric, numeric) from public;
grant execute on function app.visible_stores(uuid[]) to authenticated, service_role;
grant execute on function app.require_store_ids(text, uuid[]) to authenticated, service_role;
grant execute on function app.require_date_range(text, date, date, integer) to authenticated, service_role;
grant execute on function app.require_compare_range(text, date, date, integer) to authenticated, service_role;
grant execute on function app.require_report_rows(text, bigint) to authenticated, service_role;
grant execute on function app.period_bounds(text, date) to authenticated, service_role;
grant execute on function app.period_totals(uuid[], date, date) to authenticated, service_role;
grant execute on function app.shift_variance_scores(uuid[], date, date, numeric, numeric) to authenticated, service_role;

revoke all on function public.cash_variance_flags(uuid[], date, date, numeric, numeric) from public, anon;
revoke all on function public.period_compare_by_store(uuid[], text, date) from public, anon;
revoke all on function public.period_series(uuid[], text, date, date) from public, anon;
revoke all on function public.daily_baselines(uuid[], date, date, integer) from public, anon;
revoke all on function public.hourly_profile(uuid[], date, integer) from public, anon;
revoke all on function public.metric_compare(uuid[], text[], text, date) from public, anon;
revoke all on function public.item_summary(uuid[], date, date, date, date) from public, anon;
revoke all on function public.payment_summary(uuid[], date, date, date, date) from public, anon;
revoke all on function public.promotion_summary(uuid[], date, date) from public, anon;
revoke all on function public.shift_review(uuid[], date, date, numeric, numeric) from public, anon;
revoke all on function public.item_lifecycle(uuid[], date) from public, anon;
revoke all on function public.store_coverage(uuid[], date, date) from public, anon;
revoke all on function public.store_targets(uuid[], public.period_kind, date) from public, anon;
grant execute on function public.cash_variance_flags(uuid[], date, date, numeric, numeric) to authenticated, service_role;
grant execute on function public.period_compare_by_store(uuid[], text, date) to authenticated, service_role;
grant execute on function public.period_series(uuid[], text, date, date) to authenticated, service_role;
grant execute on function public.daily_baselines(uuid[], date, date, integer) to authenticated, service_role;
grant execute on function public.hourly_profile(uuid[], date, integer) to authenticated, service_role;
grant execute on function public.metric_compare(uuid[], text[], text, date) to authenticated, service_role;
grant execute on function public.item_summary(uuid[], date, date, date, date) to authenticated, service_role;
grant execute on function public.payment_summary(uuid[], date, date, date, date) to authenticated, service_role;
grant execute on function public.promotion_summary(uuid[], date, date) to authenticated, service_role;
grant execute on function public.shift_review(uuid[], date, date, numeric, numeric) to authenticated, service_role;
grant execute on function public.item_lifecycle(uuid[], date) to authenticated, service_role;
grant execute on function public.store_coverage(uuid[], date, date) to authenticated, service_role;
grant execute on function public.store_targets(uuid[], public.period_kind, date) to authenticated, service_role;
