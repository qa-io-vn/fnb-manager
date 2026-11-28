import { describe, expect, it } from "vitest";
import type { RecordOf } from "./columns";
import type { StoreTableId } from "./plan";
import { createExportReader, readTable } from "./reader";
import { createFakePostgrest } from "./testing/fake-postgrest";
import { TINY_STORE, tinyTables } from "./testing/synthetic-data";
import {
	type ControlTotals,
	canonicalLines,
	controlTotalsOf,
	controlTotalsRow,
	dailySummaryMatches,
	decimalOf,
	minorUnits,
	sha256Hex,
	totalsOfRecords,
	verdictOf,
} from "./totals";

const PINNED = {
	invoices: "a7399fc0eaea2679b536f8502eed461deb4614fd09b0d5afd1816e7f7c0d286f",
	invoice_lines:
		"6e58777fcf34ad78f9f724779a383ee919096f60d22056e6e61d3868988834bb",
	invoice_payments:
		"ceabcfb369e775fc13a42fb2fe5cab48b03eec571ff6a8c319dbe8fac8eacddb",
	shifts: "cfadcccb028cd7be796a8d544d7cce900f897eea6e8fbd495c4f3c5335ae19b7",
} as const;

const PINNED_FIRST_DAY_PAYMENTS =
	"09b524851eafd5c92941519a1770d3bea04cbaf9d02d09529c8f2e468b6f7ff5";

const EMPTY_FINGERPRINT =
	"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const TINY_SCOPE = {
	storeId: TINY_STORE.id,
	from: "2025-07-01",
	to: "2025-07-02",
	timeZone: TINY_STORE.timeZone,
	businessDayStartMinutes: TINY_STORE.businessDayStartMinutes,
};

async function tinyRecords<T extends StoreTableId>(
	table: T,
	scope: typeof TINY_SCOPE = TINY_SCOPE,
): Promise<RecordOf<T>[]> {
	const fake = createFakePostgrest({
		stores: [TINY_STORE],
		tables: tinyTables(),
	});
	const read = await readTable(createExportReader(fake.client), {
		table,
		scope,
		expectedRows: 0,
		personal: false,
	});
	return read.records;
}

function control(
	overrides: Partial<Record<string, unknown>> = {},
): ControlTotals {
	return controlTotalsOf(
		controlTotalsRow.parse({
			store_id: TINY_STORE.id,
			invoices: 3,
			voided_invoices: 1,
			sales_net_amount: 57345.67,
			invoice_fingerprint: PINNED.invoices,
			lines: 5,
			line_net_amount: 87345.67,
			line_fingerprint: PINNED.invoice_lines,
			payments: 3,
			payment_amount: 57345.67,
			payment_fingerprint: PINNED.invoice_payments,
			shifts: 2,
			shift_sales_amount: 57345.67,
			shift_fingerprint: PINNED.shifts,
			...overrides,
		}),
	);
}

describe("scaled values", () => {
	it("scales numbers and decimal strings exactly, never by floating multiplication", () => {
		expect(minorUnits(52300, 2)).toBe(5_230_000n);
		expect(minorUnits(120500.5, 2)).toBe(12_050_050n);
		expect(minorUnits("120500.50", 2)).toBe(12_050_050n);
		expect(minorUnits(1.5, 3)).toBe(1500n);
		expect(minorUnits(-1000, 2)).toBe(-100_000n);
		expect(minorUnits(0, 2)).toBe(0n);
		expect(minorUnits(1.005, 2)).toBe(101n);
		expect(minorUnits(0.1 + 0.2, 2)).toBe(30n);
		expect(minorUnits(99_999_999_999.99, 2)).toBe(9_999_999_999_999n);
		expect(minorUnits("1e3", 2)).toBe(100_000n);
		expect(minorUnits("-0.005", 2)).toBe(-1n);
	});

	it("turns minor units back into the decimal the database holds", () => {
		expect(decimalOf(12_050_050n)).toBe(120500.5);
		expect(decimalOf(-100_000n)).toBe(-1000);
		expect(decimalOf(5n)).toBe(0.05);
		expect(decimalOf(0n)).toBe(0);
	});
});

