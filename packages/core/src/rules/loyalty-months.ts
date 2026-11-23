import {
	formatIsoDate,
	parseIsoDate,
	shiftIsoDate,
	wallClockIn,
	zonedInstant,
} from "./business-date.js";

/**
 * Adds calendar months to an instant the way PostgreSQL adds
 * `make_interval(months => n)` to a `timestamptz` in a UTC session: the same
 * day of the month and time of day, clamped to the last day of a shorter month
 * (31 October plus six months is 30 April).
 */
export function addMonthsUtc(instant: number, months: number): number {
	const date = new Date(instant);
	const total = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
	const year = Math.floor(total / 12);
	const month = ((total % 12) + 12) % 12;
	const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
	return Date.UTC(
		year,
		month,
		Math.min(date.getUTCDate(), lastDay),
		date.getUTCHours(),
		date.getUTCMinutes(),
		date.getUTCSeconds(),
		date.getUTCMilliseconds(),
	);
}

/**
 * Adds calendar months to an ISO date the way PostgreSQL adds
 * `make_interval(months => n)` to a `date`: the same day of the month, clamped
 * to the last day of a shorter month (31 August plus six months is 28 February,
 * 29 February plus twelve months is 28 February).
 */
export function addMonthsToIsoDate(date: string, months: number): string {
	const { year, month, day } = parseIsoDate(date);
	const total = year * 12 + (month - 1) + months;
	const toYear = Math.floor(total / 12);
	const toMonth = ((total % 12) + 12) % 12;
	const lastDay = new Date(Date.UTC(toYear, toMonth + 1, 0)).getUTCDate();
	return formatIsoDate(toYear, toMonth + 1, Math.min(day, lastDay));
}

/** The local calendar date (ISO) of an instant in a time zone. */
export function localIsoDate(instant: number, timezone: string): string {
	const wall = wallClockIn(new Date(instant), timezone);
	return formatIsoDate(wall.year, wall.month, wall.day);
}

/**
 * ADR-047, `app.loyalty_credit_expires_at`: a credit issued at `from` is valid
 * through its anniversary day, the local date of `from` plus `months` (clamped),
 * so it expires at the local midnight that ends that day.
 */
export function creditExpiresAt(
	from: number,
	months: number,
	timezone: string,
): number {
	const lastDay = addMonthsToIsoDate(localIsoDate(from, timezone), months);
	return zonedInstant(shiftIsoDate(lastDay, 1), 0, timezone).getTime();
}

/**
 * The last day a credit expiring at `expiresAt` is valid: the local date of the
 * last moment before it, as the wallet states it ("valid through 19 Nov 2027").
 */
export function validThrough(expiresAt: number, timezone: string): string {
	return localIsoDate(expiresAt - 1, timezone);
}
