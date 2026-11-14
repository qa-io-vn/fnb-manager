# Tháng — the monthly report

Route `#/bao-cao/thang?month=YYYY-MM[&store=<id>,<id>]` · title "Báo cáo tháng" · built in phase 9 (step 9c) on the Ngày reference (`docs/reports/ngay.md`).

Tháng follows one calendar month: where the month to date stands against the same days of last month and of last year, where the two benchmark forecasts say the month will end and how far that is from the target, how the days, the menu, the sizes, the add-ons, the payment methods, the discounts and the cash drawers behaved. A running month ends at the as-of day; Hôm nay owns the running day.

## Period

- `M1` is the first day of the month and `Me` the period's end: the last day of the month, or the as-of day (the earliest store business date of now, minus one) while the month is running. The navigator then shows "đến hết ngày {Me}".
- The previous month runs from `P1` (its first day) to `PE` (its last day). Its comparison window is `P1` to `Pe = min(P1 + (Me − M1), PE)`, the same elapsed days clipped to its end: on 31 March the comparison is 1 to 28 February.
- Last year is the same elapsed days of the same month a year earlier, with the boundaries of `period_compare` (`docs/metrics.md`, "Report conventions").
- A month after the as-of month shows the as-of month with the clamp notice; previous and next step one month, and next is disabled on the as-of month. "Chọn ngày" opens the month of any date from 2023-01-01 to the as-of day.
- `S` is the selected stores. With several stores every figure is the sum of the stores before any ratio.

## Calls

All numbers come from SQL (`docs/schema.md`, "Report functions (phase 9)" and "Query functions"); the demo runs the parity-tested port in `@fnb/demo-analytics` (`month-pace.ts`, `forecast-accuracy.ts` and `forecast-series-helpers.ts` port `month_pace`, `forecast_accuracy`, `app.daily_net_series`, `app.weekday_profile` and `app.seasonal_naive_series`).

| Key | Call |
|---|---|
| `coverage` | `store_coverage(S, M1, Me)` |
| `compare` | `period_compare_by_store(S, 'month', Me)` — all stores, then each store; rows current, previous and last year |
| `pace` | `month_pace(S, M1, Me)` |
| `accuracy` | `forecast_accuracy(S, Me, 28)` |
| `days` | `period_series(S, 'day', M1, Me)` |
| `months` | `period_series(S, 'month', P1, Me)` — the whole previous month and the month to date |
| `baselines` | `daily_baselines(S, M1, Me, 8)` |
| `items` | `item_summary(S, M1, Me, P1, Pe)` |
| `metrics` | `metric_compare(S, ['size_l_share', 'attach_rate_topping', 'attach_rate_snack', 'discount_rate', 'voucher_invoice_share', 'gross_revenue', 'cash_share'], 'month', Me)` |
| `payments` | `payment_summary(S, M1, Me, P1, Pe)` |
| `promotions` | `promotion_summary(S, M1, Me)` |
| `shifts` | `shift_review(S, M1, Me)` |
| `shiftsPrevious` | `shift_review(S, P1, Pe)` |
| `targets` | `store_targets(S, 'month', M1)` |
| `pace.<store>` | `month_pace([store], M1, Me)` for each store, only when two or more stores are selected (read by the target card) |
| follow-ups | when only some stores have history at `P1` or at the start of last year's month: `period_compare` and `metric_compare` over the covered stores (`compareLfl.*`, `metricsLfl.*`); when only some stores have history at `P1`: `itemsCovered` = `item_summary(covered, M1, Me, P1, Pe)` and `paceCovered.<store>` = `month_pace([store], M1, Me)` for each covered store, which the forecast chips sum. Identical calls planned under two keys share one query |

Coverage: a store counts for a reference period when its history starts on or before the period's first day.

## Forecasts

`month_pace` adds to the month to date the forecast of each remaining day, by two benchmark methods of `docs/metrics.md`:

- **Dự báo theo đặc trưng ngày trong tuần** (`forecast_weekday_profile`): the mean daily net of the 28 days up to the as-of day × the index of the target's weekday over the 84 days up to it, holidays and Tết left out.
- **Dự báo mùa vụ đơn giản** (`forecast_seasonal_naive`): the net of the latest same weekday with sales in the 56 days up to the as-of day.

