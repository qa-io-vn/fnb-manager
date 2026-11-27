// Test design (ISTQB): the conformance rules of the catalogue's option groups (ADR-058 phase 3). Partitions:
// optionGroups absent (not mapped, nothing checked), empty, valid; boundaries of the limits min -1/0/20/21 and
// max 0/1/20/21 and min > max; repeated group ids, options and targets; references inside and outside the
// catalogue; a required group with fewer options than its minimum, active and inactive.
import type { CanonicalCatalog, CanonicalOptionGroup } from "@fnb/core";
import { describe, expect, it } from "vitest";
import {
	checkOptionGroupReferences,
	checkOptionGroups,
} from "../../src/conformance/index.js";

function group(
	overrides: Partial<CanonicalOptionGroup> = {},
): CanonicalOptionGroup {
	return {
		externalId: "G1",
		name: "Topping",
		minSelect: 0,
		maxSelect: 2,
		optionItemExternalIds: ["OPT-1", "OPT-2"],
		appliesToItemExternalIds: ["DR-1"],
		active: true,
		raw: null,
		...overrides,
	};
}

function catalog(optionGroups?: CanonicalOptionGroup[]): CanonicalCatalog {
	const base: CanonicalCatalog = {
		items: ["DR-1", "OPT-1", "OPT-2"].map((externalId) => ({
			externalId,
			name: externalId,
			baseName: externalId,
			listPrice: externalId === "OPT-2" ? 0 : 10_000,
			isModifier: externalId === "OPT-2",
			active: true,
		})),
		itemTypes: [],
		itemClasses: [],
		modifiers: [],
		paymentMethods: [],
		sources: [],
		promotions: [],
		packages: [],
	};
	return optionGroups === undefined ? base : { ...base, optionGroups };
}

function rules(violations: { rule: string }[]): string[] {
	return violations.map((entry) => entry.rule);
}

describe("option group checks", () => {
	it("checks nothing when the connector does not map option groups", () => {
		expect(checkOptionGroups(catalog())).toEqual([]);
		expect(checkOptionGroupReferences(catalog())).toEqual([]);
	});

	it("accepts an empty list and a valid group", () => {
		expect(checkOptionGroups(catalog([]))).toEqual([]);
		expect(checkOptionGroups(catalog([group()]))).toEqual([]);
		expect(checkOptionGroupReferences(catalog([group()]))).toEqual([]);
	});

	it("refuses a group id listed twice", () => {
		expect(rules(checkOptionGroups(catalog([group(), group()])))).toEqual([
			"option-group-unique",
		]);
	});

	it.each([
		["min 0, max 1", 0, 1, true],
		["min 20, max 20", 20, 20, true],
		["min -1", -1, 2, false],
		["min 21, max 21", 21, 21, false],
		["max 0", 0, 0, false],
		["max 21", 0, 21, false],
		["min above max", 2, 1, false],
		["a fractional min", 0.5, 2, false],
	])("judges the limits %s", (_label, minSelect, maxSelect, valid) => {
		const violations = checkOptionGroups(
			catalog([group({ minSelect, maxSelect })]),
		);

		expect(rules(violations)).toEqual(valid ? [] : ["option-group-limits"]);
	});

	it("refuses an option or a target named twice in one group", () => {
		const violations = checkOptionGroups(
			catalog([
				group({
					optionItemExternalIds: ["OPT-1", "OPT-1"],
					appliesToItemExternalIds: ["DR-1", "DR-1"],
				}),
			]),
		);

		expect(violations.map((entry) => entry.message)).toEqual([
			"option group G1 names option item OPT-1 twice",
			"option group G1 names target item DR-1 twice",
		]);
	});

	it("refuses options and targets the catalogue does not list", () => {
		const violations = checkOptionGroupReferences(
			catalog([
				group({
					optionItemExternalIds: ["OPT-1", "OPT-9"],
					appliesToItemExternalIds: ["DR-9"],
				}),
			]),
		);

		expect(rules(violations)).toEqual([
			"option-group-catalog",
			"option-group-catalog",
		]);
	});

	it("refuses an active required group with fewer options than its minimum, not an inactive one", () => {
		const short = group({
			minSelect: 3,
			maxSelect: 3,
			optionItemExternalIds: ["OPT-1", "OPT-2"],
		});
		const exact = group({
			minSelect: 2,
			maxSelect: 2,
			optionItemExternalIds: ["OPT-1", "OPT-2"],
		});

		expect(rules(checkOptionGroupReferences(catalog([short])))).toEqual([
			"option-group-satisfiable",
		]);
		expect(
			checkOptionGroupReferences(catalog([{ ...short, active: false }])),
		).toEqual([]);
		expect(checkOptionGroupReferences(catalog([exact]))).toEqual([]);
	});
});
