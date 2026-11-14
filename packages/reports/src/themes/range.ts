import type { DateRange, IsoDate } from "../contract/values.js";
import { boundOf, LAST_YEAR_DAYS } from "../period/bounds.js";
import {
	addDays,
	addMonths,
	addYears,
	daysBetween,
	firstOfMonth,
	firstOfYear,
	isValidIsoDate,
	lastOfMonth,
	lastOfYear,
	minDate,
} from "../period/dates.js";
import { FIRST_CALENDAR_DATE } from "../period/periods.js";

export type RollingPreset = "7d" | "28d" | "91d" | "364d";
export type CalendarPreset = "this_month" | "last_month" | "this_year";
export type NamedPreset = RollingPreset | CalendarPreset;
export type RangePreset = NamedPreset | "custom";

export const ROLLING_PRESET_DAYS: Readonly<Record<RollingPreset, number>> = {
	"7d": 7,
	"28d": 28,
	"91d": 91,
	"364d": 364,
};

export const NAMED_PRESETS: readonly NamedPreset[] = [
	"7d",
	"28d",
	"91d",
	"364d",
	"this_month",
	"last_month",
	"this_year",
];

export const MAX_THEME_RANGE_DAYS = 400;
export const SHIFT_THEME_RANGE_DAYS = 92;
export const SERIES_ROW_LIMIT = 900;

export interface ReportRange {
	readonly preset: RangePreset;
	readonly key: string;
	readonly from: IsoDate;
	readonly to: IsoDate;
	readonly asOf: IsoDate;
	readonly days: number;
	readonly previous: DateRange;
	readonly lastYear: DateRange | null;
}

export function isNamedPreset(value: string): value is NamedPreset {
	return (NAMED_PRESETS as readonly string[]).includes(value);
}

function isRolling(preset: NamedPreset): preset is RollingPreset {
	return Object.hasOwn(ROLLING_PRESET_DAYS, preset);
}

export function rangeDays(range: DateRange): number {
	return daysBetween(range.from, range.to) + 1;
}

function shifted(range: DateRange, days: number): DateRange {
	return { from: addDays(range.from, days), to: addDays(range.to, days) };
}

function justBefore(range: DateRange): DateRange {
	return shifted(range, -rangeDays(range));
}

function build(
	preset: RangePreset,
	span: DateRange,
	asOf: IsoDate,
	previous: DateRange,
	lastYear: DateRange | null,
): ReportRange {
	return {
		preset,
		key: `${span.from}_${span.to}`,
		from: span.from,
		to: span.to,
		asOf,
		days: rangeDays(span),
		previous,
		lastYear,
	};
}

function boundRange(
	grain: "month" | "year",
	anchor: IsoDate,
	period: "previous" | "last_year",
): DateRange {
	const bound = boundOf(grain, anchor, period);
	if (bound === undefined) {
		throw new Error(`no ${period} bound for ${grain} ${anchor}`);
	}
	return { from: bound.from, to: bound.to };
}

function wholeMonth(first: IsoDate): DateRange {
	return { from: first, to: lastOfMonth(first) };
}

export function rangeOfPreset(preset: NamedPreset, asOf: IsoDate): ReportRange {
	if (isRolling(preset)) {
		const days = ROLLING_PRESET_DAYS[preset];
		const span = { from: addDays(asOf, -(days - 1)), to: asOf };
		const lastYear =
			days === LAST_YEAR_DAYS ? null : shifted(span, -LAST_YEAR_DAYS);
		return build(preset, span, asOf, justBefore(span), lastYear);
	}
	switch (preset) {
		case "this_month":
			return build(
				preset,
				{ from: firstOfMonth(asOf), to: asOf },
				asOf,
				boundRange("month", asOf, "previous"),
				boundRange("month", asOf, "last_year"),
			);
		case "last_month": {
			const first = addMonths(firstOfMonth(asOf), -1);
			return build(
				preset,
				wholeMonth(first),
				asOf,
				wholeMonth(addMonths(first, -1)),
				wholeMonth(addYears(first, -1)),
			);
		}
		case "this_year":
			return build(
				preset,
				{ from: firstOfYear(asOf), to: asOf },
				asOf,
				boundRange("year", asOf, "previous"),
				null,
			);
	}
}

function matchingPreset(span: DateRange, asOf: IsoDate): ReportRange | null {
	for (const preset of NAMED_PRESETS) {
		const candidate = rangeOfPreset(preset, asOf);
		if (candidate.from === span.from && candidate.to === span.to) {
			return candidate;
		}
	}
	return null;
}

export function customRange(
	from: IsoDate,
	to: IsoDate,
	asOf: IsoDate,
): ReportRange {
	const span = { from, to };
	return build(
		"custom",
		span,
		asOf,
		justBefore(span),
		shifted(span, -LAST_YEAR_DAYS),
	);
}

export function rangeOf(
	from: IsoDate,
	to: IsoDate,
	asOf: IsoDate,
): ReportRange {
	return matchingPreset({ from, to }, asOf) ?? customRange(from, to, asOf);
}

export interface RangeRequest {
	readonly preset?: string | null;
	readonly from?: string | null;
	readonly to?: string | null;
}

