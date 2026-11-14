import {
	type ReportContext,
	type ReportDefinition,
	stepPeriod,
} from "@fnb/reports";
import { useMemo } from "react";
import {
	type CardState,
	type CardsLoad,
	type CardsPlan,
	useCardsLoad,
} from "./use-cards-load";

export {
	ANALYTICS_GC_TIME,
	analyticsQueryKey,
	type CardState,
	callEnd,
	type DistinctCalls,
	distinctCalls,
	expandNeeds,
	type Freshness,
	freshnessOf,
	KEY_PREFIX_WILDCARD,
	PREFETCH_FALLBACK_DELAY,
	RECENT_STALE_TIME,
	SETTLED_STALE_TIME,
} from "./use-cards-load";

export type ReportLoad = CardsLoad;

export function reportPlan(
	definition: ReportDefinition,
): CardsPlan<ReportContext> {
	return {
		cards: definition.cards as CardsPlan<ReportContext>["cards"],
		primaryCalls: (context) => definition.primaryCalls(context),
		followUpCalls: (context, coverage) =>
			definition.followUpCalls(context, coverage),
		asOf: (context) => context.period.asOf,
		previous: (context) => {
			const previous = stepPeriod(context.period, -1);
			return previous === null ? null : { ...context, period: previous };
		},
	};
}

export function useReportLoad(
	definition: ReportDefinition,
	context: ReportContext,
): ReportLoad {
	const plan = useMemo(() => reportPlan(definition), [definition]);
	return useCardsLoad(plan, context);
}

export function useReport(
	definition: ReportDefinition,
	context: ReportContext,
): readonly CardState[] {
	return useReportLoad(definition, context).cards;
}
