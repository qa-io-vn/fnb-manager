import { businessDate, shiftIsoDate } from "@fnb/core";
import type { MemberRole } from "@fnb/zalo-mini";

export type IsoDate = string;

export const REVENUE_VISIBILITIES = ["none", "store_totals", "all"] as const;

export type RevenueVisibility = (typeof REVENUE_VISIBILITIES)[number];

export const DEFAULT_REVENUE_VISIBILITY: RevenueVisibility = "all";

export function isRevenueVisibility(
	value: unknown,
): value is RevenueVisibility {
	return REVENUE_VISIBILITIES.some((level) => level === value);
}

export function revenueAccess(
	role: MemberRole,
	visibility: RevenueVisibility,
): RevenueVisibility {
	if (role === "staff") return visibility;
	if (role === "publisher") return "none";
	return "all";
}

export const HOME_CARDS = [
	"net-revenue",
	"invoices",
	"yesterday",
	"opening-hours",
] as const;

export type HomeCard = (typeof HOME_CARDS)[number];

export function homeCards(access: RevenueVisibility): HomeCard[] {
	switch (access) {
		case "all":
			return ["net-revenue", "invoices", "yesterday", "opening-hours"];
		case "store_totals":
			return ["net-revenue", "invoices", "opening-hours"];
		case "none":
			return ["opening-hours"];
	}
}

export function brandStores<Store extends { readonly name: string }>(
	stores: readonly Store[],
	memberStoreNames: readonly string[],
): Store[] {
	const names = new Set(memberStoreNames);
	return stores.filter((store) => names.has(store.name));
}

export interface StoreClock {
	readonly timeZone: string;
	readonly businessDayStartMinutes: number;
}

export interface StoreDays {
	readonly today: IsoDate;
	readonly yesterday: IsoDate;
}

export function storeDays(now: Date, clock: StoreClock): StoreDays {
	return daysFrom(
		businessDate(now, clock.timeZone, clock.businessDayStartMinutes),
	);
}

export function daysFrom(today: IsoDate): StoreDays {
	return { today, yesterday: shiftIsoDate(today, -1) };
}

export function calendarDateIn(instant: Date, timeZone: string): IsoDate {
	return businessDate(instant, timeZone, 0);
}

export const WEEKDAYS = [
	"mon",
	"tue",
	"wed",
	"thu",
	"fri",
	"sat",
	"sun",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export type OpeningSpan = readonly [string, string];

export interface OpeningHours {
	readonly known: boolean;
	readonly spans: Readonly<Record<Weekday, readonly OpeningSpan[]>>;
}

export type HoursToday =
	| { readonly kind: "unknown" }
	| { readonly kind: "closed" }
	| { readonly kind: "open"; readonly spans: readonly OpeningSpan[] };

const OPENING_TIME = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$|^24:00$/;

function openingTime(value: unknown): string | null {
	if (typeof value !== "string" || !OPENING_TIME.test(value)) return null;
	return value.padStart(5, "0");
}

function openingSpans(value: unknown): OpeningSpan[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((span: unknown) => {
		if (!Array.isArray(span)) return [];
		const open = openingTime(span[0]);
		const close = openingTime(span[1]);
		return open === null || close === null ? [] : [[open, close] as const];
	});
}

export function readOpeningHours(value: unknown): OpeningHours {
	const record =
		typeof value === "object" && value !== null && !Array.isArray(value)
			? (value as Readonly<Record<string, unknown>>)
			: {};
	const spans = Object.fromEntries(
		WEEKDAYS.map((weekday) => [weekday, openingSpans(record[weekday])]),
	) as Record<Weekday, OpeningSpan[]>;
	return {
		known: WEEKDAYS.some((weekday) => spans[weekday].length > 0),
		spans,
	};
}

export function weekdayOf(date: IsoDate): Weekday {
	const sundayFirst = new Date(`${date}T00:00:00Z`).getUTCDay();
	return WEEKDAYS[(sundayFirst + 6) % 7] ?? "mon";
}

export function hoursOn(hours: OpeningHours, date: IsoDate): HoursToday {
	if (!hours.known) return { kind: "unknown" };
	const spans = hours.spans[weekdayOf(date)];
	return spans.length === 0 ? { kind: "closed" } : { kind: "open", spans };
}