A method gives no total when one remaining day has no forecast. `forecast_accuracy(S, Me, 28)` scores both one day ahead over the last 28 days (`mae`, `mape`, scored days); the method with the lower MAE is shown first everywhere (chips, table rows, chart lines, sentences), and on a tie or without a score the weekday profile comes first. A complete month has no forecast: its rows, chips and lines are left out.

## Cards

Each card has a headline, comparison chips, a sentence, a table with a CSV download (UTF-8 with BOM, file `thang-<card>-<YYYY-MM>.csv`, a second table `…-2.csv`) and "Giải thích chỉ số". Shares and rates compare in percentage points ("−4,4 điểm %"), everything else as a relative change.

| Card | Headline | Chips | Sentence | Table and chart |
|---|---|---|---|---|
| Doanh thu tháng đến nay và nhịp tháng (`month_pace`) | net revenue of the month to date | the same days of last month; the same days last year (like for like when only some stores have that history); each forecast against the whole of last month, the lower MAE first | the month to date against last month, then the young-store note, or, when last month is like for like, "Mức so sánh chỉ tính k/N cửa hàng có đủ dữ liệu: … so với …"; then "Cả tháng dự kiến đạt … theo {forecast}"; a complete month reads "Tháng … khép lại với …" and names the larger part of the change (invoices, items per ticket or average item price) | rows this month, the same days of last month, the same days last year, the whole of last month, each forecast with MAE, MAPE and scored days, and the monthly target when every selected store has one; the cumulative net by day over the whole month with a line at each forecast and the target. The change against last month is decomposed into invoices × items per ticket × average item price |
| Xu hướng theo ngày (`daily_trend`) | mean net per date with sales | — | the best and the weakest day against the median same-weekday baseline (ties to the earlier date), and a note when one of them was a holiday | date, weekday, net, invoices, baseline, deviation, holiday, and "Đóng cửa" for a checked day without sales; bars per day (holidays in grey) with the baseline line, Tết shaded |
| Pareto món (đường 80 %) (`pareto`) | the number of items that make 80 % of item revenue | that number for the same days of last month; like for like over the covered stores ("· cùng cửa hàng (k/N)", from `itemsCovered`) when only some stores have history at `P1` | the count of all items sold, the leader and its share; last month's count, or both counts over the covered stores when the comparison is like for like | every item sold, by revenue: rank, net, share, cumulative share, quantity, the same days of last month; the top 20 as bars with the cumulative share on the right axis, a last point "Các món còn lại" that closes the line at 100 %, and the 80 % line |
| Cơ cấu size (`size_mix`) | size L share of the quantity sold by size (`size_l_share`) | last month and last year, in points | the change in points and the drink whose L share moved most (drinks with at least 10 sized units in both windows) | per drink (`base_name`): L quantity, sized quantity, L share, last month's share, change; L share of the 10 best-selling drinks |
| Tỷ lệ kèm topping và đồ ăn nhẹ (`attach_rate`) | topping attach rate, "kèm đồ ăn nhẹ x %" | topping and snack against last month and last year, in points | the topping rate's change; the snack rate's change when it moved more | both rates this month, last month, change and last year; grouped bars this period, last period, last year |
| Món mới (`new_items`) | items first sold this month (`first_sold_on ≥ M1`, all time over the stores) | — | how many, the best one and its rank among all items sold | item, first sold, quantity, net, share, rank |
| Cơ cấu thanh toán (`payment_mix`) | cash share of the money received | last month and last year, in points | the change in points and, besides cash, the payment kind whose share moved most ("Ngoài tiền mặt, …") | method, kind, amount, share, last month's share, change, and the estimated fee when any method has one; stacked shares by kind, last month and this month |
| Chi phí giảm giá (`discount_cost`) | discounts (item, bill and voucher), "x % doanh thu gộp" | cost against last month and last year; discount rate against last month, in points | the change and the promotion that cost most by name (its kind only when it has no name), with its share of the cost | promotions: kind, name, invoices, discount, share of cost, days used; second table: components item, bill and voucher this month, last month and last year; stacked components for last year, last month and this month |
| Thống kê ca (`shift_stats`) | shifts over the variance thresholds, "trên n ca" | flagged shifts against the same days of last month (like for like when only some stores had last month) | the cashier and the shift with the most flags, or none flagged | per (store,) cashier and shift slot: shifts, flagged, total and mean absolute variance, largest shortage and overage; flagged shifts per cashier. A slot is a shift's number in its store and day by opening time ("Ca 1" is every first shift of the month), never the POS shift name; a cashier shaped like an e-mail counts as "chưa rõ thu ngân" (FR-REP-21) |
| Tiến độ mục tiêu (`target_progress`) | month to date ÷ the sum of the monthly targets | each forecast against the target, the lower MAE first | the progress and the net needed per remaining day ("cần thêm … mỗi ngày trong … ngày còn lại"), or reached; the leading forecast against the target; a complete month gives the final progress only | per store: target, month to date, progress, the weekday-profile forecast and its gap to the target; bars month to date against the target with a line at the leading forecast |

