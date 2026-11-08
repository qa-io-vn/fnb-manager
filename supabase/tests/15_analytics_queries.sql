begin;
select plan(63);

create temp table fixture as
select
  '11111111-1111-4111-8111-111111111111'::uuid as demo_tenant_id,
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid as demo_owner_id,
  '22222222-2222-4222-8222-000000000001'::uuid as tea_store_id,
  '22222222-2222-4222-8222-000000000002'::uuid as coffee_store_id,
  array['22222222-2222-4222-8222-000000000001', '22222222-2222-4222-8222-000000000002']::uuid[] as both_stores,
  (current_date - 7)::date as seed_from,
  (current_date - 1)::date as seed_to,
  '2025-06-30'::date as baseline_target;

select app.refresh_analytics(f.demo_tenant_id, f.seed_from - 1, f.seed_to + 1) from fixture f;

create temp table demo_sales as
select i.*
from public.invoices i
join fixture f on f.demo_tenant_id = i.tenant_id
where i.status <> 'voided';

create temp table facts as
select
  count(*) as invoices,
  sum(i.net_amount) as net_amount,
  sum(i.gross_amount) as gross_amount,
  sum(i.paid_amount) as paid_amount,
  count(*) filter (where i.customer_phone is not null or i.customer_id is not null) as identified_invoices,
  (select sum(l.quantity) from public.invoice_lines l join demo_sales j on j.id = l.invoice_id, fixture x where l.line_kind = 'item' and j.business_date between x.seed_from and x.seed_to) as items_sold,
  (select sum(p.amount) from public.invoice_payments p join demo_sales j on j.id = p.invoice_id, fixture x where p.payment_method_external_id = 'pm-01' and j.business_date between x.seed_from and x.seed_to) as cash_amount
from demo_sales i, fixture f
where i.business_date between f.seed_from and f.seed_to;

select is((select s.invoices from fixture f cross join lateral public.period_summary(f.both_stores, f.seed_from, f.seed_to) s), (select invoices from facts), 'period_summary counts the non-voided invoices');
select is((select s.net_amount from fixture f cross join lateral public.period_summary(f.both_stores, f.seed_from, f.seed_to) s), (select net_amount from facts), 'period_summary sums the net amount');
select is((select s.gross_amount from fixture f cross join lateral public.period_summary(f.both_stores, f.seed_from, f.seed_to) s), (select gross_amount from facts), 'period_summary sums the gross amount');
select is((select s.avg_ticket from fixture f cross join lateral public.period_summary(f.both_stores, f.seed_from, f.seed_to) s), (select round(net_amount / invoices, 2) from facts), 'avg_ticket is net over invoices');
select is((select s.items_per_ticket from fixture f cross join lateral public.period_summary(f.both_stores, f.seed_from, f.seed_to) s), (select round(items_sold / invoices, 4) from facts), 'items_per_ticket is item quantity over invoices');
select is((select s.avg_item_price from fixture f cross join lateral public.period_summary(f.both_stores, f.seed_from, f.seed_to) s), (select round(net_amount / items_sold, 2) from facts), 'avg_item_price is net over item quantity');
select is((select s.cash_share from fixture f cross join lateral public.period_summary(f.both_stores, f.seed_from, f.seed_to) s), (select round(cash_amount / paid_amount, 6) from facts), 'cash_share is cash tenders over paid amount');
select is((select s.identified_share from fixture f cross join lateral public.period_summary(f.both_stores, f.seed_from, f.seed_to) s), (select round(identified_invoices::numeric / invoices, 6) from facts), 'identified_share is invoices with a phone or a customer id over invoices');
select is((select s.invoices from fixture f cross join lateral public.period_summary(f.both_stores, f.seed_from - 60, f.seed_from - 30) s), 0::bigint, 'an empty period summarises to zero invoices');
select is((select s.avg_ticket from fixture f cross join lateral public.period_summary(f.both_stores, f.seed_from - 60, f.seed_from - 30) s), null::numeric, 'an empty period has no average ticket');

select is(
  (select s.net_amount from fixture f cross join lateral public.period_summary(array[f.tea_store_id], f.seed_from, f.seed_to) s),
  (select sum(i.net_amount) from demo_sales i, fixture f where i.store_id = f.tea_store_id and i.business_date between f.seed_from and f.seed_to),
  'period_summary restricts to the requested stores'
);

create temp table week_compare as
select c.* from fixture f cross join lateral public.period_compare(f.both_stores, 'week', f.seed_to) c;

