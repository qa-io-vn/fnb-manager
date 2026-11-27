// Test design (ISTQB): the mock catalogue's option groups (ADR-058 phase 3) cover the partitions the online menu
// needs: a required group (min 1, max 1, like a size), an optional single choice (min 0, max 1) and an optional
// multiple choice (min 0, max 3) mixing priced and zero-priced options; every option and target is an item of
// the catalogue, and the zero-priced modifiers keep their flag.
import { canonicalCatalogSchema } from "@fnb/core";
import { describe, expect, it } from "vitest";
import { buildMenu, MENU } from "../../src/index.js";

const groups = MENU.catalog.optionGroups ?? [];

function itemOf(externalId: string) {
	return MENU.catalog.items.find((item) => item.externalId === externalId);
}

describe("mock option groups", () => {
	it("is a valid canonical catalogue with three groups, the same on every build", () => {
		expect(canonicalCatalogSchema.safeParse(MENU.catalog).success).toBe(true);
		expect(groups.map((group) => group.externalId)).toEqual([
			"CUST-001:0",
			"CUST-002:0",
			"CUST-003:0",
		]);
		expect(buildMenu().catalog.optionGroups).toEqual(groups);
	});

	it("has a required group, an optional single choice and an optional multiple choice", () => {
		expect(groups.map((group) => [group.minSelect, group.maxSelect])).toEqual([
			[1, 1],
			[0, 1],
			[0, 3],
		]);
	});

	it("names only items of the catalogue as options and targets", () => {
		for (const group of groups) {
			for (const id of [
				...group.optionItemExternalIds,
				...group.appliesToItemExternalIds,
			]) {
				expect(itemOf(id), `${group.externalId} ${id}`).toBeDefined();
			}
			expect(group.appliesToItemExternalIds.length).toBeGreaterThan(0);
		}
	});

	it("mixes priced and zero-priced options in the topping group", () => {
		const prices = (groups[2]?.optionItemExternalIds ?? []).map(
			(id) => itemOf(id)?.listPrice ?? -1,
		);

		expect(prices.some((price) => price > 0)).toBe(true);
		expect(prices.some((price) => price === 0)).toBe(true);
	});

	it("keeps the zero-priced options of the required group flagged as modifiers", () => {
		for (const id of groups[0]?.optionItemExternalIds ?? []) {
			expect(itemOf(id)).toMatchObject({ listPrice: 0, isModifier: true });
		}
	});
});
