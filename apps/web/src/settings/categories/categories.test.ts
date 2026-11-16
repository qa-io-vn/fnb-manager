import { describe, expect, it } from "vitest";
import type { ItemEntry, ItemTypeEntry } from "../source";
import {
	categoryChangesOf,
	entryOfSale,
	itemKeyOf,
	overriddenItems,
	posCategoryOf,
	type SoldUncategorisedItem,
	savedCategoryDraftOf,
	searchItems,
	searchTextOf,
	sizeToShow,
	typesByAccount,
	uncategorisedEntries,
	withCategoryChanges,
	withSoldItems,
} from "./categories";

function type(account: string, id: string, name: string): ItemTypeEntry {
	return {
		posAccountId: account,
		posAccountName: account === "A" ? "POS trà" : "POS cà phê",
		itemTypeExternalId: id,
		name,
		role: null,
		audit: null,
	};
}

function item(
	id: string,
	name: string,
	fields: Partial<ItemEntry> = {},
): ItemEntry {
	return {
		posAccountId: "A",
		itemExternalId: id,
		name,
		sizeLabel: null,
		listPrice: 20000,
		isModifier: false,
		active: true,
		inCatalogue: true,
		posItemTypeExternalId: "T1",
		overrideItemTypeExternalId: null,
		audit: null,
		...fields,
	};
}

const TYPES = typesByAccount([
	type("A", "T2", "Đồ ăn kèm"),
	type("A", "T1", "Trà sữa"),
	type("B", "T1", "Cà phê"),
]);

const ENTRIES: readonly ItemEntry[] = [
	item("I1", "Trà sữa trân châu"),
	item("I2", "Hạt bí", { posItemTypeExternalId: null }),
	item("I3", "Bánh quy", { posItemTypeExternalId: "T9" }),
	item("I4", "Ăn vặt cũ", { posItemTypeExternalId: null, active: false }),
	item("I5", "Đường", { posItemTypeExternalId: null, isModifier: true }),
	item("I6", "Bánh flan", {
		posItemTypeExternalId: null,
		overrideItemTypeExternalId: "T2",
	}),
	item("GONE", "GONE", {
		inCatalogue: false,
		active: false,
		posItemTypeExternalId: null,
		overrideItemTypeExternalId: "T2",
	}),
	item("I7", "Bạc xỉu", { posAccountId: "B" }),
];

function names(entries: readonly ItemEntry[]): string[] {
	return entries.map((entry) => entry.name);
}

function sale(
	id: string,
	name: string | null,
	net: number,
	posType: string | null = null,
	account = "A",
): SoldUncategorisedItem {
	return {
		posAccountId: account,
		itemExternalId: id,
		itemName: name,
		posTypeExternalId: posType,
		netAmount: net,
	};
}

const FIRST_KEYS = new Set(
	["I2", "I3"].map((id) =>
		itemKeyOf({ posAccountId: "A", itemExternalId: id }),
	),
);

describe("the item types of an account", () => {
	it("keeps each account's types apart and orders them by name", () => {
		expect(TYPES.get("A")?.map((entry) => entry.name)).toEqual([
			"Đồ ăn kèm",
			"Trà sữa",
		]);
		expect(TYPES.get("B")?.map((entry) => entry.name)).toEqual(["Cà phê"]);
	});

	it("reads an item's POS category as known, missing or unknown to its own account", () => {
		expect(posCategoryOf(ENTRIES[0] as ItemEntry, TYPES)).toMatchObject({
			kind: "known",
			type: { name: "Trà sữa" },
		});
		expect(posCategoryOf(ENTRIES[1] as ItemEntry, TYPES)).toEqual({
			kind: "missing",
		});
		expect(posCategoryOf(ENTRIES[2] as ItemEntry, TYPES)).toEqual({
			kind: "unknown",
			itemTypeExternalId: "T9",
		});
		expect(
			posCategoryOf(item("X", "Lạ", { posAccountId: "C" }), TYPES).kind,
		).toBe("unknown");
	});
});

describe("the uncategorised items", () => {
	const SOLD = [
		sale("I3", "Bánh quy", 900_000, "T9"),
		sale("Bánh mì que", "Bánh mì que", 400_000),
		sale("I2", "Hạt bí", 150_000),
		sale("I6", "Bánh flan", 90_000),
		sale("I3", "Bánh quy", 10_000, "T9"),
	];

	it("follow the sales order and take each item's catalogue entry with the POS type of its sale lines", () => {
		const listed = uncategorisedEntries(SOLD, ENTRIES);
		expect(listed.map((entry) => entry.itemExternalId)).toEqual([
			"I3",
			"Bánh mì que",
			"I2",
		]);
		expect(listed[0]).toMatchObject({
			name: "Bánh quy",
			inCatalogue: true,
			posItemTypeExternalId: "T9",
		});
		expect(
			uncategorisedEntries([sale("I1", "Trà sữa trân châu", 5)], ENTRIES)[0]
				?.posItemTypeExternalId,
		).toBeNull();
	});

	it("leave out an item whose override is saved, so a saved item leaves before the sales are read again", () => {
		expect(
			uncategorisedEntries(SOLD, ENTRIES).some(
				(entry) => entry.itemExternalId === "I6",
			),
		).toBe(false);
		const saved = withCategoryChanges(ENTRIES, [
			{ posAccountId: "A", itemExternalId: "I2", itemTypeExternalId: "T2" },
			{
				posAccountId: "A",
				itemExternalId: "Bánh mì que",
				itemTypeExternalId: "T2",
			},
		]) as ItemEntry[];
		expect(
			uncategorisedEntries(SOLD, saved).map((entry) => entry.itemExternalId),
		).toEqual(["I3"]);
	});

	it("build an entry, outside the catalogue, for an item sold by name only, and add it once to the items", () => {
		expect(entryOfSale(sale("Bánh mì que", "Bánh mì que", 1))).toMatchObject({
			posAccountId: "A",
			itemExternalId: "Bánh mì que",
			name: "Bánh mì que",
			inCatalogue: false,
			active: true,
			overrideItemTypeExternalId: null,
		});
		expect(entryOfSale(sale("X-9", null, 1)).name).toBe("X-9");
		const all = withSoldItems(ENTRIES, SOLD);
		expect(all).toHaveLength(ENTRIES.length + 1);
		expect(all.at(-1)?.itemExternalId).toBe("Bánh mì que");
	});
});

