# `@fnb/reports`

Purpose and audience: the periodic reports Ngày, Tuần, Tháng and Năm as language-neutral models, and the typed contract of the report SQL functions they read. Every number comes from SQL; this package adds only what sits on top of the rows: changes, the exact decomposition, like-for-like selection, rankings, statuses and sentence parts (ADR-029). The web app renders its card models, the daily digest of phase 12 is built from the Ngày model, and the data pack and KPI follow-up will reuse them. For developers who add or change a report card and for reviewers of report logic.

Last updated 2026-11-15

## Main exports

| Area | Exports |
|---|---|
| The SQL contract | `analyticsFunctions` and `analyticsFunctionNames` (16 functions: `store_coverage`, `period_compare`, `period_compare_by_store`, `period_series`, `daily_baselines`, `hourly_profile`, `metric_compare`, `item_summary`, `payment_summary`, `promotion_summary`, `shift_review`, `store_targets`, `item_velocity`, `month_pace`, `forecast_accuracy`, `item_lifecycle`), their argument and row schemas, `MAX_STORE_IDS` (50) |
| Sources | `AnalyticsSource`; `createRpcAnalyticsSource(client)`, which calls the functions with `supabase.rpc()` and treats 1,000 rows or more as possibly truncated (`TRUNCATION_ROW_LIMIT`, `possible_truncation`); `AnalyticsCallError`, `isArgumentLimitError` (SQLSTATE `22023`) |
| Reports | `reportDefinitions`, `dayReport`, `weekReport`, `monthReport`, `yearReport`; card lists `dayCards` (9), `weekCards` (8), `monthCards` (10), `yearCards` (7); `runReport(definition, context, source)` |
| Card models | `CardModel` (headline, comparisons, decomposition, narrative parts, tables, chart, notice, markers), comparisons and coverage (`comparison`, `coverageModel`, `likeForLikeLabel`), the exact decomposition (`decomposeNet`, `decomposeTicket`), the narrative (`narrate`, `strongestDriver`), tables, `csvName`, the message keys (`reportKeys`, `sharedReportKeys`) |
| Thematic reports (phase 10) | `themeFunctions` (the second registry: `report_settings_of`, `range_totals`, `opening_productivity`, `hour_weekday_heatmap`, `hour_profile`, and the menu, basket and modifier functions still in progress), `ARGUMENT_SQL_TYPES` for both registries, `ReportSource` with `callTheme` and `createRpcReportSource(client)`, ranges (`rangeOfPreset`, `customRange`, `resolveRange`, `stepRange`, `seriesGrain`, presets 7, 28, 91 and 364 days, this month, last month, this year; at most 400 days, 92 for shifts), `ThemeDefinition` and `runTheme`, `comparisonsFromRangeRows`, `DEFAULT_REPORT_SETTINGS` (ADR-035, ADR-036); the promotion rule helpers on top of `@fnb/core`'s `promotionRules`: `isRuleInForce`, `rulesInForce`, `ruleInForce`, `ruleSegments` (a range split where a rule version starts or ends, each part with its version or none), `discountClass(discount, base, cap)` (a discount of the whole amount before it is `full`, never `over_cap`; within `DISCOUNT_RATE_EPSILON`, which the 10b SQL checks must use too), `luckyDrawKeywordsOn` and `luckyDrawMatches` (NFC, case-insensitive, whole words joined by spaces, `_` or `-` or nothing; a match found only without tone marks is reported as possible) |
| Periods | `REPORT_KINDS`, `periodKey`, `parsePeriodKey`, `periodContaining`, `stepPeriod`, `switchKind`, ISO weeks (`isoWeekOf`, `isoWeekKey`), `asOfDate`, `BASELINE_WEEKS` (8), `FIRST_CALENDAR_DATE` (2023-01-01) |

The package is marked `sideEffects: false`, so the web bundler can split it. Runtime dependencies: `@fnb/core`, `@fnb/metrics` and `zod`.

## Who uses it

`apps/web` (the report pages and the live analytics source), `@fnb/demo-analytics` (the demo answers the same contract), `@fnb/notify` (the digest is the Ngày report built as its recipient) and `apps/jobs`.

