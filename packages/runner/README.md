# `@fnb/runner`

Purpose and audience: the wiring both sync runners share around the engine of `@fnb/sync`: the `POS_ACCOUNTS_JSON` entries, connector sessions with the database token cache, the incremental run of one store, the `Notifier` and the dead-man's switch. The `fnb` CLI (Node) and the Edge Function `sync-incremental` (Deno) both build on it, so a store syncs the same way under either runner. For developers who change how a run starts, authenticates, stops or reports.

Last updated 2026-11-12

## Main exports

| Area | Exports |
|---|---|
| Account entries | `parseAccountEntries`, `accountEntrySchema` (a union of `iposAccountSchema` and `mockAccountSchema`), `entryForKey`, `ACCOUNTS_VARIABLE` (`POS_ACCOUNTS_JSON`), `CREDENTIAL_FIELDS`, `AccountConfigError` |
| Connectors | `createConnectorRegistry` (`ipos-fabi` and `mock`), `connectAccount`, `credentialsFor`, `IPOS_APP_KEY_VARIABLE`, the token stores `repositoryTokenStore` and `readOnlyTokenStore` |
| Real or fake iPOS | `iposApiMode` reads `IPOS_REAL_API` (`on` or unset: the real API; `off`: the local snapshot; anything else an `AccountConfigError`), and `connectAccount` applies it: with `off` an `ipos-fabi` session answers from `IposSnapshots.open(key)` and never calls `fetch`, with `on` it records into `IposSnapshots.recordTo(key)` when that returns a storage. `iposModeLine`, `snapshotCoverage`, `requestCountText`; `guardIposTenant`, `sourceConflict`, `IposSourceError` and `SNAPSHOT_TENANT_SLUG` (`mock-local`) keep snapshot data and real data in separate tenants |
| `@fnb/runner/snapshot-files` | Node only, never imported by the Edge Function: `snapshotDirectory` (`.ipos-snapshot/` or `IPOS_SNAPSHOT_DIR`), `createFileSnapshotStorage`, `createFileSnapshots` (records only into a folder that exists) and `replaceAccountSnapshot` |
| The incremental run | `runIncrementalStore`, `markAuthFailed`, `clearAuthFailure`; the budget from `FNB_INCREMENTAL_WALL_MS` and `FNB_INCREMENTAL_CPU_MS` (`edgeFunctionBudget`, `EDGE_FUNCTION_BUDGET_LIMITS`: at most 390,000 ms wall and 2,000 ms CPU) |
| Dead-man's switch | `DEAD_MAN_THRESHOLD_MINUTES` (90 minutes of opening time without a successful sync), `checkPreviousDayFreshness`, `isStale` |
| Notifier | `Notifier`, `ConsoleNotifier`, `MemoryNotifier`, `notifySafely`, `NOTIFICATION_KINDS` (`run_failed`, `auth_failed`, `sync_stale`), `runFailedNotification`, `authFailedNotification`, `staleSyncNotification` |
| Labels and secrets | `accountLabel`, `storeLabel`, `collectSecretValues`, `accountSecretValues`, `databaseUrlSecrets` |
| `@fnb/runner/postgres` | `PostgresRunnerDatabase`: claims a single-use ticket with `app.claim_incremental_sync_ticket`, reads `app.incremental_sync_watched`, `app.sync_gap_minutes`, `app.longest_sync_gap_minutes` and whether the schedule is enabled, and reads or claims a tenant's iPOS source (`app.tenant_ipos_sources`, `app.claim_ipos_source`) |

Since step 12b of phase 12, the CLI wraps `ConsoleNotifier` with the outbox notifier of `@fnb/notify`; the Edge Function still reports through `ConsoleNotifier` only.

## Who uses it

`apps/jobs` (every `fnb` command that talks to a POS), the Edge Function `sync-incremental` (`@fnb/runner` and `@fnb/runner/postgres`) and `@fnb/notify`. Because the Edge Function imports it, run `node scripts/function-imports.mjs` after adding or moving a file here. A new connector is wired in here ([development.md](../../docs/development.md#add-a-pos-connector)).

## Tests

```sh
pnpm --filter @fnb/runner run test --maxWorkers=2
pnpm --filter @fnb/runner typecheck
```

Unit tests in `test/unit` (accounts, budget, dead-man's switch, incremental run, notifier, the iPOS mode and its tenant guard, the snapshot files, and the `sync-incremental` handler's answer to `IPOS_REAL_API`, which `vitest.config.ts` resolves through aliases) run on a test bed in `test/support/bed.ts` and the small snapshot of `test/support/snapshot.ts`. The SQL functions that `PostgresRunnerDatabase` calls are covered by the pgTAP files `20_incremental_schedule.sql` and `21_sync_freshness.sql`.

## Read more

- [docs/sync.md](../../docs/sync.md): the incremental runner, the Notifier and dead-man's switch, the Edge Function and its schedule.
- [docs/secrets.md](../../docs/secrets.md): the `POS_ACCOUNTS_JSON` entry shapes and the Edge Function secrets.
- [docs/decisions.md](../../docs/decisions.md): ADR-006 (credentials never in the database or the repository), ADR-020 and ADR-028.
