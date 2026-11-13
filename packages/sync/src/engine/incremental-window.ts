import type { BusinessDateWindow } from "@fnb/connector-core";
import { businessDate, shiftIsoDate } from "@fnb/core";
import type { StoreRecord } from "../rows.js";

export const INCREMENTAL_DAYS = 3;

export type StoreDay = Pick<
	StoreRecord,
	"timezone" | "business_day_start_minutes"
>;

export function incrementalWindow(
	store: StoreDay,
	at: Date,
	days: number = INCREMENTAL_DAYS,
): BusinessDateWindow {
	if (!Number.isInteger(days) || days < 1) {
		throw new RangeError(
			`an incremental window covers a whole number of days from 1, got ${days}`,
		);
	}
	const today = businessDate(
		at,
		store.timezone,
		store.business_day_start_minutes,
	);
	return { fromDate: shiftIsoDate(today, -(days - 1)), toDate: today };
}
