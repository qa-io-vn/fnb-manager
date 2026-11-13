import type { AnalyticsRow, RpcClient } from "@fnb/reports";
import type { DueDigest } from "../../src/index.js";

export const TENANT = "33333333-3333-4333-8333-333333333333";
export const STORE_A = "11111111-1111-4111-8111-111111111111";
export const STORE_B = "22222222-2222-4222-8222-222222222222";
export const OWNER = "44444444-4444-4444-8444-444444444444";
export const DAY = "2026-11-07";
export const CASHIER_ADDRESS = "cashier@example.com";
export const ZONE = "Asia/Ho_Chi_Minh";

type Period = "current" | "previous" | "last_year" | "baseline";
type TotalsRow = AnalyticsRow<"period_compare_by_store">;

export interface StoreScenario {
	readonly id: string;
	readonly name: string;
	readonly current: Partial<TotalsRow>;
	readonly previous?: Partial<TotalsRow>;
	readonly baseline?: Partial<TotalsRow>;
	readonly lastYear?: Partial<TotalsRow>;
	readonly coverage?: Partial<AnalyticsRow<"store_coverage">>;
	readonly shifts?: readonly Partial<AnalyticsRow<"shift_review">>[];
	readonly holidayKind?: "public" | "tet" | "custom" | null;
}

export interface NgayScenario {
	readonly stores: readonly StoreScenario[];
	readonly items?: readonly { name: string; quantity: number; net: number }[];
	readonly hours?: readonly { hour: number; net: number; invoices: number }[];
	readonly cash?: number;
}

const DATE_OF: Readonly<Record<Period, { from: string; to: string }>> = {
	current: { from: DAY, to: DAY },
	previous: { from: "2026-11-06", to: "2026-11-06" },
	last_year: { from: "2025-11-08", to: "2025-11-08" },
	baseline: { from: "2026-09-12", to: "2026-10-31" },
};

export function totalsRow(
	storeId: string | null,
	period: Period,
	values: Partial<TotalsRow> = {},
): TotalsRow {
	const dates = DATE_OF[period];
	return {
		store_id: storeId,
		period,
		from_date: dates.from,
		to_date: dates.to,
		days_with_data: 1,
		invoices: 100,
		net_amount: 5_000_000,
		gross_amount: 5_200_000,
		item_discount_amount: 100_000,
		bill_discount_amount: 50_000,
		voucher_amount: 50_000,
		discount_amount: 200_000,
		paid_amount: 5_000_000,
		cash_amount: 1_000_000,
		items_sold: 150,
		voucher_invoices: 10,
		member_invoices: 0,
		identified_invoices: 0,
		voided_invoices: 1,
		voided_amount: 40_000,
		edited_invoices: 1,
		avg_ticket: 50_000,
		items_per_ticket: 1.5,
		avg_item_price: 33_333.33,
		cash_share: 0.2,
		voucher_share: 0.1,
		member_share: 0,
		identified_share: 0,
		discount_rate: 0.038462,
		...values,
	};
}

export function coverageRow(
	storeId: string,
	overrides: Partial<AnalyticsRow<"store_coverage">> = {},
): AnalyticsRow<"store_coverage"> {
	return {
		store_id: storeId,
		opened_on: null,
		first_sales_on: "2025-01-01",
		last_sales_on: DAY,
		history_start: "2025-01-01",
		store_as_of_date: DAY,
		sales_days: 1,
		checked_days: 1,
		matched_days: 1,
		unmatched_days: 0,
		unchecked_sales_days: 0,
		stale_days: 0,
		last_refreshed_at: null,
		...overrides,
	};
}

export function shiftRow(
	storeId: string,
	overrides: Partial<AnalyticsRow<"shift_review">> = {},
): AnalyticsRow<"shift_review"> {
	return {
		store_id: storeId,
		shift_id: "55555555-5555-4555-8555-555555555555",
		shift_external_id: "shift-1",
		shift_name: "Ca 1",
		business_date: DAY,
		cashier_name: "Synthetic cashier",
		opened_at: "2026-11-07T00:00:00+00:00",
		closed_at: "2026-11-07T08:00:00+00:00",
		orders: 40,
		sales_amount: 2_000_000,
		cash_sales_amount: 800_000,
		opening_float_amount: 500_000,
		expected_cash_amount: 1_300_000,
		drawer_amount: 1_300_000,
		variance_amount: 0,
		trailing_shifts: 20,
		z_score: 0,
		over_abs_threshold: false,
		over_rel_threshold: false,
		over_z_threshold: false,
		flagged: false,
		reasons: [],
		...overrides,
	};
}

