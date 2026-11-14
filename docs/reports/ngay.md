# Ngày — the daily report

Route `#/bao-cao/ngay?date=YYYY-MM-DD[&store=<id>,<id>]` · title "Báo cáo ngày" · built in phase 9 (step 9b) as the reference report for Tuần, Tháng and Năm.

Ngày explains one complete business day: how it compares with the usual day of that weekday, with the day before and with the same weekday last year, which hour, item, payment method, shift or promotion made the difference, and whether the members' phone numbers were captured. Today is Hôm nay's job; Ngày stops at the last complete business day (see "Period").

## Period

- The day `D` is the period's end: the date in the URL, or the as-of day (the earliest store business date of now, minus one) when the URL has none.
- A date after the as-of day shows the as-of day with the notice "Ngày hôm nay chưa kết thúc; báo cáo dừng ở ngày …" and a link "Xem Hôm nay". A date before 2023-01-01 or not a date falls back to the as-of day.
- Previous and next step one day; next is disabled on the as-of day. "Chọn ngày" opens any date from 2023-01-01 to the as-of day.
- `S` is the selected stores: the `store` parameter when present, otherwise the top bar's selection. With several stores every figure is the sum of the stores before any ratio.

## Calls

All numbers come from SQL (`docs/schema.md`, "Report functions (phase 9)"); the demo runs the parity-tested port in `@fnb/demo-analytics`.

| Key | Call |
|---|---|
| `coverage` | `store_coverage(S, D, D)` |
| `compare` | `period_compare_by_store(S, 'day', D)` — all stores, then each store; rows current, previous (`D − 1`), last year (`D − 364`, the same weekday) and baseline |
| `hourly` | `hourly_profile(S, D, 8)` |
| `metrics` | `metric_compare(S, ['peak_share_20_21', 'discount_rate', 'voucher_invoice_share', 'customer_capture_rate'], 'day', D)` |
| `items` | `item_summary(S, D, D, D − 1, D − 1)` |
| `payments` | `payment_summary(S, D, D, D − 1, D − 1)` |
| `shifts` | `shift_review(S, D, D)` |
| `promotions` | `promotion_summary(S, D, D)` |
| follow-ups | when only some stores have history before the day before or the same weekday last year: `period_compare` and `metric_compare` over the covered stores (`compareLfl.*`, `metricsLfl.*`) |

The baseline is the median of the same weekday over the previous 8 weeks, holidays and Tết left out (`same_weekday_baseline`). Coverage: a store counts for a reference day when its history starts on or before it.

## Cards

Each card has a headline, comparison chips, a sentence, an optional chart, a table with a CSV download (UTF-8 with BOM, file `ngay-<card>-<date>.csv`) and "Giải thích chỉ số". Fraction metrics compare in percentage points ("+1,2 điểm %"), everything else as a relative change.

