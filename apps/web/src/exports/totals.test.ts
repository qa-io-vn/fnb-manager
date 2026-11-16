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
	invoices: "752a75ab281b2788a8a7b164124f2c00baeae344500697420f9195bcd372b072",
	invoice_lines:
		"d2cf95fc77e62b26a98fd1ce6f879b0a3c1b6dedec6eb0f577389272ac6ec08a",
	invoice_payments:
		"c19ec04ae4a14582c6b1a8bc33c26224703a70bbf7def8fcecccc0745d595e60",
	shifts: "f2f7bb103b17f27c17e1a041fb427b6c658828a9a39dcefc4feb5636240c4eae",
} as const;

const EMPTY_FINGERPRINT =
	"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const TINY_SCOPE = {
	storeId: TINY_STORE.id,
	from: "2026-10-01",
	to: "2026-10-31",
	timeZone: TINY_STORE.timeZone,
	businessDayStartMinutes: TINY_STORE.businessDayStartMinutes,
};

async function tinyRecords<T extends StoreTableId>(
	table: T,
): Promise<RecordOf<T>[]> {
	const fake = createFakePostgrest({
		stores: [TINY_STORE],
		tables: tinyTables(),
	});
	const read = await readTable(createExportReader(fake.client), {
		table,
		scope: TINY_SCOPE,
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
			sales_net_amount: 172800.5,
			invoice_fingerprint: PINNED.invoices,
			lines: 5,
			line_net_amount: 207800.5,
			line_fingerprint: PINNED.invoice_lines,
			payments: 3,
			payment_amount: 172800.5,
			payment_fingerprint: PINNED.invoice_payments,
			shifts: 2,
			shift_sales_amount: 172800.5,
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
	it("equal the literal hex that SQL computes for the tiny fixture", async () => {
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
		expect(invoices).toMatchObject({ rows: 3, voided: 1, amount: 17_280_050n });
		const lines = await totalsOfRecords(
			"invoice_lines",
			await tinyRecords("invoice_lines"),
		);
		expect(lines).toMatchObject({ rows: 5, voided: null, amount: 20_780_050n });
		const shifts = await totalsOfRecords("shifts", await tinyRecords("shifts"));
		expect(shifts).toMatchObject({ rows: 2, amount: 17_280_050n });
	});

	it("orders lines by external id in code units, so L10 comes before L2", async () => {
		const text = canonicalLines(
			"invoice_lines",
			await tinyRecords("invoice_lines"),
		);
		expect(text.split("\n")).toEqual([
			"aaaaaaaa-aaaa-4aaa-8aaa-000000000001|L1|item|1000|4000000",
			"aaaaaaaa-aaaa-4aaa-8aaa-000000000001|L2|modifier|2000|1230000",
			"aaaaaaaa-aaaa-4aaa-8aaa-000000000002|L1|item|1000|3500000",
			"aaaaaaaa-aaaa-4aaa-8aaa-000000000003|L10|item|1500|9000000",
			"aaaaaaaa-aaaa-4aaa-8aaa-000000000003|L2|item|1000|3050050",
		]);
	});

	it("writes an empty variance as an empty last field and nothing for no rows", async () => {
		const text = canonicalLines("shifts", await tinyRecords("shifts"));
		expect(text.split("\n")).toEqual([
			"bbbbbbbb-bbbb-4bbb-8bbb-000000000001|5230000|-100000",
			"bbbbbbbb-bbbb-4bbb-8bbb-000000000002|12050050|",
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
			dailySummaryMatches({ netAmount: 17_280_050n, invoices: 2 }, control()),
		).toBe(true);
		expect(
			dailySummaryMatches({ netAmount: 17_280_050n, invoices: 3 }, control()),
		).toBe(false);
		expect(
			dailySummaryMatches({ netAmount: 17_280_000n, invoices: 2 }, control()),
		).toBe(false);
	});
});