select is((select count(*) from week_compare), 3::bigint, 'week compare returns current, previous and last year');
select is((select from_date from week_compare where period = 'current'), (select date_trunc('week', seed_to)::date from fixture), 'week compare starts the current period on Monday');
select is((select to_date from week_compare where period = 'current'), (select seed_to from fixture), 'week compare ends the current period on the anchor');
select is(
  (select net_amount from week_compare where period = 'current'),
  (select sum(i.net_amount) from demo_sales i, week_compare w where w.period = 'current' and i.business_date between w.from_date and w.to_date),
  'week compare current net equals the facts of its range'
);
select is((select to_date - from_date from week_compare where period = 'previous'), (select to_date - from_date from week_compare where period = 'current'), 'week compare previous period has the same elapsed length');
select is((select from_date from week_compare where period = 'previous'), (select from_date - 7 from week_compare where period = 'current'), 'week compare previous period starts seven days earlier');
select is(
  (select net_amount from week_compare where period = 'previous'),
  (select sum(i.net_amount) from demo_sales i, week_compare w where w.period = 'previous' and i.business_date between w.from_date and w.to_date),
  'week compare previous net equals the facts of its range'
);
select is((select from_date from week_compare where period = 'last_year'), (select from_date - 364 from week_compare where period = 'current'), 'week compare last year is 52 weeks earlier');
select is((select net_amount from week_compare where period = 'last_year'), null::numeric, 'week compare last year is null without data');

create temp table month_compare as
select c.* from fixture f cross join lateral public.period_compare(f.both_stores, 'month', f.seed_to) c;

select is((select from_date from month_compare where period = 'current'), (select date_trunc('month', seed_to)::date from fixture), 'month compare starts on the first of the month');
select is(
  (select (invoices, net_amount) from month_compare where period = 'current'),
  (select (count(*), sum(i.net_amount)) from demo_sales i, month_compare m where m.period = 'current' and i.business_date between m.from_date and m.to_date),
  'month compare current values equal the facts of its range'
);
select is((select from_date from month_compare where period = 'previous'), (select (date_trunc('month', seed_to) - interval '1 month')::date from fixture), 'month compare previous period is the previous month');
select is(
  (select net_amount from month_compare where period = 'previous'),
  (select sum(i.net_amount) from demo_sales i, month_compare m where m.period = 'previous' and i.business_date between m.from_date and m.to_date),
  'month compare previous net equals the facts of its range'
);

select is((select count(*) from fixture f cross join lateral public.period_compare(f.both_stores, 'day', f.seed_to) c), 4::bigint, 'day compare adds the same-weekday baseline row');
select is(
  (select c.net_amount from fixture f cross join lateral public.period_compare(f.both_stores, 'day', f.seed_to) c where c.period = 'previous'),
  (select sum(i.net_amount) from demo_sales i, fixture f where i.business_date = f.seed_to - 1),
  'day compare previous is the day before the anchor'
);
select throws_ok(
  $$ select * from public.period_compare(array['22222222-2222-4222-8222-000000000001']::uuid[], 'quarter', current_date) $$,
  'P0001',
  null,
  'period_compare rejects an unknown grain'
);

insert into public.agg_daily_sales (tenant_id, store_id, business_date, invoices, net_amount)
select f.demo_tenant_id, f.tea_store_id, f.baseline_target - 7 * s.k, s.invoices, s.net_amount
from fixture f
cross join (
  values (1, 1, 100), (2, 3, 300), (3, 2, 200), (4, 10, 1000), (5, 5, 500)
) as s (k, invoices, net_amount);

select is(
  (select (sample_days, baseline_net_amount, baseline_invoices) from fixture f cross join lateral public.same_weekday_baseline(array[f.tea_store_id], f.baseline_target, 8) b),
  (5, 300.00::numeric, 3.00::numeric),
  'same_weekday_baseline returns the median of the eligible same weekdays'
);

insert into public.holidays (tenant_id, country_code, holiday_date, name, kind)
select f.demo_tenant_id, 'VN', f.baseline_target - 28, 'Shop closure', 'custom' from fixture f;

select is(
  (select (sample_days, baseline_net_amount, baseline_invoices) from fixture f cross join lateral public.same_weekday_baseline(array[f.tea_store_id], f.baseline_target, 8) b),
  (4, 250.00::numeric, 2.50::numeric),
  'same_weekday_baseline excludes a tenant holiday'
);
select is(
  (select b.baseline_avg_ticket from fixture f cross join lateral public.same_weekday_baseline(array[f.tea_store_id], f.baseline_target, 8) b),
  100.00::numeric,
  'same_weekday_baseline reports the median of the daily average tickets'
);
select is(
  (
    select (c.days_with_data, c.invoices, c.net_amount, c.avg_ticket, c.items_per_ticket, c.cash_share, c.identified_share)
    from fixture f cross join lateral public.period_compare(array[f.tea_store_id], 'day', f.baseline_target) c
    where c.period = 'baseline'
  ),
  (4, 3::bigint, 250.00::numeric, 100.00::numeric, null::numeric, null::numeric, null::numeric),
  'the baseline row carries the median net, the rounded median invoices and the median ticket, not their ratio, and null for other ratios'
);

