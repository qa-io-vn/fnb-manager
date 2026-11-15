import {
	addDays,
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
import {
	BASKET_PAIRS_MAX_DAYS,
	basketPairs,
} from "./functions/basket-pairs.js";
import { hourProfile } from "./functions/hour-profile.js";
import { hourWeekdayHeatmap } from "./functions/hour-weekday-heatmap.js";
import { ITEM_ATTACH_MAX_DAYS, itemAttach } from "./functions/item-attach.js";
import {
	ITEM_MARGINS_MAX_DAYS,
	itemMargins,
} from "./functions/item-margins.js";
import { menuEngineering } from "./functions/menu-engineering.js";
import {
	MODIFIER_SUMMARY_MAX_DAYS,
	modifierSummary,
} from "./functions/modifier-summary.js";
import { openingProductivity } from "./functions/opening-productivity.js";
import { noPlannedRead, portPending } from "./functions/port-pending.js";
import { rangeTotals } from "./functions/range-totals.js";
import { reportSettingsOf } from "./functions/report-settings-of.js";
import type {
	ThemeHandler,
	ThemeHandlerArgs,
	ThemeHandlerContext,
} from "./functions/theme-support.js";
import {
	currentDemoAsOf,
	DemoSettingsStore,
	demoSettings,
} from "./settings.js";
import {
	createDemoAnalyticsSource,
	type DemoAnalyticsSource,
	type DemoAnalyticsSourceOptions,
} from "./source.js";

const MENU_WINDOW_MAX_DAYS = 91;

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
	menu_engineering: menuEngineering,
	item_margins: itemMargins,
	item_attach: itemAttach,
	basket_pairs: basketPairs,
	modifier_summary: modifierSummary,
	promotion_days: portPending("promotion_days"),
	promotion_catalogue: portPending("promotion_catalogue"),
	promotion_lift: portPending("promotion_lift"),
	promotion_compliance: portPending("promotion_compliance"),
	item_discount_days: portPending("item_discount_days"),
	shift_adjustments: portPending("shift_adjustments"),
	data_quality_items: portPending("data_quality_items"),
	data_quality_summary: portPending("data_quality_summary"),
	data_quality_payments: portPending("data_quality_payments"),
};

function span(
	storeIds: readonly string[],
	from: IsoDate,
	to: IsoDate,
): StoreDayRange {
	return { storeIds, from, to };
}

function limitedSpan(
	storeIds: readonly string[],
	from: IsoDate,
	to: IsoDate,
	maxDays: number,
): StoreDayRange[] {
	if (from > to) return [];
	const earliest = addDays(to, -(maxDays - 1));
	return [span(storeIds, from < earliest ? earliest : from, to)];
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
	menu_engineering: (args) =>
		limitedSpan(
			args.store_ids,
			addDays(
				args.as_of_date,
				-((args.window_days ?? MENU_WINDOW_MAX_DAYS) - 1),
			),
			args.as_of_date,
			MENU_WINDOW_MAX_DAYS,
		),
	item_margins: (args) =>
		limitedSpan(
			args.store_ids,
			args.from_date,
			args.to_date,
			ITEM_MARGINS_MAX_DAYS,
		),
	item_attach: (args) =>
		limitedSpan(
			args.store_ids,
			args.from_date,
			args.to_date,
			ITEM_ATTACH_MAX_DAYS,
		),
	basket_pairs: (args) =>
		limitedSpan(
			args.store_ids,
			args.from_date,
			args.to_date,
			BASKET_PAIRS_MAX_DAYS,
		),
	modifier_summary: (args) => [
		...limitedSpan(
			args.store_ids,
			args.from_date,
			args.to_date,
			MODIFIER_SUMMARY_MAX_DAYS,
		),
		...(args.compare_from != null && args.compare_to != null
			? limitedSpan(
					args.store_ids,
					args.compare_from,
					args.compare_to,
					MODIFIER_SUMMARY_MAX_DAYS,
				)
			: []),
	],
	promotion_days: noPlannedRead,
	promotion_catalogue: noPlannedRead,
	promotion_lift: noPlannedRead,
	promotion_compliance: noPlannedRead,
	item_discount_days: noPlannedRead,
	shift_adjustments: noPlannedRead,
	data_quality_items: noPlannedRead,
	data_quality_summary: noPlannedRead,
	data_quality_payments: noPlannedRead,
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

export type DemoReportSourceOptions = DemoAnalyticsSourceOptions;

export interface DemoReportSource extends ReportSource {
	readonly kind: "demo";
	readonly aggregates: AggregateStore;
	readonly settings: DemoSettingsStore;
}

export function createDemoReportSource(
	options: DemoReportSourceOptions,
): DemoReportSource {
	const settings =
		options.settings ??
		new DemoSettingsStore(demoSettings(currentDemoAsOf(options.now())));
	const analytics: DemoAnalyticsSource = createDemoAnalyticsSource({
		...options,
		settings,
	});
	const { aggregates } = analytics;
	aggregates.days.useMappings(settings);
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
				holidays: options.holidays ?? settings.holidays(),
				reportSettings: options.reportSettings?.() ?? settings.reportSettings(),
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
