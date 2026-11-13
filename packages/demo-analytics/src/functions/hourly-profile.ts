import { type AnalyticsRow, addDays, type IsoDate } from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import { count, money, quantity, roundedMedian } from "../pg-numeric.js";
import {
	dailySales,
	type HandlerArgs,
	type HandlerContext,
	hourlySales,
	invalid,
	isExcludedFor,
	requireStoreIds,
} from "./support.js";

type Row = AnalyticsRow<"hourly_profile">;

export const HOURLY_PROFILE_MAX_WEEKS = 26;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

interface HourSums {
	invoices: number;
	netMinor: number;
	itemsMilli: number;
}

function hourSums(
	store: AggregateStore,
	storeIds: readonly string[],
	from: IsoDate,
	to: IsoDate,
): Map<string, HourSums> {
	const sums = new Map<string, HourSums>();
	for (const row of hourlySales(store, storeIds, from, to)) {
		const key = `${row.date}|${row.hourly.hour}`;
		const known = sums.get(key) ?? { invoices: 0, netMinor: 0, itemsMilli: 0 };
		known.invoices += row.hourly.invoices;
		known.netMinor += row.hourly.netMinor;
		known.itemsMilli += row.hourly.itemsMilli;
		sums.set(key, known);
	}
	return sums;
}

export function hourlyProfile(
	store: AggregateStore,
	args: HandlerArgs<"hourly_profile">,
	context: HandlerContext,
): Row[] {
	requireStoreIds("hourly_profile", args.store_ids);
	const weeks = args.weeks ?? 8;
	if (weeks < 1 || weeks > HOURLY_PROFILE_MAX_WEEKS) {
		invalid(
			"hourly_profile",
			`hourly_profile needs weeks between 1 and ${HOURLY_PROFILE_MAX_WEEKS}`,
		);
	}
	if (args.store_ids.length === 0) return [];
	const target = args.target_date;
	const hasRows = dailySales(store, args.store_ids, target, target).length > 0;
	const current = hourSums(store, args.store_ids, target, target);
	const eligible: IsoDate[] = [];
	const past = new Map<string, HourSums>();
	for (let week = 1; week <= weeks; week += 1) {
		const candidate = addDays(target, -7 * week);
		if (
			isExcludedFor(store, args.store_ids, candidate, context.holidays) ||
			dailySales(store, args.store_ids, candidate, candidate).length === 0
		) {
			continue;
		}
		eligible.push(candidate);
		for (const [key, sums] of hourSums(
			store,
			args.store_ids,
			candidate,
			candidate,
		)) {
			past.set(key, sums);
		}
	}
	return HOURS.map((hour) => {
		const now = current.get(`${target}|${hour}`);
		const samples = eligible.map(
			(date) =>
				past.get(`${date}|${hour}`) ?? {
					invoices: 0,
					netMinor: 0,
					itemsMilli: 0,
				},
		);
		return {
			hour_local: hour,
			current_invoices: hasRows ? (now?.invoices ?? 0) : null,
			current_net_amount: hasRows ? money(now?.netMinor ?? 0).toNumber() : null,
			current_items_sold: hasRows
				? quantity(now?.itemsMilli ?? 0).toNumber()
				: null,
			sample_days: eligible.length,
			baseline_invoices: roundedMedian(
				samples.map((sample) => count(sample.invoices)),
				2,
			),
			baseline_net_amount: roundedMedian(
				samples.map((sample) => money(sample.netMinor)),
				2,
			),
		};
	});
}
