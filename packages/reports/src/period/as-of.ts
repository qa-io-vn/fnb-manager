import { businessDate } from "@fnb/core";
import type { IsoDate } from "../contract/values.js";
import { addDays } from "./dates.js";

export interface StoreClock {
	readonly timeZone: string;
	readonly businessDayStartMinutes: number;
}

export function storeBusinessDate(store: StoreClock, now: Date): IsoDate {
	return businessDate(now, store.timeZone, store.businessDayStartMinutes);
}

export function asOfDate(stores: readonly StoreClock[], now: Date): IsoDate {
	let earliest: IsoDate | null = null;
	for (const store of stores) {
		const candidate = addDays(storeBusinessDate(store, now), -1);
		if (earliest === null || candidate < earliest) {
			earliest = candidate;
		}
	}
	return earliest ?? addDays(now.toISOString().slice(0, 10), -1);
}
