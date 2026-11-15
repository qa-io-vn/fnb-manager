import { describe, expect, it } from "vitest";
import type { ItemTypeEntry } from "../source";
import {
	groupsOf,
	keepEdits,
	roleChangesOf,
	roleKeyOf,
	savedDraftOf,
	suggestionsFor,
	usageOf,
	usageWindow,
} from "./roles";

function entry(
	account: string,
	type: string,
	name: string,
	role: ItemTypeEntry["role"],
): ItemTypeEntry {
	return {
		posAccountId: account,
		posAccountName: account === "A" ? "POS trà" : "POS cà phê",
		itemTypeExternalId: type,
		name,
		role,
		audit: null,
	};
}

const ENTRIES = [
	entry("A", "T1", "Trà sữa", "drink"),
	entry("A", "T2", "Topping", null),
	entry("A", "T3", "Đồ ăn kèm", null),
	entry("B", "T1", "Cà phê", null),
];

describe("keepEdits", () => {
	it("keeps what was being changed and takes everything else from the new saved roles", () => {
		const before = {
			"A|T1": "drink",
			"A|T2": "topping",
			"A|T3": null,
		} as const;
		const after = { "A|T1": "food", "A|T2": "other", "A|T3": null } as const;
		const draft = { "A|T1": "drink", "A|T2": null, "A|T3": "snack" } as const;
		expect(keepEdits(before, after, draft)).toEqual({
			"A|T1": "food",
			"A|T2": null,
			"A|T3": "snack",
		});
	});
});

describe("roles drafts", () => {
	it("keys each item type by its POS account, so the same type id in two accounts stays apart", () => {
		const draft = savedDraftOf(ENTRIES);
		expect(draft[roleKeyOf(ENTRIES[0] as ItemTypeEntry)]).toBe("drink");
		expect(draft[roleKeyOf(ENTRIES[3] as ItemTypeEntry)]).toBeNull();
		expect(Object.keys(draft)).toHaveLength(4);
	});

	it("groups the item types under their POS account in the order they come", () => {
		expect(
			groupsOf(ENTRIES).map((group) => [
				group.posAccountName,
				group.entries.map((type) => type.name),
			]),
		).toEqual([
			["POS trà", ["Trà sữa", "Topping", "Đồ ăn kèm"]],
			["POS cà phê", ["Cà phê"]],
		]);
	});

	it("sends only the changed rows, a cleared role as null", () => {
		const draft = {
			...savedDraftOf(ENTRIES),
			"A|T1": null,
			"A|T2": "topping",
		} as const;
		expect(roleChangesOf(ENTRIES, draft)).toEqual([
			{ posAccountId: "A", itemTypeExternalId: "T1", role: null },
			{ posAccountId: "A", itemTypeExternalId: "T2", role: "topping" },
		]);
		expect(roleChangesOf(ENTRIES, savedDraftOf(ENTRIES))).toEqual([]);
	});

	it("suggests a role only for types without one, and only where the name says", () => {
		expect(suggestionsFor(ENTRIES, savedDraftOf(ENTRIES))).toEqual({
			"A|T2": "topping",
			"B|T1": "drink",
		});
		expect(
			suggestionsFor(ENTRIES, { ...savedDraftOf(ENTRIES), "A|T2": "other" }),
		).toEqual({ "B|T1": "drink" });
	});
});

describe("usage of each item type", () => {
	function row(
		type: string | null,
		net: number,
		name: string,
		base: string | null = null,
	) {
		return {
			item_type_external_id: type,
			net_amount: net,
			item_name: name,
			base_name: base,
		};
	}

	it("counts each item once whatever its sizes, and its share of the whole business's item revenue", () => {
		const usage = usageOf([
			{
				posAccountId: "A",
				rows: [
					row("T1", 300, "Trà sữa M", "Trà sữa"),
					row("T1", 300, "Trà sữa L", "Trà sữa"),
					row("T1", 200, "Trà đào"),
					row("T2", 150, "Trân châu"),
					row(null, 50, "Phụ thu"),
				],
			},
			{ posAccountId: "B", rows: [row("T1", 1000, "Cà phê")] },
		]);
		expect(usage.get("A|T1")).toEqual({ items: 2, share: 0.4 });
		expect(usage.get("A|T2")).toEqual({ items: 1, share: 0.075 });
		expect(usage.get("B|T1")).toEqual({ items: 1, share: 0.5 });
		expect(usage.has("A|T3")).toBe(false);
	});

	it("gives no share when nothing was sold", () => {
		expect(
			usageOf([{ posAccountId: "A", rows: [row("T1", 0, "Trà")] }]).get("A|T1"),
		).toEqual({ items: 1, share: null });
	});

	it("covers the 28 days ending on the last complete day", () => {
		expect(usageWindow("2026-11-14")).toEqual({
			from: "2026-10-18",
			to: "2026-11-14",
		});
	});
});
