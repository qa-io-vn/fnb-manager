import type { GeneratedDay } from "@fnb/connector-mock";
import { roundMoney } from "@fnb/core";
import { addDays, type IsoDate } from "@fnb/reports";
import {
	type DemoDayRewrite,
	type DemoStoreId,
	youngStoreOpenedOn,
} from "../../src/index.js";
import { discountLine, itemLines, plainSale } from "./compliance-cases.js";

export const SOLO_STORE: DemoStoreId = "MOCK-S1";
export const SOLO_PROMOTION = {
	id: "PARITY-SOLO",
	name: "Ưu đãi riêng một cửa hàng",
} as const;
export const SOLO_FIRST_DAY_BEFORE_AS_OF = 20;
export const SOLO_DAYS = 10;
export const SOLO_SHARE = 0.2;
export const YOUNG_SOLO_STORE: DemoStoreId = "MOCK-S2";
export const YOUNG_SOLO_PROMOTION = {
	id: "PARITY-SOLO-YOUNG",
	name: "Ưu đãi khai trương",
} as const;
export const YOUNG_SOLO_FIRST_DAY_AFTER_OPENING = 12;
export const YOUNG_SOLO_DAYS = 5;

export function soloDays(asOf: IsoDate): IsoDate[] {
	return Array.from({ length: SOLO_DAYS }, (_, index) =>
		addDays(asOf, index - SOLO_FIRST_DAY_BEFORE_AS_OF),
	);
}

export function youngSoloDays(asOf: IsoDate): IsoDate[] {
	const opened = youngStoreOpenedOn(asOf);
	return Array.from({ length: YOUNG_SOLO_DAYS }, (_, index) =>
		addDays(opened, YOUNG_SOLO_FIRST_DAY_AFTER_OPENING + index),
	);
}

export function soloPromotion(asOf: IsoDate): DemoDayRewrite {
	const days = new Set(soloDays(asOf));
	const youngDays = new Set(youngSoloDays(asOf));
	return (store, day: GeneratedDay) => {
		const promotion =
			store.id === SOLO_STORE && days.has(day.date)
				? SOLO_PROMOTION
				: store.id === YOUNG_SOLO_STORE && youngDays.has(day.date)
					? YOUNG_SOLO_PROMOTION
					: null;
		if (promotion === null) return day;
		const sale = day.sales.find(plainSale);
		const [line] = sale === undefined ? [] : itemLines(sale);
		if (sale === undefined || line === undefined) return day;
		const discount = roundMoney(line.grossAmount * SOLO_SHARE);
		discountLine(day, sale, line, discount, promotion);
		day.dailyTotal = {
			...day.dailyTotal,
			discountAmount: roundMoney(
				(day.dailyTotal.discountAmount ?? 0) + discount,
			),
			netAmount: roundMoney(day.dailyTotal.netAmount - discount),
		};
		return day;
	};
}
