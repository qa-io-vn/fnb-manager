# Sync engine and the `fnb` CLI

The sync turns what a POS connector emits (`@fnb/connector-core`'s `PosConnector`, canonical records from `@fnb/core`) into the tenant database described in `docs/schema.md`. It is roadmap phase 5 (onboarding, windows, status, doctor) and the Node runner of phase 7. Two packages carry it:

| Package | Role |
|---|---|
| `packages/sync` (`@fnb/sync`) | The runtime-agnostic engine: mapping, store-day planning, void and edit detection, adjustments, checks, run bookkeeping. `"."` exports the engine and an in-memory repository; `"./postgres"` exports the Postgres repository, so a future Edge Function runner imports the engine without the database driver |
| `apps/jobs` (`@fnb/jobs`) | The `fnb` CLI used locally and by `.github/workflows/sync.yml` |

## Engine design

### Repository interface

Every database read and write the engine needs goes through `SyncRepository` (`packages/sync/src/repository.ts`). Each method is one unit of work that takes and returns plain JSON-shaped rows (column names as in the migrations, timestamps as ISO strings, numerics as fixed-scale strings), so an implementation backed by Postgres functions called over RPC can be added later without touching the engine.

| Method | Purpose |
|---|---|
| `findAccounts(key, tenantSlug?)`, `upsertAccount(row)` | Account metadata (`pos_accounts` joined with the tenant's slug and currency) |
| `readToken(accountId)`, `writeToken(accountId, token)` | The POS session token cache (`pos_account_tokens`) |
| `listStores(accountId)`, `upsertStores(account, stores)` | Stores of an account; the upsert refreshes name, address, timezone and day start, keeps a known opening date, and marks stores the POS no longer lists inactive |
| `replaceCatalog(write)` | Upserts each catalogue table of the account and marks missing rows inactive; a table the connector cannot provide is passed as `null` and left untouched |
| `paymentMethodKinds(accountId)` | `payment_methods.kind` by external id, for expected shift cash |
| `withStoreLock(storeId, work)` | Runs one store's whole window (pull, read, plan, writes, checks) while holding that store's window lock, so overlapping runs on one store queue instead of planning from the same snapshot |
| `loadStoreWindow(storeId, range, referencedIds)` | Stored invoices of the window (plus any referenced by id) with their sale time, digest and line-set key, and the stored `invoice_events` of those invoices |
| `applyStoreDay(write)` | One store-day in one transaction: invoice upserts with their lines and payments replaced, status changes, events; in Postgres also the payloads of the written sales into the day's `sale_payloads` document |
| `applyAdjustments(write)` | POS-reported adjustment events and the status changes they imply, in one transaction |
| `shiftPaymentTotals(storeId, range, shiftIds)` | Tenders per shift and payment method of the stored non-voided invoices of those shifts, business dates from one day before the range to one day after it |
| `upsertShifts(storeId, rows)`, `upsertChecks(rows)` | Shifts and `sync_checks`, written only when a value changed |
| `localDayTotals(storeId, range)` | Non-voided invoice count and net per business date, for the checks |
| `openRun(start)`, `closeRun(id, finish)`, `markAccountSynced(id, at)` | `sync_runs` bookkeeping and `pos_accounts.last_synced_at` |
| `refreshAnalytics(tenantId, range)` | Calls `app.refresh_analytics(p_tenant, p_from, p_to)` when `to_regprocedure` finds it, otherwise reports it unavailable |

`PostgresSyncRepository` implements it with postgres.js: parameterised SQL only (table and column names come from fixed lists in the package), multi-row inserts batched under the parameter limit, `sql.begin` transactions and two advisory locks, both keyed by a stable 64-bit FNV-1a hash of a namespaced store id:

- the window lock, `pg_advisory_lock` on `fnb-sync:store-window:<store id>` (`storeWindowLockKey`), taken by `withStoreLock` on a reserved connection and released in `finally` (or by Postgres when the connection drops). It covers the read-plan-write cycle: a second run on the same store waits, then reads what the first one wrote and plans nothing twice. A resync event's `occurred_at` is its run's detection time, so the unique key alone could not stop two overlapping runs from each recording the same void; the window lock does. It is a session lock, so it needs a session-mode connection (the direct host or the session pooler, never the transaction pooler) and a pool of at least two connections;
- the write lock, `pg_advisory_xact_lock` on `fnb-sync:store:<store id>` (`storeLockKey`), at the start of every store-scoped write transaction, so a writer that does not take the window lock still never interleaves with another.

Text and `raw` payloads lose any U+0000 before they reach SQL (Postgres rejects it in `text` and `jsonb`); the mapping does the same, so the stored digest still equals the incoming one, and the run raises `nul_character_removed`. `InMemorySyncRepository` implements the same contract with copy-on-write transactions, a queue per store for the window lock and lock logs for unit tests; it is split like the Postgres side (`memory/accounts.ts`, `catalog.ts`, `sales.ts`, `bookkeeping.ts`, `locks.ts`).

### Runners

The engine (`SyncEngine`) is constructed with a repository, an authenticated connector, a clock, a redactor and optional call-budget, retry and tolerance settings. It offers two operations:

- `syncMasterData(account)` discovers the stores, writes them with the timezone and business-day start from the connector's store descriptor, fetches the catalogue of every active store, merges it per account and replaces the catalogue tables: item types and classes, items (class resolved by name, cost only when the connector declares `costs`), packages, customizations (the connector's modifiers), sources, payment methods (kind from `classifyPaymentKind` in `@fnb/core`, falling back to the connector's own kind when the name says nothing) and promotions. Units and devices have no canonical source yet and are left as they are.
- `syncWindow(account, stores, window, kind)` runs the steps below for each store in external-id order, each inside `withStoreLock`, then refreshes analytics for the window and for every earlier date a run changed (see step 5).

Today the runner is the Node CLI (`apps/jobs`), used by the owner and by GitHub Actions. The Edge Function runner of phase 7 will construct the same engine with an RPC-backed repository; its `withStoreLock` has to serialise per store the same way (for example a lease row, since an RPC call cannot hold a session lock across calls).

### One window, one store

1. Pull through the connector: `collectSales(fetchSales(...))`, then adjustments, control totals and shifts when the connector declares those capabilities. Every connector call goes through `ConnectorCaller`: a per-run budget (default 400 calls, each call may be several HTTP requests) and up to three attempts with exponential backoff from one second (a rate-limit error's `retryAfterMs` wins). Authentication, schema and capability errors are not retried.
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

Every non-dry run opens a `sync_runs` row (`kind`, `range_start`, `range_end`, `started_at`, `triggered_by`) and closes it with `finished_at`, `status` and `rows_upserted`. The CLI's `--kind manual` is recorded as `backfill` because `sync_kind` has no manual label; master-data runs are `master_data`. `rows_upserted` holds the rows written per table and a `summary` object:

```json
{"invoices": 0, "invoice_events": 0, "summary": {"connector_calls": 4, "retries": 0, "flags_warn": 0, "flags_info": 0, "checks": "available", "checks_unmatched": 0, "refresh": "refreshed", "refresh_ms": 30}}
```

A failure closes the run as `failed` with an `error_message` passed through the redactor (literal credentials, connection-string users and passwords, JWTs, `sb_` keys, 32-hex keys and `password=`-style pairs become `***`), truncated to 500 characters. The transaction of the failing store-day rolls back and its advisory lock is released with it; earlier store-days stay committed and the next run completes the window. `last_synced_at` moves only after a successful window. A failing analytics refresh leaves the run succeeded with an `analytics_refresh_failed` warning, because the facts are correct and the next run refreshes again.

### Data-quality flags

Connector flags arrive through `context.onFlag`; the engine adds its own (`business_date_reassigned`, `business_date_moved_out_of_window`, `sale_outside_window`, `duplicate_sale_id`, `duplicate_line_id`, `duplicate_receipt_key`, `nul_character_removed`, `package_component_without_parent`, `payments_differ_from_paid`, `empty_day_kept`, `adjustment_repeated`, `adjustments_merged`, `store_currency_differs_from_tenant`, `analytics_refresh_failed`). The run summary counts them by code and severity; no sale id is printed.

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
| `fnb sync master` | `--account <key> [--tenant <slug>]` |
| `fnb status` | `[--tenant <slug>]` |
| `fnb doctor` | none |
| `fnb mask-credentials` | none; prints the masks on GitHub Actions |
| `fnb --help`, `fnb <command> --help`, `fnb help <command>` | |

Notes per command:

- `tenant create` is idempotent; an existing slug with different settings is refused, nothing is overwritten. `--locale` sets `tenants.country_code` from its region.
- `tenant add-member` looks the login up by e-mail; a missing one is created through the Supabase admin API (`--password` or `FNB_MEMBER_PASSWORD` creates a confirmed login, `--invite` sends an invitation) and the membership is upserted. Re-running changes only the role.
- `onboard` reads the account's entry from `POS_ACCOUNTS_JSON`, authenticates through the connector registry, upserts `pos_accounts` (display name defaults to the key), runs `syncMasterData` and prints the stores with timezone and day start. `--print-secret-entry` prints that entry, credentials included, for pasting into the GitHub secret; it is refused in CI.
- `sync window` needs an onboarded account; `--tenant` disambiguates a key used by several tenants. `--store` limits the run to some stores of one account; inactive stores are skipped unless named. `--dry-run` pulls and plans but writes nothing: no `sync_runs` row, and the POS token cache is read but not refreshed. `--account-number <n>` picks the n-th entry of `POS_ACCOUNTS_JSON` (1 = first) so a workflow never names the account; `--all-accounts` runs every entry in order and exits 1 if any failed. A paused account is skipped.
- `status` prints per account the last run, its result and age, the age of the last successful window, and the runs flagged (warning-level flags or unmatched days) or failed in the last 14 days; per store the latest verified business date, the latest business date with sales, and the unmatched and checked store-days of the last 14 days. The four `14d` columns share one window, the 14 days ending now: a run counts when it started in it, a store-day when it closed in it, so the store-days are the 14 business dates ending yesterday in the store's timezone and day start, the dates the nightly run covers. Today is still open and never counted.
- `doctor` reports database reachability and version, database size against the 500 MB free plan (yellow from the 400 MB upgrade trigger, red from 475 MB), applied migrations against `supabase/migrations`, a login per configured account, the age of each account's last successful window (green within 26 h, yellow within 72 h), the pause risk of a free project (yellow from 5 idle days, red from 7; unavailable against the local stack) and, as unavailable, disk and egress, which only the Supabase dashboard measures. It exits 1 when anything is red.

Examples (placeholders, never real names):

```sh
pnpm --filter @fnb/jobs fnb -- tenant create --name "<company>" --slug <tenant-slug> --currency VND --locale vi-VN --timezone Asia/Ho_Chi_Minh
FNB_MEMBER_PASSWORD='<a long password>' pnpm --filter @fnb/jobs fnb -- tenant add-member --tenant <tenant-slug> --email <you@example.com> --role owner
pnpm --filter @fnb/jobs fnb -- onboard --tenant <tenant-slug> --account <account-key>
pnpm --filter @fnb/jobs fnb -- sync window --account <account-key> --from 2026-10-01 --to 2026-10-31 --kind backfill --dry-run
pnpm --filter @fnb/jobs fnb -- sync window --account <account-key> --from 2026-10-01 --to 2026-10-31 --kind backfill
pnpm --filter @fnb/jobs fnb -- status --tenant <tenant-slug>
pnpm --filter @fnb/jobs fnb -- doctor
```

## Scheduled and dispatched runs

`.github/workflows/sync.yml` runs nightly at 03:23 Asia/Ho_Chi_Minh (the cron `timezone` field; an off-peak minute) over the last 14 business dates ending yesterday for every account in `POS_ACCOUNTS_JSON`, and on `workflow_dispatch` with the inputs `account_number` (the account's position in `POS_ACCOUNTS_JSON`, 1 for the first; empty for all), `from`, `to` (empty for the same 14 days), `kind` and `dry_run`. The dispatch input is a number, not a key, because inputs and step environments are printed in the public log. It skips itself with a note while `SUPABASE_DB_URL` or `POS_ACCOUNTS_JSON` is missing, writes a job summary with counts and numbered stores only, and prints `fnb status` at the end.

The secrets are set on the steps that run `fnb` only (mask, sync, status), never on the job, so checkout, setup and `pnpm install` with its lifecycle scripts never see them; `SUPABASE_SECRET_KEY` is not passed at all, because `sync window` and `status` never call the Auth admin API. Every run, nightly or dispatched, joins the single concurrency group `sync`, so two runs of the workflow never overlap. A local `fnb` run can still overlap a workflow run; the per-store window lock then makes the second wait for the first, store by store.

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

### Read `fnb doctor`

Red database or migrations: check the connection string and run the "Migrate database" workflow. A red login: the POS password or the application key changed; update `.env` and the secrets. A red pause risk: run any sync to wake the project before it pauses. A yellow database size: plan the Pro upgrade (`docs/roadmap.md` section 9).
