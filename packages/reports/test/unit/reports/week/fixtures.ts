import {
	type AnalyticsRow,
	addDays,
	type CallResults,
	type CardInput,
	COMPARE_LIKE_FOR_LIKE_KEYS,
	coverageModel,
	datesBetween,
	type HolidayKind,
	type IsoDate,
	isoWeekday,
	isoWeekOf,
	METRICS_LIKE_FOR_LIKE_KEYS,
	periodBounds,
	type ReportContext,
	resultsOf,
} from "../../../../src/index.js";
import { weekCalls } from "../../../../src/reports/week/index.js";
import {
	context,
	coverageRow,
	STORE_A,
	STORE_B,
	totalsRow,
} from "../../fixtures.js";

export { STORE_A, STORE_B };

export const AS_OF = "2026-11-03";
export const COMPLETE_WEEK_DAY = "2026-10-28";
export const RUNNING_WEEK_DAY = "2026-11-02";

export type TotalsValues = Partial<AnalyticsRow<"period_compare_by_store">>;

export const EMPTY_TOTALS: TotalsValues = {
	days_with_data: 0,
	invoices: null,
	net_amount: null,
	gross_amount: null,
	item_discount_amount: null,
	bill_discount_amount: null,
	voucher_amount: null,
	discount_amount: null,
	paid_amount: null,
	cash_amount: null,
	items_sold: null,
	voucher_invoices: null,
	member_invoices: null,
	identified_invoices: null,
	voided_invoices: null,
	voided_amount: null,
	edited_invoices: null,
	avg_ticket: null,
	items_per_ticket: null,
	avg_item_price: null,
	cash_share: null,
	voucher_share: null,
	member_share: null,
	identified_share: null,
	discount_rate: null,
};

export interface DayValues {
	readonly net: number;
	readonly invoices: number;
	readonly items: number;
}

export type DayPlan = (storeId: string, date: IsoDate) => DayValues | null;

export const steadyDay: DayPlan = () => ({
	net: 1_000_000,
	invoices: 20,
	items: 30,
});

export interface WeekBlock {
	readonly current?: TotalsValues;
	readonly previous?: TotalsValues;
	readonly last_year?: TotalsValues;
}

export interface WeekScene {
	readonly date?: IsoDate;
	readonly asOf?: IsoDate;
	readonly stores?: readonly string[];
	readonly coverage?: readonly AnalyticsRow<"store_coverage">[];
	readonly compare?: readonly AnalyticsRow<"period_compare_by_store">[];
	readonly blocks?: Readonly<Record<string, WeekBlock>>;
	readonly compareLfl?: Partial<
		Record<"previous" | "last_year", readonly AnalyticsRow<"period_compare">[]>
	>;
	readonly plan?: DayPlan;
	readonly holidays?: Readonly<Record<IsoDate, HolidayKind>>;
	readonly days?: readonly AnalyticsRow<"period_series">[];
	readonly baselines?: readonly AnalyticsRow<"daily_baselines">[];
	readonly velocity?: readonly AnalyticsRow<"item_velocity">[];
	readonly velocityCovered?: readonly AnalyticsRow<"item_velocity">[];
	readonly items?: readonly AnalyticsRow<"item_summary">[];
	readonly promotions?: readonly AnalyticsRow<"promotion_summary">[];
	readonly promotionsPrevious?: readonly AnalyticsRow<"promotion_summary">[];
	readonly metrics?: readonly AnalyticsRow<"metric_compare">[];
	readonly metricsLfl?: Partial<
		Record<"previous" | "last_year", readonly AnalyticsRow<"metric_compare">[]>
	>;
}

export function weekContext(scene: WeekScene = {}): ReportContext {
	return context(
		"week",
		scene.date ?? COMPLETE_WEEK_DAY,
		scene.stores ?? [STORE_A, STORE_B],
		{ asOf: scene.asOf ?? AS_OF },
	);
}

export function boundsOf(
	reportContext: ReportContext,
): Record<
	"current" | "previous" | "last_year",
	{ from: IsoDate; to: IsoDate }
> {
	const result: Record<string, { from: IsoDate; to: IsoDate }> = {};
	for (const bound of periodBounds("week", reportContext.period.end)) {
		result[bound.period] = { from: bound.from, to: bound.to };
	}
	return result as Record<
		"current" | "previous" | "last_year",
		{ from: IsoDate; to: IsoDate }
	>;
}

