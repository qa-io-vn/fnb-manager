import type { AnalyticsRow } from "../../contract/functions.js";
import type { DateRange } from "../../contract/values.js";
import { COVERAGE_CALL_KEY } from "../../definition.js";
import { csvName } from "../../model/card.js";
import { addDays } from "../../period/dates.js";
import type { ThemeContext } from "../context.js";
import { MEMBER_SHARE_BY_SHIFT_MAX_DAYS, type ThemeRow } from "../contract.js";
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
	memberShare: "memberShare",
	memberSharePrevious: "memberSharePrevious",
} as const;

export const shiftsNeeds = {
	sales: [shiftsCalls.coverage, shiftsCalls.shifts],
	drawer: [shiftsCalls.coverage, shiftsCalls.shifts, shiftsCalls.settings],
	adjustments: [
		shiftsCalls.coverage,
		shiftsCalls.adjustments,
		shiftsCalls.settings,
	],
	cashiers: [shiftsCalls.coverage, shiftsCalls.shifts, shiftsCalls.adjustments],
	memberShare: [
		shiftsCalls.coverage,
		shiftsCalls.memberShare,
		shiftsCalls.memberSharePrevious,
	],
} as const;

export type ShiftRow = AnalyticsRow<"shift_review">;
export type AdjustmentRow = ThemeRow<"shift_adjustments">;
export type SettingsRow = ThemeRow<"report_settings_of">;
export type MemberShareRow = ThemeRow<"member_share_by_shift">;

export interface MemberShareWindows {
	readonly current: DateRange & { readonly days: number };
	readonly previous: DateRange;
	readonly clipped: boolean;
}

export function memberShareWindows(
	context: Pick<ThemeContext, "range">,
): MemberShareWindows {
	const { range } = context;
	const current = lastDaysWindow(range, MEMBER_SHARE_BY_SHIFT_MAX_DAYS);
	const clipped = current.days < range.days;
	return {
		current,
		previous: clipped
			? {
					from: addDays(current.from, -current.days),
					to: addDays(current.from, -1),
				}
			: range.previous,
		clipped,
	};
}

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
		...memberShareCalls(context),
	];
}

export function memberShareCalls(
	context: ThemeContext,
): readonly ReportCallSpec[] {
	const storeIds = themeStoreIds(context);
	const windows = memberShareWindows(context);
	return [
		reportCall(shiftsCalls.memberShare, "member_share_by_shift", {
			store_ids: storeIds,
			from_date: windows.current.from,
			to_date: windows.current.to,
		}),
		reportCall(shiftsCalls.memberSharePrevious, "member_share_by_shift", {
			store_ids: storeIds,
			from_date: windows.previous.from,
			to_date: windows.previous.to,
		}),
	];
}

export function memberShareRows(
	results: ThemeCallResults,
	key: string = shiftsCalls.memberShare,
): readonly MemberShareRow[] {
	return results.rows(key, "member_share_by_shift") ?? [];
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
