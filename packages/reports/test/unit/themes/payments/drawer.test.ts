import { describe, expect, it } from "vitest";
import { reportKeys } from "../../../../src/model/keys.js";
import { buildDrawerCard } from "../../../../src/themes/payments/cards/drawer.js";
import { paymentsKeys } from "../../../../src/themes/payments/keys.js";
import { paymentsCalls } from "../../../../src/themes/payments/support.js";
import { STORE_A, STORE_B } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import { cardInput, settingsRow, shiftRow } from "./support.js";

const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

const shifts = [
	shiftRow({
		shift_id: "a1",
		opened_at: "2026-10-20T08:00:00Z",
		variance_amount: -30_000,
	}),
	shiftRow({
		shift_id: "a2",
		opened_at: "2026-10-20T01:00:00Z",
		shift_name: "lan.nguyen@example.com",
		cashier_name: "lan.nguyen@example.com",
		variance_amount: -120_000,
		z_score: -2.4,
		over_abs_threshold: true,
		over_z_threshold: true,
		flagged: true,
		reasons: ["absolute", "z_score"],
	}),
	shiftRow({
		shift_id: "b1",
		business_date: "2026-10-21",
		opened_at: "2026-10-21T01:00:00Z",
		variance_amount: 80_000,
		over_abs_threshold: true,
		flagged: true,
		reasons: ["absolute"],
	}),
];

describe("the Thanh toán drawer card", () => {
	it("counts flagged shifts, names the largest by its number and date and states the thresholds", () => {
		const card = buildDrawerCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[paymentsCalls.shifts]: shifts,
				[paymentsCalls.settings]: [
					settingsRow({
						cash_abs_threshold: 80_000,
						cash_rel_threshold: 0.008,
					}),
				],
			}),
		);
		expect(card.headline.value).toBe(2);
		expect(card.headline.caption?.values.count).toEqual({
			kind: "count",
			value: 3,
		});
		expect(card.narrative.map((part) => part.key)).toEqual([
			reportKeys.shifts.largest,
			paymentsKeys.drawer.thresholds,
		]);
		const shift = card.narrative[0]?.values.shift;
		expect(shift?.kind).toBe("part");
		const label = shift?.kind === "part" ? shift.value : null;
		expect(label?.key).toBe(paymentsKeys.drawer.shiftOn);
		expect(label?.values.date).toEqual({ kind: "date", value: "2026-10-20" });
		expect(card.narrative[1]?.values).toEqual({
			abs: { kind: "money", value: 80_000 },
			rel: { kind: "percent", value: 0.008 },
			z: { kind: "decimal", value: 2 },
		});
		expect(
			card.tables[0]?.rows.map((row) => [row.id, row.cells.shift]),
		).toEqual([
			["a2", 1],
			["b1", 1],
			["a1", 2],
		]);
		expect(card.subtitle?.values.days).toEqual({ kind: "count", value: 28 });
	});

	it("never shows an e-mail-like shift or cashier name", () => {
		const card = buildDrawerCard(
			cardInput(themeContext("28d", [STORE_A, STORE_B]), {
				[paymentsCalls.shifts]: shifts,
			}),
		);
		const text = JSON.stringify([card.narrative, card.tables, card.chart]);
		expect(text).not.toMatch(EMAIL_LIKE);
	});

	it("says there was no shift and keeps the headline empty", () => {
		const card = buildDrawerCard(
			cardInput(themeContext("28d", [STORE_A]), { [paymentsCalls.shifts]: [] }),
		);
		expect(card.headline.value).toBeNull();
		expect(card.narrative[0]?.key).toBe(paymentsKeys.drawer.noData);
		expect(card.notice?.part.key).toBe(paymentsKeys.drawer.noShifts);
		expect(card.chart).toBeNull();
	});

	it("says no shift was over the thresholds when none is flagged", () => {
		const card = buildDrawerCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[paymentsCalls.shifts]: [shiftRow({ variance_amount: 10_000 })],
			}),
		);
		expect(card.headline.value).toBe(0);
		expect(card.narrative[0]?.key).toBe(reportKeys.shifts.none);
	});
});
