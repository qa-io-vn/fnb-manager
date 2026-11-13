import type { IsoDate } from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import { openingMinutes } from "../calendar.js";
import {
	count,
	money,
	PgDecimal,
	quantity,
	roundedRatio,
} from "../pg-numeric.js";
import {
	dailySales,
	type HandlerContext,
	hourlySales,
	invalid,
	periodTotals,
} from "./support.js";

export interface MetricValueArgs {
	readonly store_ids: readonly string[];
	readonly metric_id: string;
	readonly from_date: IsoDate;
	readonly to_date: IsoDate;
}

export interface MetricValueRow {
	readonly value: number | null;
}

export const METRIC_VALUE_IDS = [
	"net_revenue",
	"gross_revenue",
	"invoices",
	"avg_ticket",
	"items_per_ticket",
	"avg_item_price",
	"cash_share",
	"voucher_invoice_share",
	"member_invoice_share",
	"discount_rate",
	"attach_rate_topping",
	"attach_rate_snack",
	"size_l_share",
	"sales_per_opening_hour",
	"invoices_per_opening_hour",
	"peak_share_20_21",
	"dead_hour_share_17_18",
	"void_rate",
	"edit_rate",
	"removed_line_rate",
	"customer_capture_rate",
] as const;

type Computation = (
	store: AggregateStore,
	args: MetricValueArgs,
	context: HandlerContext,
) => number | null;

function summary(store: AggregateStore, args: MetricValueArgs) {
	return periodTotals(store, args.store_ids, args.from_date, args.to_date);
}

function attachRate(
	store: AggregateStore,
	args: MetricValueArgs,
	numerator: "toppingInvoices" | "snackInvoices",
	rate: "attachRateTopping" | "attachRateSnack",
): number | null {
	let top = 0;
	let bottom = 0;
	let rows = 0;
	for (const visible of store.visibleStores(args.store_ids)) {
		for (const day of store.daysOf(visible, args.from_date, args.to_date)) {
			const attach = day.attach;
			if (attach === null || attach[rate] === null) continue;
			rows += 1;
			top += attach[numerator];
			bottom += attach.drinkInvoices;
		}
	}
	if (rows === 0) return null;
	return roundedRatio(count(top), count(bottom), 6);
}

function hourShare(
	store: AggregateStore,
	args: MetricValueArgs,
	hours: readonly number[],
): number | null {
	let inHours = 0;
	let total = 0;
	let rows = 0;
	for (const row of hourlySales(
		store,
		args.store_ids,
		args.from_date,
		args.to_date,
	)) {
		rows += 1;
		total += row.hourly.netMinor;
		if (hours.includes(row.hourly.hour)) inHours += row.hourly.netMinor;
	}
	if (rows === 0) return null;
	return roundedRatio(money(inHours), money(total), 6);
}

function perOpeningHour(
	store: AggregateStore,
	args: MetricValueArgs,
	value: "net" | "invoices",
): number | null {
	const rows = dailySales(store, args.store_ids, args.from_date, args.to_date);
	if (rows.length === 0) return null;
	if (rows.some((row) => row.store.openingHours === null)) return null;
	let minutes = 0;
	let netMinor = 0;
	let invoices = 0;
	for (const row of rows) {
		minutes += openingMinutes(row.store.openingHours, row.date) ?? 0;
		netMinor += row.daily.netMinor;
		invoices += row.daily.invoices;
	}
	const sixty = PgDecimal.integer(60);
	return value === "net"
		? roundedRatio(sixty.mul(money(netMinor)), count(minutes), 2)
		: roundedRatio(sixty.mul(count(invoices)), count(minutes), 4);
}

function dailyRate(
	store: AggregateStore,
	args: MetricValueArgs,
	numerator: (sums: {
		voided: number;
		invoices: number;
		edited: number;
	}) => number,
	denominator: (sums: {
		voided: number;
		invoices: number;
		edited: number;
	}) => number,
): number | null {
	const rows = dailySales(store, args.store_ids, args.from_date, args.to_date);
	if (rows.length === 0) return null;
	const sums = { voided: 0, invoices: 0, edited: 0 };
	for (const row of rows) {
		sums.voided += row.daily.voidedInvoices;
		sums.invoices += row.daily.invoices;
		sums.edited += row.daily.editedInvoices;
	}
	return roundedRatio(count(numerator(sums)), count(denominator(sums)), 6);
}

