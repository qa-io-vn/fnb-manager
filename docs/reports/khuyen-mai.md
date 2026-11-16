# Khuyến mãi & giảm giá — promotions and discounts

Route `#/chu-de/khuyen-mai?range=<preset>` or `?from=…&to=…`, plus `&store=<id>,<id>`, `&promo=<kind>:<key>` and `&cmp=prior_weeks|sister_store` when they differ from their defaults · title "Khuyến mãi & giảm giá" · default the last 28 days, at most 400 · built in phase 10b (#191) on the range rules of [Doanh thu](doanh-thu.md#range) (ADR-035).

Khuyến mãi shows what discounts and vouchers cost against gross revenue, how often invoices use a voucher, and whether one promotion brought revenue beyond the general trend: its gross lift, its discount cost and the net of the two, always together. The promotion catalogue and the rule cards (the 50 % cap, the discount days and the lucky-draw warning) come with #153 and are added after these three cards.

## Calls

| Key | Call |
|---|---|
| `coverage` | `store_coverage(S, R.from, R.to)` |
| `totals` | `range_totals(S, [R, R.prev, R.ly])`, as on Doanh thu, with the like-for-like follow-ups `totalsLfl.previous` and `totalsLfl.last_year` over the covered stores while coverage is partial |
| `promotions` | `promotion_summary(S, R.from, R.to)` |
| `promotionsW92` | `promotion_summary(S, W92.from, W92.to)`, the lift's picker; `W92` is the last `min(R.days, 92)` days of `R`, so up to 92 days it is the same call as `promotions` and is asked once |
| `series` | `period_series(S, 'day' when R.days ≤ 35 else 'week', R.from, R.to, false)` |
| `settings` | `report_settings_of(S)`, for the tenant's pre-period weeks |
| follow-up `lift` | `promotion_lift(S, kind, key, W92.from, W92.to, cmp, pre_weeks)` once `promotionsW92` has answered with at least one promotion and `settings` has answered; `pre_weeks` is the `promo_pre_weeks` of `settings`, the same value the subtitle names, so a saved change asks for a new lift |

Range totals are written by the refresh, so every card carries "đang cập nhật" while `store_coverage.stale_days > 0` or a catch-up range overlaps the page's range.

## Parameters

| Parameter | Values | Default |
|---|---|---|
| `promo` | `<kind>:<key>` of a promotion of `promotionsW92` (a select inside the lift card, largest discount first, each named with its kind, "Giảm giá hóa đơn không tên" for an unnamed one) | the promotion with the largest discount in `W92` |
| `cmp` | `baseline` ("Cùng thứ các tuần trước"), `prior_weeks` ("Các tuần trước chương trình"), `sister_store` ("Cửa hàng không chạy chương trình"), a radio group inside the lift card | `baseline` |

`sister_store` is disabled, with "Mọi cửa hàng đang chọn đều chạy chương trình này nên không có cửa hàng để so sánh." under the group and tied to the option, once the lift has answered with no control store (`control_store_count = 0`): every selected store ran the promotion in the window or in the pre-period weeks before it, which is always the case for a single store. A link that asks for it then drops `cmp` with a replace, as for any value the answered call does not offer. Changing either parameter pushes one history entry and asks only for the lift again. While only `cmp` changes, the options keep the state of the last answered lift (the control-store count does not depend on the comparator), so the option does not flicker; another promotion, range or store selection shows every option until its lift answers.

## Cards

| Card | Headline | Chips | Sentence | Table and chart |
|---|---|---|---|---|
| Chi phí giảm giá (`discount_cost`) | Σ item, bill and voucher discounts of `range_totals`, captioned "{rate} doanh thu gộp" (`discount_rate`, discounts ÷ gross revenue) | the cost against the previous range and last year, then the rate in points against both ("tỷ lệ giảm giá so với …"); like for like over the covered stores, "chưa có dữ liệu năm trước" for a young store | the cost, up, down or about the same against the previous range ("Không có giảm giá hay voucher nào trong …" for a measured zero); the promotion that cost most with its share of the cost | promotions: kind, name, invoices, discount, share of the cost, first and last day used, largest first · second table, components: item, bill and voucher for this range and the previous one with the change · item, bill and voucher discounts stacked per day (per week beyond 35 days) |
| Voucher (`vouchers`) | the share of invoices with a voucher (`voucher_share` of `range_totals`) | the previous range and last year, in points | the share, up, down or about the same ("Không hóa đơn nào dùng voucher trong …" for a measured zero); the voucher with the most invoices and what it took off | voucher, invoices, discount, share of the range's invoices; most invoices first |
| Hiệu quả khuyến mãi (`lift`) | the net lift (`net_lift_amount`) as signed money, captioned "Doanh thu gộp tăng thêm {gross} · chi phí giảm giá {cost}"; net = gross − cost as `promotion_lift` returns them | — | "{promotion} lãi ròng …" or "… lỗ ròng …" with the gross lift, the cost and the measured days; then "Đã trừ xu hướng chung {amount} mỗi ngày, đo trên {days} ngày không khuyến mãi." when a trend adjustment applied; then the sentence of the first flag | every day of `W92`, promotion days first and each group by date: date, promotion day, control day, gross, reference, expected without the promotion, lift, discount, opening on 10 rows · bars of gross on the promotion days with the expected level as a line. Subtitle: the promotion, "{days} ngày cuối kỳ" and the comparator's control ("đối chứng: cùng thứ trong 8 tuần trước của chính cửa hàng", "đối chứng: {weeks} tuần trước ngày khuyến mãi đầu tiên", "đối chứng: cửa hàng không chạy chương trình, so với {weeks} tuần trước của chính nó", the weeks from Ngưỡng báo cáo) |

The lift card's controls sit between its headline and its chips and are hidden in print; the subtitle names the promotion, so a printed card still says what was measured.

CSV files are named `khuyen-mai-<card>-<from>_<to>.csv` and the components table `khuyen-mai-discount_cost-<from>_<to>-2.csv`, UTF-8 with a BOM.

## States and markers

- **No promotion in `W92`.** No lift is asked for; the card says "Không có khuyến mãi nào trong {days} ngày cuối kỳ…", shows "—" and a notice to choose a range in which a promotion ran.
- **No test store, no control store, too few control days.** `no_test_store`, `no_control_store` (with `sister_store`) and `few_control_days` (fewer than 7 days without the promotion, with `baseline` or `prior_weeks`) show "—" without a caption, a warning notice with the flag's sentence, which says what to try, and "Chưa đo được hiệu quả của {promotion}…" followed by the next flag. The advice follows what can work: `few_control_days` suggests a store that did not run the promotion only while one is selected (`lift.flagNoStore.few_control_days` otherwise, which suggests a range with days without it), and `no_control_store` suggests the weeks before only when the window has at least 7 days without the promotion (`lift.flagDaily.no_control_store` otherwise). A plain before-and-after figure is never shown: without a counterfactual there is no lift, net or caption.
- **Other flags.** `few_promo_days`, `few_reference_days`, `unmeasured_days`, `control_differs_in_size`, `excluded_days_in_window` and `other_promotions` each have a sentence; the first one present closes the sentence. A flag the page does not know is left out rather than shown as a key.
- **Young store.** Its last-year chips read "chưa có dữ liệu năm trước"; with one young store among several, the chips compare the covered stores ("cùng cửa hàng (k/N)").
- **Demo.** The demo's promotions run almost every day, so for the presets the lift shows the `few_control_days` state and `sister_store` is disabled. One window is measurable: for both stores, `from=2026-03-03&to=2026-06-02`, the bill discount "Giảm 5% hóa đơn" against `prior_weeks` shows a net loss with its gross lift, cost and trend, and `sister_store` is offered there because `MOCK-S2` had not opened. Every card carries "dữ liệu mẫu".

## Tests

- Unit: `packages/reports/test/unit/themes/promotions/discount-cost.test.ts` (cost and rate chips against both references, the costliest promotion named or unnamed, the tables and stacked chart, a measured zero, no data, like for like, the young store, stale and verification markers, week buckets), `vouchers.test.ts` (share and points, the most-used voucher named or unnamed, a measured zero, no data), `lift.test.ts` (net = gross − cost under each comparator with its control and weeks, the trend sentence, each flag's sentence and the blocking ones as notices, the dash for too few control days even beside a returned lift, no test store, no promotion, the 92-day subtitle, an unknown flag), `definition.test.ts` (registration, the shared range and window call, the lift of the largest discount against `baseline` by default with the tenant's `pre_weeks`, a new `pre_weeks` changing the call, a chosen and an unknown promotion, no lift before the promotions and the settings have answered or without promotions) and `params.test.ts` (the comparator options, `sister_store` disabled with its reason).
- Web: `theme-param-controls.test.tsx` (a disabled option's reason tied to it), `theme-wiring.test.tsx` (the disabled `sister_store` dropped from the address, and kept disabled while only the comparator changes), `theme-keys.test.ts` (every key the demo reaches, in both languages, for each comparator, three selections and three presets, with no raw key and no unfilled placeholder; and three measured lifts built from fixture rows, a gain with the trend, a loss against the weeks before and a gain against another store, so the gain, loss, trend and caption keys are rendered in both languages too), `card-adapter.test.ts` and `report-card.test.tsx` (the signed money headline), `settings/thresholds/*` (the pre-period weeks field).
- Demo engine: `packages/demo-analytics/test/themes/promotions.smoke.test.ts` (every card over three selections, three presets and three comparators, every key and placeholder in both languages, the promotions table and the components adding up to the cost, the dash and `sister_store` disabled when both stores ran the promotion, and the measurable spring bill discount with `pre_weeks` in its call and `sister_store` offered).
- Parity: `promotion_lift` and `promotion_days` by #190; `promotion_summary`, `period_series` and `range_totals` by their own suites.
- Playwright: `e2e/demo/theme-khuyen-mai.spec.ts` (the three cards settle, the default promotion and comparator, two presets, a custom range through a reload and a step, the young store, the comparator and promotion switches in the address and back, the measured spring bill discount (a signed net loss, its caption, the trend sentence, `sister_store` offered and chosen), `sister_store` disabled with its reason for both stores and dropped from a link, the CSV of every table with its BOM and headers in the comma and the semicolon dialect, print with the pickers hidden, axe at 360 and 1280 px, no external request, English, and the pre-period weeks saved on Ngưỡng báo cáo reaching the lift's subtitle and restored).
