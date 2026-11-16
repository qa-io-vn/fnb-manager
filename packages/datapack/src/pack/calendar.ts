import type { DateRange, IsoDate } from "@fnb/reports";
import { notImplemented } from "./errors.js";
import type { Horizon } from "./request.js";

export const PACK_WINDOWS = [
	"band",
	"horizon",
	"ly28",
	"month_to_date",
	"months",
	"p28",
	"w28",
	"w84",
	"weeks",
] as const;

export type PackWindowName = (typeof PACK_WINDOWS)[number];

export type PackCalendar = Readonly<Record<PackWindowName, DateRange>>;

export function calendarOf(_asOf: IsoDate, _horizon: Horizon): PackCalendar {
	return notImplemented("calendarOf");
}
