// Test design (ISTQB): how the sync writes the catalogue's option groups (ADR-058 phase 3). Partitions of the
// catalogue: option groups absent (the tables are left as they are), empty (the account's groups turn inactive
// and its options and targets go), present. State transitions over two master-data runs: a group kept, changed,
// dropped; an option or target removed. Merging stores: absent everywhere, present in one, the same group in two
// stores with different targets. The mock connector's groups reach the repository end to end.
import { createMockConnector } from "@fnb/connector-mock";
import type { CanonicalCatalog, CanonicalOptionGroup } from "@fnb/core";
import { describe, expect, it } from "vitest";
import { mapCatalog, mapOptionGroups, mergeCatalogs } from "../../src/index.js";
import {
	createFakeConnector,
	EMPTY_CATALOG,
} from "../support/fake-connector.js";
import { createTestBed } from "../support/setup.js";

function group(
	overrides: Partial<CanonicalOptionGroup> = {},
): CanonicalOptionGroup {
	return {
		externalId: "C1:0",
		name: "Topping",
		minSelect: 0,
		maxSelect: 2,
		optionItemExternalIds: ["OPT-A", "OPT-B"],
		appliesToItemExternalIds: ["DR-1"],
		active: true,
		raw: { customizationUid: "C1" },
		...overrides,
	};
}

function withGroups(optionGroups?: CanonicalOptionGroup[]): CanonicalCatalog {
	return optionGroups === undefined
		? EMPTY_CATALOG
		: { ...EMPTY_CATALOG, optionGroups };
}

const CONTEXT = {
	tenantId: "dddddddd-dddd-4ddd-8ddd-000000000001",
	posAccountId: "cccccccc-cccc-4ccc-8ccc-000000000001",
	includeCosts: false,
};

describe("option group rows", () => {
	it("maps groups, options in POS order and targets", () => {
		expect(mapOptionGroups([group()])).toEqual({
			groups: [
				{
					external_id: "C1:0",
					name: "Topping",
					min_select: 0,
					max_select: 2,
					active: true,
					raw: { customizationUid: "C1" },
				},
			],
			options: [
				{ group_external_id: "C1:0", item_external_id: "OPT-A", sort_order: 0 },
				{ group_external_id: "C1:0", item_external_id: "OPT-B", sort_order: 1 },
			],
			targets: [{ group_external_id: "C1:0", item_external_id: "DR-1" }],
		});
	});

	it("writes no option groups for a catalogue without them, and an empty set for an empty list", () => {
		expect(mapCatalog(withGroups(), CONTEXT).option_groups).toBeNull();
		expect(mapCatalog(withGroups([]), CONTEXT).option_groups).toEqual({
			groups: [],
			options: [],
			targets: [],
		});
	});

	it("merges stores: absent everywhere stays absent; one group listed twice keeps its first options and every target", () => {
		expect(
			mergeCatalogs([withGroups(), withGroups()]).optionGroups,
		).toBeUndefined();
		const merged = mergeCatalogs([
			withGroups(),
			withGroups([group({ optionItemExternalIds: ["OPT-A"] })]),
			withGroups([
				group({
					optionItemExternalIds: ["OPT-Z"],
					appliesToItemExternalIds: ["DR-1", "DR-2"],
				}),
				group({ externalId: "C0:0" }),
			]),
		]);

		expect(merged.optionGroups?.map((entry) => entry.externalId)).toEqual([
			"C0:0",
			"C1:0",
		]);
		expect(merged.optionGroups?.[1]).toMatchObject({
			optionItemExternalIds: ["OPT-A"],
			appliesToItemExternalIds: ["DR-1", "DR-2"],
		});
	});
});

