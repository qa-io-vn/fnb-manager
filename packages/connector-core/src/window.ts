import {
	businessDayEnd,
	businessDayStart,
	type CanonicalStore,
	compareIsoDates,
	isoDatesBetween,
	parseIsoDate,
} from "@fnb/core";
import type { BusinessDateWindow } from "./connector.js";

export interface InstantRange {
	from: Date;
	to: Date;
}

export type StoreDayContext = Pick<
	CanonicalStore,
	"timezone" | "dayStartMinutes"
>;

export function assertWindow(window: BusinessDateWindow): void {
	parseIsoDate(window.fromDate);
	parseIsoDate(window.toDate);
	if (compareIsoDates(window.fromDate, window.toDate) > 0) {
		throw new RangeError(
			`window end "${window.toDate}" is before window start "${window.fromDate}"`,
		);
	}
}

export function windowInstants(
	window: BusinessDateWindow,
	store: StoreDayContext,
): InstantRange {
	assertWindow(window);
	return {
		from: businessDayStart(
			window.fromDate,
			store.timezone,
			store.dayStartMinutes,
		),
		to: businessDayEnd(window.toDate, store.timezone, store.dayStartMinutes),
	};
}

export function windowDates(window: BusinessDateWindow): string[] {
	assertWindow(window);
	return isoDatesBetween(window.fromDate, window.toDate);
}

export function singleDayWindow(date: string): BusinessDateWindow {
	return { fromDate: date, toDate: date };
}

export function splitWindow(
	window: BusinessDateWindow,
	maxDays: number,
): BusinessDateWindow[] {
	if (!Number.isInteger(maxDays) || maxDays < 1) {
		throw new RangeError(`maxDays must be a positive integer, got ${maxDays}`);
	}
	const dates = windowDates(window);
	const chunks: BusinessDateWindow[] = [];
	for (let start = 0; start < dates.length; start += maxDays) {
		const slice = dates.slice(start, start + maxDays);
		const fromDate = slice[0];
		const toDate = slice[slice.length - 1];
		if (fromDate && toDate) {
			chunks.push({ fromDate, toDate });
		}
	}
	return chunks;
}

export function isWithinWindow(
	date: string,
	window: BusinessDateWindow,
): boolean {
	return (
		compareIsoDates(date, window.fromDate) >= 0 &&
		compareIsoDates(date, window.toDate) <= 0
	);
}