describe("the size shown with an item's name", () => {
	it("is its size label, unless the name already carries it in brackets", () => {
		expect(sizeToShow(item("S1", "Trà đào", { sizeLabel: "L" }))).toBe("L");
		expect(
			sizeToShow(item("S2", "Bánh quy đá xay (L)", { sizeLabel: "L" })),
		).toBeNull();
		expect(sizeToShow(item("S3", "Matcha", { sizeLabel: "M" }))).toBe("M");
		expect(sizeToShow(item("S4", "Trà đào"))).toBeNull();
	});
});

describe("the overridden items", () => {
	it("list every saved override, those whose item left the catalogue last", () => {
		expect(names(overriddenItems(ENTRIES))).toEqual(["Bánh flan", "GONE"]);
	});
});

describe("the search over all items", () => {
	it("ignores case and Vietnamese marks, so a query typed without them still finds the item", () => {
		expect(searchTextOf("Đồ Ăn Kèm")).toBe("do an kem");
		expect(names(searchItems(ENTRIES, TYPES, "hat bi").items)).toEqual([
			"Hạt bí",
		]);
		expect(names(searchItems(ENTRIES, TYPES, "BẠC").items)).toEqual([
			"Bạc xỉu",
		]);
	});

	it("needs every word, and matches the size, the item code and the POS or chosen type", () => {
		expect(names(searchItems(ENTRIES, TYPES, "tra chau").items)).toEqual([
			"Trà sữa trân châu",
		]);
		expect(names(searchItems(ENTRIES, TYPES, "gone").items)).toEqual(["GONE"]);
		expect(names(searchItems(ENTRIES, TYPES, "do an kem").items)).toEqual([
			"Bánh flan",
			"GONE",
		]);
		expect(
			names(
				searchItems([item("S1", "Trà đào", { sizeLabel: "L" })], TYPES, "dao l")
					.items,
			),
		).toEqual(["Trà đào"]);
	});

	it("puts the uncategorised matches first and finds nothing for an empty query", () => {
		expect(names(searchItems(ENTRIES, TYPES, "b", FIRST_KEYS).items)).toEqual([
			"Bánh quy",
			"Hạt bí",
			"Bạc xỉu",
			"Bánh flan",
		]);
		expect(searchItems(ENTRIES, TYPES, "   ")).toEqual({ items: [], total: 0 });
	});

	it("caps the list and still counts every match", () => {
		const result = searchItems(ENTRIES, TYPES, "b", FIRST_KEYS, 2);
		expect(names(result.items)).toEqual(["Bánh quy", "Hạt bí"]);
		expect(result.total).toBe(4);
	});
});

describe("the category changes", () => {
	it("send only the changed items, an override set or replaced as its type and As in the POS as a deleted override", () => {
		const draft = {
			...savedCategoryDraftOf(ENTRIES),
			[itemKeyOf({ posAccountId: "A", itemExternalId: "I2" })]: "T2",
			[itemKeyOf({ posAccountId: "A", itemExternalId: "I6" })]: null,
			[itemKeyOf({ posAccountId: "A", itemExternalId: "GONE" })]: "T1",
		};
		expect(categoryChangesOf(ENTRIES, draft)).toEqual([
			{ posAccountId: "A", itemExternalId: "I2", itemTypeExternalId: "T2" },
			{ posAccountId: "A", itemExternalId: "I6", itemTypeExternalId: null },
			{ posAccountId: "A", itemExternalId: "GONE", itemTypeExternalId: "T1" },
		]);
		expect(categoryChangesOf(ENTRIES, savedCategoryDraftOf(ENTRIES))).toEqual(
			[],
		);
	});

	it("are written into the cached list, and a cleared override of an item outside the catalogue leaves it", () => {
		const next = withCategoryChanges(ENTRIES, [
			{ posAccountId: "A", itemExternalId: "I2", itemTypeExternalId: "T2" },
			{ posAccountId: "A", itemExternalId: "GONE", itemTypeExternalId: null },
		]);
		expect(
			next?.find((entry) => entry.itemExternalId === "I2")
				?.overrideItemTypeExternalId,
		).toBe("T2");
		expect(next?.some((entry) => entry.itemExternalId === "GONE")).toBe(false);
		expect(next).toHaveLength(ENTRIES.length - 1);
		expect(withCategoryChanges(undefined, [])).toBeUndefined();
	});

	it("add an override for an item the list lacks, as the live read lists it, and nothing for a cleared one", () => {
		const next = withCategoryChanges(ENTRIES, [
			{
				posAccountId: "A",
				itemExternalId: "Bánh mì que",
				itemTypeExternalId: "T2",
			},
			{
				posAccountId: "A",
				itemExternalId: "Không có",
				itemTypeExternalId: null,
			},
		]);
		expect(next).toHaveLength(ENTRIES.length + 1);
		expect(next?.at(-1)).toMatchObject({
			itemExternalId: "Bánh mì que",
			name: "Bánh mì que",
			inCatalogue: false,
			overrideItemTypeExternalId: "T2",
		});
	});
});
