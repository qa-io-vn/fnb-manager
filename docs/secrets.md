# Secrets and variables

Nothing sensitive is committed. Credentials live in three places only: the owner's local `.env` (gitignored), GitHub Actions secrets and variables, and Supabase (Vault and Edge Function secrets). The repository is public, so job logs and summaries must never print a credential or a shop identifier; every job masks the credential fields it parses before logging anything.

## GitHub Actions secrets

| Secret | Used by | Content |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` | migrate, backup, function deploys | personal access token from the Supabase dashboard, scoped to this project. A scoped token needs `project_admin_read` and `projects_read` for `supabase link` (migrate, backup; `db push` and `db dump` then use the database password), and `edge_functions_write`, `edge_functions_read` and `projects_read` for `supabase functions deploy` (the scopes its `--help` lists for a deploy bundled locally with JWT verification configured in `config.toml`). Setting the function's secrets from your own machine needs `edge_functions_secrets_write`, which the workflows never need |
| `SUPABASE_DB_PASSWORD` | migrate, backup | the project's database password |
| `SUPABASE_PROJECT_ID` | migrate, backup, function deploys | the project reference |
| `SUPABASE_SECRET_KEY` | `fnb tenant add-member`, digests | the project's secret API key (`sb_secret_…`); replaces the legacy service-role JWT. `sync.yml` does not pass it: `sync window` and `status` never call the Auth admin API |
| `SUPABASE_DB_URL` | sync (`sync.yml`), Mini App deploys (`deploy-mini-apps.yml`), `fnb` in CI | the **session-pooler** connection string with TLS required (`postgresql://postgres.<ref>:<password>@<pooler-host>:5432/postgres?sslmode=require`); GitHub runners have no IPv6 and the direct database host is IPv6-only on the Free plan. `fnb` asks for TLS on any host that is not local even without the suffix. The user and the password inside it are masked at job start |
| `POS_ACCOUNTS_JSON` | sync, onboarding; the same value is an Edge Function secret | JSON array of POS accounts: `[{"key":"account-1","connector":"ipos-fabi","email":"…","password":"…"}]` (optionally `"appAccessToken"`; `{"key":"account-2","connector":"mock","seed":1}` for a synthetic account); every credential field and every key is masked at job start. Use neutral keys that name no shop: the key is stored in `pos_accounts.account_key` and typed in commands, and CI output refers to accounts only by their position in this array |
| `IPOS_APP_KEY` | sync, onboarding; the same value is an Edge Function secret | the constant application key the iPOS CMS sends in its `access_token` header; obtained from the owner's CMS session, not committed. An account entry may carry its own `appAccessToken` instead |
| `BACKUP_AGE_RECIPIENT` | backup | the `age` public key; the private key stays offline with the owner |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | backup | an S3-compatible private bucket (Cloudflare R2 or similar) for encrypted dumps |
| `NOTIFY_EMAIL_API_KEY` | digests, failure alerts | HTTPS email provider key (Edge Functions cannot send SMTP) |
| `ZALO_BOT_TOKEN` | digests, alerts | Zalo Bot API token |

## GitHub Actions variables (public by design)

| Variable | Used by | Content |
|---|---|---|
| `SUPABASE_URL` | web build, Mini App builds, `fnb tenant add-member` | the project's API URL |
| `SUPABASE_PUBLISHABLE_KEY` | web build, Mini App builds | the publishable API key (`sb_publishable_…`); safe in the browser, row-level security carries the protection |

The web build's base path is not a variable: `deploy-web.yml` sets `VITE_BASE_PATH` from the GitHub Pages configuration (`/<repository>/` for a project site, `/` for a custom domain).

