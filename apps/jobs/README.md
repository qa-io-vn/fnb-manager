# `@fnb/jobs`: the `fnb` CLI

Purpose and audience: the one command-line tool that creates tenants and members, onboards POS accounts, syncs sales, reports status and health, and, from phase 12, builds the daily digests and sends notifications. The owner runs it locally; GitHub Actions runs it on schedule. For developers who change or add a command, and for whoever operates the system.

Last updated 2026-11-12

## Running it

```sh
pnpm --filter @fnb/jobs fnb -- --help
pnpm --filter @fnb/jobs fnb -- <command> [options]
node apps/jobs/bin/fnb.mjs <command> [options]
```

`bin/fnb.mjs` registers tsx and runs `src/cli.ts`, so there is no build step. `fnb <command> --help`, `fnb help <command>` and `fnb <group> --help` (for example `fnb notify --help`) print the options of a command. `fnb` alone prints the help and exits 2.

## Commands

| Command | What it does | State on 2026-11-12 |
|---|---|---|
| `tenant create` | Create a tenant (idempotent) | verified locally |
| `tenant add-member` | Give a login a role in a tenant (`owner`, `manager`, `staff`, `viewer`, `publisher`), creating the login when missing | verified locally |
| `onboard` | Add a POS account to a tenant, discover its stores and load its catalogue | verified locally |
| `sync window` | Pull a business-date window of sales (`--kind backfill`, `nightly`, `incremental` or `manual`; `--dry-run` writes nothing) | verified locally |
| `sync incremental` | Check the last three business days of each store against the POS daily totals and pull only the changed days | verified locally |
| `sync master` | Refresh the stores and the catalogue of an account | verified locally |
| `status` | The last run per account and the reconciliation state per store | verified locally |
| `doctor` | The database, migrations, POS logins, sync freshness and free-plan limits | verified locally |
| `mask-credentials` | Register every credential with the GitHub Actions log masker | verified locally; masking the `NOTIFY_*` secrets is part of step 12b, in build |
| `notify tick`, `notify status`, `notify test`, `notify link` | Send what is due; show the outbox, destinations, open alerts and digests; send one test message per destination; link a member's Zalo Bot chat | phase 12, step 12a, verified locally |
| `digest`, `notify unlink`, `notify job-failed`, `notify link --kind email` | Build the due daily digests and queue their messages; remove a destination or withdraw a member's notifications; record a failed GitHub Actions run as an alert and send it; link a member's login e-mail | phase 12, step 12b, in build |

The states follow [docs/status.md](../../docs/status.md); step 12b may still change files that the older commands share. The options of the sync, status and doctor commands, the runbook and the scheduled runs are in [docs/sync.md](../../docs/sync.md#cli-reference). Until the notification documentation of step 12c exists, `fnb <command> --help` is the reference for `digest` and the `notify` commands.

## Configuration and output

- Settings come from the environment and the repository's `.env`; the environment wins. What each command needs is in [docs/secrets.md](../../docs/secrets.md).
- The database URL is read from `DATABASE_URL` before `SUPABASE_DB_URL` locally, and the other way round when `CI` or `GITHUB_ACTIONS` is set. It must be a `postgresql://` (or `postgres://`) connection string. For every host that is not local the CLI asks for TLS (`sslmode=require`) unless the URL names its own `sslmode`, so keep `?sslmode=require` on cloud URLs as [docs/go-live.md](../../docs/go-live.md) shows.
- With `CI` or `GITHUB_ACTIONS` set, output names no shop: accounts are numbered by their position in `POS_ACCOUNTS_JSON` ("account 1"), onboarded accounts missing from it are "other 1", "other 2", and stores are numbered. On GitHub Actions every run first prints `::add-mask::` for each credential, and `GITHUB_STEP_SUMMARY` receives the summary. Run it with `CI=1` locally whenever the output is shared.
- Every command gets a notifier that writes redacted lines to stderr (`ConsoleNotifier`) and records runner notifications in the outbox (`OutboxNotifier`, through `app.record_runner_notification`).
- Exit codes: 0 success; 1 failure, a red `doctor` check or a failed `notify test`; 2 usage error. `notify job-failed` adds 3 (the database was unreachable within 10 seconds) and 4 (connected, but recording failed).

## Layout

| Path | Content |
|---|---|
| `bin/fnb.mjs` | the executable |
| `src/cli.ts`, `src/help.ts` | argument parsing, masking, the notifier, help texts and exit codes |
| `src/commands/` | one module per command or group; `index.ts` registers them in `COMMANDS` |
| `src/config/` | environment and `.env` reading, configuration errors, secret collection for masking and redaction |
| `src/admin/` | tenants, auth users and the status queries |
| `src/services.ts`, `src/output.ts`, `src/context.ts` | the database and Supabase clients, redacted and CI-aware output, the command context |

## Tests

```sh
pnpm --filter @fnb/jobs run test --maxWorkers=2
DATABASE_URL=<local database URL> pnpm --filter @fnb/jobs run test --maxWorkers=2
pnpm --filter @fnb/jobs typecheck
```

- `test/unit`: parsing and help, masking before any output, naming no account in CI, configuration, account numbers, `doctor`, the status window, the incremental checks, digests and alerts, and the `notify` commands.
- `test/integration/local-stack.test.ts` runs only with `DATABASE_URL` set in the shell (tests do not read `.env`); one test also needs `SUPABASE_URL` and `SUPABASE_SECRET_KEY`. It creates tenants named `it-sync-…` with a `mock` account, runs the commands against the local stack and deletes the tenants at the end.
- `test/integration/notify-cli.test.ts` also needs `NOTIFY_INTEGRATION=1`; it uses fixture tenants `notify-it-…`, synthetic `_IT` secrets and local mock providers.

## Read more

- [docs/sync.md](../../docs/sync.md): the CLI reference, the scheduled runs and the runbook.
- [docs/go-live.md](../../docs/go-live.md): the first cloud deployment, with the commands in order.
- [docs/development.md](../../docs/development.md#add-a-cli-command): adding a command.
