import { addDays, type IsoDate, isoWeekday } from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import { count, money, type PgDecimal, roundedMedian } from "../pg-numeric.js";
import { dailySales, type HandlerContext, isExcludedFor } from "./support.js";

export interface SameWeekdayBaselineArgs {
	readonly store_ids: readonly string[];
	readonly target_date: IsoDate;
	readonly weeks?: number;
}

export interface SameWeekdayBaselineRow {
	readonly weekday: number;
	readonly sample_days: number;
	readonly baseline_net_amount: number | null;
	readonly baseline_invoices: number | null;
	readonly baseline_avg_ticket: number | null;
}

export interface BaselineSample {
	readonly date: IsoDate;
	readonly net: PgDecimal;
	readonly invoices: PgDecimal;
}

export function baselineSamples(
	store: AggregateStore,
	storeIds: readonly string[],
	targetDate: IsoDate,
	weeks: number,
	context: HandlerContext,
): BaselineSample[] {
	const span = Math.max(weeks, 1);
	const eligible = new Set<IsoDate>();
	for (let week = 1; week <= span; week += 1) {
		const candidate = addDays(targetDate, -7 * week);
		if (!isExcludedFor(store, storeIds, candidate, context.holidays)) {
			eligible.add(candidate);
		}
	}
	const samples: BaselineSample[] = [];
	for (const date of [...eligible].sort()) {
		const rows = dailySales(store, storeIds, date, date);
		if (rows.length === 0) continue;
		let netMinor = 0;
		let invoices = 0;
		for (const row of rows) {
			netMinor += row.daily.netMinor;
			invoices += row.daily.invoices;
		}
		samples.push({ date, net: money(netMinor), invoices: count(invoices) });
	}
	return samples;
}

export function baselineOf(
	samples: readonly BaselineSample[],
): Omit<SameWeekdayBaselineRow, "weekday"> {
	return {
		sample_days: samples.length,
		baseline_net_amount: roundedMedian(
			samples.map((sample) => sample.net),
			2,
		),
		baseline_invoices: roundedMedian(
			samples.map((sample) => sample.invoices),
			2,
		),
		baseline_avg_ticket: roundedMedian(
			samples.map((sample) => sample.net.divOrNull(sample.invoices)),
			2,
		),
	};
}

export function sameWeekdayBaseline(
	store: AggregateStore,
	args: SameWeekdayBaselineArgs,
	context: HandlerContext,
): SameWeekdayBaselineRow[] {
	const samples = baselineSamples(
		store,
		args.store_ids,
		args.target_date,
		args.weeks ?? 8,
		context,
	);
	return [{ weekday: isoWeekday(args.target_date), ...baselineOf(samples) }];
}
