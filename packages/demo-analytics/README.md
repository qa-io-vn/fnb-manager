# `@fnb/demo-analytics`

Purpose and audience: the analytics engine of the browser demo. It generates the demo tenant's days with `@fnb/connector-mock`, aggregates them the way the database refresh does, and answers the 16 report functions of `@fnb/reports` in TypeScript with Postgres-exact arithmetic. A parity suite holds it equal to the SQL, digit for digit (ADR-029). For developers who change a report function, the demo calendar or the demo's numbers, and for reviewers of the parity evidence.

Last updated 2026-11-14

## Main exports

| Area | Exports |
|---|---|
| The source | `createDemoAnalyticsSource(options)`, an `AnalyticsSource` over the generated days; `handlers`, one per report function (the type requires all 16), and `reads`; `createDemoReportSource(options)`, which adds `callTheme` for the thematic functions (`themeHandlers`, `themeReads`) over the same days |
| Demo settings | `DemoSettingsStore` and `demoSettings()`: the in-memory report thresholds and store profiles of the demo (`MOCK-S1` code CH1 with 40 seats, `MOCK-S2` code CH2 without seats), each store's POS account, item-type roles per account, category overrides and item costs, read by `report_settings_of`, `hour_profile` and `opening_productivity`. The store is also the ingest's `IngestMappings`: a write to accounts, roles or overrides moves `ingestVersion`, and the day cache then re-ingests cached days from their kept raw day, as the refresh catches up after a mapping change |
| The demo calendar | `DEMO_SEED` (20261108), `DEMO_TIME_ZONE` (`Asia/Ho_Chi_Minh`), `DEMO_TENANT_ID`, `demoStores(asOf)`: `MOCK-S1` "Cửa hàng mẫu 1" (opened `ESTABLISHED_STORE_OPENED_ON`, 2024-12-02, with monthly targets) and `MOCK-S2` "Cửa hàng mẫu 2" (a young store, `youngStoreOpenedOn(asOf)`); public holidays and closed Tết days, menu changes (`demoMenu`, `LAUNCHED_DRINKS`, `RETIRED_DRINK`, `SEASONAL_DRINK`), member phone capture from `CAPTURE_FROM` (2026-10-01) |
| Days and aggregates | `DemoDayCache` and `sharedDemoDays` (each store-day generated in its own task and cached; raw days kept for `RAW_DAY_RETENTION_DAYS`, 70), `AggregateStore`, `aggregateStoreDay`. Besides phase 9's aggregates, a store-day holds the invoices with an item line, the count of each unordered item pair (keys in byte order, joined by `PAIR_SEPARATOR`) and each drink item's invoices with a topping and with a snack, all under the roles and overrides of the store's POS account (`mappings.ts`, `DEFAULT_INGEST_MAPPINGS` without settings) |
| Ports | `metricValue` and `METRIC_VALUE_IDS` (the port of `public.metric_value`), `sameWeekdayBaseline`, `seriesBuckets`, the argument guards `requireStoreIds`, `requireDateRange`, `requireReportRows` (`MAX_REPORT_ROWS`, 900) |
| Postgres-exact numerics | `PgDecimal`, `percentileContMedian`, `roundedMedian`, `roundedRatio`, `stddevSample`, `float8ToNumeric`, `numericToFloat8` |

The demo anchors its calendar to today in Asia/Ho_Chi_Minh, so its numbers move with the date; "Cửa hàng mẫu 2" always opens about two months before the current month, which keeps the young-store states visible.

## Who uses it

`apps/web` in demo mode, through the demo `RowSource` and `AnalyticsSource` in `apps/web/src/demo/`. Both load by dynamic import and make no network call, so a live session does not download them unless the demo is opened.

## Tests

```sh
pnpm --filter @fnb/demo-analytics run test --maxWorkers=2
DATABASE_URL=<local database URL> pnpm --filter @fnb/demo-analytics test:parity:postgres
pnpm --filter @fnb/demo-analytics typecheck
```

- `test/unit`: the calendar, the day cache, the dressing of generated days, ingestion into aggregates, the numerics and the source.
- `test/reports/*.smoke.test.ts`: every card of Ngày, Tuần, Tháng and Năm built on the demo engine for three store selections, with the message keys and placeholders.
- `test/parity/*.parity.test.ts` (aggregates, calendar, core functions, forecasts, item lifecycle, item velocity, `metric_value`, and the thematic `range_totals`, `hour_weekday_heatmap`, `opening_productivity`, `hour_profile` and `report_settings_of` with the default and a tenant's thresholds): by default inside `pnpm test`, every migration runs in PGlite, the parity datasets are loaded, and each ported function is compared with the SQL.
- `test:parity:postgres` runs the same files on Postgres (`PARITY_DATABASE=postgres`, `DATABASE_URL` set in the shell). It loads its datasets as `parity-…` tenants, deletes them at the end, and refuses a database that holds any tenant whose slug does not start with `demo-` or `parity-`, so it runs in CI's `database` job or on a stack without real data.
- The Vitest configuration runs the files one at a time (`fileParallelism: false`) with long timeouts (120 s per test, 240 s per hook).

## Read more

- [docs/web-app.md](../../docs/web-app.md#phase-9-decisions): the data path, the demo calendar and the size budget.
- [docs/schema.md](../../docs/schema.md#report-functions-phase-9): the SQL functions it ports.
- [docs/development.md](../../docs/development.md#add-a-report-card): changing a report function and its port together.
