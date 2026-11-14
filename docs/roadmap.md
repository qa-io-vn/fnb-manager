# FNB Manager — programme roadmap

Version 1.1 · 2026-11-07 · For approval

This is the master plan for everything requested: the analytics web app with assistant-written strategy plans (Track A), a Zalo app for the manager and staff (Track B), Zalo customer loyalty integrated with iPOS (Track C), and the portability that lets the platform be applied to another shop, owner or POS by configuration (Track D). It has 20 phases; phases larger than three days are split into sub-steps (a/b) so that every build step stays small and verifiable.

How it was produced: the architecture plan; three independently proposed roadmaps judged by two reviewers (value-first ordering won, platform and risk ideas grafted in); a critique of the first draft; a fact-checked research panel on Zalo Mini Apps, Zalo Official Accounts and messaging, the iPOS ecosystem, loyalty patterns, staff tooling and the integration architecture; a second panel on platform limits (GitHub Pages and Actions, Supabase), Zalo design and review standards, Vietnamese legal requirements, standard F&B KPIs and a hands-on read-only review of the Fabi CMS; and a completeness critic comparing v1.0 with all of it. Every claim below that came from research is written up with sources in `docs/deep-dives/`.

Companion documents: `docs/private/plan-original.md` (the original architecture and product description, kept private because it names the shops; where it differs from this roadmap or from `docs/decisions.md`, the roadmap and the decisions win), `docs/decisions.md` (ADR-001 … 026), `docs/deep-dives/` (twelve documents: zalo-mini-app-platform, zalo-oa-and-messaging, zalo-design-and-review-standards, zalo-integration-architecture, staff-app-on-zalo, loyalty-programme-design, ipos-ecosystem-and-crm, ipos-loyalty-integration-design, github-pages-and-actions, supabase-platform, vietnam-legal-requirements, fnb-kpi-standards), `docs/schema.md`, `docs/private/acceptance-figures.md` (exact numbers used to accept phases — private, the repository is public), `docs/private/ipos-data-exploration.md`, `docs/private/fabi-cms-handson.md`, `docs/private/research/`. Note: the seven Zalo and iPOS deep dives were written against the v0.9 numbering of Tracks B and C — their phase numbers are two higher than here — and call two Edge Functions `zalo-auth` and `zalo-oa-webhook`, which are `zalo-session` and `oa-webhook` in this roadmap.

## 1. Programme map

```
                         ┌─────────────────────── Surfaces ─────────────────────────┐
                         │ A  Web app on GitHub Pages — reports, exports, AI data    │
                         │    pack, saved plans, admin (loyalty rules, roster, alerts,│
                         │    consent and data-subject requests)                     │
                         │ A  /strategy in the owner's own assistant, no API key     │
                         │ B  Zalo Mini App "<Brand> Nhân viên" (internal) — staff   │
                         │ C  Zalo Mini App "<Brand> Thành viên" (public) — customers│
                         │ B·C Zalo OA messages · Zalo Bot alerts · Telegram/email   │
                         └────────────────────────────▲─────────────────────────────┘
                                                      │ supabase-js · Edge Functions
┌──────────── Connectors ─────────────┐  ┌────────────┴───────────── Platform ─────────────────────┐
│ K1 iPOS posapi sync (documented     │  │ Supabase: Postgres (canonical schema, tenants + RLS,       │
│    read endpoints only)             │─►│ RLS-protected aggregates, metric registry, loyalty ledger,│
│ K2 iPOS CRM rail (optional): member │  │ consent ledger, operations, messaging outbox, per-brand   │
│    attach at the till, e-voucher    │  │ Zalo config), Auth, Vault, Storage, Edge Functions,       │
│    codes, voucher-validation hook   │  │ pg_cron (incremental sync runner)                         │
│ K3 Zalo OA Open API · K4 ZBS        │  │ GitHub Actions: CI, migrations, web and Mini App deploys, │
│ K5 Zalo Mini App identity + zmp CI  │  │ nightly sync, backfills, backups, digests                 │
│ K6 Zalo Bot API · mock · CSV import │  │                                                           │
│ future POS via PosConnector         │  │                                                           │
└─────────────────────────────────────┘  └───────────────────────────────────────────────────────────┘
```

| Track | Phases | Delivers |
|---|---|---|
| A — Platform & analytics | 1–12 | Verified sales data for every store, the Reports page, exports, the AI data pack, strategy plans, digests, backups |
| B — Zalo manager & staff | 13–15 | Zalo foundation, staff Mini App (sign-in, shift operations, cash count, notices, alerts, approvals) |
| C — Zalo customer loyalty | 16–19 | Phone capture at the till, loyalty ledger connected to real iPOS purchases, customer Mini App, coupons, messaging, legal compliance, pilot |
| D — Cross-cutting | 20 | Portability proof (onboard a shop, deploy your own), hardening, launch, handover |
| Z — Owner paperwork | runs beside A | Legal form and e-invoice status, Zalo accounts, OA verification and package, Mini Apps, KYB, permissions, iPOS CRM questions, privacy notice, consent wording (section 5) |

## 2. Principles the roadmap enforces

1. **Configuration over code.** Tenants, POS accounts, stores, timezones, business-day start, currency, category roles, payment kinds, fee rates, thresholds, channels, loyalty rules, coupon rails, legal texts and every Zalo identifier are rows or secrets. The repository builds, tests and deploys without knowing any shop's name.
2. **Canonical schema is the contract.** Connectors normalise into POS-agnostic tables and keep the original payload in `raw`. Everything downstream reads canonical columns only; a lint fails the build if a POS field name leaks into the schema. Connectors use documented read endpoints only (ADR-025).
3. **Tenant isolation by construction.** `tenant_id` on every row, RLS on every table including aggregates (ADR-010), membership roles (owner, manager, staff, viewer, publisher), two-tenant negative tests in CI and once against the live project.
4. **Verified or flagged, never silent.** Every synced business day is reconciled against the POS's own daily totals; the badge shows in the app, digests and data pack. Every loyalty earn references a real invoice.
5. **Real data early.** One recent month is loaded in phase 5 and the full history in phase 7, so reports, sentences, prompts and loyalty rules are reviewed against real numbers.
6. **Identification at the till comes first.** Loyalty is limited by whether a member is attached before the bill is printed. The phone-capture habit and its KPI start before any loyalty code (phase 16a).
7. **Lawful by design.** Per-purpose consent with evidence, a working opt-out, data-subject-request deadlines, breach runbook, promotion rules (50 % cap, 120 discount-days, programme notification check) and e-invoice display of redemptions are built into the schema, the apps and the campaign engine, not added later (ADR-021).
8. **Zalo policy as acceptance criteria.** No outbound links, in-app Terms and Privacy, no prices without Checkout SDK, policy-compliant names and logos, performance gates, permission requests at the first review, messaging windows and caps (ADR-022).
9. **Messaging economics.** In-app first; free consultation messages inside the window second; paid template messages only for issued vouchers and reminders within consent and caps; staff alerts through the free Zalo Bot (ADR-018).
10. **No server-side AI.** The app prepares a versioned, aggregate-only data pack and stores plans; the reasoning runs in the owner's own assistant subscription (ADR-003).
11. **Testable without the cloud.** Local Supabase in Docker, pgTAP, synthetic fixtures and a mock connector shaped like the real data; live calls opt-in with local credentials.
12. **Public-repo hygiene.** Secret and identifier scanning in CI, masked credentials in job logs, synthetic fixtures only, identifiers and revenue figures only in the database, secrets or `docs/private/`. The owner reviews and commits every phase.
13. **Small verifiable steps.** No build step exceeds about three days; each ends with something the owner can open or run and acceptance checked by a command or a test.

## 3. Phase overview

| # | Track | Phase | Size | Depends on | Owner must | Status |
|---|---|---|---|---|---|---|
| 1 | A | Foundations and public-repo hygiene | 1.5 d | — | create repo, enable Pages | ● complete: public repository, CI, Pages live with a placeholder; cron-probe week still collecting |
| 2 | A | Canonical schema, tenancy, RLS, consent and legal tables | 3 d | 1 | — | ● complete at v3.1 (357 pgTAP tests) |
| 3 | A | iPOS connector and API contract spike | 2.5 d | 1 | change the tea shop's POS password; capture session | ● complete: client, C05/C08 adjustments, open items answered |
| 4 | A | Connector contract, mock connector, normaliser | 2.5 d | 2, 3 | — | ● complete: `adjustments` capability on |
| 5 | A | Cloud project live, onboarding v1, backups, first month of real data | 2.5 d | 4 | Supabase project, SMTP, secrets, backup destination | ◐ local part done: `fnb` CLI and sync engine verified on nine weeks of both accounts, every store-day reconciled; cloud project, secrets, SMTP and backups wait for the owner (`docs/go-live.md`) |
| 6 | A | Web app foundation and "Hôm nay" on real data | 3 d | 5 | Pages variables, auth URL, routing choice | ◐ built and verified locally: login, store picker, "Hôm nay" equal to the POS daily totals for both stores, demo build for Pages, install manifest, print layout, Lighthouse on the demo 95 performance and 100 accessibility; phone login, deployed password reset and Lighthouse on the live app wait for the cloud project |
| 7 | A | Sync engine: incremental on Supabase, nightly and backfill on Actions, reconciliation, voids | 3.5 d | 5 | start phone capture; C05/C08 capture | ◐ both runners built and verified locally: the Node runner with the full history loaded and every store-day reconciled, and the Edge Function `sync-incremental` on a 30-minute `pg_cron` schedule with change detection, guard, Notifier and dead-man's switch; the deploy, the three-day freshness check and the database connection on the cloud wait for the cloud project; database 285 MiB with the full history after compaction, under the 300 MB acceptance |
| 8 | A | Analytics aggregates and metric registry (≈ 40 metrics) | 3 d | 7 | — | ● complete locally: SQL layer, `packages/metrics` registry with its consistency lint, `metric_value`; refresh timing on production waits for the cloud project |
| 9 | A | Periodic reports: Ngày, Tuần, Tháng, Năm | 3 d | 6, 8 | review wording | ◐ built and verified locally: the four reports on the demo and on the real data, equal to the POS control totals on the sampled days and month; the comparison with Fabi A01/B01 and the wording review are owner checks |
| 10 | A | Thematic reports (a) · thematic II, settings, manual data, compliance checks (b) | 3 + 3 d | 9 | costs, targets, seat counts | ◐ 10a in progress: report settings, category overrides and the revenue and hours functions in SQL with exact demo ports; Doanh thu & xu hướng, Giờ & ngày trong tuần, Thực đơn and Thanh toán (payment mix, cash trend) open on the demo and on the local stack; the drawer and fee cards, Settings and the live check are next |
| 11 | A | Exports and AI data pack (a) · Strategy plans, Kế hoạch, KPI follow-up (b) | 2.5 + 2.5 d | 10 | run /strategy | ○ |
| 12 | A | Alerts, digests and channel policies | 2.5 d | 8 | Zalo Bot, email provider | ○ |
| 13 | B | Zalo and platform foundation | 3 d | 5, 6 + Track Z | Zalo accounts, OA verified + package, Mini Apps, names and logos | ○ |
| 14 | B | Staff Mini App core (a: sign-in, roles, home · b: checklists, cash count, handover, incidents) | 2.5 + 3 d | 13 | staff list, checklist items, cashier logins, staff notice | ○ |
| 15 | B | Notices, alerts, approvals; first review with permission requests; internal publish | 2.5 d + review | 14, 12 | staff follow OA, join group, message Bot | ○ |
| 16 | C | Loyalty rail (a: capture measurement, CRM facts, e-invoice readiness · b: rail setup — CRM or fallback) | 1.5 + 2 d | 7, 9 | cashier briefing, CRM questions, toggles, receipt template, e-invoice registration | ○ |
| 17 | C | Loyalty ledger, reconciliation, compliance tooling (a) · staff loyalty tools, staff app v2 (b) | 3 + 2.5 d | 16, 13, 15 | thresholds, blacklist, programme budget | ○ |
| 18 | C | Customer Mini App MVP (a) · coupons and redemption (b) | 3 + 2.5 d | 17 | brand assets, test users, reward catalogue, cashier training | ○ |
| 19 | C | Customer messaging (a) · legal filings, KYB, review, publish, pilot (b) | 2.5 + 2 d | 18 | ZBS account, templates, Sở Công Thương decision, dossier decision, standees | ○ |
| 20 | D | Portability proof (a) · hardening, launch and handover (b) | 2.5 + 2.5 d | all | deploy-your-own dry run, tag v1.0 | ○ |

