# Settings sources

How the settings pages read and write their data, in the live app and in the demo. Every page goes through one of two sources and one mutation hook. Each failure therefore has its message, the audit line has its columns, and cached numbers are dropped after a save. The page tickets build on this (#159 to #164). The rules for who may write what are in [schema.md](schema.md#who-can-write-what) and [api.md](api.md#34-settings-and-writes).

## The two sources

| Source | Defined in | Live | Demo |
|---|---|---|---|
| `SettingsSource` | `apps/web/src/settings/source.ts` | `supabase-settings-source.ts` | `demo-settings-source.ts` |
| `ManualSettingsSource` | `apps/web/src/settings/manual/source.ts` | `manual/supabase-manual-source.ts` | `manual/demo-manual-source.ts` |

`SettingsSourceProvider` (`settings-source-context.tsx`) loads both sources of the current mode together, lazily, when a page first asks. `useSettingsSourceState()` then answers `{ status: "ready", source, manual }`. Like the analytics source, a failed load is tried again when the next page asks, or on "Thử lại". The demo implementations write into the session's `DemoSettingsStore` (`apps/web/src/demo/demo-settings.ts`). The demo report engine reads that same store, so a saved change moves the demo's numbers at once. A demo page says `settings.demoNote`: changes last for the session only.

### Areas and methods

Reads return rows with their audit entry (`AuditEntry`: when, and "you", a member's role or unknown), or `null` when no member ever saved the row. Writes resolve with the stored rows, or throw `SettingsWriteError`.

| Area | Reads | Writes | Table and key |
|---|---|---|---|
| Membership | `membership` | — | `tenant_members` |
| Tenant profile | `tenantProfile` (legal form, default language), `defaultLanguage` (that column alone, for the shell) | `updateTenantProfile` | `tenants`, update of `legal_form` and `default_language` |
| Store profiles | `storeProfiles` (the POS facts and the seven profile columns) | `updateStoreProfile` (only the columns given) | `stores`, update of the profile columns |
| Item-type roles | `itemTypes` | `saveRoles` | `item_type_roles` on `pos_account_id, item_type_external_id` |
| Items and categories | `items` (the POS category and the override; an override whose item the catalogue lacks is listed with `inCatalogue: false`, so it can be cleared) | `saveCategoryOverrides` (a null type deletes the override) | `item_category_overrides` on `pos_account_id, item_external_id` |
| Payment methods | `paymentMethods` (POS kind, override, effective kind) | `saveKindOverrides` (a null kind deletes it) | `payment_kind_overrides` on `pos_account_id, payment_method_external_id` |
| Fee rates | `feeRates` | `saveFeeRates` | `payment_fee_rates` on `tenant_id, store_id, payment_method_external_id, effective_from` |
| Holidays | `holidays(year)`: the country's national days and the tenant's own | `addHoliday`, `deleteHoliday` | `holidays` (tenant rows of kind `custom`) |
| Thresholds | `reportSettings` | `saveReportSettings` | `report_settings` on `tenant_id` |
| Catch-up | `catchUpStatus` | `refreshChunk` | `analytics_catch_up_status()`, `refresh_my_analytics()` |
| Item costs | `itemCosts` (every row, so the history) | `saveItemCosts`, `deleteItemCost` | `item_costs` on `tenant_id, store_id, item_external_id, effective_from` |
| Targets | `targets` | `saveTargets` | `targets` on `store_id, period_kind, period_start` |
| Legal texts | `legalDocuments` | `saveLegalDraft` (inserts a draft, or patches the title, body and version of one), `publishLegalDocument`, `retireLegalDocument`, `deleteLegalDraft` | `legal_documents`; `publish_legal_document()` and `retire_legal_document()` |

### Live writes

- **One statement per save.** Each save is one statement, so it succeeds or fails as a whole:
  - costs, fee rates, targets, roles and thresholds: one PostgREST upsert on the table's unique key (`onConflict`), including a CSV import of up to 2,000 rows;
  - profiles: one update of the columns given; an empty change sends nothing and answers the stored row;
  - holidays and new legal drafts: one insert; a draft's patch: one update; publication and retirement: one function call.

  The exception is overrides. The rows that are set go in one upsert, then the cleared ones go in one delete per POS account, so a failure can leave part of the save written. The pages save overrides with `touchesMappings`, which drops the cached settings and analytics after a failure too.
- **A key twice in one batch.** A batch that names the same key twice fails whole: Postgres answers `21000`, reported as `duplicate`, and the demo refuses it the same way.
- **Tenant-wide rows.** A tenant-wide row (null `store_id`) resolves through the nulls-not-distinct key. A tenant-wide and a store row of the same item and date are therefore two rows, and saving the same scope again updates its row. `e2e:live/settings-manual` proves this through supabase-js on the local stack, so no RPC fallback is needed.
- **Reads.** Reads page through the 1,000-row cap in a stable order (`fetchAllPages`).
- **Refused writes.** Row-level security answers a refused update or delete with no row, not an error, so:
  - an update that returns no row is reported as `forbidden`;
  - a delete that removed nothing is checked by a second read. If the row is still there, the delete was refused (`forbidden`). A published legal text gives `frozen` instead.

## Errors

`SettingsWriteError` carries a `code` and, when the database named one, the `constraint`:

| Database answer | Code |
|---|---|
| `42501`, `PGRST3…` | `forbidden` |
| `23505` | `duplicate` (with the constraint) |
| `21000` (one batch naming a key twice) | `duplicate` |
| `23514`, `22023`, any other SQLSTATE | `invalid` (with the constraint when named) |
| `55000` (a published legal text) | `frozen` |
| no answer (the request never reached the server) | `network` |

The demo raises the same codes:

- A refused demo write becomes `invalid`, a duplicate `duplicate`, and a frozen legal text `frozen`.
- The constraint is the refused field's name. A store code another store uses and invalid opening hours are reported under the database's own constraint names (`stores_code_unique_in_tenant`, `stores_opening_hours_valid`), so the demo shows the same messages as the live app. Store codes are compared trimmed and upper-cased, as the database does.

An error that is not a `SettingsWriteError` counts as `network`. That includes a row the database stored but whose answer no longer parses. A retry then resends the same upsert, which writes nothing new.

## `useSettingsMutation`

Pages call writes only through `useSettingsMutation(write, options)`. The `write` receives the settings source, the tenant id, the page's arguments and the manual source.

- **After a success** it invalidates the tenant's settings queries and cached analytics. A write that touches a mapping (`touchesMappings`) also starts the catch-up.
- **After a failure** it invalidates nothing, except after a mapping save, which may have written part of its rows.
- **`errorKey`** is the message to show:
  - `settings.store.hours.ownerOnly` when `forbidden` and `touchesOpeningHours(args)` says the change held opening hours;
  - `settings.store.code.duplicate` for `stores_code_unique_in_tenant`;
  - `settings.store.hours.invalid` for `stores_opening_hours_valid`;
  - `settings.legal.frozen` for `frozen`;
  - otherwise `settings.error.<code>`.
- **`canRetry`** is true after a network failure, and `retry()` sends the same arguments again.

## Phân loại: item categories and payment kinds

The two 10b tabs of Settings → Phân loại write the override tables of the table above. Owners and managers with an unlimited scope may save them, like the roles (`useSettingsAccess("roles")`); every other member reads them as text with the read-only note and no save bar.

- **Nhóm của món** (`?tab=nhom-mon`) reads `items` and `itemTypes`, and `data_quality_items` through `useUncategorisedSales`.
  - "Chưa phân loại" lists what Thực đơn and Chất lượng dữ liệu call uncategorised. The hook calls `data_quality_items` once per POS account, with the store ids of that account, over the 90 days ending on the last complete day. Since the function reports each item under the account of the first store asked that sold it, every row of such a call carries that account in `pos_account_id`.
  - The hook keeps the rows with `type_known`, `catalogue_modifier` and an override all false or null, in the function's order (net amount, highest first, across the accounts). Each row is joined to `items` by POS account and item key, the key of the sale lines (`coalesce(item_external_id, item_name)`). An item sold without an id therefore gets an entry of its own, outside the catalogue, and its override is saved under that key.
  - An item whose override the cached `items` already hold leaves the list at once, before the function is read again. The call goes through the cached analytics path, so the save's `invalidateAnalytics` reads it again. While it loads the list says so; if it fails, it offers "Thử lại".
  - Then come the saved overrides, those whose item left the catalogue included, so they can be cleared. Last is a search over every item, the uncategorised first.
  - Each item offers "Theo POS" and the item types of its own POS account, never another account's and never free text. Saving sends the changed items to `saveCategoryOverrides`; "Theo POS" is a null type, so it deletes the override.
- **Loại thanh toán** (`?tab=thanh-toan`) reads `paymentMethods`. It shows each method under its POS account with the POS kind (`pos_kind`), the override and the kind in effect. Saving sends the changed methods to `saveKindOverrides`; "Theo POS" is a null kind, so it deletes the override. The tab notes that the expected cash of past shifts changes only after those days are synced again.
- **After a save.** Both tabs save through `useSettingsMutation` with `touchesMappings`, so:
  - the tenant's settings and analytics are invalidated, and the next report read shows an item in its new type, an in-app navigation back included;
  - the catch-up starts for members who may refresh, and its banner shows on every settings and theme page while days are pending; when the runner finishes it says "Đã cập nhật xong số liệu theo thay đổi phân loại." until it is closed;
  - the cached list takes the saved overrides at once, so the page shows them even if reading them back fails.

  In the demo the store re-ingests at once, so the banner never shows.
- **Errors.** The save bar shows the message of `errorKey`. After a network failure a "Thử lại" button calls `retry()`, which sends the same changes again.

## Ngưỡng báo cáo: the Khuyến mãi field

Ngưỡng báo cáo shows the nine `report_settings` columns in four groups: Thực đơn, Tiền mặt, Giờ and, since #191, Khuyến mãi with "Số tuần trước khuyến mãi" (`promoPreWeeks`, `promo_pre_weeks`: 2 to 8 weeks, default 4). Its hint and default show like the others' ("Mặc định: 4 tuần."), a value outside 2 to 8 is refused with "Nhập giá trị từ 2 đến 8." before anything is sent, a refusal by `report_settings_promo_pre_weeks_check` is shown on the field, and "Khôi phục mặc định" sets it back to 4 with the rest. It is saved like any other threshold, through `saveReportSettings` and `useSettingsMutation`, so the cached analytics are dropped at once.

Khuyến mãi's lift card reads the field through `report_settings_of` and passes it to `promotion_lift` as `pre_weeks` (the function also falls back to it when a call leaves `pre_weeks` out), so the call and the card's subtitle use one value and a saved change asks for a new lift: the `prior_weeks` comparator averages that many weeks before the first promotion day, and `sister_store` compares both the promoting and the control stores with that many weeks before. The demo engine reads the same field from the session's `DemoSettingsStore`, and the lift card names the weeks in its subtitle, so the next view shows the change in both modes.

## Queries

`apps/web/src/settings/queries.ts` has one hook per read: `useMembership`, `useItemTypes`, `useReportSettings`, `useCatchUpStatus`, `useTenantProfile`, `useTenantDefaultLanguage`, `useStoreProfiles`, `useItems`, `usePaymentMethods`, `useFeeRates`, `useHolidays(year)`, `useItemCosts`, `useTargets` and `useLegalDocuments`.

Their keys are `["settings", sourceKind, tenantId, area, ...parts]`, with the year as a part for holidays. So `invalidateSettings(queryClient, tenantId)` drops every settings read of the tenant at once.

## The demo's rows

- **Order.** Lists come back in the live order (costs by item, store with tenant-wide first, date; fee rates by method, store, date; targets by store, period kind, start; legal texts by kind, language, version), so a page shows a new row in the same place in both modes.
- **Ids.** Demo rows have no database ids. Each row's id is built from its key, such as `fee:<store>:<method>:<date>`. A legal draft's id follows its version, so a draft whose version is changed comes back under a new id.
- **Audit line.** It shows "you" with the time of the session's last save that changed that row. Rows from the demo's defaults have none, and a save that changes nothing stamps nothing, as the profile triggers do live.
- **Legal texts.** Publication and retirement follow the database's functions. Publishing a draft retires the text it replaces, and a published or retired text is never edited or deleted.

## The Cửa hàng page

`#/cai-dat/cua-hang`, the page the settings open on (`src/pages/settings/cua-hang-page.tsx`, forms in `src/settings/store/`).

- **The business block** holds the legal form (household business, micro-enterprise, small enterprise, other enterprise, not yet known; one dated line says it decides the dossier for transferring personal data abroad, ADR-019) and the default language (Tiếng Việt or English).
- **One block per store** the member can see. The name, address, time zone and business-day start are text marked "lấy từ POS", with no control: the master-data sync overwrites the first three, and the day start fixes the business date of every sale. The block edits the store code, the opening date, the opening hours, the seats, the e-invoice status, the receipt numbering and the member feature on the POS. Under the receipt numbering the page names what `data_quality_summary` suggests (`receipt_restarts_daily`): whether at least 90 % of the days with numeric receipt numbers, over the 120 days up to the last complete day, start at 3 or below. It needs at least 20 such days and shows nothing otherwise; "Dùng gợi ý" appears when they restart daily and stays, unavailable, once applied. The demo's receipt numbers are not numeric (`HD…`), so the demo never shows a suggestion; the live check of `e2e:live/settings` shows it on the fixture tenant.
- Each block has its own save bar and audit line, and sends only the fields that changed. A store whose opening hours were never entered (null) says so above the days, which the editor shows as closed. A line under the opening hours says that saving them changes Giờ & ngày, Hôm nay's opening-hour figures, the incremental sync's schedule and the digest's time.

### Who may change what

| Block | May save | Everyone else |
|---|---|---|
| Business | an owner with an unlimited scope (`useSettingsAccess("tenantProfile")`) | reads it with `settings.store.tenant.readOnly` |
| Store, except the opening hours | an owner or manager with the store in scope (`useSettingsAccess("storeProfile", storeId)`) | reads it with `settings.store.readOnly.role` or `.scope` |
| Opening hours of a store | an owner with the store in scope (`useSettingsAccess("openingHours", storeId)`) | a manager reads them with `settings.store.hours.readOnly`; the rest of the block stays editable |

Row-level security and `app.stamp_store_profile` decide regardless: a refused hours change shows `settings.store.hours.ownerOnly`, a code another store uses `settings.store.code.duplicate` (also under the code field), and invalid hours `settings.store.hours.invalid`.

### Checks before a save

`src/settings/validation.ts`: `storeCode` (at most 12 characters once trimmed; an empty code is saved as none), `seatCount` (whole seats from 0 to 5,000; empty is unknown), `openingDate` (from 2000-01-01, so an older store can record its opening, to the end of next year) and the opening-hours editor's own check of each span. A change with a problem keeps the save bar's "Lưu" unavailable.

### The default language

`PreferencesProvider` keeps the device's language in storage only once the member chose it with the toggle, marked `languageChosen: true`. A Vietnamese an earlier version stored without that marker counts as not chosen (it was saved with every other preference), while an unmarked English is kept, since only the toggle could have stored it. Until a language is chosen, `TenantDefaultLanguage`, mounted in the shell, reads `defaultLanguage` (the column `tenants.default_language` alone, without the audit's member reads) and applies it through `adoptDefaultLanguage`, so a new session opens in the tenant's language and the toggle still wins on that device. It follows the tenant's language while the session runs too: an owner who never chose a language sees the app switch as soon as they save another default.

## Tests

| Test | What it proves |
|---|---|
| `web:settings/supabase-settings-source`, `web:settings/manual/supabase-manual-source` | each method's table, columns, order and pages; the upsert key of every table; the null store sent as null; refusals and their codes; a lost connection as `network` |
| `web:settings/demo-settings-source`, `web:settings/manual/demo-manual-source` | a round trip for every method on the demo store, the audit stamps, the legal lifecycle and the same refusals |
| `web:settings/use-settings-mutation` | every error message, the owner-only hours message only when the hours changed, the retry, invalidation only after a success |
| `web:settings/queries`, `web:settings/settings-source-context` | each read goes to its source with its key; both sources load together |
| `web:pages/settings/cua-hang-page`, `web:settings/store/store-fields` | the POS facts without a control, a round trip of every profile field and of the tenant block on the demo store, the audit line, the limits of code, seats, opening date and spans, the messages of `42501`, `23505`, `23514` and a lost connection, the read-only states of a manager, a store-limited owner, staff and a viewer, the receipt-numbering suggestion |
| `web:state/preferences`, `web:settings/tenant-default-language` | the tenant's default language only without a chosen one (an earlier version's unmarked Vietnamese included), the toggle winning and being stored as chosen |
| `e2e:demo/settings-cua-hang` | the page without a receipt suggestion, an incomplete span and a duplicate code refused, hours and seats saved for the young store bringing RevPASH to Giờ & ngày after an in-app navigation, a saved default language switching the session and the toggle winning, axe at 360 and 1280 px |
| `e2e:live/settings` | on the fixture tenant: the owner's profile save through row-level security with its audit line and the data's suggestion, the duplicate code, a manager's read-only hours and the owner's role in the audit line, a store-limited manager's one store, and a new session opening in the tenant's English |
| `web:settings/categories/categories`, `web:settings/categories/categories-form`, `web:settings/categories/use-uncategorised-sales`, `web:settings/payment-kinds/payment-kinds`, `web:settings/payment-kinds/payment-kinds-form`, `web:pages/settings/phan-loai-page` | one `data_quality_items` call per POS account over 90 days, the uncategorised items in sales order with an item sold by name, the loading and failed states, the search, only the item's own account's types, the changed rows with "Theo POS" as a delete, the cached list after a save, the catch-up started after a save and not after a refusal, the refusal messages and the retry, the read-only tabs |
| `e2e:demo/settings-phan-loai` | re-mapping the uncategorised demo item takes it out of Chưa phân loại on Thực đơn and into its new category, and a re-mapped payment method moves in Thanh toán's payment mix and back, all through the app's links without a reload; axe at 360 and 1280 px |
| `e2e:live/settings-phan-loai` | on the fixture tenant of #103: the item without a type re-mapped through the real tables, the kind override moving the method in Thanh toán, the catch-up banner appearing and clearing after each, both tabs read-only for staff and viewer |
| `e2e:live/settings-manual` | on the fixture tenant of #103, through PostgREST: the tenant-wide cost key, one statement per save, fee rates, the store-limited manager's scope, the store code, the opening hours and span refusals, the tenant profile, both override kinds, holidays and the legal lifecycle |
