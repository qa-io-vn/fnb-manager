# Go-live checklist for the first deployment

This is the shortest path from the repository to a working dashboard on real data. It assumes the repository is forked or owned by you, GitHub Pages is enabled with "GitHub Actions" as the source, and you have the POS logins for every account you want to sync. Everything shop-specific stays in your local `.env`, in GitHub secrets and in your Supabase project; nothing is committed. The names below match `docs/secrets.md`.

## 1. Create the Supabase project (owner, about 10 minutes)

1. At supabase.com create a project on the Free plan in the Singapore region (closest to Vietnam). Write down the database password you choose.
2. Project settings → API: copy the project URL, the publishable key (`sb_publishable_…`) and the secret key (`sb_secret_…`). Use the new key scheme, not the legacy `anon` / `service_role` JWTs.
3. Project settings → Database → Connect: copy the **Session pooler** connection string (port 5432) and append `?sslmode=require`. GitHub runners and most home networks have no IPv6, and the direct host is IPv6-only on the Free plan, so the pooler string is the one the jobs use. The CLI and the Edge Function ask for TLS on their own for any host that is not local; the suffix keeps every other tool you paste the string into from connecting in plaintext.
4. Project settings → General: copy the project reference (the short id in the URL).
5. Account → Access tokens: create a personal access token for the migration workflow.
6. Authentication → Sign In / Providers → Email: turn **off** "Allow new users to sign up" (members are invited by the CLI, never self-registered).
7. Authentication → URL configuration: set the site URL to your Pages URL (`https://<owner>.github.io/<repository>/`) and add it plus `http://localhost:5173/**` to the redirect allow-list. Password-reset links return to the hash route of the app.
8. Optional now, required before inviting other people: Authentication → SMTP settings with your own provider. The built-in mailer only reaches addresses of your own Supabase team and sends two messages per hour.
9. Database → Settings → SSL Configuration: turn on **Enforce SSL on incoming connections**. A new project accepts plaintext connections; with enforcement the database and the pooler refuse any client that is misconfigured instead of letting it send the POS session token and the sales unencrypted. Applying it restarts the database briefly.

## 2. Put the values where the tools read them

Local `.env` (gitignored):

```
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
SUPABASE_SECRET_KEY=sb_secret_…
SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@<pooler-host>:5432/postgres?sslmode=require
SUPABASE_PROJECT_ID=<ref>
SUPABASE_DB_PASSWORD=<password>
SUPABASE_ACCESS_TOKEN=sbp_…
POS_ACCOUNTS_JSON=[{"key":"<slug>","connector":"ipos-fabi","email":"…","password":"…"}]
IPOS_APP_KEY=<the CMS application key>
```

GitHub → Settings → Secrets and variables → Actions:

| Kind | Name | Value |
|---|---|---|
| Secret | `SUPABASE_ACCESS_TOKEN` | the personal access token (the scopes a scoped token needs are in `docs/secrets.md`) |
| Secret | `SUPABASE_DB_PASSWORD` | the database password |
| Secret | `SUPABASE_PROJECT_ID` | the project reference |
| Secret | `SUPABASE_SECRET_KEY` | the secret API key |
| Secret | `SUPABASE_DB_URL` | the session-pooler connection string with `?sslmode=require` |
| Secret | `POS_ACCOUNTS_JSON` | the same JSON array as in `.env` |
| Secret | `IPOS_APP_KEY` | the CMS application key |
| Variable | `SUPABASE_URL` | the project URL |
| Variable | `SUPABASE_PUBLISHABLE_KEY` | the publishable key |

The web build reads only the two variables; the secrets never reach the browser. Its base path (`/<repository>/` for a project site, `/` for a custom domain) comes from the Pages configuration, so there is no variable to set for it. Without the two variables the build is the demo: sample numbers, no login.

## 3. Apply the schema

Push to `main` (or run "Migrate database" from the Actions tab). The workflow links the project and runs `supabase db push`. It skips itself with a note until `SUPABASE_PROJECT_ID` exists, so an unconfigured fork never fails here.

## 4. Create the tenant, the first login and the POS accounts

From a machine with the `.env` above (the CLI reads it), one command per step:

