# Supabase on the Free plan: limits, workflow and multi-tenant security

Checked 2026-11-07 against Supabase's own documentation. Numbers are quoted as published; inferences are marked.

## What the Free plan gives us

| Item | Free | Pro (US$25/month per organisation) |
|---|---|---|
| Active projects | 2 per account (paused ones do not count) | unlimited, billed |
| Compute | Nano: shared CPU, ≈0.5 GB RAM, 60 direct connections, 200 pooler clients | Micro (1 GB RAM) covered by US$10 credit |
| Database | 500 MB quota (soft: Fair Use → HTTP 402); 2 GB fixed disk, read-only at 95 % | 8 GB autoscaling disk, US$0.125/GB beyond |
| Egress (unified) | 5 GB/month, grace period then restriction | 250 GB, US$0.09/GB beyond |
| Storage | 1 GB, 50 MB per file | 100 GB, up to 500 GB per file |
| Edge Functions | 500,000 invocations/month, 150 s wall clock | 2 million, 400 s wall clock |
| Auth | 50,000 MAU; built-in mailer 2 emails/hour | 100,000 MAU |
| Realtime | 200 connections, 2 million messages | 500 connections, 5 million messages |
| Logs | 1 day | 7 days |
| Backups | none | daily, 7 days kept; PITR add-on from US$100/month |
| Branching | not included | US$0.01344 per branch-hour (≈US$0.32/day) |
| Pausing | after ~7 days of low database activity | never |

Pausing: Supabase pauses a Free project that shows low activity over a 7-day period; "a few user requests to the database each day" is enough to stay awake, a warning email arrives about a week before, and a paused project can be restored for up to one year with data intact. Our 30-minute sync and nightly job are the keep-alive; a week of failed POS logins is therefore also a pause risk, which `fnb doctor` should flag.

Capacity reality for this project: the two shops' history (~250k rows plus `raw jsonb`) fits under the roadmap's 300 MB ceiling, but WAL counts toward the 2 GB disk and a weekly 300 MB logical dump through the pooler costs about 1.3 GB of the 5 GB monthly egress. Egress, not storage, is the quota to watch.

## CLI and CI workflow

Local development runs the Supabase stack in Docker. The loop is `supabase migration new <name>` → edit `supabase/migrations/<timestamp>_<name>.sql` → `supabase db reset` (reapplies all migrations, then `supabase/seed.sql` or the `[db.seed] sql_paths` globs) → `supabase test db` (pg_prove over `supabase/tests/*.sql`, each file in its own rolled-back transaction). Dashboard experiments are captured with `supabase db diff -f <name>`; the default pg-delta engine supports `--strict-coverage`, and the legacy migra engine is documented to miss publications, storage buckets and `security_invoker` attributes.

In GitHub Actions use `supabase/setup-cli@v3` pinned to an exact CLI version (the docs pages still show `@v1`). `ci.yml` runs `supabase db start`, `supabase test db`, `supabase db diff --strict-coverage` and `supabase gen types typescript --local > packages/db/types.ts` followed by a `git diff --exit-code` drift check. `migrate.yml` needs `SUPABASE_ACCESS_TOKEN` (read access to Project Settings, API Keys and API Key Secrets), `SUPABASE_DB_PASSWORD` and the project ref, then `supabase link --project-ref $SUPABASE_PROJECT_ID` and `supabase db push --yes --remote`; applied migrations are recorded in `supabase_migrations.schema_migrations`, in timestamp order, so one push at a time (concurrency group). `supabase migration list --remote` and `migration repair --status applied|reverted` fix history; `supabase db reset --linked` drops every user object in the remote database and must never appear in a workflow. Edge Functions deploy with `supabase functions deploy --remote=$PROJECT_ID --yes`.

Branching is a Pro feature (US$0.01344/hour, data-less by default, outside the Spend Cap). On Free, the second project slot is the only staging option; local Docker in CI is the default.

## Row Level Security for tenants

Supabase's benchmark on a 100k-row table is the design brief: an index on the policy column takes a query from 171 ms to under 0.1 ms; wrapping `auth.uid()` in `(select auth.uid())` from 179 ms to 9 ms; moving a role lookup into a `security definer` function from 178,000 ms to 12 ms; `TO authenticated` from 170 ms to under 0.1 ms; and avoiding policy joins from 9,000 ms to 20 ms.

Pattern for every canonical table:

- `private.tenant_ids()` and `private.has_role(tenant uuid, role text)` as `security definer stable` functions with `set search_path = ''`, fully schema-qualified, living in the unexposed `private` schema, execute granted to `authenticated`.
- Policies per operation, `TO authenticated`, `using (tenant_id in (select private.tenant_ids()))`; writes additionally check `private.has_role(tenant_id, 'manager')`.
- Composite btree indexes leading with `tenant_id`, e.g. `(tenant_id, store_id, business_date)`.
- Store roles in `raw_app_meta_data` or membership tables, never `raw_user_meta_data`.

Surface hardening: expose only `public`; disable "Automatically expose new tables"; in the first migration run the documented `alter default privileges … revoke all on tables/sequences/functions from anon, authenticated, service_role` and `revoke execute on functions from public`, then grant explicitly. Sign-ups are disabled and anon gets nothing. Views in `public` are created `with (security_invoker = true)` so they inherit table policies (Postgres 15+).

Materialized views cannot carry RLS and do not inherit policies; the database linter flags any that `anon`/`authenticated` can select (lint 0016, remediation `revoke select … from public, anon, authenticated`). For this platform the better answer is tenant-keyed aggregate tables (`daily_sales`, `hour_weekday_sales`, …) maintained incrementally by the sync for the touched store-days: they carry `tenant_id` and RLS, refresh per tenant (a matview cannot) and stay cheap on a 0.5 GB Nano. Any matview that remains lives in an unexposed `analytics` schema behind a tenant-filtered view or RPC (inference from the linter guidance).

