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
