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
