import {
	type AnalyticsArgs,
	type AnalyticsFunctionName,
	type AnalyticsRow,
	isAnalyticsFunctionName,
} from "../contract/functions.js";
import type { DateRange } from "../contract/values.js";
import { COVERAGE_CALL_KEY } from "../definition.js";
import type { CardModel, Comparison } from "../model/card.js";
import {
	comparison,
	likeForLikeLabel,
	noCoverageReason,
	type ReferenceKind,
} from "../model/comparison.js";
import { type CoverageModel, coverageModel } from "../model/coverage.js";
import { reportKeys } from "../model/keys.js";
import { numberValue, type SentencePart } from "../model/values.js";
import { addDays, daysBetween } from "../period/dates.js";
import type {
	ThemeContext,
	ThemeKind,
	ThemeParamSpec,
	ThemeSlug,
} from "./context.js";
import type { ThemeArgs, ThemeFunctionName, ThemeRow } from "./contract.js";
import { themeKeys } from "./keys.js";
import type { NamedPreset, ReportRange } from "./range.js";
import type { ReportFunctionName, ReportSource } from "./source.js";

export type ReportArgs<N extends ReportFunctionName> =
	N extends AnalyticsFunctionName
		? AnalyticsArgs<N>
		: N extends ThemeFunctionName
			? ThemeArgs<N>
			: never;

export type ReportRow<N extends ReportFunctionName> =
	N extends AnalyticsFunctionName
		? AnalyticsRow<N>
		: N extends ThemeFunctionName
			? ThemeRow<N>
			: never;

export interface ReportCallSpec<
	N extends ReportFunctionName = ReportFunctionName,
> {
	readonly key: string;
	readonly name: N;
	readonly args: ReportArgs<N>;
}

export function reportCall<N extends ReportFunctionName>(
	key: string,
	name: N,
	args: ReportArgs<N>,
): ReportCallSpec<N> {
	return { key, name, args };
}

export interface ThemeCallResults {
	rows<N extends ReportFunctionName>(
		key: string,
		name: N,
	): readonly ReportRow<N>[] | undefined;
}

export interface ThemeCardInput {
	readonly context: ThemeContext;
	readonly coverage: CoverageModel;
	readonly results: ThemeCallResults;
}

export interface ThemeCardDefinition {
	readonly id: string;
	readonly needs: readonly string[];
	readonly wide?: boolean;
	visible(input: Pick<ThemeCardInput, "context" | "coverage">): boolean;
	build(input: ThemeCardInput): CardModel;
}

export interface ThemeDefinition {
	readonly kind: ThemeKind;
	readonly slug: ThemeSlug;
	readonly titleKey: string;
	readonly defaultPreset: NamedPreset;
	readonly maxRangeDays: number;
	readonly params: readonly ThemeParamSpec[];
	readonly cards: readonly ThemeCardDefinition[];
	primaryCalls(context: ThemeContext): readonly ReportCallSpec[];
	followUpCalls(
		context: ThemeContext,
		coverage: CoverageModel,
		results: ThemeCallResults,
	): readonly ReportCallSpec[];
}

export const TOTALS_CALL_KEY = "totals";
export const TOTALS_LIKE_FOR_LIKE_KEYS = {
	previous: "totalsLfl.previous",
	last_year: "totalsLfl.last_year",
} as const;

export const RANGE_INDEX = { current: 1, previous: 2, last_year: 3 } as const;

export function themeStoreIds(context: Pick<ThemeContext, "stores">): string[] {
	return context.stores.map((store) => store.id);
}

export function themeCoverageCall(
	context: ThemeContext,
): ReportCallSpec<"store_coverage"> {
	return reportCall(COVERAGE_CALL_KEY, "store_coverage", {
		store_ids: themeStoreIds(context),
		from_date: context.range.from,
		to_date: context.range.to,
	});
}

