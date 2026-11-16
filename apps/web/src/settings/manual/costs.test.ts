import { describe, expect, it } from "vitest";
import { vndFormatters } from "../../test/render";
import type { ItemEntry, ItemTypeEntry } from "../source";
import {
	type CostSale,
	costHistoryOf,
	costItemsOf,
	costShareOf,
	currentCostOf,
	dateHintOf,
	defaultEffectiveFrom,
	readCostEdits,
	readCostText,
	searchCostItems,
	sizeShownOf,
	withoutCost,
	withoutSaved,
	withSavedCosts,
} from "./costs";
import type { ItemCostRow } from "./source";

const TODAY = "2026-11-16";
const STORE = "S1";
const OTHER_STORE = "S2";

function entry(
	id: string,
	name: string,
	fields: Partial<ItemEntry> = {},
): ItemEntry {
	return {
		posAccountId: "A",
		itemExternalId: id,
		name,
		sizeLabel: null,
		listPrice: 40_000,
		isModifier: false,
		active: true,
		inCatalogue: true,
		posItemTypeExternalId: "T1",
		overrideItemTypeExternalId: null,
		audit: null,
		...fields,
	};
}

function sale(id: string, name: string, netAmount: number): CostSale {
	return {
		itemExternalId: id,
		name,
		sizeLabel: null,
		category: "Bán theo tên",
		netAmount,
	};
}

function cost(
	storeId: string | null,
	itemExternalId: string,
	costAmount: number,
	effectiveFrom: string,
): ItemCostRow {
	return {
		id: `${storeId ?? "all"}-${itemExternalId}-${effectiveFrom}`,
		storeId,
		itemExternalId,
		costAmount,
		effectiveFrom,
		audit: null,
	};
}

const TYPES: readonly ItemTypeEntry[] = [
	{
		posAccountId: "A",
		posAccountName: "POS A",
		itemTypeExternalId: "T1",
		name: "Trà sữa",
		role: "drink",
		audit: null,
	},
	{
		posAccountId: "A",
		posAccountName: "POS A",
		itemTypeExternalId: "T2",
		name: "Bánh",
		role: "snack",
		audit: null,
	},
];

const ENTRIES: readonly ItemEntry[] = [
	entry("I1", "Trà sữa trân châu", { sizeLabel: "M" }),
	entry("I2", "Bánh flan", {
		posItemTypeExternalId: null,
		overrideItemTypeExternalId: "T2",
	}),
	entry("I3", "Trân châu thêm", { isModifier: true }),
	entry("I4", "Ăn vặt cũ", { active: false }),
	entry("I5", "Cà phê muối"),
	entry("I6", "Món bên kia", { posAccountId: "B" }),
	entry("I7", "Món đã bỏ", { inCatalogue: false }),
];

describe("costItemsOf", () => {
	it("puts the 90-day sellers first by revenue, then the rest of the catalogue without modifiers, then items known only by a cost", () => {
		const items = costItemsOf({
			entries: ENTRIES,
			itemTypes: TYPES,
			sales: [
				sale("I5", "Cà phê muối", 1_000_000),
				sale("X9", "Món bán theo tên", 3_000_000),
				sale("I1", "Trà sữa trân châu (M)", 2_000_000),
			],
			posAccountIds: new Set(["A"]),
			costedItemIds: ["GONE", "I2"],
		});
		expect(items.map((item) => item.itemExternalId)).toEqual([
			"X9",
			"I1",
			"I5",
			"I2",
			"I4",
			"GONE",
		]);
		expect(items[0]).toEqual({
			itemExternalId: "X9",
			name: "Món bán theo tên",
			sizeLabel: null,
			category: "Bán theo tên",
			listPrice: null,
			soldAmount: 3_000_000,
		});
		expect(items[1]).toMatchObject({
			name: "Trà sữa trân châu",
			sizeLabel: "M",
			category: "Trà sữa",
			listPrice: 40_000,
			soldAmount: 2_000_000,
		});
		expect(items[3]).toMatchObject({ category: "Bánh", soldAmount: null });
	});

	it("takes every POS account for the costs of all stores", () => {
		const items = costItemsOf({
			entries: ENTRIES,
			itemTypes: TYPES,
			sales: [],
			posAccountIds: null,
			costedItemIds: [],
		});
		expect(items.map((item) => item.itemExternalId)).toContain("I6");
		expect(items.map((item) => item.itemExternalId)).not.toContain("I3");
	});
});

