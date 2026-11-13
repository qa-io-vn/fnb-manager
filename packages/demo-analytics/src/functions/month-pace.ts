import {
	type AnalyticsRow,
	addDays,
	asOfDate,
	datesBetween,
	daysBetween,
	firstOfMonth,
	type IsoDate,
	lastOfMonth,
	maxDate,
	minDate,
} from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import { money, PgDecimal } from "../pg-numeric.js";
import {
	profileEntryFor,
	profileForecast,
	seasonalNaiveSeries,
	weekdayProfile,
} from "./forecast-series-helpers.js";
import {
	dailySales,
	type HandlerArgs,
	type HandlerContext,
} from "./support.js";

type Row = AnalyticsRow<"month_pace">;

const MINOR_UNITS = 100;

interface ForecastTotal {
	readonly total: PgDecimal;
	readonly days: number;
}

function totalOf(values: readonly (PgDecimal | null)[]): ForecastTotal {
	let total = PgDecimal.integer(0);
	let days = 0;
	for (const value of values) {
		if (value === null) continue;
		total = total.add(value);
		days += 1;
	}
	return { total, days };
}

export function analyticsAsOf(
	store: AggregateStore,
	storeIds: readonly string[],
	now: Date,
): IsoDate {
	return asOfDate(store.visibleStores(storeIds), now);
}

function monthTarget(
	store: AggregateStore,
	storeIds: readonly string[],
	periodStart: IsoDate,
): number | null {
	let minor: number | null = null;
	for (const visible of store.visibleStores(storeIds)) {
		const target = store.days.target(visible, "month", periodStart);
		if (target === null) continue;
		minor = (minor ?? 0) + Math.round(target * MINOR_UNITS);
	}
	return minor === null ? null : money(minor).toNumber();
}

export function monthPace(
	store: AggregateStore,
	args: HandlerArgs<"month_pace">,
	context: HandlerContext,
): Row[] {
	const periodStart = firstOfMonth(args.month_start);
	const lastDay = lastOfMonth(periodStart);
	const asOf = minDate(
		args.as_of ?? analyticsAsOf(store, args.store_ids, context.now),
		lastDay,
	);
	const firstForecastDay = maxDate(addDays(asOf, 1), periodStart);
	const elapsedDays = Math.max(daysBetween(periodStart, asOf) + 1, 0);
	const remainingDays = Math.max(daysBetween(firstForecastDay, lastDay) + 1, 0);

	const sales = dailySales(store, args.store_ids, periodStart, asOf);
	let netMinor = 0;
	let invoices = 0;
	for (const row of sales) {
		netMinor += row.daily.netMinor;
		invoices += row.daily.invoices;
	}
	const monthToDate =
		sales.length === 0 ? PgDecimal.integer(0) : money(netMinor);

	const profile = weekdayProfile(store, args.store_ids, asOf, context.holidays);
	const profileDays = totalOf(
		datesBetween(firstForecastDay, lastDay).map((date) =>
			profileForecast(profileEntryFor(profile, date)),
		),
	);
	const naiveDays = totalOf(
		seasonalNaiveSeries(
			store,
			args.store_ids,
			asOf,
			firstForecastDay,
			lastDay,
			context.holidays,
		).map((point) => point.forecast),
	);

	return [
		{
			period_start: periodStart,
			as_of_date: asOf,
			elapsed_days: elapsedDays,
			remaining_days: remainingDays,
			month_to_date_net_amount: monthToDate.toNumber(),
			month_to_date_invoices: invoices,
			forecast_weekday_profile_net_amount:
				profileDays.days === remainingDays
					? monthToDate.add(profileDays.total).toNumber()
					: null,
			forecast_seasonal_naive_net_amount:
				naiveDays.days === remainingDays
					? monthToDate.add(naiveDays.total).toNumber()
					: null,
			target_net_amount: monthTarget(store, args.store_ids, periodStart),
		},
	];
}
