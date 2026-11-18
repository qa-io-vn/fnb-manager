# Test plan

Purpose and audience: this is the master test plan of FNB Manager. It says how the programme proves that the platform does what [requirements.md](requirements.md) asks: which quality risks the tests address, which test levels exist and where they run, which data they use, the exact commands, the process from a build to a verdict, what CI checks, which tests exist today, how every requirement traces to a test or an owner check, how each phase is accepted, and how results are reported. It is written for the owner (a café and tea-shop owner who reads English; the app speaks Vietnamese), for a developer who takes the work over on another machine, for reviewers and testers who plan and run the checks, and for whoever operates the platform after go-live.

Last updated 2026-11-18

## Contents

1. [Introduction](#1-introduction)
2. [Test strategy](#2-test-strategy)
3. [Test environments](#3-test-environments)
4. [Test data](#4-test-data)
5. [Tools and commands](#5-tools-and-commands)
6. [Process](#6-process)
7. [CI pipeline](#7-ci-pipeline)
8. [Test inventory](#8-test-inventory)
9. [Traceability matrix](#9-traceability-matrix)
10. [Acceptance test procedures per phase](#10-acceptance-test-procedures-per-phase)
11. [Owner acceptance checks](#11-owner-acceptance-checks)
12. [Risks to testing and known gaps](#12-risks-to-testing-and-known-gaps)
13. [Reporting](#13-reporting)

## 1. Introduction

### 1.1 Purpose

FNB Manager must show a shop owner numbers they can trust, keep each shop's data to the people allowed to see it, and keep everything private out of a public repository. Testing here is built around those three promises. This plan:

- names the quality risks and the test levels that answer them (section 2);
- fixes where tests run and which data they may touch, because the build machine's database also holds the shops' real data (sections 3 and 4);
- gives the commands, from the whole suite down to one test (section 5);
- sets the rules for entry, exit, defects, flaky tests, commits and pushes (section 6);
- explains CI and what it does not cover (section 7);
- lists the tests that exist on 2026-11-12 (section 8);
- traces all 375 requirements to their tests and names a planned test for every gap (section 9);
- turns each phase's roadmap acceptance into a procedure (section 10) and lists the checks only the owner can do (section 11).

### 1.2 Scope

| In scope | How it is tested |
|---|---|
| Tracks A to D, phases 1 to 20, as the [roadmap](roadmap.md) defines them | Built work by the suites of section 2; designed and planned work by the planned tests of sections 9.5 and 10 |
| Everything in the repository: the packages, the `fnb` CLI, the web app, the migrations, pgTAP files, seed and Edge Functions, the workflows and the scripts | Static analysis, unit, database, parity, integration, end-to-end and live checks |
| The cloud project after go-live (Supabase, GitHub Pages, GitHub Actions) | The cloud checks of section 10 and the owner checks of section 11 |
| Track Z, the owner's paperwork | Not tested; recorded as preconditions and owner checks |

Out of scope:

- The POS vendor's systems and reports. They are the reference the owner compares with, not the subject of a test.
- The availability and prices of GitHub, Supabase, Zalo and the e-mail provider. The tests cover how the platform reacts when they fail or answer late.
- Load beyond two shops. The Free-plan budgets are tested instead (section 2.10).
- Browsers other than Chromium, and automation on real phones (risk T-08 in section 12).
- A third-party penetration test. None is planned; section 2.11 lists the internal security tests.
- Legal advice. The legal read is an owner action in Track Z.

### 1.3 References

| Document | What a tester takes from it |
|---|---|
| [requirements.md](requirements.md) | The 376 requirements with their acceptance criteria and the short test references used here |
| [roadmap.md](roadmap.md) | Each phase's deliverables, acceptance lines, owner actions and gates |
| [plan.md](plan.md) | Roles, the definition of done, the quality gates and the risk register |
| [status.md](status.md) | What is verified, with figures; where results are recorded |
| [development.md](development.md) | Setting up a machine, everyday commands, the rules on a machine that holds real data |
| [operations.md](operations.md) | Runbooks, the maintenance calendar, the measured delays of GitHub schedules |
| [architecture.md](architecture.md), [security.md](security.md) | Components, trust boundaries, the RLS matrix, open security items |
| [schema.md](schema.md) | The database and what each pgTAP file covers |
| [sync.md](sync.md), [web-app.md](web-app.md), [metrics.md](metrics.md), [reports/](reports/ngay.md) | The behaviour under test for the sync, the web app, the metrics and the reports |
| [exports.md](exports.md), [strategy.md](strategy.md) | The browser export and its proof against `export_control_totals`; the data pack format, the plan format and every lint code with its level |
| [api.md](api.md) | The database functions, the Edge Function answers and the error codes |
| [secrets.md](secrets.md), [go-live.md](go-live.md) | The secrets each command needs; the cloud steps that unlock the cloud checks |
| [decisions.md](decisions.md) | ADR-009 (synthetic fixtures, opt-in live checks), ADR-014 (realistic acceptance gates), ADR-015 (scanning), ADR-029 (report numbers from SQL with a parity-tested port) |
| [user-guide.md](user-guide.md) | What owners and managers see and do on each screen, in the app's own words: the expected behaviour behind the end-to-end specs and the owner checks |
| [glossary.md](glossary.md) | Terms such as store-day, control totals, verified day, outbox and episode |
| `docs/private/` (gitignored, never copied) | The private acceptance figures, the identifier list for the scan and the phase build specs with their verification checklists |

### 1.4 Objectives

1. **Numbers equal the POS.** Every synced store-day is reconciled with the POS's own daily totals, and Hôm nay, the reports, the digest and the data pack show the numbers of the SQL functions.
2. **Nobody reads more than they may.** RLS is proven per table, function and role, and once on the cloud project.
3. **Nothing private leaves the build machine.** The repository, the web bundle, the logs and the job summaries carry no shop name, credential, chat id or figure.
4. **The sync stays correct under change.** Voids, edits, removed lines, repeats, overlapping runs, budgets, time zones and day starts.
5. **The app works on a phone.** Vietnamese first, accessible, no sideways scroll at 360 px, within its size and speed budgets.
6. **Messages are lawful and never doubled.** Consent before sending, windows and caps, legal floors, no resend of an uncertain outcome.
7. **Every acceptance item has evidence.** A command, a test or an owner check for each roadmap acceptance line, and a test or a planned test for each requirement.
8. **Tests never harm real data.** The real tenant changes only through real syncs, as it would in production. Tests and checks only read it; fixture tenants carry everything else and are removed by the tests themselves.

### 1.5 Conventions

- **Status** uses the words of [requirements.md](requirements.md): verified locally, built, in build, designed, planned, waits for owner.
- **Coverage** uses four words, defined in section 9.1: covered, partial, planned, owner check.
- **Test references** are written `<suite>:<path>` as in [requirements.md, section 1.5](requirements.md#15-conventions): `pgtap:04_tenant_isolation` is `supabase/tests/04_tenant_isolation.sql`, `sync:unit/checks` is `packages/sync/test/unit/checks.test.ts`, `jobs:integration/local-stack` is `apps/jobs/test/integration/local-stack.test.ts`, `web:lib/format` is `apps/web/src/lib/format.test.ts`, `e2e:demo/report-day` is `apps/web/e2e/demo/report-day.spec.ts`.
- **Roles** are those of [plan.md, section 5](plan.md#5-roles-and-responsibilities): owner, designer, builder, reviewer, verifier, operator.
- **The build machine** is the one machine where the work is built and verified. Its local Supabase stack holds **the real tenant**: the shops' real sales, loaded with `fnb`. Test defaults call that tenant `live-local` (`LIVE_TENANT`). No value from it appears in this or any other tracked file.
- **Dates** are absolute. Counts carry the date and time they were taken, because step 12b is still adding tests on 2026-11-12.

State on 2026-11-12. HEAD is commit `0f8fa1d`; everything built after it is uncommitted.

| Phases | State |
|---|---|
| 1 to 4 | complete |
| 5 and 6 | complete locally; the cloud steps wait for the owner |
| 7 and 8 | complete locally; the cloud deploy, the three-day freshness check and production timings wait for the owner |
| 9 | complete and verified locally; owner checks open |
| 10 and 11 | designed at roadmap level; detailed design pending |
| 12 | step 12a verified locally; 12b in its integration and verification; 12c planned |
| 13 to 20 | planned; Tracks B and C wait for the owner's Track Z paperwork |

## 2. Test strategy

### 2.1 Quality risks

Each risk is something that could go wrong for the owner. The last column names the test levels that defend against it; sections 2.3 to 2.13 describe each level.

| ID | Risk | Consequence | Defended by |
|---|---|---|---|
| Q1 | **Wrong numbers.** A figure on Hôm nay, a report, the digest or the data pack differs from the POS: a sync defect, an aggregate that lags or drifts, a business-date error, a demo port that diverges | Decisions on false data; the owner stops trusting the app | Reconciliation of every store-day (`sync_checks`), pgTAP against the facts, parity tests, the live checks on the real tenant, owner checks against the POS reports |
| Q2 | **Data leaks between tenants or roles.** A missing policy, a broad grant, a `security definer` helper, an exposed column | Revenue and personal data exposed; a legal breach | pgTAP access files, the `anon` end-to-end check, the database advisors, the cloud RLS run |
| Q3 | **Secrets or identifiers leak** into the public repository, the web bundle, a log or a job summary | A credential to rotate; a shop identified in public | gitleaks, the public-safety scan, the bundle check, redaction and masking unit tests, numbered CI output |
| Q4 | **The sync loses, doubles or misdates sales** under voids, edits, removed lines, repeats, overlapping runs, budget cut-offs, time zones and day starts | Totals that do not match the POS | Sync unit tests on the mock connector, the conformance suite, integration tests on Postgres, idempotency checks, live connector checks |
| Q5 | **The POS API changes** without notice (it is private and undocumented) | Failed runs or silently wrong rows | zod validation with typed errors, opt-in live checks, raw payloads kept, reconciliation that catches silent drift |
| Q6 | **Stale or missing data goes unnoticed:** a schedule that does not fire, a late GitHub cron, a rejected POS login, a paused project | The owner reads yesterday's numbers as today's | pgTAP of the schedule and the dead-man's switch, runner unit tests, `fnb doctor`, the freshness badge tests, the alerts of phase 12, owner checks after go-live |
| Q7 | **The demo diverges from the live app.** The TypeScript port computes differently from SQL | A misleading demo; a hidden SQL defect | The parity suite on PGlite at every run and on Postgres in CI |
| Q8 | **The app breaks on a phone:** layout, contrast, missing translations, console errors, slow pages | An unusable or unreadable app | Playwright with axe at 360 and 1280 px, the i18n tests, the console-error watcher, the size check, Lighthouse, the throttled Năm check |
| Q9 | **Messages are unlawful, doubled or lost:** outside the allowed hours, over a cap, without consent, sent twice after a retry, with numbers that differ from Ngày | Spam, legal exposure, alert fatigue, missed alerts | pgTAP files 26 to 31, notification unit and integration tests against mock providers, the digest-equals-Ngày live check |
| Q10 | **A Free-plan limit is exceeded:** database size, Edge Function CPU and wall time, invocations, egress | Paused project, failed runs, costs | Run-guard unit tests, `fnb doctor` thresholds, size measurements, budget checks |
| Q11 | **Tests harm or depend on real data:** a reset, a write into the real tenant, figures copied into a log, dates that age on a long-lived stack | Data loss; private figures in public; false failures | The never-reset rule, fixture tenants, the tenant-filter and synthetic-environment guards, the parity guard, read-only live checks, counts before and after a verification, tests anchored on seeded dates |
| Q12 | **Documents drift from the code:** commands, names, counts | People follow wrong instructions | The metric registry consistency test, the API docs check, the import-map check, the documentation pass of each phase and the final pass |
| Q13 | **A later phase breaks a verified one** through shared code | Regressions in work the owner already accepted | Every suite on every run, CI on every push, the verifier's full rerun (section 2.13) |

### 2.2 Levels at a glance

| Level | Proves | Tools | Runs where | When | Who |
|---|---|---|---|---|---|
| Static analysis | Format, lint, types, no secret or identifier, documents in step with the code | Biome, TypeScript, Deno, gitleaks, `check-public-safe.mjs`, `check-api-docs.mjs`, `function-imports.mjs`, `supabase db advisors` | Any machine; CI | Every change; every push | Builder, verifier, CI |
| Unit | Each module's rules, with synthetic data and no network or database | Vitest 5.1 (jsdom for the web app) | Any machine; CI | Every change | Builder, verifier, CI |
| Database | Schema, RLS, grants, functions and their numbers | pgTAP through `supabase test db` | Local stack; CI's fresh stack | Every database change; every push | Builder, verifier, CI |
| Parity | The browser port equals the SQL, row by row | Vitest with PGlite, or Postgres | PGlite anywhere; Postgres in CI | Every run (PGlite); every push (Postgres) | Builder, verifier, CI |
| Integration | The CLI, the sync repository and the notification dispatcher against a real database | Vitest with `DATABASE_URL`, mock providers | Local stack | Every verification | Verifier |
| End-to-end | The web app in a browser: pages, numbers, accessibility, layout, print, CSV | Playwright 1.65 with axe | Local stack (live), Vite (demo, pages); CI | Every web change; every push | Builder, verifier, CI |
| Live checks | The reports, the digest and the connector against real data | Vitest with `LIVE=1`, read-only | Build machine only | Every verification that touches them | Verifier |
| Performance and budgets | Bundle size, page speed, query time, run and cycle budgets, database size | Build checks, Lighthouse, Playwright with CPU throttling, live timings, `fnb doctor` | Local; partly CI | Every web build; each verification | Verifier |
| Security and privacy | RLS, grants, secrets, redaction, consent, retention | pgTAP, unit tests, scans | Local; CI | Every run | Verifier, CI |
| Acceptance | Each roadmap acceptance line | The commands and tests of section 10 | Local stack; cloud after go-live | End of each step and phase | Verifier |
| Owner checks | Agreement with the POS's own reports and the private figures; actions only the owner can take | The POS, the phone, the consoles | Private | Section 11 | Owner |

```mermaid
flowchart LR
    subgraph ANY["Any machine and CI"]
        S["Static analysis"]
        U["Unit tests"]
        P["Parity on PGlite"]
    end
    subgraph STACK["A Supabase stack"]
        D["pgTAP"]
        E["End-to-end"]
        I["Integration (local only today)"]
        PP["Parity on Postgres (fresh stack only)"]
    end
    subgraph REAL["Build machine, real tenant, read-only"]
        L["Live checks"]
        A["Acceptance demonstrations"]
    end
    subgraph CLOUD["After go-live"]
        C["Cloud checks"]
        O["Owner checks"]
    end
    ANY --> STACK --> REAL --> CLOUD
```

### 2.3 Static analysis

| Check | Command | What it catches | In CI |
|---|---|---|---|
| Lint and format | `pnpm lint` (`biome check .`) | Biome 2.6.6 recommended rules, formatting, import order; Markdown is excluded | yes, `code` job |
| Types | `pnpm typecheck` | Strict TypeScript in every package, sources and tests (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`) | yes |
| Edge Function types | `deno check index.ts` in `supabase/functions/sync-incremental` | The function under Deno v2.7.3 | yes |
| Edge Function import map | `node scripts/function-imports.mjs --check` | A `deno.json` import map that no longer matches the import graph | yes |
| Public-safety scan | `node scripts/check-public-safe.mjs` | In tracked and untracked, non-ignored files: e-mail addresses (except `example.com`, `example.org`, `users.noreply.github.com`, `email.com`), non-synthetic UUIDs, JWTs, secret prefixes, 32-hex keys, `+84` phone numbers, and every entry of `docs/private/identifiers.txt` when that file exists. Exit 1 on any finding | yes, without the private list |
| Secret scan over the history | `docker run --rm -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:v8.30.1 git /repo --redact --exit-code 1` | Secret-shaped strings anywhere in the git history (rules of `.gitleaks.toml`) | yes, `secrets` job |
| API reference check | `pnpm docs:check-api` | A `public` function that `authenticated` may execute and whose signature in [api.md](api.md) differs or is missing; it reads the catalogue in a read-only transaction. On 2026-11-12: 25 functions, 25 documented | no (request R-AP01) |
| Database advisors | `pnpm exec supabase db advisors --type security` | The Supabase database linter: tables without RLS, exposed materialised views, functions without a pinned `search_path` and more | no (request R-T01) |
| Consistency tests | part of `pnpm test` | The metric registry against [metrics.md](metrics.md) and `metric_value`; the Vietnamese and English message keys; the lazy chunks of the size check | yes |
| Comment and name scan | a scan of the added lines of changed files, by builders and the verifier | Comments in code, assistant-product names | no automated check (NFR-MNT-05) |

On 2026-11-12 the advisors report no table without RLS and no materialised view. They report two informational notes that are by design (`public.pos_account_tokens` and `public.sale_payloads` have RLS and no policy, because only the jobs reach them) and one warning: `app.data_roles` has no pinned `search_path`. It names `public.tenant_role` explicitly, so the warning is low risk, but the development rule says every function sets `search_path = ''` (request R-T01).

### 2.4 Unit tests

Every package runs `vitest run` on its `test/` folder (`test/unit`, plus the gated folders of sections 2.7 and 2.9). The web app's tests sit next to the sources in `apps/web/src` and run in jsdom. Unit tests use synthetic fixtures, the mock connector or in-memory repositories; they touch no network and no database.

| Package | What its unit tests hold |
|---|---|
| `@fnb/core` | Business date and day start, wall-clock conversion across daylight saving, size suffixes, payment kinds with overrides, money rounding and tolerance, adjustment keys, the Vietnamese holiday calendar |
| `@fnb/connector-core` | The registry and capability gating, the conformance checks (including the business-date rule a wrong time zone breaks), window helpers |
| `@fnb/connector-mock` | Deterministic data for a seed, conformance, a rejected login |
| `@fnb/connector-ipos` | Login and token cache, headers, both pagination styles, retries and non-retries, schema errors, master data, the CMS reports, the daily summary, time windows, the golden normalisation cases, adjustments, conformance offline |
| `@fnb/sync` | Mapping, business dates, reconciliation tolerance, change detection, voids and edits, robustness (repeats, overlaps, NUL characters), the incremental run, the run guard, payload documents, run bookkeeping, TLS rules, redaction |
| `@fnb/runner` | Account entries, budgets, the dead-man's switch, the incremental run with a rejected login, the Notifier |
| `@fnb/metrics` | The registry; consistency with [metrics.md](metrics.md) and with the latest `metric_value` migration |
| `@fnb/design-tokens` | The token files: the same tokens in every theme, components equal to the hex form, WCAG 2.2 AA contrast of the text and focus pairs in the light, dark and print themes; the generated CSS and palette equal to a fresh build |
| `@fnb/reports` | Periods and ISO weeks, the as-of rule, coverage and like-for-like comparisons, the exact decomposition, the narrative, the RPC source (errors, truncation guard), each card of Ngày, Tuần, Tháng and Năm |
| `@fnb/demo-analytics` | The demo calendar, generated days, ingest, Postgres-exact numerics, the source; plus the parity suite (2.6) and a smoke run of each report on the demo engine |
| `@fnb/datapack` | The pack format ([strategy.md](strategy.md)): the canonical text, decimals and units, the hash, `pack_id` and the clock, the committed JSON Schema files with Ajv against zod, every invariant, each aggregates-only rule with a fixture that breaks it, the estimate and the trimming ladder; the pack's content, built on the demo engine: the request's checks, the calendar and the KPI windows, the planned calls and their concurrency, coverage per scope, the trackable KPI ids, every table's provenance, order under shuffled rows, labels and limits, the gaps, the context, the build with its fence, the golden demo pack byte for byte, two transports giving the same bytes, and the same bytes under three process time zones; the plan lint: normalisation, front matter, sections and fields, the number grammar in both languages, citations, one fixture per lint code, the same results under jsdom, `planRecord`; source scans for locale, clock, randomness and Node APIs |
| `@fnb/notify` | Channel adapters (Zalo Bot, Brevo), secret resolution, timed fetch, rendering and truncation, templates, the digest model and fingerprint, the digest-line rules, the dispatch cycle, link parsing, the outbox notifier, the tenant-filter guard and the synthetic-environment guard |
| `@fnb/jobs` | The CLI and its help, configuration and masking, numbered output in CI, `doctor`, the status window, the incremental checks, `notify` and `digest` commands |
| `@fnb/web` | The report card and its extensions, keyset paging, the demo row source, i18n completeness and key parity, CSV, formatting, the Hôm nay metrics, verification and sentences, the web registry, the card adapter, the period navigator and picker, report routes, install assets (their colours equal to the design tokens), preferences, the lazy-chunk patterns, no raw colour outside the token package; the export engine (the month plan, the keyset reader against a fake PostgREST, the fingerprints shared with pgTAP, columns, writers, the archive, the estimate, the run) and the Xuất dữ liệu page ([exports.md](exports.md)) |

### 2.5 Database tests (pgTAP)

`pnpm exec supabase test db` runs every file in `supabase/tests`. Each file opens a transaction, declares its exact plan, creates its own fixture tenants and users, and rolls back, so nothing a test writes survives. Analytics tests count only the seeded demo tenant's rows; the notification files build tenants named `notify-it-pgtap-…` with secret names ending in `_IT` and pass a tenant filter to every scanning function. Where files 15 to 17 compare with seeded rows, they count from the seed's newest invoice date, not from `current_date`.

| File | Phase | Purpose |
|---|---|---|
| `01_schema.sql` | 2 (extended in 12a) | Schemas, helper functions, enums and labels, tables and key columns |
| `02_unique_keys.sql` | 2 | Natural keys and tenant-consistent composite foreign keys |
| `03_rls_enabled.sql` | 2 (extended in 12a) | RLS on every `public` table (52), the allow-lists of write policies and grants, default privileges, nothing for `anon` |
| `04_tenant_isolation.sql` | 2 | Two-tenant isolation of reads |
| `05_write_policies.sql` | 2 | Who may write the manual-input tables |
| `06_anon_and_tokens.sql` | 2 | `anon` reads nothing; the token cache is closed to API roles |
| `07_write_scope_and_attribution.sql` | 2 | Store scope on writes; frozen `created_by` |
| `08_publisher_role.sql` | 2 | The publisher reads no sale and only inserts plans |
| `09_invoice_events_and_lines.sql` | 2 | Invoice events and parent lines |
| `10_payment_fee_rates.sql` | 2 | Payment fee rates |
| `11_item_type_roles_and_holidays.sql` | 2 | Item-type roles and holidays |
| `12_consent_and_legal.sql` | 2 (extended in 12a) | The consent ledger (append-only for every role), data-subject deadlines, the `notifications` purpose closed to the browser |
| `13_analytics_schema.sql` | 8 | Aggregate tables, their RLS and privileges, the analytics functions |
| `14_analytics_refresh.sql` | 8 | Refresh totals against the facts, idempotent re-run, timing (demo range under ten seconds), the per-tenant lock |
| `15_analytics_queries.sql` | 8 | Period summary and comparison, median baseline with holiday and Tết exclusion, forecasts and their accuracy, the store-local as-of day, month pace, heatmap |
| `16_analytics_menu_and_cash.sql` | 8 | Item velocity, the menu matrix, cash variance flags |
| `17_analytics_access.sql` | 8 | Analytics access: isolation, store scope, publisher and `anon` read nothing, refresh limits |
| `18_metric_value.sql` | 8 | `metric_value` against the facts for every available metric, null for unmeasured inputs, refusals, privileges |
| `19_sale_payloads.sql` | 7 | Payload documents: merge, moved sale, refusals, privileges |
| `20_incremental_schedule.sql` | 7 | The incremental schedule: opening hours by time zone and day start, store selection at six ticks, single-use tickets, enabling and disabling, `sync_stale` and `dispatch_failed` alerts, retention |
| `21_sync_freshness.sql` | 7 | The dead-man's switch and the watch rule |
| `22_report_functions.sql` | 9 | The 16 report functions on a two-store fixture: properties, period bounds, totals, per-store blocks, series buckets, baselines, summaries, shifts, lifecycle, coverage, targets, argument limits |
| `23_report_access.sql` | 9 | Report access: isolation, store scope, the publisher's empty results, a viewer, `anon` refused, grants |
| `24_vn_public_holidays.sql` | 9 | The 61 global holiday rows and the Tết windows |
| `25_live_half_lateral.sql` | 9 | The lateral live half of `app.daily_sales_facts` against the previous body, and its index use |
| `26_notify_schema.sql` | 12a | The phase 12 schema, the 15 rules and 27 policies, every advertising floor refused for every writer, the outbox state machine |
| `27_notify_policy.sql` | 12a | Allowed windows across time zones and daylight saving, every step of the send decision, caps, consent revoked while held, acceptance A4 |
| `28_notify_outbox.sql` | 12a | Enqueue, claim, send and finish; back-off and retries; lease recovery; expiry; housekeeping and redaction; linking and consent; tickets |
| `29_notify_alerts.sql` | 12b | Alert episodes, destinations, runner notifications, imported sync alerts, reconciliation, channel health, job events, the rule toggle of A2, the database half of A3 |
| `30_notify_digests.sql` | 12b | Close times, the settle rule, due digests, building and failing digests |
| `31_notify_access.sql` | 12a | Notification access for every role, hidden destination columns, function privileges, owner-only rule writes |

[schema.md, Tests](schema.md#tests) describes each file in full.

### 2.6 Parity tests

The browser demo computes the reports with a TypeScript port of the SQL report functions (`@fnb/demo-analytics`). Seven parity files in `packages/demo-analytics/test/parity` (aggregates, calendar, core functions, forecasts, item lifecycle, item velocity, `metric_value`) load the same generated days into a database built from the real migrations and compare every row and value of the port with the SQL (ADR-029).

- **PGlite mode, on every run.** Inside `pnpm test`, the harness creates an in-memory PGlite database, applies every migration (with the `lz4` compression clause and a few extensions stubbed for PGlite) and runs the comparison. Nothing is shared between runs.
- **Postgres mode, in CI.** `PARITY_DATABASE=postgres` with `DATABASE_URL` runs the same files against a real PostgreSQL 17: `pnpm --filter @fnb/demo-analytics test:parity:postgres`. Before writing, the harness counts the tenants whose slug starts with neither `demo-` nor `parity-` and refuses to run if there is one ("refusing to run parity against a database that holds real tenants"). It therefore refuses the build machine's stack; it runs in CI's `database` job on a fresh stack. Its datasets are tenants named `parity-…`.

### 2.7 Integration tests

Integration tests run real code against the local database. They read the shell environment only, never `.env`, so their switches go on the command line.

| Suite | Gate | Scenarios | Data |
|---|---|---|---|
| `sync:integration/postgres-repository` | `DATABASE_URL` | Edits, voids and adjustments applied transactionally and idempotently; overlapping runs serialised on one store; text with NUL characters stored | Tenants `it-repo-…` and `it-overlap-…`, deleted at the end |
| `jobs:integration/local-stack` | `DATABASE_URL`; one test also `SUPABASE_URL` and `SUPABASE_SECRET_KEY` | Onboard a mock account, reconcile a week, re-run without changes; create a login and a membership idempotently through the Auth admin API | Tenant `it-sync-…` and a mock account, deleted at the end |
| `notify:integration/dispatch` | `NOTIFY_INTEGRATION=1` and `DATABASE_URL` | Held until the window opens (A4); a crash between send and record stays `uncertain` and is never resent; a connection lost after acceptance; concurrent dispatchers never exceed a cap; linking with the member's own "ĐỒNG Ý" | Fixture tenant `notify-it-…` |
| `notify:integration/digests-and-alerts` | the same | Three nights (A1); low revenue (A2); a stale store not repeated; channel failure; stores with different close times | the same |
| `jobs:integration/notify-cli` | the same | Link a Zalo Bot chat and send a test; link a login e-mail with its code; the held decision and status without names in CI; unlink and withdraw; job failed; credential failure (A3) | the same |

The notification suites carry three guards ([section 4.3](#43-fixture-tenants)): every scanning call needs a tenant filter while a test switch is on, the CLI runs with a synthetic environment that cannot inherit `.env`, and fixture destinations use secret names ending in `_IT` that no real destination uses. A local mock of the Zalo Bot and Brevo APIs (`packages/notify/src/testing/mock-providers.ts`, standalone as `node packages/notify/scripts/mock-providers.mjs`, port 8787 by default, bound to 127.0.0.1) answers instead of the providers.

None of these suites runs in CI today (section 7.3).

### 2.8 End-to-end tests

Playwright (`@playwright/test` ^1.65.0 with `@axe-core/playwright`) drives Chromium through three projects defined in `apps/web/playwright.config.ts`.

| Project | Server | What it covers | Skips when |
|---|---|---|---|
| `live` (port 5191) | Vite against the local stack, from `apps/web/.env.local` | Sign-in and sign-out, password-reset mail in the mail catcher, an expired recovery link, the demo offered from the login page, zero rows for a client without a session, Hôm nay on the seed for all stores and per store with its verification state, the language toggle, the placeholder page `#/ke-hoach`, the four reports on the seed, Hôm nay's yesterday equal to Ngày, the settings fixture's five logins, the settings sources' writes through PostgREST, every settings write of the write table as the five fixture logins and `anon` with every settings page read-only where a login cannot write (#165), the Cửa hàng page under row-level security (#159), Phân loại's category and payment-kind tabs through the real tables with the catch-up (#160), and Xuất dữ liệu (#141): a month of a fixture tenant exported as CSV and as JSON, every file verified, the BOM and strict UTF-8, the manifest's fingerprints equal to `export_control_totals` read by the same member, personal data only when ticked, staff and viewers gated and a store-limited manager without the personal-data box | `VITE_SUPABASE_URL` or `VITE_SUPABASE_PUBLISHABLE_KEY` is empty (normally read from `apps/web/.env.local`) |
| `demo` (port 5192) | Vite with empty Supabase variables | The demo banner and numbers, every demo page with axe at 360 px, the store table inside its card, print, favicon and manifest, no login route without a backend, the nine, eight, ten and seven cards of the reports, deep links, the as-of rule, the young store's states, CSV with a BOM, no request outside the origin, English, the design catalogue with axe and its popover, focus never hidden under the top bar, the Settings pages: Cửa hàng, Ngưỡng báo cáo and Phân loại, and Xuất dữ liệu's two tabs with the demo's notice | never |
| `pages` (port 5193) | `vite build` under `/fnb-manager/`, then `vite preview` | Icons and manifest under the Pages base path, Năm within 8 seconds on a CPU four times slower in the production build, and no design catalogue in the production build | never |

Common rules:

- One worker, no retries, 60 seconds per test, 15 seconds per expectation, locale `vi-VN`, time zone Asia/Ho_Chi_Minh, a trace kept on failure. `E2E_PORT_OFFSET` moves the three ports and the build and results folders, so specs can run side by side; `--project=<name>` starts only that project's server.
- `checkPage` (`apps/web/e2e/support/checks.ts`) runs axe with the WCAG 2.0, 2.1 and 2.2 A and AA tags plus best practice and fails on any serious or critical violation, at 1280 px and at 360 px, and again in the dark colour scheme at 360 px; it fails on sideways page scroll at 360 px and checks that the last column of every wide table is reachable inside its card by scrolling it to the end, where column snapping rests it fully in view.
- `watchConsoleErrors` (`apps/web/e2e/support/reports.ts`) fails a spec on any console error or page error once the cards have settled and after printing.
- Clocks are fixed: the demo specs set the browser clock (`page.clock.setFixedTime`), and the live specs set it just after the newest seeded date (`clockAfterSeed` in `apps/web/e2e/support/local-stack.ts`), so the results do not move with the calendar.
- The live specs sign in with the seed's development login, read from `supabase/seed.sql`, and compute their expected numbers from the invoices they can read through RLS. The settings and export specs build their own fixture tenant instead (section 4.3); the export spec can also run read-only on another login's tenant (section 5.3).

### 2.9 Live data checks

Live checks read the real tenant on the build machine. They are opt-in (`LIVE=1`), run only on the build machine, never in CI, and print booleans, counts and durations only: never an amount, a name or an id.

| Suite | What it checks | How it stays read-only |
|---|---|---|
| `reports:live/live-check` | 1. Three seeded-random store-days and yesterday: report headlines equal the POS control totals in `sync_checks` (invoices exact, net within the larger of 1,000 and 0.05 %), `metric_value` and the series buckets. 2. The last complete month: the same, plus `month_pace`. 3. Day buckets add up to the month, month buckets to the year to date. 4. A young store shows the graceful state and the total compares like for like. 5. Aggregates of the last 7 days are fresh. 6. The slowest call of each report is under 1.5 s. 7. With `LIVE_ACCEPTANCE=<private file>`, Năm's peak month and year-over-year change agree with the private sheet (prints `matches: true` or `false`; otherwise "owner check pending") | Every call runs in a read-only transaction as `authenticated`, with the claims of an owner member of the tenant |
| `reports:live/theme-live-check` | Phase 10 (#86), in the same `test:live` run, one file after the other. 1. Every theme page (Doanh thu, Giờ & ngày, Thực đơn, Thanh toán, and Ca & két tiền since #155 at 28 and 92 days, with `shift_adjustments` under a 400 ms call budget and `shift_review` under 100 ms) with the page's own calls and `analytics_catch_up_status`, at its default range and at 400 days, each call timed alone: at the default range `range_totals`, `opening_productivity`, `hour_weekday_heatmap`, `menu_engineering`, `modifier_summary`, `payment_summary` and `analytics_catch_up_status` under 50 ms, `shift_review` 100 ms, `hour_profile` and `item_margins` 150 ms, `store_coverage` and `item_summary` 200 ms, `basket_pairs` 300 ms, `item_attach` 400 ms, the slowest call of a page under 600 ms; any call under 1,500 ms at both ranges. 2. A1, with `LIVE_REFERENCE_SHEET=<private sheet>`: each store column of the reference-window section matches exactly one store. Invoices, net, average ticket, an hour's net, an hour band's share (hours inclusive), the Friday-to-Sunday share, Sunday's net and the payment mix are compared with `hour_profile`, the summed heatmap, `range_totals` and `payment_summary`, as are every hour and weekday of the hourly table the section points to. The mix is compared as shares of invoices, because the sheet counts invoices per method. Shares match within 1 point; amounts and counts within half the last written digit or 0.5 %. The identities must hold: profile equals totals, heatmap equals profile, payment shares sum to 1. Unset: `owner check pending`. 3. A2, over the window and the last 365 days: the quantities of `item_summary` and `item_margins` add up to `range_totals.items_sold`; no key of `item_summary`, `item_margins`, `menu_engineering`, `item_attach` or `basket_pairs` (in 91-day chunks, their limit being 92) is a catalogue modifier, or a key sold on modifier lines, of the same POS account; with the sheet, its menu checks (top sellers, modifier share of a day). 4. `shift_review` and `cash_variance_flags` without thresholds equal the calls with the store's thresholds (the defaults while the tenant has no settings row) over 92 days. 5. `report_settings_of` answers with the defaults and false flags; `analytics_catch_up_status` has no pending day. 6. The tenant's row counts in every table with a `tenant_id` are the same after the run | Every call runs in a read-only transaction as `authenticated` with the owner's claims, serialised; the sheet is read in memory and printed as `row <n> column <k>: matches: true|false` only | Since #166: 1. each of the eight theme pages at its default and longest range, plus `promotion_days` at 28 and 400 days, each timed alone after the call queue is idle, with every function the page plans timed; budgets at the default range `data_quality_payments` 50 ms, `shift_review` 100 ms, `data_quality_items` 150 ms, `promotion_summary`, `item_discount_days` and `data_quality_summary` 300 ms, `promotion_days`, `promotion_catalogue` and `shift_adjustments` 400 ms, `promotion_lift` 500 ms, a page 600 ms and any call 1,500 ms at both ranges; 4. the data-quality functions count no catalogue modifier as an item; 7. `shift_review` and `cash_variance_flags` flag the same shifts; 8. compliance and discount days agree with `promotion_summary` per cap period; 9. the tenant's row counts are unchanged. The connection is read-only.
| `notify:live/digest-equals-ngay` | For the three latest complete business days, all stores and each store: the digest model equals a separate Ngày build field by field, the POS control totals and `metric_value` | Dry-run builds; no `digests` row is written |
| `connector-ipos:live/smoke`, `live/connector`, `live/adjustments` | Login and store discovery; daily sales of 7 days; yesterday's invoices; control totals equal emitted sales; the discount identity on voucher invoices; 30 days of adjustments without schema errors | Reads the POS with local credentials from `.env` (the only suite that loads `.env` itself); writes nothing |

`LIVE_TENANT` (default `live-local`) and `LIVE_SEED` (default 20261108) choose the tenant and the random store-days.

### 2.10 Performance and budgets

| Budget | Check | Where | Latest result |
|---|---|---|---|
| Initial JavaScript at or under 400 kB gzipped; ECharts, the demo modules, the four report pages and the live analytics source loaded lazily | `apps/web/scripts/check-size.mjs` after every `vite build`; `web:test/lazy-chunks` | every `pnpm --filter @fnb/web build` and every Pages deploy; not in CI | 284.2 kB at phase 10a's verification on 2026-11-16; about 215 kB at phase 6 ([roadmap](roadmap.md), phase 6) |
| Lighthouse mobile: performance at least 85, accessibility at least 90 | The recipe in [apps/web/README.md](../apps/web/README.md) (Lighthouse 13.5.0 through `pnpm dlx`, Playwright's Chromium) | manual, by the verifier | demo build: 95 performance, 100 accessibility, 100 best practices, 60 SEO because of the deliberate `noindex` |
| Năm settles within 8 seconds on a CPU four times slower | `e2e:pages/report-year-performance` on the production build with Chrome DevTools CPU throttling | every end-to-end run | passing at the phase 9 verification |
| Report-sized SQL calls under 1.5 seconds | `reports:live/live-check` check 6 (slowest call per report on the real tenant) | each verification of report work | passing; phase 8 measured well under a second on a synthetic tenant of 54,000 invoices |
| Theme calls within their per-function budgets (50 to 400 ms at the default range, the slowest call of a page under 600 ms, any call under 1.5 s at 400 days) | `reports:live/theme-live-check` check 1 on the real tenant, each call timed alone | each verification of theme work | passing on 2026-11-15 and again at phase 10a's verification on 2026-11-16: every default-range call within its budget and the slowest under 50 ms; every call at 400 days under 200 ms; each new function run alone with `\timing` as the owner under 50 ms |
| Analytics refresh: the demo range under 10 seconds locally; under 2 minutes on production | `pgtap:14_analytics_refresh`; a cloud measurement | every pgTAP run; after go-live | local passing; production waits for the owner |
| Incremental run within 105 s of wall time (10 s reserve) and 1.2 s of estimated CPU (Free plan: 150 s, 2 s, 256 MB) | `sync:unit/run-guard`, `runner:unit/budget` | every run; the cloud after go-live | passing locally |
| Notification cycle: 90 s, 4 digests, 30 sends on Supabase; 120 s, 50 digests, 500 sends from the CLI | `notify:unit/dispatch/cycle` | every run | passing |
| At most 400 connector calls per run | `sync:unit/run-bookkeeping` | every run | passing |
| Digest text within 1,900 units for 50 stores and 20 findings | `notify:unit/render/digest` | every run | in build (12b) |
| Database under 300 MB with the full history | `fnb doctor` after `vacuum (full, analyze)` on the fact and aggregate tables | each phase verification | 288 MB after compaction at phase 10a's verification on 2026-11-16 (308 MB with the fact tables alone); 285 MiB at the phase 7 verification |

### 2.11 Security and privacy tests

| Concern | Tests | State |
|---|---|---|
| RLS on every table, grants and default privileges | `pgtap:03_rls_enabled`, `pgtap:13_analytics_schema` | verified locally |
| Two-tenant isolation and store scope | `pgtap:04_tenant_isolation`, `07_write_scope_and_attribution`, `17_analytics_access`, `23_report_access`, `31_notify_access` | verified locally (31: 12a) |
| Nothing for a caller without a session | `pgtap:06_anon_and_tokens`, `e2e:live/auth` | verified locally |
| The publisher reads no sale, aggregate or refresh log | `pgtap:08_publisher_role`, `17_analytics_access`, `23_report_access` | verified locally |
| Who writes manual data, rules and policies | `pgtap:05_write_policies`, `10_payment_fee_rates`, `11_item_type_roles_and_holidays`, `31_notify_access`, `35_mappings_and_catch_up`, `38_settings_writes` (store and tenant profiles by column grant, payment-kind overrides, legal texts, attributed holidays) | verified locally |
| Hidden destination columns; secret names, never values | `pgtap:26_notify_schema`, `31_notify_access`, `notify:unit/channels/secrets` | verified locally |
| Consent ledger, the `notifications` purpose closed to the browser, legal floors of channel policies | `pgtap:12_consent_and_legal`, `26_notify_schema`, `27_notify_policy` | verified locally |
| Retention, purge and redaction of messages | `pgtap:28_notify_outbox` | verified locally |
| Functions in the hidden `app` schema with an empty `search_path` | `pgtap:18_metric_value`, `19_sale_payloads`, `22_report_functions` for their functions; the database advisors for all | partial (section 9.6) |
| Redaction of credentials in logs and run errors | `sync:unit/helpers`, `sync:unit/run-bookkeeping`, `runner:unit/notifier` | verified locally |
| Masking on GitHub Actions and numbered output in CI | `jobs:unit/config`, `jobs:unit/cli`, `jobs:unit/account-numbers`, `jobs:unit/digest-and-alerts` | verified locally |
| TLS to remote databases | `sync:unit/postgres-client` (the rule); the CLI does not apply the refusal yet (request R-AS06) | partial |
| No secret in the web bundle | `apps/web/scripts/check-bundle.mjs` | verified locally; not in CI |
| No secret or identifier in the repository | gitleaks, `scripts/check-public-safe.mjs` | verified locally |
| Tests cannot reach other tenants or real secrets | `notify:unit/postgres-guard`, `notify:unit/testing-helpers`, the parity guard | verified locally |

Not covered by this plan: a third-party penetration test, and HTTP security headers (GitHub Pages sends none; [security.md](security.md) records the evaluation of a `meta` Content Security Policy as an open item).

### 2.12 Acceptance tests and owner acceptance checks

Each roadmap phase ends with acceptance lines. Section 10 turns each line into a procedure: a command or test, a pass condition, who runs it and its state. ADR-014 keeps the gates realistic: what can be shown locally is shown locally with synthetic or real data, and what needs the cloud or the POS's own reports is a cloud check or an owner check. Section 11 lists the owner checks. Their results contain real figures, so they are kept privately; only pass, fail or open and the date reach [status.md](status.md).

### 2.13 Regression

- **Nothing is retired.** Every suite of every finished phase runs on every `pnpm test`, every pgTAP run and every CI run.
- **Earlier files stay green.** A new phase may edit an earlier pgTAP file only where its spec says so (for example the table count in `03_rls_enabled.sql`); every other earlier file must pass unchanged.
- **Copies are tied together.** The parity suite ties the demo to the SQL, the consistency tests tie the registry to [metrics.md](metrics.md) and `metric_value`, the key tests tie the two languages, the import-map check ties the Edge Function to its packages.
- **Real data is re-checked.** The verifier reruns the live checks of the affected areas at each verification.
- **Every fixed defect gets a test** that failed before the fix.
- **The final integration pass** reruns everything on a freshly reset stack before go-live (plan work package WP-FP).

## 3. Test environments

### 3.1 The build machine's local stack

| Aspect | Value |
|---|---|
| Database | PostgreSQL 17 (17.11 locally), container `supabase_db_FNB_Managment`, port 54322; API 54321; Studio 54323; mail catcher 54324 |
| Migrations | 28 applied on 2026-11-12 (the newest, `20261112080118_notification_alert_resolution_rules`, belongs to step 12b) |
| Tenants | the real tenant; the seeded demo tenant `demo-fnb`; fixture tenants that tests create and delete |
| Who uses it | builders for their checks; the verifier for everything, including the live checks |

Rules on this stack:

- **Never reset it.** `pnpm db:reset` and `supabase db reset` reapply the migrations and the seed and wipe the real tenant. Never run `supabase stop --no-backup`, which deletes the data volumes; `pnpm db:stop` keeps them. Apply new migrations with `pnpm exec supabase migration up`.
- **Dates age.** The seed's dates follow the day the stack was first started, so on this stack "yesterday" in the seed is days ago. Tests anchor on the seeded data (the newest seeded invoice date in pgTAP 15 to 17; `clockAfterSeed` in the live end-to-end specs). A test that compares seeded rows with `current_date` passes in CI and fails here days later; on 2026-11-12 two such pgTAP tests are being fixed.
- **Real data is read only.** Only the live checks and the acceptance demonstrations read it (section 4.4); only a real sync writes it. Before a verification that touches the database, the verifier records counts of the real tenant's rows in `sync_runs`, `outbound_messages`, `consent_records`, `alert_events`, `digests` and `notification_channels`, and compares them at the end. They may change only through a deliberate demonstration of the step, such as a sync run; never through a test. No `it-`, `notify-it-` or `parity-` tenant may remain.
- **The Postgres parity run refuses this stack** (section 2.6).
- **The machine is shared.** Run one package at a time with two workers, give each Playwright run its own `E2E_PORT_OFFSET`, and leave the full suites to the verifier. Long commands run under `caffeinate -i` so the machine does not sleep.

### 3.2 CI's fresh stack

Each CI job that needs a database starts its own Supabase stack, resets it (every migration and the seed, dated the day of the run), runs its tests and removes the stack with `supabase stop --no-backup`, which is safe there. Both jobs leave out Studio, the Edge Runtime, Realtime, Storage, logging, the pooler and the other services they do not need; the `database` job also leaves out the mail catcher, which the `e2e` job keeps for the password-reset test. The stack holds no real tenant and no secret, and no job calls the POS. The Edge Runtime is left out, so the Edge Function is type-checked in CI but never served. CI's fresh stack is the reference for any date-dependent test.

The final integration pass of [plan.md](plan.md) also runs on a freshly reset stack: CI after the owner's push, or a second machine; never the build machine's stack.

### 3.3 Throwaway databases for parity

The PGlite parity mode builds an in-memory database with every migration at each run and drops it at the end. The Postgres mode runs on CI's fresh stack, or on any stack that holds only `demo-` and `parity-` tenants.

### 3.4 The cloud project after go-live, and staging

No cloud project exists on 2026-11-12 (gate G1). After go-live:

- the cloud checks of sections 10 and 11 read the project: `fnb status`, `fnb doctor`, `fnb digest --check-ngay` (a dry run), timings, the freshness badge, Lighthouse on the live app;
- no test writes to it, except the throwaway users of the cloud RLS run and the owner's own demonstrations (a test message, a password reset);
- whether pgTAP or another suite runs against the cloud project for the RLS run is decided at go-live (FR-TEN-17).

Phase 20b adds a staging project (the second free Supabase project), seeded with mock data, for the nightly end-to-end runs and the resilience paths.

### 3.5 Browsers and devices

| Environment | Used for | State |
|---|---|---|
| Chromium through Playwright (Desktop Chrome profile) at 1280 × 800 and 360 × 800, light and dark, `vi-VN`, Asia/Ho_Chi_Minh | Every end-to-end run | in use |
| The same with four times CPU throttling | The Năm budget | in use |
| Lighthouse mobile emulation with Playwright's Chromium | Performance and accessibility scores | manual |
| The owner's phone | Sign-in, password reset and invitation on the deployed site; reading the digest | after go-live (OC-06, OC-08) |
| Safari or WebKit, Firefox, automated real devices | – | not tested (risk T-08) |
| The Zalo Mini App simulator and devices inside Zalo | Tracks B and C | planned (phases 13 to 19) |

## 4. Test data

### 4.1 The seed and its demo tenant

`supabase/seed.sql` is synthetic and is applied by every reset and on a new machine's first `pnpm db:start`:

- the tenant `demo-fnb` ("Demo F&B", VND, Asia/Ho_Chi_Minh) with a development login as owner (its password is a constant at the top of the file; documents do not repeat it);
- two stores, `TEA` and `COF`, each on its own synthetic POS account, with opening hours and seat counts; the tea store's e-invoice status is `configured` and the coffee store's `not_configured`, its member feature `enabled` and the coffee store's `disabled`; both opt out of the incremental schedule;
- seven business days of sales before the reset date (25 invoices per store per day, three shifts, a voided, an edited and a line-removed invoice), sync runs, one check per store-day with one deliberately unmatched day at the coffee store, a promotion, a monthly target per store, item costs and payment fee rates;
- the settings of phase 10: a report-settings row with the defaults, an item moved to another category, a payment method the POS calls `other` (`pm-04`) that the tea account overrides to `ewallet`, a published privacy notice (`privacy-2026-01`) and its next version as a draft (placeholder texts, not legal ones), and Vietnamese as the default language. No live end-to-end spec depends on these rows; the settings specs use the fixture tenant of #103.

The pgTAP analytics files, the live end-to-end specs and the local CLI demonstrations use it. The unmatched day, the coffee store's e-invoice status and the seeded costs and targets are ready-made cases for the planned tests of phases 10 and 11.

### 4.2 The mock connector and the browser demo

- **Mock connector** (`@fnb/connector-mock`, id `mock`). A seeded generator shaped like a Vietnamese drinks shop: the same seed gives the same data. Its account entry takes a seed, a store count (1 to 5) and `"rejectLogin": true`, which acceptance A3 uses to force a credential failure; tests can also give it a profile, for example a 05:00 day start. A `POS_ACCOUNTS_JSON` entry such as `{"key":"account-1","connector":"mock","seed":1}` runs the CLI without POS credentials.
- **Browser demo** (`@fnb/demo-analytics`). Generated in the browser from `DEMO_SEED` 20261108 for two stores: `MOCK-S1`, established (opened 2024-12-02), and `MOCK-S2`, young. It anchors to today in Asia/Ho_Chi_Minh, so the end-to-end specs fix the clock. The cheapest snack (SN-001) is dressed without an item type, on its sale lines and its catalogue entry, so the pages show an uncategorised item that Settings can re-map; nothing else in a generated day changes. The demo's settings (`DemoSettingsStore`) start from the defaults: no category or payment-kind override, cost or fee rate, no custom holiday, default thresholds, opening hours and 40 seats for `MOCK-S1` only; a household business with Vietnamese as its language; e-invoicing `configured`, receipt numbers restarting daily and the member feature `enabled` on `MOCK-S1`, and `not_configured`, `unknown` and `unknown` on `MOCK-S2`; each store's opening date; and one draft privacy notice holding only the skeleton's six headings.
- **Parity settings fixture** (`packages/demo-analytics/test/parity/settings-fixture.ts`). Seeds the demo's defaults into PGlite, the Postgres mode and the engine, and a second variant: the uncategorised item mapped to the snack type, a drink moved to another drink type, costs for five items and the toppings (tenant-wide and per store, one changing and one starting mid-range), two e-wallet fee rates (the tenant's from mid-range, a later one for the young store), a custom holiday, a payment-kind override of the first account (`PM-BANK` counted as cash), and the young store moved to a second POS account whose roles map drink and snack but not topping; a non-default `report_settings` row and seat counts come from `theme-harness.ts`. The harness also writes the demo's tenant language and legal form, each store's e-invoice, receipt-numbering and member-feature values, the mock menu's item types, items (the cheapest snack without a type, as in the demo) and promotion catalogue on the first POS account, which the demo's catalogue ports read too; the settings variant no longer inserts the item types itself. The rewritten sales also lower their shift's sales and, when paid in cash, its drawer, so the shift stays consistent with its invoices.
- **Compliance cases** (`packages/demo-analytics/test/parity/compliance-cases.ts`). For parity runs only, dataset D3 rewrites three plain sales of `MOCK-S1` three days before the as-of day, through the day cache's `rewriteDay` option, before either engine reads them: one item line made free under its own promotion id (`PARITY-GIFT`), one item line at 60 % off under the demo's item promotion, one bill at 60 % off, one bill at 100 %, one invoice whose every item line is free under `PARITY-GIFT`, and one voucher (`PARITY-VOUCHER`) covering the whole remainder, so the full-discount branches of the compliance and discount-day rules are compared too. Both PGlite (or Postgres) and the engine load the rewritten day; the demo itself never applies them, so no demo number moves.
- **A void without its sale** (`packages/demo-analytics/test/parity/orphan-cases.ts`). For parity runs only, dataset D1 drops one voided sale of `MOCK-S1` nine days before the as-of day while its void event stays, so `shift_adjustments` attributes a void whose sale never reached the sales report by its time in both engines.
- **Numbered receipts** (`packages/demo-analytics/test/parity/receipt-cases.ts`). For parity runs only, dataset D1 numbers `MOCK-S1`'s receipts from 1 each day and `MOCK-S2`'s in one running sequence, so `data_quality_summary` infers both receipt-numbering habits in both engines.
- **Unattributed events and a modifier sold as an item** (`packages/demo-analytics/test/parity/attribution-cases.ts`). For parity runs only, dataset D1 changes `MOCK-S1`'s day five days before the as-of day: one catalogue modifier is sold as an item line, one adjusted sale names a shift that has no shift row, and a void without a sale falls 90 minutes before the first shift opens. `data_quality_summary` counts the catalogue modifier line and both kinds of unattributed event, and `data_quality_items` flags the item, in both engines; every other parity file reads the same day.
- **Single-store promotions** (`packages/demo-analytics/test/parity/solo-cases.ts`). For parity runs only, dataset D1 gives one plain sale a day a 20 % line discount under a promotion only one store runs: `PARITY-SOLO` at `MOCK-S1` on ten days ending eleven days before the as-of day, and `PARITY-SOLO-YOUNG` at `MOCK-S2` on five days from its twelfth day open, when it is less than half the established store's size. The other store is then a sister control, so the lift's sister-store counterfactual and the `control_differs_in_size` flag are compared too; the demo never applies them.

### 4.3 Fixture tenants

| Slug | Created by | Removed | Used for |
|---|---|---|---|
| `it-repo-…`, `it-overlap-…` | `sync:integration/postgres-repository` | at the end of the test | The Postgres sync repository |
| `it-sync-…` | `jobs:integration/local-stack` | at the end of the test | The CLI on the local stack |
| `notify-it-…` | `createFixtureTenant` in `@fnb/notify/testing` (two stores on a mock account, 70 days synced, an owner and a store-limited manager, destinations linked on `_IT` secret names) | after the suite; any such tenant older than an hour is deleted when a suite starts | The notification integration and CLI tests |
| `notify-it-pgtap-…` | pgTAP files 26 to 31 | rolled back | Notification database tests |
| `e2e-settings-…` | `createSettingsFixture` in `apps/web/e2e/support/settings-fixture.ts` (two stores on a mock account, two item types and six items of which one has no type, a cash and an `other` payment method, 35 days of generated sales per store ending yesterday (`fixture.sales`) refreshed into the aggregates, five logins `e2e-<role>-<hex>@example.com`: owner, manager, store-limited manager, staff, viewer) | by the spec's `afterAll` teardown; a run first removes `e2e-settings-` tenants and fixture-shaped logins older than an hour that belong to no other tenant | The live settings specs of 10b (#159 to #165) and the fixture's self-check `e2e:live/settings-fixture`; `e2e:live/settings-roles` (#165) also counts, before and after its run, the rows of every table with a `tenant_id` and the logins of every tenant whose slug does not start with `it-`, `notify-it-`, `parity-` or `e2e-settings-`, and fails if any count moved; the live Phân loại spec adds one `invoice_payments` row per fixture invoice (its primary method and paid amount) and refreshes the aggregates in its own `beforeAll`, rows that belong to the fixture tenant and go with it at teardown (on delete cascade); the live export spec (#141) likewise adds, for the month it exports, a payment with a reference per invoice, a shift per store and day named with a synthetic cashier login (`cashier@example.com`) and a synthetic customer name and phone on some invoices |
| `parity-…` | the parity harness | with its database | Postgres parity datasets |
| other pgTAP fixtures | pgTAP files | rolled back | Two-tenant and role tests |

Guards that keep fixture work away from real tenants:

1. With `NOTIFY_INTEGRATION=1`, a provider base-URL override or a simulated clock (`--at`), the notification repository refuses any scanning call without a tenant filter, and the CLI sends only for a tenant whose slug starts with `notify-it-`.
2. The integration helpers run the CLI with `loadEnvFile: false` and a synthetic environment; a helper test fails when that environment holds any key outside the synthetic list.
3. Fixture destinations name `_IT` secrets (`NOTIFY_ZALO_BOT_TOKEN_IT` and the like) with synthetic values, so a claim filtered by the secrets present can only select fixture messages.
4. The settings fixture connects only to a loopback database (`E2E_DATABASE_URL`, else the local stack's URL): it checks the hosts postgres-js resolves, so a `?host=` parameter, a `#` in the URL or `PGHOST` cannot reach another machine. Its writes and teardown name its own tenant and logins; its sweep of older leftovers deletes only `e2e-settings-` tenants and logins of the exact fixture shape that belong to no other tenant. Its self-check confirms that every table with a `tenant_id` holds the same rows for every other tenant, and the same logins, after teardown.

### 4.4 The real tenant, read-only

The real tenant exists only on the build machine. Tests and demonstrations that touch it:

- read only: the live checks run in read-only transactions or as dry runs (section 2.9);
- print booleans, counts and durations; never an amount, a name, an address or an id;
- run the CLI with `CI=1` when the output is shared, so accounts and stores are numbered;
- leave its row counts unchanged (section 3.1).

The phase 9 browser pass and the phase 12 `--check-ngay` demonstration also use it, signed in as its owner; those credentials live in `docs/private/` and never in a tracked file.

### 4.5 Private acceptance figures

- `docs/private/acceptance-figures.md` (gitignored, named in the [roadmap](roadmap.md)) holds the exact figures used to accept phases: the POS reports, the reference window, Năm's peak month.
- The reports live check compares with a private JSON file passed as `LIVE_ACCEPTANCE=<path>`, with the fields `peakMonth`, `yearOverYearChange` and an optional `year`, and prints only whether they match.
- The theme live check reads the private sheet itself when `LIVE_REFERENCE_SHEET=<path>` names it (relative to the repository root, or absolute), together with the hourly file its reference section points to in the same folder. It prints one `matches: true|false` line per compared value and never a figure, a name or a label. Its parser is unit-tested on a synthetic sheet with made-up stores and figures (`packages/reports/test/unit/themes/reference-sheet/`).
- `docs/private/identifiers.txt` feeds the public-safety scan.
- Nothing from these files goes into a tracked file, a test, a fixture, a log, a job summary or a commit message.

### 4.6 Rules for synthetic data

- UUIDs whose first eight characters repeat one hex digit (`11111111-…`), which both scanners accept.
- `example.com` addresses; tokens such as `synthetic-bot-token`; chat ids such as `synthetic-chat-1`.
- Neutral account keys (`account-1`); output in CI numbers accounts and stores.
- No recorded vendor response is committed (ADR-009); every fixture is written by hand or generated.

## 5. Tools and commands

### 5.1 Toolchain

| Tool | Version | Pinned in |
|---|---|---|
| Node.js | 22 or later (`.nvmrc` 22) | `.nvmrc`, `engines` |
| pnpm | 9.15.3 | `packageManager` |
| TypeScript | ^7.0.2 | root `devDependencies` |
| Biome | ^2.6.6 | root `devDependencies` |
| Vitest | 5.1.0 | root `devDependencies`, lockfile |
| Supabase CLI | 3.0.0, run as `pnpm exec supabase` | root `devDependencies`, lockfile |
| PostgreSQL and pgTAP | 17, through `supabase test db` | `supabase/config.toml` |
| Playwright and axe | `@playwright/test` ^1.65.0, `@axe-core/playwright` ^4.14.0, Chromium | `apps/web/package.json`; `pnpm --filter @fnb/web e2e:install` |
| PGlite | 0.3.16 | `packages/demo-analytics/package.json` |
| Deno | v2.7.3 (CI) | `.github/workflows/ci.yml` |
| gitleaks | v8.30.1 (Docker image) | `.github/workflows/ci.yml` |
| Lighthouse | 13.5.0 through `pnpm dlx` | [apps/web/README.md](../apps/web/README.md) |

### 5.2 Commands per level

Run from the repository root. `<db>` stands for the local database URL, `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (the CI value too).

| Level | Everything | One package, folder or file | One test |
|---|---|---|---|
| Lint | `pnpm lint` | `pnpm exec biome check packages/core/src/rules` | – |
| Types | `pnpm typecheck` | `pnpm --filter @fnb/core typecheck` | – |
| Unit, as CI | `pnpm test` | `pnpm --filter @fnb/reports run test --maxWorkers=2` | `pnpm --filter @fnb/core exec vitest run test/unit/money.test.ts -t "rounds" --maxWorkers=2` |
| Unit, shared machine | `pnpm -r --workspace-concurrency=1 --if-present run test --maxWorkers=2` | `pnpm --filter @fnb/reports exec vitest run test/unit/reports/day --maxWorkers=2` | as above |
| Web unit | `pnpm --filter @fnb/web test` | `pnpm --filter @fnb/web exec vitest run src/lib/csv.test.ts` | add `-t "<test name>"` |
| pgTAP | `pnpm exec supabase test db` | `pnpm exec supabase test db supabase/tests/04_tenant_isolation.sql` (paths to files or folders) | – (a file is the unit) |
| Parity, PGlite | inside `pnpm --filter @fnb/demo-analytics test` | `pnpm --filter @fnb/demo-analytics exec vitest run test/parity/forecasts.parity.test.ts` | add `-t "<test name>"` |
| Parity, Postgres | `DATABASE_URL=<db> pnpm --filter @fnb/demo-analytics test:parity:postgres` (a stack without real tenants only) | – | – |
| Integration, sync and CLI | `DATABASE_URL=<db> pnpm --filter @fnb/sync test` and `DATABASE_URL=<db> pnpm --filter @fnb/jobs test` | – | `DATABASE_URL=<db> pnpm --filter @fnb/sync exec vitest run test/integration/postgres-repository.test.ts` |
| Integration, notifications | `NOTIFY_INTEGRATION=1 DATABASE_URL=<db> pnpm --filter @fnb/notify test:integration`, then `NOTIFY_INTEGRATION=1 DATABASE_URL=<db> pnpm --filter @fnb/jobs exec vitest run test/integration/notify-cli.test.ts` | – | `NOTIFY_INTEGRATION=1 DATABASE_URL=<db> pnpm --filter @fnb/notify test:integration -t "three nights"` |
| End-to-end | `pnpm --filter @fnb/web test:e2e` (63 tests; long) | `E2E_PORT_OFFSET=10 pnpm --filter @fnb/web exec playwright test --project=demo e2e/demo/report-day.spec.ts` | add `-g "<title>"`; `--list` lists without running |
| Live checks | `DATABASE_URL=<db> pnpm --filter @fnb/reports test:live`; `DATABASE_URL=<db> pnpm --filter @fnb/notify test:live`; `pnpm --filter @fnb/connector-ipos test:live` (each script sets `LIVE=1`) | add `LIVE_ACCEPTANCE=<private file>` for check 7 and `LIVE_REFERENCE_SHEET=<private sheet>` for the theme check's A1 and menu checks | add `-t "<test name>"` |
| Web build checks | `pnpm --filter @fnb/web build` | `pnpm --filter @fnb/web check:bundle`, `check:size` on an existing `dist` | – |
| Scans | `node scripts/check-public-safe.mjs`; the gitleaks command of section 2.3 | – | – |
| Documents and imports | `pnpm docs:check-api`; `node scripts/function-imports.mjs --check` | – | – |
| Database advisors | `pnpm exec supabase db advisors --type security` | `--level warn` | – |
| Lighthouse | the recipe in [apps/web/README.md](../apps/web/README.md) | – | – |
| Operational checks | `CI=1 pnpm --filter @fnb/jobs fnb -- status`; `CI=1 pnpm --filter @fnb/jobs fnb -- doctor` (logs in to each POS account once); `CI=1 pnpm --filter @fnb/jobs fnb -- notify status` | `--tenant <slug>` on `status` and `notify status` | – |

`pnpm test -- --maxWorkers=2` does not limit the workers: pnpm passes the `--` on and Vitest 5.1 ignores every argument after it. Use the `run test --maxWorkers=2` forms.

### 5.3 Gated suites and their switches

| Switch | Turns on | Notes |
|---|---|---|
| `DATABASE_URL` | `sync:integration/postgres-repository`, `jobs:integration/local-stack` | Shell only; the tests do not read `.env` |
| `SUPABASE_URL` and `SUPABASE_SECRET_KEY` | the Auth admin test of `jobs:integration/local-stack` | `SUPABASE_SERVICE_ROLE_KEY` is accepted locally when the secret key is empty |
| `NOTIFY_INTEGRATION=1` with `DATABASE_URL` | the three notification integration files | Fixture tenants and synthetic secrets only |
| `LIVE=1` with `DATABASE_URL` | the reports, theme and digest live checks | Set by the `test:live` scripts; `LIVE_TENANT`, `LIVE_SEED`, `LIVE_ACCEPTANCE`; `LIVE_REFERENCE_SHEET` names the private sheet for the theme check (unset: `owner check pending`). The reports script runs its files one after the other with the default reporter |
| `LIVE=1` with `POS_ACCOUNTS_JSON` (and `IPOS_APP_KEY`) | the iPOS live suites | Read from `.env` by the suite itself |
| `PARITY_DATABASE=postgres` with `DATABASE_URL` | the Postgres parity mode | Set by `test:parity:postgres`; refuses real tenants |
| `apps/web/.env.local` filled | the `live` Playwright project | Written from `pnpm db:status` locally, from `supabase status -o env` in CI |
| `E2E_PORT_OFFSET` | separate ports and folders per Playwright run | |
| `E2E_DATABASE_URL` | the database the live settings fixture writes its tenant to | The local stack's URL when unset; any host postgres-js would reach other than this machine is refused before connecting |
| `E2E_LOGIN_EMAIL` and `E2E_LOGIN_PASSWORD`, optionally `E2E_TENANT_SLUG` | `e2e:live/exports` on that login's tenant instead of a fixture tenant: the last complete month exported read-only and compared with `export_control_totals` read by the same login | Read by `liveLogin()` in `apps/web/e2e/support/local-stack.ts`, which falls back to the seeded login; the personal-data and role tests then skip |

A gated suite that skips is not a pass. The verdict of a step names each gated suite the step depends on and shows it ran.

## 6. Process

### 6.1 Entry and exit criteria for a step

A step is a build step of a phase's build spec ([plan.md, section 2.3](plan.md#23-verifiable-steps-of-at-most-about-three-days)).

Entry:

1. The step's section of the build spec is final and lists its files, its tests and its verification checklist.
2. The previous step of the same stream has a green verdict.
3. The local stack is up and on the latest migrations (`pnpm exec supabase migration up`; never a reset).
4. For a step that touches the database or the notification tables, the verifier has recorded the real tenant's counts (section 3.1).
5. An owner input the step needs either exists or has a synthetic stand-in, with the owner check recorded as open.

Exit, the green verdict (the definition of done in [plan.md, section 2.4](plan.md#24-definition-of-done), with the test details):

1. Every test the spec lists exists, and every line of the step's verification checklist passes.
2. Everything CI runs passes locally: lint, typecheck, unit tests (the PGlite parity suite runs inside them), the import-map check, the Deno check, pgTAP, gitleaks and the end-to-end suite. The Postgres parity suite refuses the build machine's stack (section 2.6); it runs in CI's `database` job, or on a second stack that holds only `demo-` and `parity-` tenants, as in the final pass.
3. So do the checks CI does not run: the web build with its bundle and size checks, `pnpm docs:check-api` when a function in `public` or its grants changed, the gated integration suites the step touches, the live checks of the areas it touches, and its acceptance demonstrations.
4. The real tenant's counts changed only through the step's deliberate demonstrations, and no fixture tenant remains.
5. The public-safety scan is clean, and the changed files hold no code comment and no assistant-product name.
6. No blocker or major defect is open (section 6.4).
7. [status.md](status.md) carries the step's state and figures, and the requirement statuses the step changes are updated with their evidence.

### 6.2 Entry and exit criteria for a phase

Entry:

1. The phases in the roadmap's "Depends on" column are complete, at least locally.
2. The phase has a build spec cut into verifiable steps.
3. The owner actions it needs are done or recorded as open owner checks.
4. The gates it depends on are passed: G1 before any cloud check, G2 before 16b, G3 and G4 before 19b.

Exit:

1. Every step has a green verdict.
2. Every roadmap acceptance line is shown on the local stack by the procedure of section 10, or recorded as a cloud check or owner check with its state.
3. The roadmap's status column and status line, [requirements.md](requirements.md) and the documents the phase changed are updated.
4. "Complete locally" means 1 to 3 hold. "Complete" also needs the phase's cloud checks and owner checks to pass.

### 6.3 Build, review, fix and independent verification

| Step of the loop | Who | What it does for testing |
|---|---|---|
| Build | Builders | Write the tests with the code. Before finishing: `pnpm lint`, `pnpm typecheck`, their package's tests, their pgTAP files after `migration up`, their own Playwright spec with an `E2E_PORT_OFFSET`, the public-safety scan, and a scan of added lines for comments |
| Review | A reviewer who did not build the step | Reads code and tests against the spec. Checks that every acceptance item has a test; that refusals, the other tenant, the other role and the boundary values are tested; that tests scope their data and cannot reach real tenants; that no fixture holds real data or identifiers. Each finding gives file, line, problem and a proposed fix |
| Fix | Builders | Fix every finding or record why not |
| Verify | A verifier who did not build the step | Records the real tenant's counts, reruns everything CI runs plus the gated suites, the live checks and the acceptance demonstrations, compares the counts, and gives a verdict line by line |
| Record | Verifier | Updates [status.md](status.md) and the requirement statuses |
| Commit and push | Owner | Reviews and commits the verified work, then pushes; CI on GitHub confirms |

```mermaid
flowchart LR
    B["Build with tests"] --> R["Independent review"]
    R --> F["Fixes"]
    F --> V{"Independent verification"}
    V -- "red" --> F
    V -- "green" --> S["status.md updated"]
    S --> O["Owner commits and pushes"]
    O --> C{"CI on GitHub"}
    C -- "red" --> F
    C -- "green" --> G["Cloud and owner checks after go-live"]
```

### 6.4 Defects

| Severity | Meaning | Examples | Handling |
|---|---|---|---|
| Blocker | A Must acceptance criterion fails, or risk Q1, Q2, Q3 or Q11 happens | A report, the digest or Hôm nay differs from the POS or from Ngày; a member reads another tenant's or store's rows; a secret or identifier in a tracked file, the bundle, a log or a job summary; a test changes or deletes real data; a red CI job on `main` | The verdict is red. Fixed in the same step before anything else. A leaked secret is rotated at once ([operations.md, section 4.8](operations.md#48-rotating-supabase-keys-and-provider-tokens)); what happens to the git history is the owner's decision |
| Major | A Should criterion fails, a feature is broken with a workaround, a test is flaky, a document gives a wrong command or count that people follow, or a Must requirement the step claims has no test | A card shows an error state on a valid period; a CLI help text names a missing option; an end-to-end test fails one run in ten | Fixed before the verdict, or deferred by the owner with a dated line in [status.md](status.md) and a requirement status that says so |
| Minor | Cosmetic, wording, a document inaccuracy without impact, a slow but in-budget check | A label that wraps badly at 360 px; a stale date in a document | Fixed when convenient; listed under "Known small issues" in [status.md](status.md) if it outlives the step |

Defects are recorded in the step's review findings and verdict. Open ones go to [status.md](status.md), without identifiers or figures. A defect in a file another stream owns goes to that stream as a request with file, line, problem and proposed text ([plan.md, section 2.2](plan.md#22-two-build-streams)). A failed owner check is a blocker for its phase.

### 6.5 Flaky tests

- Playwright runs with one worker and no retries, and Vitest has no retries, on purpose: a failure is a failure.
- A test that fails and then passes on a rerun without any change is a flake. A flake is a major defect: record it and find its cause in the same step.
- Do not hide a flake with retries, longer timeouts without a measured reason, or sleeps.
- Known causes here and their fixes: date drift (anchor on seeded data or fix the clock); port collisions (`E2E_PORT_OFFSET`; the servers use `--strictPort` and never reuse a running server); load on the shared machine (one package at a time, two workers, full suites when the machine is quiet); the machine sleeping (`caffeinate -i`); a fixture tenant left behind (the stale-tenant cleanup, and the check after each verification).
- A test may be skipped only with a recorded defect and a dated line in [status.md](status.md). The only test of a Must requirement is never skipped. The gated skips of section 5.3 are by design and are not flakes.
- Before v1.0 the nightly end-to-end run must be green five nights in a row with zero flakes (FR-OPS-13).

### 6.6 What blocks a commit and a push

Commits and pushes are the owner's to trigger. These block them:

| Before a commit | Before a push |
|---|---|
| Any finding of `node scripts/check-public-safe.mjs`, run on the machine that holds `docs/private/identifiers.txt` | Anything that would turn CI red: lint, typecheck, unit tests, the import-map check, the Deno check, pgTAP on a freshly reset stack, the Postgres parity suite on a stack that holds only `demo-` and `parity-` tenants (never the build machine's), the end-to-end suite |
| Any gitleaks finding | A failing web build check (bundle or size): CI does not run it, `deploy-web.yml` does |
| Anything under `docs/private/` or any `.env` file staged (`git ls-files docs/private .env` must print nothing) | A red CI run on `main` that is not understood and fixed |
| A step without a green verdict, or an open blocker | A migration not applied and tested locally: once the cloud project exists, `migrate.yml` pushes it on `main` |
| Code comments or assistant-product names in the changed files | |

After a push, CI on GitHub must be green. A red job is a blocker.

## 7. CI pipeline

### 7.1 `ci.yml`

CI runs on every push to `main` and every pull request. Runs of the same ref share a concurrency group, and a newer run cancels an older one.

| Job | Steps | Fails when | What a failure means |
|---|---|---|---|
| `secrets` (Secret and identifier scan) | Checkout of the full history; gitleaks v8.30.1 over the history with `.gitleaks.toml`; Node from `.nvmrc`; `node scripts/check-public-safe.mjs` | A secret-shaped string anywhere in the history; an e-mail address, non-synthetic UUID, JWT, key prefix, 32-hex key or `+84` number in the tree | A blocker. If the string is real, rotate it first. CI has no identifier list, so the local scan with `docs/private/identifiers.txt` stays the commit gate |
| `code` (Lint, typecheck, unit tests) | `pnpm install --frozen-lockfile`; `pnpm lint`; `pnpm typecheck`; `pnpm test`; `node scripts/function-imports.mjs --check`; `deno check index.ts` of `sync-incremental` with Deno v2.7.3 | A lockfile out of date, a lint or type error, a failing unit, consistency or PGlite parity test, a stale import map, a Deno type error | A code defect, or a document out of step (for example the metric registry against [metrics.md](metrics.md)). The gated suites skip here: the job has no `DATABASE_URL` |
| `database` (Migrations and pgTAP tests) | The Supabase stack without Studio, the mail catcher, the Edge Runtime and the other services it does not need; `supabase db reset`; `supabase test db`; the Postgres parity suite with `DATABASE_URL`; `supabase stop --no-backup` | A migration that fails on an empty database, a pgTAP test, a parity mismatch | A schema or SQL defect, a migration that relied on local state, or a port that diverged from the SQL |
| `e2e` (Web end-to-end tests, 30-minute limit) | Playwright's Chromium; the stack with the mail catcher; `supabase db reset`; `apps/web/.env.local` written from `supabase status -o env`; `pnpm --filter @fnb/web test:e2e`; stop | A spec fails: numbers, axe, layout, a console error, sign-in, the mail catcher, the time limit | A user-visible regression, or a test that relied on the build machine's dates or data |

### 7.2 Other workflows

| Workflow | Trigger | What it runs | A failure means |
|---|---|---|---|
| `sync.yml` (Sync) | 03:23 Asia/Ho_Chi_Minh; dispatch with account number, dates, kind and dry run | Skips with a note without `SUPABASE_DB_URL` and `POS_ACCOUNTS_JSON`; masks credentials; the nightly window (14 business dates ending yesterday) or the dispatched one; then, even after a failure, `fnb digest --due`, `fnb notify tick` and `fnb status` | A failed or partial sync: [operations.md, section 4.1](operations.md#41-a-failed-or-partial-sync-run) |
| `notify.yml` (Notify) | 06:07, 07:07 and 08:07 Asia/Ho_Chi_Minh; dispatch | `fnb notify tick --skip-if-scheduler-healthy --budget-seconds 300`; skips without `SUPABASE_DB_URL` | Messages not sent: [operations.md, section 3.6](operations.md#36-alerts-and-the-daily-digest-phase-12) |
| `deploy-web.yml` | Push to `main` touching `apps/web`, `packages` or the workflow; dispatch | `pnpm --filter @fnb/web build` (with the bundle and size checks) under the Pages base path, then the Pages deploy; the demo while the repository variables are empty | The site was not updated: [operations.md, section 4.11](operations.md#411-a-failed-pages-or-function-deploy) |
| `deploy-functions.yml` | Push to `main` touching the function or what it imports; dispatch | The import-map check, then `supabase functions deploy sync-incremental`; skips without its secrets | The function was not updated: the same runbook |
| `migrate.yml` | Push to `main` touching migrations or `supabase/config.toml`; pull requests from this repository touching migrations; dispatch | `supabase db push --dry-run` on pull requests, `supabase db push` on `main`; skips without `SUPABASE_PROJECT_ID` | The cloud schema is behind or a migration failed on it |
| `backup.yml` | Monday 02:23 in Vietnam (Sunday 19:23 UTC); dispatch | `supabase db dump` of schema, data, roles and auth, encrypted with `age`, copied to the private bucket; skips until configured | No fresh off-site backup this week |
| `cron-probe-peak.yml`, `cron-probe-offpeak.yml` | Minutes 0 and 30, and 7 and 37, of every hour (UTC) | Record when each scheduled run started | Nothing for users; read with the GitHub API ([operations.md, section 2.3](operations.md#23-how-late-github-starts-scheduled-runs)) |
| `workflows-active.yml` | Monday 09:17 in Vietnam; dispatch | Re-enables scheduled workflows GitHub disabled for inactivity | The 60-day rule is not guarded (it failed on its first run, request R-P01) |
| `notify-on-failure.yml` | planned in step 12c (`workflow_run` of the other workflows) | `fnb notify job-failed`, with a database-free fallback | – |
| `onboard.yml` | planned in phase 20a | The onboarding wizard for deployers without a terminal | – |

### 7.3 What CI does not run

| Not in CI | Why it matters | Where it runs instead | Request or plan |
|---|---|---|---|
| The integration suites (sync, CLI, notifications) | Database-level behaviour of the CLI and the dispatcher is checked only by the verifier | The build machine | Step 12c plans the notification suites in the `database` job; R-T04 proposes the rest |
| The web build with its bundle and size checks | A secret-shaped string or an oversized bundle is caught only when `deploy-web.yml` runs on `main` | Builders, the verifier, `deploy-web.yml` | R-AS09 |
| The API reference check | A changed function can leave [api.md](api.md) wrong | Locally | R-AP01 |
| The database advisors | A function without a pinned `search_path` is not caught | Locally | R-T01 |
| The live checks | They need the real data, which exists only on the build machine | The build machine | By design |
| Lighthouse | Scores are measured by hand | Locally; the live app after go-live | – |
| The Edge Function served by the Edge Runtime | Its HTTP answers are not exercised automatically | Served locally at a verification | FR-SYNC-17 gap |
| Schema-diff and type drift checks, the column-name lint, a preflight log lint, a reset guard | Promised by the roadmap and ADR-023; not built | – | R-F03, R-Q01; owner decision D4 in [plan.md](plan.md) |

### 7.4 State on GitHub on 2026-11-12

- The last push is `0f8fa1d` (2026-11-08). For it, the `code`, `database` and `e2e` jobs passed and the `secrets` job failed in its setup step ("Unable to locate executable file: pnpm"). The working tree sets `package-manager-cache: false` on that step; the next push shows whether it holds.
- CI has never run on the work after `0f8fa1d`: the Edge Function runner of phase 7, phase 9 and phase 12.
- "Scheduled workflows active" failed on its first scheduled run on 2026-11-09 (request R-P01).
- Scheduled runs start hours late ([operations.md, section 2.3](operations.md#23-how-late-github-starts-scheduled-runs)), which matters for the digest's timing, not for test results.

## 8. Test inventory

Figures as dated in each table. Phase 10b and step 12c will add tests, so later runs will show higher counts.

### 8.1 Unit tests per package

From the run of 2026-11-16 at phase 10a's verification (#102), every package with `pnpm -r --workspace-concurrency=1 --if-present run test --maxWorkers=2`. Skipped files and tests are the gated suites of sections 2.7 and 2.9, which had no switch in that run.

| Package | Test files (passed + skipped) | Tests passed | Tests skipped |
|---|---:|---:|---:|
| `@fnb/core` | 9 | 131 | 0 |
| `@fnb/metrics` | 3 | 139 | 0 |
| `@fnb/design-tokens` | 2 | 9 | 0 |
| `@fnb/connector-core` | 3 | 26 | 0 |
| `@fnb/reports` | 59 + 2 | 508 | 14 |
| `@fnb/connector-mock` | 3 | 56 | 0 |
| `@fnb/connector-ipos` | 10 + 3 | 155 | 4 |
| `@fnb/sync` | 15 + 1 | 98 | 2 |
| `@fnb/demo-analytics` | 30 | 284 | 0 |
| `@fnb/runner` | 5 | 26 | 0 |
| `@fnb/web` | 58 | 718 | 0 |
| `@fnb/notify` | 16 + 3 | 163 | 11 |
| `@fnb/jobs` | 8 + 2 | 62 | 8 |
| **Total** | **221 + 11 = 232** | **2,375** | **39** |

`packages/runner/test/integration` exists but holds no test.

Later runs, one package at a time, on 2026-11-18 after the exports (#139 to #141) and the pack format and plan lint (#130, #135): `@fnb/datapack`, new since the run above, 338 of 338 in 20 files; `@fnb/web` 1,420 passed and 4 failed, the four also failing on the commit before the exports: two `web:i18n/wording-sheets` tests that fail only on a working copy whose documents have CRLF line ends, and two `web:pages/settings/cua-hang-page` cases that fail only just after local midnight. Then, at `8f749b7` (#165), `web:settings/access` 129 of 129, and at `4e21657` (#134), `@fnb/datapack` 437 of 437 in 39 files.

### 8.2 pgTAP files

Planned tests per file, read from each file's `select plan(…)` on 2026-11-16 after migration `settings_writes_and_legal` (#104). Files 33 to 35 are phase 10a's, files 36 to 39 phase 10b's.

| File | Plan | File | Plan |
|---|---:|---|---:|
| `01_schema.sql` | 193 | `18_metric_value.sql` | 45 |
| `02_unique_keys.sql` | 42 | `19_sale_payloads.sql` | 27 |
| `03_rls_enabled.sql` | 10 | `20_incremental_schedule.sql` | 84 |
| `04_tenant_isolation.sql` | 11 | `21_sync_freshness.sql` | 42 |
| `05_write_policies.sql` | 15 | `22_report_functions.sql` | 99 |
| `06_anon_and_tokens.sql` | 7 | `23_report_access.sql` | 28 |
| `07_write_scope_and_attribution.sql` | 16 | `24_vn_public_holidays.sql` | 9 |
| `08_publisher_role.sql` | 16 | `25_live_half_lateral.sql` | 7 |
| `09_invoice_events_and_lines.sql` | 14 | `26_notify_schema.sql` | 178 |
| `10_payment_fee_rates.sql` | 18 | `27_notify_policy.sql` | 58 |
| `11_item_type_roles_and_holidays.sql` | 21 | `28_notify_outbox.sql` | 141 |
| `12_consent_and_legal.sql` | 57 | `29_notify_alerts.sql` | 169 |
| `13_analytics_schema.sql` | 72 | `30_notify_digests.sql` | 84 |
| `14_analytics_refresh.sql` | 45 | `31_notify_access.sql` | 64 |
| `15_analytics_queries.sql` | 63 | `33_theme_functions.sql` | 74 |
| `16_analytics_menu_and_cash.sql` | 27 | `34_theme_access.sql` | 46 |
| `17_analytics_access.sql` | 39 | `35_mappings_and_catch_up.sql` | 63 |
| | | `36_promotion_functions.sql` | 57 |
| | | `37_shift_and_quality_functions.sql` | 33 |
| | | `38_settings_writes.sql` | 106 |
| | | `39_theme_access_b.sql` | 16 |
| | | `40_pack_functions.sql` | 43 |
| | | `41_export_totals.sql` | 20 |
| | | **40 files** | **2,159** |

By phase (files grouped by the phase that created them; 01, 03 and 12 were extended in 12a, 01 and 03 again in 10a and 10b): phase 2, 409; phase 7, 153; phase 8, 291; phase 9, 143; phase 10a, 183; phase 10b, 210; phase 12, 694.

Full run on 2026-11-18 on the local stack after the exports and the pack format: 2,159 of 2,159 in 40 files, `40_pack_functions.sql` and `41_export_totals.sql` included. Earlier: 2,159 of 2,159 in 40 files on 2026-11-16 after migration `fee_and_target_limits`; 2,153 of 2,153 in 40 files after migration `pack_and_export_functions`; 2,090 of 2,090 in 38 files after migration `item_costs_amount_whole_dong`; 2,085 of 2,085 in 38 files after migration `data_quality_payments_account_order`; 2,083 of 2,083 in 38 files after migration `data_quality_functions`; 2,053 of 2,053 in 37 files after migration `promotion_and_shift_functions`; 1,979 of 1,979 in 35 files after migrations `settings_writes_and_legal` and `settings_writes_hardening`. Earlier full runs: 1,849 of 1,849 at phase 10a's verification; 1,845 of 1,845 on 2026-11-14; 357 tests in 12 files at the end of phase 2; 675 of 675 in 19 files at the `0f8fa1d` verification; 934 of 934 in 25 files at the phase 7 verification.

### 8.3 Playwright specs

Listed with `playwright test --list` on 2026-11-18 after #165: 262 tests in 36 files.

| Project | File | Tests |
|---|---|---:|
| `live` | `e2e/live/auth.spec.ts` | 6 |
| `live` | `e2e/live/exports.spec.ts` | 5 |
| `live` | `e2e/live/reports.spec.ts` | 4 |
| `live` | `e2e/live/settings-fixture.spec.ts` | 9 |
| `live` | `e2e/live/settings-manual.spec.ts` | 15 |
| `live` | `e2e/live/settings.spec.ts` | 5 |
| `live` | `e2e/live/settings-phan-loai.spec.ts` | 4 |
| `live` | `e2e/live/settings-roles.spec.ts` | 28 |
| `live` | `e2e/live/themes.spec.ts` | 3 |
| `live` | `e2e/live/today.spec.ts` | 7 |
| `demo` | `e2e/demo/demo.spec.ts` | 12 |
| `demo` | `e2e/demo/datapack.spec.ts` | 2 |
| `demo` | `e2e/demo/report-day.spec.ts` | 12 |
| `demo` | `e2e/demo/report-week.spec.ts` | 8 |
| `demo` | `e2e/demo/report-month.spec.ts` | 13 |
| `demo` | `e2e/demo/report-year.spec.ts` | 8 |
| `demo` | `e2e/demo/settings-layout.spec.ts` | 4 |
| `demo` | `e2e/demo/settings-bao-cao.spec.ts` | 5 |
| `demo` | `e2e/demo/settings-phan-loai.spec.ts` | 7 |
| `demo` | `e2e/demo/settings-cua-hang.spec.ts` | 5 |
| `demo` | `e2e/demo/settings-ngay-le.spec.ts` | 4 |
| `demo` | `e2e/demo/settings-gia-von.spec.ts` | 7 |
| `demo` | `e2e/demo/settings-muc-tieu.spec.ts` | 3 |
| `demo` | `e2e/demo/settings-phi.spec.ts` | 4 |
| `demo` | `e2e/demo/settings-phap-ly.spec.ts` | 3 |
| `demo` | `e2e/demo/theme-doanh-thu.spec.ts` | 9 |
| `demo` | `e2e/demo/theme-gio-ngay.spec.ts` | 8 |
| `demo` | `e2e/demo/theme-thuc-don.spec.ts` | 8 |
| `demo` | `e2e/demo/theme-thanh-toan.spec.ts` | 8 |
| `demo` | `e2e/demo/theme-khuyen-mai.spec.ts` | 10 |
| `demo` | `e2e/demo/theme-so-sanh.spec.ts` | 8 |
| `demo` | `e2e/demo/theme-chat-luong.spec.ts` | 10 |
| `demo` | `e2e/demo/theme-ca-ket-tien.spec.ts` | 11 |
| `demo` | `e2e/demo/theme-navigation.spec.ts` | 4 |
| `pages` | `e2e/pages/install.spec.ts` | 2 |
| `pages` | `e2e/pages/report-year-performance.spec.ts` | 1 |
| | **Total** | **262** (live 86, demo 173, pages 3) |

At phase 10a's verification the list held 126 tests in 19 files and all 126 passed with one worker and no retries; the phase 9 verification had 63 and phase 6 had 20.

### 8.4 Parity, smoke, consistency, live and integration suites

| Suite | Files | Tests | Gate |
|---|---|---:|---|
| Parity | `packages/demo-analytics/test/parity/*.parity.test.ts` | 12 files | none for PGlite; `PARITY_DATABASE=postgres` and `DATABASE_URL` for Postgres |
| Report smoke on the demo engine | `packages/demo-analytics/test/reports/{day,week,month,year}.smoke.test.ts` | 4 files | none |
| Theme smoke on the demo engine | `packages/demo-analytics/test/themes/{revenue,hours,menu,payments}.smoke.test.ts` | 4 files | none |
| Registry consistency | `packages/metrics/test/consistency/document.test.ts`, `metric-value.test.ts` | 2 files | none |
| Reports live check | `packages/reports/test/live/live-check.test.ts` | 8 | `LIVE=1`, `DATABASE_URL` |
| Theme live check | `packages/reports/test/live/theme-live-check.test.ts` | 26 | `LIVE=1`, `DATABASE_URL`; `LIVE_REFERENCE_SHEET` for A1 and the menu checks |
| Digest equals Ngày | `packages/notify/test/live/digest-equals-ngay.test.ts` | 1 | `LIVE=1`, `DATABASE_URL` |
| iPOS live | `packages/connector-ipos/test/live/{smoke,connector,adjustments}.test.ts` | 4 smoke tests, plus per-account tests | `LIVE=1`, `POS_ACCOUNTS_JSON` |
| Sync on Postgres | `packages/sync/test/integration/postgres-repository.test.ts` | 2 | `DATABASE_URL` |
| CLI on the local stack | `apps/jobs/test/integration/local-stack.test.ts` | 2 | `DATABASE_URL` (one test also the secret key) |
| Notification dispatch | `packages/notify/test/integration/dispatch.test.ts` | 5 | `NOTIFY_INTEGRATION=1`, `DATABASE_URL` |
| Digests and alerts | `packages/notify/test/integration/digests-and-alerts.test.ts` | 5 | the same |
| Notification CLI | `apps/jobs/test/integration/notify-cli.test.ts` | 6 | the same |

### 8.5 Build checks and scans

| Check | File | Runs |
|---|---|---|
| Bundle check | `apps/web/scripts/check-bundle.mjs` | after every `vite build` of `pnpm --filter @fnb/web build` |
| Size check | `apps/web/scripts/check-size.mjs` with `scripts/lazy-chunks.mjs` | the same |
| Public-safety scan | `scripts/check-public-safe.mjs` | CI `secrets` job; before every commit |
| Secret scan | gitleaks with `.gitleaks.toml` | CI `secrets` job |
| Import map | `scripts/function-imports.mjs --check` | CI `code` job; `deploy-functions.yml` |
| API reference | `scripts/check-api-docs.mjs` (`pnpm docs:check-api`) | locally |

### 8.6 Latest results

| Check | Result | Date and source |
|---|---|---|
| Unit tests | 2,375 passed, 39 skipped (gated), 232 files, 13 packages; since then `@fnb/datapack` 338 of 338 in 20 files, and `@fnb/web` 1,420 passed with 4 known failures that also fail on the commit before (section 8.1); at `8f749b7` `web:settings/access` 129 of 129, and at `4e21657` `@fnb/datapack` 437 of 437 in 39 files | 2026-11-16, phase 10a's verification (#102); 2026-11-18, local runs |
| pgTAP | `38_settings_writes.sql` 106 of 106 at `8f749b7` (#165); 2,159 of 2,159 in 40 files on 2026-11-18 after the exports and the pack format; 2,159 of 2,159 in 40 files after migration `fee_and_target_limits`; 2,153 of 2,153 in 40 files after migration `pack_and_export_functions`; 2,090 of 2,090 in 38 files after migration `item_costs_amount_whole_dong`; 2,085 of 2,085 in 38 files after migration `data_quality_payments_account_order`; 2,083 of 2,083 in 38 files after migration `data_quality_functions`; 2,053 of 2,053 in 37 files after migration `promotion_and_shift_functions`; 1,979 of 1,979 in 35 files after migrations `settings_writes_and_legal` and `settings_writes_hardening`; 1,849 of 1,849 in 34 files at phase 10a's verification; `20_incremental_schedule.sql` unedited | 2026-11-16, #104 and #102 |
| Parity in Postgres | every parity file green in CI's `database` job on `b8779ab` | 2026-11-16, #102 |
| Integration suites on the local stack | sync 100 of 100; jobs 64, 6 gated; notification CLI 6 of 6; notification digests and alerts 9 of 10, the failure a defect of the test's own helper, not of the product, fixed by the step 12c stream | 2026-11-16, #102 |
| Live checks on the real tenant | reports live check 8 of 8; theme live check 6 of 6, with `LIVE_REFERENCE_SHEET` every compared value `matches: true` and no call over budget | 2026-11-16, #102 |
| Live checks on the real tenant, quiet machine | reports live check 8 of 8; theme live check 26 of 26, every identity true and every budget held (slowest call 101 ms); notify live 1 of 1; tenant row counts unchanged; one store with history from September 2026 only, A1 and reports check 7 pending without `docs/private` | 2026-11-18, #166 |
| Export acceptance on the real tenant | October 2026: browser and engine exports in CSV and JSON at 1,000- and 97-row pages, rows and fingerprints equal to the database, data files identical across page sizes; #132's budgets held | 2026-11-18, #195 |
| Playwright | live 86 of 86 at `8f749b7` (the 28 tests of `e2e/live/settings-roles.spec.ts` included), after live 58 of 58 with the five tests of `e2e/live/exports.spec.ts`, and demo 173 of 173 on the local stack; earlier 126 of 126 in 19 files (demo, live and pages), one worker, no retries | 2026-11-18, local runs; 2026-11-16, `pnpm verify` on `b8779ab` |
| Initial JavaScript | 324.7 kB gzipped against the 400 kB budget, after the exports; 284.2 kB at phase 10a's verification | 2026-11-18 and 2026-11-16, `pnpm --filter @fnb/web build` |
| Lighthouse mobile, demo build | performance 95, accessibility 100, best practices 100, SEO 60 | [status.md](status.md) |
| Public-safety scan and gitleaks | no findings | 2026-11-16, #102 |
| Comment scan over the lines 10a added | none | 2026-11-16, #102 |
| API reference check | 35 functions, 35 documented | 2026-11-16, #102 |
| Import map | up to date | 2026-11-16, CI `code` job |
| Database advisors (security) | no table without RLS, no materialised view; one warning (`app.data_roles` without a pinned `search_path`) | 2026-11-12 |
| Store-days equal to the POS control totals | all, both stores, from each store's first sales day; check 1 and 2 of the reports live check on 2026-11-16 | [status.md](status.md) |
| Database size with the full history | 288 MB after compacting the fact and aggregate tables | 2026-11-16, #102 |
| CI on GitHub | `b8779ab`: `code`, `database` (Postgres parity included), `e2e` and `secrets` green | 2026-11-16 |

## 9. Traceability matrix

### 9.1 How to read it

Every requirement of [requirements.md](requirements.md) appears once, in that document's order. "Verified by today" repeats its "Verified by" column, with the short test references of section 1.5. "Coverage" says what kind of evidence exists:

| Coverage | Meaning | Where the details are |
|---|---|---|
| covered | Tests or check commands in the repository verify the whole acceptance criterion locally. For a requirement in build (step 12b, phase 11a) the tests exist and the step's verification is still running or still to come, as its status shows | the test references |
| partial | Tests cover part of the criterion; the rest is a review, a one-off measurement, a cloud step or a screen not built yet | section 9.6: what is missing and the test that closes it |
| planned | No test exists yet | section 9.5: the planned test |
| owner check | The criterion is the owner's comparison with the POS or the private figures, or an action only the owner can take | section 9.7 and section 11 |

Coverage says whether tests exist. Whether they passed is the status column's job.

### 9.2 Coverage summary

Coverage of the 376 requirements on 2026-11-18, by area.

| Area | covered | partial | planned | owner check | Total |
|---|---:|---:|---:|---:|---:|
| FR-TEN | 14 | – | 1 | 2 | 17 |
| FR-CON | 14 | 2 | 1 | – | 17 |
| FR-SYNC | 25 | 2 | – | 1 | 28 |
| FR-DQ | 11 | – | 1 | 1 | 13 |
| FR-ANA | 15 | – | 1 | 1 | 17 |
| FR-REP | 17 | 2 | – | 2 | 21 |
| FR-THM | 6 | 3 | – | – | 9 |
| FR-SET | 7 | 4 | – | – | 11 |
| FR-EXP | 3 | 6 | 1 | – | 10 |
| FR-STR | 2 | 2 | 6 | – | 10 |
| FR-NOT | 26 | 4 | 12 | – | 42 |
| FR-OPS | 1 | 4 | 8 | 4 | 17 |
| FR-CMP | 8 | 1 | 8 | 3 | 20 |
| FR-STF | – | – | 23 | – | 23 |
| FR-LOY | – | – | 29 | – | 29 |
| FR-POR | 3 | 2 | 7 | – | 12 |
| **FR total** | **152** | **32** | **98** | **14** | **296** |
| NFR-SEC | 6 | 6 | 2 | 1 | 15 |
| NFR-PRV | 5 | 1 | 1 | – | 7 |
| NFR-PERF | 4 | 4 | 1 | – | 9 |
| NFR-AVL | 3 | – | – | 1 | 4 |
| NFR-COST | 2 | 4 | – | – | 6 |
| NFR-A11Y | 5 | – | – | – | 5 |
| NFR-I18N | 5 | 1 | – | – | 6 |
| NFR-UX | 4 | 2 | 1 | – | 7 |
| NFR-MNT | 6 | 3 | 2 | – | 11 |
| NFR-OBS | 3 | 1 | – | – | 4 |
| NFR-HYG | 4 | 1 | 1 | – | 6 |
| **NFR total** | **47** | **23** | **8** | **2** | **80** |
| **All** | **199** | **55** | **106** | **16** | **376** |

```mermaid
pie showData
    title Coverage of the requirements on 2026-11-18
    "covered" : 199
    "partial" : 55
    "planned" : 106
    "owner check" : 16
```

Of the 269 requirements that are verified locally, built, in build or waiting for the owner, 199 are covered, 53 partial, 1 planned and 16 owner checks. Of the 107 that are designed or planned, 105 have no test yet and 2 are partly held by tests of the database rules they rest on.

### 9.3 Functional requirements

#### FR-TEN — Tenancy, members, roles and access

| ID | Requirement | Priority | Status | Verified by today | Coverage |
|---|---|---|---|---|---|
| FR-TEN-01 | Tenant on every row | Must | verified locally | `pgtap:02_unique_keys` | covered |
| FR-TEN-02 | Membership roles and store scope | Must | verified locally | `pgtap:01_schema`, `pgtap:07_write_scope_and_attribution`, `e2e:live/settings-fixture` (five roles of one tenant, a store-limited manager reading one store) | covered |
| FR-TEN-03 | Two-tenant isolation | Must | verified locally | `pgtap:04_tenant_isolation`, `pgtap:17_analytics_access`, `pgtap:23_report_access`, `pgtap:31_notify_access`, `pgtap:39_theme_access_b` (another tenant's owner reads only their own store in every 10b function), `pgtap:40_pack_functions` and `pgtap:41_export_totals` (scoped to the member's visible stores; #132) | covered |
| FR-TEN-04 | Store scope on reads and writes | Must | verified locally | `pgtap:07_write_scope_and_attribution`, `pgtap:17_analytics_access`, `pgtap:21_sync_freshness`, `pgtap:38_settings_writes`, `pgtap:39_theme_access_b` (a store-limited manager in every 10b function), `e2e:live/settings-roles` (a manager limited to store 1 saves 5 of 27 settings writes through PostgREST: store 2's rows give no row or `42501`, every tenant-wide setting `42501` or no row, while the catch-up refresh of the whole tenant is allowed, as for every manager; the pages show store 1 alone; #165) | covered |
| FR-TEN-05 | Nothing for callers without a session | Must | verified locally | `pgtap:03_rls_enabled`, `pgtap:06_anon_and_tokens`, `e2e:live/auth`, `pgtap:39_theme_access_b` (anon runs no 10b function), `e2e:live/settings-roles` (all 27 settings writes refused to `anon` with `42501`; #165) | covered |
| FR-TEN-06 | Publisher reads no sales | Must | verified locally | `pgtap:08_publisher_role`, `pgtap:17_analytics_access`, `pgtap:23_report_access`, `pgtap:39_theme_access_b` (the publisher gets no 10b row and empty data-quality counts) | covered |
| FR-TEN-07 | Staff and viewer are read-only | Must | verified locally | `pgtap:05_write_policies`, `pgtap:31_notify_access`, `pgtap:38_settings_writes`, `e2e:live/settings-roles` (staff and the viewer save none of 27 settings writes through PostgREST, and see every settings page, tab and scope read-only in the browser; #165) | covered |
| FR-TEN-08 | Who writes manual data | Must | verified locally | `pgtap:05_write_policies`, `pgtap:07_write_scope_and_attribution`, `pgtap:10_payment_fee_rates`, `pgtap:11_item_type_roles_and_holidays`, `web:pages/settings/phan-loai-page` (staff and a store-limited manager read the roles), `pgtap:38_settings_writes`, `web:settings/access` (`manualData`), `web:settings/manual/costs-tab` and `e2e:live/settings-manual` (a store-limited manager writes their store's costs and reads the all-store costs without a control; #161), `web:settings/manual/costs-tab` and `e2e:live/settings-manual` (staff download only; rows for a store outside the scope refused; #162), `e2e:live/settings-roles` (costs, fee rates and targets for all stores, store 1 and store 2, roles, overrides and days off, as five logins and `anon`; #165) | covered |
| FR-TEN-09 | Frozen attribution | Must | verified locally | `pgtap:07_write_scope_and_attribution`, `pgtap:26_notify_schema`, `pgtap:38_settings_writes`, `e2e:live/settings-manual` (the cost, profile and override writes come back with the caller as author; #105), `e2e:live/settings` (a holiday's `created_by` and `updated_by` are the caller; an insert naming another member refused with `42501`; #106), `e2e:live/settings-manual` (the cost page's audit line, the manager's row read by the owner with its author role; #161) | covered |
| FR-TEN-10 | Create a tenant | Must | verified locally | `jobs:integration/local-stack` | covered |
| FR-TEN-11 | Add a member | Must | verified locally | `jobs:integration/local-stack` | covered |
| FR-TEN-12 | No self sign-up | Must | waits for owner | `supabase/config.toml`; owner check (`docs/go-live.md` step 1) | owner check |
| FR-TEN-13 | Sign-in | Must | verified locally | `e2e:live/auth`, `e2e:live/today` | covered |
| FR-TEN-14 | Password reset | Must | verified locally | `e2e:live/auth` | covered |
| FR-TEN-15 | Sign-in, reset and invitation on the deployed site | Must | waits for owner | owner check after `docs/go-live.md` steps 1 to 5 | owner check |
| FR-TEN-16 | Tenant and store context | Must | verified locally | `e2e:live/today`, `web:state/preferences` | covered |
| FR-TEN-17 | RLS proven on the live project | Must | waits for owner | planned live run after go-live | planned |

#### FR-CON — POS connectors

| ID | Requirement | Priority | Status | Verified by today | Coverage |
|---|---|---|---|---|---|
| FR-CON-01 | Vendor-neutral connector contract | Must | verified locally | `connector-core:unit/registry`, `connector-mock:unit/conformance` | covered |
| FR-CON-02 | Capability gating | Must | verified locally | `connector-core:unit/registry`, `sync:unit/window-changes` | covered |
| FR-CON-03 | Conformance suite | Must | verified locally | `connector-mock:unit/conformance`, `connector-ipos:unit/connector-conformance`, `connector-core:unit/checks` | covered |
| FR-CON-04 | Mock connector | Must | verified locally | `connector-mock:unit/shape`, `connector-mock:unit/conformance`, `demo-analytics:unit/ingest` (the 10b ingest structures; #151) | covered |
| FR-CON-05 | Money identities | Must | verified locally | `connector-core:unit/checks`, conformance suite | covered |
| FR-CON-06 | Flags instead of guesses | Must | verified locally | `connector-ipos:unit/connector-conformance`, `connector-ipos:unit/adjustments` | covered |
| FR-CON-07 | iPOS login and token cache | Must | verified locally | `connector-ipos:unit/auth`, `pgtap:06_anon_and_tokens` | covered |
| FR-CON-08 | iPOS request conventions | Must | verified locally | `connector-ipos:unit/http`, `connector-ipos:unit/pagination`, `connector-ipos:unit/master-data`, `connector-ipos:unit/pos-cms`, `connector-ipos:unit/time` | covered |
| FR-CON-09 | iPOS validation, errors and retries | Must | verified locally | `connector-ipos:unit/http` | covered |
| FR-CON-10 | Documented read endpoints only | Must | built | review of `packages/connector-ipos/src/endpoints` | partial |
| FR-CON-11 | iPOS normalisation | Must | verified locally | `connector-ipos:unit/connector-golden`, `core:unit/business-date`, `core:unit/size`, `core:unit/payment-kind` | covered |
| FR-CON-12 | Adjustments from the POS | Must | verified locally | `connector-ipos:unit/adjustments`, `connector-ipos:unit/connector-conformance`, `connector-ipos:live/adjustments`, `core:unit/adjustment` | covered |
| FR-CON-13 | Opt-in live checks | Must | verified locally | `connector-ipos:live/smoke`, `connector-ipos:live/connector`, `connector-ipos:live/adjustments` | covered |
| FR-CON-14 | Connectors from configuration | Must | verified locally | `runner:unit/accounts`, `jobs:unit/config` | covered |
| FR-CON-15 | Shared canonical rules | Must | verified locally | `core:unit/business-date`, `core:unit/size`, `core:unit/payment-kind`, `core:unit/money`, `core:unit/wall-clock`, `pgtap:38_settings_writes`, `web:settings/categories/categories` (an item's POS type read as known, missing or unknown by the rule of `data_quality_items.type_known`; #160) | covered |
| FR-CON-16 | Public connector documentation | Should | built | `scripts/check-public-safe.mjs` | partial |
| FR-CON-17 | CSV connector | Should | planned | planned | planned |

#### FR-SYNC — Sync engine and schedules

| ID | Requirement | Priority | Status | Verified by today | Coverage |
|---|---|---|---|---|---|
| FR-SYNC-01 | Onboard an account | Must | verified locally | `jobs:integration/local-stack`, `sync:unit/master-data` | covered |
| FR-SYNC-02 | Print the secret entry | Should | verified locally | `jobs:unit/cli` | covered |
| FR-SYNC-03 | Window sync | Must | verified locally | `sync:unit/window-mock`, `jobs:unit/cli`, `jobs:integration/local-stack` | covered |
| FR-SYNC-04 | Atomic store-days under a store lock | Must | verified locally | `sync:unit/window-robustness`, `sync:integration/postgres-repository` | covered |
| FR-SYNC-05 | Void and edit detection | Must | verified locally | `sync:unit/window-changes`, `sync:unit/window-robustness` | covered |
| FR-SYNC-06 | POS adjustments stored once | Must | verified locally | `sync:unit/window-changes`, `sync:unit/window-robustness` | covered |
| FR-SYNC-07 | Idempotent runs | Must | verified locally | `sync:unit/window-mock`, `sync:integration/postgres-repository`, `jobs:integration/local-stack` | covered |
| FR-SYNC-08 | Business date and receipt key | Must | verified locally | `sync:unit/business-date`, `sync:unit/mapping` | covered |
| FR-SYNC-09 | Customer and voucher fields | Must | verified locally | `sync:unit/mapping` | covered |
| FR-SYNC-10 | Call budget and retries | Must | verified locally | `sync:unit/run-bookkeeping` | covered |
| FR-SYNC-11 | Run bookkeeping | Must | verified locally | `sync:unit/run-bookkeeping`, `sync:unit/incremental` | covered |
| FR-SYNC-12 | Catalogue refresh | Must | verified locally | `sync:unit/master-data`, `pgtap:38_settings_writes` | covered |
| FR-SYNC-13 | Analytics refreshed after a sync | Must | verified locally | `sync:unit/incremental`, `sync:unit/run-bookkeeping`, `sync:unit/window-robustness` | covered |
| FR-SYNC-14 | Payloads kept, compressed | Must | verified locally | `sync:unit/payloads`, `pgtap:19_sale_payloads` | covered |
| FR-SYNC-15 | Incremental run per store | Must | verified locally | `sync:unit/incremental`, `sync:unit/change-detection`, `sync:unit/incremental-window`, `runner:unit/incremental-run` | covered |
| FR-SYNC-16 | CPU and wall-time guard | Must | verified locally | `sync:unit/run-guard`, `sync:unit/incremental`, `runner:unit/budget` | covered |
| FR-SYNC-17 | Edge Function runner | Must | verified locally | `pgtap:20_incremental_schedule`, Deno type-check in CI, phase 7 verification (`docs/status.md`) | partial |
| FR-SYNC-18 | Thirty-minute schedule | Must | verified locally | `pgtap:20_incremental_schedule` | covered |
| FR-SYNC-19 | Watched stores | Must | verified locally | `pgtap:20_incremental_schedule`, `pgtap:21_sync_freshness`, `runner:unit/dead-man` | covered |
| FR-SYNC-20 | Nightly job | Must | waits for owner | `.github/workflows/sync.yml`; owner dispatch after go-live | owner check |
| FR-SYNC-21 | Backfill | Must | verified locally | phase 7 verification (`docs/status.md`), `jobs:integration/local-stack` | partial |
| FR-SYNC-22 | Rejected credentials | Must | verified locally | `runner:unit/incremental-run` | covered |
| FR-SYNC-23 | Dead-man's switch | Must | verified locally | `runner:unit/dead-man`, `pgtap:20_incremental_schedule`, `pgtap:21_sync_freshness` | covered |
| FR-SYNC-24 | Undelivered scheduler calls | Must | verified locally | `pgtap:20_incremental_schedule` | covered |
| FR-SYNC-25 | Manual run of one store | Should | verified locally | `pgtap:20_incremental_schedule` | covered |
| FR-SYNC-26 | Incremental runner on a small server | Should | verified locally | `jobs:unit/incremental-checks` | covered |
| FR-SYNC-27 | Status report | Must | verified locally | `jobs:unit/status-window`, `jobs:unit/incremental-checks` | covered |
| FR-SYNC-28 | Schedule history retention | Should | verified locally | `pgtap:20_incremental_schedule` | covered |

#### FR-DQ — Data quality and reconciliation

| ID | Requirement | Priority | Status | Verified by today | Coverage |
|---|---|---|---|---|---|
| FR-DQ-01 | Daily reconciliation | Must | verified locally | `sync:unit/checks`, `sync:unit/window-mock` | covered |
| FR-DQ-02 | Unverified when unchecked | Must | verified locally | `sync:unit/window-changes` | covered |
| FR-DQ-03 | Backfill reconciliation rate | Must | verified locally | phase 7 verification, `fnb status` | covered |
| FR-DQ-04 | Monthly comparison with the POS report | Must | waits for owner | owner check | owner check |
| FR-DQ-05 | Verified badge | Must | verified locally | `web:metrics/verification`, `e2e:live/today`, `reports:unit/themes/quality/verification` (the headline counts unmatched and unchecked sales days by the badge's rule, a day without invoices left out, the days call within 900 rows up to 400 days; #158) | covered |
| FR-DQ-06 | Freshness badge | Must | verified locally | `e2e:live/today`, `web:demo/demo-row-source` | covered |
| FR-DQ-07 | Data-quality flags in the run summary | Must | verified locally | `sync:unit/mapping`, `sync:unit/window-robustness`, `sync:unit/business-date` | covered |
| FR-DQ-08 | Hôm nay equals the POS | Must | verified locally | `e2e:live/today`, phase 6 verification | covered |
| FR-DQ-09 | Report numbers equal the POS | Must | verified locally | `reports:live/live-check` (opt-in) | covered |
| FR-DQ-10 | Lagging aggregates marked | Should | verified locally | `pgtap:22_report_functions`, `reports:unit/coverage-and-comparison`, `pgtap:35_mappings_and_catch_up`, `web:settings/catch-up/catch-up-banner`, `web:settings/catch-up/use-analytics-catch-up`, `web:themes/theme-wiring` (the pending range reaches the cards and the theme page shows the banner), `web:settings/queries` (the status is read again while days are pending), `reports:unit/themes/promotions/discount-cost` (stale aggregates and an overlapping catch-up marked; #191) | covered |
| FR-DQ-11 | Unmeasured is null | Must | verified locally | `pgtap:18_metric_value`, `pgtap:36_promotion_functions` (an unmeasured lift day stays null), `datapack:pack/tables/provenance` (the data pack's KPI cells exactly as SQL gives them, null included) and `datapack:pack/gaps` (a covered scope's trackable KPIs without a value counted in `unmeasured_kpi`; #134) | covered |
| FR-DQ-12 | Data-quality page | Should | built | `pgtap:37_shift_and_quality_functions` (`data_quality_items`, `data_quality_summary`, `data_quality_payments`), `pgtap:39_theme_access_b` (#156), `pgtap:37_shift_and_quality_functions` (the payments of two accounts in the order of the stores asked; #157); `demo-analytics:parity/data-quality-items`, `demo-analytics:parity/data-quality-summary`, `demo-analytics:parity/data-quality-payments`, `demo-analytics:unit/data-quality-ports` (#157); `web:settings/categories/use-uncategorised-sales` and `e2e:live/settings-phan-loai` (Phân loại's Chưa phân loại list read from `data_quality_items`; #160), `reports:unit/themes/quality/*` (eight files: compliance, uncategorised, costs, verification, payments, modifiers, customers, markers), `demo-analytics:themes/quality.smoke`, `e2e:demo/theme-chat-luong`, `e2e:live/themes` (the page on the seed; #158), `reports:live/theme-live-check` (the Chất lượng dữ liệu page timed at 28 and 400 days; #166) | covered |
| FR-DQ-13 | Parallel verification before v1.0 | Must | planned | planned | planned |

#### FR-ANA — Analytics and metric registry

| ID | Requirement | Priority | Status | Verified by today | Coverage |
|---|---|---|---|---|---|
| FR-ANA-01 | Calendar | Must | verified locally | `pgtap:13_analytics_schema` | covered |
| FR-ANA-02 | Holidays and Tết | Must | verified locally | `pgtap:24_vn_public_holidays`, `pgtap:11_item_type_roles_and_holidays`, `core:unit/vietnam-holidays`, `pgtap:36_promotion_functions` (a holiday on a promotion day is flagged and never a control day), `web:settings/holidays/holidays` (every calendar name labelled, the national calendar shipped for 2024 to 2028) and `e2e:demo/settings-ngay-le` (national days read-only and labelled by kind; #106), `pgtap:40_pack_functions` (`holiday_calendar`; #132) | covered |
| FR-ANA-03 | Aggregates are tables with RLS | Must | verified locally | `pgtap:13_analytics_schema`, `pgtap:17_analytics_access` | covered |
| FR-ANA-04 | Refresh reproduces the facts | Must | verified locally | `pgtap:14_analytics_refresh`, `demo-analytics:parity/aggregates`, `pgtap:33_theme_functions`, `pgtap:35_mappings_and_catch_up`, `demo-analytics:parity/overrides`, `reports:live/theme-live-check` (opt-in: item quantities equal `items_sold` and no item key is a catalogue modifier, over the reference window and 365 days), `reports:live/theme-live-check` check 4 (over the reference window and 365 days no catalogue modifier is counted as an item in `data_quality_summary` or `data_quality_items`; #166) | covered |
| FR-ANA-05 | Hot and cold days | Must | verified locally | `pgtap:15_analytics_queries`, `pgtap:25_live_half_lateral` | covered |
| FR-ANA-06 | Metric registry | Must | verified locally | `metrics:consistency/document`, `metrics:unit/registry`, `web:metrics/registry` | covered |
| FR-ANA-07 | One function for any metric | Must | verified locally | `pgtap:18_metric_value`, `metrics:consistency/metric-value`, `demo-analytics:parity/metric-value` | covered |
| FR-ANA-08 | Median same-weekday baseline | Must | verified locally | `pgtap:15_analytics_queries`, `demo-analytics:parity/core-functions`, `web:metrics/today`, `pgtap:36_promotion_functions` (the lift's same-weekday median), `demo-analytics:parity/promotion-lift` (#190), `e2e:demo/settings-ngay-le`, `e2e:live/settings` and `web:settings/use-settings-mutation` (a custom day off leaves the baseline; Hôm nay refreshed after a save; #106) | covered |
| FR-ANA-09 | Benchmark forecasts with tracked error | Must | verified locally | `pgtap:15_analytics_queries`, `demo-analytics:parity/forecasts` | covered |
| FR-ANA-10 | Exact ticket decomposition | Must | verified locally | `reports:unit/decomposition-and-narrative` | covered |
| FR-ANA-11 | Query functions | Must | verified locally | `pgtap:15_analytics_queries`, `pgtap:16_analytics_menu_and_cash`, `demo-analytics:parity/item-velocity`, `pgtap:33_theme_functions`, `pgtap:35_mappings_and_catch_up`, `e2e:demo/settings-bao-cao`, `reports:unit/themes/shifts/calls` and `reports:unit/themes/shifts/drawer` (the tenant's thresholds, never over 92 days, the flags of `shift_review`; #155) | covered |
| FR-ANA-12 | Report functions with limits | Must | verified locally | `pgtap:13_analytics_schema`, `pgtap:22_report_functions`, `pgtap:23_report_access`, `reports:unit/rpc-source`, `pgtap:33_theme_functions`, `pgtap:34_theme_access`, `pgtap:36_promotion_functions`, `pgtap:37_shift_and_quality_functions` (the 10b limits), `pgtap:39_theme_access_b` (every 10b function's scope) | covered |
| FR-ANA-13 | Parity of the browser port | Must | verified locally | `demo-analytics:parity/*` (22 files), CI `database` job, `demo-analytics:parity/overrides` (with fee rates and a custom holiday), `demo-analytics:parity/menu`, `demo-analytics:parity/basket-modifiers`, `demo-analytics:parity/discount-rows` (with D3's compliance cases; #151), `demo-analytics:parity/promotion-days`, `demo-analytics:parity/promotion-lift` (#190), `demo-analytics:parity/promotion-catalogue`, `demo-analytics:parity/promotion-compliance`, `demo-analytics:parity/item-discount-days` (#152), `demo-analytics:parity/shift-adjustments` (#154), `demo-analytics:parity/data-quality-items`, `demo-analytics:parity/data-quality-summary`, `demo-analytics:parity/data-quality-payments` (#157), `demo-analytics:parity/store-profiles`, `demo-analytics:parity/metric-windows`, `demo-analytics:parity/holiday-calendar` (0 mismatches; #133) | covered |
| FR-ANA-14 | Benchmark context kept apart | Should | verified locally | `metrics:consistency/document`, `datapack:pack/context` (the data pack carries the 10 dated entries in registry order under `context`, apart from its tables, so a plan can never cite one; #134) | covered |
| FR-ANA-15 | Refresh on demand | Should | verified locally | `pgtap:17_analytics_access`, `pgtap:35_mappings_and_catch_up`, `web:settings/supabase-settings-source` (the newest 92 pending days per call), `web:settings/catch-up/use-analytics-catch-up`, `web:settings/queries`, `web:pages/settings/phan-loai-page` (a category or kind save starts the catch-up, a refused one does not), `e2e:live/settings-phan-loai` (the banner appearing and clearing after each save; #160), `web:settings/fees/fees-tab` (a fee save starts the catch-up, a refused one does not; #163) | covered |
| FR-ANA-16 | Reference-window figures | Must | verified locally | phase 8 verification (private sheet); `reports:live/theme-live-check` (opt-in, `LIVE_REFERENCE_SHEET`), `reports:unit/themes/reference-sheet` | owner check |
| FR-ANA-17 | Customer metrics | Should | planned | planned | planned |

#### FR-REP — Periodic reports

| ID | Requirement | Priority | Status | Verified by today | Coverage |
|---|---|---|---|---|---|
| FR-REP-01 | Hôm nay | Must | verified locally | `web:metrics/today`, `e2e:live/today`, `e2e:demo/demo` | covered |
| FR-REP-02 | Ngày | Must | verified locally | `reports:unit/reports/day/*`, `demo-analytics:reports/day`, `e2e:demo/report-day`, `e2e:live/reports` | covered |
| FR-REP-03 | Tuần | Must | verified locally | `reports:unit/reports/week/*`, `demo-analytics:reports/week`, `e2e:demo/report-week` | covered |
| FR-REP-04 | Tháng | Must | verified locally | `reports:unit/reports/month/*`, `demo-analytics:reports/month`, `e2e:demo/report-month` | covered |
| FR-REP-05 | Năm | Must | verified locally | `reports:unit/reports/year/*`, `demo-analytics:reports/year`, `e2e:demo/report-year` | covered |
| FR-REP-06 | Numbers from SQL only | Must | verified locally | `reports:unit/rpc-source`, `reports:unit/definition`, `pgtap:22_report_functions`, `reports:unit/themes/contract`, `reports:unit/themes/source` (the 10b functions, #149) | covered |
| FR-REP-07 | As-of rule | Must | verified locally | `reports:unit/as-of-and-bounds`, `web:reports/report-route`, `e2e:demo/report-day` | covered |
| FR-REP-08 | Deep links | Must | verified locally | `web:reports/report-route`, `web:reports/period-navigator`, `web:themes/theme-route`, `e2e:demo/report-day`, `e2e:demo/theme-navigation` (theme links keep the range and the stores), `e2e:live/themes` (a dated link per store), `web:themes/theme-wiring` (theme parameters), `reports:unit/themes/promotions/params` | covered |
| FR-REP-09 | Coverage and young stores | Must | verified locally | `reports:unit/coverage-and-comparison`, `e2e:live/reports`, `e2e:demo/report-year`, `reports:unit/themes/promotions/discount-cost` and `vouchers` (the young store's missing last year, like for like), `e2e:demo/theme-khuyen-mai` (#191), `reports:unit/themes/stores/kpis` and `calls` (the all-stores change like for like over the covered stores, labelled k/N; #193), `datapack:pack/coverage` and `datapack:pack/gaps` (the data pack's KPI windows by the same coverage rule: a window that a store of the scope did not cover is null for the whole scope rather than mixing stores, `partial_scope_window` counts it, and a store younger than 28 days shows as `young_store`; #134) | covered |
| FR-REP-10 | Sentences from templates | Must | verified locally | `reports:unit/decomposition-and-narrative`, `web:metrics/sentences`, `web:i18n/wording-sheets`, the Ca & két tiền card tests and smoke test (#155), the Khuyến mãi card tests and `web:i18n/theme-keys` (#191), the Khuyến mãi rule cards in `web:i18n/theme-keys` (#153) | covered |
| FR-REP-11 | Report card | Must | verified locally | `web:components/report-card/report-card`, `web:components/report-card/report-card-extensions`, `web:themes/theme-param-controls` (the controls slot), `web:components/report-card` and `web:reports/card-adapter` (a signed money headline; #191) | covered |
| FR-REP-12 | CSV download | Must | verified locally | `web:components/report-card/report-card`, `web:lib/csv`, `e2e:demo/report-day`, `e2e:demo/theme-doanh-thu`, `e2e:demo/theme-gio-ngay`, `web:lib/csv-parse`, `web:state/preferences`, `e2e:demo/theme-thuc-don`, `e2e:demo/theme-thanh-toan`, `web:settings/thresholds/thresholds-form`, `e2e:demo/settings-bao-cao`, phase 10a's verification (#102) (one CSV per theme from the real tenant: BOM, strict UTF-8, Vietnamese headers), `e2e:demo/theme-ca-ket-tien` (every table as UTF-8 CSV with a BOM, and semicolon-separated; #155), `e2e:demo/theme-khuyen-mai` (every table as UTF-8 CSV with a BOM, and semicolon-separated; #191), `e2e:demo/theme-ca-ket-tien` (the cashier card's CSV in both dialects with the BOM; #192), `e2e:demo/theme-khuyen-mai` (all eight tables as CSV in both dialects; #153), `web:settings/manual/cost-import` and `e2e:demo/settings-gia-von` (the cost template with the BOM in the device's dialect; #162), `web:exports/writers` and `e2e:live/exports` (every exported CSV starts with the BOM in the device's dialect and decodes as strict UTF-8 with names intact; #140, #141) | partial |
| FR-REP-13 | Print layout | Should | verified locally | `e2e:demo/demo`, `e2e:demo/report-day`, the four theme specs (`expectThemePrintLayout`: the summary line, no buttons, no tabs or pickers), `e2e:demo/theme-ca-ket-tien` (print without controls, Ca n in print; #155), `e2e:demo/theme-khuyen-mai` (print without pickers; #191) | covered |
| FR-REP-14 | Card loading and errors | Should | built | `e2e:demo/report-day` (cards settle); `web:reports/use-cards-load` (a failed card with its retry, a failed coverage call) | partial |
| FR-REP-15 | Store and period selection | Must | verified locally | `web:shell/period-picker`, `web:state/preferences`, `pgtap:22_report_functions`, `reports:unit/themes/stores/calls` (one store asks only for coverage; the days call within 900 rows) and `e2e:demo/theme-so-sanh` (one store: every card asks for a second; #193) | covered |
| FR-REP-16 | Target progress | Should | verified locally | `reports:unit/reports/month/shifts-targets`, `e2e:demo/report-month`, `e2e:live/settings-manual` and `e2e:demo/settings-muc-tieu` (a target saved in Settings brings progress and pace to Tháng; #163) | covered |
| FR-REP-17 | Demo mode | Must | verified locally | `e2e:demo/demo`, `e2e:demo/report-month`, `e2e:live/auth`, `web:demo/demo-row-source` (a custom holiday of the demo's settings leaves the baseline), `demo-analytics:unit/settings` (the demo's settings store: defaults, versions, refused writes, the 10b defaults; #151), `demo-analytics:unit/report-source` (a handler for every theme function, the planned reads of the 10b functions too; #151), `demo-analytics:unit/promotion-ports` (#190), `demo-analytics:unit/shift-adjustments` (#154), `demo-analytics:unit/data-quality-ports` (#157) | covered |
| FR-REP-18 | Navigation | Must | verified locally | `e2e:live/today`, `web:themes/theme-tabs`, `e2e:demo/theme-navigation` (the eight theme tabs, the pages of 10b, `#/chu-de`), `web:settings/pages`, `web:pages/settings/settings-layout`, `e2e:demo/settings-layout` and `e2e:demo/settings-ngay-le` (the Cảnh báo and Bản tin slots naming phase 12; #106) | covered |
| FR-REP-19 | Owner wording review | Should | waits for owner | owner check | owner check |
| FR-REP-20 | Owner comparison with POS reports | Must | waits for owner | owner check after `reports:live/live-check` | owner check |
| FR-REP-21 | Shift labels carry no personal data | Must | verified locally | `reports:unit/model/shifts`, `reports:unit/reports/day/details`, `reports:unit/reports/month/shifts-targets`, `web:reports/card-adapter`, `e2e:demo/report-day`, `e2e:demo/report-month`, `e2e:live/reports`, `reports:live/live-check`, `reports:unit/themes/shifts/labels`, `web:pages/themes/ca-ket-tien/shift-privacy` (#155), `reports:unit/themes/shifts/cashiers` and `web:pages/themes/ca-ket-tien/shift-privacy` (no address in any state of the cashier card, the unknown row never named; #192) | covered |

#### FR-THM — Thematic reports

| ID | Requirement | Priority | Status | Verified by today | Coverage |
|---|---|---|---|---|---|
| FR-THM-01 | Doanh thu & xu hướng | Should | verified locally | `pgtap:33_theme_functions`, `demo-analytics:parity/theme-revenue-hours` (`range_totals` equals the SQL, and the totals equal the day buckets of `period_series`), `demo-analytics:themes/revenue.smoke` (every preset; like for like while one store is too young), `reports:unit/themes/definition`, `reports:unit/themes/revenue` (each card from fixtures), `e2e:demo/theme-doanh-thu`, `e2e:live/themes` | covered |
| FR-THM-02 | Giờ & ngày trong tuần | Should | verified locally | `pgtap:33_theme_functions`, `pgtap:34_theme_access`, `reports:unit/themes/hours` (each card from fixtures, shift-window merging, the heat-table rows), `demo-analytics:parity/theme-revenue-hours`, `demo-analytics:themes/hours.smoke` (every preset; RevPASH only for the store with seats, "chưa có số ghế" for the one without), `e2e:demo/theme-gio-ngay`, `e2e:demo/settings-cua-hang` (hours and seats saved, then RevPASH on Giờ & ngày; #159), `e2e:live/themes` (a dated deep link per seeded store shows RevPASH with its seats), `reports:live/theme-live-check` (opt-in: hours and weekdays of the reference window), phase 10a's verification (#102) (the page on the real tenant for the reference window) | partial |
| FR-THM-03 | Thực đơn | Should | built | `pgtap:33_theme_functions`, `pgtap:34_theme_access`, `pgtap:35_mappings_and_catch_up` (the menu functions); `demo-analytics:parity/menu`, `demo-analytics:parity/basket-modifiers`, `demo-analytics:themes/menu.smoke`, `e2e:demo/theme-thuc-don`, `e2e:live/themes`, `e2e:demo/settings-bao-cao` (a saved minimum reaches the matrix), `e2e:demo/settings-gia-von` and `e2e:live/settings-manual` (five costs dated from the first business day put exactly those five items on the margin card with their unit costs; a later cost leaves earlier days on the earlier cost; a store's own cost changes only that store's margin; #161) | covered |
| FR-THM-04 | Thanh toán & tiền mặt | Should | verified locally | `pgtap:35_mappings_and_catch_up` (cash thresholds from the settings); `demo-analytics:parity/shift-review`, `demo-analytics:themes/payments.smoke`, `e2e:demo/theme-thanh-toan` (the four cards), `e2e:demo/settings-bao-cao` (a saved cash threshold reaches the drawer card), `reports:live/theme-live-check` (opt-in: the payment mix of the reference window; the default thresholds change neither `shift_review` nor `cash_variance_flags`), phase 10a's verification (#102) (the page on the real tenant for the reference window), `e2e:demo/settings-phi` (a saved fee rate brings the fee estimate to Thanh toán after an in-app navigation; #163) | partial |
| FR-THM-05 | Range presets | Could | verified locally | `reports:unit/themes/range`, `web:themes/range-picker`, `web:themes/theme-route`, `web:themes/theme-wiring` (the device's last preset; the range notices), `e2e:demo/theme-doanh-thu`, `e2e:demo/theme-navigation` | covered |
| FR-THM-06 | Khuyến mãi & giảm giá | Should | built | `reports:unit/themes/contract`, `reports:unit/themes/promotions/params`, `web:themes/theme-wiring` (the contracts and the `promo` and `cmp` parameters, #149); `pgtap:36_promotion_functions` (#150); `demo-analytics:parity/promotion-days`, `demo-analytics:parity/promotion-lift`, `demo-analytics:unit/promotion-ports` (#190); the other ports and the page planned, `demo-analytics:parity/promotion-catalogue`, `demo-analytics:parity/promotion-compliance`, `demo-analytics:parity/item-discount-days` (#152), `reports:unit/themes/promotions/discount-cost`, `reports:unit/themes/promotions/vouchers`, `reports:unit/themes/promotions/lift` (a measured gain, loss and sister-store lift, every flag's sentence), `reports:unit/themes/promotions/definition` (the lift asked with the tenant's pre-period weeks), `demo-analytics:themes/promotions.smoke` (a measured bill discount in the demo), `web:themes/theme-wiring` (the sister store disabled with its reason, kept while only the comparator changes), `web:themes/theme-param-controls`, `web:i18n/theme-keys` (a measured lift in both languages with every placeholder filled), `e2e:demo/theme-khuyen-mai`, `e2e:live/themes` (six themes on the seed) (#191), the catalogue and rule cards (`reports:unit/themes/promotions/rules`, `e2e:demo/theme-khuyen-mai`, `e2e:live/themes`; #153) | covered |
| FR-THM-07 | Ca & két tiền | Should | built | `pgtap:37_shift_and_quality_functions` (`shift_adjustments`: attribution by the invoice's shift and by time, rates, one-sided z-scores on unrounded rates) (#150); `demo-analytics:parity/shift-adjustments`, `demo-analytics:unit/shift-adjustments` (#154); `reports:unit/themes/shifts/calls`, `reports:unit/themes/shifts/shift-sales`, `reports:unit/themes/shifts/drawer` (the flagged shifts equal `shift_review`'s flagged rows), `reports:unit/themes/shifts/adjustments` (only what `shift_adjustments` flags, every missing z-score explained), `reports:unit/themes/shifts/labels`, `demo-analytics:themes/shifts.smoke` (a shift has the same Ca n in every card), `web:pages/themes/ca-ket-tien/shift-privacy` (no POS shift name or e-mail in CSV or rendered markup), `e2e:demo/theme-ca-ket-tien`, `e2e:live/themes` (the five thematic reports on the seed) (#155), `reports:unit/themes/shifts/cashiers` (per-cashier sums equal the shift rows; only named cashiers lead, tie or are counted; a shared login decided per store from the raw values over at least 2 shifts; the display-name notice when every login is an e-mail address), `demo-analytics:themes/shifts.smoke` (the cashier card's columns sum to `shift_review` and `shift_adjustments`; #192), `reports:live/theme-live-check` check 7 (the shifts `shift_review` flags equal `cash_variance_flags` with the tenant's thresholds over 92 days, per store and for all stores, with at least one shift; #166) | covered |
| FR-THM-08 | So sánh cửa hàng | Should | built | `reports:unit/themes/stores/calls`, `reports:unit/themes/stores/kpis` (the stores add up to the all-stores row, ratios after summing, like for like with k/N), `reports:unit/themes/stores/same-day`, `reports:unit/themes/stores/since-opening` (K from the youngest store with a complete week, the latest week without Tết), `demo-analytics:themes/stores.smoke`, `e2e:demo/theme-so-sanh`, `e2e:live/themes` (seven themes on the seed) (#193) | covered |
| FR-THM-09 | Sections a POS cannot feed | Should | built | `pgtap:33_theme_functions` (provisional menu roles, null attach rates), `reports:unit/themes/menu/margins`, `reports:unit/themes/menu/attach`, `reports:unit/themes/hours/productivity`, `reports:unit/themes/payments/fees`, `demo-analytics:themes/hours.smoke`, `e2e:demo/theme-thanh-toan`, phase 10a's verification (#102) (each missing-input state on the real tenant), `pgtap:37_shift_and_quality_functions` (the inputs a store lacks: costs, seats, opening hours, identified customers), `reports:unit/themes/stores/kpis` (chưa thiết lập in a figure's own cell, a dash for a store without sales), `web:reports/card-adapter`, `web:components/report-card/table-sorting` (words in a value column sort after every number; #193), `reports:unit/themes/quality/customers` and `costs` (no customer of the list yet, partial cost coverage; #158), `e2e:demo/settings-gia-von` (the margin card asks for costs first; the matrix stays provisional while an item of the role lacks a cost; #161) | partial |

#### FR-SET — Settings and manual data

| ID | Requirement | Priority | Status | Verified by today | Coverage |
|---|---|---|---|---|---|
| FR-SET-01 | Store profile | Must | built | `pgtap:38_settings_writes`; `web:pages/settings/cua-hang-page` (the POS facts without a control, every field saved and read back, the audit line, the read-only states), `web:settings/store/store-fields`, `e2e:demo/settings-cua-hang`, `e2e:live/settings` (a save under row-level security, the audit line with "Bạn" and "bởi chủ", one store for a store-limited manager; #159), `web:settings/supabase-settings-source` and `web:settings/demo-settings-source` (store profiles read with their audit columns and updated column by column; the code, hours and span refusals mapped), `e2e:live/settings-manual` (a duplicate code, the owner-only hours and an invalid span through PostgREST; #105), `e2e:live/settings-roles` (the seat count, opening hours, code and name of both stores and the legal form written as five logins and `anon`; staff and the viewer read Cửa hàng without a control; #165) | partial |
| FR-SET-02 | Opening-hours shape | Must | verified locally | `pgtap:20_incremental_schedule`, `web:settings/validation`, `web:settings/forms/opening-hours-editor`, `web:settings/store/store-fields` (the hours sent in the database's shape), `web:pages/settings/cua-hang-page` (an incomplete span blocked, the `23514` message), `e2e:demo/settings-cua-hang` (#159) | covered |
| FR-SET-03 | Item costs | Must | built | `pgtap:05_write_policies` (table); the Giá vốn page (#161), `web:settings/manual/supabase-manual-source` and `web:settings/manual/demo-manual-source` (costs read with history and saved as one upsert on scope, item and date), `e2e:live/settings-manual` (a tenant-wide and a store cost are two rows, a second save updates its row, a refused row writes nothing; #105), `web:settings/manual/costs` (scope precedence, default dates, a store's first cost after an all-store cost defaulting to today, hints that name a later row, whole đồng), `web:settings/manual/costs-tab` (unsaved rows kept visible, the scope locked while unsaved, delete messages with a retry, a store-limited manager never reading all stores first), `web:settings/manual/use-item-sales`, `web:pages/settings/du-lieu-nhap-tay-page`, `e2e:demo/settings-gia-von`, `e2e:live/settings-manual` (the page under row-level security; #161), `web:settings/manual/cost-import` (both dialects with and without a BOM, every đồng form, ISO and slash dates with the order choice, only the items the tab offers, refused rows out of duplicate matching, row numbers by line, the 2,000-row and 2 MB limits, an unchanged template saving nothing), `web:settings/manual/costs-tab` (preview, one save, a refused save keeping the preview), `web:lib/csv-parse` (line numbers), `pgtap:05_write_policies` (the whole-đồng check from 0 to 100,000,000), `e2e:demo/settings-gia-von` (template round trip), `e2e:live/settings-manual` (an import through the real tables; #162) | covered |
| FR-SET-04 | Targets | Must | built | `pgtap:05_write_policies` (table); the Mục tiêu and Phí thanh toán tabs (#163), `web:settings/manual/supabase-manual-source` and `web:settings/manual/demo-manual-source` (targets upserted on store, period kind and start; #105), `web:settings/manual/targets-tab`, `web:settings/manual/use-month-pace`, `demo-analytics:unit/source` and `demo-analytics:parity/overrides` (a saved target read by `store_targets` and `month_pace` in both engines), `pgtap:05_write_policies` (a target of 0 or with a fraction refused), `e2e:demo/settings-muc-tieu`, `e2e:live/settings-manual` (a saved target's progress, amount needed per day and forecasts on Tháng; #163) | covered |
| FR-SET-05 | Payment fee rates | Should | built | `pgtap:10_payment_fee_rates` (table); the Mục tiêu and Phí thanh toán tabs (#163), `web:settings/supabase-settings-source` and `web:settings/demo-settings-source` (fee rates upserted on scope, method and date, the null store included), `e2e:live/settings-manual` (the tenant-wide key resolved through supabase-js; #105), `web:settings/fees/fees-tab` (the first rate from the first business day, later and a store's first own rate from today, 21 % refused), `pgtap:10_payment_fee_rates` (0 to 20 per cent and a whole-đồng fixed fee up to 100,000), `e2e:demo/settings-phi`, `e2e:live/settings-manual` (#163) | covered |
| FR-SET-06 | Payment-kind mapping | Should | built | `core:unit/payment-kind` (override rule), `pgtap:38_settings_writes`; `web:settings/payment-kinds/payment-kinds`, `web:settings/payment-kinds/payment-kinds-form`, `web:pages/settings/phan-loai-page` (the Loại thanh toán tab: the POS, override and effective kinds, "Theo POS" deleting the override, the read-only states), `e2e:demo/settings-phan-loai` (a re-mapped method moving in Thanh toán's payment mix and back), `e2e:live/settings-phan-loai` (the kind override moving the method in Thanh toán, the catch-up banner; #160), `web:settings/supabase-settings-source` and `web:settings/demo-settings-source` (POS, override and effective kinds; overrides upserted and cleared), `e2e:live/settings-manual` (#105) | covered |
| FR-SET-07 | Item-type roles and categories | Must | built | `pgtap:11_item_type_roles_and_holidays`, `pgtap:14_analytics_refresh`, `pgtap:33_theme_functions`, `pgtap:35_mappings_and_catch_up`; the roles screen built (#89), the Nhóm của món tab (#160: `web:settings/categories/categories`, `web:settings/categories/categories-form`, `web:settings/categories/use-uncategorised-sales` (one `data_quality_items` call per POS account over 90 days, the best sellers first, an item sold by name), `web:pages/settings/phan-loai-page` (only the item's own account's types, "Theo POS" deleting the override), `e2e:demo/settings-phan-loai` (the uncategorised demo item re-mapped out of Chưa phân loại on Thực đơn), `e2e:live/settings-phan-loai` (an item without a type re-mapped through the real tables, Thực đơn checked before the catch-up ends)), `demo-analytics:parity/overrides`, `demo-analytics:parity/menu`, `web:settings/catch-up/use-analytics-catch-up`, `web:settings/use-settings-mutation` (a mapping save starts the catch-up), `web:data/invalidate-analytics` (a mounted analytics query of the tenant refetches at once, another tenant's does not), `web:settings/roles/roles`, `web:settings/roles/roles-form`, `web:pages/settings/phan-loai-page`, `web:settings/supabase-settings-source` (one upsert, a cleared role deleted), `core:unit/item-role` (`suggestRole`), `e2e:demo/settings-phan-loai` (Tháng's attach round trip), `pgtap:37_shift_and_quality_functions` (an overridden item and an item without a type in `data_quality_items`), `web:settings/supabase-settings-source` and `web:settings/demo-settings-source` (items with their POS category and override; overrides upserted and cleared), `e2e:live/settings-manual` (#105), `e2e:demo/theme-chat-luong` (re-mapped from the card's link, the item leaves the table without a reload: A6) and `reports:unit/themes/quality/uncategorised` (one shared rule with Phân loại; #158), `e2e:live/settings-roles` (a role, a category override and a kind override saved by the owner and the manager and refused to everyone else through PostgREST; the three Phân loại tabs read-only for every other login; #165) | partial |
| FR-SET-08 | Tenant holidays | Should | built | `pgtap:11_item_type_roles_and_holidays`, `pgtap:22_report_functions`, `pgtap:38_settings_writes`; screen planned, `web:settings/supabase-settings-source` and `web:settings/demo-settings-source` (a year of national and custom days, a custom day added once and deleted), `e2e:live/settings-manual` (#105), `web:pages/settings/ngay-le-page` (add and delete with the author, only the tenant's own days deleted, 80 characters with marks counted once, a duplicate held back in either Unicode form, a retry that empties the form and moves the year, focus kept), `web:settings/holidays/holidays`, `web:settings/validation`, `web:settings/access`, `e2e:demo/settings-ngay-le` (a day off on one of the 8 earlier Tuesdays turns Ngày's chip to 7/8 weeks and back without a reload), `e2e:live/settings` (a day outside the national calendar saved through row-level security with "Bạn" in the audit line leaves the day report's baseline; #106) | covered |
| FR-SET-09 | Default language | Could | built | `pgtap:38_settings_writes`; `web:state/preferences` (a language chosen with the toggle wins, an older stored language without that mark gives way to the default), `web:settings/tenant-default-language`, `web:settings/supabase-settings-source` (the default-language read), `e2e:demo/settings-cua-hang` (the default applies, then the toggle wins), `e2e:live/settings` (a new session opens in English; #159) | covered |
| FR-SET-10 | Legal texts | Must | built | `pgtap:12_consent_and_legal` (tables), `pgtap:38_settings_writes`; `web:settings/manual/supabase-manual-source` and `web:settings/manual/demo-manual-source` (drafts inserted or patched, publication and retirement through the two functions, frozen texts), `e2e:live/settings-manual` (#105), `web:settings/legal/legal-rules`, `web:settings/legal/markdown` (an unsafe link renders without a link, 100,000 characters of each backtracking pattern within a time budget), `web:settings/legal/markdown-preview`, `web:settings/legal/legal-editor`, `web:pages/settings/phap-ly-page` (a stale publish or retire re-reads the list with its own message), `web:settings/access`, `e2e:demo/settings-phap-ly`, `e2e:live/settings-manual` (a text inserted as published or given a status by hand refused with `42501`, a published text refused with `55000`, the next publication retiring the one in force at the same instant, a second publish or retire refused, the database's dates on the page, a manager's page read-only; #164), `e2e:live/settings-roles` (a draft, a title edit, publication and retirement saved by the owner only; a text inserted as published or a `status` patched refused to every login; Pháp lý read-only for every other login; #165) | partial |
| FR-SET-11 | Settings writes tested from the browser | Must | built | the read-only interface (#78): `web:settings/access` (every role and scope), `web:settings/read-only-notice`, `web:settings/use-settings-mutation`, `web:settings/supabase-settings-source`, `web:settings/demo-settings-source`; the layout: `e2e:demo/settings-layout`, `e2e:live/today`; the thresholds page (#90): `web:settings/thresholds/thresholds-form`, `web:pages/settings/bao-cao-page` (an owner saves and restores, every other role and scope reads with the reason and no save control), `e2e:demo/settings-bao-cao`, `e2e:live/today` (the seeded owner reads the page through row-level security, with the audit line, without writing), `pgtap:35_mappings_and_catch_up` (the write matrix of `report_settings`, the one-column upsert that keeps the others and the delete that restores the defaults); database rules: `pgtap:05_write_policies`, `pgtap:38_settings_writes`; `e2e:live/settings-fixture` (#103), `e2e:live/settings-manual` (the sources' writes through PostgREST as an owner, a manager, a store-limited manager and a viewer on the fixture tenant; #105); the write matrix (#165): `e2e:live/settings-roles` (27 settings writes as the five fixture logins and `anon` through PostgREST, each saved or refused with `42501`, `23505` or `23514` and read back as the owner: saved by the owner 22, the manager 15, the store-limited manager 5, staff, the viewer and `anon` none; every settings page, tab and scope in the browser for each login with write controls exactly where the database saves and the reason elsewhere, axe at 360 and 1280 px; 28 of 28 on the local stack), `web:settings/access` extended (eight areas by seven logins by three scopes, held equal to the write table by the live spec) | partial |

#### FR-EXP — Exports and AI data pack

| ID | Requirement | Priority | Status | Verified by today | Coverage |
|---|---|---|---|---|---|
| FR-EXP-01 | Browser export | Must | built | `pgtap:40_pack_functions` and `pgtap:41_export_totals` (the pack and export-proof functions; #132); `web:exports/plan`, `web:exports/reader`, `web:exports/totals` (the fingerprints equal the literal hex that `41_export_totals` pins), `web:exports/columns`, `web:exports/writers` (CSV with the BOM, JSON without), `web:exports/archive` and `web:exports/run` (every file proven against `export_control_totals`, the archive and its manifest; #139, #140), `web:pages/exports/exports-page` and `web:pages/exports/export-tab` (#141), `e2e:live/exports` (a seeded month as CSV and as JSON on a fixture tenant: every file verified, the expected paths, the BOM and strict UTF-8 with names intact, the manifest's fingerprints equal to `export_control_totals` read by the same member; passed on the local stack on 2026-11-18), `e2e:demo/datapack` (the demo's notice); not run yet: the real-data comparison of #195 and the owner's Excel check (OC-04, #196) | partial |
| FR-EXP-02 | Paged, split exports | Must | built | `web:data/paginate` (keyset paging of Hôm nay), `pgtap:41_export_totals` (control totals and fingerprints per table and month; #132), `web:exports/reader` (a fake PostgREST that caps pages at 1,000, 500 and 250 rows and adds and removes rows between pages: no row lost or doubled; 97-row pages give the same rows as 1,000-row pages; #139), `web:exports/totals` and `web:exports/run` (a store-month read again, at most twice, when a sync commits during the read, then marked unverified with its reason), `web:exports/plan` (split by month, at most 12 months), `web:exports/estimate` and `web:pages/exports/export-tab` (the estimate before the export and the bytes received after it; #140, #141), `e2e:live/exports` | covered |
| FR-EXP-03 | Data pack builder | Must | in build | `datapack:unit` (the package and its frozen interfaces; #129), `pgtap:40_pack_functions` (#132); the pack's content (#134): `datapack:pack/build` (demo packs valid for every horizon, in both languages, with and without a focus and an owner note; every planned call recorded, duplicates shared, the fence and `pack_data_changed`), `datapack:pack/request`, `datapack:pack/calendar`, `datapack:pack/calls`, `datapack:pack/coverage`, `datapack:pack/kpi-ids`, `datapack:pack/tables/provenance`, `order`, `labels`, `items`, `hours`, `shifts`, `holidays` and `empty` (every cell from a recorded source value, rank keys stable under shuffled rows, store labels from SQL, the twenty tables), `datapack:pack/golden` (the golden demo pack byte for byte); `buildDataPack` itself waits for the prompt (#131) | partial |
| FR-EXP-04 | Versioned schema and size budget | Must | in build | `datapack:pack/schema` (the committed `fnb-datapack-1` and `fnb-plan-1` JSON Schema files equal the generated ones; Ajv 2020 reaches zod's verdict on every fixture), `datapack:pack/budget` (the estimate as ceil(UTF-8 bytes × 5 ÷ 11), small under 15,000, the eight trimming steps in their declared order and `pack_over_budget` after the last), `datapack:pack/invariants` (the budget's limit, steps, estimate and ceiling checked on every validation; #130); `datapack:pack/golden` (the golden demo pack of two stores within the budget, 21,225 estimated tokens, nothing trimmed) and `datapack:pack/build` (every horizon and language; #134); a pack of ten stores ends in `pack_over_budget` with the stand-in prompt, and the real prompt (#131) adds its own text | partial |
| FR-EXP-05 | Aggregates only | Must | built | `datapack:pack/aggregates` (each of the five aggregates-only rules with a fixture that breaks it; identifiers that only look personal pass, the same strings inside an item name are refused), `datapack:pack/invariants` (`validatePack` runs the check, and refuses a row hidden under a `__proto__` key; #130); the pack's tables (#134): `datapack:pack/build` (the check runs before sealing, and a till text that looks like a phone number gives `pack_not_aggregate`), `datapack:pack/request` (a focus or note holding an e-mail address or a phone number refused with `pack_text_contact_details`), `datapack:pack/tables/shifts` (no shift or cashier name), `datapack:pack/tables/labels` and `datapack:pack/transport-equivalence` (store ids only in `request.stores`), `datapack:pack/golden` (the golden pack holds aggregates only) | covered |
| FR-EXP-06 | Prompt templates | Must | in build | the KPI front matter (#135): `datapack:plan/front-matter` (`fnb-plan/1` with KPIs keyed by metric ids), `datapack:pack/schema` (`fnb-plan-1.schema.json`), `datapack:plan/lint-codes` (`kpi_unknown` and `kpi_untracked` for an id outside the registry or one KPI follow-up cannot track); the prompt templates are planned (#131) | partial |
| FR-EXP-07 | Download and copy buttons | Must | designed | planned | planned |
| FR-EXP-08 | Same pack from the CLI | Must | in build | `datapack:unit` (the frozen contract; #129), `reports:unit/themes/contract` and `reports:unit/source/json-rpc-client` (`createJsonRpcClient`; #133), `datapack:pack/canonical`, `datapack:pack/decimal` and `datapack:pack/hash` (one canonical text, re-serialised byte for byte after a database round trip; `pack_id` blind to `generated_at` and key order), `datapack:pack/invariants` (`comparePackTexts`), `datapack:pack/source-scan` and `datapack:pack/browser-safe` (no locale, system clock, randomness or Node API under `src`; #130), `datapack:pack/transport-equivalence` (rows shaped as PostgREST and as `to_jsonb` return them, keys in another order and `1.50` for `1.5`, give the same bytes and `pack_id`) and `datapack:pack/environment` (the golden pack's bytes in child processes under three process time zones; #134); planned: `fnb datapack` (#137) and the byte comparison of browser and command-line packs (#144) | partial |
| FR-EXP-09 | Built by a data role | Must | designed | `pgtap:08_publisher_role`, `pgtap:17_analytics_access` (publisher reads nothing), `pgtap:40_pack_functions` (`pack_fence`; #132) | partial |
| FR-EXP-10 | Verification state in the pack | Must | built | `datapack:pack/tables/provenance` (a store-day without a matched check counted in the `stores` table's `unmatched_days`, with `verified` false), `datapack:pack/gaps` (`unreconciled_days` and `stale_aggregates` per store, each exactly when its condition holds; #134) | covered |

#### FR-STR — Strategy plans

| ID | Requirement | Priority | Status | Verified by today | Coverage |
|---|---|---|---|---|---|
| FR-STR-01 | Paste a plan | Must | in build | the plan checks the box will run (#135): `datapack:plan/normalize` (the pasted text normalised as it will be stored), `datapack:plan/lint-codes`, `datapack:plan/plan-record` (a clean plan turned into the arguments of `publish_strategy_plan` with the source `pasted`; a sample pack refused); the paste box (#143) and Kế hoạch are planned | partial |
| FR-STR-02 | Strategy prompt in the pack | Must | designed | planned | planned |
| FR-STR-03 | Publish a plan | Must | designed | planned (database rules verified: `pgtap:08_publisher_role`) | planned |
| FR-STR-04 | Plan validation | Must | in build | the client half (#135): `datapack:plan/lint-codes` (a plan without section 7 refused with `section_missing:7`, an unknown KPI id with `kpi_unknown:net_sales` at the line of its key; one fixture per lint code), `datapack:plan/lint-browser` (the same results under jsdom), `datapack:plan/sections`, `datapack:plan/front-matter`; the database's validation (phase 11b, #170) is planned | partial |
| FR-STR-05 | Cite-a-number check | Must | in build | `datapack:plan/citations` (an initiative counts as cited only when a written number matches the numeric cell it cites: `initiative_uncited`, `citation_unknown`, `citation_mismatch`), `datapack:plan/numbers` (the number grammar in Vietnamese and English), `datapack:plan/uncited-numbers`, `datapack:plan/lint-codes` (#135) | covered |
| FR-STR-06 | Kế hoạch tab | Must | designed | planned | planned |
| FR-STR-07 | KPI follow-up | Must | designed | planned | planned |
| FR-STR-08 | Plan storage rights | Must | verified locally | `pgtap:05_write_policies`, `pgtap:07_write_scope_and_attribution`, `pgtap:08_publisher_role` | covered |
| FR-STR-09 | Monthly routine guide | Could | designed | planned | planned |
| FR-STR-10 | Prompt-tuning log | Should | designed | planned | planned |

#### FR-NOT — Alerts, digests and channels

| ID | Requirement | Priority | Status | Verified by today | Coverage |
|---|---|---|---|---|---|
| FR-NOT-01 | Destinations | Must | verified locally | `pgtap:26_notify_schema` | covered |
| FR-NOT-02 | Channel kinds | Must | verified locally | `pgtap:26_notify_schema`, `notify:unit/channels/secrets` | covered |
| FR-NOT-03 | Credentials by reference | Must | verified locally | `pgtap:26_notify_schema`, `pgtap:31_notify_access`, `notify:unit/channels/secrets` | covered |
| FR-NOT-04 | Rule catalogue | Must | verified locally | `pgtap:26_notify_schema` | covered |
| FR-NOT-05 | Rule overrides by owners | Must | verified locally | `pgtap:26_notify_schema`, `pgtap:31_notify_access` | covered |
| FR-NOT-06 | Channel policies | Must | verified locally | `pgtap:26_notify_schema`, `pgtap:27_notify_policy` | covered |
| FR-NOT-07 | One outbox | Must | verified locally | `pgtap:26_notify_schema`, `pgtap:28_notify_outbox` | covered |
| FR-NOT-08 | Send decision at claim time | Must | verified locally | `pgtap:27_notify_policy`, `notify:integration/dispatch` | covered |
| FR-NOT-09 | Caps | Must | verified locally | `pgtap:27_notify_policy`, `notify:integration/dispatch` | covered |
| FR-NOT-10 | Member consent before messages | Must | verified locally | `pgtap:12_consent_and_legal`, `pgtap:28_notify_outbox`, `pgtap:31_notify_access`, `notify:unit/links` | covered |
| FR-NOT-11 | Link a Zalo Bot chat | Must | verified locally | `jobs:integration/notify-cli`, `jobs:unit/notify`, `pgtap:28_notify_outbox` | covered |
| FR-NOT-12 | Link a login e-mail | Must | in build | `jobs:integration/notify-cli`, `pgtap:28_notify_outbox` | covered |
| FR-NOT-13 | Zalo Bot channel | Must | verified locally | `notify:unit/channels/zalo-bot`, `notify:unit/channels/timed-fetch`, `notify:integration/dispatch` | covered |
| FR-NOT-14 | E-mail channel | Must | in build | `notify:unit/channels/brevo` | covered |
| FR-NOT-15 | Resend, Telegram and webhook | Could | planned | planned | planned |
| FR-NOT-16 | Test message | Must | verified locally | `jobs:integration/notify-cli` | covered |
| FR-NOT-17 | Notification status | Should | verified locally | `jobs:integration/notify-cli`, `jobs:unit/notify` | covered |
| FR-NOT-18 | Unlink and withdraw | Must | in build | `jobs:integration/notify-cli`, `pgtap:26_notify_schema` | covered |
| FR-NOT-19 | Digest equals Ngày | Must | in build | `notify:unit/digest/model`, `notify:live/digest-equals-ngay`, `notify:integration/digests-and-alerts` | partial |
| FR-NOT-20 | When the digest goes out | Must | in build | `pgtap:30_notify_digests`, `notify:integration/digests-and-alerts` | covered |
| FR-NOT-21 | Digest command and schedule | Must | in build | `jobs:unit/digest-and-alerts`, `pgtap:30_notify_digests` | covered |
| FR-NOT-22 | Digest attention lines | Must | in build | `notify:unit/rules/day`, `notify:integration/digests-and-alerts`, `pgtap:29_notify_alerts` | covered |
| FR-NOT-23 | Alert episodes | Must | in build | `pgtap:29_notify_alerts` | covered |
| FR-NOT-24 | One alert for a credential failure | Must | in build | `pgtap:29_notify_alerts`, `jobs:integration/notify-cli`, `runner:unit/incremental-run` | covered |
| FR-NOT-25 | Runner notifications in the outbox | Must | in build | `notify:unit/outbox`, `notify:integration/digests-and-alerts`, `pgtap:29_notify_alerts` | partial |
| FR-NOT-26 | Job failure alerts | Must | in build | `jobs:unit/digest-and-alerts`, `jobs:integration/notify-cli`, `pgtap:29_notify_alerts` | partial |
| FR-NOT-27 | Channel and digest failures | Should | in build | `pgtap:29_notify_alerts`, `pgtap:30_notify_digests`, `notify:integration/digests-and-alerts` | covered |
| FR-NOT-28 | Retries without double sends | Must | verified locally | `pgtap:28_notify_outbox`, `notify:unit/dispatch/cycle`, `notify:integration/dispatch` | covered |
| FR-NOT-29 | Dispatch from Actions | Must | verified locally | `notify:unit/dispatch/cycle`, `jobs:unit/notify` | covered |
| FR-NOT-30 | Dispatch from Supabase | Must | planned | planned | planned |
| FR-NOT-31 | Intraday rules | Should | planned | planned | planned |
| FR-NOT-32 | Digest corrections | Should | planned | `notify:unit/digest/model` (fingerprint); correction planned | partial |
| FR-NOT-33 | Cảnh báo settings and Bản tin panel | Must | designed | planned | planned |
| FR-NOT-34 | Message content | Must | in build | `notify:unit/render/digest`, `notify:unit/render/templates`, `notify:unit/render/format`, `notify:unit/render/alert` | covered |
| FR-NOT-35 | Zalo OA and group channels | Should | planned | planned | planned |
| FR-NOT-36 | Staff alert rules | Should | planned | planned | planned |
| FR-NOT-37 | Free channels first | Must | planned | planned | planned |
| FR-NOT-38 | Activity monitors | Should | planned | planned | planned |
| FR-NOT-39 | Customer messaging rules | Must | planned | planned | planned |
| FR-NOT-40 | Customer templates | Must | planned | planned | planned |
| FR-NOT-41 | Messaging cost report | Should | planned | planned | planned |
| FR-NOT-42 | Notification operations commands | Should | planned | planned | planned |

#### FR-OPS — Operations: backups, deploys, monitoring

| ID | Requirement | Priority | Status | Verified by today | Coverage |
|---|---|---|---|---|---|
| FR-OPS-01 | Continuous integration | Must | verified locally | `.github/workflows/ci.yml`, verification commands in `docs/status.md` | partial |
| FR-OPS-02 | Migrations by workflow | Must | waits for owner | `.github/workflows/migrate.yml`; owner run | owner check |
| FR-OPS-03 | Web deploy | Must | built | `.github/workflows/deploy-web.yml`, `e2e:pages/install` | partial |
| FR-OPS-04 | Edge Function deploy | Must | waits for owner | `.github/workflows/deploy-functions.yml`, `node scripts/function-imports.mjs --check` | owner check |
| FR-OPS-05 | Encrypted weekly backups | Must | waits for owner | `.github/workflows/backup.yml`; owner run | owner check |
| FR-OPS-06 | Guard against a linked reset | Must | planned | planned (no guard in the repository; request R-Q01) | planned |
| FR-OPS-07 | Restore drill | Must | planned | planned | planned |
| FR-OPS-08 | Health check | Must | verified locally | `jobs:unit/doctor`, `jobs:unit/incremental-checks` | covered |
| FR-OPS-09 | Scheduled workflows kept active | Must | built | `.github/workflows/workflows-active.yml`; its only run on GitHub so far, on 2026-11-09, failed (request R-P01) | partial |
| FR-OPS-10 | Cron delay probes | Should | built | `.github/workflows/cron-probe-peak.yml`, `.github/workflows/cron-probe-offpeak.yml`; the report misattributes late runs (request R-P03), so the measured delays are in [operations.md, section 2.3](operations.md#23-how-late-github-starts-scheduled-runs) | partial |
| FR-OPS-11 | Go-live checklist | Must | waits for owner | owner run of `docs/go-live.md` | owner check |
| FR-OPS-12 | Notification go-live step | Must | planned | planned (request R-F13) | planned |
| FR-OPS-13 | Staging and stable end-to-end runs | Must | planned | planned | planned |
| FR-OPS-14 | Resilience paths | Should | planned | planned | planned |
| FR-OPS-15 | Runbook and handover | Must | planned | planned | planned |
| FR-OPS-16 | Launch stability | Must | planned | planned | planned |
| FR-OPS-17 | Paperwork renewals runbook | Should | planned | planned | planned |

#### FR-CMP — Legal compliance

| ID | Requirement | Priority | Status | Verified by today | Coverage |
|---|---|---|---|---|---|
| FR-CMP-01 | Consent ledger | Must | verified locally | `pgtap:12_consent_and_legal`, `web:settings/legal/legal-editor` (each version shows the label consent records store) and `e2e:live/settings-manual` (a published text frozen; #164) | covered |
| FR-CMP-02 | Consent checked before a send | Must | verified locally | `pgtap:27_notify_policy` | covered |
| FR-CMP-03 | Data-subject request deadlines | Must | verified locally | `pgtap:12_consent_and_legal` | covered |
| FR-CMP-04 | Data-subject tooling | Must | planned | planned | planned |
| FR-CMP-05 | Breach runbook | Must | planned | planned | planned |
| FR-CMP-06 | Message log kept a year | Must | verified locally | `pgtap:26_notify_schema`, `pgtap:28_notify_outbox` | covered |
| FR-CMP-07 | Anti-spam floor for advertising | Must | verified locally | `pgtap:26_notify_schema` | covered |
| FR-CMP-08 | Operational messages kept apart | Must | verified locally | `pgtap:26_notify_schema`, `pgtap:27_notify_policy` | covered |
| FR-CMP-09 | Legal form and cross-border decision | Must | waits for owner | `pgtap:01_schema` (column); owner decision, `pgtap:38_settings_writes`, `web:pages/settings/cua-hang-page` and `e2e:demo/settings-cua-hang` (the legal form saved by an owner only, with its dated line; #159) | owner check |
| FR-CMP-10 | E-invoice status flagged | Must | in build | `pgtap:01_schema` (columns); the Cửa hàng page saves the e-invoice status and the receipt numbering with the data's suggestion (`web:pages/settings/cua-hang-page`, `e2e:live/settings`; #159), the data-quality page planned (#158), `pgtap:38_settings_writes`, `pgtap:37_shift_and_quality_functions` (`data_quality_summary` returns each store's e-invoice status), `demo-analytics:parity/data-quality-summary` (#157), `reports:unit/themes/quality/compliance` (every e-invoice state, eight receipt-numbering cases, the three notices), `demo-analytics:themes/quality.smoke` (only the young store's row), `e2e:demo/theme-chat-luong` (the young store flagged, opening Cửa hàng), `e2e:live/themes` (the seeded coffee store `not_configured` flagged, configured stores not; #158) | covered |
| FR-CMP-11 | Redemptions on the e-invoice | Must | planned | planned | planned |
| FR-CMP-12 | Discount caps | Must | in build | `core:unit/promotion-rules`, `reports:unit/themes/rules`, `demo-analytics:parity/promotion-compliance`, `demo-analytics:parity/item-discount-days` (#152), `reports:unit/themes/promotions/rules` (item and bill discounts over the cap, vouchers, gifts and free invoices apart, every legal basis of a range named with its dates, discount days counted around 26/06/2026 with gift and voucher days never added, years before 2023 not counted), `demo-analytics:themes/promotions.smoke`, `web:i18n/theme-keys`, `e2e:demo/theme-khuyen-mai` (the cap and discount-day cards; #153), `datapack:pack/context` (the data pack's context holds only the rules in force in the tenant's country on the as-of day: the 50 % cap and the lucky-draw registration, never the 120-day limit after 25 June 2026; every rule sentence in both languages with its legal basis and check date; #134) | partial |
| FR-CMP-13 | No cash-like rewards | Must | planned | planned | planned |
| FR-CMP-14 | Lucky-draw warning | Should | built | `core:unit/promotion-rules`, `reports:unit/themes/rules`; `promotion_catalogue` returns the names the warning reads (`pgtap:36_promotion_functions`), `demo-analytics:parity/promotion-catalogue` (#152), `reports:unit/themes/promotions/rules` (exact match, a name without tone marks a possible match, no warning without a keyword), `demo-analytics:unit/dressing` and `demo-analytics:parity/promotion-catalogue` (a dressed demo promotion named for a lucky draw, equal in both engines), `e2e:demo/theme-khuyen-mai` (the warning shows with its name and check date, axe with it on screen; #153) | covered |
| FR-CMP-15 | Loyalty programme notification check | Must | planned | planned | planned |
| FR-CMP-16 | Marketing consent and opt-out | Must | planned | planned | planned |
| FR-CMP-17 | Privacy notice | Must | waits for owner | owner action; the Pháp lý page built (#164), `e2e:demo/settings-phap-ly` and `e2e:live/settings-manual` (a privacy notice drafted, published and retired on the Pháp lý page; #164) | owner check |
| FR-CMP-18 | Staff notice and consent | Must | planned | planned (purpose exists: `pgtap:01_schema`) | planned |
| FR-CMP-19 | Loyalty card content | Must | planned | planned | planned |
| FR-CMP-20 | Data protection officer decision | Should | waits for owner | owner decision | owner check |

#### FR-STF — Staff app (Track B)

| ID | Requirement | Priority | Status | Verified by today | Coverage |
|---|---|---|---|---|---|
| FR-STF-01 | Brand configuration | Must | planned | planned | planned |
| FR-STF-02 | Mini App session | Must | planned | planned | planned |
| FR-STF-03 | Phone-number token | Must | planned | planned | planned |
| FR-STF-04 | OA webhook | Must | planned | planned | planned |
| FR-STF-05 | Token jobs | Must | planned | planned | planned |
| FR-STF-06 | CORS and API domain | Must | planned | planned | planned |
| FR-STF-07 | Mini App builds per tenant | Must | planned | planned | planned |
| FR-STF-08 | Phone-consent probe | Should | planned | planned | planned |
| FR-STF-09 | Staff roster | Must | planned | planned | planned |
| FR-STF-10 | Pairing | Must | planned | planned | planned |
| FR-STF-11 | Onboarding and refusal | Must | planned | planned | planned |
| FR-STF-12 | Operations RLS | Must | planned | planned | planned |
| FR-STF-13 | Role-scoped home | Must | planned | planned | planned |
| FR-STF-14 | No outbound links | Must | planned | planned | planned |
| FR-STF-15 | Checklists | Must | planned | planned | planned |
| FR-STF-16 | Cash count at close | Must | planned | planned | planned |
| FR-STF-17 | Handover and incidents | Should | planned | planned | planned |
| FR-STF-18 | Operations pages on the web | Should | planned | planned | planned |
| FR-STF-19 | Announcements | Must | planned | planned | planned |
| FR-STF-20 | Approval queue | Should | planned | planned | planned |
| FR-STF-21 | First review and permissions | Must | planned | owner check in the Zalo console | planned |
| FR-STF-22 | Internal publish | Must | planned | planned | planned |
| FR-STF-23 | Second review with the loyalty tools | Must | planned | owner check in the Zalo console | planned |

#### FR-LOY — Loyalty and customer app (Track C)

| ID | Requirement | Priority | Status | Verified by today | Coverage |
|---|---|---|---|---|---|
| FR-LOY-01 | Phone-capture KPI | Must | planned | planned | planned |
| FR-LOY-02 | Rail facts settled | Must | planned | planned | planned |
| FR-LOY-03 | Programme configuration | Must | planned | planned | planned |
| FR-LOY-04 | Rail per store | Must | planned | planned | planned |
| FR-LOY-05 | Voucher callback | Must | planned | planned | planned |
| FR-LOY-06 | Fallback rail | Must | planned | planned | planned |
| FR-LOY-07 | Member on the synced invoice | Must | planned | planned | planned |
| FR-LOY-08 | Append-only ledger | Must | planned | planned | planned |
| FR-LOY-09 | Matching paths | Must | planned | planned | planned |
| FR-LOY-10 | Fast-lane sync | Should | planned | planned | planned |
| FR-LOY-11 | Anti-fraud rules | Must | planned | planned | planned |
| FR-LOY-12 | Clawback | Must | planned | planned | planned |
| FR-LOY-13 | Liability and breakage | Should | planned | planned | planned |
| FR-LOY-14 | Incrementality | Could | planned | planned | planned |
| FR-LOY-15 | Loyalty pages | Should | planned | planned | planned |
| FR-LOY-16 | Staff loyalty tools | Must | planned | planned | planned |
| FR-LOY-17 | Browse first | Must | planned | planned | planned |
| FR-LOY-18 | Wallet and member code | Must | planned | planned | planned |
| FR-LOY-19 | Store links and session | Must | planned | planned | planned |
| FR-LOY-20 | Listing assets | Must | planned | planned | planned |
| FR-LOY-21 | Join and earn end to end | Must | planned | planned | planned |
| FR-LOY-22 | Coupon catalogue | Must | planned | planned | planned |
| FR-LOY-23 | Voucher wallet | Must | planned | planned | planned |
| FR-LOY-24 | Redemption reconciliation | Should | planned | planned | planned |
| FR-LOY-25 | OA enrolment | Should | planned | planned | planned |
| FR-LOY-26 | Pilot dashboard | Must | planned | planned | planned |
| FR-LOY-27 | Publish the customer Mini App | Must | planned | owner check in the Zalo console | planned |
| FR-LOY-28 | Store materials | Should | planned | planned | planned |
| FR-LOY-29 | Till materials for phone capture | Should | planned | planned | planned |

#### FR-POR — Portability

| ID | Requirement | Priority | Status | Verified by today | Coverage |
|---|---|---|---|---|---|
| FR-POR-01 | Configuration over code | Must | verified locally | `scripts/check-public-safe.mjs`, `e2e:demo/demo`, `pgtap:35_mappings_and_catch_up`, `web:settings/thresholds/fields`, `e2e:demo/settings-bao-cao`, `web:settings/roles/roles` (roles are rows per POS item type), `core:unit/promotion-rules`, `web:settings/thresholds/fields`, `web:settings/thresholds/thresholds-form` and `e2e:demo/theme-khuyen-mai` (the promotion pre-period weeks saved on Ngưỡng báo cáo reach the lift; #191) | covered |
| FR-POR-02 | Another store or account | Must | verified locally | `jobs:integration/local-stack`, `sync:unit/master-data` | covered |
| FR-POR-03 | Another POS | Must | built | conformance suite (`@fnb/connector-core/conformance`) | partial |
| FR-POR-04 | Onboarding wizard | Should | planned | planned | planned |
| FR-POR-05 | CSV onboarding | Should | planned | planned | planned |
| FR-POR-06 | Deployment doctor | Should | planned | planned | planned |
| FR-POR-07 | Demo seed command | Should | planned | planned | planned |
| FR-POR-08 | Store and connection settings | Should | planned | planned | planned |
| FR-POR-09 | Deploy-your-own guides | Must | planned | planned | planned |
| FR-POR-10 | Base path by configuration | Must | verified locally | `e2e:pages/install`, `web:shell/install-assets` | covered |
| FR-POR-11 | Scheduler and host by choice | Should | built | `runner:unit/incremental-run`, `jobs:unit/incremental-checks` | partial |
| FR-POR-12 | Brands by configuration | Should | planned | planned | planned |

### 9.4 Non-functional requirements

#### NFR-SEC — Security

| ID | Requirement | Priority | Status | Verified by today | Coverage |
|---|---|---|---|---|---|
| NFR-SEC-01 | RLS on every table | Must | verified locally | `pgtap:03_rls_enabled` (56 tables) | partial |
| NFR-SEC-02 | Only the publishable key in the browser | Must | verified locally | `apps/web/scripts/check-bundle.mjs` | covered |
| NFR-SEC-03 | Credentials outside the database | Must | verified locally | `pgtap:06_anon_and_tokens`, `pgtap:19_sale_payloads`, `pgtap:26_notify_schema` | covered |
| NFR-SEC-04 | Single-use tickets for scheduled calls | Must | verified locally | `pgtap:20_incremental_schedule` | covered |
| NFR-SEC-05 | TLS to the database | Must | built | `sync:unit/postgres-client` (the rule; the Edge Function applies it); the CLI refusal is open (requests R-AS06, R-T02) | partial |
| NFR-SEC-06 | Redaction | Must | verified locally | `sync:unit/helpers`, `sync:unit/run-bookkeeping`, `runner:unit/notifier` | covered |
| NFR-SEC-07 | Masking on GitHub Actions | Must | in build | `jobs:unit/config`, `jobs:unit/cli` (the POS entries, `IPOS_APP_KEY`, the secret key and the database URL, verified locally since phase 5); `jobs:unit/digest-and-alerts` (the `NOTIFY_*` credentials and the fallback targets, step 12b, in build) | covered |
| NFR-SEC-08 | Secrets only on the steps that need them | Must | built | review of the two workflow files | partial |
| NFR-SEC-09 | Hardened database functions | Must | built | `pgtap:06_anon_and_tokens`, `pgtap:23_report_access`, `pgtap:31_notify_access` (grants); `pgtap:13_analytics_schema`, `pgtap:18_metric_value`, `pgtap:19_sale_payloads`, `pgtap:22_report_functions` (definer and `search_path` of their own functions); a read-only catalogue query and `supabase db advisors` on 2026-11-12; no pgTAP audit covers every function yet (request R-T01), `pgtap:34_theme_access`, `pgtap:38_settings_writes`, `pgtap:37_shift_and_quality_functions` (the data-quality functions' signatures and settings), `pgtap:40_pack_functions` (security invoker, empty search path, grants; #132) | partial |
| NFR-SEC-10 | No reliance on HTTP security headers | Should | built | ADR-023, `apps/web/scripts/check-bundle.mjs` | partial |
| NFR-SEC-11 | SMTP and SSL on the cloud project | Must | waits for owner | owner check | owner check |
| NFR-SEC-12 | Key rotation | Must | planned | planned | planned |
| NFR-SEC-13 | Signed inbound calls | Must | planned | planned | planned |
| NFR-SEC-14 | Refused in CI | Must | in build | `jobs:unit/cli`, `jobs:unit/notify` (verified locally); `jobs:unit/digest-and-alerts` (`digest --show-text`, step 12b, in build) | covered |
| NFR-SEC-15 | New key scheme | Should | built | `docs/secrets.md`, `apps/jobs/src/config/config.ts` | partial |

#### NFR-PRV — Privacy

| ID | Requirement | Priority | Status | Verified by today | Coverage |
|---|---|---|---|---|---|
| NFR-PRV-01 | Counts-only output | Must | verified locally | `jobs:unit/account-numbers`, `jobs:unit/cli`, `runner:unit/incremental-run`, `runner:unit/notifier`, `notify:unit/outbox`, `reports:live/theme-live-check` (booleans, counts and durations only), `reports:live/theme-live-check` (booleans, counts and durations only, stores by position; #166) | covered |
| NFR-PRV-02 | Opaque recipients, count-only facts | Must | verified locally | `pgtap:26_notify_schema`, `pgtap:29_notify_alerts` | covered |
| NFR-PRV-03 | Message content retention | Must | verified locally | `pgtap:28_notify_outbox` | covered |
| NFR-PRV-04 | Former members redacted | Must | verified locally | `pgtap:28_notify_outbox` | covered |
| NFR-PRV-05 | No third-party tracking | Must | verified locally | `e2e:demo/report-day`, `e2e:demo/report-year`, `apps/web/index.html`, `e2e:demo/theme-khuyen-mai` (#191) | partial |
| NFR-PRV-06 | Customer data for data roles only | Must | verified locally | `pgtap:04_tenant_isolation`, `pgtap:06_anon_and_tokens`, `pgtap:08_publisher_role`, `pgtap:39_theme_access_b` (customer and consent counts of `data_quality_summary` for data roles only), `reports:unit/themes/quality/customers` (customer cells are counts only; #158), `web:exports/columns`, `web:exports/reader` and `web:exports/run` (personal columns and the shift name neither requested nor written unless "Kèm thông tin cá nhân" is ticked for that export; #140), `web:pages/exports/exports-page` (the box offered only to an owner or a manager with every store in scope; #141), `e2e:live/exports` (no personal data by default, a store-limited manager without the box) | covered |
| NFR-PRV-07 | Minimal Zalo-derived data | Must | planned | planned | planned |

#### NFR-PERF — Performance

| ID | Requirement | Priority | Status | Verified by today | Coverage |
|---|---|---|---|---|---|
| NFR-PERF-01 | Initial bundle | Must | verified locally | `apps/web/scripts/check-size.mjs`, `web:test/lazy-chunks` | covered |
| NFR-PERF-02 | Lighthouse performance | Must | verified locally | Lighthouse recipe in `apps/web/README.md` | partial |
| NFR-PERF-03 | Largest contentful paint recorded | Should | built | Lighthouse recipe in `apps/web/README.md` | partial |
| NFR-PERF-04 | Report query time | Must | verified locally | phase 8 and 9 measurements (`docs/schema.md`); `reports:live/theme-live-check` check 1 (theme budgets); the 10b promotion and shift functions timed warm on the local tenant within their budgets (#150); the data-quality functions within their budgets (#156), `reports:live/theme-live-check` check 1 and `reports:unit/themes/live-checks` (each of the eight theme pages at its default and longest range timed alone after the queue is idle, every planned function timed, the 10b call budgets of the build spec, the page's 600 ms and any call's 1,500 ms; #166) | covered |
| NFR-PERF-05 | Refresh time on production | Must | waits for owner | `pgtap:14_analytics_refresh` (local timing); cloud measurement | partial |
| NFR-PERF-06 | Slow phones | Should | verified locally | `e2e:pages/report-year-performance` | covered |
| NFR-PERF-07 | Incremental run within the Free plan | Must | verified locally | `sync:unit/run-guard`, `runner:unit/budget` | partial |
| NFR-PERF-08 | Notification cycle budgets | Must | verified locally | `notify:unit/dispatch/cycle` | covered |
| NFR-PERF-09 | Mini App budgets | Must | planned | planned | planned |

#### NFR-AVL — Availability and data freshness

| ID | Requirement | Priority | Status | Verified by today | Coverage |
|---|---|---|---|---|---|
| NFR-AVL-01 | Freshness during opening hours | Must | waits for owner | owner check after go-live step 6 | owner check |
| NFR-AVL-02 | Independent of GitHub's scheduler | Must | verified locally | `pgtap:20_incremental_schedule`, `.github/workflows/sync.yml` | covered |
| NFR-AVL-03 | No silent pause | Must | verified locally | `jobs:unit/doctor` | covered |
| NFR-AVL-04 | Failures stay contained | Must | verified locally | `sync:unit/run-bookkeeping`, `sync:unit/incremental`, `runner:unit/notifier`, `notify:unit/outbox` | covered |

#### NFR-COST — Cost

| ID | Requirement | Priority | Status | Verified by today | Coverage |
|---|---|---|---|---|---|
| NFR-COST-01 | Free tiers during build and pilot | Must | built | `docs/go-live.md`, `docs/secrets.md` | partial |
| NFR-COST-02 | No paid AI API | Must | built | `docs/secrets.md`; review | partial |
| NFR-COST-03 | Database size | Must | verified locally | phase 7 verification, `fnb doctor` | covered |
| NFR-COST-04 | Upgrade trigger | Must | verified locally | `jobs:unit/doctor` | covered |
| NFR-COST-05 | Function invocations | Should | built | `pgtap:20_incremental_schedule` (store selection) | partial |
| NFR-COST-06 | Egress budget | Should | built | `.github/workflows/backup.yml` (the encrypted archive's size in the job summary, read after go-live: OC-09), `web:exports/estimate` (call A's counts × the bytes per row against the Free plan's 5 GB, the question above 100 MB, the device's monthly tally surviving a refused `localStorage`), `web:exports/reader` (the bytes received, measured per page), `web:pages/exports/export-tab` (the estimate and the MB received on screen; #140, #141) | partial |

#### NFR-A11Y — Accessibility

| ID | Requirement | Priority | Status | Verified by today | Coverage |
|---|---|---|---|---|---|
| NFR-A11Y-01 | No serious axe violations | Must | verified locally | `apps/web/e2e/support/checks.ts`, `e2e:demo/demo`, `e2e:demo/report-day`, `e2e:demo/settings-bao-cao`, `e2e:demo/settings-phan-loai`, `e2e:demo/settings-cua-hang` (#159), `e2e:demo/settings-phan-loai` (the Nhóm của món and Loại thanh toán tabs at 360 and 1280 px; #160), `e2e:demo/theme-ca-ket-tien` (#155), `e2e:demo/theme-khuyen-mai` (#191), `e2e:demo/theme-so-sanh` (#193), `e2e:demo/settings-ngay-le` (Ngày lễ and both slots at 360 and 1280 px, light and dark; #106), `e2e:demo/theme-ca-ket-tien` (the cashier card at 360 and 1280 px, light and dark; #192), `e2e:demo/theme-chat-luong` (#158), `e2e:demo/theme-khuyen-mai` (the rule cards and the lucky-draw warning at 360 and 1280 px, light and dark; #153), `e2e:demo/settings-phap-ly` (#164), `e2e:live/settings-roles` (every settings page read-only at 360 and 1280 px on the live stack, as staff, the viewer and the other logins where they cannot write; #165) | covered |
| NFR-A11Y-02 | Lighthouse accessibility | Must | verified locally | Lighthouse recipe in `apps/web/README.md` | covered |
| NFR-A11Y-03 | Contrast | Must | verified locally | `apps/web/e2e/support/checks.ts`, `design-tokens:tokens` | covered |
| NFR-A11Y-04 | Charts have tables | Must | verified locally | `web:components/report-card/report-card`, `e2e:demo/theme-so-sanh` (#193) | covered |
| NFR-A11Y-05 | Keyboard and screen readers | Should | verified locally | `web:reports/period-navigator`, `e2e:demo/demo`, `web:themes/theme-param-controls` | covered |

#### NFR-I18N — Internationalisation

| ID | Requirement | Priority | Status | Verified by today | Coverage |
|---|---|---|---|---|---|
| NFR-I18N-01 | Vietnamese first, English second | Must | verified locally | `web:i18n/i18n`, `web:i18n/report-keys`, `web:i18n/theme-keys`, `web:i18n/wording-sheets`, `e2e:live/today`, `e2e:demo/demo`, `e2e:demo/settings-cua-hang` (#159), `e2e:demo/theme-ca-ket-tien` (#155), `e2e:demo/theme-khuyen-mai` (#191), `e2e:demo/theme-chat-luong` (#158), `e2e:demo/settings-phap-ly` (#164) | covered |
| NFR-I18N-02 | Formatting by locale and currency | Must | verified locally | `web:lib/format`, `notify:unit/render/format`, `web:settings/number-text`, `web:settings/forms/money-field`, `web:lib/csv`, `web:settings/manual/costs` and `costs-tab` (whole đồng, fractions refused and never rounded, `12.000 ₫`, `30,0%`, dd/MM/yyyy) and `e2e:demo/settings-gia-von` (the numeric keyboard and `50.000`; #161), `web:settings/manual/cost-import` (whole đồng, fractions refused and never rounded, dd/MM/yyyy; #162), `web:settings/manual/targets-tab` and `web:settings/fees/fees-tab` (`1,1%`, `1.000 ₫`, Tháng 11/2026; #163) | covered |
| NFR-I18N-03 | Registry spelling | Should | verified locally | `web:i18n/i18n` | covered |
| NFR-I18N-04 | Notification language | Should | in build | `notify:unit/render/templates` | covered |
| NFR-I18N-05 | Time zones and day starts | Must | verified locally | `core:unit/business-date`, `core:unit/wall-clock`, `sync:unit/incremental-window`, `pgtap:20_incremental_schedule`, `pgtap:27_notify_policy`, `pgtap:30_notify_digests`, `web:exports/columns` and `web:exports/reader` (exported local times in each store's zone, shifts cut at the business-day starts of the month; #139, #140), `web:exports/archive` and `web:exports/run` (the same archive bytes in two time zones; #140), `datapack:pack/environment` (the same pack bytes in child processes under UTC, Asia/Ho_Chi_Minh and America/Los_Angeles), `datapack:pack/request` (the default as-of day: the earliest last complete business day over the stores' time zones and day starts), `datapack:pack/tables/hours` (hour columns ordered from a 05:00 day start) and `datapack:pack/tables/shifts` (shifts banded by the local hour they opened in the store's zone, the night band across midnight; instants with `Z`, an offset or microseconds read alike; #134) | covered |
| NFR-I18N-06 | Currency-neutral amounts | Should | built | review of the migrations | partial |

#### NFR-UX — Responsive UX

| ID | Requirement | Priority | Status | Verified by today | Coverage |
|---|---|---|---|---|---|
| NFR-UX-01 | Phone first | Must | verified locally | `apps/web/e2e/support/checks.ts`, `e2e:demo/demo`, `e2e:demo/report-month`, `web:components/report-card/table-scroller`, `web:settings/forms/save-bar`, `e2e:demo/settings-bao-cao`, `e2e:demo/settings-phan-loai`, `e2e:demo/settings-cua-hang` (#159), `e2e:demo/theme-ca-ket-tien` (#155), `e2e:demo/theme-khuyen-mai` (#191), `e2e:demo/theme-so-sanh` (#193), `e2e:demo/theme-chat-luong` and `web:components/report-card` (long text wraps in wide cards; #158) | covered |
| NFR-UX-02 | Layout on phones and desktops | Should | built | `e2e:demo/demo` (360 px) | partial |
| NFR-UX-03 | Installable | Should | verified locally | `e2e:demo/demo`, `e2e:pages/install`, `web:shell/install-assets` | covered |
| NFR-UX-04 | New version prompt | Should | built | no automated test | partial |
| NFR-UX-05 | Demo always labelled | Must | verified locally | `e2e:demo/demo`, `web:settings/demo-settings-source` and `web:settings/manual/demo-manual-source` (the demo's settings writes stay in the session's store; #105) | covered |
| NFR-UX-06 | Plain states instead of zeros | Must | verified locally | `e2e:demo/report-day`, `e2e:demo/report-month`, `web:settings/catch-up/catch-up-banner`, `web:pages/settings/settings-layout`, the So sánh card tests (no sales, no common day, no complete week, stores about even; #193), the Chất lượng dữ liệu card tests' no-data cases (#158) | covered |
| NFR-UX-07 | Mini App design rules | Must | planned | planned | planned |

#### NFR-MNT — Maintainability

| ID | Requirement | Priority | Status | Verified by today | Coverage |
|---|---|---|---|---|---|
| NFR-MNT-01 | Typed code | Must | verified locally | CI `code` job, `reports:unit/themes/contract`, `web:settings/supabase-settings-source` (every read parsed by its zod row schema; #105), `datapack:pack/schema` and `datapack:plan/front-matter` (the pack and plan types read from strict zod schemas, from which the JSON Schema files are generated; #130, #135) | covered |
| NFR-MNT-02 | Lint and format | Must | verified locally | CI `code` job | covered |
| NFR-MNT-03 | Tests at every layer | Must | verified locally | `pnpm test`, `pnpm exec supabase test db`, `pnpm --filter @fnb/web test:e2e`, `e2e:live/settings-fixture` builds and removes its own tenant (#103) | covered |
| NFR-MNT-04 | Consistency checks | Must | verified locally | `metrics:consistency/document`, `metrics:consistency/metric-value`, `web:i18n/report-keys`, `web:test/lazy-chunks`, `node scripts/function-imports.mjs --check`, `demo-analytics:parity/*`, `design-tokens:generated`, `web:test/no-raw-colours`, `pnpm docs:check-openapi`, `reports:unit/themes/contract` (argument types), `demo-analytics:unit/report-source` (a handler and a read plan for every function), `demo-analytics:parity/discount-rows` (#151), the promotion ports' parity files (#190), the catalogue, compliance and discount-day parity files (#152), the shift-adjustments parity file (#154), the data-quality parity files (#157), `demo-analytics:unit/report-source` (a handler and a read plan for the phase 11 functions; #133) | covered |
| NFR-MNT-05 | No code comments | Should | built | review | partial |
| NFR-MNT-06 | Schema drift checks | Should | planned | planned (request R-F03) | planned |
| NFR-MNT-07 | Canonical column-name lint | Should | planned | planned (request R-F03) | planned |
| NFR-MNT-08 | Local stack | Must | verified locally | `supabase/seed.sql`, `docs/status.md` | covered |
| NFR-MNT-09 | Pinned toolchain | Must | built | CI | covered |
| NFR-MNT-10 | Documents follow the code | Should | built | review; `pnpm docs:check-api` (`scripts/check-api-docs.mjs`) compares `docs/api.md` with the functions in `public` that `authenticated` may execute (not in CI yet, request R-AP01); `web:i18n/wording-sheets` holds both wording sheets (`docs/reports/cau-van-bao-cao.md`, `cau-van-chu-de.md`) equal to the message files | partial |
| NFR-MNT-11 | POS details stay in their package | Must | built | review of package dependencies | partial |

#### NFR-OBS — Observability

| ID | Requirement | Priority | Status | Verified by today | Coverage |
|---|---|---|---|---|---|
| NFR-OBS-01 | Job summaries | Must | built | `.github/workflows/*.yml`, `jobs:unit/account-numbers` | partial |
| NFR-OBS-02 | Logs in our own tables | Must | verified locally | `pgtap:01_schema`, `pgtap:20_incremental_schedule`, `pgtap:28_notify_outbox` | covered |
| NFR-OBS-03 | Notification observability | Should | verified locally | `pgtap:28_notify_outbox`, `jobs:integration/notify-cli` | covered |
| NFR-OBS-04 | Browser errors fail tests | Should | verified locally | `apps/web/e2e/support/reports.ts`, `e2e:demo/theme-ca-ket-tien` and `e2e:demo/theme-thanh-toan` (every test ends on the console check; #155), `e2e:demo/theme-khuyen-mai` (#191) | covered |

#### NFR-HYG — Public-repository hygiene

| ID | Requirement | Priority | Status | Verified by today | Coverage |
|---|---|---|---|---|---|
| NFR-HYG-01 | No identifiers in the repository | Must | verified locally | `scripts/check-public-safe.mjs`, CI `secrets` job, the settings fixture's synthetic tenant, `example.com` logins and clean scan (`e2e:live/settings-fixture`, #103) | covered |
| NFR-HYG-02 | Secret scan over the history | Must | built | CI `secrets` job (`.gitleaks.toml`) | partial |
| NFR-HYG-03 | Private material ignored | Must | verified locally | `.gitignore` | covered |
| NFR-HYG-04 | Synthetic fixtures only | Must | verified locally | `scripts/check-public-safe.mjs`, `reports:unit/themes/reference-sheet` (a synthetic reference sheet), the settings fixture's tenant, items and logins are synthetic (`example.com`, #103); the compliance cases rewrite generated sales for parity only (#151); the pack and plan fixtures of `packages/datapack/test` are synthetic, with made-up store UUIDs or `MOCK-S<n>` ids and invented items and figures (#130, #135), and so is the export fixture shared with `pgtap:41_export_totals` (#139) | covered |
| NFR-HYG-05 | Neutral keys and numbered output | Must | verified locally | `jobs:unit/account-numbers`, `jobs:unit/cli` | covered |
| NFR-HYG-06 | Preflight log lint | Could | planned | planned (masking covers the risk today, NFR-SEC-07; request R-F03) | planned |

### 9.5 Requirements without coverage

Each requirement below has no test yet. They are grouped by the phase that builds them; the planned test is the test design this plan commits to. Phases 10 and 11 follow their roadmap acceptance lines, because their detailed design is pending; Tracks B, C and D are at roadmap level.

106 requirements in 6 groups.

#### Open items of phases 1 to 9 (5)

| ID | Requirement | Phase | Planned test |
|---|---|---|---|
| FR-TEN-17 | RLS proven on the live project | P5, P20b | Run the two-tenant isolation checks against the cloud project with two throwaway users at go-live and again in the 20b launch audit; the pgTAP files 04, 17, 23 and 31 are the model. The mechanism (for example `supabase test db --remote`, which CLI 3.0.0 offers but nobody has tried here) is decided at go-live (OC-10). |
| FR-OPS-06 | Guard against a linked reset | P5 | A check that fails when a workflow or script runs `db reset --linked`, and a `db:reset` wrapper that refuses a database holding a non-demo tenant, each with a test; design pending (requests R-Q01, R-AS05). |
| NFR-MNT-06 | Schema drift checks | P1 | A CI step that runs `supabase db diff` against the migrations on the fresh stack and a generated-types drift check; owner decision D4 in [plan.md](plan.md) (request R-F03). |
| NFR-MNT-07 | Canonical column-name lint | P2, P4 | A lint that fails when a POS field name appears outside `raw` in the canonical schema; owner decision D4 (request R-F03). |
| NFR-HYG-06 | Preflight log lint | P1 | A preflight check that fails a job printing a structured secret; masking at job start covers the risk today (request R-F03). |


#### Phase 11: exports, data pack, strategy plans (7)

| ID | Requirement | Phase | Planned test |
|---|---|---|---|
| FR-EXP-07 | Download and copy buttons | P11a | A Playwright test that the downloaded file and the copied text equal the built pack. |
| FR-STR-02 | Strategy prompt in the pack | P11b | Owner check: two `/strategy` runs end to end in the owner's own assistant (OC-13); the public-safety scan and a dependency review find no API key or client. |
| FR-STR-03 | Publish a plan | P11b | An integration test that `fnb publish-plan` inserts as the publisher and reads neither the manager's login nor the secret key; `pgtap:08_publisher_role` already holds the database rule. |
| FR-STR-06 | Kế hoạch tab | P11b | A Playwright spec for the list, the Markdown detail, the KPI table and the comparison of two plans, with axe and 360 px. |
| FR-STR-07 | KPI follow-up | P11b | A live test that each KPI's current value equals `metric_value` for the plan's stores and period. |
| FR-STR-09 | Monthly routine guide | P11b | Review that the guide exists; the owner's gate G5 decision is recorded. |
| FR-STR-10 | Prompt-tuning log | P11b | Review of the three logged runs; the public-safety scan stays clean. |

#### Phase 12: step 12c and the web screens (6)

| ID | Requirement | Phase | Planned test |
|---|---|---|---|
| FR-NOT-15 | Resend, Telegram and webhook | P12 (12c) | Unit tests of the Telegram, Resend and webhook adapters (exact requests, every outcome, no secret in any outcome, the webhook signature against a fixed vector) and integration runs against the mock providers extended with those three. |
| FR-NOT-30 | Dispatch from Supabase | P12 (12c), P13 | Step 12c: pgTAP for the notify schedule (inert until enabled, enable and disable, single-use tickets); a Deno type-check and tests of the `notify` function; the function served locally answers 401 to an unknown ticket and a counts-only report to a valid one; with the schedule enabled a due message leaves within one tick without Actions. |
| FR-NOT-31 | Intraday rules | P12 (12c) | Step 12c: pgTAP cases that open and resolve `zero_sales_open` on each condition and `nightly_missing` after 30 hours, and none for a tenant without destinations. |
| FR-NOT-33 | Cảnh báo settings and Bản tin panel | P12 | pgTAP for each step 12c function the screens call (role check 42501, input check 22023); live Playwright tests: an owner edits a rule, a manager sees it read-only and mutes rules only on their own destinations, the test button sends one message to the mock provider, the Bản tin panel lists past digests. |
| FR-NOT-42 | Notification operations commands | P12 (12c) | Step 12c: CLI tests that `notify resend` creates one new row pointing at the original, that `notify check` turns red when no dispatcher ran within its schedule, and that `notify setup` records the web address. |
| FR-OPS-12 | Notification go-live step | P12 (12c) | Owner check after step 12c writes go-live step 8: the owner follows it and receives a test message (`fnb notify test` exits 0) (OC-08). |

#### Track B: phases 13 to 15 (32)

| ID | Requirement | Phase | Planned test |
|---|---|---|---|
| FR-NOT-35 | Zalo OA and group channels | P13 | Integration tests against a mock OA API and a live OA test message delivered under its policy. |
| FR-NOT-36 | Staff alert rules | P15 | pgTAP and integration tests: each staff rule fires on a synthetic case and reaches the staff destination. |
| FR-NOT-37 | Free channels first | P15 | An integration test that a closed window falls back to the Bot without a paid message; owner check that the digest reaches the group and the Bot chat three nights running; the follow-only probe recorded. |
| FR-NOT-38 | Activity monitors | P15 | pgTAP: each activity monitor fires on a synthetic case. |
| FR-CMP-18 | Staff notice and consent | P14a | pgTAP: pairing is refused without a `staff_ops` consent. |
| FR-STF-01 | Brand configuration | P13 | pgTAP on the brand configuration tables (RLS, no secret column) and the public-safety scan finding no Zalo identifier. |
| FR-STF-02 | Mini App session | P13 | Deno tests of `zalo-session` with a stubbed Zalo graph; a device check that a Development build gets a session with the right claims on the owner's phone. |
| FR-STF-03 | Phone-number token | P13 | A Deno test: a token inside its 2-minute life decodes, an expired one is refused. |
| FR-STF-04 | OA webhook | P13 | Deno tests of the signature check in observe and fail-closed modes and of the answer within 2 seconds; a live OA test message verified and logged. |
| FR-STF-05 | Token jobs | P13 | pgTAP or unit tests of the single-row refresh lock; two automatic refreshes and one developer-token rotation observed on the real accounts. |
| FR-STF-06 | CORS and API domain | P13 | An integration check of the CORS answer for `https://h5.zdn.vn` and a real-device check inside Zalo. |
| FR-STF-07 | Mini App builds per tenant | P13 | CI builds one Mini App per brand from configuration; a check that no ECharts is bundled and that the browsable flags are right. |
| FR-STF-08 | Phone-consent probe | P13 | The probe result recorded with a test user before phase 18a starts. |
| FR-STF-09 | Staff roster | P14a | A Playwright test of the admin page: a manager adds and deactivates a staff member. |
| FR-STF-10 | Pairing | P14a | A Mini App test in browser mode with a mocked Zalo SDK (code valid 10 minutes; an unpaired user sees only onboarding) and pgTAP on the pairing function. |
| FR-STF-11 | Onboarding and refusal | P14a | A Mini App test: refusing leaves a usable screen with the contact instructions. |
| FR-STF-12 | Operations RLS | P14a | A pgTAP RLS suite for the operations tables: no cross-store or cross-role read. |
| FR-STF-13 | Role-scoped home | P14a | A Mini App test: a manager sees revenue cards; staff see only what the owner allows. |
| FR-STF-14 | No outbound links | P14a, P18a | A link scan of every Mini App screen that finds no outbound link. |
| FR-STF-15 | Checklists | P14b | An integration test that a checklist item changed in the dashboard appears in the app without a redeploy; a unit test of the photo resize. |
| FR-STF-16 | Cash count at close | P14b | An integration test that a deliberate 50,000 ₫ variance alerts the manager within one sync cycle. |
| FR-STF-17 | Handover and incidents | P14b | A Mini App test: a report is acknowledged and appears in the incident log. |
| FR-STF-18 | Operations pages on the web | P14b | A Playwright test that one full day at one store across three shifts appears on the web pages. |
| FR-STF-19 | Announcements | P15 | Owner check: every staff member receives a test announcement and at least 80 % tap "Đã đọc" within a day. |
| FR-STF-20 | Approval queue | P15 | A Mini App and pgTAP test: a request is approved or refused from the queue and the requester sees the result. |
| FR-STF-21 | First review and permissions | P15 | Owner check in the Zalo console: the review passed and the approved permissions are confirmed there. |
| FR-STF-22 | Internal publish | P15 | A device check: the app cannot be found by search and opens from the QR. |
| FR-POR-12 | Brands by configuration | P13 | CI builds a second brand's Mini App from configuration only. |
| NFR-SEC-13 | Signed inbound calls | P13, P16b | Deno tests: an unsigned or wrongly signed OA event is refused after the observe period; the voucher callback refuses a wrong path, a replayed transaction id and an amount out of range. |
| NFR-PRV-07 | Minimal Zalo-derived data | P13 | pgTAP on the Zalo-derived columns (Zalo id, display name, phone only) and a schema review. |
| NFR-PERF-09 | Mini App budgets | P13, P18a | A CI budget check that fails a Mini App build over any budget, and the simulator gates for LCP and page load. |
| NFR-UX-07 | Mini App design rules | P14a | A design review of every screen at the first Testing submission, and Mini App tests in browser mode for the tab count and touch-target sizes. |

#### Track C: phases 16 to 19 (42)

| ID | Requirement | Phase | Planned test |
|---|---|---|---|
| FR-ANA-17 | Customer metrics | P8, P17 | pgTAP and unit tests of each customer metric on a synthetic tenant with identified customers, each against a hand calculation. |
| FR-NOT-39 | Customer messaging rules | P19a | pgTAP on the send decision: no promotional message without marketing consent; an integration test that a customer who messaged the OA gets a free confirmation and no paid message for the same event. |
| FR-NOT-40 | Customer templates | P19a | Owner check that every template is approved; a timed check that a voucher issued in the Mini App arrives as a template message within 2 minutes. |
| FR-NOT-41 | Messaging cost report | P19a | A unit test of the cost report against the price table; owner check of the projection against the agreed budget. |
| FR-OPS-17 | Paperwork renewals runbook | P19b | Review: each renewal in the runbook has a dated reminder. |
| FR-CMP-04 | Data-subject tooling | P17a | pgTAP: deleting a synthetic customer removes every dependent row and logs the request against its deadline; Playwright on the consent view. |
| FR-CMP-05 | Breach runbook | P17a | Review of the runbook and a timed dry run against the 72-hour clock with the owner. |
| FR-CMP-11 | Redemptions on the e-invoice | P16b, P18b | A live check with the owner at the till: a test redemption appears on the synced invoice as a discount or a 0-price line. |
| FR-CMP-13 | No cash-like rewards | P18b | A unit and pgTAP test that no cash-like reward type can be saved. |
| FR-CMP-15 | Loyalty programme notification check | P16a, P19b | pgTAP: a programme cannot launch until the notification decision is stored with it. |
| FR-CMP-16 | Marketing consent and opt-out | P18a, P19a | A Mini App test that the marketing toggle is never pre-ticked, and pgTAP that no promotional message is enqueued after "Dừng nhận tin". |
| FR-CMP-19 | Loyalty card content | P18a | A Mini App test that the wallet shows the programme name, the customer's identity and the purchase quantity or value. |
| FR-STF-23 | Second review with the loyalty tools | P17b | Owner check in the Zalo console: the new Testing version with the loyalty tools is submitted and its review outcome recorded. |
| FR-LOY-01 | Phone-capture KPI | P16a | A unit or pgTAP test of the per-shift member-attached share; owner check that at least 20 invoices per store carry a phone after one week. |
| FR-LOY-02 | Rail facts settled | P16a | Owner check: each answer recorded privately with its evidence before gate G2. |
| FR-LOY-03 | Programme configuration | P16a | pgTAP: a changed programme parameter changes the next earn without a deploy. |
| FR-LOY-04 | Rail per store | P16 | pgTAP and an integration test: switching a store's rail needs no code change. |
| FR-LOY-05 | Voucher callback | P16b | Deno tests of `voucher-callback` (discount returned, second use refused, idempotency, amount checks); a 100-code pool round trip; a live code typed at the POS. |
| FR-LOY-06 | Fallback rail | P16b | A live check: a test discount entry appears by name on the synced invoice. |
| FR-LOY-07 | Member on the synced invoice | P16b acceptance | A timed live check with a test member attached at the POS: on the synced invoice within 30 minutes. |
| FR-LOY-08 | Append-only ledger | P17a | pgTAP: replaying 30 days of invoices with 50 synthetic phones equals a hand calculation, and a re-run is idempotent. |
| FR-LOY-09 | Matching paths | P17a | pgTAP for each matching path, the rejected double claim and the double-candidate queue; a live trial of 10 check-ins, at least 9 confirmed within 10 minutes. |
| FR-LOY-10 | Fast-lane sync | P17a | A unit or pgTAP test: two requests within 5 minutes start one run. |
| FR-LOY-11 | Anti-fraud rules | P17a | pgTAP: each anti-fraud rule refuses its synthetic case. |
| FR-LOY-12 | Clawback | P17a | pgTAP: a voided invoice's earn is reversed by the nightly job. |
| FR-LOY-13 | Liability and breakage | P17a | pgTAP: the liability equals a hand calculation on synthetic balances. |
| FR-LOY-14 | Incrementality | P17a | A unit test that the uplift is reported with its comparison group. |
| FR-LOY-15 | Loyalty pages | P17a | Playwright: each loyalty page lists the synthetic fixture's rows under RLS. |
| FR-LOY-16 | Staff loyalty tools | P17b | A Mini App test: a reused redemption code is rejected with a clear message. |
| FR-LOY-17 | Browse first | P18a | A Mini App test: refusing the phone permission leaves the app usable; no screen shows a price. |
| FR-LOY-18 | Wallet and member code | P18a | Mini App and pgTAP tests: an expired member code is refused at the till; a claim moves from pending to confirmed after the sync. |
| FR-LOY-19 | Store links and session | P18a | A Mini App test: no LocalStorage use; a store's QR opens that store. |
| FR-LOY-20 | Listing assets | P18a | Review against the listing checklist: name length and words, description length, logo rules. |
| FR-LOY-21 | Join and earn end to end | P18a acceptance | Owner-led check with five test users through every live path, confirmed within 10 minutes. |
| FR-LOY-22 | Coupon catalogue | P18b | pgTAP and Playwright: a coupon above the cap cannot be saved. |
| FR-LOY-23 | Voucher wallet | P18b | An end-to-end check with the cashier: "Đã dùng" within 10 minutes, a used code shown again refused or flagged, a hold released after 24 hours. |
| FR-LOY-24 | Redemption reconciliation | P18b | pgTAP: a mismatched redemption raises an alert. |
| FR-LOY-25 | OA enrolment | P19a | An integration test: a form submission creates a customer record through the webhook. |
| FR-LOY-26 | Pilot dashboard | P19b | Owner check of the two-week pilot figures, and the weekly review run by the owner alone. |
| FR-LOY-27 | Publish the customer Mini App | P19b | Owner check in the Zalo console; the app reachable from the store and its QR. |
| FR-LOY-28 | Store materials | P19b | Review: the materials exist per store and follow the consent rules. |
| FR-LOY-29 | Till materials for phone capture | P16a | Review before the capture week; a printed receipt shows the bill number. |

#### Track D: phase 20 (14)

| ID | Requirement | Phase | Planned test |
|---|---|---|---|
| FR-CON-17 | CSV connector | P20a | The conformance suite (`runConnectorConformanceSuite`) on the CSV connector with synthetic CSV fixtures, then FR-POR-05's onboarding check. |
| FR-DQ-13 | Parallel verification before v1.0 | P20b | Seven consecutive days of owner checks against the POS reports A01, B07 and C02 per store, with the reports live check run each day (20b; OC-15). |
| FR-OPS-07 | Restore drill | P20b | The restore drill of [operations.md](operations.md) section 4.10 into a throwaway project: row counts per table equal the source at backup time; quarterly once backups exist, and in 20b. |
| FR-OPS-13 | Staging and stable end-to-end runs | P20b | A nightly Playwright run against the staging project, including the Mini Apps in browser mode with a mocked Zalo SDK; five consecutive green runs with zero flakes. |
| FR-OPS-14 | Resilience paths | P20b | Each resilience path exercised on the staging project: stale-data banner, pause recovery, token expiry, password change, schema-drift alert, OA package expiry alert. |
| FR-OPS-15 | Runbook and handover | P20b | Owner check: the owner performs "add a store", "rotate a secret", "re-run a month" and "run /strategy" from the runbook alone. |
| FR-OPS-16 | Launch stability | P20b | Seven consecutive green days in `fnb status` and the digest log, read by the verifier and the owner. |
| FR-POR-04 | Onboarding wizard | P20a | CLI tests of the wizard with a mock connector and a dry run of `onboard.yml` on the staging project. |
| FR-POR-05 | CSV onboarding | P20a | An integration test: a third store onboarded from a CSV file appears in every report without a source change. |
| FR-POR-06 | Deployment doctor | P20a | Unit tests per doctor check, all green on the staging project and red on a deliberately broken one. |
| FR-POR-07 | Demo seed command | P20a | `fnb seed-demo` on a fresh project, then the live Playwright project against it. |
| FR-POR-08 | Store and connection settings | P20a | A Playwright test: an owner sees and edits each store's connection settings. |
| FR-POR-09 | Deploy-your-own guides | P20a | A timed dry run by a second GitHub account on a fresh project: a working dashboard with demo data in under 60 minutes without editing any file. |
| NFR-SEC-12 | Key rotation | P20b | The rotation run from the runbook: every workflow's next run is green and the legacy keys are disabled (owner with the verifier, 20b). |

### 9.6 Partial coverage

55 requirements are partly covered. Each row says what the tests do not show yet and which test closes the gap.

| ID | Requirement | Status | What is missing | Planned test |
|---|---|---|---|---|
| FR-CON-10 | Documented read endpoints only | built | Review only: nothing fails automatically when a new path appears. | A unit test that lists every path the iPOS client can request (the constants under `packages/connector-ipos/src/endpoints` and the login path) and compares it with the "Endpoints used" section of `docs/connectors/ipos-fabi.md`; a new path fails until it is documented. |
| FR-CON-16 | Public connector documentation | built | The scan proves only that the documents hold no identifier; their content is reviewed. | Review at phase 16b, when the loyalty rail adds the observed field names. |
| FR-SYNC-17 | Edge Function runner | verified locally | pgTAP covers the tickets; the HTTP answers (202, 401, 429, 500, 503) were shown once, by serving the function locally at the phase 7 verification. No repeatable test exercises the handler. | A Deno test of `supabase/functions/sync-incremental/handler.ts` with a stubbed database for each answer, run in the CI `code` job next to `deno check`. |
| FR-SYNC-21 | Backfill | verified locally | The local-stack integration test backfills a week of mock data; the one-month timing (under 5 minutes) and the full history were measured once, at the phase 7 verification. | Re-measure the month timing during the go-live backfill and record it in `docs/status.md`. |
| FR-REP-12 | CSV download | verified locally | The BOM and the rows are tested on every report; opening a file in Excel is the owner's check (OC-04). | Owner check OC-04, repeated for the thematic tables (10a) and the exports (11a). |
| FR-THM-02 | Giờ & ngày trong tuần | verified locally | pgTAP, parity, the demo and live specs hold the functions and the page; `reports:live/theme-live-check` with `LIVE_REFERENCE_SHEET` prints `matches: true` for every hour, weekday, hour band and weekend share of the private reference window (2026-11-15, again at phase 10a's verification (#102) on 2026-11-16), and the page opened on the real tenant for that window shows it. | The owner's reading of Giờ & ngày beside the private sheet (OC-03, #189). |
| FR-THM-09 | Sections a POS cannot feed | built | pgTAP shows the provisional menu roles without costs and the null attach rates without a role; unit tests hold the margin card asking for costs, the attach card's dash and roles action while a role is unmapped, RevPASH only with seats and the fee card's dash without a rate; phase 10a's verification (#102) saw each of these states on the real tenant. | Sections that follow a connector's declared capabilities (no costs, no customer identity), with a connector that declares no costs and no manual costs entered (10b). |
| FR-THM-04 | Thanh toán & tiền mặt | verified locally | pgTAP shows `shift_review` and `cash_variance_flags` following the tenant's cash thresholds; the parity suite holds the demo's `shift_review` to them; the unit, engine smoke and demo specs hold the payment mix (kind shares summing to 1 and matching the methods), the cash trend, the drawer card (thresholds line, no e-mail-like text) and the fee card (the dash and the fees link without a rate); the demo spec of Ngưỡng báo cáo holds the round trip from a saved cash threshold to the drawer card's thresholds line and back to the default, and the page downloads once in the semicolon dialect. | The owner's reading of Thanh toán beside the private sheet (OC-03, #189); `reports:live/theme-live-check` prints `matches: true` for the payment mix of the reference window, compared as shares of invoices (2026-11-15, again at phase 10a's verification on 2026-11-16). |
| FR-REP-14 | Card loading and errors | built | Settling is tested on the demo, the size refusal is classified in `reports:unit/rpc-source`, and `web:reports/use-cards-load` drives a failing card and its retry in the loader; no test shows the error card or the size message in the browser. | A web test that makes one card's call fail and expects the error card with its retry, and one that answers SQLSTATE 22023 and expects the request for fewer stores or a shorter period. |
| FR-SET-01 | Store profile | built | The page (#159): pgTAP holds the seven profile columns written within scope, the POS columns refused, owner-only opening hours, the unique code and the sync's upsert keeping every edited column; `web:pages/settings/cua-hang-page` (the POS facts without a control, every field saved and read back, the audit line, the read-only states), `web:settings/store/store-fields`, `e2e:demo/settings-cua-hang`, `e2e:live/settings` (a save under row-level security, the audit line with "Bạn" and "bởi chủ", one store for a store-limited manager; #159); the sources of #105 by `web:settings/supabase-settings-source`, `web:settings/demo-settings-source` and `e2e:live/settings-manual`; a viewer's refused save of every profile column and the owner's saves, read back, by `e2e:live/settings-roles` (#165). No live test shows a saved profile changing a dependent figure: the seats bringing RevPASH to Giờ & ngày is shown on the demo only (`e2e:demo/settings-cua-hang`). | A live Playwright test that an owner's seat count and opening hours change RevPASH and the per-opening-hour figures on the fixture tenant. |
| FR-SET-07 | Item-type roles and categories | built | The roles table, the null attach rate without a role and an override read by the next statement in `item_summary`, `menu_engineering` and `item_margins` are tested; the roles screen saves only changed rows, deletes a cleared role and starts the catch-up (unit tests with fakes and the demo store), and the demo spec round-trips Tháng's attach card through the app's own links. The sources of #105 are tested by `web:settings/supabase-settings-source` and `web:settings/demo-settings-source` (items with their POS category and override; overrides upserted and cleared) and `e2e:live/settings-manual` (#105). The category tab (#160) reads Chưa phân loại from `data_quality_items` and saves overrides through the real tables in `e2e:live/settings-phan-loai`. `e2e:live/settings-roles` (#165) writes a role as every login through PostgREST, saved only by owners and managers with an unlimited scope, and shows the Vai trò tab read-only to every other login; no live spec saves a role from the Vai trò tab itself. | An owner's role save on the Vai trò tab through the real tables on the fixture tenant, with the catch-up and Tháng's attach rate after it. |
| FR-SET-10 | Legal texts | built | The screens: pgTAP holds drafts, frozen published texts, publication and retirement and one published version per kind and language. The sources of #105 are tested by `web:settings/manual/supabase-manual-source` and `web:settings/manual/demo-manual-source` (drafts inserted or patched, publication and retirement through the two functions, frozen texts), `e2e:live/settings-manual` (#105). The page (#164) is tested by its unit tests, `e2e:demo/settings-phap-ly` and `e2e:live/settings-manual`; `e2e:live/settings-roles` (#165) shows it read-only to staff, the viewer and both managers and refuses their drafts, edits, publications and retirements. The acceptance says managers publish too, while the database and the page let only owners with an unlimited scope do it. | The owner's decision whether managers may publish (R-FX09), then the write table and the page following it. |
| FR-SET-11 | Settings writes tested from the browser | built | `e2e:live/settings-roles` (#165) attempts all 27 settings writes as the owner, both managers, staff, the viewer and `anon` through supabase-js and PostgREST on the fixture tenant, each saved or refused as the write table says, and shows every settings page, tab and scope in the browser with write controls exactly where the database saves; `web:settings/access` holds the access rules. The owner's saves through the pages themselves on the live stack are tested for Cửa hàng, Ngày lễ, the three Dữ liệu nhập tay tabs, Pháp lý, Nhóm của món and Loại thanh toán; Ngưỡng báo cáo and the Vai trò tab save in the browser on the demo only. The 10b verification (#168) has not run. | A live save of Ngưỡng báo cáo and of the Vai trò tab as the owner on the fixture tenant; the spec rerun in the 10b verification (#168). |
| FR-EXP-01 | Browser export | built | The engine, the screen and `e2e:live/exports` on a fixture tenant show a month's files verified against `export_control_totals`, with the BOM and strict UTF-8 (passed on the local stack on 2026-11-18); the comparison on real data and the opening in Excel are not done. | The 11a-1 acceptance on the real tenant (#195): the export compared with `psql` counts and `app.fingerprint`, printing booleans only; owner check OC-04 in Excel (#196). |
| FR-EXP-03 | Data pack builder | in build | Packs built from the demo engine through the builder with a stand-in prompt validate for every horizon, in both languages, with and without a focus and an owner note, and the golden demo pack is reproduced byte for byte (#134). `buildDataPack` itself answers `not_implemented` until the prompt exists (#131); the seeded stack's pack was built and compared across transports in a one-off run, not by a committed test. | The golden pack regenerated with prompt 1.0.0 and `buildDataPack` validating for every focus and horizon (#131); the live pack spec on the seeded stack and the byte identity in CI (#144); the 11a-2 acceptance (#145). |
| FR-EXP-04 | Versioned schema and size budget | in build | The schema files, the estimate and the trimming ladder are unit-tested on fixture packs, and the golden demo pack of two stores fits with 21,225 estimated tokens and nothing trimmed (#134). With the stand-in prompt a pack of ten stores still ends in `pack_over_budget` after the whole ladder, and the prompt of #131 adds its text to every pack. | The estimate of packs with prompt 1.0.0 for one, two and ten stores against the budget (#131), and a counts-only check on the real tenant (#145). |
| FR-EXP-06 | Prompt templates | in build | The KPI front matter and the check that every KPI id exists in the registry are tested; the prompt templates do not exist. | A unit test that every section of the strategy prompt is present in both languages and that its KPI ids exist in the registry (#131). |
| FR-EXP-08 | Same pack from the CLI | in build | The canonical text, `pack_id` and the comparison of two pack texts are unit-tested; rows shaped as PostgREST and as `to_jsonb` return them give the same pack, and so do three process time zones (#134); `fnb datapack` does not exist. | An integration test in CI that the browser pack and the `fnb datapack` pack for the same inputs are identical apart from `generated_at` (#137, #144). |
| FR-EXP-09 | Built by a data role | designed | The database already gives the publisher no aggregate; the pack builder does not exist. | An integration test that a pack built from a publisher session is refused or empty (11a). |
| FR-STR-01 | Paste a plan | in build | The normalisation, the lint and the record of a pasted plan are unit-tested; the paste box and Kế hoạch do not exist. | A live Playwright test that a pasted plan appears in Kế hoạch with the source `pasted` (#143, phase 11b). |
| FR-STR-04 | Plan validation | in build | The client lint refuses both cases, with `section_missing:7` and `kpi_unknown:net_sales`; the database does not validate a plan yet. | pgTAP tests that the SQL validators agree with the lint on the structural codes (phase 11b, #170), and the paste box's messages (#143). |
| FR-NOT-19 | Digest equals Ngày | in build | Acceptance A1 is shown locally (`--check-ngay`, the live check, the `three nights` scenario); the three real nights on the owner's phone wait for go-live. | Owner check OC-08 after go-live step 8. |
| FR-NOT-25 | Runner notifications in the outbox | in build | The CLI path is tested; the Edge Function still reports to its log only. | Step 12c: a test that `sync-incremental` writes its notifications to the outbox. |
| FR-NOT-26 | Job failure alerts | in build | The database path (`fnb notify job-failed`) is tested; the `workflow_run` listener and the database-free fallback do not exist yet. | Step 12c: a unit test of the fallback script (masking, exit codes, counts only) and a probe that the listener fires on a failed run (an owner-run probe on GitHub). |
| FR-NOT-32 | Digest corrections | planned | The digest fingerprint is unit-tested; corrections do not exist. | Step 12c: pgTAP and unit tests that a changed figure sends one correction, never two, and that an item-only or state-only change sends none. |
| FR-OPS-01 | Continuous integration | verified locally | The commands of the four jobs pass locally at each verification. On GitHub, CI has run only for `0f8fa1d`, where the secret-scan job failed in its setup step; the fix is in the working tree and unverified on GitHub. | The first push after the owner's commit: all four jobs green on GitHub (section 7.4). |
| FR-OPS-03 | Web deploy | built | The Pages-shaped build is tested by `e2e:pages/install`, and "Deploy web app" deployed `937ab46` and `0f8fa1d`; no CI job runs the bundle and size checks (request R-AS09). | Add `pnpm --filter @fnb/web build` to CI (request R-AS09); confirm the next deploy after the owner's push. |
| FR-OPS-09 | Scheduled workflows kept active | built | The workflow exists but failed on its first scheduled run on 2026-11-09 (request R-P01). | After the fix, dispatch it once and confirm it is green; then check it weekly (operations calendar). |
| FR-OPS-10 | Cron delay probes | built | The probes run; `scripts/cron-delay-report.mjs` misattributes late runs (request R-P03), so the measured delays come from the GitHub API ([operations.md](operations.md) section 2.3). | Re-run the report after its fix and compare it with section 2.3 of operations.md. |
| FR-CMP-12 | Discount caps | in build | `core:unit/promotion-rules` and `reports:unit/themes/rules` hold the dated cap and day-limit rules and their helpers; pgTAP 36 checks `promotion_compliance` and `item_discount_days` against hand counts (#150), and their demo ports equal the SQL, the parity-only 60 % and gift cases included (#152). | pgTAP or unit tests that a promotion or coupon above the cap cannot be saved and that the discount-day count per item equals a hand count (phase 18b); the cards of #153 show the cap, vouchers apart and the discount days. |
| FR-POR-03 | Another POS | built | The conformance suite runs on the two built connectors; the third connector that proves the claim (CSV) does not exist. | FR-CON-17 and FR-POR-05 (20a). |
| FR-POR-11 | Scheduler and host by choice | built | The same incremental run serves the Edge Function and the CLI; Actions as the incremental scheduler and Cloudflare Pages as the host are not exercised. | Exercise one alternative scheduler and host in the 20a portability proof. |
| NFR-SEC-01 | RLS on every table | verified locally | `pgtap:03_rls_enabled` checks RLS on all 52 tables and the grants; no test asserts that no materialised view exists (none does on 2026-11-12, and `supabase db advisors` reports none). | An assertion in `03_rls_enabled.sql` that `pg_matviews` is empty in `public` and `app`, and `supabase db advisors --type security` in the verification (request R-T01). |
| NFR-SEC-05 | TLS to the database | built | The rule (`enforcedSsl`) is unit-tested and the Edge Function applies it; the CLI still connects to a remote host whose URL asks for `sslmode=disable`, `allow` or `prefer` (request R-AS06). | A CLI unit test that such a URL is refused, once the CLI applies the rule (request R-T02). |
| NFR-SEC-08 | Secrets only on the steps that need them | built | Review of the workflow files only. | A workflow lint script that fails when a secret is set at job level or on a checkout, setup or install step of `sync.yml` and `notify.yml`. |
| NFR-SEC-09 | Hardened database functions | built | Grants and the empty `search_path` are asserted for the report functions, `metric_value` and the payload functions; no test covers every function, and `supabase db advisors` reports one function without a pinned `search_path` (`app.data_roles`). | A pgTAP audit of `proconfig` for every function in `public` and `app`, with any documented exception, plus the advisors run in the verification (request R-T01). |
| NFR-SEC-10 | No reliance on HTTP security headers | built | Covered through NFR-SEC-02 and the recorded limitation; a `meta` Content Security Policy is still being evaluated (request R-AS11). | If a `meta` policy is adopted, a Playwright check that the demo and a live build load without policy errors. |
| NFR-SEC-15 | New key scheme | built | The secrets contract and `apps/jobs/src/config/config.ts` use the new names; no test covers the fallback order. | A `jobs:unit/config` case: the secret key wins, and the legacy key is read only when the secret key is empty. |
| NFR-PRV-05 | No third-party tracking | verified locally | Requests outside the origin are tested on the demo; the live build and the `noindex` tag have no test. | A live Playwright check that requests go only to the origin and the configured Supabase URL, and a check that `index.html` carries the robots `noindex` tag. |
| NFR-PERF-02 | Lighthouse performance | verified locally | 95 on the demo build with the recipe of `apps/web/README.md`; the live app is measured after go-live. | The same recipe against the live app after go-live (OC-10). |
| NFR-PERF-03 | Largest contentful paint recorded | built | The largest contentful paint is reported with each run (2.3 s on the demo); no target is set. | The owner sets a target (requirements section 9.3); then the recipe compares each run with it. |
| NFR-PERF-05 | Refresh time on production | waits for owner | `pgtap:14_analytics_refresh` asserts the demo range refreshes in under ten seconds locally; the production timing waits for the cloud project. | Time a refresh on the cloud project after go-live and record it in `docs/status.md` (OC-10). |
| NFR-PERF-07 | Incremental run within the Free plan | verified locally | The guard is unit-tested and the runs fit locally; the cloud confirmation waits for go-live. | Read the run timings of the first cloud incremental runs (`sync_runs`) after go-live step 6 (OC-10). |
| NFR-COST-01 | Free tiers during build and pilot | built | Checked by review of `docs/go-live.md` and `docs/secrets.md`; usage is watched after go-live. | After go-live, the monthly usage review of the operations calendar. |
| NFR-COST-02 | No paid AI API | built | Review: no assistant API client or key in the repository or the secrets contract. | A dependency review at each phase verdict. |
| NFR-COST-05 | Function invocations | built | Store selection is tested; the invocation count is measured only after go-live. | Read the monthly invocation count in the Supabase usage page after go-live. |
| NFR-COST-06 | Egress budget | built | The export's estimate, its confirmation above 100 MB, the measured bytes and the device's monthly tally are tested; the backup size reaches a job summary only after go-live. | Read the weekly backup size in the summary of "Backup database" after go-live (OC-09). |
| NFR-I18N-06 | Currency-neutral amounts | built | Review of the migrations only. | A pgTAP assertion that every money column of `public` is `numeric(14,2)`. |
| NFR-UX-02 | Layout on phones and desktops | built | The 360 px checks run on every page; the navigation placement and the summary button below 1024 px have no assertion. | Playwright assertions of the bottom bar at 360 px, the side rail at 1280 px and the folded controls below 1024 px. |
| NFR-UX-04 | New version prompt | built | No automated test. | A web unit test that a changed `version.json` on window focus shows "Có phiên bản mới — tải lại". |
| NFR-MNT-05 | No code comments | built | Review at each phase; builders and the verifier scan the added lines of changed files for comment markers. | An automated scan of changed files for comment markers in CI. |
| NFR-MNT-10 | Documents follow the code | built | Only `docs/api.md` (`pnpm docs:check-api`, not in CI) and the two wording sheets (`web:i18n/wording-sheets`, in every unit run) have automated checks; every other document relies on the documentation pass of each phase and the correction requests of 2026-11-12. | The final integration pass checks every document against the code (plan WP-FP); `pnpm docs:check-api` runs in CI once request R-AP01 is applied. |
| NFR-MNT-11 | POS details stay in their package | built | Review of package dependencies only. | An import-boundary check that fails when code outside the connector packages, the runner, the demo code and the notification test helpers imports a connector package. |
| NFR-OBS-01 | Job summaries | built | The numbering is unit-tested; job summaries with real secrets appear only after go-live. | Read the first job summaries of "Sync" and "Notify" after go-live: counts and numbers only. |
| NFR-HYG-02 | Secret scan over the history | built | The `secrets` job runs gitleaks over the history; no planted-secret run has been recorded. | Owner-run probe on a throwaway branch: a synthetic secret-shaped string makes the job fail, then the branch is deleted. |

### 9.7 Requirements verified by owner checks

16 requirements are verified by an owner check. Section 11 says how each check is done and where its result is kept.

| ID | Requirement | Status | Owner check |
|---|---|---|---|
| FR-TEN-12 | No self sign-up | waits for owner | Locally `supabase/config.toml` sets `enable_signup = false`; the cloud setting is go-live step 1 (OC-05). |
| FR-TEN-15 | Sign-in, reset and invitation on the deployed site | waits for owner | Phone sign-in, password reset and invitation link on the Pages URL after go-live (OC-06). |
| FR-SYNC-20 | Nightly job | waits for owner | The skip without secrets runs on GitHub every night; the scheduled sync on the cloud project is dispatched and checked after go-live (OC-09). |
| FR-DQ-04 | Monthly comparison with the POS report | waits for owner | Each month against the POS report A01, per store (OC-01). |
| FR-ANA-16 | Reference-window figures | verified locally | Compared with the private sheet at the phase 8 verification; the result is kept privately (OC-03). The phase 10 theme live check compares the window's hours, weekdays and payment mix and prints only `matches: true` or `false`; on 2026-11-15 all 66 values and both menu checks matched. |
| FR-REP-19 | Owner wording review | waits for owner | Wording review of `docs/reports/cau-van-bao-cao.md` and `docs/reports/cau-van-chu-de.md` (OC-11); `web:i18n/wording-sheets` keeps both equal to the message files. |
| FR-REP-20 | Owner comparison with POS reports | waits for owner | After the verifier's `reports:live/live-check`: three days and one month against A01 and B01, and Năm against the private sheet (OC-02). |
| FR-OPS-02 | Migrations by workflow | waits for owner | The workflow skips with a note until `SUPABASE_PROJECT_ID` exists; the first `db push` runs after go-live (OC-09). |
| FR-OPS-04 | Edge Function deploy | waits for owner | The import-map check runs in CI and before every deploy; the deploy itself needs the cloud secrets (OC-09). |
| FR-OPS-05 | Encrypted weekly backups | waits for owner | The first encrypted backup and its logged size after go-live step 7 (OC-09). |
| FR-OPS-11 | Go-live checklist | waits for owner | The owner completes `docs/go-live.md`; `fnb status` then shows incremental runs within 30 minutes (OC-09). |
| FR-CMP-09 | Legal form and cross-border decision | waits for owner | The `legal_form` column is tested; the dossier or exemption decision is the owner's, before the customer Mini App is published (OC-14). |
| FR-CMP-17 | Privacy notice | waits for owner | The owner publishes the notice (Track Z); the app screens that show it are planned for 14a and 18a (OC-14). |
| FR-CMP-20 | Data protection officer decision | waits for owner | The owner's recorded decision before publication (OC-14). |
| NFR-SEC-11 | SMTP and SSL on the cloud project | waits for owner | Supabase dashboard settings after go-live step 1 (OC-05). |
| NFR-AVL-01 | Freshness during opening hours | waits for owner | Three consecutive days on the cloud project after go-live step 6 (OC-07). |

## 10. Acceptance test procedures per phase

### 10.1 How to run an acceptance check

1. Work on the build machine's stack without resetting it. When the step touches the database, record the real tenant's counts first (section 3.1).
2. Run the CLI with `CI=1` whenever its output is shared.
3. Record booleans, counts and durations only.
4. A line that needs the cloud project or private figures is marked as a cloud check or an owner check (OC-nn, section 11) with its state. It is never marked passed on local evidence alone.
5. The verdict lists every line as pass, fail, skipped with the reason, or open as a cloud or owner check.

Phases 1 to 12 have detailed procedures; phases 13 to 20 have an outline (section 10.14). In the tables, `<db>` is the local database URL of section 5.2.

### 10.2 Phase 1 — Foundations and public-repo hygiene

State: complete.

| # | Roadmap acceptance | How it is shown | Who | State |
|---|---|---|---|---|
| 1.1 | `pnpm lint`, `pnpm typecheck`, `pnpm test` green locally and in CI | The three commands exit 0; the CI `code` job is green | verifier, CI | verified locally at every verification; green on GitHub for `0f8fa1d` |
| 1.2 | A test commit with a fake UUID under `apps/` fails CI | Locally: put a random UUID (for example the output of `node -e "console.log(crypto.randomUUID())"`) into a new untracked file under `apps/`, run `node scripts/check-public-safe.mjs`, expect exit 1 naming the file, then delete the file. On GitHub the same scan runs in the `secrets` job | verifier | complete at phase 1 |
| 1.3 | `git ls-files` shows nothing under `docs/private/` and no `.env` | `git ls-files docs/private .env` prints nothing; `git ls-files \| grep -E '(^\|/)\.env'` lists only `.env.example` and `apps/web/.env.example` | verifier | verified on 2026-11-12 |
| 1.4 | The probe reports a week of per-slot delays before phase 7 | The probe runs read through the GitHub API ([operations.md, section 2.3](operations.md#23-how-late-github-starts-scheduled-runs)); `node scripts/cron-delay-report.mjs` once its defects are fixed (request R-P03) | operator | data collected from 2026-11-07 to 2026-11-12; the report script misreads late runs |

### 10.3 Phase 2 — Canonical schema, tenancy, RLS, consent and legal tables

State: complete.

| # | Roadmap acceptance | How it is shown | Who | State |
|---|---|---|---|---|
| 2.1 | `supabase db reset` and `supabase test db` green locally and in CI | The CI `database` job resets a fresh stack and runs every pgTAP file. On the build machine only `pnpm exec supabase test db` runs, never a reset | CI, verifier | 31 files, 1,648 planned tests on 2026-11-12; two date-dependent tests being fixed on the build machine |
| 2.2 | A member of tenant A reads zero rows of tenant B everywhere; `anon` reads nothing; a publisher reads zero invoices but can insert a plan | `pgtap:04_tenant_isolation`, `06_anon_and_tokens`, `08_publisher_role`, and for later tables `17_analytics_access`, `23_report_access`, `31_notify_access`; `e2e:live/auth` (a client with only the publishable key reads zero invoices) | CI, verifier | verified locally |
| 2.3 | Re-upserting the same day changes nothing | `sync:unit/window-mock`, `sync:integration/postgres-repository`, `jobs:integration/local-stack` (a re-run writes nothing) | verifier | verified locally |
| 2.4 | The business-date helper handles 23:59:59, 00:00:30 and a 05:00 day start | `core:unit/business-date`, `sync:unit/business-date` | CI | verified locally |
| 2.5 | The database linter reports no exposed materialised view and no table without RLS | `pgtap:03_rls_enabled` (RLS on all 52 tables); `pnpm exec supabase db advisors --type security` | verifier | on 2026-11-12: no materialised view and no table without RLS; one warning on `app.data_roles` (request R-T01) |
| 2.6 | Lint passes | `pnpm lint` | CI | verified |

The phase 2 deliverable "column-name lint" was not built (NFR-MNT-07, owner decision D4).

### 10.4 Phase 3 — iPOS connector and API contract

State: complete.

| # | Roadmap acceptance | How it is shown | Who | State |
|---|---|---|---|---|
| 3.1 | Unit tests for login and refresh, headers, both pagination styles, retry and non-retry, the 401 path, schema errors, the empty-store guard and day-range boundaries | `connector-ipos:unit/auth`, `unit/http`, `unit/pagination`, `unit/master-data`, `unit/pos-cms`, `unit/sale-summary`, `unit/time` | CI | verified |
| 3.2 | Every zod schema parses captured real responses (private run) and synthetic fixtures (CI) | The unit tests parse the synthetic fixtures; the run against captured responses was private and its result is kept in `docs/private/` | verifier | complete at phase 3 |
| 3.3 | Each open item has a written answer with query and counts | Private notes | verifier, owner | complete at phase 3 |
| 3.4 | Live smoke passes for both accounts | `pnpm --filter @fnb/connector-ipos test:live` with the POS entries and the application key in `.env`; counts and timings only | verifier | verified at phase 3 |
| 3.5 | No real identifier under `packages/` | `node scripts/check-public-safe.mjs` on a machine with `docs/private/identifiers.txt` | verifier | clean on 2026-11-12 |

### 10.5 Phase 4 — Connector contract, mock connector, normaliser

State: complete.

| # | Roadmap acceptance | How it is shown | Who | State |
|---|---|---|---|---|
| 4.1 | The mock connector and the iPOS adapter pass the conformance suite; a wrong-timezone mock fails with the rule named | `connector-mock:unit/conformance` (midnight and 05:00 day starts), `connector-ipos:unit/connector-conformance`, and `connector-core:unit/checks` ("names the business-date rule when a connector used the wrong timezone") | CI | verified |
| 4.2 | The golden cases (modifier, free topping, sizes, day start, split bill, UUID-only type) | `connector-ipos:unit/connector-golden`, `core:unit/size`, `core:unit/business-date` | CI | verified |
| 4.3 | Live: control totals equal emitted sales per day within 1,000 ₫; the discount identity holds on voucher invoices | `connector-ipos:live/connector` | verifier | verified at phase 4 |
| 4.4 | No iPOS field name outside `raw` (lint) | not built (NFR-MNT-07) | – | planned; owner decision D4 |

### 10.6 Phase 5 — Cloud project, onboarding, backups, first data

State: verified locally; the cloud steps wait for the owner.

| # | Roadmap acceptance | How it is shown | Who | State |
|---|---|---|---|---|
| 5.1 | Migrations applied by workflow | "Migrate database" (`migrate.yml`) on the first push after go-live, or by dispatch | owner (OC-09) | waits for owner |
| 5.2 | The live RLS suite is green | The two-tenant run with throwaway users on the cloud project (FR-TEN-17) | verifier with the owner (OC-10) | planned at go-live |
| 5.3 | Both stores onboarded through `fnb onboard` with correct names and opening dates | `fnb onboard --tenant <slug> --account <key>` per account; `jobs:integration/local-stack` and `sync:unit/master-data`. Names, time zones and day starts come from the POS; opening dates are entered with the store profile in 10b (request R-Q04) | verifier | names, zones and day starts verified locally; opening dates designed (FR-SET-01) |
| 5.4 | The month's per-day invoice counts equal the POS daily totals; the manager session sees the rows and the publishable key alone sees nothing | One `sync_checks` row per store-day, all matched; `CI=1 pnpm --filter @fnb/jobs fnb -- status` shows `unmatched 14d` 0 for every store; `e2e:live/auth` and `e2e:live/today` | verifier | verified locally on the full history; on the cloud after go-live |
| 5.5 | Sign-ups disabled, custom SMTP configured, the manager user created and a tenant member | Locally `enable_signup = false` and `fnb tenant add-member` (`jobs:integration/local-stack`); on the cloud, go-live step 1 | owner (OC-05) | waits for owner |
| 5.6 | The first encrypted backup exists outside the repository and its size is logged | "Backup database" (`backup.yml`) after go-live step 7; the job summary shows the size | owner (OC-09) | waits for owner |

### 10.7 Phase 6 — Web app foundation and Hôm nay

State: verified locally; the cloud checks wait for the owner.

| # | Roadmap acceptance | How it is shown | Who | State |
|---|---|---|---|---|
| 6.1 | The Pages URL loads and login works on a phone | Locally `e2e:live/auth` and `e2e:live/today`; on the Pages URL, the owner's phone | owner (OC-06) | local verified; deployed waits for owner |
| 6.2 | Without a session every view returns zero rows | `e2e:live/auth` (publishable-key client), `pgtap:06_anon_and_tokens`, `pgtap:03_rls_enabled` | CI | verified locally |
| 6.3 | The language toggle covers every string | `web:i18n/i18n` (no JSX text outside `t()`, key parity), `web:i18n/report-keys`; the toggle in `e2e:live/today` and `e2e:demo/demo`; each report spec reads well in English | CI | verified |
| 6.4 | The built bundle contains no key, UUID or e-mail address | `pnpm --filter @fnb/web build` (bundle check) | verifier; `deploy-web.yml` | verified locally; not in CI (request R-AS09) |
| 6.5 | Lighthouse mobile performance at least 85, accessibility at least 90; axe with no serious violation | The recipe in [apps/web/README.md](../apps/web/README.md); `checkPage` in every spec | verifier | demo build 93 and 100; the live app after go-live (OC-10) |
| 6.6 | Hôm nay equals the POS overview for the same day | `e2e:live/today` on the seed (expected numbers read through RLS); the real data was compared with the POS control totals at the phase 6 verification; after go-live the owner compares with the POS overview (OC-06) | verifier, owner | verified locally |
| 6.7 | A password reset completes on the deployed site | Locally `e2e:live/auth` (the mail reaches the mail catcher; an expired link is explained); deployed: OC-06 | owner | waits for owner |

### 10.8 Phase 7 — Sync engine

State: both runners verified locally; the cloud deploy and the freshness check wait for the owner.

| # | Roadmap acceptance | How it is shown | Who | State |
|---|---|---|---|---|
| 7.1 | At least 99 % of store-days ok, every exception explained privately | Matched share of `sync_checks` over the full history; `fnb status` for the last 14 business dates | verifier | 930 of 930 checked store-days matched at the phase 7 verification |
| 7.2 | Monthly totals match the POS report A01 for every month | Owner check | owner (OC-01) | open |
| 7.3 | An invoice removed from the re-pulled window ends as voided and leaves the totals | `sync:unit/window-changes` ("voids a stored sale missing from the re-pull with exactly one event"), `sync:integration/postgres-repository` | CI, verifier | verified |
| 7.4 | Two consecutive runs change nothing | `sync:unit/window-mock`, `jobs:integration/local-stack`; a second incremental invocation pulls nothing (`sync:unit/incremental`) | CI, verifier | verified |
| 7.5 | An incremental invocation per store finishes within the Edge Function budget; one backfilled month in under 5 minutes within the call budget | `sync:unit/run-guard`, `runner:unit/budget`, `sync:unit/run-bookkeeping`; the month timing measured at the verification (under a minute, four connector calls per account) | verifier | verified locally; the cloud timings after go-live (OC-10) |
| 7.6 | The freshness badge shows a sync younger than 35 minutes during opening hours for three consecutive days | Owner check on the cloud project | owner (OC-07) | waits for owner |
| 7.7 | Database size after the full backfill under 300 MB | `vacuum (full, analyze)` on the fact tables, then the size line of `CI=1 pnpm --filter @fnb/jobs fnb -- doctor` | verifier | 285 MiB after compaction |

The Edge Function runner itself is shown by serving it locally, as [sync.md](sync.md) describes: `pnpm exec supabase functions serve --env-file <file outside the repository>`, a manual ticket from `select app.issue_incremental_sync_ticket('<store id>');`, and a `POST` of `{"ticket": "<ticket>", "wait": true}` to `http://127.0.0.1:54321/functions/v1/sync-incremental`. The answer is a counts-only run report. A second call right after pulls nothing. An unknown or used ticket gets 401. pgTAP 20 and 21 hold the schedule, the tickets and the dead-man's switch. All twelve checks of the phase 7 verification passed on 2026-11-08.

### 10.9 Phase 8 — Analytics aggregates and metric registry

State: complete locally; the production timing waits for the owner.

| # | Roadmap acceptance | How it is shown | Who | State |
|---|---|---|---|---|
| 8.1 | Tests green | `pnpm test`, `pnpm exec supabase test db` | CI, verifier | verified |
| 8.2 | Refresh under 2 minutes on production | `pgtap:14_analytics_refresh` locally (the demo range under ten seconds); a timed refresh on the cloud project | verifier (OC-10) | local verified; production waits for owner |
| 8.3 | Report-sized queries under 1.5 seconds | `reports:live/live-check` check 6 on the real tenant; the phase 8 measurement on a synthetic tenant of 54,000 invoices | verifier | verified locally |
| 8.4 | Aggregates reproduce the reference-window figures in the private sheet | Owner check against the private sheet | verifier, owner (OC-03) | done at the phase 8 verification |
| 8.5 | Every metric has Vietnamese and English labels, unit, formula, grain and report mapping (lint) | `metrics:consistency/document`, `metrics:unit/registry`, `web:metrics/registry` | CI | verified |
| 8.6 | The two-tenant RLS matrix passes on aggregate tables | `pgtap:17_analytics_access`, `pgtap:13_analytics_schema` | CI | verified |
| 8.7 | Forecast error is tracked for both benchmark forecasts | `pgtap:15_analytics_queries` (forecast accuracy), `demo-analytics:parity/forecasts` | CI | verified |

### 10.10 Phase 9 — Periodic reports Ngày, Tuần, Tháng, Năm

State: verified locally; the owner checks are open.

| # | Roadmap acceptance | How it is shown | Who | State |
|---|---|---|---|---|
| 9.1 | Three random days and one month equal the POS reports A01 and B01 | Verifier: `DATABASE_URL=<db> pnpm --filter @fnb/reports test:live`, checks 1 and 2 (headlines equal the POS control totals in `sync_checks`, `metric_value` and the series buckets). Then the owner compares those pages with A01 and B01 | verifier, then owner (OC-02) | live check verified; owner check open |
| 9.2 | Năm shows the correct peak month and year-over-year change (private sheet) | Live check 7 with `LIVE_ACCEPTANCE=<private file>`, plus checks 3 and 4 (buckets add up; like-for-like totals); then the owner | verifier, then owner (OC-02) | owner check open |
| 9.3 | Young stores show a graceful "chưa có dữ liệu năm trước" state | `e2e:demo/report-day`, `report-week` and `report-year` on the young demo store; `e2e:live/reports` on the seven-day seed; `reports:unit/coverage-and-comparison`; live check 4 | CI, verifier | verified |
| 9.4 | No horizontal scroll at 360 px | `checkPage` in every report spec, before and after printing; the browser pass on the real tenant | CI, verifier | verified |

The verifier's checklist for report work, run at the phase 9 verification and again whenever report code changes:

1. Everything CI runs, plus the web build with its size check (the initial JavaScript figure goes into the verdict).
2. The reports live check on the real tenant (booleans, counts and durations only).
3. A browser pass on the real tenant, signed in as its owner: the four reports for all stores and for each store, at 360 px and at 1280 px. Pass when there is no sideways scroll, axe is clean, no raw message key shows, Hôm nay's yesterday equals Ngày's day for net revenue and invoices, the young store shows its graceful state on Năm, and the placeholders for unmapped roles, missing targets and an empty member share show their plain-language text. Screenshots stay off the repository.
4. The public-safety scan with the private identifier list.

### 10.11 Phase 10 — Thematic reports, settings, manual data, compliance checks

State: step 10a verified locally on 2026-11-16 (#102); step 10b in build, with its integration (#167) and verification (#168) left; the owner checks are open. The private build spec of phase 10 is final, and its verification checklist names the 10a and 10b lines that this table summarises.

| # | Roadmap acceptance | How it is shown | Who | State |
|---|---|---|---|---|
| 10.1 | The heatmap and the payment mix reproduce the reference window (private sheet) | `DATABASE_URL=<db> LIVE_REFERENCE_SHEET=docs/private/acceptance-figures.md pnpm --filter @fnb/reports test:live`: `reports:live/theme-live-check` check 2 prints `matches: true` for every compared hour, weekday, band, share and payment item and no `owner check pending` from the theme file; then Giờ & ngày and Thanh toán opened on the real tenant for the reference window, per store; then the owner reads both pages beside the sheet (#189) | verifier, owner (OC-03) | build side passed on 2026-11-15 and again at #102 on 2026-11-16 (all 66 compared values true; both pages show the window for each store); the owner's reading is open |
| 10.2 | Modifier lines never appear as items | `pgtap:16_analytics_menu_and_cash` and `pgtap:33_theme_functions` in CI; on the real tenant, `reports:live/theme-live-check` check 3 over the reference window and the last 365 days (item quantities equal `items_sold`, no item key is a catalogue modifier; with the sheet, its top sellers and a day's modifier share); `e2e:demo/theme-thuc-don` and `demo-analytics:themes/menu.smoke` | CI, verifier | passed at #102: pgTAP green, every live check true, no modifier among the 365 days' item keys, the Thực đơn spec green |
| 10.3 | Entering a cost for five items shows their margin only; a target shows pace on Tháng | Live Playwright on the seeded stack, which already holds item costs and a monthly target per store | CI, verifier | 10b (the costs page #161 and targets #163); in 10a the margins card shows only costed items on the seeded stack (`e2e:live/themes`) |
| 10.4 | A viewer cannot save settings | Live Playwright write tests per settings form as owner, store-limited manager, staff and viewer, on top of `pgtap:05_write_policies`, `07_write_scope_and_attribution` and `38_settings_writes` | CI | live: `e2e:live/settings-roles` (API matrix of five logins and anon; read-only pages for every login with axe at 360/1280) plus `web:settings/access`; 28 of 28 and the whole live project 86 of 86 on the local stack at `8f749b7` (#165); the 10b verification (#168) has not run |
| 10.5 | Re-mapping an uncategorised item moves it immediately | Live Playwright on the item-type role mapping | CI | `pgtap:35_mappings_and_catch_up` holds the override read at once; the category tab and its live test come with 10b (#160) |
| 10.6 | The data-quality page flags a store without e-invoicing | Live Playwright: the seeded coffee store (`not_configured`) is flagged | CI | 10b (#158) |
| 10.7 | Every CSV opens in Excel with correct Vietnamese characters | BOM and row tests per table in both dialects, as in phase 9; one CSV per theme downloaded from the real tenant and decoded as strict UTF-8; then the owner | CI, verifier, owner (OC-04) | build side passed at #102: every theme spec's CSV checks green in both dialects, and the four downloaded files start with the BOM, decode as strict UTF-8 and have Vietnamese headers; the owner's Excel check is open (#189) |

Owner inputs for this phase: item costs for the top items of one store, one monthly target, seat counts and opening hours (OC-12).

### 10.12 Phase 11 — Exports, data pack, strategy plans

State: 11a in build, 11b designed. The phase 11 build spec is final (private) and verifies 11a in two halves: 11a-1, the exports, by #195, and 11a-2, the pack, the prompt, the plan lint, the command line and the paste box, by #145. Row 11.1 is refined from the 11a-1 acceptance ticket (#195), which follows the build spec's checklist; rows 11.2 to 11.4 still follow the roadmap and are refined with #145 and phase 11b.

| # | Roadmap acceptance | Planned procedure | Who |
|---|---|---|---|
| 11.1 | A month's export equals the invoices table and opens in Excel with correct diacritics | 1. `e2e:live/exports` on a fixture tenant: the month as CSV and as JSON gives only verified files at the expected archive paths, every CSV starts with the BOM and is strict UTF-8 with names unchanged, no JSON file has a BOM, the manifest's fingerprints equal `export_control_totals` read by the same signed-in member, personal columns appear only when ticked, staff and viewers get the explanation and a store-limited manager never sees the box; axe at 360 and 1280 px (passed on the local stack on 2026-11-18). 2. On the real tenant (#195): the real tenant's row counts of `strategy_reports`, `sync_runs` and `analytics_refreshes` recorded before and after; one complete past month of both stores exported as CSV and as JSON, every file `verified: true`; each store's rows per table counted and fingerprinted with `app.fingerprint` as `postgres` in `psql`, and a script kept outside the repository compares them with the manifest and the files, printing only `rows_equal`, `fingerprints_equal`, `daily_summary_equal`, `bom` and `utf8`, true for each store; the export again with 97-row pages gives the same files; the timing budgets of #132 hold; no fixture tenant remains. Not run yet: there is no real data on the build machine. 3. The owner opens the files in Excel (OC-04, #196) | CI, verifier, owner (OC-04) |
| 11.2 | Browser and CLI packs are byte-identical apart from the timestamp; the pack validates, stays within budget and holds aggregates only | An integration test comparing both packs byte for byte; schema validation for every focus and horizon; the token estimate within 15,000 to 30,000; a refusal test for row-level and personal fields | CI, verifier |
| 11.3 | `/strategy` runs end to end; every initiative cites a number present in the pack; the plan appears in Kế hoạch; KPI follow-up shows live values | The owner runs `/strategy` twice in their own assistant; a unit test of the cite-a-number check; live Playwright for Kế hoạch; each KPI value equals `metric_value` | owner (OC-13), CI |
| 11.4 | A plan missing a section or using an unknown KPI id is rejected | Unit tests of the validation behind `fnb publish-plan` and the paste box | CI |

### 10.13 Phase 12 — Alerts, digests and channel policies

State: step 12a verified locally; step 12b in its integration and verification; step 12c planned. The roadmap's four acceptance lines are shown locally as A1 to A4.

| # | Roadmap acceptance | How it is shown locally | Step | State |
|---|---|---|---|---|
| A1 | The digest arrives three nights running with numbers equal to Ngày | `CI=1 pnpm --filter @fnb/jobs fnb -- digest --tenant <slug> --date YYYY-MM-DD --check-ngay` for each of the three latest complete business days of the real tenant: every JSON line shows `equal`, `pos_invoices`, `pos_net` and `metric_value` as true. `DATABASE_URL=<db> pnpm --filter @fnb/notify test:live`: every scope of the three days equal. `NOTIFY_INTEGRATION=1 DATABASE_URL=<db> pnpm --filter @fnb/notify test:integration -t "three nights"`: exactly three digests over three simulated nights, each equal to Ngày. On the owner's phone after go-live: OC-08 | 12b | in build |
| A2 | A synthetic low-revenue day triggers the anomaly line, and disabling the rule suppresses it | `NOTIFY_INTEGRATION=1 DATABASE_URL=<db> pnpm --filter @fnb/notify test:integration -t "low revenue"`; the same toggle in `pgtap:29_notify_alerts` and `notify:unit/rules/day` | 12b | in build |
| A3 | A forced credential failure produces one alert and marks the account `auth_failed` | `NOTIFY_INTEGRATION=1 DATABASE_URL=<db> pnpm --filter @fnb/jobs exec vitest run test/integration/notify-cli.test.ts -t "credential failure"`: the mock account rejects its login; exactly one alert message and one provider request; the account is `auth_failed`; the database half in `pgtap:29_notify_alerts` | 12b | in build |
| A4 | A message outside a channel's allowed hours is held until the window opens | `pnpm exec supabase test db supabase/tests/27_notify_policy.sql`: queued at 00:30 local, held, released at exactly 06:00 local; `NOTIFY_INTEGRATION=1 DATABASE_URL=<db> pnpm --filter @fnb/notify test:integration -t "held until the window opens"`: no request before 06:00, one at 06:00 | 12a | verified locally |

What the verifier checks for each step of phase 12. The lines apply the exit criteria of section 6.1 and the rules of sections 3.1 and 2.11 to the roadmap's acceptance lines and to the code of each step:

| Area | What is checked | After 12a | After 12b | After 12c |
|---|---|---|---|---|
| Before | Counts of the real tenant's rows in the notification and sync tables (section 3.1), taken before the run and compared after it | yes | yes | yes |
| Repository and code | Every changed path belongs to the step; lint, typecheck and unit tests pass; the import map and the Deno check are current for every Edge Function the step touches; changed files hold no code comment and no assistant-product name; the public-safety scan and gitleaks find nothing | yes | yes | yes |
| Database | New migrations applied with `migration up`, never a reset; all pgTAP files pass, the notification files 26 to 31 among them; grants keep a destination's address, secret name and configuration from `authenticated` and every new table from `anon`; consent and rule writes stay with the roles the policies name; a notification cycle without a tenant filter, run inside a transaction that is rolled back, leaves the real tenant's counts unchanged | yes | yes | yes, with the tests of the new schedule and of the database functions for the web screens |
| Acceptance | A1 to A4 as above | A4 | A1 to A4 | A1 to A4 |
| Behaviour | The notification integration suites pass and leave no `notify-it-` tenant behind; an adapter honours a base-URL override only for a loopback address, and no token, chat id, address or URL reaches an outcome, an error or a log line | yes | yes | yes, with the `notify` function served locally: an unknown ticket gets 401 and a manual ticket a report with counts only, as for `sync-incremental` (ADR-028) |
| Output | Run with `CI=1`, `fnb notify status` and `fnb doctor` show counts and numbered stores only: no shop or member name, address, chat id, token or amount | – | yes | yes |
| Documents | The notification documentation, `packages/notify/README.md`, the updates to the existing documents that step 12c owns, and ADR-030 to ADR-033 | – | – | yes |

### 10.14 Phases 13 to 20 (outline)

Each of these phases gets a build spec cut into verifiable steps before it starts; its detailed procedures are written then. The planned tests per requirement are in section 9.5.

| Phase | Roadmap acceptance, in short | Planned test types | Preconditions |
|---|---|---|---|
| 13 Zalo and platform foundation | A Development build of each Mini App gets a session with the right claims on the owner's phone; an OA test message is signature-checked and logged (observe mode, then fail closed); the OA token refreshes twice and the developer token rotates once; the API domain works from a real device; the phone-consent probe is recorded; CI fails a build over budget | Deno tests of the Edge Functions with stubbed Zalo APIs; pgTAP for the brand configuration; CI budget checks; device and console checks by the owner (OC-16) | Track Z: Zalo accounts, an OA per brand verified with its package, Mini Apps with names and logos |
| 14 Staff Mini App core | Pairing and onboarding as specified; no cross-store or cross-role read; one full day at one store across three shifts; a 50,000 ₫ variance alerts the manager within one sync cycle; a checklist change needs no redeploy; no outbound link | A pgTAP RLS suite for the operations tables; Mini App tests in browser mode with a mocked Zalo SDK; a link scan; an integration test of the variance alert; an owner-run day | Staff list, checklist items, individual cashier logins, the staff notice |
| 15 Notices, alerts, approvals; first review; internal publish | At least 80 % read a test announcement within a day; the digest reaches the group and the Bot chat three nights running; a closed window falls back to the Bot without a paid message; the follow-only probe recorded; the review passed with permissions confirmed in the console; the app opens only by deep link or QR | pgTAP for the staff rules and activity monitors; integration tests of routing and fallback; console and device checks (OC-16) | Staff follow the OA, join the group, message the Bot |
| 16 Loyalty rail | At least 20 invoices per store carry a phone after a week; a definitive answer on the phone fields; the rail decision recorded; a test member on the synced invoice within 30 minutes, or a discount entry by name; the voucher callback returns the discount and refuses a second use; a 100-code pool round-trips; both stores' e-invoice status known | Live checks with test members at the till; Deno tests of `voucher-callback`; owner answers recorded privately | Cashier briefing, POS CRM questions, receipt template, e-invoice registration; gate G2 |
| 17 Loyalty ledger and compliance tooling; staff loyalty tools | Replaying 30 days with 50 synthetic phones equals a hand calculation and is idempotent; a voided invoice's earn is reversed; double claims are rejected; the ambiguity queue lists a double candidate; a deletion request cascades and is logged against its deadline; 9 of 10 live check-ins confirmed within 10 minutes; a reused redemption code is rejected | pgTAP for the ledger, matching paths, anti-fraud rules, clawback and data-subject deletion; live trials | Thresholds, blacklist, programme budget |
| 18 Customer Mini App and coupons | Five test users join and earn within 10 minutes; refusing the phone permission keeps the app usable; LCP and load gates pass; no LocalStorage; a redemption end to end; a used code refused or flagged; an unused hold released after 24 hours; no outbound link or price | Mini App tests in browser mode; simulator gates; an end-to-end check with the cashier; pgTAP for coupons and caps | Brand assets, test users, reward catalogue, cashier training |
| 19 Customer messaging; legal filings, review, publish, pilot | Templates approved; a voucher template within 2 minutes; no promotional message without consent; a free confirmation instead of a paid one; projected cost under budget; filings or exemptions documented; the app published; the two-week pilot figures; the owner runs the weekly review alone | pgTAP for the send decisions; integration tests against a mock template API; console checks; pilot dashboard checks (OC-14, OC-16) | ZBS account and templates; the Sở Công Thương and dossier decisions; gates G3 and G4 |
| 20 Portability proof; hardening, launch, handover | A second GitHub account reaches a working dashboard in under 60 minutes; a third store onboarded by CSV with zero source changes; end-to-end green five nights in a row with zero flakes; the RLS audit green; the restore drill reproduces counts; seven green days of sync and digests; the owner performs the four runbook tasks alone | Conformance on the CSV connector; nightly end-to-end on the staging project; the cloud RLS audit; the restore drill; the seven-day parallel verification (OC-15) | All phases; the staging project |

## 11. Owner acceptance checks

### 11.1 How owner checks work

Some acceptance lines can only be checked by the owner: they compare the platform with the POS's own reports or with private figures, or they need the owner's phone, the owner's cloud dashboard or the Zalo console.

1. **The verifier prepares.** The matching live check runs first, and the owner gets the list of pages, dates and stores to compare, with deep links (for example `#/bao-cao/thang?month=YYYY-MM&store=<id>`).
2. **The owner compares or acts.**
3. **The result is recorded privately**, as a dated entry in `docs/private/` that says what was compared and whether it passed. This plan proposes one file, `docs/private/owner-checks.md`, for all of them. Figures stay there.
4. **[status.md](status.md) gets only** the check's ID, the date and "passed", "failed" or "open".
5. **A failed owner check is a blocker** for its phase (section 6.4).

### 11.2 The checks

Every result is kept privately in `docs/private/`.

| ID | Check | Requirements | When | How | State on 2026-11-12 |
|---|---|---|---|---|---|
| OC-01 | Monthly totals against the POS report A01 | FR-DQ-04 | Once for every month of history, then monthly ([operations.md, section 5](operations.md#5-maintenance-calendar)) | Open Tháng for each store and for all stores and compare net revenue and invoices with A01 for the same store and month | open |
| OC-02 | Phase 9: days and month against A01 and B01; Năm against the private sheet | FR-REP-20 | After the verifier's live check | The verifier runs `DATABASE_URL=<db> LIVE_ACCEPTANCE=<private file> pnpm --filter @fnb/reports test:live` and lists three random days and one month. The owner compares Ngày of each day and Tháng of the month with A01 and B01, and Năm's peak month and year-over-year change with the private sheet | open; the live check passes |
| OC-03 | The reference window | FR-ANA-16, FR-THM-02, FR-THM-04 | Phase 8; again in phase 10 | Compare the aggregates (phase 8), then the heatmap and the payment mix (phase 10), with the reference window of the private sheet | phase 8 done at its verification; phase 10: `reports:live/theme-live-check` prints `matches: true` for every compared value (2026-11-15), the owner's reading of the pages waits (#189) |
| OC-04 | CSV files and exports in Excel | FR-REP-12, FR-EXP-01 | Phases 9, 10 and 11 | Download a table's CSV from each report (and each export of 11a), open it in Excel, check the Vietnamese diacritics and that the rows match the screen | open |
| OC-05 | Cloud authentication settings | FR-TEN-12, NFR-SEC-11 | Go-live step 1 | In the Supabase dashboard: sign-ups off, custom SMTP set, SSL enforced; keep a screenshot privately | waits for owner |
| OC-06 | Sign-in, password reset and invitation on the deployed site | FR-TEN-15 | After go-live steps 1 to 5 | On a phone: sign in at the Pages URL; request a reset and complete it; open an invitation link sent with `fnb tenant add-member --invite`; compare Hôm nay with the POS's own overview for the same day | waits for owner |
| OC-07 | Freshness during opening hours | NFR-AVL-01 | Three consecutive days after go-live step 6 | Several times a day in opening hours, the freshness badge shows a sync younger than 35 minutes (or read `CI=1 pnpm --filter @fnb/jobs fnb -- status`) | waits for owner |
| OC-08 | The digest on the owner's phone | FR-NOT-19, FR-OPS-12 | Three nights after go-live step 8 (written in step 12c) | Link the owner's Zalo Bot chat with `fnb notify link`, confirm with `fnb notify test`, then on three mornings compare the digest with Ngày for the same day; the verifier runs `fnb digest --check-ngay` against the cloud | waits for owner |
| OC-09 | Cloud workflows and the go-live checklist | FR-OPS-02, FR-OPS-04, FR-OPS-05, FR-OPS-11, FR-SYNC-20 | Go-live | Follow [go-live.md](go-live.md): "Migrate database" applies the schema, "Deploy Edge Functions" deploys, "Sync" runs on schedule and by dispatch, "Backup database" writes its first encrypted archive and logs its size, `fnb status` shows incremental runs within 30 minutes | waits for owner |
| OC-10 | Cloud measurements | NFR-PERF-02, NFR-PERF-05, NFR-PERF-07, FR-TEN-17, NFR-OBS-01 | After go-live, by the verifier with the owner's access | Lighthouse on the live app; a timed analytics refresh; the timings of the first incremental runs; the two-tenant run with throwaway users, removed afterwards; the first job summaries carry counts only | planned |
| OC-11 | Wording review | FR-REP-19 | Any time | Read [reports/cau-van-bao-cao.md](reports/cau-van-bao-cao.md) (689 Vietnamese templates of the periodic reports) and [reports/cau-van-chu-de.md](reports/cau-van-chu-de.md) (503 templates of the thematic reports and Settings), each with its English meaning, and mark changes | open |
| OC-12 | Phase 10 inputs | FR-SET-01, FR-SET-03, FR-SET-04, FR-THM-02, FR-THM-03 | Phase 10 | Enter item costs for the top items of one store, one monthly target, seat counts and opening hours; check that the margins, the pace and the per-hour figures look right | planned |
| OC-13 | Strategy runs | FR-STR-02, FR-STR-09 | Phase 11b | Create the publisher login's local `.env`; run `/strategy` twice in the owner's own assistant; check that every initiative cites a number from the pack; decide the monthly routine (gate G5) | planned |
| OC-14 | Legal and paperwork decisions | FR-CMP-09, FR-CMP-17, FR-CMP-20 | Track Z; before Track C goes public | Record the legal form and the dossier or exemption (gate G3); publish the privacy notice; record the data protection officer decision | waits for owner |
| OC-15 | Seven-day parallel verification | FR-DQ-13 | Phase 20b | Each day for seven consecutive days compare each store with the POS reports A01, B07 and C02; the verifier runs the reports live check each day | planned |
| OC-16 | Zalo console and device checks | FR-STF-21, FR-LOY-27 and the device checks of section 10.14 | Tracks B and C | Confirm the approved permissions and the published apps in the Zalo console; open the Mini Apps on real phones | planned |

## 12. Risks to testing and known gaps

### 12.1 Risks

The delivery risks are in [plan.md, section 7](plan.md#7-risk-register); these are the risks to the tests themselves.

| ID | Risk | Effect on testing | Mitigation |
|---|---|---|---|
| T-01 | The real tenant lives on the test stack | A reset or a careless test could destroy or alter real data, and private figures could reach a log | The never-reset rule; fixture tenants with their guards; read-only live checks that print counts only; counts compared before and after; the parity guard |
| T-02 | The long-lived stack ages | Date-dependent tests fail on the build machine and pass in CI | Anchor on seeded data; fixed clocks; CI's fresh stack as the reference (plan risk R-16) |
| T-03 | One shared build machine | Contention makes suites slow or flaky; sleep breaks long runs; a disk fault loses uncommitted work | One package at a time with two workers; port offsets; `caffeinate -i`; the owner commits each verified step (plan risk R-01) |
| T-04 | Uncommitted work | CI on GitHub has never run phases 7 to 12 | The verifier reruns CI's commands locally; the final pass; the owner's push confirms (plan risk R-08) |
| T-05 | No cloud project yet | Every cloud acceptance line is unproven | The go-live checklist; OC-05 to OC-10 scheduled at go-live (plan risk R-10) |
| T-06 | Owner checks need the owner's time and private figures | Phases stay "complete locally" | Live checks reduce the owner's part to a comparison; the `LIVE_ACCEPTANCE` hook; the owner-check list with deep links (plan risk R-15) |
| T-07 | The POS API is private, and live checks need real credentials | Drift shows only on real data | zod validation and typed errors; opt-in live suites; reconciliation of every store-day (plan risk R-03) |
| T-08 | Only Chromium with a desktop profile is automated | Defects specific to Safari, iOS or Firefox can pass unseen | 360 px checks on every page; the owner's phone checks at go-live; a WebKit project in Playwright proposed for 20b |
| T-09 | Some checks run outside CI | Integration suites, web build checks, the API check and the advisors can be skipped by a hurried run | They are verification lines; requests R-T04, R-AS09, R-AP01 and R-T01 move them into CI |
| T-10 | The notification providers are mocked | Real Zalo Bot and e-mail limits and answers can differ | Timeouts recorded as uncertain and never resent; the owner's first link and test message; OC-08 |
| T-11 | Counts move while step 12b is in build | The figures in this plan age quickly | Every figure is dated; sections 8 and 9 are refreshed at each phase end |
| T-12 | Mini App testing needs Zalo access, and test users bypass permission approval | Tests with test users prove nothing about approvals | Console checks (OC-16); the phase 13 probes; Zalo policies as acceptance criteria (ADR-022) |

### 12.2 Known gaps

| # | Gap | Requirements | What closes it |
|---|---|---|---|
| 1 | The integration suites do not run in CI | NFR-MNT-03, FR-OPS-01 | Step 12c plans to add the notification suites to the `database` job; request R-T04 proposes the sync and CLI suites |
| 2 | The web build checks do not run in CI | NFR-SEC-02, NFR-PERF-01 | Request R-AS09 |
| 3 | The API reference check and the database advisors do not run in CI | NFR-MNT-10, NFR-SEC-09 | Requests R-AP01 and R-T01 |
| 4 | No repeatable test of the Edge Function's HTTP answers | FR-SYNC-17 | A Deno test of the handler (section 9.6) |
| 5 | No assertion that no materialised view exists; no `search_path` audit of every function; `app.data_roles` reported by the advisors | NFR-SEC-01, NFR-SEC-09 | Request R-T01 |
| 6 | The CLI does not refuse a plaintext `sslmode` on a remote host | NFR-SEC-05 | Requests R-AS06 and R-T02 |
| 7 | Untested web paths: the card error and size message, the new-version prompt, the navigation placement | FR-REP-14, NFR-UX-04, NFR-UX-02 | The tests of section 9.6 |
| 8 | Not built: schema-diff and type drift checks, the column-name lint, the preflight log lint, the reset guard | NFR-MNT-06, NFR-MNT-07, NFR-HYG-06, FR-OPS-06 | Owner decision D4 in [plan.md](plan.md); requests R-F03 and R-Q01 |
| 9 | No restore drill yet | FR-OPS-07 | Quarterly once backups exist; phase 20b |
| 10 | No cloud RLS run yet | FR-TEN-17 | At go-live (OC-10) |
| 11 | The keep-alive workflow fails, and the cron report misreads delays | FR-OPS-09, FR-OPS-10 | Requests R-P01 and R-P03 |
| 12 | No automated no-comment scan and no import-boundary check | NFR-MNT-05, NFR-MNT-11 | The checks of section 9.6 |
| 13 | No recorded proof that the secrets job fails on a planted secret | NFR-HYG-02 | An owner-run probe on a throwaway branch |
| 14 | The tests of phases 10 and 11 and of step 12c are not written | section 9.5 | Their build steps |
| 15 | The tests of Tracks B, C and D are planned only | section 9.5 | Their build specs |

### 12.3 Correction requests referenced in this plan

A difference between a document and the code, or a missing check in a file another stream owns, goes to that file's owner as a request with file, line, problem and proposed text ([plan.md, section 2.2](plan.md#22-two-build-streams)). The requests this plan refers to, as of 2026-11-12, are below; the tracked list of every request of the documentation set, with its owner and state, is [plan.md, section 8.1](plan.md#81-open-correction-requests).

| Request | File | What it asks |
|---|---|---|
| R-AP01 | `.github/workflows/ci.yml` | Run `pnpm docs:check-api` in the `database` job |
| R-AS05 | `docs/decisions.md` (ADR-023), `docs/roadmap.md` (phase 5) | The guard against `db reset --linked` does not exist: build it or amend the text |
| R-AS06 | `apps/jobs/src/services.ts` | Make the CLI refuse a plaintext `sslmode` on a remote host, as the Edge Function does |
| R-AS09 | `.github/workflows/ci.yml` | Run `pnpm --filter @fnb/web build`, with its bundle and size checks, in CI |
| R-AS11 | `apps/web/index.html` | Evaluate a `meta` Content Security Policy, with a Playwright check |
| R-F03 | `docs/roadmap.md`, `docs/decisions.md` | The promised drift checks, preflight log lint, column-name lint and single probe workflow: build them or amend the text |
| R-F13 | `docs/go-live.md` | Add the step for the notification secrets, linking and the test message |
| R-P01 | `.github/workflows/workflows-active.yml` | Tell `gh` which repository to use, then confirm the workflow is green |
| R-P03 | `scripts/cron-delay-report.mjs` | Attribute late runs to the right slot and count skipped slots |
| R-Q01 | `docs/roadmap.md`, `docs/decisions.md` | The reset guard of phase 5 and ADR-023 does not exist |
| R-Q04 | `docs/roadmap.md` | Opening dates come from the store profile in 10b, not from onboarding |
| R-T01 | `supabase/tests/03_rls_enabled.sql`, a migration for `app.data_roles`, `docs/requirements.md` | Assert that no materialised view exists, audit the `search_path` of every function, run the database advisors in the verification or CI, fix or document `app.data_roles` |
| R-T02 | `docs/requirements.md` | NFR-SEC-05 is not yet true for the CLI: show it as built until the CLI refuses plaintext connections |
| R-T03 | `docs/status.md` | The phase 12 row calls step 12b verified; on 2026-11-12 it is still in its integration and verification |
| R-T04 | `.github/workflows/ci.yml` | Run the sync and CLI integration suites on CI's fresh stack |

## 13. Reporting

### 13.1 Where results are recorded

| Record | What it holds | Updated by | When |
|---|---|---|---|
| [status.md](status.md) | Phase and step states; the verification figures (unit tests passed and skipped, pgTAP planned and passed, Playwright passed, Lighthouse, real-data checks as pass or fail); known small issues; owner checks as open, passed or failed with a date | verifier | after each green verdict, at the final pass, when an owner action changes |
| [requirements.md](requirements.md) | Each requirement's status, with the verdict that proves it | verifier | with the verdict |
| This plan | The inventory (section 8) and the coverage (section 9) | verifier | at each phase end, and when a step adds a suite |
| [roadmap.md](roadmap.md) | The status column and status lines | verifier; the owner approves | at each phase end |
| The step's verdict | Every checklist line with pass or fail and counts | verifier | each step |
| `docs/private/` | Owner-check results with their figures; the acceptance figures | owner | each check |
| GitHub Actions | CI per push and pull request; job summaries with counts and numbered stores only | GitHub | each run |
| After go-live | `fnb status`, `fnb doctor`, `fnb notify status`, the daily digest | operator | the calendar of [operations.md, section 5](operations.md#5-maintenance-calendar) |

### 13.2 Cadence

- **Each step:** the verdict, a [status.md](status.md) update and a short plain-language note to the owner ([plan.md, section 9](plan.md#9-reporting)).
- **Each phase end:** the roadmap status, the requirement statuses, sections 8 and 9 of this plan.
- **Each push:** CI.
- **Before go-live:** the final integration pass on a freshly reset stack.
- **After go-live:** daily (Hôm nay, red runs), weekly (`fnb doctor`, `fnb status`, `fnb notify status`, the backup, the scheduled-workflows check), monthly (OC-01, database size, Zalo Bot message count), quarterly (the restore drill), as [operations.md, section 5](operations.md#5-maintenance-calendar) lists.

### 13.3 What a verdict contains

- Each checklist line: pass, fail, or skipped with the reason; for a fail, the counts the command printed.
- Test totals: unit tests passed and skipped per package, pgTAP planned and passed, Playwright passed per project, and which gated suites ran.
- The real tenant's counts before and after.
- The defects found, with severity and state.
- The owner checks and cloud checks still open.
- No name, address, chat id, token or amount.

### 13.4 Keeping this plan current

- A new suite or pgTAP file: add it to sections 2 and 8.
- A requirement whose test is written: change its coverage in section 9 and take it out of section 9.5 or 9.6.
- A new phase build spec: refine its rows in section 10 from the spec's verification checklist (the phase 10 and phase 11 specs dated 2026-11-12 await review).
- Requirement IDs are never reused or renumbered ([requirements.md](requirements.md)).
