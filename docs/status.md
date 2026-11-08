# Build status and next steps

Updated 2026-11-08. This page hands the work over between sessions and machines: what is built and verified, what comes next and in which order, and how to pick it up on another machine. Phase definitions, deliverables and acceptance criteria live in `docs/roadmap.md` and are not repeated here.

Every phase so far went through the same loop: build, an independent review, fixes, then an independent verification that reruns everything CI runs plus checks against real data loaded on the local stack. Nothing below is called done unless that verification passed.

## Where it stands

| Phase | State |
|---|---|
| 1 Foundations and public-repo hygiene | complete |
| 2 Canonical schema, tenancy, RLS, consent and legal tables | complete |
| 3 iPOS connector and API contract | complete, including voids, edits and removed lines |
| 4 Connector contract, mock connector, normaliser | complete |
| 5 Cloud project, onboarding, backups, first data | everything local is complete; the cloud steps wait for the owner (`docs/go-live.md`) |
| 6 Web app foundation and "Hôm nay" | complete locally; a build without Supabase variables is the demo that Pages serves |
| 7 Sync engine | Node runner complete and the full history of both accounts loaded locally with every store-day reconciled; the Edge Function runner is not started |
| 8 Analytics aggregates and metric registry | complete locally |
| 9 to 12 | not started |
| 13 to 20 | not started; they wait for the Track Z paperwork in `docs/roadmap.md` section 5 |

Checks at the last verification:

| Check | Result |
|---|---|
| Unit tests across all packages | 599 |
| pgTAP, 19 files | 675 of 675 |
| Playwright, live and demo | 20 of 20 |
| Lighthouse mobile on the demo build | performance 93, accessibility 100, best practices 100, SEO 60 because of the deliberate `noindex` |
| Store-days equal to the POS control totals | all of them, for both stores, from each store's first sales day |
| Database size with the full history | about 291 MB, under the 300 MB acceptance (ADR-027) |

## What comes next

Two streams can run side by side because they touch different files. The web stream owns `apps/web`, `docs/web-app.md` and `docs/metrics.md`; the backend stream owns `packages/`, `apps/jobs`, `supabase/` and the workflows. Both re-read shared docs before editing them.

### Web stream

1. **Phase 9, periodic reports (3 d).** Settle one design question first: how report numbers reach the page in live mode and in demo mode. The candidates are:
   - one TypeScript path over aggregate-shaped rows for both modes, held to the SQL functions by parity tests;
   - the SQL functions as the single source through RPC in live mode, with a TypeScript port for the demo held to them by parity tests;
   - the real SQL running in the browser for the demo, only if its download size and start-up time are acceptable on a phone.

   Whichever wins, the reports, `metric_value` and the later data pack must produce the same numbers. Then build the shared report foundation and Ngày, then Tuần, Tháng and Năm in parallel, each with its own folder and i18n file.
2. **Phase 10a and 10b, thematic reports, settings and manual data (3 + 3 d).**
3. **The web parts of phases 11 and 12:** export and data-pack buttons, the paste box, the Kế hoạch tab and KPI follow-up, Settings → Cảnh báo and the Bản tin panel.

### Backend stream

1. **Phase 7 remainder: the Edge Function incremental runner.**
   - `supabase/functions/sync-incremental` on the Deno 2 runtime reuses `@fnb/sync` and the connectors through an import map. Replace Node-only APIs such as `Buffer` in the iPOS auth helper without breaking the Node runner.
   - One invocation per store covers the last 3 business days. It compares the POS daily control totals first and pulls detail only for changed or unchecked days.
   - A CPU and wall-time guard is sized to the Free plan's Edge Function limits and hands larger windows to the nightly job. The per-store advisory lock stays; the runner refreshes analytics for the changed days and writes `sync_runs` of kind `incremental`.
   - `pg_cron` calls it every 30 minutes through `pg_net`, only for stores open in store-local time, and stays inert until the owner enables it. POS credentials live only in Edge Function secrets (ADR-006), and the call uses the least-privileged token available.
   - A channel-agnostic `Notifier` with a console implementation covers run and auth failures. A dead-man's switch fires after 90 minutes without a successful sync during opening hours.
   - CI gets a Deno type-check. A deploy step skips until the secrets exist, and `docs/go-live.md` and `docs/secrets.md` get the owner steps.