## Tests

```sh
pnpm --filter @fnb/reports run test --maxWorkers=2
DATABASE_URL=<local database URL> pnpm --filter @fnb/reports test:live
DATABASE_URL=<local database URL> LIVE_REFERENCE_SHEET=<private sheet> pnpm --filter @fnb/reports test:live
pnpm --filter @fnb/reports typecheck
```

- The unit tests build every card from fixtures in `test/unit/reports/<day|week|month|year>/`, test the theme ranges, planning, comparisons, RPC source and promotion rule helpers in `test/unit/themes/`, and test periods, the as-of day, coverage and comparisons, the decomposition and narrative, numerics, totals, definitions and the RPC source.
- `test:live` (the script sets `LIVE=1`) is a read-only check on the local tenant (`LIVE_TENANT`, default `live-local`; `LIVE_SEED`, default 20261108): the report headlines against the POS control totals, `metric_value` and `period_series`. `LIVE_ACCEPTANCE` can name a private file for the owner's sheet check; it never comes from the repository.
- The same command runs the theme live check (`test/live/theme-live-check.test.ts`) one file after the other, so each call is timed alone, and with the default reporter, so the printed lines show in every terminal. Every call runs as the tenant's owner in a read-only transaction, one at a time:
  - the four theme pages at their default range against the per-function and page budgets of [test-plan §2.9](../../docs/test-plan.md#29-live-data-checks), and at 400 days against the 1.5 s limit;
  - the reference window when `LIVE_REFERENCE_SHEET` names the owner's private sheet (a path from the repository root, or absolute; the sheet stays in `docs/private/`). `test/live/reference-sheet.ts` reads it and `test/live/reference-facts.ts` builds the compared values from `hour_profile`, `hour_weekday_heatmap`, `range_totals` and `payment_summary`. The payment mix is compared as shares of invoices, because the sheet counts invoices per payment method. Unset, the check prints `owner check pending` and passes;
  - modifiers never counted or returned as items, over the window and the last 365 days. A modifier is a catalogue item flagged as one, or a key sold on modifier lines. `item_attach` and `basket_pairs` stop at 92 days, so the year is read in 91-day chunks;
  - the cash thresholds (the defaults while the tenant has no settings row) leaving `shift_review` and `cash_variance_flags` unchanged;
  - `report_settings_of` and `analytics_catch_up_status`;
  - the tenant's row counts before and after.

  It prints only booleans, counts and durations (`row <n> column <k>: matches: true|false`), never a figure, a name or a label from the sheet. Its parser is unit-tested in `test/unit/themes/reference-sheet.test.ts` on a synthetic sheet with made-up stores and figures.
- The demo smoke tests and the parity suite in `@fnb/demo-analytics` run these reports on the TypeScript port.

## Read more

- [docs/reports/ngay.md](../../docs/reports/ngay.md), [tuan.md](../../docs/reports/tuan.md), [thang.md](../../docs/reports/thang.md), [nam.md](../../docs/reports/nam.md): period, calls, cards, states and tests of each report.
- [docs/reports/doanh-thu.md](../../docs/reports/doanh-thu.md), [gio-ngay.md](../../docs/reports/gio-ngay.md), [thuc-don.md](../../docs/reports/thuc-don.md), [thanh-toan.md](../../docs/reports/thanh-toan.md): range, calls, cards, states and tests of each thematic report.
- [docs/reports/cau-van-bao-cao.md](../../docs/reports/cau-van-bao-cao.md) and [cau-van-chu-de.md](../../docs/reports/cau-van-chu-de.md): every Vietnamese sentence of the periodic and of the thematic reports and Settings, for the owner's wording review.
- [docs/web-app.md](../../docs/web-app.md#phase-9-decisions): how the web app loads and shows the reports ([phase 10 decisions](../../docs/web-app.md#phase-10-decisions) for the thematic reports and Settings).
- [docs/decisions.md](../../docs/decisions.md): ADR-029 (report numbers come from SQL), ADR-035 (thematic reports) and ADR-036 (thresholds, mappings and the catch-up).
- [docs/development.md](../../docs/development.md#add-a-report-card): adding a report card.
