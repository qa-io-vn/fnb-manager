import type { DateRange, IsoDate } from "../../contract/values.js";
import type {
	Comparison,
	ComparisonBasis,
	UnavailableReason,
} from "../../model/card.js";
import { comparison, noCoverageReason } from "../../model/comparison.js";
import type { Coverage, CoverageModel } from "../../model/coverage.js";
import { reportKeys } from "../../model/keys.js";
import { ratio, roundHalfAwayFromZero } from "../../model/numeric.js";
import { numberValue, part, type SentencePart } from "../../model/values.js";
import { addDays, daysBetween } from "../../period/dates.js";
import type { ReportPeriod } from "../../period/periods.js";
import { weekKeys } from "./keys.js";
import type { DayRow, WeekDays } from "./support.js";

export const SKIP_TET_WEEKS = true;
export const AVERAGE_WEEKS = 4;
export const MIN_AVERAGE_WEEKS = 2;
const COVERAGE_LEAD_DAYS = 7 * AVERAGE_WEEKS;
const MINOR_UNITS = 100;
const QUANTITY_UNITS = 1000;

export interface AverageWeek {
	readonly weeksBack: number;
	readonly from: IsoDate;
	readonly to: IsoDate;
}

export interface AverageValues {
	readonly net: number | null;
	readonly invoices: number | null;
	readonly avgTicket: number | null;
	readonly itemsPerTicket: number | null;
	readonly avgItemPrice: number | null;
}

export type AverageMetric = "net" | "invoices" | "avgTicket";

export interface WeekdayAverage {
	readonly net: number | null;
	readonly invoices: number | null;
}

export interface FourWeekAverage {
	readonly coverageFrom: IsoDate;
	readonly coverage: Coverage;
	readonly storeIds: readonly string[];
	readonly basis: ComparisonBasis;
	readonly candidates: readonly AverageWeek[];
	readonly weeks: readonly AverageWeek[];
	readonly skippedWeeks: readonly AverageWeek[];
	readonly unavailable: UnavailableReason | null;
	readonly range: DateRange | null;
	readonly reference: AverageValues;
	readonly current: AverageValues;
	weekday(isoWeekday: number): WeekdayAverage;
	forStore(storeId: string): AverageValues;
}

interface Sums {
	readonly netMinor: number;
	readonly invoices: number;
	readonly itemsMilli: number;
	readonly present: boolean;
}

const EMPTY_SUMS: Sums = {
	netMinor: 0,
	invoices: 0,
	itemsMilli: 0,
	present: false,
};

export const NO_VALUES: AverageValues = {
	net: null,
	invoices: null,
	avgTicket: null,
	itemsPerTicket: null,
	avgItemPrice: null,
};

export function averageWeeks(
	period: Pick<ReportPeriod, "from" | "end">,
): readonly AverageWeek[] {
	const elapsed = daysBetween(period.from, period.end);
	return Array.from({ length: AVERAGE_WEEKS }, (_, index) => {
		const weeksBack = index + 1;
		const from = addDays(period.from, -7 * weeksBack);
		return { weeksBack, from, to: addDays(from, elapsed) };
	});
}

export function averageCoverageFrom(
	period: Pick<ReportPeriod, "from">,
): IsoDate {
	return addDays(period.from, -COVERAGE_LEAD_DAYS);
}

export function holdsTet(week: AverageWeek, days: WeekDays): boolean {
	for (let date = week.from; date <= week.to; date = addDays(date, 1)) {
		if (days.holidayKind(date) === "tet") return true;
	}
	return false;
}

function hasData(row: DayRow | undefined): row is DayRow {
	return row !== undefined && row.days_with_data > 0;
}

function addSums(left: Sums, right: Sums): Sums {
	return {
		netMinor: left.netMinor + right.netMinor,
		invoices: left.invoices + right.invoices,
		itemsMilli: left.itemsMilli + right.itemsMilli,
		present: left.present || right.present,
	};
}

function sumsOn(
	days: WeekDays,
	storeIds: readonly string[],
	date: IsoDate,
): Sums {
	let sums = EMPTY_SUMS;
	for (const storeId of storeIds) {
		const row = days.store(storeId, date);
		if (!hasData(row)) continue;
		sums = addSums(sums, {
			netMinor: Math.round((row.net_amount ?? 0) * MINOR_UNITS),
			invoices: row.invoices ?? 0,
			itemsMilli: Math.round((row.items_sold ?? 0) * QUANTITY_UNITS),
			present: true,
		});
	}
	return sums;
}

function sumsOver(
	days: WeekDays,
	storeIds: readonly string[],
	from: IsoDate,
	to: IsoDate,
): Sums {
	let sums = EMPTY_SUMS;
	for (let date = from; date <= to; date = addDays(date, 1)) {
		sums = addSums(sums, sumsOn(days, storeIds, date));
	}
	return sums;
}

