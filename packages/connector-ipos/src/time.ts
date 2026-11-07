export const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;
export const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

export interface EpochMsRange {
	startDate: number;
	endDate: number;
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
