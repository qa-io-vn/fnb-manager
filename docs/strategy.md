# Data pack and plan format

Purpose and audience: the formats of phase 11's strategy path. The AI data pack is one aggregate-only, versioned JSON document that the owner hands to their own assistant (ADR-003); the plan is the Markdown the assistant writes back, checked against that exact pack before it can be stored. This page states the pack format (canonical text, `pack_id`, units and digits, the aggregates-only rules, the budget and its trimming ladder, the JSON Schema files) and the plan format `fnb-plan/1` with its lint (sections, initiative fields, citations, the number grammar and every lint code). It is for developers of the pack, the prompt, the command line and the paste box, for reviewers who check that nothing row-level or personal leaves in a pack, and for testers. The code is `packages/datapack` ([README](../packages/datapack/README.md)); where this page and the code differ, the code wins. Requirements: FR-EXP-04, FR-EXP-05, FR-EXP-06, FR-EXP-08, FR-STR-01, FR-STR-04, FR-STR-05.

Last updated 2026-11-18

## 1. Where the formats fit

By design, the owner, or a manager, builds a pack in the browser ("Tải gói dữ liệu cho AI", "Sao chép gói + prompt") or with `fnb datapack`, always as a data role, never as the publisher, which reads no aggregate (FR-EXP-09). Both use the same code of `@fnb/datapack`, so the same data gives the same bytes. The assistant answers with a plan whose front matter names the pack's `pack_id`; the "Dán kế hoạch" box and `fnb publish-plan` are to run the same lint against that pack, and only a plan without errors becomes the arguments of `publish_strategy_plan` ([architecture.md, 6.5](architecture.md#65-data-pack-and-plan-publishing-phase-11)).