describe("searchCostItems and sizeShownOf", () => {
	const items = costItemsOf({
		entries: ENTRIES,
		itemTypes: TYPES,
		sales: [],
		posAccountIds: null,
		costedItemIds: [],
	});

	it("finds items by name, size, code or category without Vietnamese marks", () => {
		expect(
			searchCostItems(items, "tran chau m").map((item) => item.itemExternalId),
		).toEqual(["I1"]);
		expect(
			searchCostItems(items, "banh").map((item) => item.itemExternalId),
		).toEqual(["I2"]);
		expect(
			searchCostItems(items, "i5").map((item) => item.itemExternalId),
		).toEqual(["I5"]);
		expect(searchCostItems(items, "  ")).toHaveLength(items.length);
	});

	it("shows a size only when the name does not carry it", () => {
		expect(sizeShownOf({ name: "Trà sữa", sizeLabel: "L" })).toBe("L");
		expect(sizeShownOf({ name: "Trà sữa (L)", sizeLabel: "L" })).toBeNull();
		expect(sizeShownOf({ name: "Trà sữa", sizeLabel: " " })).toBeNull();
	});
});

describe("costs by scope and date", () => {
	const rows = [
		cost(null, "I1", 10_000, "2023-01-01"),
		cost(null, "I1", 11_000, "2026-06-01"),
		cost(STORE, "I1", 12_000, "2026-09-01"),
		cost(STORE, "I1", 13_000, "2026-12-01"),
		cost(null, "I2", 5_000, "2023-01-01"),
	];

	it("takes a store's own row in force before the row for all stores", () => {
		expect(currentCostOf(rows, STORE, "I1", TODAY)).toEqual({
			row: rows[2],
			inherited: false,
		});
		expect(currentCostOf(rows, STORE, "I1", "2026-08-31")).toEqual({
			row: rows[1],
			inherited: true,
		});
		expect(currentCostOf(rows, STORE, "I2", TODAY)).toEqual({
			row: rows[4],
			inherited: true,
		});
		expect(currentCostOf(rows, null, "I1", TODAY)).toEqual({
			row: rows[1],
			inherited: false,
		});
		expect(currentCostOf(rows, null, "I9", TODAY)).toBeNull();
		expect(currentCostOf(rows, STORE, "I1", "2022-12-31")).toBeNull();
	});

	it("dates a first cost 01/01/2023 only when neither the scope nor, for a store, the costs for all stores have a row", () => {
		expect(defaultEffectiveFrom(costHistoryOf(rows, null, "I9"), TODAY)).toBe(
			"2023-01-01",
		);
		expect(
			defaultEffectiveFrom(costHistoryOf(rows, OTHER_STORE, "I9"), TODAY),
		).toBe("2023-01-01");
		expect(defaultEffectiveFrom(costHistoryOf(rows, null, "I2"), TODAY)).toBe(
			TODAY,
		);
		expect(defaultEffectiveFrom(costHistoryOf(rows, STORE, "I2"), TODAY)).toBe(
			TODAY,
		);
		const history = costHistoryOf(rows, STORE, "I1");
		expect(history.own.map((row) => row.effectiveFrom)).toEqual([
			"2026-09-01",
			"2026-12-01",
		]);
		expect(history.shared.map((row) => row.effectiveFrom)).toEqual([
			"2023-01-01",
			"2026-06-01",
		]);
		expect(costHistoryOf(rows, null, "I1").shared).toEqual([]);
	});

	it("says what a date does to the history of the scope, with the day a later row ends it", () => {
		const none = costHistoryOf(rows, null, "I9");
		expect(dateHintOf(none, "2023-01-01", TODAY)).toEqual({
			kind: "wholeHistory",
			until: null,
		});
		expect(dateHintOf(none, "2025-03-01", TODAY)).toEqual({
			kind: "fromDate",
			until: null,
		});
		const shared = costHistoryOf(rows, null, "I1");
		expect(dateHintOf(shared, TODAY, TODAY)).toEqual({
			kind: "keepsEarlier",
			until: null,
		});
		expect(dateHintOf(shared, "2026-06-01", TODAY)).toEqual({
			kind: "replaces",
			until: null,
		});
		expect(dateHintOf(shared, "2025-01-01", TODAY)).toEqual({
			kind: "keepsEarlier",
			until: "2026-05-31",
		});
		const twoRows = [
			cost(null, "I3", 9_000, "2024-01-01"),
			cost(null, "I3", 9_500, "2026-06-01"),
		];
		expect(
			dateHintOf(costHistoryOf(twoRows, null, "I3"), "2023-01-01", TODAY),
		).toEqual({ kind: "wholeHistory", until: "2023-12-31" });
		expect(
			dateHintOf(costHistoryOf(twoRows, null, "I3"), "2023-06-01", TODAY),
		).toEqual({ kind: "fromDate", until: "2023-12-31" });
	});

	it("tells a store whether its own cost keeps or replaces the cost for all stores on past days", () => {
		const firstOwn = costHistoryOf(rows, STORE, "I2");
		expect(dateHintOf(firstOwn, TODAY, TODAY)).toEqual({
			kind: "keepsShared",
			until: null,
		});
		expect(dateHintOf(firstOwn, "2023-01-01", TODAY)).toEqual({
			kind: "replacesShared",
			until: null,
		});
		expect(dateHintOf(firstOwn, "2026-12-24", TODAY)).toEqual({
			kind: "keepsShared",
			until: null,
		});
		const beforeOwn = costHistoryOf(rows, STORE, "I1");
		expect(dateHintOf(beforeOwn, "2026-01-01", TODAY)).toEqual({
			kind: "replacesShared",
			until: "2026-08-31",
		});
		expect(dateHintOf(beforeOwn, "2026-10-01", TODAY)).toEqual({
			kind: "keepsEarlier",
			until: "2026-11-30",
		});
		const sharedLater = costHistoryOf(
			[cost(null, "I4", 7_000, "2026-12-20")],
			STORE,
			"I4",
		);
		expect(dateHintOf(sharedLater, TODAY, TODAY)).toEqual({
			kind: "fromDate",
			until: null,
		});
	});

	it("gives a cost's share of the list price only with a price", () => {
		expect(costShareOf(12_000, 40_000)).toBe(0.3);
		expect(costShareOf(12_000, null)).toBeNull();
		expect(costShareOf(12_000, 0)).toBeNull();
	});
});