function removedLineRate(
	store: AggregateStore,
	args: MetricValueArgs,
): number | null {
	let removed = 0;
	let itemLines = 0;
	for (const visible of store.visibleStores(args.store_ids)) {
		for (const date of store.days.datesFor(
			visible,
			args.from_date,
			args.to_date,
		)) {
			removed += store.removedLinesOn(visible, date);
			itemLines += store.day(visible.id, date)?.itemLines ?? 0;
		}
	}
	return roundedRatio(count(removed), count(itemLines), 6);
}

function sizeLargeShare(
	store: AggregateStore,
	args: MetricValueArgs,
): number | null {
	let large = 0;
	let total = 0;
	let rows = 0;
	for (const visible of store.visibleStores(args.store_ids)) {
		for (const day of store.daysOf(visible, args.from_date, args.to_date)) {
			for (const size of day.sizes) {
				rows += 1;
				total += size.quantityMilli;
				if (size.sizeLabel === "L") large += size.quantityMilli;
			}
		}
	}
	if (rows === 0) return null;
	return roundedRatio(quantity(large), quantity(total), 6);
}

const computations: Readonly<Record<string, Computation>> = {
	net_revenue: (store, args) => {
		const totals = summary(store, args);
		return totals.days_with_data > 0 ? totals.net_amount : null;
	},
	gross_revenue: (store, args) => {
		const totals = summary(store, args);
		return totals.days_with_data > 0 ? totals.gross_amount : null;
	},
	invoices: (store, args) => {
		const totals = summary(store, args);
		return totals.days_with_data > 0 ? totals.invoices : null;
	},
	avg_ticket: (store, args) => summary(store, args).avg_ticket,
	items_per_ticket: (store, args) => summary(store, args).items_per_ticket,
	avg_item_price: (store, args) => summary(store, args).avg_item_price,
	cash_share: (store, args) => summary(store, args).cash_share,
	voucher_invoice_share: (store, args) => summary(store, args).voucher_share,
	member_invoice_share: (store, args) => summary(store, args).member_share,
	discount_rate: (store, args) => summary(store, args).discount_rate,
	attach_rate_topping: (store, args) =>
		attachRate(store, args, "toppingInvoices", "attachRateTopping"),
	attach_rate_snack: (store, args) =>
		attachRate(store, args, "snackInvoices", "attachRateSnack"),
	size_l_share: (store, args) => sizeLargeShare(store, args),
	sales_per_opening_hour: (store, args) => perOpeningHour(store, args, "net"),
	invoices_per_opening_hour: (store, args) =>
		perOpeningHour(store, args, "invoices"),
	peak_share_20_21: (store, args) => hourShare(store, args, [20, 21]),
	dead_hour_share_17_18: (store, args) => hourShare(store, args, [17, 18]),
	void_rate: (store, args) =>
		dailyRate(
			store,
			args,
			(sums) => sums.voided,
			(sums) => sums.invoices + sums.voided,
		),
	edit_rate: (store, args) =>
		dailyRate(
			store,
			args,
			(sums) => sums.edited,
			(sums) => sums.invoices,
		),
	removed_line_rate: (store, args) => removedLineRate(store, args),
	customer_capture_rate: (store, args) => summary(store, args).identified_share,
};

export function isMetricValueId(id: string): boolean {
	return Object.hasOwn(computations, id);
}

export function metricValue(
	store: AggregateStore,
	args: MetricValueArgs,
	context: HandlerContext,
): MetricValueRow[] {
	if (args.from_date > args.to_date) {
		invalid(
			"metric_compare",
			"metric_value needs a date range whose start is not after its end",
		);
	}
	const computation = computations[args.metric_id];
	if (computation === undefined) {
		invalid(
			"metric_compare",
			`metric_value does not compute '${args.metric_id}'`,
		);
	}
	return [{ value: computation(store, args, context) }];
}
