import type { HolidayKind } from "@fnb/core";
import { HOLIDAY_CALENDAR_MAX_DAYS, type ThemeRow } from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import { byteOrder } from "../text-order.js";
import {
	requireThemeDateRange,
	requireThemeStoreIds,
	type ThemeHandlerArgs,
	type ThemeHandlerContext,
} from "./theme-support.js";

type Row = ThemeRow<"holiday_calendar">;

const KIND_ORDER: Readonly<Record<HolidayKind, number>> = {
	public: 0,
	tet: 1,
	custom: 2,
};

function byCalendarOrder(left: Row, right: Row): number {
	if (left.holiday_date !== right.holiday_date) {
		return left.holiday_date < right.holiday_date ? -1 : 1;
	}
	return (
		byteOrder(left.name, right.name) ||
		KIND_ORDER[left.kind] - KIND_ORDER[right.kind]
	);
}

export function holidayCalendar(
	store: AggregateStore,
	args: ThemeHandlerArgs<"holiday_calendar">,
	context: ThemeHandlerContext,
): Row[] {
	requireThemeStoreIds("holiday_calendar", args.store_ids);
	requireThemeDateRange(
		"holiday_calendar",
		args.from_date,
		args.to_date,
		HOLIDAY_CALENDAR_MAX_DAYS,
	);
	if (store.visibleStores(args.store_ids).length === 0) return [];
	const seen = new Set<string>();
	const rows: Row[] = [];
	for (const holiday of context.holidays) {
		if (
			holiday.holidayDate < args.from_date ||
			holiday.holidayDate > args.to_date
		) {
			continue;
		}
		const key = [holiday.holidayDate, holiday.name, holiday.kind].join(
			"\u0000",
		);
		if (seen.has(key)) continue;
		seen.add(key);
		rows.push({
			holiday_date: holiday.holidayDate,
			name: holiday.name,
			kind: holiday.kind,
		});
	}
	return rows.sort(byCalendarOrder);
}
