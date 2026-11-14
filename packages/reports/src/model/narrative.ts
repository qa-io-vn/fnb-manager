import type { Comparison, Decomposition } from "./card.js";
import { MAX_NARRATIVE_PARTS } from "./card.js";
import { largestPart } from "./decomposition.js";
import {
	decompositionClauseKey,
	decompositionReferenceClauseKey,
	driverClauseKey,
	reportKeys,
} from "./keys.js";
import {
	type NumericValueKind,
	numberValue,
	part,
	partValue,
	type SentencePart,
	signedKindOf,
	type TypedValue,
	type ValueUnit,
} from "./values.js";

export const FLAT_THRESHOLD = 0.005;
export const MIN_VISIBLE_SHARE_CHANGE = 0.0005;

export type DriverDimension =
	| "store"
	| "hour"
	| "weekday"
	| "day"
	| "month"
	| "item"
	| "category"
	| "promotion"
	| "payment"
	| "cashier";

export interface DriverCandidate {
	readonly dimension: DriverDimension;
	readonly label: TypedValue;
	readonly contribution: number;
	readonly unit: ValueUnit;
}

export type MainClause = "up" | "down" | "flat" | "noReference" | "noData";

export interface NarrativeInput {
	readonly main: Readonly<Record<MainClause, string>>;
	readonly values: Readonly<Record<string, TypedValue>>;
	readonly current: number | null;
	readonly comparison: Comparison | null;
	readonly notes: readonly SentencePart[];
	readonly drivers: readonly DriverCandidate[];
	readonly decomposition: Decomposition | null;
	readonly references?: readonly Comparison[];
}

export function mainClauseOf(
	current: number | null,
	comparison: Comparison | null,
): MainClause {
	if (current === null) return "noData";
	if (
		comparison === null ||
		comparison.unavailable !== null ||
		comparison.change === null
	) {
		return "noReference";
	}
	if (Math.abs(comparison.change) < FLAT_THRESHOLD) return "flat";
	if (
		comparison.unit === "fraction" &&
		comparison.difference !== null &&
		Math.abs(comparison.difference) < MIN_VISIBLE_SHARE_CHANGE
	) {
		return "flat";
	}
	return comparison.change > 0 ? "up" : "down";
}

export function strongestDriver(
	candidates: readonly DriverCandidate[],
	totalChange: number,
): { candidate: DriverCandidate; against: boolean } | null {
	let strongest: DriverCandidate | null = null;
	for (const candidate of candidates) {
		if (!Number.isFinite(candidate.contribution)) continue;
		if (
			strongest === null ||
			Math.abs(candidate.contribution) > Math.abs(strongest.contribution)
		) {
			strongest = candidate;
		}
	}
	if (strongest === null || strongest.contribution === 0) return null;
	const against =
		totalChange !== 0 &&
		Math.sign(strongest.contribution) !== Math.sign(totalChange);
	return { candidate: strongest, against };
}

function orderedCandidates(
	candidates: readonly DriverCandidate[],
): readonly DriverCandidate[] {
	const stores = candidates.filter(
		(candidate) => candidate.dimension === "store",
	);
	if (stores.some((candidate) => candidate.contribution !== 0)) return stores;
	return candidates.filter((candidate) => candidate.dimension !== "store");
}

function totalChangeOf(comparison: Comparison | null): number {
	if (comparison === null || comparison.unavailable !== null) return 0;
	return comparison.difference ?? 0;
}

export function driverClause(
	candidates: readonly DriverCandidate[],
	totalChange: number,
): SentencePart | null {
	const strongest = strongestDriver(orderedCandidates(candidates), totalChange);
	if (strongest === null) return null;
	const { candidate, against } = strongest;
	return {
		key: driverClauseKey(candidate.dimension, against),
		values: {
			[candidate.dimension]: candidate.label,
			delta: numberValue(signedKindOf(candidate.unit), candidate.contribution),
		},
	};
}

