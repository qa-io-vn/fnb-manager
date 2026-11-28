# Data exports

How the web app exports invoices, invoice lines, payments, shifts and the daily summary on `#/xuat-du-lieu?tab=xuat` (phase 11a), and how every exported file is proven equal to the database. The code lives in `apps/web/src/exports/` (the engine) and `apps/web/src/pages/exports/` (the screen). Requirements: FR-EXP-01, FR-EXP-02, FR-REP-12, NFR-COST-06, NFR-PRV-06, NFR-I18N-05.

## Who may export

- Owners and managers get the form. Staff, viewers and a login with no membership read "Chỉ chủ quán và quản lý xuất được dữ liệu"; a publisher login gets nothing below the page heading. The role and the store scope come from the settings source's `membership(tenantId)`, the same query the settings pages use; no second membership query exists.
- This is a deliberate-use gate, not a security boundary. Every read runs as the signed-in member through row-level security, so a member can never export a row they could not already read.
- The demo has no real invoices; its tab says "Bản demo không có dữ liệu hóa đơn thật để xuất" and links to the pack tab, which in the demo builds a sample pack from the demo engine ([strategy.md, section 7](strategy.md#7-building-a-pack-in-the-browser)).

## What the form asks

| Field | Default | Rule |
|---|---|---|
| Cửa hàng | the stores chosen in the top bar | at least one |
| Từ tháng, Đến tháng | the last complete month | months from the earliest history start of the chosen stores (`store_coverage.history_start`) to the as-of month; at most 12 months ("Tối đa 12 tháng mỗi lần xuất") |
| Bảng dữ liệu | all five | at least one |
| Định dạng tệp | CSV in this device's format | CSV, named with its format and a link to Cài đặt › Ngưỡng báo cáo, or JSON |
| Kèm thông tin cá nhân | off | shown only to an owner or manager whose scope covers every store; never remembered, and switched off again after each export |

"Ước tính" asks the database for each store-month's counts and shows the estimated transfer. "Xuất dữ liệu" estimates first when needed, asks "Lần xuất này ước tính hơn 100 MB. Vẫn xuất?" above 100 MB, then exports with a progress line per store-month and table ("Tháng 10/2026 · S1 · Dòng hóa đơn 6.000/8.914") and a "Dừng" button that aborts every request.

## Months and the running month

A store-month covers the business dates of one calendar month for one store. For the running month it ends at that store's as-of day (the store's business date of now, minus one, as on every report) and is marked `running` in the manifest. A store whose as-of day is before the month starts has no store-month there. Months are cut by business date, so a sale after midnight but before the store's day start belongs to the day before.

## Files and columns

Every file holds the database's own ASCII column names, so scripts can rely on them. Values are what PostgREST returns, plus a few columns the exporter adds: the store's name, and local times written `YYYY-MM-DD HH:MM:SS` in the store's time zone (through `@fnb/core`'s `wallClockIn`), which Excel reads as a date and time. `raw` and `synced_at` are never exported (`raw` is empty on these rows, and `synced_at` changes on every re-sync).

