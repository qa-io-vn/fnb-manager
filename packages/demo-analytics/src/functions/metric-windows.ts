import { METRIC_WINDOW_LIMITS, type ThemeRow } from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import { isMetricValueId, metricValue } from "./metric-value.js";
import {
	invalidTheme,
	requireThemeDateRange,
	requireThemeStoreIds,
	type ThemeHandlerArgs,
	type ThemeHandlerContext,
} from "./theme-support.js";

type Row = ThemeRow<"metric_windows">;

export const METRIC_WINDOWS_MAX_DAYS = METRIC_WINDOW_LIMITS.days;

export function metricWindows(
	store: AggregateStore,
	args: ThemeHandlerArgs<"metric_windows">,
	context: ThemeHandlerContext,
): Row[] {
	requireThemeStoreIds("metric_windows", args.store_ids);
	if (
		args.metric_ids.length < 1 ||
		args.metric_ids.length > METRIC_WINDOW_LIMITS.metricIds
	) {
		invalidTheme(
			"metric_windows",
			`metric_windows needs 1 to ${METRIC_WINDOW_LIMITS.metricIds} metric ids`,
		);
	}
	const rangeCount = args.from_dates.length;
	if (
		rangeCount < 1 ||
		rangeCount > METRIC_WINDOW_LIMITS.ranges ||
		args.to_dates.length !== rangeCount
	) {
		invalidTheme(
			"metric_windows",
			`metric_windows needs 1 to ${METRIC_WINDOW_LIMITS.ranges} ranges and as many to_dates as from_dates`,
		);
	}
	const ranges = args.from_dates.map((from, index) => ({
		from,
		to: args.to_dates[index] ?? from,
	}));
	for (const range of ranges) {
		requireThemeDateRange(
			"metric_windows",
			range.from,
			range.to,
			METRIC_WINDOWS_MAX_DAYS,
		);
	}
	if (args.store_ids.length === 0) return [];
	for (const metricId of args.metric_ids) {
		if (!isMetricValueId(metricId)) {
			invalidTheme(
				"metric_windows",
				`metric_value does not compute '${metricId}'`,
			);
		}
	}
	return ranges.flatMap((range, index) =>
		args.metric_ids.map((metricId) => ({
			range_index: index + 1,
			from_date: range.from,
			to_date: range.to,
			metric_id: metricId,
			value:
				metricValue(
					store,
					{
						store_ids: args.store_ids,
						metric_id: metricId,
						from_date: range.from,
						to_date: range.to,
					},
					context,
				)[0]?.value ?? null,
		})),
	);
}
