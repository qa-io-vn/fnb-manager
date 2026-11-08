import { businessDate, MILLISECONDS_PER_DAY, shiftIsoDate } from "@fnb/core";

export const STATUS_WINDOW_DAYS = 14;

export interface StatusWindow {
	days: number;
	since: Date;
	until: Date;
}

export interface StoreClock {
	timezone: string;
	business_day_start_minutes: number;
}

export interface StoreDayRange {
	fromDate: string;
	toDate: string;
}

export function statusWindow(
	now: Date,
	days: number = STATUS_WINDOW_DAYS,
): StatusWindow {
	return {
		days,
		since: new Date(now.getTime() - days * MILLISECONDS_PER_DAY),
		until: now,
	};
}

export function closedStoreDays(
	window: StatusWindow,
	store: StoreClock,
): StoreDayRange {
	const openDay = businessDate(
		window.until,
		store.timezone,
		store.business_day_start_minutes,
	);
	return {
		fromDate: shiftIsoDate(openDay, -window.days),
		toDate: shiftIsoDate(openDay, -1),
	};
}
