# FNB Manager

Manager platform for food & beverage shops. It syncs sales data from the shop's POS into a Postgres database, turns it into easy-to-understand periodic and thematic reports, packages the numbers into an AI data pack that Claude turns into a store plan, and extends into a Zalo app for staff and a Zalo loyalty programme for customers. Built to be reused: adding a shop, a store, another owner or another POS system is configuration, not code.

The first connector is iPOS Fabi (Vietnam). The first users are two single-store brands in the same neighbourhood.

## Layout

| Path | Purpose |
|---|---|
| `apps/web/` | Static web app (Vite + React + TypeScript), deployed to GitHub Pages |
| `apps/jobs/` | Node CLI (`fnb`): onboarding, POS sync, backfill, reconciliation, AI data pack, publish-plan, digests, doctor |
| `packages/core/` | Canonical POS-agnostic data model, normalisation rules (business day, sizes, payment kinds), shared utilities |
| `packages/connector-core/` | `PosConnector` interface with capabilities, registry and the conformance test suite every connector must pass |
| `packages/connector-mock/` | Seeded synthetic connector shaped like real café data, used by tests, the demo tenant and end-to-end runs |
| `packages/connector-ipos/` | iPOS Fabi connector: typed API client and the normaliser to the canonical model |
| `supabase/` | Database migrations, row-level security, seed, pgTAP tests, local Supabase configuration |
| `scripts/` | Repository checks (`check-public-safe.mjs`) and operations helpers (`cron-delay-report.mjs`) |
| `.github/workflows/` | CI (lint, typecheck, tests, migrations, secret and identifier scan), migrations, backups, cron probes, deployments |
| `.claude/skills/strategy/` | Claude Code skill that writes a store plan from the data pack |
| `docs/` | Roadmap, decisions, schema, secrets contract, connector docs, deep dives (`docs/private/` is gitignored and holds anything shop-specific) |

Start with `docs/roadmap.md`, then `docs/decisions.md` and `docs/schema.md`.

## Local development

Requirements: Node 22+, pnpm 9+, Docker (for the local Supabase stack).

```sh
pnpm install
pnpm db:start
cp .env.example .env
pnpm test
pnpm lint
pnpm exec supabase test db
node scripts/check-public-safe.mjs
```

`pnpm db:start` prints the local API URL and keys to put into `.env`; `pnpm db:reset` reapplies every migration and the synthetic seed, which also creates a development login for the web app.

## Secrets and public-repository rules

Never commit credentials. Locally they live in `.env` (gitignored). In production they live in GitHub Actions secrets and variables and in Supabase secrets — the full contract is in `docs/secrets.md`. The repository is public, so it contains code only: no exports, snapshots, account identifiers or revenue figures. CI runs gitleaks and `scripts/check-public-safe.mjs` on every push; the same script runs locally and also checks an optional private identifier list in `docs/private/identifiers.txt`.
