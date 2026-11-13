# `@fnb/connector-mock`

Purpose and audience: a seeded, synthetic `PosConnector` shaped like a Vietnamese drinks shop. The same seed always gives the same stores, menu, sales, shifts and adjustments; it makes no network call and passes the conformance suite. For developers who need realistic data without POS credentials: in unit tests, in the browser demo and in end-to-end runs.

Last updated 2026-11-12

## Main exports

| Area | Exports |
|---|---|
| The connector | `createMockConnector(options)`, `mockConnectorFactory`, `MOCK_CONNECTOR_ID` (`"mock"`), `mockCredentialsSchema`: `seed` (required), optional `storeCount` (1 to 5) and optional `rejectLogin: true`, which makes the login fail on purpose |
| The generator | `generateDay`, `generateDays`, `mockStore`, with the types `GeneratedDay` and `GeneratedData` |
| The menu | `MENU`, `buildMenu`: drinks in sizes M and L, toppings, snacks and zero-price modifier groups |
| The profile | `DEFAULT_MOCK_PROFILE` (Asia/Ho_Chi_Minh, business day from midnight, VND, daily volume, hourly and weekday weights, shift templates), `resolveProfile` |
| Randomness | `mulberry32`, `hashSeed`: the seeded generator |

It declares all nine capabilities, `costs` included (see the capability matrix in [docs/connectors.md](../../docs/connectors.md#capability-matrix)).

## Who uses it

- `@fnb/runner` registers it, so a `POS_ACCOUNTS_JSON` entry such as `{"key":"account-1","connector":"mock","seed":1}` works with every `fnb` command, locally and in tests.
- `@fnb/demo-analytics` and `apps/web` generate the demo's days with it.
- `@fnb/notify` builds its test fixture tenants with it.
- The tests of `@fnb/sync`, `@fnb/connector-ipos` and `apps/jobs` use it as a development dependency.

The Edge Function imports it through `@fnb/runner`, so run `node scripts/function-imports.mjs` after adding or moving a file here.

## Tests

```sh
pnpm --filter @fnb/connector-mock run test --maxWorkers=2
pnpm --filter @fnb/connector-mock typecheck
```

`test/unit/conformance.test.ts` runs the conformance suite of `@fnb/connector-core`; `shape.test.ts` checks the shape of the generated data; `reject-login.test.ts` checks the refused login.

## Read more

- [docs/connectors.md](../../docs/connectors.md): the contract and the conformance suite.
- [docs/development.md](../../docs/development.md#1-set-up-a-machine): using a mock account without POS credentials.
- [docs/web-app.md](../../docs/web-app.md#phase-6-decisions): how the demo uses the generated days.
