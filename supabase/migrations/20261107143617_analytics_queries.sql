create view public.v_recent_daily_sales
with (security_invoker = true)
as
select
  tenant_id, store_id, business_date, invoices, gross_amount, item_discount_amount, bill_discount_amount, voucher_amount,
  net_amount, paid_amount, cash_amount, items_sold, modifier_lines, voucher_invoices, member_invoices, identified_invoices,
  voided_invoices, voided_amount, edited_invoices
from app.daily_sales_facts(null, current_date - 45, current_date + 1);

create view public.v_recent_hourly_sales
with (security_invoker = true)
as
select tenant_id, store_id, business_date, hour_local, invoices, net_amount, items_sold
from app.hourly_sales_facts(null, current_date - 45, current_date + 1);

revoke all on public.v_recent_daily_sales, public.v_recent_hourly_sales from anon;
grant select on public.v_recent_daily_sales, public.v_recent_hourly_sales to authenticated, service_role;

create or replace function app.analytics_live_from()
returns date
language sql
stable
set search_path = ''
as $$
  select current_date - 1;
$$;

create or replace function app.analytics_as_of(p_store_ids uuid[], p_at timestamptz default now())
returns date
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (
      select min(((p_at at time zone s.timezone) - make_interval(mins => s.business_day_start_minutes))::date) - 1
      from public.stores s
      where s.id = any (p_store_ids)
    ),
    (p_at at time zone 'UTC')::date - 1
  );
$$;

create or replace function app.daily_sales(p_store_ids uuid[], p_from date, p_to date)
returns table (
  store_id uuid,
  business_date date,
  invoices integer,
  gross_amount numeric,
  item_discount_amount numeric,
  bill_discount_amount numeric,
  voucher_amount numeric,
  net_amount numeric,
  paid_amount numeric,
  cash_amount numeric,
  items_sold numeric,
  modifier_lines integer,
  voucher_invoices integer,
  member_invoices integer,
  identified_invoices integer,
  voided_invoices integer,
  voided_amount numeric,
  edited_invoices integer
)
language sql
stable
security invoker
rows 10000
set search_path = ''
as $$
  select
    a.store_id, a.business_date, a.invoices, a.gross_amount, a.item_discount_amount, a.bill_discount_amount, a.voucher_amount,
    a.net_amount, a.paid_amount, a.cash_amount, a.items_sold, a.modifier_lines, a.voucher_invoices, a.member_invoices, a.identified_invoices,
    a.voided_invoices, a.voided_amount, a.edited_invoices
  from public.agg_daily_sales a
  where a.store_id = any (p_store_ids)
    and a.business_date between p_from and least(p_to, app.analytics_live_from() - 1)
  union all
  select
    f.store_id, f.business_date, f.invoices, f.gross_amount, f.item_discount_amount, f.bill_discount_amount, f.voucher_amount,
    f.net_amount, f.paid_amount, f.cash_amount, f.items_sold, f.modifier_lines, f.voucher_invoices, f.member_invoices, f.identified_invoices,
    f.voided_invoices, f.voided_amount, f.edited_invoices
  from app.daily_sales_facts(null, greatest(p_from, app.analytics_live_from()), p_to, p_store_ids) f;
$$;

create or replace function app.hourly_sales(p_store_ids uuid[], p_from date, p_to date)
returns table (
  store_id uuid,
  business_date date,
  hour_local smallint,
  invoices integer,
  net_amount numeric,
  items_sold numeric
)
language sql
stable
security invoker
rows 10000
set search_path = ''
as $$
  select a.store_id, a.business_date, a.hour_local, a.invoices, a.net_amount, a.items_sold
  from public.agg_hourly_sales a
  where a.store_id = any (p_store_ids)
    and a.business_date between p_from and least(p_to, app.analytics_live_from() - 1)
  union all
  select f.store_id, f.business_date, f.hour_local, f.invoices, f.net_amount, f.items_sold
  from app.hourly_sales_facts(null, greatest(p_from, app.analytics_live_from()), p_to, p_store_ids) f;
$$;

