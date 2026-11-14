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

## ADR-034 — One token source in the DTCG format; accessible primitives in the shadcn pattern; WCAG 2.2 AA

Date 2026-11-14 · Status accepted

The web app defined its colours in five places (the light, dark and print blocks of `styles.css`, and the screen-fallback and print palettes of the chart theme), and the copies had already drifted: the chart fallback's second series colour differed from the CSS one. Control styles were copied as class strings (the primary button four times, the text input three times), and the store picker, the language switch and the folded controls each implemented their own open, close, focus and keyboard behaviour. The Zalo Mini Apps of track B will need the same brand in zmp-ui. The owner asked for a standard that keeps this easy to maintain. Decision: every colour, font stack and print size is a token in the Design Tokens Format Module 2025.10 of the W3C Design Tokens Community Group, kept in `packages/design-tokens`; Style Dictionary 5 generates from it the CSS variables with the Tailwind 4 `@theme inline` mapping and a typed palette for ECharts, and later the zmp-ui theme, and the generated files are committed and checked for staleness in CI like the Edge Function's import map. Controls live in `apps/web/src/components/ui` in the shadcn/ui pattern: the code is ours, built on Radix primitives where an interaction needs more than the native WAI-ARIA pattern gives, with variants typed by `class-variance-authority` (amended at DS2 on 2026-11-14: the store picker's popover is Radix; the language switch and the folded controls already follow the toggle-button and disclosure patterns natively and stay so); single-choice pickers stay native `<select>` because the system picker is the most usable on phones. The project standard rises from WCAG 2.1 AA to 2.2 AA, checked by axe with the `wcag22aa` tag and by end-to-end checks for focus that the sticky top bar must not hide and for password managers on the sign-in forms. A development-only catalogue page shows every control and is checked by axe, instead of a separate Storybook toolchain. Not chosen: Material UI and Ant Design, whose runtime weight works against the 400 kB start-up budget on phones and whose look takes long to bend to the brand; Radix Themes, whose prebuilt look gives less control. Consequences: a colour changes in one file for the web, the charts, print and later the Mini Apps; the component code is ours to maintain, with no library upgrade to wait for; the DTCG format is a community-group report rather than a W3C Recommendation, so Style Dictionary sits between it and the code and absorbs a later revision. The design system is described in `docs/design-system.md` and introduced in three steps, DS1 to DS3, each keeping every existing test green.
