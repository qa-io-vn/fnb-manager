import { describe, expect, it } from "vitest";
import type { AnalyticsRow } from "../../../src/contract/functions.js";
import {
	cashierCell,
	cashierShownValue,
	isEmailLike,
	reportKeys,
	shiftNumbers,
	shiftNumberValue,
	shownCashier,
} from "../../../src/index.js";

function shift(
	id: string,
	values: Partial<AnalyticsRow<"shift_review">> = {},
): AnalyticsRow<"shift_review"> {
	return {
		store_id: "store-a",
		shift_id: `id-${id}`,
		shift_external_id: id,
		shift_name: `${id}@example.com`,
		business_date: "2026-11-03",
		cashier_name: "Lan",
		opened_at: "2026-11-03T01:00:00.000Z",
		closed_at: null,
		orders: 1,
		sales_amount: 0,
		cash_sales_amount: 0,
		opening_float_amount: null,
		expected_cash_amount: null,
		drawer_amount: null,
		variance_amount: null,
		trailing_shifts: null,
		z_score: null,
		over_abs_threshold: false,
		over_rel_threshold: false,
		over_z_threshold: false,
		flagged: false,
		reasons: [],
		...values,
	};
}

describe("shift numbers", () => {
	it("number the shifts of a store-day by their opening time", () => {
		const numbers = shiftNumbers([
			shift("late", { opened_at: "2026-11-03T09:00:00.000Z" }),
			shift("early", { opened_at: "2026-11-03T01:00:00.000Z" }),
			shift("noon", { opened_at: "2026-11-03T05:00:00.000Z" }),
		]);
		expect([...numbers.entries()].sort()).toEqual([
			["id-early", 1],
			["id-late", 3],
			["id-noon", 2],
		]);
	});

	it("break ties by the external id and put shifts without an opening time last", () => {
		const numbers = shiftNumbers([
			shift("B"),
			shift("A"),
			shift("unknown", { opened_at: "not a time" }),
		]);
		expect(numbers.get("id-A")).toBe(1);
		expect(numbers.get("id-B")).toBe(2);
		expect(numbers.get("id-unknown")).toBe(3);
	});

	it("start again at 1 for every store and every business day", () => {
		const numbers = shiftNumbers([
			shift("a1"),
			shift("a2", { opened_at: "2026-11-03T08:00:00.000Z" }),
			shift("b1", { store_id: "store-b" }),
			shift("next", { business_date: "2026-11-04" }),
		]);
		expect(numbers.get("id-a1")).toBe(1);
		expect(numbers.get("id-a2")).toBe(2);
		expect(numbers.get("id-b1")).toBe(1);
		expect(numbers.get("id-next")).toBe(1);
	});

	it("label a shift by its number through the message catalogue", () => {
		expect(shiftNumberValue(2)).toEqual({
			kind: "part",
			value: {
				key: reportKeys.label.shiftNumber,
				values: { number: { kind: "count", value: 2 } },
			},
		});
	});
});

describe("cashier names", () => {
	it("recognise e-mail-shaped text", () => {
		expect(isEmailLike("lan@example.com")).toBe(true);
		expect(isEmailLike("Ca sáng - minh@example.com")).toBe(true);
		expect(isEmailLike("Lan")).toBe(false);
		expect(isEmailLike("Lan @ quầy 2")).toBe(false);
	});

	it("show a name, and the unknown-cashier label for a missing, blank or e-mail-shaped one", () => {
		expect(shownCashier(" Lan ")).toBe("Lan");
		expect(shownCashier(null)).toBeNull();
		expect(shownCashier("  ")).toBeNull();
		expect(shownCashier("lan@example.com")).toBeNull();
		expect(cashierShownValue("lan@example.com")).toEqual({
			kind: "message",
			value: reportKeys.label.unknownCashier,
		});
		expect(cashierShownValue("Lan")).toEqual({ kind: "text", value: "Lan" });
		expect(cashierCell("lan@example.com")).toBe(
			reportKeys.label.unknownCashier,
		);
		expect(cashierCell("Lan")).toBe("Lan");
	});
});
