import type { AnalyticsRow } from "../../../../src/contract/functions.js";
import type { IsoDate } from "../../../../src/contract/values.js";
import { coverageModel } from "../../../../src/model/coverage.js";
import { addDays } from "../../../../src/period/dates.js";
import type { ThemeContext } from "../../../../src/themes/context.js";
import type { ThemeRow } from "../../../../src/themes/contract.js";
import {
	RANGE_INDEX,
	type ReportRow,
	type ThemeCardInput,
} from "../../../../src/themes/definition.js";
import type { ReportFunctionName } from "../../../../src/themes/source.js";
import { rangeTotalsRow } from "../fixtures.js";

export type TotalsRangeRow = ThemeRow<"range_totals">;
export type SeriesRow = AnalyticsRow<"period_series">;
export type CoverageRow = AnalyticsRow<"store_coverage">;
export type RangeKind = keyof typeof RANGE_INDEX;

export function sales(
	net: number,
	invoices: number,
	items: number,
): Partial<TotalsRangeRow> {
	return {
		net_amount: net,
		invoices,
		items_sold: items,
		avg_ticket:
			invoices === 0 ? null : Math.round((net / invoices) * 100) / 100,
		items_per_ticket:
			invoices === 0 ? null : Math.round((items / invoices) * 10_000) / 10_000,
		avg_item_price: items === 0 ? null : Math.round((net / items) * 100) / 100,
	};
}

export function totalsRow(
	context: ThemeContext,
	kind: RangeKind,
	storeId: string | null,
	values: Partial<TotalsRangeRow> = {},
): TotalsRangeRow {
	const span =
		kind === "current"
			? context.range
			: kind === "previous"
				? context.range.previous
				: context.range.lastYear;
	if (span === null) throw new Error("this range has no last-year reference");
	return rangeTotalsRow(RANGE_INDEX[kind], storeId, span.from, span.to, values);
}

export function likeForLikeRows(
	context: ThemeContext,
	kind: "previous" | "last_year",
	current: Partial<TotalsRangeRow>,
	reference: Partial<TotalsRangeRow>,
): TotalsRangeRow[] {
	const span =
		kind === "previous" ? context.range.previous : context.range.lastYear;
	if (span === null) throw new Error("this range has no last-year reference");
	return [
		rangeTotalsRow(1, null, context.range.from, context.range.to, current),
		rangeTotalsRow(2, null, span.from, span.to, reference),
	];
}

export function seriesRow(
	bucket: IsoDate,
	overrides: Partial<SeriesRow> = {},
): SeriesRow {
	return {
		store_id: null,
		bucket_start: bucket,
		bucket_end: bucket,
		iso_year: null,
		iso_week: null,
		weekday: null,
		calendar_days: 1,
		excluded_days: 0,
		tet_days: 0,
		holiday_kind: null,
		checked_days: 1,
		matched_days: 1,
		days_with_data: 1,
		invoices: 100,
		net_amount: 5_000_000,
		gross_amount: 5_200_000,
		item_discount_amount: 0,
		bill_discount_amount: 0,
		voucher_amount: 0,
		discount_amount: 200_000,
		paid_amount: 5_000_000,
		cash_amount: 1_000_000,
		items_sold: 150,
		voucher_invoices: 0,
		member_invoices: 0,
		identified_invoices: 0,
		voided_invoices: 0,
		voided_amount: 0,
		edited_invoices: 0,
		avg_ticket: 50_000,
		items_per_ticket: 1.5,
		avg_item_price: 33_333.33,
		cash_share: 0.2,
		voucher_share: 0,
		member_share: 0,
		identified_share: 0,
		discount_rate: 0.04,
		...overrides,
	};
}

export function dayRows(
	from: IsoDate,
	nets: readonly number[],
	overrides: (date: IsoDate) => Partial<SeriesRow> = () => ({}),
): SeriesRow[] {
	return nets.map((net, index) => {
		const date = addDays(from, index);
		return seriesRow(date, { net_amount: net, ...overrides(date) });
	});
}

export function weekRows(
	monday: IsoDate,
	nets: readonly number[],
	overrides: (start: IsoDate) => Partial<SeriesRow> = () => ({}),
): SeriesRow[] {
	return nets.map((net, index) => {
		const start = addDays(monday, 7 * index);
		return seriesRow(start, {
			bucket_end: addDays(start, 6),
			calendar_days: 7,
			days_with_data: 7,
			net_amount: net,
			...overrides(start),
		});
	});
}

export function monthRow(
	storeId: string | null,
	from: IsoDate,
	to: IsoDate,
	net: number,
): SeriesRow {
	return seriesRow(from, {
		store_id: storeId,
		bucket_end: to,
		net_amount: net,
	});
}

export function cardInput(
	context: ThemeContext,
	calls: Readonly<Record<string, readonly unknown[]>>,
	coverageRows: readonly CoverageRow[] = [],
): ThemeCardInput {
	return {
		context,
		coverage: coverageModel(coverageRows, context),
		results: {
			rows<N extends ReportFunctionName>(key: string, _name: N) {
				return calls[key] as readonly ReportRow<N>[] | undefined;
			},
		},
	};
}
