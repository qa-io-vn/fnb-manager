import { describe, expect, it } from "vitest";
import { reportKeys } from "../../../../src/model/keys.js";
import { buildCategoryMixCard } from "../../../../src/themes/menu/cards/category-mix.js";
import { menuKeys } from "../../../../src/themes/menu/keys.js";
import { menuCalls } from "../../../../src/themes/menu/support.js";
import { STORE_A } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import { cardInput, itemRow } from "./support.js";

describe("the Thực đơn category mix card", () => {
	it("shares item revenue by effective category, names the mover and flags the uncategorised item", () => {
		const card = buildCategoryMixCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[menuCalls.items]: [
					itemRow({
						item_external_id: "D1",
						net_amount: 6_000_000,
						compare_net_amount: 4_000_000,
					}),
					itemRow({
						item_external_id: "T1",
						item_type_external_id: "T-TOP",
						item_type_name: "Topping",
						role: "topping",
						net_amount: 3_000_000,
						compare_net_amount: 5_000_000,
					}),
					itemRow({
						item_external_id: "SN-001",
						item_type_external_id: null,
						item_type_name: null,
						role: null,
						net_amount: 1_000_000,
						compare_net_amount: 1_000_000,
					}),
				],
			}),
		);
		expect(card.headline.value).toBe(0.6);
		expect(card.tables[0]?.rows.map((row) => row.cells.category)).toEqual([
			"Trà sữa",
			"Topping",
			reportKeys.label.uncategorised,
		]);
		expect(card.tables[0]?.rows[0]?.cells.shareChange).toBe(0.2);
		expect(card.narrative.map((part) => part.key)).toEqual([
			menuKeys.categoryMix.main,
			"report.clause.driver.category",
		]);
		expect(card.notice).toEqual({
			tone: "info",
			part: {
				key: menuKeys.categoryMix.uncategorised,
				values: { items: { kind: "count", value: 1 } },
			},
			action: "settings_categories",
		});
	});

	it("says nothing sold and shows no notice without item sales", () => {
		const card = buildCategoryMixCard(
			cardInput(themeContext("28d", [STORE_A]), { [menuCalls.items]: [] }),
		);
		expect(card.headline.value).toBeNull();
		expect(card.narrative[0]?.key).toBe(menuKeys.categoryMix.noData);
		expect(card.notice).toBeNull();
		expect(card.chart).toBeNull();
	});
});
