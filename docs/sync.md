# Sync engine and the `fnb` CLI

The sync turns what a POS connector emits (`@fnb/connector-core`'s `PosConnector`, canonical records from `@fnb/core`) into the tenant database described in `docs/schema.md`. It is roadmap phase 5 (onboarding, windows, status, doctor) and phase 7: the Node runner and the Edge Function runner. These parts carry it:

| Part | Role |
|---|---|
| `packages/sync` (`@fnb/sync`) | The runtime-agnostic engine: mapping, store-day planning, void and edit detection, adjustments, checks, run bookkeeping, and the incremental operation with its change detection and CPU and wall-time guard. `"."` exports the engine and an in-memory repository; `"./postgres"` exports the Postgres repository |
| `packages/runner` (`@fnb/runner`) | What both runners share around the engine: the `POS_ACCOUNTS_JSON` entries, connector sessions with the database token cache, the incremental run of one store, the `Notifier` and the dead-man's switch. `"./postgres"` exports the ticket and freshness queries |
| `apps/jobs` (`@fnb/jobs`) | The `fnb` CLI used locally and by `.github/workflows/sync.yml` |
| `supabase/functions/sync-incremental` | The Edge Function runner on the Supabase Edge Runtime (Deno 2), called by `pg_cron` through `pg_net` every 30 minutes for each store that is open |

## Engine design

### Repository interface

Every database read and write the engine needs goes through `SyncRepository` (`packages/sync/src/repository.ts`). Each method is one unit of work that takes and returns plain JSON-shaped rows (column names as in the migrations, timestamps as ISO strings, numerics as fixed-scale strings), so an implementation backed by Postgres functions called over RPC can be added later without touching the engine.

| Method | Purpose |
|---|---|
| `findAccounts(key, tenantSlug?)`, `upsertAccount(row)` | Account metadata (`pos_accounts` joined with the tenant's slug and currency) |
| `updateAccountStatus(accountId, status, from)` | Sets `pos_accounts.status` only when the current status is one of `from`, and says whether it changed; the runners use it to set and clear `auth_failed` |
| `findStore(storeId)` | A store with its account, for a runner that starts from a store id |
| `readToken(accountId)`, `writeToken(accountId, token)` | The POS session token cache (`pos_account_tokens`) |
| `listStores(accountId)`, `upsertStores(account, stores)` | Stores of an account; the upsert refreshes name, address, timezone and day start, keeps a known opening date, and marks stores the POS no longer lists inactive |
| `replaceCatalog(write)` | Upserts each catalogue table of the account and marks missing rows inactive; a table the connector cannot provide is passed as `null` and left untouched |
| `paymentMethodKinds(accountId)` | `payment_methods.kind` by external id, for expected shift cash |
| `withStoreLock(storeId, work, options?)` | Runs one store's whole window (pull, read, plan, writes, checks) while holding that store's window lock, so overlapping runs on one store queue instead of planning from the same snapshot; with `{ waitMs }` it gives up after that long with `StoreLockBusyError` instead of queueing |
| `loadStoreWindow(storeId, range, referencedIds)` | Stored invoices of the window (plus any referenced by id) with their sale time, digest and line-set key, and the stored `invoice_events` of those invoices |
| `applyStoreDay(write)` | One store-day in one transaction: invoice upserts with their lines and payments replaced, status changes, events; in Postgres also the payloads of the written sales into the day's `sale_payloads` document |
| `applyAdjustments(write)` | POS-reported adjustment events and the status changes they imply, in one transaction |
| `shiftPaymentTotals(storeId, range, shiftIds)` | Tenders per shift and payment method of the stored non-voided invoices of those shifts, business dates from one day before the range to one day after it |
| `upsertShifts(storeId, rows)`, `upsertChecks(rows)` | Shifts and `sync_checks`, written only when a value changed |
| `localDayTotals(storeId, range)` | Non-voided invoice count and net per business date, for the checks |
| `loadChecks(storeId, range)` | The stored `sync_checks` rows of a range, for change detection |
| `openRun(start)`, `closeRun(id, finish)`, `markAccountSynced(id, at)` | `sync_runs` bookkeeping, including the run's `store_id` and `store_ids`, and `pos_accounts.last_synced_at` |
| `staleAnalyticsDates(storeId, range)` | Dates of the store in the range whose `sync_checks` row is newer than every finished analytics refresh covering them (`app.stale_analytics_dates`), for the incremental run to refresh again |
| `refreshAnalytics(tenantId, range)` | Calls `app.refresh_analytics(p_tenant, p_from, p_to)` when `to_regprocedure` finds it, otherwise reports it unavailable; the refresh also shrinks the tenant's pending catch-up range when the window covers one of its ends |

`createPostgresClient` asks for TLS (`sslmode=require`) for every database host that is not local (loopback, `host.docker.internal`, the local stack's database container by its name `supabase_db_*` or its network aliases `db` and `db.supabase.internal`) unless the connection string carries its own `sslmode`; postgres.js would otherwise connect in plaintext, because it uses TLS only when told to. `PostgresSyncRepository` implements it with postgres.js: parameterised SQL only (table and column names come from fixed lists in the package), multi-row inserts batched under the parameter limit, `sql.begin` transactions and two advisory locks, both keyed by a stable 64-bit FNV-1a hash of a namespaced store id:

- the window lock, `pg_advisory_lock` on `fnb-sync:store-window:<store id>` (`storeWindowLockKey`), taken by `withStoreLock` on a reserved connection and released in `finally` (or by Postgres when the connection drops). With a wait limit the lock is polled with `pg_try_advisory_lock` every 250 ms until the limit passes. A window run waits at most 10 minutes for each store (`DEFAULT_WINDOW_LOCK_WAIT_MS`) and then fails with "another sync run held the store's window lock for longer than 600000 ms", so a run that hangs elsewhere never blocks the nightly job without a word; the incremental run waits 15 seconds. It covers the read-plan-write cycle: a second run on the same store waits, then reads what the first one wrote and plans nothing twice. A resync event's `occurred_at` is its run's detection time, so the unique key alone could not stop two overlapping runs from each recording the same void; the window lock does. It is a session lock, so it needs a session-mode connection (the direct host or the session pooler, never the transaction pooler) and a pool of at least two connections;
- the write lock, `pg_advisory_xact_lock` on `fnb-sync:store:<store id>` (`storeLockKey`), at the start of every store-scoped write transaction, so a writer that does not take the window lock still never interleaves with another.

Text and `raw` payloads lose any U+0000 before they reach SQL (Postgres rejects it in `text` and `jsonb`); the mapping does the same, so the stored digest still equals the incoming one, and the run raises `nul_character_removed`. `InMemorySyncRepository` implements the same contract with copy-on-write transactions, a queue per store for the window lock and lock logs for unit tests; it is split like the Postgres side (`memory/accounts.ts`, `catalog.ts`, `sales.ts`, `bookkeeping.ts`, `locks.ts`).

### Runners

The engine (`SyncEngine`) is constructed with a repository, an authenticated connector, a clock, a redactor and optional call-budget, retry and tolerance settings. It offers three operations:

- `syncMasterData(account)` discovers the stores, writes them with the timezone and business-day start from the connector's store descriptor, fetches the catalogue of every active store, merges it per account and replaces the catalogue tables: item types and classes, items (class resolved by name, cost only when the connector declares `costs`), packages, customizations (the connector's modifiers), sources, payment methods (kind from `classifyPaymentKind` in `@fnb/core`, falling back to the connector's own kind when the name says nothing) and promotions. Units and devices have no canonical source yet and are left as they are.
- `syncWindow(account, stores, window, kind)` runs the steps below for each store in external-id order, each inside `withStoreLock`, then refreshes analytics for the window and for every earlier date a run changed (see step 5).
- `syncIncremental(account, store, options)` checks one store's last three business days against the POS daily totals and runs the same steps only for the days that changed (see "Incremental runner" below).

Two runners construct it. The Node CLI (`apps/jobs`) serves the owner and GitHub Actions (nightly, backfills, and `fnb sync incremental` for a deployment that schedules from a small server). The Edge Function `sync-incremental` serves `pg_cron`. Both build the connector, the token cache and the incremental run from `@fnb/runner`, and both use `PostgresSyncRepository` with the same advisory locks, so the Edge Function never overlaps the nightly job or the CLI on a store.

### One window, one store

1. Pull through the connector: `collectSales(fetchSales(...))`, then adjustments, control totals and shifts when the connector declares those capabilities. Every connector call goes through `ConnectorCaller`: a per-run budget (default 400 calls, each call may be several HTTP requests) and up to three attempts with exponential backoff from one second (a rate-limit error's `retryAfterMs` wins). Authentication, schema and capability errors are not retried. The iPOS transport gives each HTTP attempt 30 seconds for its answer and body (`requestTimeoutMs`) and retries a timed-out attempt like a network error, so no POS call can hang a run. An incremental run also hands every call its deadline (`FetchContext.signal`, see "CPU and wall-time guard"); once it passes, the caller retries nothing and settles the call at once, even with a connector that ignores the signal.
2. Assign business dates from the stored store row with `businessDate(soldAt, timezone, business_day_start_minutes)`. A connector date that disagrees raises `business_date_reassigned`; a sale outside the window is dropped with `sale_outside_window`; a repeated sale id keeps the last copy with `duplicate_sale_id`.
3. Map each sale (`mapSale`): receipt number into `receipt_no` (receipts are identified by store + business date + receipt number because numbering resets daily or yearly; a repeat inside a store-day raises `duplicate_receipt_key`), channel into `sale_type`, customer phone and name, voucher code, name and amount, bill discount and its name, money at scale 2 and quantities at scale 3, blank text as null, a guest count of 0 as null, the largest tender as primary payment, the full payload in `raw`. Lines keep their kind (`package_component` is stored as `item` with `package_external_id` taken from its parent line's item) and their own `raw` without the fields whose value equals the invoice payload's, and so do payments (`docs/schema.md`, storage rule); `parent_line_external_id` is set on modifier lines only and null on item lines, as the column is defined (a priced topping that the connector classifies as an item is a top-level item line); payments are numbered by `sequence_no` in list order and carry the invoice's business date.
4. Plan and apply each business date (`planStoreDay`, then `applyStoreDay` in one transaction under the store lock). `PostgresSyncRepository` writes the payloads of the inserted and rewritten sales into the day's `sale_payloads` document through `app.store_sale_payloads`, before the invoice rows, and stores null in their `raw` columns:
   - a new sale is inserted;
   - a stored sale whose digest (every mapped column except `raw`, `status` and the ids) changed is rewritten: invoice upserted, lines and payments replaced. When its net amount or its line set (line ids, items and quantities) changed and the POS reported no edit for it, one `edited` event is recorded with `source = resync_diff`, the absolute difference as amount and the detection time as `occurred_at`;
   - a stored sale whose digest is unchanged is not written at all; only a status that has to change is updated;
   - a stored sale of that date that the re-pull no longer contains becomes `voided` with one `voided` event (`resync_diff`, the stored net as amount), unless the POS already reported the void or the sale is the pre-edit original that an `edited` adjustment replaced (that one is voided silently, the edit event covers it). When a re-pulled day comes back empty, it is voided only when the control totals confirm it: the connector declares control totals, the call succeeded and the day has no row or a zero count (the same reading the checks use). Otherwise nothing is voided and `empty_day_kept` is raised;
   - before voiding, the stored sale's business date is recomputed from `sold_at` with the store's current timezone and day start. When that date now falls outside the window (the store's day start or timezone changed since the sale was stored), the sale is not voided: it still exists on the POS, the run raises `business_date_moved_out_of_window`, and the next window that covers its new date re-dates it (invoice and payments) without an event;
   - a sale that comes back on a date other than its stored one is rewritten with the new date, and its old date counts as touched.
5. Adjustments, when declared: de-duplicated by `adjustmentKey` from `@fnb/core`; two adjustments that share the stored unique key (`store_id, invoice_external_id, kind, occurred_at`) are merged into one event whose amount is their sum and whose `raw` lists both (`adjustments_merged`). They are inserted with `source = pos_report` and `on conflict do nothing`, so re-runs insert nothing twice. A reported void makes the invoice `voided`; an edit or removed line makes a `completed` invoice `edited`. Adjustments are fetched by when they happened, so one inside the window can change a sale dated before it: that sale's business date is a touched date. Touched dates are refreshed in analytics together with the window (contiguous dates merged into one `refresh_analytics` call each), and their checks are recomputed from fresh control totals of that day, one connector call per date.
6. Shifts, when declared: upserted with `expected_cash_amount` = opening float + cash tenders of the shift after the store-days and adjustments are applied: the stored non-voided invoices of the shift with business dates from one day before the window to one day after it (the same span the analytics refresh uses for `agg_shift_cash`), method kind from `payment_methods`, else the tender's own kind.
7. Checks, when the connector declares control totals: one `sync_checks` row per store-day with the POS count and net against the stored non-voided count and net. A day without a control-total row counts as zero receipts. `is_matched` needs the exact count and a net within the larger of 1,000 and 0.05 % of the POS net (`DEFAULT_CHECK_TOLERANCE`, inclusive). Without control totals no row is written: the day stays unverified rather than matched, and the run records `checks: "unavailable"`.

Status is derived, never stored blindly: `voided` when the connector says so or a POS void was reported, `edited` when the connector says so or an edit, removed line or resync edit is on record, otherwise `completed`. Because the derivation reads the stored events, a second run computes the same status and writes nothing.

### Idempotency

Two consecutive runs over the same window change nothing: unchanged sales, shifts and checks are not written, events are keyed, and the run's per-table counts are all zero. The unit tests compare full in-memory snapshots and the integration test compares an `md5` over every row of the six sales tables of the tenant before and after the second run. Every list the engine writes is sorted by external id first, so the order of writes is deterministic.

### Run bookkeeping

Every non-dry run opens a `sync_runs` row (`kind`, `range_start`, `range_end`, `started_at`, `triggered_by`, and `store_id` when the run covers one store: every incremental run, and a window run given a single store) and closes it with `finished_at`, `status` and `rows_upserted`. The CLI's `--kind manual` is recorded as `backfill` because `sync_kind` has no manual label; master-data runs are `master_data`. `rows_upserted` holds the rows written per table and a `summary` object:

```json
{"invoices": 0, "invoice_events": 0, "summary": {"connector_calls": 4, "retries": 0, "flags_warn": 0, "flags_info": 0, "checks": "available", "checks_unmatched": 0, "refresh": "refreshed", "refresh_ms": 30}}
```

A failure closes the run as `failed` with an `error_message` passed through the redactor (literal credentials, connection-string users and passwords, JWTs, `sb_` keys, 32-hex keys and `password=`-style pairs become `***`), truncated to 500 characters. The transaction of the failing store-day rolls back and its advisory lock is released with it; earlier store-days stay committed and the next run completes the window. `last_synced_at` moves only after a successful window. An incremental run that stopped cleanly before syncing every changed day closes as `partial` (see "Incremental runner"). A failing analytics refresh leaves the run succeeded with an `analytics_refresh_failed` warning, because the facts are correct. A window run refreshes its whole window, so the next run of that window repairs it. An incremental run refreshes only what it synced, so coverage is kept durable: before pulling, it asks for the store's dates of the last 14 days whose `sync_checks` row was written after the start of every finished refresh covering them (`app.stale_analytics_dates`) and refreshes those too, without pulling them again (`analytics_refresh_retried`, `stale_days_refreshed`). A date that a run committed but never refreshed (the refresh failed, a later day failed, the worker was killed) is therefore refreshed by the next incremental run of the store, within 30 minutes. A day the POS changed without moving its count or net keeps its check, so it waits for the nightly refresh, as its data does.

### Data-quality flags

Connector flags arrive through `context.onFlag`; the engine adds its own (`business_date_reassigned`, `business_date_moved_out_of_window`, `sale_outside_window`, `duplicate_sale_id`, `duplicate_line_id`, `duplicate_receipt_key`, `nul_character_removed`, `package_component_without_parent`, `payments_differ_from_paid`, `empty_day_kept`, `adjustment_repeated`, `adjustments_merged`, `store_currency_differs_from_tenant`, `analytics_refresh_failed`, and for incremental runs `incremental_handed_off` (warning, one per day left to the nightly job), `deadline_reached` (warning, a POS call was cut off at the wall-clock deadline), `abandoned_runs_closed` (warning), `analytics_refresh_retried` (info, one per date refreshed again without a pull) and `store_busy` (info)). The run summary counts them by code and severity; no sale id is printed.

## Incremental runner

The incremental runner keeps today current during opening hours without the nightly job's 14-day pull. Roadmap phase 7 and ADR-020 define it; ADR-028 explains how the scheduled call is authorised.

### One invocation, one store

`runIncrementalStore` (`@fnb/runner`) is what the Edge Function and `fnb sync incremental` run for one store:

1. Load the store and its account. A store that is inactive, an account that is `paused`, or an account that is `auth_failed` is skipped without a POS call (the CLI's `--retry-auth-failed` retries the last case).
2. Dead-man's switch: read the minutes of opening time since the store's last successful sync (`app.sync_gap_minutes`, null for a store the sync does not watch); above 90 the `Notifier` gets a `sync_stale` alert before anything else runs, so a store whose earlier runs failed or were handed off is reported even when this run fails too. The scheduler raises the same alert without the function (see "Notifier and dead-man's switch").
3. Find the account's entry in `POS_ACCOUNTS_JSON` by its key and log in through the connector registry, with the token cache in `pos_account_tokens`. A login the POS rejects sets the account to `auth_failed` (only from `active` or `error`, so the `auth_failed` alert goes out once), records a failed run, and stops; a later login that succeeds sets it back to `active`. A missing entry or another connection error records a failed run and alerts `run_failed`.
4. `syncIncremental` first closes as `failed` any incremental run of the store still marked `running` 10 minutes after it started (a worker the platform stopped at its wall-clock or CPU limit never closes its own run; an `abandoned_runs_closed` warning counts them), then opens one `sync_runs` row (`kind = incremental`, the store in `store_id` and `store_ids`, the window in `range_start` and `range_end`), takes the store's window lock with a 15-second wait, and inside it:
   - computes the window: the last 3 business dates ending today, in the store's timezone and business-day start (`incrementalWindow`);
   - makes one control-totals call for the whole window and compares each date with what is stored (change detection below);
   - reads the store's stale dates of the last 14 days (`staleAnalyticsDates`, see "Run bookkeeping");
   - pulls the changed dates one by one, newest first, through the same store-window steps as a window run (sales, adjustments, control totals, shifts, plan, writes, checks), asking the guard before each date;
   - after releasing the lock, refreshes analytics for the synced dates, the earlier dates their adjustments touched and the stale dates, nothing else.
5. The run closes `succeeded` when every changed date was synced, `partial` when the guard or a busy lock stopped it, `failed` (with the redacted error, and a `run_failed` alert) otherwise. `last_synced_at` moves only on `succeeded`.

`rows_upserted.summary` of an incremental run adds `days_checked`, `days_changed`, `days_synced`, `days_handed_off`, `stale_days_refreshed`, `stopped` (`wall_time`, `cpu_time`, `store_busy` or null) and `cpu_estimate_ms`. Each day's outcome is recorded as it happens, so a run that fails part-way still counts the days it committed: they are `synced`, and the changed days it never reached stay `pending`. A second invocation right after the first finds nothing changed and makes exactly one connector call.

### Change detection

| A date of the window is pulled when | Reason recorded |
|---|---|
| it has no `sync_checks` row | `unchecked` |
| its last check did not match | `unmatched` |
| the POS count or net differs from the check's `source_` values by any amount | `pos_changed` |
| the stored non-voided count or net no longer matches the POS within the check tolerance | `local_changed` |
| none of these | `unchanged`, not pulled |

The POS daily totals are what the checks already reconcile against, so a new sale, a void, an edit that changes the net or a removed line moves them and the date is pulled. An edit that keeps a day's count and net (an item swapped for one at the same price, a corrected payment method) leaves the totals as they were; the nightly run picks it up. A connector without control totals cannot be compared, so the incremental run pulls every date of its window each time.

### CPU and wall-time guard

The guard is sized to the Free plan's Edge Function limits, from [supabase.com/docs/guides/functions/limits](https://supabase.com/docs/guides/functions/limits) (read 2026-11-08):

| Limit (Free plan) | Value | Budget the guard keeps |
|---|---|---|
| Wall clock, how long a worker stays active | 150 s (400 s on paid plans) | 105 s, of which 10 s are reserved for the refresh and closing the run |
| CPU time per request, async I/O excluded | 2 s | 1.2 s estimated |
| Memory | 256 MB | not guarded; a day's payloads are a few MB |
| Request idle timeout | 150 s | not reached: a scheduled call is answered 202 at once and the run continues under `EdgeRuntime.waitUntil` |
| Function size | 20 MB bundled by the CLI, 5 MB bundled server-side | the CLI-bundled eszip is about 7.6 MB (about 1.4 MB compressed), so the deploy uses the default local bundling |

Before each date the guard admits it only when the estimated CPU time so far plus the date's estimate stays within 1.2 s and the elapsed time since the request arrived plus the date's projected duration plus the 10-second reserve stays within 105 s. The Edge Runtime reports no CPU time to the function (`Deno.cpuUsage` is missing and `process.cpuUsage()` returns zeros there), so CPU time is estimated from the work: 250 ms for start-up, login and the control totals, then 50 ms plus 1 ms per POS invoice of the date, the count coming from the control totals. On the real data a pull costs about 0.5 ms of CPU per sale plus 150 to 300 ms of warm-up for the first pull of a process (measured with `process.cpuUsage()` in Node on dry runs of one and three days of both stores), so the model counts each sale twice. The projected duration of a date is the larger of 8 s plus 20 ms per invoice and the average duration of the dates already pulled in this run. The local Edge Runtime enforces the same CPU limit (a soft limit at 1 s that retires the worker after the request, a hard limit at 2 s that cancels it), which is how the budget was checked.

The guard also bounds a date it has admitted. The run's deadline is the wall-clock budget less the 10-second reserve, measured from the request's arrival; every POS call carries it, the iPOS connector aborts its HTTP request at it, and `ConnectorCaller` neither retries nor waits past it. A call still running then is cut off: its date and every date after it are handed off, `stopped = wall_time`, and `deadline_reached` is raised. The run then refreshes and closes inside the reserve, well before the platform stops the worker.

The budget can be changed where no Free-plan limit applies. The Edge Function reads `FNB_INCREMENTAL_WALL_MS` and `FNB_INCREMENTAL_CPU_MS` from its secrets (whole milliseconds, at most 390,000 against the paid plans' 400-second wall clock and 2,000 against the CPU limit, which is 2 s on every plan); a value it cannot use answers 500 and logs why. `fnb sync incremental` runs where no Edge limit exists, so its budget per store defaults to `SERVER_INCREMENTAL_BUDGET`, 10 minutes of wall time and 10 minutes of estimated CPU, and `--wall-budget-ms` and `--cpu-budget-ms` change it (105000 and 1200 reproduce the Free-plan budget).

A date the guard refuses, and every date after it, is handed off: the run closes `partial`, `days_handed_off` counts them, an `incremental_handed_off` warning marks the run as flagged in `fnb status`, and the nightly job covers them at the latest. Because the dates still disagree with their checks, the next incremental run tries them again, newest first. When the deadline cuts off the control-totals call itself, nothing was compared, so every date of the window is handed off without a reason: `days_checked` and `days_changed` stay 0 and `days_handed_off` counts the whole window. A store held by another run (a backfill, the nightly job) for more than 15 seconds is left alone the same way, with `stopped = store_busy`.

### Edge Function `sync-incremental`

`supabase/functions/sync-incremental` (`index.ts`, `handler.ts`, `postgres-socket.ts` and the generated `deno.json`) is thin: it accepts `POST` with `{"ticket": "<uuid>"}`, claims the ticket in the database (`app.claim_incremental_sync_ticket`), answers 401 for an unknown, used or expired ticket, and runs `runIncrementalStore` for the ticket's store. A scheduled call is answered `202 {"accepted": true}` immediately and the run continues under `EdgeRuntime.waitUntil`; `{"ticket": "…", "wait": true}` runs first and answers with the run's report instead. The report and every log line carry counts only: the account by its position in `POS_ACCOUNTS_JSON` ("account 2"), the store by its position in the account ("store 1"), no store name, account key, external id or amount.

| Environment | Source |
|---|---|
| `SUPABASE_DB_URL` | injected by Supabase: the direct connection, which is session mode as the window lock needs |
| `FNB_DB_URL` | optional Edge Function secret that overrides it, for example with the session-pooler string; never the transaction pooler |
| `FNB_DB_CA_CERT` | optional Edge Function secret: the PEM of the database's certificate authority, for a TLS connection whose server certificate the runtime does not already trust; Supabase documents its deployed functions as preconfigured for TLS to their database |
| `POS_ACCOUNTS_JSON`, `IPOS_APP_KEY` | Edge Function secrets, the same values as the GitHub secrets (`docs/secrets.md`) |
| `FNB_INCREMENTAL_WALL_MS`, `FNB_INCREMENTAL_CPU_MS` | optional Edge Function secrets: the run budget (see "CPU and wall-time guard"); without them the Free-plan budget of 105,000 and 1,200 ms applies |

The function always speaks TLS to a database host that is not local: it uses `sslmode=require` unless the URL asks for `verify-full`, and its socket verifies the server certificate either way (against the runtime's store and `FNB_DB_CA_CERT`). A URL that would let the connection fall back to plaintext (`sslmode=disable`, `allow` or `prefer` on a remote host) is refused: the function answers 500 and logs why. Claims go through one shared connection per worker (`max` 1, closed after 30 idle seconds), so a caller without a valid ticket never opens a backend of its own; while 32 claims wait on it the function answers 429 without touching the database. Only a claimed ticket opens the run's own two connections.

The function constructs the same objects as the CLI: `PostgresSyncRepository` from `@fnb/sync/postgres` with at most two connections, the connector registry and token cache from `@fnb/runner`, and a `ConsoleNotifier` that writes through the redactor. It hands postgres.js its own socket, `postgres-socket.ts`, built on `Deno.connect` and `Deno.startTls`: in the Edge Runtime (1.77.9, compatible with Deno 2.1) postgres.js v4 over `node:net` either stops at once (its default `onread` mode needs a socket user buffer the runtime does not implement) or, with `onread` off, misreads results larger than about 200 kB: the stream the runtime's `node:net` emulation hands over no longer matches what the server sent (a run then hangs or fails with an invalid message length), and copying each chunk on arrival did not help. Through the Deno socket a probe read 30,000 rows (6.4 MB) correctly, plain and over TLS 1.3, and the real runs stopped hanging. `createPostgresClient` gained the two options this needs, `socket` and `fetchTypes` (false in the function, so postgres.js never opens an extra connection to look up types; enums arrive as text, the way the repository reads them). The other change to package source was replacing `Buffer` in the iPOS JWT decoder with `atob` and `TextDecoder`.

The workspace packages ship TypeScript whose relative imports end in `.js`, as Node's module resolution wants. Deno resolves those only with sloppy imports, which the Edge Runtime ignores in `deno.json`, and the Supabase CLI reads every imported file itself (to mount it for `serve` and to upload it for `deploy`) without any `.js`-to-`.ts` rewriting. `deno.json` in the function directory therefore maps each package's bare name to its entry file, each npm dependency to the exact version pnpm installed (`npm:zod@4.6.7`, `npm:postgres@4.1.0`), each imported `.js` path to its `.ts` file (top-level `imports`, which Deno applies) and each relative specifier per directory (`scopes`, which the CLI's walker applies). `node scripts/function-imports.mjs` writes that map from the import graph; `--check` fails when it is stale, and CI runs it before `deno check supabase/functions/sync-incremental/index.ts`.

Locally: `pnpm exec supabase functions serve --env-file <file with POS_ACCOUNTS_JSON and IPOS_APP_KEY>` serves it at `http://127.0.0.1:54321/functions/v1/sync-incremental` (`verify_jwt = false` comes from `[functions.sync-incremental]` in `supabase/config.toml`). The CLI injects `SUPABASE_DB_URL` with the stack's network alias `db` as the host (`postgresql://postgres:postgres@db:5432/postgres` in CLI 3.0.0); that host counts as local, so the served function connects without TLS, as the local database expects, and needs no `FNB_DB_URL`. The rule lives in `enforcedSsl` in `@fnb/sync/postgres`, with unit tests for that URL, the cloud strings and the refused modes. Deploying bundles it with the CLI's Docker bundler, which produced a 7.6 MB eszip from this layout locally (`edge-runtime bundle`, the step `supabase functions deploy` runs before uploading); `.github/workflows/deploy-functions.yml` deploys it.

### Schedule

Migration `20261108084100_incremental_sync_schedule.sql` installs `pg_cron` and `pg_net` and keeps the schedule in `app` (not exposed through the API): one settings row, `app.incremental_sync_settings`, disabled; no `pg_cron` job. Migration `20261108104800_incremental_sync_hardening.sql` adds the store-ids coverage, the watch rule, the resume mark, the opening-hours check, the alerts, the retention and the stale-date lookup described here. `select app.enable_incremental_sync('https://<ref>.supabase.co/functions/v1/sync-incremental');` stores the URL and schedules the job `sync-incremental` every 30 minutes (`*/30 * * * *`, run as `postgres`); `select app.disable_incremental_sync();` removes it. Each tick runs `app.dispatch_incremental_sync()`. It records every scheduled ticket that expired unclaimed as a `dispatch_failed` alert and drops the expired tickets, and it prunes the schedule's history. It does nothing more while disabled; otherwise it evaluates the dead-man's switch for every watched store, then issues one ticket per due store and posts it with `net.http_post` (30-second timeout instead of `pg_net`'s 2-second default; the ticket lives 10 minutes). `pg_net` sends a request only after the transaction that queued it commits and keeps each response in `net._http_response` for 6 hours ([supabase.com/docs/guides/database/extensions/pg_net](https://supabase.com/docs/guides/database/extensions/pg_net)); `cron.job_run_details` keeps the job's runs.

One rule says which stores the incremental sync watches, `app.store_watched_for_sync`: the store is active, its account is not `paused`, and `stores.settings` does not say `{"incremental_sync": false}`. The scheduler, the in-run dead-man's switch and the nightly check all use it. A store is due at a tick when it is watched, its account is not `auth_failed`, and `app.store_due_for_incremental` holds:

- it is open at the tick in its own timezone, or
- it was open at any moment of the 30 minutes before the tick, so the tick after closing collects the last sales of the day however soon after a tick the store closed (ticks run a fraction of a second late, so the test is an overlap of spans, not a count of whole minutes), or
- its opening hours are unknown: never entered (`opening_hours` is null), or entered without a single usable span (`{}`, empty lists; `app.opening_hours_known`). Then every tick syncs it, around the clock, and the dead-man's switch counts every minute. Unknown hours never silently stop the sync; entering the hours (phase 10 settings) saves the night-time calls, and `fnb doctor` turns yellow for hours entered without a span.

`stores.opening_hours` must have the shape the schedule reads, or the database refuses the write (`stores_opening_hours_valid`, `app.opening_hours_valid`): null, or an object whose keys are weekdays `mon` to `sun`, each a list of `[open, close]` pairs of `H:MM` or `HH:MM` times from `0:00` to `23:59`, or `24:00`.

`stores.opening_hours` is read the way `app.opening_minutes` reads it for the per-hour metrics: the key of a weekday holds the spans of the business dates of that weekday, a time before the business-day start belongs to the next calendar day, a close at or before the open runs past midnight, and a spelled-out `00:00`–`00:00` is the whole day. `app.opening_spans` lays the spans out as instants (a malformed span passed to it is ignored rather than failing the tick), `app.store_open_at` tests one instant and `app.opening_minutes_between` counts opening minutes, overlapping spans once.

Retention keeps the Free-plan database from growing with the schedule (`app.prune_incremental_sync_history`, at every tick): incremental `sync_runs` are kept 35 days, 90 when they did not succeed; `cron.job_run_details` 7 days; resolved `app.sync_alerts` 90 days; `analytics_refreshes` 35 days, always keeping each tenant's newest. The dead-man's switch looks back at most 7 days and the stale-date lookup 14, so nothing they read is pruned.

`select app.issue_incremental_sync_ticket('<store id>');` issues a manual ticket for one store whether or not the schedule is enabled; post it to the function (with `"wait": true` to see the report) to run that store now. The run is recorded with `triggered_by = manual`, scheduled runs with `schedule`.

### Notifier and dead-man's switch

`Notifier` (`@fnb/runner`) is one method, `notify(notification)`. A notification has a kind (`run_failed`, `auth_failed`, `sync_stale`), a severity, a subject (tenant, account, store and run ids, for a channel to route by; never printed by the console channel), an identifier-free label and message, and count-only facts. `ConsoleNotifier` writes one redacted line per notification (stderr in the CLI, the function log in the Edge Function); `notifySafely` keeps a failing channel from failing the run. Phase 12 adds the real channels, the rules and their cool-down; until then every evaluation that finds a stale store logs it again.

| Raised by | When |
|---|---|
| both runners, `run_failed` | a run fails or cannot start (missing entry, connection error) |
| both runners, `auth_failed` | the POS rejects the login and the account moves to `auth_failed` |
| every incremental run, `sync_stale` | the store has had more than 90 minutes of opening time without a successful sync (`app.sync_gap_minutes`, opening hours as above, unknown hours counting every minute) |
| the scheduler itself, at every tick, `sync_stale` in `app.sync_alerts` | the same reading for every watched store, taken in the database before any ticket is issued, so it fires when the function is broken, unreachable or failing before its claim |
| the scheduler itself, `dispatch_failed` in `app.sync_alerts` | a scheduled ticket expired unclaimed: `pg_net` could not deliver it, or the function answered without claiming it; the alert keeps the HTTP status or `pg_net`'s error of the last such call and is resolved when a ticket of the store is claimed again |
| the nightly run (`sync window --kind nightly`), `sync_stale` | while the schedule is enabled: the longest stretch of the last business day's opening time without a successful sync was over 90 minutes (`app.longest_sync_gap_minutes`) |

A successful sync for this purpose is a `succeeded` run of the store's account that is not `master_data`, that covered the store (`store_ids` lists it; older rows without the list count when `store_id` is the store or null), and whose range reached the day before the store's business date at the run's end, so a backfill of an older month does not count. `partial` and `failed` runs do not count. Only watched stores are measured: both gap functions return null for a store that is inactive, of a paused account or opted out, and the nightly check skips such a store with a line saying so. Opening time before the sync started watching a store again does not count: reactivating a store, opting it back in or moving its account out of `paused` sets `stores.sync_resumed_at` (by trigger), and both gaps start at the later of it and the last success, so the first run after a closure such as Tết reports nothing.

`app.sync_alerts` keeps one open row per store and kind (`opened_at`, `last_seen_at`, `occurrences`, `minutes` for `sync_stale`, `http_status` and `error` for `dispatch_failed`); a tick that finds the store fresh again resolves its `sync_stale` row, and disabling the schedule resolves every open row. `fnb status` lists the open alerts per store, `fnb doctor` is red while any is open, and phase 12 will deliver them to a channel from that table (`notified_at`). The nightly check is the switch that does not depend on Supabase at all: it runs on GitHub Actions and still reports a day on which the scheduler never ran.

## CLI reference

`fnb` runs through tsx because the workspace packages ship TypeScript source. From the repository root:

```sh
pnpm --filter @fnb/jobs fnb -- <command> [options]
node apps/jobs/bin/fnb.mjs <command> [options]
```

Configuration comes from the environment and, when present, the repository's `.env` (the environment wins). Exit codes: 0 success, 1 failure or a red doctor check, 2 usage error. With `CI` or `GITHUB_ACTIONS` set, output names no shop: accounts, stores and tenants are numbered or called "the tenant", and only counts are printed; error messages never repeat an account key or a tenant slug. An account listed in `POS_ACCOUNTS_JSON` is called by its 1-based position there in every command, so "account 2" in the sync step and in the status step is the same entry, the one `--account-number 2` picks. An onboarded account missing from the variable (the demo tenant's seeded accounts, for example) is never given such a number: `status` and `doctor` call it "other 1", "other 2", … in tenant and key order, and the stores of `status` carry the label of their account. With `GITHUB_ACTIONS` set, every run first prints `::add-mask::` for each credential and for each account key, with `%`, CR and LF encoded as `%25`, `%0D` and `%0A` the way the runner decodes workflow commands.

| Command | Options |
|---|---|
| `fnb tenant create` | `--name <name> --slug <slug> [--currency VND] [--locale vi-VN] [--timezone Asia/Ho_Chi_Minh] [--legal-form household_business\|micro_enterprise\|small_enterprise\|enterprise\|unknown]` |
| `fnb tenant add-member` | `--tenant <slug> --email <address> --role owner\|manager\|staff\|viewer\|publisher [--password <p> \| --invite]`; without either flag a missing login takes `FNB_MEMBER_PASSWORD` |
| `fnb onboard` | `--tenant <slug> --account <key> [--display-name <label>] [--print-secret-entry]` |
| `fnb sync window` | `(--account <key> \| --account-number <n> \| --all-accounts) --from YYYY-MM-DD --to YYYY-MM-DD [--store <external id>]... [--kind backfill\|nightly\|incremental\|manual] [--tenant <slug>] [--dry-run]` |
| `fnb sync incremental` | `(--account <key> \| --account-number <n> \| --all-accounts) [--store <external id>]... [--tenant <slug>] [--retry-auth-failed] [--wall-budget-ms <n>] [--cpu-budget-ms <n>]` |
| `fnb sync master` | `--account <key> [--tenant <slug>]` |
| `fnb status` | `[--tenant <slug>]` |
| `fnb doctor` | none |
| `fnb mask-credentials` | none; prints the masks on GitHub Actions |
| `fnb --help`, `fnb <command> --help`, `fnb help <command>` | |

Notes per command:

- `tenant create` is idempotent; an existing slug with different settings is refused, nothing is overwritten. `--locale` sets `tenants.country_code` from its region.
- `tenant add-member` looks the login up by e-mail; a missing one is created through the Supabase admin API (`--password` or `FNB_MEMBER_PASSWORD` creates a confirmed login, `--invite` sends an invitation) and the membership is upserted. Re-running changes only the role.
- `onboard` reads the account's entry from `POS_ACCOUNTS_JSON`, authenticates through the connector registry, upserts `pos_accounts` (display name defaults to the key), runs `syncMasterData` and prints the stores with timezone and day start. `--print-secret-entry` prints that entry, credentials included, for pasting into the GitHub secret; it is refused in CI.
- `sync window` needs an onboarded account; `--tenant` disambiguates a key used by several tenants. `--store` limits the run to some stores of one account; inactive stores are skipped unless named. `--dry-run` pulls and plans but writes nothing: no `sync_runs` row, and the POS token cache is read but not refreshed. `--account-number <n>` picks the n-th entry of `POS_ACCOUNTS_JSON` (1 = first) so a workflow never names the account; `--all-accounts` runs every entry in order and exits 1 if any failed. A paused account is skipped. A login the POS rejects sets the account to `auth_failed` and alerts once through the `Notifier`; a run that fails alerts `run_failed`; the next successful login sets the account back to `active`. With `--kind nightly` it then reports, per store and while the incremental schedule is enabled, the longest stretch of the last business day's opening time without a successful sync, and alerts `sync_stale` above 90 minutes; a store the sync does not watch (inactive, paused or opted out) is listed as skipped. Each store waits at most 10 minutes for its window lock.
- `sync incremental` runs the incremental runner of the Edge Function for every active store of the chosen accounts, one store after the other, and prints one count-only line per store; it exits 1 when a store failed. It is the scheduled job for a deployment that runs it from a small server instead of `pg_cron`, so its budget per store defaults to 10 minutes of wall time and 10 minutes of estimated CPU; `--wall-budget-ms` and `--cpu-budget-ms` change it. An `auth_failed` account is skipped unless `--retry-auth-failed` is given.
- `status` prints per account the last run, its result and age, the age of the last successful window, and the runs flagged (warning-level flags or unmatched days) or failed in the last 14 days; per store the latest verified business date, the latest business date with sales, the unmatched and checked store-days of the last 14 days, and the open alerts of the incremental scheduler (`stale <n> min`, `dispatch failed x<n> (HTTP <status>)`). The four `14d` columns share one window, the 14 days ending now: a run counts when it started in it, a store-day when it closed in it, so the store-days are the 14 business dates ending yesterday in the store's timezone and day start, the dates the nightly run covers. Today is still open and never counted.
- `doctor` reports database reachability and version, database size in MiB against the free plan's 500 MB quota, which Supabase measures with `pg_size_pretty` and so in MiB (yellow from the 400 MiB upgrade trigger, red from 475 MiB), applied migrations against `supabase/migrations`, a login per configured account, the age of each account's last successful window (green within 26 h, yellow within 72 h), the pause risk of a free project (yellow from 5 idle days, red from 7; unavailable against the local stack), whether the incremental schedule is enabled (yellow while it is not), the open sync alerts (red while any is open), the opening hours of the active stores (yellow for hours entered without a usable span) and, as unavailable, disk and egress, which only the Supabase dashboard measures. It exits 1 when anything is red.

Examples (placeholders, never real names):

```sh
pnpm --filter @fnb/jobs fnb -- tenant create --name "<company>" --slug <tenant-slug> --currency VND --locale vi-VN --timezone Asia/Ho_Chi_Minh
FNB_MEMBER_PASSWORD='<a long password>' pnpm --filter @fnb/jobs fnb -- tenant add-member --tenant <tenant-slug> --email <you@example.com> --role owner
pnpm --filter @fnb/jobs fnb -- onboard --tenant <tenant-slug> --account <account-key>
pnpm --filter @fnb/jobs fnb -- sync window --account <account-key> --from 2026-10-01 --to 2026-10-31 --kind backfill --dry-run
pnpm --filter @fnb/jobs fnb -- sync window --account <account-key> --from 2026-10-01 --to 2026-10-31 --kind backfill
pnpm --filter @fnb/jobs fnb -- sync incremental --account <account-key>
pnpm --filter @fnb/jobs fnb -- status --tenant <tenant-slug>
pnpm --filter @fnb/jobs fnb -- doctor
```

## Scheduled and dispatched runs

`.github/workflows/sync.yml` runs nightly at 03:23 Asia/Ho_Chi_Minh (the cron `timezone` field; an off-peak minute) over the last 14 business dates ending yesterday for every account in `POS_ACCOUNTS_JSON`, and on `workflow_dispatch` with the inputs `account_number` (the account's position in `POS_ACCOUNTS_JSON`, 1 for the first; empty for all), `from`, `to` (empty for the same 14 days), `kind` and `dry_run`. The dispatch input is a number, not a key, because inputs and step environments are printed in the public log. It skips itself with a note while `SUPABASE_DB_URL` or `POS_ACCOUNTS_JSON` is missing, writes a job summary with counts and numbered stores only, and prints `fnb status` at the end.

The secrets are set on the steps that run `fnb` only (mask, sync, status), never on the job, so checkout, setup and `pnpm install` with its lifecycle scripts never see them; `SUPABASE_SECRET_KEY` is not passed at all, because `sync window` and `status` never call the Auth admin API. Every run, nightly or dispatched, joins the single concurrency group `sync`, so two runs of the workflow never overlap. A local `fnb` run can still overlap a workflow run; the per-store window lock then makes the second wait for the first, store by store.

Between nightly runs `pg_cron` calls the Edge Function every 30 minutes for each store that is open (see "Incremental runner"); the nightly job and the Edge Function share the per-store window lock, and the Edge Function gives way after 15 seconds instead of waiting. `.github/workflows/deploy-functions.yml` deploys the function on every push to `main` that touches it or the packages it imports, and skips with a note while `SUPABASE_PROJECT_ID` or `SUPABASE_ACCESS_TOKEN` is missing.

Keep the account keys in `POS_ACCOUNTS_JSON` neutral (`account-1`, `account-2`): they are stored in `pos_accounts.account_key`, typed on the command line and masked in CI, but a neutral key cannot leak a shop name through a path the masks do not cover.

## Runbook

### Onboard a tenant and an account

1. Put the account into `POS_ACCOUNTS_JSON` in `.env` (`{"key":"account-<n>","connector":"ipos-fabi","email":"…","password":"…"}`, with a neutral key that names no shop) and set `IPOS_APP_KEY`.
2. `fnb tenant create …`, then `fnb tenant add-member …` for the owner.
3. `fnb onboard --tenant <tenant-slug> --account <account-key>` and check the printed stores: timezone and day start must match the POS.
4. Load one month with `fnb sync window … --kind backfill`; repeat month by month for older history.
5. Add the same entry to the `POS_ACCOUNTS_JSON` GitHub secret (`--print-secret-entry` prints it locally); the nightly run picks it up.

### Re-run a month

`fnb sync window --account <account-key> --from <YYYY-MM-01> --to <YYYY-MM-last> --kind backfill`, or dispatch "Sync" with the account's number and the same dates. A re-run is safe at any time: unchanged sales are skipped, changed ones rewritten with an `edited` event, vanished ones voided. Start with `--dry-run` to see the counts first.

### Read `fnb status`

- A last run that failed, or a last success older than a day, means the nightly job did not complete: open the workflow log (counts and the credential-free error are there) and re-run the window.
- `unmatched 14d` above zero means some store-days disagree with the POS daily totals: re-run those days; if they stay unmatched, compare the day privately against the POS report and record the explanation (ADR-014).
- `checked 14d` below 14 means some days were never reconciled: either they were not synced or the connector has no control totals.

### Enable or pause the incremental schedule

On the cloud project, after the function is deployed and its secrets are set (`docs/go-live.md` step 6), run in the SQL editor `select app.enable_incremental_sync('https://<ref>.supabase.co/functions/v1/sync-incremental');`. Pause it with `select app.disable_incremental_sync();`. To exclude one store, set `{"incremental_sync": false}` in its `stores.settings`. To run one store now, issue a manual ticket with `select app.issue_incremental_sync_ticket('<store id>');` and post it to the function.

Locally: serve the function with `pnpm exec supabase functions serve --env-file <file>` (a file outside the repository with `POS_ACCOUNTS_JSON` and `IPOS_APP_KEY`), then `select app.enable_incremental_sync('http://kong:8000/functions/v1/sync-incremental');` (the database reaches the gateway by its Docker name). Disable it again when done; the pgTAP suite expects a disabled schedule.

### Read the incremental runs

- `partial` with `stopped = store_busy`: another run held the store for more than 15 seconds (a backfill during opening hours); nothing is lost.
- `partial` with `stopped = cpu_time` or `wall_time`: the changed days did not fit the run's budget (or, with `deadline_reached`, a POS call was cut off at the deadline); the nightly run covers them. If `wall_time` stops happen every day on a paid plan, raise the `FNB_INCREMENTAL_WALL_MS` function secret (up to 390000, against the 400-second wall clock). The CPU limit is 2 seconds on every plan, so `cpu_time` stops are only lifted by running `fnb sync incremental` from a small server, whose budget has no Edge limit; until then the nightly run covers those days.
- `failed`: the error is in `sync_runs.error_message`, redacted; a `run_failed` line is in the function log.
- An account shown as `auth_failed` in `fnb status`: the POS rejected its credentials. Fix them in `.env`, the GitHub secret and the Edge Function secret, then run `fnb sync window` for it (or wait for the nightly run): the successful login sets it back to `active` and the schedule resumes it.
- A `sync_stale` alert: the store went more than 90 minutes of opening time without a successful sync. `fnb status` shows the open alerts per store (`select * from app.sync_alerts where resolved_at is null;` in the SQL editor shows them in full). Look for failed or partial runs of the store, then for the scheduler: `cron.job_run_details` for the job and `net._http_response` (kept 6 hours) for the function's answers.
- A `dispatch_failed` alert: the scheduler's calls to the store expire unclaimed. Its `http_status` and `error` say why: no answer recorded or a `pg_net` error (wrong URL in `app.enable_incremental_sync`, function not deployed), 500 (the function's secrets or database URL, see its log), 503 (the function cannot reach the database), 401 (it connects to another database than the one that issued the ticket), 429 (more than 32 claims at once on one worker). It clears at the next ticket the function claims.

### Read `fnb doctor`

Red database or migrations: check the connection string and run the "Migrate database" workflow. A red login: the POS password or the application key changed; update `.env` and the secrets. A red pause risk: run any sync to wake the project before it pauses. A yellow database size: plan the Pro upgrade (`docs/roadmap.md` section 9). Red sync alerts: see `sync_stale` and `dispatch_failed` under "Read the incremental runs". Yellow opening hours: enter at least one `[open, close]` pair per opening weekday for the stores counted, or set the hours back to null.
