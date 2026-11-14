import type { ThemeRow } from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import { openingMinutes } from "../calendar.js";
import { count, money, PgDecimal, roundedRatio } from "../pg-numeric.js";
import { dailySales } from "./support.js";
import {
	requireThemeDateRange,
	requireThemeStoreIds,
	type ThemeHandlerArgs,
	type ThemeHandlerContext,
} from "./theme-support.js";

type Row = ThemeRow<"opening_productivity">;

export const OPENING_PRODUCTIVITY_MAX_DAYS = 1100;

interface StoreDay {
	readonly storeId: string;
	readonly invoices: number;
	readonly netMinor: number;
	readonly hoursMissing: boolean;
	readonly minutes: number;
	readonly seats: number | null;
}

function blockRow(
	storeId: string | null,
	days: readonly StoreDay[],
	seats: number | null,
): Row {
	if (days.length === 0) {
		return {
			store_id: storeId,
			days_with_sales: 0,
			invoices: null,
			net_amount: null,
			opening_minutes: null,
			seat_count: seats,
			seat_minutes: null,
			sales_per_opening_hour: null,
			invoices_per_opening_hour: null,
			revpash: null,
		};
	}
	const invoices = days.reduce((total, day) => total + day.invoices, 0);
	const netMinor = days.reduce((total, day) => total + day.netMinor, 0);
	const hoursKnown = days.every((day) => !day.hoursMissing);
	const minutes = hoursKnown
		? days.reduce((total, day) => total + day.minutes, 0)
		: null;
	const seatMinutes =
		hoursKnown && days.every((day) => day.seats !== null)
			? days.reduce((total, day) => total + (day.seats ?? 0) * day.minutes, 0)
			: null;
	const sixty = PgDecimal.integer(60);
	const net = money(netMinor);
	return {
		store_id: storeId,
		days_with_sales: days.length,
		invoices,
		net_amount: net.toNumber(),
		opening_minutes: minutes,
		seat_count: seats,
		seat_minutes: seatMinutes,
		sales_per_opening_hour:
			minutes === null ? null : roundedRatio(sixty.mul(net), count(minutes), 2),
		invoices_per_opening_hour:
			minutes === null
				? null
				: roundedRatio(sixty.mul(count(invoices)), count(minutes), 4),
		revpash:
			seatMinutes === null
				? null
				: roundedRatio(sixty.mul(net), count(seatMinutes), 2),
	};
}

export function openingProductivity(
	store: AggregateStore,
	args: ThemeHandlerArgs<"opening_productivity">,
	context: ThemeHandlerContext,
): Row[] {
	requireThemeStoreIds("opening_productivity", args.store_ids);
	requireThemeDateRange(
		"opening_productivity",
		args.from_date,
		args.to_date,
		OPENING_PRODUCTIVITY_MAX_DAYS,
	);
	if (args.store_ids.length === 0) return [];
	const visible = store.visibleStores(args.store_ids);
	const days: StoreDay[] = dailySales(
		store,
		args.store_ids,
		args.from_date,
		args.to_date,
	).map((row) => ({
		storeId: row.store.id,
		invoices: row.daily.invoices,
		netMinor: row.daily.netMinor,
		hoursMissing: row.store.openingHours === null,
		minutes: openingMinutes(row.store.openingHours, row.date) ?? 0,
		seats: context.settings.seatCount(row.store.id),
	}));
	const storesWithDays = visible.filter((entry) =>
		days.some((day) => day.storeId === entry.id),
	);
	const allSeats =
		storesWithDays.length === 0 ||
		storesWithDays.some(
			(entry) => context.settings.seatCount(entry.id) === null,
		)
			? null
			: storesWithDays.reduce(
					(total, entry) => total + (context.settings.seatCount(entry.id) ?? 0),
					0,
				);
	return [
		blockRow(null, days, allSeats),
		...visible.map((entry) =>
			blockRow(
				entry.id,
				days.filter((day) => day.storeId === entry.id),
				context.settings.seatCount(entry.id),
			),
		),
	];
}
