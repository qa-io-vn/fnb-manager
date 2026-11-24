# Architecture decisions

Short records of the decisions that shape this system, so that anyone reusing it for another shop knows what was chosen and why. Newest at the bottom.

## ADR-001 — Static frontend on GitHub Pages, data and auth in Supabase, scheduled compute in GitHub Actions

Date 2026-11-07 · Status accepted

The owner wants no servers to run and no manual deployment. GitHub Pages hosts the web app and redeploys on every push. Supabase (free tier) provides Postgres, email/password auth and row-level security so revenue data is never public, plus Edge Functions for the few always-on endpoints that Zalo integrations need. GitHub Actions runs the POS sync on a cron and applies database migrations. The only manual step is creating the Supabase project once and pasting three secrets into GitHub.

Consequence: GitHub Pages on a free account requires a public repository, so the repository holds code only — no data exports, snapshots, identifiers or credentials. Shop-specific notes live in the gitignored `docs/private/`.

## ADR-002 — TypeScript everywhere

Date 2026-11-07 · Status accepted

Frontend, sync jobs and tooling share one language and one toolchain (pnpm workspaces, Biome, Vitest). Database logic is SQL in Supabase migrations with pgTAP tests.

## ADR-003 — No paid AI API; the strategy runs under the owner's own assistant subscription

Date 2026-11-07 · Status accepted

A personal assistant subscription cannot be used by a server. The platform therefore prepares an AI data pack (aggregates only) and stores the resulting plans; the reasoning happens in the owner's own assistant, either through a `/strategy` command run locally or on a schedule, or by pasting an exported data pack into a chat. The strategy prompt ships inside the data pack, and any assistant-specific wrapper lives in the owner's personal configuration, outside this repository. If an API key is ever added, the data pack and prompt stay the same.

## ADR-004 — Canonical POS-agnostic schema behind a connector interface

Date 2026-11-07 · Status accepted

Every POS-specific detail stays inside a connector package (`packages/connector-ipos` first). Connectors normalise into one canonical model: tenants, POS accounts, stores, master data, invoices, invoice lines, payments, shifts. POS ids are kept as `external_id` columns and the original payload in `raw jsonb`, so nothing is lost and anything can be re-derived. Adding another POS means implementing the connector interface, not changing the schema or the reports.

## ADR-005 — Multi-tenant from day one

Date 2026-11-07 · Status accepted

Even with one owner and two stores today, every table carries `tenant_id`, access is granted through `tenant_members` (owner, manager, staff, viewer, optional store scope) and enforced by RLS. A second owner, a second POS account or a third store is a row, not a code change.

## ADR-006 — Credentials never in the database or the repository

Date 2026-11-07 · Status accepted · amended 2026-11-08 for the Edge Function runner

POS credentials (`POS_ACCOUNTS_JSON`, `IPOS_APP_KEY`) live in GitHub Actions secrets, in the Edge Function secrets of `sync-incremental`, and in the owner's local `.env`. The database stores only account metadata, external ids and a service-role-only token cache. The scheduled calls to the Edge Function carry single-use tickets the database issues (ADR-028), so no API key or other credential is kept in the database or in Vault for them. Zalo app secrets will live in Supabase Edge Function secrets.

## ADR-007 — Business day and money conventions

Date 2026-11-07 · Status accepted

Timestamps are stored as `timestamptz`; `business_date` is computed by the sync in the store's timezone (Asia/Ho_Chi_Minh for the first tenant, fixed offset, no DST). Amounts are `numeric(14,2)` in the tenant's currency so the schema also fits currencies with decimals.

## ADR-008 — Local development on a Dockerised Supabase stack

Date 2026-11-07 · Status accepted

`pnpm db:start` runs the full Supabase stack locally (Postgres 17, Auth, PostgREST, Studio). Migrations, RLS and pgTAP tests are developed and verified locally and in CI before any cloud project exists. The seed creates a synthetic demo tenant and a dev login so the web app works offline from the first day.

## ADR-009 — Connector tests use synthetic fixtures; live checks are opt-in

Date 2026-11-07 · Status accepted

Unit tests inject a fake `fetch` with generated fixtures. A live smoke test runs only with `LIVE=1` and local credentials and prints counts and timings only. Recorded real responses are never committed because the repository is public.

## ADR-010 — Analytics aggregates are job-refreshed tables with RLS, not materialised views

Date 2026-11-07 · Status accepted

Postgres does not apply row-level security to materialised views, and a `security_invoker` view over one needs the caller to hold SELECT on it, so tenant filtering would rest on view predicates alone. Aggregates (daily sales, hour × weekday, item sales, payments, shifts, basket pairs, …) are therefore ordinary tables carrying `tenant_id` and `store_id`, refreshed by the nightly and incremental jobs, protected by the same RLS policies as the fact tables and covered by the same two-tenant test matrix. Recent days are served by plain views over the fact tables so "today" is fresh after every incremental run.

## ADR-011 — Early manager value: first live screen before the full sync engine

Date 2026-11-07 · Status accepted

Three independently proposed roadmaps were judged; the ordering that puts a real report on the owner's phone earliest scored best. Sequence: cloud project live with one recent month loaded through the generic onboarding path → web foundation with a "Hôm nay" screen reading real data (badge "chưa đối soát" until reconciliation exists) → sync engine with reconciliation, void detection, schedules and the full backfill → analytics layer. The owner can swap the web and sync phases if unattended data matters more; both depend only on the cloud project.

## ADR-012 — Connector contract with capability flags, proven by a mock connector and a conformance suite

Date 2026-11-07 · Status accepted

`PosConnector` declares capabilities (lines, modifiers, payments, shifts, adjustments, control totals, customers, guest count, costs). A seeded mock connector shaped like the real data passes a conformance suite before the iPOS adapter is written against the interface, so the "generic" contract does not inherit iPOS's shape. A CSV import connector is added later as the second real implementation for shops whose POS has no API. Reports hide sections a POS cannot feed instead of failing.

## ADR-013 — Least-privilege identities for the strategy path

Date 2026-11-07 · Status accepted

`fnb publish-plan` and the optional cloud routine sign in as a dedicated tenant member with the `publisher` role (read aggregates, insert plans, nothing else) using credentials from a local gitignored `.env` or the routine's environment. The manager's login and the service-role key never leave their places (the browser session and GitHub Actions respectively).

