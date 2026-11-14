# `@fnb/core`

Purpose and audience: the canonical, POS-agnostic data model that every other package speaks, and the business rules they share (business date, money, payment kinds, sizes, sale arithmetic, the Vietnam holiday calendar). For developers who change the model or a rule, or who need to know how a number is defined before it reaches the database.

Last updated 2026-11-14

## Main exports

| Area | Exports |
|---|---|
| Canonical records (zod schema and type for each) | `CanonicalSale` with `CanonicalLine` and `CanonicalPayment`, `CanonicalShift`, `CanonicalStore`, `CanonicalCatalog` (items, item types and classes, modifiers, packages, payment methods, promotions, sources), `CanonicalAdjustment`, `CanonicalDailyTotal` (the POS's own daily count and net), `DataQualityFlag` |
| Enums | `LINE_KINDS`, `PAYMENT_KINDS`, `CHANNELS`, `ADJUSTMENT_KINDS`, the sale status and flag severity schemas |
| Business date | `businessDate(instant, timezone, dayStartMinutes)`, `businessDayStart`, `businessDayEnd`, `instantOnBusinessDate`, `zonedInstant`, `wallClockIn`, ISO-date helpers (`parseIsoDate`, `formatIsoDate`, `shiftIsoDate`, `isoDatesBetween`, `compareIsoDates`) |
| Money | `roundMoney`, `sumMoney`, `moneyEquals`, `MONEY_DECIMALS`, `DEFAULT_MONEY_TOLERANCE` |
| Payment kinds | `classifyPaymentKind` with `DEFAULT_PAYMENT_KIND_RULES` (Vietnamese defaults; exact-name overrides per tenant win first) |
| Sizes | `parseSizeSuffix` with `DEFAULT_SIZE_LABELS` (S, M, L, XL, XXL) |
| Item roles and modifiers | `suggestRole(itemTypeName)` (a suggested role, `drink`, `topping`, `snack` or `food`, from Vietnamese item-type names; the earliest term wins, then the longest; short terms match whole words) with `ROLE_SUGGESTION_TERMS`, and `classifyModifier(name)` (`sugar`, `ice` or `other`); suggestions only, saved by the owner in Settings |
| Sale arithmetic | `lineNetTotal`, `paymentTotal`, `expectedNetFromLines`, `expectedNetFromComponents`, `itemQuantity`, `countsAsItem` |
| Adjustments | `adjustmentKey`, the de-duplication key of a POS adjustment |
| Vietnam calendar | `VIETNAM_HOLIDAYS`, `isHolidayDate`, `isTetWindowDate`, `isExcludedDay` |

The only runtime dependency is `zod`. The package exports its TypeScript source (`src/index.ts`); there is nothing to build before using it.

## Who uses it

Every workspace package except `@fnb/metrics`, both apps (`apps/web`, `apps/jobs`), and the Edge Function `sync-incremental` through `@fnb/runner` and `@fnb/sync`. Because the Edge Function imports it, run `node scripts/function-imports.mjs` after adding or moving a file here ([development.md](../../docs/development.md#add-or-move-a-file-the-edge-function-imports)).

## Tests

```sh
pnpm --filter @fnb/core run test --maxWorkers=2
pnpm --filter @fnb/core typecheck
```

Unit tests in `test/unit` cover the business date (time zones, day starts after midnight, wall-clock conversion), money, payment-kind classification, size parsing, role suggestions and modifier families, the adjustment key and the holiday calendar.

## Read more

- [docs/connectors.md](../../docs/connectors.md#shared-rules-in-fnbcore): the shared rules every connector uses.
- [docs/schema.md](../../docs/schema.md#business-date): the business date in the database.
- [docs/decisions.md](../../docs/decisions.md): ADR-004 (canonical schema behind a connector interface) and ADR-007 (business day and money conventions).
