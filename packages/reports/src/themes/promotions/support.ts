import type { AnalyticsRow } from "../../contract/functions.js";
import type { DateRange, PromotionKind } from "../../contract/values.js";
import { COVERAGE_CALL_KEY } from "../../definition.js";
import { csvName } from "../../model/card.js";
import type { CoverageModel } from "../../model/coverage.js";
import { promotionKindKey } from "../../model/keys.js";
import {
	messageValue,
	part,
	type SentencePart,
	textValue,
} from "../../model/values.js";
import { addDays, daysBetween } from "../../period/dates.js";
import { UNNAMED_PROMOTION_KEY } from "../../reports/week/cards/promotions.js";
import type { ThemeContext } from "../context.js";
import {
	PROMOTION_COMPARATORS,
	type PromotionComparator,
	REDEMPTION_SUMMARY_MAX_DAYS,
	type ThemeRow,
} from "../contract.js";
import {
	lastDaysWindow,
	likeForLikeRangeCalls,
	type RangeTotalsRow,
	type ReportCallSpec,
	reportCall,
	type ThemeCallResults,
	TOTALS_CALL_KEY,
	TOTALS_LIKE_FOR_LIKE_KEYS,
	themeCoverageCall,
	themeStoreIds,
	totalsCall,
} from "../definition.js";
import { bucketGrain } from "../payments/support.js";
import { settingsOf } from "../settings.js";
import { promotionsKeys } from "./keys.js";
import {
	COMPARATOR_PARAM,
	chosenPromotion,
	DEFAULT_COMPARATOR,
	LIFT_CALL_KEY,
	PROMOTION_PARAM,
	PROMOTIONS_W92_CALL_KEY,
	type PromotionChoice,
	promotionOptions,
} from "./params.js";
import {
	type CapPeriod,
	capPeriods,
	type DiscountDaysPlan,
	discountDaysPlan,
	needsDaysUnderRule,
	themePromotionRules,
} from "./rules.js";

export const PROMOTIONS_SLUG = "khuyen-mai";
export const LIFT_WINDOW_DAYS = 92;
export const LIFT_BASELINE_WEEKS = 8;
export const LIFT_MIN_CONTROL_DAYS = 7;

export const promotionsCalls = {
	coverage: COVERAGE_CALL_KEY,
	totals: TOTALS_CALL_KEY,
	promotions: "promotions",
	promotionsW92: PROMOTIONS_W92_CALL_KEY,
	series: "series",
	settings: "settings",
	lift: LIFT_CALL_KEY,
	catalogue: "catalogue",
	discountDays: "discountDays",
	discountDaysUnderRule: "discountDaysUnderRule",
	redemptions: "redemptions",
	redemptionsPrevious: "redemptionsPrevious",
} as const;

export const COMPLIANCE_CALL_PREFIX = "compliance.";
export const COMPLIANCE_CALLS = `${COMPLIANCE_CALL_PREFIX}*`;

const likeForLikeKeys = [
	TOTALS_LIKE_FOR_LIKE_KEYS.previous,
	TOTALS_LIKE_FOR_LIKE_KEYS.last_year,
] as const;

export const promotionsNeeds = {
	discountCost: [
		promotionsCalls.coverage,
		promotionsCalls.totals,
		...likeForLikeKeys,
		promotionsCalls.promotions,
		promotionsCalls.series,
	],
	vouchers: [
		promotionsCalls.coverage,
		promotionsCalls.totals,
		...likeForLikeKeys,
		promotionsCalls.promotions,
	],
	lift: [
		promotionsCalls.coverage,
		promotionsCalls.promotionsW92,
		promotionsCalls.settings,
		promotionsCalls.lift,
	],
	catalogue: [promotionsCalls.coverage, promotionsCalls.catalogue],
	ruleCap: [promotionsCalls.coverage, COMPLIANCE_CALLS],
	ruleDays: [
		promotionsCalls.coverage,
		promotionsCalls.discountDays,
		promotionsCalls.discountDaysUnderRule,
	],
	redemptions: [
		promotionsCalls.coverage,
		promotionsCalls.redemptions,
		promotionsCalls.redemptionsPrevious,
	],
} as const;

