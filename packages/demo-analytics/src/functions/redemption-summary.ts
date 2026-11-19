import { REDEMPTION_SUMMARY_MAX_DAYS, type ThemeRow } from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import {
	requireThemeDateRange,
	requireThemeStoreIds,
	type ThemeHandlerArgs,
	type ThemeHandlerContext,
} from "./theme-support.js";

export function redemptionSummary(
	_store: AggregateStore,
	args: ThemeHandlerArgs<"redemption_summary">,
	_context: ThemeHandlerContext,
): ThemeRow<"redemption_summary">[] {
	requireThemeStoreIds("redemption_summary", args.store_ids);
	requireThemeDateRange(
		"redemption_summary",
		args.from_date,
		args.to_date,
		REDEMPTION_SUMMARY_MAX_DAYS,
	);
	return [];
}
