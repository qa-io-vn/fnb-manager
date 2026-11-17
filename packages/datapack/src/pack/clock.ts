import { wallClockIn } from "@fnb/core";
import { isValidIsoDate } from "@fnb/reports";
import { DataPackError } from "./errors.js";

export interface PackClock {
	now(): Date;
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function generatedAt(clock: PackClock): string {
	const instant = clock.now();
	const text = Number.isNaN(instant.getTime()) ? "" : instant.toISOString();
	if (!INSTANT.test(text)) {
		throw new DataPackError(
			"pack_invalid",
			"the clock gave a time that cannot be written as generated_at",
		);
	}
	return `${text.slice(0, 19)}Z`;
}

const ZONED_INSTANT =
	/^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

export function fixedClock(instant: string): PackClock {
	const day = ZONED_INSTANT.exec(instant)?.[1];
	const time =
		day !== undefined && isValidIsoDate(day)
			? new Date(instant).getTime()
			: Number.NaN;
	if (Number.isNaN(time)) {
		throw new DataPackError(
			"pack_invalid",
			`${instant} is not an ISO time with Z or an offset`,
		);
	}
	return { now: () => new Date(time) };
}

const TIMESTAMP =
	/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:Z|([+-])(\d{2})(?::?(\d{2}))?)$/;
const MILLISECONDS_PER_MINUTE = 60_000;

export function instantMilliseconds(timestamp: string | null): number | null {
	const match = timestamp === null ? null : TIMESTAMP.exec(timestamp);
	if (match === null) return null;
	const [
		,
		year,
		month,
		day,
		hour,
		minute,
		second,
		fraction,
		sign,
		offsetHours,
		offsetMinutes,
	] = match;
	const milliseconds = Number(`${fraction ?? ""}000`.slice(0, 3));
	const local = Date.UTC(
		Number(year),
		Number(month) - 1,
		Number(day),
		Number(hour),
		Number(minute),
		Number(second ?? "0"),
		milliseconds,
	);
	const offset =
		sign === undefined
			? 0
			: (sign === "-" ? -1 : 1) *
				(Number(offsetHours) * 60 + Number(offsetMinutes ?? "0"));
	const time = local - offset * MILLISECONDS_PER_MINUTE;
	return Number.isFinite(time) ? time : null;
}

export function localHourOf(
	timestamp: string | null,
	timezone: string,
): number | null {
	const time = instantMilliseconds(timestamp);
	return time === null ? null : wallClockIn(new Date(time), timezone).hour;
}
