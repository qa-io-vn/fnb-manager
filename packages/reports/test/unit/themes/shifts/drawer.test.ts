import { describe, expect, it } from "vitest";
import { reportKeys } from "../../../../src/model/keys.js";
import { buildDrawerCard } from "../../../../src/themes/payments/cards/drawer.js";
import { paymentsKeys } from "../../../../src/themes/payments/keys.js";
import { paymentsCalls } from "../../../../src/themes/payments/support.js";
import { buildShiftDrawerCard } from "../../../../src/themes/shifts/cards/drawer.js";
import { shiftsKeys } from "../../../../src/themes/shifts/keys.js";
import { shiftsCalls } from "../../../../src/themes/shifts/support.js";
import { STORE_A, STORE_B } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import {
	cardInput,
	EMAIL_LIKE,
	LOGIN,
	settingsRow,
	shiftRow,
} from "./support.js";

const shifts = [
	shiftRow({
		shift_id: "a1",
		shift_external_id: "A1",
		opened_at: "2026-10-20T08:00:00Z",
		cashier_name: "Minh",
		variance_amount: -30_000,
	}),
	shiftRow({
		shift_id: "a2",
		shift_external_id: "A2",
		opened_at: "2026-10-20T01:00:00Z",
		shift_name: LOGIN,
		cashier_name: LOGIN,
		variance_amount: -120_000,
		z_score: -2.4,
		over_abs_threshold: true,
		over_z_threshold: true,
		flagged: true,
		reasons: ["absolute", "z_score"],
	}),
	shiftRow({
		shift_id: "b1",
		shift_external_id: "B1",
		business_date: "2026-10-21",
		opened_at: "2026-10-21T01:00:00Z",
		cashier_name: "Minh",
		variance_amount: 80_000,
		over_abs_threshold: true,
		flagged: true,
		reasons: ["absolute"],
	}),
	shiftRow({
		shift_id: "b2",
		shift_external_id: "B2",
		business_date: "2026-10-21",
		opened_at: "2026-10-21T08:00:00Z",
		cashier_name: null,
		variance_amount: 5_000,
	}),
];

describe("the Ca & két tiền drawer card", () => {
	it("flags exactly the shifts shift_review flags and reads like Thanh toán's drawer card", () => {
		const settings = [
			settingsRow({ cash_abs_threshold: 80_000, cash_rel_threshold: 0.008 }),
		];
		const card = buildShiftDrawerCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[shiftsCalls.shifts]: shifts,
				[shiftsCalls.settings]: settings,
			}),
		);
		const payments = buildDrawerCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[paymentsCalls.shifts]: shifts,
				[paymentsCalls.settings]: settings,
			}),
		);
		const flaggedIds = shifts
			.filter((row) => row.flagged)
			.map((row) => row.shift_id);
		expect(card.headline.value).toBe(flaggedIds.length);
		expect(card.metricId).toBe("flagged_shifts");
		expect(card.relatedMetricIds).toEqual([
			"cash_variance",
			"cash_variance_zscore",
		]);
		const drawerRows = card.tables[0]?.rows ?? [];
		expect(
			drawerRows
				.filter((row) => row.cells.reasons !== null)
				.map((row) => row.id),
		).toEqual(["a2", "b1"]);
		expect(card.narrative).toEqual(payments.narrative);
		expect(card.narrative.map((part) => part.key)).toEqual([
			reportKeys.shifts.largest,
			paymentsKeys.drawer.thresholds,
		]);
		expect(card.tables[0]).toEqual(payments.tables[0]);
		expect(card.chart).toEqual(payments.chart);
		expect(card.titleKey).toBe(shiftsKeys.drawer.title);
		expect(card.subtitle).toBeNull();
		expect(
			drawerRows.map((row) => [row.id, row.cells.shift, row.cells.cashier]),
		).toEqual([
			["a2", 1, reportKeys.label.unknownCashier],
			["b1", 1, "Minh"],
			["a1", 2, "Minh"],
			["b2", 2, reportKeys.label.unknownCashier],
		]);
	});

	it("groups the shifts per cashier with flags, variance sums and extremes, an e-mail login falling under the unknown cashier", () => {
		const card = buildShiftDrawerCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[shiftsCalls.shifts]: shifts,
			}),
		);
		const table = card.tables[1];
		expect(table?.captionKey).toBe(shiftsKeys.drawer.cashierTable);
		expect(table?.columns.map((column) => column.key)).toEqual([
			"cashier",
			"shifts",
			"flagged",
			"totalVariance",
			"meanVariance",
			"largestShortage",
			"largestOverage",
		]);
		expect(table?.rows.map((row) => row.cells)).toEqual([
			{
				store: null,
				cashier: reportKeys.label.unknownCashier,
				shifts: 2,
				flagged: 1,
				totalVariance: 125_000,
				meanVariance: 62_500,
				largestShortage: -120_000,
				largestOverage: 5_000,
			},
			{
				store: null,
				cashier: "Minh",
				shifts: 2,
				flagged: 1,
				totalVariance: 110_000,
				meanVariance: 55_000,
				largestShortage: -30_000,
				largestOverage: 80_000,
			},
		]);
		const sum = (key: "shifts" | "flagged") =>
			(table?.rows ?? []).reduce(
				(total, row) => total + Number(row.cells[key]),
				0,
			);
		expect(sum("shifts")).toBe(shifts.length);
		expect(sum("flagged")).toBe(2);
	});

	it("splits the cashier table by store when several stores are chosen and never shows an e-mail address", () => {
		const card = buildShiftDrawerCard(
			cardInput(themeContext("28d", [STORE_A, STORE_B]), {
				[shiftsCalls.shifts]: [
					...shifts,
					shiftRow({
						store_id: STORE_B,
						shift_id: "c1",
						cashier_name: "Minh",
					}),
				],
			}),
		);
		expect(card.tables[1]?.columns[0]?.key).toBe("store");
		expect(card.tables[1]?.rows.map((row) => row.cells.store)).toContain(
			"Store 2",
		);
		const text = JSON.stringify([card.narrative, card.tables, card.chart]);
		expect(text).not.toMatch(EMAIL_LIKE);
		expect(text).not.toContain("@");
	});

	it("says there was no shift in the range, with a dash and the notice", () => {
		const card = buildShiftDrawerCard(
			cardInput(themeContext("28d", [STORE_A]), { [shiftsCalls.shifts]: [] }),
		);
		expect(card.headline.value).toBeNull();
		expect(card.narrative[0]?.key).toBe(shiftsKeys.noData);
		expect(card.notice?.part.key).toBe(shiftsKeys.noShifts);
		expect(card.chart).toBeNull();
		expect(card.tables.map((table) => table.rows.length)).toEqual([0, 0]);
	});
});
