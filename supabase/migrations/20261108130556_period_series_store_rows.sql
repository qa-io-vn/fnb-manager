drop function public.period_series(uuid[], text, date, date);

create function public.period_series(
  store_ids uuid[],
  grain text,
  from_date date,
  to_date date,
  include_stores boolean default true
)
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
  if period_series.include_stores is null then
    raise exception using
      errcode = '22023',
      message = 'period_series needs include_stores to be true or false';
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
  perform app.require_report_rows(
    'period_series',
    bucket_count::bigint * (case when period_series.include_stores then visible_store_count + 1 else 1 end)
  );

  return query
  with blocks as (
    select null::uuid as block_store_id, 0::bigint as block_position
    union all
    select v.store_id, v.store_position
    from app.visible_stores(period_series.store_ids) v
    where period_series.include_stores
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

revoke all on function public.period_series(uuid[], text, date, date, boolean) from public, anon;
grant execute on function public.period_series(uuid[], text, date, date, boolean) to authenticated, service_role;
