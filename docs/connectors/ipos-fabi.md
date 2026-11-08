# Connector: iPOS Fabi

`packages/connector-ipos` is the first `PosConnector` implementation. It talks to the REST API that the Fabi CMS (fabi.ipos.vn) itself uses. iPOS does not publish this API; everything below was observed by capturing the CMS's own requests and verified with live probes. Treat it as subject to change: every response is validated with zod, and a shape change raises a typed error instead of writing bad rows.

The connector uses documented read endpoints only. It never calls CMS forwarding endpoints, CRM endpoints or anything that writes.

## Authentication

- `POST /api/accounts/v1/user/login` with JSON `{ "email", "password" }` returns a JWT (HS256) valid for 7 days together with the user's company, brands, cities and stores. The company, brand and store objects use `id` as their identifier.
- Every call sends: `authorization: <jwt>` (no `Bearer` prefix), `access_token: <app key>` (a constant the CMS bundle ships with; it is configuration, never committed: the client option `appAccessToken`, filled from `IPOS_APP_KEY` or the account entry's `appAccessToken`, and the client refuses to start without a 32-hex value), `fabi_type: pos-cms`, `x-client-timezone: <offset in ms>` (25200000 for UTC+7), `accept-language: vi`.
- The connector caches the token per account, re-logs-in when the token is within 12 hours of expiry or on a 401, and retries the failed call once. Server logins do not invalidate the user's browser session.

## Conventions

- Dates are epoch milliseconds; `start_date` and `end_date` are inclusive. The CMS uses local midnight to 23:59:59.999 in the store's timezone.
- `store_open_at` is the business-day start in **whole hours** (a value in minutes answers HTTP 400). The aggregate views shift the window themselves: with a local-midnight window and `store_open_at=5`, the row for date *d* covers *d* 05:00 to *d+1* 05:00 and is still stamped `tran_date` = local midnight of *d* with `date` = *d*. Sending an already-shifted window together with `store_open_at` double-shifts. The connector therefore sends midnight instants plus `store_open_at = dayStartMinutes / 60` and labels rows by `date`. Each store's day start comes from `open_at` (hours) on the login payload's store objects (0 on both observed stores); the connector option `dayStartMinutes` overrides it and must be a multiple of 60.
- Responses are `{ data, message?, track_id }` or `{ error: { code, message }, track_id }`.
- Invoice-level reports accept `skip_limit=1&results_per_page=N` (5,000 works). They return `next_cursor` at the envelope top level — the epoch-ms `tran_date` of the last row. The server ignores `cursor`, `offset` and `page`; the resume parameter is `last_tran_date=<next_cursor>` and it is **inclusive**, so the boundary row repeats and the connector de-duplicates it by key at the boundary only (two legitimately equal payment rows on one bill are kept).
- `/api/v3/reports/shifts` paginates with `page`; it honours `results_per_page` (the connector sends 500) and returns `page`, `num_results`, `total_pages` at the top level.
- Retries: 429 and 5xx with exponential backoff; other 4xx are not retried; 401 triggers one re-login.

## Endpoints used

| Purpose | Endpoint | Notes |
|---|---|---|
| Stores | `GET /api/mdata/v1/stores` | `skip_limit=true`, company and brand ids |
| Items | `GET /api/mdata/v1/items` | **always** with `list_store_uid`; an empty value returns HTTP 500 and the brand-level call can return an empty list |
| Item types / classes / units | `GET /api/mdata/v1/item-types`, `item-classes`, `units` | items carry type and class as UUIDs; names come from these lists |
| Customisations (modifiers) | `GET /api/mdata/v1/customizations` | requires `store_uid` (HTTP 400 without it) |
| Sources, payment methods, promotions, packages | `GET /api/mdata/v1/sources`, `payment-methods`, `promotions?aggregate=true`, `packages` | |
| Users | `GET /api/accounts/v1/users` | rejects `skip_limit`; send only company and brand ids |
| Daily totals (control totals) | `GET /api/v3/reports/sale-summary/days` | `by_days=1`; per-day invoice count and net revenue used for reconciliation |
| Other aggregates | `GET /api/v3/reports/sale-summary/{overview,hours,weekdays,stores,items,item-types,item-classes,sources,payment-methods,promotions}` and `/api/v3/reports/sale-trend/{day-of-week,month-of-year,by-hour}` | used by the exploration and for cross-checks |
| Invoices | `GET /api/v1/accounting/report/sale` | one row per invoice |
| Invoice lines | `GET /api/v1/accounting/report/sale-detail` | one row per line, including zero-amount modifier lines |
| Payments | `GET /api/v1/accounting/report/payment-method` | one row per payment; no per-row id |
| Shifts | `GET /api/v3/reports/shifts` | accepts `list_store_uid`; rows identify the terminal by device code; a shift belongs to the window by its close time, so a shift opened before the window and closed inside it is returned |
| Cash movements | `GET /api/v3/pos-cms/cash-in-out` | `data` (movements), `data_shift`, totals |
| Item × price | `GET /api/v1/reports/sale-summary/items-by-price` | requires `list_store_uid` for store-scoped accounts (HTTP 403 otherwise) |

Adjustments (the `adjustments` capability is **implemented**; it reads the CMS reports that load only after a button click, exposed on the client as `client.posCms.*`):

| Purpose | Endpoint | Client method | Notes |
|---|---|---|---|
| Cancelled and edited invoices (C05) | `GET /api/v3/pos-cms/report/sale-edit-delete` | `listEditedOrDeletedSales` | company, brand and `store_uid`, `start_date`/`end_date` in ms, `page=1`, `store_open_at`; rows carry `status` `DELETE` or `EDIT`, `tran_id`, `origin_tran_id`, `first_origin_tran_id`, `sale_note` (the cashier's reason), `total_amount_origin` (before), `total_amount` (after), `tran_date` (bill time) and `updated_at` (cancel/edit time, ms); the response has no paging fields and also returns `data_shift` (the shifts the rows reference). The server refuses a range longer than **three months** (HTTP 500, "Khoảng thời gian xem báo cáo không được quá 3 tháng"), so `fetchAdjustments` splits its query per calendar month in the store's timezone and concatenates. Cancelled bills are absent from the accounting sale report; an edited bill's new `tran_id` is in the sale report with the post-edit total while its `origin_tran_id` is not. Used by `fetchAdjustments`. |
| Invoice snapshot behind a C05 row | `GET /api/v3/pos-cms/sale?tran_id=…` | `getSaleSnapshot` | the full original invoice (`sale_detail[]`, `sale_payment_method[]`) as it stood; the void is recorded by the C05 row, not by mutating the sale. Client only; not needed to build adjustments. |
| Removed items (C08) | `GET /api/v3/pos-cms/report/sale-change-log-remove-item` | `listRemovedItemEvents` | `list_store_uid` (not `store_uid`), fixed page size of **20** with no total (the client reads `page=1,2,…` until a page is short), `start_date` and `end_date` **must fall in the same calendar month** (HTTP 400 otherwise) so the client splits the requested range per calendar month in the store's timezone (`timezone` parameter) and concatenates; one row per change event with `sale_detail[]` where a removed line has a **negative quantity** and `sort_index` −1 and usually an id ending in `_REMOVE` (live data also contains removed lines without the suffix, so the quantity is the marker and the suffix is secondary); `amount` is positive and equals `price × |quantity|` without toppings (`toppings[]` carry the same negative quantity, `amount_all_topping` is the value with toppings); `is_printed` marks lines already sent to the kitchen; `updated_at` is epoch **seconds** shifted by the local offset (use `log_date`). The event's `tran_id` is in the accounting sale report only when the order was later paid. Used by `fetchAdjustments`. |
| Order change log (C04) | `GET /api/v3/pos-cms/sale-change-log` | `listSaleChangeLog` | `store_uid`, page size **100** with no total (read until a short page); the same **same-calendar-month** rule as C08 (HTTP 400 with the identical message on a cross-month range), so the client splits per calendar month in the store's timezone (`timezone` parameter) and returns the `ranges` it used; full sale snapshots per change (`SALE_CHANGE`, `RE_PRINT_ORDER`) in `change_data`; C08 is this log filtered to removals. Client only; a 30-day pull is thousands of rows. |
| Out-of-stock history (C09) | `GET /api/v3/pos-cms/report/out-of-stock-item` | `listOutOfStockEvents` | dates in epoch **seconds** here (the client converts from ms); `page`, `total_pages`, `num_results` in the envelope and the client walks the pages; optional `city_uid`. Client only; the feature is unused on the observed accounts. |

## Normalisation to the canonical model

| Canonical | iPOS source | Rule |
|---|---|---|
| `sale.externalId` | `tran_id` | unique per store |
| `sale.receiptNo` | `tran_no` | resets daily or yearly depending on the store — never a global key |
| `sale.soldAt`, `businessDate` | `tran_date` | business date computed in the store's timezone with its configured day start |
| `sale.channel` | `sale_type`, `source_id` | `OTS` → dine_in, `TA` → take_away, delivery when the source is a configured delivery platform |
| `sale.itemDiscountAmount` | `amount_discount_detail` + `amount_discount_price` | both are line-level reductions already netted into the lines; the observed "voucher" promotions are buy-one-get-one style: one line gets `price` 0 with `amount_discount_on_price` equal to its list price and a `promotion_id`, mirrored in the header's `amount_discount_price` |
| `sale.billDiscountAmount` | `discount_extra_amount` | `discount_extra_name` becomes the bill discount label |
| `sale.voucherAmount` | `voucher_amount_paid` | observed 0 even on invoices carrying a `voucher_code`; the code and name are passed through, so "share of invoices with a voucher" uses the code |
| `sale.grossAmount` | `amount_origin` + item discounts | `amount_origin` already equals the sum of line amounts net of line reductions |
| `sale.netAmount`, `paidAmount` | `total_amount`, payments | identity verified live on every discounted invoice: gross − item − bill − voucher + service charge + shipping + VAT = net (VAT, service charge and shipping were 0 everywhere, so their signs are unverified) |
| `sale.customerPhone`, `customerName` | `customer_phone`, `customer_name` | empty unless the cashier attached a member |
| `line.lineKind` | items master, customisation option ids and names, amounts | the customisation options (0% Đường, 50% Đá, …) live in `customizations.data.LstItem_Options[].LstItem_Id` and are also rows of the items master (type uncategorised, price 0), so a line whose item id — or item name, matched against the option items' names — is a customisation option with zero amounts and a zero master price is a modifier; priced toppings chosen through the customisation dialog (about 10 % of all lines on one observed account) carry revenue and stay items, and the catalog marks them `isModifier: false` so catalog and sales agree; promotion lines of real items at price 0 stay items; package components when `package_id` is set |
| `line.parentLineExternalId` | composite line id, then position | modifier line ids embed the parent line's id (`<parentLineId>_<tranId>_SDTOP_…`), which gives an exact link; the nearest preceding item line is the fallback because a few invoices list the modifier before its item |
| `line.baseName`, `sizeLabel` | `item_name` | trailing `(S)`, `(M)`, `(L)`, `(XL)` with optional inner spaces |
| `line.itemTypeName` | `item_type_name`, items master | resolved through the item master when the line only carries a UUID or an "uncategorised" label |
| `payment.kind` | `payment_method_name` | configurable Vietnamese name patterns: cash, e-wallet, bank transfer, card, voucher, other |
| `sale.openedAt`, `closedAt` | `start_hour`/`start_minute`, `end_hour`/`end_minute` on the sale's business date | when the opening clock lands after the close (a bill opened before midnight and paid after it) the opening is moved back one day |
| `shift.*` | shifts report, store-scoped | sales, orders, cash drawer total, opening float, changed-after-close flag; rows without a `store_uid` raise a `shift_without_store` flag and are dropped |
| `dailyTotal.*` | sale-summary/days with midnight instants and `store_open_at` in hours | invoice count and net revenue per business date, labelled by the row's `date` |
| `adjustment` (`kind: voided`) | C05 row with `status = DELETE` | `saleExternalId` = `tran_id`, `amount` = `total_amount_origin` (the voided bill), `occurredAt` = `updated_at`, `reason` = `sale_note` when present; the whole row is kept in `raw`. The voided bill is absent from the accounting sale report, so the referenced sale is one the sales sync never stores and revenue already excludes it |
| `adjustment` (`kind: edited`) | C05 row with `status = EDIT` | `saleExternalId` = `tran_id` (present in the sale report with the post-edit total), `relatedSaleExternalId` = `origin_tran_id`, falling back to `first_origin_tran_id` (the pre-edit invoice, which the sale report no longer lists), `amount` = \|`total_amount_origin − total_amount`\| so it is never negative, with the direction read from `raw` (`total_amount_origin` before, `total_amount` after), `occurredAt` = `updated_at`; a row without any origin reference is still emitted and raises an `edit_without_origin` flag. The linkage was inferred from the CMS export columns and matches the two EDIT rows seen live so far (both carried `origin_tran_id` = `first_origin_tran_id`; one left the total unchanged, one increased it). A row whose status is neither value is dropped with an `unknown_adjustment_status` flag |
| `adjustment` (`kind: line_removed`) | C08 event, one per `sale_detail` line with a negative `quantity` | `saleExternalId` = `tran_id`, `lineExternalId` = `id_sale_detail` (the `_REMOVE` suffix included when the server sent one), `itemExternalId`/`itemName` from the line, `quantity` = \|`quantity`\|, `amount` = `price × quantity` (the line's own value, toppings excluded; they stay in `raw`), `occurredAt` = `log_date`; `raw` is the event with only that line; kept or added lines (positive quantity) in the same event are skipped; a removed line without the `_REMOVE` suffix is still emitted and raises an informational `removed_line_without_suffix` flag. The order is in the sale report only when it was later paid |
| adjustment window | `updated_at` / `log_date` in the store's timezone | the connector queries one day on each side of the business-day instants (the server's own date filter field is not documented), splits that range per calendar month for both C05 (three-month cap) and C08 (same-month rule), keeps the adjustments whose change time falls on a business date inside the window, de-duplicates by (kind, sale, line, time) with `adjustmentKey` from `@fnb/core` and sorts by time |

## Testing

- Unit tests use an injected `fetch` and synthetic fixtures (fake UUIDs, generic names, round amounts). Nothing recorded from a real account is committed.
- `LIVE=1 pnpm --filter @fnb/connector-ipos test:live` runs opt-in tests against the real API using the local `.env`; they print counts and timings only. `test/live/adjustments.test.ts` fetches the last 30 days of adjustments per store on every account, prints counts by kind, and asserts zero schema errors and a clean `checkAdjustments` run; it never asserts specific counts.
- The conformance suite from `@fnb/connector-core` runs against the adapter with iPOS-shaped fixtures rendered from the mock connector's canonical data. The renderer also turns the mock's adjustments into synthetic C05 rows (`DELETE`/`EDIT`, every other edit rendered as an increase of the bill) and C08 events (`_REMOVE` lines with negative quantity, positive amount and `sort_index` −1), answers HTTP 400 to a C08 request spanning two calendar months and serves 20-row pages, so the adapter's month splitting, absolute edit amounts and short-page termination run offline. The unit tests add an edit that increased the bill, a removed line without the `_REMOVE` suffix and a window spanning three calendar months (three C05 calls).

## Known quirks (keep when writing new code)

1. Empty `list_store_uid=` → HTTP 500 on several master-data endpoints; the client refuses to send it.
2. Cursor resume is inclusive; de-duplicate only at the boundary.
3. Payment rows have no id; `(tran_id, method, trace_no, amount)` is not unique.
4. `customizations` needs a store id; `users` rejects `skip_limit`.
5. Shifts accept `list_store_uid`; the report keys shifts on their close time, and shifts spanning midnight are attributed to the day they closed.
6. Modifier lines (sugar, ice, strength) arrive as zero-amount lines typed "uncategorised"; they are a preference dataset, not sales.
7. `voucher_amount_paid` is 0 on the invoices that carry a voucher code; the reduction sits on the lines (`amount_discount_on_price`) and in the header's `amount_discount_price`.
8. Shifts carry a constant opening float in `balance`; `payment_fee_amount` has been 0 everywhere so far.
9. `store_open_at` is in hours and the aggregate views shift the window themselves; never pre-shift the instants when passing it.
10. C08 (`sale-change-log-remove-item`) and C04 (`sale-change-log`) refuse a range that touches two calendar months (HTTP 400) and serve fixed pages (20 and 100) with no total; split per calendar month in the store's timezone and read pages until a short one. C05 (`sale-edit-delete`) accepts cross-month ranges but refuses more than three months (HTTP 500, retried as a server error unless the range is split first); the adapter splits it per calendar month too. C05 and C04 take `store_uid`, C08 takes `list_store_uid`.
11. On C08 and C04 rows `updated_at` is in epoch seconds and shifted by the local offset; use `log_date` (ms) for the change time. C09 takes its range in epoch seconds.
12. A removed line is recognised by its negative `quantity` (with `sort_index` −1); most carry the `_REMOVE` suffix on `id_sale_detail` but live data also has removed lines without it, so never rely on the suffix alone. Its `amount` is already positive (`price × |quantity|`) and excludes toppings, so never negate it again and do not expect it to include `amount_all_topping`.
13. An EDIT can increase the bill (`total_amount > total_amount_origin`); the canonical `edited.amount` is the absolute difference and the direction lives in `raw`.
