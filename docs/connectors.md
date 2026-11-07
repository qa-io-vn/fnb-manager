# POS connectors

A connector turns one point-of-sale system into the canonical, POS-agnostic model defined in `@fnb/core`. Everything downstream (sync engine, reports, exports, data packs) reads canonical fields only; vendor field names live inside the connector package and in the `raw` payloads it keeps on every record.

Packages:

| Package | Role |
|---|---|
| `@fnb/core` | Canonical schemas (zod) and shared rules: business date, size suffix parsing, payment-kind classification, money helpers, sale arithmetic |
| `@fnb/connector-core` | The `PosConnector` contract, capability flags, typed errors, registry, window helpers and the conformance suite |
| `@fnb/connector-mock` | Seeded synthetic connector shaped like a real drinks shop; passes the suite; used by tests, demos and E2E |
| `@fnb/connector-ipos` | Typed client for the iPOS Fabi API plus `createIposConnector`, the first real adapter |

## The contract

```ts
interface PosConnector {
	describe(): ConnectorDescriptor;
	authenticate(credentials: unknown): Promise<void>;
	discoverStores(): Promise<CanonicalStore[]>;
	fetchCatalog(store: CanonicalStore): Promise<CanonicalCatalog>;
	fetchSales(store: CanonicalStore, window: BusinessDateWindow, context?: FetchContext): AsyncIterable<CanonicalSale[]>;
	fetchShifts(store: CanonicalStore, window: BusinessDateWindow, context?: FetchContext): Promise<CanonicalShift[]>;
	fetchAdjustments(store: CanonicalStore, window: BusinessDateWindow, context?: FetchContext): Promise<CanonicalAdjustment[]>;
	fetchControlTotals(store: CanonicalStore, window: BusinessDateWindow, context?: FetchContext): Promise<CanonicalDailyTotal[]>;
}

interface FetchContext {
	onFlag?: (flag: DataQualityFlag) => void;
}
```

- `describe()` returns `{ id, label, capabilities, credentialsSchema, notes? }`. `credentialsSchema` is a zod schema; it must reject an empty object. `capabilities` is a complete map of booleans (see the matrix below).
- `authenticate(credentials)` validates the credentials against the schema and establishes a session. It throws `ConnectorAuthError` on bad credentials.
- The iPOS Fabi credentials are `{ email, password, appAccessToken }`; `appAccessToken` is the CMS application key (`IPOS_APP_KEY` in the environment or per account entry) and is required.
- A **window** is `{ fromDate, toDate }` of inclusive business dates (`YYYY-MM-DD`), interpreted in the store's `timezone` with its `dayStartMinutes`. `windowInstants(window, store)` from `@fnb/connector-core` converts it to the two instants a vendor API usually wants.
- `fetchSales` yields batches (any size, any grouping). Each `CanonicalSale` carries nested `lines` and `payments`, its `soldAt` instant and the `businessDate` derived from it with `businessDate(soldAt, store.timezone, store.dayStartMinutes)`.
- Methods behind a capability that is declared `false` must throw `ConnectorCapabilityError` (`assertCapability(descriptor, name)` does this).
- External ids are the vendor's natural keys and must be stable across runs; the original vendor record goes into `raw`.
- `fetchShifts` returns the shifts the vendor attributes to the window; vendors differ on whether a shift belongs to the window by its open or its close time, so the connector's `describe().notes` must say which, and callers assign business dates from `openedAt`/`closedAt` themselves.

### Data-quality flags

A connector never guesses. When a vendor record is inconsistent (line sums that do not reach the net, payments that do not match the paid amount, an item missing from the master, a duplicate id, a shift without a store) the connector still emits the record and reports a `DataQualityFlag` (`{ code, saleExternalId?, message, severity: "info" | "warn" }` from `@fnb/core`). Flags are delivered through the optional `context.onFlag` sink that every `fetch*` method accepts; a connector may additionally offer its own options-level callback, but the sync engine only needs to wire the shared one. Flags are data about the vendor's data, not errors: a connector throws only when it cannot read the vendor at all (`ConnectorAuthError`, `ConnectorSchemaError`, `ConnectorRateLimitError`).

Typed errors: `ConnectorAuthError`, `ConnectorSchemaError` (a vendor response did not match its schema), `ConnectorCapabilityError`, `ConnectorRateLimitError`; all extend `ConnectorError` and carry `connectorId`.

