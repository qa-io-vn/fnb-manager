# Operations runbook

This runbook is for whoever runs FNB Manager day to day: the owner, a manager the owner trusts with operations, and the developer on call. It lists the environments and who holds which credential, what runs when, how to see that everything is healthy, what to do when something breaks, the maintenance calendar and whom to call. It builds on [sync.md](sync.md) (sync engine and CLI reference), [go-live.md](go-live.md) (first deployment) and [secrets.md](secrets.md) (secrets contract); [security.md](security.md) describes the threats and controls, [development.md](development.md) the local setup and checks, and [requirements.md](requirements.md) the operational requirements behind this runbook (FR-OPS, NFR-AVL and NFR-OBS). Phase 12 parts are marked as verified locally (12a), in build (12b) or planned (12c).

Last updated 2026-11-18

## 0. Read first: the state on 2026-11-12

- **No cloud project exists yet.** Gate G1 waits for the owner ([go-live.md](go-live.md)). The workflows that need the cloud ("Sync", "Backup database", "Migrate database") skip themselves with a note in their summary, and nothing syncs in the cloud. The local stack on the build machine holds a tenant loaded with real data, for verification only.
- **GitHub runs the workflows on `main` (checked 2026-11-18).** All eleven workflow files are on GitHub, `deploy-functions.yml`, `notify.yml` and `deploy-mini-apps.yml` included; every one that needs the cloud project, its secrets or the Zalo configuration skips itself with a note in its summary. Pages serves the demo build that `deploy-web.yml` made from `main`.
- **Phase 13 groundwork is built and not live.** The Zalo configuration tables with `fnb zalo config` and `fnb zalo bind`, the shared helpers of the Zalo Edge Functions, the Mini App sign-in (`zalo-session`, `zalo-phone`, the access-token hook), the two webhooks (`oa-webhook`, `bot-webhook`) and the two Mini App scaffolds exist (#203, #204, #205, #207, #208), tested against a mock of Zalo. No Zalo function is deployed, no token job runs (#206), and "Deploy Mini Apps" has never deployed. Everything real waits for the owner's Zalo accounts (#8) and the device check (#210).
- **Phase 14a is built on the local stack.** The staff roster with Cài đặt → Nhân viên, pairing codes, the staff notice with its `staff_ops` consent, the staff revenue level and the staff app's home exist (#211, #212, #213, #214, #216, #217); the app's pairing screens are in progress (#215), and the device acceptance waits for the owner (#218). `pnpm zalo:dev` runs the staff app against the local backend, on this PC or a phone ([development.md](development.md)).
- **Phase 12:** step 12a (outbox, Zalo Bot channel, `fnb notify tick`, `status`, `link`, `test`) is verified locally; step 12b (`fnb digest`, the alert rules, Brevo e-mail, `notify unlink`, `notify job-failed`, the Actions steps) is in build; step 12c (the Supabase dispatcher, the failure listener, Telegram, Resend and webhook, `docs/notifications.md`) is planned.
- Known issues are in section 3.8.

## 1. Environments and access

### 1.1 Environments

| Environment | What it is | Data | State on 2026-11-12 |
|---|---|---|---|
| Local, build machine | Supabase stack in Docker (`pnpm db:start`): API on port 54321, database 54322, Studio 54323, mail catcher 54324; the `fnb` CLI; the web dev server (`pnpm --filter @fnb/web dev`, port 5173) | the synthetic seed tenant `demo-fnb` and a tenant loaded from the real POS accounts | running; **never reset** (`supabase db reset` would wipe the real tenant) |
| Local, another machine | the same stack, fresh | the seed only, until the real data is reloaded ([status.md](status.md)) | – |
| CI | GitHub Actions runners | throwaway stacks (`supabase start`, `supabase db reset`); `ci.yml` reads no secret | runs on every push to `main` and every pull request |
| Production database and functions | a Supabase project on the Free plan, Singapore region | the real tenants | waits for owner (G1) |
| Production web app | GitHub Pages, under `/<repository>/` | none in the files; every number is read by the signed-in member under row-level security | live with the demo build |
| Scheduled compute | GitHub Actions (nightly sync, backups, notifications, deploys) and Supabase `pg_cron` (the incremental sync; from 12c the notification dispatcher) | – | Actions scheduled and skipping; `pg_cron` inert |

### 1.2 Who holds which credential

The owner holds every production credential. The operator needs none for the daily checks (web app, digest, Actions tab); `fnb status` and `fnb doctor` against the cloud run only on a machine with the owner's `.env`. Names and contents are in [secrets.md](secrets.md).

| Credential | Lives in | Held by | Used by |
|---|---|---|---|
| Supabase organisation and project owner login | Supabase dashboard | owner | SQL editor, function secrets, plan, pause and restore |
| GitHub repository admin | GitHub | owner | secrets, variables, Pages, enabling workflows |
| `SUPABASE_ACCESS_TOKEN` | GitHub secret; the owner's `.env` or `supabase login` | owner | `migrate.yml`, `backup.yml`, `deploy-functions.yml`; setting function secrets |
| `SUPABASE_DB_PASSWORD` | GitHub secret; `.env` | owner | `migrate.yml`, `backup.yml` |
| `SUPABASE_PROJECT_ID` | GitHub secret; `.env` | owner | `migrate.yml`, `backup.yml`, `deploy-functions.yml` |
| `SUPABASE_DB_URL` (session pooler; contains the database password) | GitHub secret; `.env` | owner | `sync.yml`, `notify.yml`, `deploy-mini-apps.yml`; the CLI against the cloud |
| `SUPABASE_SECRET_KEY` | the owner's `.env` only; no workflow reads it | owner | `fnb tenant add-member` when it creates a login |
| `POS_ACCOUNTS_JSON`, `IPOS_APP_KEY` | GitHub secrets; Edge Function secrets; `.env` | owner; the build machine keeps a copy for the local tenant | sync, onboarding, `fnb doctor`, live tests, `sync-incremental` |
| `FNB_DB_URL`, `FNB_DB_CA_CERT`, `FNB_INCREMENTAL_WALL_MS`, `FNB_INCREMENTAL_CPU_MS` (optional) | Edge Function secrets | owner | `sync-incremental` |
| `BACKUP_AGE_RECIPIENT`, `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | GitHub secrets | owner | `backup.yml` |
| The `age` private key | offline with the owner, never in GitHub or Supabase | owner | restoring a backup |
| `NOTIFY_ZALO_BOT_TOKEN`, `NOTIFY_EMAIL_API_KEY`, `NOTIFY_EMAIL_FROM`, `NOTIFY_EMAIL_FROM_NAME`, `NOTIFY_TELEGRAM_BOT_TOKEN`, `NOTIFY_WEBHOOK_SECRET` | GitHub secrets; `.env`; Edge Function secrets from 12c | owner | the notification steps of `sync.yml` and `notify.yml` (in build); `fnb notify …` |
| `ZALO_APP_SECRET_<BRAND>`, `ZALO_OA_SECRET_<BRAND>` (phase 13) | Edge Function secrets, named by `zalo_apps.secret_name` and `oas.secret_name` | owner | `zalo-session` and `zalo-phone` (the App secret, #205) and `oa-webhook` (the OA secret key, #207); built, not deployed |
| The OA and Mini App developer token pairs (phase 13) | the `zalo_tokens` table, closed to every API role; not a secret anyone sets by hand | the token jobs (#206, not built yet) | the OA messages and `deploy-mini-apps.yml` |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | GitHub variables, public by design | – | the web build and the Mini App builds; `SUPABASE_URL` also in `sync.yml` |
| Member logins (e-mail and password) | Supabase Auth | each member: owner, manager, staff, viewer; the publisher login from phase 11 | the web app, under row-level security |
| Local stack keys | printed by `pnpm db:start`; `.env`, `apps/web/.env.local` | builder, local only | development and tests |
| `docs/private/` | the build machine; copied between machines through a private channel | owner and delivery team | acceptance figures, build specs, the identifier list of the public-safety scan |

### 1.3 Running the CLI against the right database

- `pnpm --filter @fnb/jobs fnb -- <command>` (or `node apps/jobs/bin/fnb.mjs <command>`) reads the environment and the repository's `.env`. The environment wins, and an empty value in the environment hides the file's value.
- Without `CI`, the CLI reads `DATABASE_URL` (the local stack) before `SUPABASE_DB_URL` (the cloud). **With `CI=1` the order is reversed.** On a machine whose `.env` holds both, `CI=1 pnpm --filter @fnb/jobs fnb -- status` reads the cloud and `CI=1 SUPABASE_DB_URL= pnpm --filter @fnb/jobs fnb -- status` reads the local stack.
- `CI=1` makes the output safe to share: accounts are named by their position in `POS_ACCOUNTS_JSON` ("account 1"), stores are numbered, and no shop, member, address or amount is printed. The commands in this runbook use it.
- Three commands print private values and are refused with `CI` set: `fnb notify link`, `fnb onboard --print-secret-entry` and `fnb digest --show-text`. Run them without `CI=1`, on the owner's machine, and never paste their output anywhere.
- Exit codes: 0 success; 1 failure, a red `doctor` check or a failed `notify test`; 2 usage error; `notify job-failed` also returns 3 (database unreachable within 10 seconds) and 4 (connected, but the record failed).
- SQL in this runbook runs in the SQL editor of the cloud project, as the database owner. On the build machine the same statements run in `docker exec -it supabase_db_FNB_Managment psql -U postgres -d postgres`. Read amounts only there; never copy them into an issue, a chat or a file in the repository.

## 2. What runs when

### 2.1 Schedules

Times are Asia/Ho_Chi_Minh (UTC+7). GitHub starts scheduled runs late, often by hours (section 2.3).

| What | When | Defined in | What it does | State on 2026-11-12 |
|---|---|---|---|---|
| Incremental sync | every 30 minutes (`*/30 * * * *`) for each store that is open in its own time zone, once more just after it closes, and around the clock for a store without opening hours | `pg_cron` job `sync-incremental`, created by `app.enable_incremental_sync(<function URL>)` | `app.dispatch_incremental_sync()`: records expired tickets as `dispatch_failed`, prunes history, evaluates the dead-man's switch, then posts one single-use ticket per due store to the Edge Function `sync-incremental`, which checks the store's last three business days against the POS daily totals and pulls only the days that changed | built and verified locally; not deployed; waits for owner (go-live step 6) |
| "Sync" (nightly) | daily 03:23 (`23 3 * * *` with the `Asia/Ho_Chi_Minh` time zone) | `.github/workflows/sync.yml` | masks credentials; `fnb sync window --all-accounts --kind nightly` over the 14 business dates ending yesterday; then, even after a failure, `fnb digest --due`, `fnb notify tick` and `fnb status` | scheduled; skips until `SUPABASE_DB_URL` and `POS_ACCOUNTS_JSON` exist; the digest and send steps are in build (12b) and not on GitHub yet |
| "Notify" | daily 06:07, 07:07, 08:07 (`7 6,7,8 * * *`, same time zone) | `.github/workflows/notify.yml` | `fnb notify tick --skip-if-scheduler-healthy --budget-seconds 300`: builds the digests that are due, polls bot links, sends what is due; exits at once while the Supabase dispatcher is healthy | in build (12b); not on GitHub yet |
| Notification dispatcher in Supabase | a `pg_cron` tick that wakes the `notify` Edge Function when work is due | `app.enable_notify` | the same cycle, inside Supabase | planned (12c) |
| Failure alerts from Actions | when a watched workflow fails | `notify-on-failure.yml`, calling `fnb notify job-failed` | records a `job_failed` alert; a database-free fallback message when recording fails | `fnb notify job-failed` in build (12b); the listener and the fallback are planned (12c) |
| "Backup database" | Monday 02:23 (`23 19 * * 0`, UTC: Sunday 19:23) | `.github/workflows/backup.yml` | dumps schema, data, roles and auth data; packs and encrypts them with `age`; uploads `backup-<UTC stamp>.tar.gz.age` to `s3://<bucket>/database/`; the summary logs the encrypted size | scheduled; skips until `SUPABASE_PROJECT_ID`, `BACKUP_AGE_RECIPIENT` and `BACKUP_S3_BUCKET` exist |
| "Scheduled workflows active" | Monday 09:17 (`17 2 * * 1`, UTC) | `.github/workflows/workflows-active.yml` | re-enables any workflow GitHub disabled after 60 days without repository activity, and warns | scheduled; **failing** (section 3.8) |
| Cron probes | every :00 and :30, and every :07 and :37 | `cron-probe-peak.yml`, `cron-probe-offpeak.yml` | write the actual start time into the job summary; `node scripts/cron-delay-report.mjs` reads them | running |
| Sync retention | at every incremental tick | `app.prune_incremental_sync_history()` | keeps incremental `sync_runs` 35 days (90 when not succeeded), `cron.job_run_details` 7 days, resolved `app.sync_alerts` 90 days, `analytics_refreshes` 35 days (each tenant's newest kept) | runs only while the incremental schedule is enabled |
| Storage maintenance | Sundays in the nightly run, and in the 02:00–05:59 window of any incremental tick at most once in 6 days | `app.maintain_storage()` (the nightly step passes `true` on Sundays) | rebuilds the indexes of up to ten tables whose indexes are at least 4 MiB and 3 times the table (sales, lines, ledger and so on), waiting 5 seconds per lock and skipping a locked table; one row in `app.storage_maintenance_runs`. Measured on the local database: 314 MB to 150 MB, indexes of invoices 43 MB to 2 MB | built; a failure never stops a sync tick |
| Notification retention | inside the notify tick, at most once every 20 hours | `app.notify_housekeeping` | deletes finished queue rows after `retention_days` (default 400), clears message bodies after `body_retention_days` (default 90), deletes lapsed link codes and unaccepted bot destinations | verified locally (12a) |

### 2.2 Event-driven workflows

| Workflow | Runs on | Does | Secrets |
|---|---|---|---|
| "CI" (`ci.yml`) | push to `main`, every pull request | secret and identifier scan; lint, typecheck, unit tests, the import maps and the Deno checks and tests of every Edge Function; migrations, pgTAP and the Postgres parity suite on a fresh stack; web end-to-end tests; the Mini App builds for two synthetic brands with their size budgets and browser checks | none |
| "Migrate database" (`migrate.yml`) | push to `main` touching `supabase/migrations/**` or `supabase/config.toml`; pull requests touching migrations (dry run); manual dispatch | `supabase link`, then `supabase db push`; skips without `SUPABASE_PROJECT_ID` | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID` |
| "Deploy web app" (`deploy-web.yml`) | push to `main` touching `apps/web/**`, `packages/**` or the workflow; manual dispatch | builds the web app (the demo while the two variables are empty) and deploys it to Pages | none; variables `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` |
| "Deploy Edge Functions" (`deploy-functions.yml`) | push to `main` touching `supabase/functions`, `supabase/config.toml`, any package's `src/` or `package.json`, the lockfile or the import-map script; manual dispatch | checks the import maps, then deploys each function the push affects (every function on a manual run), keeps going after a failed one and fails at the end; skips without its two secrets, and deploys nothing when no function imports a changed file | `SUPABASE_PROJECT_ID`, `SUPABASE_ACCESS_TOKEN` |
| "Deploy Mini Apps" (`deploy-mini-apps.yml`) | push to `main` touching the two Mini Apps, `packages/zalo-mini`, `packages/design-tokens`, the lockfile or the workflow (a Development version); a `mini-v*` tag (a Testing version); manual dispatch (Development) | builds each brand's staff and customer Mini Apps from the `mini_apps` rows, checks the size budgets and deploys them with `zmp-cli`; skips with a note until it is configured (4.17) and has never deployed | `SUPABASE_DB_URL`; variables `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` |

### 2.3 How late GitHub starts scheduled runs

Measured on this repository through the GitHub API on 2026-11-12:

| Workflow | Scheduled | Actual starts (local time) |
|---|---|---|
| "Sync" | 03:23 daily | 2026-11-09 06:47, 2026-11-10 09:46, 2026-11-11 07:42, 2026-11-12 08:56: between 3 h 24 min and 6 h 23 min late |
| "Backup database" | Monday 02:23 | 2026-11-09 05:56: 3 h 33 min late |
| "Scheduled workflows active" | Monday 09:17 | 2026-11-09 16:54: 7 h 37 min late |
| Cron probes | every 30 minutes | 18 runs each between 2026-11-07 and 2026-11-12, out of more than 200 slots |

Plan for it: the nightly data and an Actions-sent digest can arrive mid-morning. The incremental sync and, from 12c, the notification dispatcher run inside Supabase for that reason (ADR-020). Every window run is idempotent, so a late or missed run heals at the next one.

### 2.4 One day, in a picture

```mermaid
flowchart LR
    POS[(POS API)]
    subgraph SB[Supabase]
        CRON[pg_cron every 30 min] --> EF[Edge Function sync-incremental]
        DB[(Postgres)]
    end
    subgraph GH[GitHub Actions]
        SYNC["Sync, 03:23"]
        NOTIFY["Notify, 06:07 07:07 08:07"]
        BACKUP["Backup, Monday 02:23"]
    end
    POS --> EF --> DB
    POS --> SYNC --> DB
    DB --> NOTIFY --> MSG[Zalo Bot and e-mail]
    SYNC --> MSG
    DB --> BACKUP --> BUCKET[(Private bucket)]
    DB --> WEB[Web app on GitHub Pages]
```

The incremental path is built but inert until the owner enables it; the notification paths are in build (12b).

## 3. Monitoring

### 3.1 `fnb status`

```sh
CI=1 pnpm --filter @fnb/jobs fnb -- status
CI=1 pnpm --filter @fnb/jobs fnb -- status --tenant <tenant-slug>
```

Per account: the last run, its result and age, the age of the last successful window, and the runs flagged (warning-level data-quality flags or unmatched days) or failed in the last 14 days. Per store: the latest verified business date, the latest business date with sales, the unmatched and checked store-days of the 14 business dates ending yesterday, and the scheduler's open alerts.

| You see | It means | Go to |
|---|---|---|
| last run failed, or the last success older than a day | the nightly did not complete | 4.1 |
| `unmatched 14d` above 0 | some store-days disagree with the POS daily totals | 4.4 |
| `checked 14d` below 14 | some days were never reconciled: not synced, or no control totals | 4.5, 4.6 |
| an account in `auth_failed` | the POS refuses its login | 4.2 |
| `stale <n> min` or `dispatch failed x<n> (HTTP <status>)` | the dead-man's switch or the scheduler raised an alert | 4.3 |

### 3.2 `fnb doctor`

```sh
CI=1 pnpm --filter @fnb/jobs fnb -- doctor
```

It exits 1 when any check is red. It logs in to every POS account in `POS_ACCOUNTS_JSON` with the password itself, without the cached session.

| Check | Green | Yellow | Red |
|---|---|---|---|
| database | reachable | – | unreachable |
| database size, in MiB | below 400 | from 400 (the Pro trigger, gate G4) | from 475 (the Free quota is 500 MB) |
| migrations | every file applied | applied without a file | a file not applied |
| login, per account | the POS accepts it | – | the POS refuses it (4.2) |
| last sync, per account | last successful window within 26 h | within 72 h | older |
| pause risk (cloud only) | under 5 idle days | from 5 idle days | from 7 (4.12) |
| incremental schedule | enabled | not enabled | – |
| sync alerts | none open | – | any open alert in `app.sync_alerts` (4.3) |
| opening hours | usable or unknown | hours entered without a usable span | – |
| disk, egress | reported as unavailable: only the Supabase dashboard measures them | | |

While the incremental schedule is off, the 26-hour window plus GitHub's delays (2.3) can turn "last sync" yellow between two nightly runs.

### 3.3 The web app's badges

- **Freshness**, in the top bar: "cập nhật lúc {time}" (with the date when it is not today), "chưa đồng bộ" when the tenant has never synced, "chưa rõ lúc cập nhật" when the time is unknown. It reads the tenant's latest succeeded run in `sync_runs`. With the incremental schedule on, it should show a time less than 35 minutes old during opening hours (the phase 7 acceptance).
- **Verified**, on each day section of Hôm nay: "đã đối soát" only when every selected store-day has a matched check; otherwise cards carry "chưa đối soát". In the demo both badges read "dữ liệu mẫu".
- **New version:** after a deploy, an open app offers "Có phiên bản mới — tải lại" when its window regains focus (Pages caches `index.html` for ten minutes).

### 3.4 Reconciliation

Each synced store-day gets one `sync_checks` row: the POS count and net against ours. It is matched when the count is exact and the net is within the larger of 1,000 (in the tenant's currency) and 0.05 % of the POS net. Without control totals no row is written and the day stays unverified. ADR-014 accepts at least 99 % of store-days matched, with every exception explained privately.

### 3.5 The dead-man's switch

Three watchers, so a broken path is caught by another:

| Watcher | Fires when | Shows in |
|---|---|---|
| every incremental run, before it starts | the store had more than 90 minutes of opening time without a successful sync | a `sync_stale` notification from the runner |
| the scheduler, at every tick | the same reading, taken in the database for every watched store, so it fires even when the function is broken; and scheduled calls that expired unclaimed | `app.sync_alerts` (`sync_stale`, `dispatch_failed`); `fnb status`; `fnb doctor` red |
| the nightly run (`--kind nightly`), while the schedule is enabled | the longest stretch of yesterday's opening time without a successful sync was over 90 minutes | the nightly's log; a `sync_stale` notification |

Unknown opening hours count every minute. A store that is inactive, belongs to a paused account or carries `{"incremental_sync": false}` in `stores.settings` is not watched. After a closure (a store reactivated or opted back in, an account leaving `paused`), counting starts again from that moment.

### 3.6 Alerts and the daily digest (phase 12)

- **Destinations** are linked per member with `fnb notify link`: the Zalo Bot (12a, verified locally) and e-mail through Brevo (12b, in build). Telegram, Resend and a signed webhook arrive in 12c (planned). `fnb notify status` shows every destination and the outbox; `fnb notify test` sends one test message per active destination.
- **The Zalo Bot's replies** reach the platform through the poller of `fnb notify tick` today. `bot-webhook` (#207, built, not deployed) can take them instead once a bot is in webhook mode: the bot's secret token is stored only as its SHA-256 (`app.set_bot_webhook`, run as `postgres` after the Bot's `setWebhook` succeeded; no `fnb` command does both yet), and from then on the poller leaves that bot alone, because Zalo treats polling and a webhook as exclusive. Either path completes a member's link code and their "ĐỒNG Ý". Through the webhook a member can also reply "DỪNG" (or "DUNG"): their consent to notifications is withdrawn, their waiting messages are cancelled, all their destinations of the tenant (e-mail included) are disabled as `consent_withdrawn`, and the chat gets one confirmation, logged as `stop_confirmation.v1` without its text. To receive messages again they need a new link from the owner.
- **Quiet hours:** operational messages on the Zalo Bot, Telegram and e-mail go out between 06:00 and 24:00 in the reader's time zone, at most 20 per local day (the seeded `channel_policies`). A message outside that window is held until it opens. Critical alerts are held too, unless the owner sets `critical_bypass` on the tenant's policy.
- **The daily digest** is the Ngày report built as its recipient, so its numbers equal Ngày. It is due when every store of its scope has settled the day (no open shift, and a successful sync at least 30 minutes after the close and the last shift close), or at the 06:30 deadline the next morning. `fnb digest` queues it; `fnb notify tick` sends it. Until 12c only the Actions path sends, so GitHub's delays (2.3) apply.
- **Customer messages (phase 19a, built against a mock ZBS provider, off by default):** a loyalty event (points confirmed, a reward held, a held reward about to end, points or stamps about to expire; birthday and win-back only behind the promotions flag) becomes one outbox row for the member, never with a name, phone or text in it. It is always an in-app notice first (the wallet shows it); it leaves the app as a free OA consultation message only when the customer messaged the OA within 48 hours (within the API's 7 days only on the package's out-of-window allowance), and as a paid ZBS template only for the events whose route allows it, once the brand's template is approved and `zbs_enabled` is on. A free message that works means no paid one for the same event. Loyalty consent is checked when the event is queued and again when it is sent; promotions also need the marketing consent at both moments, so "Dừng nhận tin" stops what already waits; per-user caps (Tag 3: 1 in 24 hours, 30 a month) and the OA's daily template quota hold messages locally. Nothing reaches Zalo before runbook 4.23 is done.
- **Alert rules** (the catalogue `alert_rule_catalog`; owners override them per tenant or store):

| Rule | Delivery | Severity | To | Cool-down | Raised by |
|---|---|---|---|---|---|
| `daily_digest` | the digest itself | info | owner, manager | – | `fnb digest` (12b, in build) |
| `revenue_below_baseline` | a digest line | warning | owner, manager | – | net below 75 % of the same-weekday baseline, with at least 4 sample days (12b) |
| `ticket_drop` | a digest line | warning | owner, manager | – | average ticket more than 10 % below the baseline, with at least 20 invoices (12b) |
| `drawer_variance` | a digest line | warning | owner, manager | – | the shifts Ngày flags, at most 3 lines (12b) |
| `unverified_day` | a digest line | warning | owner, manager | – | a settled day unmatched or unchecked (12b) |
| `zero_sales_day` | a digest line | warning | owner, manager | – | no sales on a day the store was expected to open (12b) |
| `zero_sales_open` | immediate | warning | owner, manager | 24 h | planned (12c) |
| `sync_failed` | immediate | warning | owner | 6 h | two incremental failures in a row (12b) |
| `auth_failed` | immediate | critical | owner | 1 h; a notice when it clears | the POS refuses a login (12b) |
| `sync_stale` | immediate | critical | owner | 2 h; a reminder every 24 h; a notice when it clears | the dead-man's switch (12b) |
| `sync_dispatch_failed` | immediate | warning | owner | 6 h | scheduled calls expiring unclaimed (12b) |
| `nightly_missing` | immediate | warning | owner | 24 h; a notice when it clears | planned (12c): no successful nightly for 30 hours |
| `job_failed` | immediate | warning | owner | 12 h | `fnb notify job-failed` (12b); the listener workflow is planned (12c) |
| `channel_failed` | immediate | warning | owner | 24 h | a destination that keeps failing (12b) |
| `digest_failed` | immediate | warning | owner | 24 h | a digest that could not be built (12b) |
| `zalo_webhook_unverified` | immediate | warning | owner | 24 h | `oa-webhook` (#207, built): more OA calls in one tenant-local day than `max_per_day` (default 10) whose signature was missing or wrong, counted whether observe mode stored them or enforce mode refused them; raised once, at the first call over the limit (runbook 4.18) |
| `redemption_mismatch` | immediate | warning | owner, manager (store-scoped) | – | `app.reconcile_redemptions` after each sync (#273, built): a code verified at the till without an invoice `grace_hours` (24) later, an invoice carrying a reward discount without a redemption, or a discount that differs from the reward by more than `amount_tolerance` (1,000 ₫); the message counts each kind, names the store and carries no amount, code or link; it clears without a notice once no path D item of the store is open in `loyalty_queue` |
| `zbs_report_rate` | immediate | warning | owner | 24 h | `app.record_zbs_reports` (#279, built against a mock): on a day with at least `min_sent` (50) template messages of an OA, more than `max_rate_percent` (1 %) of them reported by recipients; Zalo lowers the daily quota tier above 2 % (runbook 4.23) |

```sh
CI=1 pnpm --filter @fnb/jobs fnb -- notify status --tenant <tenant-slug>
CI=1 pnpm --filter @fnb/jobs fnb -- notify tick --dry-run
```

`notify status` lists messages by state, held and `uncertain` messages, each destination with its last success, this month's count (the Zalo Bot's Basic plan allows 3,000 a month) and last error code, the open alert episodes and the digests. `notify tick --dry-run` claims nothing and prints each waiting message's decision, for example `message 3: held until 2026-11-09 06:00 +07, outside_hours`. An `uncertain` message is never resent automatically: someone must decide.

### 3.7 GitHub and Supabase consoles

- **Actions tab:** each run's summary carries counts and numbered stores only. GitHub e-mails a scheduled run's failure only to the person who last edited its cron line, so the owner checks the tab until the failure listener (12c) exists.
- **Supabase dashboard:** database size and egress (5 GB a month on the Free plan) under usage; Edge Function logs, kept one day on the Free plan; the SQL editor.

### 3.8 Known issues on 2026-11-12

| Issue | Effect | Handling |
|---|---|---|
| "Scheduled workflows active" failed on its first run (2026-11-09): its `gh workflow list` call ran without a repository (no checkout and no `GH_REPO`) | GitHub's 60-day inactivity rule is not guarded | fix requested to the backend stream; meanwhile the owner's commits keep the repository active |
| On GitHub, CI for `0f8fa1d` failed in the secret-scan job: `actions/setup-node@v5` stopped with "Unable to locate executable file: pnpm" | CI is red although the code, database and end-to-end jobs passed | the fix (`package-manager-cache: false`) is in the working tree; the next push shows whether it holds |
| Scheduled runs start hours late (2.3) | the nightly and the Actions-sent digest arrive mid-morning | enable the incremental schedule; the Supabase dispatcher (12c) |
| Two date-sensitive pgTAP tests fail on the long-lived local stack | false failures on the build machine only; CI's fresh stack passes | fix in progress |
| `node scripts/cron-delay-report.mjs` attributes a run to the latest slot before it, so delays longer than the slot spacing read as minutes, and it ignores skipped slots | its medians understate the delays | read section 2.3 instead; fix requested |

## 4. Runbooks

Each runbook gives the symptoms, the checks (with `CI=1`), the fix and how to verify it. `<n>` is an account's position in `POS_ACCOUNTS_JSON` (1 for the first).

### 4.1 A failed or partial sync run

**Symptoms.** "Sync" shows a red run; its summary says "Sync failed; the log of the failing step has the counts and the credential-free error." `fnb status` shows a failed last run, or runs counted as failed or flagged. Incremental runs end `partial` or `failed`. From 12b, a `sync_failed` alert after two failed incremental runs in a row.

**Checks.**

```sh
CI=1 pnpm --filter @fnb/jobs fnb -- status
CI=1 pnpm --filter @fnb/jobs fnb -- doctor
```

Open the failing step's log in the Actions tab. In the SQL editor:

```sql
select kind, status, started_at, finished_at, error_message, rows_upserted -> 'summary' as summary
from public.sync_runs order by started_at desc limit 20;
```

**Fix.**

- `partial` with `stopped` = `store_busy`: another run held the store for more than 15 seconds; nothing is lost.
- `partial` with `stopped` = `cpu_time` or `wall_time` (with `deadline_reached` when a POS call was cut off): the changed days did not fit the Edge Function's budget; the nightly covers them. If `wall_time` stops happen every day on a paid plan, raise the `FNB_INCREMENTAL_WALL_MS` function secret (at most 390000). The CPU limit is 2 seconds on every plan.
- `failed`: fix what the redacted error names (a refused login: 4.2; the database unreachable: 4.12 or the URL in the secret; a POS schema error: escalate to the delivery team, section 6), then run the window again. Start with a dry run:

```sh
CI=1 pnpm --filter @fnb/jobs fnb -- sync window --account-number <n> --from <YYYY-MM-DD> --to <YYYY-MM-DD> --dry-run
CI=1 pnpm --filter @fnb/jobs fnb -- sync window --account-number <n> --from <YYYY-MM-DD> --to <YYYY-MM-DD>
```

Or dispatch "Sync" from the Actions tab with `account_number`, `from` and `to` (empty means the 14 business dates ending yesterday), `kind` and `dry_run`.

**Verify.** `fnb status` shows a succeeded last run and `unmatched 14d` 0; the freshness badge shows a recent time.

### 4.2 An account marked `auth_failed`

**Symptoms.** `fnb status` shows the account in `auth_failed`; `fnb doctor` shows its login red; the incremental schedule skips its stores. From 12b, a critical `auth_failed` alert, once per episode, with a notice when it clears.

**Checks.**

```sh
CI=1 pnpm --filter @fnb/jobs fnb -- doctor
```

A red login means the POS refuses the credentials in this machine's `POS_ACCOUNTS_JSON`. Log in to the POS back office by hand to confirm the current password.

**Fix.** Put the working password in all three places (4.7, step 3), then run any window for the account:

```sh
CI=1 pnpm --filter @fnb/jobs fnb -- sync window --account-number <n> --from <yesterday> --to <yesterday>
```

A successful login sets the account back to `active`, and the schedule picks its stores up again. On a small server that runs `fnb sync incremental` instead of `pg_cron`, `--retry-auth-failed` does the same.

**Verify.** `doctor` shows the login green; `status` shows the account `active`; the next incremental run of its stores succeeds.

### 4.3 Stale data

**Symptoms.** During opening hours the freshness badge shows a time more than about 35 minutes old, or "chưa đồng bộ". `fnb doctor` shows "sync alerts" red, or "last sync" yellow or red. `fnb status` lists `stale <n> min` or `dispatch failed x<n> (HTTP <status>)`. From 12b, a `sync_stale` alert (critical) or `sync_dispatch_failed`.

**Checks.**

```sh
CI=1 pnpm --filter @fnb/jobs fnb -- status
CI=1 pnpm --filter @fnb/jobs fnb -- doctor
```

In the SQL editor:

```sql
select * from app.sync_alerts where resolved_at is null;
select jobid, jobname, schedule, active from cron.job;
select jobid, status, return_message, start_time from cron.job_run_details order by start_time desc limit 20;
select id, status_code, timed_out, error_msg, created from net._http_response order by created desc limit 20;
```

`net._http_response` keeps the function's answers for 6 hours.

**Fix,** by what the checks show:

- The schedule is off (`doctor`: "incremental schedule" yellow; no `sync-incremental` row in `cron.job`): enable it as in go-live step 6.
- `dispatch_failed` with no answer or a `pg_net` error: the URL given to `app.enable_incremental_sync` is wrong or the function is not deployed (4.11). 500: a function secret or the database URL; read the function's log. 503: the function cannot reach the database; set `FNB_DB_URL` (go-live step 6). 401: the function connects to another database than the one that issued the ticket. 429: more than 32 claims at once on one worker; it clears by itself.
- An account in `auth_failed`: 4.2. Runs that fail: 4.1. The project paused: 4.12.
- Only the nightly is late: GitHub's delay (2.3); wait, or dispatch "Sync" by hand.

To run one store now, issue a manual ticket and post it within 10 minutes:

```sql
select app.issue_incremental_sync_ticket(id) from public.stores where active order by external_id limit 1;
```

```sh
curl -X POST https://<ref>.supabase.co/functions/v1/sync-incremental -H 'content-type: application/json' -d '{"ticket":"<ticket>","wait":true}'
```

**Verify.** The open row in `app.sync_alerts` gets `resolved_at` at the next tick that finds the store fresh; the badge shows a time from the last 30 minutes.

### 4.4 A store-day that does not reconcile

**Symptoms.** `fnb status` shows `unmatched 14d` above 0 for a store; Hôm nay or a report card shows "chưa đối soát". From 12b, the digest's `unverified_day` line.

**Checks.**

```sh
CI=1 pnpm --filter @fnb/jobs fnb -- status
```

```sql
select store_id, business_date, checked_at
from public.sync_checks where not is_matched order by business_date desc limit 20;
```

The amounts behind a mismatch are private: compare them only in the SQL editor.

**Fix.** Run the day again (4.6). Most mismatches are a late edit, a void or an adjustment the re-pull picks up. If the day stays unmatched, compare it privately with the POS's own daily report and record the explanation privately (ADR-014).

**Verify.** `unmatched 14d` is back to 0 and the day reads "đã đối soát".

### 4.5 Backfilling a month

One month per run keeps a backfill inside the call budget (400 connector calls per run). Load older history month by month, walking back with `--dry-run` until a month shows no sales. On the local stack one account-month took about a minute.

```sh
CI=1 pnpm --filter @fnb/jobs fnb -- sync window --account-number <n> --from 2026-10-01 --to 2026-10-31 --kind backfill --dry-run
CI=1 pnpm --filter @fnb/jobs fnb -- sync window --account-number <n> --from 2026-10-01 --to 2026-10-31 --kind backfill
```

From GitHub: dispatch "Sync" with `account_number`, `from`, `to` and `kind` = `backfill`. Analytics are refreshed after the window automatically.

**Verify.** `fnb status` shows the run succeeded and nothing unmatched; compare the month's totals privately with the POS monthly report.

### 4.6 Re-running a day

```sh
CI=1 pnpm --filter @fnb/jobs fnb -- sync window --account-number <n> --from <YYYY-MM-DD> --to <YYYY-MM-DD> --store <external id>
```

`--store` is optional and can repeat. A re-run is safe at any time: unchanged sales are skipped, changed ones are rewritten with an `edited` event, vanished ones are voided (an empty day only when the POS control totals confirm it). If another run holds the store, the window waits up to 10 minutes for it.

**Verify.** `fnb status` for that store; the day's badge.

### 4.7 Changing the POS password

1. Pick a quiet time: after the nightly run, outside opening hours.
2. Change the password in the POS back office (owner).
3. The same day, update `POS_ACCOUNTS_JSON` in all three places:
   - the owner's `.env`;
   - the GitHub secret `POS_ACCOUNTS_JSON` (Settings → Secrets and variables → Actions);
   - the Edge Function secret: write a file outside the repository with `POS_ACCOUNTS_JSON='<the JSON array>'` and `IPOS_APP_KEY='<the key>'`, each value in single quotes, run `pnpm exec supabase secrets set --env-file <that file> --remote=<project ref>`, then delete the file.
4. Check the `.env` copy with a fresh login: `CI=1 pnpm --filter @fnb/jobs fnb -- doctor`.
5. The runs reuse a cached POS session (`pos_account_tokens`) until it is within 12 hours of expiry, so a place still holding the old password can fail days later. To prove the other two places now: clear the cache, issue a ticket for one of the account's stores and post it with `"wait": true` as in 4.3 (this tests the Edge Function secret), clear the cache again and right away dispatch "Sync" for the account with a one-day window (this tests the GitHub secret, unless a scheduled tick logged in first).

```sql
delete from public.pos_account_tokens
where pos_account_id = (select id from public.pos_accounts where account_key = '<account-key>');

select app.issue_incremental_sync_ticket(s.id)
from public.stores s join public.pos_accounts a on a.id = s.pos_account_id
where a.account_key = '<account-key>' and s.active
order by s.external_id limit 1;
```

Add a tenant filter if several tenants use the same key.

**Verify.** `doctor` shows the login green; the ticket answers 200 with counts; the dispatched "Sync" run is green.

### 4.8 Rotating Supabase keys and provider tokens

Rotate at launch and whenever a person with access leaves ([secrets.md](secrets.md)). The order is always: rotate at the provider, update every place that holds the value, re-run the affected workflow, confirm the next scheduled run is green.

| Credential | Where to update | Verify with |
|---|---|---|
| Secret API key (`SUPABASE_SECRET_KEY`) | create a new secret key in the project's API settings, put it in `.env`, delete the old one; no workflow holds it | the next `fnb tenant add-member` that creates a login |
| Publishable key and URL | the GitHub variables `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_URL`, then dispatch "Deploy web app"; locally `apps/web/.env.local` | sign in on the Pages URL |
| Database password | reset it in the project's database settings; update `SUPABASE_DB_PASSWORD` and `SUPABASE_DB_URL` (GitHub secrets and `.env`) and the function secret `FNB_DB_URL` if it is set | dispatch "Backup database" or "Migrate database" (both link with the password; "Migrate database" also applies any migration not applied yet), and "Sync" with `dry_run` (the URL); a manual ticket with `"wait": true` (4.3) when `FNB_DB_URL` is set |
| Access token (`SUPABASE_ACCESS_TOKEN`) | create a new personal access token with the scopes in secrets.md, update the GitHub secret and `.env`, revoke the old one | dispatch "Deploy Edge Functions" or "Migrate database" |
| POS password, `IPOS_APP_KEY` | 4.7 | 4.7 |
| `NOTIFY_*` provider tokens and the e-mail sender | rotate at the provider; update the GitHub secrets and `.env`, and from 12c the Edge Function secrets. If the Zalo Bot itself must be replaced, every member links again with `fnb notify link` | `CI=1 pnpm --filter @fnb/jobs fnb -- notify test --tenant <tenant-slug>` prints "sent" per destination |
| Backup bucket keys | rotate at the storage provider; update `BACKUP_S3_ACCESS_KEY_ID` and `BACKUP_S3_SECRET_ACCESS_KEY` | dispatch "Backup database"; its summary logs the encrypted size |
| Backup `age` key | create a new pair with `age-keygen -o <file kept offline>`, set `BACKUP_AGE_RECIPIENT` to the new public key; keep the old private key as long as backups made with it are kept | the next backup; a restore drill (4.10) |

Phase 20b plans the move to the new key scheme with the legacy keys disabled.

### 4.9 Database size above budget

**Symptoms.** `fnb doctor` shows "database size" yellow (from 400 MiB) or red (from 475 MiB); the Supabase usage page agrees. With two stores the database grows by about 18 MiB a month.

**Checks.**

```sh
CI=1 pnpm --filter @fnb/jobs fnb -- doctor
```

```sql
select pg_size_pretty(pg_database_size(current_database()));
```

Retention runs only while the incremental schedule is enabled (2.1).

**Fix.**

1. Run the sync retention by hand: `select app.prune_incremental_sync_history();`
2. Reclaim dead rows after heavy reruns or tests: `vacuum (full, analyze)` on the large fact tables, one statement per table (`public.invoices`, `public.invoice_lines`, `public.invoice_payments`, `public.shifts`, `public.sale_payloads`), then on the aggregate tables the analytics refresh rewrites (every `public.agg_*` table: `agg_attach_daily`, `agg_basket_pairs_28d`, `agg_category_daily`, `agg_daily_sales`, `agg_hourly_sales`, `agg_item_daily`, `agg_modifier_prefs_daily`, `agg_payment_daily`, `agg_shift_cash`, `agg_size_mix_daily`). VACUUM cannot run inside a transaction block, needs free disk about the size of the table and locks it while it runs: do it after the nightly and outside opening hours. On the build machine this took the database from 338 MiB to 285 MiB after phase 7's test runs; at phase 10a's verification the fact tables alone left 308 MB and the aggregate tables brought it to 288 MB. On the cloud, autovacuum reuses most of that space by itself.
3. Ask the delivery team for code-level savings: two indexes duplicate the leading column of unique indexes (about 7 MB).
4. Decide gate G4: move to Pro before the database reaches the Free quota.

**Verify.** `doctor` shows the size green or yellow with room to spare.

### 4.10 Restoring a backup (drill)

No restore has been rehearsed yet; phase 20b plans the drill. Run it each quarter once backups exist, and record the result privately.

**Never restore into the build machine's local stack:** it holds the real tenant. Use a second Supabase project on the Free plan created for the drill (the Free plan allows two active projects), and delete it afterwards. The steps need the AWS command-line tool (or another S3 client), `age` and `psql`; none of them is installed on the build machine on 2026-11-12.

1. Find and fetch the newest backup:

```sh
aws s3 ls "s3://<bucket>/database/" --endpoint-url "<endpoint>"
aws s3 cp "s3://<bucket>/database/<file>.tar.gz.age" . --endpoint-url "<endpoint>"
```

2. Decrypt and unpack it, outside the repository:

```sh
age --decrypt -i <private key file> -o backup.tar.gz <file>.tar.gz.age
mkdir restore && tar -xzf backup.tar.gz -C restore
```

The archive holds `roles.sql`, `schema.sql`, `data.sql` and `auth-data.sql`.

3. Restore in the order Supabase documents (roles, schema, then data with triggers off), in one transaction:

```sh
psql --single-transaction --variable ON_ERROR_STOP=1 \
  --file restore/roles.sql \
  --file restore/schema.sql \
  --command 'SET session_replication_role = replica' \
  --file restore/data.sql \
  --dbname "<connection string of the drill project>"
```

Use the drill project's session-pooler string with `?sslmode=require`, as in go-live step 1. The default dump leaves out the `auth` schema, so the backup carries its data in `auth-data.sql`: restore it the same way, with `SET session_replication_role = replica` before it. This step has not been rehearsed; record exactly what worked.

4. Compare counts between production and the drill project, for example `select count(*) from public.invoices;` and the same for `invoice_lines`, `sync_checks`, `tenant_members` and `consent_records`.
5. Delete the drill project and the decrypted files.

**Verify.** The counts match the moment of the backup. For a real recovery, the new project then needs the GitHub secrets and variables of section 1.2 updated, the functions deployed, their secrets set and the schedules enabled again (go-live steps 2, 3 and 6).

### 4.11 A failed Pages, function or Mini App deploy

**Pages ("Deploy web app" red).**

- The build step fails when a check of the bundle fails: `check-bundle.mjs` refuses an e-mail address, a non-synthetic UUID, a JWT, a secret key or a 32-hex string in `dist` (a live build may contain only its own publishable key and URL); `check-size.mjs` refuses more than 400 kB of gzipped initial JavaScript, or a lazy chunk pattern that matches nothing.
- Reproduce the demo build locally: `VITE_BASE_PATH=/<repository>/ VITE_SUPABASE_URL= VITE_SUPABASE_PUBLISHABLE_KEY= pnpm --filter @fnb/web build`.
- Fix the cause in a build step (delivery team), then the owner pushes or re-runs the workflow. A deploy-only failure is re-run from the Actions tab.
- **Verify:** the Pages URL loads; open tabs offer "Có phiên bản mới — tải lại".

**Functions ("Deploy Edge Functions" red).**

- Which function: the job deploys the functions the push affects one after the other and does not stop at a failure. The summary has a line per function, "Deployed <name>." or "Deploying <name> failed; the functions deployed before it keep their new version.", and the job then fails naming every failed function. The functions deployed in the same run keep their new version, so only the failed ones need a second deploy, and nothing has to be rolled back.
- A stale import map: `node scripts/function-imports.mjs --check` fails. Regenerate the maps with `node scripts/function-imports.mjs`, then let the owner commit the new `deno.json` files.
- A type error or a failing Deno test: run `deno check index.ts` and `deno test --permit-no-files` in the function's folder under `supabase/functions` (CI's `code` job runs both for every function).
- A refused token: the access token lacks `edge_functions_write`, `edge_functions_read` or `projects_read` ([secrets.md](secrets.md)).
- A manual deploy from the owner's machine: `pnpm exec supabase functions deploy <name> --remote=<project ref> --yes`; to redeploy everything, dispatch "Deploy Edge Functions" from the Actions tab, which deploys every function.
- **Verify:** a manual ticket with `"wait": true` answers 200 with counts (4.3).

**Mini Apps ("Deploy Mini Apps" red).** The build of one Mini App failed its size budgets or its build, or `zmp-cli` refused the login or the deploy. The loop stops at the first failure: the Mini Apps listed before it keep their new version, the ones after it keep their old one. Read the step's log, which numbers the Mini Apps ("Mini App 2 of 4: customer, development build") and names no brand; fix the cause, then re-run the workflow, which deploys every Mini App again and spends one more deploy of each from the quota (4.17).

### 4.12 A paused Free project

**Symptoms.** Every job that touches the database fails; the web app cannot sign in or load; Supabase sent a warning e-mail about a week before. From 12c, the failure listener's `fnb notify job-failed` exits 3 (database unreachable) and its database-free fallback message goes out instead. Beforehand, `fnb doctor` shows the pause risk yellow from 5 idle days and red from 7.

**Fix.** The owner restores the project from the Supabase dashboard; the data stays intact ([deep-dives/supabase-platform.md](deep-dives/supabase-platform.md)). Then:

```sh
CI=1 pnpm --filter @fnb/jobs fnb -- doctor
```

Check that `cron.job` still lists `sync-incremental` if the schedule was enabled (4.3). Run the missed days: the nightly covers 14 business dates; a longer gap needs a backfill (4.5).

**Prevent.** Keep the nightly green, because it is the activity that keeps the project awake, and fix an `auth_failed` account within days.

**Verify.** `doctor` and `status` green; the badge fresh.

### 4.13 Onboarding a new shop, store or POS account

**A new store under an existing account.**

```sh
CI=1 pnpm --filter @fnb/jobs fnb -- sync master --account <account-key>
```

It discovers the store with its time zone and business-day start. Then backfill its history month by month with `--store <external id>` (4.5). Until the phase 10b settings pages exist, enter its opening hours in SQL; the database refuses a wrong shape:

```sql
update public.stores
set opening_hours = '{"mon": [["07:00", "22:00"]], "tue": [["07:00", "22:00"]], "wed": [["07:00", "22:00"]], "thu": [["07:00", "22:00"]], "fri": [["07:00", "22:00"]], "sat": [["07:00", "22:00"]], "sun": [["07:00", "22:00"]]}'
where id = '<store id>';
```

Keys run from `mon` to `sun`; each holds `[open, close]` pairs. A weekday without a pair counts as closed. A member limited to some stores (`tenant_members.store_ids`) does not see the new store until its id is added there. A store to leave out of the incremental sync gets `{"incremental_sync": false}` in `stores.settings`.

**A new POS account (another brand).**

1. Append the entry to `POS_ACCOUNTS_JSON` in `.env` with a neutral key such as `account-3`. Append, never insert: CI and the dispatch input name accounts by position.
2. `pnpm --filter @fnb/jobs fnb -- onboard --tenant <tenant-slug> --account <account-key>` (without `CI=1` if you need to see the store names; never share that output). Check each store's time zone and day start.
3. Backfill month by month (4.5).
4. Put the entry in the GitHub secret (`--print-secret-entry` prints it; it is refused in CI) and in the Edge Function secret (4.7, step 3).

**A new shop (a new tenant)** follows [go-live.md](go-live.md) step 4:

```sh
CI=1 pnpm --filter @fnb/jobs fnb -- tenant create --name "<company>" --slug <tenant-slug> --currency VND --locale vi-VN --timezone Asia/Ho_Chi_Minh --legal-form <form>
FNB_MEMBER_PASSWORD='<a long password>' pnpm --filter @fnb/jobs fnb -- tenant add-member --tenant <tenant-slug> --email <login e-mail> --role owner
```

`--invite` sends an invitation instead, through the project's SMTP. Then onboard its accounts as above and link its digests with `fnb notify link` (12a). Another owner runs their own deployment instead (roadmap section 8).

**Verify.** `CI=1 pnpm --filter @fnb/jobs fnb -- status --tenant <tenant-slug>` lists the stores with checked days; the member signs in and sees them.

### 4.14 Removing a member

**A person on the staff roster** (anyone who uses the staff Mini App): an owner or manager whose stores cover every store of the person opens Cài đặt → Nhân viên and chooses "Ngừng" on the person's card, then confirms. `deactivate_staff` removes the membership with its destinations and binding codes, deletes the person's Zalo identities in the tenant and the live pairing code, and revokes every Auth session of the login, so the staff app signs them out at its next call; the roster row stays as "Đã ngừng" and the consent ledger as evidence. If the person also receives notifications, run step 1 below first, while the membership still exists; afterwards rotate what they knew (step 4). Steps 2 and 3 are not needed: a login made at pairing has no password and no inbox, so it cannot sign in anywhere once its identities are gone. "Mở lại" later puts the row back to "Chờ ghép nối": access returns only with a new pairing code (4.19).

**Any other member** (a web login without a roster row, or when the roster cannot be used):

1. Stop their notifications and withdraw their notifications consent (12b, in build):

```sh
CI=1 pnpm --filter @fnb/jobs fnb -- notify unlink --tenant <tenant-slug> --member <login e-mail> --all
```

2. Remove the membership. No CLI command does this yet; in the SQL editor:

```sql
delete from public.tenant_members
where tenant_id = (select id from public.tenants where slug = '<tenant-slug>')
  and user_id = (select id from auth.users where email = '<login e-mail>');
```

The trigger `tenant_members_redact_notifications` redacts their message rows at once; their destinations go with the membership; the consent ledger row stays as evidence. If the login is on the staff roster, the trigger `tenant_members_deactivate_staff` marks the roster row inactive too, so the roster never shows access the person no longer has; their Zalo identities and sessions stay until step 3 or a `deactivate_staff`, but RLS reads `tenant_members`, so they read nothing.

3. If the person should lose the login altogether, delete the user in the Supabase dashboard (Authentication → Users); every membership of that login goes with it.
4. Rotate every shared credential the person knew: the POS passwords (4.7) and anything else they had (4.8).

**Verify.** The person sees no tenant data after signing in, or cannot sign in; the staff app answers "not linked" at its next open; `fnb notify status --tenant <tenant-slug>` shows no destination of theirs; on Nhân viên the person's card reads "Đã ngừng".

### 4.15 Handling a data-subject request

The law sets the deadlines ([deep-dives/vietnam-legal-requirements.md](deep-dives/vietnam-legal-requirements.md)): a first response within 2 working days; completion within 20 days, or 30 when a processor handles the data. The owner is the controller and answers; the operator records and acts. The dashboard tooling arrives in phase 17a; until then requests are handled in the SQL editor.

1. **Record** the request; the trigger fills both deadlines from the tenant's country and time zone:

```sql
insert into public.data_subject_requests (tenant_id, subject_type, contact, request_type)
select id, 'customer', '<how the requester asked to be answered>', 'access'
from public.tenants where slug = '<tenant-slug>'
returning id, first_response_due_at, completion_due_at;
```

`subject_type` is `customer` or `staff`; `request_type` is `access`, `correction`, `deletion`, `export`, `objection` or `withdraw_consent`. Set `uses_processor` to true when a processor handles the data for this request; the legal read (Track Z) settles when that applies.

2. **Find the data.** Members: the login e-mail (Supabase Auth), `tenant_members`, `notification_channels`, `outbound_messages`, `consent_records`; staff on the roster also `staff_roster` (name, role, stores, status, and the phone if they linked one) and `zalo_identities` (the per-app Zalo user id and display name). Customers, as the POS sends them: `customers` (phone, name), `invoices.customer_phone` and `customer_name`, and the raw payloads in `sale_payloads`. Cashiers: `shifts.cashier_name`. Backups hold copies for as long as they are kept.
3. **Act.**
   - Access or export: on Khách hàng → Yêu cầu về dữ liệu, record the request linked to the customer (look the customer up on Tra cứu dữ liệu, which keeps the phone masked) and press Tải dữ liệu (JSON), or run `select public.dsr_export('<request id>')`; hand the file over through a private channel, never through the repository or a group chat. The file holds every row of that customer and nothing of anyone else.
   - Correction: members in Auth and `tenant_members`; a customer's name in our copy with Sửa tên on the request (`public.dsr_correct`); POS data in the POS itself, then run those days again (4.6).
   - Deletion of a member: 4.14. Of a customer: remove the data in the POS first, because a re-sync of those days brings back what the POS still holds. Then an owner with every store runs the deletion on the request (the customer's own "Rời chương trình" in the Mini App records one with the customer named; a request recorded by hand needs `subject_id` set to the `customers.id` first):

```sql
select public.dsr_delete('<request id>');
```

   It removes, in one transaction, the customer's memberships with their ledger rows, stamps, claims, check-ins, redemptions (a held pool code is quarantined), queue items, refusals and loyalty requests, the consent records, the Mini App logins with their Auth users, and the `customers` row; it redacts the customer's message rows; it completes the request and logs the counts per table with both deadlines in `data_subject_request_actions`. Running it again answers the logged result and deletes nothing. The customer's invoices lose the POS phone and name, and the raw POS documents in `sale_payloads` lose the customer and e-invoice buyer fields of those sales and every text that writes the phone (`sale_records_scrubbed` in the counts); a later sync or the nightly re-pull that brings the phone back is blanked and scrubbed on arrival. The POS itself still holds them: ask the cashier to remove the customer from those bills in the POS if the person asks for that too. Message rows of any other subject can be redacted with `select app.redact_outbound_for_subject('<tenant id>', '<customer or staff>', '<subject id>');`.
   - Objection or withdrawal of consent: for notifications, `fnb notify unlink --member <login e-mail> --all` (4.14, step 1); for `staff_ops`, only the person withdraws it, in their own session (`withdraw_staff_ops_consent`; the app's screen for it is still to come), which unpairs their Zalo identities and ends their sessions; when they ask the owner instead, deactivate them on Nhân viên (4.14), which ends their access the same way. The loyalty and marketing purposes arrive with Track C.
4. **Close** the request:

```sql
update public.data_subject_requests
set status = 'completed', completed_at = now(), notes = '<what was done>'
where id = '<request id>';
```

Open requests and their deadlines:

```sql
select id, request_type, status, first_response_due_at, completion_due_at
from public.data_subject_requests
where status in ('received', 'in_progress') order by completion_due_at;
```

### 4.16 Responding to a personal-data breach

A breach is any unauthorised access to, loss of or disclosure of personal data: member e-mails and chat ids, customer phones and names, cashier names, consent evidence. The personal-data law requires notice to the Ministry of Public Security (A05) **within 72 hours**, and breach records are kept **5 years** ([deep-dives/vietnam-legal-requirements.md](deep-dives/vietnam-legal-requirements.md); ADR-021). The owner notifies, with legal advice; this runbook gets the facts ready. Phase 17a builds the full breach runbook with its tooling (roadmap); until then these steps apply.

1. **Contain, in the first hour.** Rotate every exposed credential (4.8). Disable a compromised login (Supabase dashboard, Authentication → Users). If the sync path is involved, pause the schedule with `select app.disable_incremental_sync();`, and disable the "Sync" workflow in the Actions tab if the nightly must stop too ("Scheduled workflows active" re-enables only workflows GitHub disabled for inactivity). To stop messages before 12c's switch exists, remove the `NOTIFY_*` GitHub secrets or unlink the destinations. If a secret reached the public repository, treat it as exposed: rotate first; rewriting git history needs the owner.
2. **Preserve evidence at once.** Platform logs are kept one day on the Free plan: export the relevant Supabase logs now. GitHub keeps run logs for 90 days by default.
3. **Assess within 24 hours.** Which data, which tenant, how many people, since when, and whether it left our control.
4. **Notify within 72 hours.** Count them from the earliest moment that could apply until the legal read confirms when the clock starts. The owner sends the notice with what is known and completes it later. Whether and how to inform the people affected is part of the legal read.
5. **Record** the breach, the timeline and the actions privately (never in this repository) and keep the record 5 years.
6. **Follow up:** fix the cause, add a test or a scan rule, update this runbook or an ADR, and add any new identifier to the private identifier list of the public-safety scan.

### 4.17 Mini App deploys

`deploy-mini-apps.yml` (phase 13, #208) builds and deploys each brand's staff and customer Mini Apps. On 2026-11-24 the first Development versions of brand-1's two Mini Apps were uploaded by hand from the owner's machine (`zmp-cli@4.0.5 login` by QR, which needs the owner to approve once in Zalo, then `deploy --existing --passive --outputDir dist`), built with `VITE_ZALO_RUNTIME=zalo`, `VITE_MINI_APP_STAGE=development` and the cloud project's public URL and publishable key; the cloud project's address was added to both Mini Apps' API domains. Two findings: the app folder's `app-config.json` must be the built one (fixed in the workflow), and a Zalo build is over the script budget (G-107). Before that day it had never deployed: it needs the owner's Zalo accounts and Mini App ids (#8), the `mini_apps` rows, the developer token in `zalo_tokens` (#206) and the `fnb zalo app-config` and `fnb zalo zmp env` commands, which are not built yet.

- **Which version.** A push to `main` that touches `apps/zalo-staff`, `apps/zalo-customer`, `packages/zalo-mini`, `packages/design-tokens`, `pnpm-lock.yaml` or the workflow deploys a Development version of every configured Mini App; a manual dispatch does the same. A tag `mini-v<version>` (for example `mini-v0.1.0`) deploys a Testing version, the one a Zalo review or a tester opens. Each version's description is the branch or tag and the commit.
- **What a run does.** It masks the credential fields, lists the configured Mini Apps with `fnb zalo app-config --list`, then for each one, numbered in the log: writes its `app-config.json` from the `mini_apps` row, builds it for the Zalo runtime with the size budgets (3 MB a file, 10 MB a version, no ECharts), gets its Mini App id and developer token from `fnb zalo zmp env` into a `.env` that it deletes afterwards, and runs `zmp-cli@4.0.5 login` and `deploy`. The summary ends with how many builds were deployed and at which stage.
- **Quotas.** Zalo allows 300 Development and 60 Testing deploys per Mini App in 30 days. Every push to `main` that touches the paths above spends one Development deploy of each Mini App of every brand, and every tag one Testing deploy of each; a re-run spends them again. Keep Testing tags for real submissions, and group Mini App changes into fewer pushes when a month is busy.
- **A skipped run is green and deploys nothing.** Its summary says why: "Mini App deploys are not configured yet (missing: …)" names the missing secret `SUPABASE_DB_URL` or variable `SUPABASE_URL` or `SUPABASE_PUBLISHABLE_KEY`; "The fnb zalo commands that read the mini_apps rows are not built yet" means the CLI lacks them (they are still to be built in phase 13); "No Mini App is configured in the mini_apps rows yet" means the owner's rows are missing. None of them is a failure.
- **From mock ids to the real ones.** A brand set up for `pnpm zalo:dev` holds mock ids (`mock-…`), and `fnb zalo config set` refuses to change a stored row. Once the owner's Zalo App, OA and Mini App ids exist (#8): run `pnpm zalo:dev forget --tenant <slug> --brand <key>` on the machine that holds the rows, which removes the brand's Zalo rows and mock identities only when every Zalo id and every bound identity is a `mock-` one and nothing else hangs off the brand (it removes nothing and says why otherwise); then `fnb zalo config set --tenant <slug> --file <brand.json>` with the real ids, from a file outside the repository; then `fnb zalo bind --tenant <slug> --member <login e-mail> --brand <key>` for each owner or manager who signs in to the Mini App with an existing login, while staff on the roster pair with a code from Nhân viên (4.19).
- **Allowed domains in the Zalo runtime.** The staff app calls `zalo-session` and, for its home, the Data API (`/rest/v1`) directly at the project's `https://<project ref>.supabase.co`. Add that domain to each Mini App's allowed domains in the Zalo developer console before the first Development version is opened on a phone; whether the Data API's own CORS answer works from inside Zalo is part of the device check (#210).
- **Before a tag.** Run CI's checks locally on the commit: `pnpm --filter @fnb/zalo-staff build`, `pnpm --filter @fnb/zalo-customer build` and both apps' `test:e2e` ([development.md](development.md), section 3). A Testing build refuses the Development-only probe screen, so a probe left in the code fails the build, not the review.
- **The real sign-in check (G-109).** The automated suites run on a stand-in Zalo whose token and App secret always match, so a wrong `ZALO_APP_SECRET_<BRAND>` in the cloud's function secrets passes every test and still breaks every sign-in on a phone ("The data could not be loaded", code `session 401 zalo_token_refused`). After any change to a Zalo App secret, to `zalo-session` or to a brand's Zalo rows, and before telling the owner a version is ready, run one real sign-in: the owner gets a "User Access Token" for the brand's Zalo App in Zalo for Developers > Tools > API Explorer (this asks once to allow the app to read their name and avatar), save it to a file outside the repository, then `SUPABASE_URL=<project URL> SUPABASE_PUBLISHABLE_KEY=<publishable key> node scripts/zalo-sign-in-check.mjs --token-file <file> --brand <key>`, and delete the file. It prints only status codes, counts and a diagnosis. "Zalo accepts the token but the cloud refuses it" has two causes, told apart by the Graph error in the `zalo-session` log (Edge Functions > zalo-session > Logs, last hour): `453` means the stored App secret is not the Zalo App's key (copy it again from the Zalo App's settings into the function secrets; no redeploy is needed); `-501` means the Graph refused the cloud server itself, which it does to every server outside Vietnam, so the relay is not running or not announced (section 4.20). "Signed in and the home answered" with notes on a missing programme, store list or privacy notice means the sign-in works. A user token lasts about an hour.
- **Verify:** the summary counts the deployed builds and names their stage, the real sign-in check answers "Signed in and the home answered", and the Development build of each Mini App opens on the owner's phone (#210).

### 4.18 Zalo disabled the webhook, or signatures do not match

`oa-webhook` (#207) receives each brand's OA events. It is built against fake events and not deployed; the steps below apply once the owner's Zalo accounts exist and the function is deployed (#8, #210). Zalo retries a webhook only when the connection fails and disables a webhook that keeps failing, so the function answers 200 within 1.5 seconds to everything it can parse, stores after the answer when the database is slow, and answers 401 only in `enforce` mode. Each OA has a mode, `oas.webhook_mode`: `observe` (the default) stores every event with its signature outcome, `enforce` refuses a missing or wrong signature and stores only the day's count.

- **Symptoms.** `zalo_webhook_unverified` reaches the owner: more than `max_per_day` calls of one OA in a day failed the signature check. Or no OA event arrives at all, `last_interaction_at` stops moving, and the Zalo developer console shows the webhook disabled. Or `oa-webhook` logs `invalid_signature` 401s, or 500 `not_configured`.
- **Look first.** In the SQL editor, `select day, signature, events from app.oa_event_days where oa_id = '<OA row id>' order by day desc limit 14;` gives the count per outcome: `raw` or `compact` matched, `mismatch` and `missing` failed and were stored (observe mode), `refused` failed in enforce mode. An owner reads the same counts through `public.oa_event_counts`. The function's log lines (Edge Functions → `oa-webhook` → Logs) carry the event name, the outcome, the mode and the follow-up, never the user or the text, each line starting with the request id.
- **500 `not_configured`.** The secret that `oas.secret_name` names is not set, or the database URL is missing or allows plaintext: set the secret from a file outside the repository ([secrets.md](secrets.md)); no redeploy is needed.
- **Every call `mismatch`.** The OA secret key is wrong or was regenerated in the Zalo console, or the rows name another brand's secret: compare `oas.secret_name` with the secret you set, set the current OA secret key, and watch the next events turn `raw` or `compact`. Until #210 confirms the exact bytes Zalo signs, a whole day of `mismatch` with the right key means the signed bytes differ from the two forms the function tries; keep the OA in `observe` and report it.
- **Every call `missing`.** The events come without `X-ZEvent-Signature`: check that the console sends to `oa-webhook` of this project and not to another URL in front of it.
- **Some calls fail, most match.** Calls from someone other than Zalo. In `observe` mode they are stored with their outcome and followed up like real events, so a forged follow or message moves `last_interaction_at` and a forged unfollow disables a destination; switch to `enforce` once the real events match.
- **The webhook was disabled.** Check that the function is deployed and answers (an empty `POST` with `{}` gets 200 `{"ok": true}` and stores nothing), that the project is not paused (4.12) and that `oa-webhook` is in `supabase/config.toml` with `verify_jwt = false`. Then re-enable the webhook in the Zalo developer console. Events Zalo sent while it was disabled are not replayed; a member who wrote to the OA meanwhile counts as interacting again at their next message.
- **Switch an OA from `observe` to `enforce`.** Do it once the first real events of the OA match (#210): a day or more of `raw` or `compact` and no `mismatch` or `missing`. As an owner through the API, or as `postgres` in the SQL editor: `update public.oas set webhook_mode = 'enforce' where external_id = '<OA id>';`. The function reads the mode at every call, so the next call follows it; nothing to redeploy. `fnb zalo config set` refuses to change a stored row, so it cannot switch the mode. Switch back the same way if real events start failing.
- **Verify:** the day's counts show `raw` or `compact` only, no `zalo_webhook_unverified` episode stays open, and a follow or a message to the OA moves the member's `last_interaction_at`.

### 4.19 Staff pairing support

Staff pair their Zalo account with their row on the staff roster once (#213): an owner or manager issues a 6-digit code on Cài đặt → Nhân viên, and the person, in the brand's staff Mini App, reads the staff notice, accepts it and enters the code. The server side is built and tested against a mock of Zalo; the app's screens for the notice and the code are in progress (#215), and nothing is live before the owner's Zalo accounts exist (#8). [user-guide.md](user-guide.md) has the owner's side, [schema.md](schema.md) the rules.

- **Before anyone pairs.** The tenant has a published Vietnamese staff notice (Cài đặt → Pháp lý, kind "Thông báo cho nhân viên"): without one no code is checked. The person has a roster row that is not "Đã ngừng"; the brand has its staff Mini App row and the store a store code, so Nhân viên can draw the store's QR code.
- **Issuing a code.** "Tạo mã ghép nối" on the person's card shows the code once, with a 10-minute countdown; nothing stores it but a hash, so a code that was lost is replaced by issuing a new one, which also ends the old one. A refusal says why: the person works in a store outside the issuer's scope (`42501`), or the row is inactive or belongs to a login that is an owner, viewer or publisher of the tenant (`22023`).
- **"The code was refused."** The app shows the same answer for a wrong, expired, used, replaced or burnt code and for a row that was deactivated in the meantime, on purpose. Check the person's card: "Đã ngừng" needs "Mở lại" first; otherwise issue a new code and have it typed within 10 minutes. Five wrong codes in the tenant's apps are tolerated while a code is live; the sixth burns every live code of the tenant, so issue new ones.
- **"Wait."** Five wrong codes from one Zalo account make that account wait 15 minutes; the app gets the seconds left. Nothing needs resetting: wait, then use a fresh code.
- **"The notice changed."** A pairing request names the notice version the person read; if a newer one was published meanwhile, the code is not checked. Reopen the app, read the new notice and try again.
- **Asked for the notice again after pairing.** A newer staff notice was published. Accepting it in the app records the new version and signs the person in; nothing for the operator to do.
- **"Đang hoạt động" but "Chưa ghép nối".** The person withdrew their `staff_ops` consent, which unpaired their Zalo account and ended their sessions while the membership stays. Issue a new code if they want to use the app again.
- **Not linked at every open.** The row was deactivated, the membership removed (4.14), or the Zalo account belongs to another brand's app, which is a separate identity: a code works in every brand's staff app of the tenant, so pair again in that app.
- **Look at the logs.** `zalo-session`'s lines (Edge Functions → `zalo-session` → Logs, once deployed; the `[zalo-session]` lines of `pnpm zalo:dev` locally) say what happened without a code, name or id: "unpaired: the pairing code was refused", "unpaired: the identity waits after too many wrong codes", "unpaired: the accepted notice is not the published one", "notice required: the staff_ops consent is missing or outdated", or "session minted: staff, 1 stores, identity bound, login created".
- **Look in the database** (SQL editor, as `postgres`): `select display_name, status, paired_at, deactivated_at from public.staff_roster where tenant_id = '<tenant id>' order by display_name;` gives each person's state; `select count(*) from app.staff_pairing_codes where tenant_id = '<tenant id>' and expires_at > now();` the live codes (their hashes say nothing).
- **Verify:** the person's card reads "Đang hoạt động" and "Đã ghép nối ngày …", and the staff app opens on Trang chủ with their stores.

### 4.20 Importing a voucher code pool

A store on the CRM code-pool rail (`crm_code_pool`) hands out single-use codes that iPOS CRM generated (#244). Run this on the owner's machine; the commands refuse to run with `CI` set because the files hold live codes.

1. **In iPOS CRM**, create one "Xuất danh sách voucher" programme per reward, with an accounting type that shows on the bill ("Chiết khấu trên tổng hóa đơn" or "Giảm giá trên từng món"), and export its codes: at most 1,000 per run, sent by e-mail as Excel.
2. **Save the export as CSV.** Open it in Excel and use Save As → "CSV UTF-8", into a folder outside the repository. The code must be in the first column; a header row is fine.
3. **Map the reward first** if it is new: its `coupon_rail_rewards` row at the store, with the programme's id as `crm_programme_external_id`.
4. **Import:** `pnpm --filter @fnb/jobs fnb -- loyalty codes import --tenant <slug> --store <store code> --reward <key> --file <path>.csv` (add `--expires <ISO instant>` when the export has an end date). The line printed holds counts only: rows read, malformed and duplicate rows refused, codes inserted, already in the pool, used elsewhere. Importing the same file again inserts nothing.
5. **Delete the CSV and the e-mail attachment** once imported; the codes now live in the database only.
6. **Watch the stock:** `fnb loyalty codes status --tenant <slug>` counts available, assigned, used, quarantined and expired codes per store and reward. When the available count of a reward runs low, export and import the next batch; an empty pool answers `no_code_available` in the customer app.
7. **Reconcile with the vendor:** `fnb loyalty codes export --tenant <slug> --state used --out <path outside the repository>` (or `--state quarantined`) writes the codes with the invoice that used them. A code burns at the till as soon as it is typed, so a code removed from a bill reads "Đã sử dụng" in CRM without an invoice: it stays assigned until the 24-hour release quarantines it, and appears in the quarantined export.
8. **Verify:** after the next sync, a code typed at the till shows as used in `codes status` (the reconciliation's `pool_codes_used` count) and the redemption as Đã dùng in the app.

### 4.21 The voucher callback refuses or does not answer

The `voucher-callback` Edge Function answers the codes a cashier types on a CRM multi-use programme (#243, [api.md](api.md#voucher-callback)). It is off until the store's `coupon_rails` row has `callback_enabled = true`; switch it on only after the iPOS hotline has confirmed the method, timeout, retries, source addresses and result code (questions 6 to 8 of the [integration design](deep-dives/ipos-loyalty-integration-design.md#questions-for-the-ipos-hotline)).

- **Set up.** `fnb loyalty callback-path issue --tenant <slug>` prints the URL once; enter it as the programme's callback link in iPOS CRM. On the store's `crm_callback` rail row set `callback_store_ref` to the store's POS id (`fb_store_id`, the `pos_id` of its invoices) and, once known, `callback_ip_allowlist` to the vendor's addresses. Before filling the list, set the function setting `VOUCHER_CALLBACK_PROXY_HOPS` to the number of proxies in front of the function on the hosted platform (one test call from a known address, with the list holding only that address, must answer something other than 403): the function never trusts the first `x-forwarded-for` entry, which the caller can write.
- **The till shows 0 ₫ with a reason.** The reason names the outcome: "Cửa hàng chưa bật kiểm tra mã ưu đãi" (switched off), "Cửa hàng chưa được cấu hình…" (no rail carries that store reference), "Mã đã được sử dụng" (answered for another sale, or confirmed), "Mã không hợp lệ", "Mã đã hết hạn", "Hóa đơn chưa đạt giá trị tối thiểu", "Hóa đơn không có món được áp dụng". A refusal binds nothing: correct the bill and type the code again.
- **"Hệ thống đang bận".** The database did not answer within 2.5 seconds. Type the code again on the same bill: a stored answer is replayed.
- **Nothing reaches the function, or every call gets 404.** The URL in CRM is wrong or was revoked; issue a new one (which revokes the old) and update the programme. A 403 means the POS called from an address outside the allow-list.
- **Look at the log** (SQL editor, as `postgres`): `select logged_at, store_id, outcome, discount_amount, latency_ms from app.voucher_callback_log where tenant_id = '<tenant id>' order by logged_at desc limit 50;` holds outcomes only, never a code. The function's own lines (Edge Functions → `voucher-callback` → Logs) give the outcome and duration per call.
- **An answered sale never syncs** (the bill was cancelled after the code was applied). The redemption stays held, is listed as `verified_without_invoice` after the grace hours and is released by the nightly job at the end of its hold.
- **To stop the callback at once,** set `callback_enabled = false` on the rail row, or revoke the path with `fnb loyalty callback-path revoke --tenant <slug> --label pos-crm`; the cashier then sees 0 ₫ and the staff app's verification still works on the other rails.

### 4.22 The OA chat menu, the welcome and the no-app enrolment

Each brand's OA gets a chat menu and a welcome, and a customer can join from the chat by sharing name and phone in Zalo's `request_user_info` form (#276, #277; [api.md](api.md#oa-webhook), [schema.md](schema.md#oa-menus-oa-users-and-the-no-app-enrolment-phase-19a)). Everything is built against a mock of the OA Open API. Nothing reaches Zalo until the owner's accounts exist (#8) and the steps below are done.

- **Set up, once per brand, after the OA is verified, on `tang_truong` or `toan_dien`, authorised (`fnb zalo oa authorize`) and its signatures matching (4.18, #210).**
  1. Put the brand's logo, a square https image, where Zalo can fetch it. The form needs it.
  2. Write the menu: `fnb zalo oa-menu set --tenant <slug> --brand <key> --form-image-url <https URL>` takes the default buttons (Tham gia thành viên as the join keyword; Điểm của tôi, Voucher của tôi and Mở ứng dụng thành viên as links into the customer Mini App) and the default Vietnamese texts. `--file <menu.json>`, kept outside the repository, replaces any of them (`fnb zalo oa-menu set --help` lists the fields). The welcome and the replies are consultation messages: never a promotion, a price or a discount. The joined text must keep saying that promotions are opt-in from the Mini App.
  3. Check: `fnb zalo oa-menu apply --tenant <slug> --brand <key> --dry-run` prints the buttons, their links and the diff, and calls nothing. The links point at `https://zalo.me/s/<customer Mini App id>/…`, so the brand's customer row in `mini_apps` must hold the real Mini App id first (`fnb zalo config set`).
  4. Push: the same command without `--dry-run`. If Zalo refuses it, the OA Open API's menu path or body may differ from the one built here (`POST /v3.0/oa/menu` with `{"menus": [...]}`, taken from third-party documentation and unverified). Then enter the buttons the dry run printed by hand in OA Manager (Quản lý → Menu) and report the error code.
  5. Switch the replies on: `pnpm exec supabase secrets set ZALO_OA_MESSAGES=1 --project-ref <ref>`. Until then every due reply is logged as `cancelled` (`messages_off`), and the enrolment through the form still runs.
  6. On a phone, follow the OA: one welcome arrives with the buttons. Tap Tham gia thành viên: the form arrives. Send it: the joined text arrives, and the customer shows in Khách hàng with the channel `oa_form`. Record the run privately, without the phone.
- **No welcome after a follow.** `select event_name, signature, customer_step from public.oa_events where oa_id = '<OA row id>' order by received_at desc limit 20;`:
  - `unverified`: the signature does not match (4.18). Nothing is sent and nobody is enrolled until it does, in `observe` mode too.
  - `no_welcome`: the OA has no menu, or its welcome is off.
  - `already_welcomed`: the user was welcomed in this follow or in the last 24 hours.
  - `stale`: the event arrived more than 48 hours late.
- **The step ran but nothing arrived.** `select template_ref, status, last_error_code, sent_at from public.outbound_messages where tenant_id = '<tenant id>' and channel = 'zalo_oa' order by created_at desc limit 20;`:
  - `cancelled` with `messages_off`: `ZALO_OA_MESSAGES` is not set.
  - `cancelled` with `no_token`: no valid OA access token, or the package has no Open API; check `fnb zalo status`.
  - `failed` with `zalo_m230`: the user has not interacted with the OA in 7 days.
  - Other `zalo_m…` codes are Zalo's error codes with the minus written `m`.
  - `uncertain`: the answer was lost. Nothing is retried.
- **A customer cannot join from the chat.** `customer_step` names the reason:
  - `refused_phone_invalid`: the form's phone does not read as a phone.
  - `refused_phone_in_use`: the phone is enrolled as, or tied to, another OA user of this OA. The customer can join in the Mini App, whose phone comes from Zalo's phone token.
  - `refused_policy_missing`: no privacy notice is published (Pháp lý).
  - `refused_no_programme`: no active loyalty programme.
  - `form_recent`: a second tap within two minutes of a form.
  - `outside_window`: the tap was handled more than 48 hours after it.
- **Change the menu:** run `set` again with the new values, then `apply`. An unchanged menu is never pushed twice.

### 4.23 Customer messages: ZBS templates and consultation messages

Customer messages (#278 to #280; [schema.md](schema.md#customer-messaging-phase-19a), [the template drafts](loyalty/zbs-templates.md)) are built against a mock ZBS provider and a mock OA Open API. Nothing is sent to a customer, and nothing costs money, until the steps below are done.

- **Owner steps, once per brand (#16):**
  1. Fund the brand's ZBS account (at least 50,000 ₫ a top-up, non-refundable), linked to the brand's verified OA on `tang_truong` or `toan_dien`, and authorise the Zalo App for the OA (`fnb zalo oa authorize`, so `zalo_tokens` holds a live OA token).
  2. Submit the six drafts of [zbs-templates.md](loyalty/zbs-templates.md) in the ZBS console with the logo in its light and dark versions and the category question. Record each template id as a `zbs_templates` row (`pending_review`), then the decision (`approved` or `rejected`) once the console shows it, and the reviewers' answer in [roadmap.md section 11](roadmap.md#11-open-questions).
  3. Switch the tenant on, as `postgres` on the owner's machine: `insert into app.customer_message_settings (tenant_id, enabled) values ('<tenant id>', true) on conflict (tenant_id) do update set enabled = true;`. In-app notices and free consultation messages work from here; `zbs_enabled = true` adds paid templates, and `promotions_enabled = true` adds birthday and win-back (only when the reviewers accepted them). Keep `zbs_daily_quota` at or below the OA's ZBS quota tier.
  4. Run the dispatcher with `NOTIFY_CUSTOMER_MESSAGES=on` and `NOTIFY_CUSTOMER_LIVE=1`. The second is the only switch that lets it call the real Zalo hosts; without it only a loopback mock named in `NOTIFY_ZBS_BASE_URL` or `NOTIFY_ZALO_OA_BASE_URL` is called, and in-app notices still close.
  5. Check on the owner's phone: hold a test reward in the Mini App and time the voucher template until it arrives (the target is 2 minutes with the Supabase dispatcher of 12c; with `fnb notify tick` it is the next tick). Record the run privately.
- **What happened to a message:** `select kind, channel, status, decision, hold_reason, last_error_code, params ->> 'route' as route from public.outbound_messages where tenant_id = '<tenant id>' and subject_type = 'customer' order by created_at desc limit 20;`
  - `sent` on `mini_app` with the decision `in_app_only`, `outside_window`, `no_template`, `templates_disabled`, `no_recipient` or a hold reason: it stayed in the app, at no cost.
  - `cancelled` with `no_consent`, `no_marketing_consent`, `membership_inactive`, `messaging_disabled`, `subject_removed` or `expired`: deliberately not sent.
  - `held` with `outside_hours`, `daily_cap`, `monthly_cap` or `zbs_quota`: it waits for `not_before`.
  - `queued` with `token_missing`: no live OA token; authorise the OA again.
  - `failed` with `balance_insufficient`: top up the ZBS account; `template_rejected`: the console's template and the registry differ; `user_unreachable`: the phone has no Zalo account or refuses templates.
  - `uncertain`: the provider's answer was lost (a timeout). It is never resent; check the ZBS console's history before doing anything.
- **Report rate:** read the day's reported count in the ZBS console and record it with `select app.record_zbs_reports('<OA row id>', date '<day>', <reported>);`. Above 1 % the owner gets `zbs_report_rate`; above 2 % Zalo lowers the daily quota. Look at the wording and the event that drew the reports, and switch that route to `in_app` until it is fixed.
- **Stop everything for a tenant:** `update app.customer_message_settings set enabled = false where tenant_id = '<tenant id>';`. Waiting messages are cancelled as `messaging_disabled` at the next tick.

### 4.20 The Zalo Graph relay (ADR-057)

The Zalo Graph answers error `-501` to every server outside Vietnam, so the cloud `zalo-session` and `zalo-phone` send their Graph calls through a relay in Vietnam: for now the shop's PC, later a small VPS in Vietnam. While the relay is down, sign-in fails on every phone ("The data could not be loaded", code `session 502 zalo_unavailable`, or `session 401 zalo_token_refused` once no announcement is fresher than 15 minutes).

- **Once: the key.** `pnpm zalo:relay --create-key` writes 32 random bytes to `%LOCALAPPDATA%\fnb-zalo-relay\relay.key` and prints nothing of them. Store the same value as the function secret `ZALO_RELAY_KEY` (Supabase dashboard > Edge Functions > Secrets). Never paste it into a chat, a ticket or the repository. The functions read secrets on each start; no redeploy is needed.
- **Start.** `SUPABASE_URL=https://<project ref>.supabase.co SUPABASE_PUBLISHABLE_KEY=<publishable key> pnpm zalo:relay`. It serves on 127.0.0.1:8790 and downloads the pinned cloudflared once (checked by SHA-256, as `pnpm zalo:dev --tunnel` does). It opens a quick tunnel and prints "the quick tunnel is open" and "announced to the cloud"; it never prints the address or the key. Every Graph call it carries prints one line: path, HTTP status, Zalo's error number, time.
- **Keep it running.** It announces itself every 5 minutes, opens a new tunnel 5 s after one stops and announces that, and stops on Ctrl+C. Sign-in works only while it runs.
- **Verify.** Run the real sign-in check of section 4.17. A relayed sign-in shows a `/v2.0/me: HTTP 200, Zalo error 0` line in the relay's output.
- **Problems.** "not announced: HTTP 401 relay_refused": the key file and the function secret differ, or the PC clock is more than two minutes off. "HTTP 404 relay_not_configured": the function secret is missing. `refused a request (stale)` in the relay: the PC clock is more than a minute off. `(sealed)`: something other than our functions knocked; nothing was forwarded.
- **Moving to a VPS in Vietnam.** Run the same command there, as a service, with the key file copied over a secure channel; stop the PC's relay. The newest announcement wins.

## 5. Maintenance calendar

| When | Task | Who | How |
|---|---|---|---|
| Daily | Open Hôm nay: a fresh freshness badge, yesterday "đã đối soát" | operator | web app |
| Daily, once phase 12 runs | Read the digest; act on its attention lines and on alerts | owner, managers | Zalo Bot, e-mail |
| Daily | Any red run in the Actions tab | operator | 4.1 |
| Weekly, Monday | "Backup database" ran and logged its encrypted size | operator | Actions tab |
| Weekly | `fnb doctor` all green, or every yellow understood | operator | 3.2 |
| Weekly | `fnb status`: `unmatched 14d` 0 and `checked 14d` 14 for every store | operator | 3.1 |
| Weekly, once phase 12 runs | `fnb notify status`: no `uncertain` message, no failing destination | operator | 3.6 |
| Weekly | "Scheduled workflows active" green | operator | 3.8 |
| Weekly, once an OA webhook is live | The OA webhook's day counts show matching signatures only, and the webhook is still enabled in the Zalo console | operator | 4.18 |
| Monthly | Database size trend against 400 MiB; egress against 5 GB in the Supabase usage page | operator | 3.2, 3.7 |
| Monthly | Compare last month's totals privately with the POS monthly report | owner | ADR-014 |
| Monthly | Open data-subject requests and their deadlines | owner | 4.15 |
| Monthly | Zalo Bot messages this month against the 3,000 allowed | operator | `fnb notify status` |
| Monthly, once Mini Apps deploy | Mini App deploys in the last 30 days against 300 Development and 60 Testing per Mini App | operator | "Deploy Mini Apps" runs in the Actions tab; 4.17 |
| Monthly | At least one commit, so GitHub's 60-day inactivity rule never disables the schedules | owner | – |
| Quarterly | Restore drill | operator, with the verifier | 4.10 |
| Quarterly | Review who has access (members, the staff roster on Cài đặt → Nhân viên, GitHub collaborators, the Supabase team); rotate after anyone left | owner | 4.8, 4.14 |
| Yearly, before 1 January | The seeded public holidays and Tết windows cover 2024 to 2028: add the next years before they start | delivery team | a migration |
| Yearly | Legal watch (the Decree 91 replacement, personal-data decrees, the e-invoice decree) and the privacy notice | owner | the legal read |
| Yearly, and at gate G4 | Supabase plan: Pro before public launch, or at about 400 MB, a second owner or mandatory daily backups | owner | roadmap section 6 |
| March 2028 | The year comparison drops one day after a leap year; check Năm then | delivery team | roadmap phase 9 |

## 6. Escalation by role

| Severity | Examples | First response | Who acts |
|---|---|---|---|
| 1, critical | personal data exposed; a credential leaked; data lost; the project down for every member | at once; the 72-hour clock of 4.16 may be running | owner, with the delivery team and legal advice |
| 2, major | no successful sync for a store through a business day; the digest missing; the project paused; a deploy broke the app | the same day | operator, then the delivery team for code or configuration defects |
| 3, minor | one unmatched store-day; one failing destination; a partial run; a yellow `doctor` check | within the week | operator |

| Role | Called for |
|---|---|
| Operator | first line: the badges, the digest, the Actions tab, the runbooks of section 4 |
| Owner | every credential, cloud change, vendor account and decision; legal notices; approving commits and pushes |
| Builder | defects in code, migrations or workflows; a fix goes through the definition of done ([plan.md](plan.md), section 2.4) |
| Verifier | confirming that a fix holds, on the real data |
| POS vendor (iPOS) | logins, the application key, API behaviour the connector cannot explain |
| Supabase | platform incidents, a paused or degraded project, billing |
| GitHub | Actions or Pages incidents |
| Zalo, the e-mail provider, the storage provider | their channel or bucket failing |
| Legal adviser | data-subject requests in doubt; breach notification; the dossier decision |
