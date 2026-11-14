import type { IsoDate, ThemeRow } from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import { count } from "../pg-numeric.js";
import { byteOrder } from "../text-order.js";
import {
	invalidTheme,
	requireThemeDateRange,
	requireThemeRows,
	requireThemeStoreIds,
	type ThemeHandlerArgs,
	type ThemeHandlerContext,
} from "./theme-support.js";

type Row = ThemeRow<"modifier_summary">;

export const MODIFIER_SUMMARY_MAX_DAYS = 400;

function within(
	date: IsoDate,
	from: IsoDate | null,
	to: IsoDate | null,
): boolean {
	return from !== null && to !== null && date >= from && date <= to;
}

export function modifierSummary(
	store: AggregateStore,
	args: ThemeHandlerArgs<"modifier_summary">,
	_context: ThemeHandlerContext,
): Row[] {
	requireThemeStoreIds("modifier_summary", args.store_ids);
	requireThemeDateRange(
		"modifier_summary",
		args.from_date,
		args.to_date,
		MODIFIER_SUMMARY_MAX_DAYS,
	);
	const compareFrom = args.compare_from ?? null;
	const compareTo = args.compare_to ?? null;
	if ((compareFrom === null) !== (compareTo === null)) {
		invalidTheme(
			"modifier_summary",
			"modifier_summary needs compare_from and compare_to together",
		);
	}
	if (compareFrom !== null && compareTo !== null) {
		requireThemeDateRange(
			"modifier_summary",
			compareFrom,
			compareTo,
			MODIFIER_SUMMARY_MAX_DAYS,
		);
	}
	if (args.store_ids.length === 0) return [];
	const hasCompare = compareFrom !== null;
	const current = new Map<string, number>();
	const compare = new Map<string, number>();
	const ranges: [IsoDate, IsoDate][] = [[args.from_date, args.to_date]];
	if (compareFrom !== null && compareTo !== null) {
		ranges.push([compareFrom, compareTo]);
	}
	for (const entry of store.visibleStores(args.store_ids)) {
		const seen = new Set<IsoDate>();
		for (const [from, to] of ranges) {
			for (const day of store.daysOf(entry, from, to)) {
				if (seen.has(day.date)) continue;
				seen.add(day.date);
				const inCurrent = within(day.date, args.from_date, args.to_date);
				const inCompare = within(day.date, compareFrom, compareTo);
				for (const [name, lines] of day.modifiers) {
					if (inCurrent) current.set(name, (current.get(name) ?? 0) + lines);
					if (inCompare) compare.set(name, (compare.get(name) ?? 0) + lines);
				}
			}
		}
	}
	const names = new Set([...current.keys(), ...compare.keys()]);
	let currentTotal = 0;
	let compareTotal = 0;
	for (const name of names) {
		currentTotal += current.get(name) ?? 0;
		compareTotal += compare.get(name) ?? 0;
	}
	const rows: Row[] = [...names]
		.map((name) => {
			const lines = current.get(name) ?? 0;
			const compareLines = compare.get(name) ?? 0;
			return {
				modifier_name: name,
				lines,
				share:
					currentTotal === 0
						? null
						: count(lines).div(count(currentTotal)).round(6).toNumber(),
				compare_lines: hasCompare ? compareLines : null,
				compare_share: hasCompare
					? compareTotal === 0
						? null
						: count(compareLines).div(count(compareTotal)).round(6).toNumber()
					: null,
			};
		})
		.sort(
			(left, right) =>
				right.lines - left.lines ||
				byteOrder(left.modifier_name, right.modifier_name),
		);
	requireThemeRows("modifier_summary", rows.length);
	return rows;
}
