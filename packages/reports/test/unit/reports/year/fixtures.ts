import {
	type AnalyticsRow,
	addDays,
	type CallResults,
	type CardInput,
	COMPARE_LIKE_FOR_LIKE_KEYS,
	coverageModel,
	type IsoDate,
	isoWeekOf,
	lastOfMonth,
	minDate,
	mondayOf,
	type ReportContext,
	ratio,
	resultsOf,
} from "../../../../src/index.js";
import { sinceCallKey, yearCalls } from "../../../../src/reports/year/index.js";
import {
	context,
	coverageRow,
	STORE_A,
	STORE_B,
	totalsRow,
} from "../../fixtures.js";

export { STORE_A, STORE_B };

export const STORE_C = "44444444-4444-4444-8444-444444444444";
export const AS_OF = "2026-11-03";
export const YOUNG_START = "2026-08-31";

export type SeriesRow = AnalyticsRow<"period_series">;
export type LifecycleRow = AnalyticsRow<"item_lifecycle">;
export type TotalsRow = AnalyticsRow<"period_compare_by_store">;

export interface Figures {
	readonly net: number;
	readonly invoices: number;
	readonly items: number;
	readonly days?: number;
}

const EMPTY_TOTALS = {
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
} as const;

function totalsOfFigures(figures: Figures | null, calendarDays: number) {
	if (figures === null) return EMPTY_TOTALS;
	return {
		...EMPTY_TOTALS,
		days_with_data: figures.days ?? calendarDays,
		invoices: figures.invoices,
		net_amount: figures.net,
		gross_amount: figures.net,
		discount_amount: 0,
		paid_amount: figures.net,
		cash_amount: 0,
		items_sold: figures.items,
		voucher_invoices: 0,
		member_invoices: 0,
		identified_invoices: 0,
		voided_invoices: 0,
		voided_amount: 0,
		edited_invoices: 0,
		avg_ticket: ratio(figures.net, figures.invoices, 2),
		items_per_ticket: ratio(figures.items, figures.invoices, 4),
		avg_item_price: ratio(figures.net, figures.items, 2),
	};
}

function sumFigures(entries: readonly (Figures | null)[]): Figures | null {
	const present = entries.filter((entry): entry is Figures => entry !== null);
	if (present.length === 0) return null;
	const days = present.every((entry) => entry.days !== undefined)
		? present.reduce((total, entry) => total + (entry.days ?? 0), 0)
		: null;
	return {
		net: present.reduce((total, entry) => total + entry.net, 0),
		invoices: present.reduce((total, entry) => total + entry.invoices, 0),
		items: present.reduce((total, entry) => total + entry.items, 0),
		...(days === null ? {} : { days }),
	};
}

export interface BucketAttributes {
	readonly isoYear?: number | null;
	readonly isoWeek?: number | null;
	readonly weekday?: number | null;
	readonly tetDays?: number;
	readonly holidayKind?: SeriesRow["holiday_kind"];
}

export function seriesRow(
	storeId: string | null,
	bucketStart: IsoDate,
	bucketEnd: IsoDate,
	figures: Figures | null,
	attributes: BucketAttributes = {},
): SeriesRow {
	const calendarDays =
		Math.round(
			(Date.parse(`${bucketEnd}T00:00:00Z`) -
				Date.parse(`${bucketStart}T00:00:00Z`)) /
				86_400_000,
		) + 1;
	return {
		store_id: storeId,
		bucket_start: bucketStart,
		bucket_end: bucketEnd,
		iso_year: attributes.isoYear ?? null,
		iso_week: attributes.isoWeek ?? null,
		weekday: attributes.weekday ?? null,
		calendar_days: calendarDays,
		excluded_days: attributes.tetDays ?? 0,
		tet_days: attributes.tetDays ?? 0,
		holiday_kind: attributes.holidayKind ?? null,
		checked_days: 0,
		matched_days: 0,
		...totalsOfFigures(figures, calendarDays),
	};
}

export type StoreMonths = Readonly<Record<string, Figures>>;

export function monthRows(
	stores: Readonly<Record<string, StoreMonths>>,
	from: IsoDate,
	to: IsoDate,
	tetDays: Readonly<Record<string, number>> = {},
): SeriesRow[] {
	const rows: SeriesRow[] = [];
	for (let start = from; start <= to; start = addDays(lastOfMonth(start), 1)) {
		const end = minDate(lastOfMonth(start), to);
		const key = start.slice(0, 7);
		const attributes = { tetDays: tetDays[key] ?? 0 };
		const perStore = Object.entries(stores).map(
			([id, months]) => [id, months[key] ?? null] as const,
		);
		rows.push(
			seriesRow(
				null,
				start,
				end,
				sumFigures(perStore.map(([, figures]) => figures)),
				attributes,
			),
		);
		for (const [id, figures] of perStore) {
			rows.push(seriesRow(id, start, end, figures, attributes));
		}
	}
	return rows;
}

