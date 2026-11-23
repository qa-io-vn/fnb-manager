# Notifications: digests and alerts

How the daily digest and the operational alerts reach owners and managers, what the system guarantees, and what to do when something goes wrong. The decisions behind it are ADR-030 to ADR-033 in [decisions.md](decisions.md); the tables and functions are in [schema.md](schema.md), "Notifications and alerts (phase 12)"; the browser functions are in [api.md](api.md) section 3.5. Examples use placeholders and `example.com`, never real names, chat ids or figures.

## Contents

1. Concepts and guarantees
2. Destinations, linking and consent
3. Policies and their legal basis
4. Alert rules
5. The digest
6. Dispatch paths and budgets
7. Failure alerts for scheduled jobs
8. Settings → Cảnh báo and Bản tin on the web
9. Runbook
10. CLI reference
11. What is not built yet

## 1. Concepts and guarantees

- **Outbox.** Every message is one row of `outbound_messages`, inserted only by `app.enqueue_message` (directly, or through the digest, alert, link and test paths). A row moves `queued` → `sending` → `sent` (or `delivered`), or to `held`, `failed`, `cancelled` or `uncertain`; the trigger `outbound_messages_guard` refuses any other move.
- **Decision at claim time.** A dispatcher claims due rows with a lease and asks SQL (`app.message_decision`) whether to send now, hold until the window opens or a cap resets, or cancel (no consent, rule muted, destination inactive or removed, expired, no dispatcher holds the secret). Changing a policy, a mute or a consent therefore affects messages that are already waiting.
- **Exactly once, or `uncertain`.** If a dispatcher dies after the provider accepted a message but before the result was recorded, lease recovery (`app.recover_message_leases`) retries it with the same idempotency key on a provider that honours one (Resend, the signed webhook), so it is delivered once. On any other provider (Zalo Bot, Telegram, Brevo) the row becomes `uncertain`: it may or may not have arrived, and nothing resends it automatically.
- **Episodes.** An alert is an episode in `alert_events`: one open row per dedupe key (for example `sync_stale:store:<id>`), with occurrences, a cool-down between notices, reminders, folding under a root cause (a store's stale sync under its account's `auth_failed`) and a resolution, with a notice for the rules that send one. Facts are count-only (`app.facts_are_count_only`).
- **Counts only.** Logs, CLI output in CI and every function result hold counts, numbers and hints, never an address, chat id, token, URL or amount.

## 2. Destinations, linking and consent

A destination (`notification_channels`) belongs to one member (except a webhook) and names the environment variable of its credential (`secret_name`, for example `NOTIFY_ZALO_BOT_TOKEN`), never the value.

- **Zalo Bot and Telegram, two steps.** The member (in the web app, the staff app or with `fnb notify link`) gets a code `FNB-` plus 8 characters, valid 15 minutes and stored only as a hash. The member sends the code to the bot; the bot answers with the notice `ops-notifications-v1`; the destination turns `active`, and the `notifications` consent is recorded (`method = 'bot_reply'`), only when the member replies "ĐỒNG Ý". "DỪNG" in the chat withdraws it.
- **E-mail.** From the web app, `start_channel_link` with kind `email` activates the member's own login address at once and records the consent with `method = 'web_session'`, after the page showed the notice. From the CLI, an e-mail code confirms the address.
- **Webhook.** Added only from the command line (`fnb notify link --kind webhook --url https://…`); it belongs to no member and needs no consent; it receives alerts and tests, never digests.
- **Stopping.** `stop_my_notifications` (web "Ngừng nhận tất cả", staff app "Dừng nhận thông báo") withdraws the consent, cancels the waiting messages and disables every destination of the member as `consent_withdrawn`. Removing one destination (`remove_destination`) keeps the consent.

## 3. Policies and their legal basis

