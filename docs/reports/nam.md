# Năm — the yearly report

Route `#/bao-cao/nam?year=YYYY[&store=<id>,<id>]` · title "Báo cáo năm" · built in phase 9 (step 9c) on the Ngày foundation (`docs/reports/ngay.md`).

Năm explains a calendar year: its months against each other and against the two years before, how it grows against last year month by month and to date, its seasonal shape and the Tết dip, how the ticket moves, which items are new, growing, declining or gone, and how a store that opened during the last year is ramping up. A running year ends at the last complete business day; Hôm nay owns today.

## Period

- `Y1` is 1 January of the year and `Ye` the period's end: 31 December, or the as-of day (the earliest store business date of now, minus one) for the running year.
- `L1` is 1 January of last year and `F1` 1 January two years back, the first row of the month × year matrix.
- Previous and next step one year; next is disabled on the as-of year. "Chọn ngày" opens any date from 2023-01-01 to the as-of day and moves to its year. A year after the as-of year shows the as-of year with the notice "Ngày hôm nay chưa kết thúc; báo cáo dừng ở ngày …".
- `S` is the selected stores. With several stores every figure is the sum of the stores before any ratio.
- A store is young for Năm when its history starts after `Ye − 364`.

## Calls

All numbers come from SQL (`docs/schema.md`, "Report functions (phase 9)"); the demo runs the parity-tested port in `@fnb/demo-analytics`.

| Key | Call |
|---|---|
| `coverage` | `store_coverage(S, Y1, Ye)` |
| `compare` | `period_compare_by_store(S, 'year', Ye)` — all stores, then each store; rows current (`Y1` to `Ye`) and last year (the same elapsed days from `L1`) |
| `months` | `period_series(S, 'month', F1, Ye)` |
| `weeks` | `period_series(S, 'week', L1, Ye, include_stores => false)` — all stores only |
| `weekdays` | `period_series(S, 'weekday', Y1, Ye, include_stores => false)` — all stores only |
| `lifecycle` | `item_lifecycle(S, Ye)` |
| follow-ups | when only some stores have history on `L1`: `period_compare` over the covered stores (`compareLfl.last_year`; for a year the previous period is last year, so it is planned once) and `item_lifecycle` over them (`lifecycleCovered`); for each young store whose history starts on or before `Ye`: `period_series([store], 'day', history_start, Ye)` (`since.<storeId>`) |

`period_series` limits its result to 900 rows. The weekly and weekday calls ask for the all-stores rows only, so the monthly call (36 months × (stores + 1)) sets the limit: Năm handles up to 24 stores selected together. A card whose call goes over a limit says so and asks for fewer stores instead of offering a retry.

## Rules

The constants live in `packages/reports/src/reports/year/rules.ts`.

- **Complete month.** A month whose last day is on or before the as-of day.
- **Peak month** (`PEAK_COMPLETE_MONTHS_ONLY = true`). The complete month of the year with the highest net over all selected stores; ties go to the earlier month. Before any month is complete it is the latest month, marked partial.
- **Year over year per month.** The stores covered for month m are those whose history starts on or before the first day of m a year earlier. The change is Σ covered net of m ÷ Σ covered net of m a year earlier − 1, from the per-store month rows, flagged "cùng cửa hàng" when only some stores are covered and "chưa có dữ liệu năm trước" when none is.
- **Month on month** compares complete months over all stores; **3 months against the previous 3** compares the latest three complete months with the three before, all six with data.
- **Seasonality index** (`SEASONALITY_MONTHS = 12`). The window is the 12 complete months ending with the latest complete month on or before `Ye`, over the stores whose history starts on or before its first day. The average daily net of month m is their net of m ÷ the calendar days of m; its index is that average ÷ the mean of the 12 averages, rounded to 3 digits. With no covered store, or a month without their sales, the card says "chưa đủ 12 tháng". The card's peak is the window month with the highest index; it can differ from the matrix's peak month, which ranks monthly net over all stores.
- **Tết dip.** For each of the two years in `weeks`, the week with the most Tết days (ties to the earlier week) against the four weeks before it: its net per calendar day ÷ the mean net per calendar day of those four weeks − 1. For whole weeks this is the week's net ÷ the mean net of the four weeks − 1; a week clipped by the start of `weeks` (1 January of last year) counts by its days. Every one of the five weeks needs sales.
- **Lifecycle statuses** (`QUIET_DAYS = 56`, `LIFECYCLE_CHANGE = 0.2`, `MIN_LIFECYCLE_QUANTITY = 10`), the first that applies: new (first sold on or after `Y1`); discontinued (last sold before `Ye − 55` and on or after `L1`); growing (at least 10 units last year to date and this year to date at least 1.2 times that); declining (at least 10 units and at most 0.8 times); steady (any other item sold this year). Items last sold before `L1` are left out; quantities are compared exactly in thousandths.
- **Since-opening blocks.** Block k covers `history_start + 7(k − 1)` to `history_start + 7k − 1` and counts when it ends on or before `Ye`. Its average per day is the block's net ÷ its days with sales, so a closed day does not lower it. Growth compares the latest complete block with block 1.

## Cards

Each card has a headline, a sentence, a table with a CSV download (UTF-8 with BOM, file `nam-<card>-<year>.csv`, a second table `…-2.csv`) and "Giải thích chỉ số"; most have a chart.

