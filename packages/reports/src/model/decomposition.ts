import type {
	Comparison,
	ComparisonBasis,
	Decomposition,
	DecompositionPart,
} from "./card.js";
import { roundHalfAwayFromZero } from "./numeric.js";

export interface DecompositionSums {
	readonly net: number | null;
	readonly invoices: number | null;
	readonly items: number | null;
}

export interface DecompositionResult {
	readonly total: number;
	readonly parts: readonly DecompositionPart[];
}

interface Factors {
	readonly net: number;
	readonly invoices: number;
	readonly ticket: number;
	readonly itemsPerTicket: number;
	readonly itemPrice: number;
}

function factorsOf(sums: DecompositionSums): Factors | null {
	const { net, invoices, items } = sums;
	if (net === null || invoices === null || items === null) return null;
	if (invoices === 0 || items === 0) return null;
	return {
		net,
		invoices,
		ticket: net / invoices,
		itemsPerTicket: items / invoices,
		itemPrice: net / items,
	};
}

function whole(value: number): number {
	return roundHalfAwayFromZero(value, 0);
}

function cents(value: number): number {
	return roundHalfAwayFromZero(value, 2);
}

export function decomposeNet(
	current: DecompositionSums,
	reference: DecompositionSums,
): DecompositionResult | null {
	const one = factorsOf(current);
	const zero = factorsOf(reference);
	if (one === null || zero === null) return null;
	const total = whole(one.net - zero.net);
	const traffic = whole(
		((one.invoices - zero.invoices) * (zero.ticket + one.ticket)) / 2,
	);
	const items = whole(
		((((one.itemsPerTicket - zero.itemsPerTicket) *
			(zero.itemPrice + one.itemPrice)) /
			2) *
			(zero.invoices + one.invoices)) /
			2,
	);
	const price = whole(total - traffic - items);
	return {
		total,
		parts: [
			{
				factor: "invoices",
				from: zero.invoices,
				to: one.invoices,
				effect: traffic,
			},
			{
				factor: "items_per_ticket",
				from: roundHalfAwayFromZero(zero.itemsPerTicket, 4),
				to: roundHalfAwayFromZero(one.itemsPerTicket, 4),
				effect: items,
			},
			{
				factor: "avg_item_price",
				from: cents(zero.itemPrice),
				to: cents(one.itemPrice),
				effect: price,
			},
		],
	};
}

export function decomposeTicket(
	current: DecompositionSums,
	reference: DecompositionSums,
): DecompositionResult | null {
	const one = factorsOf(current);
	const zero = factorsOf(reference);
	if (one === null || zero === null) return null;
	const total = cents(one.ticket - zero.ticket);
	const items = cents(
		((one.itemsPerTicket - zero.itemsPerTicket) *
			(zero.itemPrice + one.itemPrice)) /
			2,
	);
	const price = cents(total - items);
	return {
		total,
		parts: [
			{
				factor: "items_per_ticket",
				from: roundHalfAwayFromZero(zero.itemsPerTicket, 4),
				to: roundHalfAwayFromZero(one.itemsPerTicket, 4),
				effect: items,
			},
			{
				factor: "avg_item_price",
				from: cents(zero.itemPrice),
				to: cents(one.itemPrice),
				effect: price,
			},
		],
	};
}

export function decomposition(
	metric: Decomposition["metric"],
	against: Decomposition["against"],
	basis: ComparisonBasis,
	result: DecompositionResult | null,
): Decomposition | null {
	if (result === null) return null;
	return { metric, against, basis, total: result.total, parts: result.parts };
}

export function decompositionAgainst(
	comparisons: readonly Comparison[],
): Comparison | null {
	const usable = (kind: Comparison["kind"]) =>
		comparisons.find(
			(candidate) =>
				candidate.kind === kind &&
				candidate.unavailable === null &&
				candidate.reference !== null,
		) ?? null;
	return usable("previous") ?? usable("last_year");
}

export function largestPart(
	parts: readonly DecompositionPart[],
): DecompositionPart | null {
	let largest: DecompositionPart | null = null;
	for (const candidate of parts) {
		if (
			largest === null ||
			Math.abs(candidate.effect) > Math.abs(largest.effect)
		) {
			largest = candidate;
		}
	}
	return largest;
}
