# `@fnb/connector-core`

Purpose and audience: the vendor-neutral contract every POS connector implements (`PosConnector` with capability flags), the registry that builds connectors from configuration, the typed errors, the business-date window helpers and the conformance suite every connector must pass. For developers who write or review a connector, or who call one from the sync engine.

Last updated 2026-11-12

## Main exports

| Area | Exports |
|---|---|
| The contract | `PosConnector` (`describe`, `authenticate`, `discoverStores`, `fetchCatalog`, `fetchSales`, `fetchShifts`, `fetchAdjustments`, `fetchControlTotals`), `ConnectorDescriptor`, `BusinessDateWindow`, `FetchContext` (an `onFlag` sink for data-quality flags and an abort `signal`), `collectSales` |
| Capabilities | `CAPABILITY_NAMES`: `lines`, `modifiers`, `payments`, `shifts`, `adjustments`, `controlTotals`, `customers`, `guestCount`, `costs`; `capabilities`, `NO_CAPABILITIES`, `assertCapability` (throws `ConnectorCapabilityError` for a capability declared `false`) |
| Registry | `ConnectorRegistry`, `ConnectorFactory` (`{ id, create(options) }`) |
| Errors | `ConnectorError`, `ConnectorAuthError`, `ConnectorCapabilityError`, `ConnectorRateLimitError`, `ConnectorSchemaError` |
| Windows | `windowInstants`, `windowDates`, `splitWindow`, `singleDayWindow`, `assertWindow`, `isWithinWindow` |
| `@fnb/connector-core/conformance` | `runConnectorConformanceSuite(name, createConnector, options)` and the pure checks behind it (`checkBusinessDates`, `checkLineSums`, `checkNetComponents`, `checkModifiers`, `checkPayments`, `checkControlTotals`, `checkBoundarySales`, `checkAdjustments`, `checkPaginationCompleteness`, `checkWindowEdges` and others) for live verification scripts |

Runtime dependencies: `@fnb/core` and `zod`. `vitest` is an optional peer dependency, needed only by the conformance subpath.

## Who uses it

`@fnb/connector-mock` and `@fnb/connector-ipos` implement the contract; `@fnb/sync` calls it; `@fnb/runner` builds connectors through the registry for the CLI and the Edge Function; `apps/jobs` and `apps/web` use its types. The Edge Function imports it through `@fnb/runner`, so run `node scripts/function-imports.mjs` after adding or moving a file here.

## Tests

```sh
pnpm --filter @fnb/connector-core run test --maxWorkers=2
pnpm --filter @fnb/connector-core typecheck
```

Unit tests in `test/unit` cover the checks, the registry and the window helpers. The suite itself runs against both connectors: `packages/connector-mock/test/unit/conformance.test.ts` and `packages/connector-ipos/test/unit/connector-conformance.test.ts`.

## Read more

- [docs/connectors.md](../../docs/connectors.md): the contract, the capability matrix, writing a connector and the suite's options and rules.
- [docs/development.md](../../docs/development.md#add-a-pos-connector): wiring a new connector into the runners.
- [docs/decisions.md](../../docs/decisions.md): ADR-004 and ADR-012 (connector contract with capability flags, proven by a mock connector and a conformance suite).