describe("option groups in the repository", () => {
	const STORE = {
		externalId: "STORE-1",
		name: "Cửa hàng thử",
		timezone: "Asia/Ho_Chi_Minh",
		dayStartMinutes: 0,
		currency: "VND",
	};

	async function syncWith(optionGroups?: CanonicalOptionGroup[]) {
		const bed = await createTestBed();
		const run = async (groups?: CanonicalOptionGroup[]) =>
			bed
				.engine(
					createFakeConnector({
						stores: [STORE],
						catalog: withGroups(groups),
					}),
				)
				.syncMasterData(bed.account);
		const first = await run(optionGroups);
		return { bed, run, first };
	}

	it("writes the groups, their options and targets with counts", async () => {
		const { bed, first } = await syncWith([group()]);

		expect(first.tables).toMatchObject({
			item_option_groups: 1,
			item_option_group_options: 2,
			item_option_group_targets: 1,
		});
		expect(
			bed.repository
				.catalogRows("item_option_groups")
				.map((row) => [row.external_id, row.active, row.values.max_select]),
		).toEqual([["C1:0", true, 2]]);
		expect(bed.repository.optionGroupLinks(bed.account.id)).toEqual({
			options: [
				{ group_external_id: "C1:0", item_external_id: "OPT-A", sort_order: 0 },
				{ group_external_id: "C1:0", item_external_id: "OPT-B", sort_order: 1 },
			],
			targets: [{ group_external_id: "C1:0", item_external_id: "DR-1" }],
		});
	});

	it("leaves everything as it was when a later catalogue carries no option groups", async () => {
		const { bed, run } = await syncWith([group()]);

		const second = await run(undefined);

		expect(second.tables.item_option_groups).toBeUndefined();
		expect(bed.repository.catalogRows("item_option_groups")[0]?.active).toBe(
			true,
		);
		expect(
			bed.repository.optionGroupLinks(bed.account.id).options,
		).toHaveLength(2);
	});

	it("follows the POS on the next run: a changed group, a dropped group turned inactive, removed options and targets gone", async () => {
		const { bed, run } = await syncWith([
			group(),
			group({ externalId: "C2:0", optionItemExternalIds: ["OPT-C"] }),
		]);

		await run([
			group({
				maxSelect: 1,
				optionItemExternalIds: ["OPT-B"],
				appliesToItemExternalIds: ["DR-2"],
			}),
		]);

		expect(
			bed.repository
				.catalogRows("item_option_groups")
				.map((row) => [row.external_id, row.active, row.values.max_select]),
		).toEqual([
			["C1:0", true, 1],
			["C2:0", false, 2],
		]);
		expect(bed.repository.optionGroupLinks(bed.account.id)).toEqual({
			options: [
				{ group_external_id: "C1:0", item_external_id: "OPT-B", sort_order: 0 },
			],
			targets: [{ group_external_id: "C1:0", item_external_id: "DR-2" }],
		});
	});

	it("turns every group inactive and clears options and targets for an empty list", async () => {
		const { bed, run } = await syncWith([group()]);

		await run([]);

		expect(bed.repository.catalogRows("item_option_groups")[0]?.active).toBe(
			false,
		);
		expect(bed.repository.optionGroupLinks(bed.account.id)).toEqual({
			options: [],
			targets: [],
		});
	});

	it("writes the mock connector's groups end to end", async () => {
		const bed = await createTestBed({ storeExternalId: "MOCK-S1" });
		const connector = createMockConnector();
		await connector.authenticate({ seed: 3, storeCount: 2 });

		const summary = await bed.engine(connector).syncMasterData(bed.account);

		expect(summary.tables.item_option_groups).toBe(3);
		const links = bed.repository.optionGroupLinks(bed.account.id);
		expect(links.options.length).toBe(summary.tables.item_option_group_options);
		expect(links.targets.length).toBe(summary.tables.item_option_group_targets);
		const items = new Set(
			bed.repository.catalogRows("items").map((row) => row.external_id),
		);
		expect(
			[...links.options, ...links.targets].every((link) =>
				items.has(link.item_external_id),
			),
		).toBe(true);
	});
});