create or replace function app.summarize_daily(p_store_ids uuid[], p_from date, p_to date)
returns table (
  days_with_data integer,
  invoices bigint,
  net_amount numeric,
  gross_amount numeric,
  discount_amount numeric,
  paid_amount numeric,
  cash_amount numeric,
  items_sold numeric,
  voucher_invoices bigint,
  member_invoices bigint,
  identified_invoices bigint,
  avg_ticket numeric,
  items_per_ticket numeric,
  avg_item_price numeric,
  cash_share numeric,
  voucher_share numeric,
  member_share numeric,
  identified_share numeric
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
      sum(d.item_discount_amount + d.bill_discount_amount + d.voucher_amount) as discount_amount,
      sum(d.paid_amount) as paid_amount,
      sum(d.cash_amount) as cash_amount,
      sum(d.items_sold) as items_sold,
      sum(d.voucher_invoices) as voucher_invoices,
      sum(d.member_invoices) as member_invoices,
      sum(d.identified_invoices) as identified_invoices
    from app.daily_sales(p_store_ids, p_from, p_to) d
  )
  select
    t.days_with_data::integer,
    t.invoices,
    t.net_amount,
    t.gross_amount,
    t.discount_amount,
    t.paid_amount,
    t.cash_amount,
    t.items_sold,
    t.voucher_invoices,
    t.member_invoices,
    t.identified_invoices,
    round(t.net_amount / nullif(t.invoices, 0), 2),
    round(t.items_sold / nullif(t.invoices, 0), 4),
    round(t.net_amount / nullif(t.items_sold, 0), 2),
    round(t.cash_amount / nullif(t.paid_amount, 0), 6),
    round(t.voucher_invoices::numeric / nullif(t.invoices, 0), 6),
    round(t.member_invoices::numeric / nullif(t.invoices, 0), 6),
    round(t.identified_invoices::numeric / nullif(t.invoices, 0), 6)
  from totals t;
$$;

create or replace function app.daily_net_series(p_store_ids uuid[], p_from date, p_to date)
returns table (
  business_date date,
  net_amount numeric,
  excluded boolean
)
language sql
stable
security invoker
rows 100
set search_path = ''
as $$
  select d.business_date, sum(d.net_amount), app.is_excluded_day(p_store_ids, d.business_date)
  from app.daily_sales(p_store_ids, p_from, p_to) d
  group by d.business_date;
$$;

