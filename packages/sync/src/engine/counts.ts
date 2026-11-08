import type { TableCounts } from "../rows.js";

export function addCounts(target: TableCounts, source: TableCounts): void {
	for (const [table, count] of Object.entries(source)) {
		target[table] = (target[table] ?? 0) + count;
	}
}

export function sortedCounts(counts: TableCounts): TableCounts {
	return Object.fromEntries(
		Object.entries(counts).sort(([left], [right]) =>
			left < right ? -1 : left > right ? 1 : 0,
		),
	);
}
