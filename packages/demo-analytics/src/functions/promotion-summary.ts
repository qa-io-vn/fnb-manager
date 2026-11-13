import type { AnalyticsRow, IsoDate, PromotionKind } from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import { money } from "../pg-numeric.js";
import {
	type HandlerArgs,
	type HandlerContext,
	requireDateRange,
	requireReportRows,
	requireStoreIds,
} from "./support.js";

type Row = AnalyticsRow<"promotion_summary">;

export const PROMOTION_SUMMARY_MAX_DAYS = 92;

interface PromotionTotals {
	kind: PromotionKind;
	key: string;
	name: string | null;
	invoices: number;
	lines: number;
	discountMinor: number;
	first: IsoDate;
	last: IsoDate;
	days: Set<IsoDate>;
}

function byCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function promotionSummary(
	store: AggregateStore,
	args: HandlerArgs<"promotion_summary">,
	_context: HandlerContext,
): Row[] {
	requireStoreIds("promotion_summary", args.store_ids);
	requireDateRange(
		"promotion_summary",
		args.from_date,
		args.to_date,
		PROMOTION_SUMMARY_MAX_DAYS,
	);
	const totals = new Map<string, PromotionTotals>();
	for (const visible of store.visibleStores(args.store_ids)) {
		for (const day of store.daysOf(visible, args.from_date, args.to_date)) {
			for (const usage of day.promotions) {
				const mapKey = `${usage.kind}|${usage.key}`;
				const known = totals.get(mapKey);
				if (known === undefined) {
					totals.set(mapKey, {
						kind: usage.kind,
						key: usage.key,
						name: usage.name,
						invoices: usage.invoices,
						lines: usage.lines,
						discountMinor: usage.discountMinor,
						first: day.date,
						last: day.date,
						days: new Set([day.date]),
					});
					continue;
				}
				known.name =
					known.name === null
						? usage.name
						: usage.name !== null && usage.name > known.name
							? usage.name
							: known.name;
				known.invoices += usage.invoices;
				known.lines += usage.lines;
				known.discountMinor += usage.discountMinor;
				if (day.date < known.first) known.first = day.date;
				if (day.date > known.last) known.last = day.date;
				known.days.add(day.date);
			}
		}
	}
	const rows = [...totals.values()]
		.sort(
			(left, right) =>
				right.discountMinor - left.discountMinor ||
				byCodeUnits(left.kind, right.kind) ||
				byCodeUnits(left.key, right.key),
		)
		.map(
			(total): Row => ({
				promotion_kind: total.kind,
				promotion_key: total.key,
				promotion_name: total.name,
				invoices: total.invoices,
				lines: total.kind === "item" ? total.lines : null,
				discount_amount: money(total.discountMinor).toNumber(),
				first_used_on: total.first,
				last_used_on: total.last,
				days_used: total.days.size,
			}),
		);
	requireReportRows("promotion_summary", rows.length);
	return rows;
}
