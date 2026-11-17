import { describe, expect, it } from "vitest";
import {
	COLUMNS,
	columnsFor,
	localDateTime,
	personalColumnsOf,
	type ShiftRecord,
	shiftBusinessDate,
	shiftRow,
	withColumns,
} from "./columns";
import { EXPORT_TABLES, type ExportStore } from "./plan";
import { csvText } from "./writers";

const STORE: ExportStore = {
	id: "11111111-1111-4111-8111-111111111111",
	label: "S1",
	name: "Cửa hàng thử",
	timeZone: "Asia/Ho_Chi_Minh",
	businessDayStartMinutes: 300,
	asOf: "2026-11-15",
};

const SHIFT: ShiftRecord = {
	id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
	external_id: "CA-1",
	name: "cashier@example.com",
	opened_at: "2026-10-31T21:30:00+00:00",
	closed_at: "2026-11-01T05:15:30+00:00",
	orders_count: 12,
	sales_amount: 1250000,
	opening_float_amount: 500000,
	expected_cash_amount: 900000,
	cash_drawer_amount: 899000,
	cash_variance_amount: -1000,
	changed_after_close: false,
	status: "closed",
	device_code: "POS-1",
	cashier_name: "Thu ngân Lê",
};

describe("export columns", () => {
	it("never names raw or synced_at", () => {
		for (const table of EXPORT_TABLES) {
			const names = COLUMNS[table].map((column) => column.key);
			expect(names, table).not.toContain("raw");
			expect(names, table).not.toContain("synced_at");
			expect(new Set(names).size, table).toBe(names.length);
			for (const name of names) expect(name).toMatch(/^[a-z_]+$/);
		}
	});

	it("leaves personal columns and the shift name out by default", () => {
		expect(personalColumnsOf("invoices")).toEqual([
			"customer_phone",
			"customer_name",
			"employee_name",
			"voucher_code",
		]);
		expect(personalColumnsOf("invoice_lines")).toEqual(["note"]);
		expect(personalColumnsOf("invoice_payments")).toEqual([
			"reference_no",
			"partner_transaction_id",
		]);
		expect(personalColumnsOf("shifts")).toEqual(["name", "cashier_name"]);
		expect(personalColumnsOf("daily_summary")).toEqual([]);
		for (const table of EXPORT_TABLES) {
			for (const column of personalColumnsOf(table)) {
				expect(columnsFor(table, false)).not.toContain(column);
				expect(columnsFor(table, true)).toContain(column);
			}
		}
	});

	it("writes a shift name such as a cashier's e-mail only when the box is ticked", () => {
		const row = shiftRow(SHIFT, STORE);
		const plain = csvText(
			columnsFor("shifts", false),
			[withColumns(row, columnsFor("shifts", false))],
			"comma",
		);
		const personal = csvText(columnsFor("shifts", true), [row], "comma");
		expect(plain).not.toContain("cashier@example.com");
		expect(plain).not.toContain("Thu ngân Lê");
		expect(personal).toContain("cashier@example.com");
		expect(personal).toContain("Thu ngân Lê");
	});

	it("adds local times in the store's zone and the shift's business date after the day start", () => {
		const row = shiftRow(SHIFT, STORE);
		expect(row.opened_at_local).toBe("2026-11-01 04:30:00");
		expect(row.business_date).toBe("2026-10-31");
		expect(row.closed_at_local).toBe("2026-11-01 12:15:30");
		expect(shiftBusinessDate("2026-10-31T22:00:00+00:00", STORE)).toBe(
			"2026-11-01",
		);
		expect(localDateTime(null, STORE.timeZone)).toBeNull();
		expect(localDateTime("2026-03-08T10:30:00Z", "America/Los_Angeles")).toBe(
			"2026-03-08 03:30:00",
		);
	});

	it("starts the daily summary with the date, scope and store name, then the period totals", () => {
		const columns = columnsFor("daily_summary", true);
		expect(columns.slice(0, 5)).toEqual([
			"business_date",
			"scope",
			"store_name",
			"days_with_data",
			"invoices",
		]);
		expect(columns.slice(-3)).toEqual([
			"holiday_kind",
			"checked_days",
			"matched_days",
		]);
	});
});
