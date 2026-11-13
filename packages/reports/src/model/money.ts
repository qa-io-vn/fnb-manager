const MINOR_UNITS = 100;
const QUANTITY_UNITS = 1000;

function sumIn(
	units: number,
	values: Iterable<number | null | undefined>,
): number {
	let total = 0;
	for (const value of values) {
		if (value === null || value === undefined) continue;
		total += Math.round(value * units);
	}
	return total / units;
}

export function sumMoney(values: Iterable<number | null | undefined>): number {
	return sumIn(MINOR_UNITS, values);
}

export function sumQuantity(
	values: Iterable<number | null | undefined>,
): number {
	return sumIn(QUANTITY_UNITS, values);
}

export function sumMoneyOrNull(
	values: Iterable<number | null | undefined>,
): number | null {
	const present = [...values].filter(
		(value): value is number => value !== null && value !== undefined,
	);
	return present.length === 0 ? null : sumMoney(present);
}
