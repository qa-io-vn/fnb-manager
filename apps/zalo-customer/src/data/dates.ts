import {
	CLAIM_WINDOW_HOURS,
	type IsoDate,
	WEEKDAYS,
	type Weekday,
} from "@fnb/zalo-mini/loyalty";

export const SHOP_TIME_ZONE = "Asia/Ho_Chi_Minh";
const DAY_MS = 86_400_000;

export function isoDateIn(
	instant: number,
	timeZone: string = SHOP_TIME_ZONE,
): IsoDate {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(new Date(instant));
	const part = (type: string) =>
		parts.find((entry) => entry.type === type)?.value ?? "";
	return `${part("year")}-${part("month")}-${part("day")}`;
}

export function addDays(date: IsoDate, days: number): IsoDate {
	const at = Date.parse(`${date}T00:00:00Z`) + days * DAY_MS;
	return new Date(at).toISOString().slice(0, 10);
}

/**
 * A date plus calendar months, clamped to the last day of a shorter month the
 * way PostgreSQL adds months to a date (31 August plus six months is 28
 * February).
 */
export function addMonths(date: IsoDate, months: number): IsoDate {
	const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
	const total = year * 12 + (month - 1) + months;
	const toYear = Math.floor(total / 12);
	const toMonth = ((total % 12) + 12) % 12;
	const lastDay = new Date(Date.UTC(toYear, toMonth + 1, 0)).getUTCDate();
	return new Date(Date.UTC(toYear, toMonth, Math.min(day, lastDay)))
		.toISOString()
		.slice(0, 10);
}

/** The instant of the local midnight that starts a date in the shop's time zone. */
export function localMidnight(
	date: IsoDate,
	timeZone: string = SHOP_TIME_ZONE,
): number {
	const utc = Date.parse(`${date}T00:00:00Z`);
	const shown = Date.parse(`${isoDateIn(utc, timeZone)}T00:00:00Z`);
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone,
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	})
		.formatToParts(new Date(utc))
		.reduce<Record<string, number>>((all, part) => {
			all[part.type] = Number(part.value);
			return all;
		}, {});
	const offset =
		shown - utc + ((parts.hour ?? 0) * 60 + (parts.minute ?? 0)) * 60_000;
	return utc - offset;
}

/**
 * ADR-047: a credit issued at an instant is valid through the local date of it
 * plus the programme's months and ends at the local midnight closing that day.
 */
export function creditEnd(
	issuedAt: number,
	months: number,
	timeZone: string = SHOP_TIME_ZONE,
): { readonly validThrough: IsoDate; readonly expiresAt: number } {
	const validThrough = addMonths(isoDateIn(issuedAt, timeZone), months);
	return {
		validThrough,
		expiresAt: localMidnight(addDays(validThrough, 1), timeZone),
	};
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
	return Math.round(
		(Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
	);
}

export function weekdayOf(date: IsoDate): Weekday {
	const index = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
	return WEEKDAYS[index] ?? "mon";
}

export function claimDates(
	now: number,
	windowHours: number = CLAIM_WINDOW_HOURS,
): readonly IsoDate[] {
	const today = isoDateIn(now);
	const days = Math.max(
		0,
		daysBetween(isoDateIn(now - windowHours * 3_600_000), today),
	);
	return Array.from({ length: days + 1 }, (_, index) => addDays(today, -index));
}

export function shownDate(date: IsoDate): string {
	const [year, month, day] = date.split("-");
	return `${day}/${month}/${year}`;
}

export function shownTime(
	instant: number,
	timeZone: string = SHOP_TIME_ZONE,
): string {
	return new Intl.DateTimeFormat("en-GB", {
		timeZone,
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	}).format(new Date(instant));
}

export function shownInstant(
	iso: string,
	timeZone: string = SHOP_TIME_ZONE,
): string {
	const instant = Date.parse(iso);
	if (Number.isNaN(instant)) return "";
	const time = new Intl.DateTimeFormat("en-GB", {
		timeZone,
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).format(new Date(instant));
	return `${time} ${shownDate(isoDateIn(instant, timeZone))}`;
}