`channel_policies` holds one row per channel kind and message class (operational, transactional, advertising), global or overridden per tenant: the sending window in the reader's zone, the daily and monthly caps, whether a critical alert may break the window, labels and the opt-out text. CHECK constraints keep every row above the floor: member destinations always need the `notifications` consent; advertising needs prior consent, 07:00–22:00, at most 3 in 24 hours, a label and an opt-out (Decree 91/2020). Digests and alerts to the business's own members are operational, internal messages; the advertising rules do not apply to them (ADR-033, a working reading, not legal advice). Owners with every store override the operational rows of their tenant (Settings → Cảnh báo, "Giờ gửi và giới hạn"); the other classes stay disabled until the customer phases. The legal watch item: Decree 91/2020 may be replaced by a new decree; a change becomes a data migration of the policy rows.

## 4. Alert rules

`alert_rule_catalog` lists every rule with its defaults and a parameter schema; `alert_rules` holds tenant and store overrides, written by owners with every store only (validated by trigger). `effective_alert_rules(tenant, store)` shows each rule as it applies and where it comes from. The rules that run at the notify tick (`app.notify_tick_rules`, third form): resolution and reminders (`app.reconcile_alerts`), the sync alerts of the incremental runner (`app.import_sync_alerts`), channel health, the due digests, the intraday rules `zero_sales_open` (a store open for `min_open_minutes` with a fresh sync and no sale, after `min_history_days` of checked history, not on an excluded day) and `nightly_missing` (no succeeded nightly for `hours`), and `dsr_due_soon` (data-subject requests overdue or due within `days`, counts only). Rules that read opening hours stay quiet for a store without them.

## 5. The digest

One digest per tenant, business date and store scope, built from the Ngày report functions as the member who receives it, so it equals Ngày for the same day and stores (ADR-031). A day counts as settled for a store when its last sync after closing plus `settle_grace_minutes` has passed; the digest is built when every store of its scope has settled or at `deadline_local` (06:30). `fnb digest --check-ngay` compares a built digest with Ngày. Corrections after the nightly reconciliation: one correction at most, never for item-only changes. `fnb digest --revise` rebuilds a digest whose tenant had a successful nightly, reconciliation or backfill run covering its date after it was built (`app.digests_to_revise`, the last three local days), and `app.revise_digest` replaces the model and, the first time and only when the rebuilt text carries a correction, queues one `digest_correction` per destination and sets `revision` to 1 (G-70, migration `20261123110000_digest_revision`).

## 6. Dispatch paths and budgets

- **Supabase.** `app.enable_notify(<function URL>)` stores the URL and schedules the `pg_cron` job `notify` (every 5 minutes) running `app.notify_tick()`, which runs the rules, housekeeping (at most once in 20 hours) and posts a single-use ticket (ADR-028) to the `notify` Edge Function only while work is waiting, never twice in 4 minutes. The function claims the ticket before it opens any connection of its own (401 for an unknown, used or expired ticket), answers 202 and runs the cycle: at most 90 s, 4 digests, 30 sends and 30 s of bot polling; work left over is handed to a continuation ticket, at most 3 in a chain. `app.disable_notify()` removes the job.
- **Actions.** `fnb notify tick` runs the same cycle from the Notify workflow; with `--skip-if-scheduler-healthy` it exits at once while the Supabase dispatcher is healthy (schedule on, a tick in the last 15 minutes, nothing overdue for 10 minutes, no ticket expired unclaimed in the last hour).
- **Health.** `fnb notify check` exits 1 when the dispatchers or the digest stopped; `fnb doctor` and `fnb status` show the schedule, the last tick, the secrets each dispatcher reported, failing destinations and the Zalo Bot month count.

## 7. Failure alerts for scheduled jobs

`fnb notify job-failed` records a failed workflow as a `job_failed` episode. Exit codes: 0 recorded, 2 usage error, 3 the database could not be reached, 4 connected but nothing was recorded. On 2, 3 or 4, or when the install failed, `node scripts/notify-fallback.mjs send` sends one fixed Vietnamese text per target listed in the `NOTIFY_FALLBACK_TARGETS` secret, with no database (`mask` first registers every value with `::add-mask::`); `fnb notify fallback-entry` prints one target entry locally. The listener workflow itself and the probe of a run that fails before any job starts are tracked in section 11.

## 8. Settings → Cảnh báo and Bản tin on the web

