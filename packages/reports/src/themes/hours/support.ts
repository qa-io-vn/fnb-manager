import { COVERAGE_CALL_KEY } from "../../definition.js";
import { csvName } from "../../model/card.js";
import type { ThemeContext } from "../context.js";
import type { HourLevel, HourScope, ThemeRow } from "../contract.js";
import {
	type ReportCallSpec,
	reportCall,
	type ThemeCallResults,
	themeCoverageCall,
	themeStoreIds,
} from "../definition.js";

export const HOURS_SLUG = "gio-ngay";
export const SHIFT_WINDOWS_MIN_DAYS = 14;
export const THIN_WEEKDAY_DAYS = 2;
const HOURS_PER_DAY = 24;

export const hoursCalls = {
	coverage: COVERAGE_CALL_KEY,
	heat: "heat",
	hours: "hours",
	hoursPrevious: "hoursPrevious",
	productivity: "productivity",
	productivityPrevious: "productivityPrevious",
	settings: "settings",
} as const;

export const hoursNeeds = {
	heat: [hoursCalls.coverage, hoursCalls.heat, hoursCalls.hours],
	profile: [hoursCalls.coverage, hoursCalls.hours, hoursCalls.hoursPrevious],
	productivity: [
		hoursCalls.coverage,
		hoursCalls.productivity,
		hoursCalls.productivityPrevious,
		hoursCalls.settings,
	],
	windows: [hoursCalls.coverage, hoursCalls.hours, hoursCalls.settings],
} as const;

export function hoursPrimaryCalls(
	context: ThemeContext,
): readonly ReportCallSpec[] {
	const storeIds = themeStoreIds(context);
	const { range } = context;
	const window = (from: string, to: string) => ({
		store_ids: storeIds,
		from_date: from,
		to_date: to,
	});
	return [
		themeCoverageCall(context),
		reportCall(
			hoursCalls.heat,
			"hour_weekday_heatmap",
			window(range.from, range.to),
		),
		reportCall(hoursCalls.hours, "hour_profile", window(range.from, range.to)),
		reportCall(
			hoursCalls.hoursPrevious,
			"hour_profile",
			window(range.previous.from, range.previous.to),
		),
		reportCall(
			hoursCalls.productivity,
			"opening_productivity",
			window(range.from, range.to),
		),
		reportCall(
			hoursCalls.productivityPrevious,
			"opening_productivity",
			window(range.previous.from, range.previous.to),
		),
		reportCall(hoursCalls.settings, "report_settings_of", {
			store_ids: storeIds,
		}),
	];
}

export function hoursFollowUpCalls(): readonly ReportCallSpec[] {
	return [];
}

export type HourProfileRow = ThemeRow<"hour_profile">;
export type HeatRow = ThemeRow<"hour_weekday_heatmap">;
export type ProductivityRow = ThemeRow<"opening_productivity">;

export function profileRows(
	results: ThemeCallResults,
	key: string,
): readonly HourProfileRow[] {
	return results.rows(key, "hour_profile") ?? [];
}

export function hourRows(
	rows: readonly HourProfileRow[],
	scope: Exclude<HourScope, "weekday">,
): HourProfileRow[] {
	return rows
		.filter((row) => row.scope === scope && row.hour_local !== null)
		.sort(
			(left, right) => (left.hour_position ?? 0) - (right.hour_position ?? 0),
		);
}

export function summaryRow(
	rows: readonly HourProfileRow[],
	scope: Exclude<HourScope, "weekday">,
): HourProfileRow | undefined {
	return rows.find((row) => row.scope === scope && row.hour_local === null);
}

export function weekdayRows(rows: readonly HourProfileRow[]): HourProfileRow[] {
	return rows
		.filter((row) => row.scope === "weekday" && row.weekday !== null)
		.sort((left, right) => (left.weekday ?? 0) - (right.weekday ?? 0));
}

export interface LevelWindow {
	readonly level: HourLevel;
	readonly fromHour: number;
	readonly toHour: number;
	readonly hours: readonly HourProfileRow[];
}

export function levelWindows(rows: readonly HourProfileRow[]): LevelWindow[] {
	const windows: LevelWindow[] = [];
	let current: HourProfileRow[] = [];
	const flush = () => {
		const first = current[0];
		const last = current[current.length - 1];
		if (first === undefined || last === undefined || first.level === null)
			return;
		windows.push({
			level: first.level,
			fromHour: first.hour_local ?? 0,
			toHour: ((last.hour_local ?? 0) + 1) % HOURS_PER_DAY,
			hours: current,
		});
	};
	for (const row of rows) {
		const previous = current[current.length - 1];
		const adjacent =
			previous !== undefined &&
			previous.level === row.level &&
			(previous.hour_position ?? 0) + 1 === (row.hour_position ?? 0);
		if (!adjacent) {
			flush();
			current = [];
		}
		current.push(row);
	}
	flush();
	return windows;
}

export function clock(hour: number): string {
	return `${String(hour).padStart(2, "0")}:00`;
}

export function windowText(
	window: Pick<LevelWindow, "fromHour" | "toHour">,
): string {
	return `${clock(window.fromHour)}–${clock(window.toHour)}`;
}

export function hoursCsvName(context: ThemeContext, card: string): string {
	return csvName(HOURS_SLUG, card, context.range.key);
}