2. **Phase 12 backend:** `notification_channels`, `alert_rules`, `outbound_messages`, channel policies, the rules engine with cool-down, the e-mail and Zalo Bot channels and `fnb digest`.
3. **Phase 11 backend:** `packages/datapack` with `buildDataPack`, `fnb datapack`, the strategy prompt shipped inside the pack, and `fnb publish-plan` signing in as the `publisher` member. Any assistant-specific wrapper for `/strategy` lives in the owner's personal configuration, outside this repository (ADR-003).

After both streams, one final pass runs everything CI runs, updates the roadmap statuses and checks the docs against the code.

## Known small issues

- `fnb doctor` prints sizes in MiB but labels them MB.
- `supabase/seed.sql` still writes `raw` onto the seeded invoices, lines and payments and creates no `sale_payloads` documents, so a fresh reset seeds the demo tenant in the shape from before ADR-027. No test depends on it.
- `docs/schema.md` says every set-returning helper declares `rows 10000`. That is not true for `daily_net_series`, `weekday_profile`, `seasonal_naive_series`, `summarize_daily` and `dsr_deadlines`, and its Tests paragraph does not list files 18 and 19.
- `docs/secrets.md` does not yet mention the "other N" account labels that `docs/sync.md` describes.
- The Vietnamese text mixes two accent placements: the registry writes "hóa", "hủy" and "tùy", while some interface strings write "hoá", "huỷ" and "tuỳ". Pick one during the wording review in phase 9.
- With two stores the database grows by about 18 MiB a month, so the Free plan's 500 MB lasts roughly a year. Two indexes duplicate the leading column of unique indexes and could free about 7 MB.
- On the demo, the largest contentful paint is about 2.9 s because the demo data is generated before the first card renders. zod loads at start-up through `@fnb/core`.
- At about 305 px of chart width the store bar chart hides its second label, and printed charts keep their on-screen size.
- The web end-to-end job in CI runs on GitHub for the first time with this push.

## Picking the work up on another machine

1. Install Node 22 or later, pnpm 9, Docker with at least 8 GB of memory for the Supabase stack, and git.
2. Clone the repository, run `pnpm install`, then `pnpm db:start`. The first start applies every migration and the seed.
3. Copy two things from the old machine through a private channel, never through this repository:
   - the `.env` file, with the variables listed in `docs/secrets.md`;
   - the whole `docs/private/` folder. `scripts/check-public-safe.mjs` reads the shop identifiers from `docs/private/identifiers.txt` and only checks the generic patterns without it.
4. Write `apps/web/.env.local` from `pnpm db:status` as `docs/web-app.md` describes, then `pnpm --filter @fnb/web dev`.
5. To check reports against real numbers, reload the real data. Create a local tenant with `fnb tenant create` and a login with `fnb tenant add-member`. Then run `fnb onboard` for each account in `.env`, and `fnb sync window … --kind backfill` month by month, walking back with `--dry-run` until a month shows no sales. One account-month takes about a minute. `docs/sync.md` has the exact flags.
6. Confirm with `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm exec supabase test db` and `CI=1 pnpm --filter @fnb/jobs fnb -- status`.

Rules that keep the work safe:
- Once real data is loaded, never run `supabase db reset`: it wipes the local tenant. Apply new migrations with `pnpm exec supabase migration up`.
- Run the CLI with `CI=1` whenever its output is shared; it then masks and numbers accounts.
- No shop name, account e-mail, key or revenue figure goes into a tracked file. Run `node scripts/check-public-safe.mjs` before every commit.
- Never print or copy credential values from `.env`.

## Owner actions still open

- Create the Supabase cloud project, the GitHub secrets and variables, SMTP and the backup destination (`docs/go-live.md`). After that, Pages serves the real app behind login instead of the demo.
- Change the tea shop's POS password (`docs/roadmap.md` section 5).
- The Track Z paperwork in `docs/roadmap.md` section 5: legal form, Zalo accounts and verification, e-invoice registration, iPOS CRM questions and the privacy notice. Tracks B and C cannot start before it.
