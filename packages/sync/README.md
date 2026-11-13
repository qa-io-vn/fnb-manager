# `@fnb/sync`

Purpose and audience: the POS-agnostic sync engine. It writes the canonical sales of any connector into the tenant database, detects voids and edits, records POS adjustments, checks every store-day against the POS's own daily totals (`sync_checks`) and refreshes the analytics for the dates it changed. It runs unchanged under Node (the `fnb` CLI) and Deno (the Edge Function). For developers who change how sales reach the database, and for reviewers of reconciliation and idempotency.

Last updated 2026-11-12

## Main exports

| Area | Exports |
|---|---|
| The engine | `SyncEngine` with `syncMasterData` (stores and catalogue), `syncWindow` (a business-date window, store by store) and `syncIncremental` (the last `INCREMENTAL_DAYS` business days of one store, pulling only the days that are unchecked, unmatched or changed) |
| Repositories | `SyncRepository`, the contract for every read and write; `InMemorySyncRepository` for tests; from `@fnb/sync/postgres`: `PostgresSyncRepository`, `createPostgresClient` (asks for TLS on every database host that is not local unless the URL names its own `sslmode`) and `enforcedSsl` (which the Edge Function uses to refuse a URL that allows plaintext) |
| Checks and change detection | `buildChecks`, `totalsMatch`, `DEFAULT_CHECK_TOLERANCE`, `detectChangedDays`, `DAY_REASONS` |
| Budgets and guards | `ConnectorCaller` (`DEFAULT_CALL_BUDGET`, retries with back-off), `RunGuard` with `INCREMENTAL_BUDGET`, `SERVER_INCREMENTAL_BUDGET` and `SUPABASE_FREE_PLAN_EDGE_LIMITS`; `DEFAULT_LOCK_WAIT_MS`, `DEFAULT_WINDOW_LOCK_WAIT_MS`, `STALE_REFRESH_LOOKBACK_DAYS` |
| Mapping | `mapSale`, `mapShift`, `mapCatalog`, `mapAdjustment`, `toDbLineKind`, `planStoreDay`, `deriveStatus` |
| Locks | `storeLockKey`, `storeWindowLockKey` (advisory locks per store), `StoreLockBusyError` |
| Redaction | `createRedactor`, `safeErrorMessage`, `describeError` |

Two runs over the same window change nothing: unchanged sales are not written, events are keyed, and every list is written in external-id order.

## Who uses it

`@fnb/runner` and `apps/jobs` run it; the Edge Function imports `@fnb/sync` and `@fnb/sync/postgres`; `@fnb/notify` builds its test fixtures with it; `@fnb/demo-analytics` maps the demo's line kinds with `toDbLineKind`. Because the Edge Function imports it, run `node scripts/function-imports.mjs` after adding or moving a file here.

## Tests

```sh
pnpm --filter @fnb/sync run test --maxWorkers=2
DATABASE_URL=<local database URL> pnpm --filter @fnb/sync run test --maxWorkers=2
pnpm --filter @fnb/sync typecheck
```

- The unit tests run the engine on the in-memory repository with fake and mock connectors: master data, mapping, business dates, windows (voids and edits found by re-pulling, robustness), checks, sale payloads, run bookkeeping, change detection, the incremental window and run, the run guard and the TLS rules of the Postgres client.
- `test/integration/postgres-repository.test.ts` runs only with `DATABASE_URL` set in the shell (tests do not read `.env`). It creates its own tenants (slugs `it-repo-…` and `it-overlap-…`) and deletes them at the end.

## Read more

- [docs/sync.md](../../docs/sync.md): the engine design, one window for one store, idempotency, run bookkeeping, the incremental runner, change detection and the CPU and wall-time guard.
- [docs/schema.md](../../docs/schema.md): the tables it writes.
- [docs/decisions.md](../../docs/decisions.md): ADR-020 (two runners, one sync engine), ADR-027 (sale payloads in one document per store-day), ADR-028 (single-use tickets for the scheduled calls).
