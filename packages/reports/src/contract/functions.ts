import type { z } from "zod";
import {
	dailyBaselineRow,
	dailyBaselinesArgs,
	forecastAccuracyArgs,
	forecastAccuracyRow,
	hourlyProfileArgs,
	hourlyProfileRow,
	itemLifecycleArgs,
	itemLifecycleRow,
	itemSummaryArgs,
	itemSummaryRow,
	itemVelocityArgs,
	itemVelocityRow,
	metricCompareArgs,
	metricCompareRow,
	monthPaceArgs,
	monthPaceRow,
	paymentSummaryArgs,
	paymentSummaryRow,
	periodCompareArgs,
	periodCompareByStoreRow,
	periodCompareRow,
	periodSeriesArgs,
	periodSeriesRow,
	promotionSummaryRow,
	rangeArgs,
	shiftReviewArgs,
	shiftReviewRow,
	storeCoverageArgs,
	storeCoverageRow,
	storeTargetRow,
	storeTargetsArgs,
} from "./rows.js";

export const analyticsFunctions = {
	store_coverage: { args: storeCoverageArgs, row: storeCoverageRow },
	period_compare: { args: periodCompareArgs, row: periodCompareRow },
	period_compare_by_store: {
		args: periodCompareArgs,
		row: periodCompareByStoreRow,
	},
	period_series: { args: periodSeriesArgs, row: periodSeriesRow },
	daily_baselines: { args: dailyBaselinesArgs, row: dailyBaselineRow },
	hourly_profile: { args: hourlyProfileArgs, row: hourlyProfileRow },
	metric_compare: { args: metricCompareArgs, row: metricCompareRow },
	item_summary: { args: itemSummaryArgs, row: itemSummaryRow },
	payment_summary: { args: paymentSummaryArgs, row: paymentSummaryRow },
	promotion_summary: { args: rangeArgs, row: promotionSummaryRow },
	shift_review: { args: shiftReviewArgs, row: shiftReviewRow },
	store_targets: { args: storeTargetsArgs, row: storeTargetRow },
	item_velocity: { args: itemVelocityArgs, row: itemVelocityRow },
	month_pace: { args: monthPaceArgs, row: monthPaceRow },
	forecast_accuracy: { args: forecastAccuracyArgs, row: forecastAccuracyRow },
	item_lifecycle: { args: itemLifecycleArgs, row: itemLifecycleRow },
} as const;

export type AnalyticsFunctionName = keyof typeof analyticsFunctions;
export type AnalyticsArgs<N extends AnalyticsFunctionName> = z.input<
	(typeof analyticsFunctions)[N]["args"]
>;
export type AnalyticsRow<N extends AnalyticsFunctionName> = z.output<
	(typeof analyticsFunctions)[N]["row"]
>;

export const analyticsFunctionNames = Object.keys(
	analyticsFunctions,
) as readonly AnalyticsFunctionName[];

export function isAnalyticsFunctionName(
	name: string,
): name is AnalyticsFunctionName {
	return Object.hasOwn(analyticsFunctions, name);
}

export function argumentNames(name: AnalyticsFunctionName): readonly string[] {
	return Object.keys(analyticsFunctions[name].args.shape);
}

export function rowColumns(name: AnalyticsFunctionName): readonly string[] {
	return Object.keys(analyticsFunctions[name].row.shape);
}
