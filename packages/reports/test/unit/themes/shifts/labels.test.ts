import { describe, expect, it } from "vitest";
import { isEmailLike } from "../../../../src/model/shifts.js";
import { buildAdjustmentsCard } from "../../../../src/themes/shifts/cards/adjustments.js";
import { buildCashiersCard } from "../../../../src/themes/shifts/cards/cashiers.js";
import { buildShiftDrawerCard } from "../../../../src/themes/shifts/cards/drawer.js";
import { buildShiftSalesCard } from "../../../../src/themes/shifts/cards/shift-sales.js";
import { shiftsCalls } from "../../../../src/themes/shifts/support.js";
import { STORE_A, STORE_B } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import { adjustmentRow, cardInput, LOGIN, shiftRow } from "./support.js";

const SHIFTS = [
	{ id: "a-noon", store: STORE_A, opened: "2026-10-20T05:00:00Z" },
	{ id: "a-dawn", store: STORE_A, opened: "2026-10-20T00:00:00Z" },
	{ id: "a-night", store: STORE_A, opened: "2026-10-20T11:00:00Z" },
	{ id: "b-noon", store: STORE_B, opened: "2026-10-20T05:00:00Z" },
	{ id: "b-dawn", store: STORE_B, opened: "2026-10-20T00:30:00Z" },
];

const NUMBERS: Readonly<Record<string, number>> = {
	"a-dawn": 1,
	"a-noon": 2,
	"a-night": 3,
	"b-dawn": 1,
	"b-noon": 2,
};

function shiftsInput() {
	return cardInput(themeContext("28d", [STORE_A, STORE_B]), {
		[shiftsCalls.shifts]: SHIFTS.map((shift) =>
			shiftRow({
				store_id: shift.store,
				shift_id: shift.id,
				shift_external_id: shift.id,
				opened_at: shift.opened,
				shift_name: LOGIN,
				cashier_name: LOGIN,
				variance_amount: -90_000,
				flagged: true,
				reasons: ["absolute"],
			}),
		),
		[shiftsCalls.adjustments]: [...SHIFTS].reverse().map((shift) =>
			adjustmentRow({
				store_id: shift.store,
				shift_id: shift.id,
				shift_external_id: shift.id,
				opened_at: shift.opened,
				shift_name: LOGIN,
				cashier_name: ` ${LOGIN} `,
				void_z_score: 2.5,
				flagged: true,
				reasons: ["voids"],
			}),
		),
	});
}

function cards() {
	const input = shiftsInput();
	return [
		buildShiftSalesCard(input),
		buildShiftDrawerCard(input),
		buildAdjustmentsCard(input),
	];
}

describe("the shift labels and cashiers of Ca & két tiền", () => {
	it("number shifts Ca 1, Ca 2, … by opening time within each store and day, alike in every card that lists shifts", () => {
		for (const card of cards()) {
			const shown = Object.fromEntries(
				(card.tables[0]?.rows ?? []).map((row) => [row.id, row.cells.shift]),
			);
			expect(shown, card.id).toEqual(NUMBERS);
		}
	});

	it("never put an e-mail-shaped shift or cashier name in a sentence, table row, CSV row or chart label", () => {
		for (const card of [...cards(), buildCashiersCard(shiftsInput())]) {
			const rendered = JSON.stringify([
				card.narrative,
				card.tables.map((table) => table.rows),
				card.chart,
				card.notice,
			]);
			expect(isEmailLike(rendered), card.id).toBe(false);
			expect(rendered, card.id).not.toContain("@");
			expect(rendered, card.id).not.toContain("example.com");
		}
	});
});
