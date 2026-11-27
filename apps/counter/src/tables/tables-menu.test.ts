import { describe, expect, it } from "vitest";
import {
	byCategory,
	type CounterMenuItem,
	folded,
	matches,
} from "../menu/menu-api";
import { byArea, type MapTable, tableState } from "./tables-page";

// counter:unit/tables-menu: a table's state on the map (decision table: a call answered or not, orders or not), the
// areas in order, and the accent-free search of the sold-out list.

function table(id: string, overrides: Partial<MapTable> = {}): MapTable {
	return {
		id,
		label: id,
		area: "Tầng 1",
		sort_order: 1,
		call: null,
		open_orders: 0,
		...overrides,
	};
}

describe("the table map", () => {
	const call = {
		id: "c1",
		called_at: "2026-11-28T03:00:00Z",
		waiting_seconds: 30,
	};
	it.each([
		[table("a", { call }), ["c1"], 0, "calling"],
		[table("a", { call }), [], 0, "free"],
		[table("a", { call }), [], 1, "occupied"],
		[table("a", { open_orders: 2 }), [], 0, "occupied"],
		[table("a"), [], 1, "occupied"],
		[table("a"), [], 0, "free"],
	] as const)(
		"%o with calls %o and %i orders on the board is %s",
		(value, calls, orders, state) => {
			expect(tableState(value, new Set(calls), orders)).toBe(state);
		},
	);

	it("groups by area in the order of the tables", () => {
		const groups = byArea([
			table("Bàn 3", { area: "Sân", sort_order: 3 }),
			table("Bàn 1", { sort_order: 1 }),
			table("Bàn 2", { sort_order: 2 }),
			table("Bàn 4", { area: null, sort_order: 4 }),
		]);
		expect(
			groups.map(([area, tables]) => [
				area,
				tables.map((value) => value.label),
			]),
		).toEqual([
			["Tầng 1", ["Bàn 1", "Bàn 2"]],
			["Sân", ["Bàn 3"]],
			["", ["Bàn 4"]],
		]);
	});
});

describe("the sold-out list", () => {
	const item = (name: string, category: string): CounterMenuItem => ({
		id: name,
		brand_id: "b",
		category,
		name,
		order_types: ["table"],
		available: true,
		sold_out_until: null,
		sizes: [],
		option_group_ids: [],
	});

	it("finds names without accents or case", () => {
		expect(folded("Cà Phê Đá")).toBe("ca phe da");
		expect(matches(item("Cà phê sữa", "Cà phê"), "ca phe")).toBe(true);
		expect(matches(item("Trà đào", "Trà"), "DAO")).toBe(true);
		expect(matches(item("Trà đào", "Trà"), "bánh")).toBe(false);
		expect(matches(item("Trà đào", "Trà"), "  ")).toBe(true);
	});

	it("keeps the categories in the menu's order", () => {
		expect(
			byCategory([item("a", "X"), item("b", "Y"), item("c", "X")]).map(
				([category, list]) => [category, list.length],
			),
		).toEqual([
			["X", 2],
			["Y", 1],
		]);
	});
});
