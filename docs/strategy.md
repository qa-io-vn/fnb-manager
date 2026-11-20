# Data pack and plan format

Purpose and audience: the formats of phase 11's strategy path. The AI data pack is one aggregate-only, versioned JSON document that the owner hands to their own assistant (ADR-003); the plan is the Markdown the assistant writes back, checked against that exact pack before it can be stored. This page states the pack format (canonical text, `pack_id`, units and digits, the aggregates-only rules, the budget and its trimming ladder, the JSON Schema files), the pack's content (the request, the calendar and the KPI windows, the report calls, coverage per scope, the twenty tables, the gaps, the context, the build, the golden pack, the strategy prompt and the chat bundle), the plan format `fnb-plan/1` with its lint (sections, initiative fields, citations, the number grammar and every lint code), the sample plan and the plan fixtures, and how a pack is built in the browser and checked and built with `fnb datapack`. It is for developers of the pack, the prompt, the command line and the paste box, for reviewers who check that nothing row-level or personal leaves in a pack, and for testers. The code is `packages/datapack` ([README](../packages/datapack/README.md)), with the pack tab in `apps/web` and the command in `apps/jobs`; where this page and the code differ, the code wins. Requirements: FR-EXP-03 to FR-EXP-10, FR-STR-01, FR-STR-02, FR-STR-04, FR-STR-05.

Last updated 2026-11-18

## 1. Where the formats fit