export function decompositionClause(
	decomposition: Decomposition | null,
): SentencePart | null {
	if (decomposition === null) return null;
	const largest = largestPart(decomposition.parts);
	if (largest === null || largest.effect === 0) return null;
	return {
		key: decompositionClauseKey(largest.factor),
		values: { effect: numberValue("moneySigned", largest.effect) },
	};
}

export function decompositionReferenceClause(
	decomposition: Decomposition | null,
	reference: Comparison | null,
): SentencePart | null {
	if (decomposition === null || reference === null) return null;
	const largest = largestPart(decomposition.parts);
	if (largest === null || largest.effect === 0) return null;
	return {
		key: decompositionReferenceClauseKey(largest.factor),
		values: {
			against: partValue(reference.label),
			total: numberValue("moneySigned", decomposition.total),
			effect: numberValue("moneySigned", largest.effect),
		},
	};
}

function numericKindOf(value: TypedValue | undefined): NumericValueKind | null {
	if (value === undefined) return null;
	switch (value.kind) {
		case "money":
		case "moneyExact":
		case "count":
		case "decimal":
		case "ratio":
		case "percent":
			return value.kind;
		default:
			return null;
	}
}

export function likeForLikeNote(
	comparison: Comparison | null,
	valueKind: NumericValueKind | null,
): SentencePart | null {
	if (
		comparison === null ||
		comparison.basis !== "like_for_like" ||
		comparison.unavailable !== null
	) {
		return null;
	}
	const counts = {
		covered: numberValue("count", comparison.coveredStores),
		total: numberValue("count", comparison.totalStores),
	};
	if (
		valueKind === null ||
		comparison.current === null ||
		comparison.reference === null
	) {
		return part(reportKeys.clause.coverage.likeForLike, counts);
	}
	return part(reportKeys.clause.coverage.likeForLikeValues, {
		...counts,
		current: numberValue(valueKind, comparison.current),
		reference: numberValue(valueKind, comparison.reference),
	});
}

function referenceOf(
	input: NarrativeInput,
	decomposition: Decomposition,
): Comparison | null {
	return (
		input.references?.find(
			(candidate) =>
				candidate.kind === decomposition.against &&
				candidate.basis === decomposition.basis &&
				candidate.unavailable === null,
		) ?? null
	);
}

function followUpClause(
	input: NarrativeInput,
	clause: MainClause,
): SentencePart | null {
	if (clause === "noData") return null;
	const measuredAgainstMain = !(
		clause === "noReference" && input.comparison !== null
	);
	const trend = clause === "up" || clause === "down";
	if (measuredAgainstMain) {
		const driver = driverClause(
			input.drivers,
			trend ? totalChangeOf(input.comparison) : 0,
		);
		if (driver !== null) return driver;
	}
	const split = input.decomposition;
	if (split === null) return null;
	if (input.comparison !== null && split.against === input.comparison.kind) {
		return trend ? decompositionClause(split) : null;
	}
	if (input.comparison === null) return decompositionClause(split);
	return decompositionReferenceClause(split, referenceOf(input, split));
}

export function narrate(input: NarrativeInput): readonly SentencePart[] {
	const clause = mainClauseOf(input.current, input.comparison);
	const values: Record<string, TypedValue> = { ...input.values };
	if (
		(clause === "up" || clause === "down" || clause === "flat") &&
		input.comparison?.change !== null &&
		input.comparison?.change !== undefined
	) {
		values.delta = numberValue("percent", Math.abs(input.comparison.change));
	}
	const parts: SentencePart[] = [{ key: input.main[clause], values }];
	const coverageNote =
		clause === "up" || clause === "down" || clause === "flat"
			? likeForLikeNote(input.comparison, numericKindOf(input.values.value))
			: null;
	const note = coverageNote ?? input.notes[0];
	if (note !== undefined) parts.push(note);
	const follow = followUpClause(input, clause);
	if (follow !== null) parts.push(follow);
	return parts.slice(0, MAX_NARRATIVE_PARTS);
}
