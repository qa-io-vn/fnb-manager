# Doanh thu & xu hướng — revenue and its trend

Route `#/chu-de/doanh-thu?range=<preset>` or `?from=YYYY-MM-DD&to=YYYY-MM-DD`, plus `&store=<id>,<id>` · title "Doanh thu & xu hướng" · built in phase 10a (#91, #188) as the first thematic report (ADR-035).

Doanh thu answers how much the stores sold over a chosen range, whether that is up or down on the range before and on the same weeks last year, which store and which part of the ticket moved it, and where the trend is heading.

## Range

- `R` is the range: a preset (7 ngày, 4 tuần, 13 tuần, 52 tuần, Tháng này, Tháng trước, Năm nay; 4 tuần by default) or two dates. It ends at the last complete business day (the as-of day); an end after it is moved to it with a notice. At most 400 days: a longer range keeps its last 400 days with a notice. A start before 2023-01-01 or an invalid date falls back to 4 tuần.
- References: `R.prev` is the range of equal length just before; `R.ly` is `R` shifted 364 days (the same weekdays). Tháng này and Tháng trước compare month with month as Tháng does; 52 tuần and Năm nay have one reference only, because the range before is also last year.
- The preset chips are a radio group; ‹ and › move a rolling or custom range by its length and a calendar preset by a month or a year; "Từ ngày" and "Đến ngày" apply on Enter, on leaving the field or 0.7 s after typing. The last preset used is remembered on the device. Moving to Giờ & ngày keeps the range and the stores.
- `S` is the selected stores, as on the periodic reports.

## Calls

All numbers come from SQL (`docs/schema.md`, "Thematic report functions (phase 10)"); the demo runs the parity-tested ports.

| Key | Call |
|---|---|
| `coverage` | `store_coverage(S, R.from, R.to)` |
| `totals` | `range_totals(S, [R.from, R.prev.from, R.ly.from], [R.to, R.prev.to, R.ly.to])` (two ranges without `R.ly`) |
| `series` | `period_series(S, g, f, R.to, false)`: grain `g` is day up to 92 days, else week; `f` starts 6 days (or 3 weeks) before `R` so the first point has a full moving average |
| `seriesLastYear` | the same over `R.ly` |
| `months`, `monthsLastYear` | `period_series(S, 'month', R, true)` and the same a year earlier, from 56 days |
| follow-ups | when only some stores have history at a reference's start: `range_totals` over the covered stores (`totalsLfl.previous`, `totalsLfl.last_year`) |

## Cards

| Card | Headline | Chips | Sentence | Table and chart |
|---|---|---|---|---|
| Doanh thu thuần (`net_revenue`) | net revenue of `R` | the range before ("so với 4 tuần trước", "so với 7 ngày trước", "so với tháng trước"), the same weeks last year (like for like when only some stores have that history) | vs the range before, with the young store's note, then the store that moved most or the decomposition clause | several stores: store, net, the range before, change, last year, change, with the young store's state, and grouped bars per store; one store: rows this range, the range before and last year with net, invoices and ticket |
| Xu hướng doanh thu (`trend`) | mean net per day with sales | — | the moving average rose, fell or held, from its first to its last point; Tết noted when the range holds Tết days | date (or week), net, 7-day (or 4-week) moving average, last year's moving average, change; bars of net, the moving average and last year's as lines, Tết shaded. Fewer points than the window: a notice and no average |
| Số hóa đơn (`invoices`) | invoices | as net revenue | as net revenue, by invoices | as net revenue |
| Giá trị trung bình mỗi hóa đơn (`avg_ticket`) | average ticket | as net revenue | vs the range before, with the ticket split into items per ticket and average item price | rows this range, the range before and last year with ticket, items per ticket and average item price |
| Theo tháng (`by_month`, from 56 days) | the latest complete month | — | the best month and its change on the same month last year | month, net, last year, change, with "Cùng cửa hàng" on months compared like for like; bars this year and last year |
| Tỷ trọng từng cửa hàng (`store_share`, two or more stores) | the largest store's share | — | the largest store's share and its change in points on the range before | store, net, share, the previous share, change in points; stacked shares of the range before and this range |

CSV files are named `doanh-thu-<card>-<from>_<to>.csv`, UTF-8 with a BOM.

## States and markers

- **Young store.** The last-year chip reads "chưa có dữ liệu năm trước" and the sentence names the store and its first day; with several stores the chips compare the covered stores and read "· cùng cửa hàng (k/N)".
- **No data.** A range without sales shows "—" and "Chưa có số liệu bán hàng trong …".
- **Verification.** "chưa đối soát" or "dữ liệu mẫu" as on the periodic reports.

## Tests

- Unit: `packages/reports/test/unit/themes/` (ranges, planning, comparisons, the RPC source, the settings defaults).
- Demo engine: `packages/demo-analytics/test/themes/revenue.smoke.test.ts` builds every visible card for three store selections and four presets and checks every message key and placeholder in both languages.
- Parity: `range_totals` against the SQL in `theme-revenue-hours.parity.test.ts`.
- pgTAP: `33_theme_functions.sql` and `34_theme_access.sql`.
- Playwright: `e2e/demo/theme-doanh-thu.spec.ts` (cards settle, presets, a custom range across a reload and a step, the young store, CSV with BOM, print, axe at 360 and 1280 px, no request outside the origin, English) and `e2e/live/themes.spec.ts` on the seeded stack.