Build effort ≈ 72 working days (about 14–15 weeks): Track A ≈ 37, Tracks B+C ≈ 30, Track D ≈ 5. Track A is usable from phase 9 (about week 5). Zalo verification, permission approvals (~2 weeks reported) and legal paperwork add calendar time, so Track Z starts in week 1 (section 5).

## 4. Phases in detail

### Phase 1 — Foundations and public-repo hygiene (A)

Goal: a public monorepo where every later phase lands on tested, secret-free ground. Deep dive: `github-pages-and-actions.md`.

Deliverables: pnpm workspace on Node 22, TypeScript strict, Biome, Vitest, Supabase CLI, local Supabase in Docker, `.gitignore` for `docs/private/`, `.env*`, `.playwright-mcp/` and live fixtures, `.env.example` with names only, `ci.yml` (lint, typecheck, unit tests, migrations + pgTAP on a Supabase stack in CI, `db diff --strict-coverage` and `gen types` drift checks, Supabase CLI pinned via `supabase/setup-cli@v3`), secret scanning (gitleaks plus generic identifier rules, ADR-015) and a preflight lint that fails when a structured secret is printed to a log, `cron-probe.yml` recording delay per time slot and testing the cron `timezone` field, a weekly check that scheduled workflows are still active (the 60-day inactivity rule) with `gh workflow enable` documented, `.nojekyll`, README, `docs/decisions.md`, this roadmap.

Acceptance: `pnpm lint`, `pnpm typecheck`, `pnpm test` green locally and in CI · a test commit with a fake UUID under `apps/` fails CI · `git ls-files` shows nothing under `docs/private/` and no `.env` · the probe reports a week of per-slot delays before phase 7.

Owner: create the public GitHub repository, enable Actions and Pages (source: GitHub Actions), make the first commit.

Status: complete — public repository with Actions and Pages enabled, first commit published, placeholder page served; CI runs lint, typecheck, unit tests, migrations plus pgTAP on a Supabase stack, the gitleaks scan (docker image with the repository configuration, because the GitHub action needs a licence for organisations) and the public-safety scan; `migrate.yml` and `backup.yml` skip cleanly until the cloud secrets exist; the cron probes and the weekly workflows-active check are scheduled. Still collecting: the first week of cron-delay data (`scripts/cron-delay-report.mjs`).

Portability: the repository is the artifact another owner forks; it contains code, placeholders and generic docs only.

### Phase 2 — Canonical schema, tenancy, RLS, consent and legal tables (A)

Goal: the multi-tenant, POS-agnostic database with row-level security, proven by pgTAP before live data exists. Deep dives: `supabase-platform.md`, `vietnam-legal-requirements.md`; field dictionary in `docs/schema.md`.

Deliverables: migrations for `tenants`, `tenant_members` (owner | manager | staff | viewer | publisher, optional store scope), `pos_accounts` (metadata and external ids only), `pos_account_tokens` (service role only), `stores` (timezone, `business_day_start_minutes`, `opening_hours`, `seat_count`, currency, `opened_on`, `e_invoice_status`, `tran_no_reset_period`, settings), master data (`items` with `base_name`, `size_label`, `is_modifier`, lifecycle; `store_items`; `item_types`, `item_classes`, `units`, `customizations`, `sources`, `payment_methods` with `kind`, `promotions`, `packages`, `devices`), `customers`, facts (`invoices` with status completed | edited | voided and decomposed discounts; `invoice_lines` with `line_kind`, `parent_line_external_id`, `package_external_id`; `invoice_payments`; `shifts`; `invoice_events`), `sync_runs`, `sync_checks`, manual data (`item_costs`, `targets`, `payment_fee_rates`, `item_type_roles`, `holidays` with Tết windows 2024–2028), `strategy_reports`, and the legal tables `consent_records` (subject type customer | staff, subject id, purpose loyalty | marketing | staff_ops, policy version, channel, granted_at, revoked_at, evidence) and `data_subject_requests` (type, received_at, first-response due in 2 working days, completion due in 20 or 30 days, status); storage rule (`raw` on invoices and shifts; lines keep only non-duplicated fields); unique natural keys and composite tenant-consistent foreign keys; report indexes leading with tenant; helpers in a non-exposed schema (`security definer`, pinned `search_path`, `(select …)` wrapping, index-usable policies); hardening SQL (default privileges revoked for anon and authenticated, functions not executable by public, only `public` exposed); RLS on every table with data roles separated from the publisher role; synthetic demo seed with a dev login; pgTAP tests; column-name lint; `docs/schema.md`.

Acceptance: `supabase db reset` and `supabase test db` green locally and in CI · a member of tenant A reads zero rows of tenant B everywhere; anon reads nothing; a publisher reads zero invoices but can insert a plan · re-upserting the same day changes nothing · business-date helper handles 23:59:59, 00:00:30 and a 05:00 day start · the database linter reports no exposed materialised view and no table without RLS · lint passes.

Status: complete at v3.1 — 8 migrations, 12 pgTAP files, 357 tests; publisher role isolated; invoice events; holidays with Tết windows; append-only consent ledger (trigger-enforced, binds the service role too), data-subject requests with a working-day deadline function, outbound-message log; store compliance fields; `docs/schema.md`. Later phases add their own tables (aggregates in 8, alerts in 12, Zalo config in 13, loyalty in 17).

Owner: review the ERD.

Portability: a second owner, POS account or store is a row; timezone, day start and currency are store columns; vendor ids live in `external_id` and `raw`.

### Phase 3 — iPOS connector and API contract spike (A)

Goal: a typed, validated client for every documented posapi read endpoint the sync needs, built on observed behaviour, with the open questions answered by evidence. Deep dives: `ipos-ecosystem-and-crm.md`; private API notes.

Deliverables: `packages/connector-ipos` (login with 7-day token cache and re-login on 401, exact headers, inclusive millisecond windows, cursor pagination with boundary de-duplication because the resume parameter is inclusive, large-page shifts, store id always sent, zod validation with passthrough, typed errors with endpoint and track id, retries with backoff); synthetic fixtures and a fake-fetch suite; opt-in live smoke test (counts only); anonymising recorder to a gitignored folder; capture of the C05 (edited and cancelled invoices) and C08 (removed items) endpoints and their clients; evidence for the open items (rows per invoice on split bills, discount decomposition, line time of day, whether the sale payload carries customer phone or membership once a member is attached, historical promotions); boundary probes; public `docs/connectors/ipos-fabi.md` without identifiers. Hard rule (ADR-025): only documented posapi read endpoints — never the CMS forwarding or CRM endpoints — and never persist any credential or other brand's data such endpoints might return.

Acceptance: unit tests for login and refresh, headers, both pagination styles, retry and non-retry, 401 path, schema errors, the empty-store guard and day-range boundaries · every zod schema parses captured real responses (private run) and synthetic fixtures (CI) · each open item has a written answer with query and counts · live smoke passes for both accounts · no real identifier under `packages/`.

Status: client verified (58 unit tests, live smoke, leak scan clean); live probing corrected the pagination and several endpoint details. C05 (cancelled/edited invoices), the per-invoice snapshot, C08 (removed items, one change event per order, same-calendar-month ranges only), C04 (order log) and C09 (out-of-stock, unused) are captured and documented in the private notes and in `docs/connectors/ipos-fabi.md`; the adjustment clients are implemented and the connector's `adjustments` capability is on: C05 rows become `voided` or `edited` (edits carry the absolute difference; two edits observed live), C08 removed lines become `line_removed` (detected by negative quantity, not only the `_REMOVE` suffix — some removals carry none), C05 ranges are split per calendar month because the server caps them at three months, and C04 is month-bounded like C08. Live over 30 days: 39 and 40 adjustments on the two accounts with zero schema errors. Open items answered by live probing: one sale-report row and one payment row per invoice (no split bills in 6,437 sales), the "voucher" promotions are line-level price reductions with `voucher_amount_paid` always 0, voided invoices are absent from the sale report while edited ones appear with the post-edit amount.

Owner: change the tea shop's six-digit POS password, keep both logins in the local `.env`, allow a browser capture session for C05 and C08.

Portability: everything Fabi-specific lives in one package; the mapping table and fixture layout are the template for every future connector.

### Phase 4 — Connector contract, mock connector, normaliser (A)

Goal: fix the vendor-neutral `PosConnector` interface and prove it with a POS-independent implementation before the iPOS normaliser is written against it (ADR-012).

