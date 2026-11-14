import { describe, expect, it } from "vitest";
import { buildMatrixCard } from "../../../../src/themes/menu/cards/matrix.js";
import { menuKeys } from "../../../../src/themes/menu/keys.js";
import { menuCallKey } from "../../../../src/themes/menu/support.js";
import { STORE_A, STORE_B } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import { cardInput, menuRow } from "./support.js";

const settings = [{ menu_window_days: 21, menu_popularity_factor: 0.75 }];

describe("the Thực đơn matrix card", () => {
	it("counts the drink stars, keeps a provisional role marked and draws stacked classes", () => {
		const card = buildMatrixCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[menuCallKey(STORE_A)]: [
					menuRow({ item_external_id: "D1", menu_class: "star" }),
					menuRow({
						item_external_id: "D2",
						menu_class: "dog",
						net_amount: 1_000_000,
					}),
					menuRow({
						role: "topping",
						item_external_id: "T1",
						menu_class: "plowhorse",
					}),
				],
				settings,
			}),
		);
		expect(card.headline.value).toBe(1);
		expect(card.markers.provisional).toBe(true);
		expect(card.narrative.map((sentence) => sentence.key)).toEqual([
			menuKeys.matrix.stars,
			menuKeys.matrix.provisional,
			menuKeys.matrix.lowSample,
		]);
		expect(card.tables).toHaveLength(2);
		expect(card.tables[0]?.rows.map((row) => row.cells.state)).toEqual([
			menuKeys.matrix.provisionalCell,
			menuKeys.matrix.provisionalCell,
			menuKeys.matrix.provisionalCell,
		]);
		const drinkShares = card.tables[1]?.rows
			.filter((row) => row.id.startsWith("drink|"))
			.map((row) => [row.id, row.cells.items, row.cells.netShare]);
		expect(drinkShares).toEqual([
			["drink|star", 1, 0.8],
			["drink|plowhorse", 0, 0],
			["drink|puzzle", 0, 0],
			["drink|dog", 1, 0.2],
		]);
		expect(
			card.chart?.series.map((series) => [series.stack, series.values]),
		).toEqual([
			["classes", [1, 0]],
			["classes", [0, 1]],
			["classes", [0, 0]],
			["classes", [1, 0]],
		]);
		expect(card.subtitle?.key).toBe(menuKeys.matrix.subtitle);
	});

	it("shows the roles action and no classes when no item type has a role", () => {
		const card = buildMatrixCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[menuCallKey(STORE_A)]: [
					menuRow({ role: "other", role_mapped: false, menu_class: "star" }),
				],
				settings,
			}),
		);
		expect(card.headline.value).toBeNull();
		expect(card.tables).toEqual([]);
		expect(card.chart).toBeNull();
		expect(card.notice?.action).toBe("settings_roles");
		expect(card.narrative.map((sentence) => sentence.key)).toEqual([
			menuKeys.matrix.unmapped,
		]);
		expect(card.markers.provisional).toBe(false);
	});

	it("leaves the headline empty when roles are mapped but no drink sold", () => {
		const card = buildMatrixCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[menuCallKey(STORE_A)]: [
					menuRow({ role: "snack", provisional: false }),
				],
				settings,
			}),
		);
		expect(card.headline.value).toBeNull();
		expect(card.narrative[0]?.key).toBe(menuKeys.matrix.noStars);
	});

	it("reads one call per store and says each store is classed on its own", () => {
		const card = buildMatrixCard(
			cardInput(themeContext("28d", [STORE_A, STORE_B]), {
				[menuCallKey(STORE_A)]: [menuRow({ menu_class: "star" })],
				[menuCallKey(STORE_B)]: [menuRow({ menu_class: "dog" })],
				settings,
			}),
		);
		expect(card.headline.value).toBe(1);
		expect(card.narrative[0]?.key).toBe(menuKeys.matrix.starsStores);
		expect(card.tables[0]?.columns[0]?.key).toBe("store");
		expect(card.tables[0]?.rows).toHaveLength(2);
	});

	it("names the settings window when nothing sold", () => {
		const card = buildMatrixCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[menuCallKey(STORE_A)]: [],
				settings,
			}),
		);
		expect(card.headline.value).toBeNull();
		expect(card.narrative[0]).toEqual({
			key: menuKeys.matrix.noData,
			values: { days: { kind: "count", value: 21 } },
		});
		expect(card.subtitle?.values.factor).toEqual({
			kind: "decimal",
			value: 0.75,
		});
	});
});
