import {
	type AnalyticsRow,
	addDays,
	type CardModel,
	COVERAGE_CALL_KEY,
	type CoverageModel,
	callReport,
	coverageModel,
	type IsoDate,
	isArgumentLimitError,
	lastOfMonth,
	type ReportFunctionName,
	type ReportSource,
	type ReportStore,
	reportCallIdentity,
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
	if (Array.isArray(args.to_dates)) {
		const ends = (args.to_dates as unknown[]).filter(
			(value): value is string => typeof value === "string",
		);
		return [...ends].sort().at(-1) ?? null;
	}
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

export interface PlannedCall {
	readonly key: string;
	readonly name: ReportFunctionName;
	readonly args: object;
}

export function analyticsQueryKey(
	sourceKind: ReportSource["kind"],
	tenantId: string,
	call: { readonly name: string; readonly args: object },
) {
	return ["analytics", sourceKind, tenantId, call.name, call.args] as const;
}

export interface LoadContext {
	readonly tenantId: string;
	readonly stores: readonly ReportStore[];
	readonly sample: boolean;
}

export interface LoadResults {
	rows(key: string, name: string): readonly unknown[] | undefined;
}

export interface LoadCard<C> {
	readonly id: string;
	readonly needs: readonly string[];
	visible(input: { context: C; coverage: CoverageModel }): boolean;
	build(input: {
		context: C;
		coverage: CoverageModel;
		results: LoadResults;
	}): CardModel;
}

export interface CardsPlan<C extends LoadContext> {
	readonly cards: readonly LoadCard<C>[];
	primaryCalls(context: C): readonly PlannedCall[];
	followUpCalls(
		context: C,
		coverage: CoverageModel,
		results: LoadResults,
	): readonly PlannedCall[];
	asOf(context: C): IsoDate;
	previous(context: C): C | null;
}

export function fetchOptions(
	source: ReportSource,
	tenantId: string,
	asOf: IsoDate,
	call: PlannedCall,
) {
	return {
		queryKey: analyticsQueryKey(source.kind, tenantId, call),
		queryFn: () => callReport(source, call as never) as Promise<unknown[]>,
		gcTime: ANALYTICS_GC_TIME,
		...freshnessOf(call, asOf, source.kind === "demo"),
	};
}

function queryOptions(
	source: ReportSource,
	tenantId: string,
	asOf: IsoDate,
	call: PlannedCall,
) {
	return {
		...fetchOptions(source, tenantId, asOf, call),
		placeholderData: keepPreviousData,
	};
}

type CallQuery = UseQueryResult<unknown[]>;

export interface DistinctCalls<Call extends PlannedCall = PlannedCall> {
	readonly calls: readonly Call[];
	readonly indexOf: ReadonlyMap<string, number>;
}

export function distinctCalls<Call extends PlannedCall>(
	planned: readonly Call[],
): DistinctCalls<Call> {
	const calls: Call[] = [];
	const byIdentity = new Map<string, number>();
	const indexOf = new Map<string, number>();
	for (const call of planned) {
		const identity = reportCallIdentity(call as never);
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

function prefetchPrevious<C extends LoadContext>(
	client: QueryClient,
	source: ReportSource,
	plan: CardsPlan<C>,
	context: C,
): void {
	const previous = plan.previous(context);
	if (previous === null) return;
	for (const call of plan.primaryCalls(previous)) {
		void client.prefetchQuery(
			fetchOptions(source, previous.tenantId, plan.asOf(previous), call),
		);
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

export interface CardsLoad {
	readonly cards: readonly CardState[];
	readonly coverage: CoverageModel | null;
	readonly failed: boolean;
	readonly retry: () => void;
}

export function useCardsLoad<C extends LoadContext>(
	plan: CardsPlan<C>,
	context: C,
): CardsLoad {
	const sourceState = useAnalyticsSourceState();
	const source = sourceState.status === "ready" ? sourceState.source : null;
	const client = useQueryClient();
	const asOf = plan.asOf(context);
	const primary = useMemo(() => plan.primaryCalls(context), [plan, context]);
	const primaryDistinct = useMemo(() => distinctCalls(primary), [primary]);
	const primaryQueries = useQueries({
		queries:
			source === null
				? []
				: primaryDistinct.calls.map((call) =>
						queryOptions(source, context.tenantId, asOf, call),
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
	const primaryResults: LoadResults = {
		rows(key: string) {
			const index = primaryDistinct.indexOf.get(key);
			const state =
				index === undefined ? UNPLANNED : stateOf(primaryQueries[index]);
			return state.status === "ready" ? state.rows : EMPTY_ROWS;
		},
	};
	const followUpInputs = [
		plan,
		context,
		coverage,
		...primaryDistinct.calls.map((_, index) => {
			const state = stateOf(primaryQueries[index]);
			return state.status === "ready" ? state.rows : state.status;
		}),
	];
	const plannedFollowUps = useRef<{
		readonly inputs: readonly unknown[];
		readonly calls: readonly PlannedCall[];
	} | null>(null);
	if (
		plannedFollowUps.current === null ||
		!sameInputs(plannedFollowUps.current.inputs, followUpInputs)
	) {
		plannedFollowUps.current = {
			inputs: followUpInputs,
			calls:
				coverage === null
					? []
					: plan.followUpCalls(context, coverage, primaryResults),
		};
	}
	const followUps = plannedFollowUps.current.calls;
	const followUpDistinct = useMemo(() => distinctCalls(followUps), [followUps]);
	const followUpQueries = useQueries({
		queries:
			source === null
				? []
				: followUpDistinct.calls.map((call) =>
						queryOptions(source, context.tenantId, asOf, call),
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
	const results: LoadResults = {
		rows(key: string) {
			const state = keyState(key);
			return state.status === "ready" ? state.rows : EMPTY_ROWS;
		},
	};
	const lastCoverage = useRef<CoverageModel | null>(null);
	if (coverage !== null) lastCoverage.current = coverage;
	const visibleCoverage =
		coverage ?? lastCoverage.current ?? coverageModel([], context);
	const failedSource = sourceState.status === "failed";
	const cards: CardState[] = plan.cards
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
		return onIdle(() => prefetchPrevious(client, source, plan, context));
	}, [settled, client, source, plan, context]);

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
