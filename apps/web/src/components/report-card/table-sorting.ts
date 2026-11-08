import type { TableRow, TableSort, TableValue } from "./types";

function compareValues(
	left: TableValue,
	right: TableValue,
	collator: Intl.Collator,
): number {
	if (left === null && right === null) return 0;
	if (left === null) return 1;
	if (right === null) return -1;
	if (typeof left === "number" && typeof right === "number")
		return left - right;
	return collator.compare(String(left), String(right));
}

export function sortRows(
	rows: readonly TableRow[],
	sort: TableSort | null,
	collator: Intl.Collator,
): TableRow[] {
	if (sort === null) return [...rows];
	const factor = sort.direction === "ascending" ? 1 : -1;
	return [...rows].sort((left, right) => {
		const leftValue = left.cells[sort.key] ?? null;
		const rightValue = right.cells[sort.key] ?? null;
		if (leftValue === null || rightValue === null) {
			return compareValues(leftValue, rightValue, collator);
		}
		return factor * compareValues(leftValue, rightValue, collator);
	});
}

export function nextSort(current: TableSort | null, key: string): TableSort {
	if (current?.key === key) {
		return {
			key,
			direction: current.direction === "ascending" ? "descending" : "ascending",
		};
	}
	return { key, direction: "descending" };
}
