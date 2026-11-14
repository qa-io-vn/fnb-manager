# Build status and next steps

Updated 2026-11-08 in the evening. This page hands the work over between sessions and machines: what is built and verified, what comes next and in which order, and how to pick it up on another machine. Phase definitions, deliverables and acceptance criteria live in `docs/roadmap.md` and are not repeated here.

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
| 7 Sync engine | complete locally: the Node runner, the full history of both accounts with every store-day reconciled, and the Edge Function runner `sync-incremental` on its 30-minute schedule; the deploy and the three-day freshness check wait for the cloud project |
| 8 Analytics aggregates and metric registry | complete locally |
| 9 Periodic reports | complete locally: Ngày, Tuần, Tháng and Năm on the demo and on the real data, verified against the POS control totals; the Fabi A01/B01 comparison and the wording review wait for the owner |
| 10 | 10a in progress: report settings, category overrides and the revenue and hours functions are in SQL with exact demo ports (ADR-035, ADR-036); Doanh thu & xu hướng and Giờ & ngày trong tuần open under `#/chu-de` on the demo and on the local stack; Thực đơn, Thanh toán, the Settings pages and the live reference check are next, then 10b |
| 11 | not started |
| 12 Alerts, digests and channel policies | the build spec is final (`docs/private/phase-12-build-spec.md`) and splits the work into three verifiable steps: 12a (schema, outbox, policy decision, Zalo Bot channel, linking, the `notify` CLI) and 12b (the daily digest equal to Ngày, the rule alerts, Brevo e-mail, the Actions steps; acceptance A1 to A3 shown on the local stack) are built and verified locally; 12c (Supabase dispatch, failure alerts, Telegram, Resend, webhook, docs) is next (Supabase dispatch, failure alerts, Telegram, Resend, webhook, docs) |
| 13 to 20 | not started; they wait for the Track Z paperwork in `docs/roadmap.md` section 5 |

Checks at the verification before the push of 0f8fa1d:

| Check | Result |
|---|---|
| Unit tests across all packages | 599 |
| pgTAP, 19 files | 675 of 675 |
| Playwright, live and demo | 20 of 20 |
| Lighthouse mobile on the demo build | performance 95, accessibility 100, best practices 100, SEO 60 because of the deliberate `noindex` |
| Store-days equal to the POS control totals | all of them, for both stores, from each store's first sales day |
| Database size with the full history | about 291 MB, under the 300 MB acceptance (ADR-027) |

Phase 7's verification on 2026-11-08 passed all twelve of its checks: pgTAP over 25 files gives 934 of 934. Every package's unit tests pass, and the 930 checked store-days of the real tenant all match. Both runners work end to end on the local stack, and a second invocation pulls nothing. The database then measured 338 MiB because of dead rows from the test runs; compacted, it is 285 MiB, under the acceptance. The totals for the whole repository are measured again after phase 9's verification.

## What comes next

Two streams can run side by side because they touch different files. The web stream owns `apps/web`, `docs/web-app.md` and `docs/metrics.md`; the backend stream owns `packages/`, `apps/jobs`, `supabase/` and the workflows. Both re-read shared docs before editing them.

### Web stream

1. **Phase 9, periodic reports: done.** Report numbers come from the SQL functions through RPC, and the demo runs a parity-tested TypeScript port (ADR-029). `docs/reports/` documents each report, and `docs/reports/cau-van-bao-cao.md` lists every Vietnamese sentence for the owner's wording review.
2. **Phase 10a and 10b, thematic reports, settings and manual data (3 + 3 d).** The build spec is final (`docs/private/phase-10-build-spec.md`) and split into the issues under #21 and #22. Done in 10a: the settings and mapping tables, the range model, the revenue and hours functions with their demo ports, the Doanh thu and Giờ & ngày pages, the menu functions (`menu_engineering`, `item_margins`, `item_attach`, effective categories in `item_summary`), `basket_pairs`, `modifier_summary`, the cash thresholds of `shift_review` and `cash_variance_flags` read from the settings, and category overrides in the refresh with a tracked catch-up range. Their demo ports and the Thực đơn page with its matrix and margins cards are built; next: the rest of Thực đơn, Thanh toán and Settings.
3. **The web parts of phases 11 and 12:** export and data-pack buttons, the paste box, the Kế hoạch tab and KPI follow-up, Settings → Cảnh báo and the Bản tin panel.

### Backend stream

1. **Phase 7 remainder: done.** The Edge Function runner `sync-incremental`, its `pg_cron` schedule with single-use tickets (ADR-028), change detection, the guard, the console `Notifier`, the dead-man's switch, the CI Deno check and `deploy-functions.yml` are built and verified locally. `docs/sync.md` describes them and `docs/go-live.md` has the owner steps to set the function secrets and enable the schedule.
2. **Phase 12 backend:** `notification_channels`, `alert_rules`, `outbound_messages`, channel policies, the rules engine with cool-down, the e-mail and Zalo Bot channels and `fnb digest`. Its build spec is being written from three competing designs and will be kept in `docs/private/phase-12-build-spec.md`; the console `Notifier` from phase 7 becomes one of its channels.
3. **Phase 11 backend:** `packages/datapack` with `buildDataPack`, `fnb datapack`, the strategy prompt shipped inside the pack, and `fnb publish-plan` signing in as the `publisher` member. Any assistant-specific wrapper for `/strategy` lives in the owner's personal configuration, outside this repository (ADR-003).

After both streams, one final pass runs everything CI runs, updates the roadmap statuses and checks the docs against the code.

## Known small issues

- Test runs leave dead rows behind: after phase 7's verification the local database reached 338 MiB, and `vacuum (full, analyze)` on the fact tables brought it back to 285 MiB with the full history. Repeat it after heavy local testing before measuring the size.
- `supabase/tests/17_analytics_access.sql` test 20 fails on a long-lived local stack once the seeded demo rows are more than a week old, because its window follows `current_date`. A freshly reset stack, as in CI, passes.
- With two stores the database grows by about 18 MiB a month, so the Free plan's 500 MB lasts roughly a year. Two indexes duplicate the leading column of unique indexes and could free about 7 MB.
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
