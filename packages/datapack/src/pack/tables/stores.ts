import { CALL_KEYS } from "../calls.js";
import type { StoreProfileRow } from "../resolve.js";
import type { PackTable } from "../schema.js";
import {
	columns,
	type PackRows,
	packRow,
	packTable,
	type TableContext,
	type TableSpec,
} from "./support.js";

const MINUTES_PER_DAY = 1440;
const MINUTES_PER_HOUR = 60;
const CLOCK_TIME = /^(\d{1,2}):(\d{2})$/;

export const STORES_SPEC: TableSpec = {
	grain: "store",
	window: null,
	columns: columns([
		["name", "text"],
		["opened_on", "date"],
		["history_start", "date"],
		["history_days", "days"],
		["day_start", "hours"],
		["open_hours_week", "hours"],
		["seats", "count"],
		["e_invoice", "class"],
		["sales_days", "days"],
		["unmatched_days", "days"],
		["unchecked_days", "days"],
		["stale_days", "days"],
		["verified", "flag"],
	]),
};

function minutesOf(time: string): number | null {
	const match = CLOCK_TIME.exec(time);
	if (match === null) return null;
	return Number(match[1]) * MINUTES_PER_HOUR + Number(match[2]);
}

export function weeklyOpeningMinutes(
	hours: StoreProfileRow["opening_hours"],
): number | null {
	if (hours === null) return null;
	let total = 0;
	let spans = 0;
	for (const day of Object.keys(hours).sort()) {
		for (const [open, close] of hours[day] ?? []) {
			const opening = minutesOf(open);
			const closing = minutesOf(close);
			if (opening === null || closing === null) return null;
			spans += 1;
			total +=
				closing > opening
					? closing - opening
					: closing - opening + MINUTES_PER_DAY;
		}
	}
	return spans === 0 ? null : total;
}

export function storesTable(context: TableContext): PackTable {
	const coverageRows = context.results.rows(
		CALL_KEYS.coverage,
		"store_coverage",
	);
	const rows: PackRows = {};
	for (const profile of context.profiles) {
		const coverage = coverageRows.find(
			(row) => row.store_id === profile.store_id,
		);
		const openMinutes = weeklyOpeningMinutes(profile.opening_hours);
		rows[profile.label] = packRow(
			STORES_SPEC,
			[
				profile.name,
				profile.opened_on,
				coverage?.history_start ?? null,
				context.coverage.historyDays(profile.store_id),
				profile.business_day_start_minutes / MINUTES_PER_HOUR,
				openMinutes === null ? null : openMinutes / MINUTES_PER_HOUR,
				profile.seat_count,
				profile.e_invoice_status,
				coverage?.sales_days,
				coverage?.unmatched_days,
				coverage?.unchecked_sales_days,
				coverage?.stale_days,
				coverage === undefined
					? null
					: coverage.unmatched_days === 0 &&
						coverage.unchecked_sales_days === 0,
			],
			context.request.currency,
		);
	}
	return packTable("stores", context, STORES_SPEC, rows);
}
