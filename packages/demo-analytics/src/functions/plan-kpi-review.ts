import type { ThemeRow } from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import {
	requireThemeStoreIds,
	type ThemeHandlerArgs,
	type ThemeHandlerContext,
} from "./theme-support.js";

export function planKpiReview(
	_store: AggregateStore,
	args: ThemeHandlerArgs<"plan_kpi_review">,
	_context: ThemeHandlerContext,
): ThemeRow<"plan_kpi_review">[] {
	requireThemeStoreIds("plan_kpi_review", args.store_ids);
	return [];
}
