# Go-live checklist for the first deployment

This is the shortest path from the repository to a working dashboard on real data. It assumes the repository is forked or owned by you, GitHub Pages is enabled with "GitHub Actions" as the source, and you have the POS logins for every account you want to sync. Everything shop-specific stays in your local `.env`, in GitHub secrets and in your Supabase project; nothing is committed. The names below match `docs/secrets.md`.

## 1. Create the Supabase project (owner, about 10 minutes)

1. At supabase.com create a project on the Free plan in the Singapore region (closest to Vietnam). Write down the database password you choose.
2. Project settings → API: copy the project URL, the publishable key (`sb_publishable_…`) and the secret key (`sb_secret_…`). Use the new key scheme, not the legacy `anon` / `service_role` JWTs.
3. Project settings → Database → Connect: copy the **Session pooler** connection string (port 5432). GitHub runners and most home networks have no IPv6, and the direct host is IPv6-only on the Free plan, so the pooler string is the one the jobs use.
4. Project settings → General: copy the project reference (the short id in the URL).
5. Account → Access tokens: create a personal access token for the migration workflow.
6. Authentication → Sign In / Providers → Email: turn **off** "Allow new users to sign up" (members are invited by the CLI, never self-registered).
7. Authentication → URL configuration: set the site URL to your Pages URL (`https://<owner>.github.io/<repository>/`) and add it plus `http://localhost:5173/**` to the redirect allow-list. Password-reset links return to the hash route of the app.
8. Optional now, required before inviting other people: Authentication → SMTP settings with your own provider. The built-in mailer only reaches addresses of your own Supabase team and sends two messages per hour.

## 2. Put the values where the tools read them

Local `.env` (gitignored):

```
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
SUPABASE_SECRET_KEY=sb_secret_…
SUPABASE_DB_URL=postgresql://postgres.<ref>:<password>@<pooler-host>:5432/postgres
SUPABASE_PROJECT_ID=<ref>
SUPABASE_DB_PASSWORD=<password>
SUPABASE_ACCESS_TOKEN=sbp_…
POS_ACCOUNTS_JSON=[{"key":"<slug>","connector":"ipos-fabi","email":"…","password":"…"}]
IPOS_APP_KEY=<the CMS application key>
```

GitHub → Settings → Secrets and variables → Actions:

| Kind | Name | Value |
|---|---|---|
| Secret | `SUPABASE_ACCESS_TOKEN` | the personal access token |
| Secret | `SUPABASE_DB_PASSWORD` | the database password |
| Secret | `SUPABASE_PROJECT_ID` | the project reference |
| Secret | `SUPABASE_SECRET_KEY` | the secret API key |
| Secret | `SUPABASE_DB_URL` | the session-pooler connection string |
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

## 6. Keep it fresh and safe

- "Sync" (`sync.yml`) runs nightly at 03:23 Vietnam time for the last 14 business days of every account in `POS_ACCOUNTS_JSON` and can be dispatched for one account (by its position in `POS_ACCOUNTS_JSON`, 1 for the first) or all, any window and kind, or as a dry run; runs never overlap (one concurrency group) and the secrets reach only the steps that run `fnb`; it skips itself with a note until `SUPABASE_DB_URL` and `POS_ACCOUNTS_JSON` exist. The Free plan pauses a project after a week without activity, and the nightly job is the activity.
- "Backup" (`backup.yml`) needs `BACKUP_AGE_RECIPIENT` and the S3-compatible bucket secrets; until they exist it skips with a note. Set them before the first month of real data is in.
- `pnpm --filter @fnb/jobs fnb -- doctor` reports database size, migration drift, account logins and the last successful sync; run it when something looks stale.

## What the owner cannot delegate

Creating the Supabase project and the GitHub secrets, choosing the backup destination, changing the POS passwords after onboarding people who no longer need them, and the legal registrations listed in `docs/roadmap.md` section 5.