## States and markers

- **No data.** A month without invoices shows "—" with the notice "Chưa có số liệu bán hàng trong tháng này." and "Tháng … chưa có hóa đơn nào."
- **Young store.** A store without history on the first day of the reference period gives "chưa có dữ liệu kỳ trước" or "chưa có dữ liệu năm trước" instead of a change; with several stores the comparison uses the covered stores and reads "· cùng cửa hàng (k/N)". The forecast chips follow the same rule at `P1`, from the per-store `month_pace` calls and the per-store month of `months`.
- **New items of a young store.** With no store covered at `P1` the card shows "—" and "Cửa hàng mới mở: chưa xác định món mới."; with some covered, new items come from the covered stores only, so a store that opened last month does not make its whole menu new.
- **No forecast.** When neither method has a total the card says "Chưa đủ dữ liệu của những tuần gần đây để dự báo cả tháng." and each forecast chip reads "đang tích lũy dữ liệu dự báo".
- **Not measured, not configured.** Without sized items the size card shows "—" and "Chưa có món bán theo size."; without item roles the attach card shows "—" and "Chưa gán vai trò món." with a link to Settings (`#/cai-dat/phan-loai`); when a selected store has no target the target card shows "—" and "Chưa đặt mục tiêu tháng cho {stores}." with a link to `#/cai-dat/du-lieu-nhap-tay`. None of them shows 0.
- **Verification.** "chưa đối soát" when a selected store has a day without a matched POS control total in the range; "dữ liệu mẫu" in the demo.
- **Aggregates catching up.** The Pareto, size, attach, new items, payment and shift cards read aggregates and show "đang cập nhật" while a recent day's aggregates differ from the live totals.

## Tests

- Unit: `packages/reports/test/unit/reports/month/` builds every card from fixtures: forecast order by MAE and the tie, a complete month, 31 March against 28 February, the cumulative chart and its lines, like-for-like forecasts, Pareto exactly at 80 % and the closing point, size groups and the driver threshold, new items with the young store excluded, attach and target states, the payment fee column, shift groups and the like-for-like flag count, and the call plan.
- Parity: `packages/demo-analytics/test/parity/forecasts.parity.test.ts` compares `month_pace` (current, past, future, Tết and matrix months, with and without `as_of`), `forecast_accuracy` (28 and 56 days) and the three series helpers digit for digit with the SQL over the three parity datasets.
- Demo engine: `packages/demo-analytics/test/reports/month.smoke.test.ts` builds every card for three store selections, the previous month and the young store's first month.
- Browser: `apps/web/e2e/demo/report-month.spec.ts` (ten cards settle, the forecasts in MAE order, the Pareto 80 % line, target progress for [S1] and "Chưa đặt mục tiêu" for all stores, measured attach rates, deep link and stepping, the young store's first month, CSV with BOM, print, axe at 360 and 1280 px, no external request, English).
- Live: `LIVE=1 DATABASE_URL=… pnpm --filter @fnb/reports test:live` checks the last complete month's headline against the POS control totals, `metric_value`, the `period_series` month bucket and `month_pace.month_to_date_net_amount`.
