# Tuần — the weekly report

Route `#/bao-cao/tuan?week=YYYY-Www[&store=<id>,<id>]` · title "Báo cáo tuần" · built in phase 9 (step 9c) on the Ngày foundation (`docs/reports/ngay.md`, `docs/web-app.md` "Phase 9 decisions").

Tuần explains one ISO week, Monday to Sunday: how its revenue, invoices and average ticket compare with last week, with the average of the four weeks before and with the same week a year earlier; which day carried the week; which items are rising or falling; how the category mix moved; what the promotions cost; and which days beat or missed their usual level.

## Period

- The week runs from Monday `Wm` (`period.from`) to `We` (`period.end`): Sunday, or the as-of day for the running week. `e = We − Wm` is the number of elapsed days minus one. The as-of day is the earliest store business date of now, minus one; today is Hôm nay's job.
- The URL key is the ISO year and week, `YYYY-Www` (`2026-W45`); weeks 53 exist (2026-W53 runs from 2026-12-28 to 2027-01-03). A missing or invalid key opens the week of the as-of day; a future key opens it with the notice of the clamp.
- Previous and next step one ISO week, across the year boundary (`2026-W01` back to `2025-W52`); next is disabled on the week of the as-of day. "Chọn ngày" opens the week of any date from 2023-01-01 to the as-of day.
- A running week shows "đến hết {end}" under the totals' headlines, and every comparison covers the same elapsed days: last week is `[Wm − 7, We − 7]`, the same week last year `[Wm − 364, We − 364]` (52 weeks earlier, the `period_compare` week rule).
- `S` is the selected stores; with several stores every figure is the sum of the stores before any ratio.

## Calls

All numbers come from SQL (`docs/schema.md`, "Report functions (phase 9)"); the demo runs the parity-tested port in `@fnb/demo-analytics`.

| Key | Call |
|---|---|
| `coverage` | `store_coverage(S, Wm, We)` |
| `compare` | `period_compare_by_store(S, 'week', We)` — all stores, then each store; rows current, previous and last year |
| `days` | `period_series(S, 'day', Wm − 28, We)` — every day of the week and of the four weeks before, with its holiday kind |
| `baselines` | `daily_baselines(S, Wm, We, 8)` — the same-weekday median of each day |
| `velocity` | `item_velocity(S, We)` — each item's last 28 days against the 28 days before |
| `items` | `item_summary(S, Wm, We, Wm − 7, We − 7)` |
| `promotions` | `promotion_summary(S, Wm, We)` |
| `promotionsPrevious` | `promotion_summary(S, Wm − 7, We − 7)` |
| `metrics` | `metric_compare(S, ['discount_rate', 'voucher_invoice_share'], 'week', We)` |
| follow-ups | when only some stores have history before last week or the same week last year: `period_compare` and `metric_compare` over the covered stores (`compareLfl.*`, `metricsLfl.*`); when only some stores have history on `We − 55`: `item_velocity` over those stores (`velocityCovered`) |

Coverage: a store counts for a reference period when its history starts on or before the period's first day. `period_series` returns at most 900 rows, so a selection of more than 24 stores is beyond the `days` call.

## The 4-week average

Built in TypeScript from the `days` rows (`packages/reports/src/reports/week/four-week-average.ts`):

- Week k (k = 1 to 4) is `[Wm − 7k, Wm − 7k + e]`, the same elapsed days k weeks earlier.
- The stores are those covered on `Wm − 28`. With some stores covered the comparison is like for like ("· cùng cửa hàng (k/N)"), its current figure is the covered stores' week, and the 4-week bar and table row say "cùng cửa hàng". With none covered it reads "cửa hàng mới, chưa đủ 4 tuần".
- A week whose compared days hold a Tết day is skipped (`SKIP_TET_WEEKS = true`); other public holidays stay in. With fewer than two weeks left there is no reference ("chưa có số để so sánh"). The label says how many weeks were used: "so với trung bình 3 tuần".
- Net revenue and invoices are the mean, over the weeks left, of the covered stores' sums; a covered store-day without data counts 0. The average ticket is pooled: Σ net ÷ Σ invoices of those weeks, rounded to 2 decimals (items per ticket 4, item price 2).
- The same weeks and stores give each weekday's 4-week average for the weekday curve, so the elapsed weekdays' averages add up to the 4-week average.

## Cards

Each card has a headline, chips where it compares, a sentence, an optional chart, a table with a CSV download (UTF-8 with BOM, file `tuan-<card>-<YYYY-Www>.csv`) and "Giải thích chỉ số". Fraction metrics compare in percentage points, everything else as a relative change.