Deliverables: `packages/core` (canonical zod model and rules: `businessDate` with IANA timezone and day start, `parseSizeSuffix`, `classifyPaymentKind` with Vietnamese defaults and overrides); `packages/connector-core` (interface with capabilities — lines, modifiers, payments, shifts, adjustments, control totals, customers, guest count, costs — registry, typed errors, conformance suite); `packages/connector-mock` (seeded generator shaped like the real data); iPOS adapter (business date, channel map, discount decomposition into item, bill and voucher, line classification with the item master first so free toppings stay items, size parsing, item type resolution for UUID-only items, one payment per payment row, control totals from daily summaries, customer phone, membership and voucher fields passed through); iPOS-shaped fixture renderer so the adapter runs the conformance suite offline; live verification on both accounts; `docs/connectors.md`.

Acceptance: mock connector and iPOS adapter pass the conformance suite; a deliberately wrong-timezone mock fails with the rule named · golden cases (50 % Đá → modifier; free topping → item; "(L)" → size L; plain name → no size; "( M )" with spaces → size M; 23:30 local keeps its date; 00:30 with 05:00 day start → previous date; split bill → one sale, two payments; UUID-only type resolved) · live: control totals equal emitted sales per day within 1,000 ₫; the discount identity holds on voucher invoices · no iPOS field name outside `raw` (lint).

Status: complete — four packages, 249 unit tests, conformance suites for the mock connector and the iPOS adapter (midnight and 05:00 day starts), live verification on both accounts (control totals equal emitted sales on every probed store-day; discount identity holds on all 376 discounted invoices; `store_open_at` confirmed to be in hours; per-store day start taken from the login payload). The adapter's `adjustments` capability is on since the C05/C08 clients landed (phase 3 status); the conformance suite checks adjustment shapes and keys for every connector that declares the capability.

Portability: another POS is one more package passing the same suite; the CSV connector (phase 20a) is the second real implementation.

### Phase 5 — Cloud project live, onboarding v1, backups, first month of real data (A)

Goal: run the generic path for real: migrations by workflow, RLS proven on the live project, both shops onboarded through the CLI, one recent month loaded, backups running from the first day real data exists. Deep dives: `supabase-platform.md`, `github-pages-and-actions.md`.

Deliverables: `migrate.yml` (Supabase `db push` on changes to migrations with a concurrency group and a dry run on pull requests, CLI pinned); secrets contract with the new key scheme — `SUPABASE_SECRET_KEY`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID` as secrets, `SUPABASE_PUBLISHABLE_KEY` and URL as repository variables — and `POS_ACCOUNTS_JSON` parsed at job start with every credential field masked before any logging (or one secret per account assembled in the workflow); `fnb onboard` v1 (create tenant, add POS account, authenticate through the connector, discover stores, write rows, print the secret entry); `fnb tenant add-member`; `fnb sync window`; `sync.yml` with workflow_dispatch; live RLS proof with two throwaway auth users; `backup.yml` (weekly `supabase db dump` of schema, data, roles and auth through the session pooler, encrypted with `age` before upload, stored outside the public repository, size and egress recorded) with a guard against `db reset --linked`; `fnb doctor` v1 (database size, disk, egress estimate, pause risk, last successful sync); `docs/secrets.md`; one recent month loaded for both stores.

Acceptance: migrations applied by workflow; the live RLS suite is green · both stores onboarded through `fnb onboard` with correct names and opening dates · the month's per-day invoice counts equal the POS daily totals; the manager session sees the rows and the publishable key alone sees nothing · sign-ups disabled, custom SMTP configured (the built-in mailer allows two emails per hour), manager user created and a tenant member · the first encrypted backup exists outside the repository and its size is logged.

Owner: create the Supabase project (Singapore), disable sign-ups, configure custom SMTP, create the manager user, add the secrets and variables above, choose a private backup destination, run the dispatch workflows.

Portability: the first tenant enters through the same command a stranger's shop will use; nothing about the shops exists in the repository.

Status: everything that needs no cloud project is done and verified on the local stack. `fnb tenant create`, `tenant add-member`, `onboard`, `sync window`, `sync master`, `status` and `doctor` work, and `docs/go-live.md` matches their real flags. Onboarding discovers both stores with their timezone and day start through the connector. Nine weeks of both accounts are loaded, and every store-day's invoice count and net total equal the POS control totals. `sync.yml` and `backup.yml` skip with a note until their secrets exist. Waiting for the owner: the Supabase project, SMTP, the secrets and variables, the backup destination and the live RLS run.

### Phase 6 — Web app foundation and "Hôm nay" on real data (A)

Goal: the authenticated, bilingual, mobile-first web app on GitHub Pages with the report-card pattern and a first live screen — the early-value pivot (ADR-011). Deep dive: `github-pages-and-actions.md`.

Deliverables: Vite + React + TypeScript with the base path taken from the Pages configuration output; routing decision implemented — hash routing with the PKCE auth flow (recommended) or a 404.html redirect with a router basename — and the password-reset and invite links tested on the project-site path; supabase-js auth with persisted session; tenant/store context from membership (store selector with "Tất cả" for N stores); period picker; i18n vi/en with a completeness lint; `Intl` formatters driven by tenant currency and locale; lazy-loaded ECharts; `ReportCard` (headline, comparison chips, sentence, chart, table with CSV, collapsed "Giải thích chỉ số"); freshness and verified badges (badge reads "chưa đối soát" until phase 7); `version.json` with a "phiên bản mới, tải lại" prompt because Pages caches `index.html` for ten minutes; PWA manifest; print stylesheet; `deploy-web.yml` (configure-pages, upload-pages-artifact, deploy-pages, concurrency group); "Hôm nay" screen reading minimal RLS-protected aggregates; Playwright smoke, component tests, axe checks with WCAG 2.1 AA contrast as the project standard. Recorded limitation: Pages cannot set CSP or HSTS headers; Cloudflare Pages is the drop-in fallback.

Acceptance: the Pages URL loads and login works on a phone; without a session every view returns zero rows · language toggle covers every string · built bundle contains no key, UUID or email · Lighthouse mobile performance ≥ 85, accessibility ≥ 90, axe with no serious violations · "Hôm nay" equals the POS overview for the same day · a password reset completes on the deployed site.

Owner: set the repository variables; add the exact Pages URL and a localhost pattern to the Supabase Auth redirect list; log in on your phone.

Portability: tenants, stores, currency and strings come from data; a fork on another domain changes one base-path variable.

Status: built and verified on the local stack. The app has hash routing with the PKCE flow, login and the password-reset request (the e-mail reaches the local mail catcher), the store selector with "Tất cả", vi and en with a key-parity test, the report card, the freshness and verified badges, the version check and `deploy-web.yml`. "Hôm nay" equals the POS daily totals for each store and for both together, read through RLS as the owner; without a session every table returns zero rows. The install manifest and icons, the print stylesheet and tables that scroll inside their card at 360 px are in. Unit tests, 20 Playwright specs and axe at 360 and 1280 px pass, and the initial bundle is about 215 kB gzipped. Lighthouse mobile on the demo build scores 93 for performance and 100 for accessibility and best practices; SEO is 60 only because the app sends `noindex` on purpose. A build without the Supabase variables is a demo with generated numbers and no network calls; Pages serves it until the cloud project exists. Waiting for the cloud project: login on a phone, the password reset on the deployed site and Lighthouse on the live app.

### Phase 7 — Sync engine: incremental on Supabase, nightly and backfill on Actions, reconciliation, voids (A)

Goal: an idempotent, connector-agnostic sync that keeps canonical tables fresh without depending on GitHub's cron, marks every business day verified or not, and loads the complete history (ADR-020). Deep dives: `supabase-platform.md`, `github-pages-and-actions.md`.

Deliverables: one sync engine built on supabase-js and runtime-agnostic connectors, with two runners: an Edge Function `sync-incremental` scheduled by `pg_cron` every 30 minutes during each store's opening hours (one invocation per store; last 3 business days; change detection first by comparing daily totals and pulling detail only for changed days; a CPU/time guard that hands a window larger than its budget to the nightly job), and a Node runner on GitHub Actions for the nightly job (last 14 days, catalogue, adjustments, analytics refresh, checks, scheduled at an off-peak minute with the cron `timezone` field), backfills (workflow_dispatch by month) and the owner's CLI; atomic per-sale replacement; soft-void and edit detection into `invoice_events`; C05/C08 adjustments; `sync_checks` per store-day (count exact, money within 1,000 ₫ or 0.05 %, payments equal invoice totals) with ok | warn | fail; advisory lock per store; `sync_runs` with timings, counts and call budget; `fnb status`; `Notifier` interface with console implementation; dead-man's-switch alert when the last successful run is older than 90 minutes during opening hours; job summaries free of identifiers; keep-alive for the 60-day Actions rule; customer phone, membership and voucher fields captured on invoices; receipt key `store + business date + tran_no` (receipt numbers reset daily at one shop and yearly at the other); full backfill of both stores; verified badge wired.

Acceptance: ≥ 99 % of store-days ok with every exception explained privately (ADR-014) · monthly totals match Fabi report A01 for every month (private sheet) · an invoice removed from the re-pulled window ends as voided and leaves totals · two consecutive runs change nothing · an incremental invocation per store finishes within the Edge Function budget; one backfilled month in under 5 minutes within the call budget · the freshness badge shows a sync younger than 35 minutes during opening hours for three consecutive days · database size after full backfill under 300 MB.

Owner: start the phone-capture habit at the till (ask every customer for a phone number with the Fabi "Thêm khách hàng" flow — the first step of Track C, needs no software); allow the C05/C08 capture session; run the backfill workflows.

Portability: the engine speaks only `PosConnector`; reconciliation uses each connector's control totals; the scheduler is a per-deployment choice (Supabase, Actions or a small server) without touching the engine.

Status: the Node runner is done and verified locally. `packages/sync` replaces each store-day atomically, records voids, edits and removed lines in `invoice_events`, writes one `sync_checks` row per store-day, takes a per-store advisory lock and logs `sync_runs` with timings and the call budget. `sync.yml` runs nightly and on dispatch, with identifiers masked in its output. A month backfills in under a minute with four connector calls per account, and a second run over the same window changes nothing. The full history of both stores is loaded locally: every store-day from each store's first sales day matches the POS control totals. Right after the full backfill the database measured 277 MiB, under the 300 MB acceptance, because sale payloads are stored as one compressed document per store-day (ADR-027).

The Edge Function runner is built and verified locally. `supabase/functions/sync-incremental` runs the same engine through `@fnb/runner`, which both runners share. One invocation per store compares the last 3 business days with the POS control totals and pulls only changed or unchecked days, so a second invocation pulls nothing in about half a second. A CPU and wall-time guard sized to the Free plan's limits closes a run as `partial` and leaves the rest to the nightly job. `pg_cron` calls the function every 30 minutes through `pg_net` for the stores open in their own timezone, and the schedule stays inert until the owner enables it. Each scheduled call carries a single-use ticket instead of an API key (ADR-028). The console `Notifier` reports run and auth failures and the dead-man's switch, an account the POS rejects is marked `auth_failed`, and `deploy-functions.yml` deploys the function once the secrets exist.

Waiting for the cloud project: the deploy, TLS and reachability of the injected database URL, CPU accounting when requests share a worker, and the freshness criterion over three days. The monthly check against Fabi A01 stays an owner check. The verification runs left about 50,000 dead rows in the fact tables and the local database at 338 MiB; after `vacuum (full, analyze)` on the fact tables it measured 285 MiB, under the acceptance. On the cloud project autovacuum reuses that space, so the incremental runs do not grow the database beyond the new sales.

### Phase 8 — Analytics aggregates and metric registry (A)

Goal: tenant-scoped aggregate tables and one typed registry of about forty metrics that reports, exports, the data pack, digests, loyalty KPIs and KPI follow-up all read from (ADR-010, ADR-026). Deep dive: `fnb-kpi-standards.md`; definitions in `docs/metrics.md`.

Deliverables: calendar dimension (ISO weeks, holidays, Tết); job-refreshed aggregate tables with RLS — daily sales, hour × weekday, item sales and velocity, category mix, size mix, modifier preferences, attach rates via `item_type_roles`, basket pairs, payment mix, discounts and promotion days, shift cash, adjustments, N-store comparison, data quality, sync health, member-attached share per shift — plus `period_compare` and `refresh_analytics(tenant)`; plain views over the last 45 days for freshness; `packages/metrics` registry (id, vi/en label, unit, formula text, grain, direction, source, reports) with `metric_value(store, key, from, to)` covering net revenue, invoices, average ticket decomposed into items per ticket × average item price, attach rate per drink, sales and invoices per opening hour, RevPASH (shown only when `seat_count` is set), peak and dead-hour shares, discount rate (gross or net fixed in the registry), voucher share, cash share and cash variance (absolute, relative and z-score thresholds), void, edit and removed-line rates per shift and cashier with z-scores, customer capture rate, repeat rate, 30/90-day frequency, monthly cohort retention, RFM quintiles, lifetime value, loyalty liability and breakage, reward cost rate, member frequency uplift; same-weekday 8-week **median** baseline excluding holidays and Tết; seasonal-naïve (m = 7) and weekday-profile benchmark forecasts; benchmark "context" entries with year and source kept separate from tenant metrics; pgTAP and Vitest tests on the mock dataset.

Acceptance: tests green; refresh under 2 minutes on production; report-sized queries under 1.5 seconds · aggregates reproduce the reference-window figures in the private sheet · every metric has vi and en labels, unit, formula, grain and report mapping (lint) · the two-tenant RLS matrix passes on aggregate tables · forecast error is tracked for both benchmark forecasts.

Portability: every metric defined once and keyed by tenant and store; locale-specific pieces are rows and registry entries.

Status: the SQL layer is complete and verified. It has the calendar, ten aggregate tables with RLS, a refresh serialised per tenant, the live path for yesterday and today, and the query functions: baseline, period summary and comparison, both benchmark forecasts with tracked error, month pace, heatmap, item velocity, menu matrix and cash variance. 603 pgTAP tests pass, and report-sized queries take well under a second on a synthetic tenant of 54,000 invoices. Every definition is in `docs/metrics.md`. `packages/metrics` holds the typed registry, a test keeps it equal to `docs/metrics.md`, and the web labels follow it. `metric_value(store_ids, metric_id, from_date, to_date)` returns any available metric for any period; on the real data its revenue and invoice counts equal the POS control totals. Customer metrics wait for Track C, and refresh timing on production waits for the cloud project.

### Phase 9 — Periodic reports: Ngày, Tuần, Tháng, Năm (A)

Goal: the four periodic reports in the card pattern with comparisons and plain-language explanations, for one store or all.

Deliverables: Ngày (vs previous day and the median same-weekday baseline, hourly curve vs usual, top 5 items without modifiers, payment split with cash to count, shifts with drawer variance, discounts and vouchers, member-attached share), Tuần (7-day totals vs last week and 4-week average, weekday curve, risers and fallers, category mix, promotions run, best and worst day), Tháng (month-to-date with the two benchmark forecasts as pace, daily trend, Pareto with the 80 % line, size mix, attach rate, new items, payment mix, discount cost, shift statistics, target progress), Năm (month × year matrix, growth, seasonality with the Tết marker, ticket trend, item lifecycle, year-over-year, since-opening curve for young stores); every card attributes ticket change to items per ticket versus average item price; sentence generator with driver attribution in i18n templates; deep links; print layout; CSV on every table; a Playwright spec per report on the demo tenant.

Acceptance: three random days and one month equal Fabi A01 and B01 (owner check) · Năm shows the correct peak month and year-over-year change (private sheet) · young stores show a graceful "chưa có dữ liệu năm trước" state · no horizontal scroll at 360 px.

Owner: review the Vietnamese sentences.

Portability: comparisons derive from each store's opening date; sentences are i18n resources.

Status: built and verified locally. Report numbers come only from security-invoker SQL functions through RPC (ADR-029); the demo runs a TypeScript port of the same functions, held to the SQL by a parity suite in PGlite on every test run and in PostgreSQL in CI. Ngày, Tuần, Tháng and Năm each render as cards with comparisons, the decomposition of ticket change into items per ticket and average item price, like-for-like labels when stores are missing, sentences from i18n templates, deep links (`#/bao-cao/ngay?date=…`, `?week=YYYY-Www`, `?month=`, `?year=`, `&store=`), print layout and CSV with a UTF-8 BOM on every table. The verification found three random days and one month of the real data equal to the POS control totals per store, the young store's "chưa có dữ liệu năm trước" state, no sideways scroll at 360 px before and after printing, axe clean at 360 and 1280 px, and 63 Playwright tests passing. Owner checks still open: the three days and the month against Fabi A01 and B01, the Năm peak month and year-over-year change against the private sheet, and the wording review of `docs/reports/cau-van-bao-cao.md`. The year comparison uses the same elapsed days, which drops one day after a leap year; that first matters in March 2028.

