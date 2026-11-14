# Giờ & ngày trong tuần — hours and weekdays

Route `#/chu-de/gio-ngay?range=<preset>` or `?from=…&to=…`, plus `&store=<id>,<id>` · title "Giờ & ngày trong tuần" · built in phase 10a (#92, #93) on the range rules of [Doanh thu](doanh-thu.md#range) (ADR-035).

Giờ & ngày shows when the stores sell: the best and quietest hour of each weekday, the peak and quiet hours with their share of revenue, the weekday pattern, revenue per opening hour and per seat, and the hours that are busy enough to staff.

## Calls

| Key | Call |
|---|---|
| `coverage` | `store_coverage(S, R.from, R.to)` |
| `heat` | `hour_weekday_heatmap(S, R.from, R.to)` |
| `hours`, `hoursPrevious` | `hour_profile(S, R)` and over `R.prev`, with the tenant's thresholds |
| `productivity`, `productivityPrevious` | `opening_productivity(S, R)` and over `R.prev` |
| `settings` | `report_settings_of(S)` |

Every level, mean per day and share comes from `hour_profile` (`docs/schema.md`): in all days, the `peak_hours` largest hours (3 by default) are cao điểm and hours below the quiet ratio (0.5) times the open span's mean are thấp điểm; Monday to Friday and the weekend are levelled by invoices per day against the busy ratio (1.25) and the quiet ratio. The thresholds are the tenant's report settings. TypeScript only merges consecutive hours of the same level into windows.

## Cards

| Card | Headline | Chips | Sentence | Table and chart |
|---|---|---|---|---|
| Bản đồ nhiệt giờ × thứ (`heatmap`) | the best cell's mean net per day, with its weekday and hour | — | the best and the quietest cell with sales | two heat tables, mean net and mean invoices per day: hours from the first to the last with sales, from the first store's day start, columns T2 to CN and an average column; five shades, values in every cell. A weekday with fewer than 2 days of data adds a notice |
| Giờ cao điểm và thấp điểm (`peak_dead`) | the peak hours' share of revenue | the share against the range before, in points | the peak hours and their share, the quiet windows and theirs | hour, mean net per day, share, level; bars per hour by level |
| Theo thứ trong tuần (`weekday`) | the best weekday's mean net per day | — | the best and weakest weekday and the gap; the weekday that changed most on the range before | weekday, mean net and invoices per day, share, the previous mean, change; bars |
| Doanh thu mỗi giờ mở cửa và mỗi ghế (`productivity`) | net per opening hour | the range before | vs the range before, and RevPASH with the seat count when seats exist | several stores: open hours, net and invoices per hour, seats, RevPASH, and "chưa có số ghế" for a store without seats; one store: this range and the range before |
| Gợi ý khung ca (`shift_windows`) | the number of busy windows | — | the longest busy window of the weekdays and of the weekend; "Dựa trên số hóa đơn mỗi giờ; chưa tính năng suất nhân viên." | day group, from, to, level, the smallest and largest mean invoices and net per day of its hours |

CSV files are named `gio-ngay-<card>-<from>_<to>.csv`, UTF-8 with a BOM.

## States and markers

- **No opening hours.** A store with sales but no opening hours leaves net per hour at "—" with the notice "Chưa nhập giờ mở cửa…" and the link "Nhập giờ mở cửa và số ghế" to Cài đặt → Cửa hàng; RevPASH appears only for stores with seats, and the card is marked provisional while a store lacks them.
- **Short ranges.** Under 14 days the shift windows card adds "Cần ít nhất 14 ngày…".
- **No data.** Without hourly sales the cards say so and show "—".

## Tests

- Demo engine: `packages/demo-analytics/test/themes/hours.smoke.test.ts` (three store selections, four presets, the heat table's columns, three peak hours, RevPASH for the store with seats and the settings link for the young store, the short-range notice).
- Parity: `hour_weekday_heatmap`, `hour_profile` (default and tenant thresholds, explicit arguments, the 400-day limit), `opening_productivity` and `report_settings_of` in `theme-revenue-hours.parity.test.ts`.
- pgTAP: `33_theme_functions.sql` (hand-computed levels and shares, ties, a 05:00 day start, split and overnight opening hours) and `34_theme_access.sql`.
- Playwright: `e2e/demo/theme-gio-ngay.spec.ts` (cards settle, the heat table's columns and its last column at 360 px, the young store's settings link, the short range, CSV, print, axe, English) and `e2e/live/themes.spec.ts`.
- Open: the comparison with the private reference window (OC-03) and the read-only live check that prints `matches` for it (#86).