function sumRows(rows: readonly TotalsRow[], period: Period): TotalsRow {
	const present = rows.filter((row) => row.period === period);
	const sum = (pick: (row: TotalsRow) => number | null) =>
		present.reduce((total, row) => total + (pick(row) ?? 0), 0);
	const invoices = sum((row) => row.invoices);
	const net = sum((row) => row.net_amount);
	return totalsRow(null, period, {
		days_with_data: Math.max(0, ...present.map((row) => row.days_with_data)),
		invoices,
		net_amount: net,
		cash_amount: sum((row) => row.cash_amount),
		items_sold: sum((row) => row.items_sold),
		avg_ticket: invoices === 0 ? null : net / invoices,
	});
}

function storeTotals(scenario: NgayScenario): TotalsRow[] {
	const rows = scenario.stores.flatMap((store) => [
		totalsRow(store.id, "current", store.current),
		totalsRow(store.id, "previous", store.previous ?? {}),
		totalsRow(store.id, "baseline", {
			days_with_data: 8,
			...(store.baseline ?? {}),
		}),
		totalsRow(store.id, "last_year", store.lastYear ?? {}),
	]);
	const periods: Period[] = ["current", "previous", "baseline", "last_year"];
	return [...periods.map((period) => sumRows(rows, period)), ...rows];
}

function likeForLikeRows(scenario: NgayScenario): TotalsRow[] {
	const rows = storeTotals(scenario).filter((row) => row.store_id !== null);
	const periods: Period[] = ["current", "previous", "baseline", "last_year"];
	return periods.map((period) => sumRows(rows, period));
}

function itemRows(scenario: NgayScenario): AnalyticsRow<"item_summary">[] {
	return (scenario.items ?? []).map((item, index) => ({
		item_external_id: `item-${index + 1}`,
		item_name: item.name,
		base_name: null,
		size_label: null,
		item_type_external_id: null,
		item_type_name: null,
		role: "drink",
		quantity: item.quantity,
		net_amount: item.net,
		invoices: item.quantity,
		days_sold: 1,
		net_share: 0.1,
		compare_quantity: item.quantity,
		compare_net_amount: item.net,
		compare_net_share: 0.1,
		first_sold_on: "2025-01-01",
		last_sold_on: DAY,
	}));
}

function hourRows(scenario: NgayScenario): AnalyticsRow<"hourly_profile">[] {
	return (scenario.hours ?? []).map((hour) => ({
		hour_local: hour.hour,
		current_invoices: hour.invoices,
		current_net_amount: hour.net,
		current_items_sold: hour.invoices,
		sample_days: 8,
		baseline_invoices: hour.invoices,
		baseline_net_amount: hour.net,
	}));
}

function paymentRows(
	scenario: NgayScenario,
): AnalyticsRow<"payment_summary">[] {
	const cash = scenario.cash ?? 1_500_000;
	return [
		{
			method_key: "cash",
			kind: "cash",
			payment_method_name: "Tiền mặt",
			invoices: 30,
			amount: cash,
			share: 0.3,
			fee_amount: 0,
			fee_estimate_amount: 0,
			compare_amount: cash,
			compare_share: 0.3,
		},
		{
			method_key: "transfer",
			kind: "bank_transfer",
			payment_method_name: "Chuyển khoản",
			invoices: 70,
			amount: 3_500_000,
			share: 0.7,
			fee_amount: 0,
			fee_estimate_amount: 0,
			compare_amount: 3_500_000,
			compare_share: 0.7,
		},
	];
}

function seriesRows(scenario: NgayScenario): AnalyticsRow<"period_series">[] {
	const row = (
		storeId: string | null,
		holiday: "public" | "tet" | "custom" | null,
	): AnalyticsRow<"period_series"> => ({
		...totalsRow(storeId, "current"),
		store_id: storeId,
		bucket_start: DAY,
		bucket_end: DAY,
		iso_year: 2026,
		iso_week: 45,
		weekday: 6,
		calendar_days: 1,
		excluded_days: holiday === null ? 0 : 1,
		tet_days: holiday === "tet" ? 1 : 0,
		holiday_kind: holiday,
		checked_days: 1,
		matched_days: 1,
	});
	const holiday =
		scenario.stores.find((store) => store.holidayKind)?.holidayKind ?? null;
	return [
		row(null, holiday),
		...scenario.stores.map((store) => row(store.id, store.holidayKind ?? null)),
	];
}

