import type {
	CustomerHome,
	CustomerLegal,
	CustomerStore,
	IsoDate,
	MenuHighlight,
	OpeningSpan,
	Programme,
	Weekday,
} from "@fnb/zalo-mini/loyalty";
import { WEEKDAYS } from "@fnb/zalo-mini/loyalty";
import { weekdayOf } from "../data/dates";

export type HoursOnDay =
	| { readonly kind: "unknown" }
	| { readonly kind: "closed" }
	| { readonly kind: "open"; readonly spans: readonly OpeningSpan[] };

export function hoursKnown(store: CustomerStore): boolean {
	return WEEKDAYS.some((weekday) => store.openingHours[weekday].length > 0);
}

export function hoursOn(store: CustomerStore, date: IsoDate): HoursOnDay {
	if (!hoursKnown(store)) return { kind: "unknown" };
	const spans = store.openingHours[weekdayOf(date)];
	return spans.length === 0 ? { kind: "closed" } : { kind: "open", spans };
}

export function spansText(spans: readonly OpeningSpan[]): string {
	return spans.map(([open, close]) => `${open}–${close}`).join(", ");
}

export interface WeekRow {
	readonly weekday: Weekday;
	readonly spans: readonly OpeningSpan[];
	readonly today: boolean;
}

export function weekRows(store: CustomerStore, today: IsoDate): WeekRow[] {
	const current = weekdayOf(today);
	return WEEKDAYS.map((weekday) => ({
		weekday,
		spans: store.openingHours[weekday],
		today: weekday === current,
	}));
}

export function menuAt(
	menu: readonly MenuHighlight[],
	store: string | null,
): MenuHighlight[] {
	return menu.filter(
		(item) =>
			item.storeCodes === null ||
			store === null ||
			item.storeCodes.includes(store),
	);
}

const MONEY =
	/\d[\d.,\s]*\s?(?:₫|đ(?![\p{L}])|đồng|vnđ|vnd)|(?:₫|vnđ|vnd)\s?\d/iu;

export function looksLikePrice(text: string): boolean {
	return MONEY.test(text);
}

export type JoinBlock = "no-programme" | "no-privacy";

export function programmeOpen(
	programme: Programme | null,
	today: IsoDate,
): programme is Programme {
	if (programme === null) return false;
	if (programme.status === "paused" || programme.status === "ended")
		return false;
	if (programme.startsOn !== null && programme.startsOn > today) return false;
	return programme.endsOn === null || programme.endsOn >= today;
}

export function joinBlock(
	home: CustomerHome,
	today: IsoDate,
): JoinBlock | null {
	if (!programmeOpen(home.programme, today)) return "no-programme";
	return home.legal.policyVersion === null ? "no-privacy" : null;
}

export interface JoinableHome extends CustomerHome {
	readonly programme: Programme;
	readonly legal: CustomerLegal & { readonly policyVersion: string };
}

export function joinableHome(
	home: CustomerHome,
	today: IsoDate,
): JoinableHome | null {
	return joinBlock(home, today) === null ? (home as JoinableHome) : null;
}

export function storeByCode<T extends { readonly code: string }>(
	stores: readonly T[],
	code: string | null | undefined,
): T | null {
	if (code === null || code === undefined || code === "") return null;
	const exact = stores.find((store) => store.code === code);
	if (exact !== undefined) return exact;
	const wanted = code.toLowerCase();
	const matches = stores.filter((store) => store.code.toLowerCase() === wanted);
	return matches.length === 1 ? (matches[0] ?? null) : null;
}

export function storeOrOnly<T extends { readonly code: string }>(
	stores: readonly T[],
	code: string | null | undefined,
): T | null {
	return (
		storeByCode(stores, code) ??
		(stores.length === 1 ? (stores[0] ?? null) : null)
	);
}
