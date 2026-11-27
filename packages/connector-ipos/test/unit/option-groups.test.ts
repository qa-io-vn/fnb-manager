// Test design (ISTQB): equivalence partitions and boundary values of the iPOS customization limits as they
// become canonical option groups (ADR-058 phase 3). Min_Permitted: missing, negative, 0, 1, 20, 21, a fraction;
// Max_Permitted: missing (falls back to the option count), 0, 1, 20, 21, below min. Options: empty, repeated,
// blank, priced and zero-priced (both kept). Targets: repeated and missing. A customization switched off gives
// inactive groups. The zero-priced modifiers of toModifiers stay exactly as before.
import { canonicalCatalogSchema, canonicalOptionGroupSchema } from "@fnb/core";
import { describe, expect, it } from "vitest";
import {
	toCanonicalCatalog,
	toOptionGroups,
} from "../../src/connector/catalog.js";
import {
	buildMasterIndex,
	type MasterData,
} from "../../src/connector/master-index.js";
import { resolveIposOptions } from "../../src/connector/options.js";
import {
	type Customization,
	customizationSchema,
	itemSchema,
} from "../../src/schemas/master-data.js";

const OPTIONS = resolveIposOptions({});

function item(id: string, name: string, price: number) {
	return itemSchema.parse({
		id: `uid-${id}`,
		item_id: id,
		item_name: name,
		ots_price: price,
		active: 1,
	});
}

function customization(
	id: string,
	options: Record<string, unknown>[],
	overrides: Record<string, unknown> = {},
): Customization {
	return customizationSchema.parse({
		id,
		name: `Synthetic customization ${id}`,
		active: 1,
		list_item: ["ITEM-DRINK-1", "ITEM-DRINK-2"],
		data: { LstItem_Options: options },
		...overrides,
	});
}

function masterData(customizations: Customization[]): MasterData {
	return {
		items: [
			item("ITEM-DRINK-1", "Synthetic drink 1", 30_000),
			item("ITEM-DRINK-2", "Synthetic drink 2", 35_000),
			item("OPT-PRICED", "Synthetic topping", 5_000),
			item("OPT-FREE-1", "Synthetic less ice", 0),
			item("OPT-FREE-2", "Synthetic less sugar", 0),
		],
		itemTypes: [],
		itemClasses: [],
		units: [],
		customizations,
		sources: [],
		paymentMethods: [],
		promotions: [],
		packages: [],
	};
}

function onlyGroup(option: Record<string, unknown>) {
	const groups = toOptionGroups(masterData([customization("C1", [option])]));
	expect(groups).toHaveLength(1);
	const [group] = groups;
	if (!group) {
		throw new Error("no group");
	}
	expect(canonicalOptionGroupSchema.safeParse(group).success).toBe(true);
	return group;
}

