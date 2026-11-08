import { formatIsoDate, wallClockIn, zonedInstant } from "@fnb/core";

export const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;
export const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
export const VIETNAM_TIMEZONE = "Asia/Ho_Chi_Minh";

export interface EpochMsRange {
	startDate: number;
	endDate: number;
}

function nextCalendarMonthStart(epochMs: number, timezone: string): number {
	const clock = wallClockIn(new Date(epochMs), timezone);
	const year = clock.month === 12 ? clock.year + 1 : clock.year;
	const month = clock.month === 12 ? 1 : clock.month + 1;
	return zonedInstant(formatIsoDate(year, month, 1), 0, timezone).getTime();
}

export function splitRangeByCalendarMonth(
	range: EpochMsRange,
	timezone: string = VIETNAM_TIMEZONE,
): EpochMsRange[] {
	if (range.endDate < range.startDate) {
		throw new RangeError(
			`Range end ${range.endDate} is before range start ${range.startDate}`,
		);
	}
	const ranges: EpochMsRange[] = [];
	let cursor = range.startDate;
	while (cursor <= range.endDate) {
		const nextMonth = nextCalendarMonthStart(cursor, timezone);
		ranges.push({
			startDate: cursor,
			endDate: Math.min(range.endDate, nextMonth - 1),
		});
		cursor = nextMonth;
	}
	return ranges;
}

export function sameCalendarMonth(
	range: EpochMsRange,
	timezone: string = VIETNAM_TIMEZONE,
): boolean {
	const start = wallClockIn(new Date(range.startDate), timezone);
	const end = wallClockIn(new Date(range.endDate), timezone);
	return start.year === end.year && start.month === end.month;
}

const isoCalendarDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

export function vietnamMidnight(dateISO: string): number {
	const match = isoCalendarDatePattern.exec(dateISO);
	if (!match) {
		throw new RangeError(
			`Expected an ISO calendar date (YYYY-MM-DD), got "${dateISO}"`,
		);
	}
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const utcMidnight = Date.UTC(year, month - 1, day);
	const roundTrip = new Date(utcMidnight);
	const isRealCalendarDate =
		roundTrip.getUTCFullYear() === year &&
		roundTrip.getUTCMonth() === month - 1 &&
		roundTrip.getUTCDate() === day;
	if (!isRealCalendarDate) {
		throw new RangeError(`"${dateISO}" is not a valid calendar date`);
	}
	return utcMidnight - VIETNAM_UTC_OFFSET_MS;
}

export function vietnamDayRange(dateISO: string): EpochMsRange {
	const startDate = vietnamMidnight(dateISO);
	return { startDate, endDate: startDate + MILLISECONDS_PER_DAY - 1 };
}

export function vietnamRange(fromISO: string, toISO: string): EpochMsRange {
	const startDate = vietnamMidnight(fromISO);
	const endDate = vietnamMidnight(toISO) + MILLISECONDS_PER_DAY - 1;
	if (endDate < startDate) {
		throw new RangeError(
			`Range end "${toISO}" is before range start "${fromISO}"`,
		);
	}
	return { startDate, endDate };
}

export function vietnamDateISO(epochMs: number): string {
	const shifted = new Date(epochMs + VIETNAM_UTC_OFFSET_MS);
	const year = String(shifted.getUTCFullYear()).padStart(4, "0");
	const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
	const day = String(shifted.getUTCDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

export function vietnamDaysAgo(days: number, now: number = Date.now()): string {
	return vietnamDateISO(now - days * MILLISECONDS_PER_DAY);
}
