import { type HolidayEntry, VIETNAM_HOLIDAYS } from "@fnb/core";
import {
	type AnalyticsArgs,
	AnalyticsCallError,
	type AnalyticsFunctionName,
	type AnalyticsRow,
	type AnalyticsSource,
	addDays,
	analyticsFunctions,
	BASELINE_WEEKS,
	firstOfMonth,
	INVALID_ARGUMENTS_CODE,
	INVALID_ROWS_CODE,
	type IsoDate,
	lastOfMonth,
	minDate,
	periodBounds,
} from "@fnb/reports";
import { z } from "zod";
import { AggregateStore, type StoreDayRange } from "./aggregates.js";
import { DemoDayCache } from "./days.js";
import { dailyBaselines } from "./functions/daily-baselines.js";
import { forecastAccuracy } from "./functions/forecast-accuracy.js";
import { hourlyProfile } from "./functions/hourly-profile.js";
import { itemLifecycle } from "./functions/item-lifecycle.js";
import { itemSummary } from "./functions/item-summary.js";
import { itemVelocity } from "./functions/item-velocity.js";
import { metricCompare } from "./functions/metric-compare.js";
import { monthPace } from "./functions/month-pace.js";
import { paymentSummary } from "./functions/payment-summary.js";
import { periodCompare } from "./functions/period-compare.js";
import { periodCompareByStore } from "./functions/period-compare-by-store.js";
import { periodSeries } from "./functions/period-series.js";
import { promotionSummary } from "./functions/promotion-summary.js";
import { shiftReview, TRAILING_DAYS } from "./functions/shift-review.js";
import { storeCoverage } from "./functions/store-coverage.js";
import { storeTargets } from "./functions/store-targets.js";
import type {
	Handler,
	HandlerArgs,
	HandlerContext,
} from "./functions/support.js";

export interface DemoAnalyticsSourceOptions {
	readonly now: () => Date;
	readonly days?: DemoDayCache;
	readonly volumeScale?: number;
	readonly validateRows?: boolean;
	readonly holidays?: readonly HolidayEntry[];
}

export interface DemoAnalyticsSource extends AnalyticsSource {
	readonly kind: "demo";
	readonly aggregates: AggregateStore;
}

type Handlers = { readonly [N in AnalyticsFunctionName]: Handler<N> };
type Reads = {
	readonly [N in AnalyticsFunctionName]: (
		args: HandlerArgs<N>,
		store: AggregateStore,
	) => readonly StoreDayRange[];
};

const FORECAST_HISTORY_DAYS = 90;

export const handlers: Handlers = {
	store_coverage: storeCoverage,
	period_compare: periodCompare,
	period_compare_by_store: periodCompareByStore,
	period_series: periodSeries,
	daily_baselines: dailyBaselines,
	hourly_profile: hourlyProfile,
	metric_compare: metricCompare,
	item_summary: itemSummary,
	payment_summary: paymentSummary,
	promotion_summary: promotionSummary,
	shift_review: shiftReview,
	store_targets: storeTargets,
	item_velocity: itemVelocity,
	month_pace: monthPace,
	forecast_accuracy: forecastAccuracy,
	item_lifecycle: itemLifecycle,
};

function range(
	storeIds: readonly string[],
	from: IsoDate,
	to: IsoDate,
): StoreDayRange {
	return { storeIds, from, to };
}

function boundRanges(
	storeIds: readonly string[],
	grain: "day" | "week" | "month" | "year",
	anchor: IsoDate,
	padBefore: number,
): StoreDayRange[] {
	return periodBounds(grain, anchor).flatMap((bound) => {
		if (bound.period !== "baseline") {
			return [range(storeIds, addDays(bound.from, -padBefore), bound.to)];
		}
		return Array.from({ length: BASELINE_WEEKS }, (_, index) => {
			const date = addDays(anchor, -7 * (index + 1));
			return range(storeIds, date, date);
		});
	});
}

