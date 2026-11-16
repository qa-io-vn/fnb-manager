import {
	daysBetween,
	firstOfMonth,
	type IsoDate,
	lastOfMonth,
	maxDate,
	minDate,
} from "@fnb/reports";
import type { CsvDialect } from "../lib/csv";

export const STORE_TABLES = [
	"invoices",
	"invoice_lines",
	"invoice_payments",
	"shifts",
] as const;

export type StoreTableId = (typeof STORE_TABLES)[number];

export const EXPORT_TABLES = [...STORE_TABLES, "daily_summary"] as const;

export type ExportTableId = (typeof EXPORT_TABLES)[number];

export const FILE_STEMS: Readonly<Record<ExportTableId, string>> = {
	invoices: "hoa-don",
	invoice_lines: "dong-hoa-don",
	invoice_payments: "thanh-toan",
	shifts: "ca",
	daily_summary: "tong-hop-ngay",
};

export type ExportFormat = "csv" | "json";

export const MAX_EXPORT_MONTHS = 12;

export type MonthKey = string;

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface ExportStore {
	readonly id: string;
	readonly label: string;
	readonly name: string;
	readonly timeZone: string;
	readonly businessDayStartMinutes: number;
	readonly asOf: IsoDate;
}

export interface ExportRequest {
	readonly stores: readonly ExportStore[];
	readonly firstMonth: MonthKey;
	readonly lastMonth: MonthKey;
	readonly tables: readonly ExportTableId[];
	readonly format: ExportFormat;
	readonly dialect: CsvDialect;
	readonly personal: boolean;
}

export interface StoreMonth {
	readonly store: ExportStore;
	readonly month: MonthKey;
	readonly from: IsoDate;
	readonly to: IsoDate;
	readonly running: boolean;
}

export interface MonthPlan {
	readonly month: MonthKey;
	readonly from: IsoDate;
	readonly to: IsoDate;
	readonly storeMonths: readonly StoreMonth[];
}

export interface PlannedFile {
	readonly path: string;
	readonly table: ExportTableId;
	readonly month: MonthKey;
	readonly store: ExportStore | null;
}

export interface ExportPlan {
	readonly request: ExportRequest;
	readonly stores: readonly ExportStore[];
	readonly storeTables: readonly StoreTableId[];
	readonly dailySummary: boolean;
	readonly months: readonly MonthPlan[];
	readonly files: readonly PlannedFile[];
	readonly archiveName: string;
}

export type PlanError =
	| "no_stores"
	| "no_tables"
	| "invalid_month"
	| "month_order"
	| "too_many_months"
	| "nothing_to_export";

export type PlanResult =
	| { readonly ok: true; readonly plan: ExportPlan }
	| { readonly ok: false; readonly error: PlanError };

export function isMonthKey(value: string): value is MonthKey {
	return MONTH_KEY.test(value);
}

export function monthOfDate(date: IsoDate): MonthKey {
	return date.slice(0, 7);
}

export function nextMonth(month: MonthKey): MonthKey {
	const [year, number] = month.split("-").map(Number) as [number, number];
	return number === 12
		? `${year + 1}-01`
		: `${year}-${String(number + 1).padStart(2, "0")}`;
}

export function monthsBetween(first: MonthKey, last: MonthKey): MonthKey[] {
	const months: MonthKey[] = [];
	for (let month = first; month <= last; month = nextMonth(month)) {
		months.push(month);
	}
	return months;
}

export function monthOptions(
	historyStart: IsoDate | null,
	latestAsOf: IsoDate,
): MonthKey[] {
	const last = monthOfDate(latestAsOf);
	const first =
		historyStart === null || historyStart > latestAsOf
			? last
			: monthOfDate(historyStart);
	return monthsBetween(first, last);
}

export function labelNumber(label: string): number {
	const digits = /^S(\d+)$/.exec(label)?.[1];
	return digits === undefined ? Number.MAX_SAFE_INTEGER : Number(digits);
}

export function byLabel(left: ExportStore, right: ExportStore): number {
	const difference = labelNumber(left.label) - labelNumber(right.label);
	if (difference !== 0) return difference;
	return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function storeMonthOf(store: ExportStore, month: MonthKey): StoreMonth | null {
	const from = firstOfMonth(`${month}-01`);
	const monthEnd = lastOfMonth(from);
	const to = minDate(store.asOf, monthEnd);
	if (to < from) return null;
	return { store, month, from, to, running: to < monthEnd };
}

function extensionOf(format: ExportFormat): string {
	return format === "csv" ? "csv" : "json";
}

export function storeFilePath(
	month: MonthKey,
	label: string,
	table: StoreTableId,
	format: ExportFormat,
): string {
	return `${month}/${label}/${FILE_STEMS[table]}.${extensionOf(format)}`;
}

export function dailyFilePath(month: MonthKey, format: ExportFormat): string {
	return `${month}/${FILE_STEMS.daily_summary}.${extensionOf(format)}`;
}

export function archiveNameOf(first: MonthKey, last: MonthKey): string {
	return `fnb-xuat-du-lieu_${first}_${last}.zip`;
}

export function planExport(request: ExportRequest): PlanResult {
	if (request.stores.length === 0) return { ok: false, error: "no_stores" };
	if (request.tables.length === 0) return { ok: false, error: "no_tables" };
	if (!isMonthKey(request.firstMonth) || !isMonthKey(request.lastMonth)) {
		return { ok: false, error: "invalid_month" };
	}
	if (request.lastMonth < request.firstMonth) {
		return { ok: false, error: "month_order" };
	}
	const monthKeys = monthsBetween(request.firstMonth, request.lastMonth);
	if (monthKeys.length > MAX_EXPORT_MONTHS) {
		return { ok: false, error: "too_many_months" };
	}
	const stores = [...request.stores].sort(byLabel);
	const storeTables = STORE_TABLES.filter((table) =>
		request.tables.includes(table),
	);
	const dailySummary = request.tables.includes("daily_summary");
	const months: MonthPlan[] = [];
	const files: PlannedFile[] = [];
	for (const month of monthKeys) {
		const storeMonths = stores
			.map((store) => storeMonthOf(store, month))
			.filter((storeMonth): storeMonth is StoreMonth => storeMonth !== null);
		if (storeMonths.length === 0) continue;
		const from = storeMonths[0]?.from ?? `${month}-01`;
		const to = storeMonths.reduce(
			(latest, storeMonth) => maxDate(latest, storeMonth.to),
			from,
		);
		months.push({ month, from, to, storeMonths });
		if (dailySummary) {
			files.push({
				path: dailyFilePath(month, request.format),
				table: "daily_summary",
				month,
				store: null,
			});
		}
		for (const storeMonth of storeMonths) {
			for (const table of storeTables) {
				files.push({
					path: storeFilePath(
						month,
						storeMonth.store.label,
						table,
						request.format,
					),
					table,
					month,
					store: storeMonth.store,
				});
			}
		}
	}
	if (months.length === 0) return { ok: false, error: "nothing_to_export" };
	return {
		ok: true,
		plan: {
			request,
			stores,
			storeTables,
			dailySummary,
			months,
			files,
			archiveName: archiveNameOf(request.firstMonth, request.lastMonth),
		},
	};
}

export function dayCount(from: IsoDate, to: IsoDate): number {
	return daysBetween(from, to) + 1;
}