describe("readCostText", () => {
	const formatters = vndFormatters();
	const read = (text: string) => readCostText(text, formatters, "VND");

	it("reads whole đồng in the usual spellings", () => {
		expect(read("25000")).toEqual({ value: 25_000, issue: null });
		expect(read("25.000")).toEqual({ value: 25_000, issue: null });
		expect(read("25.000 ₫")).toEqual({ value: 25_000, issue: null });
		expect(read("")).toEqual({ value: null, issue: null });
	});

	it("refuses a negative cost, a fraction of a đồng and a cost above the limit, never rounding", () => {
		expect(read("-5000").issue).toEqual({ key: "atLeast", min: 0 });
		for (const text of ["25000,5", "8333.33", "25.5", "1.250.000,5"]) {
			expect(read(text).issue, text).toEqual({ key: "wholeMoney" });
		}
		expect(read("100000001").issue).toEqual({
			key: "atMost",
			max: 100_000_000,
		});
		expect(read("abc").issue).toEqual({ key: "number" });
	});
});

describe("readCostEdits", () => {
	const formatters = vndFormatters();
	const rows = [cost(null, "I1", 10_000, "2023-01-01")];
	const context = {
		storeId: null,
		rows,
		today: TODAY,
		readCost: (text: string) => readCostText(text, formatters, "VND"),
	};

	it("turns each typed cost into a row of the scope at its date, defaulted by the history", () => {
		const reading = readCostEdits(
			{
				I1: { cost: "12.000", date: null },
				I2: { cost: "8000", date: null },
				I3: { cost: "9000", date: "2024-02-01" },
				I4: { cost: "", date: null },
				I5: { cost: " ", date: "2023-01-01" },
			},
			context,
		);
		expect(reading.changes).toEqual([
			{
				storeId: null,
				itemExternalId: "I1",
				costAmount: 12_000,
				effectiveFrom: TODAY,
			},
			{
				storeId: null,
				itemExternalId: "I2",
				costAmount: 8_000,
				effectiveFrom: "2023-01-01",
			},
			{
				storeId: null,
				itemExternalId: "I3",
				costAmount: 9_000,
				effectiveFrom: "2024-02-01",
			},
		]);
		expect(reading.pendingCount).toBe(3);
		expect(reading.invalid).toBe(false);
	});

	it("counts a changed date without a cost as unsaved and asks for the cost", () => {
		const reading = readCostEdits(
			{ I2: { cost: "", date: "2024-02-01" } },
			context,
		);
		expect(reading.changes).toEqual([]);
		expect(reading.pendingCount).toBe(1);
		expect(reading.unsaved).toEqual(new Set(["I2"]));
		expect(reading.invalid).toBe(true);
		expect(reading.issues.get("I2")).toEqual({
			cost: { key: "required" },
			date: null,
		});
	});

	it("holds back a row with a refused cost or date", () => {
		const reading = readCostEdits(
			{
				I1: { cost: "-1", date: null },
				I2: { cost: "8000", date: "2022-12-31" },
				I3: { cost: "8000", date: "" },
			},
			context,
		);
		expect(reading.changes).toEqual([]);
		expect(reading.pendingCount).toBe(3);
		expect(reading.invalid).toBe(true);
		expect(reading.issues.get("I1")).toEqual({
			cost: { key: "atLeast", min: 0 },
			date: null,
		});
		expect(reading.issues.get("I2")?.date?.key).toBe("dateRange");
		expect(reading.issues.get("I3")?.date).toEqual({ key: "required" });
	});

	it("forgets the saved items and keeps the others", () => {
		expect(
			withoutSaved(
				{
					I1: { cost: "1", date: null },
					I2: { cost: "2", date: null },
				},
				[
					{
						storeId: null,
						itemExternalId: "I1",
						costAmount: 1,
						effectiveFrom: TODAY,
					},
				],
			),
		).toEqual({ I2: { cost: "2", date: null } });
	});
});

describe("the cached rows after a write", () => {
	const first = cost(null, "I1", 10_000, "2023-01-01");
	const store = cost(STORE, "I1", 12_000, "2023-01-01");

	it("replaces a row of the same scope, item and date and adds a new one", () => {
		const updated = { ...first, costAmount: 11_000 };
		const added = cost(null, "I1", 13_000, TODAY);
		expect(withSavedCosts([first, store], [updated, added])).toEqual([
			updated,
			store,
			added,
		]);
		expect(withSavedCosts(undefined, [added])).toBeUndefined();
	});

	it("drops a deleted row", () => {
		expect(withoutCost([first, store], first.id)).toEqual([store]);
		expect(withoutCost(undefined, first.id)).toBeUndefined();
	});
});
