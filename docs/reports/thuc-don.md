# Thực đơn — menu

Route `#/chu-de/thuc-don?range=<preset>` or `?from=…&to=…`, plus `&store=<id>,<id>` · title "Thực đơn" · default the last 28 days, at most 400 · built in phase 10a (#96, #97) on the range rules of [Doanh thu](doanh-thu.md#range) (ADR-035).

Thực đơn shows which items carry the menu: each item classed as star, plowhorse, puzzle or dog within its group (drinks, toppings, snacks…) and store, the margin of the items that have a cost, which items rise or fall, how categories and sizes mix, how often a drink comes with a topping or a snack, which items sell together, and which sugar and ice levels customers choose.

`W92` is the last `min(R.days, 92)` days of the range: `item_attach` and `basket_pairs` stop at 92 days, so their cards say "{days} ngày cuối kỳ" in the subtitle.

## Calls

| Key | Call |
|---|---|
| `coverage` | `store_coverage(S, R.from, R.to)` |
| `menu.<storeId>` | `menu_engineering([store], R.to)` for each selected store, because the method is per store; window, popularity factor and low-sample minimum from the tenant's settings (28 days, 0.7 and 10 by default) |
| `items` | `item_summary(S, R, R.prev)` |
| `margins` | `item_margins(S, R.from, R.to)` |
| `attach`, `attachPrevious` | `item_attach(S, W92)` and the same number of days just before |
| `pairs` | `basket_pairs(S, W92.from, W92.to, 3, 50)` |
| `modifiers` | `modifier_summary(S, R, R.prev)` |
| `settings` | `report_settings_of(S)` |
| `itemsCovered` (follow-up) | `item_summary(covered stores, R, R.prev)`, only while some selected stores have no history at `R.prev.from` |
| `attachCovered`, `attachPreviousCovered` (follow-up) | `item_attach` over the covered stores for both windows, only while some selected stores have no history at the window before |

`menu_engineering` and `item_margins` take each item's type and role from the POS, an override in Settings winning, and cost each store-day at the cost in force on its business date, a store's own cost before the tenant-wide one ([`schema.md`](../schema.md), "Effective category and role" and "Cost by business date").

## Cards

| Card | Headline | Chips | Sentence | Table and chart |
|---|---|---|---|---|
| Ma trận thực đơn (`menu_matrix`) | the stars among the drinks ("—" when no drink sold or no role is mapped) | — | how many drinks are stars (with several stores, each store is classed on its own and the count adds their classifications); while a role lacks costs, that it is classed on price for now; a low-sample note when a role has fewer items than the minimum | full width. The items table: item, class, group (when several groups are classed), store (when several stores are selected), quantity, share of the group's quantity, average price, unit cost, margin per item, "tạm tính"; ordered by group (drinks first), then class (Ngôi sao to Chó), then quantity, and opening on its first 20 rows with "Xem tất cả n dòng" for the rest (CSV and print hold every row). The per-group table: popularity line, the count of each class and the stars' share of the group's revenue. Stacked bars of each group's class mix as shares of its classed items (the counts are in the per-group table). Subtitle: the window and the factor |
| Biên lợi nhuận món (`margins`) | the gross margin rate of the costed items | — | the rate, the number of costed items and their share of item revenue | the items with a costed quantity: quantity, costed quantity and revenue, cost, unit cost (equal to the matrix's for the same days), margin, margin rate, cost coverage |
| Món tăng, món giảm (`movers`) | the top riser's quantity change, captioned with the item ("cùng cửa hàng (k/N)" when only some stores have the previous range) | — | the top riser and faller with their changes; the best-selling new item | trend (Tăng, Giảm, Mới), item, quantity this range and the previous one, change, revenue: up to 5 risers and 5 fallers that sold at least 10 in the previous range (risers also in this one) and 3 new items that sold at least 10, Tuần's thresholds. With some stores lacking the previous range the rows come from the covered stores |
| Cơ cấu nhóm món (`category_mix`) | the largest category's share of item revenue | — | the largest category and its share; the category whose share moved most (points) | category ("Chưa phân loại" for items without one), group, revenue, share, previous share, change in points, quantity, on effective categories (an override in Settings winning); grouped bars of the shares, this range and the previous one |
| Cơ cấu size (`size_mix`) | the L share of the quantity sold by size | the previous range, in points (like for like over the covered stores; "chưa có dữ liệu kỳ trước" when no store has it) | the L share, up or down in points; the drink whose L share moved most among drinks with at least 10 sized in both ranges | Tháng's table per base drink: L quantity, sized quantity, L share, previous share, change in points, opening on 10 rows; bars of the L share of the 10 best-selling drinks, this range and the previous one |
| Tỷ lệ kèm topping và đồ ăn nhẹ (`attach`) | the topping rate of the invoices with a drink in `W92`, captioned with the snack rate | topping and snack rates against the window before, in points (like for like over the covered stores) | the topping rate, up or down in points; the drink with the highest topping rate among drinks on at least 20 invoices | per drink: invoices with the drink, topping rate, snack rate, opening on 10 rows; bars of the topping rate of the 10 drinks on most invoices. Subtitle `W92` |
| Món hay bán cùng nhau (`pairs`) | the invoices of the top pair, captioned "A + B" | — | the top pair, its invoices and lift, as a combo to try | the top 20 pairs: item 1, item 2, invoices with both, confidence both ways, lift, opening on 10 rows. Subtitle `W92` |
| Đường và đá (`preferences`) | the most chosen sugar level's share among sugar choices, captioned with the level | — | the most chosen sugar and ice levels with their shares; the level whose share moved most (points) | sugar levels with the other options (kind "Khác") in the first table and ice levels in the second: option, times chosen, share within its kind, previous share, change in points; grouped bars of each sugar and ice level's share, this range and the previous one. Names are grouped by `classifyModifier` (`@fnb/core`) |

The class names (Ngôi sao, Ngựa kéo cày, Câu đố, Chó) are message keys the owner may rename during the wording review. CSV files are named `thuc-don-<card>-<from>_<to>.csv` and a card's second table `thuc-don-<card>-<from>_<to>-2.csv` (the matrix's per-group table; the ice levels when sugar levels or other options come first), UTF-8 with a BOM; the dates are the page's range, while the matrix covers the menu window and the attach and pairs cards cover `W92`, all ending on its last day. Item cards read item lines only (`agg_item_daily`, `item_margins`, `menu_engineering`, `item_attach`, `basket_pairs`), so no modifier name appears in their tables; only Đường và đá lists modifier levels, on purpose.

## States and markers

- **No costs.** The matrix places every group without a cost for each item on price and is marked provisional ("tạm tính"); the margins card says no item has a cost and links to Cài đặt → Giá vốn ("Nhập giá vốn").
- **Costs starting mid-range.** The margins card adds a notice with the share of the costed items' revenue that the costs cover.
- **No roles.** When no item type has a role the matrix shows no classes, leaves the headline at "—" and links to Cài đặt → Phân loại to give item types a role.
- **Previous range missing.** Without history at the previous range's first day for any selected store, Món tăng, món giảm says so in a notice and ranks nothing, and the size and attach chips read "chưa có dữ liệu kỳ trước"; with only some stores covered they compare those stores.
- **Uncategorised items.** An item without a category (the demo's dressed item `SN-001`) is listed as "Chưa phân loại" in the category mix, with a notice and the "Phân loại món" link (Cài đặt → Phân loại → Nhóm món).
- **Roles for attach rates.** A rate is "—" while no POS account of the selected stores maps its role; the attach card then links to Cài đặt → Phân loại, naming the drink role when items sell but none is a drink, both rates when neither is mapped, or the one missing. A store whose account lacks the role does not count towards that rate (ADR-036). A measured zero shows as 0 %.
- **Nothing sized, no pair, no options.** Cơ cấu size says no item is sold by size; Món hay bán cùng nhau explains that a pair needs 3 invoices; Đường và đá says no sugar or ice option was recorded.
- **No data.** Without item sales the cards say so and show "—".

## Tests

- Unit: `packages/reports/test/unit/themes/menu/menu-matrix.test.ts` and `margins.test.ts` (stars and shares, the provisional and low-sample sentences, no roles, no drink, several stores, the settings window when nothing sold; costed rows only, the rate over costed revenue, no costs, a cost starting mid-range, an item without revenue and a measured zero); `movers.test.ts` (the thresholds, covered stores only, no previous range, nothing qualifying), `category-mix.test.ts` (the uncategorised row and its action, the driver, no data), `size-mix.test.ts` (the L share and its points, like for like, a young store, nothing sized), `attach.test.ts` (both rates and chips, the top drink at 20 invoices, a measured zero, unmapped roles, the 92-day window), `pairs.test.ts` (top 20, names falling back to keys, no pair) and `preferences.test.ts` (shares within each kind, other options apart, ice alone, other options only, no options); `calls.test.ts` (the windows and the covered-store follow-ups). `classifyModifier` is held by `packages/core/test/unit/item-role.test.ts`.
- Demo engine: `packages/demo-analytics/test/themes/menu.smoke.test.ts` (three store selections, four presets, every key and placeholder in both languages, the provisional matrix and the costs notice of the demo, no modifier name in an item table, the uncategorised item with its action, the attach rates and both sugar and ice tables).
- Parity: `menu_engineering`, `item_margins`, `item_attach` and `item_summary` in `menu.parity.test.ts`; `basket_pairs` and `modifier_summary` in `basket-modifiers.parity.test.ts`.
- pgTAP: `33_theme_functions.sql`, `34_theme_access.sql` and `35_mappings_and_catch_up.sql`.
- Playwright: `e2e/demo/theme-thuc-don.spec.ts` (the eight cards settle, the provisional matrix and the costs link, the item table's 20-row preview, its "Xem tất cả" toggle and every row in print, the CSV of every table, no modifier name outside Đường và đá, the uncategorised item with the "Phân loại món" link, the attach rates with both chips, print, axe at 360 and 1280 px, no external request, English) and `e2e/live/themes.spec.ts` (the margins headline on the seeded costs).
