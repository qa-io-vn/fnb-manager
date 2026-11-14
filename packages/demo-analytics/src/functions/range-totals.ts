import type { ThemeRow } from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import { periodTotals } from "./support.js";
import {
	invalidTheme,
	requireThemeDateRange,
	requireThemeRows,
	requireThemeStoreIds,
	type ThemeHandlerArgs,
	type ThemeHandlerContext,
} from "./theme-support.js";

type Row = ThemeRow<"range_totals">;

export const RANGE_TOTALS_MAX_RANGES = 6;
export const RANGE_TOTALS_MAX_DAYS = 1100;

export function rangeTotals(
	store: AggregateStore,
	args: ThemeHandlerArgs<"range_totals">,
	_context: ThemeHandlerContext,
): Row[] {
	requireThemeStoreIds("range_totals", args.store_ids);
	const count = args.from_dates.length;
	if (
		count < 1 ||
		count > RANGE_TOTALS_MAX_RANGES ||
		count !== args.to_dates.length
	) {
		invalidTheme(
			"range_totals",
			`range_totals needs 1 to ${RANGE_TOTALS_MAX_RANGES} ranges, with as many end dates as start dates`,
		);
	}
	const ranges = args.from_dates.map((from, index) => ({
		from,
		to: args.to_dates[index] as string,
	}));
	for (const range of ranges) {
		requireThemeDateRange(
			"range_totals",
			range.from,
			range.to,
			RANGE_TOTALS_MAX_DAYS,
		);
	}
	if (args.store_ids.length === 0) return [];
	const visible = store.visibleStores(args.store_ids);
	requireThemeRows("range_totals", count * (1 + visible.length));
	const blocks = [
		{ storeId: null as string | null, storeIds: args.store_ids },
		...visible.map((entry) => ({ storeId: entry.id, storeIds: [entry.id] })),
	];
	return ranges.flatMap((range, index) =>
		blocks.map((block) => ({
			range_index: index + 1,
			store_id: block.storeId,
			from_date: range.from,
			to_date: range.to,
			...periodTotals(store, block.storeIds, range.from, range.to),
		})),
	);
}