| Card | Headline | Chips | Sentence | Table and chart |
|---|---|---|---|---|
| Doanh thu tuần (`net_revenue`) | net revenue of the week, "đến hết {end}" while it runs | last week (same elapsed days), the 4-week average, the same week last year (like for like when only some stores have that history) | vs last week; a young store's "{store} mở từ {date}, chưa có dữ liệu năm trước", or, when last week is like for like, "Mức so sánh chỉ tính k/N cửa hàng có đủ dữ liệu: {this week} so với {last week}"; the store that moved most against its own last week, among the stores the comparison covers (none with fewer than two such stores; one store: the weekday, each date against the same weekday last week). No driver follows "chưa có tuần trước để so sánh" | several stores: store, net, last week, change, 4-week average, change, last year, change, with the young store's state; one store: rows this week, last week, 4-week average, last year × net, invoices, average ticket. Bars this week, last week, 4-week average, last year |
| Hóa đơn tuần (`invoices`) | invoices | as above | as above, by invoices | as above |
| Giá trị hóa đơn tuần (`avg_ticket`) | average ticket | last week, the pooled 4-week ticket, last year | vs last week, then the larger of items per ticket and average item price | rows this week, last week, 4-week average, last year × average ticket, items per ticket, average item price; the state column explains a missing 4-week row |
| Đường theo ngày trong tuần (`weekday_curve`) | net of the strongest day, "{weekday}, {date}" | — | the strongest day and its share of the week; the day furthest from its 4-week same-weekday average | Monday to Sunday: weekday, date, net, share of the week (6 digits), last week, change, 4-week same-weekday average, change. Bars this week (days after the as-of day are gaps), lines last week and the 4-week average |
| Món tăng, món giảm (`movers`) | the top riser's quantity change, named; subtitle "28 ngày đến {end} so với 28 ngày trước" | — | the top riser and the top faller; the best-selling new item | rising: the top 5 by quantity change, above 0, with at least 10 units in both windows; falling: the bottom 5, below 0, with at least 10 units in the earlier window; new: unsold earlier, at least 10 units now, top 3 by net (`MIN_VELOCITY_QUANTITY = 10`). Columns: group, item, quantity in each window, change, net of the last 28 days |
| Cơ cấu nhóm món (`category_mix`) | share of the leading category, named | — | the leading category and its share of item revenue; the category whose share moved most, in points | category, role, net, share, last week's share, change in points, quantity; items without a type are grouped as "Chưa phân loại" (shown in the category column, the chart and the sentence; their role column reads "Chưa gán vai trò"). Grouped bars of share, this week and last week |
| Khuyến mãi đã chạy (`promotions`) | discount cost of the week, "{rate} doanh thu gộp" | cost vs last week; discount rate vs last week, in points | the cost vs last week, the costliest promotion by name (its kind only when it has no name) and the share of invoices with a voucher; "Tuần này không chạy khuyến mãi." in a week without discounts | kind, name, invoices, discount, last week's discount of the same kind and key (0 when it did not run), change, days used; stacked item, bill and voucher discounts, last week and this week |
| Ngày tốt nhất và kém nhất (`best_worst_days`) | the best day's deviation from its baseline, "{weekday}, {date}" | — | the best and the worst day against the 8-week same-weekday median; a note when either is a holiday ("Lưu ý: … là Tết") | date, weekday, net, baseline, deviation, holiday kind; bars of each day's deviation above and below the baseline |

The deviation is (net − baseline) ÷ baseline over the days with at least one same-weekday sample and with sales; ties go to the earlier date. Holidays are labelled by kind ("Tết", "Ngày lễ", "Ngày nghỉ riêng").

The net revenue and average ticket cards decompose the change against last week (or, without it, against last year): revenue into invoices × items per ticket × average item price, the ticket into items per ticket × average item price, each part rounded so the parts add up exactly to the difference shown. The 4-week average and the medians are never decomposed.

## States and markers

- **No data.** A week without invoices shows "—", "Chưa có hóa đơn nào trong tuần …" and the notice "Chưa có số liệu bán hàng trong tuần này."; a week with voided invoices only has no average ticket.
- **Young store.** A store without history on the reference period's first day shows "chưa có dữ liệu năm trước" (or "kỳ trước") instead of a change, and its table row says so; with several stores the comparison uses the covered stores and reads "· cùng cửa hàng (k/N)".
- **Eight weeks for movers.** Without a store whose history starts by `We − 55`, Món tăng, món giảm shows "—" and "Cần 8 tuần dữ liệu để so 28 ngày gần nhất với 28 ngày trước đó."; with only some such stores it ranks over them and the headline caption reads "· cùng cửa hàng (k/N)". When nothing rose past the thresholds the headline is "—" with a notice.
- **Too few days.** With fewer than two days that have a baseline, Ngày tốt nhất và kém nhất shows "—" and asks for at least two such days.
- **Verification.** "chưa đối soát" when a selected store has a day without a matched POS control total in the week; "dữ liệu mẫu" in the demo.
- **Aggregates catching up.** Món tăng, món giảm and Cơ cấu nhóm món read the item aggregates and show "đang cập nhật" while a recent day's aggregates differ from the live totals.

## Tests

- Unit: `packages/reports/test/unit/reports/week/` builds every card from fixtures: the 4-week average with a Tết week skipped, with one qualifying week, like for like and with zero days; all stores and one store; a young store; a running week, a one-day week (Monday as-of) and ISO week 53; the movers thresholds; category grouping with a null type; promotions matched by kind and key; best and worst ties, missing baselines and too few days; the call plan.
- Parity: `packages/demo-analytics/test/parity/item-velocity.parity.test.ts` holds the engine's `item_velocity` to the SQL over the three datasets, every matrix anchor and the window edges.
- Demo engine: `packages/demo-analytics/test/reports/week.smoke.test.ts` builds every card for three store selections in five weeks (the running week, the week before, the young store's opening week, the Tết week and the week after it), and checks the message files and every placeholder.
- Browser: `apps/web/e2e/demo/report-week.spec.ts` (eight cards settle, the 4-week chip, deep link `?week=2026-W44` and stepping, `2026-W01` back to `2025-W52`, the young store, CSV with BOM on the weekday curve and the movers, print, axe at 360 and 1280 px, no external request, English without keys or placeholders).
