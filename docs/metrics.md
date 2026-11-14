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
| `net_revenue` | Doanh thu thuần | Net revenue | VND | Σ `net_amount` of non-voided invoices | store-day | higher | `agg_daily_sales.net_amount`, `v_recent_daily_sales`, `period_summary().net_amount` | Hôm nay, Ngày, Tuần, Tháng, Năm, Doanh thu & xu hướng, data pack, So sánh cửa hàng | available now |
| `gross_revenue` | Doanh thu gộp | Gross revenue | VND | Σ `gross_amount` of non-voided invoices, before every discount | store-day | neutral | `agg_daily_sales.gross_amount`, `period_summary().gross_amount` | Khuyến mãi & giảm giá, Ngày, Tháng | available now |
| `invoices` | Số hóa đơn | Invoices | count | count of non-voided invoices | store-day | higher | `agg_daily_sales.invoices`, `period_summary().invoices` | every periodic report, Hôm nay, Doanh thu & xu hướng, So sánh cửa hàng | available now |
| `avg_ticket` | Giá trị trung bình mỗi hóa đơn | Average ticket | VND | `net_revenue` ÷ `invoices` | store-period | higher | `period_summary().avg_ticket` | Hôm nay, Ngày, Tuần, Tháng, Năm, Doanh thu & xu hướng, So sánh cửa hàng | available now |
| `items_per_ticket` | Số món mỗi hóa đơn | Items per ticket | items | Σ item-line quantity ÷ `invoices` | store-period | higher | `period_summary().items_per_ticket` | Ngày, Tuần, Tháng, Năm, Thực đơn, Doanh thu & xu hướng, So sánh cửa hàng | available now |
| `avg_item_price` | Giá trung bình mỗi món | Average item price | VND | `net_revenue` ÷ Σ item-line quantity, so that `avg_ticket` = `items_per_ticket` × `avg_item_price` exactly | store-period | neutral | `period_summary().avg_item_price` | Thực đơn, Ngày, Tuần, Tháng, Năm, Doanh thu & xu hướng, So sánh cửa hàng | available now |
| `cash_share` | Tỷ trọng tiền mặt | Cash share | fraction | Σ tenders whose payment method kind is `cash` ÷ Σ `paid_amount` | store-period | neutral | `period_summary().cash_share`, `agg_payment_daily` | Thanh toán & tiền mặt, Ngày, Tháng, So sánh cửa hàng | available now |
| `voucher_invoice_share` | Tỷ lệ hóa đơn dùng voucher | Voucher invoice share | fraction | invoices with `voucher_amount` > 0 or a `voucher_code` ÷ `invoices` | store-period | neutral | `period_summary().voucher_share`, `agg_daily_sales.voucher_invoices` | Khuyến mãi & giảm giá, Ngày, Tuần, Tháng | available now |
| `member_invoice_share` | Tỷ lệ hóa đơn có thành viên | Member invoice share | fraction | invoices with a `customer_phone` ÷ `invoices`; phone only, the POS member rail (compare `customer_capture_rate`, which also counts invoices identified by `customer_id` alone) | store-period | higher | `period_summary().member_share`, `agg_daily_sales.member_invoices` | Ngày, Khách hàng, Tháng | available now |
| `discount_rate` | Tỷ lệ giảm giá | Discount rate | fraction | (item + bill + extra + voucher discounts) ÷ `gross_revenue`. **Convention: the denominator is gross**, never net, so a 10 % promotion reads as 0.10 | store-period | lower | `period_summary().discount_amount` ÷ `gross_amount` | Khuyến mãi & giảm giá, Ngày, Tuần, Tháng | available now |
| `attach_rate_topping` | Tỷ lệ kèm topping | Topping attach rate | fraction | invoices containing a drink and a topping ÷ invoices containing a drink; roles from `item_type_roles`; over a period Σ `topping_invoices` ÷ Σ `drink_invoices` of the measured days | store-day | higher | `agg_attach_daily.attach_rate_topping` (`topping_invoices` ÷ `drink_invoices`) | Thực đơn, Tháng | available now (null until an item type of the store's POS account carries the `topping` role, and on days without a drink invoice) |
| `attach_rate_snack` | Tỷ lệ kèm đồ ăn nhẹ | Snack attach rate | fraction | invoices containing a drink and a snack ÷ invoices containing a drink; over a period Σ `snack_invoices` ÷ Σ `drink_invoices` of the measured days | store-day | higher | `agg_attach_daily.attach_rate_snack` | Thực đơn, Tháng | available now (null until an item type of the store's POS account carries the `snack` role, and on days without a drink invoice) |
| `size_l_share` | Tỷ trọng size L | Size L share | fraction | quantity with `size_label` = L ÷ quantity of all sized items | store-period | higher | `agg_size_mix_daily` | Tháng, Thực đơn | available now |

## Time productivity

| id | Tiếng Việt | English | Unit | Formula | Grain | Direction | Source | Reports | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `sales_per_opening_hour` | Doanh thu mỗi giờ mở cửa | Sales per opening hour | VND / hour | `net_revenue` ÷ opening hours of the period from `stores.opening_hours` | store-period | higher | `agg_daily_sales` + `stores.opening_hours` | Giờ & ngày trong tuần, So sánh cửa hàng | available now (null until opening hours are entered) |
| `invoices_per_opening_hour` | Hóa đơn mỗi giờ mở cửa | Invoices per opening hour | count / hour | `invoices` ÷ opening hours of the period | store-period | higher | `agg_daily_sales` + `stores.opening_hours` | Giờ & ngày trong tuần, So sánh cửa hàng | available now (null until opening hours are entered) |
| `revpash` | Doanh thu mỗi ghế mỗi giờ | Revenue per available seat hour | VND / seat-hour | `net_revenue` ÷ (`stores.seat_count` × opening hours) | store-period | higher | `agg_daily_sales` + `stores.seat_count` + `stores.opening_hours` | Giờ & ngày trong tuần, So sánh cửa hàng | needs seats |
| `peak_share_20_21` | Tỷ trọng giờ cao điểm 20–21h | Peak-hour share (20:00–21:59) | fraction | net in local hours 20 and 21 ÷ daily net | store-day | neutral | `agg_hourly_sales`, `hour_weekday_heatmap()` | Giờ & ngày trong tuần, Ngày | available now |
| `dead_hour_share_17_18` | Tỷ trọng giờ thấp điểm 17–18h | Dead-hour share (17:00–18:59) | fraction | net in local hours 17 and 18 ÷ daily net | store-day | higher | `agg_hourly_sales`, `hour_weekday_heatmap()` | Giờ & ngày trong tuần | available now |
| `peak_share_top_hours` | Tỷ trọng giờ cao điểm | Peak-hour share (top hours) | fraction | net of the `peak_hours` hours with the largest net ÷ net of the range | store-period | neutral | `hour_profile()` (`all` summary, `peak_share`) | Giờ & ngày trong tuần | available now |
| `dead_hour_share` | Tỷ trọng giờ thấp điểm | Quiet-hour share | fraction | net of the hours below `dead_hour_ratio` × the mean hour of the open span ÷ net of the range | store-period | neutral | `hour_profile()` (`all` summary, `dead_share`) | Giờ & ngày trong tuần | available now |
| `weekday_share` | Tỷ trọng theo ngày trong tuần | Weekday share (one value per ISO weekday 1–7) | fraction | net of the weekday ÷ net of the week | store-week | neutral | `agg_daily_sales` + `dim_calendar.weekday` | Tuần, Năm, Giờ & ngày trong tuần | available now |

## Baselines and forecasts

| id | Tiếng Việt | English | Unit | Formula | Grain | Direction | Source | Reports | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `same_weekday_baseline` | Mức nền cùng ngày trong tuần | Same-weekday baseline | VND and count | medians over the same weekday of the previous 8 weeks, holidays and Tết excluded, days without data skipped: median of `net_revenue`, median of `invoices`, and median of the daily `avg_ticket` (a true median ticket, not the ratio of the two other medians) | store-day | neutral | `same_weekday_baseline()`, row `baseline` of `period_compare(…, 'day', …)` | Hôm nay, Ngày, Tuần, Tháng, alerts, Khuyến mãi (lift) | available now |
| `forecast_weekday_profile` | Dự báo theo đặc trưng ngày trong tuần | Weekday-profile forecast | VND | level × weekday index, both taken at the origin: the level is the mean daily net of the 28 days ending at the origin, the index the mean net of the target's weekday ÷ the mean daily net over the 84 days ending at the origin; excluded days left out of both; index 1 when the weekday has no clean day in the 84 days; the same value for every horizon from one origin. Default origin: the as-of day, or the day before the target when that is earlier | store-day | neutral | `weekday_profile_forecast()`, `month_pace().forecast_weekday_profile_net_amount` | Tháng (pace), Hôm nay | available now (null when the 28 days hold no clean day; while the window lacks some weekdays, as in a store's first four weeks, the level leans toward the weekdays present) |
| `forecast_seasonal_naive` | Dự báo mùa vụ đơn giản | Seasonal-naïve forecast | VND | net of the most recent day with sales that falls on the target's weekday, on or before the origin and at most 55 days before it (usually the last such weekday before the origin); holidays not excluded | store-day | neutral | `seasonal_naive_forecast()`, `month_pace().forecast_seasonal_naive_net_amount` | Tháng (pace) | available now (null when that weekday had no sales in the 8 weeks) |
| `forecast_mae` | Sai số dự báo tuyệt đối trung bình | Forecast mean absolute error | VND | per benchmark forecast: mean of \|actual net − forecast\| over the days of the window, each day forecast one day ahead (origin = the day before); scored only on days with sales that are not excluded and where both forecasts exist, so the two values compare like for like; `mape` beside it is the mean of \|error\| ÷ actual | store-period (trailing 28 days by default) | lower | `forecast_accuracy(store_ids, as_of_date, days)` rows `forecast_weekday_profile` and `forecast_seasonal_naive` (`sample_days`, `mae`, `mape`) | Tháng (the forecast with the lower MAE is shown first) | available now (null until a day has both forecasts, which needs a week of history) |

## Menu

| id | Tiếng Việt | English | Unit | Formula | Grain | Direction | Source | Reports | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `item_velocity` | Tốc độ bán món | Item velocity | % change | (quantity in the trailing 28 days − quantity in the 28 days before) ÷ the earlier quantity | item-period | higher | `item_velocity()` | Thực đơn, Tuần (risers and fallers) | available now |
| `menu_class` | Phân loại thực đơn | Menu class (Kasavana–Smith) | class | per item-type role over the 28 days ending `as_of_date`, across the requested stores: popular when menu mix ≥ 0.7 × (1 ÷ items in the role); high margin when the margin axis ≥ the quantity-weighted mean margin axis of the role; star (popular, high), plowhorse (popular, low), puzzle (not popular, high), dog. The axis is decided per role: contribution margin (average price − unit cost) when every item of the role has a cost, otherwise the average price for every item of the role and for its threshold, so costed and uncosted items never share one axis | item-period (28 days) | neutral | `menu_matrix()`; `menu_engineering()` for the thematic reports (tenant thresholds, effective categories, costs by business date) | Thực đơn | needs costs (a role with any item lacking a cost is `provisional = true` and ranked on price); a role with fewer than 10 sold items carries `low_sample = true` and is shown with a low-sample badge, because the thresholds are unstable below about 10 items |
| `gross_margin_rate` | Biên lợi nhuận gộp món | Item gross margin rate | fraction | (net of the costed store-days − their cost) ÷ net of the costed store-days, each store-day costed on its business date | store-period, item-period | higher | `item_margins()` (`margin_rate`) | Thực đơn | needs costs |
| `cost_coverage` | Tỷ trọng doanh thu món có giá vốn | Costed share of item revenue | fraction | net of the item store-days with a cost on their business date ÷ item net | store-period | higher | `item_margins()` (`cost_coverage`) | Thực đơn, Chất lượng dữ liệu | available now |

## Cash and adjustments

| id | Tiếng Việt | English | Unit | Formula | Grain | Direction | Source | Reports | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `cash_variance` | Chênh lệch tiền mặt | Cash variance | VND | counted drawer − expected cash (opening float + cash tenders of the shift). Payouts are not synced from the POS, so the standard term − payouts is missing: a shift with a cash payout shows the payout as a shortage until payouts are modelled | shift | lower (absolute value) | `agg_shift_cash.variance_amount` | Ca & két tiền, Ngày, Tháng, Thanh toán & tiền mặt | available now |
| `cash_variance_zscore` | Điểm z chênh lệch tiền mặt | Cash variance z-score | z | (variance − mean variance of the store's shifts in the trailing 56 days) ÷ their sample standard deviation; needs 3 shifts and a non-zero spread; flagged over 2, together with the tenant's absolute and relative thresholds from `report_settings` (by default 50,000 VND and 0.5 % of cash sales) | shift | lower (absolute value) | `cash_variance_flags()`; reports read `shift_review()`, and `cash_variance_flags()` applies the same tenant thresholds | Ca & két tiền, Ngày, Tháng, alerts, Thanh toán & tiền mặt | available now |
| `void_rate` | Tỷ lệ hủy hóa đơn | Void rate | fraction | voided invoices ÷ (non-voided + voided invoices); the VND figure beside it is Σ `net_amount` of the voided invoices (`voided_amount`) | store-day | lower | `agg_daily_sales.voided_invoices`, `agg_daily_sales.voided_amount` | Chất lượng dữ liệu | available now; the cashier-period variant and the z-score ranking within a store (ADR-026) are computed by the reports layer from `invoices` and `invoice_events`, no aggregate holds a cashier; POS sources whose sales report leaves voided sales out understate it, and the shift view is `shift_void_rate` |
| `edit_rate` | Tỷ lệ sửa hóa đơn | Edit rate | fraction | invoices with status `edited` ÷ non-voided invoices | store-day | lower | `agg_daily_sales.edited_invoices` | Ca & két tiền | available now; cashier-period variant and z-score ranking as for `void_rate` |
| `removed_line_rate` | Tỷ lệ dòng bị xóa | Removed-line rate | fraction | `invoice_events` of kind `line_removed` ÷ item lines of the period | store-day, cashier-period, shift | lower | `invoice_events` (fact table; no aggregate yet) | Ca & két tiền | available now (populated once the adjustment sync of phase 7 runs; computed by the reports layer) |
| `payment_fee_estimate` | Phí thanh toán ước tính | Estimated payment fees | VND | Σ over payments of amount × the fee rate in force on the business date, plus its fixed fee | store-period | lower | `payment_summary()` (`fee_estimate_amount`) | Thanh toán & tiền mặt | available now; null until a fee rate exists |
| `shift_void_rate` | Tỷ lệ hủy theo ca | Shift void rate | fraction | void events ÷ (orders + void events) of the shift | shift | lower | `shift_adjustments()` (`void_rate`) | Ca & két tiền | available now; the function comes with phase 10b |
| `shift_void_rate_zscore` | Điểm z tỷ lệ hủy theo ca | Shift void rate z-score | z | (shift void rate − mean of the store's shifts in the trailing 56 days) ÷ their sample standard deviation | shift | lower | `shift_adjustments()` (`void_z_score`) | Ca & két tiền | available now; the function comes with phase 10b |
| `removed_line_rate_zscore` | Điểm z tỷ lệ xóa món | Removed-line rate z-score | z | (shift removed-line rate − mean of the store's shifts in the trailing 56 days) ÷ their sample standard deviation | shift | lower | `shift_adjustments()` (`removed_z_score`) | Ca & két tiền | available now; the function comes with phase 10b |
| `edits_after_close` | Sửa sau khi đóng ca | Edits after close | count | adjustment events of any kind on the shift's invoices recorded at or after the shift closed | shift | lower | `shift_adjustments()` (`edits_after_close`) | Ca & két tiền | available now; the function comes with phase 10b |

## Promotions and compliance

| id | Tiếng Việt | English | Unit | Formula | Grain | Direction | Source | Reports | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `promo_lift` | Doanh thu gộp tăng thêm nhờ khuyến mãi | Promotion gross lift | VND | difference-in-differences of gross revenue on the promotion days against the chosen comparator | store-period | higher | `promotion_lift()` (`gross_lift`) | Khuyến mãi & giảm giá | available now; the function comes with phase 10b |
| `promo_net_lift` | Lãi ròng từ khuyến mãi | Promotion net lift | VND | gross lift − discount cost of the promotion days | store-period | higher | `promotion_lift()` (`net_lift`) | Khuyến mãi & giảm giá | available now; the function comes with phase 10b |
| `discount_days` | Số ngày giảm giá bán trong năm | Discount days in the year | count | days from 1 January to the as-of date on which the item sold below its list price or under a bill discount (gift and voucher days left out) | item-period | neutral | `item_discount_days()` (`price_discount_days`) | Khuyến mãi & giảm giá | available now; the function comes with phase 10b |

## Data quality

| id | Tiếng Việt | English | Unit | Formula | Grain | Direction | Source | Reports | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `modifier_line_share` | Tỷ trọng dòng tùy chọn | Modifier line share | fraction | modifier lines ÷ (item lines + modifier lines) of non-voided invoices | store-period | neutral | `data_quality_summary()` | Chất lượng dữ liệu | available now; the function comes with phase 10b |
| `consent_coverage` | Tỷ lệ khách định danh có đồng ý tích điểm | Consent coverage of identified customers | fraction | identified customers with a loyalty consent ÷ identified customers | store-period | higher | `data_quality_summary()` | Chất lượng dữ liệu | needs customer identity; the function comes with phase 10b |

## Customers and loyalty

Computed on identified customers only; `customer_capture_rate` is always shown beside them so a low capture rate is not read as a low repeat rate.

| id | Tiếng Việt | English | Unit | Formula | Grain | Direction | Source | Reports | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `customer_capture_rate` | Tỷ lệ hóa đơn định danh khách | Customer capture rate | fraction | non-voided invoices with a `customer_phone` or a `customer_id` ÷ `invoices`; an invoice identified by id alone (Zalo identity, phases 16–19) counts | store-day, store-period | higher | `agg_daily_sales.identified_invoices` ÷ `invoices`, `period_summary().identified_share` | Chất lượng dữ liệu, Khách hàng, Ngày, So sánh cửa hàng | available now |
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

`metric_value(store_ids, metric_id, from_date, to_date)` returns one number for a metric over the given stores and business dates, read as the caller so row-level security applies. It covers every metric above whose status is `available now` and that has one value per store and period: the store-day and store-period metrics outside Baselines and forecasts, listed by `metricValueIds()` in `packages/metrics` (a test keeps that list and the SQL equal). Stores and days are summed before any ratio, so a store-day rate over a range is the ratio of the range totals; the attach rates count the measured days only, and the per-opening-hour metrics divide by the opening hours of the store-days with sales and are null when one of those stores has no opening hours. A range without synced sales returns null, as `period_compare` does. The attach rates and the size L share read aggregates without a live counterpart, so a day counts once it has been refreshed. Any other id raises `22023`: baselines, forecasts and forecast error, the weekday share and the item, shift and customer metrics come from their own functions (`docs/schema.md`). A metric whose Source names its own SQL function is read from that function and is never computed by `metric_value` (`ownFunctions` in `packages/metrics`): the hour shares from `hour_profile`, the margin and cost coverage from `item_margins`, the fee estimate from `payment_summary`, the shift adjustments from `shift_adjustments`, the promotion lift from `promotion_lift`, the discount days from `item_discount_days` and the data-quality shares from `data_quality_summary`. `peak_share_top_hours` and `dead_hour_share`, for range views, supersede `peak_share_20_21` and `dead_hour_share_17_18`, which keep their definition because Ngày and the digest read them (`supersededBy`).

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

## Report conventions

The periodic reports Ngày, Tuần, Tháng and Năm (roadmap phase 9) take every number from the report functions of `docs/schema.md` (section Report functions), or from their parity-tested TypeScript port in demo mode, and build their cards in `@fnb/reports`. These rules hold for every card.

### Period and as-of day

- A report ends at the last complete business day of the selected stores, `app.analytics_as_of(store_ids)` in SQL and `asOfDate()` in TypeScript. Today belongs to Hôm nay; Ngày opens on yesterday.
- Ngày is one business day; Tuần an ISO week from Monday to Sunday, key `YYYY-Www`; Tháng a calendar month, key `YYYY-MM`; Năm a calendar year, key `YYYY`. A running week, month or year ends at the as-of day, and every comparison of it covers the same elapsed days, with the boundaries of `period_compare` (section Period comparison).

### Coverage and like-for-like

- A store's history starts at `history_start` = the later of `stores.opened_on` and its first day with sales; when only one of them is known, that one.
- A store is covered for a reference period starting on `from` when its history starts on or before `from`.

| Coverage of the selected stores | The comparison |
| --- | --- |
| every store covered | current and reference over all selected stores |
| some stores covered | current and reference both over the covered stores only, labelled "cùng cửa hàng (k/N)" |
| no store covered | none: "chưa có dữ liệu năm trước" (or "kỳ trước") when a selected store started after `from`, otherwise no data |

- The median same-weekday baseline is never like-for-like. It needs one eligible day; with fewer than eight the label shows "(k/8 tuần)".
- A card's figures are verified when every selected store has no unmatched and no unchecked sales day in the report's range (`sync_checks`); otherwise they are marked unverified. Demo figures are marked as sample data.
- Cards that read item, payment, shift, size or attach aggregates show "đang cập nhật" while a day from yesterday onwards has aggregates that disagree with its live totals (`store_coverage.stale_days`).
- Several stores are summed before any ratio, and a figure whose input is not configured or not measured is null, never 0.

### Comparisons per report

| Report | Comparisons |
| --- | --- |
| Ngày | the previous day; the same weekday 52 weeks earlier (day − 364); the median same-weekday baseline of the previous 8 weeks, holidays and Tết excluded |
| Tuần | last week over the same elapsed days; the 4-week average; the same week 52 weeks earlier |
| Tháng | the previous month over the same elapsed days, clipped to its end; the same month a year earlier; the two month forecasts as pace, the one with the lower forecast error first; the monthly target |
| Năm | last year to date over the same elapsed days; each month against the same month a year earlier over the stores covered then; month on month over complete months; the latest three complete months against the three before |

`change` = (current − reference) ÷ reference, null when either value is null or the reference is 0. A fraction (a share or a rate) is compared as the difference in percentage points.

### Decomposition

Revenue V is invoices N × average ticket T, and T is items per ticket I × average item price P, each taken unrounded from the SQL sums of the same stores and basis as the comparison (T = V ÷ N, I = Q ÷ N, P = V ÷ Q with Q the items sold). Index 0 is the reference, 1 the current period.

| Part | Revenue effect | Ticket effect |
| --- | --- | --- |
| invoices | round((N1 − N0) × (T0 + T1) ÷ 2) | — |
| items per ticket | round((I1 − I0) × (P0 + P1) ÷ 2 × (N0 + N1) ÷ 2) | round2((I1 − I0) × (P0 + P1) ÷ 2) |
| average item price | the total minus the other parts | the total minus the items part |
| total | round(V1 − V0) | round2(T1 − T0) |

The parts add up exactly to the total shown: the decomposition line shows every amount in full, and the ticket split is shown at the currency's precision (whole đồng) with the item price part as the remainder of the shown total. A net revenue or average ticket card decomposes against the previous period, and against last year when the previous period is unavailable; Năm always decomposes against last year. Nothing is decomposed against the median baseline, because medians do not multiply. There is no decomposition when an input is null or when invoices or items are 0 on either side.

### Sentences

- A main clause compares the headline with one reference; when that comparison is like-for-like, the next clause gives the covered stores' figures ("Mức so sánh chỉ tính k/N cửa hàng có đủ dữ liệu: … so với …").
- A driver clause names the candidate with the largest contribution, and says it went against the trend only after a rising or falling main clause; no driver follows a main clause whose reference is missing.
- A decomposition clause measured against the main clause's reference says "Phần lớn do …" after a rising or falling clause; one measured against another reference (Ngày compares with the baseline but decomposes against the day before) names that reference and the difference ("Chênh lệch … so với hôm trước phần lớn do …").

### 4-week average (Tuần)

- Week k (k = 1 to 4) is the same elapsed days of the week k weeks earlier.
- The stores are those covered on the Monday four weeks earlier.
- A week whose compared days hold a Tết day is skipped (`SKIP_TET_WEEKS`). With fewer than two weeks left there is no reference; the label shows how many weeks were used.
- Net and invoices are the mean, over the weeks left, of the covered stores' sums; a covered store-day without data counts 0. The average ticket is pooled: Σ net ÷ Σ invoices of those weeks.

### Peak month (Năm)

The peak month is the complete month of the year (its last day on or before the as-of day) with the highest net over all selected stores. With no complete month yet, it is the latest month, marked partial (`PEAK_COMPLETE_MONTHS_ONLY`).

### Seasonality index (Năm)

- The window is the 12 complete months ending with the latest complete month on or before the end of the period (`SEASONALITY_MONTHS`), over the stores covered at its first day.
- The average daily net of month m is the covered stores' net of m ÷ the calendar days of m; its index is that average ÷ the mean of the 12 averages. With fewer than 12 covered months the card says "chưa đủ 12 tháng".
- The Tết dip of a year is the net per calendar day of its week with the most Tết days ÷ the mean net per calendar day of the four weeks before, minus 1; all five weeks need sales. For whole weeks this equals the week's net ÷ the mean net of the four weeks, minus 1; dividing by calendar days keeps a week clipped by the start of the weekly series (for example the 5-day first bucket of 2025) from pulling the mean down.
- The seasonality card's peak is the window month with the highest index, over the covered stores. It can differ from the peak month above, which ranks the months of the year by their net over all selected stores.

### Item lifecycle statuses (Năm)

The first status that applies, with `QUIET_DAYS` = 56, `LIFECYCLE_CHANGE` = 0.2 and `MIN_LIFECYCLE_QUANTITY` = 10:

| Status | Rule |
| --- | --- |
| new | first sold on or after 1 January of the year |
| discontinued | last sold more than 55 days before the end of the period, and on or after 1 January of last year |
| growing | at least 10 units last year to date, and this year to date at least 1.2 times that |
| declining | at least 10 units last year to date, and this year to date at most 0.8 times that |
| steady | any other item sold this year |

Items last sold before 1 January of last year are left out. Year to date and last year to date follow the year rule of `period_compare`.

### Since-opening weeks (Năm)

- A store is young for Năm when its history starts later than 364 days before the end of the period; it then has no year-over-year comparison and shows "chưa có dữ liệu năm trước".
- For a young store, week k since opening covers history start + 7(k − 1) to history start + 7k − 1 and is complete when it ends on or before the end of the period. Its average per day is the week's net ÷ its days with data; growth is the latest complete week against week 1.

## Thematic report conventions

The thematic reports of phase 10 (`#/chu-de/…`, ADR-035) read the same SQL as the periodic reports, over a date range instead of a calendar period.

Thực đơn classes the menu over the menu window that ends on the range's last day (`menu_window_days`, 28 by default, with the popularity factor and the low-sample minimum from the tenant's report settings), store by store, so its matrix does not follow the length of the range. Costs apply from their `effective_from` date: each store-day is costed at the cost in force on its business date, a store's own cost before the tenant-wide one, and before an item's first cost the item has none, so its margin covers only the costed days (`cost_coverage`).

Its attach rates and pairs cover the last `min(range days, 92)` days of the range, the limit of `item_attach` and `basket_pairs`, and compare with as many days just before. An item line takes the role of its effective type on the invoice's POS account, so a store whose account maps no topping (or snack) type counts for neither side of that rate, and a role that no selected account maps leaves the rate null (shown "—" with the roles action), as `agg_attach_daily` does. Movers use Tuần's thresholds on the range and the previous one: an item needs at least 10 sold in the previous range to rise or fall (and 10 in this one to rise), and a new item at least 10. Sugar and ice levels are modifier names grouped by `classifyModifier` (`đường`, `ngọt`, `sugar`; the whole words `đá`, `ice`); each level's share is within its kind, and other options are listed apart. When only some selected stores have history at a reference's first day, the size and attach chips (and the sentences built on them) and the movers use those stores only; the size table and its driver keep every selected store, as on Tháng.

Thanh toán's cash trend buckets the range by day up to 35 days and by week (from Monday) beyond. Its warning compares whole weeks, so the weekdays on both sides match: with day buckets the last k weeks against the k weeks before (k the largest whole number of weeks that fits twice, at least 2), with week buckets the later half of the full weeks against the earlier half (at least 2 a side; a week cut by the range's edge is left out). On each side the cash share is Σ cash ÷ Σ paid and the net revenue per day is Σ net ÷ calendar days, so a store that opens inside the range adds revenue rather than lowering the day's average. It fires when the cash share rose by at least 1 point and the net per day fell by at least 5 %, the signal of KPI deep dive §5. When a selected store's data starts after the first bucket, the card does not compare the first bucket with the last.

A share's change that would read 0.0 points (under 0.05 points) is "about the same" in every sentence, whatever its relative size.

### Ranges and references

- A range is a preset (7, 28, 91 or 364 days; this month; last month; this year) or two dates, and ends at the as-of day. It covers at most 400 days (the limit of `store_coverage`); a longer request keeps its last 400 days.
- Rolling presets and custom ranges compare with the range of equal length just before and with the range shifted 364 days (the same weekdays). This month and last month compare month with month as `period_bounds` does; 364 days and this year have one reference only, because the range before is last year.
- A store counts for a reference when its history starts on or before the reference's first day, as in "Coverage and like-for-like" above; partly covered references compare the covered stores (`range_totals` over those stores).

### Hour profile

- `hour_profile` places each hour after the first selected store's business-day start and fills the open span (the first to the last hour with sales) with zeros where nothing sold, so an empty hour inside the day counts as quiet.
- Over all days, the `peak_hours` hours with the largest net (3 by default; ties go to the earlier hour) are peak, and an hour whose mean net per day is below `dead_hour_ratio` (0.5) times the span's mean hour is quiet. `peak_share_top_hours` and `dead_hour_share` are their shares of the range's net.
- Monday to Friday and the weekend are levelled by invoices per day: busy at `busy_hour_ratio` (1.25) times the span's mean hour or more, quiet below `dead_hour_ratio` times it. Consecutive busy hours form the suggested shift windows; staff are not counted.
- The thresholds are the tenant's report settings (ADR-036); comparisons use unrounded values.

### Opening hours and seats

Per-opening-hour values use the store's opening hours from settings, split and overnight spans included (`app.opening_minutes`), and are null while a store with sales has none. RevPASH divides net revenue by seats × opening hours and is null while a store with sales has no seat count.

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
