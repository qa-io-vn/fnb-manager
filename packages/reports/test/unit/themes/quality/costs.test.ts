import { describe, expect, it } from "vitest";
import { buildCostsCard } from "../../../../src/themes/quality/cards/costs.js";
import { qualityKeys } from "../../../../src/themes/quality/keys.js";
import {
	COST_TABLE_ITEMS,
	qualityCalls,
} from "../../../../src/themes/quality/support.js";
import { STORE_A } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import {
	cardInput,
	type ItemRow,
	itemRow,
	type MarginRow,
	marginRow,
} from "./support.js";

function card(rows: readonly ItemRow[], margins: readonly MarginRow[]) {
	return buildCostsCard(
		cardInput(themeContext("28d", [STORE_A]), {
			[qualityCalls.items]: rows,
			[qualityCalls.margins]: margins,
		}),
	);
}

describe("the Chất lượng dữ liệu cost card", () => {
	it("reads cost_coverage as item_margins does, each store-day costed on its own date, and lists the items without a cost today", () => {
		const model = card(
			[
				itemRow({ item_external_id: "A", net_amount: 600_000 }),
				itemRow({
					item_external_id: "B",
					item_name: "Bánh",
					cost_known: false,
					net_amount: 400_000,
					quantity: 8,
				}),
				itemRow({
					item_external_id: "M",
					cost_known: false,
					catalogue_modifier: true,
					net_amount: 0,
				}),
			],
			[
				marginRow({
					item_external_id: "A",
					net_amount: 600_000,
					costed_net_amount: 450_000,
				}),
				marginRow({
					item_external_id: "B",
					net_amount: 400_000,
					costed_net_amount: 0,
				}),
			],
		);
		expect(model.metricId).toBe("cost_coverage");
		expect(model.headline).toEqual({
			value: 0.45,
			unit: "fraction",
			caption: null,
		});
		expect(model.narrative).toEqual([
			{
				key: qualityKeys.costs.coverage,
				values: {
					range: expect.anything(),
					coverage: { kind: "percent", value: 0.45 },
				},
			},
			{
				key: qualityKeys.costs.main,
				values: {
					count: { kind: "count", value: 1 },
					share: { kind: "percent", value: 0.4 },
				},
			},
		]);
		expect(model.tables[0]?.rows.map((row) => row.cells)).toEqual([
			{
				item: "Bánh",
				quantity: 8,
				netAmount: 400_000,
				share: 0.4,
				fix: qualityKeys.fix.settings.cost,
			},
		]);
		expect(model.notice?.action).toBe("settings_costs");
		expect(model.markers.stale).toBe(false);
	});

	it("shows the share Thực đơn shows when a cost starts on day 20 of 28, though every item has a cost on the last day", () => {
		const model = card(
			[itemRow({ item_external_id: "A", net_amount: 1_000_000 })],
			[
				marginRow({
					item_external_id: "A",
					net_amount: 1_000_000,
					costed_net_amount: 321_429,
				}),
			],
		);
		expect(model.headline.value).toBe(0.321429);
		expect(model.narrative.map((entry) => entry.key)).toEqual([
			qualityKeys.costs.coverage,
			qualityKeys.costs.none,
		]);
		expect(model.tables).toEqual([]);
		expect(model.notice?.action).toBe("settings_costs");
	});

	it(`keeps the ${COST_TABLE_ITEMS} largest items without a cost, largest first`, () => {
		const rows = Array.from({ length: 25 }, (_, index) =>
			itemRow({
				item_external_id: `I${String(index).padStart(2, "0")}`,
				cost_known: false,
				net_amount: (index + 1) * 1_000,
			}),
		);
		const model = card(rows, [
			marginRow({ net_amount: 325_000, costed_net_amount: 0 }),
		]);
		expect(model.headline.value).toBe(0);
		const amounts = model.tables[0]?.rows.map((row) => row.cells.netAmount);
		expect(amounts).toHaveLength(COST_TABLE_ITEMS);
		expect(amounts?.[0]).toBe(25_000);
		expect(amounts?.at(-1)).toBe(6_000);
		expect(model.narrative[1]?.values.count).toEqual({
			kind: "count",
			value: 25,
		});
	});

	it("says every item is costed without a table or a notice", () => {
		const model = card(
			[itemRow({ item_external_id: "A" })],
			[marginRow({ costed_net_amount: 1_000_000 })],
		);
		expect(model.headline.value).toBe(1);
		expect(model.narrative[1]?.key).toBe(qualityKeys.costs.none);
		expect(model.tables).toEqual([]);
		expect(model.notice).toBeNull();
	});

	it("shows a dash and a plain sentence when nothing was sold", () => {
		const model = card([], []);
		expect(model.headline.value).toBeNull();
		expect(model.narrative.map((entry) => entry.key)).toEqual([
			qualityKeys.costs.noData,
		]);
		expect(model.notice).toBeNull();
	});
});
