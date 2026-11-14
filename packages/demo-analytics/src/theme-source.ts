import {
	INVALID_ARGUMENTS_CODE,
	INVALID_ROWS_CODE,
	type IsoDate,
	type ReportSource,
	type ThemeArgs,
	ThemeCallError,
	type ThemeFunctionName,
	type ThemeRow,
	themeFunctions,
} from "@fnb/reports";
import { z } from "zod";
import type { AggregateStore, StoreDayRange } from "./aggregates.js";
import { hourProfile } from "./functions/hour-profile.js";
import { hourWeekdayHeatmap } from "./functions/hour-weekday-heatmap.js";
import { openingProductivity } from "./functions/opening-productivity.js";
import { rangeTotals } from "./functions/range-totals.js";
import { reportSettingsOf } from "./functions/report-settings-of.js";
import type {
	ThemeHandler,
	ThemeHandlerArgs,
	ThemeHandlerContext,
} from "./functions/theme-support.js";
import { DemoSettingsStore } from "./settings.js";
import {
	createDemoAnalyticsSource,
	type DemoAnalyticsSource,
	type DemoAnalyticsSourceOptions,
} from "./source.js";

type ThemeHandlers = {
	readonly [N in ThemeFunctionName]: ThemeHandler<N>;
};

type ThemeReads = {
	readonly [N in ThemeFunctionName]: (
		args: ThemeHandlerArgs<N>,
	) => readonly StoreDayRange[];
};

export const themeHandlers: ThemeHandlers = {
	report_settings_of: reportSettingsOf,
	range_totals: rangeTotals,
	opening_productivity: openingProductivity,
	hour_weekday_heatmap: hourWeekdayHeatmap,
	hour_profile: hourProfile,
	menu_engineering: notImplemented("menu_engineering"),
	item_margins: notImplemented("item_margins"),
	item_attach: notImplemented("item_attach"),
	basket_pairs: notImplemented("basket_pairs"),
	modifier_summary: notImplemented("modifier_summary"),
};

function notImplemented<N extends ThemeFunctionName>(name: N): ThemeHandler<N> {
	return () => {
		throw new ThemeCallError(name, "not_implemented");
	};
}

function span(
	storeIds: readonly string[],
	from: IsoDate,
	to: IsoDate,
): StoreDayRange {
	return { storeIds, from, to };
}

export const themeReads: ThemeReads = {
	report_settings_of: () => [],
	range_totals: (args) =>
		args.from_dates.map((from, index) =>
			span(args.store_ids, from, args.to_dates[index] ?? from),
		),
	opening_productivity: (args) => [
		span(args.store_ids, args.from_date, args.to_date),
	],
	hour_weekday_heatmap: (args) => [
		span(args.store_ids, args.from_date, args.to_date),
	],
	hour_profile: (args) => [span(args.store_ids, args.from_date, args.to_date)],
	menu_engineering: () => [],
	item_margins: (args) => [span(args.store_ids, args.from_date, args.to_date)],
	item_attach: (args) => [span(args.store_ids, args.from_date, args.to_date)],
	basket_pairs: (args) => [span(args.store_ids, args.from_date, args.to_date)],
	modifier_summary: (args) => [
		span(args.store_ids, args.from_date, args.to_date),
		...(args.compare_from != null && args.compare_to != null
			? [span(args.store_ids, args.compare_from, args.compare_to)]
			: []),
	],
};

function issues(error: z.ZodError): string {
	return error.issues
		.slice(0, 3)
		.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
		.join("; ");
}

function parseThemeArgs<N extends ThemeFunctionName>(
	name: N,
	args: ThemeArgs<N>,
): ThemeHandlerArgs<N> {
	const parsed = themeFunctions[name].args.safeParse(args);
	if (!parsed.success) {
		throw new ThemeCallError(
			name,
			INVALID_ARGUMENTS_CODE,
			issues(parsed.error),
		);
	}
	return parsed.data as ThemeHandlerArgs<N>;
}

function validateThemeRows<N extends ThemeFunctionName>(
	name: N,
	rows: ThemeRow<N>[],
): ThemeRow<N>[] {
	const parsed = z.array(themeFunctions[name].row as z.ZodType).safeParse(rows);
	if (!parsed.success) {
		throw new ThemeCallError(name, INVALID_ROWS_CODE, issues(parsed.error));
	}
	return parsed.data as ThemeRow<N>[];
}

export interface DemoReportSourceOptions extends DemoAnalyticsSourceOptions {
	readonly settings?: DemoSettingsStore;
}

export interface DemoReportSource extends ReportSource {
	readonly kind: "demo";
	readonly aggregates: AggregateStore;
	readonly settings: DemoSettingsStore;
}

export function createDemoReportSource(
	options: DemoReportSourceOptions,
): DemoReportSource {
	const analytics: DemoAnalyticsSource = createDemoAnalyticsSource(options);
	const settings = options.settings ?? new DemoSettingsStore();
	const { aggregates } = analytics;
	return {
		kind: "demo",
		aggregates,
		settings,
		call: analytics.call,
		async callTheme<N extends ThemeFunctionName>(
			name: N,
			args: ThemeArgs<N>,
		): Promise<ThemeRow<N>[]> {
			const parsed = parseThemeArgs(name, args);
			const read = themeReads[name] as (
				args: ThemeHandlerArgs<N>,
			) => readonly StoreDayRange[];
			await aggregates.ensureAll(read(parsed));
			const context: ThemeHandlerContext = {
				now: options.now(),
				holidays: [],
				settings,
			};
			const handler = themeHandlers[name] as ThemeHandler<N>;
			const rows = handler(aggregates, parsed, context);
			return options.validateRows === true
				? validateThemeRows(name, rows)
				: rows;
		},
	};
}
