# `@fnb/metrics`

Purpose and audience: the typed metric registry, mirrored from [docs/metrics.md](../../docs/metrics.md): every metric's id, Vietnamese and English labels, unit, formula, grains, direction, source, report mapping and status, plus the benchmark context kept apart from them (ADR-026). Reports, the web app, and later the data pack, digests and KPI follow-up read their definitions from here. For developers who add or change a metric and for reviewers who check that the code, the document and the SQL agree.

Last updated 2026-11-12

## Main exports

| Area | Exports |
|---|---|
| The registry | `metrics` (41 metrics on 2026-11-12, in six groups: sales, time, baselines, menu, cash, customers), `metricById`, `findMetric`, `isMetricId`, `metricsForReport`, `metricsInGroup` |
| `metric_value` | `metricValueIds()`: the 21 ids that `public.metric_value` computes (available now, with a store-day or store-period value); `isAvailableNow`, `isComputedByMetricValue`, `hasStorePeriodValue` |
| Benchmark context | `benchmarkContext` (10 entries of published market figures, never mixed with a tenant's metrics) |
| Vocabularies | `metricGroups`, `reportNames` (the Vietnamese report names, such as Hôm nay, Ngày, Thực đơn), `periodicReports`, `metricGrains`, `storeGrains`, `metricDirections`, `metricStatuses`, `metricUnits` |

The package has no runtime dependency.

## Who uses it

`@fnb/reports` (card metrics and report mapping), `apps/web` (labels, directions and units of every metric a card shows; its tests require the labels to equal the registry's exactly), and the parity tests of `@fnb/demo-analytics`.

## Tests

```sh
pnpm --filter @fnb/metrics run test --maxWorkers=2
pnpm --filter @fnb/metrics typecheck
```

- `test/unit/registry.test.ts`: lookups, report mapping, groups and the `metric_value` ids.
- `test/consistency/document.test.ts`: the registry equals `docs/metrics.md` field by field, with the same ids in the same order, and every metric has both labels, a unit, a formula, a grain, a direction, a source, a status and a report.
- `test/consistency/metric-value.test.ts`: the ids dispatched by the latest migration that defines `public.metric_value` equal `metricValueIds()`, and any other id is refused with SQLSTATE `22023`.

## Read more

- [docs/metrics.md](../../docs/metrics.md): the conventions, the 41 metrics, the report conventions and the benchmark context.
- [docs/development.md](../../docs/development.md#add-a-metric): adding a metric end to end.
- [docs/deep-dives/fnb-kpi-standards.md](../../docs/deep-dives/fnb-kpi-standards.md): the KPI methods behind the formulas.