### Phase 10 — Thematic reports, settings, manual data and compliance checks (A)

10a (3 d): Doanh thu & xu hướng; Giờ & ngày trong tuần (heatmap, dead-hour and peak call-outs, sales and invoices per opening hour, RevPASH where seats are entered, suggested shift windows); Thực đơn (Kasavana–Smith menu engineering per item-type role and store over 28 days with tenant-configurable thresholds and a "provisional — no cost" badge until costs exist, movers, size mix, attach rates, items sold together, sugar and ice preferences, margin where costs exist); Thanh toán & tiền mặt (payment mix by kind, cash share trend, expected vs counted cash per shift with the three-threshold variance rule, fee estimate); item-type role mapping UI; range presets; CSV export with UTF-8 BOM.

10b (3 d): Khuyến mãi & giảm giá (discount and voucher cost, voucher share, promotion lift as difference-in-differences against three selectable comparators — same-weekday baseline, sister store, prior non-promo weeks — always showing gross lift, discount cost and net lift; promotion catalogue with last-used dates; rule checks: 50 % discount cap, 120 discount-days per item per year counter, lucky-draw-needs-registration warning); Ca & két tiền (per-shift sales and orders, drawer variance, edits after close, voids and removed items ranked by z-score); So sánh cửa hàng (N stores, same-day comparison, since-opening alignment); Chất lượng dữ liệu (uncategorised items, items without cost, unverified days, modifier share, unmapped payment methods, customer capture rate, consent coverage, e-invoice status, member toggles off, receipt-number reset period, with "fix in POS" hints); Settings (store profile, hours, day start, seat count, legal form, item costs with CSV import, monthly targets, payment fee % per method, payment-kind mapping, category mapping, item-type roles, holidays, default language, legal texts); audit columns; margin and target progress wired in; RLS write tests from the browser.

Acceptance: heatmap and payment mix reproduce the reference window (private sheet) · modifier lines never appear as items · entering a cost for five items shows their margin only; a target shows pace on Tháng · a viewer cannot save settings · re-mapping an uncategorised item moves it immediately · the data-quality page flags a store without e-invoicing · every CSV opens in Excel with correct Vietnamese characters.

Owner: enter costs for the top items of one store, one monthly target, seat counts and opening hours.

Portability: charts bind to canonical kinds and tenant role mappings; all shop-specific business knowledge is data edited in the app.

### Phase 11 — Exports, AI data pack and strategy plans (A)

11a (2.5 d) Exports and data pack: browser export of invoices, lines, payments, shifts and daily summary for any store and range as CSV (UTF-8 BOM) or JSON, read through stable-ordered pagination under the 1,000-row API default, split by month, with export egress reported; `packages/datapack` `buildDataPack({stores, horizon, focus, language})` over the metric registry (store profile, weekly and monthly totals, heatmap, items with trends, category and size mix, attach rates, basket pairs, modifier preferences, payment and discount mix, shift statistics, cross-store comparison, data gaps, manual costs and targets, registry ids and formulas, benchmark context entries kept separate, focus), JSON schema and token estimate (15–30k), prompt templates with fixed sections, the cite-a-number rule and KPI front matter keyed by metric ids; buttons "Tải gói dữ liệu cho AI" and "Sao chép gói + prompt"; `fnb datapack` CLI; "Dán kế hoạch" paste box.

11b (2.5 d) Strategy: a versioned strategy prompt shipped inside the data pack, run by a `/strategy` command in the owner's own assistant (any assistant-specific wrapper lives in the owner's personal configuration, outside this repository); `fnb publish-plan` validating sections and KPI ids and signing in as the `publisher` member (ADR-013); Kế hoạch tab (list, markdown detail, KPI table with baseline, target, current value and status, comparison of two plans); guide for a monthly scheduled run; prompt-tuning log from three runs on real data.

Acceptance: a month's export equals the invoices table and opens in Excel with correct diacritics · browser and CLI packs are byte-identical apart from the timestamp; the pack validates, stays within budget and contains aggregates only · `/strategy` runs end to end; every initiative cites a number present in the pack (lint); the plan appears in Kế hoạch; KPI follow-up shows live values · a plan missing a section or using an unknown KPI id is rejected.

Owner: create the local `.env` for the publisher login; run `/strategy` twice; decide on the monthly routine.

Portability: the pack schema is versioned and POS-agnostic; the strategy command reads everything from the database.

### Phase 12 — Alerts, digests and channel policies (A)

Goal: push yesterday's numbers and anomalies to the owner's phone and alert on failures through configurable, lawful channels; the same abstraction later carries Zalo. Deep dives: `vietnam-legal-requirements.md`, `zalo-oa-and-messaging.md`.