```sh
pnpm --filter @fnb/jobs fnb -- tenant create --name "<your company>" --slug <tenant-slug> --currency VND --locale vi-VN --timezone Asia/Ho_Chi_Minh
FNB_MEMBER_PASSWORD='<a long password>' pnpm --filter @fnb/jobs fnb -- tenant add-member --tenant <tenant-slug> --email <you@example.com> --role owner
pnpm --filter @fnb/jobs fnb -- onboard --tenant <tenant-slug> --account <key-from-POS_ACCOUNTS_JSON>
pnpm --filter @fnb/jobs fnb -- sync window --account <key> --from <YYYY-MM-01> --to <yesterday> --kind backfill
pnpm --filter @fnb/jobs fnb -- status
```

`tenant add-member` also accepts `--password '<a long password>'` (it then lands in your shell history) or `--invite` (sends an invitation e-mail through your SMTP settings). `onboard` authenticates through the connector, discovers the stores of that account and writes them with their timezone and business-day start, then loads the catalogue. Repeat `onboard` and `sync window` for every account. Give every `POS_ACCOUNTS_JSON` entry a neutral key such as `account-1` before onboarding it: the key is stored in the database and typed in commands, while the Actions log of this public repository refers to accounts only by their position in the array (`account 1` is the first entry), and `status` and `doctor` call an onboarded account that is not in the array `other 1`, `other 2`, … so it is never mistaken for an entry. One month per `sync window` call keeps each run inside the POS call budget; older history is loaded month by month, and `--dry-run` shows the counts before anything is written.

Locally the CLI reads `DATABASE_URL` before `SUPABASE_DB_URL`. If your `.env` still points `DATABASE_URL` at the local stack, run the commands against the cloud with `DATABASE_URL= pnpm --filter @fnb/jobs fnb -- …` (an empty value in the environment overrides the file). The full command reference and the runbook are in `docs/sync.md`.

## 5. Deploy the web app

Any push that touches `apps/web/**` or `packages/**` rebuilds and deploys the app to Pages. Open the Pages URL on your phone, sign in with the e-mail and password from step 4, pick the store, and compare "Hôm nay" with the POS overview for the same day.

## 6. Turn on the incremental sync (owner, about 10 minutes)

Between nightly runs the `sync-incremental` Edge Function keeps today current: `pg_cron` calls it every 30 minutes for each store that is open, and it pulls only the days whose POS totals changed (`docs/sync.md`, "Incremental runner").

