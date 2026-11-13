import type {
	AnalyticsArgs,
	AnalyticsFunctionName,
	AnalyticsRow,
} from "./contract/functions.js";
import type { CardModel } from "./model/card.js";
import { type CoverageModel, coverageModel } from "./model/coverage.js";
import { periodBounds } from "./period/bounds.js";
import type { ReportKind, ReportPeriod } from "./period/periods.js";
import type { AnalyticsSource } from "./source/source.js";

export interface ReportStore {
	readonly id: string;
	readonly name: string;
	readonly timeZone: string;
	readonly businessDayStartMinutes: number;
}

export interface ReportContext {
	readonly tenantId: string;
	readonly stores: readonly ReportStore[];
	readonly allStoresSelected: boolean;
	readonly period: ReportPeriod;
	readonly sample: boolean;
}

export interface CallSpec<
	N extends AnalyticsFunctionName = AnalyticsFunctionName,
> {
	readonly key: string;
	readonly name: N;
	readonly args: AnalyticsArgs<N>;
}

export interface CallResults {
	rows<N extends AnalyticsFunctionName>(
		key: string,
		name: N,
	): readonly AnalyticsRow<N>[] | undefined;
}

export interface CardInput {
	readonly context: ReportContext;
	readonly coverage: CoverageModel;
	readonly results: CallResults;
}

export interface CardDefinition {
	readonly id: string;
	readonly needs: readonly string[];
	visible(input: Pick<CardInput, "context" | "coverage">): boolean;
	build(input: CardInput): CardModel;
}

export type ReportSlug = "ngay" | "tuan" | "thang" | "nam";

export interface ReportDefinition {
	readonly kind: ReportKind;
	readonly slug: ReportSlug;
	readonly titleKey: string;
	readonly cards: readonly CardDefinition[];
	primaryCalls(context: ReportContext): readonly CallSpec[];
	followUpCalls(
		context: ReportContext,
		coverage: CoverageModel,
	): readonly CallSpec[];
}

export const COVERAGE_CALL_KEY = "coverage";
export const COMPARE_LIKE_FOR_LIKE_KEYS = {
	previous: "compareLfl.previous",
	last_year: "compareLfl.last_year",
} as const;
export const METRICS_LIKE_FOR_LIKE_KEYS = {
	previous: "metricsLfl.previous",
	last_year: "metricsLfl.last_year",
} as const;

export function storeIdsOf(context: Pick<ReportContext, "stores">): string[] {
	return context.stores.map((store) => store.id);
}

export function call<N extends AnalyticsFunctionName>(
	key: string,
	name: N,
	args: AnalyticsArgs<N>,
): CallSpec<N> {
	return { key, name, args };
}

export function coverageCall(
	context: ReportContext,
): CallSpec<"store_coverage"> {
	return call(COVERAGE_CALL_KEY, "store_coverage", {
		store_ids: storeIdsOf(context),
		from_date: context.period.from,
		to_date: context.period.end,
	});
}

export function likeForLikeCalls(
	context: ReportContext,
	coverage: CoverageModel,
	spec: { readonly grain: ReportKind; readonly metricIds?: readonly string[] },
): readonly CallSpec[] {
	const calls: CallSpec[] = [];
	const anchor = context.period.end;
	for (const bound of periodBounds(spec.grain, anchor)) {
		if (bound.period !== "previous" && bound.period !== "last_year") continue;
		const reference = coverage.forReference(bound.from);
		if (reference.state !== "partial") continue;
		const covered = [...reference.coveredStoreIds];
		calls.push(
			call(COMPARE_LIKE_FOR_LIKE_KEYS[bound.period], "period_compare", {
				store_ids: covered,
				grain: spec.grain,
				anchor,
			}),
		);
		if (spec.metricIds !== undefined && spec.metricIds.length > 0) {
			calls.push(
				call(METRICS_LIKE_FOR_LIKE_KEYS[bound.period], "metric_compare", {
					store_ids: covered,
					metric_ids: [...spec.metricIds],
					grain: spec.grain,
					anchor,
				}),
			);
		}
	}
	return calls;
}

export function withNoDataNotice(
	card: CardDefinition,
	noticeKey: string,
): CardDefinition {
	return {
		...card,
		build(input) {
			const model = card.build(input);
			if (model.headline.value !== null || model.notice !== null) return model;
			return {
				...model,
				notice: {
					tone: "info",
					part: { key: noticeKey, values: {} },
					action: null,
				},
			};
		},
	};
}

export function callIdentity(spec: Pick<CallSpec, "name" | "args">): string {
	return JSON.stringify([spec.name, spec.args]);
}

export function resultsOf(
	entries: ReadonlyMap<string, readonly unknown[]>,
): CallResults {
	return {
		rows<N extends AnalyticsFunctionName>(key: string, _name: N) {
			return (entries.get(key) ?? []) as readonly AnalyticsRow<N>[];
		},
	};
}

async function runCalls(
	calls: readonly CallSpec[],
	source: AnalyticsSource,
	into: Map<string, readonly unknown[]>,
): Promise<void> {
	const pending = new Map<string, Promise<readonly unknown[]>>();
	const keyed: [string, Promise<readonly unknown[]>][] = [];
	for (const spec of calls) {
		const identity = callIdentity(spec);
		let request = pending.get(identity);
		if (request === undefined) {
			request = source.call(spec.name, spec.args);
			pending.set(identity, request);
		}
		keyed.push([spec.key, request]);
	}
	const settled = await Promise.all(keyed.map(([, request]) => request));
	keyed.forEach(([key], index) => {
		into.set(key, settled[index] ?? []);
	});
}

export function assertUniqueKeys(calls: readonly CallSpec[]): void {
	const seen = new Set<string>();
	for (const spec of calls) {
		if (seen.has(spec.key)) {
			throw new Error(`call key ${spec.key} is planned twice`);
		}
		seen.add(spec.key);
	}
}

export async function runReport(
	definition: ReportDefinition,
	context: ReportContext,
	source: AnalyticsSource,
): Promise<readonly CardModel[]> {
	const entries = new Map<string, readonly unknown[]>();
	const primary = definition.primaryCalls(context);
	assertUniqueKeys(primary);
	await runCalls(primary, source, entries);
	const coverage = coverageModel(
		(entries.get(COVERAGE_CALL_KEY) ?? []) as AnalyticsRow<"store_coverage">[],
		context,
	);
	const followUps = definition.followUpCalls(context, coverage);
	assertUniqueKeys([...primary, ...followUps]);
	await runCalls(followUps, source, entries);
	const results = resultsOf(entries);
	return definition.cards
		.filter((card) => card.visible({ context, coverage }))
		.map((card) => card.build({ context, coverage, results }));
}