export function steadyMonths(
	from: IsoDate,
	to: IsoDate,
	net: (month: string) => number,
): Record<string, Figures> {
	const months: Record<string, Figures> = {};
	for (let start = from; start <= to; start = addDays(lastOfMonth(start), 1)) {
		const key = start.slice(0, 7);
		const value = net(key);
		months[key] = {
			net: value,
			invoices: Math.round(value / 50_000),
			items: Math.round(value / 25_000),
		};
	}
	return months;
}

export function weekRows(
	from: IsoDate,
	to: IsoDate,
	netOfDay: (date: IsoDate) => number | null,
	tetDates: ReadonlySet<IsoDate> = new Set(),
): SeriesRow[] {
	const rows: SeriesRow[] = [];
	let start = from;
	while (start <= to) {
		const end = minDate(addDays(mondayOf(start), 6), to);
		let net = 0;
		let days = 0;
		let tet = 0;
		for (let date = start; date <= end; date = addDays(date, 1)) {
			const value = netOfDay(date);
			if (value !== null) {
				net += value;
				days += 1;
			}
			if (tetDates.has(date)) tet += 1;
		}
		const week = isoWeekOf(start);
		rows.push(
			seriesRow(
				null,
				start,
				end,
				days === 0
					? null
					: {
							net,
							invoices: Math.round(net / 50_000),
							items: Math.round(net / 25_000),
							days,
						},
				{ isoYear: week.isoYear, isoWeek: week.isoWeek, tetDays: tet },
			),
		);
		start = addDays(end, 1);
	}
	return rows;
}

export function dayRows(
	storeId: string,
	from: IsoDate,
	to: IsoDate,
	netOfDay: (date: IsoDate) => number | null,
): SeriesRow[] {
	const rows: SeriesRow[] = [];
	for (let date = from; date <= to; date = addDays(date, 1)) {
		const net = netOfDay(date);
		const figures =
			net === null
				? null
				: {
						net,
						invoices: Math.round(net / 50_000),
						items: Math.round(net / 25_000),
						days: 1,
					};
		rows.push(seriesRow(null, date, date, figures));
		rows.push(seriesRow(storeId, date, date, figures));
	}
	return rows;
}

export function weekdayRows(nets: readonly (number | null)[]): SeriesRow[] {
	return nets.map((net, index) =>
		seriesRow(
			null,
			"2026-01-01",
			AS_OF,
			net === null
				? null
				: {
						net,
						invoices: Math.round(net / 50_000),
						items: Math.round(net / 25_000),
						days: 44,
					},
			{ weekday: index + 1 },
		),
	);
}

export function lifecycleRow(
	id: string,
	values: Partial<LifecycleRow> = {},
): LifecycleRow {
	return {
		item_external_id: id,
		item_name: `Item ${id}`,
		item_type_external_id: "TYPE-001",
		item_type_name: "Drinks",
		role: "drink",
		first_sold_on: "2025-01-02",
		last_sold_on: AS_OF,
		months_sold: 22,
		quantity_28d: 100,
		quantity_prior_28d: 100,
		quantity_ytd: 1_000,
		quantity_last_ytd: 1_000,
		net_ytd: 50_000_000,
		net_last_ytd: 50_000_000,
		quantity_lifetime: 2_000,
		net_lifetime: 100_000_000,
		...values,
	};
}

export interface CompareFigures {
	readonly current: Figures | null;
	readonly lastYear: Figures | null;
}

