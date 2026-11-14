import { describe, expect, it } from "vitest";
import { buildPairsCard } from "../../../../src/themes/menu/cards/pairs.js";
import { menuKeys } from "../../../../src/themes/menu/keys.js";
import { menuCalls } from "../../../../src/themes/menu/support.js";
import { STORE_A } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import { cardInput, pairRow } from "./support.js";

describe("the Thực đơn pairs card", () => {
	it("leads with the top pair and lists the first 20 pairs as combo candidates", () => {
		const rows = Array.from({ length: 25 }, (_, index) =>
			pairRow({
				item_a_external_id: `A${String(index).padStart(2, "0")}`,
				pair_invoices: 30 - index,
			}),
		);
		const card = buildPairsCard(
			cardInput(themeContext("28d", [STORE_A]), { [menuCalls.pairs]: rows }),
		);
		expect(card.headline.value).toBe(30);
		expect(card.headline.unit).toBe("count");
		expect(card.headline.caption?.key).toBe(menuKeys.pairs.caption);
		expect(card.narrative[0]?.key).toBe(menuKeys.pairs.main);
		expect(card.narrative[0]?.values.lift).toEqual({
			kind: "decimal",
			value: 2.5,
		});
		expect(card.tables[0]?.rows).toHaveLength(20);
		expect(card.tables[0]?.rows[0]?.cells).toEqual({
			itemA: "Trà đào",
			itemB: "Trân châu",
			pairInvoices: 30,
			confidenceAB: 0.2,
			confidenceBA: 0.3,
			lift: 2.5,
		});
		expect(card.notice).toBeNull();
	});

	it("falls back to the item keys when a name is missing", () => {
		const card = buildPairsCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[menuCalls.pairs]: [pairRow({ item_a_name: null, item_b_name: null })],
			}),
		);
		expect(card.tables[0]?.rows[0]?.cells.itemA).toBe("D1");
		expect(card.tables[0]?.rows[0]?.cells.itemB).toBe("T1");
	});

	it("explains the three-invoice minimum when no pair qualifies", () => {
		const card = buildPairsCard(
			cardInput(themeContext("28d", [STORE_A]), { [menuCalls.pairs]: [] }),
		);
		expect(card.headline.value).toBeNull();
		expect(card.narrative[0]?.key).toBe(menuKeys.pairs.none);
		expect(card.notice?.part).toEqual({
			key: menuKeys.pairs.minimum,
			values: { minimum: { kind: "count", value: 3 } },
		});
		expect(card.tables).toEqual([]);
	});
});