export type PromotionRow = AnalyticsRow<"promotion_summary">;
export type SeriesRow = AnalyticsRow<"period_series">;
export type SettingsRow = ThemeRow<"report_settings_of">;

export interface RedemptionWindows {
	readonly current: DateRange & { readonly days: number };
	readonly previous: DateRange;
	readonly clipped: boolean;
}

export function redemptionWindows(
	context: Pick<ThemeContext, "range">,
): RedemptionWindows {
	const { range } = context;
	const previousDays = daysBetween(range.previous.from, range.previous.to) + 1;
	if (
		range.days <= REDEMPTION_SUMMARY_MAX_DAYS &&
		previousDays <= REDEMPTION_SUMMARY_MAX_DAYS
	) {
		return {
			current: { from: range.from, to: range.to, days: range.days },
			previous: range.previous,
			clipped: false,
		};
	}
	const current = lastDaysWindow(range, REDEMPTION_SUMMARY_MAX_DAYS);
	return {
		current,
		previous: {
			from: addDays(current.from, -current.days),
			to: addDays(current.from, -1),
		},
		clipped: current.days < range.days,
	};
}

export function redemptionCalls(
	context: ThemeContext,
): readonly ReportCallSpec[] {
	if (context.sample) return [];
	const storeIds = themeStoreIds(context);
	const windows = redemptionWindows(context);
	return [
		reportCall(promotionsCalls.redemptions, "redemption_summary", {
			store_ids: storeIds,
			from_date: windows.current.from,
			to_date: windows.current.to,
		}),
		reportCall(promotionsCalls.redemptionsPrevious, "redemption_summary", {
			store_ids: storeIds,
			from_date: windows.previous.from,
			to_date: windows.previous.to,
		}),
	];
}

export function liftWindow(
	context: Pick<ThemeContext, "range">,
): DateRange & { readonly days: number } {
	return lastDaysWindow(context.range, LIFT_WINDOW_DAYS);
}

function isComparator(value: string | undefined): value is PromotionComparator {
	return (
		value !== undefined &&
		(PROMOTION_COMPARATORS as readonly string[]).includes(value)
	);
}

export function comparatorOf(
	context: Pick<ThemeContext, "params">,
): PromotionComparator {
	const value = context.params[COMPARATOR_PARAM];
	return isComparator(value) ? value : DEFAULT_COMPARATOR;
}

export function liftPromotion(
	context: Pick<ThemeContext, "params">,
	results: ThemeCallResults,
): PromotionChoice | null {
	const options = promotionOptions(results);
	if (options === null) return null;
	return chosenPromotion(context.params[PROMOTION_PARAM] ?? "", options);
}

export function liftPreWeeks(results: ThemeCallResults): number | null {
	const rows = results.rows(promotionsCalls.settings, "report_settings_of");
	if (rows === undefined || rows.length === 0) return null;
	return settingsOf(rows).settings.promoPreWeeks;
}

export function complianceCallKey(index: number): string {
	return `${COMPLIANCE_CALL_PREFIX}${index + 1}`;
}

export function themeCapPeriods(
	context: Pick<ThemeContext, "range">,
): CapPeriod[] {
	return capPeriods(themePromotionRules(), context.range);
}

export function themeDiscountDaysPlan(
	context: Pick<ThemeContext, "range">,
): DiscountDaysPlan {
	return discountDaysPlan(themePromotionRules(), context.range.to);
}

export function ruleCalls(context: ThemeContext): readonly ReportCallSpec[] {
	const storeIds = themeStoreIds(context);
	const plan = themeDiscountDaysPlan(context);
	return [
		reportCall(promotionsCalls.catalogue, "promotion_catalogue", {
			store_ids: storeIds,
			as_of_date: context.range.to,
		}),
		...themeCapPeriods(context).map((period, index) =>
			reportCall(complianceCallKey(index), "promotion_compliance", {
				store_ids: storeIds,
				from_date: period.from,
				to_date: period.to,
				cap_rate: period.cap,
			}),
		),
		...(plan.counted
			? [
					reportCall(promotionsCalls.discountDays, "item_discount_days", {
						store_ids: storeIds,
						calendar_year: plan.year,
						as_of_date: plan.asOf,
					}),
				]
			: []),
		...(needsDaysUnderRule(plan) && plan.underRule !== null
			? [
					reportCall(
						promotionsCalls.discountDaysUnderRule,
						"item_discount_days",
						{
							store_ids: storeIds,
							calendar_year: plan.year,
							as_of_date: plan.underRule.to,
						},
					),
				]
			: []),
	];
}

