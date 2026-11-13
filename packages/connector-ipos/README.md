# `@fnb/connector-ipos`

Purpose and audience: the first real connector. It holds a typed client for the iPOS Fabi CMS REST API (login, master data, sales reports, invoices, shifts, adjustments) and the `PosConnector` adapter that turns its responses into the canonical model of `@fnb/core`. For developers who change how POS data is read, and for reviewers checking that only documented read endpoints are used (ADR-025).

Last updated 2026-11-12

## Main exports

| Area | Exports |
|---|---|
| The connector | `createIposConnector`, `iposConnectorFactory`, `IPOS_CONNECTOR_ID` (`"ipos-fabi"`), `iposDescriptor`, `iposCredentialsSchema` (`email`, `password` and `appAccessToken`, the CMS application key that `@fnb/runner` takes from `IPOS_APP_KEY` or from the account entry), `FLAG_CODES`, the options `DEFAULT_BATCH_DAYS`, `DEFAULT_TIMEZONE`, `DEFAULT_SALE_TYPE_CHANNELS` |
| The client | `createIposClient` with typed endpoint groups: accounting (daily sales, invoices), master data, POS CMS (edited and deleted sales, removed items, change log, sale snapshot, out of stock), reports (shifts) and sale summary; `DEFAULT_BASE_URL` |
| Login tokens | `createMemoryTokenStore`, `decodeJwtPayload`, `isTokenFresh`, `TOKEN_REFRESH_WINDOW_MS`, `LOGIN_PATH` |
| Errors and retries | `IposError`, `IposAuthError`, `IposHttpError`, `IposNetworkError`, `IposSchemaError`; `DEFAULT_RETRY_POLICY` |
| Vietnam time | `vietnamDateISO`, `vietnamDayRange`, `vietnamMidnight`, `vietnamRange`, `splitRangeByCalendarMonth`, `VIETNAM_TIMEZONE` |

Every response is parsed with a zod schema (`src/schemas/`), and every vendor row is kept in `raw`. The connector declares every capability except `costs` (the CMS returns no cost prices); adjustments come from the CMS reports C05 and C08 and never include `reissued`.

## Who uses it

`@fnb/runner` registers it, so the `fnb` CLI (`apps/jobs`) and the Edge Function `sync-incremental` use it for every `POS_ACCOUNTS_JSON` entry with `"connector": "ipos-fabi"`. Because the Edge Function imports it, run `node scripts/function-imports.mjs` after adding or moving a file here.

## Tests

```sh
pnpm --filter @fnb/connector-ipos run test --maxWorkers=2
pnpm --filter @fnb/connector-ipos typecheck
pnpm --filter @fnb/connector-ipos test:live
```

- The unit tests run on a fake `fetch` with synthetic fixtures (`test/fixtures`): authentication, HTTP retries, pagination, master data, the POS CMS and sale-summary endpoints, adjustments, Vietnam time, a golden mapping test and the conformance suite of `@fnb/connector-core`.
- `test:live` is opt-in (the script sets `LIVE=1`). It reads `POS_ACCOUNTS_JSON` and `IPOS_APP_KEY` from the repository's `.env`, calls the real API and prints counts, timings and flag counts only.
- Recorded vendor responses are never committed: the repository is public (ADR-009).

## Read more

- [docs/connectors/ipos-fabi.md](../../docs/connectors/ipos-fabi.md): authentication, conventions, endpoints, normalisation, testing and quirks.
- [docs/connectors.md](../../docs/connectors.md): the contract and the capability matrix.
- [docs/secrets.md](../../docs/secrets.md): the account entry and `IPOS_APP_KEY`.
