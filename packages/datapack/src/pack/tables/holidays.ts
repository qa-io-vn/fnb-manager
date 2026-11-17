import { daysBetween, type HolidayKind, isoWeekday } from "@fnb/reports";
import { CALL_KEYS } from "../calls.js";
import { compareCodeUnits } from "../canonical.js";
import { ALL_SCOPE, type PackTable } from "../schema.js";
import { WEEKDAY_KEYS } from "./series.js";
import {
	columns,
	type PackRows,
	packRow,
	packTable,
	type TableContext,
	type TableSpec,
} from "./support.js";

export const HOLIDAY_KIND_ORDER: readonly HolidayKind[] = [
	"tet",
	"public",
	"custom",
];

export const NAME_SEPARATOR = "; ";

export const CALENDAR_SPEC: TableSpec = {
	grain: "date",
	window: "horizon",
	columns: columns([
		["names", "text"],
		["kind", "class"],
		["weekday", "class"],
		["days_away", "days"],
	]),
};

export function calendarTable(context: TableContext): PackTable {
	const byDate = new Map<
		string,
		{ names: Set<string>; kinds: Set<HolidayKind> }
	>();
	for (const row of context.results.rows(
		CALL_KEYS.holidays,
		"holiday_calendar",
	)) {
		const entry = byDate.get(row.holiday_date) ?? {
			names: new Set<string>(),
			kinds: new Set<HolidayKind>(),
		};
		entry.names.add(row.name);
		entry.kinds.add(row.kind);
		byDate.set(row.holiday_date, entry);
	}
	const rows: PackRows = {};
	for (const [date, entry] of byDate) {
		rows[`${ALL_SCOPE}/${date}`] = packRow(
			CALENDAR_SPEC,
			[
				[...entry.names].sort(compareCodeUnits).join(NAME_SEPARATOR),
				HOLIDAY_KIND_ORDER.find((kind) => entry.kinds.has(kind)) ?? null,
				WEEKDAY_KEYS[isoWeekday(date) - 1] ?? null,
				daysBetween(context.request.asOf, date),
			],
			context.request.currency,
		);
	}
	return packTable("calendar", context, CALENDAR_SPEC, rows);
}
