import type { AnalyticsRow } from "../contract/functions.js";
import type { DateRange } from "../contract/values.js";
import type { Comparison, ComparisonKind, UnavailableReason } from "./card.js";
import type { Coverage, CoverageModel } from "./coverage.js";
import { reportKeys } from "./keys.js";
import { difference, relativeChange } from "./numeric.js";
import {
	numberValue,
	partValue,
	type SentencePart,
	type ValueUnit,
} from "./values.js";

export type { Comparison } from "./card.js";

export type PeriodRowLike =
	| AnalyticsRow<"period_compare_by_store">
	| AnalyticsRow<"period_compare">;

export type ReferenceKind = "previous" | "last_year";
export type PeriodReferenceKind = ReferenceKind | "baseline";

export const FULL_BASELINE_WEEKS = 8;

function isAllStoresRow(row: PeriodRowLike): boolean {
	return !("store_id" in row) || row.store_id === null;
}

function rowOf<Row extends PeriodRowLike>(
	rows: readonly Row[] | undefined,
	period: string,
): Row | undefined {
	return rows?.find((row) => row.period === period && isAllStoresRow(row));
}

export function likeForLikeLabel(
	label: SentencePart,
	coverage: Coverage,
): SentencePart {
	return {
		key: reportKeys.compare.likeForLike,
		values: {
			label: partValue(label),
			covered: numberValue("count", coverage.coveredStoreIds.length),
			total: numberValue("count", coverage.storeCount),
		},
	};
}

export function baselineLabel(
	label: SentencePart,
	sampleDays: number,
): SentencePart {
	if (sampleDays >= FULL_BASELINE_WEEKS) return label;
	return {
		key: reportKeys.compare.baselinePartial,
		values: { days: numberValue("count", sampleDays) },
	};
}

export function noCoverageReason(
	coverage: CoverageModel,
	storeIds: readonly string[],
	from: string,
): UnavailableReason {
	return storeIds.some((id) => coverage.isYoungAt(id, from))
		? "store_too_young"
		: "no_data";
}

export interface ComparisonInput {
	readonly kind: ComparisonKind;
	readonly label: SentencePart;
	readonly range: DateRange | null;
	readonly current: number | null;
	readonly reference: number | null;
	readonly basis?: Comparison["basis"];
	readonly coveredStores: number;
	readonly totalStores: number;
	readonly sampleDays?: number | null;
	readonly unavailable?: UnavailableReason | null;
	readonly unit?: ValueUnit;
}

export function comparison(input: ComparisonInput): Comparison {
	const unavailable =
		input.unavailable ??
		(input.current === null || input.reference === null ? "no_data" : null);
	const usable = unavailable === null;
	return {
		kind: input.kind,
		label: input.label,
		range: input.range,
		current: input.current,
		reference: usable ? input.reference : null,
		change: usable ? relativeChange(input.current, input.reference) : null,
		difference: usable ? difference(input.current, input.reference) : null,
		basis: input.basis ?? "all_stores",
		coveredStores: input.coveredStores,
		totalStores: input.totalStores,
		sampleDays: input.sampleDays ?? null,
		unavailable,
		...(input.unit === undefined ? {} : { unit: input.unit }),
	};
}

export function withUnit(
	comparisons: readonly Comparison[],
	unit: ValueUnit,
): readonly Comparison[] {
	return comparisons.map((entry) => ({ ...entry, unit }));
}

