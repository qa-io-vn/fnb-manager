import { type AnalyticsRow, BASELINE_WEEKS, periodBounds } from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import { roundedInvoices } from "./period-compare.js";
import { sameWeekdayBaseline } from "./same-weekday-baseline.js";
import {
	EMPTY_TOTALS,
	type HandlerArgs,
	type HandlerContext,
	periodTotals,
	requireStoreIds,
} from "./support.js";

type Row = AnalyticsRow<"period_compare_by_store">;

export function periodCompareByStore(
	store: AggregateStore,
	args: HandlerArgs<"period_compare_by_store">,
	context: HandlerContext,
): Row[] {
	requireStoreIds("period_compare_by_store", args.store_ids);
	if (args.store_ids.length === 0) return [];
	const bounds = periodBounds(args.grain, args.anchor);
	const blocks: { storeId: string | null; storeIds: readonly string[] }[] = [
		{ storeId: null, storeIds: args.store_ids },
		...store
			.visibleStores(args.store_ids)
			.map((visible) => ({ storeId: visible.id, storeIds: [visible.id] })),
	];
	const rows: Row[] = [];
	for (const block of blocks) {
		for (const bound of bounds) {
			if (bound.period === "baseline") {
				const [baseline] = sameWeekdayBaseline(
					store,
					{
						store_ids: block.storeIds,
						target_date: args.anchor,
						weeks: BASELINE_WEEKS,
					},
					context,
				);
				rows.push({
					...EMPTY_TOTALS,
					store_id: block.storeId,
					period: "baseline",
					from_date: bound.from,
					to_date: bound.to,
					days_with_data: baseline?.sample_days ?? 0,
					invoices: roundedInvoices(baseline?.baseline_invoices ?? null),
					net_amount: baseline?.baseline_net_amount ?? null,
					avg_ticket: baseline?.baseline_avg_ticket ?? null,
				});
				continue;
			}
			rows.push({
				store_id: block.storeId,
				period: bound.period,
				from_date: bound.from,
				to_date: bound.to,
				...periodTotals(store, block.storeIds, bound.from, bound.to),
			});
		}
	}
	return rows;
}
