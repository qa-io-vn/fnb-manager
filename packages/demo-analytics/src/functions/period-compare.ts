import { type AnalyticsRow, BASELINE_WEEKS, periodBounds } from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import { PgDecimal } from "../pg-numeric.js";
import { sameWeekdayBaseline } from "./same-weekday-baseline.js";
import {
	type HandlerArgs,
	type HandlerContext,
	periodTotals,
} from "./support.js";

type Row = AnalyticsRow<"period_compare">;

export function roundedInvoices(value: number | null): number | null {
	return value === null
		? null
		: PgDecimal.parse(value.toFixed(2)).round(0).toNumber();
}

export function periodCompare(
	store: AggregateStore,
	args: HandlerArgs<"period_compare">,
	context: HandlerContext,
): Row[] {
	const rows: Row[] = [];
	for (const bound of periodBounds(args.grain, args.anchor)) {
		if (bound.period === "baseline") {
			const [baseline] = sameWeekdayBaseline(
				store,
				{
					store_ids: args.store_ids,
					target_date: args.anchor,
					weeks: BASELINE_WEEKS,
				},
				context,
			);
			rows.push({
				period: "baseline",
				from_date: bound.from,
				to_date: bound.to,
				days_with_data: baseline?.sample_days ?? 0,
				invoices: roundedInvoices(baseline?.baseline_invoices ?? null),
				net_amount: baseline?.baseline_net_amount ?? null,
				gross_amount: null,
				discount_amount: null,
				avg_ticket: baseline?.baseline_avg_ticket ?? null,
				items_per_ticket: null,
				avg_item_price: null,
				cash_share: null,
				voucher_share: null,
				member_share: null,
				identified_share: null,
			});
			continue;
		}
		const totals = periodTotals(store, args.store_ids, bound.from, bound.to);
		rows.push({
			period: bound.period,
			from_date: bound.from,
			to_date: bound.to,
			days_with_data: totals.days_with_data,
			invoices: totals.invoices,
			net_amount: totals.net_amount,
			gross_amount: totals.gross_amount,
			discount_amount: totals.discount_amount,
			avg_ticket: totals.avg_ticket,
			items_per_ticket: totals.items_per_ticket,
			avg_item_price: totals.avg_item_price,
			cash_share: totals.cash_share,
			voucher_share: totals.voucher_share,
			member_share: totals.member_share,
			identified_share: totals.identified_share,
		});
	}
	return rows;
}
