import { describe, expect, it } from "vitest";
import type { RecordOf } from "./columns";
import {
	createExportReader,
	readTable,
	recordKey,
	type StoreMonthScope,
	selectList,
	shiftWindow,
} from "./reader";
import {
	createFakePostgrest,
	type FakeTables,
	oracleControlTotals,
} from "./testing/fake-postgrest";
import {
	STORE_ONE,
	STORE_TWO,
	syntheticTables,
} from "./testing/synthetic-data";

const OCTOBER: StoreMonthScope = {
	storeId: STORE_ONE.id,
	from: "2026-10-01",
	to: "2026-10-31",
	timeZone: STORE_ONE.timeZone,
	businessDayStartMinutes: STORE_ONE.businessDayStartMinutes,
};

function busyTables(): FakeTables {
	return syntheticTables({
		stores: [STORE_ONE, STORE_TWO],
		from: "2026-09-28",
		to: "2026-11-02",
		invoicesPerDay: 40,
	});
}

function expectedCount(
	tables: FakeTables,
	table: "invoices" | "invoice_lines",
) {
	const totals = oracleControlTotals(
		tables,
		OCTOBER.storeId,
		OCTOBER.from,
		OCTOBER.to,
	);
	return (table === "invoices" ? totals.invoices : totals.lines) as number;
}

function keysOf<T extends "invoices" | "invoice_lines">(
	table: T,
	records: readonly RecordOf<T>[],
): string[] {
	return records.map((record) => recordKey(table, record));
}

describe("the keyset reader under a server row cap", () => {
	it.each([1000, 500, 250])(
		"reads every invoice line exactly once when the server returns at most %i rows",
		async (cap) => {
			const tables = busyTables();
			const fake = createFakePostgrest({
				stores: [STORE_ONE, STORE_TWO],
				tables,
				serverCap: cap,
			});
			const expected = expectedCount(tables, "invoice_lines");
			expect(expected).toBeGreaterThan(2000);
			const read = await readTable(createExportReader(fake.client), {
				table: "invoice_lines",
				scope: OCTOBER,
				expectedRows: expected,
				personal: false,
			});
			const keys = keysOf("invoice_lines", read.records);
			expect(new Set(keys).size).toBe(keys.length);
			expect(keys).toHaveLength(expected);
			expect(fake.requests).toHaveLength(Math.ceil(expected / cap));
		},
	);

	it("keeps reading past a short page until an empty page when rows went missing", async () => {
		const tables = busyTables();
		const fake = createFakePostgrest({
			stores: [STORE_ONE],
			tables,
			serverCap: 250,
		});
		const expected = expectedCount(tables, "invoices");
		const read = await readTable(createExportReader(fake.client), {
			table: "invoices",
			scope: OCTOBER,
			expectedRows: expected + 5,
			personal: false,
		});
		expect(read.records).toHaveLength(expected);
		expect(fake.requests.at(-1)?.returned).toBe(0);
		expect(fake.requests).toHaveLength(Math.ceil(expected / 250) + 1);
	});

	it("neither drops nor doubles a row when rows are added and removed between pages", async () => {
		const tables = busyTables();
		const original = tables.invoices.filter(
			(row) =>
				row.store_id === OCTOBER.storeId &&
				row.business_date >= OCTOBER.from &&
				row.business_date <= OCTOBER.to,
		);
		const removedAhead = original.at(-3);
		const fake = createFakePostgrest({
			stores: [STORE_ONE],
			tables,
			serverCap: 500,
			beforeRequest: (index, current) => {
				if (index !== 1) return;
				current.invoices = current.invoices.filter(
					(row) => row.id !== removedAhead?.id,
				);
				const template = original.at(-1);
				if (template) {
					current.invoices.push({
						...template,
						id: "ffffffff-0000-4000-8000-000000000001",
						external_id: "HD-NEW",
					});
				}
			},
		});
		const read = await readTable(createExportReader(fake.client), {
			table: "invoices",
			scope: OCTOBER,
			expectedRows: original.length,
			personal: false,
		});
		const keys = keysOf("invoices", read.records);
		expect(new Set(keys).size).toBe(keys.length);
		expect(keys).toContain("ffffffff-0000-4000-8000-000000000001");
		expect(keys).not.toContain(removedAhead?.id);
		const survivors = original
			.filter((row) => row.id !== removedAhead?.id)
			.map((row) => row.id);
		for (const id of survivors) expect(keys).toContain(id);
	});

	it("gives the same rows with 97-row pages as with 1,000-row pages", async () => {
		const tables = busyTables();
		const read = async (pageSize: number) => {
			const fake = createFakePostgrest({ stores: [STORE_ONE], tables });
			return readTable(createExportReader(fake.client), {
				table: "invoice_lines",
				scope: OCTOBER,
				expectedRows: expectedCount(tables, "invoice_lines"),
				pageSize,
				personal: false,
			});
		};
		const large = await read(1000);
		const small = await read(97);
		expect(small.records).toEqual(large.records);
		expect(small.pages).toBeGreaterThan(large.pages);
	});

	it("refuses a page size that is not a positive integer", async () => {
		const fake = createFakePostgrest({
			stores: [STORE_ONE],
			tables: busyTables(),
		});
		await expect(
			readTable(createExportReader(fake.client), {
				table: "invoices",
				scope: OCTOBER,
				expectedRows: 0,
				pageSize: 0,
				personal: false,
			}),
		).rejects.toThrow(RangeError);
	});
});