The Data API returns at most 1,000 rows by default (`api.max_rows = 1000`). Keep it and paginate with `.order(stable_key).range(from, to)` plus `count: 'exact'`; exports split by month and page. API keys: use the new `sb_publishable_…` key in the Pages build and `sb_secret_…` (service_role, bypasses RLS) only in Actions and Edge Functions; legacy `anon`/`service_role` JWTs are deprecated by end of 2026.

## Edge Functions, cron and webhooks

Edge Functions run Deno 2.1 (all regions since 2025-08-15) with 256 MB memory, 2 s CPU per request, 150 s wall clock on Free, 100 functions and 100 secrets per project; secret names cannot start with `SUPABASE_`; set them with `supabase secrets set --env-file` and read with `Deno.env.get`. Zalo webhook receivers set `verify_jwt = false` in `config.toml`, verify Zalo's own signature, answer 200 at once and finish work in `EdgeRuntime.waitUntil`. 500,000 invocations per month is far beyond two shops' event volume.

Supabase Cron (`create extension pg_cron with schema pg_catalog`) schedules from every second (`'30 seconds'`) to yearly, recommends at most 8 concurrent jobs of at most 10 minutes, and never prunes `cron.job_run_details` (schedule a daily delete of rows older than 7 days). HTTP calls go through pg_net (async, 2,000 ms default timeout, ~200 requests/s, responses kept 6 hours in unlogged tables). Database Webhooks are pg_net triggers with no documented retry and header secrets stored in the trigger definition (use Vault). GitHub Actions therefore remains the primary scheduler; pg_cron handles only in-database housekeeping.

## Backups on Free

There are none. Supabase advises Free projects to export regularly. Plan from phase 6: a weekly `backup.yml` runs `supabase db dump --db-url <session pooler URL> -f schema.sql`, `--data-only --use-copy -f data.sql`, `--role-only -f roles.sql` and `-s auth --data-only` for users (the default dump excludes `auth` and `storage`), encrypts with age, and uploads to a private destination; artifacts on a public repository are downloadable by anyone, so only encrypted files may be stored there (inference). A quarterly restore into local Supabase proves it. Use the pooler because Free direct connections are IPv6-only and Actions runners are IPv4 (medium confidence, not verified this session).

## Checklist for this project

- [ ] Migration 0001: revoke default privileges, create `private` and `analytics`, disable auto-expose.
- [ ] Tenant helpers as `security definer stable set search_path = ''` in `private`.
- [ ] Policy per operation, `TO authenticated`, `(select private.tenant_ids())`, tenant-leading indexes.
- [ ] `security_invoker = true` on every public view; zero lint-0016 warnings.
- [ ] pgTAP: rls_enabled, cross-tenant zero, anon zero, publisher role negative tests.
- [ ] ci.yml with `setup-cli@v3` pinned, `test db`, `db diff --strict-coverage`, gen-types drift.
- [ ] migrate.yml with link + `db push --yes --remote`, concurrency group, no `db reset --linked` anywhere.
- [ ] New-style keys in secrets/variables; custom SMTP; sign-ups off.
- [ ] Pagination helper (`range`, `count`) shared by web and jobs; max rows stays 1,000.
- [ ] Webhook functions: `verify_jwt = false`, signature check, `waitUntil`.
- [ ] pg_cron cleanup job for `cron.job_run_details`.
- [ ] Weekly encrypted `db dump` to a private location; restore drill documented.
- [ ] `fnb doctor`: database size, disk %, egress estimate, last sync (pause guard), upgrade trigger at ~400 MB or second owner.

## Sources

- https://supabase.com/pricing
- https://supabase.com/docs/guides/platform/billing-on-supabase
- https://supabase.com/docs/guides/platform/free-project-pausing
- https://supabase.com/docs/guides/platform/compute-and-disk
- https://supabase.com/docs/guides/platform/database-size
- https://supabase.com/docs/guides/platform/manage-your-usage/egress
- https://supabase.com/docs/guides/platform/manage-your-usage/branching
- https://supabase.com/docs/guides/platform/cost-control
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/functions/limits
- https://supabase.com/docs/guides/functions/secrets
- https://supabase.com/docs/guides/functions/background-tasks
- https://supabase.com/docs/guides/functions/cicd-workflow
- https://supabase.com/changelog?tags=edge+functions
- https://supabase.com/docs/guides/api/api-keys
- https://supabase.com/docs/guides/auth/rate-limits
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv
- https://supabase.com/docs/guides/database/hardening-data-api
- https://supabase.com/docs/guides/database/database-linter?lint=0016_materialized_view_in_api
- https://supabase.com/docs/reference/cli/config-reference
- https://supabase.com/docs/guides/deployment/managing-environments
- https://supabase.com/docs/guides/deployment/database-migrations
- https://supabase.com/docs/reference/cli/supabase-db-diff
- https://supabase.com/docs/reference/cli/supabase-db-reset
- https://supabase.com/docs/reference/cli/supabase-test-db
- https://supabase.com/docs/guides/database/postgres/testing-row-level-security
- https://supabase.com/docs/guides/local-development/seeding-your-database
- https://supabase.com/docs/reference/cli/supabase-db-dump
- https://github.com/supabase/setup-cli
- https://supabase.com/docs/guides/cron/quickstart
- https://supabase.com/docs/guides/database/extensions/pg_net
- https://supabase.com/docs/guides/database/webhooks
- https://supabase.com/docs/guides/storage/uploads/file-limits