export function rangeReference(
	range: ReportRange,
	kind: ReferenceKind,
): DateRange | null {
	return kind === "previous" ? range.previous : range.lastYear;
}

export function rangeTotalsCall(
	key: string,
	storeIds: readonly string[],
	ranges: readonly DateRange[],
): ReportCallSpec<"range_totals"> {
	return reportCall(key, "range_totals", {
		store_ids: [...storeIds],
		from_dates: ranges.map((range) => range.from),
		to_dates: ranges.map((range) => range.to),
	});
}

export function totalsCall(
	context: ThemeContext,
): ReportCallSpec<"range_totals"> {
	const { range } = context;
	const ranges: DateRange[] = [range, range.previous];
	if (range.lastYear !== null) ranges.push(range.lastYear);
	return rangeTotalsCall(TOTALS_CALL_KEY, themeStoreIds(context), ranges);
}

export function likeForLikeRangeCalls(
	context: ThemeContext,
	coverage: CoverageModel,
): readonly ReportCallSpec[] {
	const calls: ReportCallSpec[] = [];
	for (const kind of ["previous", "last_year"] as const) {
		const reference = rangeReference(context.range, kind);
		if (reference === null) continue;
		const covered = coverage.forReference(reference.from);
		if (covered.state !== "partial") continue;
		calls.push(
			rangeTotalsCall(
				TOTALS_LIKE_FOR_LIKE_KEYS[kind],
				covered.coveredStoreIds,
				[context.range, reference],
			),
		);
	}
	return calls;
}

export type RangeTotalsRow = ThemeRow<"range_totals">;

export function rangeRow(
	rows: readonly RangeTotalsRow[] | undefined,
	index: number,
	storeId: string | null = null,
): RangeTotalsRow | undefined {
	return rows?.find(
		(row) => row.range_index === index && row.store_id === storeId,
	);
}

export function referenceLabel(
	range: ReportRange,
	kind: ReferenceKind,
): SentencePart {
	if (kind === "last_year") {
		switch (range.preset) {
			case "this_month":
			case "last_month":
				return { key: reportKeys.compare.lastYear.month, values: {} };
			default:
				return { key: themeKeys.compare.lastYear, values: {} };
		}
	}
	switch (range.preset) {
		case "this_month":
		case "last_month":
			return { key: reportKeys.compare.previous.month, values: {} };
		case "this_year":
			return { key: reportKeys.compare.previous.year, values: {} };
		case "28d":
		case "91d":
		case "364d":
			return {
				key: themeKeys.compare.previousWeeks,
				values: { weeks: numberValue("count", range.days / 7) },
			};
		default:
			return {
				key: themeKeys.compare.previousDays,
				values: { days: numberValue("count", range.days) },
			};
	}
}

export function referenceKinds(range: ReportRange): readonly ReferenceKind[] {
	return range.lastYear === null ? ["previous"] : ["previous", "last_year"];
}

export function comparisonsFromRangeRows(input: {
	readonly context: ThemeContext;
	readonly all: readonly RangeTotalsRow[];
	readonly likeForLike: Partial<
		Record<ReferenceKind, readonly RangeTotalsRow[]>
	>;
	readonly coverage: CoverageModel;
	readonly pick: (row: RangeTotalsRow) => number | null;
	readonly kinds?: readonly ReferenceKind[];
}): readonly Comparison[] {
	const { context } = input;
	const currentRow = rangeRow(input.all, RANGE_INDEX.current);
	const current = currentRow ? input.pick(currentRow) : null;
	const kinds = input.kinds ?? referenceKinds(context.range);
	return kinds.flatMap((kind) => {
		const range = rangeReference(context.range, kind);
		if (range === null) return [];
		const label = referenceLabel(context.range, kind);
		const referenceRow = rangeRow(input.all, RANGE_INDEX[kind]);
		const coverage = input.coverage.forReference(range.from);
		if (coverage.state === "full") {
			return [
				comparison({
					kind,
					label,
					range,
					current,
					reference: referenceRow ? input.pick(referenceRow) : null,
					coveredStores: coverage.storeCount,
					totalStores: coverage.storeCount,
				}),
			];
		}
		if (coverage.state === "partial") {
			const rows = input.likeForLike[kind];
			const lflCurrent = rangeRow(rows, 1);
			const lflReference = rangeRow(rows, 2);
			return [
				comparison({
					kind,
					label: likeForLikeLabel(label, coverage),
					range,
					current: lflCurrent ? input.pick(lflCurrent) : null,
					reference: lflReference ? input.pick(lflReference) : null,
					basis: "like_for_like",
					coveredStores: coverage.coveredStoreIds.length,
					totalStores: coverage.storeCount,
				}),
			];
		}
		return [
			comparison({
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
			}),
		];
	});
}