describe("iPOS customizations as option groups", () => {
	it("gives one group per customization and option position, keyed <customization>:<position>", () => {
		const groups = toOptionGroups(
			masterData([
				customization("C1", [
					{ Name: "Size", LstItem_Id: ["OPT-FREE-1"] },
					{ Name: "Topping", LstItem_Id: ["OPT-PRICED"] },
				]),
				customization("C2", [{ Name: "Ice", LstItem_Id: ["OPT-FREE-2"] }]),
			]),
		);

		expect(groups.map((group) => group.externalId)).toEqual([
			"C1:0",
			"C1:1",
			"C2:0",
		]);
		expect(groups.map((group) => group.name)).toEqual([
			"Size",
			"Topping",
			"Ice",
		]);
		expect(groups[0]?.raw).toMatchObject({
			customizationUid: "C1",
			position: 0,
		});
	});

	it("keeps priced and zero-priced options alike, in POS order, without repeats or blanks", () => {
		const group = onlyGroup({
			Name: "Topping",
			LstItem_Id: ["OPT-PRICED", "OPT-FREE-1", "OPT-PRICED", " ", "OPT-FREE-2"],
			Max_Permitted: 3,
		});

		expect(group.optionItemExternalIds).toEqual([
			"OPT-PRICED",
			"OPT-FREE-1",
			"OPT-FREE-2",
		]);
	});

	it("takes the targets from list_item without repeats, and none when the POS lists none", () => {
		const repeated = toOptionGroups(
			masterData([
				customization("C1", [{ LstItem_Id: ["OPT-FREE-1"] }], {
					list_item: ["ITEM-DRINK-1", "ITEM-DRINK-1", "ITEM-DRINK-2"],
				}),
			]),
		);
		const missing = toOptionGroups(
			masterData([
				customization("C1", [{ LstItem_Id: ["OPT-FREE-1"] }], {
					list_item: null,
				}),
			]),
		);

		expect(repeated[0]?.appliesToItemExternalIds).toEqual([
			"ITEM-DRINK-1",
			"ITEM-DRINK-2",
		]);
		expect(missing[0]?.appliesToItemExternalIds).toEqual([]);
	});

	it("names a group after the customization when the option has no name", () => {
		const group = onlyGroup({ Name: "  ", LstItem_Id: ["OPT-FREE-1"] });

		expect(group.name).toBe("Synthetic customization C1");
	});

	it.each([
		["missing", undefined, 0],
		["negative", -1, 0],
		["zero", 0, 0],
		["one", 1, 1],
		["twenty", 20, 20],
		["twenty-one", 21, 20],
		["a fraction", 1.7, 1],
	])("clamps a %s Min_Permitted to %s", (_label, min, expected) => {
		const group = onlyGroup({
			LstItem_Id: ["OPT-FREE-1"],
			Min_Permitted: min,
			Max_Permitted: 20,
		});

		expect(group.minSelect).toBe(expected);
	});

	it.each([
		["missing, with three options", undefined, 3],
		["zero", 0, 1],
		["one", 1, 1],
		["twenty", 20, 20],
		["twenty-one", 21, 20],
	])("reads a %s Max_Permitted as %s", (_label, max, expected) => {
		const group = onlyGroup({
			LstItem_Id: ["OPT-PRICED", "OPT-FREE-1", "OPT-FREE-2"],
			Max_Permitted: max,
		});

		expect(group.maxSelect).toBe(expected);
	});

	it("raises a Max_Permitted below Min_Permitted to the minimum", () => {
		const group = onlyGroup({
			LstItem_Id: ["OPT-PRICED", "OPT-FREE-1", "OPT-FREE-2"],
			Min_Permitted: 2,
			Max_Permitted: 1,
		});

		expect([group.minSelect, group.maxSelect]).toEqual([2, 2]);
	});

	it("keeps a group with no option at all, with a maximum of 1", () => {
		const group = onlyGroup({
			Name: "Empty",
			LstItem_Id: [],
			Min_Permitted: 1,
		});

		expect(group.optionItemExternalIds).toEqual([]);
		expect([group.minSelect, group.maxSelect]).toEqual([1, 1]);
	});

	it("marks every group of a switched-off customization inactive", () => {
		const groups = toOptionGroups(
			masterData([
				customization(
					"C1",
					[{ LstItem_Id: ["OPT-FREE-1"] }, { LstItem_Id: ["OPT-PRICED"] }],
					{ active: 0 },
				),
				customization("C2", [{ LstItem_Id: ["OPT-FREE-2"] }]),
			]),
		);

		expect(groups.map((group) => [group.externalId, group.active])).toEqual([
			["C1:0", false],
			["C1:1", false],
			["C2:0", true],
		]);
	});

	it("keeps the first copy of a customization the POS lists twice", () => {
		const groups = toOptionGroups(
			masterData([
				customization("C1", [{ Name: "First", LstItem_Id: ["OPT-FREE-1"] }]),
				customization("C1", [{ Name: "Second", LstItem_Id: ["OPT-FREE-2"] }]),
			]),
		);

		expect(groups.map((group) => group.name)).toEqual(["First"]);
	});

	it("adds the groups to the catalogue and leaves the zero-priced modifiers as they were", () => {
		const data = masterData([
			customization("C1", [
				{ Name: "Topping", LstItem_Id: ["OPT-PRICED", "OPT-FREE-1"] },
			]),
		]);
		const catalog = toCanonicalCatalog(data, buildMasterIndex(data), OPTIONS);

		expect(canonicalCatalogSchema.safeParse(catalog).success).toBe(true);
		expect(catalog.optionGroups?.map((group) => group.externalId)).toEqual([
			"C1:0",
		]);
		expect(catalog.modifiers.map((modifier) => modifier.externalId)).toEqual([
			"OPT-FREE-1",
		]);
		expect(
			catalog.items.find((entry) => entry.externalId === "OPT-PRICED")
				?.isModifier,
		).toBe(false);
	});
});
