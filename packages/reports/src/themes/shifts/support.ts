import type { AnalyticsRow } from "../../contract/functions.js";
import { COVERAGE_CALL_KEY } from "../../definition.js";
import { csvName } from "../../model/card.js";
import type { ThemeContext } from "../context.js";
import type { ThemeRow } from "../contract.js";
import {
	lastDaysWindow,
	type ReportCallSpec,
	reportCall,
	type ThemeCallResults,
	themeCoverageCall,
	themeStoreIds,
} from "../definition.js";
import { SHIFT_THEME_RANGE_DAYS } from "../range.js";

export const SHIFTS_SLUG = "ca-ket-tien";

export const shiftsCalls = {
	coverage: COVERAGE_CALL_KEY,
	shifts: "shifts",
	adjustments: "adjustments",
	settings: "settings",
} as const;

export const shiftsNeeds = {
	sales: [shiftsCalls.coverage, shiftsCalls.shifts],
	drawer: [shiftsCalls.coverage, shiftsCalls.shifts, shiftsCalls.settings],
	adjustments: [
		shiftsCalls.coverage,
		shiftsCalls.adjustments,
		shiftsCalls.settings,
	],
} as const;

export type ShiftRow = AnalyticsRow<"shift_review">;
export type AdjustmentRow = ThemeRow<"shift_adjustments">;
export type SettingsRow = ThemeRow<"report_settings_of">;

export function shiftsPrimaryCalls(
	context: ThemeContext,
): readonly ReportCallSpec[] {
	const storeIds = themeStoreIds(context);
	const span = lastDaysWindow(context.range, SHIFT_THEME_RANGE_DAYS);
	return [
		themeCoverageCall(context),
		reportCall(shiftsCalls.shifts, "shift_review", {
			store_ids: storeIds,
			from_date: span.from,
			to_date: span.to,
		}),
		reportCall(shiftsCalls.adjustments, "shift_adjustments", {
			store_ids: storeIds,
			from_date: span.from,
			to_date: span.to,
		}),
		reportCall(shiftsCalls.settings, "report_settings_of", {
			store_ids: storeIds,
		}),
	];
}

export function shiftsFollowUpCalls(): readonly ReportCallSpec[] {
	return [];
}

export function reviewRows(results: ThemeCallResults): readonly ShiftRow[] {
	return results.rows(shiftsCalls.shifts, "shift_review") ?? [];
}

export function adjustmentRows(
	results: ThemeCallResults,
): readonly AdjustmentRow[] {
	return results.rows(shiftsCalls.adjustments, "shift_adjustments") ?? [];
}

export function shiftsCsvName(context: ThemeContext, card: string): string {
	return csvName(SHIFTS_SLUG, card, context.range.key);
}