describe("fingerprints shared with the database tests", () => {
	it("equal the literal hex that 41_export_totals pins for the shared fixture", async () => {
		for (const table of Object.keys(PINNED) as StoreTableId[]) {
			const totals = await totalsOfRecords(table, await tinyRecords(table));
			expect(totals.fingerprint, table).toBe(PINNED[table]);
		}
	});

	it("count, sum and keep the voided invoices apart", async () => {
		const invoices = await totalsOfRecords(
			"invoices",
			await tinyRecords("invoices"),
		);
		expect(invoices).toMatchObject({ rows: 3, voided: 1, amount: 5_734_567n });
		const lines = await totalsOfRecords(
			"invoice_lines",
			await tinyRecords("invoice_lines"),
		);
		expect(lines).toMatchObject({ rows: 5, voided: null, amount: 8_734_567n });
		const payments = await totalsOfRecords(
			"invoice_payments",
			await tinyRecords("invoice_payments"),
		);
		expect(payments).toMatchObject({ rows: 3, amount: 5_734_567n });
		const shifts = await totalsOfRecords("shifts", await tinyRecords("shifts"));
		expect(shifts).toMatchObject({ rows: 2, amount: 5_734_567n });
	});

	it("take payments by their own business date and lines by their invoice's, as SQL does", async () => {
		const firstDay = { ...TINY_SCOPE, to: "2025-07-01" };
		const payments = await totalsOfRecords(
			"invoice_payments",
			await tinyRecords("invoice_payments", firstDay),
		);
		expect(payments).toMatchObject({
			rows: 1,
			amount: 2_000_000n,
			fingerprint: PINNED_FIRST_DAY_PAYMENTS,
		});
		expect(await tinyRecords("invoices", firstDay)).toHaveLength(2);
		expect(await tinyRecords("invoice_lines", firstDay)).toHaveLength(4);
		expect(await tinyRecords("shifts", firstDay)).toHaveLength(1);
	});

	it("orders lines by external id in code units, so L10 comes before L2", async () => {
		const text = canonicalLines(
			"invoice_lines",
			await tinyRecords("invoice_lines"),
		);
		expect(text.split("\n")).toEqual([
			"33333333-3333-4333-8333-000004110101|L1|item|1000|4000000",
			"33333333-3333-4333-8333-000004110101|L10|modifier|1000|0",
			"33333333-3333-4333-8333-000004110101|L2|item|2000|500000",
			"33333333-3333-4333-8333-000004110102|L1|item|1000|3000000",
			"33333333-3333-4333-8333-000004110103|L1|item|500|1234567",
		]);
	});

	it("writes an empty variance as an empty last field and nothing for no rows", async () => {
		const text = canonicalLines("shifts", await tinyRecords("shifts"));
		expect(text.split("\n")).toEqual([
			"33333333-3333-4333-8333-000004110201|4500000|-50000",
			"33333333-3333-4333-8333-000004110202|1234567|",
		]);
		expect(await sha256Hex(canonicalLines("shifts", []))).toBe(
			EMPTY_FINGERPRINT,
		);
		expect((await totalsOfRecords("invoices", [])).fingerprint).toBe(
			EMPTY_FINGERPRINT,
		);
	});
});

describe("when to re-read and when to give up", () => {
	it("verifies a file whose figures equal the database's second call", async () => {
		const own = {
			invoices: await totalsOfRecords(
				"invoices",
				await tinyRecords("invoices"),
			),
		};
		expect(verdictOf(own, control(), control(), 2)).toEqual({
			kind: "verified",
		});
	});

	it("re-reads while the database moved during the read, at most twice", async () => {
		const own = {
			invoices: await totalsOfRecords(
				"invoices",
				await tinyRecords("invoices"),
			),
		};
		const moved = control({
			invoices: 4,
			invoice_fingerprint: EMPTY_FINGERPRINT,
		});
		expect(verdictOf(own, control(), moved, 2)).toEqual({ kind: "reread" });
		expect(verdictOf(own, control(), moved, 1)).toEqual({ kind: "reread" });
		expect(verdictOf(own, control(), moved, 0)).toEqual({
			kind: "unverified",
			reason: "changed",
		});
	});

	it("marks a persistent difference as a mismatch when the database stood still", async () => {
		const own = {
			invoices: await totalsOfRecords(
				"invoices",
				await tinyRecords("invoices"),
			),
		};
		const other = control({ invoice_fingerprint: EMPTY_FINGERPRINT });
		expect(verdictOf(own, other, other, 2)).toEqual({
			kind: "unverified",
			reason: "mismatch",
		});
	});
});

describe("the daily summary check", () => {
	it("compares net sales and kept invoices with the invoice totals", () => {
		expect(
			dailySummaryMatches({ netAmount: 5_734_567n, invoices: 2 }, control()),
		).toBe(true);
		expect(
			dailySummaryMatches({ netAmount: 5_734_567n, invoices: 3 }, control()),
		).toBe(false);
		expect(
			dailySummaryMatches({ netAmount: 5_734_500n, invoices: 2 }, control()),
		).toBe(false);
	});

	it("does not count a later day's refund documents as invoices (ADR-071)", async () => {
		const refunded = control({ invoices: 4, refund_invoices: 1 });
		expect(refunded.tables.invoices.refunds).toBe(1);
		expect(
			dailySummaryMatches({ netAmount: 5_734_567n, invoices: 2 }, refunded),
		).toBe(true);
		expect(
			dailySummaryMatches({ netAmount: 5_734_567n, invoices: 3 }, refunded),
		).toBe(false);
		// a database that does not report refund documents yet reads as none
		expect(control().tables.invoices.refunds).toBeUndefined();
		const records = await tinyRecords("invoices");
		const withRefund = [
			...records,
			{ ...records[0], id: "refund-1", status: "refund", net_amount: -1000 },
		] as RecordOf<"invoices">[];
		const totals = await totalsOfRecords("invoices", withRefund);
		expect(totals).toMatchObject({ rows: 4, voided: 1, refunds: 1 });
		expect(totals.amount).toBe(5_734_567n - 100_000n);
	});
});