The owner, or a manager, builds a pack in the browser on Xuất dữ liệu ("Tải gói dữ liệu cho AI", "Sao chép gói + prompt"; section 7) or with `fnb datapack` (section 8), always as a member with a data role, never as the publisher, which reads no aggregate (FR-EXP-09). Both run `buildDataPack` of `@fnb/datapack`, so the same data gives the same bytes: on the local stack the browser's pack and the command line's for the same member were identical apart from `generated_at`, with the same `pack_id`, and since `8c1b490` the live pack spec compares the two in CI's `e2e` job (#144). The assistant answers with a plan whose front matter names the pack's `pack_id`; the "Dán kế hoạch" box and `fnb publish-plan` are to run the same lint against that pack, and only a plan without errors becomes the arguments of `publish_strategy_plan` ([architecture.md, 6.5](architecture.md#65-data-pack-and-plan-publishing-phase-11)).

| Part | Code | State on 2026-11-18 |
|---|---|---|
| The pack format: canonical text, `pack_id`, units, the schema and its JSON Schema files, validation, the aggregates-only check, the estimate and the budget | `src/pack/` | built (#130) |
| The pack's content: the request, the report calls, the calendar and KPI windows, coverage per scope, the tables, the gaps and the context (`buildDataPack`, `packCalls`, `calendarOf`, `PACK_GAPS`) | `src/pack/build.ts`, `resolve.ts`, `calls.ts`, `calendar.ts`, `coverage.ts`, `context.ts`, `tables/` | built (#134) |
| The strategy prompt 1.0.0 and the chat bundle (`strategyPrompt`, `chatBundle`) | `src/prompt/`, `src/pack/bundle.ts` | built (#131) |
| The plan format and its lint (`normalizePlanText`, `parsePlan`, `lintPlan`, `planRecord`) | `src/plan/` | built (#135) |
| The sample plan and the plan fixtures (`samplePlan`, `miniPack` in `@fnb/datapack/testing`) | `src/testing/`, `test/fixtures/plans/`, `scripts/emit-plan-fixtures.ts` | built (#136) |
| `fnb datapack`: build, check and compare packs as a member, written only to private places | `apps/jobs/src/commands/datapack.ts`, `apps/jobs/src/datapack/` | built (#137) |
| The pack tab "Gói dữ liệu cho AI": the form, the build, the summary, "Tải gói dữ liệu cho AI" and "Sao chép gói + prompt" | `apps/web/src/pages/exports/pack-*`, `apps/web/src/datapack/` | built (#142) |
| `fnb publish-plan --check` and the paste box "Dán kế hoạch": the lint of a pasted plan against its pack, offline and in the browser | `apps/jobs/src/commands/publish-plan.ts`, `apps/web/src/pages/plans/`, `apps/web/src/plans/` | built in `8c1b490` (#138, #143); their sections of this page are still to write |
| The byte identity of browser and command-line packs in CI, then the acceptance of 11a-2 | `apps/web/e2e/live/datapack.spec.ts`, CI | in build (#144: the browser half is in `8c1b490`, the gated integration suite is next), then #145 |
| KPI status and the comparison of two plans (`kpiStatus`, `comparePlans`) | `src/plan/status.ts`, `compare.ts` | phase 11b (#171) |

## 2. The pack

### 2.1 The document

A pack is one JSON object with exactly twelve keys; the zod schema `dataPackSchema` is strict at every level, so an unknown key fails.

| Key | Holds |
|---|---|
| `format` | `fnb-datapack` |
| `schema_version`, `builder_version` | `1.0.0` each (`DATA_PACK_SCHEMA_VERSION`, `DATA_PACK_BUILDER_VERSION`) |
| `pack_id` | 64 lowercase hex digits (section 2.5) |
| `generated_at` | UTC to the second, `2026-11-12T03:00:00Z` |
| `sample` | true for a sample pack, whose stores are `MOCK-S<n>`; a sample pack is never published |
| `request` | `as_of` (an ISO date), `currency` (three capital letters), `focus` and `owner_note` (text or null), `horizon` (`30d`, `90d`, `180d` or `12m`), `language` (`vi` or `en`), `stores` (1 to 10 entries of `id` and `label`) |
| `calendar` | the date ranges `band`, `horizon`, `ly28`, `month_to_date`, `months`, `p28`, `w28`, `w84` and `weeks`, each `{from, to}`, equal to `calendarOf(as_of, horizon)` |
| `context` | `benchmarks` (rows of four texts), `note` and `rules` (rows of text, text, date, text): context that is not the tenant's data, such as the benchmark entries, kept apart from the tables |
| `prompt` | `id` (`fnb-strategy`), `language`, `text`, `version` |
| `budget` | `estimated_tokens`, `limit` (30,000) and `trimmed` (section 2.6) |
| `tables` | the figures, by table id (`^[a-z][a-z0-9_]*$`) |

A table has a `title`, a `grain` (one of 19 aggregate grains such as `store-week`, `item-period` or `weekday-hour`), a `window` (one of the calendar's names, or null), `notes`, its `columns` (each a `name` matching `^[a-z][a-z0-9_]*$` and a `unit`) and its `rows`: an object from row key to an array of cells, one per column in the declared order, each cell a number, a text, a boolean or null. A row key is made of letters, digits and `_ . / -` with at least one letter, so it is never read as an array index (`ROW_KEY_PATTERN`). Its first segment, up to the first `/`, is its scope when it is `ALL` or a store label (`S1` to `S99`): `ALL/2026-W45`, `S2/2026-W45`, `ALL/net_revenue`. Store ids appear only in `request.stores`: UUIDs in a live pack, `MOCK-S<n>` exactly when `sample` is true. Tables name stores by label only.

### 2.2 Canonical text

`canonicalJson` writes the one text of a value:

- object keys sorted by UTF-16 code units at every level (`compareCodeUnits`, never a locale or `localeCompare`);
- no whitespace between tokens;
- strings escaped exactly as `JSON.stringify` escapes a string, so a line break inside a string is always `\n` and the text has no line-ending variants;
- numbers through `formatDecimal` (section 2.3);
- one final newline.

It refuses `NaN`, infinities, `undefined`, functions, symbols, big integers, objects that are not plain and a value that contains itself, naming the path (`pack_invalid`). Every pack, every `pack_id` and every comparison goes through this text, so a parsed pack re-serialises byte for byte, also after a database round trip that reorders keys, adds whitespace or writes `1.50` for `1.5`.

### 2.3 Numbers

`formatDecimal` writes a number as plain decimal digits: `toPrecision(15)` (15 significant digits; ECMAScript breaks its ties away from zero), the digits read into a `BigInt` and scaled without floating-point arithmetic, trailing zeros trimmed, `-0` written as `0`, never an exponent. So `0.1 + 0.2` is written `0.3`, `1e-7` is `0.0000001`, 10¹⁴ đồng is written in full, and a written number reads back to the same text. A value that is not a finite number is refused.

### 2.4 Units and digits

Each column declares a unit, and the builder rounds every number half away from zero (`roundHalfAwayFromZero` of `@fnb/reports`) to the unit's digits before it is written. Validation refuses a cell with more decimals than its unit allows (`cell_digits`) and a cell of the wrong kind (`cell_unit`); null is allowed in any column.

| Unit | Cell | Digits |
|---|---|---|
| `money` | number | the currency's minor units (ISO 4217: 0 for VND, 2 for a currency the table does not list) |
| `money_thousands` | number | 1 |
| `count`, `days` | number | 0 |
| `quantity` | number | 3 |
| `fraction`, `rel_change`, `pp_change` | number | 4 |
| `hours` | number | 1 |
| `ratio` | number | 2 |
| `metric`, `metric_change` | number | unrounded: KPI values exactly as SQL gives them |
| `text`, `class` | text | |
| `date` | an ISO date that exists | |
| `flag` | boolean | |

### 2.5 `pack_id`, `generated_at` and the clock

- `pack_id` is `sha256Hex` (Web Crypto's SHA-256 over the UTF-8 bytes, written as lowercase hex) of the canonical text with both `pack_id` and `generated_at` set to `""`. Two packs of the same data therefore have the same `pack_id` whatever their build time, transport or key order, and a plan's front matter names the pack it was written from by this id.
- The clock is injected (`PackClock`) and read for two values only: `generated_at`, written in UTC to the second with the milliseconds cut, and, when the request names no as-of day, the default as-of day, the last complete business day of the pack's stores at that time (section 3.1). `fixedClock` takes only an ISO instant with `Z` or an offset (`2026-11-12T10:00:00+07:00`) on a date that exists, so no process time zone can enter.
- `sealPack` trims a draft to its budget, computes the `pack_id` and returns the pack, its canonical text, the id and the estimate.

### 2.6 The budget and its trimming ladder

`estimateTokens` is ceil(UTF-8 bytes × 5 ÷ 11) in integer arithmetic. `budget.estimated_tokens` is the estimate of the pack's own final canonical text: the builder measures the text with a `pack_id` of 64 zeros and a `generated_at` of the same width as the real ones, then repeats until the estimate's own digits no longer change it, so the value does not depend on the id or the time and validation can recompute it exactly. A pack under 15,000 (`TOKEN_FLOOR`) is reported as small, never refused.

Above 30,000 (`TOKEN_LIMIT`) `trimToBudget` applies eight fixed steps, in this order, stopping as soon as the pack fits:

| Step | Effect |
|---|---|
| 1. `heatmap_invoices:drop` | removes the table |
| 2. `pairs:all_only` | keeps only the table's `ALL` rows |
| 3. `modifiers:all_only` | the same |
| 4. `sizes:all_only` | the same |
| 5. `hour_levels:all_only` | the same |
| 6. `heatmap_net:all_only` | the same |
| 7. `monthly:all_only` | the same |
| 8. `items:all_only` | the same |

A step that changes nothing, because the table is absent or holds only `ALL` rows, is skipped and not recorded; every step that changed the pack is recorded in `budget.trimmed` in order. A pack still above 30,000 after the last step fails with `pack_over_budget`, naming the estimate and the steps taken.

### 2.7 Validation

`validatePack(value)` reads a value through its canonical text and `dataPackSchema` and returns `valid`, the pack and its issues, each with a `code`, a `path` (such as `tables.items.rows["ALL/i01"][2]`) and a `detail`:

1. The value must have a canonical text (`not_json`) and pass the schema (`schema:<zod code>` at the failing path). Validation stops at the first of steps 1 and 2 that fails.
2. The schema's output must write the same canonical text as the input. A key the schema reader would drop unseen, such as a row hidden under a key named `__proto__`, is refused as `schema:changed`.
3. The invariants of `checkPackInvariants`: every row has one cell per column (`row_length`); row keys follow the pattern (`row_key`); each cell fits its unit and digits (`cell_unit`, `cell_digits`); column names are unique (`column_duplicate`); every row scope that is a store label names a store of the pack (`row_scope_unknown`); store ids are unique (`store_duplicate`) and of the right kind for `sample` (`sample_ids`); labels rise strictly by number, so `S10` comes after `S2` (`store_order`); the calendar equals `calendarOf(as_of, horizon)` (`as_of_invalid`, `calendar_unavailable`, `calendar_mismatch`); the budget's limit is 30,000 (`budget_limit`), its trimmed steps are ladder steps in ladder order (`budget_trimmed`), its estimate equals the estimate of the text (`budget_estimate`) and stays within the limit (`budget_over`); and `pack_id` recomputes (`pack_id_mismatch`).
4. The aggregates-only check (section 2.8).

`parsePack(text)` does the same for a text and also returns the `pack_id` recomputed from it, so a text with a duplicate key, whose parsed value no longer hashes to its own id, fails. `comparePackTexts(left, right)` answers `valid` (both valid), `identical_apart_from_generated_at` (both texts canonical and equal once `generated_at` is blanked), `pack_id_equal` and `tables_differing` (the ids of the tables whose canonical text differs or that only one side has). That comparison is the basis of FR-EXP-08: the browser's pack and the command line's for the same inputs must be identical apart from `generated_at` (#144).

### 2.8 Aggregates only

`aggregatesOnlyIssues` is part of every validation and has five rules:

| Rule | Refuses | Code |
|---|---|---|
| 1. Allowed grains only | a grain outside the 19 declared ones, or one with an invoice, line, payment, shift, customer or cashier segment | `grain_not_allowed` |
| 2. No forbidden column name | a column named after a person (customer, employee, cashier, staff, member or user) or holding their name, full name, id or code; phone, mobile, tel or telephone; e-mail; receipt; voucher code; any `external`, `ext` or `pos` segment; invoice ids and numbers; shift ids, numbers and names; notes; references; addresses. Each is matched as whole words between underscores | `column_forbidden`, with the rule in the detail |
| 3. At most 400 rows per table | a longer table | `table_too_long` |
| 4. No contact details or identifiers in prose | an e-mail address, a Vietnamese phone number (with `+84`, `84` or `0` and the usual separators), a run of nine or more digits or a UUID in the texts people typed (`request.focus`, `request.owner_note`) or in the prose of `tables` (titles, notes, and every text or class cell, such as an item name from the till) | `text_email`, `text_phone`, `text_digit_run`, `text_uuid` |
| 5. Every number finite | `NaN` or an infinity anywhere | `number_not_finite` |

Identifiers, dates, row keys, `pack_id`, `prompt`, `context` and the top-level calendar are not scanned: they are not personal data, and some match by chance (a `pack_id` with nine digits in a row, a store's UUID, a synthetic repeated-group id). The same strings inside an item name are refused. Date cells are left to the invariants, which accept only real ISO dates.

### 2.9 The JSON Schema files

`schema/fnb-datapack-1.schema.json` (`$id` `urn:fnb:datapack:1`) and `schema/fnb-plan-1.schema.json` (`urn:fnb:plan:1`, the plan's front matter) are generated from the zod schemas with `z.toJSONSchema` (draft 2020-12, input mode, so the plan schema does not require `scope`, which has a default) and committed. Regenerate them with `pnpm --filter @fnb/datapack schemas`, which also formats them with Biome; a test fails when the committed files differ from the generated ones, key order included. Zod is the only validator shipped; Ajv 2020 is a development dependency, used by a test that checks it reaches zod's verdict on valid and invalid packs and plans and on every fixture file.

### 2.10 Why the browser and the command line agree

Nothing in the format reads the environment. Source-scan tests refuse `Intl.`, `toLocale`, `localeCompare`, `Math.random` and `Date.now` everywhere in `src/pack` and `src/plan`. In `src/pack` they also refuse `new Date(` outside `clock.ts`, `JSON.stringify` outside `canonical.ts` and `.normalize(` outside `request-text.ts`, the request normaliser of #134. In `src/plan` they also refuse `new Date(`, `JSON.stringify` and the browser globals everywhere, and `.normalize(` outside `normalize.ts`. A further test imports both entry points under jsdom and refuses any Node API or database driver under `src`, and the package is marked `sideEffects: false`. Two tests build real packs to check the result: the golden demo pack built in child processes under the time zones UTC, Asia/Ho_Chi_Minh and America/Los_Angeles, each with its own `LANG` (`C`, `vi_VN.UTF-8`, `tr_TR.UTF-8`), has the same bytes in each; and rows shaped as PostgREST returns them and as `to_jsonb` returns them, with keys in another order and `1.50` for `1.5`, give the same bytes and the same `pack_id`.

## 3. The pack's content

`buildDataPack(request, options)` (`src/pack/build.ts`, #134) fills the format of section 2 from the report functions of `@fnb/reports`: it checks the request, reads the store profiles, derives the calendar from the as-of day, plans every call up front, reads them through the report source it is given, builds twenty tables and the context, and seals the pack. The same code builds a sample pack from the demo engine, a live pack in the browser through PostgREST (section 7) and, for `fnb datapack`, a pack read over Postgres inside one snapshot (section 8). `buildDataPack` takes its prompt from `strategyPrompt` in the request's language (section 3.10).

### 3.1 The request

`DataPackRequest` is checked twice: by `checkPackRequest` before anything is read, and by `resolvePackRequest` once the store profiles are in.

| Field | Rule | Refused with |
|---|---|---|
| `storeIds` | 1 to 10 distinct stores (`MAX_PACK_STORES`): UUIDs in a live pack, `MOCK-S<n>` in a sample pack. Every store must be visible to the session, and all must belong to one tenant with one currency and one country; no two may share a label | `pack_stores_invalid` |
| `asOf` | null for the default: the last complete business day, the earliest over the pack's stores, from each store's time zone and business-day start at the clock's time (`asOfDate` of `@fnb/reports`). An earlier day may be named, a later one may not | `pack_invalid` for a date that does not exist, `pack_as_of_not_complete` for a day after the default |
| `horizon` | `30d`, `90d`, `180d` or `12m`: the 30, 90, 180 or 365 days after the as-of day; `DEFAULT_HORIZON` (`90d`) is the default for the callers | `pack_invalid` |
| `language` | `vi` or `en`: the language of the tables' titles and notes, the metric labels, the context's note and rule sentences and the prompt, which must be in the same language | `pack_invalid` |
| `focus`, `ownerNote` | text or null. Each is composed to NFC, every run of whitespace becomes one space, and the ends are trimmed; an empty result is null. At most 280 and 1,000 characters (`FOCUS_MAX_LENGTH`, `OWNER_NOTE_MAX_LENGTH`), counted after that. A text that holds an e-mail address, a Vietnamese phone number, a run of nine or more digits or a UUID (rule 4 of section 2.8) is refused, so contact details typed by mistake never reach a pack | `pack_text_too_long`, `pack_text_contact_details` |
| `sample` | true exactly when the source is the demo engine: the demo builds sample packs only, and a sample pack comes only from the demo | `pack_invalid` |

The resolved request lists the stores as `{id, label}` in label order. The labels (`S<n>`) and the currency come from `store_profiles`, so from SQL, and so does the country whose rules the context holds. `request.stores` is the only place in a pack where store ids appear.

### 3.2 The calendar and the KPI windows

`calendarOf(asOf, horizon)` gives the nine ranges of `calendar`, and `kpiWindowsOf(asOf)` the eleven KPI windows (`KPI_WINDOWS`: `w28`, `p28`, `ly28` and `b1` to `b8`). Every range is inclusive and follows from the as-of day alone; `validatePack` checks that a pack's `calendar` equals `calendarOf(as_of, horizon)` (section 2.7).

| Window | Range |
|---|---|
| `w28` | the 28 days ending on the as-of day (`KPI_WINDOW_DAYS`) |
| `p28` | the 28 days before `w28` |
| `ly28` | `w28` moved back 364 days, so its weekdays line up with `w28`'s |
| `b1` to `b8` | `w28` moved back 7, 14, … 56 days; `b4` equals `p28`. They appear only through the `lo`, `hi` and `n` of the `kpi` table |
| `band` | from the first day of `b8` to the as-of day: the 84 days that `w28` and the eight band windows span |
| `w84` | the 84 days ending on the as-of day |
| `weeks` | the last 13 complete ISO weeks, Monday to Sunday, ending on the as-of day when it is a Sunday, else on the Sunday before |
| `months` | the last 27 complete months, ending with the as-of month when the as-of day is its last day, else with the month before |
| `month_to_date` | the first of the as-of month to the as-of day |
| `horizon` | the day after the as-of day and the horizon's 30, 90, 180 or 365 days from it |

### 3.3 The calls

`packCalls(request)` lists every report-function call up front, the store profiles first:

- once per pack: `store_profiles`; `store_coverage` from the first day of `ly28` to the as-of day; `report_settings_of`; `period_series` by week over `weeks`, by month over `months` and by weekday over `w84`, with each store's rows when the pack has several; `shift_review` over `w28`; `holiday_calendar` over `horizon`;
- once per scope: `metric_windows` for the trackable KPI ids over the eleven KPI windows; `month_pace` for the month to date; `hour_weekday_heatmap` and `hour_profile` over `w84`; `item_summary`, `modifier_summary` and `payment_summary` over `w28` compared with `p28`; `item_margins`, `basket_pairs` and `promotion_summary` over `w28`.

The scopes (`packScopes`) are `ALL`, every store of the pack together, and, when the pack has more than one store, each store alone under its label; a pack of one store has the `ALL` scope only. That makes 8 calls plus 10 per scope: 18 for one store, 38 for two. Every call's arguments pass its function's contract in `@fnb/reports`, within that function's limits, for one, two and ten stores.

The calls run through `runPlannedCalls` of `@fnb/reports`, which shares a call planned twice, and `limitedReportSource`, which runs at most 4 at a time (`BROWSER_CONCURRENCY`), and one at a time when the source is Postgres (`SNAPSHOT_CONCURRENCY`), as inside one read-only transaction. `onProgress(done, total)` counts the distinct calls. `recordingReportSource` records each call's arguments and rows; the build returns them as `calls`, which the provenance tests compare with every cell.

The trackable KPI ids, `trackableMetricIds()`, are the ids that `metric_value` computes and that are current in the registry, without `KPI_EXCLUDED_METRIC_IDS` (`void_rate`): 18 today. The `kpi` table, the rows of `metrics` marked trackable and the plan lint's `kpi_untracked` use this one list; superseded ids and `void_rate` appear only as rows of `metrics` that are not trackable.

### 3.4 Coverage per scope

The KPI windows follow phase 9's coverage rule ([metrics.md, coverage and like-for-like](metrics.md#coverage-and-like-for-like); `isCoveredAt` of `@fnb/reports`). A store covers a window when its history starts on or before the window's first day, its history starting on the later of its opening day and its first day with sales (`store_coverage`). A window counts for a scope only when every store of the scope covers it; otherwise it is null for all of the scope's KPIs, rather than a figure for fewer stores than the scope names (`scopeCoverage`).

So in a pack of two stores where the newer one opened during `p28`:

- every `ALL` row of the `kpi` table has `p28`, `ly28` and both changes null, and its `lo`, `hi` and `n` use only the windows both stores cover;
- the gap `partial_scope_window/ALL` counts the windows nulled;
- the newer store's own `p28` is null as well, while the older store's own rows stay complete.

A store open for less than 28 days has a null `w28` on all its rows, and so has every `ALL` row; the gaps show it as `young_store` with its days of history, not as unmeasured KPIs.

### 3.5 The tables

Rules for all twenty:

- **Cells.** Every number is the value its report function gave, rounded to its column's unit (section 2.4); the KPI cells are SQL's values, unrounded. The title and notes are in the pack's language, and the notes explain the row keys and columns to the assistant.
- **Row keys.** Series are keyed `<scope>/<bucket>`. A ranked table is keyed `<scope>/r<rank>` from `r01`, with two digits or more and no gap, in a declared total order applied in TypeScript after the rows are read, never in the order a transport delivered them. Ties are broken down to a name and a key, so shuffled source rows give the same keys and the same bytes.
- **Stores.** Tables name stores by their labels from SQL; store ids appear only in `request.stores`.
- **Empty.** Every table is present even without a row: a pack of stores without sales still holds all twenty and validates.

| Table | Rows | Window | Columns (unit) | What is kept, in which order |
|---|---|---|---|---|
| `stores` | `S<n>`, one per store | none | `name` (text), `opened_on`, `history_start` (date), `history_days`, `sales_days`, `unmatched_days`, `unchecked_days`, `stale_days` (days), `day_start`, `open_hours_week` (hours), `seats` (count), `e_invoice` (class), `verified` (flag) | from `store_profiles` and `store_coverage`; the day counts run from the first day of `ly28` to the as-of day, and `verified` is true when no day is unmatched or unchecked against the POS |
| `kpi` | `<scope>/<metric id>`, one per scope and trackable id | `w28` | `w28`, `p28`, `ly28`, `lo`, `hi` (metric), `p28_change`, `ly28_change` (metric_change), `n` (count) | the changes are relative, or a difference for a KPI whose unit is a fraction; `lo`, `hi` and `n` are the lowest value, the highest and the number of windows with a value among `w28` and `b1` to `b8` |
| `weekly` | `<scope>/<ISO year>-W<week>` | `weeks` | `net`, `avg_ticket` (money), `invoices` (count), `store_days`, `holiday_days` (days) | weeks that end before the scope's history starts are left out |
| `monthly` | `<scope>/<year>-<month>` | `months` | as `weekly` | as `weekly` |
| `weekday` | `<scope>/<mon … sun>` | `w84` | as `weekly` without `holiday_days`, plus `share` (fraction: the weekday's part of the week's net) | holidays included |
| `month_to_date` | `<scope>` | `month_to_date` | `net`, `target`, `forecast_profile`, `forecast_naive` (money), `invoices` (count), `elapsed_days`, `remaining_days` (days), `target_share` (fraction) | from `month_pace`; the `ALL` target only when every store has one |
| `heatmap_net` | `<scope>/<weekday>` | `w84` | `hHH` (money_thousands), one per local hour with sales | the mean net per day of the weekday, in thousands; hours in order from the first store's business-day start; 0 for an hour without sales on a weekday with sales |
| `heatmap_invoices` | as `heatmap_net` | `w84` | `hHH` (ratio) | the mean invoices per day |
| `hour_levels` | `<scope>/all`, `<scope>/weekdays`, `<scope>/weekend` | `w84` | `hHH` (class), `peak_share`, `dead_share` (fraction) | from `hour_profile`: `peak`, `dead` or `normal` on `all`, `busy`, `quiet` or `normal` on weekdays and the weekend |
| `items` | `<scope>/r<rank>` | `w28` | `name` (text), `role` (class), `qty` (quantity), `net` (money), `share` (fraction), `net_change` (rel_change, against `p28`), `first_sold` (date), `margin_rate` (fraction, null without costs) | the 10 items sold in `w28` with the largest net, then quantity, name and id |
| `categories` | `<scope>/r<rank>` | `w28` | `name` (text), `items` (count), `qty` (quantity), `net` (money), `share` (fraction), `net_change` (rel_change) | at most 10, by net, quantity and name; a category is the POS item type or its override |
| `sizes` | `<scope>/r<rank>` | `w28` | `size` (text), `qty` (quantity), `net` (money), `qty_share` (fraction), `qty_share_change` (pp_change) | at most 6 sizes of sized items, by quantity, net and name |
| `pairs` | `<scope>/r<rank>` | `w28` | `item_a`, `item_b` (text), `invoices` (count), `confidence_ab`, `confidence_ba` (fraction), `lift` (ratio) | the 8 pairs with the most shared invoices, then lift, names and ids |
| `modifiers` | `<scope>/r<rank>` | `w28` | `name` (text), `family` (class: sugar, ice or other), `lines` (count), `share` (fraction), `share_change` (pp_change) | the 10 most used, then name |
| `payments` | `<scope>/r<rank>` | `w28` | `name` (text), `kind` (class), `invoices` (count), `amount`, `fee` (money), `share` (fraction), `share_change` (pp_change) | at most 8, by amount, invoices, kind, name and key; `fee` only when every store of the scope has fee rates |
| `promotions` | `<scope>/r<rank>` | `w28` | `name` (text), `kind` (class: item, bill or voucher), `invoices` (count), `discount` (money), `days` (days) | the 8 with the largest discount, then invoices, kind, name and key |
| `shifts` | `<scope>/<band>` | `w28` | `shifts`, `flagged` (count), `avg_orders` (ratio), `avg_sales`, `avg_abs_variance` (money), `avg_hours` (hours) | by the local hour each shift opened in its store's time zone: `morning` 05–11, `midday` 11–17, `evening` 17–23, `night` 23–05; `avg_hours` over closed shifts; never a shift or cashier name |
| `calendar` | `ALL/<date>` | `horizon` | `names` (text), `kind`, `weekday` (class), `days_away` (days) | public holidays, Tết and the tenant's own days; the names of one date joined with `; `, its kind `tet` before `public` before `custom` |
| `gaps` | `<code>/<scope>` | none | `value` (count), `severity`, `setting` (class) | section 3.6 |
| `metrics` | `<metric id>` | none | `label` (text), `unit`, `direction`, `superseded_by` (class), `trackable` (flag), `formula` (text) | every id that `metric_value` computes, its label in the pack's language |

### 3.6 The gaps

`gaps` names every missing input the assistant should know about: one row `<code>/<scope>` for each condition that holds, and none otherwise. `PACK_GAPS` (exported) fixes each code's severity and the setting that fixes it, a `NoticeAction` of `@fnb/reports` that the interface turns into a link to the settings page of phase 10; null when no setting can.

| Code | Scope | When | `value` | Severity | Setting |
|---|---|---|---|---|---|
| `opening_hours` | each store | the store's opening hours are not known | null | medium | `settings_store` |
| `seat_count` | each store | no seat count | null | low | `settings_store` |
| `item_roles` | each store | the item-type roles are not configured | null | medium | `settings_roles` |
| `item_costs` | each store | no item cost | null | medium | `settings_costs` |
| `partial_costs` | each scope | a store of the scope has costs, but items sold in `w28` have a cost for only part of their sales, or none | the items | low | `settings_costs` |
| `fee_rates` | each store | no fee rate | null | low | `settings_fees` |
| `target` | each store | no monthly target for the as-of month | null | low | `settings_targets` |
| `young_store` | each store | its history starts after the first day of `w28`, or has not started | its days of history | medium | none |
| `short_history` | each store | its history covers `w28` but starts after the first day of `ly28` | its days of history | low | none |
| `partial_scope_window` | each scope of several stores | KPI windows nulled by the coverage rule (section 3.4) | the windows | medium | none |
| `unreconciled_days` | each store | days unmatched or unchecked against the POS, from the first day of `ly28` to the as-of day | the days | high | none |
| `stale_aggregates` | each store | days whose aggregates are still being refreshed | the days | medium | none |
| `no_customer_identity` | `ALL` | registry metrics wait for customer identity (Track C) | those metrics, 11 today | low | none |
| `unmeasured_kpi` | each scope whose `w28` counts | trackable KPIs without a `w28` value | the KPIs | medium | none |
| `staff_hours` | `ALL` | always: no staff hours are recorded | null | low | none |

A store's gaps carry its label as the scope, also in a pack of one store.

### 3.7 The context, and why it is never cited

`context` stands beside `tables`, not inside them, because nothing in it measures the tenant's stores:

- `benchmarks`: the 10 dated entries of `benchmarkContext` in `@fnb/metrics` (FR-ANA-14, [metrics.md, benchmark context](metrics.md#benchmark-context)), in registry order, each `[id, figure, year, source]` as the registry writes it;
- `note`: in the pack's language, that this is market context and rules for reference, not the stores' measurements, never a target and never cited, and that the rules follow their sources as of the check date and are not legal advice;
- `rules`: the promotion rules of `promotionRules(country)` in `@fnb/core` in force in the tenant's country on the as-of day (valid from that day or earlier, and until that day or later or without an end), each `[id, country, valid_from, sentence]`. The sentence is written in the pack's language from a template per rule id, with its legal basis, the date its sources were checked and the caveat that it is not legal advice; every rule has its sentence in both languages. A rule no longer in force is left out: from 26 June 2026 the yearly limit of 120 discount days per item, reported repealed by Decree 239/2026, is not sent, while the 50 % discount cap and the registration of lucky draws remain. The legal read (#49) checks the decree's text, and #50 opens a follow-up here if it differs.

A plan cites cells of `tables` only: a citation of `context` is `citation_unknown` (section 4.5), and a KPI must be a trackable id measured in the `kpi` table (section 5). A market figure or a legal threshold therefore never stands in for the shop's own numbers, as evidence or as a KPI's baseline, and nobody takes a benchmark for a target. The aggregates-only scan leaves `context` alone (section 2.8), since it holds no personal data.

### 3.8 The build

`buildPackWith(request, options, promptOf)`, which `buildDataPack` calls with `strategyPrompt`, runs these stages:

1. Check the request (section 3.1) before anything is read, and take the prompt in the request's language; a prompt in another language is refused (`pack_invalid`).
2. Read the fence (`options.fence`): the pack tab passes a call of `pack_fence` over the pack's stores (section 7); the demo, whose numbers cannot change during a build, and `fnb datapack`, which reads inside one read-only repeatable-read transaction (section 8), pass none.
3. Read `store_profiles` and resolve the request: labels, currency, country and the default as-of day.
4. Read every other call of `packCalls` (section 3.3).
5. Read the fence again. If it moved, a sync or a refresh committed during the read, and the build starts again at stage 2; after three attempts (`PACK_ATTEMPTS`) it fails with `pack_data_changed`.
6. Draft the pack: the calendar, the twenty tables, the context, the prompt and `generated_at`.
7. Run the aggregates-only check (section 2.8) on the draft. Any issue fails the build with `pack_not_aggregate`, naming the first three, as for an item name from the till that looks like a phone number.
8. `sealPack`: trim to the budget (section 2.6), which may fail with `pack_over_budget`, and compute `pack_id`.
9. `validatePack` (section 2.7); any issue fails the build with `pack_invalid`.

The result, `BuiltPack`, holds the pack, its canonical text, `pack_id`, the estimate and the recorded calls.

### 3.9 The golden pack and the measured sizes

`test/fixtures/demo-pack.json` is the golden demo pack: a sample pack of the demo engine's two stores (`MOCK-S1`, `MOCK-S2`) built at the fixed clock `2026-11-12T03:00:00Z`, so the as-of day is 2026-11-11, with the horizon `90d`, Vietnamese, the focus "Tăng giá trị hóa đơn buổi chiều" and prompt 1.0.0. Every figure in it is synthetic, so it is safe to commit. The file holds the pack's canonical text formatted by Biome. `test/pack/golden.test.ts` builds the pack again and requires the file's canonical text byte for byte, a valid pack within the budget with nothing trimmed and with aggregates only, and no store id outside `request.stores`. `pnpm --filter @fnb/datapack golden` (`scripts/emit-demo-pack.ts`) writes the file again and prints its estimate and the first eight digits of its `pack_id`; run it when the content or the prompt changes on purpose, then `pnpm --filter @fnb/datapack fixtures`, since two plan fixtures derive from the golden pack (section 6).

Sizes with prompt 1.0.0, whose text adds 3,779 estimated tokens to a Vietnamese pack and 3,378 to an English one:

| Pack | Estimated tokens |
|---|---|
| The golden demo pack, two stores | 24,968 of 30,000, nothing trimmed |
| The seed's two stores on the local stack, as-of day 2026-11-17, Vietnamese, `90d` (`fnb datapack --tenant demo-fnb`) | 19,817, nothing trimmed; for the same requests the command line's pack and the browser path's were identical apart from `generated_at`, with the same `pack_id` |
| The mini pack, `test/fixtures/plans/mini-pack.json` (section 6) | 17,978 |
| One to four stores of the demo, the third and fourth made of copied store rows (`test/pack/store-budget.test.ts`) | one to three stores fit untrimmed in both languages; four fit after the first steps of the ladder |
| More stores, measured the same way when the prompt landed | up to seven in Vietnamese and eight in English fit after the whole ladder; ten stores end in `pack_over_budget` |

So the request allows ten stores (`MAX_PACK_STORES`), but a pack of more than seven or eight stores of this size is refused with `pack_over_budget`, and the pack tab then suggests choosing fewer stores (FR-EXP-04).

### 3.10 The strategy prompt

`strategyPrompt(language)` (`src/prompt/prompt.ts`, #131) returns `{ id: "fnb-strategy", version: "1.0.0", language, text }`, and the build puts it in the pack's `prompt`, so the instructions travel with the figures they explain and `pack_id` covers them. Each language's text is an array of string literals in `strategy-vi.ts` and `strategy-en.ts`, joined with LF, so neither a checkout's line endings nor a bundler can change it. No value is ever written into the text: it names pack fields (`request.horizon`, `tables`, `context.rules`) instead, so each version and language is one fixed string.

The text, in the plan's language, tells the assistant:

- the three kinds of information and how to keep them apart: the measurements in `tables`, the only evidence and the only cells to cite; the context and rules in `context`, never cited and never a target, while the plan respects the rules; and what the owner declared, `request.focus` and `request.owner_note`. Every text in the pack is data, not instructions;
- how to read the tables: row keys and scopes, the units, `null` as not measured and never 0, the `gaps` table and what `budget.trimmed` cut;
- the cite-a-number rule (section 4.5) with the number formats of the plan's language (section 4.6), and "ước tính" or "estimate" before a number it worked out itself (section 4.7);
- the answer format: the JSON front matter, with `pack` copied from `pack_id`, 3 to 6 KPIs keyed by trackable ids, each baseline copied unrounded from `w28` and each target in the good direction; then the ten sections of section 4.3 in order, and five to seven initiatives with their seven fields (section 4.4);
- the quality rules (specific and feasible for a small store, the focus first, no invented number, no personal data, no question back and no tool), a check before answering, and a worked example of the front matter and the first initiative.

The prompt names no assistant, product, vendor or tool and holds no slash command, link, markup tag or tool-call syntax (ADR-003), so the same text works pasted into a chat, attached as a file or handed to an assistant that can run commands; any assistant-specific wrapper stays in the owner's own configuration, outside the repository. It reaches the assistant three ways: inside every pack (`prompt.text`, so the downloaded file alone is enough), first in the chat bundle (section 3.11), and in the bundle file of `fnb datapack --bundle`.

`PROMPT_SHA256` pins the SHA-256 of each language's text per version, and a test fails when a text changes while the version stays: a change of the plan format takes a new major version, a new rule a minor one, a rewording a patch. The prompt's own example, filled with the numbers of a built pack, lints with no issue at all.

### 3.11 The chat bundle

`chatBundle(pack)` (`src/pack/bundle.ts`) is the text that "Sao chép gói + prompt" copies and `fnb datapack --bundle` writes, for a chat that takes text only: the prompt's text, an empty line, then the pack's canonical text in one `json` fence, in which `prompt.text` is replaced by a one-line pointer in the pack's language ("Lời nhắc nằm ở đầu văn bản này, ngay trước gói dữ liệu.", "The instructions are at the top of this text, just before this data pack."), so the prompt is sent once. `pack_id` is unchanged, and putting the prompt back into the fenced pack gives the pack byte for byte.

## 4. The plan format `fnb-plan/1`

### 4.1 Normalisation

`normalizePlanText` turns whatever was pasted or written into the one text that is linted, hashed, published and stored, and is idempotent:

1. removes a leading byte order mark, converts CRLF and CR to LF and composes the text to Unicode NFC;
2. strips trailing spaces and tabs from every line;
3. removes a single code fence (plain, `markdown` or `md`) wrapped around the whole answer;
4. finds the front matter: a `---` block at the start, a later `---` block whose first non-blank line opens a JSON object, or a code block marked `fnb-plan` or `json` that contains `"format":"fnb-plan/1"`, which it converts into the `---` form;
5. discards anything before the front matter and reports it with the warning `preamble_text`; when a fence was opened just before the front matter and is closed after the plan, that fence is removed and a remark after it is kept;
6. removes surrounding blank lines and leaves exactly one final newline.

### 4.2 Front matter

The plan starts with a JSON object between two `---` lines (YAML is not read), checked by `planFrontMatterSchema`:

| Key | Rule | Lint code |
|---|---|---|
| `format` | `fnb-plan/1` | `front_matter_invalid` |
| `pack` | the `pack_id` of the pack the plan was written from | `front_matter_invalid` when malformed, `pack_mismatch` when another pack's |
| `title` | 1 to 120 characters | `front_matter_invalid` |
| `horizon` | `30d`, `90d`, `180d` or `12m`, the pack's horizon | `front_matter_invalid`, `horizon_mismatch` |
| `language` | `vi` or `en`: the grammar in which the body's numbers are read | `front_matter_invalid` |
| `kpis` | 1 to 8 entries, keyed by metric id (`^[a-z][a-z0-9_]{1,63}$`), each with `scope` (`ALL` or a store label, `ALL` when left out), `target` (a finite number), an optional `baseline` and `initiatives` (at least one initiative number from 1 to 7) | `front_matter_invalid`, `kpis_count`, the `kpi_*` codes of section 5 |

Unknown keys, at the top or inside a KPI, are dropped and named in the warning `front_matter_extra_fields`; the plan stays valid. Each `front_matter_invalid` names its failing path at the line of its key.

```
---
{
	"format": "fnb-plan/1",
	"pack": "<the pack_id>",
	"title": "A 90-day plan for both stores",
	"horizon": "90d",
	"language": "en",
	"kpis": {
		"avg_ticket": { "scope": "ALL", "target": 55000, "initiatives": [1, 2] },
		"discount_rate": { "target": 0.038, "initiatives": [3] }
	}
}
---
```

### 4.3 The ten sections

Sections are level-one or level-two headings, recognised by their Vietnamese or English title in any case, with an optional leading number (`1.`, `1)`, `1:` or `1 –`), optional bold and an optional trailing colon. Other headings are kept but count as no section.

| # | Id | Vietnamese title | English title |
|---:|---|---|---|
| 1 | `summary` | Tóm tắt tình hình | Situation summary |
| 2 | `strengths_weaknesses` | Điểm mạnh và điểm yếu | Strengths and weaknesses |
| 3 | `initiatives` | Sáng kiến ưu tiên | Priority initiatives |
| 4 | `plan_30_60_90` | Kế hoạch 30/60/90 ngày | 30/60/90-day plan |
| 5 | `menu` | Thực đơn | Menu |
| 6 | `hours_staffing` | Giờ mở cửa và nhân sự | Opening hours and staffing |
| 7 | `promotions` | Lịch khuyến mãi | Promotion calendar |
| 8 | `risks` | Rủi ro | Risks |
| 9 | `data_to_collect` | Dữ liệu cần thu thập | Data to collect |
| 10 | `assumptions` | Giả định | Assumptions |

A missing section is reported by its number (`section_missing:7`), every missing one, not only the first.

### 4.4 Initiatives and their seven fields

An initiative is a level-three heading `### Sáng kiến <n>: <title>` or `### Initiative <n>: <title>` (any case, optional bold, `:`, `.` or a dash after the number). A plan has five to seven of them (`initiatives_count:<k>`), numbered from 1 without gaps (`initiative_number:<n>` names the first out of place). An initiative ends at the next heading of level one to three.

Inside it, each field is a line that starts with its label, with an optional list marker, optional bold or italics and a colon (`- **Căn cứ:** …`), and runs over the following lines until the next label or heading. An empty field counts as missing, and of two equal labels the first is kept. Labels are read in either language, whatever the plan's language.

| Id | Vietnamese label | English label |
|---|---|---|
| `evidence` | Căn cứ | Evidence |
| `action` | Hành động | Action |
| `impact` | Tác động dự kiến | Expected impact |
| `effort` | Công sức | Effort |
| `kpi` | KPI | KPI |
| `read` | Cách đọc KPI trên ứng dụng | How to read the KPI in the app |
| `first_step` | Bước đầu tiên | First step |

Each missing field is reported as `initiative_field_missing:<n>:<field id>`.

### 4.5 Citations

A citation is `[[table:row:column]]`: a table id of the pack, a row key and a column name, separated by colons, spaces around them ignored. It cites one cell. The written number it vouches for is the number right before it on the same line, with at most three other words in between; looking back stops at another citation, and nothing after the reference or on another line counts. Dates, store labels and window names are words, not numbers, when looking back.

```
The average ticket is 52,314 VND [[kpi:ALL/avg_ticket:w28]] over 23,600 invoices [[kpi:ALL/invoices:w28]].
```

- `context` is never a table: a citation of it, of an unknown table, row or column, or a malformed reference is `citation_unknown:<ref>`.
- In a pack of one store, the row key `S1`, or one that starts with `S1/`, resolves to the matching `ALL` row.
- A written number that the cited numeric cell does not hold (section 4.6), or a number written for an empty cell, is `citation_mismatch:<ref>`, with the written number as the detail.
- A citation of a text, date or class cell, or one without a number before it, is valid but proves no number.
- An initiative is cited only when one of its lines holds a valid citation of a numeric cell whose written number matches it; otherwise `initiative_uncited:<n>`. A citation that the written number contradicts does not count.

The pack's `kpi` table is read by row `<scope>/<metric id>`: the column `w28` is the KPI's baseline, and `lo` and `hi` its band.

### 4.6 The number grammar

Numbers are read in the plan's language (the front matter's `language`, else the pack's):

| | Vietnamese (`vi`) | English (`en`) |
|---|---|---|
| Thousands separator | `.`, a space, a no-break space or a narrow no-break space, one kind per number | `,` |
| Decimal mark | `,` | `.` |
| Examples | `52.314`, `1 230 000`, `4,25` | `52,314`, `1,230,000`, `4.25` |

- Thousands groups follow an integer part of at most three digits and hold exactly three digits each.
- A single ambiguous group, one separator followed by exactly three digits (`1.500` or `1,500`), is read both ways: as 1,500 and as 1.5. A decimal mark of the other language that is not such a group (`4.25` in Vietnamese) and a number with more separators than the grammar allows are read as no number, which matches nothing.
- After the digits may follow, in this order, a scale word, a currency word and a percent or point word, each optionally after one space:

| Kind | Words | Effect |
|---|---|---|
| Scale | `nghìn`, `ngàn`, `thousand`, `k` | × 1,000 |
| | `triệu`, `million`, `tr`, `mn`, `m` | × 1,000,000 |
| | `tỷ`, `tỉ`, `billion`, `bn` | × 1,000,000,000 |
| Currency | `đồng`, `vnđ`, `vnd`, `đ`, `₫` | none |
| Percent or point | `%`, `phần trăm`, `điểm`, `điểm %`, `điểm phần trăm`, `percent`, `per cent`, `point`, `points`, `percentage point`, `percentage points`, `pts`, `pp`, `p.p.` | ÷ 100 |

- Signs are words: "giảm 3,2 điểm" and "−3.2 pts" both read 3.2 points (0.032), and values are compared as absolute values.
- **Matching.** A written number matches a cell when it is within half a unit of its last significant written digit, plus a relative tolerance of 10⁻⁹ for floating point. Trailing zeros of a whole number are not significant. So `1.230.000` matches anything from 1,225,000 to 1,235,000, `1,23 tỷ` anything within 5,000,000 of 1,230,000,000, and `31,25%` a fraction from 0.31245 to 0.31255. A `money_thousands` cell is also tried multiplied by 1,000. Front-matter numbers (a KPI's `baseline`) are read with the same rule.

### 4.7 Numbers without a citation

In sections 1 and 2 and in each initiative's Evidence field, every number must be cited, equal a KPI target of the front matter, or come after "ước tính" or "estimate" on its line (the assistant's own arithmetic). Otherwise it is counted in the warning `uncited_numbers:<k>`, whose detail lists each one as `<line>:<text>`. Never counted, wherever they stand: dates (`2026-11-12`, `12/11/2026`, `2026-11`, `2026-W45`), years from 1900 to 2099, times (`9:30`, `9h`, `9h30`, `9 am`), hour ranges with an hour mark (`7–9h`, `17:00–19:00`), fractions such as `30/60/90`, the number after `tháng`, `tuần`, `ngày`, `thứ`, `quý`, `month`, `week`, `day`, `quarter`, `sáng kiến`, `initiative`, `mục` or `section`, list numbering at the start of a line, store labels and headings. The other sections and the other initiative fields are not scanned. Like every warning, it does not make the lint's `ok` false.

## 5. The lint

`lintPlan(text, pack)` never throws. It normalises the text (section 4.1) and returns `ok` (true when no issue is an error), `normalized` (the text to store), `issues`, the parsed plan (null while the front matter is missing or invalid) and a summary (initiatives, cited initiatives, citations, valid citations, KPIs, uncited numbers, words). Each issue has a `code`, its `level`, a `line` (1-based, in the normalised text; null when the issue has no single line) and a `detail`, which is data such as a path, a value or a list, never a sentence. A code carries its parameter after the first colon (`kpi_unknown:net_sales`); the screens and the command line turn codes into messages. Issues come errors first, then by line, then in the order found, and an exact repeat is dropped. Warnings do not make `ok` false.

| Code | Level | When |
|---|---|---|
| `preamble_text` | warning | text stood before the front matter and was discarded |
| `front_matter_missing` | error | the text does not start with the front matter, or it is never closed |
| `front_matter_invalid` | error | the front matter is not a JSON object or fails the schema; one issue per failing path |
| `front_matter_extra_fields` | warning | unknown keys were dropped; the detail names them |
| `content_too_large` | error | the normalised text is over 200,000 bytes of UTF-8 |
| `pack_mismatch` | error | `pack` is not the given pack's `pack_id` |
| `horizon_mismatch` | error | `horizon` is not the pack's |
| `section_missing:<n>` | error | section `n` of the ten is absent |
| `initiatives_count:<k>` | error | `k` initiatives, outside 5 to 7 |
| `initiative_number:<n>` | error | the initiatives are not numbered 1, 2, 3… without gaps |
| `initiative_field_missing:<n>:<field>` | error | initiative `n` lacks a field, or it is empty |
| `initiative_uncited:<n>` | error | initiative `n` holds no valid citation of a matching number |
| `citation_unknown:<ref>` | error | the citation names no cell of the pack, or `context` |
| `citation_mismatch:<ref>` | error | the written number does not match the cited cell |
| `kpis_count:<k>` | error | `k` KPIs, outside 1 to 8 |
| `kpi_unknown:<id>` | error | the id is not a metric of the registry |
| `kpi_untracked:<id>` | error | a registry metric that KPI follow-up cannot track: not computed by `metric_value`, superseded by another id, or `void_rate` |
| `kpi_scope_unknown:<id>` | error | the scope is a store label the pack does not hold |
| `kpi_unmeasured:<id>` | error | the pack's `kpi` table has no numeric `w28` value for that scope and metric |
| `kpi_baseline_mismatch:<id>` | error | a written `baseline` does not match `w28` (section 4.6); the detail is the pack's value |
| `kpi_target_unchanged:<id>` | error | the target equals the baseline |
| `kpi_initiative_unknown:<id>` | error | the KPI names an initiative the plan does not have |
| `kpi_initiative_unlinked:<id>` | warning | a linked initiative's KPI field does not mention the id |
| `uncited_numbers:<k>` | warning | `k` numbers of section 4.7 have no citation; only when `k` is above 0 |

The KPI checks run only on valid front matter, and `kpi_unknown` and `kpi_untracked` stop the other checks of that KPI. The lint gives the same results in Node and under jsdom, recorded for every fixture in `test/fixtures/plans/lint/results.json`.

`planRecord(plan, pack, lint, via)` turns a plan that passed the lint into the arguments of `publish_strategy_plan`: the pack's store ids; the title, horizon and language; the normalised text; per KPI its scope, the store ids of that scope, the baseline copied exactly from `w28` whatever the front matter wrote, the target, `lo` and `hi` from the pack (null when missing), its initiatives, `due_on` at the end of the pack's horizon and `window_days` 28; the as-of date, `pack_id`, prompt version and the pack itself; the lint summary with its warning codes; and how the plan came (`skill`, `routine` or `pasted`). It refuses a sample pack (`sample_pack_not_publishable`), a plan written from another pack (`pack_id_mismatch`) and a KPI without a store or a baseline in the pack (`front_matter_invalid`).

## 6. The sample plan and the plan fixtures

`@fnb/datapack/testing` (`src/testing/`, #136) holds two helpers for the tests of every package that handles plans, such as those of `fnb datapack`; no shipped code imports it.

- **`samplePlan(pack)`** writes a deterministic plan from the pack's own cells, in the pack's language, titled "Kế hoạch mẫu, tạo tự động để minh họa" ("Sample plan, generated automatically to illustrate"). Its KPIs are the first three ids of a fixed list (`avg_ticket`, `attach_rate_topping`, `discount_rate`, `items_per_ticket`, `size_l_share`, `invoices`, `net_revenue`, all trackable) whose `ALL` row of the `kpi` table has a `w28`. Each target is the baseline moved 5 % in the metric's good direction, rounded to the digits of the metric's unit and moved one more unit when rounding gives the baseline back. Sections 1 and 2 cite `kpi` cells; the five initiatives take the KPIs in turn, and each Evidence field cites one detail cell (the leading item's net, the quietest weekday's share, the leading payment method's and category's shares, the month-to-date net), falling back to another detail cell and then to the KPI's `w28` when a table is empty. Numbers follow the language's grammar (`91.402 đ`, `22,88%`, `1,1 điểm`; `91,402 VND`, `22.88%`, `1.1 points`). A pack that measures none of the listed ids is refused (`pack_invalid`). For demo packs on 30 days in a row, in both languages, the sample plan lints with no error and no uncited number.
- **`miniPack()`** returns `test/fixtures/plans/mini-pack.json`, a fresh copy on every call: a small, hand-written pack shaped like a live one (`sample` false, the seed's synthetic store ids, all twenty tables, every trackable id per scope, prompt 1.0.0 in Vietnamese), valid and aggregate-only, 17,978 estimated tokens. Every plan fixture that reaches SQL is built on it, since a sample pack can never be published.

The plan fixtures, in `test/fixtures/plans/` beside the one-fixture-per-code folder `lint/` of section 5:

| File | What it is | Lint against its pack |
|---|---|---|
| `mini-pack.json` | the mini pack | a valid pack |
| `prompt-example.md` | a five-initiative plan written as the prompt asks, against the mini pack: the prompt's citation style, a target on each KPI line and worked "ước tính" arithmetic in each expected-impact field | no issue |
| `missing-section.md` | the sample plan of the golden demo pack without section 7 | `section_missing:7` |
| `unknown-kpi.md` | the same plan with its first KPI renamed `net_sales`, in the front matter and in the KPI field of its initiatives | `kpi_unknown:net_sales` |

`pnpm --filter @fnb/datapack fixtures` (`scripts/emit-plan-fixtures.ts`) writes them again: it seals `mini-pack.json` after a hand edit (its estimate and `pack_id`, formatted by Biome), writes the new `pack_id` into `prompt-example.md`, and regenerates the two rejection fixtures from the golden pack. Run it after editing the mini pack or regenerating the golden pack; `test/plan/fixtures.test.ts` fails when a committed file differs from what the script would write. `fnb publish-plan --check` (#138) and the paste box (#143) are tested with the same files, and so are to be the tests of phase 11b. Every fixture is synthetic.

## 7. Building a pack in the browser

The tab "Gói dữ liệu cho AI" of `#/xuat-du-lieu` (#142; the page's default tab, for owners and managers; [web-app.md](web-app.md#phase-11-decisions)) builds the pack in the member's browser through the page's report source: the signed-in member's session through PostgREST, so row-level security decides every row, or in the demo the demo engine, which builds a sample pack of its stores and sends no request outside its origin.

- The builder is a lazy chunk (`apps/web/src/datapack/browser-pack.ts`, about 27 kB gzipped), loaded at the first "Tạo gói", so the page's first load does not carry `@fnb/datapack`.
- The request comes from the form: the stores chosen in the top bar (1 to 10), "Dữ liệu đến hết ngày" (the as-of day, by default and at the latest the last complete day), "Kỳ kế hoạch", "Trọng tâm", "Ghi chú của chủ quán" and "Ngôn ngữ kế hoạch". The address parameters `asOf`, `horizon`, `lang` and `focus` fill it, as the byte-identity check of #144 needs.
- The fence is `pack_fence` over the pack's stores, read before and after the calls (section 3.8). After the build the tab validates the pack once more (`validatePack`) and keeps its canonical text: "Tải gói dữ liệu cho AI" saves that text byte for byte as `goi-du-lieu_<as_of>_<tat-ca|s1-s2…>_<8 hex>.json`, and "Sao chép gói + prompt" copies the chat bundle (section 3.11).
- `pack_id` needs Web Crypto's SHA-256, which a browser offers only to a page opened over https or on the same computer (`localhost`); anywhere else the tab says so instead of showing the form.
- Up to five packs stay on the device, 14 days at most, as `fnb.pack.<pack_id>` in `localStorage`, and sign-out removes them.

On the local stack the pack built in the browser and a pack built in Node with `buildDataPack` for the same login were identical apart from `generated_at`, with the same `pack_id` (`apps/web/e2e/live/datapack.spec.ts`). Since `8c1b490` the same spec also builds the request with `fnb datapack` as a child process and requires `--check --against` to report the two identical apart from `generated_at`; it needs `DATABASE_URL`, which CI's `e2e` job sets (#144).

## 8. Building and checking a pack from the command line

`fnb datapack` (`apps/jobs/src/commands/datapack.ts`, #137) builds the browser's pack on the owner's machine:

```sh
pnpm --filter @fnb/jobs fnb -- datapack --tenant <slug> [--store <S1|store id>]... [--member <login e-mail>] [--as-of YYYY-MM-DD] [--horizon 30d|90d|180d|12m] [--language vi|en] [--focus <text>] [--note-file <path>] [--out <file>] [--bundle <file>] [--json]
pnpm --filter @fnb/jobs fnb -- datapack --check <file> [--against <file>] [--json]
pnpm --filter @fnb/jobs fnb -- datapack --tenant <slug> --list-stores [--member <login e-mail>]
```

- **As a member.** The command connects with the database URL (`DATABASE_URL` locally, `SUPABASE_DB_URL` first in CI) and needs no POS credential and no secret key. It builds as `--member`, a login of the tenant with the owner, manager, staff or viewer role, or else as the tenant's first owner whose scope covers every store; a publisher and a login that is not a member are refused. Without `--store` the pack covers every active store the member sees; `--store` takes a label (`S1`) or a store id, up to ten. The defaults are Vietnamese, `90d` and the last complete day; `--note-file` reads the owner note from a file.
- **One read-only snapshot.** `withReportSnapshot(sql, memberUserId, run)` (`apps/jobs/src/datapack/snapshot.ts`) opens one transaction `isolation level repeatable read read only`, sets `role authenticated`, the time zone `UTC` and the member's claims ([api.md](api.md#calling-a-function-as-a-member-from-a-server)), and runs the builder on `createRpcReportSource(createJsonRpcClient(transaction), "postgres")`, one call at a time. Row-level security applies exactly as in the browser and the service role is never used; nothing can change during the read, so no fence is needed.
- **Private files only.** A relative path starts from the folder where the command was typed (`INIT_CWD`, which pnpm sets, else the working directory). The default file is `docs/private/strategy/packs/<as_of>_<tat-ca|s1-s2…>_<8 hex>.json` under the repository root, with its folders created; `--out` names another file, and `--bundle` writes the chat bundle too. A file may go anywhere outside the repository, or below the root's `docs/private/` when `git check-ignore` confirms that git ignores it. Real paths are resolved first, so a symbolic link from `docs/private/` into a tracked folder is refused; so are a `docs/private/` folder elsewhere (git ignores none under `apps/jobs`, for example), any other folder of the repository, and any path when git cannot answer. The pack holds the shop's real figures, so it lands only where a commit cannot pick it up.
- **Output.** The command reads the written file back, then prints where it wrote (a path from the repository root), `valid`, `aggregates_only`, the `pack_id`, the as-of day, the horizon, the language, the store labels, the member, the estimate and the trimming steps; `--json` prints them as one JSON object. With `CI` or `GITHUB_ACTIONS` set, the output names no tenant, store name, member, e-mail, path or amount: stores by label, files by base name, the member by role, the `pack_id` as its first eight characters, and `--list-stores`, which prints store names and ids, is refused.
- **Checking files.** `--check <file>` opens no connection and needs no variable: it prints `valid`, `aggregates_only`, the `pack_id`, the estimate and each issue of `parsePack`. With `--against <file>` it compares two packs (`comparePackTexts`, section 2.7) and prints `valid`, `identical_apart_from_generated_at`, `pack_id_equal` and `tables_differing`.

| Exit code | Meaning |
|---|---|
| 0 | success; with `--against`, two valid packs identical apart from `generated_at` |
| 1 | failure, such as a publisher or a login that is not a member, an unknown tenant or a database error; with `--against`, two valid packs that differ |
| 2 | usage: a wrong flag, a refused path, `--list-stores` in CI, or a request the builder refuses (the stores, a later as-of day, contact details in the focus or note, a text too long) |
| 4 | the pack is invalid, over budget or not aggregate-only |

On the seed tenant the command's pack equalled the browser path's for two requests, apart from `generated_at`; on the real tenant one pack was built, valid and aggregate-only, and deleted.

## 9. Tests

```sh
pnpm --filter @fnb/datapack test
pnpm --filter @fnb/datapack schemas
pnpm --filter @fnb/datapack golden
pnpm --filter @fnb/datapack fixtures
pnpm --filter @fnb/jobs exec vitest run test/unit/datapack.test.ts test/unit/datapack-files.test.ts
pnpm --filter @fnb/web exec vitest run src/pages/exports/pack-tab.test.tsx src/datapack
```

At `70e5c86`, 539 tests in 44 files pass and 1 is skipped with `CI=1`: the scan against the private identifier list, which needs `docs/private/`. The tests of the pack's content build packs from the demo engine (`@fnb/demo-analytics`, a development dependency) through `buildDataPack` with prompt 1.0.0, so they need no database.

| Test | Proves |
|---|---|
| `test/pack/request.test.ts` | 1 to 10 distinct stores of one tenant, UUIDs in a live pack and `MOCK-S<n>` in a sample, a sample exactly from the demo source, unknown horizons, languages and dates refused, labels and currency from SQL, the default as-of day as the earliest complete business day over the stores, an earlier as-of day allowed and a later one refused, the typed texts composed, collapsed, trimmed and counted, e-mail addresses and phone numbers refused |
| `test/pack/calendar.test.ts` | every window of an as-of day, `w28`, `p28` and `ly28` of 28 days with `ly28` on the same weekdays, the band windows with `b4` equal to `p28`, a leap day, a month that the as-of day ends, the weeks ending on a Sunday as-of day or the Sunday before, 2026's week 53, the horizon, a date that does not exist and an unknown horizon refused |
| `test/pack/calls.test.ts` | store profiles first, then the pack-wide calls, then each scope's; one scope for one store; every call within its contract for one, two and ten stores; `metric_windows` with the 18 trackable ids over the eleven windows; the concurrency limit |
| `test/pack/coverage.test.ts`, `kpi-ids.test.ts` | the coverage rule with a store opened during `p28` and one open less than 28 days; the trackable ids, the `kpi` rows and the trackable `metrics` rows, superseded ids and `void_rate` only as context |
| `test/pack/tables/provenance.test.ts`, `order.test.ts`, `labels.test.ts`, `empty.test.ts` | every numeric cell from a recorded source value, the KPI cells exact and the others rounded to their unit, a store-day without a matched check in `stores`; the same rank keys and bytes from shuffled source rows, ranks from `r01` without a gap; labels from SQL as the only store names in the tables; every table built and valid without sales |
| `test/pack/tables/items.test.ts`, `hours.test.ts`, `shifts.test.ts`, `holidays.test.ts` | the items kept and their ties, categories over every item, sizes of sized items only; hour columns from a 05:00 day start and 0 for an hour without sales; the shift bands, the night band across midnight, instants with `Z`, an offset or microseconds read alike, no shift or cashier name; one row per holiday date over the horizon |
| `test/pack/gaps.test.ts`, `context.test.ts` | each gap code with its severity and setting, present exactly when its condition holds; the rules in force on the as-of day, the 120-day limit not sent after its reported repeal, every rule sentence in both languages, the benchmarks apart in registry order |
| `test/pack/build.test.ts` | `buildDataPack` carrying `strategyPrompt` in the pack's language and refusing a prompt in another language; packs valid for every horizon, in both languages, with and without a focus and an owner note; every call recorded, duplicates shared, progress up to the distinct calls, 4 calls at a time in the browser and 1 over Postgres; the fence read before and after, a rebuild when it moved and `pack_data_changed` after three attempts; a till text that looks like a phone number refused; a focus with an e-mail address refused before any read, a store the session cannot see after the store profiles alone, and a later as-of day refused |
| `test/pack/prompt.test.ts` | `fnb-strategy` 1.0.0 in each language, each text equal to its pinned SHA-256 and a changed text failing the pin; one fixed text per language (NFC, LF only, a title and a version line); the ten sections and seven fields in order; no tool, slash command, link, markup tag or tool-call syntax; the prompt's example citing cells a built pack holds and linting with no issue, and refused against other numbers; the scan of the prompts, the golden pack and the package's file names against the private identifier list, naming only file and line (skipped in CI) |
| `test/pack/bundle.test.ts`, `store-budget.test.ts` | the chat bundle starting with the prompt, one `json` fence with the pointer in the pack's language, the same `pack_id`, and the pack back byte for byte once the prompt is put back; one to three stores untrimmed and four after trimming, in both languages |
| `test/pack/golden.test.ts`, `transport-equivalence.test.ts`, `environment.test.ts` | the golden demo pack with prompt 1.0.0 byte for byte, valid, within the budget and aggregates only; the same bytes and `pack_id` from rows shaped as PostgREST and as `to_jsonb` return them, with store ids only in `request.stores`; the same bytes in child processes under three process time zones |
| `test/pack/canonical.test.ts`, `decimal.test.ts` | the golden canonical text, code-unit key order, byte-for-byte re-serialisation after a simulated jsonb round trip, refused values; decimals at scales 0 to 6, `-0`, 10¹⁴ đồng, `toPrecision` ties, no exponent; each unit's digits and rounding |
| `test/pack/hash.test.ts` | published SHA-256 digests, the pinned `pack_id` of the fixture pack, `pack_id` blind to `generated_at` and key order, the clock read once and only zoned instants on real dates, `sealPack` |
| `test/pack/schema.test.ts` | the committed JSON Schema files equal the generated ones; Ajv 2020 and zod agree on every pack and plan fixture, valid or not |
| `test/pack/invariants.test.ts`, `aggregates.test.ts`, `budget.test.ts` | every invariant, `parsePack` with a duplicate key and a `__proto__` row, `comparePackTexts`; each aggregates-only rule with a fixture that breaks it and identifiers that only look personal; the estimate and a ten-store pack trimmed in the declared order up to `pack_over_budget` |
| `test/pack/source-scan.test.ts`, `browser-safe.test.ts`, `public-api.test.ts` | no locale, clock, randomness or Node API where the browser and the command line would differ; the package's exports |
| `test/plan/normalize.test.ts`, `front-matter.test.ts`, `sections.test.ts` | Windows line ends, decomposed Unicode, fences, preambles and front matter in a code block; the front matter and its lines; the ten sections, the initiatives and their seven fields in both languages |
| `test/plan/numbers.test.ts`, `citations.test.ts`, `uncited-numbers.test.ts` | the number grammar in both languages, the citation rules, `money_thousands`, `S1` in a one-store pack, and what the uncited-number warning counts and ignores |
| `test/plan/lint-codes.test.ts`, `lint-browser.test.ts` | one fixture per code under `test/fixtures/plans/lint/` (the oversized plan is built in the test), clean plans in Vietnamese and English with no issue at all, `section_missing:7` and `kpi_unknown:net_sales`, the recorded results, the same results under jsdom |
| `test/plan/plan-record.test.ts` | scopes mapped to store ids, the baseline copied exactly, the due date, the refused sample pack |
| `test/plan/source-scan.test.ts` | no locale, clock, randomness, browser global or Unicode normalisation outside `normalize.ts` in `src/plan` |
| `test/plan/sample-plan.test.ts` | every KPI id the sample plan may choose is trackable; the targets and their rounding; `samplePlan` of demo packs on 30 days in a row, in both languages and for one store, linting with no issue; Evidence citing detail cells and sections 1 and 2 citing `kpi` cells; the fallbacks |
| `test/plan/fixtures.test.ts` | the mini pack valid, aggregate-only and live-shaped; `prompt-example.md` with no issue; `missing-section.md` and `unknown-kpi.md` giving exactly their codes; every fixture equal to what `pnpm --filter @fnb/datapack fixtures` writes |
| `apps/jobs/test/unit/datapack.test.ts` | the flags and their refusals, the member rules, numbered and masked output under `CI`, `--list-stores` refused in CI, the usage, failure and invalid-pack exit codes, `--check` and `--against` (#137) |
| `apps/jobs/test/unit/datapack-files.test.ts` | relative paths from `INIT_CWD` and without it, the default paths, a path outside the repository allowed, `docs/private/` allowed only where git ignores it, a `docs/private/` folder under `apps/jobs`, a tracked folder and a symbolic link into one refused, and a machine without `git` (#137) |
| `apps/web/src/pages/exports/pack-tab.test.tsx`, `apps/web/src/datapack/browser-pack.test.ts` | the form, the build, the summary and each error code with its retry; the copy and its manual dialog; the device cache's five packs, 14 days and sign-out; the remembered owner note; role gating; the browser's build equal to the package's byte for byte, the gaps high first, the fence read before and after the calls, `pack_data_changed`, stopping, and the file names (#142) |

The pack tab's end-to-end specs are `apps/web/e2e/demo/datapack.spec.ts` (the demo's sample pack downloaded and parsed, the copied bundle, the manual-copy dialog with the clipboard permission denied, English, axe at 360 and 1280 px) and `apps/web/e2e/live/datapack.spec.ts` (section 7).

Every fixture is synthetic: the lint pack's stores have made-up UUIDs, the mini pack uses the seed's synthetic ids, the sample pack uses `MOCK-S<n>`, and the items and figures are invented.

## 10. Publishing a plan and what the database refuses (phase 11b)

A plan is stored only through `publish_strategy_plan` ([api.md](api.md#publicpublish_strategy_plan), [schema.md](schema.md#strategy-plans-phase-11)). Two callers reach it, both with `planRecord(plan, pack, lint, via)` as arguments, and both lint first:

- **The paste box** (`#/ke-hoach/dan`): "Lưu kế hoạch" turns active only when the lint finds no error, for an owner or a manager; it publishes as `pasted` and opens the saved plan, or the stored one with "Kế hoạch này đã được lưu" when the same text was saved before. A plan written from a sample pack is never sent; in the demo it is kept in `sessionStorage` instead.
- **`fnb publish-plan`** without `--check`: lints (exit 3 on errors), refuses a sample pack (exit 4, `sample_pack_not_publishable`) before any sign-in, then signs in as the publisher member with `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `FNB_PUBLISHER_EMAIL` and `FNB_PUBLISHER_PASSWORD` only, session persistence and token refresh off. A login that can read even one `tenant_members` row is a data member and is stopped (exit 1). It publishes with `--via skill` (default) or `--via routine`, signs out and prints the plan id prefix, the store count, the horizon and the counts of initiatives, citations and KPIs.

| Database answer | Paste box | Command line |
|---|---|---|
| saved | opens the plan, "Đã lưu kế hoạch." | exit 0, `published` |
| the same text again | opens the stored plan, "Kế hoạch này đã được lưu." | exit 0, `already published` |
| `22023 plan_rejected`, codes in `details` | "Cơ sở dữ liệu từ chối kế hoạch. Mã: …" | exit 3, one `rejected:` line per code |
| `plan_rate_limited` (over 20 plans of the tenant in 24 hours) | "Đã lưu quá 20 kế hoạch trong 24 giờ." | exit 3 |
| `42501 plan_scope_denied` | "Bạn không có quyền lưu kế hoạch cho mọi cửa hàng…" | exit 1, `scope denied` |
| network or server failure | "Không lưu được kế hoạch." | exit 1 |

The database checks the structure again with its own validators: the text must already be normalised, start with its front matter, hold the ten sections once each and in order and five to seven initiatives; each KPI must be one of the 18 trackable ids, a complete entry over the plan's stores with a target different from its baseline; the front matter must agree with the arguments, and the pack with the plan (its id, not a sample, the stores, the as-of day, the horizon, the prompt version and each KPI's baseline equal to its `w28` cell). A plan missing section 7 is refused with `section_missing:7` and a KPI renamed `net_sales` with `kpi_unknown:net_sales` in the command line, in the paste box and in the database; no row is written. For the codes both sides check (`front_matter_missing`, `section_missing`, `initiatives_count`, `kpis_count`, `kpi_unknown`, with `kpi_untracked` reported as `kpi_unknown`), the lint and the SQL validators give the same codes (integration scenario 4). A stored plan never changes apart from its title and `archived_at`.

## 11. KPI follow-up and the statuses

Each KPI of a plan is measured with `metric_windows` over the plan's KPI stores: range 1 is the 28 days ending on today's as-of day `N` (the earliest last complete business day over the plan's stores), range 2 the 28 days ending on the plan's as-of day `A`, which re-measures the stored baseline. One call is made per store set. When the re-measured baseline differs from the stored one (by more than a relative 10⁻⁹), Kế hoạch shows both with "≠": the data of those days changed after the plan, for example after a re-sync.

`kpiStatus({ baseline, target, current, elapsedDays, horizonDays, band })` (`packages/datapack/src/plan/status.ts`) gives the status by these rules, applied in order; `progress` is `(current − baseline) / (target − baseline)`, so it works for both directions:

| # | Rule | Status | Vietnamese |
|---:|---|---|---|
| 1 | no current value | `no_data` | Chưa có số liệu |
| 2 | fewer than 14 days since the plan's as-of day | `too_early` | Còn quá sớm |
| 3 | progress at least 1 (the target reached in its direction) | `achieved` | Đã đạt |
| 4 | the horizon has run its full length (elapsed days at least the horizon's days) | `missed` | Không đạt |
| 5 | progress below 0 | `off_course` | Đi ngược hướng |
| 6 | progress at least min(elapsed / horizon, 1) − 0.25 | `on_track` | Đúng tiến độ |
| 7 | otherwise | `behind` | Chậm tiến độ |

`withinBand` is true when the current value lies inside the KPI's normal range (`lo` to `hi` of the pack); Kế hoạch then adds "trong dao động thường", and the flag never changes the status. The list's summary "x/y KPI đúng tiến độ" counts `on_track` and `achieved`. `comparePlans(left, right, live)` (`compare.ts`) puts two plans side by side: a header per plan, every KPI of either plan keyed by metric id and its sorted store ids (a KPI whose scope changed is one dropped and one added), each side's baseline, target, due date and status against the same live value, and the initiative titles compared after NFC, lower case and collapsed spaces, labelled kept, new or removed. The decision table is `test/plan/status.test.ts`, the comparison `test/plan/compare.test.ts`.

## 12. Kế hoạch in the web app

- `#/ke-hoach` lists the plans newest first by `created_at` then `id`, 50 at a time with keyset paging, reading the list columns only (never the text or the pack), grouped by store set with "Bản n", the dates, the horizon, the source badge ("Máy tính", "Lịch", "Dán"), the KPI count and the citation count; only the newest unarchived plan of each set measures its KPIs. Archived plans appear after "Hiện kế hoạch đã lưu trữ".
- `#/ke-hoach/:id` shows the header with the store labels from the pack, the prompt version and the pack id prefix, the badge "Mã gói khớp" or "Mã gói không khớp" (the stored pack re-canonicalised against its `pack_id`; consistency only), the KPI table (cards at 360 px) and the plan text. The text is rendered by `react-markdown` 10.1.0 with `remark-gfm` 4.0.1 on this route only, with raw HTML skipped and only `h2 h3 h4 p ul ol li strong em table thead tbody tr th td blockquote code pre hr br cite` allowed, anything else unwrapped to its text; each `[[table:row:column]]` becomes a chip holding the cell's value from the stored pack, outlined in red when it points nowhere, and every display re-runs the lint against the stored pack. Owners and managers whose scope covers the plan's stores rename, archive and delete it.
- `#/ke-hoach/so-sanh?a=<id>&b=<id>` compares two plans; the picker offers the plans of the same store set and defaults to the previous one.
- The demo lists an automatically generated sample plan over all demo stores and 90 days, measured through the demo `metric_windows` port, and keeps pasted plans in `sessionStorage`; no request leaves the origin.

## 13. Three ways to run the strategy, and the monthly run

All three share one pack and one prompt (section 3.10), and every plan is checked by the same lint before it is stored.

1. **A chat on any device.** Build the pack on "Gói dữ liệu cho AI", copy the bundle into a chat with any assistant, paste the answer into "Dán kế hoạch", fix what the lint lists and save.
2. **A personal command on the owner's computer.** A command in the owner's own assistant, kept in the owner's personal configuration and never in this repository, started from the repository root so that the command line and the assistant resolve paths alike: it builds the pack with `fnb datapack` into `docs/private/strategy/`, gives the bundle to the assistant, repeats `fnb publish-plan --check` until the plan is clean, then runs `fnb publish-plan` as the publisher (`--via skill`, badge "Máy tính").
3. **A monthly scheduled run** (`--via routine`, badge "Lịch"). Until `fnb strategy-run` (#198) exists, a wrapper script kept outside the repository does the same steps with the same rules: build the pack, run the assistant's non-interactive mode on the bundle in a throw-away folder under the system temporary directory, with assistant tools off and an environment stripped to `PATH`, `HOME`, `USER`, `LANG` and `TZ` (never a database URL, an API key, POS credentials or the publisher's password), check the answer, and publish only a clean plan. Routine plans go live unread, which is why they carry their own badge.

**Scheduling.** On macOS, a per-user `launchd` job (`~/Library/LaunchAgents`, loaded with `launchctl bootstrap gui/$(id -u) <plist>`) with `StartCalendarInterval` day 1, 07:30; a run missed while the Mac sleeps happens once on wake. Elsewhere, a cron line such as `30 7 1 * *`. Either way the job starts the wrapper from the repository root.

**Where files may go.** Packs, plans and logs hold the shop's real figures: they are written below the root's `docs/private/` (ignored by git, checked with `git check-ignore`) or outside the repository, never anywhere else (section 8).

**Troubleshooting.**

| Symptom | Cause and fix |
|---|---|
| `publish-plan` exits 1, "publisher login was refused" | wrong `FNB_PUBLISHER_EMAIL` or `FNB_PUBLISHER_PASSWORD`, or the login was never created (#199) |
| exits 1, "data member" | the variables hold an owner, manager, staff or viewer login; create a separate publisher login |
| exits 3 with `rejected:` codes | the database refused the plan; fix the codes (section 10) and publish again |
| exits 4, `sample_pack_not_publishable` | the plan was written from the demo's sample pack; build a pack from real data |
| Kế hoạch shows "≠" beside a baseline | the days behind the baseline changed after the plan (a re-sync); the plan stays as written |

The scheduled route's dry run on the real tenant, the owner's two runs and the decision on the monthly routine are owner steps (#199, #201, #202).

## Read more

- [architecture.md, 6.5](architecture.md#65-data-pack-and-plan-publishing-phase-11): the data pack and plan publishing flow.
- [exports.md](exports.md): the row-level exports of the same page, which are not part of the pack.
- [decisions.md, ADR-003](decisions.md#adr-003--no-paid-ai-api-the-strategy-runs-under-the-owners-own-assistant-subscription) and [ADR-013](decisions.md#adr-013--least-privilege-identities-for-the-strategy-path): why the pack exists and who may publish a plan.
- [security.md, 8.6](security.md#86-personal-data-minimisation-in-practice): personal-data minimisation.
- [metrics.md](metrics.md): the metric ids that KPIs use.
