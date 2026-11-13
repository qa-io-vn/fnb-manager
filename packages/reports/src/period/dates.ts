import { formatIsoDate, parseIsoDate, shiftIsoDate } from "@fnb/core";
import type { IsoDate } from "../contract/values.js";

const MILLISECONDS_PER_DAY = 86_400_000;

function utcTime(date: IsoDate): number {
	const { year, month, day } = parseIsoDate(date);
	return Date.UTC(year, month - 1, day);
}

export function addDays(date: IsoDate, days: number): IsoDate {
	return days === 0 ? date : shiftIsoDate(date, days);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
	return Math.round((utcTime(to) - utcTime(from)) / MILLISECONDS_PER_DAY);
}

export function isoWeekday(date: IsoDate): number {
	const day = new Date(utcTime(date)).getUTCDay();
	return day === 0 ? 7 : day;
}

export function minDate(left: IsoDate, right: IsoDate): IsoDate {
	return left <= right ? left : right;
}

export function maxDate(left: IsoDate, right: IsoDate): IsoDate {
	return left >= right ? left : right;
}

export function yearOf(date: IsoDate): number {
	return parseIsoDate(date).year;
}

export function monthOf(date: IsoDate): number {
	return parseIsoDate(date).month;
}

export function firstOfMonth(date: IsoDate): IsoDate {
	const { year, month } = parseIsoDate(date);
	return formatIsoDate(year, month, 1);
}

export function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function lastOfMonth(date: IsoDate): IsoDate {
	const { year, month } = parseIsoDate(date);
	return formatIsoDate(year, month, daysInMonth(year, month));
}

export function addMonths(date: IsoDate, months: number): IsoDate {
	const { year, month, day } = parseIsoDate(date);
	const index = year * 12 + (month - 1) + months;
	const targetYear = Math.floor(index / 12);
	const targetMonth = index - targetYear * 12 + 1;
	return formatIsoDate(
		targetYear,
		targetMonth,
		Math.min(day, daysInMonth(targetYear, targetMonth)),
	);
}

export function addYears(date: IsoDate, years: number): IsoDate {
	return addMonths(date, years * 12);
}

export function firstOfYear(date: IsoDate): IsoDate {
	return formatIsoDate(yearOf(date), 1, 1);
}

export function lastOfYear(date: IsoDate): IsoDate {
	return formatIsoDate(yearOf(date), 12, 31);
}

export function datesBetween(from: IsoDate, to: IsoDate): IsoDate[] {
	const dates: IsoDate[] = [];
	for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) {
		dates.push(cursor);
	}
	return dates;
}

export function isValidIsoDate(value: string): boolean {
	try {
		parseIsoDate(value);
		return true;
	} catch {
		return false;
	}
}
