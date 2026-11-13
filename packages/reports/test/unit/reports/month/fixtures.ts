import {
	type AnalyticsRow,
	type CallResults,
	type CardInput,
	COMPARE_LIKE_FOR_LIKE_KEYS,
	coverageModel,
	type IsoDate,
	METRICS_LIKE_FOR_LIKE_KEYS,
	type ReportContext,
	resultsOf,
} from "../../../../src/index.js";
import {
	coveredPaceKey,
	monthCalls,
	storePaceKey,
} from "../../../../src/reports/month/index.js";
import {
	context,
	coverageRow,
	STORE_A,
	STORE_B,
	totalsRow,
} from "../../fixtures.js";

export { STORE_A, STORE_B };

export const AS_OF = "2026-11-03";
export const MONTH_START = "2026-11-01";
export const PREVIOUS_START = "2026-10-01";
export const PREVIOUS_END = "2026-10-03";
export const LAST_YEAR_START = "2025-11-01";
export const LAST_YEAR_END = "2025-11-03";

export type TotalsValues = Partial<AnalyticsRow<"period_compare_by_store">>;

export interface MonthBlock {
	readonly current?: TotalsValues;
	readonly previous?: TotalsValues;
	readonly last_year?: TotalsValues;
}

export function monthBlock(
	storeId: string | null,
	values: MonthBlock = {},
	ranges: {
		readonly current: readonly [IsoDate, IsoDate];
		readonly previous: readonly [IsoDate, IsoDate];
		readonly lastYear: readonly [IsoDate, IsoDate];
	} = {
		current: [MONTH_START, AS_OF],
		previous: [PREVIOUS_START, PREVIOUS_END],
		lastYear: [LAST_YEAR_START, LAST_YEAR_END],
	},
): AnalyticsRow<"period_compare_by_store">[] {
	return [
		totalsRow(
			storeId,
			"current",
			ranges.current[0],
			ranges.current[1],
			values.current,
		),
		totalsRow(
			storeId,
			"previous",
			ranges.previous[0],
			ranges.previous[1],
			values.previous ?? {
				net_amount: 4_000_000,
				invoices: 90,
				items_sold: 120,
				discount_amount: 150_000,
			},
		),
		totalsRow(
			storeId,
			"last_year",
			ranges.lastYear[0],
			ranges.lastYear[1],
			values.last_year ?? {
				net_amount: 4_400_000,
				invoices: 95,
				items_sold: 140,
			},
		),
	];
}

export function paceRow(
	values: Partial<AnalyticsRow<"month_pace">> = {},
): AnalyticsRow<"month_pace"> {
	return {
		period_start: MONTH_START,
		as_of_date: AS_OF,
		elapsed_days: 3,
		remaining_days: 27,
		month_to_date_net_amount: 5_000_000,
		month_to_date_invoices: 100,
		forecast_weekday_profile_net_amount: 50_000_000,
		forecast_seasonal_naive_net_amount: 52_000_000,
		target_net_amount: null,
		...values,
	};
}

export function accuracyRows(
	weekdayProfileMae: number | null,
	seasonalNaiveMae: number | null,
	sampleDays = 28,
): AnalyticsRow<"forecast_accuracy">[] {
	return [
		{
			forecast_id: "forecast_seasonal_naive",
			sample_days: sampleDays,
			mae: seasonalNaiveMae,
			mape: seasonalNaiveMae === null ? null : 0.06,
		},
		{
			forecast_id: "forecast_weekday_profile",
			sample_days: sampleDays,
			mae: weekdayProfileMae,
			mape: weekdayProfileMae === null ? null : 0.05,
		},
	];
}

export function seriesRow(
	storeId: string | null,
	bucketStart: IsoDate,
	bucketEnd: IsoDate,
	values: Partial<AnalyticsRow<"period_series">> = {},
): AnalyticsRow<"period_series"> {
	const { store_id: _storeId, ...totals } = totalsRow(
		storeId,
		"current",
		bucketStart,
		bucketEnd,
	);
	const { period: _period, from_date: _from, to_date: _to, ...rest } = totals;
	return {
		store_id: storeId,
		bucket_start: bucketStart,
		bucket_end: bucketEnd,
		iso_year: null,
		iso_week: null,
		weekday: null,
		calendar_days: 1,
		excluded_days: 0,
		tet_days: 0,
		holiday_kind: null,
		checked_days: 1,
		matched_days: 1,
		...rest,
		...values,
	};
}