export function promotionsPrimaryCalls(
	context: ThemeContext,
): readonly ReportCallSpec[] {
	const storeIds = themeStoreIds(context);
	const { range } = context;
	const window = liftWindow(context);
	return [
		themeCoverageCall(context),
		totalsCall(context),
		reportCall(promotionsCalls.promotions, "promotion_summary", {
			store_ids: storeIds,
			from_date: range.from,
			to_date: range.to,
		}),
		reportCall(promotionsCalls.promotionsW92, "promotion_summary", {
			store_ids: storeIds,
			from_date: window.from,
			to_date: window.to,
		}),
		reportCall(promotionsCalls.series, "period_series", {
			store_ids: storeIds,
			grain: bucketGrain(range.days),
			from_date: range.from,
			to_date: range.to,
			include_stores: false,
		}),
		reportCall(promotionsCalls.settings, "report_settings_of", {
			store_ids: storeIds,
		}),
		...ruleCalls(context),
		...redemptionCalls(context),
	];
}

export function liftCall(
	context: ThemeContext,
	choice: PromotionChoice,
	preWeeks: number,
): ReportCallSpec<"promotion_lift"> {
	const window = liftWindow(context);
	return reportCall(promotionsCalls.lift, "promotion_lift", {
		store_ids: themeStoreIds(context),
		promotion_kind: choice.kind,
		promotion_key: choice.key,
		from_date: window.from,
		to_date: window.to,
		comparator: comparatorOf(context),
		pre_weeks: preWeeks,
	});
}

export function promotionsFollowUpCalls(
	context: ThemeContext,
	coverage: CoverageModel,
	results: ThemeCallResults,
): readonly ReportCallSpec[] {
	const choice = liftPromotion(context, results);
	const preWeeks = liftPreWeeks(results);
	return [
		...likeForLikeRangeCalls(context, coverage),
		...(choice === null || preWeeks === null
			? []
			: [liftCall(context, choice, preWeeks)]),
	];
}

export function totalsRows(
	results: ThemeCallResults,
	key: string = promotionsCalls.totals,
): readonly RangeTotalsRow[] {
	return results.rows(key, "range_totals") ?? [];
}

export function promotionRows(
	results: ThemeCallResults,
	key: string = promotionsCalls.promotions,
): readonly PromotionRow[] {
	return results.rows(key, "promotion_summary") ?? [];
}

export function seriesRows(results: ThemeCallResults): readonly SeriesRow[] {
	return [...(results.rows(promotionsCalls.series, "period_series") ?? [])]
		.filter((row) => row.store_id === null)
		.sort((left, right) => (left.bucket_start < right.bucket_start ? -1 : 1));
}

export function promotionId(
	row: Pick<PromotionRow, "promotion_kind" | "promotion_key">,
): string {
	return `${row.promotion_kind}|${row.promotion_key}`;
}

export function promotionName(
	row: Pick<PromotionRow, "promotion_key" | "promotion_name">,
): string | null {
	if (row.promotion_name !== null) return row.promotion_name;
	return row.promotion_key === UNNAMED_PROMOTION_KEY ? null : row.promotion_key;
}

export function promotionLabel(
	kind: PromotionKind,
	name: string | null,
): SentencePart {
	const kindValue = messageValue(promotionKindKey(kind));
	return name === null
		? part(promotionsKeys.lift.optionUnnamed, { kind: kindValue })
		: part(promotionsKeys.lift.option, {
				name: textValue("text", name),
				kind: kindValue,
			});
}

export function promotionsCsvName(context: ThemeContext, card: string): string {
	return csvName(PROMOTIONS_SLUG, card, context.range.key);
}