Deliverables: `notification_channels` (telegram | email | zalo_bot | zalo_oa | zalo_gmf | webhook), `alert_rules` with seeded defaults, `outbound_messages` log (recipient, channel, template, consent reference, timestamp; kept at least one year) and per-channel policy objects (allowed hours, maximum per day, label, opt-out text, consent purpose) with anti-spam defaults for SMS and email (07:00–22:00, 3 per day, advertising label, opt-out) and Zalo defaults (consultation via API only within 7 days of interaction, broadcasts manual-only, template windows); channel interface with an HTTPS email provider (Edge Functions cannot send SMTP) and the free Zalo Bot API as the default digest channels — the Bot needs no OA package or review and is created in this phase — with Telegram optional because its availability in Vietnam was interrupted in 2025; `fnb digest` as the last step of the final incremental window of the day; rules engine (revenue below 75 % of the median baseline, ticket down > 10 %, drawer variance over threshold, unverified day, zero sales during opening hours, sync or auth failure, stale sync) with cool-down; failure alerts from the Actions jobs; Settings → Cảnh báo with a test button; Bản tin panel.

Acceptance: the digest arrives three nights running with numbers equal to Ngày · a synthetic low-revenue day triggers the anomaly line and disabling the rule suppresses it · a forced credential failure produces one alert and marks the account `auth_failed` · a message outside a channel's allowed hours is held until the window opens.

Owner: create the Zalo Bot (free) and an email-provider account and add their tokens; Telegram only if wanted.

Portability: channels, rules, policies and thresholds are tenant rows.

### Phase 13 — Zalo and platform foundation (B)

Goal: everything both Mini Apps and OA messaging need on Supabase and GitHub Actions, built with admin and developer access only so no Zalo review is needed yet. Deep dives: `zalo-mini-app-platform.md`, `zalo-oa-and-messaging.md`, `zalo-design-and-review-standards.md`, `zalo-integration-architecture.md`.

Facts used: Mini Apps are built with zmp-cli, zmp-sdk and zmp-ui (React + Vite), hosted free by Zalo, run on origin `https://h5.zdn.vn` in a Secure Context without LocalStorage or cookies (Native Storage, auth in headers), so our APIs must return CORS for that origin; Development and Testing builds open only for admins, developers and invited test users (test users bypass permission approval, so they prove nothing about it); reported limits ≤ 10 MB per version, 3 MB per file, 300 Development and 60 Testing builds per month (community-sourced, medium confidence); Open API for the OA needs the Tăng trưởng package; webhooks need HTTPS and a 200 within 2 seconds, retry only on connection failure and are disabled after sustained failure; OA access tokens last 25 hours and refresh tokens are single-use; `app-config.json` is static per build, so one build per brand; names must carry an owner-identifying prefix or suffix and may not be generic nouns or contain "App", "Mini App" or "Zalo"; logos may not contain a QR code or phone number; no outbound links except embedded Privacy and Terms; the Zalo Bot API is free on the Basic plan; OA-to-group messages are free only until 31 December 2026.

Deliverables: per-brand config tables (`brands`, `zalo_apps`, `oas`, `mini_apps`, `zbs_templates`, `gmf_groups`) and Vault secrets; Edge Functions `zalo-session` (Mini App access token → Zalo graph with the app-secret proof → Supabase session with role and store claims), `zalo-phone` (phone-number token decoded within its 2-minute life), `oa-webhook` (`verify_jwt` off, Zalo signature check, event log, 200 within 2 s, follow-up via `waitUntil`), `bot-webhook`, `notify` (outbox dispatcher with quota and policy checks); OA OAuth v4 PKCE authorisation and a refresh job every 12 hours with a single-row lock and alerts on token errors; a second job rotating the zmp developer refresh token used by CI deploys (one-month life, rotates on each use) with an alert on failure; CORS for `https://h5.zdn.vn`; API domain declared; zmp-cli scaffolds for the staff and customer Mini Apps on zmp-ui and ZaUI tokens with `app-config.json` generated per tenant in CI (title, header titles vi/en, header colours light and dark), no ECharts in Mini Apps, CI budgets (bundle, per-file size, LCP < 2.5 s and page load < 1.5 s in the Zalo simulator), browsable flags (staff app hidden, customer app listed); Zalo secrets set through the CLI; functions deployed from CI; the Zalo Bot from phase 12 wired to Zalo-specific alert rules; `zalo_oa` and `zalo_gmf` channel implementations with the policy objects from phase 12.

Acceptance: a Development build of each Mini App opens on the owner's phone and obtains a Supabase session with correct role claims · an OA test message reaches `oa-webhook`, is signature-verified and logged; verification runs in observe mode on the first live events and is then set to fail closed · the OA token refreshes automatically twice without manual action and the zmp token rotation job succeeds once · the API domain works from a real device · a probe records whether a test user on an unpublished build can complete the phone-number consent (two Zalo pages disagree; the answer shapes phase 18a) · CI fails a build that exceeds a budget.

Owner (Track Z, started in week 1): confirm the legal form and registration behind each brand; complete eKYC on the Zalo account that will own everything; create one OA per brand and submit verification within 14 days; buy the Tăng trưởng package per OA and link a ZBS account; create one Zalo App per brand and share App ID/Secret securely; decide one shared customer Mini App or one per brand (ADR-017 default: one per brand); create the Mini Apps with policy-compliant names and logos (hard to change later) and add the developer and 5–10 test users.

Decision gate G3 (reframed, ADR-019): the premise that Zalo requires Vietnam-resident storage is unverified; the verified duty is the personal-data law's cross-border rule — a transfer dossier within 60 days of the first transfer unless the business qualifies for the household or micro-enterprise exemption (small enterprises may defer to 2030). The owner's legal form decides this before Track C goes public.

Portability: every Zalo identifier and secret is a config row or Vault secret; a new brand is a config insert plus the owner's OA and Zalo App creation; one codebase builds one Mini App per brand.

### Phase 14 — Staff Mini App core (B)

Deep dives: `staff-app-on-zalo.md`, `zalo-design-and-review-standards.md`.

14a (2.5 d) Sign-in, roles, home: staff roster table and web admin page (name, role, store scope, Zalo id, status); 6-digit pairing code issued by a manager (valid 10 minutes); onboarding screen stating why a Zalo login is needed (internal-app exception) and a "từ chối" screen with contact instructions; staff notice and consent record for staff personal data (purpose staff_ops); Zalo identity → `zalo-session` → pairing → session in Native Storage; optional phone linking as a separate step; RLS for operations tables keyed on role and store claims; home with role-scoped cards reading phase-8 aggregates and the freshness stamp; Privacy and Terms embedded as in-app popups per tenant, never as links; design-guideline acceptance (≤ 4 tabs, one primary action per screen, 44 × 44 pt targets, loading feedback at 300 ms, result modal auto-dismiss 1.5 s).

14b (3 d) Shift operations: checklist templates as configuration per store and shift phase with required-photo items (photos resized client-side, stored in per-brand buckets); `checklist_runs` with time and actor; cash count at shift close compared with the synced Fabi drawer total using the phase-8 variance thresholds; handover notes; incident and stock-out reports with photo and category; manager acknowledgement; web pages for checklist compliance, variance history and incident log feeding Ca & két tiền and Chất lượng dữ liệu.

Acceptance: a new staff member with a tester role opens the QR link, enters the pairing code and sees only their store's tasks; a manager sees revenue cards; an unpaired user sees only onboarding · RLS suite shows no cross-store or cross-role reads · one full day at one store completed through the app across three shifts · a deliberate 50,000 ₫ variance alerts the manager within one sync cycle · changing a checklist item in the dashboard appears in the app without a redeploy · no screen contains an outbound link.

Owner: staff list with Zalo phone numbers and roles; decide which revenue figures staff may see; agree checklist items and the variance threshold; switch to individual Fabi cashier logins; approve the staff notice text.

Portability: roles, stores, checklists, thresholds and shift phases are configuration.

### Phase 15 — Notices, alerts, approvals; first review with permission requests; internal publish (B)

Goal: push the right information to the right people on Zalo at near-zero message cost, let managers act from the app, and publish the staff Mini App for internal use.

Deliverables: announcements with read receipts, pinned notices; alert engine on `alert_rules` evaluated after each sync and nightly (sync failure, drawer variance, abnormal voids, voucher spike, unfinished checklist, daily digest); channels Zalo Bot 1:1 (free), OA group (included in the package; messages free until 31 December 2026, budgeted after), OA consultation messages inside the 48-hour window with buttons that open the Mini App (never the web dashboard), a daily "Nhận bản tin" action that resets the window (two Zalo pages disagree on whether merely following the OA opens it, so the shift-start interaction — a menu tap or the check-in deep link — is designed as the opener and tested), email fallback; outbox with per-channel quota and fallback order (never a paid message when a free channel works); manager approval queue; monitors for OA activity (180 days) and Mini App visits (≥ 10 per month) in `alert_rules`; first Testing submission with the reviewer note citing the internal-audience exception, Privacy and Terms embedded, and the phone-number, camera and QR-scan permission requests filed with reason text and screenshots (approval reported to take up to ~2 weeks); published and distributed by QR and home-screen shortcut, hidden from search.

Acceptance: every staff member receives a test announcement and ≥ 80 % tap "Đã đọc" within a day · the digest arrives in the group and the owner's Bot chat three nights running · routing falls back from OA message to Bot when the window is closed without a paid message · a staff member who only followed the OA is tested for receiving a free message and the result recorded · review passed and the approved-permission list confirmed in the console (not inferred from test users) · the app opens only by deep link/QR.

Owner: all staff follow the brand OA, join the group and send one message to the Bot; approve the OA-based verification within 24 hours.

Portability: alert rules and channel preferences are rows per store; the engine is generic.

### Phase 16 — Loyalty rail (C)

Deep dives: `ipos-ecosystem-and-crm.md`, `ipos-loyalty-integration-design.md`, `loyalty-programme-design.md`, `vietnam-legal-requirements.md`.

Facts used: iPOS CRM is already initialised for both brands at no charge; the coffee shop has only the default tier and three percentage voucher codes created by iPOS staff, with member toggles switched off; the tea shop's tiers (1 point per 10,000 ₫, four spend tiers from 2023) belong to the franchise brand's CRM company and may be shared with other franchisees — so our ledger must stay independent of CRM tiers (ADR-016, ADR-024); the cashier attaches a member in Fabi with "Thêm khách hàng" by phone (a new number creates a member; the check-in-code variant is documented only for the older membership flow and must be re-tested on Fabi); CRM e-voucher codes typed at the POS flip to "Đã sử dụng" immediately — items cannot change while a voucher is applied and removing it burns a single-use code, so a code can read "used" with no final invoice, which is why redemptions are always reconciled against synced invoices; CRM e-voucher programmes carry a `callback_url` so our server can validate codes against the bill lines (iPOS documents the payload); one-time voucher code lists can be exported at 100 ₫ per code (≤ 1,000 per export); the custom receipt template can print `{tran_no}`, `{customer_phone}` and `{customer_point}`; receipt numbers reset daily at the coffee shop and yearly at the tea shop; e-invoicing is not configured at the coffee shop (no tax code) and disabled at the tea shop, while point redemptions must appear on cash-register e-invoices as discounts or 0-price promotional lines.

