import { afterEach, describe, expect, it, vi } from "vitest";
import {
	addToMonthlyTally,
	BYTES_PER_ROW,
	CONFIRM_ABOVE_BYTES,
	dailySummaryIncludesAll,
	dailySummaryRowCount,
	deviceMonth,
	estimateExport,
	monthlyTallyKey,
	needsConfirmation,
	readMonthlyTally,
	storeMonthKey,
} from "./estimate";
import { type ExportStore, planExport } from "./plan";
import {
	type ControlTotals,
	controlTotalsOf,
	controlTotalsRow,
} from "./totals";

const FINGERPRINT =
	"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const S1: ExportStore = {
	id: "11111111-1111-4111-8111-111111111111",
	label: "S1",
	name: "Cửa hàng một",
	timeZone: "Asia/Ho_Chi_Minh",
	businessDayStartMinutes: 0,
	asOf: "2026-11-15",
};

const S2: ExportStore = {
	...S1,
	id: "22222222-2222-4222-8222-222222222222",
	label: "S2",
};

function totals(storeId: string, invoices: number): ControlTotals {
	return controlTotalsOf(
		controlTotalsRow.parse({
			store_id: storeId,
			invoices,
			voided_invoices: 0,
			sales_net_amount: 0,
			invoice_fingerprint: FINGERPRINT,
			lines: invoices * 2,
			line_net_amount: 0,
			line_fingerprint: FINGERPRINT,
			payments: invoices,
			payment_amount: 0,
			payment_fingerprint: FINGERPRINT,
			shifts: 90,
			shift_sales_amount: 0,
			shift_fingerprint: FINGERPRINT,
		}),
	);
}

describe("the egress estimate", () => {
	it("multiplies call A's counts by the measured bytes per row", () => {
		const result = planExport({
			stores: [S1, S2],
			firstMonth: "2026-10",
			lastMonth: "2026-10",
			tables: [
				"invoices",
				"invoice_lines",
				"invoice_payments",
				"shifts",
				"daily_summary",
			],
			format: "csv",
			dialect: "comma",
			personal: false,
		});
		if (!result.ok) throw new Error(result.error);
		const map = new Map([
			[storeMonthKey("2026-10", S1.id), totals(S1.id, 2000)],
			[storeMonthKey("2026-10", S2.id), totals(S2.id, 1000)],
		]);
		const estimate = estimateExport(result.plan, map);
		expect(estimate.totalRows).toEqual({
			invoices: 3000,
			invoice_lines: 6000,
			invoice_payments: 3000,
			shifts: 180,
			daily_summary: 93,
		});
		expect(estimate.bytes).toBe(
			3000 * 910 + 6000 * 585 + 3000 * 175 + 180 * 475 + 93 * 820,
		);
		expect(estimate.needsConfirmation).toBe(false);
		expect(estimate.rows.map((row) => row.label)).toEqual(["S1", "S2"]);
	});

	it("counts only the ticked tables", () => {
		const result = planExport({
			stores: [S1],
			firstMonth: "2026-10",
			lastMonth: "2026-10",
			tables: ["shifts"],
			format: "json",
			dialect: "comma",
			personal: false,
		});
		if (!result.ok) throw new Error(result.error);
		const estimate = estimateExport(
			result.plan,
			new Map([[storeMonthKey("2026-10", S1.id), totals(S1.id, 2000)]]),
		);
		expect(estimate.bytes).toBe(90 * BYTES_PER_ROW.shifts);
	});

	it("asks for confirmation only above 100 MB", () => {
		expect(needsConfirmation(CONFIRM_ABOVE_BYTES)).toBe(false);
		expect(needsConfirmation(CONFIRM_ABOVE_BYTES + 1)).toBe(true);
	});

	it("drops the ALL rows when stores plus one times days would pass 900 rows", () => {
		const storeMonths = Array.from({ length: 29 }, () => ({}) as never);
		const month = { from: "2026-10-01", to: "2026-10-31", storeMonths };
		expect(dailySummaryIncludesAll(month)).toBe(false);
		expect(dailySummaryRowCount(month)).toBe(29 * 31);
		const small = { ...month, storeMonths: storeMonths.slice(0, 28) };
		expect(dailySummaryIncludesAll(small)).toBe(true);
		expect(dailySummaryRowCount(small)).toBe(29 * 31);
	});
});

describe("the monthly tally on this device", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		window.localStorage.clear();
	});

	it("adds each export's bytes under fnb.export-bytes.<YYYY-MM>", () => {
		expect(monthlyTallyKey("2026-11")).toBe("fnb.export-bytes.2026-11");
		expect(readMonthlyTally("2026-11")).toBe(0);
		expect(addToMonthlyTally("2026-11", 1500)).toBe(1500);
		expect(addToMonthlyTally("2026-11", 500)).toBe(2000);
		expect(readMonthlyTally("2026-11")).toBe(2000);
		expect(readMonthlyTally("2026-10")).toBe(0);
		expect(deviceMonth(new Date(2026, 10, 30, 23, 0))).toBe("2026-11");
	});

	it("survives storage that refuses to read or write", () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new DOMException("denied", "SecurityError");
		});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new DOMException("full", "QuotaExceededError");
		});
		expect(readMonthlyTally("2026-11")).toBe(0);
		expect(() => addToMonthlyTally("2026-11", 100)).not.toThrow();
	});

	it("ignores a stored value that is not a byte count", () => {
		window.localStorage.setItem(monthlyTallyKey("2026-11"), '"lots"');
		expect(readMonthlyTally("2026-11")).toBe(0);
	});
});
