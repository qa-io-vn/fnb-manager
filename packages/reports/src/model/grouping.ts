import { roundHalfAwayFromZero } from "./numeric.js";

export const SHARE_DIGITS = 6;

export function groupRows<Row>(
	rows: readonly Row[],
	key: (row: Row) => string,
): Map<string, Row[]> {
	const groups = new Map<string, Row[]>();
	for (const row of rows) {
		const groupKey = key(row);
		const group = groups.get(groupKey);
		if (group === undefined) {
			groups.set(groupKey, [row]);
		} else {
			group.push(row);
		}
	}
	return groups;
}

export function topN<Row>(
	rows: readonly Row[],
	count: number,
	compare: (left: Row, right: Row) => number,
): Row[] {
	return rows
		.map((row, index) => ({ row, index }))
		.sort(
			(left, right) => compare(left.row, right.row) || left.index - right.index,
		)
		.slice(0, Math.max(0, count))
		.map(({ row }) => row);
}

export function byDescending<Row>(
	value: (row: Row) => number | null,
): (left: Row, right: Row) => number {
	return (left, right) =>
		(value(right) ?? Number.NEGATIVE_INFINITY) -
		(value(left) ?? Number.NEGATIVE_INFINITY);
}

export function byAscending<Row>(
	value: (row: Row) => number | null,
): (left: Row, right: Row) => number {
	return (left, right) =>
		(value(left) ?? Number.POSITIVE_INFINITY) -
		(value(right) ?? Number.POSITIVE_INFINITY);
}

export function cumulativeShares(
	values: readonly number[],
	digits: number = SHARE_DIGITS,
): (number | null)[] {
	const minor = values.map((value) => Math.round(value * 100));
	const total = minor.reduce((sum, value) => sum + value, 0);
	if (total === 0) return values.map(() => null);
	let running = 0;
	return minor.map((value) => {
		running += value;
		return roundHalfAwayFromZero(running / total, digits);
	});
}

export function shares(
	values: readonly number[],
	digits: number = SHARE_DIGITS,
): (number | null)[] {
	const minor = values.map((value) => Math.round(value * 100));
	const total = minor.reduce((sum, value) => sum + value, 0);
	if (total === 0) return values.map(() => null);
	return minor.map((value) => roundHalfAwayFromZero(value / total, digits));
}

export function countToReach(
	cumulative: readonly (number | null)[],
	threshold: number,
): number | null {
	const index = cumulative.findIndex(
		(share) => share !== null && share >= threshold,
	);
	return index < 0 ? null : index + 1;
}