export function compareRows(
	blocks: Readonly<Record<string, CompareFigures>>,
	currentRange: { from: IsoDate; to: IsoDate } = {
		from: "2026-01-01",
		to: AS_OF,
	},
	lastYearRange: { from: IsoDate; to: IsoDate } = {
		from: "2025-01-01",
		to: "2025-11-03",
	},
): TotalsRow[] {
	const entries = Object.entries(blocks);
	const all: CompareFigures = {
		current: sumFigures(entries.map(([, block]) => block.current)),
		lastYear: sumFigures(entries.map(([, block]) => block.lastYear)),
	};
	const block = (storeId: string | null, figures: CompareFigures) => {
		const current = totalsOfFigures(figures.current, 1);
		const lastYear = totalsOfFigures(figures.lastYear, 1);
		return [
			totalsRow(
				storeId,
				"current",
				currentRange.from,
				currentRange.to,
				current,
			),
			totalsRow(
				storeId,
				"previous",
				lastYearRange.from,
				lastYearRange.to,
				lastYear,
			),
			totalsRow(
				storeId,
				"last_year",
				lastYearRange.from,
				lastYearRange.to,
				lastYear,
			),
		];
	};
	return [
		...block(null, all),
		...entries.flatMap(([id, figures]) => block(id, figures)),
	];
}

export function lflCompare(
	figures: CompareFigures,
): AnalyticsRow<"period_compare">[] {
	const current = totalsOfFigures(figures.current, 1);
	const lastYear = totalsOfFigures(figures.lastYear, 1);
	const row = (
		period: "current" | "previous" | "last_year",
		from: IsoDate,
		to: IsoDate,
		values: ReturnType<typeof totalsOfFigures>,
	): AnalyticsRow<"period_compare"> => ({
		period,
		from_date: from,
		to_date: to,
		days_with_data: values.days_with_data,
		invoices: values.invoices,
		net_amount: values.net_amount,
		gross_amount: values.gross_amount,
		discount_amount: values.discount_amount,
		avg_ticket: values.avg_ticket,
		items_per_ticket: values.items_per_ticket,
		avg_item_price: values.avg_item_price,
		cash_share: values.cash_share,
		voucher_share: values.voucher_share,
		member_share: values.member_share,
		identified_share: values.identified_share,
	});
	return [
		row("current", "2026-01-01", AS_OF, current),
		row("previous", "2025-01-01", "2025-11-03", lastYear),
		row("last_year", "2025-01-01", "2025-11-03", lastYear),
	];
}

export interface YearScene {
	readonly stores?: readonly string[];
	readonly date?: IsoDate;
	readonly asOf?: IsoDate;
	readonly coverage?: readonly AnalyticsRow<"store_coverage">[];
	readonly compare?: readonly TotalsRow[];
	readonly compareLfl?: readonly AnalyticsRow<"period_compare">[];
	readonly months?: readonly SeriesRow[];
	readonly weeks?: readonly SeriesRow[];
	readonly weekdays?: readonly SeriesRow[];
	readonly lifecycle?: readonly LifecycleRow[];
	readonly lifecycleCovered?: readonly LifecycleRow[];
	readonly since?: Readonly<Record<string, readonly SeriesRow[]>>;
}

export function yearContext(scene: YearScene = {}): ReportContext {
	return context(
		"year",
		scene.date ?? scene.asOf ?? AS_OF,
		scene.stores ?? [STORE_A, STORE_B],
		{
			asOf: scene.asOf ?? AS_OF,
		},
	);
}

export function establishedAndYoung(): AnalyticsRow<"store_coverage">[] {
	return [
		coverageRow(STORE_A, { history_start: "2024-12-02" }),
		coverageRow(STORE_B, { history_start: YOUNG_START }),
	];
}

export function yearInput(scene: YearScene = {}): CardInput {
	const reportContext = yearContext(scene);
	const storeIds = reportContext.stores.map((store) => store.id);
	const coverageRows =
		scene.coverage ??
		storeIds.map((id) => coverageRow(id, { history_start: "2024-12-02" }));
	const entries = new Map<string, readonly unknown[]>([
		[yearCalls.coverage, coverageRows],
		[yearCalls.compare, scene.compare ?? []],
		[yearCalls.months, scene.months ?? []],
		[yearCalls.weeks, scene.weeks ?? []],
		[yearCalls.weekdays, scene.weekdays ?? []],
		[yearCalls.lifecycle, scene.lifecycle ?? []],
		[yearCalls.lifecycleCovered, scene.lifecycleCovered ?? []],
		[COMPARE_LIKE_FOR_LIKE_KEYS.previous, scene.compareLfl ?? []],
		[COMPARE_LIKE_FOR_LIKE_KEYS.last_year, scene.compareLfl ?? []],
		...Object.entries(scene.since ?? {}).map(
			([id, rows]) => [sinceCallKey(id), rows] as [string, readonly unknown[]],
		),
	]);
	const results: CallResults = resultsOf(entries);
	return {
		context: reportContext,
		coverage: coverageModel(coverageRows, reportContext),
		results,
	};
}
