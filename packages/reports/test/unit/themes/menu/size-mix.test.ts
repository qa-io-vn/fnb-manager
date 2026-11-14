import { describe, expect, it } from "vitest";
import { buildSizeMixCard } from "../../../../src/themes/menu/cards/size-mix.js";
import { menuKeys } from "../../../../src/themes/menu/keys.js";
import { menuCalls } from "../../../../src/themes/menu/support.js";
import { coverageRow, STORE_A, STORE_B } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import { cardInput, itemRow } from "./support.js";

const sized = [
	itemRow({
		item_external_id: "D1-M",
		item_name: "Trà đào (M)",
		base_name: "Trà đào",
		size_label: "M",
		quantity: 60,
		compare_quantity: 50,
	}),
	itemRow({
		item_external_id: "D1-L",
		item_name: "Trà đào (L)",
		base_name: "Trà đào",
		size_label: "L",
		quantity: 40,
		compare_quantity: 50,
	}),
	itemRow({ item_external_id: "T1", size_label: null, quantity: 500 }),
];

describe("the Thực đơn size mix card", () => {
	it("measures the L share of sized items against the previous range in points", () => {
		const card = buildSizeMixCard(
			cardInput(themeContext("28d", [STORE_A]), { [menuCalls.items]: sized }, [
				coverageRow(STORE_A),
			]),
		);
		expect(card.headline.value).toBe(0.4);
		expect(card.comparisons).toHaveLength(1);
		expect(card.comparisons[0]?.reference).toBe(0.5);
		expect(card.comparisons[0]?.difference).toBe(-0.1);
		expect(card.narrative[0]?.key).toBe(menuKeys.sizeMix.down);
		expect(card.narrative[0]?.values.points).toEqual({
			kind: "pointMagnitude",
			value: 10,
		});
		expect(card.narrative[1]?.key).toBe("report.clause.driver.item");
		expect(card.tables[0]?.rows.map((row) => row.cells)).toEqual([
			{
				drink: "Trà đào",
				largeQuantity: 40,
				sizedQuantity: 100,
				largeShare: 0.4,
				previousShare: 0.5,
				change: -0.1,
			},
		]);
		expect(card.tables[0]?.previewRows).toBe(10);
	});

	it("compares like for like over the covered stores", () => {
		const context = themeContext("28d", [STORE_A, STORE_B]);
		const card = buildSizeMixCard(
			cardInput(
				context,
				{
					[menuCalls.items]: sized,
					[menuCalls.itemsCovered]: sized.slice(0, 1),
				},
				[
					coverageRow(STORE_A),
					coverageRow(STORE_B, { history_start: context.range.to }),
				],
			),
		);
		expect(card.comparisons[0]?.basis).toBe("like_for_like");
		expect(card.comparisons[0]?.current).toBe(0);
		expect(card.comparisons[0]?.reference).toBe(0);
	});

	it("marks the chip unavailable for a store too young for the previous range", () => {
		const context = themeContext("28d", [STORE_A]);
		const card = buildSizeMixCard(
			cardInput(context, { [menuCalls.items]: sized }, [
				coverageRow(STORE_A, { history_start: context.range.from }),
			]),
		);
		expect(card.comparisons[0]?.unavailable).toBe("store_too_young");
		expect(card.narrative[0]?.key).toBe(menuKeys.sizeMix.noReference);
	});

	it("says nothing is sized when no item has a size", () => {
		const card = buildSizeMixCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[menuCalls.items]: [itemRow({ size_label: null })],
			}),
		);
		expect(card.headline.value).toBeNull();
		expect(card.notice?.part.key).toBe(menuKeys.sizeMix.none);
		expect(card.narrative[0]?.key).toBe(menuKeys.sizeMix.noData);
		expect(card.chart).toBeNull();
	});
});
