// Times at the counter are Vietnam time (UTC+7, no daylight saving), written without Intl so a test writes what a
// tablet writes: "14:05", "27/11/2026", "27/11 14:05".

export const VIETNAM_OFFSET_MS = 7 * 3_600_000;

function two(value: number): string {
	return String(value).padStart(2, "0");
}

function shifted(at: Date | string | number): Date {
	const time =
		at instanceof Date
			? at.getTime()
			: typeof at === "number"
				? at
				: Date.parse(at);
	if (!Number.isFinite(time)) throw new RangeError(`not a time: ${String(at)}`);
	return new Date(time + VIETNAM_OFFSET_MS);
}

/** "14:05" */
export function clockOf(at: Date | string | number): string {
	const local = shifted(at);
	return `${two(local.getUTCHours())}:${two(local.getUTCMinutes())}`;
}

/** "2026-11-27", the calendar date in Vietnam */
export function vietnamDate(at: Date | string | number): string {
	const local = shifted(at);
	return `${local.getUTCFullYear()}-${two(local.getUTCMonth() + 1)}-${two(local.getUTCDate())}`;
}

/** "27/11 14:05" */
export function dayAndClock(at: Date | string | number): string {
	const local = shifted(at);
	return `${two(local.getUTCDate())}/${two(local.getUTCMonth() + 1)} ${clockOf(at)}`;
}

/** Whole minutes from `since` to `now`, never below 0. */
export function minutesBetween(since: string | number, now: number): number {
	const start = typeof since === "number" ? since : Date.parse(since);
	if (!Number.isFinite(start)) return 0;
	return Math.max(0, Math.floor((now - start) / 60_000));
}

/** The first day of the month of an ISO date: "2026-11-27" is "2026-11-01". */
export function monthOf(isoDate: string): string {
	return `${isoDate.slice(0, 7)}-01`;
}

/** An ISO date moved by whole days. */
export function addDays(isoDate: string, days: number): string {
	const date = new Date(`${isoDate}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}