16a (1.5 d) Phone-capture measurement and decision inputs: cashier script and one-page SOP for "Thêm khách hàng"; receipt template updated to print `{tran_no}` prominently and, if the HTML template renders an image with `{tran_no}` in its URL, a per-bill claim QR; KPI card "tỷ lệ hoá đơn có hội viên theo ca"; written checks: whether the posapi sale payload carries phone or membership after a test member is attached, whether the tea brand's CRM company and tiers are shared with other franchisees, current CRM rates (the published policy dates from 2020 and its free tier expired at the end of 2024), the coffee shop's member toggles, e-invoice status of both stores; loyalty configuration tables, a `loyalty_programmes` record (name, period, reward budget — drives the 100 M₫ notification check) and the programme terms draft (recommended mechanic: "tích 8 tặng 1" stamps for bills ≥ 50,000 ₫, 2 welcome stamps, 1 point per 10,000 ₫, 6-month stamp validity, 12-month points expiry — configurable).

Decision gate G2 (end of the capture week): if the shared-tier question is resolved, the rates are acceptable and the phone field appears in posapi, CRM is the POS-side rail; otherwise the fallback rail (staff-verified check-in, receipt-code claims, Fabi payment-discount entries). Ledger and Mini Apps are identical either way.

16b (2 d) Rail setup — with CRM: member toggles on, check-in by digit string and multi-voucher settings, a single-use export pool per reward, a multi-use programme pointing at our `voucher-callback` Edge Function (prototyped against the documented payload before any contract; secret path, idempotency on the transaction id, amount sanity checks, optional IP allow-list) and tested with a code typed at the POS; code pool imported into `coupon_codes`. Without CRM: Fabi "Chiết khấu thanh toán" entries per reward and promotion names mapped in `coupon_rails`. In both cases every reward maps to a Fabi discount or 0-price promotional line so the e-invoice shows it; connector documentation of the exact field names observed for phone, membership, voucher code and discount.

Acceptance: ≥ 20 invoices per store carry a phone after one week; the KPI card shows the share per shift · a definitive yes/no on phone and membership fields in posapi rows, documented privately · the shared-tier and rate questions answered and the rail decision recorded · a test member attached at the POS appears on the synced invoice within 30 minutes (CRM) or a test discount entry appears by name (fallback) · a coupon typed at the POS reaches the callback and returns the configured discount; a second use is refused · a 100-code pool round-trips · both stores' e-invoice status is known and the coffee shop's registration is underway.

Owner: brief cashiers and ask every customer for a phone for one week; ask iPOS (vendor hotline) about the franchise CRM company, current CRM rates and callback egress IPs; turn on the coffee shop's member toggles and set the receipt template; register the coffee shop for e-invoicing and confirm the tea shop's status; approve the mechanic and the programme budget; create CRM programmes with the developer; decide whether to connect the OA to iPOS CRM (default: no — avoid double messaging costs).

Portability: `coupon_rails` rows select the rail per store; a non-iPOS shop implements a different rail without touching the ledger or Mini Apps.

### Phase 17 — Loyalty ledger, reconciliation, compliance tooling and staff loyalty tools (C)

17a (3 d) Ledger and reconciliation: tables `memberships`, `loyalty_ledger` (append-only: earn, confirm, clawback, redeem, adjust, expire, with ₫ value at issue), `stamps`, `pending_checkins`, `receipt_claims`, `coupons`, `coupon_codes`, `redemptions`; SQL functions for earn/confirm/clawback/expire; reconciliation job after each sync trying four paths in precision order — A phone on the invoice, B dynamic check-in code matched to a synced invoice at the same store within −2/+15 minutes (closest amount, ambiguous cases to the manager queue), C receipt claim by `store + business date + tran_no + amount` within 72 hours, D voucher recipient — recording which path matched; fast-lane sync (Edge Function → at most one run per 5 minutes per store, 60-minute window); anti-fraud rules from configuration (one earn per invoice, minimum bill, daily cap of 3 earning invoices per phone, staff phone blacklist, delivery-source exclusion, negative balance on clawback); clawback on voided or edited invoices; nightly liability and breakage (points liability = outstanding × value × (1 − expected breakage), default 20 % until six months of expiry data; deferred revenue released in proportion to redemptions); hold-out or matched-cohort incrementality measurement; consent and data-subject tooling in the dashboard (per-purpose consent view, opt-out, look up, correct, export and delete a customer with cascading deletion across memberships, points, coupons and consent evidence, with the 2-working-day and 20-day deadlines tracked); 72-hour breach runbook; dashboard pages for members, ledger lookup, reconciliation queue and shift-level loyalty anomalies.