insert into public.holidays (tenant_id, country_code, holiday_date, name, kind)
select f.demo_tenant_id, 'VN', f.baseline_target - 35, 'Tet eve', 'tet' from fixture f;

select is(
  (select (sample_days, baseline_net_amount, baseline_invoices) from fixture f cross join lateral public.same_weekday_baseline(array[f.tea_store_id], f.baseline_target, 8) b),
  (3, 200.00::numeric, 2.00::numeric),
  'same_weekday_baseline excludes a Tet day'
);
select is(
  (select sample_days from fixture f cross join lateral public.same_weekday_baseline(array[f.tea_store_id], f.baseline_target, 2) b),
  2,
  'same_weekday_baseline honours the number of weeks'
);
select is((select app.tet_window(f.demo_tenant_id, 'VN', '2026-02-18') from fixture f), true, 'tet_window covers the seeded Tet days');
select is((select app.tet_window(f.demo_tenant_id, 'VN', '2026-02-25') from fixture f), false, 'tet_window ends with the last Tet day');
select is((select app.is_holiday(f.demo_tenant_id, 'VN', '2026-09-02') from fixture f), true, 'is_holiday finds a global public holiday');
select is((select app.is_holiday(f.demo_tenant_id, 'VN', '2026-09-03') from fixture f), false, 'is_holiday is false on an ordinary day');

select is((select public.seasonal_naive_forecast(array[f.tea_store_id], f.baseline_target) from fixture f), 100.00::numeric, 'seasonal naive forecast is the value of the same weekday a week earlier');
select is((select public.weekday_profile_forecast(array[f.tea_store_id], f.baseline_target) from fixture f), 200.00::numeric, 'weekday profile forecast is the holiday-free trailing level times the weekday index');
select is((select public.weekday_profile_forecast(array[f.tea_store_id], f.baseline_target - 365) from fixture f), null::numeric, 'weekday profile forecast is null without history');
select is(
  (select (public.weekday_profile_forecast(array[f.tea_store_id], f.baseline_target, f.baseline_target + 30), public.seasonal_naive_forecast(array[f.tea_store_id], f.baseline_target, f.baseline_target + 30)) from fixture f),
  (200.00::numeric, 100.00::numeric),
  'an origin on or after the target is clamped to the day before, so a forecast never sees its own target day'
);

create temp table accuracy as
select a.* from fixture f cross join lateral public.forecast_accuracy(array[f.tea_store_id], f.baseline_target - 7, 21) a;

select is(
  (select array_agg(forecast_id order by forecast_id) from accuracy),
  array['forecast_seasonal_naive', 'forecast_weekday_profile'],
  'forecast_accuracy returns one row per benchmark forecast'
);
select is(
  (select (sample_days, mae, mape) from accuracy where forecast_id = 'forecast_weekday_profile'),
  (2, 125.00::numeric, 0.916667::numeric),
  'forecast_accuracy scores the weekday profile one day ahead on the days where both forecasts exist'
);
select is(
  (select (sample_days, mae, mape) from accuracy where forecast_id = 'forecast_seasonal_naive'),
  (2, 150.00::numeric, 1.166667::numeric),
  'forecast_accuracy scores the seasonal naive forecast on the same days'
);
select is(
  (select (public.weekday_profile_forecast(array[f.tea_store_id], f.baseline_target - 7), public.seasonal_naive_forecast(array[f.tea_store_id], f.baseline_target - 7)) from fixture f),
  (250.00::numeric, 300.00::numeric),
  'the single-day forecasts agree with the values forecast_accuracy scored'
);

create temp table seed_series as
select
  i.business_date,
  sum(i.net_amount) as net_amount,
  app.is_excluded_day(f.both_stores, i.business_date) as excluded,
  app.analytics_as_of(f.both_stores) as origin
from demo_sales i, fixture f
where i.business_date between app.analytics_as_of(f.both_stores) - 83 and app.analytics_as_of(f.both_stores)
group by i.business_date, f.both_stores;

create temp table long_horizon as
select (select max(origin) from seed_series) + 35 as profile_target, (select max(origin) from seed_series) + 63 as naive_target;

