import { describe, expect, it } from "vitest";
import { buildPreferencesCard } from "../../../../src/themes/menu/cards/preferences.js";
import { menuKeys } from "../../../../src/themes/menu/keys.js";
import { menuCalls } from "../../../../src/themes/menu/support.js";
import { STORE_A } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import { cardInput, modifierRow } from "./support.js";

function build(rows: Parameters<typeof modifierRow>[0][]) {
	return buildPreferencesCard(
		cardInput(themeContext("28d", [STORE_A]), {
			[menuCalls.modifiers]: rows.map(modifierRow),
		}),
	);
}

describe("the Thực đơn sugar and ice card", () => {
	it("shares each level within its family, keeps other options apart and names the biggest shift", () => {
		const card = build([
			{ modifier_name: "70% Đường", lines: 30, compare_lines: 10 },
			{ modifier_name: "50% Đường", lines: 10, compare_lines: 30 },
			{ modifier_name: "0% Đá", lines: 20, compare_lines: 20 },
			{ modifier_name: "Thêm trân châu", lines: 5, compare_lines: 0 },
		]);
		expect(card.headline.value).toBe(0.75);
		expect(card.headline.caption?.values.level).toEqual({
			kind: "text",
			value: "70% Đường",
		});
		expect(card.narrative.map((part) => part.key)).toEqual([
			menuKeys.preferences.main,
			"report.clause.driver.item",
		]);
		expect(card.tables.map((table) => table.captionKey)).toEqual([
			menuKeys.preferences.sugarTable,
			menuKeys.preferences.iceTable,
		]);
		expect(card.tables[0]?.columns.map((column) => column.key)).toContain(
			"family",
		);
		expect(card.tables[1]?.columns.map((column) => column.key)).not.toContain(
			"family",
		);
		expect(card.tables[0]?.rows.map((row) => row.cells)).toEqual([
			{
				level: "70% Đường",
				family: menuKeys.family.sugar,
				lines: 30,
				familyShare: 0.75,
				previousShare: 0.25,
				change: 0.5,
			},
			{
				level: "50% Đường",
				family: menuKeys.family.sugar,
				lines: 10,
				familyShare: 0.25,
				previousShare: 0.75,
				change: -0.5,
			},
			{
				level: "Thêm trân châu",
				family: menuKeys.family.other,
				lines: 5,
				familyShare: 1,
				previousShare: null,
				change: null,
			},
		]);
		expect(card.chart?.categories).toHaveLength(3);
		expect(card.notice).toBeNull();
	});

	it("reads the ice levels alone when no sugar level was chosen", () => {
		const card = build([
			{ modifier_name: "Ít đá", lines: 4, compare_lines: 2 },
		]);
		expect(card.headline.value).toBeNull();
		expect(card.narrative[0]?.key).toBe(menuKeys.preferences.iceOnly);
		expect(card.tables.map((table) => table.captionKey)).toEqual([
			menuKeys.preferences.iceTable,
		]);
	});

	it("says no sugar or ice was recorded when only other options exist", () => {
		const card = build([
			{ modifier_name: "Thêm kem", lines: 3, compare_lines: 1 },
		]);
		expect(card.narrative[0]?.key).toBe(menuKeys.preferences.otherOnly);
		expect(card.notice?.part.key).toBe(menuKeys.preferences.none);
		expect(card.chart).toBeNull();
	});

	it("says nothing was chosen without modifier lines", () => {
		const card = build([]);
		expect(card.headline.value).toBeNull();
		expect(card.narrative[0]?.key).toBe(menuKeys.preferences.noData);
		expect(card.tables).toEqual([]);
	});
});
