# Secrets and variables

Nothing sensitive is committed. Credentials live in three places only: the owner's local `.env` (gitignored), GitHub Actions secrets and variables, and Supabase (Vault and Edge Function secrets). The repository is public, so job logs and summaries must never print a credential or a shop identifier; every job masks the credential fields it parses before logging anything.

## GitHub Actions secrets

| Secret | Used by | Content |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | migrate, backup, function deploys | personal access token from the Supabase dashboard, scoped to this project |
| `SUPABASE_DB_PASSWORD` | migrate, backup | the project's database password |
| `SUPABASE_PROJECT_ID` | migrate, backup, function deploys | the project reference |
| `SUPABASE_SECRET_KEY` | nightly sync, backfill, digests | the project's secret API key (`sb_secret_…`); replaces the legacy service-role JWT |
| `POS_ACCOUNTS_JSON` | sync, onboarding | JSON array of POS accounts: `[{"key":"<slug>","connector":"ipos-fabi","email":"…","password":"…"}]`; every credential field is masked at job start |
| `IPOS_APP_KEY` | sync, onboarding | the constant application key the iPOS CMS sends in its `access_token` header; obtained from the owner's CMS session, not committed. An account entry may carry its own `appAccessToken` instead |
| `BACKUP_AGE_RECIPIENT` | backup | the `age` public key; the private key stays offline with the owner |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | backup | an S3-compatible private bucket (Cloudflare R2 or similar) for encrypted dumps |
| `NOTIFY_EMAIL_API_KEY` | digests, failure alerts | HTTPS email provider key (Edge Functions cannot send SMTP) |
| `ZALO_BOT_TOKEN` | digests, alerts | Zalo Bot API token |

## GitHub Actions variables (public by design)

| Variable | Used by | Content |
|---|---|---|
| `SUPABASE_URL` | web build, jobs | the project's API URL |
| `SUPABASE_PUBLISHABLE_KEY` | web build | the publishable API key (`sb_publishable_…`); safe in the browser, row-level security carries the protection |
| `VITE_BASE_PATH` | web build | `/<repository>/` for a project site, `/` for a custom domain |

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
