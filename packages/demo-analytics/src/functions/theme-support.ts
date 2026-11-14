import {
	daysBetween,
	type IsoDate,
	MAX_STORE_IDS,
	ThemeCallError,
	type ThemeFunctionName,
	type ThemeRow,
	type themeFunctions,
} from "@fnb/reports";
import type { z } from "zod";
import type { AggregateStore } from "../aggregates.js";
import type { DemoSettingsStore } from "../settings.js";
import {
	type HandlerContext,
	INVALID_PARAMETER_VALUE,
	MAX_REPORT_ROWS,
} from "./support.js";

export interface ThemeHandlerContext extends HandlerContext {
	readonly settings: DemoSettingsStore;
}

export type ThemeHandlerArgs<N extends ThemeFunctionName> = z.output<
	(typeof themeFunctions)[N]["args"]
>;

export type ThemeHandler<N extends ThemeFunctionName> = (
	store: AggregateStore,
	args: ThemeHandlerArgs<N>,
	context: ThemeHandlerContext,
) => ThemeRow<N>[];

export function invalidTheme(name: ThemeFunctionName, message: string): never {
	throw new ThemeCallError(name, INVALID_PARAMETER_VALUE, message);
}

export function requireThemeStoreIds(
	name: ThemeFunctionName,
	storeIds: readonly string[],
): void {
	if (storeIds.length > MAX_STORE_IDS) {
		invalidTheme(
			name,
			`${name} needs store_ids with 0 to ${MAX_STORE_IDS} store ids`,
		);
	}
}

export function requireThemeDateRange(
	name: ThemeFunctionName,
	from: IsoDate,
	to: IsoDate,
	maxDays: number,
): void {
	if (from > to) {
		invalidTheme(
			name,
			`${name} needs a date range whose start is not after its end`,
		);
	}
	const days = daysBetween(from, to) + 1;
	if (days > maxDays) {
		invalidTheme(name, `${name} covers at most ${maxDays} days, not ${days}`);
	}
}

export function requireThemeRows(name: ThemeFunctionName, rows: number): void {
	if (rows > MAX_REPORT_ROWS) {
		invalidTheme(
			name,
			`${name} returns at most ${MAX_REPORT_ROWS} rows, this call needs ${rows}`,
		);
	}
}

export function requireBetween(
	name: ThemeFunctionName,
	argument: string,
	value: number | null | undefined,
	low: number,
	high: number,
): void {
	if (value === null || value === undefined) return;
	if (value < low || value > high) {
		invalidTheme(name, `${name} needs ${argument} between ${low} and ${high}`);
	}
}