export function themeResultsOf(
	entries: ReadonlyMap<string, readonly unknown[]>,
): ThemeCallResults {
	return {
		rows<N extends ReportFunctionName>(key: string, _name: N) {
			return entries.get(key) as readonly ReportRow<N>[] | undefined;
		},
	};
}

export function callReport(
	source: ReportSource,
	spec: Pick<ReportCallSpec, "name" | "args">,
): Promise<readonly unknown[]> {
	if (isAnalyticsFunctionName(spec.name)) {
		return source.call(spec.name, spec.args as AnalyticsArgs<typeof spec.name>);
	}
	return source.callTheme(spec.name, spec.args as ThemeArgs<typeof spec.name>);
}

export function reportCallIdentity(
	spec: Pick<ReportCallSpec, "name" | "args">,
): string {
	return JSON.stringify([spec.name, spec.args]);
}

export function assertUniqueReportKeys(calls: readonly ReportCallSpec[]): void {
	const seen = new Set<string>();
	for (const spec of calls) {
		if (seen.has(spec.key)) {
			throw new Error(`call key ${spec.key} is planned twice`);
		}
		seen.add(spec.key);
	}
}

export async function runPlannedCalls(
	calls: readonly ReportCallSpec[],
	source: ReportSource,
	into: Map<string, readonly unknown[]>,
): Promise<void> {
	const pending = new Map<string, Promise<readonly unknown[]>>();
	const keyed: [string, Promise<readonly unknown[]>][] = [];
	for (const spec of calls) {
		const identity = reportCallIdentity(spec);
		let request = pending.get(identity);
		if (request === undefined) {
			request = callReport(source, spec);
			pending.set(identity, request);
		}
		keyed.push([spec.key, request]);
	}
	const settled = await Promise.all(keyed.map(([, request]) => request));
	keyed.forEach(([key], index) => {
		into.set(key, settled[index] ?? []);
	});
}

export async function runTheme(
	definition: ThemeDefinition,
	context: ThemeContext,
	source: ReportSource,
): Promise<readonly CardModel[]> {
	const entries = new Map<string, readonly unknown[]>();
	const primary = definition.primaryCalls(context);
	assertUniqueReportKeys(primary);
	await runPlannedCalls(primary, source, entries);
	const coverage = coverageModel(
		(entries.get(COVERAGE_CALL_KEY) ??
			[]) as readonly AnalyticsRow<"store_coverage">[],
		context,
	);
	const results = themeResultsOf(entries);
	const followUps = definition.followUpCalls(context, coverage, results);
	assertUniqueReportKeys([...primary, ...followUps]);
	await runPlannedCalls(followUps, source, entries);
	return definition.cards
		.filter((card) => card.visible({ context, coverage }))
		.map((card) => card.build({ context, coverage, results }));
}

export function lastDaysWindow(
	range: DateRange,
	days: number,
): DateRange & { readonly days: number } {
	const used = Math.min(daysBetween(range.from, range.to) + 1, days);
	return { from: addDays(range.to, -(used - 1)), to: range.to, days: used };
}
