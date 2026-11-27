import { describe, expect, it } from "vitest";
import type { OptionGroup } from "../menu/menu-api";
import {
	addLine,
	defaultOptions,
	draftReady,
	draftTotal,
	emptyDraft,
	itemCount,
	lineTotal,
	MAX_QTY,
	optionsValid,
	requestOf,
	setQty,
	setType,
	toggleOption,
} from "./draft";

// counter:unit/draft (Q01-U2): the counter's ticket. Equivalence partitions and boundaries of quantities (0 removes, 1,
// 20, 21 held at 20), line totals with option prices, merging the same line, what is sent (never a price but the
// total shown), option groups within their minimum and maximum.

const coffee = {
	itemId: "coffee",
	itemName: "Cà phê sữa",
	sizeId: "coffee-l",
	sizeLabel: "Lớn",
	unitPrice: 35_000,
	options: [{ id: "extra", name: "Thêm shot", price: 6_000 }],
	qty: 1,
	note: "",
};

describe("the ticket", () => {
	it("adds a line, merges the same choices and keeps different notes apart", () => {
		let draft = addLine(emptyDraft("r1"), coffee);
		draft = addLine(draft, { ...coffee, qty: 2 });
		expect(draft.lines).toHaveLength(1);
		expect(draft.lines[0]?.qty).toBe(3);
		draft = addLine(draft, { ...coffee, note: "ít ngọt" });
		expect(draft.lines).toHaveLength(2);
		expect(itemCount(draft, "coffee")).toBe(4);
	});

	it("prices a line with its options and sums the ticket", () => {
		expect(
			lineTotal({ qty: 2, unitPrice: 35_000, options: coffee.options }),
		).toBe(82_000);
		const draft = addLine(addLine(emptyDraft("r"), coffee), {
			...coffee,
			sizeId: "tea",
			unitPrice: 39_000,
			options: [],
			qty: 2,
		});
		expect(draftTotal(draft)).toBe(41_000 + 78_000);
	});

	it.each([
		[0, 0],
		[1, 1],
		[MAX_QTY, MAX_QTY],
		[MAX_QTY + 1, MAX_QTY],
		[-1, 0],
	])("a quantity of %i leaves %i", (qty, left) => {
		const draft = setQty(
			addLine(emptyDraft("r"), coffee),
			addLine(emptyDraft("r"), coffee).lines[0]?.key ?? "",
			qty,
		);
		expect(draft.lines[0]?.qty ?? 0).toBe(left);
	});

	it("needs a table for a table order, none for takeaway", () => {
		const draft = addLine(emptyDraft("r"), coffee);
		expect(draftReady(draft)).toBe(false);
		expect(draftReady({ ...draft, tableId: "t1" })).toBe(true);
		expect(draftReady(setType({ ...draft, tableId: "t1" }, "takeaway"))).toBe(
			true,
		);
		expect(setType({ ...draft, tableId: "t1" }, "takeaway").tableId).toBeNull();
		expect(draftReady(emptyDraft("r"))).toBe(false);
	});

	it("sends ids, quantities, options, notes and the total shown, never a price", () => {
		const draft = {
			...addLine(emptyDraft("req"), { ...coffee, note: "ít đá" }),
			tableId: "t1",
			note: "  khách quen ",
		};
		const request = requestOf(draft);
		expect(request).toEqual({
			request_id: "req",
			type: "table",
			table_id: "t1",
			lines: [{ size: "coffee-l", qty: 1, options: ["extra"], note: "ít đá" }],
			note: "khách quen",
			expected_total: 41_000,
		});
		expect(JSON.stringify(request.lines)).not.toContain("35000");
	});
});

describe("option groups", () => {
	const ice: OptionGroup = {
		id: "ice",
		name: "Đá",
		min_select: 0,
		max_select: 1,
		options: [
			{ id: "less", name: "Ít đá", price_delta: 0, is_default: false },
			{ id: "none", name: "Không đá", price_delta: 0, is_default: true },
		],
	};
	const toppings: OptionGroup = {
		id: "top",
		name: "Topping",
		min_select: 1,
		max_select: 2,
		options: [
			{ id: "a", name: "A", price_delta: 5_000, is_default: false },
			{ id: "b", name: "B", price_delta: 5_000, is_default: false },
			{ id: "c", name: "C", price_delta: 5_000, is_default: false },
		],
	};

	it("starts with the defaults and replaces within a group of one", () => {
		const start = defaultOptions([ice]);
		expect([...start]).toEqual(["none"]);
		expect([...toggleOption(ice, start, "less")]).toEqual(["less"]);
		expect([...toggleOption(ice, new Set(["less"]), "less")]).toEqual([]);
	});

	it("stops at the maximum and checks the minimum (boundaries 0, 1, 2, 3)", () => {
		let chosen = new Set<string>();
		expect(optionsValid([toppings], chosen)).toBe(false);
		chosen = toggleOption(toppings, chosen, "a");
		expect(optionsValid([toppings], chosen)).toBe(true);
		chosen = toggleOption(toppings, chosen, "b");
		expect(optionsValid([toppings], chosen)).toBe(true);
		chosen = toggleOption(toppings, chosen, "c");
		expect([...chosen].sort()).toEqual(["a", "b"]);
		expect(optionsValid([toppings], new Set(["a", "b", "c"]))).toBe(false);
	});
});
