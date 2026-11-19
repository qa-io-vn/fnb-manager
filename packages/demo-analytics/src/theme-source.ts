import {
	addDays,
	daysBetween,
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
import { ESTABLISHED_STORE_OPENED_ON } from "./calendar.js";
import {
	BASKET_PAIRS_MAX_DAYS,
	basketPairs,
} from "./functions/basket-pairs.js";
import {
	DATA_QUALITY_ITEMS_MAX_DAYS,
	dataQualityItems,
} from "./functions/data-quality-items.js";
import {
	DATA_QUALITY_PAYMENTS_MAX_DAYS,
	dataQualityPayments,
} from "./functions/data-quality-payments.js";
import {
	DATA_QUALITY_SUMMARY_MAX_DAYS,
	dataQualitySummary,
	RECEIPT_LOOKBACK_DAYS,
} from "./functions/data-quality-summary.js";
import { holidayCalendar } from "./functions/holiday-calendar.js";
import { hourProfile } from "./functions/hour-profile.js";
import { hourWeekdayHeatmap } from "./functions/hour-weekday-heatmap.js";
import { ITEM_ATTACH_MAX_DAYS, itemAttach } from "./functions/item-attach.js";
import { itemDiscountDays } from "./functions/item-discount-days.js";
import {
	ITEM_MARGINS_MAX_DAYS,
	itemMargins,
} from "./functions/item-margins.js";
import { menuEngineering } from "./functions/menu-engineering.js";
import {
	METRIC_WINDOWS_MAX_DAYS,
	metricWindows,
} from "./functions/metric-windows.js";
import {
	MODIFIER_SUMMARY_MAX_DAYS,
	modifierSummary,
} from "./functions/modifier-summary.js";
import { openingProductivity } from "./functions/opening-productivity.js";
import { planKpiReview } from "./functions/plan-kpi-review.js";
import { promotionCatalogue } from "./functions/promotion-catalogue.js";
import {
	PROMOTION_COMPLIANCE_MAX_DAYS,
	promotionCompliance,
} from "./functions/promotion-compliance.js";
import {
	PROMOTION_DAYS_MAX_DAYS,
	promotionDays,
} from "./functions/promotion-days.js";
import {
	PROMOTION_LIFT_LOOKBACK_DAYS,
	PROMOTION_LIFT_MAX_DAYS,
	promotionLift,
} from "./functions/promotion-lift.js";
import { rangeTotals } from "./functions/range-totals.js";
import { redemptionSummary } from "./functions/redemption-summary.js";
import { reportSettingsOf } from "./functions/report-settings-of.js";
import {
	SHIFT_ADJUSTMENTS_MAX_DAYS,
	SHIFT_ADJUSTMENTS_TRAILING_DAYS,
	shiftAdjustments,
} from "./functions/shift-adjustments.js";
import { storeProfiles } from "./functions/store-profiles.js";
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
const LAST_FOUR_DIGIT_YEAR = 9999;
const EVENT_DAYS_AFTER_SALE = 1;
const SHIFT_WINDOW_DAYS_BEFORE = 2;

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
	promotion_days: promotionDays,
	promotion_catalogue: promotionCatalogue,
	promotion_lift: promotionLift,
	promotion_compliance: promotionCompliance,
	item_discount_days: itemDiscountDays,
	shift_adjustments: shiftAdjustments,
	data_quality_items: dataQualityItems,
	data_quality_summary: dataQualitySummary,
	data_quality_payments: dataQualityPayments,
	store_profiles: storeProfiles,
	metric_windows: metricWindows,
	holiday_calendar: holidayCalendar,
	plan_kpi_review: planKpiReview,
	redemption_summary: redemptionSummary,
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
	promotion_days: (args) =>
		limitedSpan(
			args.store_ids,
			args.from_date,
			args.to_date,
			PROMOTION_DAYS_MAX_DAYS,
		),
	promotion_catalogue: (args) => [
		span(args.store_ids, ESTABLISHED_STORE_OPENED_ON, args.as_of_date),
	],
	promotion_lift: (args) =>
		limitedSpan(
			args.store_ids,
			addDays(args.from_date, -PROMOTION_LIFT_LOOKBACK_DAYS),
			args.to_date,
			PROMOTION_LIFT_MAX_DAYS + PROMOTION_LIFT_LOOKBACK_DAYS,
		),
	promotion_compliance: (args) =>
		limitedSpan(
			args.store_ids,
			args.from_date,
			args.to_date,
			PROMOTION_COMPLIANCE_MAX_DAYS,
		),
	item_discount_days: (args) => {
		if (args.calendar_year > LAST_FOUR_DIGIT_YEAR) return [];
		const yearEnd = `${args.calendar_year}-12-31`;
		const asOf = args.as_of_date ?? yearEnd;
		return [
			span(
				args.store_ids,
				`${args.calendar_year}-01-01`,
				asOf < yearEnd ? asOf : yearEnd,
			),
		];
	},
	shift_adjustments: (args) =>
		limitedSpan(
			args.store_ids,
			addDays(
				args.from_date,
				-(SHIFT_ADJUSTMENTS_TRAILING_DAYS + EVENT_DAYS_AFTER_SALE),
			),
			addDays(args.to_date, EVENT_DAYS_AFTER_SALE),
			SHIFT_ADJUSTMENTS_MAX_DAYS +
				SHIFT_ADJUSTMENTS_TRAILING_DAYS +
				2 * EVENT_DAYS_AFTER_SALE,
		),
	data_quality_items: (args) =>
		limitedSpan(
			args.store_ids,
			args.from_date,
			args.to_date,
			DATA_QUALITY_ITEMS_MAX_DAYS,
		),
	data_quality_summary: (args) => {
		const daysBack = Math.max(
			daysBetween(args.from_date, args.to_date) + SHIFT_WINDOW_DAYS_BEFORE,
			RECEIPT_LOOKBACK_DAYS - 1,
		);
		return limitedSpan(
			args.store_ids,
			addDays(args.to_date, -daysBack),
			addDays(args.to_date, EVENT_DAYS_AFTER_SALE),
			DATA_QUALITY_SUMMARY_MAX_DAYS +
				SHIFT_WINDOW_DAYS_BEFORE +
				EVENT_DAYS_AFTER_SALE,
		);
	},
	data_quality_payments: (args) =>
		limitedSpan(
			args.store_ids,
			args.from_date,
			args.to_date,
			DATA_QUALITY_PAYMENTS_MAX_DAYS,
		),
	store_profiles: () => [],
	metric_windows: (args) => {
		const ranges = args.from_dates.map((from, index) => ({
			from,
			to: args.to_dates[index] ?? from,
		}));
		const valid = ranges.every(
			(range) =>
				range.from <= range.to &&
				daysBetween(range.from, range.to) < METRIC_WINDOWS_MAX_DAYS,
		);
		return valid && args.from_dates.length === args.to_dates.length
			? ranges.map((range) =>
					span(args.store_ids, addDays(range.from, -1), range.to),
				)
			: [];
	},
	holiday_calendar: () => [],
	plan_kpi_review: () => [],
	redemption_summary: () => [],
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
