# `@fnb/datapack`

Purpose and audience: the AI data pack of phase 11, one aggregate-only, versioned JSON document that the owner hands to their own assistant (ADR-003), with its canonical text, its content hash, its published JSON Schema, its token budget and its aggregates-only check, and its content built from the report functions; and the plan format the assistant writes back. The web app and the `fnb datapack` command build the pack with the same code, so the same data always gives the same bytes. For developers of the pack, the prompt and the plan checks, and for reviewers who check that nothing row-level or personal can leave in a pack.

Last updated 2026-11-18

## Main exports

| Area | Exports |
|---|---|
| The format | `DATA_PACK_FORMAT` (`fnb-datapack`), `DATA_PACK_SCHEMA_VERSION`, `DATA_PACK_BUILDER_VERSION`, `dataPackSchema` and `packTableSchema` (strict zod objects), `DataPack`, `PackTable`, `PackColumn`, `PackCell`, `PACK_UNITS`, `PACK_GRAINS`, `ROW_KEY_PATTERN`, `STORE_ID_PATTERN` |
| Canonical text and hash | `canonicalJson`, `formatDecimal`, `sha256Hex` |
| Reading and comparing packs | `parsePack`, `validatePack`, `comparePackTexts`, `aggregatesOnlyIssues` |
| Budget | `estimateTokens`, `TOKEN_LIMIT` (30,000), `TOKEN_FLOOR` (15,000) |
| Building | `buildDataPack` (`BuildDataPackOptions`, `BuiltPack`), `packCalls`, `calendarOf` and `PACK_WINDOWS`, `trackableMetricIds`, `KPI_EXCLUDED_METRIC_IDS` and `KPI_WINDOW_DAYS`, `PACK_GAPS` (`PackGapCode`, `GapSeverity`), `PackClock`, the request types and limits (`DataPackRequest`, `HORIZONS`, `HORIZON_DAYS`, `DEFAULT_HORIZON`, `PACK_LANGUAGES`, `MAX_PACK_STORES`, `FOCUS_MAX_LENGTH`, `OWNER_NOTE_MAX_LENGTH`), `DataPackError` and `PACK_ERROR_CODES`. `buildDataPack` answers `not_implemented` until `strategyPrompt` exists (#131) |
| Prompt | `strategyPrompt`, `PROMPT_ID`, `PROMPT_VERSION`, `chatBundle` (in progress, #131) |
| Plans | `PLAN_FORMAT` (`fnb-plan/1`), `PLAN_SECTIONS`, `INITIATIVE_FIELDS`, `planFrontMatterSchema`, `normalizePlanText`, `parsePlan`, `lintPlan`, `planRecord`, `kpiStatus`, `comparePlans` (in progress) |

`./testing` holds the sample pack and plan for other packages' tests. The package is marked `sideEffects: false` and uses no Node API under `src/`, so the browser and the command line run the same code. Runtime dependencies: `@fnb/core`, `@fnb/metrics`, `@fnb/reports` and `zod`; zod is the only validator shipped, and Ajv is a dev dependency used only to check the published schema files.

## The pack document

A pack is one JSON object with twelve keys: `budget`, `builder_version`, `calendar`, `context`, `format`, `generated_at`, `pack_id`, `prompt`, `request`, `sample`, `schema_version` and `tables`. Every table under `tables` has a `title`, a `grain`, a `window` (a calendar window or null), `notes`, its `columns` (a name and a unit each) and its `rows`: an object from row key to an array of cells, one per column, in the declared column order. A row key is made of letters, digits and `_ . / -`, with at least one letter, so it is never read as an array index; its first segment, up to the first `/`, is its scope when it is `ALL` or a store label (`S1` to `S99`). Store ids appear only in `request.stores`; tables name stores by label.

### Canonical text

`canonicalJson` writes the one text of a value: object keys sorted by UTF-16 code units at every level, no whitespace, strings escaped exactly as `JSON.stringify` escapes a string (so a line break inside a string is always `\n` and a lone surrogate is escaped), numbers through `formatDecimal`, and one final newline. It refuses `NaN`, infinities, `undefined`, functions, symbols, big integers, objects that are not plain and cycles, naming the path. A parsed pack re-serialises byte for byte, also after a database round trip that reorders keys, adds whitespace or writes `1.50` for `1.5`.

`formatDecimal` writes a number as plain decimal digits: 15 significant digits (`toPrecision(15)`, whose ties ECMAScript fixes away from zero), read into a `BigInt`, trailing zeros trimmed, `-0` written as `0`, never an exponent. So `0.1 + 0.2` is written `0.3`, `1e-7` is `0.0000001`, 10¹⁴ đồng is written in full, and any written number reads back to the same text. Nothing in the format uses `Intl`, a locale, the process time zone or randomness; a source-scan test refuses `Intl.`, `toLocale`, `localeCompare`, `Math.random`, `Date.now`, `.normalize(` outside the request normaliser, `new Date(` outside the clock and `JSON.stringify` outside the canonical writer in `src/pack`.

### Units and digits

Each column declares a unit, and every number is rounded half away from zero to the unit's digits before it is written:

| Unit | Digits |
|---|---|
| `money` | the currency's minor units (ISO 4217: 0 for VND, 2 when not listed) |
| `money_thousands` | 1 |
| `count`, `days` | 0 |
| `quantity` | 3 |
| `fraction`, `rel_change`, `pp_change` | 4 |
| `hours` | 1 |
| `ratio` | 2 |
| `metric`, `metric_change` | unrounded: KPI values exactly as SQL gives them |
| `text`, `class`, `date`, `flag` | text, text, an ISO date, a boolean |

### `pack_id`, `generated_at` and the estimate

- `pack_id` is the SHA-256 (`sha256Hex`, Web Crypto over the UTF-8 bytes) of the canonical text with both `pack_id` and `generated_at` set to `""`. Two packs of the same data therefore have the same `pack_id` whatever their build time, transport or key order.
- The clock is injected and read for two values only: `generated_at`, written in UTC to the second (`2026-11-12T03:00:00Z`), and, when the request names no as-of day, the default as-of day, the last complete business day of the pack's stores at that time. A fixed clock takes only an ISO instant with `Z` or an offset.
- `budget.estimated_tokens` is `estimateTokens` of the pack's own final canonical text: ceil(UTF-8 bytes × 5 ÷ 11) in integer arithmetic. It does not depend on the values of `pack_id` and `generated_at`.

### The budget and its trimming ladder

Above 30,000 estimated tokens the pack is trimmed by eight fixed steps, in this order, stopping as soon as it fits; each step that changed the pack is recorded in `budget.trimmed`:

1. `heatmap_invoices:drop`
2. `pairs:all_only`
3. `modifiers:all_only`
4. `sizes:all_only`
5. `hour_levels:all_only`
6. `heatmap_net:all_only`
7. `monthly:all_only`
8. `items:all_only`

`drop` removes the table; `all_only` keeps only its `ALL` rows. A pack still above 30,000 after the last step fails with `pack_over_budget`. A pack under 15,000 is reported as small, never refused.

### Validation

`validatePack` reads a value through its canonical text and `dataPackSchema`, then checks the invariants: every row has one cell per column, row keys follow the pattern, each cell fits its column's unit and digits, column names are unique, store labels are unique and in label order and every row scope names a store of the pack, store ids are UUIDs in a live pack and `MOCK-S<n>` exactly when `sample` is true, the calendar equals `calendarOf(as_of, horizon)`, the budget's limit, trimmed steps, estimate and ceiling hold, and `pack_id` recomputes. A value the schema reader would change (a key named `__proto__`) is refused. `parsePack` does the same for a text and also returns the recomputed `pack_id`, so a text with a duplicate key fails. `comparePackTexts` answers `valid`, `identical_apart_from_generated_at` (both texts canonical and equal once `generated_at` is blanked), `pack_id_equal` and `tables_differing`.

### Aggregates only

`aggregatesOnlyIssues`, part of every validation, has five rules:

1. Allowed grains only: no invoice, line, payment, shift, customer or cashier grain.
2. No forbidden column name: customer, employee, cashier or staff names and ids, phone, e-mail, receipt, voucher code, external or POS ids, invoice and shift ids or names, notes, references, address.
3. At most 400 rows per table.
4. No e-mail address, Vietnamese phone number, run of nine or more digits or UUID in the texts people typed (names from the till, the focus, the owner note) or in the other prose of `tables` (titles, notes, text cells).
5. Every number finite.

Identifiers, dates, `pack_id`, `prompt`, `context` and the top-level calendar are not scanned: they are not personal data, and some match by chance (a `pack_id` with nine digits in a row, a store id). The same strings inside an item name are refused.

### The JSON Schema files

`schema/fnb-datapack-1.schema.json` (`$id` `urn:fnb:datapack:1`) and `schema/fnb-plan-1.schema.json` (`urn:fnb:plan:1`) are generated from the zod schemas with `z.toJSONSchema` (draft 2020-12, input mode, so the plan schema does not require `scope`) and committed. Regenerate them with `pnpm --filter @fnb/datapack schemas`; a test fails when the committed files differ from the generated ones, and another checks that Ajv 2020 reaches zod's verdict on valid and invalid packs and plans and on every fixture.

## The pack's content

`buildDataPack(request, { source, clock, fence, onProgress })` builds a pack from the report functions of `@fnb/reports` through any `ReportSource`: the demo engine (sample packs only), PostgREST in the browser, or Postgres for the command line. [docs/strategy.md, section 3](../../docs/strategy.md) has the details.

- **Request.** 1 to 10 stores of one tenant, `30d`, `90d` (`DEFAULT_HORIZON`), `180d` or `12m`, `vi` or `en`, and an as-of day that defaults to the last complete business day and may be earlier, never later (`pack_as_of_not_complete`). The focus (280 characters) and the owner note (1,000) are composed to NFC, their runs of whitespace collapsed and trimmed, and refused when they hold contact details (`pack_text_contact_details`).
- **Calendar.** `calendarOf(asOf, horizon)`: `w28`, `p28`, `ly28` (364 days back), `band` (the span of `b1` to `b8`, `w28` stepped back 7 days at a time), `w84`, the last 13 complete ISO weeks, the last 27 complete months, the month to date and the horizon.
- **Calls.** `packCalls` plans every call up front, the store profiles first: 8 for the pack and 10 per scope (`ALL`, and each store when there are several), so 18 for one store and 38 for two; at most 4 run at once, one at a time over Postgres.
- **Coverage.** A KPI window counts for a scope only when every store of the scope has history on its first day; otherwise it is null for the whole scope, and the gap `partial_scope_window` counts it.
- **Tables.** Twenty: `stores`, `kpi`, `weekly`, `monthly`, `weekday`, `month_to_date`, `heatmap_net`, `heatmap_invoices`, `hour_levels`, `items`, `categories`, `sizes`, `pairs`, `modifiers`, `payments`, `promotions`, `shifts`, `calendar`, `gaps` and `metrics`. Ranked rows (`<scope>/r01`…) follow declared total orders, never the transport's order; KPI cells are SQL's values, the rest rounded to their unit; stores appear by label only, and shifts by opening band without names.
- **Gaps.** `PACK_GAPS` maps each of the 15 gap codes to its severity and the settings page that fixes it.
- **Context.** The 10 dated benchmark entries as the registry writes them, and the promotion rules in force in the tenant's country on the as-of day, each as a sentence in the pack's language; it sits outside `tables`, so a plan cannot cite it.
- **Build.** Check the request, take the prompt, read the fence, the store profiles and the other calls, read the fence again (up to three attempts, then `pack_data_changed`), then the aggregates-only check (`pack_not_aggregate`), `sealPack` and `validatePack`.

`test/fixtures/demo-pack.json` is the golden demo pack: the demo's two stores at the fixed clock `2026-11-12T03:00:00Z`, 21,225 estimated tokens, built with a stand-in prompt until prompt 1.0.0 exists. `pnpm --filter @fnb/datapack golden` writes it again.

## Who uses it

`apps/web` (the pack buttons on Xuất dữ liệu and the plan paste box) and `apps/jobs` (`fnb datapack` and `fnb publish-plan`).

## Tests

```sh
pnpm --filter @fnb/datapack test
pnpm --filter @fnb/datapack typecheck
pnpm --filter @fnb/datapack schemas
pnpm --filter @fnb/datapack golden
```

437 tests in 39 files at `4e21657`.

- `test/pack/canonical.test.ts`, `decimal.test.ts`, `hash.test.ts`: the canonical text, decimals and units, the hash, `pack_id` and the clock.
- `test/pack/schema.test.ts`: the committed schema files equal the generated ones; Ajv and zod agree.
- `test/pack/invariants.test.ts`, `aggregates.test.ts`, `budget.test.ts`: validation, the aggregates-only rules with a breaking fixture each, the estimate and the trimming ladder.
- `test/pack/source-scan.test.ts` and `browser-safe.test.ts`: no locale, clock, randomness or Node API where they would make the browser and the command line differ.
- `test/pack/request.test.ts`, `calendar.test.ts`, `calls.test.ts`: the request's checks and defaults, every calendar window (leap days, month ends, a Sunday as-of day, 2026's week 53), the planned calls and the concurrency limit.
- `test/pack/coverage.test.ts`, `kpi-ids.test.ts`, `gaps.test.ts`, `context.test.ts`: the coverage rule per scope, the trackable KPI ids, each gap exactly when its condition holds, the rules in force in both languages.
- `test/pack/tables/*.test.ts`: provenance of every cell, the declared orders under shuffled rows, labels, empty tables, items, hour columns, shift bands, holiday dates.
- `test/pack/build.test.ts`, `golden.test.ts`, `transport-equivalence.test.ts`, `environment.test.ts`: the build with its fence and refusals, the golden pack byte for byte, two row shapes giving the same bytes, and the same bytes under three process time zones.

## Read more

- [docs/strategy.md](../../docs/strategy.md): the pack format, the pack's content (the request, the calendar and the KPI windows, the calls, coverage, every table with its keys and units, the gaps, the context, the build and the golden pack) and the plan format `fnb-plan/1` with every lint code and its level.
- [docs/architecture.md, 6.5](../../docs/architecture.md#65-data-pack-and-plan-publishing-phase-11): the data pack and plan publishing flow.
- [docs/decisions.md, ADR-003](../../docs/decisions.md#adr-003--no-paid-ai-api-the-strategy-runs-under-the-owners-own-assistant-subscription): why the pack exists.
- [docs/security.md, 8.6](../../docs/security.md#86-personal-data-minimisation-in-practice): personal-data minimisation.
