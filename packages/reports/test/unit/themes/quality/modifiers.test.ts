import { describe, expect, it } from "vitest";
import { buildModifiersCard } from "../../../../src/themes/quality/cards/modifiers.js";
import { qualityKeys } from "../../../../src/themes/quality/keys.js";
import { qualityCalls } from "../../../../src/themes/quality/support.js";
import { STORE_A, STORE_B } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import { cardInput, type SummaryRow, summaryRow } from "./support.js";

function card(rows: readonly SummaryRow[]) {
	return buildModifiersCard(
		cardInput(themeContext("28d", [STORE_A, STORE_B]), {
			[qualityCalls.summary]: rows,
		}),
	);
}

describe("the Chất lượng dữ liệu modifier card", () => {
	it("reads the modifier line share and shows 0 catalogue modifiers sold as items per store, without a hint (acceptance A2)", () => {
		const model = card([
			summaryRow(null, { modifier_line_share: 0.2 }),
			summaryRow(STORE_A),
			summaryRow(STORE_B, { modifier_line_share: 0.1 }),
		]);
		expect(model.metricId).toBe("modifier_line_share");
		expect(model.headline.value).toBe(0.2);
		expect(model.narrative.map((entry) => entry.key)).toEqual([
			qualityKeys.modifiers.main,
			qualityKeys.modifiers.catalogueNone,
		]);
		expect(model.tables[0]?.rows.map((row) => row.cells)).toEqual([
			{
				store: "Store 1",
				itemLines: 150,
				modifierLines: 50,
				share: 0.25,
				catalogueModifiers: 0,
				fix: null,
			},
			{
				store: "Store 2",
				itemLines: 150,
				modifierLines: 50,
				share: 0.1,
				catalogueModifiers: 0,
				fix: null,
			},
		]);
		expect(model.notice).toBeNull();
	});

	it("warns with the POS hint on the store that sold catalogue modifiers as items", () => {
		const model = card([
			summaryRow(null, { catalogue_modifier_lines: 3 }),
			summaryRow(STORE_A, { catalogue_modifier_lines: 3 }),
			summaryRow(STORE_B),
		]);
		expect(model.narrative[1]).toEqual({
			key: qualityKeys.modifiers.catalogue,
			values: { count: { kind: "count", value: 3 } },
		});
		expect(model.tables[0]?.rows.map((row) => row.cells.fix)).toEqual([
			qualityKeys.fix.pos.modifier,
			null,
		]);
		expect(model.notice).toEqual({
			tone: "warning",
			part: { key: qualityKeys.fix.pos.modifier, values: {} },
			action: null,
		});
	});

	it("says no line was sold instead of showing 0", () => {
		const model = card([
			summaryRow(null, {
				item_lines: 0,
				modifier_lines: 0,
				modifier_line_share: null,
			}),
		]);
		expect(model.headline.value).toBeNull();
		expect(model.narrative[0]?.key).toBe(qualityKeys.modifiers.noData);
		expect(model.tables).toEqual([]);
	});
});
