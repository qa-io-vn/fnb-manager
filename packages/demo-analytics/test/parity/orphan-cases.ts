import type { GeneratedDay } from "@fnb/connector-mock";
import { addDays, type IsoDate } from "@fnb/reports";
import type { DemoDayRewrite, DemoStoreId } from "../../src/index.js";

export const ORPHAN_STORE: DemoStoreId = "MOCK-S1";
export const ORPHAN_DAYS_BEFORE_AS_OF = 9;

export function orphanDay(asOf: IsoDate): IsoDate {
	return addDays(asOf, -ORPHAN_DAYS_BEFORE_AS_OF);
}

export function orphanVoids(asOf: IsoDate): DemoDayRewrite {
	const date = orphanDay(asOf);
	return (store, day: GeneratedDay) => {
		if (store.id !== ORPHAN_STORE || day.date !== date) return day;
		const voided = day.sales.find((sale) => sale.status === "voided");
		if (voided === undefined) return day;
		day.sales = day.sales.filter((sale) => sale !== voided);
		return day;
	};
}

export function bothRewrites(
	...rewrites: readonly DemoDayRewrite[]
): DemoDayRewrite {
	return (store, day) =>
		rewrites.reduce((current, rewrite) => rewrite(store, current), day);
}