export interface RangeLimits {
	readonly defaultPreset: NamedPreset;
	readonly maxDays: number;
}

export interface ResolvedRange {
	readonly range: ReportRange;
	readonly rangeClamped: boolean;
	readonly todayClamped: boolean;
	readonly invalid: boolean;
}

function withinLimit(
	span: DateRange,
	asOf: IsoDate,
	maxDays: number,
	flags: { todayClamped: boolean; invalid: boolean },
): ResolvedRange {
	const tooLong = rangeDays(span) > maxDays;
	const from = tooLong ? addDays(span.to, -(maxDays - 1)) : span.from;
	return {
		range: rangeOf(from, span.to, asOf),
		rangeClamped: tooLong,
		todayClamped: flags.todayClamped,
		invalid: flags.invalid,
	};
}

function defaultRange(
	asOf: IsoDate,
	limits: RangeLimits,
	invalid: boolean,
): ResolvedRange {
	const range = rangeOfPreset(limits.defaultPreset, asOf);
	return withinLimit(range, asOf, limits.maxDays, {
		todayClamped: false,
		invalid,
	});
}

export function resolveRange(
	request: RangeRequest,
	asOf: IsoDate,
	limits: RangeLimits,
): ResolvedRange {
	const { preset, from, to } = request;
	if (from != null || to != null) {
		if (
			from == null ||
			to == null ||
			!isValidIsoDate(from) ||
			!isValidIsoDate(to) ||
			from < FIRST_CALENDAR_DATE ||
			from > to ||
			from > asOf
		) {
			return defaultRange(asOf, limits, true);
		}
		const todayClamped = to > asOf;
		return withinLimit({ from, to: minDate(to, asOf) }, asOf, limits.maxDays, {
			todayClamped,
			invalid: false,
		});
	}
	if (preset != null) {
		if (!isNamedPreset(preset)) return defaultRange(asOf, limits, true);
		return withinLimit(rangeOfPreset(preset, asOf), asOf, limits.maxDays, {
			todayClamped: false,
			invalid: false,
		});
	}
	return defaultRange(asOf, limits, false);
}

export interface RangeSearch {
	readonly range?: string;
	readonly from?: string;
	readonly to?: string;
}

export function rangeSearch(range: ReportRange): RangeSearch {
	return range.preset === "custom"
		? { from: range.from, to: range.to }
		: { range: range.preset };
}

type StepUnit = "month" | "year" | "days";

function stepUnit(range: ReportRange): StepUnit {
	if (range.preset === "this_month" || range.preset === "last_month") {
		return "month";
	}
	if (range.preset === "this_year") return "year";
	if (range.preset !== "custom") return "days";
	const monthEnd = minDate(lastOfMonth(range.from), range.asOf);
	if (range.from === firstOfMonth(range.from) && range.to === monthEnd) {
		return "month";
	}
	const yearEnd = minDate(lastOfYear(range.from), range.asOf);
	if (range.from === firstOfYear(range.from) && range.to === yearEnd) {
		return "year";
	}
	return "days";
}

function steppedSpan(range: ReportRange, direction: 1 | -1): DateRange {
	switch (stepUnit(range)) {
		case "month": {
			const first = addMonths(firstOfMonth(range.from), direction);
			return { from: first, to: minDate(lastOfMonth(first), range.asOf) };
		}
		case "year": {
			const first = addYears(firstOfYear(range.from), direction);
			return { from: first, to: minDate(lastOfYear(first), range.asOf) };
		}
		case "days":
			return shifted(range, direction * range.days);
	}
}

export function canStepRange(range: ReportRange, direction: 1 | -1): boolean {
	if (direction === 1) return range.to < range.asOf;
	return steppedSpan(range, -1).from >= FIRST_CALENDAR_DATE;
}

export function stepRange(range: ReportRange, direction: 1 | -1): ReportRange {
	if (!canStepRange(range, direction)) return range;
	const span = steppedSpan(range, direction);
	const to = minDate(span.to, range.asOf);
	return rangeOf(span.from, to, range.asOf);
}

export function moveRangeToLimit(
	range: ReportRange,
	maxDays: number,
): ReportRange {
	if (range.days <= maxDays) return range;
	return rangeOf(addDays(range.to, -(maxDays - 1)), range.to, range.asOf);
}

export type RangeSeriesGrain = "day" | "week" | "month";

const GRAINS: readonly RangeSeriesGrain[] = ["day", "week", "month"];

function bucketBound(grain: RangeSeriesGrain, days: number): number {
	switch (grain) {
		case "day":
			return days;
		case "week":
			return Math.floor((days + 5) / 7) + 1;
		case "month":
			return Math.ceil(days / 28) + 1;
	}
}

export function seriesGrain(
	days: number,
	storeCount: number,
	includeStores: boolean,
	finest: RangeSeriesGrain,
): RangeSeriesGrain {
	const rowsPerBucket = includeStores ? storeCount + 1 : 1;
	const start = GRAINS.indexOf(finest);
	for (const grain of GRAINS.slice(start)) {
		if (bucketBound(grain, days) * rowsPerBucket <= SERIES_ROW_LIMIT) {
			return grain;
		}
	}
	return "month";
}