1. Deploy it: any push to `main` that touches the function or the packages it imports runs "Deploy Edge Functions" (`deploy-functions.yml`); you can also run it from the Actions tab. It needs only `SUPABASE_PROJECT_ID` and `SUPABASE_ACCESS_TOKEN` and skips with a note until both exist.
2. Give the function the POS credentials. Write a file outside the repository with two lines, the same values as the GitHub secrets, each in single quotes: `POS_ACCOUNTS_JSON='<the JSON array>'` and `IPOS_APP_KEY='<the key>'`. Without the quotes the CLI reads ` #` inside a value (a password such as `Pass #1`) as the start of a comment and uploads the value cut short, and every call then answers 500. Run `pnpm exec supabase secrets set --env-file <that file> --remote=<ref>`, then delete the file. Repeat it whenever you change a POS password. `secrets set`, here and in step 3, needs an access token that may write function secrets; a scoped token needs `projects_read` and `edge_functions_secrets_write`, the second of which the workflows never need. Sign in once on this machine with `pnpm exec supabase login`, or export `SUPABASE_ACCESS_TOKEN` in the shell. CLI 3.0.0 also reads `SUPABASE_ACCESS_TOKEN` from a `.env` in the directory it runs in, so from the repository root the token of section 2 is used ahead of your login; if that token lacks the scope, run `SUPABASE_ACCESS_TOKEN= pnpm exec supabase secrets set …` (an empty value hides the file's) to use the login.
3. Try one store. In the SQL editor run `select app.issue_incremental_sync_ticket(id) from public.stores where active order by external_id limit 1;`, then within 10 minutes post the ticket: `curl -X POST https://<ref>.supabase.co/functions/v1/sync-incremental -H 'content-type: application/json' -d '{"ticket":"<ticket>","wait":true}'`. The answer lists counts only: days checked, changed and synced, connector calls and the duration. If the answer is not 200, the function log (Edge Functions → `sync-incremental` → Logs) has a redacted line that says why:
   - 503 `{"error":"the database is unavailable"}`: the function could not claim the ticket (log line `could not claim the ticket: …`). When the direct host is unreachable (it is IPv6-only on the Free plan), set `FNB_DB_URL` to the session-pooler string with `?sslmode=require`: `pnpm exec supabase secrets set FNB_DB_URL='<the string>' --remote=<ref>`. When the certificate is not trusted, download the CA from Project settings → Database → SSL configuration and set it, line breaks included: `pnpm exec supabase secrets set FNB_DB_CA_CERT="$(cat <ca file>)" --remote=<ref>`. Then issue a new ticket.
   - 500 `{"error":"the function is not configured"}`: a secret is missing or unusable (`POS_ACCOUNTS_JSON` not a JSON array, often a value cut short as in step 2; `FNB_INCREMENTAL_WALL_MS` or `FNB_INCREMENTAL_CPU_MS` out of range) or the database URL allows plaintext (`sslmode=disable`, `allow` or `prefer`). Fix the secret named in the log and issue a new ticket.
   - 500 with a run report: the run itself failed; the report's `stage` and `error` say where (`config` for a missing account entry, `auth` for a rejected POS login, `run` for the sync).
   - 401 `{"error":"unknown, used or expired ticket"}`: the ticket is older than 10 minutes or was used already; issue a new one. If a fresh ticket is refused too, `FNB_DB_URL` points at another database than the SQL editor.
   - 429: more than 32 tickets were being claimed on one worker at once; post again.
4. Enable the schedule in the SQL editor: `select app.enable_incremental_sync('https://<ref>.supabase.co/functions/v1/sync-incremental');`. Until you do, the schedule does nothing; `select app.disable_incremental_sync();` pauses it again.
5. Half an hour later, `fnb status` shows `incremental` runs and the freshness badge of the web app shows a time from the last 30 minutes.

Stores without opening hours are synced around the clock, which costs about 48 small calls a day per store; once the opening hours are entered (phase 10 settings, or `stores.opening_hours`, which the database checks), a store is synced only while it is open and once more just after it closes. A store you want left out gets `{"incremental_sync": false}` in `stores.settings`; the dead-man's switch and the nightly check then leave it alone too, and so they do for inactive stores and paused accounts. On a paid plan the function can use more of the 400-second wall clock: set the `FNB_INCREMENTAL_WALL_MS` function secret (at most 390000).

## 7. Keep it fresh and safe

- "Sync" (`sync.yml`) runs nightly at 03:23 Vietnam time for the last 14 business days of every account in `POS_ACCOUNTS_JSON` and can be dispatched for one account (by its position in `POS_ACCOUNTS_JSON`, 1 for the first) or all, any window and kind, or as a dry run; runs never overlap (one concurrency group) and the secrets reach only the steps that run `fnb`; it skips itself with a note until `SUPABASE_DB_URL` and `POS_ACCOUNTS_JSON` exist. The Free plan pauses a project after a week without activity, and the nightly job is the activity.
- "Backup" (`backup.yml`) needs `BACKUP_AGE_RECIPIENT` and the S3-compatible bucket secrets; until they exist it skips with a note. Set them before the first month of real data is in.
- `pnpm --filter @fnb/jobs fnb -- doctor` reports database size, migration drift, account logins, the last successful sync and whether the incremental schedule is on; run it when something looks stale.
- A store that goes more than 90 minutes of opening time without a successful sync raises a `sync_stale` line (the dead-man's switch) in the function log, and the scheduler itself records it in `app.sync_alerts` at every tick, together with scheduled calls that expired unclaimed (`dispatch_failed`), so a broken function or delivery is caught within half an hour; `fnb status` and `fnb doctor` show the open alerts, and the nightly job reports any such stretch of the previous day in its log. A POS password that stops working marks the account `auth_failed` in `fnb status`; fix it in `.env`, the GitHub secret and the function secret, then run any `fnb sync window` for it. Phase 12 sends these alerts to your phone.

## What the owner cannot delegate

Creating the Supabase project and the GitHub secrets, setting the Edge Function secrets and enabling the incremental schedule, choosing the backup destination, changing the POS passwords after onboarding people who no longer need them, and the legal registrations listed in `docs/roadmap.md` section 5.
