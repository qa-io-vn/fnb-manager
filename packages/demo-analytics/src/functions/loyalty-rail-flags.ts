import type { ThemeRow } from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import {
	requireThemeStoreIds,
	type ThemeHandlerArgs,
	type ThemeHandlerContext,
} from "./theme-support.js";

export function loyaltyRailFlags(
	_store: AggregateStore,
	args: ThemeHandlerArgs<"loyalty_rail_flags">,
	_context: ThemeHandlerContext,
): ThemeRow<"loyalty_rail_flags">[] {
	requireThemeStoreIds("loyalty_rail_flags", args.p_store_ids);
	return [];
}
