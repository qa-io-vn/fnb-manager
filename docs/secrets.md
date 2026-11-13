# Secrets and variables

Nothing sensitive is committed. Credentials live in three places only: the owner's local `.env` (gitignored), GitHub Actions secrets and variables, and Supabase (Vault and Edge Function secrets). The repository is public, so job logs and summaries must never print a credential or a shop identifier; every job masks the credential fields it parses before logging anything.

## GitHub Actions secrets

| Secret | Used by | Content |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | migrate, backup, function deploys | personal access token from the Supabase dashboard, scoped to this project. A scoped token needs `project_admin_read` and `projects_read` for `supabase link` (migrate, backup; `db push` and `db dump` then use the database password), and `edge_functions_write`, `edge_functions_read` and `projects_read` for `supabase functions deploy` (the scopes its `--help` lists for a deploy bundled locally with JWT verification configured in `config.toml`). Setting the function's secrets from your own machine needs `edge_functions_secrets_write`, which the workflows never need |
| `SUPABASE_DB_PASSWORD` | migrate, backup | the project's database password |
| `SUPABASE_PROJECT_ID` | migrate, backup, function deploys | the project reference |
| `SUPABASE_SECRET_KEY` | `fnb tenant add-member`, digests | the project's secret API key (`sb_secret_…`); replaces the legacy service-role JWT. `sync.yml` does not pass it: `sync window` and `status` never call the Auth admin API |
| `SUPABASE_DB_URL` | sync (`sync.yml`), `fnb` in CI | the **session-pooler** connection string with TLS required (`postgresql://postgres.<ref>:<password>@<pooler-host>:5432/postgres?sslmode=require`); GitHub runners have no IPv6 and the direct database host is IPv6-only on the Free plan. `fnb` asks for TLS on any host that is not local even without the suffix. The user and the password inside it are masked at job start |
| `POS_ACCOUNTS_JSON` | sync, onboarding; the same value is an Edge Function secret | JSON array of POS accounts: `[{"key":"account-1","connector":"ipos-fabi","email":"…","password":"…"}]` (optionally `"appAccessToken"`; `{"key":"account-2","connector":"mock","seed":1}` for a synthetic account); every credential field and every key is masked at job start. Use neutral keys that name no shop: the key is stored in `pos_accounts.account_key` and typed in commands, and CI output refers to accounts only by their position in this array |
| `IPOS_APP_KEY` | sync, onboarding; the same value is an Edge Function secret | the constant application key the iPOS CMS sends in its `access_token` header; obtained from the owner's CMS session, not committed. An account entry may carry its own `appAccessToken` instead |
| `BACKUP_AGE_RECIPIENT` | backup | the `age` public key; the private key stays offline with the owner |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | backup | an S3-compatible private bucket (Cloudflare R2 or similar) for encrypted dumps |
| `NOTIFY_EMAIL_API_KEY` | digests, failure alerts | HTTPS email provider key (Edge Functions cannot send SMTP) |
| `ZALO_BOT_TOKEN` | digests, alerts | Zalo Bot API token |

## GitHub Actions variables (public by design)

| Variable | Used by | Content |
|---|---|---|
| `SUPABASE_URL` | web build, `fnb tenant add-member` | the project's API URL |
| `SUPABASE_PUBLISHABLE_KEY` | web build | the publishable API key (`sb_publishable_…`); safe in the browser, row-level security carries the protection |

The web build's base path is not a variable: `deploy-web.yml` sets `VITE_BASE_PATH` from the GitHub Pages configuration (`/<repository>/` for a project site, `/` for a custom domain).

## What each `fnb` command needs

The CLI (`docs/sync.md`) talks to Postgres directly with the database URL and uses the secret API key only for the Supabase Auth admin API.

| Command | Database URL | `SUPABASE_URL` + `SUPABASE_SECRET_KEY` | `POS_ACCOUNTS_JSON` (+ `IPOS_APP_KEY`) |
|---|---|---|---|
| `tenant create` | yes | no | no |
| `tenant add-member` | yes | only when the login has to be created | no |
| `onboard` | yes | no | the account's entry |
| `sync window`, `sync master`, `sync incremental` | yes | no | the account's entry (every entry with `--all-accounts`) |
| `status` | yes | no | optional; when present, accounts are numbered by their position in it, as in `sync window` |
| `doctor` | yes | no | every entry (each one logs in once) |
| `mask-credentials`, `--help` | no | no | no |

In `sync.yml` the secrets are set on the `fnb` steps only (mask, sync, status), not on the job, so checkout, the setup actions and `pnpm install` with its lifecycle scripts run without them. The job gets `SUPABASE_DB_URL`, `POS_ACCOUNTS_JSON` and `IPOS_APP_KEY`; nothing in it needs `SUPABASE_SECRET_KEY`.