The `ConnectorRegistry` maps connector ids to factories: `registry.register(factory)` and `registry.create(id, options)`.

### Money identities every connector must satisfy

For each sale:

- `netAmount = grossAmount − itemDiscountAmount − billDiscountAmount − voucherAmount + serviceChargeAmount + shippingFeeAmount + vatAmount`
- `netAmount = Σ line.netAmount − billDiscountAmount − voucherAmount + serviceChargeAmount + shippingFeeAmount + vatAmount`
- `paidAmount = Σ payment.amount`
- a `modifier` line carries no money and no item quantity; it may point at the item line it belongs to through `parentLineExternalId`
- the catalog and the sales agree on what a modifier is: a line that references a catalog item with `isModifier: true` (or an id listed in `catalog.modifiers`) has `lineKind: "modifier"`, and a `modifier` line never references a catalog item with `isModifier: false`
- `vatAmount` is only VAT added on top of the prices; VAT already included in prices stays inside the amounts

Control totals (`CanonicalDailyTotal`) count and sum the sales the connector emits for that business date, excluding sales with `status: "voided"`.

## Capability matrix

| Capability | Meaning | mock | iPOS Fabi |
|---|---|---|---|
| `lines` | sales carry item lines | yes | yes |
| `modifiers` | zero-amount customisation lines (sugar, ice) are emitted as `lineKind: "modifier"` | yes | yes |
| `payments` | one payment record per tender, split bills kept | yes | yes |
| `shifts` | cashier shifts with sales, orders, drawer and opening float | yes | yes |
| `adjustments` | voids, edits and removed lines after the fact | yes | no (not captured yet) |
| `controlTotals` | the vendor's own per-day count and net, for reconciliation | yes | yes |
| `customers` | customer name or phone when the cashier captured one | yes | yes |
| `guestCount` | guests per sale | yes | yes |
| `costs` | item cost prices in the catalog | yes | no (cost prices are empty) |

Reports hide the sections a connector cannot feed instead of failing.

## Shared rules in `@fnb/core`

- `businessDate(instant, timezone, dayStartMinutes)` uses `Intl.DateTimeFormat` with an IANA timezone; 23:30 local stays on its local date whatever the UTC date is, and 00:30 with a 05:00 day start belongs to the previous business date. `businessDayStart`, `businessDayEnd` and `instantOnBusinessDate` go the other way.
- `parseSizeSuffix(name, sizeLabels?)` splits a trailing `(M)`, `( M )`, `(l)`, `(XL)` into `baseName` and `sizeLabel`; names without a recognised suffix are returned unchanged with `sizeLabel: undefined`. The vocabulary defaults to S, M, L, XL, XXL.
- `classifyPaymentKind(name, { overrides?, rules? })` maps tender names to `cash | ewallet | bank_transfer | card | voucher | other` with Vietnamese defaults (tiền mặt, COD, cash; MoMo, ZaloPay, VNPay, ShopeePay; transfer, chuyển khoản, bank; card, thẻ, Visa, Master, ATM; voucher) and exact-name per-tenant overrides that win first.
- `roundMoney`, `sumMoney`, `moneyEquals`, `itemQuantity`, `expectedNetFromLines`, `expectedNetFromComponents`, `paymentTotal`.

## Writing a connector

1. Create `packages/connector-<vendor>` depending on `@fnb/core`, `@fnb/connector-core` and `zod` only.
2. Write the vendor client (schemas for every response, typed errors, pagination) separately from the adapter.
3. Implement `PosConnector`. Keep the vendor-to-canonical mapping in small modules (stores, catalog, lines, payments, sales, shifts, control totals) and put every vendor row into `raw`.
4. Classify lines explicitly. The order that works for a drinks shop: a line whose item exists in the item master and is not a customisation option is an item (a free topping with amount 0 stays an item); a customisation option with zero amount and zero master price is a modifier attached to its item line; an unknown item with zero amount and zero price is a modifier; a line inside a package that is not the package itself is a `package_component`; everything else is an item.
5. Emit `DataQualityFlag`s instead of guessing: line sums that do not reach the net, payments that do not match, unknown items or item types, duplicate ids.
6. Export a `ConnectorFactory` (`{ id, create(options) }`) so the registry can build it from configuration.
7. Run the conformance suite against synthetic fixtures (never recorded vendor responses: the repository is public) and, opt-in with local credentials, against the live API.