select is(
  (select public.weekday_profile_forecast(f.both_stores, h.profile_target) from fixture f, long_horizon h),
  (
    select round(
      avg(s.net_amount) filter (where s.business_date >= s.origin - 27)
      * (avg(s.net_amount) filter (where extract(isodow from s.business_date) = extract(isodow from h.profile_target)) / avg(s.net_amount)),
      2
    )
    from seed_series s, long_horizon h
    where not s.excluded
  ),
  'five weeks ahead the weekday profile is the level at the origin times the weekday index'
);
select isnt((select public.weekday_profile_forecast(f.both_stores, h.profile_target) from fixture f, long_horizon h), null::numeric, 'the weekday profile forecast exists beyond 28 days');
select is(
  (select public.seasonal_naive_forecast(f.both_stores, h.naive_target) from fixture f, long_horizon h),
  (
    select round(s.net_amount, 2)
    from seed_series s, long_horizon h
    where (h.naive_target - s.business_date) % 7 = 0
      and s.business_date >= s.origin - 55
    order by s.business_date desc
    limit 1
  ),
  'nine weeks ahead the seasonal naive forecast repeats the last observed same weekday'
);
select isnt((select public.seasonal_naive_forecast(f.both_stores, h.naive_target) from fixture f, long_horizon h), null::numeric, 'the seasonal naive forecast exists beyond eight weeks');

select is(
  (select app.analytics_as_of(f.both_stores, (current_date + time '18:00') at time zone 'UTC') from fixture f),
  current_date,
  'at 18:00 UTC the local day of a UTC+7 store has turned, so its last complete day is the UTC date'
);
select is(
  (select app.analytics_as_of(f.both_stores, (current_date + time '16:00') at time zone 'UTC') from fixture f),
  current_date - 1,
  'at 16:00 UTC the last complete local day is the day before the UTC date'
);

update public.stores s set business_day_start_minutes = 360 from fixture f where s.id = f.tea_store_id;

select is(
  (select app.analytics_as_of(array[f.tea_store_id], (current_date + time '18:00') at time zone 'UTC') from fixture f),
  current_date - 1,
  'a business day that starts at 06:00 local has not turned at 01:00 local'
);

update public.stores s set business_day_start_minutes = 0 from fixture f where s.id = f.tea_store_id;

create temp table pace as
select p.* from fixture f cross join lateral public.month_pace(f.both_stores, current_date) p;

select is((select period_start from pace), date_trunc('month', current_date)::date, 'month_pace reports the month start');
select is(
  (select month_to_date_net_amount from pace),
  (select coalesce(sum(i.net_amount), 0) from demo_sales i, pace p where i.business_date between p.period_start and p.as_of_date),
  'month_pace month-to-date net equals the facts through the as-of date'
);
select is((select as_of_date from pace), (select least(app.analytics_as_of(f.both_stores), (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date) from fixture f), 'month_pace counts month to date through the last complete local business day');
select is((select remaining_days from pace), (select ((period_start + interval '1 month' - interval '1 day')::date - as_of_date) from pace), 'month_pace counts the remaining days of the month');
select is(
  (select target_net_amount from pace),
  (select sum(t.net_target_amount) from public.targets t, fixture f where t.store_id = any (f.both_stores) and t.period_kind = 'month' and t.period_start = date_trunc('month', current_date)::date),
  'month_pace sums the store targets of the month'
);
select is(
  (select p.month_to_date_net_amount from fixture f cross join lateral public.month_pace(f.both_stores, f.seed_to, f.seed_to) p),
  (select coalesce(sum(i.net_amount), 0) from demo_sales i, fixture f where i.business_date between date_trunc('month', f.seed_to)::date and f.seed_to),
  'an explicit as-of date is counted in month to date'
);

create temp table future_pace as
select p.* from fixture f cross join lateral public.month_pace(f.both_stores, (date_trunc('month', current_date) + interval '1 month')::date) p;

select is(
  (select (elapsed_days, remaining_days, month_to_date_net_amount) from future_pace),
  (select (0, extract(day from date_trunc('month', current_date) + interval '2 months' - interval '1 day')::integer, 0::numeric)),
  'a future month has no month to date and forecasts every one of its days'
);
select ok(
  (select forecast_weekday_profile_net_amount / nullif(forecast_seasonal_naive_net_amount, 0) between 0.5 and 2 from future_pace),
  'for a future month both forecasts exist and agree in order of magnitude'
);
select cmp_ok((select forecast_weekday_profile_net_amount from pace), '>=', (select month_to_date_net_amount from pace), 'the weekday-profile month forecast is at least the month to date');
select cmp_ok((select forecast_seasonal_naive_net_amount from pace), '>=', (select month_to_date_net_amount from pace), 'the seasonal-naive month forecast is at least the month to date');

select is(
  (select (sum(h.invoices)::bigint, sum(h.net_amount)) from fixture f cross join lateral public.hour_weekday_heatmap(f.both_stores, f.seed_from, f.seed_to) h),
  (select (invoices, net_amount) from facts),
  'the heatmap sums to the period totals'
);

select * from finish();
rollback;