export function comparisonsFromPeriodRows(input: {
	readonly all: readonly AnalyticsRow<"period_compare_by_store">[];
	readonly likeForLike: Partial<
		Record<ReferenceKind, readonly AnalyticsRow<"period_compare">[]>
	>;
	readonly coverage: CoverageModel;
	readonly kinds: readonly PeriodReferenceKind[];
	readonly pick: (row: PeriodRowLike) => number | null;
	readonly labels: Readonly<Record<PeriodReferenceKind, SentencePart>>;
}): readonly Comparison[] {
	const currentRow = rowOf(input.all, "current");
	const current = currentRow ? input.pick(currentRow) : null;
	return input.kinds.map((kind) => {
		const label = input.labels[kind];
		const referenceRow = rowOf(input.all, kind);
		const range = referenceRow
			? { from: referenceRow.from_date, to: referenceRow.to_date }
			: null;
		if (kind === "baseline") {
			const sampleDays = referenceRow?.days_with_data ?? 0;
			const storeCount = input.coverage.storeCount;
			if (referenceRow === undefined || sampleDays < 1) {
				return comparison({
					kind,
					label,
					range,
					current,
					reference: null,
					coveredStores: 0,
					totalStores: storeCount,
					sampleDays,
					unavailable: "building_baseline",
				});
			}
			return comparison({
				kind,
				label: baselineLabel(label, sampleDays),
				range,
				current,
				reference: input.pick(referenceRow),
				coveredStores: storeCount,
				totalStores: storeCount,
				sampleDays,
			});
		}
		if (range === null) {
			return comparison({
				kind,
				label,
				range,
				current,
				reference: null,
				coveredStores: 0,
				totalStores: input.coverage.storeCount,
				unavailable: "no_data",
			});
		}
		const coverage = input.coverage.forReference(range.from);
		if (coverage.state === "full") {
			return comparison({
				kind,
				label,
				range,
				current,
				reference: referenceRow ? input.pick(referenceRow) : null,
				coveredStores: coverage.storeCount,
				totalStores: coverage.storeCount,
			});
		}
		if (coverage.state === "partial") {
			const rows = input.likeForLike[kind];
			const lflCurrent = rowOf(rows, "current");
			const lflReference = rowOf(rows, kind);
			return comparison({
				kind,
				label: likeForLikeLabel(label, coverage),
				range: lflReference
					? { from: lflReference.from_date, to: lflReference.to_date }
					: range,
				current: lflCurrent ? input.pick(lflCurrent) : null,
				reference: lflReference ? input.pick(lflReference) : null,
				basis: "like_for_like",
				coveredStores: coverage.coveredStoreIds.length,
				totalStores: coverage.storeCount,
			});
		}
		return comparison({
			kind,
			label,
			range,
			current,
			reference: null,
			coveredStores: 0,
			totalStores: coverage.storeCount,
			unavailable: noCoverageReason(
				input.coverage,
				coverage.youngStoreIds,
				range.from,
			),
		});
	});
}

function metricRowOf(
	rows: readonly AnalyticsRow<"metric_compare">[] | undefined,
	metricId: string,
	period: string,
): AnalyticsRow<"metric_compare"> | undefined {
	return rows?.find(
		(row) => row.metric_id === metricId && row.period === period,
	);
}

export function comparisonsFromMetricRows(input: {
	readonly all: readonly AnalyticsRow<"metric_compare">[];
	readonly likeForLike: Partial<
		Record<ReferenceKind, readonly AnalyticsRow<"metric_compare">[]>
	>;
	readonly coverage: CoverageModel;
	readonly metricId: string;
	readonly kinds: readonly ReferenceKind[];
	readonly labels: Readonly<Record<ReferenceKind, SentencePart>>;
}): readonly Comparison[] {
	const current =
		metricRowOf(input.all, input.metricId, "current")?.value ?? null;
	return input.kinds.map((kind) => {
		const label = input.labels[kind];
		const referenceRow = metricRowOf(input.all, input.metricId, kind);
		if (referenceRow === undefined) {
			return comparison({
				kind,
				label,
				range: null,
				current,
				reference: null,
				coveredStores: 0,
				totalStores: input.coverage.storeCount,
				unavailable: "no_data",
			});
		}
		const range = { from: referenceRow.from_date, to: referenceRow.to_date };
		const coverage = input.coverage.forReference(range.from);
		if (coverage.state === "full") {
			return comparison({
				kind,
				label,
				range,
				current,
				reference: referenceRow.value,
				coveredStores: coverage.storeCount,
				totalStores: coverage.storeCount,
			});
		}
		if (coverage.state === "partial") {
			const rows = input.likeForLike[kind];
			return comparison({
				kind,
				label: likeForLikeLabel(label, coverage),
				range,
				current: metricRowOf(rows, input.metricId, "current")?.value ?? null,
				reference: metricRowOf(rows, input.metricId, kind)?.value ?? null,
				basis: "like_for_like",
				coveredStores: coverage.coveredStoreIds.length,
				totalStores: coverage.storeCount,
			});
		}
		return comparison({
			kind,
			label,
			range,
			current,
			reference: null,
			coveredStores: 0,
			totalStores: coverage.storeCount,
			unavailable: noCoverageReason(
				input.coverage,
				coverage.youngStoreIds,
				range.from,
			),
		});
	});
}
