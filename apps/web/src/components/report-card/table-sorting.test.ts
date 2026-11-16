import { describe, expect, it } from "vitest";
import { nextSort, sortRows } from "./table-sorting";
import type { TableColumn, TableRow } from "./types";

const collator = new Intl.Collator("vi-VN");

const columns: readonly TableColumn[] = [
	{ key: "store", label: "Cửa hàng", kind: "text" },
	{ key: "revpash", label: "Doanh thu mỗi ghế mỗi giờ", kind: "money" },
];

const rows: readonly TableRow[] = [
	{ id: "a", cells: { store: "Bình", revpash: 12_000 } },
	{ id: "b", cells: { store: "An", revpash: "chưa thiết lập" } },
	{ id: "c", cells: { store: "Châu", revpash: null } },
	{ id: "d", cells: { store: "Dung", revpash: 30_000 } },
];

function ids(sorted: readonly TableRow[]): string[] {
	return sorted.map((row) => row.id);
}

describe("table sorting", () => {
	it("puts a state written in a number column after every number, in both directions, like an empty cell", () => {
		for (const direction of ["descending", "ascending"] as const) {
			const sorted = ids(
				sortRows(rows, { key: "revpash", direction }, collator, columns),
			);
			expect(sorted.slice(0, 2)).toEqual(
				direction === "descending" ? ["d", "a"] : ["a", "d"],
			);
			expect([...sorted.slice(2)].sort()).toEqual(["b", "c"]);
		}
	});

	it("sorts text columns by the collator and keeps their text cells in place among each other", () => {
		expect(
			ids(
				sortRows(
					rows,
					{ key: "store", direction: "ascending" },
					collator,
					columns,
				),
			),
		).toEqual(["b", "a", "c", "d"]);
	});

	it("leaves the order alone without a sort and starts a new column descending", () => {
		expect(ids(sortRows(rows, null, collator, columns))).toEqual([
			"a",
			"b",
			"c",
			"d",
		]);
		expect(nextSort(null, "revpash")).toEqual({
			key: "revpash",
			direction: "descending",
		});
		expect(
			nextSort({ key: "revpash", direction: "descending" }, "revpash"),
		).toEqual({ key: "revpash", direction: "ascending" });
	});
});
