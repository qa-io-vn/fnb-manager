import { beforeAll, describe, expect, it } from "vitest";
import type { BuiltPack } from "../../../src/pack/build.js";
import { CATEGORY_LIMIT, ITEM_LIMIT } from "../../../src/pack/tables/items.js";
import { buildWith, demoRequest, demoSource } from "../support/demo.js";
import { overriddenSource } from "../support/sources.js";

function item(
	name: string,
	net: number,
	quantity: number,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		item_external_id: `ID-${name}`,
		item_name: name,
		base_name: name,
		size_label: null,
		item_type_external_id: "T1",
		item_type_name: "Trà",
		role: "drink",
		quantity,
		net_amount: net,
		invoices: quantity,
		days_sold: 10,
		net_share: 0.01,
		compare_quantity: quantity,
		compare_net_amount: net,
		compare_net_share: 0.01,
		first_sold_on: "2025-01-01",
		last_sold_on: "2026-11-11",
		...overrides,
	};
}

describe("the items, categories and sizes", () => {
	let built: BuiltPack;

	beforeAll(async () => {
		const rows = [
			...Array.from({ length: 12 }, (_, index) =>
				item(
					`Món ${String.fromCharCode(97 + index)}`,
					1_000_000 - index * 10_000,
					10,
				),
			),
			item("Hòa 2", 500_000, 5, { item_external_id: "B" }),
			item("Hòa 1", 500_000, 5, { item_external_id: "C" }),
			item("Hòa 1", 500_000, 5, { item_external_id: "A" }),
			item("Hòa 1", 500_000, 6, { item_external_id: "D" }),
			item("Chỉ kỳ trước", 0, 0, {
				compare_net_amount: 900_000,
				compare_quantity: 9,
			}),
			item("Size M", 200_000, 4, { size_label: "M", item_type_name: null }),
			item("Size L", 300_000, 4, {
				size_label: "L",
				item_type_name: null,
				compare_quantity: 0,
			}),
		];
		built = await buildWith(
			overriddenSource(demoSource(), { item_summary: () => rows }),
			demoRequest({ storeIds: ["MOCK-S1"] }),
		);
	});

	it("keeps the top items by net sales, quantity, name and id, never an item sold only before", () => {
		const rows = built.pack.tables.items?.rows ?? {};
		expect(Object.keys(rows)).toHaveLength(ITEM_LIMIT);
		expect(rows["ALL/r01"]?.[0]).toBe("Món a");
		expect(rows["ALL/r10"]?.[0]).toBe("Món j");
		const names = Object.values(rows).map((row) => row[0]);
		expect(names).not.toContain("Chỉ kỳ trước");
		expect(names).not.toContain("Món k");
	});

	it("breaks ties by quantity, then name, then id", async () => {
		const tied = [
			item("Hòa 2", 500_000, 5, { item_external_id: "B" }),
			item("Hòa 1", 500_000, 5, { item_external_id: "C", net_share: 0.02 }),
			item("Hòa 1", 500_000, 5, { item_external_id: "A", net_share: 0.03 }),
			item("Hòa 1", 500_000, 6, { item_external_id: "D", net_share: 0.04 }),
		];
		const pack = await buildWith(
			overriddenSource(demoSource(), { item_summary: () => tied }),
			demoRequest({ storeIds: ["MOCK-S1"] }),
		);
		const rows = pack.pack.tables.items?.rows ?? {};
		expect(
			["ALL/r01", "ALL/r02", "ALL/r03", "ALL/r04"].map((key) => [
				rows[key]?.[0],
				rows[key]?.[4],
			]),
		).toEqual([
			["Hòa 1", 0.04],
			["Hòa 1", 0.03],
			["Hòa 1", 0.02],
			["Hòa 2", 0.01],
		]);
	});

	it("groups categories over every item, with the items sold and the change against p28", () => {
		const rows = built.pack.tables.categories?.rows ?? {};
		expect(Object.keys(rows).length).toBeLessThanOrEqual(CATEGORY_LIMIT);
		expect(rows["ALL/r01"]?.slice(0, 2)).toEqual(["Trà", 16]);
		const tea = rows["ALL/r01"];
		const net = 12 * 1_000_000 - 66 * 10_000 + 4 * 500_000;
		expect(tea?.[3]).toBe(net);
		expect(tea?.[5]).toBe(
			Math.round(((net - (net + 900_000)) / (net + 900_000)) * 10_000) / 10_000,
		);
		expect(rows["ALL/r02"]?.slice(0, 2)).toEqual([null, 2]);
	});

	it("lists sized items only, with their share of the sized quantity", () => {
		const rows = built.pack.tables.sizes?.rows ?? {};
		expect(rows).toEqual({
			"ALL/r01": ["L", 4, 300_000, 0.5, 0.5],
			"ALL/r02": ["M", 4, 200_000, 0.5, -0.5],
		});
	});
});