| Card | Headline | Chips | Sentence | Table and chart |
|---|---|---|---|---|
| Doanh thu tháng × năm (`month_matrix`) | net of the peak month, captioned with the month ("chưa hết tháng" when partial) | — | the peak month of the year, then last year's peak month and how this year's compares; when only some stores have last year, both peaks are taken over those stores ("Tính trên k/N cửa hàng có đủ dữ liệu, …"), with a note naming the young store | heat table across the whole card grid: rows `F1`'s year to this year, columns the 12 months and the year total in compact money (the exact amount in the cell's tooltip and in the CSV), "—" without data, the 12 months coloured by quintile; the caption says when the last month is not over |
| Tăng trưởng (`growth`) | the latest complete month against the same month last year | — | the largest rise and fall; the like-for-like note; "Tết rơi vào … năm nay nhưng … năm trước" when January or February leads and Tết moved month | month, net, same month last year, and, when a month compares like for like, the covered stores' net and last year's net it is computed from; change (with its basis), month on month, 3 months against the 3 before on the latest row; bars of the monthly changes, rises and falls in their own tones |
| Mùa vụ và Tết (`seasonality`) | the highest seasonality index, captioned with its month | — | the peak and the low month; the Tết dip this year and last | the 12 window months (net, calendar days, average per day, index with two decimals) and a second table of net and share by weekday this year; lines of weekly net this year and last year by ISO week 1–53 with the Tết weeks of each year marked. Too short: the weekday table stays, with the notice |
| Xu hướng giá trị hóa đơn (`ticket_trend`) | average ticket year to date | last year, like for like when only some stores have it | against last year, then the larger of items per ticket and average item price | per month: average ticket, items per ticket (two decimals), average item price, the covered stores' ticket on a like-for-like month, last year's ticket of the covered stores, change and the two effects; lines of the monthly ticket this year and last year, on an axis that fits the values instead of starting at 0 |
| Vòng đời món (`item_lifecycle`) | the number of new items, captioned with the best new item | — | counts per status, the best new item, the largest discontinued item (by lifetime net); "—" when the year has no item sales | item, stage, first and last sold, quantity this and last year to date, change, net this year to date, by stage then net; bars of the count per stage |
| So với năm trước (`year_over_year`) | net revenue year to date | last year over the same elapsed days, "cùng cửa hàng (k/N)" when only some stores have it | against last year, and, when last year is like for like, "Mức so sánh chỉ tính k/N cửa hàng có đủ dữ liệu: … so với …"; with two or more comparable stores the store that moved most, else the complete month that moved most | several stores: year to date, same period last year, change and the young store's state; one store: rows this year and last year × net, invoices and average ticket; bars per store |
| Từ ngày khai trương (`since_opening`) | average daily net of the latest complete week since opening, "tuần thứ k kể từ khai trương" | — | the growth from week 1 to that week | week, from, to, days with sales, net, average per day, change against week 1 (a store column with several young stores); a line per young store. Only shown while a selected store is young |

The net revenue and average ticket of the year decompose against last year: revenue into invoices × items per ticket × average item price, the ticket into items per ticket × average item price, each part rounded so they add up exactly to the difference shown.

## States and markers

- **Young store.** A store without history on 1 January of last year shows "chưa có dữ liệu năm trước" on the year-to-date chips and in its table row; with several stores the comparison uses the covered stores and reads "· cùng cửa hàng (k/N)". Alone, the year-over-year card adds the notice "{store} mở từ {date}, chưa có dữ liệu năm trước", growth shows it when no month compares, the lifecycle card keeps only new and discontinued items and says why, and the since-opening card follows it week by week.
- **No sales.** A year without sales for the selected stores shows "—" with "Cửa hàng đang chọn chưa có doanh thu trong năm …".
- **No complete month.** Growth waits for the first complete month; the matrix uses the running month, marked partial.
- **Verification.** "chưa đối soát" when a selected store has a day without a matched POS control total in the year; "dữ liệu mẫu" in the demo.
- **Aggregates catching up.** The lifecycle card reads item aggregates and shows "đang cập nhật" while a recent day's aggregates differ from the live totals.

## Owner sheet

The live check (`LIVE=1 … pnpm --filter @fnb/reports test:live`, check 7) reads the matrix headline caption's month (`YYYY-MM`) as Năm's peak month and the year-over-year card's last-year change as the year-over-year change, and compares them with the private sheet given in `LIVE_ACCEPTANCE`.

## Tests

- Unit: `packages/reports/test/unit/reports/year/` (the peak month with and without a complete month, per-month like for like with a young store, seasonality with 11 and 12 months, the Tết dip with a clipped week, lifecycle precedence and its exact 1.2 and 0.8 boundaries, since-opening blocks with a closed day, ISO week 53 of 2026, every card, the call plan).
- Parity: `packages/demo-analytics/test/parity/item-lifecycle.parity.test.ts` compares `item_lifecycle` of the engine with the SQL over D2 for every store set and anchor of the matrix.
- Demo engine: `packages/demo-analytics/test/reports/year.smoke.test.ts` builds every card for three store selections and last year, and checks that the month buckets add up to the year-to-date headline.
- Browser: `apps/web/e2e/demo/report-year.spec.ts` (seven cards settle, the heat table rows, since opening for the young store only, the young store on the year-over-year card, deep link and stepping, CSV with BOM, print, axe at 360 and 1280 px, the 8-second gate at four times slower CPU, no external request, English).
