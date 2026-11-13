import { formatIsoDate } from "@fnb/core";
import type { IsoDate } from "../contract/values.js";
import { addDays, daysBetween, isoWeekday, yearOf } from "./dates.js";

export interface IsoWeek {
	readonly isoYear: number;
	readonly isoWeek: number;
}

export function isoWeekOf(date: IsoDate): IsoWeek {
	const thursday = addDays(date, 4 - isoWeekday(date));
	const isoYear = yearOf(thursday);
	const dayOfYear = daysBetween(formatIsoDate(isoYear, 1, 1), thursday);
	return { isoYear, isoWeek: Math.floor(dayOfYear / 7) + 1 };
}

export function mondayOfIsoWeek(isoYear: number, isoWeek: number): IsoDate {
	const fourthOfJanuary = formatIsoDate(isoYear, 1, 4);
	const firstMonday = addDays(fourthOfJanuary, 1 - isoWeekday(fourthOfJanuary));
	return addDays(firstMonday, 7 * (isoWeek - 1));
}

export function isoWeeksInYear(isoYear: number): number {
	return isoWeekOf(formatIsoDate(isoYear, 12, 28)).isoWeek;
}

export function mondayOf(date: IsoDate): IsoDate {
	return addDays(date, 1 - isoWeekday(date));
}

export function isoWeekKey(week: IsoWeek): string {
	return `${String(week.isoYear).padStart(4, "0")}-W${String(week.isoWeek).padStart(2, "0")}`;
}
