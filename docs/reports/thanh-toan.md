# Thanh toán & tiền mặt — payments and cash

Route `#/chu-de/thanh-toan?range=<preset>` or `?from=…&to=…`, plus `&store=<id>,<id>` · title "Thanh toán & tiền mặt" · default the last 28 days, at most 400 · built in phase 10a (#98, #99) on the range rules of [Doanh thu](doanh-thu.md#range) (ADR-035).

Thanh toán shows how customers pay, by kind (tiền mặt, chuyển khoản, ví điện tử, thẻ, voucher, khác) and by method, how the cash share moves over the range, with a warning when cash rises while revenue falls, each shift's expected against counted cash with the tenant's thresholds, and what card and e-wallet fees are estimated to cost.

## Calls

| Key | Call |
|---|---|
| `coverage` | `store_coverage(S, R.from, R.to)` |
| `totals` | `range_totals(S, [R, R.prev, R.ly])`, as on Doanh thu, with the like-for-like follow-ups `totalsLfl.previous` and `totalsLfl.last_year` over the covered stores while coverage is partial |
| `payments` | `payment_summary(S, R.from, R.to, R.prev.from, R.prev.to)` |
| `paymentsPrevious` | `payment_summary(S, R.prev.from, R.prev.to)`, the previous range's own fee estimates for #99 |
| `series` | `period_series(S, 'day' when R.days ≤ 35 else 'week', R.from, R.to, false)` |
| `shifts` | `shift_review(S, W92.from, W92.to)`, the last `min(R.days, 92)` days, thresholds left out so the tenant's settings apply |
| `settings` | `report_settings_of(S)` |

Payment kinds come from each method's kind, an override in Settings winning once phase 10b adds it; kinds are written by the refresh, so every card carries the "đang cập nhật" marker while a catch-up range overlaps the page's range (ADR-036).

## Cards

| Card | Headline | Chips | Sentence | Table and chart |
|---|---|---|---|---|
| Cơ cấu thanh toán theo loại (`payment_mix`) | the cash share of the money taken (`cash_share` of `range_totals`) | the previous range and last year, in points (like for like over the covered stores; "chưa có dữ liệu năm trước" for a young store) | the cash share, up, down or about the same against the previous range; apart from cash, the kind whose share moved most | kinds: kind, amount, share, previous share, change in points (the kind shares sum to 1 and equal the method rows summed by kind) · second table, methods: method, kind, invoices, amount, share · stacked kind shares, the previous range beside this one |
| Xu hướng tỷ trọng tiền mặt (`cash_trend`) | the cash share of the last day (or week) with payments | that bucket against the first one, in points (none, with a note, when a selected store's data starts after the first bucket) | the last bucket's cash share against the first; the warning "Những tuần gần đây, tỷ trọng tiền mặt tăng trong khi doanh thu mỗi ngày giảm…" when the recent whole weeks show a cash share (Σ cash ÷ Σ paid) at least 1 point higher and a net revenue per calendar day at least 5 % lower than as many weeks before (two weeks a side at least; full weeks only with week buckets), KPI deep dive §5 and [metrics.md](../metrics.md#thematic-report-conventions) | per day up to 35 days, per week (from Monday) beyond: day or week, net revenue, cash, cash share, newest first and opening on 10 rows · bars of cash with the cash share as a line on the right axis |
| Tiền mặt dự kiến và đếm được theo ca (`drawer`) | the flagged shifts, captioned "trên {n} ca" | — | Ngày's shift sentences through the shared keys `report.shifts.none` and `report.shifts.largest` (the largest variance named "Ca n ngày …", with the store when several are selected), then the thresholds line "Ngưỡng: {abs} · {rel} tiền mặt bán · z trên {z}" from `report_settings_of` | store (several stores), date, shift "Ca n" numbered by opening time within the store and day, cashier (e-mail-like names masked), cash sales, expected, counted, variance, z-score, reasons; largest variance first, opening on 10 rows · bars of over and short variances for the 20 largest. Subtitle `W92`; payouts are not synced, so a payout reads as a shortage (the `cash_variance` note under "Giải thích chỉ số") |
| Phí thanh toán ước tính (`fees`) | Σ `fee_estimate_amount`, captioned with its rate on non-cash revenue | the previous range's own estimate (`paymentsPrevious`); "chưa có dữ liệu" when it has no payments, "chưa có dữ liệu kỳ trước" while a store lacks the previous range | the estimate against the previous range; the method that costs most and its share of fees | method, kind, amount, effective rate (estimate ÷ amount), estimated fee, the fee the POS reported; costliest first |

CSV files are named `thanh-toan-<card>-<from>_<to>.csv` and the methods table `thanh-toan-payment_mix-<from>_<to>-2.csv`, UTF-8 with a BOM.

## States and markers

- **Young store.** Its last-year chip reads "chưa có dữ liệu năm trước"; with one young store among several, the chips compare the covered stores ("cùng cửa hàng (k/N)").
- **Catch-up pending.** Both cards show "đang cập nhật" while a catch-up range overlaps the page's range.
- **No shift.** Without shifts in the window the drawer card says so, with a notice to check that cashiers open and close shifts on the POS.
- **No fee rate.** While no payment method has a fee rate (`report_settings_of.fee_rates_configured`), the fee card shows "—" and links to Cài đặt → Dữ liệu nhập tay → Phí thanh toán.
- **No data.** Without payments the cards say so and show "—".

## Tests

- Unit: `packages/reports/test/unit/themes/payments/payment-mix.test.ts` (the chip in points, kind shares summing to 1, methods table, the apart-from-cash mover, like for like, the stale marker, no data) and `cash-trend.test.ts` (last against first bucket, the cash signal over whole weeks and its negatives, a store joining after the first bucket, day and week buckets, no data).
- Unit, #99: `drawer.test.ts` (shift numbering by opening time, the thresholds line, e-mail-like shift and cashier names never rendered, no shift, none flagged) and `fees.test.ts` (the rate on non-cash revenue, the chip from `paymentsPrevious`, no previous payments, not configured, stale).
- Parity: `shift-review.parity.test.ts` (the demo's thresholds from the default and a tenant's settings and explicit ones, against the SQL).
- Demo engine: `packages/demo-analytics/test/themes/payments.smoke.test.ts` (three store selections, four presets, every key and placeholder in both languages, kind shares summing to 1 and matching the methods by kind).
- Parity: `payment_summary` and `period_series` are phase 9's, held by their parity suites; `range_totals` by `theme-revenue-hours.parity.test.ts`.
- Playwright: `e2e/demo/theme-thanh-toan.spec.ts` (the four cards settle, the chips' reference, day and week buckets, a custom range through a reload and a step, the young store, the CSV of every table, the thresholds line, and shifts labelled "Ca n" with no POS shift name or e-mail address on screen, in the CSV and in print, the fee card's dash and fees link, print, axe at 360 and 1280 px, no external request, English).