export const reads: Reads = {
	store_coverage: (args, store) => [
		range(args.store_ids, args.from_date, args.to_date),
		...store.visibleStores(args.store_ids).flatMap((visible) => {
			const span = store.days.storeRange(visible);
			return span === null
				? []
				: [
						range([visible.id], span.from, span.from),
						range([visible.id], span.to, span.to),
					];
		}),
	],
	period_compare: (args) =>
		boundRanges(args.store_ids, args.grain, args.anchor, 0),
	period_compare_by_store: (args) =>
		boundRanges(args.store_ids, args.grain, args.anchor, 0),
	period_series: (args) => [
		range(args.store_ids, args.from_date, args.to_date),
	],
	daily_baselines: (args) => [
		range(
			args.store_ids,
			addDays(args.from_date, -7 * (args.weeks ?? 8)),
			args.to_date,
		),
	],
	hourly_profile: (args) => [
		range(args.store_ids, args.target_date, args.target_date),
		...Array.from({ length: args.weeks ?? 8 }, (_, index) => {
			const date = addDays(args.target_date, -7 * (index + 1));
			return range(args.store_ids, date, date);
		}),
	],
	metric_compare: (args) =>
		periodBounds(args.grain, args.anchor)
			.filter((bound) => bound.period !== "baseline")
			.map((bound) => range(args.store_ids, addDays(bound.from, -1), bound.to)),
	item_summary: (args) => [
		range(args.store_ids, args.from_date, args.to_date),
		...(args.compare_from !== undefined && args.compare_to !== undefined
			? [range(args.store_ids, args.compare_from, args.compare_to)]
			: []),
	],
	payment_summary: (args) => [
		range(args.store_ids, args.from_date, args.to_date),
		...(args.compare_from !== undefined && args.compare_to !== undefined
			? [range(args.store_ids, args.compare_from, args.compare_to)]
			: []),
	],
	promotion_summary: (args) => [
		range(args.store_ids, args.from_date, args.to_date),
	],
	shift_review: (args) => [
		range(
			args.store_ids,
			addDays(args.from_date, -TRAILING_DAYS),
			args.to_date,
		),
	],
	store_targets: () => [],
	item_velocity: (args) => [
		range(args.store_ids, addDays(args.as_of_date, -55), args.as_of_date),
	],
	month_pace: (args, store) => {
		const monthStart = firstOfMonth(args.month_start);
		const asOf = minDate(args.as_of ?? store.asOf(), lastOfMonth(monthStart));
		const from = minDate(monthStart, addDays(asOf, -FORECAST_HISTORY_DAYS));
		return [range(args.store_ids, from, asOf)];
	},
	forecast_accuracy: (args) => [
		range(
			args.store_ids,
			addDays(args.as_of_date, -(args.days ?? 28) - FORECAST_HISTORY_DAYS),
			args.as_of_date,
		),
	],
	item_lifecycle: (args) => [
		range(args.store_ids, "2000-01-01", args.as_of_date),
	],
};

function parseArgs<N extends AnalyticsFunctionName>(
	name: N,
	args: AnalyticsArgs<N>,
): HandlerArgs<N> {
	const parsed = analyticsFunctions[name].args.safeParse(args);
	if (!parsed.success) {
		throw new AnalyticsCallError(
			name,
			INVALID_ARGUMENTS_CODE,
			parsed.error.issues
				.slice(0, 3)
				.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
				.join("; "),
		);
	}
	return parsed.data as HandlerArgs<N>;
}

function validateRows<N extends AnalyticsFunctionName>(
	name: N,
	rows: AnalyticsRow<N>[],
): AnalyticsRow<N>[] {
	const parsed = z
		.array(analyticsFunctions[name].row as z.ZodType)
		.safeParse(rows);
	if (!parsed.success) {
		throw new AnalyticsCallError(
			name,
			INVALID_ROWS_CODE,
			parsed.error.issues
				.slice(0, 3)
				.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
				.join("; "),
		);
	}
	return parsed.data as AnalyticsRow<N>[];
}

export function createDemoAnalyticsSource(
	options: DemoAnalyticsSourceOptions,
): DemoAnalyticsSource {
	const days =
		options.days ??
		new DemoDayCache({
			now: options.now,
			...(options.volumeScale === undefined
				? {}
				: { volumeScale: options.volumeScale }),
		});
	if (
		options.days !== undefined &&
		options.volumeScale !== undefined &&
		options.days.volumeScale !== options.volumeScale
	) {
		throw new RangeError(
			"the demo day cache and the analytics source disagree on the volume scale",
		);
	}
	const aggregates = new AggregateStore(days);
	const holidays = options.holidays ?? VIETNAM_HOLIDAYS;
	return {
		kind: "demo",
		aggregates,
		async call<N extends AnalyticsFunctionName>(
			name: N,
			args: AnalyticsArgs<N>,
		): Promise<AnalyticsRow<N>[]> {
			const parsed = parseArgs(name, args);
			const read = reads[name] as (
				args: HandlerArgs<N>,
				store: AggregateStore,
			) => readonly StoreDayRange[];
			await aggregates.ensureAll(read(parsed, aggregates));
			const context: HandlerContext = { now: options.now(), holidays };
			const handler = handlers[name] as Handler<N>;
			const rows = handler(aggregates, parsed, context);
			return options.validateRows === true ? validateRows(name, rows) : rows;
		},
	};
}
