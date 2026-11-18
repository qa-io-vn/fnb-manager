import type { GeneratedDay } from "@fnb/connector-mock";
import type { CanonicalAdjustment } from "@fnb/core";
import { addDays, type IsoDate } from "@fnb/reports";
import type { DemoDayRewrite, DemoStoreId } from "../../src/index.js";

export const ORPHAN_STORE: DemoStoreId = "MOCK-S1";
export const ORPHAN_DAYS_BEFORE_AS_OF = 9;
export const ORPHAN_SALE_ID = "PARITY-ORPHAN-SALE";

const ORPHAN_VOID_AMOUNT = 38_000;

export function orphanDay(asOf: IsoDate): IsoDate {
	return addDays(asOf, -ORPHAN_DAYS_BEFORE_AS_OF);
}

export function orphanVoids(asOf: IsoDate): DemoDayRewrite {
	const date = orphanDay(asOf);
	return (store, day: GeneratedDay) => {
		if (store.id !== ORPHAN_STORE || day.date !== date) return day;
		const shift = day.shifts.find((candidate) => candidate.closedAt);
		if (shift?.closedAt === undefined) {
			throw new Error("no closed shift to hold the orphan void");
		}
		const opened = shift.openedAt.getTime();
		const orphan: CanonicalAdjustment = {
			kind: "voided",
			saleExternalId: ORPHAN_SALE_ID,
			occurredAt: new Date(
				opened + Math.floor((shift.closedAt.getTime() - opened) / 2),
			),
			amount: ORPHAN_VOID_AMOUNT,
			reason: "Khách huỷ đơn",
			raw: { source: "parity" },
		};
		day.adjustments = [...day.adjustments, orphan];
		return day;
	};
}

export function bothRewrites(
	...rewrites: readonly DemoDayRewrite[]
): DemoDayRewrite {
	return (store, day) =>
		rewrites.reduce((current, rewrite) => rewrite(store, current), day);
}