describe("the queries sent to PostgREST", () => {
	it("pages invoices by business date then id, inside the store-month", async () => {
		const fake = createFakePostgrest({
			stores: [STORE_ONE],
			tables: busyTables(),
			serverCap: 500,
		});
		await readTable(createExportReader(fake.client), {
			table: "invoices",
			scope: OCTOBER,
			expectedRows: 1240,
			personal: false,
		});
		const [first, second] = fake.requests;
		expect(first?.filters).toEqual([
			`store_id=eq.${STORE_ONE.id}`,
			"business_date=gte.2026-10-01",
			"business_date=lte.2026-10-31",
		]);
		expect(first?.order).toEqual(["business_date", "id"]);
		expect(first?.limit).toBe(1000);
		expect(second?.filters.at(-1)).toMatch(
			/^or=\(business_date\.gt\."2026-10-\d{2}",and\(business_date\.eq\."2026-10-\d{2}",id\.gt\."[0-9a-f-]{36}"\)\)$/,
		);
	});

	it("filters lines on their invoice's business date and payments on their own", async () => {
		const fake = createFakePostgrest({
			stores: [STORE_ONE],
			tables: busyTables(),
		});
		const reader = createExportReader(fake.client);
		await readTable(reader, {
			table: "invoice_lines",
			scope: OCTOBER,
			expectedRows: 0,
			personal: false,
		});
		await readTable(reader, {
			table: "invoice_payments",
			scope: OCTOBER,
			expectedRows: 0,
			personal: false,
		});
		const lines = fake.requests.find(
			(request) => request.table === "invoice_lines",
		);
		const payments = fake.requests.find(
			(request) => request.table === "invoice_payments",
		);
		expect(lines?.select).toContain(
			"invoices!inner(external_id,business_date)",
		);
		expect(lines?.filters).toContain("invoices.business_date=gte.2026-10-01");
		expect(lines?.order).toEqual(["invoice_id", "external_id"]);
		expect(payments?.filters).toContain("business_date=lte.2026-10-31");
		expect(payments?.order).toEqual(["invoice_id", "sequence_no"]);
	});

	it("reads shifts between the business-day starts of the month and of the next month", () => {
		expect(shiftWindow(OCTOBER)).toEqual({
			from: "2026-09-30T22:00:00.000Z",
			until: "2026-10-31T22:00:00.000Z",
		});
		expect(
			shiftWindow({
				...OCTOBER,
				timeZone: "America/Los_Angeles",
				businessDayStartMinutes: 0,
				from: "2026-11-01",
				to: "2026-11-30",
			}),
		).toEqual({
			from: "2026-11-01T07:00:00.000Z",
			until: "2026-12-01T08:00:00.000Z",
		});
	});

	it("asks for personal columns only when they are wanted", () => {
		expect(selectList("invoices", false)).not.toContain("customer_phone");
		expect(selectList("invoices", true)).toContain(
			"customer_phone,customer_name,employee_name,voucher_code",
		);
		expect(selectList("shifts", false)).not.toMatch(/(^|,)name(,|$)/);
		expect(selectList("shifts", true)).toMatch(/(^|,)name,cashier_name$/);
		expect(selectList("invoice_lines", false)).not.toContain("note");
		expect(selectList("invoice_payments", false)).not.toContain("reference_no");
	});

	it("measures the bytes received as the UTF-8 length of each page", async () => {
		const fake = createFakePostgrest({
			stores: [STORE_ONE],
			tables: busyTables(),
		});
		const reader = createExportReader(fake.client);
		const page = await reader.page({
			table: "invoices",
			scope: OCTOBER,
			after: null,
			pageSize: 10,
			personal: false,
		});
		expect(page.value).toHaveLength(10);
		expect(page.bytes).toBe(
			new TextEncoder().encode(JSON.stringify(page.value)).length,
		);
	});
});