const DEFAULT_BLOCK: Required<WeekBlock> = {
	current: {
		net_amount: 7_000_000,
		invoices: 140,
		items_sold: 210,
		avg_ticket: 50_000,
		items_per_ticket: 1.5,
		avg_item_price: 33_333.33,
		discount_amount: 300_000,
		item_discount_amount: 150_000,
		bill_discount_amount: 100_000,
		voucher_amount: 50_000,
	},
	previous: {
		net_amount: 6_000_000,
		invoices: 125,
		items_sold: 180,
		avg_ticket: 48_000,
		items_per_ticket: 1.44,
		avg_item_price: 33_333.33,
		discount_amount: 250_000,
		item_discount_amount: 120_000,
		bill_discount_amount: 80_000,
		voucher_amount: 50_000,
	},
	last_year: {
		net_amount: 5_500_000,
		invoices: 120,
		items_sold: 170,
		avg_ticket: 45_833.33,
		items_per_ticket: 1.4167,
		avg_item_price: 32_352.94,
	},
};

export function weekBlock(
	reportContext: ReportContext,
	storeId: string | null,
	values: WeekBlock = {},
): AnalyticsRow<"period_compare_by_store">[] {
	const bounds = boundsOf(reportContext);
	return (["current", "previous", "last_year"] as const).map((period) =>
		totalsRow(storeId, period, bounds[period].from, bounds[period].to, {
			...DEFAULT_BLOCK[period],
			...values[period],
		}),
	);
}

function seriesRow(
	storeId: string | null,
	date: IsoDate,
	values: DayValues | null,
	holiday: HolidayKind | null,
): AnalyticsRow<"period_series"> {
	const week = isoWeekOf(date);
	const totals = totalsRow(storeId, "current", date, date, {
		...(values === null
			? EMPTY_TOTALS
			: {
					days_with_data: 1,
					net_amount: values.net,
					invoices: values.invoices,
					items_sold: values.items,
				}),
	});
	const { period: _period, from_date: _from, to_date: _to, ...rest } = totals;
	return {
		...rest,
		store_id: storeId,
		bucket_start: date,
		bucket_end: date,
		iso_year: week.isoYear,
		iso_week: week.isoWeek,
		weekday: isoWeekday(date),
		calendar_days: 1,
		excluded_days: holiday === null ? 0 : 1,
		tet_days: holiday === "tet" ? 1 : 0,
		holiday_kind: holiday,
		checked_days: values === null ? 0 : 1,
		matched_days: values === null ? 0 : 1,
	};
}

export function dayRows(
	reportContext: ReportContext,
	plan: DayPlan = steadyDay,
	holidays: Readonly<Record<IsoDate, HolidayKind>> = {},
): AnalyticsRow<"period_series">[] {
	const storeIds = reportContext.stores.map((store) => store.id);
	const from = addDays(reportContext.period.from, -28);
	return datesBetween(from, reportContext.period.end).flatMap((date) => {
		const holiday = holidays[date] ?? null;
		const perStore = storeIds.map((id) => ({ id, values: plan(id, date) }));
		const present = perStore.filter((entry) => entry.values !== null);
		const all: DayValues | null =
			present.length === 0
				? null
				: present.reduce<DayValues>(
						(total, entry) => ({
							net: total.net + (entry.values?.net ?? 0),
							invoices: total.invoices + (entry.values?.invoices ?? 0),
							items: total.items + (entry.values?.items ?? 0),
						}),
						{ net: 0, invoices: 0, items: 0 },
					);
		return [
			seriesRow(null, date, all, holiday),
			...perStore.map((entry) =>
				seriesRow(entry.id, date, entry.values, holiday),
			),
		];
	});
}

export function baselineRow(
	date: IsoDate,
	sampleDays: number,
	net: number | null,
): AnalyticsRow<"daily_baselines"> {
	return {
		business_date: date,
		weekday: isoWeekday(date),
		sample_days: sampleDays,
		baseline_net_amount: net,
		baseline_invoices: net === null ? null : net / 50_000,
		baseline_avg_ticket: net === null ? null : 50_000,
	};
}

