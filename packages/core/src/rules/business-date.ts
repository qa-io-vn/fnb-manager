import { ISO_DATE_PATTERN } from "../schemas/iso-date-pattern.js";

export const MINUTES_PER_DAY = 24 * 60;
export const MILLISECONDS_PER_MINUTE = 60_000;
export const MILLISECONDS_PER_DAY = MINUTES_PER_DAY * MILLISECONDS_PER_MINUTE;

export interface WallClock {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
	const cached = formatters.get(timezone);
	if (cached) {
		return cached;
	}
	const formatter = new Intl.DateTimeFormat("en-US", {
		timeZone: timezone,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
	formatters.set(timezone, formatter);
	return formatter;
}

export function assertTimezone(timezone: string): void {
	formatterFor(timezone);
}

const MILLISECONDS_PER_HOUR = 60 * MILLISECONDS_PER_MINUTE;
const LAST_SECOND_OF_HOUR = MILLISECONDS_PER_HOUR - 1000;
const MAX_CACHED_HOURS = 100_000;
const YEAR_100_START_MS = new Date(0).setUTCFullYear(100, 0, 1);
const LAST_REPRESENTABLE_MS = 8.64e15;
const hourOffsets = new Map<string, Map<number, number | null>>();
let cachedHourCount = 0;

function hourOffsetsOf(timezone: string): Map<number, number | null> {
	let offsets = hourOffsets.get(timezone);
	if (offsets === undefined) {
		offsets = new Map();
		hourOffsets.set(timezone, offsets);
	}
	return offsets;
}

function formattedOffset(time: number, timezone: string): number {
	const clock = formattedWallClock(new Date(time), timezone);
	return (
		Date.UTC(
			clock.year,
			clock.month - 1,
			clock.day,
			clock.hour,
			clock.minute,
			clock.second,
		) - time
	);
}

function steadyHourOffset(hour: number, timezone: string): number | null {
	const cached = hourOffsetsOf(timezone).get(hour);
	if (cached !== undefined) return cached;
	const start = hour * MILLISECONDS_PER_HOUR;
	const atStart = formattedOffset(start, timezone);
	const atEnd = formattedOffset(start + LAST_SECOND_OF_HOUR, timezone);
	const offset =
		atStart === atEnd && Math.abs(atStart) < MILLISECONDS_PER_DAY
			? atStart
			: null;
	if (cachedHourCount >= MAX_CACHED_HOURS) {
		hourOffsets.clear();
		cachedHourCount = 0;
	}
	hourOffsetsOf(timezone).set(hour, offset);
	cachedHourCount += 1;
	return offset;
}

export function wallClockIn(instant: Date, timezone: string): WallClock {
	const time = instant.getTime();
	if (!Number.isFinite(time)) return formattedWallClock(instant, timezone);
	const offset = steadyHourOffset(
		Math.floor(time / MILLISECONDS_PER_HOUR),
		timezone,
	);
	if (offset === null) return formattedWallClock(instant, timezone);
	const wall = new Date(time + offset);
	return {
		year: wall.getUTCFullYear(),
		month: wall.getUTCMonth() + 1,
		day: wall.getUTCDate(),
		hour: wall.getUTCHours(),
		minute: wall.getUTCMinutes(),
		second: wall.getUTCSeconds(),
	};
}

export function formattedWallClock(instant: Date, timezone: string): WallClock {
	const parts = formatterFor(timezone).formatToParts(instant);
	const read = (type: Intl.DateTimeFormatPartTypes): number => {
		const part = parts.find((candidate) => candidate.type === type);
		if (!part) {
			throw new RangeError(`Intl did not return a ${type} for ${timezone}`);
		}
		return Number(part.value);
	};
	return {
		year: read("year"),
		month: read("month"),
		day: read("day"),
		hour: read("hour"),
		minute: read("minute"),
		second: read("second"),
	};
}

let lastParsedDate: string | null = null;
let lastParsedYear = 0;
let lastParsedMonth = 0;
let lastParsedDay = 0;

export function parseIsoDate(value: string): {
	year: number;
	month: number;
	day: number;
} {
	if (value === lastParsedDate) {
		return { year: lastParsedYear, month: lastParsedMonth, day: lastParsedDay };
	}
	if (!ISO_DATE_PATTERN.test(value)) {
		throw new RangeError(
			`Expected an ISO calendar date (YYYY-MM-DD), got "${value}"`,
		);
	}
	const [year, month, day] = value.split("-").map(Number) as [
		number,
		number,
		number,
	];
	const roundTrip = new Date(Date.UTC(year, month - 1, day));
	const isReal =
		roundTrip.getUTCFullYear() === year &&
		roundTrip.getUTCMonth() === month - 1 &&
		roundTrip.getUTCDate() === day;
	if (!isReal) {
		throw new RangeError(`"${value}" is not a valid calendar date`);
	}
	lastParsedDate = value;
	lastParsedYear = year;
	lastParsedMonth = month;
	lastParsedDay = day;
	return { year, month, day };
}

export function formatIsoDate(
	year: number,
	month: number,
	day: number,
): string {
	const pad = (value: number, width: number) =>
		String(value).padStart(width, "0");
	return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

export function shiftIsoDate(date: string, days: number): string {
	const { year, month, day } = parseIsoDate(date);
	const shifted = new Date(Date.UTC(year, month - 1, day + days));
	return formatIsoDate(
		shifted.getUTCFullYear(),
		shifted.getUTCMonth() + 1,
		shifted.getUTCDate(),
	);
}

export function compareIsoDates(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function isoDatesBetween(fromDate: string, toDate: string): string[] {
	parseIsoDate(fromDate);
	parseIsoDate(toDate);
	const dates: string[] = [];
	for (
		let cursor = fromDate;
		compareIsoDates(cursor, toDate) <= 0;
		cursor = shiftIsoDate(cursor, 1)
	) {
		dates.push(cursor);
	}
	return dates;
}

function assertDayStart(dayStartMinutes: number): void {
	if (
		!Number.isInteger(dayStartMinutes) ||
		dayStartMinutes < 0 ||
		dayStartMinutes >= MINUTES_PER_DAY
	) {
		throw new RangeError(
			`dayStartMinutes must be an integer between 0 and ${MINUTES_PER_DAY - 1}, got ${dayStartMinutes}`,
		);
	}
}

export function businessDate(
	instant: Date,
	timezone: string,
	dayStartMinutes: number,
): string {
	assertDayStart(dayStartMinutes);
	const clock = wallClockIn(instant, timezone);
	const calendarDate = formatIsoDate(clock.year, clock.month, clock.day);
	const minutesOfDay = clock.hour * 60 + clock.minute;
	return minutesOfDay < dayStartMinutes
		? shiftIsoDate(calendarDate, -1)
		: calendarDate;
}

function wallClockAsUtc(instant: Date, timezone: string): number {
	const time = instant.getTime();
	if (Number.isFinite(time)) {
		const offset = steadyHourOffset(
			Math.floor(time / MILLISECONDS_PER_HOUR),
			timezone,
		);
		const wallTime = offset === null ? Number.NaN : time + offset;
		if (wallTime >= YEAR_100_START_MS && wallTime <= LAST_REPRESENTABLE_MS) {
			return Math.floor(wallTime / 1000) * 1000;
		}
	}
	const clock = wallClockIn(instant, timezone);
	return Date.UTC(
		clock.year,
		clock.month - 1,
		clock.day,
		clock.hour,
		clock.minute,
		clock.second,
	);
}

export function zonedInstant(
	date: string,
	minutesOfDay: number,
	timezone: string,
): Date {
	const { year, month, day } = parseIsoDate(date);
	const wallClockUtc = Date.UTC(year, month - 1, day, 0, minutesOfDay);
	const guess = new Date(wallClockUtc);
	const firstOffset = wallClockAsUtc(guess, timezone) - guess.getTime();
	const candidate = new Date(wallClockUtc - firstOffset);
	const secondOffset =
		wallClockAsUtc(candidate, timezone) - candidate.getTime();
	return secondOffset === firstOffset
		? candidate
		: new Date(wallClockUtc - secondOffset);
}

export function businessDayStart(
	date: string,
	timezone: string,
	dayStartMinutes: number,
): Date {
	assertDayStart(dayStartMinutes);
	return zonedInstant(date, dayStartMinutes, timezone);
}

export function businessDayEnd(
	date: string,
	timezone: string,
	dayStartMinutes: number,
): Date {
	const nextStart = businessDayStart(
		shiftIsoDate(date, 1),
		timezone,
		dayStartMinutes,
	);
	return new Date(nextStart.getTime() - 1);
}

export function instantOnBusinessDate(
	date: string,
	minutesOfDay: number,
	timezone: string,
	dayStartMinutes: number,
): Date {
	assertDayStart(dayStartMinutes);
	const calendarDate =
		minutesOfDay < dayStartMinutes ? shiftIsoDate(date, 1) : date;
	return zonedInstant(calendarDate, minutesOfDay, timezone);
}
