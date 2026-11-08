import {
	businessDate,
	businessDayStart,
	compareIsoDates,
	MILLISECONDS_PER_MINUTE,
	shiftIsoDate,
	wallClockIn,
} from "@fnb/core";

export type IsoDate = string;

export { compareIsoDates };

export interface StoreClock {
	timeZone: string;
	businessDayStartMinutes: number;
}

export function addDays(isoDate: IsoDate, days: number): IsoDate {
	return shiftIsoDate(isoDate, days);
}

export function dateFromIso(isoDate: IsoDate): Date {
	return new Date(`${isoDate}T00:00:00Z`);
}

export function isoWeekday(isoDate: IsoDate): number {
	const sundayBased = dateFromIso(isoDate).getUTCDay();
	return sundayBased === 0 ? 7 : sundayBased;
}

export function sameWeekdayHistory(isoDate: IsoDate, weeks: number): IsoDate[] {
	return Array.from({ length: weeks }, (_, index) =>
		addDays(isoDate, -7 * (index + 1)),
	);
}

export function businessDateOf(instant: Date, clock: StoreClock): IsoDate {
	return businessDate(instant, clock.timeZone, clock.businessDayStartMinutes);
}

const MILLISECONDS_PER_SECOND = 1_000;
const MILLISECONDS_PER_HOUR = 60 * MILLISECONDS_PER_MINUTE;
const MILLISECONDS_PER_UTC_DAY = 24 * MILLISECONDS_PER_HOUR;
const MEMO_LIMIT = 4_096;

function remembered<Value>(
	memo: Map<string, Value>,
	key: string,
	compute: () => Value,
): Value {
	if (memo.has(key)) return memo.get(key) as Value;
	if (memo.size >= MEMO_LIMIT) memo.clear();
	const value = compute();
	memo.set(key, value);
	return value;
}

const businessDayStarts = new Map<string, number>();

export function businessDayStartOf(date: IsoDate, clock: StoreClock): Date {
	const key = `${clock.timeZone}|${clock.businessDayStartMinutes}|${date}`;
	return new Date(
		remembered(businessDayStarts, key, () =>
			businessDayStart(
				date,
				clock.timeZone,
				clock.businessDayStartMinutes,
			).getTime(),
		),
	);
}

export function minutesIntoBusinessDay(
	instant: Date,
	date: IsoDate,
	clock: StoreClock,
): number {
	return (
		(instant.getTime() - businessDayStartOf(date, clock).getTime()) /
		MILLISECONDS_PER_MINUTE
	);
}

function utcOffsetAt(instantMs: number, timeZone: string): number {
	const wall = wallClockIn(new Date(instantMs), timeZone);
	const wallAsUtc = Date.UTC(
		wall.year,
		wall.month - 1,
		wall.day,
		wall.hour,
		wall.minute,
		wall.second,
	);
	const wholeSeconds =
		Math.floor(instantMs / MILLISECONDS_PER_SECOND) * MILLISECONDS_PER_SECOND;
	return wallAsUtc - wholeSeconds;
}

const steadyUtcOffsets = new Map<string, number | null>();

function steadyOffsetOnUtcDay(utcDay: number, timeZone: string): number | null {
	return remembered(steadyUtcOffsets, `${timeZone}|${utcDay}`, () => {
		const dayStart = utcDay * MILLISECONDS_PER_UTC_DAY;
		const atStart = utcOffsetAt(dayStart, timeZone);
		const atEnd = utcOffsetAt(
			dayStart + MILLISECONDS_PER_UTC_DAY - MILLISECONDS_PER_SECOND,
			timeZone,
		);
		return atStart === atEnd ? atStart : null;
	});
}

export function localHourOf(instant: Date, timeZone: string): number {
	const instantMs = instant.getTime();
	const offset = steadyOffsetOnUtcDay(
		Math.floor(instantMs / MILLISECONDS_PER_UTC_DAY),
		timeZone,
	);
	if (offset === null) return wallClockIn(instant, timeZone).hour;
	const localMs = instantMs + offset;
	const intoLocalDay =
		((localMs % MILLISECONDS_PER_UTC_DAY) + MILLISECONDS_PER_UTC_DAY) %
		MILLISECONDS_PER_UTC_DAY;
	return Math.floor(intoLocalDay / MILLISECONDS_PER_HOUR);
}

export function todayIn(timeZone: string, now: Date): IsoDate {
	return businessDate(now, timeZone, 0);
}

export function isIsoDate(value: unknown): value is IsoDate {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return false;
	}
	const parsed = dateFromIso(value);
	return (
		!Number.isNaN(parsed.getTime()) &&
		parsed.toISOString().slice(0, 10) === value
	);
}
