import { describe, expect, it } from "vitest";
import { buildUncategorisedCard } from "../../../../src/themes/quality/cards/uncategorised.js";
import { qualityKeys } from "../../../../src/themes/quality/keys.js";
import {
	isUncategorisedItem,
	qualityCalls,
} from "../../../../src/themes/quality/support.js";
import { coverageRow, STORE_A } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import { cardInput, type ItemRow, itemRow } from "./support.js";

function card(rows: readonly ItemRow[]) {
	return buildUncategorisedCard(
		cardInput(themeContext("28d", [STORE_A]), { [qualityCalls.items]: rows }, [
			coverageRow(STORE_A),
		]),
	);
}

const withoutType = itemRow({
	item_external_id: "SEEDS",
	item_name: "Hạt rang",
	pos_type_external_id: null,
	pos_type_name: null,
	item_type_external_id: null,
	item_type_name: null,
	type_known: false,
	role: null,
	net_amount: 250_000,
	quantity: 5,
});

describe("the Chất lượng dữ liệu uncategorised card", () => {
	it("counts the items sold without a category with their share of item revenue and asks for a category in the POS or in Settings", () => {
		const model = card([
			itemRow({ item_external_id: "A", net_amount: 750_000 }),
			withoutType,
		]);
		expect(model.headline).toEqual({ value: 1, unit: "count", caption: null });
		expect(model.narrative[0]?.key).toBe(qualityKeys.uncategorised.main);
		expect(model.narrative[0]?.values.share).toEqual({
			kind: "percent",
			value: 0.25,
		});
		expect(model.narrative[1]?.key).toBe(qualityKeys.uncategorised.rolesNone);
		expect(model.tables).toHaveLength(1);
		expect(model.tables[0]?.rows[0]?.cells).toEqual({
			item: "Hạt rang",
			posType: null,
			quantity: 5,
			netAmount: 250_000,
			share: 0.25,
			fix: qualityKeys.fix.pos.category,
		});
		expect(model.notice).toEqual({
			tone: "info",
			part: { key: qualityKeys.uncategorised.itemsNotice, values: {} },
			action: "settings_categories",
		});
		expect(model.markers.verification).toBe("verified");
	});

	it("drops an item from the table once it has an override, as Phân loại's Chưa phân loại list does (acceptance A6)", () => {
		const remapped = {
			...withoutType,
			override_type_external_id: "TYPE-9",
		};
		expect(isUncategorisedItem(withoutType)).toBe(true);
		expect(isUncategorisedItem(remapped)).toBe(false);
		const model = card([itemRow({ item_external_id: "A" }), remapped]);
		expect(model.headline.value).toBe(0);
		expect(model.tables).toEqual([]);
		expect(model.narrative[0]?.key).toBe(qualityKeys.uncategorised.none);
		expect(model.notice).toBeNull();
	});

	it("leaves catalogue modifiers sold as items to the modifier card and out of the revenue base", () => {
		const model = card([
			itemRow({ item_external_id: "A", net_amount: 750_000 }),
			{
				...withoutType,
				item_external_id: "SUGAR",
				catalogue_modifier: true,
				net_amount: 500_000,
			},
			withoutType,
		]);
		expect(
			isUncategorisedItem({ ...withoutType, catalogue_modifier: true }),
		).toBe(false);
		expect(model.headline.value).toBe(1);
		expect(model.narrative[0]?.values.share).toEqual({
			kind: "percent",
			value: 0.25,
		});
		expect(model.tables[0]?.rows.map((row) => row.cells.share)).toEqual([0.25]);
	});

	it("groups the item types without a role and links to both Settings tabs when both findings exist", () => {
		const model = card([
			withoutType,
			itemRow({
				item_external_id: "T1",
				item_type_external_id: "TYPE-5",
				item_type_name: "Bánh",
				role: null,
				net_amount: 300_000,
			}),
			itemRow({
				item_external_id: "T2",
				item_type_external_id: "TYPE-5",
				item_type_name: "Bánh",
				role: null,
				net_amount: 200_000,
			}),
			itemRow({ item_external_id: "D1", net_amount: 250_000 }),
		]);
		expect(model.narrative[1]).toEqual({
			key: qualityKeys.uncategorised.roles,
			values: {
				count: { kind: "count", value: 1 },
				share: { kind: "percent", value: 0.5 },
			},
		});
		expect(model.tables[1]?.captionKey).toBe(
			qualityKeys.uncategorised.typesTable,
		);
		expect(model.tables[1]?.rows).toEqual([
			{
				id: expect.stringContaining("TYPE-5"),
				cells: {
					category: "Bánh",
					items: 2,
					netAmount: 500_000,
					share: 0.5,
					fix: qualityKeys.fix.settings.role,
				},
			},
		]);
		expect(model.notice?.action).toBe("settings_categories");
		expect(model.notice?.secondaryAction).toBe("settings_roles");
		expect(model.notice?.part.key).toBe(qualityKeys.uncategorised.bothNotice);
	});

	it("links only to the roles when every item has a category but a category has no role", () => {
		const model = card([
			itemRow({ item_external_id: "T1", role: null }),
			itemRow({ item_external_id: "D1" }),
		]);
		expect(model.headline.value).toBe(0);
		expect(model.notice).toEqual({
			tone: "info",
			part: { key: qualityKeys.uncategorised.rolesNotice, values: {} },
			action: "settings_roles",
		});
		expect(model.tables).toHaveLength(1);
	});

	it("says plainly that nothing was sold instead of showing 0", () => {
		const model = card([]);
		expect(model.headline.value).toBeNull();
		expect(model.narrative.map((entry) => entry.key)).toEqual([
			qualityKeys.uncategorised.noData,
		]);
		expect(model.notice).toBeNull();
	});
});
