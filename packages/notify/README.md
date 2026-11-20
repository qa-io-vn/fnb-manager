# @fnb/notify

Notifications for FNB Manager: the channel adapters, the message templates, the dispatch cycle over the Postgres outbox, chat linking, the daily digest and the alert render. How it all works for an operator is in [docs/notifications.md](../../docs/notifications.md); the decisions are ADR-030 to ADR-033 in [docs/decisions.md](../../docs/decisions.md).

## Parts and exports

| Export | What it holds | Runs in |
| --- | --- | --- |
| `@fnb/notify` | Channel adapters (Zalo Bot, Brevo, Resend, Telegram, signed webhook, ZBS), the adapter registry and secret resolution, `runNotifyCycle`, budgets, linking, digest model and building blocks, customer dispatch | Node and Deno (the `notify` Edge Function) |
| `@fnb/notify/outbox` | `OutboxNotifier` and `CompositeNotifier`, the runner's notifier that writes alerts into the outbox | Node and Deno (`sync-incremental`) |
| `@fnb/notify/postgres` | The Postgres repository of the cycle, destinations, digests, revisions, resend, status and doctor facts | Node and Deno, with postgres.js |
| `@fnb/notify/render` | Templates (`messages/vi.ts`, `messages/en.ts`), the digest, correction and alert render, formatting and truncation | Browser-safe, no Node module |
| `@fnb/notify/testing` | Mock providers, fixture tenants and the test environment guards | Node, tests only |

Only `@fnb/notify/render` is meant for the browser; the web app currently imports nothing from this package (the Settings pages read the rendered text stored in the outbox).

## The `@fnb/reports` imports

`packages/notify/src` and the notify and digest commands of `apps/jobs` may import exactly these `@fnb/reports` exports, pinned by `test/unit/reports-contract.test.ts` (an import outside the list fails `pnpm test`): `AnalyticsArgs`, `AnalyticsCallError`, `AnalyticsFunctionName`, `AnalyticsRow`, `AnalyticsSource`, `CardModel`, `Comparison`, `IsoDate`, `ReportContext`, `ReportStore`, `RpcClient`, `addDays`, `analyticsFunctionNames`, `argumentNames`, `asOfDate`, `createRpcAnalyticsSource`, `dayReport`, `isAnalyticsFunctionName`, `maxDate`, `periodContaining`, `relativeChange`, `runReport`.

## Tests

- `pnpm --filter @fnb/notify test`: unit tests (adapters against a fake `fetch`, templates, render, budgets, the fallback script against the mock providers).
- `NOTIFY_INTEGRATION=1 DATABASE_URL=… pnpm --filter @fnb/notify test:integration`: the dispatch, digest and correction scenarios on the local stack against `node packages/notify/scripts/mock-providers.mjs`.
- `LIVE=1 pnpm --filter @fnb/notify test:live`: the live digest check against a real tenant (read-only).

Three guards keep tests away from real tenants: integration suites run only with `NOTIFY_INTEGRATION=1` and a loopback `DATABASE_URL`; fixture tenants are named `notify-it-…` and their destinations use `_IT` secret names, which the cleanup removes (with their `app.bot_poll_state` rows once no fixture is left); every scanning call of a suite carries a tenant filter, and a scan without one is refused in test mode.
