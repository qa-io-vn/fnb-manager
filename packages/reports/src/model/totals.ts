import type { AnalyticsRow } from "../contract/functions.js";
import type { ComparePeriod, IsoDate } from "../contract/values.js";
import {
	type CallResults,
	COMPARE_LIKE_FOR_LIKE_KEYS,
	METRICS_LIKE_FOR_LIKE_KEYS,
	type ReportContext,
	type ReportStore,
} from "../definition.js";
import type { CardMarkers, Comparison, TableCell } from "./card.js";
import type { ReferenceKind } from "./comparison.js";
import type { CoverageModel } from "./coverage.js";
import type { DecompositionSums } from "./decomposition.js";
import { reportKeys, unavailableKey } from "./keys.js";
import { sumMoneyOrNull, sumQuantity } from "./money.js";
import { relativeChange } from "./numeric.js";
import { part, type SentencePart, textValue } from "./values.js";

export type TotalsRow = AnalyticsRow<"period_compare_by_store">;

export function totalsOf(
	rows: readonly TotalsRow[],
	storeId: string | null,
	period: ComparePeriod,
): TotalsRow | undefined {
	return rows.find((row) => row.store_id === storeId && row.period === period);
}

export function pickFrom<Row>(
	row: Row | undefined,
	pick: (row: Row) => number | null,
): number | null {
	return row === undefined ? null : pick(row);
}

export function changeCell(
	current: number | null,
	reference: number | null,
): TableCell {
	return relativeChange(current, reference);
}

export function comparisonOf(
	comparisons: readonly Comparison[],
	kind: Comparison["kind"],
): Comparison | null {
	return comparisons.find((entry) => entry.kind === kind) ?? null;
}

export function isMultiStore(context: Pick<ReportContext, "stores">): boolean {
	return context.stores.length >= 2;
}

export function likeForLikeTotals(
	results: CallResults,
): Partial<Record<ReferenceKind, readonly AnalyticsRow<"period_compare">[]>> {
	return {
		previous:
			results.rows(COMPARE_LIKE_FOR_LIKE_KEYS.previous, "period_compare") ?? [],
		last_year:
			results.rows(COMPARE_LIKE_FOR_LIKE_KEYS.last_year, "period_compare") ??
			[],
	};
}

export function likeForLikeMetrics(
	results: CallResults,
): Partial<Record<ReferenceKind, readonly AnalyticsRow<"metric_compare">[]>> {
	return {
		previous:
			results.rows(METRICS_LIKE_FOR_LIKE_KEYS.previous, "metric_compare") ?? [],
		last_year:
			results.rows(METRICS_LIKE_FOR_LIKE_KEYS.last_year, "metric_compare") ??
			[],
	};
}

export function markersOf(
	coverage: CoverageModel,
	readsAggregates: boolean,
): CardMarkers {
	return {
		provisional: false,
		stale: readsAggregates && coverage.staleStoreIds.length > 0,
		verification: coverage.verification,
	};
}

function presentRows(rows: readonly (TotalsRow | undefined)[]): TotalsRow[] {
	return rows.filter(
		(row): row is TotalsRow => row !== undefined && row.days_with_data > 0,
	);
}

export function sumsOfRows(
	rows: readonly (TotalsRow | undefined)[],
): DecompositionSums {
	const present = presentRows(rows);
	if (present.length === 0) return { net: null, invoices: null, items: null };
	const invoices = present.map((row) => row.invoices);
	const items = present.map((row) => row.items_sold);
	return {
		net: sumMoneyOrNull(present.map((row) => row.net_amount)),
		invoices: invoices.some((value) => value === null)
			? null
			: invoices.reduce<number>((total, value) => total + (value ?? 0), 0),
		items: items.some((value) => value === null) ? null : sumQuantity(items),
	};
}

export function decompositionInputs(
	rows: readonly TotalsRow[],
	coverage: CoverageModel,
	against: Comparison,
): { current: DecompositionSums; reference: DecompositionSums } | null {
	const kind = against.kind;
	if (kind !== "previous" && kind !== "last_year") return null;
	if (against.basis === "all_stores") {
		return {
			current: sumsOfRows([totalsOf(rows, null, "current")]),
			reference: sumsOfRows([totalsOf(rows, null, kind)]),
		};
	}
	if (against.range === null) return null;
	const covered = coverage.forReference(against.range.from).coveredStoreIds;
	return {
		current: sumsOfRows(covered.map((id) => totalsOf(rows, id, "current"))),
		reference: sumsOfRows(covered.map((id) => totalsOf(rows, id, kind))),
	};
}

export interface StoreTotals {
	readonly store: ReportStore;
	readonly current: TotalsRow | undefined;
	readonly previous: TotalsRow | undefined;
	readonly lastYear: TotalsRow | undefined;
	readonly baseline: TotalsRow | undefined;
}

export function storeTotals(
	context: Pick<ReportContext, "stores">,
	rows: readonly TotalsRow[],
): readonly StoreTotals[] {
	return context.stores.map((store) => ({
		store,
		current: totalsOf(rows, store.id, "current"),
		previous: totalsOf(rows, store.id, "previous"),
		lastYear: totalsOf(rows, store.id, "last_year"),
		baseline: totalsOf(rows, store.id, "baseline"),
	}));
}

export function youngStoreState(
	coverage: CoverageModel,
	storeId: string,
	referenceFrom: IsoDate,
	kind: "previous" | "last_year" = "last_year",
): string | null {
	return coverage.isYoungAt(storeId, referenceFrom)
		? unavailableKey("store_too_young", kind)
		: null;
}

export function youngStoreNote(
	context: Pick<ReportContext, "stores">,
	coverage: CoverageModel,
	referenceFrom: IsoDate,
): SentencePart | null {
	const reference = coverage.forReference(referenceFrom);
	for (const storeId of reference.youngStoreIds) {
		const start = coverage.historyStart(storeId);
		const store = context.stores.find((entry) => entry.id === storeId);
		if (start === null || store === undefined) continue;
		return part(reportKeys.clause.coverage.youngStore, {
			store: textValue("text", store.name),
			date: textValue("date", start),
		});
	}
	return null;
}
