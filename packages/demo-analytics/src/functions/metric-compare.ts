import { type AnalyticsRow, periodBounds } from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import { metricValue } from "./metric-value.js";
import {
	type HandlerArgs,
	type HandlerContext,
	invalid,
	requireStoreIds,
} from "./support.js";

type Row = AnalyticsRow<"metric_compare">;

export const METRIC_COMPARE_MAX_IDS = 25;

export function metricCompare(
	store: AggregateStore,
	args: HandlerArgs<"metric_compare">,
	context: HandlerContext,
): Row[] {
	requireStoreIds("metric_compare", args.store_ids);
	if (
		args.metric_ids.length < 1 ||
		args.metric_ids.length > METRIC_COMPARE_MAX_IDS
	) {
		invalid(
			"metric_compare",
			`metric_compare needs 1 to ${METRIC_COMPARE_MAX_IDS} metric ids`,
		);
	}
	if (args.store_ids.length === 0) return [];
	const bounds = periodBounds(args.grain, args.anchor).filter(
		(bound) => bound.period !== "baseline",
	);
	const rows: Row[] = [];
	for (const metricId of args.metric_ids) {
		for (const bound of bounds) {
			if (bound.period === "baseline") continue;
			const [result] = metricValue(
				store,
				{
					store_ids: args.store_ids,
					metric_id: metricId,
					from_date: bound.from,
					to_date: bound.to,
				},
				context,
			);
			rows.push({
				metric_id: metricId,
				period: bound.period,
				from_date: bound.from,
				to_date: bound.to,
				value: result?.value ?? null,
			});
		}
	}
	return rows;
}
