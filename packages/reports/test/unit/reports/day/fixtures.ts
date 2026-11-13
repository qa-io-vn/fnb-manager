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
import { dayCalls } from "../../../../src/reports/day/index.js";
import {
	context,
	coverageRow,
	STORE_A,
	STORE_B,
	totalsRow,
} from "../../fixtures.js";

export { STORE_A, STORE_B };

export const DAY = "2026-11-03";
export const PREVIOUS_DAY = "2026-11-02";
export const LAST_YEAR_DAY = "2025-11-04";
export const BASELINE_FROM = "2026-09-08";
export const BASELINE_TO = "2026-10-27";

export type TotalsValues = Partial<AnalyticsRow<"period_compare_by_store">>;

export interface BlockValues {
	readonly current?: TotalsValues;
	readonly previous?: TotalsValues;
	readonly last_year?: TotalsValues;
	readonly baseline?: TotalsValues;
}

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

export const BASELINE_ONLY: TotalsValues = {
	...EMPTY_TOTALS,
	days_with_data: 8,
	invoices: 95,
	net_amount: 4_800_000,
	avg_ticket: 50_500,
};

export function block(
	storeId: string | null,
	values: BlockValues = {},
): AnalyticsRow<"period_compare_by_store">[] {
	return [
		totalsRow(storeId, "current", DAY, DAY, values.current),
		totalsRow(
			storeId,
			"previous",
			PREVIOUS_DAY,
			PREVIOUS_DAY,
			values.previous ?? {
				net_amount: 4_000_000,
				invoices: 90,
				items_sold: 120,
			},
		),
		totalsRow(
			storeId,
			"last_year",
			LAST_YEAR_DAY,
			LAST_YEAR_DAY,
			values.last_year ?? {
				net_amount: 4_400_000,
				invoices: 95,
				items_sold: 140,
			},
		),
		totalsRow(
			storeId,
			"baseline",
			BASELINE_FROM,
			BASELINE_TO,
			values.baseline ?? BASELINE_ONLY,
		),
	];
}

export function hourRow(
	hour: number,
	current: number | null,
	baseline: number | null,
	sampleDays = 8,
): AnalyticsRow<"hourly_profile"> {
	return {
		hour_local: hour,
		current_invoices: current === null ? null : Math.round(current / 50_000),
		current_net_amount: current,
		current_items_sold: current === null ? null : Math.round(current / 30_000),
		sample_days: sampleDays,
		baseline_invoices: baseline === null ? null : baseline / 50_000,
		baseline_net_amount: baseline,
	};
}

export function hourProfile(
	values: Readonly<Record<number, readonly [number | null, number | null]>>,
	sampleDays = 8,
): AnalyticsRow<"hourly_profile">[] {
	return Array.from({ length: 24 }, (_, hour) => {
		const entry = values[hour] ?? [0, sampleDays > 0 ? 0 : null];
		return hourRow(hour, entry[0], entry[1], sampleDays);
	});
}

export function metricRow(
	metricId: string,
	period: "current" | "previous" | "last_year",
	value: number | null,
): AnalyticsRow<"metric_compare"> {
	const range = {
		current: DAY,
		previous: PREVIOUS_DAY,
		last_year: LAST_YEAR_DAY,
	}[period];
	return {
		metric_id: metricId,
		period,
		from_date: range,
		to_date: range,
		value,
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
		days_sold: 1,
		net_share: 0.1,
		compare_quantity: 8,
		compare_net_amount: 400_000,
		compare_net_share: 0.09,
		first_sold_on: "2025-01-01",
		last_sold_on: DAY,
		...values,
	};
}

export function paymentRow(
	kind: AnalyticsRow<"payment_summary">["kind"],
	name: string,
	amount: number,
	compareAmount: number,
	share: number | null = null,
): AnalyticsRow<"payment_summary"> {
	return {
		method_key: `${kind}|${name}`,
		kind,
		payment_method_name: name,
		invoices: 10,
		amount,
		share,
		fee_amount: 0,
		fee_estimate_amount: 0,
		compare_amount: compareAmount,
		compare_share: null,
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
		shift_name: `Shift ${id}`,
		business_date: DAY,
		cashier_name: "Cashier",
		opened_at: "2026-11-02T23:30:00.000Z",
		closed_at: "2026-11-03T05:00:00.000Z",
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
		first_used_on: DAY,
		last_used_on: DAY,
		days_used: 1,
	};
}

export interface DayScene {
	readonly stores?: readonly string[];
	readonly coverage?: readonly AnalyticsRow<"store_coverage">[];
	readonly compare?: readonly AnalyticsRow<"period_compare_by_store">[];
	readonly compareLfl?: Partial<
		Record<"previous" | "last_year", readonly AnalyticsRow<"period_compare">[]>
	>;
	readonly hourly?: readonly AnalyticsRow<"hourly_profile">[];
	readonly metrics?: readonly AnalyticsRow<"metric_compare">[];
	readonly metricsLfl?: Partial<
		Record<"previous" | "last_year", readonly AnalyticsRow<"metric_compare">[]>
	>;
	readonly items?: readonly AnalyticsRow<"item_summary">[];
	readonly payments?: readonly AnalyticsRow<"payment_summary">[];
	readonly shifts?: readonly AnalyticsRow<"shift_review">[];
	readonly promotions?: readonly AnalyticsRow<"promotion_summary">[];
	readonly startMinutes?: number;
	readonly sample?: boolean;
}

export function dayContext(scene: DayScene = {}): ReportContext {
	const base = context("day", DAY, scene.stores ?? [STORE_A, STORE_B], {
		sample: scene.sample ?? false,
	});
	return {
		...base,
		stores: base.stores.map((store) => ({
			...store,
			businessDayStartMinutes: scene.startMinutes ?? 0,
		})),
	};
}

export function dayInput(scene: DayScene = {}): CardInput {
	const reportContext = dayContext(scene);
	const storeIds = reportContext.stores.map((store) => store.id);
	const coverageRows = scene.coverage ?? storeIds.map((id) => coverageRow(id));
	const entries = new Map<string, readonly unknown[]>([
		[dayCalls.coverage, coverageRows],
		[
			dayCalls.compare,
			scene.compare ?? [...block(null), ...storeIds.flatMap((id) => block(id))],
		],
		[dayCalls.hourly, scene.hourly ?? []],
		[dayCalls.metrics, scene.metrics ?? []],
		[dayCalls.items, scene.items ?? []],
		[dayCalls.payments, scene.payments ?? []],
		[dayCalls.shifts, scene.shifts ?? []],
		[dayCalls.promotions, scene.promotions ?? []],
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

export function youngCoverage(
	youngStoreStart: IsoDate = "2026-08-31",
): AnalyticsRow<"store_coverage">[] {
	return [
		coverageRow(STORE_A, { history_start: "2024-12-02" }),
		coverageRow(STORE_B, { history_start: youngStoreStart }),
	];
}

export function seeded(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
		mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed);
		return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
	};
}