17b (2.5 d) Staff loyalty tools (staff app v2): "Ghi nhận khách" (type phone or scan the customer's dynamic code with the approved QR-scan permission, or the camera API with a JavaScript decoder if not granted), redemption verification (enter or scan the code → shows the Fabi discount or CRM voucher code to apply → marks pending until the synced invoice confirms), member lookup with today's visits, manager queue for ambiguous matches, disputes and adjustments with reason; new Testing version submitted for review.

Acceptance: replaying 30 days of invoices with 50 synthetic phones yields a ledger equal to a hand calculation and re-running is idempotent · a voided invoice reverses its earn in the nightly job · a receipt claimed twice, or by a second phone, is rejected; the ambiguity queue lists a manufactured double-candidate case · a deletion request removes a synthetic customer and every dependent row and is logged against its deadline · a staff check-in recorded during a live sale is matched and confirmed within 10 minutes in at least 9 of 10 trials · a reused redemption code is rejected with a clear message.

Owner: approve thresholds and the matching window; provide staff phone numbers for the blacklist; confirm the programme budget and period.

Portability: all rules are configuration per programme; the engine depends only on the canonical invoice tables.

### Phase 18 — Customer Mini App and coupons (C)

18a (3 d) Customer Mini App MVP: browse-first home (programme, store info, menu highlights **without prices** — "Xem tại quầy" — because showing prices and taking orders would require the Checkout SDK) usable without any permission; "Tham gia thành viên" and "Nhận điểm từ hoá đơn" are the only actions that trigger the phone-number consent, preceded by a purpose screen; refusal keeps browsing usable; in-app Privacy and Terms popup per tenant titled "Chính sách bảo mật Mini App <Tên>" naming the legal entity; consent log on join with a separate, never pre-ticked marketing toggle and "Dừng nhận tin" in settings; wallet (stamps ring, points, tier, expiry, history with pending/confirmed states); dynamic member code/QR (60-second refresh, 2-minute validity, store-aware); receipt-claim form (bill number and amount); store deep links with route parameters and QR standees per store; follow-OA step after joining; Native Storage session; performance gates (LCP < 2.5 s, page load < 1.5 s on a mid-range Android inside Zalo), bundle and per-file budgets; listing assets per tenant (owner-identifying name 3–50 characters, description 20–500 characters in the F&B category, logo on a solid background without QR or phone); Testing builds via CI; test users invited.

18b (2.5 d) Coupons and redemption: coupon catalogue configuration (reward, cost in stamps or points, minimum bill, validity, store scope, exclusions) with a dashboard editor that enforces the 50 % cap on price-reducing coupons and the 120 discount-days per item per year counter, and that forbids cash-like rewards (no payouts, no wallets); voucher wallet (redeem → hold → single-use code with countdown → "Đã dùng" on confirmation; unused holds released after 24 hours); rail integration per `coupon_rails`; redemption reconciliation and mismatch alerts; redemption analytics in Khuyến mãi & giảm giá.

Acceptance: five test users join and earn through all live paths and see confirmed stamps within 10 minutes (if the phase 13 probe shows test users cannot complete the phone consent on an unpublished build, the first Testing version is submitted for review first, or pilot users enrol through the OA request-user-info form) · refusing the phone permission leaves the app usable · LCP and load gates pass in the simulator; no LocalStorage use · end to end: a test customer redeems, the cashier applies it, the synced invoice shows the voucher or 0-price line and the wallet shows "Đã dùng" within 10 minutes · a used code shown again is refused (callback rail) or flagged (fallback) · an unused hold is released after 24 hours with stamps restored · no screen contains an outbound link or a price.

Owner: brand assets and Vietnamese copy; invite 5–10 test users; approve the first reward catalogue; train cashiers on entering voucher codes on Fabi's total screen.

Portability: brand theme, copy and programme parameters come from config at runtime; one codebase builds one Mini App per brand.

### Phase 19 — Customer messaging, legal filings, KYB, review, publish and pilot (C)

Facts used: consultation messages are free within 48 hours of the customer's last interaction and can be sent through the API only within 7 days of it; broadcasts are sent from the OA manager only (no API), between 06:00 and 19:59, at most one per day and four free per follower per month on the package; ZBS template messages need a funded ZBS account, approved Vietnamese templates with diacritics and no links or phone numbers in the body, a logo in light and dark versions, and reach only users who have transacted; whether promotional content (birthday, win-back) is accepted in templates is disputed between sources and must be confirmed with the template reviewers; three price sources disagree (200/300 ₫ ex-VAT on the price page, 300/400 ₫ in the 2026 notice, 140–411 ₫ through iPOS CRM), so budgets use the highest; Mini App KYB precedes the first review (~3 working days via a verified OA), each version review takes about 3 working days.

19a (2.5 d) Messaging: OA chat menu and welcome message with buttons (join, points, vouchers, open the Mini App); request-user-info form → webhook → customer record as the no-app enrolment route; ZBS templates drafted and submitted (points confirmation and coupon issued as transaction or care templates with name, points and bill-number parameters and a CTA button to the Mini App; voucher template; expiry reminder; birthday and win-back only if accepted as after-sales templates, otherwise manual broadcasts to consenting followers within the caps); outbox rules (in-app first; consultation only inside the window after a quota check; **marketing consent checked before any promotional send**; per-user caps enforced locally; report-rate monitoring); messaging cost report with the reconciled price table.

19b (2 d) Legal filings, KYB, publish, pilot: Sở Công Thương notification (form via the National Public Service Portal, at least 3 working days before launch) unless the programme's total gift value is kept under 100 M₫ — decision recorded with the programme record; cross-border transfer dossier and impact assessment filed with the Ministry of Public Security within 60 days of the first customer record, or the documented exemption election for a household or micro business; data-protection officer appointed only if required; Mini App KYB via the verified OA (or documents), phone-permission approval confirmed in the console, Testing version submitted with full description and policy-compliant listing assets; store materials (QR standees with store parameters, receipt QR or bill number, cashier cheat-sheet, consent wording at the till that never pre-ticks, staff announcement); pilot dashboard (member-attached share, members joined, stamps issued, redemptions, repeat rate, message cost) and weekly review note; runbook for paperwork renewals (OA package, ZBS balance, OA token, group fees after 2026), review cadence and dispute handling.

Acceptance: all templates approved; a voucher issued in the Mini App arrives as a template message within 2 minutes · a customer without marketing consent receives no promotional message; a customer who messaged the OA receives a free confirmation and no paid message for the same event · projected monthly message cost stays under the agreed budget at pilot volume · legal filings or exemption decisions are documented before publication · the customer Mini App is published and reachable from the store and the QR; phone permission granted · two-week pilot: ≥ 25 % of invoices member-attached at each store, ≥ 150 members, no unresolved dispute older than 48 hours · the owner runs the weekly review alone.

Owner: fund the ZBS account and authorise the Zalo App for the OA; approve template wording; decide the programme budget versus the 100 M₫ threshold and file or record accordingly; decide the dossier or exemption; approve the OA-based verification within 24 hours; print and place QR standees; brief all shifts. Decision gate G4: move Supabase to Pro before public launch (or when the database passes ~400 MB, a second owner is onboarded or daily backups become mandatory).

Portability: template ids and tags are per-brand config; outbox rules and legal texts are generic with tenant parameters; publishing repeats per brand with templated materials.

### Phase 20 — Portability proof, hardening, launch and handover (D)

20a (2.5 d) Portability proof: `fnb onboard` interactive wizard (connector picker including mock and CSV, credentials, discovery, store settings, manager invite, exact secret snippets) and an `onboard.yml` wrapper for GitHub-UI-only deployers; `packages/connector-csv` passing the conformance suite; `fnb doctor` (secrets present, migrations applied, each account authenticates, each store synced and verified, Pages reachable, sign-ups disabled, SMTP configured, database size, disk, egress and pause risk with the Pro upgrade trigger, scheduled-workflow state, OA package and token status, OA activity and Mini App visit counts, e-invoice status); `fnb seed-demo`; Settings → Cửa hàng & kết nối; `docs/deploy-your-own.md` (fork → Supabase → secrets and variables → migrate → onboard → backfill → Pages → Zalo apps per brand; Free-tier limits, pause rule, Actions and Pages terms caveat: one deployment per owner, not a hosted service for strangers), `docs/add-a-store.md`, `docs/zalo-setup.md`, `docs/connectors.md` updated.

20b (2.5 d) Hardening, launch, handover: full Playwright suite on the demo tenant against a staging Supabase project (the second and last free project), including Mini Apps in browser mode with a mocked Zalo SDK; RLS audit against the live project; resilience (stale-data banner, Supabase pause recovery, token expiry and password-change paths, schema-drift alert, OA package expiry alert); budgets (bundle, Lighthouse, axe); restore drill from the phase-5 backups; rotation to the new key scheme and legacy keys disabled; 7-day parallel verification against Fabi reports A01, B07 and C02 per store; `docs/runbook.md`, `docs/handover.md`, CHANGELOG, v1.0.0.

Acceptance: a second GitHub account follows the guide on a fresh Supabase project and reaches a working dashboard with demo data in under 60 minutes without editing any file · a third store onboarded through the CSV connector needs zero source changes and appears in every report · E2E green for five consecutive nightly runs with zero flakes; RLS audit green; restore drill reproduces counts · seven consecutive days of green sync and digests; the owner performs "add a store", "rotate a secret", "re-run a month" and "run /strategy" from the runbook alone.

Owner: deploy-your-own dry run; attend the walkthrough; tag v1.0.0.

## 5. Owner actions and paperwork (Track Z), with lead times

| When | Action | Lead time | Needed by |
|---|---|---|---|
| Now | Change the tea shop's six-digit POS password | minutes | phase 3 |
| Week 1 | Create the public GitHub repository, enable Actions and Pages | minutes | phase 1 |
| Week 1 | Confirm each brand's legal form (hộ kinh doanh, micro or small enterprise), annual revenue band and registered name — this decides the personal-data exemptions, the e-invoice duty (household businesses above 1 bn₫ revenue must issue cash-register e-invoices), how many OAs and the KYB route | days | phases 13, 16, 19 |
| Week 1–2 | Complete eKYC on the Zalo account that will own the OA, Zalo App and Mini Apps | 1–2 days | phase 13 |
| Week 2 | Decide and report (or not) the iPOS endpoint security findings to iPOS; never reuse those values (ADR-025) | 1 day | — |
| Week 2 | Decide one OA per brand (ADR-017 default) or one per legal entity — if both brands sit under one household-business registration, one OA per brand may not be possible (unverified; confirm with Zalo's verification team); create the OA(s); submit verification within 14 days (registration, legal representative's ID; brand proof if the OA name differs) | 2–3 working days | phase 13 |
| Week 2 | Buy the Tăng trưởng package per OA (2,500,000 ₫/year incl. VAT); link a ZBS account (tax code must match; minimum top-up 50,000 ₫) | 1 day | phases 13, 19 |
| Week 2 | Create one Zalo App per brand, activate it, store App ID/Secret as secrets, authorise the OA | 1 day | phase 13 |
| Week 2 | Decide one shared customer Mini App or one per brand; choose policy-compliant names (owner-identifying, no generic nouns, no "App"/"Zalo") and logos (no QR, no phone, solid background); create the Mini Apps; add the developer and 5–10 test users | 1 day | phases 13–14 |
| Week 3 | Create the Supabase project (Singapore), disable sign-ups, configure custom SMTP, create the manager user, add the secrets and variables, choose a private backup destination, run the backfill workflows | 1 hour | phase 5 |
| Week 3 | Ask iPOS (vendor hotline): is the tea brand's CRM company shared with other franchisees, current CRM rates, callback egress IPs, partner API terms | days to weeks | phase 16 |
| Week 3–4 | Register the coffee shop for e-invoicing in Fabi (no tax code configured today) and confirm the tea shop's e-invoice status | 1–2 weeks | phase 16 |
| Week 4 | Set the Pages variables and the auth redirect URLs; choose routing (hash + PKCE default); log in on your phone | minutes | phase 6 |
| Week 4 | Switch to individual Fabi cashier logins per shift; start the phone-capture habit at the till | 1 week of habit | phases 7, 16 |
| Week 5–6 | Review report wording; enter item costs, a monthly target, seat counts and opening hours | 1 hour | phases 9, 10 |
| Week 6 | Publish the Vietnamese privacy notice and information-protection rules (purpose, scope, retention, measures, third parties including Supabase, GitHub and Zalo, foreign hosting, rights, contact) as tenant documents — before any staff data is processed | 1 week | phase 14 |
| Week 7 | Create the local `.env` for the publisher login; run `/strategy` twice; decide on the monthly routine; create a Telegram bot or email-provider account | 1 hour | phases 11, 12 |
| Week 7–8 | Staff list with Zalo phones and roles; staff follow the OA, join the group, message the Bot; approve the OA-based verification; permission requests filed at the first submission | ~2 weeks for approvals | phases 14, 15 |
| Week 8 | In the Fabi CMS: turn on the coffee shop's member toggles, set the receipt template to print the bill number (and points), test a per-bill QR; approve loyalty mechanic, thresholds, reward catalogue and programme budget; sign or decline iPOS CRM; create CRM programmes with the developer | 1 day | phases 16–18 |
| Week 9 | Legal read: cross-border dossier or exemption election, programme notification versus the 100 M₫ threshold, marketing-consent wording at the till and on standees | 1–2 weeks | gate G3, phase 19 |
| Week 10–11 | Fund the ZBS account; approve template wording; approve the customer Mini App verification; print QR standees; brief all shifts | 1 week incl. reviews | phase 19 |
| Week 11 | Move Supabase to Pro before public launch | minutes | gate G4 |
| Week 14–15 | Deploy-your-own dry run; walkthrough; tag v1.0.0 | 2 hours | phase 20 |

## 6. Decision gates

| Gate | When | Question | Default |
|---|---|---|---|
| G1 | before phase 5 | Supabase project, SMTP and GitHub secrets in place? | owner creates them (1 hour) |
| G2 | end of phase 16a | Are the tea brand's CRM tiers shared with other franchisees, are the rates acceptable, and does posapi expose the phone once a member is attached? | yes → CRM rail; no → fallback rail; ledger and apps unchanged |
| G3 | before phase 19b | Cross-border transfer: file the dossier with the Ministry of Public Security, or record the household/micro-enterprise exemption? | decided by the legal form confirmed in week 1; keep Zalo-derived data minimal either way |
| G4 | before phase 19b | Supabase Pro before public traffic, or earlier if the database passes ~400 MB, a second owner joins or daily backups become mandatory? | yes |
| G5 | phase 11b | Monthly scheduled assistant run for plans? | start by hand; add once the prompt is tuned |
| G6 | phase 7 | Scheduler for incremental sync: Supabase pg_cron + Edge Function (default) or GitHub Actions? | Supabase; Actions keeps nightly, backfill, backups and deploys (ADR-020) |

## 7. Sequence and parallelism

```
Week   1    2    3    4    5    6    7    8    9    10   11   12   13   14   15
A      1 2  3 4  5    6 7  8    9    10a  10b  11a  11b  12
B                          13   14a  14b  15
C                                    16a  16b  17a  17b  18a  18b  19a  19b
D                                                                  20a  20b
Z      ■■■■■■■■■■■■■■■■■■■■■■■■ (legal form, Zalo accounts and approvals, iPOS questions, e-invoice, privacy notice, legal read)
```

Phases 1–8 are sequential. From week 5 two streams run side by side: the report stream (9 → 10 → 11, with 12 after 8) and the Zalo stream (13 → 14 → 15, as soon as Track Z paperwork is done), followed by the loyalty stream (16 → 17 → 18 → 19). Phase 20 closes everything. If the owner prefers unattended data before any screen, phases 6 and 7 swap with no other change.

## 8. Portability, concretely

| To add… | You do | Code changes |
|---|---|---|
| A third store under the same iPOS account | `fnb onboard` discovers it; pick it; backfill | none |
| Another iPOS account (another brand) | add one entry to `POS_ACCOUNTS_JSON`; `fnb onboard` | none |
| Another brand's Zalo apps and loyalty programme | create its OA, Zalo App and Mini Apps; enter ids and secrets in settings; set rules and rewards; CI builds its Mini Apps | none |
| A shop whose POS has no API | fill the CSV template; `fnb onboard --connector csv` | none |
| Another POS system | implement `PosConnector` in a new package; pass the conformance suite | one new package |
| Your own copy of everything (another owner) | fork, create a Supabase project, set secrets, enable Pages, run onboard — each owner runs their own deployment (GitHub's terms do not allow hosting a commercial service for strangers on Pages) | none |
| A different loyalty rail (no iPOS CRM) | set `coupon_rails` for the store | none |
| A different scheduler or host | switch the runner (Supabase, Actions, small server) or the static host (Cloudflare Pages) by configuration | none |

## 9. Running costs (verified prices, 2026)

| Item | Cost |
|---|---|
| Supabase | Free during build and pilot (500 MB database, 5 GB egress, 500,000 function invocations, no backups, pause after ~7 idle days); Pro ≈ US$25 ≈ 650,000 ₫/month before public launch (daily backups, no pause, higher limits) |
| GitHub (public repo, Actions, Pages) | 0 ₫ |
| AI assistant | covered by the owner's existing subscription |
| Telegram bot / email provider free tier | 0 ₫ |
| Zalo OA Tăng trưởng package | 2,500,000 ₫/year incl. VAT per OA ≈ 208,000 ₫/month per brand (Open API, one staff group, 500 out-of-window consultation messages per month, 4 free broadcasts per follower per month) |
| OA consultation messages | free within 48 hours of interaction; 55 ₫ each beyond the allowance |
| OA staff group messages | free until 31 December 2026; group fee tiers afterwards (from 25,000 ₫/month) — budget line |
| ZBS template messages | official notice effective 16 March 2026: 300 ₫ per message for most templates (points, receipts, care, payment request), 400 ₫ for OTP and voucher templates, ex-VAT, plus category-based button fees (a button opening our own Mini App is free); the public price page still shows the older 200/300 ₫ table and the old 165 ₫ "transaction message" was discontinued on 1 March 2026; pilot estimate 120,000–160,000 ₫/month with in-app-first rules; worst case 450,000–600,000 ₫/month |
| Zalo Bot API (staff alerts) | 0 ₫ on the Basic plan |
| Zalo Mini App hosting, review, store listing | 0 ₫ (calendar cost: 3 working days per review, up to ~2 weeks for permissions) |
| iPOS CRM | initialised at 0 ₫; one-time voucher codes 100 ₫ each; Zalo messages through CRM 55 ₫ each (not used — we send our own); optional setup by iPOS 4,000,000 ₫; voucher callback built by us (iPOS would charge 1,000,000 ₫) |
| iPOS Fabi (already paid) | 250,000 ₫/month per store |
| Optional iPOS products | HRM: 150,000 ₫/month for 10 staff, plus 80,000 ₫ per extra branch (two vendor pages disagree whether 4 staff are free or 80,000 ₫); FoodHub delivery gateway 1,500,000 ₫ per store + 500,000 ₫ per platform — not built by us |
| Legal filings | no state fees (notification, dossier); professional advice at market rates if used |
| Total, two brands | two OA packages (≈ 416,000 ₫) + template messages (120,000–160,000 ₫) ≈ 536,000–576,000 ₫/month on Supabase Free; ≈ 1,190,000–1,230,000 ₫/month with Supabase Pro; plus out-of-window consultation messages, group fees after 2026 and any CRM subscription |

## 10. Risks and how the roadmap handles them

- **Cashier adoption of phone capture** — individual logins, the per-shift KPI, a measured week before any loyalty code, the receipt-claim path that needs no cashier action, the staff app as a second capture point.
- **posapi may not expose the phone even with CRM** — verified in 16a; paths B–D work without it.
- **Franchise CRM company shared with other stores** — our ledger is independent of CRM tiers; CRM is used only for member attach and voucher codes (ADR-024).
- **Legal duties** — consent ledger, opt-out, data-subject deadlines, breach runbook, dossier or exemption, programme notification check, discount caps and e-invoice display are built in (ADR-021); the legal read in week 9 confirms the entity-specific choices.
- **E-invoicing not configured** — the coffee shop has no tax code configured and the tea shop's e-invoicing is disabled; the owner registers in weeks 3–4 and the data-quality page flags the status.
- **Zalo review rules** — no outbound links, in-app Terms, hidden prices, compliant names and logos, performance gates, permission requests at the first review (test users bypass approval), 7-day API window, manual broadcasts, activity duties (ADR-022).
- **GitHub Actions terms and cron reliability** — incremental sync runs inside Supabase; Actions carries only CI, deploys, nightly, backfills and backups with off-peak minutes, the cron timezone field, a dead-man's switch and a keep-alive for the 60-day rule; a small server is the documented fallback (ADR-020).
- **GitHub Pages behaviour** — public files only (anon key by design, RLS carries security), fixed 10-minute cache (version prompt), no CSP/HSTS (recorded), SPA routing chosen deliberately; Cloudflare Pages is the drop-in fallback.
- **Supabase free tier** — storage rule and 300 MB ceiling, egress budget (backups ≈ 1.3 GB/month, exports), 1,000-row pagination, logs kept in our tables, email through an HTTPS provider, keep-alive by the sync, Pro before public launch (G4).
- **Secrets in logs** — credential fields masked at job start; structured secret printing fails the preflight lint.
- **Zalo messaging prices and policy drift** — budget at the highest quoted price, confirm template categories with reviewers, consent before promotional sends, report-rate monitoring, channel policies configurable.
- **OA package expiry** reverts to the free tier and breaks webhooks and messaging — renewal reminders and an alert on the package error code.
- **Fraud and leakage** — blacklist, bill number + amount + store + date for claims, caps, dynamic codes, clawback on voids, shift anomaly reports, manager approval for adjustments.
- **Single-use OA refresh token** — one refresh job with a row lock; alerts on token errors.
- **Undocumented private POS API** — fixture-backed contract, zod validation, drift alerts, raw payloads kept, documented read endpoints only.
- **Vendor security observations** — the CMS review found endpoints returning credentials and another brand's data; we never call or persist them and recommend responsible disclosure to iPOS (ADR-025).

## 11. Open questions

- Does the posapi sale payload expose customer phone, membership id or check-in code once a member is attached in Fabi, and is it masked? (16a)
- Are the tea brand's CRM company and tiers shared with other franchisees, and does the owner have the right to change them? Current CRM rates? (16a)
- Does the CRM voucher callback still work in the current CRM version, can `callback_url` be set from the UI, does it carry authentication, from which IPs does the POS call it, and can Fabi's check-in digit string accept our dynamic codes? (16b)
- Can a custom receipt template render a per-bill QR with the bill number in its URL? (16a)
- Does Zalo's agreement actually require Vietnam-resident storage of Zalo-derived data (premise of the old G3), and does the owner's legal form qualify for the personal-data exemptions? (week 1, week 9)
- Which ZBS prices and template categories apply to a new OA; are "points credited" and "coupon issued" accepted as transaction or care templates when the transaction happened at the POS; may templates carry promotions, vouchers or birthday wishes? (19a)
- Can the staff Mini App remain a Testing build with test users for a long pilot, is the internal-audience classification still granted for a login-gated app, and does server-driven content count as a feature change needing re-review? (15)
- Does an informational menu with prices but no buy button trigger the Checkout SDK rule? (18a — default: hide prices)
- How does the Sở Công Thương interpret the 100 M₫ threshold for an open-ended points programme, and are welcome stamps and birthday coupons loyalty rewards (exempt from the value cap) or gifts (capped)? (19b)
- Exact articles of the 2026 e-invoice decree for cash-register invoices and discount display, and how Fabi prints 0-price promotional lines after its update. (16b)
- What resets GitHub's 60-day inactivity timer, and what is the measured cron delay for this repository? (phase 1 probe)
- Does Supabase count service-role calls as activity for pause purposes; does the pooler suffice for dumps from IPv4-only runners; does an auth-schema dump restore cleanly? (phase 5)
- Does Fabi report voids before payment separately from cancellations after payment and removed lines? (phase 3)
- Which staff may see revenue; do all staff have smartphones with Zalo; will the owner enter seat counts and staff hours; discount rate on gross or net? (14a, 10b, 8)
- Can test users complete the phone-number consent on an unpublished build, or only after the first review? Two Zalo pages disagree. (13, 18a)
- Does merely following the OA open the 48-hour free window, or only a message or menu interaction? Two Zalo pages disagree. (15)
- How long does a Mini App access token live, and how many admins, developers and test users may a Mini App have? (13)
- iPOS HRM price for four staff — free or 80,000 ₫ per month (two vendor pages disagree). (§9)

## 12. Change log

- v1.1 (2026-11-07) — absorbed the standards panel and critic: legal compliance built in (consent ledger, data-subject requests, breach runbook, dossier/exemption gate, programme notification check — correcting v1.0's statement that notification was removed; Decree 128/2024 kept it with a 100 M₫ exemption — discount caps, e-invoice display); Zalo policy as acceptance criteria (no outbound links, in-app Terms, hidden prices, naming and logo rules, performance gates, permission requests at first review, 7-day API window, manual broadcasts, activity duties, per-tenant builds, group fees after 2026); platform facts (new Supabase key scheme, custom SMTP, backups from phase 5, egress budget, pagination, masked secrets, cron timezone and off-peak minutes, dead-man's switch, 60-day keep-alive, PKCE with hash routing, version prompt, no CSP on Pages, Cloudflare Pages fallback, Actions-terms hedge with incremental sync moved to Supabase pg_cron + Edge Functions); iPOS facts from the hands-on review (CRM initialised at 0 ₫ for both brands, franchise-shared tiers, receipt numbers reset daily/yearly so claims key on store + date + bill number, member toggles, e-invoicing not configured, security observations); KPI methods (menu engineering, ticket decomposition, median baselines, difference-in-differences lift, cash thresholds, loyalty liability and breakage, cohorts, RFM, lifetime value); owner table extended; gates G3 reframed and G6 added; twelve deep-dive documents referenced. Post-review consistency pass: ZBS prices from the 2026 notice, Zalo Bot and email as default digest channels (Telegram optional), zmp token rotation, probes for the three conflicting Zalo pages, phase 16 facts softened, cost arithmetic corrected, vendor hotline number removed, deep-dive numbering note added.
- v1.0 (2026-11-07) — Track A reordered per the roadmap judges; Tracks B and C rebuilt from the fact-checked Zalo and iPOS research; 20 phases with sub-steps.
- v0.9 (2026-11-07) — first full roadmap from the architecture plan, the three panel proposals and the critique.
