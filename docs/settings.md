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
| Tenant profile | `tenantProfile` (legal form, default language) | `updateTenantProfile` | `tenants`, update of `legal_form` and `default_language` |
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

## Queries

`apps/web/src/settings/queries.ts` has one hook per read: `useMembership`, `useItemTypes`, `useReportSettings`, `useCatchUpStatus`, `useTenantProfile`, `useStoreProfiles`, `useItems`, `usePaymentMethods`, `useFeeRates`, `useHolidays(year)`, `useItemCosts`, `useTargets` and `useLegalDocuments`.

Their keys are `["settings", sourceKind, tenantId, area, ...parts]`, with the year as a part for holidays. So `invalidateSettings(queryClient, tenantId)` drops every settings read of the tenant at once.

## The demo's rows

- **Order.** Lists come back in the live order (costs by item, store with tenant-wide first, date; fee rates by method, store, date; targets by store, period kind, start; legal texts by kind, language, version), so a page shows a new row in the same place in both modes.
- **Ids.** Demo rows have no database ids. Each row's id is built from its key, such as `fee:<store>:<method>:<date>`. A legal draft's id follows its version, so a draft whose version is changed comes back under a new id.
- **Audit line.** It shows "you" with the time of the session's last save that changed that row. Rows from the demo's defaults have none, and a save that changes nothing stamps nothing, as the profile triggers do live.
- **Legal texts.** Publication and retirement follow the database's functions. Publishing a draft retires the text it replaces, and a published or retired text is never edited or deleted.

## Tests

| Test | What it proves |
|---|---|
| `web:settings/supabase-settings-source`, `web:settings/manual/supabase-manual-source` | each method's table, columns, order and pages; the upsert key of every table; the null store sent as null; refusals and their codes; a lost connection as `network` |
| `web:settings/demo-settings-source`, `web:settings/manual/demo-manual-source` | a round trip for every method on the demo store, the audit stamps, the legal lifecycle and the same refusals |
| `web:settings/use-settings-mutation` | every error message, the owner-only hours message only when the hours changed, the retry, invalidation only after a success |
| `web:settings/queries`, `web:settings/settings-source-context` | each read goes to its source with its key; both sources load together |
| `e2e:live/settings-manual` | on the fixture tenant of #103, through PostgREST: the tenant-wide cost key, one statement per save, fee rates, the store-limited manager's scope, the store code, the opening hours and span refusals, the tenant profile, both override kinds, holidays and the legal lifecycle |