export function velocityRow(
	id: string,
	recent: number,
	prior: number,
	recentNet = recent * 40_000,
): AnalyticsRow<"item_velocity"> {
	return {
		item_external_id: id,
		item_name: `Item ${id}`,
		item_type_external_id: "TYPE-001",
		item_type_name: "Trà sữa",
		recent_quantity: recent,
		prior_quantity: prior,
		recent_net_amount: recentNet,
		prior_net_amount: prior * 40_000,
		quantity_change_pct:
			prior === 0
				? null
				: Math.round((100 * (recent - prior) * 1000) / prior) / 1000,
		net_change_pct: null,
	};
}

export function itemRow(
	id: string,
	values: Partial<AnalyticsRow<"item_summary">> = {},
): AnalyticsRow<"item_summary"> {
	return {
		item_external_id: id,
		item_name: `Item ${id}`,
		base_name: null,
		size_label: null,
		item_type_external_id: "TYPE-001",
		item_type_name: "Trà sữa",
		role: "drink",
		quantity: 10,
		net_amount: 500_000,
		invoices: 10,
		days_sold: 3,
		net_share: null,
		compare_quantity: 8,
		compare_net_amount: 400_000,
		compare_net_share: null,
		first_sold_on: "2025-01-01",
		last_sold_on: AS_OF,
		...values,
	};
}

export function promotionRow(
	kind: AnalyticsRow<"promotion_summary">["promotion_kind"],
	key: string,
	discount: number,
	name: string | null = key,
): AnalyticsRow<"promotion_summary"> {
	return {
		promotion_kind: kind,
		promotion_key: key,
		promotion_name: name,
		invoices: 3,
		lines: kind === "item" ? 4 : null,
		discount_amount: discount,
		first_used_on: COMPLETE_WEEK_DAY,
		last_used_on: COMPLETE_WEEK_DAY,
		days_used: 2,
	};
}

export function metricRows(
	reportContext: ReportContext,
	values: Readonly<
		Record<
			string,
			Partial<Record<"current" | "previous" | "last_year", number | null>>
		>
	>,
): AnalyticsRow<"metric_compare">[] {
	const bounds = boundsOf(reportContext);
	return Object.entries(values).flatMap(([metricId, periods]) =>
		(["current", "previous", "last_year"] as const).map((period) => ({
			metric_id: metricId,
			period,
			from_date: bounds[period].from,
			to_date: bounds[period].to,
			value: periods[period] ?? null,
		})),
	);
}

export function weekInput(scene: WeekScene = {}): CardInput {
	const reportContext = weekContext(scene);
	const storeIds = reportContext.stores.map((store) => store.id);
	const coverageRows =
		scene.coverage ??
		storeIds.map((id) => coverageRow(id, { history_start: "2025-01-01" }));
	const compare =
		scene.compare ??
		[null, ...storeIds].flatMap((id) =>
			weekBlock(reportContext, id, scene.blocks?.[id ?? "all"] ?? {}),
		);
	const entries = new Map<string, readonly unknown[]>([
		[weekCalls.coverage, coverageRows],
		[weekCalls.compare, compare],
		[
			weekCalls.days,
			scene.days ?? dayRows(reportContext, scene.plan, scene.holidays),
		],
		[weekCalls.baselines, scene.baselines ?? []],
		[weekCalls.velocity, scene.velocity ?? []],
		[weekCalls.velocityCovered, scene.velocityCovered ?? []],
		[weekCalls.items, scene.items ?? []],
		[weekCalls.promotions, scene.promotions ?? []],
		[weekCalls.promotionsPrevious, scene.promotionsPrevious ?? []],
		[weekCalls.metrics, scene.metrics ?? []],
		[COMPARE_LIKE_FOR_LIKE_KEYS.previous, scene.compareLfl?.previous ?? []],
		[COMPARE_LIKE_FOR_LIKE_KEYS.last_year, scene.compareLfl?.last_year ?? []],
		[METRICS_LIKE_FOR_LIKE_KEYS.previous, scene.metricsLfl?.previous ?? []],
		[METRICS_LIKE_FOR_LIKE_KEYS.last_year, scene.metricsLfl?.last_year ?? []],
	]);
	const results: CallResults = resultsOf(entries);
	return {
		context: reportContext,
		coverage: coverageModel(coverageRows, reportContext),
		results,
	};
}

export function youngStoreCoverage(
	youngStart: IsoDate,
): AnalyticsRow<"store_coverage">[] {
	return [
		coverageRow(STORE_A, { history_start: "2024-12-02" }),
		coverageRow(STORE_B, { history_start: youngStart }),
	];
}