| Part | Code | State on 2026-11-18 |
|---|---|---|
| The pack format: canonical text, `pack_id`, units, the schema and its JSON Schema files, validation, the aggregates-only check, the estimate and the budget | `src/pack/` | built (#130) |
| The pack's content: the report calls, the tables, the calendar windows, gaps and context (`buildDataPack`, `packCalls`, `calendarOf`) | `src/pack/build.ts`, `calls.ts`, `calendar.ts` | in build (#134) |
| The strategy prompt and the chat bundle (`strategyPrompt`, `chatBundle`) | `src/prompt/`, `src/pack/bundle.ts` | planned (#131) |
| The plan format and its lint (`normalizePlanText`, `parsePlan`, `lintPlan`, `planRecord`) | `src/plan/` | built (#135) |
| `fnb datapack`, `fnb publish-plan --check`, the pack buttons, the paste box, the byte identity of browser and command-line packs in CI | `apps/jobs`, `apps/web` | planned (#137, #138, #142, #143, #144) |
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
- `generated_at` is the only value read from the clock, and the clock is injected (`PackClock`): it is written in UTC to the second, with the milliseconds cut. `fixedClock` takes only an ISO instant with `Z` or an offset (`2026-11-12T10:00:00+07:00`) on a date that exists, so no process time zone can enter.
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

Nothing in the format reads the environment. Source-scan tests refuse `Intl.`, `toLocale`, `localeCompare`, `Math.random` and `Date.now` everywhere in `src/pack` and `src/plan`. In `src/pack` they also refuse `new Date(` outside `clock.ts`, `JSON.stringify` outside `canonical.ts` and `.normalize(` outside `request-text.ts`, the request normaliser of #134. In `src/plan` they also refuse `new Date(`, `JSON.stringify` and the browser globals everywhere, and `.normalize(` outside `normalize.ts`. A further test imports both entry points under jsdom and refuses any Node API or database driver under `src`, and the package is marked `sideEffects: false`.

## 3. The plan format `fnb-plan/1`

### 3.1 Normalisation

`normalizePlanText` turns whatever was pasted or written into the one text that is linted, hashed, published and stored, and is idempotent:

1. removes a leading byte order mark, converts CRLF and CR to LF and composes the text to Unicode NFC;
2. strips trailing spaces and tabs from every line;
3. removes a single code fence (plain, `markdown` or `md`) wrapped around the whole answer;
4. finds the front matter: a `---` block at the start, a later `---` block whose first non-blank line opens a JSON object, or a code block marked `fnb-plan` or `json` that contains `"format":"fnb-plan/1"`, which it converts into the `---` form;
5. discards anything before the front matter and reports it with the warning `preamble_text`; when a fence was opened just before the front matter and is closed after the plan, that fence is removed and a remark after it is kept;
6. removes surrounding blank lines and leaves exactly one final newline.

### 3.2 Front matter

The plan starts with a JSON object between two `---` lines (YAML is not read), checked by `planFrontMatterSchema`:

| Key | Rule | Lint code |
|---|---|---|
| `format` | `fnb-plan/1` | `front_matter_invalid` |
| `pack` | the `pack_id` of the pack the plan was written from | `front_matter_invalid` when malformed, `pack_mismatch` when another pack's |
| `title` | 1 to 120 characters | `front_matter_invalid` |
| `horizon` | `30d`, `90d`, `180d` or `12m`, the pack's horizon | `front_matter_invalid`, `horizon_mismatch` |
| `language` | `vi` or `en`: the grammar in which the body's numbers are read | `front_matter_invalid` |
| `kpis` | 1 to 8 entries, keyed by metric id (`^[a-z][a-z0-9_]{1,63}$`), each with `scope` (`ALL` or a store label, `ALL` when left out), `target` (a finite number), an optional `baseline` and `initiatives` (at least one initiative number from 1 to 7) | `front_matter_invalid`, `kpis_count`, the `kpi_*` codes of section 4 |

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

### 3.3 The ten sections

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

### 3.4 Initiatives and their seven fields

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

### 3.5 Citations

A citation is `[[table:row:column]]`: a table id of the pack, a row key and a column name, separated by colons, spaces around them ignored. It cites one cell. The written number it vouches for is the number right before it on the same line, with at most three other words in between; looking back stops at another citation, and nothing after the reference or on another line counts. Dates, store labels and window names are words, not numbers, when looking back.

```
The average ticket is 52,314 VND [[kpi:ALL/avg_ticket:w28]] over 23,600 invoices [[kpi:ALL/invoices:w28]].
```

- `context` is never a table: a citation of it, of an unknown table, row or column, or a malformed reference is `citation_unknown:<ref>`.
- In a pack of one store, the row key `S1`, or one that starts with `S1/`, resolves to the matching `ALL` row.
- A written number that the cited numeric cell does not hold (section 3.6), or a number written for an empty cell, is `citation_mismatch:<ref>`, with the written number as the detail.
- A citation of a text, date or class cell, or one without a number before it, is valid but proves no number.
- An initiative is cited only when one of its lines holds a valid citation of a numeric cell whose written number matches it; otherwise `initiative_uncited:<n>`. A citation that the written number contradicts does not count.

The pack's `kpi` table is read by row `<scope>/<metric id>`: the column `w28` is the KPI's baseline, and `lo` and `hi` its band.

### 3.6 The number grammar

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

### 3.7 Numbers without a citation

In sections 1 and 2 and in each initiative's Evidence field, every number must be cited, equal a KPI target of the front matter, or come after "ước tính" or "estimate" on its line (the assistant's own arithmetic). Otherwise it is counted in the warning `uncited_numbers:<k>`, whose detail lists each one as `<line>:<text>`. Never counted, wherever they stand: dates (`2026-11-12`, `12/11/2026`, `2026-11`, `2026-W45`), years from 1900 to 2099, times (`9:30`, `9h`, `9h30`, `9 am`), hour ranges with an hour mark (`7–9h`, `17:00–19:00`), fractions such as `30/60/90`, the number after `tháng`, `tuần`, `ngày`, `thứ`, `quý`, `month`, `week`, `day`, `quarter`, `sáng kiến`, `initiative`, `mục` or `section`, list numbering at the start of a line, store labels and headings. The other sections and the other initiative fields are not scanned. Like every warning, it does not make the lint's `ok` false.

## 4. The lint

`lintPlan(text, pack)` never throws. It normalises the text (section 3.1) and returns `ok` (true when no issue is an error), `normalized` (the text to store), `issues`, the parsed plan (null while the front matter is missing or invalid) and a summary (initiatives, cited initiatives, citations, valid citations, KPIs, uncited numbers, words). Each issue has a `code`, its `level`, a `line` (1-based, in the normalised text; null when the issue has no single line) and a `detail`, which is data such as a path, a value or a list, never a sentence. A code carries its parameter after the first colon (`kpi_unknown:net_sales`); the screens and the command line turn codes into messages. Issues come errors first, then by line, then in the order found, and an exact repeat is dropped. Warnings do not make `ok` false.

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
| `kpi_baseline_mismatch:<id>` | error | a written `baseline` does not match `w28` (section 3.6); the detail is the pack's value |
| `kpi_target_unchanged:<id>` | error | the target equals the baseline |
| `kpi_initiative_unknown:<id>` | error | the KPI names an initiative the plan does not have |
| `kpi_initiative_unlinked:<id>` | warning | a linked initiative's KPI field does not mention the id |
| `uncited_numbers:<k>` | warning | `k` numbers of section 3.7 have no citation; only when `k` is above 0 |

The KPI checks run only on valid front matter, and `kpi_unknown` and `kpi_untracked` stop the other checks of that KPI. The lint gives the same results in Node and under jsdom, recorded for every fixture in `test/fixtures/plans/lint/results.json`.

`planRecord(plan, pack, lint, via)` turns a plan that passed the lint into the arguments of `publish_strategy_plan`: the pack's store ids; the title, horizon and language; the normalised text; per KPI its scope, the store ids of that scope, the baseline copied exactly from `w28` whatever the front matter wrote, the target, `lo` and `hi` from the pack (null when missing), its initiatives, `due_on` at the end of the pack's horizon and `window_days` 28; the as-of date, `pack_id`, prompt version and the pack itself; the lint summary with its warning codes; and how the plan came (`skill`, `routine` or `pasted`). It refuses a sample pack (`sample_pack_not_publishable`), a plan written from another pack (`pack_id_mismatch`) and a KPI without a store or a baseline in the pack (`front_matter_invalid`).

## 5. Tests

```sh
pnpm --filter @fnb/datapack test
pnpm --filter @fnb/datapack schemas
```

| Test | Proves |
|---|---|
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

Every fixture is synthetic: the lint pack's stores have made-up UUIDs, the sample pack uses `MOCK-S<n>`, and the items and figures are invented.

## Read more

- [architecture.md, 6.5](architecture.md#65-data-pack-and-plan-publishing-phase-11): the data pack and plan publishing flow.
- [exports.md](exports.md): the row-level exports of the same page, which are not part of the pack.
- [decisions.md, ADR-003](decisions.md#adr-003--no-paid-ai-api-the-strategy-runs-under-the-owners-own-assistant-subscription) and [ADR-013](decisions.md#adr-013--least-privilege-identities-for-the-strategy-path): why the pack exists and who may publish a plan.
- [security.md, 8.6](security.md#86-personal-data-minimisation-in-practice): personal-data minimisation.
- [metrics.md](metrics.md): the metric ids that KPIs use.
