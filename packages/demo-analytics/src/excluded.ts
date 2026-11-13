import {
	type HolidayEntry,
	isExcludedDay,
	isHolidayDate,
	isTetWindowDate,
} from "@fnb/core";
import type { HolidayKind, IsoDate } from "@fnb/reports";

interface HolidayIndex {
	readonly tetWindow: Map<IsoDate, boolean>;
	readonly holiday: Map<IsoDate, boolean>;
	readonly excluded: Map<IsoDate, boolean>;
	readonly kinds: Map<IsoDate, HolidayKind | null>;
}

const indexes = new WeakMap<readonly HolidayEntry[], HolidayIndex>();

function indexOf(holidays: readonly HolidayEntry[]): HolidayIndex {
	let index = indexes.get(holidays);
	if (index === undefined) {
		index = {
			tetWindow: new Map(),
			holiday: new Map(),
			excluded: new Map(),
			kinds: new Map(),
		};
		indexes.set(holidays, index);
	}
	return index;
}

function memo<Value>(
	cache: Map<IsoDate, Value>,
	date: IsoDate,
	compute: () => Value,
): Value {
	if (cache.has(date)) return cache.get(date) as Value;
	const value = compute();
	cache.set(date, value);
	return value;
}

export function isTetWindowDay(
	holidays: readonly HolidayEntry[],
	date: IsoDate,
): boolean {
	return memo(indexOf(holidays).tetWindow, date, () =>
		isTetWindowDate(holidays, date),
	);
}

export function isHolidayDay(
	holidays: readonly HolidayEntry[],
	date: IsoDate,
): boolean {
	return memo(indexOf(holidays).holiday, date, () =>
		isHolidayDate(holidays, date),
	);
}

export function isExcludedDemoDay(
	holidays: readonly HolidayEntry[],
	date: IsoDate,
): boolean {
	return memo(indexOf(holidays).excluded, date, () =>
		isExcludedDay(holidays, date),
	);
}

const KIND_ORDER: readonly HolidayKind[] = ["public", "tet", "custom"];

export function holidayKindOn(
	holidays: readonly HolidayEntry[],
	date: IsoDate,
): HolidayKind | null {
	return memo(indexOf(holidays).kinds, date, () => {
		if (isTetWindowDay(holidays, date)) return "tet";
		const kinds = holidays
			.filter((holiday) => holiday.holidayDate === date)
			.map((holiday) => holiday.kind);
		return KIND_ORDER.find((kind) => kinds.includes(kind)) ?? null;
	});
}