`deploy-mini-apps.yml` needs the secret `SUPABASE_DB_URL` and the variables `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`, which a Zalo build of a Mini App receives as `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; it skips with a note while one of the three is missing. It holds no Zalo credential of its own: for each Mini App it reads the Mini App id from the `mini_apps` rows and the developer token from `zalo_tokens` through `fnb zalo` commands, writes them to a `.env` in the app's folder for one `zmp-cli` login and deletes the file after the deploy. Those commands (`fnb zalo app-config --list`, `fnb zalo zmp env`) are not built yet, so on 2026-11-18 the workflow ends with a note and deploys nothing. As in `sync.yml`, the secret is set only on the configuration check and the steps that run `fnb` or the deploy, and `fnb mask-credentials` runs first.

## What each `fnb` command needs

The CLI (`docs/sync.md`) talks to Postgres directly with the database URL and uses the secret API key only for the Supabase Auth admin API.

| Command | Database URL | `SUPABASE_URL` + `SUPABASE_SECRET_KEY` | `POS_ACCOUNTS_JSON` (+ `IPOS_APP_KEY`) |
|---|---|---|---|
| `tenant create` | yes | no | no |
| `tenant add-member` | yes | only when the login has to be created | no |
| `onboard` | yes | no | the account's entry |
| `sync window`, `sync master`, `sync incremental` | yes | no | the account's entry (every entry with `--all-accounts`) |
| `ipos-snapshot from-db` | yes | no | no; it reads the database only |
| `bootstrap` (`pnpm db:load-real`) | yes | `SUPABASE_URL` with `SUPABASE_PUBLISHABLE_KEY` to write a missing `apps/web/.env.local`, and `SUPABASE_SECRET_KEY` with `FNB_MEMBER_PASSWORD` only when the owner login has to be created | every entry |
| `status` | yes | no | optional; when present, accounts are numbered by their position in it, as in `sync window` |
| `doctor` | yes | no | every entry (each one logs in once) |
| `datapack` | yes, to build a pack or list stores (`SUPABASE_DB_URL` first in CI); `--check` and `--against` read files only and need nothing | no | no; it reads the database as a member and never reaches the POS |
| `mask-credentials`, `--help` | no | no | no |

In `sync.yml` the secrets are set on the `fnb` steps only (mask, sync, status), not on the job, so checkout, the setup actions and `pnpm install` with its lifecycle scripts run without them. The job gets `SUPABASE_DB_URL`, `POS_ACCOUNTS_JSON` and `IPOS_APP_KEY`; nothing in it needs `SUPABASE_SECRET_KEY`.

`IPOS_REAL_API` (`on` or `off`; unset means `on`) chooses, for every command that reaches iPOS, between the real API and the local iPOS snapshot in `.ipos-snapshot/` (`docs/sync.md`, "Real or fake iPOS"). It is not a secret and no workflow sets it, so CI, GitHub Actions and production keep calling the real API. With `off` the POS credentials and `IPOS_APP_KEY` are never sent anywhere and may be missing. `IPOS_SNAPSHOT_DIR` moves the snapshot, which holds real business data, to another folder outside the repository or below `docs/private/`.

The database URL is `DATABASE_URL` locally (the local stack) and `SUPABASE_DB_URL` in CI; each side falls back to the other when its own is missing. Locally the legacy `SUPABASE_SERVICE_ROLE_KEY` printed by older `supabase start` versions is accepted when `SUPABASE_SECRET_KEY` is empty. `FNB_MEMBER_PASSWORD` gives `tenant add-member` and `bootstrap` the password of a new login without putting it on the command line; `FNB_MEMBER_EMAIL` gives `bootstrap` the owner's e-mail when `--email` is not passed, and `pnpm zalo:dev` the member it signs in when `--member` is not passed. `bootstrap` compares the database URL with `SUPABASE_URL` (local or remote, and the project reference) and refuses to load into a backend the web app would not read.

On GitHub Actions every `fnb` run first prints `::add-mask::` for the key, e-mail, password and `appAccessToken` of every `POS_ACCOUNTS_JSON` entry, `IPOS_APP_KEY`, the Supabase secret key and the user and password inside the database URL, both URL-encoded and decoded (GitHub only masks whole secret values, never fields inside a JSON secret). The value is encoded the way the runner decodes workflow commands (`%` as `%25`, CR as `%0D`, LF as `%0A`), so a password containing `%25` is masked as itself; a multi-line value is masked line by line. In CI the output never names an account key or a tenant slug, not even in an error: an account listed in `POS_ACCOUNTS_JSON` is "account 1", "account 2", … by its position there, the number `--account-number` takes, and an onboarded account missing from it (the demo tenant's seeded accounts, for example) is "other 1", "other 2", … in tenant and key order, so it is never mistaken for an entry. The stores of `status` carry their account's label, and the Edge Function labels a store as "account N store M", M counting the account's stores by external id. Error messages pass through the same redactor before they are printed or stored in `sync_runs.error_message`.

## Supabase secrets (Edge Functions and Vault)

| Secret | Used by |
|---|---|
| `POS_ACCOUNTS_JSON` | `sync-incremental`: the same JSON array as the GitHub secret; the function picks the entry whose key is the store's `pos_accounts.account_key` |
| `IPOS_APP_KEY` | `sync-incremental`, unless every entry carries `appAccessToken` |
| `IPOS_REAL_API` | `sync-incremental`: leave it unset or `on`; the function keeps no iPOS snapshot and answers 500 to every ticket while it is `off` |
| `FNB_DB_URL` | `sync-incremental`, and from #207 `oa-webhook` and `bot-webhook`, optional: overrides the injected `SUPABASE_DB_URL` (the direct connection) with another session-mode string, such as the session pooler with `?sslmode=require`; never the transaction pooler, because the store lock is a session lock. The function speaks TLS to any host that is not local and refuses a URL whose `sslmode` would allow plaintext |
| `FNB_DB_CA_CERT` | `sync-incremental`, `oa-webhook` and `bot-webhook`, optional: the PEM of the certificate authority of the database's TLS certificate (Project settings → Database → SSL configuration), needed only if the runtime does not trust it already. It spans several lines, so set it on its own: `pnpm exec supabase secrets set FNB_DB_CA_CERT="$(cat <ca file>)" --remote=<project ref>` |
| `FNB_INCREMENTAL_WALL_MS`, `FNB_INCREMENTAL_CPU_MS` | `sync-incremental`, optional: the run's wall-clock and estimated-CPU budget in milliseconds, default 105000 and 1200 for the Free plan; at most 390000 (paid plans allow 400 s of wall clock) and 2000 (the CPU limit on every plan) |
| `ZALO_APP_SECRET_<BRAND>` | `zalo-session` and `zalo-phone` (#205): the App secret of the brand's Zalo App, for the app-secret proof of the Mini App access token and for exchanging the phone-number token. `<BRAND>` is by convention the brand key in capitals (`ZALO_APP_SECRET_BRAND_1` for `brand-1`); `zalo_apps.secret_name` names it, so the database decides which secret a brand uses |
| `ZALO_OA_SECRET_<BRAND>` | `oa-webhook` (#207): the OA secret key with which it checks the signature of the brand's OA events; `oas.secret_name` names it. While it is missing, the function answers 500 `not_configured` and stores nothing |
| `NOTIFY_ZALO_BOT_TOKEN…` | `bot-webhook` (#207): the Zalo Bot token the poller already uses, named by the destination's `secret_name`, to send the one confirmation after a "DỪNG"; without it the stop is recorded and the confirmation logged as failed |
| `VOUCHER_CALLBACK_PATH_SECRET` | the iPOS CRM voucher-validation callback URL (phase 16b) |

These two are the only `ZALO_` values kept as function secrets. The OA access and refresh tokens and the Mini App developer token pair are not secrets to set: their refresh tokens are single-use and change at every refresh, so they live in the table `zalo_tokens`, one row per brand and kind, which no API role can read ([schema.md](schema.md), "Zalo configuration"); the token jobs (#206) are to write them. The configuration rows name a secret only by a `ZALO_` name, and a CHECK refuses a value pasted in its place. The shared code of the Zalo functions (`supabase/functions/_shared/http.ts`) reads a secret by its name, answers 500 `not_configured` without naming it when it is missing, and removes every `ZALO_` secret value from its logs. A Zalo Bot in webhook mode has one more secret, the token Zalo sends in `X-Bot-Api-Secret-Token`: it is not a function secret, and the database keeps only its SHA-256 (`app.bot_poll_state.webhook_secret_sha256`).

`zalo-session` and `zalo-phone` also use what Supabase injects: `SUPABASE_URL` and the secret key, read from `SUPABASE_SECRET_KEYS` (a JSON dictionary of the project's secret keys; its `default` entry, else the first) or else from the legacy `SUPABASE_SERVICE_ROLE_KEY`, for the two service-role RPCs and the Auth admin API. Nothing needs to be set for them. Four more variables are for tests and local development only and must stay unset on the cloud project:

| Variable | What it does |
|---|---|
| `ZALO_INTEGRATION` | `1` turns on the Zalo integration suites (with `DATABASE_URL` of the local stack, and for the sign-in suite of `@fnb/zalo` also its `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `SUPABASE_PUBLISHABLE_KEY`; [test-plan.md](test-plan.md), section 5.3); in a function it allows only tenants whose slug starts with `zalo-it-`; `0` or unset is off, anything else is a configuration error |
| `ZALO_LOCAL_DEV` | `1` lets `zalo-session` use the mock Zalo Graph of `pnpm zalo:dev` (#208), and only on the local stack: the function's `SUPABASE_URL` must be a loopback address (`http://127.0.0.1:<port>` or `localhost`), its `SUPABASE_DB_URL` a database on 127.0.0.1 or localhost, `ZALO_TENANT_ID` set and `ZALO_INTEGRATION` off; otherwise the function answers 500 before any call. A deployed function has the project's `https://` URL (or `http://kong:8000` under `supabase functions serve`) and a remote database, so it cannot meet these conditions ([security.md](security.md), section 4.9). The loop sets it for the function it starts; the local Playwright specs of the staff app read it as their switch. `0` or unset is off |
| `ZALO_TENANT_ID` | the id of the one tenant whose brand keys the functions resolve; required with `ZALO_INTEGRATION=1` and with `ZALO_LOCAL_DEV=1`, and otherwise needed only if two tenants use the same brand key |
| `ZALO_GRAPH_BASE_URL` | a loopback address (`http://127.0.0.1:<port>`) of the mock Zalo Graph of `@fnb/zalo/testing`; accepted only with `ZALO_INTEGRATION=1`, or with `ZALO_LOCAL_DEV=1` on the local stack |

### The local staff-app loop

`pnpm zalo:dev` ([development.md](development.md)) reads `.env` for the local stack (`SUPABASE_URL`, `DATABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`, each refused unless it points at this machine) and `FNB_MEMBER_EMAIL` for the member to sign in (or `--member`). It sets the variables below for the processes it starts and nothing else; none of them is a secret to keep, none belongs in `.env`, and they exist only on a developer's machine.

| Variable | Set for | What it holds |
|---|---|---|
| `ZALO_LOCAL_DEV`, `ZALO_TENANT_ID`, `ZALO_GRAPH_BASE_URL`, `ZALO_APP_SECRET_<BRAND>` | `zalo-session` under Deno | the switch above, the tenant's id, the mock Graph's loopback address, and a random App secret drawn on every start, which the mock Graph checks; `SUPABASE_URL`, `SUPABASE_DB_URL` and `SUPABASE_SECRET_KEYS` from the local stack |
| `VITE_ZALO_SESSION=local` | the staff app's Vite dev server | the third session mode, next to the stand-in and the Zalo runtime: the browser runtime with the real session client, through a proxy to the local function. Development only: a build with it is refused, and so is a Zalo runtime |
| `ZALO_LOCAL_SESSION_URL` | the same | the loopback address of the local `zalo-session` (`http://127.0.0.1:<port>`), required by the `local` mode; the dev server proxies `/functions/v1/zalo-session` to it, and the page never sees it |
| `ZALO_LOCAL_ACCESS_TOKEN` | the same | the mock Zalo access token of the local user, required by the `local` mode; the page's mocked SDK hands it to the session client |
| `ZALO_LOCAL_ACCESS_KEY` | the same, with `--lan` or `--tunnel` | the access guard's 256-bit key, drawn on every start and never written to a file; 22 to 128 base64url characters are accepted |
| `ZALO_LOCAL_TUNNEL_HOST` | the same, with `--tunnel` | the quick tunnel's `….trycloudflare.com` host name; it needs the access key |
| `ZALO_LOCAL_SUPABASE_URL` | the same, with `--lan` or `--tunnel` | the loopback address of the local API, which the dev server proxies under `/supabase`; plain `pnpm zalo:dev` instead takes a loopback `SUPABASE_URL` from the repository's `.env` for the proxy, never for the page |

Edge Function secret names may not start with `SUPABASE_`. Supabase injects `SUPABASE_URL`, `SUPABASE_DB_URL`, the API keys and `SUPABASE_JWKS` into every function itself ([supabase.com/docs/guides/functions/secrets](https://supabase.com/docs/guides/functions/secrets)). Set the function's secrets from a file outside the repository, each value in single quotes (`POS_ACCOUNTS_JSON='[…]'`; unquoted, ` #` inside a value starts a comment and the rest is dropped): `pnpm exec supabase secrets set --env-file <file> --remote=<project ref>`; a change takes effect without a redeploy. Locally, `supabase functions serve --env-file <file>` reads the same variables, from a file that is not in the repository either.

The `pg_cron` schedule that calls `sync-incremental` holds no credential: each call carries a single-use ticket that the database issued a moment earlier and the function claims through its own database connection (ADR-028). Nothing for it goes into Vault, and no API key is stored in the database.

## Local `.env`

Copy `.env.example` and fill in the local Supabase keys printed by `pnpm db:start`, the POS accounts, `IPOS_APP_KEY` (the iPOS CMS application key; the live connector tests need it), and later the publisher login used by `/strategy`. Once `.ipos-snapshot/` holds a snapshot, set `IPOS_REAL_API=off` to develop without calling iPOS; the folder is gitignored like `.env` and holds real business data, so it never leaves the machine except over the private channel. The file is gitignored; the public-safety scan (`node scripts/check-public-safe.mjs`) refuses to pass if a credential-shaped string appears in a tracked file.

## Rotation

Rotate the POS passwords, the Supabase secret key and the Zalo secrets at launch and whenever a person with access leaves. The runbook lists the order (rotate at the provider, update the secret, re-run the affected workflow, confirm the next scheduled run is green).
