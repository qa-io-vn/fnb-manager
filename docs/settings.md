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

- **After a success** it invalidates the tenant's settings queries, its cached analytics and Hôm nay's report (`invalidateTodayReport`, the `today` queries of the tenant), since a holiday (Hôm nay's excluded days) or a payment-kind change moves Hôm nay's numbers too. A write that touches a mapping (`touchesMappings`) also starts the catch-up.
- **After a failure** it invalidates nothing, except after a mapping save, which may have written part of its rows: then it drops the settings, the analytics and Hôm nay's report.
- **`errorKey`** is the message to show:
  - `settings.store.hours.ownerOnly` when `forbidden` and `touchesOpeningHours(args)` says the change held opening hours;
  - `settings.store.code.duplicate` for `stores_code_unique_in_tenant`;
  - `settings.store.hours.invalid` for `stores_opening_hours_valid`;
  - `settings.manual.costs.amountRefused` for `item_costs_amount_whole_dong` (`23514` from the database check on `item_costs.cost_amount`, whole đồng from 0 to 100,000,000; the Giá vốn tab and the CSV import refuse the same values before sending);
  - `settings.legal.frozen` for `frozen`;
  - otherwise `settings.error.<code>`.
- **`canRetry`** is true after a network failure, and `retry()` sends the same arguments again.

## Phân loại: item categories and payment kinds

The two 10b tabs of Settings → Phân loại write the override tables of the table above. Owners and managers with an unlimited scope may save them, like the roles (`useSettingsAccess("roles")`); every other member reads them as text with the read-only note and no save bar.

- **Nhóm của món** (`?tab=nhom-mon`) reads `items` and `itemTypes`, and `data_quality_items` through `useUncategorisedSales`.
  - "Chưa phân loại" lists what Thực đơn and Chất lượng dữ liệu call uncategorised. The hook calls `data_quality_items` once per POS account, with the store ids of that account, over the 90 days ending on the last complete day. Since the function reports each item under the account of the first store asked that sold it, every row of such a call carries that account in `pos_account_id`.
  - The hook keeps the rows with `type_known`, `catalogue_modifier` and an override all false or null (`isUncategorisedItem` of `@fnb/reports`, the predicate Chất lượng dữ liệu's uncategorised card uses too, so both pages agree), in the function's order (net amount, highest first, across the accounts). Each row is joined to `items` by POS account and item key, the key of the sale lines (`coalesce(item_external_id, item_name)`). An item sold without an id therefore gets an entry of its own, outside the catalogue, and its override is saved under that key.
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

## Dữ liệu nhập tay: item costs

`#/cai-dat/du-lieu-nhap-tay` (`src/pages/settings/du-lieu-nhap-tay-page.tsx`) holds the manual data in three tabs: Giá vốn (`?tab=gia-von`, the default, #161), and Mục tiêu and Phí thanh toán, placeholders until #163 fills them. [manual-data.md](manual-data.md) describes the costs, their scopes, dates and history; this section says how the tab uses the sources.

- **Reads.** `useItemCosts` (every row, so the history), `useItems` and `useItemTypes` (the catalogue, its sizes, prices and categories), and `item_summary` over the last 90 days of the scope's stores through the cached analytics path (`useItemSales` in `src/settings/manual/use-item-sales.ts`), so a save's `invalidateAnalytics` reads it again.
- **Writes.** "Lưu" sends the typed costs of the scope to `saveItemCosts` in one call; "Xóa" in an item's history calls `deleteItemCost`. Both go through `useSettingsMutation` without `touchesMappings`: costs are read at query time, so no catch-up starts, and the tenant's cached analytics are dropped after a success, so Thực đơn shows the new margins on its next view. The saved rows replace the cached `itemCosts` at once, and a deleted row leaves it.
- **Access.** `useSettingsAccess("manualData", storeId)`: a store row needs an owner or manager with the store in scope, a row for all stores an owner or manager with an unlimited scope (`settings/access.ts`), as the policies of `item_costs`, `targets` and `payment_fee_rates` say. The targets and fees tabs of #163 use the same area.
- **Checks.** `itemCost(fractionDigits)` in `src/settings/validation.ts`: 0 to 100,000,000 (`ITEM_COST_MAX`), whole đồng for VND; `readCostText` also reads `8333.33` or `25.5` as a fraction of a đồng instead of "not a number"; dates through `businessDate`. The database has no check on `cost_amount` yet; it comes with #162.
- **Order of reads.** The tab waits for the membership before it picks the default scope and asks for the 90-day sales, so a store-limited member reads their store's sales only.
- **Delete refusals** have their own words (`deleteErrorKey`: `settings.manual.costs.deleteError.forbidden`, `.network`, `.other`); after a lost connection "Thử lại" calls the delete mutation's `retry()`.

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

## The Ngày lễ page

`#/cai-dat/ngay-le` (`src/pages/settings/ngay-le-page.tsx`, parts in `src/settings/holidays/`). It reads `holidays(year)` through `useHolidays(year)`.

- **The year.** A select of 2024 to 2030 (`HOLIDAY_YEARS`, the range of the analytics calendar) opens on the current year in the tenant's time zone, held inside that range; its hint says the national calendar is shipped for 2024 to 2028 only. The page reads one year at a time. While a year loads, the Ngày nghỉ riêng section, its form and its status line stay mounted and only its list waits.
- **Ngày nghỉ riêng** (the tenant's own days, kind `custom`) comes first, because it is the part a member acts on. Each row shows the name as typed, the weekday and date, and the audit line (`AuditLine`: "Bạn" or the role). A note says that these days are left out of baselines and forecasts. The live functions exclude them at query time through `app.is_excluded_day`, and the demo engine at once, so the next view of a report shows the change.
- **Adding** takes a date from 2024-01-01 to 2030-12-31 (`HOLIDAY_DATE_BOUNDS`) and a name of 1 to 80 characters once composed and trimmed (`holidayName` and `holidayNameValueOf` in `validation.ts`: the name is normalised to NFC first, so a letter typed with combining marks counts once). `readHolidayDraft` sends that composed, trimmed name and holds back a name the date already has in the year on screen, compared in the same form ("Ngày này đã có ngày nghỉ riêng cùng tên."). The database's own refusal of a duplicate (`23505` on `holidays_tenant_country_date_name_key`, or the demo's duplicate) reads `settings.holidays.add.duplicate`. A successful add, whether from **Thêm** or from "Thử lại" after a lost connection, takes the same path: the form empties (a counter the form watches) and a day of another year moves the select to that year. **Xóa** on a row deletes it. Each action reports its outcome in one status line that stays mounted ("Đã thêm …", "Đã xóa …", or the refusal), with "Thử lại" after a lost connection (`retry`). After a delete, or an add sent again by "Thử lại", the focus moves to the section's heading when it would otherwise fall to the page.
- **After a save** the cached year takes the stored row at once (`withAddedHoliday`, `withoutHoliday`), and `useSettingsMutation` drops the tenant's settings, analytics and Hôm nay's report, so a Ngày report or Hôm nay opened next leaves the day out of its same-weekday baseline (the chip then reads "so với mức nền (7/8 tuần)" when one of the eight weeks is gone).
- **Ngày lễ quốc gia** lists the national days of the tenant's country for the year, read-only: the name in the interface language (`globalHolidayNameKey` maps the 13 names of the calendar; a name it does not know shows as stored), the date and the kind (`report.holiday.public`, `report.holiday.tet`). A note says the national calendar is shipped for 2024 to 2028 (`nationalCalendarYears`, the years of `VIETNAM_HOLIDAYS` and of its migration), because its lunar-calendar days are worked out year by year; a year without national rows says so.
- **Who may change it.** Owners and managers with an unlimited scope (`useSettingsAccess("holidays")`), as row-level security allows. Everyone else reads both lists with `ReadOnlyNotice` and has neither the form nor Xóa. Live, the insert policy also requires `created_by` to be the caller, and the triggers set `updated_by`, so a holiday saved from the browser carries its author and an insert naming someone else is refused (`42501`).

## The Pháp lý page

`#/cai-dat/phap-ly` (`src/pages/settings/phap-ly-page.tsx`, components and rules in `src/settings/legal/`) shows the legal texts of `legalDocuments`; the lifecycle and the rules behind it are in [manual-data.md](manual-data.md#legal-documents-settings--pháp-lý).

- **Lists.** One section per kind, in the order of `legal_document_kind`, each with a list per language (`legalGroupsOf`): a line naming the version in force and its publication date, then the published version, the drafts by label and the retired versions, newest retirement first. Each version shows its status, title, label ("Mã phiên bản ghi khi đồng ý"), the database's dates (`publishedAt`, `retiredAt`, in the tenant's time zone) and, for a draft, the audit line. "Xem nội dung" shows the text through the preview.
- **Editor.** One editor at a time, opened by "Tạo bản nháp" in a list or "Sửa" on a draft, with the title, the label and the Markdown body (`legal-editor.tsx`). The label is suggested by `suggestedLegalVersion` and checked by `legalDraftIssues` as the database does: the pattern, the 40, 200 and 100,000 character limits, and a label the list already holds. A required field left empty shows its message once touched or after "Lưu bản nháp". "Tạo bản nháp từ khung" fills an empty body with `legalSkeleton(language)`; "Soạn" and "Xem trước" switch between the text box and the preview (`markdown.ts`, rendered as React elements, so the text is never HTML). The preview reads headings and list markers with plain string code and its inline marks with patterns that never backtrack across the text, so 100,000 characters of any input read in linear time. "Đóng" closes the editor and returns the focus to the button that opened it. "Lưu bản nháp" sends `saveLegalDraft` through `useSettingsMutation`, puts the saved row in the cached list and keeps the editor on it, under its new id in the demo when the label changed. A label taken meanwhile (`duplicate`) shows on the label field.
- **Actions.** "Công bố" (drafts), "Ngừng áp dụng" (published) and "Xóa bản nháp" (drafts) each open a confirmation under the version (`confirm-panel.tsx`; Escape or "Quay lại" closes it and returns the focus). Publishing names the version in force that it retires, and retiring names the kind and language left without a version in force. The confirmed action calls `publishLegalDocument`, `retireLegalDocument` or `deleteLegalDraft` through one `useSettingsMutation`; the list's status line then says what was done, or the refusal with "Thử lại" after a lost connection. A publication or retirement the database refuses because the version is no longer a draft or no longer in force (`22023`, `invalid`; the demo refuses the same way), as after another tab's change or a retry whose first answer was lost, says `settings.legal.stale`; deleting a draft published meanwhile says `settings.legal.frozen`. The list is read again after every action, refused ones included, so its states and dates are the database's. A published or retired version has no edit or delete control, and a draft open in the editor shows no action of its own.
- **Access.** `useSettingsAccess("legal")`: an owner with an unlimited scope writes; every other member reads the page with `settings.legal.readOnly` and only "Xem nội dung".
- **Slots.** "Mục liên quan" names the customer consents and personal-data requests (phase 17a) and links to Cửa hàng for the legal form.

## Slots for later phases

`src/settings/pages.ts` declares every settings page once. An entry is `built` (with its lazy `load`), `planned` (a 10b page still to come) or `slot` (a page a later phase fills). A page without `load` renders the layout's placeholder, which names the page and its phase; a slot's placeholder also shows its `slotKey` line.

| Slot | Route | Phase | Keys |
|---|---|---|---|
| Cảnh báo | `#/cai-dat/canh-bao` | 12 | `settings.alerts.title`, `settings.alerts.slot` |
| Bản tin | `#/cai-dat/ban-tin` | 12 | `settings.digests.title`, `settings.digests.slot` |

The keys live in the shared `settings` file until phase 12 adds message files with the prefixes `settings.alerts.` and `settings.digests.` and moves them there; the i18n test allows no key in two files. To fill a slot, phase 12 sets the entry's `status` to `built` and gives it a `load`, so the layout, the menu and the route stay as they are. The access helper already separates the two kinds of alert writes: `alertRules` lets only owners with an unlimited scope edit rules, and `alertMutes` lets any owner or manager mute rules on their own destinations. Nhân viên (`#/cai-dat/nhan-vien`, 14a) and Cửa hàng và kết nối (`#/cai-dat/ket-noi`, 20a) stay unlisted until they are built; the customer-consent page (17a) is named on the Pháp lý page.

## Tests

| Test | What it proves |
|---|---|
| `web:settings/supabase-settings-source`, `web:settings/manual/supabase-manual-source` | each method's table, columns, order and pages; the upsert key of every table; the null store sent as null; refusals and their codes; a lost connection as `network` |
| `web:settings/demo-settings-source`, `web:settings/manual/demo-manual-source` | a round trip for every method on the demo store, the audit stamps, the legal lifecycle and the same refusals |
| `web:settings/use-settings-mutation` | every error message, the owner-only hours message only when the hours changed, the retry, invalidation of the settings, the analytics and Hôm nay's report after a success and after a mapping save that failed part way, and of nothing after another refusal |
| `web:settings/queries`, `web:settings/settings-source-context` | each read goes to its source with its key; both sources load together |
| `web:pages/settings/cua-hang-page`, `web:settings/store/store-fields` | the POS facts without a control, a round trip of every profile field and of the tenant block on the demo store, the audit line, the limits of code, seats, opening date and spans, the messages of `42501`, `23505`, `23514` and a lost connection, the read-only states of a manager, a store-limited owner, staff and a viewer, the receipt-numbering suggestion |
| `web:state/preferences`, `web:settings/tenant-default-language` | the tenant's default language only without a chosen one (an earlier version's unmarked Vietnamese included), the toggle winning and being stored as chosen |
| `e2e:demo/settings-cua-hang` | the page without a receipt suggestion, an incomplete span and a duplicate code refused, hours and seats saved for the young store bringing RevPASH to Giờ & ngày after an in-app navigation, a saved default language switching the session and the toggle winning, axe at 360 and 1280 px |
| `e2e:live/settings` | on the fixture tenant: the owner's profile save through row-level security with its audit line and the data's suggestion, the duplicate code, a manager's read-only hours and the owner's role in the audit line, a store-limited manager's one store, a day off added and deleted on Ngày lễ with the owner as `created_by` and `updated_by` and "Bạn" in its audit line, the Ngày report's same-weekday baseline losing that week on the next in-app view, an insert naming another member as `created_by` refused with `42501`, and a new session opening in the tenant's English |
| `web:settings/categories/categories`, `web:settings/categories/categories-form`, `web:settings/categories/use-uncategorised-sales`, `web:settings/payment-kinds/payment-kinds`, `web:settings/payment-kinds/payment-kinds-form`, `web:pages/settings/phan-loai-page` | one `data_quality_items` call per POS account over 90 days, the uncategorised items in sales order with an item sold by name, the loading and failed states, the search, only the item's own account's types, the changed rows with "Theo POS" as a delete, the cached list after a save, the catch-up started after a save and not after a refusal, the refusal messages and the retry, the read-only tabs |
| `e2e:demo/settings-phan-loai` | re-mapping the uncategorised demo item takes it out of Chưa phân loại on Thực đơn and into its new category, and a re-mapped payment method moves in Thanh toán's payment mix and back, all through the app's links without a reload; axe at 360 and 1280 px |
| `e2e:live/settings-phan-loai` | on the fixture tenant of #103: the item without a type re-mapped through the real tables, the kind override moving the method in Thanh toán, the catch-up banner appearing and clearing after each, both tabs read-only for staff and viewer |
| `e2e:live/settings-manual` | on the fixture tenant of #103, through PostgREST: the tenant-wide cost key, one statement per save, fee rates, the store-limited manager's scope, the store code, the opening hours and span refusals, the tenant profile, both override kinds, holidays and the legal lifecycle; in the browser (#161): five costs for store 1 on the Giá vốn tab reaching Thực đơn's margin card alone, a later cost leaving the earlier days at the earlier cost, and a store-limited manager writing their store and reading the costs for all stores; and for the legal texts: a text inserted as published or given a status by hand refused (`42501`), a published text frozen (`55000`), the next publication retiring the version in force at the same instant, a second publication or retirement of the same version refused (`22023`, `invalid`); the Pháp lý page publishing and retiring a draft with the database's dates, and a manager's read-only page; a small CSV import (#162) saving its two valid rows in one upsert, a lower-case store code and a blank first date included |
| `web:settings/manual/costs`, `web:settings/manual/cost-import`, `web:settings/manual/costs-tab`, `web:settings/manual/use-item-sales`, `web:pages/settings/du-lieu-nhap-tay-page`, `e2e:demo/settings-gia-von` | the Giá vốn tab and its CSV import: see [manual-data.md](manual-data.md#tests) |
| `web:pages/settings/ngay-le-page`, `web:settings/holidays/holidays`, `web:settings/validation` | the year select of 2024 to 2030 opening on the current year, the national days read-only with their Vietnamese names and kinds and the 2024 to 2028 note, a year without them, a day off added with its author and deleted, delete only on the tenant's own days, the name's 1 to 80 characters (combining marks counted once) and the calendar's dates checked before sending, a name the date already has held back (also when typed in another Unicode form), the database's duplicate message, the move to another year with the form, its focus and the status line kept, the retry after a lost connection emptying the form and moving the year, the focus on the heading after a delete or a retry, the read-only states of a store-limited manager, staff and a viewer, a year that could not be read |
| `web:settings/pages`, `web:pages/settings/settings-layout`, `web:settings/access` | one entry per page; Ngày lễ built; Cảnh báo and Bản tin as slots of phase 12 with their keys in the shared `settings` file and their placeholder line; Nhân viên and Cửa hàng và kết nối unlisted; `holidays`, `alertRules` and `alertMutes` access |
| `e2e:demo/settings-ngay-le` | the national days of 2026 read-only and labelled by kind, the years 2024 to 2030 (2029 without national days), a day off added on a Tuesday of the eight weeks before Ngày's day turning its chip into "so với mức nền (7/8 tuần)" and back after the delete, all through the app's links without a reload; the Cảnh báo and Bản tin placeholders inside the settings layout; axe at 360 and 1280 px in both colour schemes and the English text without raw keys |
| `web:settings/legal/legal-rules`, `web:settings/legal/markdown`, `web:settings/legal/markdown-preview`, `web:settings/legal/legal-editor`, `web:pages/settings/phap-ly-page` | the label's pattern and suggestion, the length limits, the skeleton equal to the demo engine's and made of headings only, the list order, the Markdown preview (numbered lists keeping their first number across blank lines, a heading's own `#`, links other than `http`, `https` and `mailto` shown without an anchor, no HTML, and 100,000 characters of each backtracking-prone input read and rendered within a time budget), the publish, retire and delete confirmations, no edit control on published or retired versions, the refusals, a publication, retirement or deletion made stale by a change elsewhere and the list read again, the focus back on the opening button, a round trip of draft, publication, replacement, retirement and deletion on the demo store, and the read-only page of a manager, a store-limited owner, staff and a viewer |
| `e2e:demo/settings-phap-ly` | the twelve lists with the demo's draft, a draft from the skeleton previewed, published after the confirmation and retired with the demo store's dates, the next version retiring the one in force, an English skeleton, a deleted draft, English without raw keys, axe at 360 and 1280 px in both colour schemes on the list, the editor and the preview, and at 1280 px on the confirmation |
