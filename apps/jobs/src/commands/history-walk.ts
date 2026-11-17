import {
	businessDate,
	compareIsoDates,
	formatIsoDate,
	parseIsoDate,
	shiftIsoDate,
} from "@fnb/core";

export const DEFAULT_STOP_AFTER_EMPTY_MONTHS = 2;
export const DEFAULT_MAX_MONTHS = 120;

export interface MonthWindow {
	month: string;
	fromDate: string;
	toDate: string;
}

export type MonthAction = "synced" | "skipped" | "failed";

export interface WalkedMonth {
	window: MonthWindow;
	action: MonthAction;
	sales: number | null;
	error: string | null;
}

export type WalkStop =
	| "empty_months"
	| "before_opening"
	| "max_months"
	| "failed";

export interface WalkResult {
	months: WalkedMonth[];
	stop: WalkStop;
}

export interface MonthSync {
	succeeded: boolean;
	sales: number;
	error: string | null;
}

export interface HistoryPort {
	isSynced(window: MonthWindow): Promise<boolean>;
	storedSales(window: MonthWindow): Promise<number>;
	sync(window: MonthWindow): Promise<MonthSync>;
}

export interface WalkOptions {
	today: string;
	openedOn: string | null;
	stopAfterEmpty: number;
	maxMonths: number;
	onMonth?: (month: WalkedMonth) => void;
}

export interface StoreClock {
	timezone: string;
	business_day_start_minutes: number;
	opened_on: string | null;
}

export function monthOf(date: string): string {
	parseIsoDate(date);
	return date.slice(0, 7);
}

function monthParts(month: string): { year: number; month: number } {
	const { year, month: number } = parseIsoDate(`${month}-01`);
	return { year, month: number };
}

export function previousMonth(month: string): string {
	const parts = monthParts(month);
	return parts.month === 1
		? formatIsoDate(parts.year - 1, 12, 1).slice(0, 7)
		: formatIsoDate(parts.year, parts.month - 1, 1).slice(0, 7);
}

export function nextMonth(month: string): string {
	const parts = monthParts(month);
	return parts.month === 12
		? formatIsoDate(parts.year + 1, 1, 1).slice(0, 7)
		: formatIsoDate(parts.year, parts.month + 1, 1).slice(0, 7);
}

export function monthEnd(month: string): string {
	return shiftIsoDate(`${nextMonth(month)}-01`, -1);
}

function earlier(left: string, right: string): string {
	return compareIsoDates(left, right) <= 0 ? left : right;
}

function later(left: string, right: string): string {
	return compareIsoDates(left, right) >= 0 ? left : right;
}

export function monthWindow(month: string, today: string): MonthWindow {
	return {
		month,
		fromDate: `${month}-01`,
		toDate: earlier(monthEnd(month), today),
	};
}

export function isOpenWindow(window: MonthWindow, today: string): boolean {
	return compareIsoDates(window.toDate, today) >= 0;
}

export function latestBusinessDate(
	stores: readonly StoreClock[],
	now: Date,
): string {
	const dates = stores.map((store) =>
		businessDate(now, store.timezone, store.business_day_start_minutes),
	);
	const [first, ...rest] = dates;
	if (first === undefined) {
		throw new RangeError("latestBusinessDate needs at least one store");
	}
	return rest.reduce(later, first);
}

export function historyFloor(stores: readonly StoreClock[]): string | null {
	const dates = stores.map((store) => store.opened_on);
	if (dates.length === 0 || dates.some((date) => date === null)) {
		return null;
	}
	return (dates as string[]).reduce(earlier);
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function walkMonth(
	port: HistoryPort,
	window: MonthWindow,
	today: string,
): Promise<WalkedMonth> {
	try {
		if (!isOpenWindow(window, today) && (await port.isSynced(window))) {
			return {
				window,
				action: "skipped",
				sales: await port.storedSales(window),
				error: null,
			};
		}
		const result = await port.sync(window);
		return {
			window,
			action: result.succeeded ? "synced" : "failed",
			sales: result.sales,
			error: result.succeeded ? null : (result.error ?? "the sync failed"),
		};
	} catch (error) {
		return { window, action: "failed", sales: null, error: errorText(error) };
	}
}

export async function walkHistory(
	port: HistoryPort,
	options: WalkOptions,
): Promise<WalkResult> {
	const months: WalkedMonth[] = [];
	let month = monthOf(options.today);
	let emptyStreak = 0;
	while (months.length < options.maxMonths) {
		const window = monthWindow(month, options.today);
		if (
			options.openedOn !== null &&
			compareIsoDates(window.toDate, options.openedOn) < 0
		) {
			return { months, stop: "before_opening" };
		}
		const walked = await walkMonth(port, window, options.today);
		months.push(walked);
		options.onMonth?.(walked);
		if (walked.action === "failed") {
			return { months, stop: "failed" };
		}
		emptyStreak = walked.sales === 0 ? emptyStreak + 1 : 0;
		if (emptyStreak >= options.stopAfterEmpty) {
			return { months, stop: "empty_months" };
		}
		month = previousMonth(month);
	}
	return { months, stop: "max_months" };
}

export interface DateSpan {
	fromDate: string;
	toDate: string;
}

export function syncedSpan(results: readonly WalkResult[]): DateSpan | null {
	const windows = results.flatMap((result) =>
		result.months
			.filter((month) => month.action !== "skipped")
			.map((month) => month.window),
	);
	const [first, ...rest] = windows;
	if (first === undefined) {
		return null;
	}
	return rest.reduce<DateSpan>(
		(span, window) => ({
			fromDate: earlier(span.fromDate, window.fromDate),
			toDate: later(span.toDate, window.toDate),
		}),
		{ fromDate: first.fromDate, toDate: first.toDate },
	);
}

export function refreshWindows(span: DateSpan): MonthWindow[] {
	const windows: MonthWindow[] = [];
	for (
		let month = monthOf(span.fromDate);
		compareIsoDates(`${month}-01`, span.toDate) <= 0;
		month = nextMonth(month)
	) {
		const window = monthWindow(month, span.toDate);
		windows.push({
			month,
			fromDate: later(window.fromDate, span.fromDate),
			toDate: window.toDate,
		});
	}
	return windows;
}

export interface WalkTotals {
	synced: number;
	skipped: number;
	failed: number;
	withSales: number;
	oldestWithSales: string | null;
}

export function walkTotals(result: WalkResult): WalkTotals {
	const count = (action: MonthAction) =>
		result.months.filter((month) => month.action === action).length;
	const withSales = result.months.filter(
		(month) => month.sales !== null && month.sales > 0,
	);
	return {
		synced: count("synced"),
		skipped: count("skipped"),
		failed: count("failed"),
		withSales: withSales.length,
		oldestWithSales: withSales.at(-1)?.window.month ?? null,
	};
}
