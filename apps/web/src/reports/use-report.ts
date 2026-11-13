import {
	type AnalyticsFunctionName,
	type AnalyticsRow,
	type AnalyticsSource,
	addDays,
	type CallResults,
	type CallSpec,
	type CardModel,
	COVERAGE_CALL_KEY,
	type CoverageModel,
	callIdentity,
	coverageModel,
	type IsoDate,
	isArgumentLimitError,
	lastOfMonth,
	type ReportContext,
	type ReportDefinition,
	stepPeriod,
} from "@fnb/reports";
import {
	keepPreviousData,
	type QueryClient,
	type UseQueryResult,
	useQueries,
	useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { useAnalyticsSourceState } from "../data/analytics-source-context";

export type CardState =
	| { readonly id: string; readonly status: "loading" }
	| {
			readonly id: string;
			readonly status: "error";
			readonly retry: () => void;
			readonly limit?: boolean;
	  }
	| {
			readonly id: string;
			readonly status: "ready";
			readonly model: CardModel;
	  };

const MINUTE = 60_000;
export const SETTLED_STALE_TIME = 30 * MINUTE;
export const RECENT_STALE_TIME = 2 * MINUTE;
export const ANALYTICS_GC_TIME = 30 * MINUTE;
export const PREFETCH_FALLBACK_DELAY = 300;

const END_ARGUMENTS = [
	"to_date",
	"anchor",
	"target_date",
	"as_of_date",
	"as_of",
] as const;

export function callEnd(call: { readonly args: object }): IsoDate | null {
	const args = call.args as Readonly<Record<string, unknown>>;
	for (const name of END_ARGUMENTS) {
		const value = args[name];
		if (typeof value === "string") return value;
	}
	if (typeof args.month_start === "string")
		return lastOfMonth(args.month_start);
	if (typeof args.period_start === "string") return args.period_start;
	return null;
}

export interface Freshness {
	readonly staleTime: number;
	readonly refetchOnWindowFocus: boolean;
}

export function freshnessOf(
	call: { readonly args: object },
	asOf: IsoDate,
	demo: boolean,
): Freshness {
	if (demo) {
		return { staleTime: Number.POSITIVE_INFINITY, refetchOnWindowFocus: false };
	}
	const end = callEnd(call);
	if (end !== null && end < addDays(asOf, -1)) {
		return { staleTime: SETTLED_STALE_TIME, refetchOnWindowFocus: false };
	}
	return { staleTime: RECENT_STALE_TIME, refetchOnWindowFocus: true };
}

export function analyticsQueryKey(
	sourceKind: AnalyticsSource["kind"],
	tenantId: string,
	call: Pick<CallSpec, "name" | "args">,
) {
	return ["analytics", sourceKind, tenantId, call.name, call.args] as const;
}

function fetchOptions(
	source: AnalyticsSource,
	context: ReportContext,
	call: CallSpec,
) {
	return {
		queryKey: analyticsQueryKey(source.kind, context.tenantId, call),
		queryFn: () => source.call(call.name, call.args) as Promise<unknown[]>,
		gcTime: ANALYTICS_GC_TIME,
		...freshnessOf(call, context.period.asOf, source.kind === "demo"),
	};
}

function queryOptions(
	source: AnalyticsSource,
	context: ReportContext,
	call: CallSpec,
) {
	return {
		...fetchOptions(source, context, call),
		placeholderData: keepPreviousData,
	};
}

type CallQuery = UseQueryResult<unknown[]>;

export interface DistinctCalls {
	readonly calls: readonly CallSpec[];
	readonly indexOf: ReadonlyMap<string, number>;
}

export function distinctCalls(planned: readonly CallSpec[]): DistinctCalls {
	const calls: CallSpec[] = [];
	const byIdentity = new Map<string, number>();
	const indexOf = new Map<string, number>();
	for (const call of planned) {
		const identity = callIdentity(call);
		let index = byIdentity.get(identity);
		if (index === undefined) {
			index = calls.length;
			calls.push(call);
			byIdentity.set(identity, index);
		}
		indexOf.set(call.key, index);
	}
	return { calls, indexOf };
}

type KeyState =
	| { readonly status: "pending" }
	| { readonly status: "error"; readonly query: CallQuery }
	| { readonly status: "ready"; readonly rows: readonly unknown[] };

const EMPTY_ROWS: readonly unknown[] = [];
const PENDING: KeyState = { status: "pending" };
const UNPLANNED: KeyState = { status: "ready", rows: EMPTY_ROWS };

function stateOf(query: CallQuery | undefined): KeyState {
	if (query === undefined) return PENDING;
	if (query.isError) return { status: "error", query };
	if (query.data === undefined || query.isPlaceholderData) return PENDING;
	return { status: "ready", rows: query.data };
}

export const KEY_PREFIX_WILDCARD = ".*";

export function expandNeeds(
	needs: readonly string[],
	plannedKeys: readonly string[],
): string[] {
	return needs.flatMap((need) => {
		if (!need.endsWith(KEY_PREFIX_WILDCARD)) return [need];
		const prefix = need.slice(0, -KEY_PREFIX_WILDCARD.length + 1);
		return plannedKeys.filter((key) => key.startsWith(prefix));
	});
}

interface BuiltCard {
	readonly inputs: readonly unknown[];
	readonly outcome:
		| { readonly model: CardModel }
		| { readonly failure: unknown };
}

function sameInputs(left: readonly unknown[], right: readonly unknown[]) {
	return (
		left.length === right.length &&
		left.every((value, index) => Object.is(value, right[index]))
	);
}

function prefetchPrevious(
	client: QueryClient,
	source: AnalyticsSource,
	definition: ReportDefinition,
	context: ReportContext,
): void {
	const previous = stepPeriod(context.period, -1);
	if (previous === null) return;
	const previousContext: ReportContext = { ...context, period: previous };
	for (const call of definition.primaryCalls(previousContext)) {
		void client.prefetchQuery(fetchOptions(source, previousContext, call));
	}
}

function onIdle(task: () => void): () => void {
	const idle = globalThis as {
		requestIdleCallback?: (callback: () => void) => number;
		cancelIdleCallback?: (handle: number) => void;
	};
	if (typeof idle.requestIdleCallback === "function") {
		const handle = idle.requestIdleCallback(task);
		return () => idle.cancelIdleCallback?.(handle);
	}
	const timer = setTimeout(task, PREFETCH_FALLBACK_DELAY);
	return () => clearTimeout(timer);
}

export interface ReportLoad {
	readonly cards: readonly CardState[];
	readonly coverage: CoverageModel | null;
	readonly failed: boolean;
	readonly retry: () => void;
}

export function useReportLoad(
	definition: ReportDefinition,
	context: ReportContext,
): ReportLoad {
	const sourceState = useAnalyticsSourceState();
	const source = sourceState.status === "ready" ? sourceState.source : null;
	const client = useQueryClient();
	const primary = useMemo(
		() => definition.primaryCalls(context),
		[definition, context],
	);
	const primaryDistinct = useMemo(() => distinctCalls(primary), [primary]);
	const primaryQueries = useQueries({
		queries:
			source === null
				? []
				: primaryDistinct.calls.map((call) =>
						queryOptions(source, context, call),
					),
	}) as CallQuery[];
	const coverageIndex = primaryDistinct.indexOf.get(COVERAGE_CALL_KEY);
	const coverageQuery =
		coverageIndex === undefined ? undefined : primaryQueries[coverageIndex];
	const coverageState = stateOf(coverageQuery);
	const coverageRows =
		coverageState.status === "ready" ? coverageState.rows : null;
	const coverage = useMemo(
		() =>
			coverageRows === null
				? null
				: coverageModel(
						coverageRows as AnalyticsRow<"store_coverage">[],
						context,
					),
		[coverageRows, context],
	);
	const followUps = useMemo(
		() =>
			coverage === null ? [] : definition.followUpCalls(context, coverage),
		[definition, context, coverage],
	);
	const followUpDistinct = useMemo(() => distinctCalls(followUps), [followUps]);
	const followUpQueries = useQueries({
		queries:
			source === null
				? []
				: followUpDistinct.calls.map((call) =>
						queryOptions(source, context, call),
					),
	}) as CallQuery[];

	const built = useRef(new Map<string, BuiltCard>());
	const keyState = (key: string): KeyState => {
		const primaryIndex = primaryDistinct.indexOf.get(key);
		if (primaryIndex !== undefined) {
			return stateOf(primaryQueries[primaryIndex]);
		}
		if (coverage === null) return PENDING;
		const followUpIndex = followUpDistinct.indexOf.get(key);
		if (followUpIndex === undefined) return UNPLANNED;
		return stateOf(followUpQueries[followUpIndex]);
	};
	const results: CallResults = {
		rows<N extends AnalyticsFunctionName>(key: string, _name: N) {
			const state = keyState(key);
			return (state.status === "ready" ? state.rows : EMPTY_ROWS) as
				| readonly AnalyticsRow<N>[]
				| undefined;
		},
	};
	const lastCoverage = useRef<CoverageModel | null>(null);
	if (coverage !== null) lastCoverage.current = coverage;
	const visibleCoverage =
		coverage ?? lastCoverage.current ?? coverageModel([], context);
	const failedSource = sourceState.status === "failed";
	const cards: CardState[] = definition.cards
		.filter((card) => card.visible({ context, coverage: visibleCoverage }))
		.map((card): CardState => {
			if (failedSource) {
				return {
					id: card.id,
					status: "error",
					retry: () => window.location.reload(),
				};
			}
			const planned = [
				...primary.map((call) => call.key),
				...followUps.map((call) => call.key),
			];
			const states = [
				...expandNeeds(card.needs, planned).map(keyState),
				...(coverage === null &&
				card.needs.some((need) => need.endsWith(KEY_PREFIX_WILDCARD))
					? [PENDING]
					: []),
			];
			const failed = states.flatMap((state) =>
				state.status === "error" ? [state.query] : [],
			);
			if (failed.length > 0) {
				return {
					id: card.id,
					status: "error",
					retry: () => {
						for (const query of failed) void query.refetch();
					},
					...(failed.every((query) => isArgumentLimitError(query.error))
						? { limit: true }
						: {}),
				};
			}
			if (
				coverage === null ||
				states.some((state) => state.status !== "ready")
			) {
				return { id: card.id, status: "loading" };
			}
			const inputs = [
				context,
				coverage,
				...states.map((state) =>
					state.status === "ready" ? state.rows : undefined,
				),
			];
			let entry = built.current.get(card.id);
			if (entry === undefined || !sameInputs(entry.inputs, inputs)) {
				let outcome: BuiltCard["outcome"];
				try {
					outcome = { model: card.build({ context, coverage, results }) };
				} catch (failure) {
					if (import.meta.env.DEV) console.error(failure);
					outcome = { failure };
				}
				entry = { inputs, outcome };
				built.current.set(card.id, entry);
			}
			if ("failure" in entry.outcome) {
				return {
					id: card.id,
					status: "error",
					retry: () => {
						built.current.delete(card.id);
						for (const query of [...primaryQueries, ...followUpQueries]) {
							void query.refetch();
						}
					},
				};
			}
			return { id: card.id, status: "ready", model: entry.outcome.model };
		});

	const settled =
		source !== null &&
		cards.length > 0 &&
		cards.every((card) => card.status !== "loading");
	useEffect(() => {
		if (!settled || source === null) return;
		return onIdle(() => prefetchPrevious(client, source, definition, context));
	}, [settled, client, source, definition, context]);

	return {
		cards,
		coverage,
		failed: failedSource || coverageState.status === "error",
		retry: () => {
			if (failedSource) {
				window.location.reload();
				return;
			}
			if (coverageQuery !== undefined) void coverageQuery.refetch();
		},
	};
}

export function useReport(
	definition: ReportDefinition,
	context: ReportContext,
): readonly CardState[] {
	return useReportLoad(definition, context).cards;
}