Amended 2026-11-20 with phase 11b (#169, #170, #177). The publisher reads only tenants, stores, holidays and the calendar (and the global notification catalogues); it reads no aggregate, sale, pack or plan, holds no `INSERT` on `strategy_reports` and publishes only through `publish_strategy_plan`. Packs are built by a data member: in the browser by the signed-in owner or manager, or by `fnb datapack` acting as one through its own database connection. `fnb publish-plan` signs in with the publishable key and the publisher's e-mail and password only, and refuses a login that can read `tenant_members`.

## ADR-014 — Realistic acceptance gates

Date 2026-11-07 · Status accepted

Backfill is accepted at ≥ 99 % of store-days reconciled with every exception explained privately; one month syncs in under 5 minutes within a stated API-call budget; the E2E suite must be green with zero flakes over five consecutive runs on a staging Supabase project seeded with mock data; v1.0 requires a 7-day parallel verification against Fabi reports A01, B07 and C02 per store; backups are encrypted and restore-tested. The nightly digest runs as the last step of the final incremental sync of the day so it never misses the evening peak.

## ADR-015 — Secret and identifier scanning uses generic rules in CI

Date 2026-11-07 · Status accepted

CI cannot see the gitignored private identifier list, so the scanner uses generic patterns (32-hex app keys, Supabase and JWT key shapes, e-mail addresses, UUIDs) with an allow-list for documented examples and tests; the private list is checked locally before the first commit of each phase.

## ADR-016 — Loyalty: our ledger is the system of record; iPOS CRM is an optional rail

Date 2026-11-07 · Status accepted (rail choice pending the iPOS CRM quote)

Research (fact-checked against iPOS's and Zalo's own documentation) shows that iPOS exposes no public write API; the only documented ways an identity or a coupon reaches a Fabi invoice are the iPOS CRM module (cashier attaches a member by phone or check-in code, e-voucher codes typed at the POS, and a restaurant-hosted voucher-validation callback). Points, stamps, coupons and customers therefore live in our Supabase ledger, computed from the synced invoice stream, which remains the proof of purchase. iPOS CRM is used only for what it uniquely does at the till — if its quote is acceptable. Without it, the same ledger works with staff-verified check-ins, receipt-code claims and Fabi payment-discount entries. The rail is configuration per store; the ledger and both Mini Apps do not change.

## ADR-017 — One Zalo App and one verified Official Account per brand; two Mini Apps per brand

Date 2026-11-07 · Status accepted

Zalo's single-brand-per-app rule and OA-based Mini App verification lead to: one Zalo App (developers.zalo.me) per brand holding that brand's Staff Mini App (Internal classification, distributed by QR and deep link) and Customer Mini App (public), one verified OA per brand on the Tăng trưởng package (required for any Open API use), and one ZBS account for the legal entity. All Zalo identifiers and secrets are per-brand configuration rows and Vault/CI secrets, never code.

## ADR-018 — Messaging economics: in-app first, free OA window second, paid templates last

Date 2026-11-07 · Status accepted

Confirmations and balances are shown in the Mini App; consultation messages are sent free inside the 48-hour interaction window; paid ZBS template messages (raised in 2026 to roughly 300–400 ₫ each) are reserved for issued vouchers, expiry reminders and win-back campaigns, within Zalo's per-user caps; staff alerts go through the free Zalo Bot API and the OA group included in the package. An outbox with per-channel quotas and fallback order enforces this.

## ADR-019 — Cross-border hosting of personal data: dossier or exemption before launch

Date 2026-11-07 · Status open (reframed after the legal deep dive)

An early research note said Zalo's Mini App agreement requires Vietnam-resident storage of Zalo-derived data; no primary source has confirmed that clause. The verified duty is in the personal-data law in force since 1 January 2026: hosting customer data on Supabase (Singapore) and GitHub is a cross-border transfer that normally needs a transfer impact dossier filed within 60 days of the first transfer — unless the business is a household business or micro-enterprise (exempt) or a small enterprise (may defer to 2030), and provided no sensitive data is processed and fewer than 100,000 data subjects are reached. The owner confirms each brand's legal form in week 1; the choice (file or record the exemption) is gate G3 and must be made before Track C goes public. Zalo-derived data stays minimal (Zalo id, display name, phone), analytics events stay aggregate, and the database remains portable to a Vietnam-hosted Postgres if a requirement ever appears.

## ADR-020 — Two runners, one sync engine: incremental on Supabase, heavy jobs on GitHub Actions

Date 2026-11-07 · Status accepted

GitHub's Actions terms exclude use "as part of a serverless application" and activity unrelated to building and publishing the project, scheduled runs are routinely 20–40 minutes late and are disabled after 60 days without repository activity. A twice-hourly POS sync on Actions is therefore both a terms grey area and an unreliable freshness promise. The sync engine is built on supabase-js and runtime-agnostic connectors, with two runners: an Edge Function invoked by `pg_cron` every 30 minutes per store during opening hours (last 3 business days, change detection first, a CPU/time guard that hands oversized windows to the nightly job), and a Node runner on GitHub Actions for the nightly job, backfills, backups and the owner's CLI. Actions schedules use off-peak minutes and the cron timezone field, a dead-man's-switch alert fires when the last successful run is older than 90 minutes during opening hours, and a keep-alive guards the 60-day rule. A small server is the documented fallback for every scheduled job.

## ADR-021 — Legal compliance is built into the schema, the apps and the campaign engine

Date 2026-11-07 · Status accepted

Vietnam's personal-data law (in force since 1 January 2026, with its 2025 and 2026 decrees), the promotions decree (as amended in 2024), the 2026 e-invoice decree and the anti-spam decree set duties the platform must satisfy by construction: a per-purpose consent ledger with evidence (loyalty, marketing, staff operations) and a working opt-out; data-subject requests tracked against the 2-working-day first response and 20/30-day completion deadlines, with cascading deletion; a 72-hour breach notification runbook; the cross-border dossier or exemption decision (ADR-019); a programme record (name, period, reward budget) that drives the Sở Công Thương notification check (required for customer loyalty programmes unless the total gift value stays under 100 M₫ — the 2024 amendment removed notification for ordinary discounts and vouchers, not for loyalty programmes); the 50 % discount cap and the 120 discount-days per item per year counter on coupons; no cash-like rewards; every redemption modelled as a Fabi discount or 0-price promotional line so the cash-register e-invoice shows it; channel policies with allowed hours, daily caps, advertising labels, opt-out text and consent purpose; an outbound-message log kept at least one year. The owner's entity-specific choices (legal form, filings) are confirmed by a legal read before Track C goes public.

## ADR-022 — Zalo policy rules are acceptance criteria

Date 2026-11-07 · Status accepted

Zalo's Mini App review policy and OA rules are treated as build requirements rather than launch risks: no outbound links from a Mini App except embedded Privacy and Terms (so no links to the web dashboard; Terms and Privacy are in-app popups titled for the Mini App and naming the legal entity); no prices shown without the Checkout SDK (menu highlights say "Xem tại quầy" until ordering is scoped); no permission prompt at launch and a usable "từ chối" path; personal-data permissions requested with reason text and screenshots at the first Testing submission (test users bypass approvals and prove nothing); names with an owner-identifying prefix or suffix and no generic nouns, "App", "Mini App" or "Zalo"; logos without QR codes or phone numbers on a solid background; performance gates (LCP < 2.5 s, page load < 1.5 s, bundle and per-file budgets) enforced in CI; ≤ 4 bottom tabs, one primary action per screen, 44 × 44 pt targets; `app-config.json` generated per tenant so one codebase ships one Mini App per brand; consultation messages through the API only within 7 days of the user's last interaction; broadcasts manual-only within their caps and hours; template messages only to users who transacted; Mini Apps kept above 10 visits per month and OAs active toward followers within 180 days, monitored by alert rules.

## ADR-023 — Supabase and GitHub operating conventions

Date 2026-11-07 · Status accepted

New Supabase key scheme from the start (`SUPABASE_SECRET_KEY` for jobs and functions, `SUPABASE_PUBLISHABLE_KEY` as the public web variable; legacy JWT keys disabled once everything works); `SUPABASE_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_ID` for migrations; the Supabase CLI pinned in CI; `db diff --strict-coverage` and generated-types drift checks in CI; custom SMTP (or the send-email hook) configured before inviting users because the built-in mailer allows two emails per hour; weekly encrypted `supabase db dump` backups through the session pooler from the first day real data exists, stored outside the public repository, with a guard against `db reset --linked` and a restore drill; egress budgeted (backups, exports); Data API pagination with stable ordering under the 1,000-row default; all audit and sync logs in our own tables (platform logs are kept one day on the free tier); email sent through an HTTPS provider because Edge Functions block SMTP ports; `fnb doctor` reports database size, disk, egress, pause risk and the Pro upgrade trigger (~400 MB, a second owner, or mandatory daily backups). GitHub: credential fields of `POS_ACCOUNTS_JSON` are masked at job start (or stored one secret per account), job summaries carry no identifiers, `.nojekyll` is present, the SPA uses hash routing with the PKCE auth flow unless the 404.html approach is chosen, a `version.json` prompt handles the fixed 10-minute Pages cache, and the absence of CSP/HSTS on Pages is accepted with Cloudflare Pages as the drop-in fallback.

## ADR-024 — iPOS CRM is already present; the loyalty ledger stays independent of it

Date 2026-11-07 · Status accepted (rail choice at gate G2)

The hands-on review of the Fabi CMS found iPOS CRM initialised for both brands at no charge, with a published price list (one-time voucher codes 100 ₫ each, Zalo messages through CRM 55 ₫ each, optional setup 4,000,000 ₫, a restaurant-hosted voucher-validation callback that iPOS would build for 1,000,000 ₫), and that the tea brand's CRM tiers belong to the franchise brand's CRM company and may be shared with other franchisees. Points, stamps, coupons and customers therefore live only in our ledger (ADR-016); CRM is used, if at all, for attaching a member at the till and consuming voucher codes, never for tiers or points that other stores could change. Receipt claims are keyed on store + business date + bill number because bill numbers reset daily at one shop and yearly at the other. The owner confirms the shared-tier question and current rates before gate G2.

## ADR-025 — Connectors use documented read endpoints only; vendor security observations are handled privately

Date 2026-11-07 · Status accepted

During the read-only CMS review, some CMS forwarding endpoints returned credentials of vendor service accounts and another brand's configuration in plain text. The connector calls only the documented posapi read endpoints used by the sync, never the CMS forwarding or CRM endpoints; nothing returned by such endpoints is stored, logged or reused; the observations are recorded only in the private notes, and the owner decides whether to report them to iPOS (responsible disclosure recommended).

## ADR-026 — Standard KPI methods in the metric registry

Date 2026-11-07 · Status accepted

Reports, the data pack, digests and KPI follow-up share one registry of about forty metrics with id, bilingual label, unit, formula, grain, direction, source and report mapping. Methods adopted: Kasavana–Smith menu engineering per item-type role and store over a rolling 28-day window with configurable thresholds and a "provisional — no cost" state until item costs exist; average ticket decomposed into items per ticket × average item price; same-weekday 8-week median baselines excluding holidays and Tết; seasonal-naïve and weekday-profile benchmark forecasts with tracked error; promotion lift as difference-in-differences against a chosen comparator, always net of discount cost; cash variance with absolute, relative and z-score thresholds; void, edit and removed-line rates ranked by z-score within a store; RevPASH and sales per opening hour where seats are known; loyalty economics with points valued at issue, liability net of expected breakage (20 % default until six months of expiry data) and deferred revenue released with redemptions; customer metrics (repeat rate, visit frequency, cohort retention, RFM, lifetime value) computed on identified customers with the capture rate reported alongside. Vietnam benchmarks are stored as dated "context" entries separate from tenant metrics.

## ADR-027 — Sale payloads live in one compressed document per store-day

Date 2026-11-08 · Status accepted

The full backfill of both shops put the database at about 850 MB against the 300 MB ceiling of phase 7, two thirds of it `raw jsonb` on invoices, lines and tenders: a line payload is about 3 kB and a row under 2 kB is never compressed, so the storage rule for lines would have saved little. Dropping payloads would break ADR-004 ("nothing is lost"). Instead the sync writes null to those three `raw` columns and keeps every sale's payloads in `sale_payloads`, one lz4-compressed JSON-lines document per store and business date, with line and tender payloads stripped of the fields equal to their invoice's. Within a day the field names and many values repeat, so the documents compress about ten times and the same history fits under the ceiling. A future column is back-filled by reading the document of the sale's store-day.

## ADR-028 — Scheduled calls to the incremental Edge Function carry a single-use ticket, not an API key

Date 2026-11-08 · Status accepted

`pg_cron` calls `sync-incremental` through `pg_net`, so whatever authorises the call is stored in the database and, until the request leaves, sits in `net.http_request_queue`. Supabase supports three ways to authorise it. Its scheduling guide ([supabase.com/docs/guides/functions/schedule-functions](https://supabase.com/docs/guides/functions/schedule-functions)) sends the project's secret key on the `apikey` header and has the function accept only that key; a secret key bypasses row-level security on the whole Data API, it would live in Vault, and the same guide warns that any role able to log in can read it from the queue while the request waits. The publishable key is public by design, so it authorises nothing: anyone with the web bundle could make the function call the POS. The third way is `verify_jwt = false` with the function checking the caller itself, and this is the one used, with the least privilege it allows: the scheduler issues one random ticket per due store in `app.incremental_sync_tickets`, with a 10-minute life, and the request carries only that id; the function claims it, deleting it, through its own database connection before it does anything, and answers 401 to an unknown, used or expired ticket. No credential for the schedule exists anywhere. A ticket read from the queue or a log can at most start one sync of one store, once, within minutes. A caller without a valid ticket costs one invocation and one indexed delete, made over the worker's single shared claim connection, so anonymous traffic never opens database connections of its own and cannot exhaust the Free plan's small connection limit; while 32 claims wait on that connection the function answers 429 without touching the database. Only a claimed ticket opens the run's own connections. Signing tickets with a key held in Vault and in a function secret would turn bad tickets away before any query, but it would put a credential back into the schedule, which this decision avoids. Manual runs use `app.issue_incremental_sync_ticket`.

The same function connects to Postgres with postgres.js over the injected `SUPABASE_DB_URL`, the direct connection, always over TLS for a host that is not local (a URL that would allow plaintext is refused), and reuses `PostgresSyncRepository` rather than an RPC-backed repository: the session advisory lock that serialises a store's runs is then the same for the Edge Function, the nightly job and the CLI, and the Edge Function gives way after 15 seconds instead of queueing behind a backfill.

## ADR-029 — Report numbers come from SQL; the demo runs a parity-tested TypeScript port

Date 2026-11-08 · Status accepted

The periodic reports (phase 9) need the same numbers in three places: the live web app, the demo that runs in the browser with no backend, and later the data pack, KPI follow-up and digests. Every sum, ratio, median and forecast of a report is computed in SQL, in `security invoker` functions that the browser calls through `supabase.rpc()` as the signed-in member, so row-level security and the single production source stay as `docs/metrics.md` and `docs/schema.md` describe them; TypeScript only adds what sits on top of those rows (changes, the exact decomposition, like-for-like selection, rankings, statuses and sentence drivers), in pure card models of `@fnb/reports` that every consumer shares. The demo cannot run SQL: PGlite in the browser would cost 4–5 MB of WebAssembly. Instead `@fnb/demo-analytics` ports exactly those functions to TypeScript, over days generated from the mock connector and aggregated as the nightly refresh does, behind the same `AnalyticsSource` interface, and a parity suite applies the real migrations in PGlite (and, in CI, on the real stack), loads the same days and compares every row and value, so a change to a function that is not mirrored in the port fails the build. The cost is a second implementation of each function, paid once per function and kept honest by the parity suite rather than by review.

## ADR-030 — One Postgres outbox; every send decision in SQL at claim time; policies as rows with legal floors; alerts as episodes

Date 2026-11-20 · Status accepted

Digests and alerts reach owners and managers through several channels (Zalo Bot, e-mail, later Telegram and a signed webhook) with rules that differ by channel and message class: sending hours, daily and monthly caps, consent, labels for advertising. Decision: every message is one row of `outbound_messages`, inserted only through `app.enqueue_message`, and the decision to send, hold or cancel is taken in SQL when a dispatcher claims the row (`app.message_decision`), not when it is queued, so a policy or consent change applies to messages already waiting. Policies are rows of `channel_policies` per channel kind and message class, global or per tenant, and the legal floors (consent for every member destination, the advertising window, cap, label and opt-out of Decree 91/2020) are CHECK constraints that bind every writer, the service role and the browser included, so no override can store a policy below the floor. A provider that honours an idempotency key (Resend, the signed webhook) is retried with the same key after a crash between send and record, so it delivers exactly once; any other provider's row becomes `uncertain`, never resent automatically, and a person resends it (`resend_message`, `fnb notify resend`) as a new row that points at the original, numbered `:resend:<n>` under an advisory lock. Alerts are episodes (`alert_events`): one open row per dedupe key with occurrences, a cool-down, reminders, folding under a root cause and a resolution notice, so a repeated reading never repeats the message. Not chosen: a queue service outside Postgres (another system to run on the free plan, and the decision would need the policy rows anyway); deciding at enqueue time (a consent withdrawn after queueing would not stop the message); automatic resends of `uncertain` rows (a duplicate digest is worse than a late one).

## ADR-031 — The digest is the Ngày report as its recipient sees it, sent once its stores have settled the day or at 06:30, corrected at most once

Date 2026-11-20 · Status accepted

The owner reads the morning digest instead of opening the app, so its figures must be the ones Ngày shows. Decision: the digest is built from the same report functions as Ngày (ADR-029), called as the member who receives it so row-level security and the member's store scope apply, one digest per tenant, business date and scope (members with the same stores share it). It is built when every store of its scope has settled the day (its last sync after closing plus the grace minutes) or at the tenant's `deadline_local` (06:30 by default), whichever comes first, instead of as the last step of the final incremental window, which ADR-014 and the roadmap's phase 12 text described before (amended by this record). After the nightly reconciliation the digest of the last two business dates is rebuilt (`fnb digest --revise`; its SQL half, `app.digests_to_revise` and `app.revise_digest`, is still to be built, see docs/test-gaps.md): an unchanged fingerprint changes nothing, a digest whose messages are still waiting is replaced silently, and a shown figure that changed or a new attention line sends one `digest_correction` per destination, never a second one. Not chosen: sending at a fixed hour regardless of the data (a digest built on an unsynced day would need a correction most mornings); sending a correction for every change (a stream of updates trains the owner to ignore them).

## ADR-032 — Two dispatchers and a database-free failure path

Date 2026-11-20 · Status accepted

GitHub's scheduled workflows often start late or not at all, and the free Supabase project pauses after a week without activity. Decision: two dispatchers run the same cycle (`runNotifyCycle` of `@fnb/notify`). The `notify` Edge Function is woken by the `pg_cron` job `notify` (`app.enable_notify`, every 5 minutes, off until the owner enables it) through single-use tickets as ADR-028 describes for the incremental sync, works within the Free-plan budget (90 s, 4 digests, 30 sends, at most 3 chained continuations) and claims rows with a lease so two dispatchers never send the same message. The CLI on GitHub Actions (`fnb notify tick`) runs as a fallback and skips itself while the Supabase dispatcher is healthy. A scheduled workflow that fails is reported by a `workflow_run` listener through `fnb notify job-failed`; when the database cannot be reached or nothing was recorded, `scripts/notify-fallback.mjs` sends one fixed text per target from the `NOTIFY_FALLBACK_TARGETS` secret with no database at all, so a paused project still reaches the owner. Not chosen: Actions only (late schedules delay alerts by hours); the Edge Function only (a paused project or a broken deploy would go unnoticed); a third-party uptime service (another account with the owner's data).

## ADR-033 — Credentials by reference, consent at the member's own act, owner-only rule overrides, internal messages are not advertising

Date 2026-11-20 · Status accepted

A destination row names the environment variable that holds its credential (`secret_name`, `NOTIFY_` with the kind's prefix), never its value; dispatchers report which names they hold, and a message whose secret no runtime has reported for 48 hours is cancelled as `no_dispatcher_secret` instead of waiting. The member's `notifications` consent is recorded only at their own act: the "ĐỒNG Ý" reply to the bot's notice, the e-mail code, or the web link of their own login address (`start_channel_link`, method `web_session`); an owner or manager never records it for someone else, and `stop_my_notifications` or "DỪNG" withdraws it. The browser never sees an address, chat id, secret name or destination configuration (column grants and function results), and webhooks are added from the command line only. Alert rule and policy overrides are written by owners with every store only, because the rules include signals that watch the managers; managers read them and mute rules on their own destinations. A member who leaves loses their destinations with the membership (cascade), and their messages keep only count-only parameters. Digests and operational alerts to the business's own owners and managers are internal operational messages, not advertising: they need the member's consent and respect the channel's hours, but the advertising label, cap and opt-out text of Decree 91/2020 apply only to the advertising class, which stays disabled until the customer phases. This is the project's reading for building, not legal advice; the owner's legal review stays an owner item (#15).

## ADR-034 — One token source in the DTCG format; accessible primitives in the shadcn pattern; WCAG 2.2 AA

Date 2026-11-14 · Status accepted

The web app defined its colours in five places (the light, dark and print blocks of `styles.css`, and the screen-fallback and print palettes of the chart theme), and the copies had already drifted: the chart fallback's second series colour differed from the CSS one. Control styles were copied as class strings (the primary button four times, the text input three times), and the store picker, the language switch and the folded controls each implemented their own open, close, focus and keyboard behaviour. The Zalo Mini Apps of track B will need the same brand in zmp-ui. The owner asked for a standard that keeps this easy to maintain. Decision: every colour, font stack and print size is a token in the Design Tokens Format Module 2025.10 of the W3C Design Tokens Community Group, kept in `packages/design-tokens`; Style Dictionary 5 generates from it the CSS variables with the Tailwind 4 `@theme inline` mapping and a typed palette for ECharts, and later the zmp-ui theme, and the generated files are committed and checked for staleness in CI like the Edge Function's import map. Controls live in `apps/web/src/components/ui` in the shadcn/ui pattern: the code is ours, built on Radix primitives where an interaction needs more than the native WAI-ARIA pattern gives, with variants typed by `class-variance-authority` (amended at DS2 on 2026-11-14: the store picker's popover is Radix; the language switch and the folded controls already follow the toggle-button and disclosure patterns natively and stay so); single-choice pickers stay native `<select>` because the system picker is the most usable on phones. The project standard rises from WCAG 2.1 AA to 2.2 AA, checked by axe with the `wcag22aa` tag and by end-to-end checks for focus that the sticky top bar must not hide and for password managers on the sign-in forms. A development-only catalogue page shows every control and is checked by axe, instead of a separate Storybook toolchain. Not chosen: Material UI and Ant Design, whose runtime weight works against the 400 kB start-up budget on phones and whose look takes long to bend to the brand; Radix Themes, whose prebuilt look gives less control. Consequences: a colour changes in one file for the web, the charts, print and later the Mini Apps; the component code is ours to maintain, with no library upgrade to wait for; the DTCG format is a community-group report rather than a W3C Recommendation, so Style Dictionary sits between it and the code and absorbs a later revision. The design system is described in `docs/design-system.md` and introduced in three steps, DS1 to DS3, each keeping every existing test green.

## ADR-035 — Thematic reports run on date ranges over the phase 9 card model, and every report function has a parity-tested port

Date 2026-11-14 · Status accepted · amended 2026-11-16

Phase 10 adds eight thematic reports (Doanh thu, Giờ & ngày, Thực đơn, Thanh toán, Khuyến mãi, Ca & két tiền, So sánh, Chất lượng dữ liệu) that the owner reads over a chosen range rather than a calendar period. Decision: a theme is a second kind of report definition in `@fnb/reports` (`ThemeDefinition`, `ThemeContext` with a `ReportRange`, `runTheme`) whose cards are the same language-neutral `CardModel` that phase 9's adapter and `ReportCard` render. Ranges come from presets (7, 28, 91 and 364 days, this month, last month, this year) or two dates, compare with the range of equal length just before and with the same weekdays 52 weeks earlier (calendar presets follow `period_bounds`), and stop at 400 days, the limit of `store_coverage`, which every theme calls first (92 for Ca & két tiền). ADR-029 holds without exception: every number of a theme is SQL, and each new report function has a TypeScript port in `@fnb/demo-analytics` held to it by the parity suite (`range_totals`, `opening_productivity`, `hour_profile`, `hour_weekday_heatmap` and `report_settings_of` first); TypeScript adds only what ADR-029 lists. Peak, quiet and busy hours are levels that `hour_profile` computes in SQL from the tenant's thresholds, so the fixed-window registry ids `peak_share_20_21` and `dead_hour_share_17_18` keep their definition for Ngày and the digest. The phase 9 contract that phase 12 consumes does not change: the new functions live in a second registry (`themeFunctions`), the browser source gains a `callTheme` method beside `call`, and `ARGUMENT_SQL_TYPES` covers both registries. Not chosen: adding range kinds to `ReportKind` (every switch over the four periods would change, and phase 12 consumes those types); a separate card component (two renderers to keep accessible); deriving hour levels in TypeScript from heatmap rows (thresholds and means per day are SQL work under ADR-029).

Amended 2026-11-16 with the 10a documents (#100). Range views read the peak and quiet-hour shares `peak_share_top_hours` and `dead_hour_share`, whose hours `hour_profile` picks from the tenant's thresholds. The fixed-window ids `peak_share_20_21` and `dead_hour_share_17_18` keep their definition (Ngày's hourly card reads `peak_share_20_21`), and the registry marks them `supersededBy` the new ids, so the data pack and KPI follow-up of phase 11 will offer one peak share and one quiet-hour share; retiring them waits until Ngày, and the digest if it adopts them, move to configurable hours together. The hour × weekday heatmap is a table (phase 9's heat variant with five sequential shades, values in every cell, CSV, print and screen readers), and the menu matrix is a table of items with their class beside stacked bars of the class shares, not a scatter chart. Ranges compare with the range of equal length just before and with the same weekdays 52 weeks earlier; calendar presets use the period rules of phase 9. Not chosen: redefining the fixed-window ids (their names carry the hours); retiring them in phase 10 (it would change Ngày and the digest that phase 12 builds on); an ECharts heatmap with a visual map or a scatter matrix (no table, CSV or print for free, and a larger chart chunk); a 365-day preset (its last-year range would overlap it by a day). Applied in [web-app.md](web-app.md#phase-10-decisions), [metrics.md](metrics.md#thematic-report-conventions), the theme documents [doanh-thu.md](reports/doanh-thu.md), [gio-ngay.md](reports/gio-ngay.md), [thuc-don.md](reports/thuc-don.md) and [thanh-toan.md](reports/thanh-toan.md), and [packages/reports/README.md](../packages/reports/README.md).

Amended 2026-11-16 with So sánh cửa hàng (#193). The since-opening card aligns stores at week K, taken from the youngest store that has a complete week, because counting a store younger than a week would empty the card; such a store shows "—" and is named in a note. It ignores the chosen range and compares at the latest week with no Tết day at either store, saying so when it steps back. When only some stores have figures for the range before, the all-stores change is computed like for like over those stores and labelled with k/N. A message key may stand in a figure's own table cell ("chưa thiết lập"); it is shown and exported as words and sorts after every number. The same-day headline is the gap between the highest and lowest store index on the day they were furthest apart, explained by the display series `store_day_gap`; week and month buckets use revenue per day with sales. Store colours use the five chart colours, then repeat them dashed. Tables hold one row per store per period because column labels are message keys.

## ADR-036 — Report thresholds are tenant rows that SQL reads; category overrides apply at query time; a tracked catch-up keeps aggregates honest

Date 2026-11-14 · Status accepted · amended 2026-11-16

The owner will tune the menu window, cash tolerances and peak hours, and re-map items whose POS category is wrong, from Settings. Decision: thresholds live in one `report_settings` row per tenant, written by owners with an unlimited scope; functions that use a threshold take it as an argument that defaults to null and read the tenant's row through `app.store_report_settings()` when it is null, so the reports, the registry and the digest flag the same hours and shifts without any caller passing them. An item's category is moved by an `item_category_overrides` row that names another POS item type of the same account; functions that group by category join it when they run, so a re-mapping shows on the next read, and the facts keep what the POS sent (ADR-004). Numbers the nightly refresh derives from mappings and rates (attach rates, category and payment aggregates, fee estimates) follow once the affected days are refreshed: every write to `item_type_roles`, `item_category_overrides` or `payment_fee_rates` moves a version on the tenant row and marks the whole history pending, the refresh shrinks the pending range only when the version it read is unchanged, and `analytics_catch_up_status` lets Settings refresh the pending days in 92-day chunks. The catch-up is never inferred from `analytics_refreshes`, which the scheduler prunes after 35 days. Every writable row records its last writer in `updated_by`, set by trigger, so attribution cannot be forged. Not chosen: thresholds in the report context (the digest builds its own and would silently use defaults); rewriting the facts' item types (the POS stays the source); query-time joins for every aggregate number (attach rates need invoice-level co-occurrence); an unnoticed partial refresh.

Amended 2026-11-14 with the menu functions (#80): an item type id belongs to its POS account, so an override and a role are always resolved on the account of the sale (the store's account for daily item rows, the invoice's for line-level counts). The menu matrix therefore keeps an item whose type two accounts map to different roles once per role, as phase 8's `menu_matrix` does, and the store order cannot move sales between roles; results with one row per item (`item_summary`, `item_margins`) take the first requested store that sold the item, and every report reads item names with the database collation, so an item renamed inside a range has one name everywhere.

Amended 2026-11-16 with the 10a documents (#100). Labels follow a role or category mapping as soon as they are read; numbers that the refresh derives from mappings follow through the tracked catch-up, and every theme and settings page says "đang cập nhật" until the pending days are done. In the web app every successful settings write drops the tenant's cached analytics, and so does the catch-up runner whenever the pending range moves, because phase 9's stale times would otherwise show the old rows after an in-app navigation back to a page loaded before the change. A cost or a fee rate applies on every business date from its own date: `item_margins` and `menu_engineering` cost each store-day of sales with the `item_costs` row in force on that day, the store's own row before the tenant-wide one, so both Thực đơn cards show the same unit cost over the same days; the Settings pages of 10b date an item's first cost in a scope, and a payment method's first fee rate, at the earliest date the app accepts, so margins and fee estimates cover every range as soon as they are saved. Not chosen: a settings epoch in every query key (invalidation does the same without changing phase 9's key shape); applying the cost in force on the as-of day to the whole window (a long margin would be recomputed at today's cost, and a KPI baseline would move whenever a cost changes); dating every first entry today (the margin card would stay empty on the day of entry). Applied in [web-app.md](web-app.md#phase-10-decisions) (the settings source, `useSettingsMutation` and the catch-up), [metrics.md](metrics.md#thematic-report-conventions), [schema.md](schema.md#settings-and-mappings-phase-10), [thuc-don.md](reports/thuc-don.md) and [thanh-toan.md](reports/thanh-toan.md).

## ADR-037 — Mini App sessions are minted through the Auth admin API (generate_link + verify)

Date 2026-11-18 · Status accepted · amended 2026-11-18

A Mini App runs inside Zalo with no password, no cookie and no web storage, and it must reach the same Data API under the same row-level security as the web app. Zalo gives the Mini App an access token for its own Zalo App; Supabase Auth has no Zalo provider. Decision: the Edge Function `zalo-session` (#205) confirms the access token with Zalo's Graph and the app-secret proof (HMAC-SHA256 of the token keyed with the brand's App secret), finds the member bound to that Zalo identity in `zalo_identities` (bound once with a one-time code that `fnb zalo bind` issues), and mints a genuine Supabase session for that member's existing login through the Auth admin API with the secret key: `POST /auth/v1/admin/generate_link` with `type: magiclink` and the login's e-mail gives a hashed token, and `POST /auth/v1/verify` with that token gives the access and refresh tokens. No e-mail is sent and nothing in the repository signs a token. Every access token Auth issues, the web app's included, carries the claim `memberships` (`[{tenant_id, role, store_ids}]`, `store_ids` null for every store) from the access-token hook `app.custom_access_token_claims`, so a Mini App shows the member's role and stores without a query, while row-level security keeps reading `tenant_members`.

Consequences, from Supabase Auth's own behaviour, which the build relies on and the cloud project confirms in #210: the login's last sign-in time moves at every Mini App sign-in, so it no longer tells when the member last used the web app; generating the link replaces any magic-link or recovery token the login was waiting on, so a password-reset link sent just before a Mini App sign-in stops working and must be requested again; `/verify` is limited per IP address (30 verifications per 5 minutes, `token_verifications` in `supabase/config.toml`), and every Mini App sign-in reaches it from the function's own address, so a burst above that limit is refused until the limit is raised on the cloud project; and a bound login without an e-mail cannot get a session (`session_unavailable`). The Mini App's session and a web session are independent sessions of the same login, each refreshed on its own.

Not chosen: a separate Auth user per Zalo identity without e-mail or password, the issue's first sketch, because a second login per member would split roles, store scopes and attribution between two users; a token signed by hand with the project's JWT secret, which would put that secret in a function and bypass Auth's sessions and refresh; and Auth's anonymous sign-in or an external OIDC provider, since Zalo's access token is not an OIDC token. Applied in [api.md](api.md) (sections 2 and 5), [security.md](security.md) (sections 4.3 and 5.1), [schema.md](schema.md) ("Sign-in functions and the access-token hook") and [architecture.md](architecture.md) (sections 6.6 and 11).

Amended 2026-11-18 with the staff pairing of phase 14a (#213): staff on the roster have no login of their own until they pair, and the minting above needs one. Decision: at a person's first pairing, once the database has accepted the code and the notice (`app.zalo_pair` answers `login_needed`), `zalo-session` creates one Auth user for the roster row through the Auth admin API, `POST /auth/v1/admin/users` with `email_confirm: true` and no password, at the address `staff-<random uuid>@zalo-staff.invalid`; the database takes it only when it belongs to nobody yet (`app.staff_login_is_fresh`) and stores it on the row, which keeps it for every later pairing, in another brand's app or after a reactivation; the function deletes the user again when the pairing did not use it. Sessions are then minted for it as above. `.invalid` is reserved (RFC 2606) and resolves nowhere, so the address names nobody, receives no mail and cannot be taken over, and with no password the login's only way in is a Mini App session for its bound Zalo identity. Consequences: these logins never sign in to the web app; the web app knows the person by the roster's display name, never by this address; and a failed clean-up leaves a login with no password, membership or identity, which the function logs without naming. This is one login per person, not the rejected login per Zalo identity: the person's identities in each brand's app all point to it, so roles, store scope and attribution stay on one user. Applied in [schema.md](schema.md) ("Staff roster, consent and pairing (phase 14a)") and [security.md](security.md) (sections 4.3 and 5.1).

## ADR-040 — One builder writes a deterministic data pack for every runtime

Date 2026-11-20 · Status accepted

The strategy needs the same aggregate pack whether the owner builds it in the browser, on the command line or in a monthly run. Decision: `@fnb/datapack` is the only builder; it runs on any `ReportSource` (PostgREST in the browser, a read-only repeatable-read transaction as a member in `fnb datapack`, the demo engine), serialises to one canonical text and derives `pack_id` as the sha256 of that text without `pack_id` and `generated_at`. Browser and command line give byte-identical packs apart from the time (tests: golden pack, transport equivalence, environment independence; `e2e/live/datapack.spec.ts`). Not chosen: a server-side pack endpoint (it would need a service identity that reads sales); building in the assistant from raw exports (no budget, no aggregate-only guarantee, no reproducible id). Consequences: a pack can be checked anywhere with `fnb datapack --check`, and a stored plan proves which pack it was written from.

## ADR-041 — Plans are immutable and written only by one validating function; the publisher identity cannot read

Date 2026-11-20 · Status accepted

Decision: `strategy_reports` rows are written only by `publish_strategy_plan` (`security definer`), which re-validates the structure, the KPIs and the pack in SQL, stores the full pack beside the plan, is idempotent on the text's sha256 and limits a tenant to 20 plans a day; a trigger lets an update change only `title` and `archived_at` (and clear `created_by` when the publishing login is deleted). The publisher member publishes through the function and reads nothing; readers need a data role and every store of the plan in scope. Not chosen: trusting the client lint alone (a hand-written request or another client could store a malformed plan); editable plans (a KPI follow-up against a moving target proves nothing; a new version is a new plan); the secret key for the scheduled run (a leak would read every sale). Consequences: a leaked publisher credential can publish a valid plan but read nothing; plans compare across versions because none changes.

## ADR-042 — Exports and plans prove themselves against the database

Date 2026-11-20 · Status accepted

Decision: an export carries per store-month control totals and fingerprints that the browser checks against `export_totals` (#132, #141); a plan's every initiative cites pack cells by `[[table:row:column]]`, the lint checks each written number against its cell, Kế hoạch re-runs the lint against the stored pack, recomputes the pack id ("Mã gói khớp") and re-measures every KPI baseline from the database (shown with "≠" when the data changed). Not chosen: trusting the assistant's numbers; storing only the plan text (no way to recheck a citation later). Consequences: a reader can see whether a number in a plan came from the data, and a re-sync that changes history shows up beside the baseline instead of silently.

## ADR-043 — Each store chooses what confirms loyalty: the POS sync or staff with the bill evidence ladder

Date 2026-11-21 · Status accepted

Context: earns of paths B and C and the discount-rail redemptions were confirmed only by a synced POS invoice, so a store without a POS link (or with a POS whose data we cannot read) could not run the programme, and confirmation waited for the sync. Zalo's Anlene case and the chains' staff-scan flows show the POS-free pattern; docs/deep-dives/bill-verification-plan.md designs its evidence ladder.

Decision: `loyalty_store_settings.confirmation` per store, `pos_sync` by default (unchanged behaviour) or `staff`. In `staff` mode the paper bill recorded in the staff Mini App earns on path E (`bill_captures`, `loyalty_ledger.bill_id`), pending until the customer's blind total agrees (level 2) unless the owner accepts level 0; disagreements and large bills go to a manager, disputes and silence reverse; staff confirm rewards at once and managers void them within the window. The POS paths do not earn at a staff-mode store; a sync, if any, only feeds a non-blocking shadow check. Caps per staff member and store, dedupe on store + business date + bill number, a random audit, an audit trail and an alert bound what a dishonest pair can take.

Consequences: no POS dependency and instant confirmation for members who answer; a colluding staff member and customer can still forge a bill, bounded by the caps (section 3 of the plan); phases 4-8 (camera, photo hash, reader, bill checks) build on the stored extension points.

## ADR-044 — Staff-mode defaults and a free-only rule for what comes next

Date 2026-11-21 · Status accepted (the owner delegated the choices: "you decide all, keep all free")

Decision: the defaults of ADR-043 stay as built. A bill nobody confirms is reversed (`bill_silence_outcome = reverse`); a bill is confirmed at once only when the staff total and the customer's blind total agree (evidence level 2); counter claims are not auto-approved (`auto_approve_per_day = 0`) until the owner raises it; 2 % of confirmed bills are audited by an owner or manager; a bill forged by a staff member and a customer together is accepted as a loss bounded by the per-staff, per-member and per-store caps, because nothing short of POS data can detect it. Stamp value and the daily loss the owner accepts are left to the owner to set in Cài đặt → Khách hàng thân thiết → Xác nhận tại quầy; the caps ship conservative.

Everything built next must run on free tiers: no paid vision API (the bill reader stays a mock and the camera path stays unbuilt until the owner funds a budget; phases 4–8 wait), receipt photos are not collected yet (when they are, 90 days in the free Supabase bucket or free object storage), the archive of old months goes to Cloudflare R2 or Backblaze B2 free allowances (G-97) and only when the database passes 300 MB after the weekly index rebuild, and hosting stays on the Supabase Free plan with GitHub Pages (a Contabo VPS was compared and not chosen).

Not chosen: confirming a silent bill (it rewards a missing check), staff-total-only confirmation as the default (one person could invent bills), a paid reader now.

## ADR-045 — A data-subject request that turns overdue is escalated once and then reminded daily; a lost destination never closes the episode

Date 2026-11-22 · Status accepted (the owner delegated the choice: "you analyze standard and decide for me") · closes the decision of G-101

Decision: (a) when an open `dsr_due_soon` episode passes from due soon to overdue, one message with its own wording is queued ("overdue", with the count and the days late of the oldest request, no personal data); while any request stays overdue the rule then repeats every 24 hours (`remind_every` = 24 hours) to the same destinations; a request that is only due soon keeps the single early notice and no repeats. (b) the evaluator keeps reading tenants that have no usable destination, so the episode stays open with current facts and is never closed because a destination was lost: the obligation does not end with the inbox. The owner sees a notice in Cài đặt → Cảnh báo that deadlines are not being sent while no destination works.

Why: warn before the breach, escalate at the breach, remind on a fixed cadence until resolved is the standard service-deadline pattern; a silent overdue request is the worst outcome under the personal-data law, and a daily cadence is frequent enough to act on without teaching the owner to ignore it.

Not chosen: a second recipient (a one-owner tenant has none), hourly reminders (noise), closing the episode when no destination exists (hides a live deadline).

Build: a migration for the 24-hour `remind_every` and the transition message, the two characterisation tests of `pgtap:235` change to expect it, then the owner notice.

Built 2026-11-23 (migration `20261123100000_dsr_overdue_escalation`), with one refinement found while building: the catalogue's `remind_every` stays null, because the generic reminder of `app.reconcile_alerts` would repeat the due-soon-only notice too, which this decision rules out. The evaluator itself queues the rule's reminder message (template `alert.dsr_due_soon.reminder.v1`, the overdue wording) when a request turns overdue, when no message was ever sent for the episode, and every 24 hours after the last one, and the facts gain `days_late`. (b) `app.notify_tick_rules` now reads every tenant with an open request or an open episode, destination or not. Tests: `pgtap:239_dsr_overdue_escalation` (26), `pgtap:235`, `pgtap:180`, `pgtap:181`, `notify:unit/render/alert` and `notify:unit/rules/dsr-due-soon`. The owner's notice is built too (`apps/web` status section of Settings, Alerts: a warning shown to an owner who sees every destination while none is enabled and active or failing, tested in `web:unit/settings/notify/status-section`).

## ADR-046 — Balances never go negative: adjustments are floored, clawbacks are capped at what is left, pending earns neither expire nor count

Date 2026-11-22 · Status accepted (delegated) · closes G-102 and G-43

Decision: (1) a manual adjustment that would take a stamp or point balance below zero is refused (22023). (2) A clawback of an earn (a void, a reversal) takes back at most the member's current balance of that kind; the part that cannot be taken is a write-off the programme absorbs, written on the clawback row as "short by n" and counted in the nightly counts. A clawback of an earn that already expired takes back only what is left of it, normally nothing. (3) A pending earn never expires while pending: its expiry clock starts when it is confirmed. (4) The wallet shows the ledger balance, which is now never negative; the `greatest(0, …)` in the wallet stays as a safety net (so the choice of G-43, show 0, is the rule and now agrees with the ledger).

Why: stamp and star schemes in retail and F&B carry no member debt; a balance below zero cannot be explained at the till, and netting a debt against the next earn punishes a customer who disputed a void. The loss is bounded by the voided earn itself.

Not chosen: negative balances (the airline model needs a debt rule and a collections process), netting against the next earn, showing the customer a negative figure.

Build: the floor in `app.loyalty_apply_adjustment`, the cap in the clawback writers, pending earns skipped in `app.loyalty_expire`, pgTAP for each, then the second half of G-15 (generated sequences through the app functions).

Built 2026-11-23 (migrations `20261123120000_loyalty_adjustment_floor`, `130000_pending_earn_expiry_clock`, `140000_loyalty_clawback_cap`). (1) `app.loyalty_apply_adjustment` refuses with 22023, and writes nothing, a negative part larger than the spendable balance of its kind; a positive part is never refused. (2) Every clawback goes through one writer, `app.loyalty_write_clawback` (used by `app.loyalty_clawback` and `app.bill_reverse`): a pending earn is taken back whole, a confirmed earn up to the member's spendable balance of each kind, an earn that already expired nothing; the part not taken is written on the row's reason as "short by n stamp(s) and n point(s)" (there is no notes column) and counted in the nightly answer as `written_off_stamps` and `written_off_points`. A clawback while a hold is open can write off points that a later release returns, which follows the decision literally. (3) A pending earn never expires: `app.loyalty_expiring_points` and `app.loyalty_expire` skip unconfirmed earns, and the confirm step starts the clock (the ledger is append-only, so the expiry is written on the confirm row and the earn's stamps get new expiries). (4) The wallet keeps `greatest(0, ...)` on stamps and now on points. Second half of G-15: a seeded generator in `@fnb/core` runs 200 sequences of up to 20 steps through the model and `pgtap:244_loyalty_ledger_sequence_replay` runs the same steps through the SQL functions, each in its own synthetic tenant, comparing the outcome and all four balances of three members after every step and the row counts per kind at the end.

## ADR-047 — A credit is valid through the end of its anniversary day and is spendable until that instant, not until the nightly row

Date 2026-11-22 · Status accepted (delegated) · closes the two expiry questions

Decision: a credit's last day is the local date of the sale (tenant time zone) plus the programme's months, clamped to the last day of a shorter month as built (31 August plus six months is 28 February). It is valid through 23:59:59 of that date: `expires_at` is the local midnight that ends it. A credit is shown in the balance and can be spent while the moment is before `expires_at`. The nightly `app.loyalty_expire` only writes the ledger row afterwards, at its next run; between midnight and that run the credit is already unspendable and out of the wallet, whatever rows exist. Credits that have not expired yet are moved to the end of their anniversary day, later by under 24 hours, so no member loses anything. The Mini App states a date ("valid through 19 Nov 2027"), never a time.

Why: loyalty terms and vouchers are dated, not timed, and a time of day that no receipt shows leads to disputes at the till; end of day is the retail convention and what Vietnamese vouchers state. Spendability must follow the instant, not a job's timing, or the window depends on when the cron ran.

Not chosen: the sale's moment (the current build: invisible to the customer, and "the same day" means different hours for different credits), expiry at the nightly run.

Build: `app.loyalty_earn` sets the end-of-day `expires_at`, a data migration moves the unexpired credits, `pgtap:231` changes its three same-day credits (02:00, 09:00 and 23:30) to expire together and gains the midnight-to-run window, and the wallet and the Mini App read the instant.

Built 2026-11-23 (migrations `20261123150000_credit_end_of_day_expiry`, `160000_spendable_at_the_instant`, `170000_credit_expiry_end_of_day_data`). `app.loyalty_credit_expires_at` gives the local midnight that ends the local date of the sale plus the months (clamped); every writer of an expiry uses it (earn, bill earn, welcome stamps, adjustment, both confirm steps), so every date shown is a "valid through" date. `app.loyalty_balance(membership, at)` leaves out credits whose expiry has passed at `at`, whatever expire rows exist (with a null moment it is the plain ledger sum; `public.loyalty_balance` passes `now()`). Points expire first in, first out by aggregate, so a hold or a manual debit between a credit's midnight and the nightly run would be counted against the dead credit; before one is accepted, `app.redeem_coupon` and the negative part of `app.loyalty_apply_adjustment` first run the member's due expiry (`app.loyalty_expire_membership`, also used by `app.loyalty_expire`), so an expire row can appear at the debit's moment instead of at the nightly run and counts in that day's liability flows. The data migration moves each unexpired credit to the end of its day with the append-only trigger disabled inside its own transaction and enabled again before the commit (expiry column only, never earlier, at most 24 hours later; 2 ledger rows and 4 stamps on the local database). The wallet emits `valid_through` and `expires_at` and keeps `expires_on` and `on` with the same last valid day for older Mini App builds; the customer Mini App says "valid through dd/mm/yyyy", never a time, and reloads once if the end passes while the wallet is open.

## ADR-048 — Liability counts confirmed points only, the daily flow covers the closed previous day, breakage cohorts follow the credit

Date 2026-11-22 · Status accepted (delegated) · closes G-103 and G-104

Decision: (G-103) the liability is the confirmed outstanding points times the point value times one minus the breakage rate; a pending earn is not a liability until it is confirmed, so the clawback of a pending earn lowers nothing. (G-104 F1) an expiry is attributed to the month its credit was issued, through the earn row it expires, and only a row without that link falls back to first-in first-out. (G-104 F2) `points_issued`, `points_redeemed` and `deferred_revenue_released_amount` of a run cover the whole previous local business day, from its start to the start of the next, so the 03:23 nightly reports a complete day (the definition of the digest, ADR-031) and a late run still reports that day only.

Why: revenue recognition is done on a closed period and an obligation is counted once, when the credit is earned and confirmed (the IFRS 15 and ASC 606 treatment of loyalty credits); breakage is analysed by vintage, which is the month a credit was issued; half-day aggregates mislead.

Build: a migration for `app.loyalty_liability` and the breakage function, then the labelled KNOWN LIMITATION assertion of `pgtap:236` changes to the new rule; do it before any page reads these columns.

Built 2026-11-23 (migration `20261123090000_liability_flows_and_cohorts`), with two refinements found while building. (1) An `expire` row is one row per member and carries no link to an earn, so F1 is traced the way the row was written, first in first out, which is the fallback this decision named: at the moment of each expiry run the member's credits past their expiry (net of their clawbacks) are lined up oldest expiry first, the spent points took the front of the line, so the expired points are its last ones, and each credit is charged with its share under its issue month. What cannot be traced keeps the old month (the run month less the expiry period); the cohorts' expired points always add up to the expiry rows of the ledger. (2) F2 covers all five flow columns of a row (`points_issued`, `points_redeemed`, `points_expired`, `points_clawed_back` and `deferred_revenue_released_amount`), not three: a row that mixed yesterday's issued points with today's expired ones would not add up. The stock columns (members, outstanding points and stamps, the liability) stay those of the moment of the run. Tests: `core:unit/loyalty-liability` (57), `pgtap:236`, `pgtap:238`, `pgtap:65`.

Two changes after an independent review of 2026-11-23: the cohort trace was quadratic (an expiry row per member re-lined the whole history and a correlated subquery scanned all traced rows per expiry row: 10, 20 and 40 members took 1.8, 8 and 34 seconds), so `20261123180000_liability_trace_one_pass` reads each credit once with its effective expiry, confirm moment and clawback and carries each traced part with its run (20 members took 6.4 s, now 0.34 s, identical cohorts on 200 random tenants; `pgtap:245`); and the trace skips unconfirmed pending earns like the writer does (`pgtap:246`, `core:unit/loyalty-liability`, six new cases).

## ADR-049 — Store scope belongs to the login; the app only picks the brand; the owner reads which brands a login spans

Date 2026-11-22 · Status accepted (delegated) · closes G-105

Decision: the design stays as built. An owner or manager assigns stores to a person, and one person may work in stores of several brands of the same tenant (a manager of two brands is normal in a multi-brand business). The staff app lists only the stores of the brand it was opened for, and the database accepts a call only for a store in the login's scope (`wrong_store` otherwise). The access page shows, per login, the brands its stores belong to, and flags a cashier (staff role) login that spans more than one brand: warned, not refused.

Why: role-based access assigns rights to people on resources, and a client app is not a security boundary; no path crosses a tenant, and the owner is the one who sets the scope.

Not chosen: refusing a multi-brand login at creation (it blocks real managers), scoping the session by the app's brand (it adds a second scope to keep in step with the first).

Build: the per-login brand list and flag on the access page, and a pgTAP case beside `pgtap:104_follow_oa_and_access` that pins the store scope.

Built 2026-11-23: the brands line of each row of the staff roster in Settings, Staff (`apps/web/src/settings/staff/staff-brands.tsx`, rules `brandsOfScope` and `crossesBrands` in `staff-rules.ts`; the brand is named by its staff Mini App; shown for a tenant with two brands or more; a staff login that spans brands carries a warning note, a manager does not) and six cases in `pgtap:104` (a login of two brands is accepted at both stores, a login of one store and a manager of the other brand are refused 42501 at the other brand's store, an outsider is refused everywhere). Tests: `web:unit/settings/staff/staff-brands`.

## ADR-050 — An invoice whose amount changes after it earned goes to a manager; the earn is not recomputed by itself

Date 2026-11-24 · Status accepted (the owner delegated the choice: "all other thing you choose for me") · closes the decision of G-44

Decision: when a sync or the nightly re-pull changes the net amount of an invoice that already earned on a POS path and is not voided, the loyalty reconciliation compares what the earn gave with what the programme's rules give for the new amount. When they differ, one item opens in the loyalty queue for the store's managers (path D, reason `earned_invoice_edited`), naming the invoice and its earn; the manager settles it with an ordinary adjustment, which ADR-046 floors at the balance, or closes it with a reason. An item is opened once per invoice. A void stays an automatic clawback (G-03); an amount that changes back to what earned opens nothing.

Why: a difference that a rule cannot settle safely goes to an exception queue for a person, which is how reconciliations are run. An edit after payment is rare, and it is a known cashier-fraud pattern (ring a large bill, let a member claim it, then edit it down), so a person should see each one rather than have the system quietly absorb it. An automatic correcting entry would touch the ADR-046 cap, the expiry order, the liability cohorts (ADR-048) and the replayed ledger model (G-15) for a rare case.

Not chosen: keeping the first amount silently (hides the fraud pattern); an automatic entry for the difference (the ripple above); reversing the earn and earning again on the new amount (with the ADR-046 cap, a member who already spent the points would be credited twice).

Build: the comparison in the reconciliation, the new queue reason, its wording on the web queue page, and state-transition tests (amount down below the stamp minimum, amount up across it, the amount changed back, a voided invoice, a second change of an invoice already queued).

## ADR-051 — A staff-phone adjustment is refused with an answer, kept as a refused request, and counted in the shift report

Date 2026-11-24 · Status accepted (delegated) · closes the decision of G-45

Decision: a manual adjustment or a dispute credit on the membership of a staff phone is still refused, whoever asks, but no longer as an error. The request is kept in the request log with state `refused` and the system's refusal `staff_phone`, and the caller gets the same answer shape as any request with that state and refusal. A manager's approval of an older request that turns out to name a staff phone is refused the same way. `loyalty_shift_anomalies` counts these refusals under `staff_phone`, in the shift of the request's time.

Why: fraud monitoring counts attempts, not only the actions that succeeded: a staff member trying to credit their own phone is exactly what the owner needs to see, and an error rolls back everything, so nothing could be counted. The request log already holds every adjustment with who asked and when, so it is the one record to count from.

Not chosen: making `loyalty_refusals.invoice_id` nullable (every reader of that table and its uniqueness key assume an invoice); counting nothing.

Build: a `refusal` column on the request log that only the system sets, the two request functions, the shift-anomaly function, the staff app's reading of the answer, pgTAP beside `pgtap:150` and `pgtap:81`.

## ADR-052 — The erased-phone memory is a keyed hash with a key per tenant

Date 2026-11-24 · Status accepted (delegated) · closes the decision of G-46

Decision: the memory of erased phones stores an HMAC-SHA-256 of the phone in E.164 form, keyed with 32 random bytes per tenant that live in a table no API role can read and are created at the tenant's first erasure. Two tenants hold different values for one phone. Entries written before this change (a plain SHA-256) still match; an old entry is rewritten in the keyed form the first time its phone is seen again (a synced invoice, a join, a new erasure). What stays: someone with full access to the database can read a key and still test every possible number of that tenant. That is accepted, because the same person can already read every phone of the members who were not erased, while an erased customer's data is gone.

Why: pseudonymisation guidance (ENISA, 2019) treats a plain hash of a phone number as reversible by trying every number, and recommends a keyed hash. A key per tenant keeps one tenant's list from being linked with another's and makes precomputed tables useless, so a copy of the list alone (an export, a log, a support extract) reveals nothing. The key stays inside the database because a restore must bring it back: a key lost in a restore would silently empty the erasure memory, and the POS would bring the erased phones back, which is the worse harm.

Not chosen: Supabase Vault or a function secret (a restore into a new project, the disaster case of `backup.yml`, would lose the key); a slow hash (paid again at every synced invoice); keeping the plain hash.

Build: the key table, `app.phone_hash` per tenant, every reader and writer of `app.erased_phones`, and pgTAP that two tenants hold different values for one phone, that an old entry still blanks a synced phone and is rewritten in the keyed form, and that no API role reads the keys.

## ADR-053 — A corrected name stands: nothing that writes a customer's name overwrites one that is set

Date 2026-11-24 · Status accepted (delegated) · closes the decision of G-52

Decision: no flag; the rule already holds and is now pinned by tests. No POS sync writes `customers.name` (the POS name lives on the invoices and in the raw sale data), and the two other writers, a Zalo join and the OA form, fill a name only when it is empty. So a name corrected through `dsr_correct` survives every later sync, join and form. Any future writer, a POS customer sync for example, must keep that rule: fill an empty name, never overwrite one. The request page keeps telling the owner to correct the name in the POS as well, because the invoices and the raw sale data hold the POS's copy.

Why: the right to have personal data corrected means a correction has to stick. A protection flag would only guard against a writer that does not exist, and a guard test that fails when a new writer appears does the same job.

Not chosen: a `name_corrected_at` flag that the sync respects (no sync writes the name); asking the owner to correct the POS first (the apps show our copy, so it must be right whatever the POS holds).

Build: pgTAP beside `pgtap:161`: a corrected name survives a join and an OA form that carry another name, and the list of functions that write `customers.name` is exactly the known three.

Built 2026-11-24: `pgtap:249_corrected_name_stands` (17 tests; the OA form, the Zalo join, a synced invoice, its re-pull and the earn's lookup keep a corrected name; controls show both writers fill a null or blank name; the guard lists the three writers). With the two writers changed to overwrite, 5 tests fail.

## ADR-054 — A data export stays a browser download that no server keeps, and each download is recorded

Date 2026-11-24 · Status accepted (delegated) · closes the decision of G-53

Decision: `dsr_export` records an `export` action in `data_subject_request_actions` every time it answers: who made the copy, when, and the counts of what it holds, never the content. The file is still made in the owner's browser and never stored on a server or behind a link. The request page says how to hand it over: in person, or sent to the contact the request came from, and the downloaded file deleted afterwards.

Why: the right of access asks for a copy in a common electronic format, and accountability asks for a record of who made a copy and when. Every copy at rest is one more place that can leak, so a file that never lands in storage is the smallest surface; a JSON file opens on any phone.

Not chosen: an expiring link (the file would have to be stored, and a link can be forwarded); an encrypted archive (most phones cannot open an AES-encrypted zip, and the password needs a second channel anyway).

Build: the action kind `export`, the record in `dsr_export`, the wording on the request page, pgTAP beside `pgtap:161` (one action per export, count-only facts, nothing recorded for a refused caller).

Built 2026-11-24 (migration `20261124120000_dsr_export_recorded`): the action check allows `export`, the one-row-per-request-and-action key became a partial unique index on the deletion, and `dsr_export` inserts one action per answer with `auth.uid()`, the moment, the counts and both deadlines. The request page says the download is recorded and how to hand it over. Tests: `pgtap:250_dsr_export_recorded` (24; without the record 9 fail) and `e2e:live/privacy-requests`.

## ADR-055 — The member frequency uplift compares matched cohorts; no hold-out group

Date 2026-11-24 · Status accepted (delegated) · closes the decision of G-54

Decision: the uplift compares members with identified non-members of the same cohort: the same first-visit month and the same first store (an exact match on both). Each cohort cell's difference in visit frequency is weighted by its number of members; a cell with fewer than 10 customers on either side is left out; with fewer than 10 matched members in all, the uplift stays null. The answer names the comparison `matched_cohorts` and gives the matched sizes. There is no hold-out group. `customer_ltv` waits until item costs cover the stores.

Why: customers who already come often are the ones who join, so the plain gap between members and non-members overstates what the programme does. Matching on tenure and store is the standard low-cost correction (coarsened exact matching). A hold-out would deny the programme to some customers, which a single store cannot explain at the till, and it would leave too few customers to measure anything.

Not chosen: a configured hold-out group; propensity-score matching (too few identified customers for a model to be stable).

Note: on 2026-11-22 the real tenant's 30 days held no invoice with a phone or customer id, so the uplift will read null there until the till records customers.

Build: the cohort comparison in `customer_metrics`, its documentation in metrics.md, the web wording of the comparison, and a hand-calculated pgTAP case beside `pgtap:163` with two cohorts of different tenure.

## ADR-056 — Each brand's Mini Apps carry the brand's identity from its configuration, checked against WCAG AA

Date 2026-11-24 · Status accepted (the owner asked for the Mini Apps to follow the brand's identity)

Decision: a brand's Mini App row may carry a `theme`: a light and a dark palette over the design tokens' roles plus four brand roles (`highlight`, `hero`, `hero_ink`, `tile`), and an optional tile wordmark, tagline and kicker. The build carries it to the app, which applies it as one style sheet at start-up and shows the brand banner on the home screens and the sign-in states. The repository holds only the mechanism and a synthetic theme; a real brand's colours and words live in its configuration. `app-config` refuses a theme below WCAG 2.2 AA contrast in either palette. The Zalo header colours stay the existing `header_color_*` fields, set to match.

Why: the owner's customers should recognise the shop in Zalo at a glance; a generic multi-brand system keeps brand data out of the code, and the accessibility floor of ADR-034 must hold whatever colours a brand picks. A run-time style sheet is the only way, because Zalo serves its own page shell and ignores `index.html`.

Not chosen: a stylesheet per brand in the repository (brand data in a public repository); custom fonts (a heavier first load, G-107); a logo image in the bundle (the tile wordmark draws the same mark in a few hundred bytes).

Built 2026-11-24: `packages/zalo-mini/src/app-config/index.ts` (the theme's validation and style sheet), `src/react/brand-theme.tsx` (`applyBrandTheme`, `BrandHero`, `BrandWordmark`), both boots and the three screens. Tests: `zalo-mini:unit/brand-theme` (13: equivalence classes of a theme, the contrast boundaries at #767676/#777777 and #949494/#959595 on white, every rule failing in a flat dark palette, the wordmark and text bounds, the theme carried to the build and never into the deployed config, one style element, the tiles and the tagline in both languages), `zalo-mini:unit/app-config` (the second synthetic brand's theme in the comparison). Left: the `mini_apps` table has no theme column yet, so `fnb zalo app-config` from the database builds without it (G-108).
