import { type AnalyticsRow, datesBetween, isoWeekday } from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import { baselineOf, baselineSamples } from "./same-weekday-baseline.js";
import {
	type HandlerArgs,
	type HandlerContext,
	invalid,
	requireDateRange,
	requireStoreIds,
} from "./support.js";

type Row = AnalyticsRow<"daily_baselines">;

export const DAILY_BASELINES_MAX_DATES = 62;
export const DAILY_BASELINES_MAX_WEEKS = 26;
export const DEFAULT_BASELINE_WEEKS = 8;

export function dailyBaselines(
	store: AggregateStore,
	args: HandlerArgs<"daily_baselines">,
	context: HandlerContext,
): Row[] {
	requireStoreIds("daily_baselines", args.store_ids);
	requireDateRange(
		"daily_baselines",
		args.from_date,
		args.to_date,
		DAILY_BASELINES_MAX_DATES,
	);
	const weeks = args.weeks ?? DEFAULT_BASELINE_WEEKS;
	if (weeks < 1 || weeks > DAILY_BASELINES_MAX_WEEKS) {
		invalid(
			"daily_baselines",
			`daily_baselines needs weeks between 1 and ${DAILY_BASELINES_MAX_WEEKS}`,
		);
	}
	if (args.store_ids.length === 0) return [];
	return datesBetween(args.from_date, args.to_date).map((date) => ({
		business_date: date,
		weekday: isoWeekday(date),
		...baselineOf(baselineSamples(store, args.store_ids, date, weeks, context)),
	}));
}