create or replace function app.weekday_profile(p_store_ids uuid[], p_origin date)
returns table (
  weekday smallint,
  level_net_amount numeric,
  weekday_index numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with clean_days as (
    select s.business_date, s.net_amount
    from app.daily_net_series(p_store_ids, p_origin - 83, p_origin) s
    where not s.excluded
  ),
  level as (
    select avg(c.net_amount) as level_net_amount
    from clean_days c
    where c.business_date >= p_origin - 27
  ),
  overall as (
    select avg(c.net_amount) as mean_net_amount
    from clean_days c
  ),
  by_weekday as (
    select extract(isodow from c.business_date)::smallint as weekday, avg(c.net_amount) as mean_net_amount
    from clean_days c
    group by extract(isodow from c.business_date)
  )
  select
    w.weekday::smallint,
    level.level_net_amount,
    bw.mean_net_amount / nullif(overall.mean_net_amount, 0)
  from generate_series(1, 7) as w (weekday)
  cross join level
  cross join overall
  left join by_weekday bw on bw.weekday = w.weekday;
$$;

create or replace function app.seasonal_naive_series(p_store_ids uuid[], p_origin date, p_from date, p_to date)
returns table (
  target_date date,
  forecast_net_amount numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with series as (
    select s.business_date, s.net_amount
    from app.daily_net_series(p_store_ids, least(p_origin, p_from - 1) - 55, least(p_origin, p_to - 1)) s
  ),
  targets as (
    select g::date as target_date, least(p_origin, g::date - 1) as target_origin
    from generate_series(p_from, p_to, interval '1 day') as g
  )
  select
    t.target_date,
    (
      select round(s.net_amount, 2)
      from series s
      where s.business_date between t.target_origin - 55 and t.target_origin
        and (t.target_date - s.business_date) % 7 = 0
      order by s.business_date desc
      limit 1
    )
  from targets t;
$$;

revoke all on function app.analytics_live_from() from public;
revoke all on function app.analytics_as_of(uuid[], timestamptz) from public;
revoke all on function app.daily_sales(uuid[], date, date) from public;
revoke all on function app.hourly_sales(uuid[], date, date) from public;
revoke all on function app.summarize_daily(uuid[], date, date) from public;
revoke all on function app.daily_net_series(uuid[], date, date) from public;
revoke all on function app.weekday_profile(uuid[], date) from public;
revoke all on function app.seasonal_naive_series(uuid[], date, date, date) from public;
grant execute on function app.analytics_live_from() to authenticated, service_role;
grant execute on function app.analytics_as_of(uuid[], timestamptz) to authenticated, service_role;
grant execute on function app.daily_sales(uuid[], date, date) to authenticated, service_role;
grant execute on function app.hourly_sales(uuid[], date, date) to authenticated, service_role;
grant execute on function app.summarize_daily(uuid[], date, date) to authenticated, service_role;
grant execute on function app.daily_net_series(uuid[], date, date) to authenticated, service_role;
grant execute on function app.weekday_profile(uuid[], date) to authenticated, service_role;
grant execute on function app.seasonal_naive_series(uuid[], date, date, date) to authenticated, service_role;

create or replace function public.same_weekday_baseline(store_ids uuid[], target_date date, weeks integer default 8)
returns table (
  weekday smallint,
  sample_days integer,
  baseline_net_amount numeric,
  baseline_invoices numeric,
  baseline_avg_ticket numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with candidate_days as (
    select (target_date - 7 * k)::date as candidate_date
    from generate_series(1, greatest(weeks, 1)) as k
  ),
  eligible_days as (
    select c.candidate_date
    from candidate_days c
    where not app.is_excluded_day(store_ids, c.candidate_date)
  ),
  daily as (
    select d.business_date, sum(d.net_amount) as day_net_amount, sum(d.invoices) as day_invoices
    from app.daily_sales(store_ids, target_date - 7 * greatest(weeks, 1), target_date - 7) d
    join eligible_days e on e.candidate_date = d.business_date
    group by d.business_date
  )
  select
    extract(isodow from target_date)::smallint,
    count(*)::integer,
    round((percentile_cont(0.5) within group (order by daily.day_net_amount))::numeric, 2),
    round((percentile_cont(0.5) within group (order by daily.day_invoices::numeric))::numeric, 2),
    round((percentile_cont(0.5) within group (order by daily.day_net_amount / nullif(daily.day_invoices, 0)))::numeric, 2)
  from daily;
$$;

create or replace function public.period_summary(store_ids uuid[], from_date date, to_date date)
returns table (
  days_with_data integer,
  invoices bigint,
  net_amount numeric,
  gross_amount numeric,
  discount_amount numeric,
  paid_amount numeric,
  cash_amount numeric,
  items_sold numeric,
  avg_ticket numeric,
  items_per_ticket numeric,
  avg_item_price numeric,
  cash_share numeric,
  voucher_share numeric,
  member_share numeric,
  identified_share numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    s.days_with_data,
    coalesce(s.invoices, 0),
    coalesce(s.net_amount, 0),
    coalesce(s.gross_amount, 0),
    coalesce(s.discount_amount, 0),
    coalesce(s.paid_amount, 0),
    coalesce(s.cash_amount, 0),
    coalesce(s.items_sold, 0),
    s.avg_ticket,
    s.items_per_ticket,
    s.avg_item_price,
    s.cash_share,
    s.voucher_share,
    s.member_share,
    s.identified_share
  from app.summarize_daily(store_ids, from_date, to_date) s;
$$;

create or replace function public.period_compare(store_ids uuid[], grain text, anchor date)
returns table (
  period text,
  from_date date,
  to_date date,
  days_with_data integer,
  invoices bigint,
  net_amount numeric,
  gross_amount numeric,
  discount_amount numeric,
  avg_ticket numeric,
  items_per_ticket numeric,
  avg_item_price numeric,
  cash_share numeric,
  voucher_share numeric,
  member_share numeric,
  identified_share numeric
)
language plpgsql
stable
security invoker
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
  case grain
    when 'day' then
      current_start := anchor;
      previous_start := anchor - 1;
      previous_period_end := previous_start;
      last_year_start := anchor - 364;
      last_year_period_end := last_year_start;
    when 'week' then
      current_start := date_trunc('week', anchor)::date;
      previous_start := current_start - 7;
      previous_period_end := previous_start + 6;
      last_year_start := current_start - 364;
      last_year_period_end := last_year_start + 6;
    when 'month' then
      current_start := date_trunc('month', anchor)::date;
      previous_start := (current_start - interval '1 month')::date;
      previous_period_end := current_start - 1;
      last_year_start := (current_start - interval '1 year')::date;
      last_year_period_end := (last_year_start + interval '1 month' - interval '1 day')::date;
    when 'year' then
      current_start := date_trunc('year', anchor)::date;
      previous_start := (current_start - interval '1 year')::date;
      previous_period_end := current_start - 1;
      last_year_start := previous_start;
      last_year_period_end := previous_period_end;
    else
      raise exception 'period_compare grain must be day, week, month or year, not %', grain;
  end case;
  elapsed_days := anchor - current_start;

  return query
  select 'current'::text, current_start, anchor,
    s.days_with_data, s.invoices, s.net_amount, s.gross_amount, s.discount_amount,
    s.avg_ticket, s.items_per_ticket, s.avg_item_price, s.cash_share, s.voucher_share, s.member_share, s.identified_share
  from app.summarize_daily(store_ids, current_start, anchor) s;

  return query
  select 'previous'::text, previous_start, least(previous_start + elapsed_days, previous_period_end),
    s.days_with_data, s.invoices, s.net_amount, s.gross_amount, s.discount_amount,
    s.avg_ticket, s.items_per_ticket, s.avg_item_price, s.cash_share, s.voucher_share, s.member_share, s.identified_share
  from app.summarize_daily(store_ids, previous_start, least(previous_start + elapsed_days, previous_period_end)) s;

  return query
  select 'last_year'::text, last_year_start, least(last_year_start + elapsed_days, last_year_period_end),
    s.days_with_data, s.invoices, s.net_amount, s.gross_amount, s.discount_amount,
    s.avg_ticket, s.items_per_ticket, s.avg_item_price, s.cash_share, s.voucher_share, s.member_share, s.identified_share
  from app.summarize_daily(store_ids, last_year_start, least(last_year_start + elapsed_days, last_year_period_end)) s;

  if grain = 'day' then
    return query
    select 'baseline'::text, anchor - 7 * baseline_weeks, anchor - 7,
      b.sample_days, round(b.baseline_invoices)::bigint, b.baseline_net_amount, null::numeric, null::numeric,
      b.baseline_avg_ticket, null::numeric, null::numeric, null::numeric, null::numeric, null::numeric, null::numeric
    from public.same_weekday_baseline(store_ids, anchor, baseline_weeks) b;
  end if;
end;
$$;

create or replace function public.weekday_profile_forecast(store_ids uuid[], target_date date, origin date default null)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select round(p.level_net_amount * coalesce(p.weekday_index, 1), 2)
  from app.weekday_profile(store_ids, least(coalesce(origin, app.analytics_as_of(store_ids)), target_date - 1)) p
  where p.weekday = extract(isodow from target_date);
$$;

create or replace function public.seasonal_naive_forecast(store_ids uuid[], target_date date, origin date default null)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select s.forecast_net_amount
  from app.seasonal_naive_series(store_ids, coalesce(origin, app.analytics_as_of(store_ids)), target_date, target_date) s;
$$;

create or replace function public.month_pace(store_ids uuid[], month_start date, as_of date default null)
returns table (
  period_start date,
  as_of_date date,
  elapsed_days integer,
  remaining_days integer,
  month_to_date_net_amount numeric,
  month_to_date_invoices bigint,
  forecast_weekday_profile_net_amount numeric,
  forecast_seasonal_naive_net_amount numeric,
  target_net_amount numeric
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  last_day date;
  first_forecast_day date;
  weekday_profile_total numeric;
  seasonal_naive_total numeric;
  weekday_profile_days integer;
  seasonal_naive_days integer;
begin
  period_start := date_trunc('month', month_start)::date;
  last_day := (period_start + interval '1 month' - interval '1 day')::date;
  as_of_date := least(coalesce(month_pace.as_of, app.analytics_as_of(store_ids)), last_day);
  first_forecast_day := greatest(as_of_date + 1, period_start);
  elapsed_days := greatest(as_of_date - period_start + 1, 0);
  remaining_days := greatest(last_day - first_forecast_day + 1, 0);

  select coalesce(sum(d.net_amount), 0), coalesce(sum(d.invoices), 0)
  into month_to_date_net_amount, month_to_date_invoices
  from app.daily_sales(store_ids, period_start, as_of_date) d;

  select coalesce(sum(round(p.level_net_amount * coalesce(p.weekday_index, 1), 2)), 0), count(p.level_net_amount)
  into weekday_profile_total, weekday_profile_days
  from generate_series(first_forecast_day, last_day, interval '1 day') as g
  join app.weekday_profile(store_ids, as_of_date) p on p.weekday = extract(isodow from g);

  select coalesce(sum(s.forecast_net_amount), 0), count(s.forecast_net_amount)
  into seasonal_naive_total, seasonal_naive_days
  from app.seasonal_naive_series(store_ids, as_of_date, first_forecast_day, last_day) s;

  forecast_weekday_profile_net_amount := case when weekday_profile_days = remaining_days then month_to_date_net_amount + weekday_profile_total end;
  forecast_seasonal_naive_net_amount := case when seasonal_naive_days = remaining_days then month_to_date_net_amount + seasonal_naive_total end;

  select sum(t.net_target_amount)
  into target_net_amount
  from public.targets t
  where t.store_id = any (store_ids)
    and t.period_kind = 'month'
    and t.period_start = month_pace.period_start;

  return next;
end;
$$;

create or replace function public.forecast_accuracy(store_ids uuid[], as_of_date date, days integer default 28)
returns table (
  forecast_id text,
  sample_days integer,
  mae numeric,
  mape numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with series as materialized (
    select s.business_date, s.net_amount, s.excluded
    from app.daily_net_series(store_ids, as_of_date - greatest(days, 1) + 1 - 84, as_of_date) s
  ),
  scored_days as (
    select
      s.business_date as target_date,
      s.net_amount as actual_net_amount,
      (
        select round(
          avg(h.net_amount) filter (where h.business_date >= s.business_date - 28)
          * coalesce(
            avg(h.net_amount) filter (where extract(isodow from h.business_date) = extract(isodow from s.business_date))
              / nullif(avg(h.net_amount), 0),
            1
          ),
          2
        )
        from series h
        where not h.excluded
          and h.business_date between s.business_date - 84 and s.business_date - 1
      ) as weekday_profile_net_amount,
      (
        select round(h.net_amount, 2)
        from series h
        where h.business_date between s.business_date - 56 and s.business_date - 1
          and (s.business_date - h.business_date) % 7 = 0
        order by h.business_date desc
        limit 1
      ) as seasonal_naive_net_amount
    from series s
    where s.business_date > as_of_date - greatest(days, 1)
      and not s.excluded
  ),
  comparable_days as (
    select *
    from scored_days d
    where d.weekday_profile_net_amount is not null
      and d.seasonal_naive_net_amount is not null
  ),
  errors as (
    select 'forecast_weekday_profile'::text as forecast_id, c.actual_net_amount, c.weekday_profile_net_amount as forecast_net_amount
    from comparable_days c
    union all
    select 'forecast_seasonal_naive'::text, c.actual_net_amount, c.seasonal_naive_net_amount
    from comparable_days c
  )
  select
    ids.forecast_id,
    count(e.forecast_net_amount)::integer,
    round(avg(abs(e.actual_net_amount - e.forecast_net_amount)), 2),
    round(avg(abs(e.actual_net_amount - e.forecast_net_amount) / nullif(e.actual_net_amount, 0)), 6)
  from (values ('forecast_seasonal_naive'::text), ('forecast_weekday_profile'::text)) as ids (forecast_id)
  left join errors e on e.forecast_id = ids.forecast_id
  group by ids.forecast_id
  order by ids.forecast_id;
$$;

create or replace function public.hour_weekday_heatmap(store_ids uuid[], from_date date, to_date date)
returns table (
  weekday smallint,
  hour_local smallint,
  days_with_data integer,
  invoices bigint,
  net_amount numeric,
  avg_net_amount numeric,
  avg_invoices numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with hourly as (
    select h.business_date, extract(isodow from h.business_date)::smallint as day_of_week, h.hour_local, h.invoices, h.net_amount
    from app.hourly_sales(store_ids, from_date, to_date) h
  ),
  days_per_weekday as (
    select hourly.day_of_week, count(distinct hourly.business_date) as day_count
    from hourly
    group by hourly.day_of_week
  )
  select
    h.day_of_week,
    h.hour_local,
    d.day_count::integer,
    sum(h.invoices),
    sum(h.net_amount),
    round(sum(h.net_amount) / d.day_count, 2),
    round(sum(h.invoices)::numeric / d.day_count, 4)
  from hourly h
  join days_per_weekday d on d.day_of_week = h.day_of_week
  group by h.day_of_week, h.hour_local, d.day_count
  order by h.day_of_week, h.hour_local;
$$;

create or replace function public.item_velocity(store_ids uuid[], as_of_date date)
returns table (
  item_external_id text,
  item_name text,
  item_type_external_id text,
  item_type_name text,
  recent_quantity numeric,
  prior_quantity numeric,
  recent_net_amount numeric,
  prior_net_amount numeric,
  quantity_change_pct numeric,
  net_change_pct numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with per_item as (
    select
      a.item_external_id,
      max(a.item_name) as item_name,
      max(a.item_type_external_id) as item_type_external_id,
      max(a.item_type_name) as item_type_name,
      coalesce(sum(a.quantity) filter (where a.business_date > as_of_date - 28), 0) as recent_quantity,
      coalesce(sum(a.quantity) filter (where a.business_date <= as_of_date - 28), 0) as prior_quantity,
      coalesce(sum(a.net_amount) filter (where a.business_date > as_of_date - 28), 0) as recent_net_amount,
      coalesce(sum(a.net_amount) filter (where a.business_date <= as_of_date - 28), 0) as prior_net_amount
    from public.agg_item_daily a
    where a.store_id = any (store_ids)
      and a.business_date between as_of_date - 55 and as_of_date
    group by a.item_external_id
  )
  select
    p.item_external_id,
    p.item_name,
    p.item_type_external_id,
    p.item_type_name,
    p.recent_quantity,
    p.prior_quantity,
    p.recent_net_amount,
    p.prior_net_amount,
    round(100 * (p.recent_quantity - p.prior_quantity) / nullif(p.prior_quantity, 0), 3),
    round(100 * (p.recent_net_amount - p.prior_net_amount) / nullif(p.prior_net_amount, 0), 3)
  from per_item p
  order by p.recent_net_amount desc;
$$;

create or replace function public.menu_matrix(store_ids uuid[], as_of_date date, popularity_factor numeric default 0.7)
returns table (
  role public.item_type_role,
  item_external_id text,
  item_name text,
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
  menu_class text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with store_items as (
    select
      a.store_id,
      s.tenant_id,
      s.pos_account_id,
      a.item_external_id,
      max(a.item_name) as item_name,
      max(a.item_type_external_id) as item_type_external_id,
      sum(a.quantity) as quantity,
      sum(a.net_amount) as net_amount
    from public.agg_item_daily a
    join public.stores s on s.id = a.store_id
    where a.store_id = any (store_ids)
      and a.business_date between as_of_date - 27 and as_of_date
    group by a.store_id, s.tenant_id, s.pos_account_id, a.item_external_id
  ),
  with_role_and_cost as (
    select
      si.*,
      coalesce(r.role, 'other') as item_role,
      cost.cost_amount
    from store_items si
    left join public.item_type_roles r
      on r.pos_account_id = si.pos_account_id
      and r.item_type_external_id = si.item_type_external_id
    left join lateral (
      select c.cost_amount
      from public.item_costs c
      where c.tenant_id = si.tenant_id
        and c.item_external_id = si.item_external_id
        and c.effective_from <= as_of_date
        and (c.store_id = si.store_id or c.store_id is null)
      order by (c.store_id is not null) desc, c.effective_from desc
      limit 1
    ) cost on true
  ),
  per_item as (
    select
      w.item_role,
      w.item_external_id,
      max(w.item_name) as item_name,
      sum(w.quantity) as quantity,
      sum(w.net_amount) as net_amount,
      bool_or(w.cost_amount is null) as without_cost,
      sum(w.quantity * w.cost_amount) as cost_total
    from with_role_and_cost w
    group by w.item_role, w.item_external_id
  ),
  role_flags as (
    select
      p.item_role,
      bool_or(p.without_cost) as provisional,
      count(*) < 10 as low_sample
    from per_item p
    group by p.item_role
  ),
  axes as (
    select
      p.*,
      rf.provisional,
      rf.low_sample,
      round(p.net_amount / nullif(p.quantity, 0), 2) as avg_unit_price,
      case when p.without_cost then null else round(p.cost_total / nullif(p.quantity, 0), 2) end as unit_cost,
      case
        when rf.provisional then p.net_amount / nullif(p.quantity, 0)
        else (p.net_amount - p.cost_total) / nullif(p.quantity, 0)
      end as margin_axis
    from per_item p
    join role_flags rf on rf.item_role = p.item_role
  ),
  role_totals as (
    select
      x.item_role,
      count(*) as item_count,
      sum(x.quantity) as role_quantity,
      sum(x.margin_axis * x.quantity) / nullif(sum(x.quantity), 0) as margin_threshold
    from axes x
    group by x.item_role
  )
  select
    x.item_role,
    x.item_external_id,
    x.item_name,
    x.quantity,
    x.net_amount,
    round(100 * x.quantity / nullif(rt.role_quantity, 0), 3),
    round(100 * popularity_factor / rt.item_count, 3),
    x.avg_unit_price,
    x.unit_cost,
    round(x.margin_axis, 2),
    round(rt.margin_threshold, 2),
    x.provisional,
    x.low_sample,
    case
      when x.quantity / nullif(rt.role_quantity, 0) >= popularity_factor / rt.item_count and x.margin_axis >= rt.margin_threshold then 'star'
      when x.quantity / nullif(rt.role_quantity, 0) >= popularity_factor / rt.item_count then 'plowhorse'
      when x.margin_axis >= rt.margin_threshold then 'puzzle'
      else 'dog'
    end
  from axes x
  join role_totals rt on rt.item_role = x.item_role
  order by x.item_role, x.quantity desc;
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
  with window_shifts as (
    select s.store_id, s.shift_id, s.shift_external_id, s.business_date, s.cashier_name, s.cash_sales_amount, s.variance_amount
    from public.agg_shift_cash s
    where s.store_id = any (store_ids)
      and s.business_date between from_date and to_date
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
      abs(sc.variance_amount) > abs_threshold as over_abs_threshold,
      sc.cash_sales_amount > 0 and abs(sc.variance_amount) > rel_threshold * sc.cash_sales_amount as over_rel_threshold,
      coalesce(abs(sc.z_score) > 2, false) as over_z_threshold
    from scored sc
  )
  select
    f.store_id,
    f.shift_id,
    f.shift_external_id,
    f.business_date,
    f.cashier_name,
    f.cash_sales_amount,
    f.variance_amount,
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
  from flagged f
  where f.over_abs_threshold or f.over_rel_threshold or f.over_z_threshold
  order by f.business_date, f.store_id, f.shift_external_id;
$$;

revoke all on function public.same_weekday_baseline(uuid[], date, integer) from public, anon;
revoke all on function public.period_summary(uuid[], date, date) from public, anon;
revoke all on function public.period_compare(uuid[], text, date) from public, anon;
revoke all on function public.weekday_profile_forecast(uuid[], date, date) from public, anon;
revoke all on function public.seasonal_naive_forecast(uuid[], date, date) from public, anon;
revoke all on function public.month_pace(uuid[], date, date) from public, anon;
revoke all on function public.forecast_accuracy(uuid[], date, integer) from public, anon;
revoke all on function public.hour_weekday_heatmap(uuid[], date, date) from public, anon;
revoke all on function public.item_velocity(uuid[], date) from public, anon;
revoke all on function public.menu_matrix(uuid[], date, numeric) from public, anon;
revoke all on function public.cash_variance_flags(uuid[], date, date, numeric, numeric) from public, anon;

grant execute on function public.same_weekday_baseline(uuid[], date, integer) to authenticated, service_role;
grant execute on function public.period_summary(uuid[], date, date) to authenticated, service_role;
grant execute on function public.period_compare(uuid[], text, date) to authenticated, service_role;
grant execute on function public.weekday_profile_forecast(uuid[], date, date) to authenticated, service_role;
grant execute on function public.seasonal_naive_forecast(uuid[], date, date) to authenticated, service_role;
grant execute on function public.month_pace(uuid[], date, date) to authenticated, service_role;
grant execute on function public.forecast_accuracy(uuid[], date, integer) to authenticated, service_role;
grant execute on function public.hour_weekday_heatmap(uuid[], date, date) to authenticated, service_role;
grant execute on function public.item_velocity(uuid[], date) to authenticated, service_role;
grant execute on function public.menu_matrix(uuid[], date, numeric) to authenticated, service_role;
grant execute on function public.cash_variance_flags(uuid[], date, date, numeric, numeric) to authenticated, service_role;