## Running the conformance suite

The suite is a vitest helper exported from `@fnb/connector-core/conformance`:

```ts
import { runConnectorConformanceSuite } from "@fnb/connector-core/conformance";

runConnectorConformanceSuite("my connector", () => createMyConnector(options), {
	credentials: { token: "synthetic" },
	window: { fromDate: "2026-10-26", toDate: "2026-11-01" },
	moneyTolerance: 1,
	expectSalesOnEdges: true,
	expectBoundarySales: true,
	boundaryMarginMinutes: 60,
	expectFullyPaid: true,
});
```

Options: `storeExternalId` picks a store other than the first one discovered; `moneyTolerance` (default 1, in the store's currency unit) is applied per sale and, for the window-level paid-versus-net rule, multiplied by the number of sales; `expectSalesOnEdges` (default true) requires at least one sale on each edge date; `expectBoundarySales` (default true) requires a sale within `boundaryMarginMinutes` (default 60) of the start and of the end of each edge business day, which is what exposes a connector that drops the first or last hour or derives dates in the wrong timezone, so fixtures should place sales there (the mock does); `expectFullyPaid` (default false) adds the window-level rule that the paid total equals the net total, which is false for vendors with debt or partial payments and therefore opt-in; `timeoutMs` bounds the loading step.

It authenticates, discovers a store, fetches the catalog, fetches the window twice and once per day, collects every flag through `context.onFlag`, then asserts (rule names in parentheses):

| Assertion | Rule | Gated on |
|---|---|---|
| the descriptor has an id, a label and a boolean for every capability; its credentials schema rejects `{}` | – | always |
| the store, the catalog, every sale, shift, adjustment and control total match the canonical zod schemas; sale and line ids are unique | `schema`, `unique-ids` | always (shifts, adjustments and control totals only when declared) |
| the catalog lists at least one item | – | `lines` |
| the window emits at least one sale | – | always |
| external ids, amounts, line ids and payments (count, method, amount) are identical across the two runs | `stable-ids` | always |
| every sale's `businessDate` is inside the window and equals the date derived from `soldAt` in the store's timezone and day start | `business-date` | always |
| gross − item discount − bill discount − voucher + service charge + shipping + VAT equals the sale net | `net-components` | always |
| every sale has at least one line, and Σ line net − bill discount − voucher + charges equals the sale net | `line-sums` | `lines` |
| every sale has zero lines | `no-lines` | `lines` declared false |
| modifier lines carry no money; their parent exists and is not a modifier; lines agree with the catalog's `isModifier` flags | `modifier-amounts`, `modifier-parent`, `modifier-catalog` | `lines` |
| at least one modifier line appears when the catalog lists modifiers | `modifier-presence` | `modifiers` |
| no modifier line appears | – | `modifiers` declared false |
| Σ payment.amount equals `paidAmount` | `payments-sum` | always |
| no payments appear | – | `payments` declared false |
| the window's paid total equals its net total | `paid-vs-net` | `expectFullyPaid` |
| the whole window equals the union of its single-day windows | `pagination` | always |
| both edge dates fetched alone equal their slice of the whole window; edges have sales when `expectSalesOnEdges` | `window-edges` | always |
| each edge date has a sale within the margin of the business-day start and end | `boundary-sales` | `expectBoundarySales` |
| every collected flag matches `DataQualityFlag` | `flags` | always |
| control totals equal the emitted non-voided sales per business date (count and net) | `control-totals` | `controlTotals` |
| `fetchControlTotals`, `fetchShifts`, `fetchAdjustments` throw `ConnectorCapabilityError` | – | the capability declared false |

Failures name the rule and the first offending sale ids. The individual checks (`checkBusinessDates`, `checkLineSums`, `checkNetComponents`, `checkModifiers(sales, catalog)`, `checkPayments`, `checkControlTotals`, `checkBoundarySales`, …) are exported as pure functions for live verification scripts.

Run everything from the repository root with `pnpm test`; the live verification of a real connector is opt-in (`LIVE=1 pnpm --filter @fnb/connector-ipos test:live`) and prints counts, timings and flag counts only.