The database URL is `DATABASE_URL` locally (the local stack) and `SUPABASE_DB_URL` in CI; each side falls back to the other when its own is missing. Locally the legacy `SUPABASE_SERVICE_ROLE_KEY` printed by older `supabase start` versions is accepted when `SUPABASE_SECRET_KEY` is empty. `FNB_MEMBER_PASSWORD` gives `tenant add-member` the password of a new login without putting it on the command line.

On GitHub Actions every `fnb` run first prints `::add-mask::` for the key, e-mail, password and `appAccessToken` of every `POS_ACCOUNTS_JSON` entry, `IPOS_APP_KEY`, the Supabase secret key and the user and password inside the database URL, both URL-encoded and decoded (GitHub only masks whole secret values, never fields inside a JSON secret). The value is encoded the way the runner decodes workflow commands (`%` as `%25`, CR as `%0D`, LF as `%0A`), so a password containing `%25` is masked as itself; a multi-line value is masked line by line. In CI the output never names an account key or a tenant slug, not even in an error: an account listed in `POS_ACCOUNTS_JSON` is "account 1", "account 2", … by its position there, the number `--account-number` takes, and an onboarded account missing from it (the demo tenant's seeded accounts, for example) is "other 1", "other 2", … in tenant and key order, so it is never mistaken for an entry. The stores of `status` carry their account's label, and the Edge Function labels a store as "account N store M", M counting the account's stores by external id. Error messages pass through the same redactor before they are printed or stored in `sync_runs.error_message`.

## Supabase secrets (Edge Functions and Vault)

| Secret | Used by |
|---|---|
| `POS_ACCOUNTS_JSON` | `sync-incremental`: the same JSON array as the GitHub secret; the function picks the entry whose key is the store's `pos_accounts.account_key` |
| `IPOS_APP_KEY` | `sync-incremental`, unless every entry carries `appAccessToken` |
| `FNB_DB_URL` | `sync-incremental`, optional: overrides the injected `SUPABASE_DB_URL` (the direct connection) with another session-mode string, such as the session pooler with `?sslmode=require`; never the transaction pooler, because the store lock is a session lock. The function speaks TLS to any host that is not local and refuses a URL whose `sslmode` would allow plaintext |
| `FNB_DB_CA_CERT` | `sync-incremental`, optional: the PEM of the certificate authority of the database's TLS certificate (Project settings → Database → SSL configuration), needed only if the runtime does not trust it already. It spans several lines, so set it on its own: `pnpm exec supabase secrets set FNB_DB_CA_CERT="$(cat <ca file>)" --remote=<project ref>` |
| `FNB_INCREMENTAL_WALL_MS`, `FNB_INCREMENTAL_CPU_MS` | `sync-incremental`, optional: the run's wall-clock and estimated-CPU budget in milliseconds, default 105000 and 1200 for the Free plan; at most 390000 (paid plans allow 400 s of wall clock) and 2000 (the CPU limit on every plan) |
| `ZALO_APP_SECRET_<brand>` | Mini App session verification, phone-number token decoding |
| `ZALO_OA_SECRET_<brand>` | webhook signature verification |
| `ZALO_OA_REFRESH_TOKEN_<brand>` | OA token refresh job (single-use; rotated by the job) |
| `ZMP_DEVELOPER_REFRESH_TOKEN` | Mini App deploys (one-month life; rotated by its job) |
| `VOUCHER_CALLBACK_PATH_SECRET` | the iPOS CRM voucher-validation callback URL |

Edge Function secret names may not start with `SUPABASE_`. Supabase injects `SUPABASE_URL`, `SUPABASE_DB_URL`, the API keys and `SUPABASE_JWKS` into every function itself ([supabase.com/docs/guides/functions/secrets](https://supabase.com/docs/guides/functions/secrets)). Set the function's secrets from a file outside the repository, each value in single quotes (`POS_ACCOUNTS_JSON='[…]'`; unquoted, ` #` inside a value starts a comment and the rest is dropped): `pnpm exec supabase secrets set --env-file <file> --remote=<project ref>`; a change takes effect without a redeploy. Locally, `supabase functions serve --env-file <file>` reads the same variables, from a file that is not in the repository either.

The `pg_cron` schedule that calls `sync-incremental` holds no credential: each call carries a single-use ticket that the database issued a moment earlier and the function claims through its own database connection (ADR-028). Nothing for it goes into Vault, and no API key is stored in the database.

## Local `.env`

Copy `.env.example` and fill in the local Supabase keys printed by `pnpm db:start`, the POS accounts, `IPOS_APP_KEY` (the iPOS CMS application key; the live connector tests need it), and later the publisher login used by `/strategy`. The file is gitignored; the public-safety scan (`node scripts/check-public-safe.mjs`) refuses to pass if a credential-shaped string appears in a tracked file.

## Rotation

Rotate the POS passwords, the Supabase secret key and the Zalo secrets at launch and whenever a person with access leaves. The runbook lists the order (rotate at the provider, update the secret, re-run the affected workflow, confirm the next scheduled run is green).
