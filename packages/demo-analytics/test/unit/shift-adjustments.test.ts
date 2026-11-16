import type { GeneratedDay } from "@fnb/connector-mock";
import type { CanonicalSale, CanonicalShift } from "@fnb/core";
import { addDays, INVALID_ARGUMENTS_CODE, Z_THRESHOLD } from "@fnb/reports";
import { describe, expect, it } from "vitest";
import { shiftAdjustments } from "../../src/functions/shift-adjustments.js";
import {
	type AggregateStore,
	aggregateStoreDay,
	createDemoReportSource,
	DemoSettingsStore,
	demoSettings,
	demoStores,
} from "../../src/index.js";

const DATE = "2026-11-03";
const NOW = new Date("2026-11-04T05:30:00.000Z");
const [store] = demoStores(DATE);

function shift(
	externalId: string,
	openedAt: string,
	closedAt: string,
): CanonicalShift {
	return {
		externalId,
		name: externalId,
		cashierName: "Thu ngân",
		openedAt: new Date(openedAt),
		closedAt: new Date(closedAt),
		salesAmount: 30_000,
		ordersCount: 1,
		openingFloatAmount: 1_000_000,
		cashDrawerAmount: 1_030_000,
		changedAfterClose: false,
		raw: null,
	};
}

function sale(
	externalId: string,
	soldAt: string,
	shiftExternalId: string,
): CanonicalSale {
	return {
		externalId,
		soldAt: new Date(soldAt),
		businessDate: DATE,
		channel: "dine_in",
		guestCount: 0,
		shiftExternalId,
		grossAmount: 30_000,
		itemDiscountAmount: 0,
		billDiscountAmount: 0,
		voucherAmount: 0,
		partnerMarketingAmount: 0,
		serviceChargeAmount: 0,
		shippingFeeAmount: 0,
		vatAmount: 0,
		netAmount: 30_000,
		paidAmount: 30_000,
		status: "completed",
		lines: [
			{
				externalId: `${externalId}-L1`,
				lineKind: "item",
				itemExternalId: "DR-015",
				itemName: "Cà phê đen",
				baseName: "Cà phê đen",
				quantity: 1,
				unitPrice: 30_000,
				grossAmount: 30_000,
				discountAmount: 0,
				netAmount: 30_000,
				raw: null,
			},
		],
		payments: [
			{
				methodExternalId: "PM-CASH",
				methodName: "Tiền mặt",
				kind: "cash",
				amount: 30_000,
				feeAmount: 0,
				raw: null,
			},
		],
		raw: null,
	};
}

const day: GeneratedDay = {
	date: DATE,
	sales: [
		sale("A", "2026-11-03T03:00:00.000Z", "EARLY"),
		sale("B", "2026-11-03T08:00:00.000Z", "LATE"),
	],
	shifts: [
		shift("EARLY", "2026-11-03T00:00:00.000Z", "2026-11-03T08:00:00.000Z"),
		shift("LATE", "2026-11-03T05:00:00.000Z", "2026-11-03T15:00:00.000Z"),
	],
	adjustments: [
		{
			kind: "voided",
			saleExternalId: "GONE",
			occurredAt: new Date("2026-11-03T06:00:00.000Z"),
			amount: 45_000,
			raw: null,
		},
		{
			kind: "line_removed",
			saleExternalId: "A",
			lineExternalId: "A-L1",
			occurredAt: new Date("2026-11-03T09:00:00.000Z"),
			amount: 30_000,
			raw: null,
		},
	],
	dailyTotal: {
		businessDate: DATE,
		invoiceCount: 2,
		grossAmount: 60_000,
		discountAmount: 0,
		voucherAmount: 0,
		netAmount: 60_000,
		raw: null,
	},
};

describe("shift_adjustments", () => {
	if (store === undefined) throw new Error("missing demo store");
	const aggregates = aggregateStoreDay(store, day);
	const fake = {
		visibleStores: (ids: readonly string[]) =>
			ids.includes(store.id) ? [store] : [],
		daysOf: () => [aggregates],
	} as unknown as AggregateStore;
	const context = {
		now: NOW,
		holidays: [],
		reportSettings: new DemoSettingsStore(demoSettings(DATE)).reportSettings(),
		settings: new DemoSettingsStore(demoSettings(DATE)),
	};

	it("gives a void of an unknown sale to the latest opened of two overlapping shifts, and an invoice's event to its own shift even after it closed", () => {
		const rows = shiftAdjustments(
			fake,
			{ store_ids: [store.id], from_date: DATE, to_date: DATE },
			context,
		);
		expect(
			rows.map((row) => [
				row.shift_external_id,
				row.orders,
				row.voids,
				row.void_amount,
				row.removed_lines,
				row.edits_after_close,
				row.flagged,
				row.reasons,
			]),
		).toEqual([
			["EARLY", 1, 0, 0, 1, 1, true, ["after_close"]],
			["LATE", 1, 1, 45_000, 0, 0, false, []],
		]);
		expect(rows[1]?.void_rate).toBe(0.5);
		expect(rows.every((row) => row.void_z_score === null)).toBe(true);
		expect(rows.every((row) => row.trailing_shifts === 0)).toBe(true);
	});

	it("refuses more than 92 days and a threshold that is not above 0, answers nothing for an empty store list, and scores against 2 when the call names no threshold", async () => {
		const demo = createDemoReportSource({
			now: () => NOW,
			volumeScale: 0.1,
			settings: new DemoSettingsStore(demoSettings(DATE)),
		});
		await expect(
			demo.callTheme("shift_adjustments", {
				store_ids: ["MOCK-S1"],
				from_date: addDays(DATE, -92),
				to_date: DATE,
			}),
		).rejects.toMatchObject({
			code: "22023",
			functionName: "shift_adjustments",
		});
		for (const threshold of [0, -1]) {
			await expect(
				demo.callTheme("shift_adjustments", {
					store_ids: ["MOCK-S1"],
					from_date: DATE,
					to_date: DATE,
					z_threshold: threshold,
				}),
				String(threshold),
			).rejects.toMatchObject({ code: INVALID_ARGUMENTS_CODE });
		}
		expect(Z_THRESHOLD).toBe(2);
		const full = createDemoReportSource({
			now: () => NOW,
			volumeScale: 1,
			settings: new DemoSettingsStore(demoSettings(DATE)),
		});
		const range = {
			store_ids: ["MOCK-S1"],
			from_date: addDays(DATE, -13),
			to_date: DATE,
		};
		const byDefault = await full.callTheme("shift_adjustments", range);
		expect(byDefault.some((row) => row.void_z_score !== null)).toBe(true);
		expect(
			await full.callTheme("shift_adjustments", {
				...range,
				z_threshold: Z_THRESHOLD,
			}),
		).toEqual(byDefault);
		const lowest = await full.callTheme("shift_adjustments", {
			...range,
			z_threshold: 0.0001,
		});
		expect(
			lowest.filter((row) => (row.reasons ?? []).includes("voids")).length,
		).toBeGreaterThan(
			byDefault.filter((row) => (row.reasons ?? []).includes("voids")).length,
		);
		expect(
			await demo.callTheme("shift_adjustments", {
				store_ids: [],
				from_date: DATE,
				to_date: DATE,
			}),
		).toEqual([]);
	});
});
