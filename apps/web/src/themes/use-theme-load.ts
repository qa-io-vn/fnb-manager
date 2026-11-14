import {
	canStepRange,
	stepRange,
	type ThemeCallResults,
	type ThemeContext,
	type ThemeDefinition,
} from "@fnb/reports";
import { useMemo } from "react";
import {
	type CardsLoad,
	type CardsPlan,
	useCardsLoad,
} from "../reports/use-cards-load";

export function themePlan(
	definition: ThemeDefinition,
): CardsPlan<ThemeContext> {
	return {
		cards: definition.cards as CardsPlan<ThemeContext>["cards"],
		primaryCalls: (context) => definition.primaryCalls(context),
		followUpCalls: (context, coverage, results) =>
			definition.followUpCalls(
				context,
				coverage,
				results as unknown as ThemeCallResults,
			),
		asOf: (context) => context.range.asOf,
		previous: (context) =>
			canStepRange(context.range, -1)
				? { ...context, range: stepRange(context.range, -1) }
				: null,
	};
}

export function useThemeLoad(
	definition: ThemeDefinition,
	context: ThemeContext,
): CardsLoad {
	const plan = useMemo(() => themePlan(definition), [definition]);
	return useCardsLoad(plan, context);
}
