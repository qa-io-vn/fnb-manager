import { describe, expect, it } from "vitest";
import { buildMarginsCard } from "../../../../src/themes/menu/cards/margins.js";
import { menuKeys } from "../../../../src/themes/menu/keys.js";
import { menuCalls } from "../../../../src/themes/menu/support.js";
import { STORE_A } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import { cardInput, marginRow } from "./support.js";

function card(rows: readonly unknown[]) {
	return buildMarginsCard(
		cardInput(themeContext("28d", [STORE_A]), { [menuCalls.margins]: rows }),
	);
}

describe("the Thực đơn margins card", () => {
	it("lists only the costed items and reads the rate over their costed revenue", () => {
		const margins = card([
			marginRow({ item_external_id: "D1" }),
			marginRow({
				item_external_id: "D2",
				net_amount: 1_000_000,
				costed_quantity: 0,
				costed_net_amount: 0,
				cost_amount: null,
				margin_amount: null,
				margin_rate: null,
				cost_coverage: 0,
			}),
		]);
		expect(margins.headline.value).toBe(0.375);
		expect(margins.tables[0]?.rows.map((row) => row.id)).toEqual(["D1"]);
		expect(margins.tables[0]?.rows[0]?.cells.unitCost).toBe(25_000);
		expect(margins.narrative[0]).toEqual({
			key: menuKeys.margins.rate,
			values: {
				rate: { kind: "percent", value: 0.375 },
				items: { kind: "count", value: 1 },
				share: { kind: "percent", value: 0.8 },
			},
		});
		expect(margins.notice).toBeNull();
	});

	it("asks for costs when no item has one", () => {
		const margins = card([
			marginRow({
				costed_quantity: 0,
				costed_net_amount: 0,
				cost_amount: null,
				margin_amount: null,
				margin_rate: null,
				cost_coverage: 0,
			}),
		]);
		expect(margins.headline.value).toBeNull();
		expect(margins.tables).toEqual([]);
		expect(margins.notice?.action).toBe("settings_costs");
		expect(margins.narrative[0]?.key).toBe(menuKeys.margins.noCost);
	});

	it("notes the covered share when a cost starts inside the range", () => {
		const margins = card([
			marginRow({
				quantity: 100,
				costed_quantity: 50,
				net_amount: 4_000_000,
				costed_net_amount: 2_000_000,
				cost_amount: 1_250_000,
				margin_amount: 750_000,
				margin_rate: 0.375,
				cost_coverage: 0.5,
			}),
		]);
		expect(margins.notice?.part).toEqual({
			key: menuKeys.margins.partial,
			values: { share: { kind: "percent", value: 0.5 } },
		});
	});

	it("raises no partial notice for a fully costed item without revenue and keeps a measured zero", () => {
		const margins = card([
			marginRow({
				net_amount: 0,
				costed_net_amount: 0,
				cost_amount: 0,
				margin_amount: 0,
				margin_rate: null,
				cost_coverage: null,
			}),
			marginRow({
				item_external_id: "D2",
				cost_amount: 4_000_000,
				margin_amount: 0,
				margin_rate: 0,
			}),
		]);
		expect(margins.notice).toBeNull();
		expect(margins.headline.value).toBe(0);
	});
});
