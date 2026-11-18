import type { GeneratedDay } from "@fnb/connector-mock";
import { MENU } from "@fnb/connector-mock";
import type { CanonicalAdjustment, CanonicalSale } from "@fnb/core";
import type { IsoDate } from "@fnb/reports";
import type { DemoDayRewrite, DemoStoreId } from "../../src/index.js";
import { openCaseDay } from "./case-days.js";

export const ATTRIBUTION_STORE: DemoStoreId = "MOCK-S1";
export const ATTRIBUTION_DAYS_BEFORE_AS_OF = 5;
export const MISSING_SHIFT_ID = "PARITY-NO-SHIFT";
export const GHOST_SALE_ID = "PARITY-GHOST-SALE";
export const GHOST_MINUTES_BEFORE_FIRST_SHIFT = 90;

const MINUTE_MS = 60_000;
const EDIT_MINUTES_AFTER_SALE = 10;
const PARITY_EDIT_REASON = "Sửa hoá đơn kiểm thử";
const CATALOGUE_MODIFIERS = new Set(
	MENU.catalog.items
		.filter((item) => item.isModifier)
		.map((item) => item.externalId),
);

export function attributionDay(asOf: IsoDate): IsoDate {
	return openCaseDay(asOf, ATTRIBUTION_DAYS_BEFORE_AS_OF);
}

function sellModifierAsItem(day: GeneratedDay): void {
	for (const sale of day.sales) {
		if (sale.status !== "completed") continue;
		const line = sale.lines.find(
			(candidate) =>
				candidate.lineKind === "modifier" &&
				candidate.itemExternalId !== undefined &&
				CATALOGUE_MODIFIERS.has(candidate.itemExternalId),
		);
		if (line === undefined) continue;
		line.lineKind = "item";
		line.parentLineExternalId = undefined;
		return;
	}
	throw new Error("no catalogue modifier line to sell as an item");
}

function editedAdjustment(sale: CanonicalSale): CanonicalAdjustment {
	return {
		kind: "edited",
		saleExternalId: sale.externalId,
		relatedSaleExternalId: `${sale.externalId}-ORIGIN`,
		occurredAt: new Date(
			sale.soldAt.getTime() + EDIT_MINUTES_AFTER_SALE * MINUTE_MS,
		),
		amount: sale.netAmount,
		reason: PARITY_EDIT_REASON,
		raw: null,
	};
}

function moveSaleOffItsShift(day: GeneratedDay): void {
	const completed = day.sales.filter((sale) => sale.status === "completed");
	const adjusted = new Set(
		day.adjustments.map((adjustment) => adjustment.saleExternalId),
	);
	const sale =
		completed.find((candidate) => adjusted.has(candidate.externalId)) ??
		completed[0];
	if (sale === undefined) throw new Error("no completed sale to move");
	if (!adjusted.has(sale.externalId)) {
		day.adjustments = [...day.adjustments, editedAdjustment(sale)];
	}
	sale.shiftExternalId = MISSING_SHIFT_ID;
}

function addGhostVoid(day: GeneratedDay): void {
	const firstOpen = Math.min(
		...day.shifts.map((shift) => shift.openedAt.getTime()),
	);
	const ghost: CanonicalAdjustment = {
		kind: "voided",
		saleExternalId: GHOST_SALE_ID,
		occurredAt: new Date(
			firstOpen - GHOST_MINUTES_BEFORE_FIRST_SHIFT * MINUTE_MS,
		),
		amount: 45_000,
		raw: { source: "parity" },
	};
	day.adjustments = [...day.adjustments, ghost];
}

export function unattributedCases(asOf: IsoDate): DemoDayRewrite {
	const date = attributionDay(asOf);
	return (store, day: GeneratedDay) => {
		if (store.id !== ATTRIBUTION_STORE || day.date !== date) return day;
		sellModifierAsItem(day);
		moveSaleOffItsShift(day);
		addGhostVoid(day);
		return day;
	};
}
