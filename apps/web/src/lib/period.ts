import {
	addDays,
	compareIsoDates,
	dateFromIso,
	type IsoDate,
	isIsoDate,
	isoWeekday,
} from "./business-dates";

export type PeriodKind = "day" | "week" | "month" | "year" | "custom";

export const periodKinds: readonly PeriodKind[] = [
	"day",
	"week",
	"month",
	"year",
	"custom",
];

export interface DateRange {
	from: IsoDate;
	to: IsoDate;
}

export interface Period {
	kind: PeriodKind;
	anchor: IsoDate;
	custom: DateRange;
}

export function startOfIsoWeek(isoDate: IsoDate): IsoDate {
	return addDays(isoDate, 1 - isoWeekday(isoDate));
}

export function startOfMonth(isoDate: IsoDate): IsoDate {
	return `${isoDate.slice(0, 7)}-01`;
}

export function endOfMonth(isoDate: IsoDate): IsoDate {
	const start = dateFromIso(startOfMonth(isoDate));
	const nextMonth = new Date(
		Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
	);
	return addDays(nextMonth.toISOString().slice(0, 10), -1);
}

export function rangeOf(period: Period): DateRange {
	const { kind, anchor, custom } = period;
	switch (kind) {
		case "day":
			return { from: anchor, to: anchor };
		case "week": {
			const from = startOfIsoWeek(anchor);
			return { from, to: addDays(from, 6) };
		}
		case "month":
			return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
		case "year":
			return {
				from: `${anchor.slice(0, 4)}-01-01`,
				to: `${anchor.slice(0, 4)}-12-31`,
			};
		case "custom":
			return compareIsoDates(custom.from, custom.to) <= 0
				? { from: custom.from, to: custom.to }
				: { from: custom.to, to: custom.from };
	}
}

export function defaultPeriod(today: IsoDate): Period {
	return {
		kind: "day",
		anchor: today,
		custom: { from: addDays(today, -6), to: today },
	};
}

export function isPeriodKind(value: unknown): value is PeriodKind {
	return (
		typeof value === "string" &&
		(periodKinds as readonly string[]).includes(value)
	);
}

export function parsePeriod(value: unknown): Period | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const candidate = value as Record<string, unknown>;
	const custom = candidate.custom as Record<string, unknown> | undefined;
	if (
		!isPeriodKind(candidate.kind) ||
		!isIsoDate(candidate.anchor) ||
		!custom ||
		!isIsoDate(custom.from) ||
		!isIsoDate(custom.to)
	) {
		return undefined;
	}
	return {
		kind: candidate.kind,
		anchor: candidate.anchor,
		custom: { from: custom.from, to: custom.to },
	};
}