| File | Rows | Columns (personal columns marked †, left out unless ticked) |
|---|---|---|
| `hoa-don` | invoices with `business_date` in the month, every status | `store_name`, `id`, `external_id`, `receipt_no`, `business_date`, `sold_at`, `sold_at_local`, `opened_at`, `closed_at`, `status`, `table_name`, `area_name`, `sale_type`, `source_name`, `shift_external_id`, `device_code`, `guest_count`, `gross_amount`, `item_discount_amount`, `bill_discount_amount`, `extra_discount_amount`, `bill_discount_name`, `voucher_name`, `voucher_amount`, `partner_marketing_amount`, `service_charge_amount`, `shipping_fee_amount`, `vat_amount`, `net_amount`, `paid_amount`, `primary_payment_method_name`; † `customer_phone`, `customer_name`, `employee_name`, `voucher_code` |
| `dong-hoa-don` | every line of those invoices | `store_name`, `invoice_id`, `invoice_external_id`, `business_date` (the invoice's), `external_id`, `parent_line_external_id`, `line_kind`, `item_external_id`, `item_name`, `base_name`, `size_label`, `item_type_name`, `item_class_name`, `unit_name`, `package_external_id`, `quantity`, `list_unit_price`, `unit_price`, `gross_amount`, `discount_amount`, `net_amount`, `promotion_name`; † `note` |
| `thanh-toan` | tenders with their own `business_date` in the month | `store_name`, `invoice_id`, `invoice_external_id`, `business_date`, `sequence_no`, `payment_method_external_id`, `payment_method_name`, `amount`, `fee_amount`; † `reference_no`, `partner_transaction_id` |
| `ca` | shifts whose business date (the date of `opened_at` in the store's zone, after the business-day start) is in the month | `store_name`, `id`, `external_id`, † `name`, `business_date`, `opened_at`, `opened_at_local`, `closed_at`, `closed_at_local`, `orders_count`, `sales_amount`, `opening_float_amount`, `expected_cash_amount`, `cash_drawer_amount`, `cash_variance_amount`, `changed_after_close`, `status`, `device_code`; † `cashier_name` |
| `tong-hop-ngay` | `period_series(stores, 'day', month start, month end or as-of, include_stores => true)`: one row per day for all chosen stores (`ALL`) and per store | `business_date`, `scope` (`ALL` or the store's label), `store_name` (empty on `ALL`), every column of `app.period_totals()` in its order, `holiday_kind`, `checked_days`, `matched_days` |

When (stores + 1) × days would pass the report functions' 900-row limit, the daily summary is asked store by store, without the `ALL` rows. It uses the report function on purpose: its numbers are the reports' numbers.

### Personal columns

Customer phone and name, employee and cashier names, voucher codes, line notes and payment references are personal. So is the shift `name`: on real data the till can put a cashier's login e-mail there. These columns are not even requested from the database unless "Kèm thông tin cá nhân" is ticked for that export, and the box is only offered to an owner or a manager with every store in scope. The manifest records `personal_columns`, and `doc-truoc.txt` says whether the files hold personal data.

## Formats

- **CSV** goes through the app's one CSV writer, `buildCsv(columns, rows, dialect)` in `apps/web/src/lib/csv.ts`: UTF-8 with a byte order mark (`EF BB BF`), CRLF line ends, RFC 4180 quoting, a `'` before a cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return, numbers without grouping, `true` and `false`, and an empty field for null. The format is this device's choice in Cài đặt › Ngưỡng báo cáo: `comma` (dot decimals, the default) or `semicolon` (decimal comma, for Excel set to Vietnamese). There is never a `sep=` line.
- **JSON** files are UTF-8 without a byte order mark (RFC 8259): `{"format":"fnb-export","version":1,"table":"invoices","store":"S1","month":"2026-10","columns":[…],"rows":[{…}]}`. The daily summary has `"store":null`. Identifiers stay exact strings.

## The archive

One export is one ZIP named `fnb-xuat-du-lieu_<first month>_<last month>.zip`, written with fflate's streaming `Zip` and `ZipDeflate` (level 6), loaded only when an export starts. The entries come in a fixed order, every one stamped 1980-01-01 00:00 built from local date components, so the same rows give the same archive bytes in any time zone. Paths are printable ASCII:

```
manifest.json
doc-truoc.txt
2026-10/tong-hop-ngay.csv
2026-10/S1/hoa-don.csv
2026-10/S1/dong-hoa-don.csv
2026-10/S1/thanh-toan.csv
2026-10/S1/ca.csv
2026-10/S2/…
2026-11/…
```

`S1`, `S2`… are the stores' stable labels from `store_profiles` (the position among the tenant's stores ordered by first appearance), the same labels the AI data pack uses; the labels and the history start are asked at most 50 stores at a time. The manifest and the guide come first in the archive but are written last; the files are compressed as soon as each store-month is verified.

### manifest.json

| Field | Meaning |
|---|---|
| `format`, `version` | `fnb-export-manifest`, 1 |
| `generated_at` | when the archive was written, UTC to the second |
| `file_format`, `dialect`, `personal_columns` | the choices of the form (`dialect` is null for JSON) |
| `first_month`, `last_month` | the range |
| `stores[]` | `label`, `id`, `name`, `time_zone` |
| `files[]` | `path`, `table`, `store` (label, null for the daily summary), `month`, `from`, `to`, `running`, `rows`, `bytes`, `sha256` of the file, `received_bytes`, `database_totals` and `exporter_totals` (`rows`, `voided` for invoices, `refunds` for invoices when there are refund documents, `amount`, `fingerprint`), `verified`, `reason` when not verified |
| `daily_summary_checks[]` | `month`, `store`, `matched` |
| `egress` | `received_bytes`, `estimated_bytes`, `uncompressed_upper_bound: true` |

### doc-truoc.txt

A Vietnamese guide (UTF-8 with a byte order mark, CRLF): what each column means, the CSV format used, how to open the files in Excel (below), one verification line per store-month and the transfer figure.

## Reading under the 1,000-row cap

Supabase answers at most 1,000 rows per request by default, and PostgREST's row limit may return fewer rows than asked. The exporter therefore reads each table of each store-month with a keyset on a key that a re-sync does not change, as the signed-in member, through supabase-js:

| Table | Filter | Order and keyset |
|---|---|---|
| invoices | `store_id`, `business_date` between the month's bounds | `business_date, id`; after (d, i): `or=(business_date.gt.d,and(business_date.eq.d,id.gt.i))` |
| invoice_lines | `store_id`, embedded `invoices!inner(external_id,business_date)` with the invoice's `business_date` between the bounds | `invoice_id, external_id`, the same composite keyset |
| invoice_payments | `store_id`, `business_date` between the bounds, embedded `invoices!inner(external_id)` | `invoice_id, sequence_no` |
| shifts | `store_id`, `opened_at` from the business-day start of the first day to before the business-day start of the day after the last | `id`; `id.gt.<last>` |

- The page size is a parameter, 1,000 by default. A run with 97-row pages gives the same files.
- Rows are de-duplicated by their key, so a sync committing between two pages neither drops nor doubles a row.
- **Stop rule.** A page shorter than asked ends the read only once the rows read reach the store-month's count from the database's control totals. Otherwise the reader keeps going until a page comes back empty. A server cap below the page size is therefore followed without truncating a file and costs no extra request in the normal case.
- At most two requests are in flight per export: the four tables of a store-month are read two at a time.

Every call stays inside the limits of the functions it calls (migration `pack_and_export_functions` and the phase 9 report functions):

| Call | Limit | How the exporter keeps to it |
|---|---|---|
| table reads | PostgREST `max_rows` 1,000 (`supabase/config.toml`) | pages of at most 1,000 rows and the stop rule above |
| `export_control_totals(store_ids, from_date, to_date)` | 50 stores, 92 days | one store and one store-month (at most 31 days) per call |
| `period_series(store_ids, 'day', from_date, to_date, include_stores)` | 50 stores, 900 rows | (stores + 1) × days at most 900, otherwise one call per store |
| `store_profiles(store_ids)`, `store_coverage(store_ids, from_date, to_date)` | 50 stores | at most 50 store ids per call |

## Proof that a month equals the tables

For every store-month the exporter:

1. calls `export_control_totals([store], first day, last day)` (call A): per table a count, a sum and a SHA-256 fingerprint computed in SQL;
2. reads the ticked tables as above;
3. computes the same figures from the rows it wrote: counts, sums (in exact minor units), and the SHA-256 (Web Crypto) of the same canonical lines in the same order:
   - invoices `id|status|net×100|gross×100|paid×100|business_date`, by `id`;
   - lines `invoice_id|external_id|line_kind|quantity×1000|net×100`, by `invoice_id`, then `external_id` in code-unit order;
   - payments `invoice_id|sequence_no|amount×100`, by `invoice_id`, `sequence_no`;
   - shifts `id|sales×100|variance×100`, by `id`, the variance empty when it is null;

   scaled values come from `roundHalfAwayFromZero` and BigInt digits, never from floating multiplication;
4. calls `export_control_totals` again (call B). A file is `verified` when its own figures equal call B's.
5. When they differ and call B differs from call A, a sync committed during the read: the store-month is read again, at most twice. If the data keeps moving, its files stay in the archive with `verified: false` and reason `changed`, and the screen says "Dữ liệu thay đổi trong lúc xuất; thử lại sau ít phút". When they differ while call A equals call B, the reason is `mismatch` and the screen asks to report it: that never happens on a healthy stack.

The daily summary is checked on its own: per store, its `net_amount` total over the store-month equals `sales_net_amount`, and its `invoices` total equals `invoices − voided_invoices − refund_invoices` (a refund handed back on a later business day than its order's is a negative document of status `refund`: in the net and the rows, never counted as an invoice; ADR-071). The screen then reads "Tổng hợp ngày khớp hóa đơn", or "Tổng hợp ngày chưa khớp, cần làm mới số liệu phân tích" when the aggregates lag the facts; the invoice files stay verified either way, and the daily file is marked `aggregates_lag`.

One fixture with fixed UUIDs and amounts, store T of `supabase/tests/41_export_totals.sql` (four invoices, six lines, four payments and three shifts over 1 to 3 July 2025), pins the fingerprints as the same literal hex in the database test and in Vitest (`apps/web/src/exports/totals.test.ts`, `src/exports/testing/synthetic-data.ts`): the four of 1 and 2 July and the payments of 1 July alone, so SQL and TypeScript cannot drift. The line `L10` sorts before `L2`, as `collate "C"` sorts it, and a payment dated after its invoice counts on its own day.

## Transfer (egress)

- **Estimated before starting**: call A's counts × bytes per row measured on the local stack (invoices 910, lines 585, payments 175, shifts 475, daily summary 820), shown as "Ước tính khoảng 33 MB dữ liệu truyền tải (gói Free: 5 GB mỗi tháng)". Above 100 MB the export asks for confirmation.
- **Measured**: the UTF-8 length of every response as received, re-encoded after supabase-js parses it, per file and in total: "Đã nhận … MB (chưa nén)". Supabase counts database egress as data sent to clients and does not say whether compressed or uncompressed bytes count, so the figure is an upper bound.
- **This device's monthly tally**: `localStorage` `fnb.export-bytes.<YYYY-MM>` adds each export's bytes, read and written inside `try`/`catch`; it is a convenience only and shows as "Đã xuất tháng này khoảng 0,2 GB".
- **Free-plan arithmetic**: a busy store-month of about 2,000 invoices, 5,000 lines, 2,000 payments and 90 shifts is 2,000 × 910 + 5,000 × 585 + 2,000 × 175 + 90 × 475 ≈ 5.1 MB, so a year of two such stores, daily summaries included, is about 125 MB: 2.5 % of the Free plan's 5 GB a month.

## Opening the files in Excel

- Double-click opens a CSV with its diacritics intact thanks to the byte order mark. If every field lands in one column, switch Cài đặt › Ngưỡng báo cáo to the semicolon format and export again.
- Excel turns a column of digits into numbers and drops leading zeros, both on double-click and in Data › From Text/CSV, whose automatic type detection reads the first 200 rows. Receipt numbers often start with 0, and receipt claims are keyed on them (ADR-024). To keep them:
  - in Data › From Text/CSV, choose Transform Data and set `receipt_no` and every `id`, `*external_id` and `*_code` column to Text before loading, or choose "Do not detect data types";
  - in Excel for 365 or Excel 2024, File › Options › Data › Automatic Data Conversion can switch off "Remove leading zeros…", which then also applies to double-click opening.
- A double-clicked file shows receipt numbers without their leading zeros; the JSON files keep every identifier exactly.

## Tests

| Test | Proves |
|---|---|
| `apps/web/src/exports/reader.test.ts` | a fake PostgREST capping pages at 1,000, 500 and 250 rows, rows added and removed between pages, a short final page, 97-row pages equal to 1,000-row pages, the query shapes, personal columns requested only when ticked, bytes measured, at most 50 stores per call (the fake refuses more, as it refuses more than 92 days of control totals and more than 900 daily-summary rows) |
| `apps/web/src/exports/totals.test.ts` | the fingerprints pinned by `41_export_totals`, exact scaling, when to re-read and when to give up, the daily-summary check |
| `apps/web/src/exports/plan.test.ts` | month splitting, the 12-month limit, the running month, file order |
| `apps/web/src/exports/columns.test.ts`, `writers.test.ts` | no personal column or shift name by default, local times, the byte order mark and CRLF, both CSV formats, formula guards, JSON without a byte order mark |
| `apps/web/src/exports/archive.test.ts`, `run.test.ts` | entry order and time, the same bytes in two time zones, every manifest field, re-reads, unverified reasons, a lagging daily summary, at most two requests in flight, stopping |
| `apps/web/src/exports/estimate.test.ts` | the estimate arithmetic, the 100 MB threshold, the monthly tally when storage refuses |
| `apps/web/src/pages/exports/exports-page.test.tsx`, `export-tab.test.tsx` | the tabs, role gating (nothing for the publisher), the personal box by role and scope, form validation and the 12-month message, estimate, confirmation, result states, stopping, the demo notice; the pack tab's own tests (`pack-tab.test.tsx`) are listed in [strategy.md, section 9](strategy.md#9-tests) |
| `apps/web/e2e/live/exports.spec.ts` | a month exported as CSV and JSON on a fixture tenant: every file verified, the expected paths, the byte order mark and strict UTF-8 with names intact, manifest fingerprints equal to `export_control_totals` read by the same signed-in member, personal data only when ticked, staff and viewers gated, a store-limited manager without the box; axe at 360 and 1280 px, light and dark |
| `apps/web/e2e/demo/datapack.spec.ts` | the page opening on the pack tab, the export tab's demo notice, no request leaving the origin, English without raw keys, links of at least 44 px, axe at 360 and 1280 px; its other three tests build, download and copy the demo's sample pack (#142) |
| `apps/web/e2e/live/datapack.spec.ts` | the pack tab on the settings fixture tenant: the owner's browser pack equal to the package's own build in the same session apart from `generated_at`, with the copy carrying that pack; a manager limited to one store; staff gated (#142) |

The live spec creates its own fixture tenant (`e2e/support/settings-fixture.ts`) and deletes it afterwards. With `E2E_LOGIN_EMAIL`, `E2E_LOGIN_PASSWORD` and optionally `E2E_TENANT_SLUG` set (read by `liveLogin()` in `e2e/support/local-stack.ts`, which falls back to the seeded login) it instead exports the last complete month of that login's tenant, read-only, and compares it with `export_control_totals` read by the same login; the personal-data and role tests then skip.