export const EMPTY_SERIES: Partial<AnalyticsRow<"period_series">> = {
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

export function dayRow(
	date: IsoDate,
	net: number | null,
	values: Partial<AnalyticsRow<"period_series">> = {},
): AnalyticsRow<"period_series"> {
	return seriesRow(null, date, date, {
		...(net === null ? EMPTY_SERIES : { net_amount: net }),
		...values,
	});
}

export function baselineRow(
	date: IsoDate,
	baseline: number | null,
	sampleDays = 8,
): AnalyticsRow<"daily_baselines"> {
	return {
		business_date: date,
		weekday: 1,
		sample_days: sampleDays,
		baseline_net_amount: baseline,
		baseline_invoices: baseline === null ? null : baseline / 50_000,
		baseline_avg_ticket: baseline === null ? null : 50_000,
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
		item_type_name: "Drinks",
		role: "drink",
		quantity: 10,
		net_amount: 500_000,
		invoices: 10,
		days_sold: 3,
		net_share: 0.1,
		compare_quantity: 8,
		compare_net_amount: 400_000,
		compare_net_share: 0.09,
		first_sold_on: "2025-01-01",
		last_sold_on: AS_OF,
		...values,
	};
}

export function metricRows(
	metricId: string,
	current: number | null,
	previous: number | null,
	lastYear: number | null,
): AnalyticsRow<"metric_compare">[] {
	return [
		{
			metric_id: metricId,
			period: "current",
			from_date: MONTH_START,
			to_date: AS_OF,
			value: current,
		},
		{
			metric_id: metricId,
			period: "previous",
			from_date: PREVIOUS_START,
			to_date: PREVIOUS_END,
			value: previous,
		},
		{
			metric_id: metricId,
			period: "last_year",
			from_date: LAST_YEAR_START,
			to_date: LAST_YEAR_END,
			value: lastYear,
		},
	];
}

export function paymentRow(
	kind: AnalyticsRow<"payment_summary">["kind"],
	name: string,
	amount: number,
	compareAmount: number,
	values: Partial<AnalyticsRow<"payment_summary">> = {},
): AnalyticsRow<"payment_summary"> {
	return {
		method_key: `${kind}|${name}`,
		kind,
		payment_method_name: name,
		invoices: 10,
		amount,
		share: null,
		fee_amount: 0,
		fee_estimate_amount: 0,
		compare_amount: compareAmount,
		compare_share: null,
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
		first_used_on: MONTH_START,
		last_used_on: AS_OF,
		days_used: 3,
	};
}

export function shiftRow(
	id: string,
	values: Partial<AnalyticsRow<"shift_review">> = {},
): AnalyticsRow<"shift_review"> {
	return {
		store_id: STORE_A,
		shift_id: id,
		shift_external_id: id,
		shift_name: "Ca sáng",
		business_date: MONTH_START,
		cashier_name: "Lan",
		opened_at: "2026-11-01T00:00:00.000Z",
		closed_at: "2026-11-01T07:00:00.000Z",
		orders: 20,
		sales_amount: 2_000_000,
		cash_sales_amount: 700_000,
		opening_float_amount: 1_500_000,
		expected_cash_amount: 2_200_000,
		drawer_amount: 2_200_000,
		variance_amount: 0,
		trailing_shifts: 30,
		z_score: 0.1,
		over_abs_threshold: false,
		over_rel_threshold: false,
		over_z_threshold: false,
		flagged: false,
		reasons: [],
		...values,
	};
}

export interface MonthScene {
	readonly date?: IsoDate;
	readonly asOf?: IsoDate;
	readonly stores?: readonly string[];
	readonly coverage?: readonly AnalyticsRow<"store_coverage">[];
	readonly compare?: readonly AnalyticsRow<"period_compare_by_store">[];
	readonly compareLfl?: Partial<
		Record<"previous" | "last_year", readonly AnalyticsRow<"period_compare">[]>
	>;
	readonly pace?: readonly AnalyticsRow<"month_pace">[];
	readonly storePace?: Readonly<Record<string, AnalyticsRow<"month_pace">>>;
	readonly accuracy?: readonly AnalyticsRow<"forecast_accuracy">[];
	readonly days?: readonly AnalyticsRow<"period_series">[];
	readonly months?: readonly AnalyticsRow<"period_series">[];
	readonly baselines?: readonly AnalyticsRow<"daily_baselines">[];
	readonly items?: readonly AnalyticsRow<"item_summary">[];
	readonly itemsCovered?: readonly AnalyticsRow<"item_summary">[];
	readonly metrics?: readonly AnalyticsRow<"metric_compare">[];
	readonly metricsLfl?: Partial<
		Record<"previous" | "last_year", readonly AnalyticsRow<"metric_compare">[]>
	>;
	readonly payments?: readonly AnalyticsRow<"payment_summary">[];
	readonly promotions?: readonly AnalyticsRow<"promotion_summary">[];
	readonly shifts?: readonly AnalyticsRow<"shift_review">[];
	readonly shiftsPrevious?: readonly AnalyticsRow<"shift_review">[];
	readonly targets?: readonly AnalyticsRow<"store_targets">[];
	readonly sample?: boolean;
}

export function monthContext(scene: MonthScene = {}): ReportContext {
	return context(
		"month",
		scene.date ?? AS_OF,
		scene.stores ?? [STORE_A, STORE_B],
		{ sample: scene.sample ?? false, asOf: scene.asOf ?? AS_OF },
	);
}

export function monthInput(scene: MonthScene = {}): CardInput {
	const reportContext = monthContext(scene);
	const storeIds = reportContext.stores.map((store) => store.id);
	const coverageRows = scene.coverage ?? storeIds.map((id) => coverageRow(id));
	const entries = new Map<string, readonly unknown[]>([
		[monthCalls.coverage, coverageRows],
		[
			monthCalls.compare,
			scene.compare ?? [
				...monthBlock(null),
				...storeIds.flatMap((id) => monthBlock(id)),
			],
		],
		[monthCalls.pace, scene.pace ?? [paceRow()]],
		[monthCalls.accuracy, scene.accuracy ?? accuracyRows(900_000, 800_000)],
		[monthCalls.days, scene.days ?? []],
		[monthCalls.months, scene.months ?? []],
		[monthCalls.baselines, scene.baselines ?? []],
		[monthCalls.items, scene.items ?? []],
		[monthCalls.itemsCovered, scene.itemsCovered ?? []],
		[monthCalls.metrics, scene.metrics ?? []],
		[monthCalls.payments, scene.payments ?? []],
		[monthCalls.promotions, scene.promotions ?? []],
		[monthCalls.shifts, scene.shifts ?? []],
		[monthCalls.shiftsPrevious, scene.shiftsPrevious ?? []],
		[monthCalls.targets, scene.targets ?? []],
		[COMPARE_LIKE_FOR_LIKE_KEYS.previous, scene.compareLfl?.previous ?? []],
		[COMPARE_LIKE_FOR_LIKE_KEYS.last_year, scene.compareLfl?.last_year ?? []],
		[METRICS_LIKE_FOR_LIKE_KEYS.previous, scene.metricsLfl?.previous ?? []],
		[METRICS_LIKE_FOR_LIKE_KEYS.last_year, scene.metricsLfl?.last_year ?? []],
		...Object.entries(scene.storePace ?? {}).flatMap(([storeId, row]) => [
			[storePaceKey(storeId), [row]] as const,
			[coveredPaceKey(storeId), [row]] as const,
		]),
	]);
	const results: CallResults = resultsOf(entries);
	return {
		context: reportContext,
		coverage: coverageModel(coverageRows, reportContext),
		results,
	};
}

export function youngAtPreviousMonth(
	youngStart: IsoDate = "2026-10-15",
): AnalyticsRow<"store_coverage">[] {
	return [
		coverageRow(STORE_A, { history_start: "2024-12-02" }),
		coverageRow(STORE_B, { history_start: youngStart }),
	];
}
