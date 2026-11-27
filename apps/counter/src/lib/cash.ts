// Cash at the counter in whole đồng: counting a drawer by denomination, the difference with what the server expected,
// the change for a customer and the quick amounts a cashier taps. Every value is a whole number; anything else is
// refused, so a wrong number never reaches the server as a plausible amount.

/** The notes a Vietnamese drawer holds, largest first (coins are not in use). */
export const DENOMINATIONS = [
	500_000, 200_000, 100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000,
] as const;
export type Denomination = (typeof DENOMINATIONS)[number];

/** The most notes of one kind a count accepts (a full drawer has far fewer). */
export const MAX_NOTES = 9_999;
/** The largest amount the counter takes (the database's own bound on a payment and a count). */
export const MAX_AMOUNT = 100_000_000;

export type Counts = Readonly<Partial<Record<Denomination, number>>>;

/** A typed count: empty is 0; digits only, at most MAX_NOTES; anything else is null (refused). */
export function parseNoteCount(text: string): number | null {
	const trimmed = text.trim();
	if (trimmed === "") return 0;
	if (!/^\d{1,4}$/.test(trimmed)) return null;
	const value = Number(trimmed);
	return value <= MAX_NOTES ? value : null;
}

/** The total of a count by denomination. A negative, fractional or too large count is a RangeError. */
export function countTotal(counts: Counts): number {
	let total = 0;
	for (const denomination of DENOMINATIONS) {
		const notes = counts[denomination] ?? 0;
		if (!Number.isSafeInteger(notes) || notes < 0 || notes > MAX_NOTES) {
			throw new RangeError(
				`a count of ${denomination} notes must be a whole number from 0 to ${MAX_NOTES}, got ${notes}`,
			);
		}
		total += notes * denomination;
	}
	return total;
}

export function setCount(
	counts: Counts,
	denomination: Denomination,
	notes: number,
): Counts {
	const next = Math.min(MAX_NOTES, Math.max(0, Math.trunc(notes)));
	return { ...counts, [denomination]: next };
}

/** A typed amount of đồng ("200000", "200.000", "200,000đ"): whole, 0 to MAX_AMOUNT; anything else null. */
export function parseAmount(text: string): number | null {
	const digits = text.replace(/[\s.,đ]/g, "");
	if (digits === "") return 0;
	if (!/^\d{1,9}$/.test(digits)) return null;
	const value = Number(digits);
	return value <= MAX_AMOUNT ? value : null;
}

/**
 * The change for a customer: what they gave less the total. Refused (null) when they gave less than the total or
 * when either is not a whole amount within bounds.
 */
export function changeDue(total: number, tendered: number): number | null {
	if (!Number.isSafeInteger(total) || !Number.isSafeInteger(tendered))
		return null;
	if (total < 0 || total > MAX_AMOUNT || tendered < 0 || tendered > MAX_AMOUNT)
		return null;
	if (tendered < total) return null;
	return tendered - total;
}

/** The amounts a cashier taps for a total: exact, the next 10.000, 50.000 and 100.000, then 200.000 and 500.000. */
export function quickAmounts(total: number): number[] {
	if (!Number.isSafeInteger(total) || total <= 0) return [];
	const up = (step: number) => Math.ceil(total / step) * step;
	const candidates = [
		total,
		up(10_000),
		up(50_000),
		up(100_000),
		200_000,
		500_000,
	];
	return [
		...new Set(
			candidates.filter((amount) => amount >= total && amount <= MAX_AMOUNT),
		),
	]
		.sort((a, b) => a - b)
		.slice(0, 5);
}

export type Difference =
	| { readonly kind: "matched" }
	| { readonly kind: "short" | "over"; readonly amount: number };

/** The difference the server answered (counted less expected), in words for the screen. */
export function differenceOf(cashDifference: number): Difference {
	if (cashDifference === 0) return { kind: "matched" };
	return cashDifference < 0
		? { kind: "short", amount: -cashDifference }
		: { kind: "over", amount: cashDifference };
}
