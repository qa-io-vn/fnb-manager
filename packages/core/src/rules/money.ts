export const MONEY_DECIMALS = 2;
export const DEFAULT_MONEY_TOLERANCE = 0.005;

export function roundMoney(value: number, decimals = MONEY_DECIMALS): number {
	const factor = 10 ** decimals;
	const magnitude = Math.round((Math.abs(value) + Number.EPSILON) * factor);
	const rounded = magnitude / factor;
	return value < 0 ? -rounded : rounded;
}

export function sumMoney(values: Iterable<number>): number {
	let total = 0;
	for (const value of values) {
		total += value;
	}
	return roundMoney(total);
}

export function moneyEquals(
	left: number,
	right: number,
	tolerance = DEFAULT_MONEY_TOLERANCE,
): boolean {
	return Math.abs(left - right) <= tolerance;
}