function selected(args: Readonly<Record<string, unknown>>): Set<string> {
	const ids = args.store_ids;
	return new Set(Array.isArray(ids) ? ids.map(String) : []);
}

export interface FakeClient extends RpcClient {
	readonly calls: { fn: string; args: Record<string, unknown> }[];
}

export function ngayClient(scenario: NgayScenario): FakeClient {
	const calls: { fn: string; args: Record<string, unknown> }[] = [];
	return {
		calls,
		async rpc(fn, args) {
			calls.push({ fn, args });
			const scope = selected(args);
			const stores = scenario.stores.filter((store) => scope.has(store.id));
			const view: NgayScenario = { ...scenario, stores };
			const json = (rows: unknown[]) =>
				JSON.parse(JSON.stringify(rows)) as unknown[];
			switch (fn) {
				case "store_coverage":
					return {
						data: json(
							stores.map((store) => coverageRow(store.id, store.coverage)),
						),
						error: null,
					};
				case "period_compare_by_store":
					return { data: json(storeTotals(view)), error: null };
				case "period_compare":
					return { data: json(likeForLikeRows(view)), error: null };
				case "hourly_profile":
					return { data: json(hourRows(view)), error: null };
				case "metric_compare":
					return { data: [], error: null };
				case "item_summary":
					return { data: json(itemRows(view)), error: null };
				case "payment_summary":
					return { data: json(paymentRows(view)), error: null };
				case "shift_review":
					return {
						data: json(
							stores.flatMap((store) =>
								(store.shifts ?? []).map((shift) => shiftRow(store.id, shift)),
							),
						),
						error: null,
					};
				case "promotion_summary":
					return { data: [], error: null };
				case "period_series":
					return { data: json(seriesRows(view)), error: null };
				default:
					return { data: [], error: null };
			}
		},
	};
}

export const TWO_STORES: NgayScenario = {
	stores: [
		{
			id: STORE_A,
			name: "Cửa hàng A",
			current: { net_amount: 7_100_000, invoices: 180, avg_ticket: 39_444.44 },
			baseline: { net_amount: 7_244_898, invoices: 180, avg_ticket: 40_000 },
		},
		{
			id: STORE_B,
			name: "Cửa hàng B",
			current: { net_amount: 5_245_000, invoices: 132, avg_ticket: 39_734.85 },
			baseline: { net_amount: 5_646_000, invoices: 130, avg_ticket: 43_000 },
		},
	],
	items: [
		{ name: "Trà sữa", quantity: 85, net: 3_000_000 },
		{ name: "Cà phê", quantity: 60, net: 1_800_000 },
		{ name: "Bánh", quantity: 41, net: 900_000 },
		{ name: "Nước", quantity: 10, net: 100_000 },
	],
	hours: [
		{ hour: 18, net: 900_000, invoices: 20 },
		{ hour: 19, net: 1_234_000, invoices: 30 },
		{ hour: 20, net: 700_000, invoices: 15 },
	],
	cash: 4_560_000,
};

export function dueFor(
	storeIds: readonly string[],
	overrides: Partial<DueDigest> = {},
): DueDigest {
	return {
		tenantId: TENANT,
		businessDate: DAY,
		scopeKey: "0".repeat(32),
		storeIds: [...storeIds],
		allStores: storeIds.length > 1,
		trigger: "settled",
		runAs: OWNER,
		channelIds: [],
		storeFacts: storeIds.map((storeId) => ({
			storeId,
			openingMinutes: null,
			closeAt: "2026-11-07T17:00:00.000Z",
			lastShiftClosedAt: null,
			openShifts: 0,
			settledAt: "2026-11-07T20:30:00.000Z",
			dayEnded: true,
		})),
		...overrides,
	};
}

export function storesOf(scenario: NgayScenario, ids: readonly string[]) {
	return scenario.stores
		.filter((store) => ids.includes(store.id))
		.map((store) => ({
			id: store.id,
			name: store.name,
			timeZone: ZONE,
			businessDayStartMinutes: 0,
		}))
		.sort((left, right) => left.name.localeCompare(right.name));
}
