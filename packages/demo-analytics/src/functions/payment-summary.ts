import type { AnalyticsRow, IsoDate, PaymentKindValue } from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import { money, roundedRatio } from "../pg-numeric.js";
import {
	type HandlerArgs,
	type HandlerContext,
	requireCompareRange,
	requireDateRange,
	requireReportRows,
	requireStoreIds,
} from "./support.js";

type Row = AnalyticsRow<"payment_summary">;

export const PAYMENT_SUMMARY_MAX_DAYS = 400;

interface MethodTotals {
	kind: PaymentKindValue;
	name: string;
	invoices: number;
	amountMinor: number;
	feeMinor: number;
	feeEstimateMinor: number;
	compareAmountMinor: number;
}

function inRange(
	date: IsoDate,
	from: IsoDate | undefined,
	to: IsoDate | undefined,
): boolean {
	return from !== undefined && to !== undefined && date >= from && date <= to;
}

function byCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function paymentSummary(
	store: AggregateStore,
	args: HandlerArgs<"payment_summary">,
	_context: HandlerContext,
): Row[] {
	requireStoreIds("payment_summary", args.store_ids);
	requireDateRange(
		"payment_summary",
		args.from_date,
		args.to_date,
		PAYMENT_SUMMARY_MAX_DAYS,
	);
	requireCompareRange(
		"payment_summary",
		args.compare_from,
		args.compare_to,
		PAYMENT_SUMMARY_MAX_DAYS,
	);
	const hasCompare = args.compare_from !== undefined;
	const methods = new Map<string, MethodTotals>();
	const seen = new Set<string>();
	const ranges: [IsoDate, IsoDate][] = [[args.from_date, args.to_date]];
	if (args.compare_from !== undefined && args.compare_to !== undefined) {
		ranges.push([args.compare_from, args.compare_to]);
	}
	for (const [from, to] of ranges) {
		for (const visible of store.visibleStores(args.store_ids)) {
			for (const day of store.daysOf(visible, from, to)) {
				const dayKey = `${visible.id}|${day.date}`;
				if (seen.has(dayKey)) continue;
				seen.add(dayKey);
				const current = inRange(day.date, args.from_date, args.to_date);
				const compare = inRange(day.date, args.compare_from, args.compare_to);
				for (const payment of day.payments) {
					const name = payment.methodName ?? payment.methodExternalId;
					const key = `${payment.kind}|${name}`;
					const known = methods.get(key) ?? {
						kind: payment.kind,
						name,
						invoices: 0,
						amountMinor: 0,
						feeMinor: 0,
						feeEstimateMinor: 0,
						compareAmountMinor: 0,
					};
					if (current) {
						known.invoices += payment.invoices;
						known.amountMinor += payment.amountMinor;
						known.feeMinor += payment.feeMinor;
						known.feeEstimateMinor += payment.feeEstimateMinor;
					}
					if (compare) known.compareAmountMinor += payment.amountMinor;
					methods.set(key, known);
				}
			}
		}
	}
	let currentTotal = 0;
	let compareTotal = 0;
	for (const method of methods.values()) {
		currentTotal += method.amountMinor;
		compareTotal += method.compareAmountMinor;
	}
	const rows = [...methods.entries()]
		.sort(
			([leftKey, left], [rightKey, right]) =>
				right.amountMinor - left.amountMinor || byCodeUnits(leftKey, rightKey),
		)
		.map(
			([key, method]): Row => ({
				method_key: key,
				kind: method.kind,
				payment_method_name: method.name,
				invoices: method.invoices,
				amount: money(method.amountMinor).toNumber(),
				share: roundedRatio(money(method.amountMinor), money(currentTotal), 6),
				fee_amount: money(method.feeMinor).toNumber(),
				fee_estimate_amount: money(method.feeEstimateMinor).toNumber(),
				compare_amount: hasCompare
					? money(method.compareAmountMinor).toNumber()
					: null,
				compare_share: hasCompare
					? roundedRatio(
							money(method.compareAmountMinor),
							money(compareTotal),
							6,
						)
					: null,
			}),
		);
	requireReportRows("payment_summary", rows.length);
	return rows;
}
