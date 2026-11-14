# Thực đơn — menu

Route `#/chu-de/thuc-don?range=<preset>` or `?from=…&to=…`, plus `&store=<id>,<id>` · title "Thực đơn" · default the last 28 days, at most 400 · built in phase 10a (#96) on the range rules of [Doanh thu](doanh-thu.md#range) (ADR-035).

Thực đơn shows which items carry the menu: each item classed as star, plowhorse, puzzle or dog within its group (drinks, toppings, snacks…) and store, and the margin of the items that have a cost. Movers, category and size mix, attach rates, items sold together and sugar and ice choices join in #97.

## Calls

| Key | Call |
|---|---|
| `coverage` | `store_coverage(S, R.from, R.to)` |
| `menu.<storeId>` | `menu_engineering([store], R.to)` for each selected store, because the method is per store; window, popularity factor and low-sample minimum from the tenant's settings (28 days, 0.7 and 10 by default) |
| `items` | `item_summary(S, R, R.prev)`, read by the cards of #97 |
| `margins` | `item_margins(S, R.from, R.to)` |
| `settings` | `report_settings_of(S)` |

`menu_engineering` and `item_margins` take each item's type and role from the POS, an override in Settings winning, and cost each store-day at the cost in force on its business date, a store's own cost before the tenant-wide one ([`schema.md`](../schema.md), "Effective category and role" and "Cost by business date").

## Cards

| Card | Headline | Chips | Sentence | Table and chart |
|---|---|---|---|---|
| Ma trận thực đơn (`menu_matrix`) | the stars among the drinks ("—" when no drink sold or no role is mapped) | — | how many drinks are stars (with several stores, each store is classed on its own and the count adds their classifications); while a role lacks costs, that it is classed on price for now; a low-sample note when a role has fewer items than the minimum | full width. The items table: item, class, group (when several groups are classed), store (when several stores are selected), quantity, share of the group's quantity, average price, unit cost, margin per item, "tạm tính"; ordered by group (drinks first), then class (Ngôi sao to Chó), then quantity, and opening on its first 20 rows with "Xem tất cả n dòng" for the rest (CSV and print hold every row). The per-group table: popularity line, the count of each class and the stars' share of the group's revenue. Stacked bars of each group's class mix as shares of its classed items (the counts are in the per-group table). Subtitle: the window and the factor |
| Biên lợi nhuận món (`margins`) | the gross margin rate of the costed items | — | the rate, the number of costed items and their share of item revenue | the items with a costed quantity: quantity, costed quantity and revenue, cost, unit cost (equal to the matrix's for the same days), margin, margin rate, cost coverage |

The class names (Ngôi sao, Ngựa kéo cày, Câu đố, Chó) are message keys the owner may rename during the wording review. CSV files are named `thuc-don-<card>-<from>_<to>.csv` and the matrix's second table `thuc-don-menu_matrix-<from>_<to>-2.csv`, UTF-8 with a BOM; the dates are the page's range, while the matrix covers the menu window that ends on its last day.

## States and markers

- **No costs.** The matrix places every group without a cost for each item on price and is marked provisional ("tạm tính"); the margins card says no item has a cost and links to Cài đặt → Giá vốn ("Nhập giá vốn").
- **Costs starting mid-range.** The margins card adds a notice with the share of the costed items' revenue that the costs cover.
- **No roles.** When no item type has a role the matrix shows no classes, leaves the headline at "—" and links to Cài đặt → Phân loại to give item types a role.
- **No data.** Without item sales the cards say so and show "—".

## Tests

- Unit: `packages/reports/test/unit/themes/menu/menu-matrix.test.ts` and `margins.test.ts` (stars and shares, the provisional and low-sample sentences, no roles, no drink, several stores, the settings window when nothing sold; costed rows only, the rate over costed revenue, no costs, a cost starting mid-range, an item without revenue and a measured zero).
- Demo engine: `packages/demo-analytics/test/themes/menu.smoke.test.ts` (three store selections, four presets, every key and placeholder in both languages, the provisional matrix and the costs notice of the demo).
- Parity: `menu_engineering`, `item_margins`, `item_attach` and `item_summary` in `menu.parity.test.ts`; `basket_pairs` and `modifier_summary` in `basket-modifiers.parity.test.ts`.
- pgTAP: `33_theme_functions.sql`, `34_theme_access.sql` and `35_mappings_and_catch_up.sql`.
- Playwright: `e2e/demo/theme-thuc-don.spec.ts` (cards settle, the provisional matrix and the costs link, the item table's 20-row preview, its "Xem tất cả" toggle and every row in print, CSV, print, axe at 360 and 1280 px, no external request, English) and `e2e/live/themes.spec.ts` (the margins headline on the seeded costs).
