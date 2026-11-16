import { describe, expect, it } from "vitest";
import { reportKeys } from "../../../../src/model/keys.js";
import { paymentsKeys } from "../../../../src/themes/payments/keys.js";
import {
	buildShiftSalesCard,
	SALES_CHART_SHIFTS,
} from "../../../../src/themes/shifts/cards/shift-sales.js";
import { shiftsKeys } from "../../../../src/themes/shifts/keys.js";
import { shiftsCalls } from "../../../../src/themes/shifts/support.js";
import { STORE_A, STORE_B } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import { cardInput, EMAIL_LIKE, LOGIN, shiftRow } from "./support.js";

function day(date: string, store = STORE_A) {
	return [
		shiftRow({
			store_id: store,
			shift_id: `${store}-${date}-evening`,
			shift_external_id: "E",
			business_date: date,
			opened_at: `${date}T10:00:00Z`,
			closed_at: `${date}T15:00:00Z`,
			cashier_name: "Minh",
			orders: 60,
			sales_amount: 3_000_000,
		}),
		shiftRow({
			store_id: store,
			shift_id: `${store}-${date}-morning`,
			shift_external_id: "M",
			business_date: date,
			opened_at: `${date}T00:00:00Z`,
			closed_at: `${date}T05:00:00Z`,
			shift_name: LOGIN,
			cashier_name: LOGIN,
			orders: 30,
			sales_amount: 1_000_000,
		}),
	];
}

describe("the Ca & két tiền sales card", () => {
	it("averages net per shift and names the strongest and weakest shift by its number", () => {
		const card = buildShiftSalesCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[shiftsCalls.shifts]: [...day("2026-10-20"), ...day("2026-10-21")],
			}),
		);
		expect(card.metricId).toBe("shift_net");
		expect(card.headline).toMatchObject({ value: 2_000_000, unit: "money" });
		expect(card.headline.caption?.values.count).toEqual({
			kind: "count",
			value: 4,
		});
		const [main] = card.narrative;
		expect(main?.key).toBe(shiftsKeys.sales.main);
		expect(main?.values.best).toMatchObject({
			kind: "part",
			value: {
				key: reportKeys.label.shiftNumber,
				values: { number: { kind: "count", value: 2 } },
			},
		});
		expect(main?.values.bestValue).toEqual({ kind: "money", value: 3_000_000 });
		expect(main?.values.worst).toMatchObject({
			kind: "part",
			value: { values: { number: { kind: "count", value: 1 } } },
		});
		expect(main?.values.worstCount).toEqual({ kind: "count", value: 2 });
	});

	it("lists shifts newest first as Ca n by opening time, with times of day and the masked cashier", () => {
		const card = buildShiftSalesCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[shiftsCalls.shifts]: [...day("2026-10-20"), ...day("2026-10-21")],
			}),
		);
		const rows = card.tables[0]?.rows ?? [];
		expect(rows.map((row) => [row.cells.date, row.cells.shift])).toEqual([
			["2026-10-21", 2],
			["2026-10-21", 1],
			["2026-10-20", 2],
			["2026-10-20", 1],
		]);
		expect(rows[1]?.cells).toMatchObject({
			cashier: reportKeys.label.unknownCashier,
			openedAt: "07:00",
			closedAt: "12:00",
			orders: 30,
			net: 1_000_000,
		});
		expect(rows[0]?.cells.cashier).toBe("Minh");
		expect(card.tables[0]?.columns.map((column) => column.key)).toEqual([
			"date",
			"shift",
			"cashier",
			"openedAt",
			"closedAt",
			"orders",
			"net",
		]);
		expect(
			JSON.stringify([card.narrative, card.tables, card.chart]),
		).not.toMatch(EMAIL_LIKE);
	});

	it("charts the net of the last 40 shifts in time order, labelled with the store when several are chosen", () => {
		const dates = Array.from(
			{ length: 25 },
			(_, index) => `2026-10-${String(index + 1).padStart(2, "0")}`,
		);
		const card = buildShiftSalesCard(
			cardInput(themeContext("28d", [STORE_A, STORE_B]), {
				[shiftsCalls.shifts]: dates.flatMap((date) => day(date)),
			}),
		);
		expect(SALES_CHART_SHIFTS).toBe(40);
		const chart = card.chart;
		expect(chart?.categories).toHaveLength(40);
		expect(chart?.series[0]?.values.slice(-2)).toEqual([1_000_000, 3_000_000]);
		const last = chart?.categories.at(-1);
		expect(last?.kind === "part" ? last.value.key : null).toBe(
			paymentsKeys.drawer.shiftOnAt,
		);
		expect(last?.kind === "part" ? last.value.values.date : null).toEqual({
			kind: "date",
			value: "2026-10-25",
		});
		expect(card.tables[0]?.columns[0]?.key).toBe("store");
	});

	it("falls back to the plain average when every day has one shift", () => {
		const card = buildShiftSalesCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[shiftsCalls.shifts]: [day("2026-10-20")[0], day("2026-10-21")[0]],
			}),
		);
		expect(card.narrative[0]?.key).toBe(shiftsKeys.sales.average);
		expect(card.headline.value).toBe(3_000_000);
	});

	it("says there is no shift, with a dash and the notice", () => {
		const card = buildShiftSalesCard(
			cardInput(themeContext("28d", [STORE_A]), { [shiftsCalls.shifts]: [] }),
		);
		expect(card.headline.value).toBeNull();
		expect(card.narrative[0]?.key).toBe(shiftsKeys.noData);
		expect(card.notice?.part.key).toBe(shiftsKeys.noShifts);
		expect(card.chart).toBeNull();
	});
});
