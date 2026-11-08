# Metric registry

The single list of metrics that reports, exports, the AI data pack, digests and KPI follow-up read from (ADR-026). Every metric is defined once here; `packages/metrics` mirrors these ids and labels in TypeScript, and the SQL that produces each value lives in `supabase/migrations/` (see `docs/schema.md`, section Analytics). Nothing here is specific to one shop: the examples are generic and the benchmark section holds published market figures only.

## Conventions

- **Net** is the invoice total after item, bill, extra and voucher discounts (`invoices.net_amount`). **Gross** is the total before them (`invoices.gross_amount`). Service charge, shipping fee and VAT are not discounts and are not subtracted.
- **Sales** are invoices whose `status` is not `voided`; an `edited` invoice counts with its latest amounts. Voided and edited invoices are counted separately as adjustment metrics.
- **Items sold** counts lines of kind `item` only. Modifier (sugar, ice, topping options sold at zero price), service, package and other lines are never items.
- **Rates and shares are fractions**: `0.25` means 25 %. Columns named `_pct` are percentages: `12.345` means 12.345 %.
- **Grains**: store-day, store-hour, store-week (ISO week), store-period (any date range), item-period (an item over a date range; the menu matrix uses the trailing 28 days), shift, cashier-period, customer, segment (a group of customers), cohort-month, tenant-month, tenant-period. Every value is keyed by tenant and store; a multi-store figure is the sum of the stores before any ratio is taken.
- **Direction**: higher-is-better, lower-is-better, or neutral (a descriptive or comparator metric that no one should maximise).
- **Status**: `available now` (computed from synced data), `needs costs` (item costs entered in Settings), `needs customer identity` (identified customers from the loyalty rail, phases 16–19), `needs seats` (`stores.seat_count` entered in Settings).
- **Freshness**: aggregate tables are refreshed by the sync jobs; dates from yesterday onwards are read live from the fact tables (see the hot path rule in `docs/schema.md`). A report never has to wait for a refresh to show today.
- **As-of day and forecast origin**: month-to-date figures and forecasts run up to the last complete business day of the stores, `app.analytics_as_of(store_ids)`: the store-local business date of now (timezone and day-start rule of each store) minus one day, the earliest over the stores. A forecast built from an origin uses only days up to that origin and never sees its own target day.
- **Holidays and Tết**: baselines and the weekday profile exclude days that are public holidays, Tết days or tenant custom holidays (`holidays`, kinds `public`, `tet`, `custom`). The seasonal-naïve forecast is deliberately raw and does not. Forecast error is scored on days that are not excluded.
- **Unmeasured is null**: a metric whose inputs are not configured yet (a role mapping, opening hours, seats, costs) is null, never zero; zero means measured and none.

## Sales, ticket and basket

