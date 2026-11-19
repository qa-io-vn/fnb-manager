import type {
	CustomerStore,
	IsoDate,
	MenuHighlight,
	OpeningSpan,
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
