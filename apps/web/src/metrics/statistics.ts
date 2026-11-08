export function median(values: readonly number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	const upper = sorted[middle] ?? 0;
	if (sorted.length % 2 === 1) return upper;
	const lower = sorted[middle - 1] ?? 0;
	return (lower + upper) / 2;
}

export function changeFraction(
	current: number | null,
	reference: number | null,
): number | null {
	if (current === null || reference === null || reference === 0) return null;
	return (current - reference) / reference;
}

export function shareOf(part: number, total: number): number | null {
	return total === 0 ? null : part / total;
}

export function sum(values: readonly number[]): number {
	return values.reduce((total, value) => total + value, 0);
}