Cảnh báo (`#/cai-dat/canh-bao`) shows the dispatcher status, the member's destinations (owners and managers with every store see the tenant's), linking, the test button, edit, remove and stop-all; the rules (owners with every store edit, managers read and mute on their own destination); sending hours and caps; the alert history and the message log with resend. Bản tin (`#/cai-dat/ban-tin`) lists the last 31 digests as they were sent, with delivery per destination and a link to Ngày. The web app talks to the database only through the functions of [api.md](api.md) 3.5 and table reads under RLS; see [web-app.md](web-app.md), "Phase 12 decisions".

## 9. Runbook

- **Link a bot for a member.** Web: Cài đặt → Cảnh báo → "Kết nối Zalo Bot", then send the code to the bot and reply "ĐỒNG Ý". CLI: `fnb notify link --tenant <slug> --member <login e-mail> --kind zalo_bot`.
- **Read the state.** `fnb notify status --tenant <slug>` lists destinations by number and the messages of 14 days by state; message ids are printed locally only, never in CI.
- **An `uncertain` message.** Ask the recipient whether it arrived. If not, resend it: web "Gửi lại" in the message log, or `fnb notify resend --tenant <slug> --message <id>`. The original row stays.
- **Rotate a token.** Put the new value in `.env`, the GitHub secret and the Edge Function secret under the same name; no row changes. A destination that failed with `token_invalid` recovers at its next successful send.
- **Re-link a chat.** Remove the destination (web "Gỡ" or `fnb notify unlink`) and link again; the member answers "ĐỒNG Ý" again.
- **Enable or pause the Supabase schedule.** `select app.enable_notify('https://<project>.supabase.co/functions/v1/notify');` and `select app.disable_notify();` as `postgres`.
- **What an alert means.** `auth_failed`: the POS refused the login; update the password in `.env` and the secrets, then sync. `sync_stale`: a store has not synced for the threshold while open. `sync_failed`: a sync run failed repeatedly. `nightly_missing`: no nightly run succeeded for 30 hours; check the Actions tab. `zero_sales_open`: a store is open with fresh syncs and no invoice; check the till. `channel_failed`: a destination keeps failing; check its token or re-link it. `digest_failed`: the digest could not be built after 5 attempts. `dsr_due_soon`: a data-subject request is overdue or due soon; open Khách hàng → Yêu cầu dữ liệu.

## 10. CLI reference

| Command | Purpose | Exit codes |
| --- | --- | --- |
| `fnb digest [--tenant <slug>] [--due \| --date YYYY-MM-DD] [--revise] [--dry-run] [--check-ngay] [--show-text] [--resend] [--at <ISO instant>]` | Build due digests, one date, a resend copy (`:resend:<n>`), the comparison with Ngày | 0 ok, 1 a digest failed, 2 usage |
| `fnb notify tick [--tenant <slug>] [--skip-if-scheduler-healthy]` | Run one dispatch cycle | 0 ok, 1 failures |
| `fnb notify status [--tenant <slug>] [--days 14] [--at <ISO instant>]` | Destinations and messages by state | 0 |
| `fnb notify link …` / `fnb notify unlink …` | Link or remove a destination (refused in CI) | 0, 2 usage |
| `fnb notify test --tenant <slug> [--destination <n>]` | Send a test now | 0 sent, 1 not sent |
| `fnb notify job-failed …` | Record a failed workflow | 0, 2, 3, 4 (section 7) |
| `fnb notify fallback-entry --tenant <slug> --destination <n>` | Print one `NOTIFY_FALLBACK_TARGETS` entry (refused in CI) | 0, 2 |
| `fnb notify check [--tenant <slug>]` | Health of the pipeline | 0 green, 1 red |
| `fnb notify setup [--app-url https://<owner>.github.io/<repository>/]` | Store the app link used in digests | 0, 2 |
| `fnb notify resend --tenant <slug> --message <id>` | Resend an uncertain or failed digest or alert | 0, 2 |

## 11. What is not built yet

Tracked in [test-gaps.md](test-gaps.md) (G-70 to G-76): the workflow files (the failure listener, deploying `notify`, the Deno checks and the notification integration suites in CI); the Deno tests and the eszip measurement of the `notify` function on a machine with Deno; the go-live step that turns the schedule on in the cloud; the dated legal and Zalo Bot notes of the deep dives; the answer of the startup-failure probe (#71).