| Card | Headline | Chips | Sentence | Table and chart |
|---|---|---|---|---|
| Doanh thu thuần (`net_revenue`) | net revenue of the day | baseline (with "k/8 tuần" while fewer than 8 weeks exist), the day before, the same weekday last year (like for like when only some stores have that history) | vs the baseline; for a young store "{store} mở từ {date}, chưa có dữ liệu năm trước"; the store that moved most against its own baseline (one store: the hour) | several stores: store, net, baseline, the day before, last year and their changes, with the young store's state; one store: rows this day, the day before, baseline, last year. Grouped bars per store, day against baseline |
| Số hóa đơn (`invoices`) | invoices | as above | as above, by invoices | as above |
| Giá trị trung bình mỗi hóa đơn (`avg_ticket`) | average ticket | baseline (median ticket), the day before, last year | vs the baseline, then the larger of items per ticket and average item price, naming the reference it is measured against ("Chênh lệch … so với hôm trước phần lớn do …"); when several stores are flat, the store with the highest ticket | average ticket, items per ticket, average item price per store or per period row |
| Theo giờ so với thường lệ (`hourly`) | net of the peak hour, "lúc HH:00" | share of 20:00–22:00 vs the day before, in points | the peak hour and the 20:00–22:00 share; the hour furthest from usual | hour, net, baseline, difference, invoices, baseline invoices; lines this day and usual. The axis starts at the first store's day start and quiet hours at both ends are trimmed. Without any usable same weekday in the 8 weeks before, the baseline line is left out with a notice |
| 5 món bán chạy (`top_items`) | net of the best seller, named | — | the best seller's quantity and share of item revenue; among the top 10, the item whose revenue changed most "so với hôm trước", left out when the day before has no item sales | top 5: item, quantity, net, share, the day before, change; bars this day and the day before |
| Thanh toán và tiền mặt cần đếm (`payments`) | cash to count (cash-kind tenders) | cash share vs the day before, in points | the leading payment kind and its share; "Tiền mặt cần đếm: …" exact | method, kind, amount, share, the day before, change; stacked shares by kind, the day before and this day |
| Ca và chênh lệch két (`shifts`) | flagged shifts, "trên n ca" | — | none flagged, or the largest flagged variance with its shift, cashier and reasons (the tenant's thresholds from Settings, by default absolute 50,000 ₫ and relative 0.5 % of cash sales, and a z-score over 2) | store, shift, cashier, opened, closed, cash sales, expected, drawer, variance, z, reasons, sorted by the size of the variance; bars of over and short variances. Shifts read "Ca 1", "Ca 2" by opening time within the store and day, the digest's numbering, never the POS shift name; a cashier shaped like an e-mail reads "chưa rõ thu ngân" (FR-REP-21). A day without shifts has no headline and a notice |
| Giảm giá và voucher (`discounts`) | discount cost, "x % doanh thu gộp" | cost vs the day before; discount rate vs the day before and last year, in points | the cost vs the day before and the largest promotion by name (its kind only when it has no name); "không có giảm giá" on a day without | promotions (kind, name, invoices, discount, share of cost) and a second table of components item, bill and voucher for both days; stacked components for both days |
| Hóa đơn có số điện thoại thành viên (`members`) | member share | vs the day before, in points | a measured zero reads "Chưa hóa đơn nào có số điện thoại thành viên; nhắc thu ngân hỏi số khi thanh toán."; otherwise the change and the store with the lowest share | invoices, member invoices, member share, capture rate per store or per period row |

The net revenue and average ticket cards decompose the change against the day before (or, without it, against last year): revenue into invoices × items per ticket × average item price, the ticket into items per ticket × average item price, each part rounded so the parts add up exactly to the difference shown. The line under the chips shows every amount in full ("Chênh lệch +1.538.000 ₫ so với hôm trước: …"), and the ticket split is shown in whole đồng with the item price part as the remainder, so the shown parts add up to the shown total. The baseline is never decomposed, because medians do not multiply; since the sentence compares with the baseline, its decomposition clause names the day before (or last year) it is measured against.

## States and markers

- **No data.** A day without invoices shows "—" with the notice "Chưa có số liệu bán hàng trong ngày này." and "Ngày … chưa có hóa đơn nào." A day with voided invoices only has a net revenue of 0 and no average ticket.
- **Sentences.** A driver or decomposition clause follows only a main clause it explains: none after "chưa có số để so sánh" when the reference is missing, and after a level ("ngang") clause a driver never reads "đi ngược chiều".
- **Young store.** A store without history on the reference day shows "chưa có dữ liệu năm trước" (or "kỳ trước") instead of a change, and its table row says so; with several stores the comparison uses the covered stores and reads "· cùng cửa hàng (k/N)".
- **Verification.** "chưa đối soát" when a selected store has a day without a matched POS control total in the range; "dữ liệu mẫu" in the demo.
- **Aggregates catching up.** Cards that read item, payment or shift aggregates show "đang cập nhật" while a recent day's aggregates differ from the live totals.

## Tests

- Unit: `packages/reports/test/unit/reports/day/` builds every card from fixtures (all stores and one store, partial and no coverage, a 3-of-8-week baseline, a voided-only day, no shifts, no promotions, a measured zero member share, decomposition additivity over 200 seeded days, a 05:00 day start).
- Demo engine: `packages/demo-analytics/test/reports/day.smoke.test.ts` builds every card for three store selections.
- Browser: `apps/web/e2e/demo/report-day.spec.ts` (nine cards settle, Hôm nay's yesterday equals Ngày, deep link and stepping, today clamps, the young store, CSV with BOM, print, axe at 360 and 1280 px, no external request, English) and `apps/web/e2e/live/reports.spec.ts` on the seeded stack.
- Live: `LIVE=1 DATABASE_URL=… pnpm --filter @fnb/reports test:live` compares Ngày's headlines with the POS control totals, `metric_value` and `period_series` on the local tenant.