function money(minor: number): number {
	return minor / MINOR_UNITS;
}

function meanMoney(minors: readonly number[]): number | null {
	if (minors.length === 0) return null;
	const total = minors.reduce((sum, value) => sum + value, 0);
	return money(roundHalfAwayFromZero(total / minors.length, 0));
}

function meanCount(values: readonly number[]): number | null {
	if (values.length === 0) return null;
	const total = values.reduce((sum, value) => sum + value, 0);
	return ratio(total, values.length, 2);
}

function pooled(weeks: readonly Sums[]): AverageValues {
	if (weeks.length === 0) return NO_VALUES;
	const total = weeks.reduce(addSums, EMPTY_SUMS);
	const net = money(total.netMinor);
	const items = total.itemsMilli / QUANTITY_UNITS;
	return {
		net: meanMoney(weeks.map((week) => week.netMinor)),
		invoices: meanCount(weeks.map((week) => week.invoices)),
		avgTicket: ratio(net, total.invoices, 2),
		itemsPerTicket: ratio(items, total.invoices, 4),
		avgItemPrice: ratio(net, items, 2),
	};
}

function valuesOf(sums: Sums): AverageValues {
	if (!sums.present) return NO_VALUES;
	const net = money(sums.netMinor);
	const items = sums.itemsMilli / QUANTITY_UNITS;
	return {
		net,
		invoices: sums.invoices,
		avgTicket: ratio(net, sums.invoices, 2),
		itemsPerTicket: ratio(items, sums.invoices, 4),
		avgItemPrice: ratio(net, items, 2),
	};
}

export function fourWeekAverage(input: {
	readonly period: Pick<ReportPeriod, "from" | "end">;
	readonly coverage: CoverageModel;
	readonly days: WeekDays;
}): FourWeekAverage {
	const { period, coverage, days } = input;
	const coverageFrom = averageCoverageFrom(period);
	const covered = coverage.forReference(coverageFrom);
	const storeIds = covered.coveredStoreIds;
	const candidates = averageWeeks(period);
	const weeks = candidates.filter(
		(week) => !(SKIP_TET_WEEKS && holdsTet(week, days)),
	);
	const skippedWeeks = candidates.filter((week) => !weeks.includes(week));
	const unavailable: UnavailableReason | null =
		covered.state === "none"
			? noCoverageReason(coverage, covered.youngStoreIds, coverageFrom)
			: weeks.length < MIN_AVERAGE_WEEKS
				? "no_reference"
				: null;
	const usable = unavailable === null;
	const weekSums = (ids: readonly string[]) =>
		weeks.map((week) => sumsOver(days, ids, week.from, week.to));
	const range =
		weeks.length === 0
			? null
			: {
					from: weeks[weeks.length - 1]?.from ?? coverageFrom,
					to: weeks[0]?.to ?? period.end,
				};
	return {
		coverageFrom,
		coverage: covered,
		storeIds,
		basis: covered.state === "partial" ? "like_for_like" : "all_stores",
		candidates,
		weeks,
		skippedWeeks,
		unavailable,
		range,
		reference: usable ? pooled(weekSums(storeIds)) : NO_VALUES,
		current: valuesOf(sumsOver(days, storeIds, period.from, period.end)),
		weekday(isoWeekday) {
			if (!usable) return { net: null, invoices: null };
			const sums = weeks.map((week) =>
				sumsOn(days, storeIds, addDays(week.from, isoWeekday - 1)),
			);
			return {
				net: meanMoney(sums.map((entry) => entry.netMinor)),
				invoices: meanCount(sums.map((entry) => entry.invoices)),
			};
		},
		forStore(storeId) {
			if (!usable || !storeIds.includes(storeId)) return NO_VALUES;
			return pooled(weekSums([storeId]));
		},
	};
}

export function averageLabel(average: FourWeekAverage): SentencePart {
	const weeks = numberValue("count", average.weeks.length);
	if (average.basis === "like_for_like") {
		return part(weekKeys.compare.average4WeeksLikeForLike, {
			weeks,
			covered: numberValue("count", average.storeIds.length),
			total: numberValue("count", average.coverage.storeCount),
		});
	}
	return part(reportKeys.compare.average4Weeks, { weeks });
}

export function fourWeekComparison(
	average: FourWeekAverage,
	metric: AverageMetric,
	allStoresCurrent: number | null,
): Comparison {
	const current =
		average.basis === "like_for_like"
			? average.current[metric]
			: allStoresCurrent;
	return comparison({
		kind: "average_4_weeks",
		label: averageLabel(average),
		range: average.range,
		current,
		reference: average.reference[metric],
		basis: average.basis,
		coveredStores: average.unavailable === null ? average.storeIds.length : 0,
		totalStores: average.coverage.storeCount,
		unavailable: average.unavailable,
	});
}