| id | Tiếng Việt | English | Unit | Formula | Grain | Direction | Source | Reports | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `net_revenue` | Doanh thu thuần | Net revenue | VND | Σ `net_amount` of non-voided invoices | store-day | higher | `agg_daily_sales.net_amount`, `v_recent_daily_sales`, `period_summary().net_amount` | Hôm nay, Ngày, Tuần, Tháng, Năm, Doanh thu & xu hướng, data pack | available now |
| `gross_revenue` | Doanh thu gộp | Gross revenue | VND | Σ `gross_amount` of non-voided invoices, before every discount | store-day | neutral | `agg_daily_sales.gross_amount`, `period_summary().gross_amount` | Khuyến mãi & giảm giá, Tháng | available now |
| `invoices` | Số hóa đơn | Invoices | count | count of non-voided invoices | store-day | higher | `agg_daily_sales.invoices`, `period_summary().invoices` | every periodic report, Hôm nay | available now |
| `avg_ticket` | Giá trị trung bình mỗi hóa đơn | Average ticket | VND | `net_revenue` ÷ `invoices` | store-period | higher | `period_summary().avg_ticket` | Hôm nay, Ngày, Tháng, Năm | available now |
| `items_per_ticket` | Số món mỗi hóa đơn | Items per ticket | items | Σ item-line quantity ÷ `invoices` | store-period | higher | `period_summary().items_per_ticket` | Ngày, Thực đơn | available now |
| `avg_item_price` | Giá trung bình mỗi món | Average item price | VND | `net_revenue` ÷ Σ item-line quantity, so that `avg_ticket` = `items_per_ticket` × `avg_item_price` exactly | store-period | neutral | `period_summary().avg_item_price` | Thực đơn, Ngày | available now |
| `cash_share` | Tỷ trọng tiền mặt | Cash share | fraction | Σ tenders whose payment method kind is `cash` ÷ Σ `paid_amount` | store-period | neutral | `period_summary().cash_share`, `agg_payment_daily` | Thanh toán & tiền mặt, Ngày | available now |
| `voucher_invoice_share` | Tỷ lệ hóa đơn dùng voucher | Voucher invoice share | fraction | invoices with `voucher_amount` > 0 or a `voucher_code` ÷ `invoices` | store-period | neutral | `period_summary().voucher_share`, `agg_daily_sales.voucher_invoices` | Khuyến mãi & giảm giá | available now |
| `member_invoice_share` | Tỷ lệ hóa đơn có thành viên | Member invoice share | fraction | invoices with a `customer_phone` ÷ `invoices`; phone only, the POS member rail (compare `customer_capture_rate`, which also counts invoices identified by `customer_id` alone) | store-period | higher | `period_summary().member_share`, `agg_daily_sales.member_invoices` | Ngày, Khách hàng, Tháng | available now |
| `discount_rate` | Tỷ lệ giảm giá | Discount rate | fraction | (item + bill + extra + voucher discounts) ÷ `gross_revenue`. **Convention: the denominator is gross**, never net, so a 10 % promotion reads as 0.10 | store-period | lower | `period_summary().discount_amount` ÷ `gross_amount` | Khuyến mãi & giảm giá, Tháng | available now |
| `attach_rate_topping` | Tỷ lệ kèm topping | Topping attach rate | fraction | invoices containing a drink and a topping ÷ invoices containing a drink; roles from `item_type_roles`; over a period Σ `topping_invoices` ÷ Σ `drink_invoices` of the measured days | store-day | higher | `agg_attach_daily.attach_rate_topping` (`topping_invoices` ÷ `drink_invoices`) | Thực đơn, Tháng | available now (null until an item type of the store's POS account carries the `topping` role, and on days without a drink invoice) |
| `attach_rate_snack` | Tỷ lệ kèm đồ ăn nhẹ | Snack attach rate | fraction | invoices containing a drink and a snack ÷ invoices containing a drink; over a period Σ `snack_invoices` ÷ Σ `drink_invoices` of the measured days | store-day | higher | `agg_attach_daily.attach_rate_snack` | Thực đơn, Tháng | available now (null until an item type of the store's POS account carries the `snack` role, and on days without a drink invoice) |
| `size_l_share` | Tỷ trọng size L | Size L share | fraction | quantity with `size_label` = L ÷ quantity of all sized items | store-period | higher | `agg_size_mix_daily` | Tháng, Thực đơn | available now |

## Time productivity

| id | Tiếng Việt | English | Unit | Formula | Grain | Direction | Source | Reports | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `sales_per_opening_hour` | Doanh thu mỗi giờ mở cửa | Sales per opening hour | VND / hour | `net_revenue` ÷ opening hours of the period from `stores.opening_hours` | store-period | higher | `agg_daily_sales` + `stores.opening_hours` | Giờ & ngày trong tuần | available now (null until opening hours are entered) |
| `invoices_per_opening_hour` | Hóa đơn mỗi giờ mở cửa | Invoices per opening hour | count / hour | `invoices` ÷ opening hours of the period | store-period | higher | `agg_daily_sales` + `stores.opening_hours` | Giờ & ngày trong tuần | available now (null until opening hours are entered) |
| `revpash` | Doanh thu mỗi ghế mỗi giờ | Revenue per available seat hour | VND / seat-hour | `net_revenue` ÷ (`stores.seat_count` × opening hours) | store-period | higher | `agg_daily_sales` + `stores.seat_count` + `stores.opening_hours` | Giờ & ngày trong tuần | needs seats |
| `peak_share_20_21` | Tỷ trọng giờ cao điểm 20–21h | Peak-hour share (20:00–21:59) | fraction | net in local hours 20 and 21 ÷ daily net | store-day | neutral | `agg_hourly_sales`, `hour_weekday_heatmap()` | Giờ & ngày trong tuần, Ngày | available now |
| `dead_hour_share_17_18` | Tỷ trọng giờ thấp điểm 17–18h | Dead-hour share (17:00–18:59) | fraction | net in local hours 17 and 18 ÷ daily net | store-day | higher | `agg_hourly_sales`, `hour_weekday_heatmap()` | Giờ & ngày trong tuần | available now |
| `weekday_share` | Tỷ trọng theo ngày trong tuần | Weekday share (one value per ISO weekday 1–7) | fraction | net of the weekday ÷ net of the week | store-week | neutral | `agg_daily_sales` + `dim_calendar.weekday` | Tuần, Năm | available now |

## Baselines and forecasts

| id | Tiếng Việt | English | Unit | Formula | Grain | Direction | Source | Reports | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `same_weekday_baseline` | Mức nền cùng ngày trong tuần | Same-weekday baseline | VND and count | medians over the same weekday of the previous 8 weeks, holidays and Tết excluded, days without data skipped: median of `net_revenue`, median of `invoices`, and median of the daily `avg_ticket` (a true median ticket, not the ratio of the two other medians) | store-day | neutral | `same_weekday_baseline()`, row `baseline` of `period_compare(…, 'day', …)` | Hôm nay, Ngày, alerts, Khuyến mãi (lift) | available now |
| `forecast_weekday_profile` | Dự báo theo đặc trưng ngày trong tuần | Weekday-profile forecast | VND | level × weekday index, both taken at the origin: the level is the mean daily net of the 28 days ending at the origin, the index the mean net of the target's weekday ÷ the mean daily net over the 84 days ending at the origin; excluded days left out of both; index 1 when the weekday has no clean day in the 84 days; the same value for every horizon from one origin. Default origin: the as-of day, or the day before the target when that is earlier | store-day | neutral | `weekday_profile_forecast()`, `month_pace().forecast_weekday_profile_net_amount` | Tháng (pace), Hôm nay | available now (null when the 28 days hold no clean day; while the window lacks some weekdays, as in a store's first four weeks, the level leans toward the weekdays present) |
| `forecast_seasonal_naive` | Dự báo mùa vụ đơn giản | Seasonal-naïve forecast | VND | net of the most recent day with sales that falls on the target's weekday, on or before the origin and at most 55 days before it (usually the last such weekday before the origin); holidays not excluded | store-day | neutral | `seasonal_naive_forecast()`, `month_pace().forecast_seasonal_naive_net_amount` | Tháng (pace) | available now (null when that weekday had no sales in the 8 weeks) |
| `forecast_mae` | Sai số dự báo tuyệt đối trung bình | Forecast mean absolute error | VND | per benchmark forecast: mean of \|actual net − forecast\| over the days of the window, each day forecast one day ahead (origin = the day before); scored only on days with sales that are not excluded and where both forecasts exist, so the two values compare like for like; `mape` beside it is the mean of \|error\| ÷ actual | store-period (trailing 28 days by default) | lower | `forecast_accuracy(store_ids, as_of_date, days)` rows `forecast_weekday_profile` and `forecast_seasonal_naive` (`sample_days`, `mae`, `mape`) | Tháng (the forecast with the lower MAE is shown first) | available now (null until a day has both forecasts, which needs a week of history) |

## Menu

| id | Tiếng Việt | English | Unit | Formula | Grain | Direction | Source | Reports | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `item_velocity` | Tốc độ bán món | Item velocity | % change | (quantity in the trailing 28 days − quantity in the 28 days before) ÷ the earlier quantity | item-period | higher | `item_velocity()` | Thực đơn, Tuần (risers and fallers) | available now |
| `menu_class` | Phân loại thực đơn | Menu class (Kasavana–Smith) | class | per item-type role over the 28 days ending `as_of_date`, across the requested stores: popular when menu mix ≥ 0.7 × (1 ÷ items in the role); high margin when the margin axis ≥ the quantity-weighted mean margin axis of the role; star (popular, high), plowhorse (popular, low), puzzle (not popular, high), dog. The axis is decided per role: contribution margin (average price − unit cost) when every item of the role has a cost, otherwise the average price for every item of the role and for its threshold, so costed and uncosted items never share one axis | item-period (28 days) | neutral | `menu_matrix()` | Thực đơn | needs costs (a role with any item lacking a cost is `provisional = true` and ranked on price); a role with fewer than 10 sold items carries `low_sample = true` and is shown with a low-sample badge, because the thresholds are unstable below about 10 items |

## Cash and adjustments

| id | Tiếng Việt | English | Unit | Formula | Grain | Direction | Source | Reports | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `cash_variance` | Chênh lệch tiền mặt | Cash variance | VND | counted drawer − expected cash (opening float + cash tenders of the shift). Payouts are not synced from the POS, so the standard term − payouts is missing: a shift with a cash payout shows the payout as a shortage until payouts are modelled | shift | lower (absolute value) | `agg_shift_cash.variance_amount` | Ca & két tiền, Ngày, Thanh toán & tiền mặt | available now |
| `cash_variance_zscore` | Điểm z chênh lệch tiền mặt | Cash variance z-score | z | (variance − mean variance of the store's shifts in the trailing 56 days) ÷ their sample standard deviation; needs 3 shifts and a non-zero spread; flagged over 2, together with the absolute (50,000 VND) and relative (0.5 % of cash sales) thresholds | shift | lower (absolute value) | `cash_variance_flags()` | Ca & két tiền, alerts | available now |
| `void_rate` | Tỷ lệ hủy hóa đơn | Void rate | fraction | voided invoices ÷ (non-voided + voided invoices); the VND figure beside it is Σ `net_amount` of the voided invoices (`voided_amount`) | store-day | lower | `agg_daily_sales.voided_invoices`, `agg_daily_sales.voided_amount` | Ca & két tiền, Chất lượng dữ liệu | available now; the cashier-period variant and the z-score ranking within a store (ADR-026) are computed by the reports layer from `invoices` and `invoice_events`, no aggregate holds a cashier |
| `edit_rate` | Tỷ lệ sửa hóa đơn | Edit rate | fraction | invoices with status `edited` ÷ non-voided invoices | store-day | lower | `agg_daily_sales.edited_invoices` | Ca & két tiền | available now; cashier-period variant and z-score ranking as for `void_rate` |
| `removed_line_rate` | Tỷ lệ dòng bị xóa | Removed-line rate | fraction | `invoice_events` of kind `line_removed` ÷ item lines of the period | store-day, cashier-period | lower | `invoice_events` (fact table; no aggregate yet) | Ca & két tiền | available now (populated once the adjustment sync of phase 7 runs; computed by the reports layer) |

## Customers and loyalty

Computed on identified customers only; `customer_capture_rate` is always shown beside them so a low capture rate is not read as a low repeat rate.

| id | Tiếng Việt | English | Unit | Formula | Grain | Direction | Source | Reports | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `customer_capture_rate` | Tỷ lệ hóa đơn định danh khách | Customer capture rate | fraction | non-voided invoices with a `customer_phone` or a `customer_id` ÷ `invoices`; an invoice identified by id alone (Zalo identity, phases 16–19) counts | store-day, store-period | higher | `agg_daily_sales.identified_invoices` ÷ `invoices`, `period_summary().identified_share` | Chất lượng dữ liệu, Khách hàng | available now |
| `repeat_rate` | Tỷ lệ khách quay lại | Repeat rate | fraction | customers with ≥ 2 visits in the window ÷ customers with ≥ 1 visit | store-period | higher | `invoices.customer_id` (fact table) | Khách hàng | needs customer identity |
| `visit_frequency_30d` | Tần suất ghé 30 ngày | Visit frequency, 30 days | visits / customer | visits ÷ active customers over the trailing 30 days | store-period | higher | `invoices.customer_id` | Khách hàng | needs customer identity |
| `visit_frequency_90d` | Tần suất ghé 90 ngày | Visit frequency, 90 days | visits / customer | visits ÷ active customers over the trailing 90 days | store-period | higher | `invoices.customer_id` | Khách hàng | needs customer identity |
| `cohort_retention` | Giữ chân theo nhóm tháng | Cohort retention | fraction | customers first seen in month c who bought in month c + k ÷ size of cohort c | cohort-month | higher | `customers.first_seen_at`, `invoices.customer_id` | Khách hàng | needs customer identity |
| `rfm_quintiles` | Phân khúc RFM | RFM quintiles | scores 1–5 | quintile rank of recency (reversed), frequency and monetary value over the trailing 365 days; 125 cells grouped into about 8 segments | customer | neutral | `invoices.customer_id` | Khách hàng | needs customer identity |
| `customer_ltv` | Giá trị vòng đời khách hàng | Customer lifetime value | VND | `avg_ticket` × visits per year × gross margin × expected lifespan in years | customer, segment | higher | `invoices`, `item_costs` | Khách hàng | needs customer identity and costs |
| `loyalty_liability` | Nợ điểm thưởng | Loyalty points liability | VND | outstanding points × value per point × (1 − expected breakage; 20 % until six months of expiry data exist) | tenant-month | lower | loyalty ledger (phase 17) | Khách hàng (loyalty P&L) | needs customer identity |
| `breakage_rate` | Tỷ lệ điểm hết hạn không dùng | Breakage rate | fraction | 1 − points redeemed ÷ points issued, by issue cohort at expiry | tenant-month | neutral | loyalty ledger (phase 17) | Khách hàng (loyalty P&L) | needs customer identity |
| `reward_cost_rate` | Tỷ lệ chi phí thưởng | Reward cost rate | fraction | value of rewards redeemed ÷ net revenue of member invoices | tenant-month | lower | loyalty ledger (phase 17) | Khách hàng (loyalty P&L) | needs customer identity |
| `member_frequency_uplift` | Mức tăng tần suất của thành viên | Member frequency uplift | fraction | member visit frequency ÷ matched non-member frequency − 1, on matched cohorts or a hold-out | tenant-period | higher | loyalty ledger (phase 17), `invoices.customer_id` | Khách hàng (loyalty P&L) | needs customer identity |

## Reading a metric

`metric_value(store_ids, metric_id, from_date, to_date)` returns one number for a metric over the given stores and business dates, read as the caller so row-level security applies. It covers every metric above whose status is `available now` and that has one value per store and period: the store-day and store-period metrics outside Baselines and forecasts, listed by `metricValueIds()` in `packages/metrics` (a test keeps that list and the SQL equal). Stores and days are summed before any ratio, so a store-day rate over a range is the ratio of the range totals; the attach rates count the measured days only, and the per-opening-hour metrics divide by the opening hours of the store-days with sales and are null when one of those stores has no opening hours. A range without synced sales returns null, as `period_compare` does. The attach rates and the size L share read aggregates without a live counterpart, so a day counts once it has been refreshed. Any other id raises `22023`: baselines, forecasts and forecast error, the weekday share and the item, shift and customer metrics come from their own functions (`docs/schema.md`).

## Period comparison

`period_compare(store_ids, grain, anchor)` returns the rows `current`, `previous` and `last_year` (and `baseline` for the day grain) with `invoices`, `net_amount`, `gross_amount`, `discount_amount`, `avg_ticket`, `items_per_ticket`, `avg_item_price`, `cash_share`, `voucher_share`, `member_share` and `identified_share`. Period boundaries:

| Grain | Current | Previous | Same period last year |
| --- | --- | --- | --- |
| `day` | the anchor day | the day before | the same weekday 52 weeks earlier (anchor − 364 days) |
| `week` | Monday of the anchor's ISO week to the anchor | the same elapsed days one week earlier | the same elapsed days 52 weeks earlier |
| `month` | the first of the anchor's month to the anchor | the same elapsed days of the previous month, clipped to its end | the same elapsed days of the same month a year earlier |
| `year` | 1 January of the anchor's year to the anchor | the same elapsed days of the previous year | identical to previous |

Every value is null when the period has no data (`days_with_data` = 0), so a young store shows "chưa có dữ liệu năm trước" instead of zero.

The `baseline` row is not a period sum. `days_with_data` is the number of eligible same-weekday days, `net_amount` the median net, `invoices` the median invoice count rounded to a whole invoice, and `avg_ticket` the median of the daily average tickets; `gross_amount`, `discount_amount`, `items_per_ticket`, `avg_item_price` and every share are null. `same_weekday_baseline()` returns the unrounded `baseline_invoices`.

## Benchmark context

Published Vietnam market figures kept apart from tenant metrics and shown as dated context only. They are survey shares and chain averages, never targets for one shop; the sources are listed in `docs/deep-dives/fnb-kpi-standards.md`.

| id | Figure | Year | Source |
| --- | --- | --- | --- |
| `ctx_fnb_revenue_2024` | F&B revenue 688,800 bn VND, +16.6 %; 323,010 outlets | 2024 | iPOS market report 2024 (published 2025-03) |
| `ctx_fnb_revenue_2025` | F&B revenue 726,500 bn VND, +5.5 %; 329,500 outlets | 2025 | iPOS market report 2025 (published 2026-04) |
| `ctx_outlets_h1_2025` | 299,900 outlets, −7.1 %; 45.3 % of outlets raised prices 5–10 % | H1 2025 | iPOS half-year report (published 2025-10) |
| `ctx_drink_price_bands_2024` | preferred drink price bands, 2023 → 2024: under 20k VND 4.3 → 12.3 %; 21–35k 29.6 → 40.0 %; 35–50k 47.7 → 31.5 %; 70k and over 7.3 → 5.1 %; 52.3 % of consumers prefer drinks under 35k | 2024 | iPOS market report 2024 |
| `ctx_drink_price_bands_2025` | drinks at 35k VND or more: 57.58 % | 2025 | iPOS market report 2025 |
| `ctx_visit_frequency_h1_2024` | 41.7 % visit cafés 1–2 times a month, 32.3 % 1–2 times a week; cups over 100k VND fell from 6 % to 1.7 % | H1 2024 | iPOS half-year report (published 2024-08) |
| `ctx_visit_frequency_2024` | the 3–4 visits a week group grew from 17.4 % to 32.8 % | 2024 | iPOS market report 2024 |
| `ctx_chain_daily_sales_2024` | a leading coffee chain: about 850 stores, roughly 15–16 m VND per store per day, same-store sales −3.7 % | 2024 | Jollibee Group annual results, cafef.vn (2025-03) |
| `ctx_chain_daily_sales_2025` | a leading tea chain: 1,891 bn VND revenue, +17 %; like-for-like 22.8 m VND per store per day; delivery over 31 % of retail revenue | 2025 | znews.vn (2026-01), vnexpress.net (2026-10, Q3 2026 like-for-like 24.8 m VND) |
| `ctx_food_delivery_gmv_2025` | food delivery GMV US$2.1 bn, +19 %; two platforms hold about 95 % | 2025 | theinvestor.vn (2026-01) |

## Keeping this file current

A metric is added here first, then to `packages/metrics` and the SQL; the lint in phase 8 checks that every id in `packages/metrics` has a Vietnamese and an English label, a unit, a formula, a grain, a direction and at least one report. The Vietnamese labels are to be reviewed by the owner (roadmap phase 9).
