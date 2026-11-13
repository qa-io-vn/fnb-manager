import type { IsoDate } from "../contract/values.js";
import {
	addDays,
	addMonths,
	addYears,
	daysBetween,
	firstOfMonth,
	firstOfYear,
	minDate,
} from "./dates.js";
import { mondayOf } from "./iso-week.js";
import type { ReportKind } from "./periods.js";

export type BoundPeriod = "current" | "previous" | "last_year" | "baseline";

export interface PeriodBound {
	readonly period: BoundPeriod;
	readonly from: IsoDate;
	readonly to: IsoDate;
}

export const BASELINE_WEEKS = 8;
export const LAST_YEAR_DAYS = 364;

interface Starts {
	readonly current: IsoDate;
	readonly previous: IsoDate;
	readonly previousEnd: IsoDate;
	readonly lastYear: IsoDate;
	readonly lastYearEnd: IsoDate;
}

function startsOf(grain: ReportKind, anchor: IsoDate): Starts {
	switch (grain) {
		case "day":
			return {
				current: anchor,
				previous: addDays(anchor, -1),
				previousEnd: addDays(anchor, -1),
				lastYear: addDays(anchor, -LAST_YEAR_DAYS),
				lastYearEnd: addDays(anchor, -LAST_YEAR_DAYS),
			};
		case "week": {
			const current = mondayOf(anchor);
			const previous = addDays(current, -7);
			const lastYear = addDays(current, -LAST_YEAR_DAYS);
			return {
				current,
				previous,
				previousEnd: addDays(previous, 6),
				lastYear,
				lastYearEnd: addDays(lastYear, 6),
			};
		}
		case "month": {
			const current = firstOfMonth(anchor);
			const lastYear = addYears(current, -1);
			return {
				current,
				previous: addMonths(current, -1),
				previousEnd: addDays(current, -1),
				lastYear,
				lastYearEnd: addDays(addMonths(lastYear, 1), -1),
			};
		}
		case "year": {
			const current = firstOfYear(anchor);
			const previous = addYears(current, -1);
			return {
				current,
				previous,
				previousEnd: addDays(current, -1),
				lastYear: previous,
				lastYearEnd: addDays(current, -1),
			};
		}
	}
}

export function periodBounds(
	grain: ReportKind,
	anchor: IsoDate,
): readonly PeriodBound[] {
	const starts = startsOf(grain, anchor);
	const elapsed = daysBetween(starts.current, anchor);
	const bounds: PeriodBound[] = [
		{ period: "current", from: starts.current, to: anchor },
		{
			period: "previous",
			from: starts.previous,
			to: minDate(addDays(starts.previous, elapsed), starts.previousEnd),
		},
		{
			period: "last_year",
			from: starts.lastYear,
			to: minDate(addDays(starts.lastYear, elapsed), starts.lastYearEnd),
		},
	];
	if (grain === "day") {
		bounds.push({
			period: "baseline",
			from: addDays(anchor, -7 * BASELINE_WEEKS),
			to: addDays(anchor, -7),
		});
	}
	return bounds;
}

export function boundOf(
	grain: ReportKind,
	anchor: IsoDate,
	period: BoundPeriod,
): PeriodBound | undefined {
	return periodBounds(grain, anchor).find((bound) => bound.period === period);
}
