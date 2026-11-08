# Secrets and variables

Nothing sensitive is committed. Credentials live in three places only: the owner's local `.env` (gitignored), GitHub Actions secrets and variables, and Supabase (Vault and Edge Function secrets). The repository is public, so job logs and summaries must never print a credential or a shop identifier; every job masks the credential fields it parses before logging anything.

## GitHub Actions secrets

| Secret | Used by | Content |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | migrate, backup, function deploys | personal access token from the Supabase dashboard, scoped to this project |
| `SUPABASE_DB_PASSWORD` | migrate, backup | the project's database password |
| `SUPABASE_PROJECT_ID` | migrate, backup, function deploys | the project reference |
| `SUPABASE_SECRET_KEY` | `fnb tenant add-member`, digests | the project's secret API key (`sb_secret_…`); replaces the legacy service-role JWT. `sync.yml` does not pass it: `sync window` and `status` never call the Auth admin API |
| `SUPABASE_DB_URL` | sync (`sync.yml`), `fnb` in CI | the **session-pooler** connection string (`postgresql://postgres.<ref>:<password>@<pooler-host>:5432/postgres`); GitHub runners have no IPv6 and the direct database host is IPv6-only on the Free plan. The user and the password inside it are masked at job start |
| `POS_ACCOUNTS_JSON` | sync, onboarding | JSON array of POS accounts: `[{"key":"account-1","connector":"ipos-fabi","email":"…","password":"…"}]` (optionally `"appAccessToken"`; `{"key":"account-2","connector":"mock","seed":1}` for a synthetic account); every credential field and every key is masked at job start. Use neutral keys that name no shop: the key is stored in `pos_accounts.account_key` and typed in commands, and CI output refers to accounts only by their position in this array |
| `IPOS_APP_KEY` | sync, onboarding | the constant application key the iPOS CMS sends in its `access_token` header; obtained from the owner's CMS session, not committed. An account entry may carry its own `appAccessToken` instead |
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
| `sync window`, `sync master` | yes | no | the account's entry (every entry with `--all-accounts`) |
| `status` | yes | no | optional; when present, accounts are numbered by their position in it, as in `sync window` |
| `doctor` | yes | no | every entry (each one logs in once) |
| `mask-credentials`, `--help` | no | no | no |

In `sync.yml` the secrets are set on the `fnb` steps only (mask, sync, status), not on the job, so checkout, the setup actions and `pnpm install` with its lifecycle scripts run without them. The job gets `SUPABASE_DB_URL`, `POS_ACCOUNTS_JSON` and `IPOS_APP_KEY`; nothing in it needs `SUPABASE_SECRET_KEY`.

The database URL is `DATABASE_URL` locally (the local stack) and `SUPABASE_DB_URL` in CI; each side falls back to the other when its own is missing. Locally the legacy `SUPABASE_SERVICE_ROLE_KEY` printed by older `supabase start` versions is accepted when `SUPABASE_SECRET_KEY` is empty. `FNB_MEMBER_PASSWORD` gives `tenant add-member` the password of a new login without putting it on the command line.

On GitHub Actions every `fnb` run first prints `::add-mask::` for the key, e-mail, password and `appAccessToken` of every `POS_ACCOUNTS_JSON` entry, `IPOS_APP_KEY`, the Supabase secret key and the user and password inside the database URL, both URL-encoded and decoded (GitHub only masks whole secret values, never fields inside a JSON secret). The value is encoded the way the runner decodes workflow commands (`%` as `%25`, CR as `%0D`, LF as `%0A`), so a password containing `%25` is masked as itself; a multi-line value is masked line by line. In CI the output never names an account key or a tenant slug, not even in an error. Error messages pass through the same redactor before they are printed or stored in `sync_runs.error_message`.

## Supabase secrets (Edge Functions and Vault)

| Secret | Used by |
|---|---|
| `ZALO_APP_SECRET_<brand>` | Mini App session verification, phone-number token decoding |
| `ZALO_OA_SECRET_<brand>` | webhook signature verification |
| `ZALO_OA_REFRESH_TOKEN_<brand>` | OA token refresh job (single-use; rotated by the job) |
| `ZMP_DEVELOPER_REFRESH_TOKEN` | Mini App deploys (one-month life; rotated by its job) |
| `VOUCHER_CALLBACK_PATH_SECRET` | the iPOS CRM voucher-validation callback URL |

Edge Function secret names may not start with `SUPABASE_`.

## Local `.env`

Copy `.env.example` and fill in the local Supabase keys printed by `pnpm db:start`, the POS accounts, `IPOS_APP_KEY` (the iPOS CMS application key; the live connector tests need it), and later the publisher login used by `/strategy`. The file is gitignored; the public-safety scan (`node scripts/check-public-safe.mjs`) refuses to pass if a credential-shaped string appears in a tracked file.

## Rotation

Rotate the POS passwords, the Supabase secret key and the Zalo secrets at launch and whenever a person with access leaves. The runbook lists the order (rotate at the provider, update the secret, re-run the affected workflow, confirm the next scheduled run is green).
