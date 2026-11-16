import type {
	TableColumn,
	TableRow,
	TableSort,
	TableValue,
	ValueKind,
} from "./types";

const NUMBER_KINDS: ReadonlySet<ValueKind> = new Set<ValueKind>([
	"money",
	"count",
	"decimal",
	"ratio",
	"percent",
	"signedPercent",
	"percentPoints",
	"percentChange",
]);

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

function sortableValue(value: TableValue, numbersOnly: boolean): TableValue {
	return numbersOnly && typeof value !== "number" ? null : value;
}

export function sortRows(
	rows: readonly TableRow[],
	sort: TableSort | null,
	collator: Intl.Collator,
	columns: readonly TableColumn[] = [],
): TableRow[] {
	if (sort === null) return [...rows];
	const factor = sort.direction === "ascending" ? 1 : -1;
	const kind = columns.find((column) => column.key === sort.key)?.kind;
	const numbersOnly = kind !== undefined && NUMBER_KINDS.has(kind);
	return [...rows].sort((left, right) => {
		const leftValue = sortableValue(left.cells[sort.key] ?? null, numbersOnly);
		const rightValue = sortableValue(
			right.cells[sort.key] ?? null,
			numbersOnly,
		);
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
