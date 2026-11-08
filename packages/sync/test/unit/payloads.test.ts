import { describe, expect, it } from "vitest";
import {
	mapSale,
	salePayloadRecord,
	withoutParentFields,
} from "../../src/index.js";
import { cashPayment, itemLine, sale } from "../support/sales.js";

const context = {
	tenantId: "tenant-1",
	storeId: "store-1",
	posAccountId: "account-1",
	businessDate: "2026-11-01",
};

interface PayloadRecord {
	external_id: string;
	invoice: Record<string, unknown> | null;
	lines: Record<string, Record<string, unknown> | null>;
	payments: Record<string, Record<string, unknown> | null>;
}

function parseRecord(record: string): PayloadRecord {
	return JSON.parse(record) as PayloadRecord;
}

describe("withoutParentFields", () => {
	it("drops the fields whose value equals the parent's and keeps the rest", () => {
		expect(
			withoutParentFields(
				{
					tran_id: "T-1",
					store_uid: "S-1",
					amount: 45_000,
					nested: { a: 1, b: [1, 2] },
					list: [1, 2],
					note: "",
				},
				{
					tran_id: "T-1",
					store_uid: "S-2",
					amount: 50_000,
					nested: { b: [1, 2], a: 1 },
					list: [2, 1],
				},
			),
		).toEqual({ store_uid: "S-1", amount: 45_000, list: [1, 2], note: "" });
	});

	it("leaves a payload unchanged when either side is not an object", () => {
		expect(withoutParentFields(null, { a: 1 })).toBeNull();
		expect(withoutParentFields([1, 2], { a: 1 })).toEqual([1, 2]);
		expect(withoutParentFields({ a: 1 }, null)).toEqual({ a: 1 });
		expect(withoutParentFields({ a: 1 }, ["a"])).toEqual({ a: 1 });
	});
});

describe("sale payloads", () => {
	it("maps line and payment payloads without the fields of their invoice", () => {
		const { write } = mapSale(
			sale("T-1", "2026-11-01T03:15:00.000Z", "2026-11-01", {
				raw: { tran_id: "T-1", store_uid: "S-1", employee_id: "E-1" },
				lines: [
					itemLine("L1", {
						raw: { id: "L1", tran_id: "T-1", store_uid: "S-1", item_id: "I-1" },
					}),
				],
				payments: [
					cashPayment(45_000, {
						raw: { tran_id: "T-1", employee_id: "E-2", amount: 45_000 },
					}),
				],
			}),
			context,
		);
		expect(write.invoice.raw).toEqual({
			tran_id: "T-1",
			store_uid: "S-1",
			employee_id: "E-1",
		});
		expect(write.lines[0]?.raw).toEqual({ id: "L1", item_id: "I-1" });
		expect(write.payments[0]?.raw).toEqual({
			employee_id: "E-2",
			amount: 45_000,
		});
	});

	it("records the invoice payload, the lines by external id and the payments by sequence", () => {
		const { write } = mapSale(
			sale("T-2", "2026-11-01T03:15:00.000Z", "2026-11-01", {
				lines: [itemLine("L1"), itemLine("L1")],
				payments: [
					cashPayment(20_000),
					cashPayment(25_000, { raw: { trace: "R-1" } }),
				],
			}),
			context,
		);
		expect(parseRecord(salePayloadRecord(write))).toEqual({
			external_id: "T-2",
			invoice: { id: "T-2" },
			lines: { L1: { line: "L1" }, "L1#2": { line: "L1" } },
			payments: { "1": null, "2": { trace: "R-1" } },
		});
	});

	it("rebuilds every field of a line payload from its record and the invoice payload", () => {
		const invoiceRaw = {
			tran_id: "T-3",
			store_uid: "S-1",
			amount_origin: 45_000,
			start_date: 1_762_000_000_000,
		};
		const lineRaw = {
			id: "L1",
			tran_id: "T-3",
			store_uid: "S-1",
			amount_origin: 20_000,
			quantity: 1,
		};
		const { write } = mapSale(
			sale("T-3", "2026-11-01T03:15:00.000Z", "2026-11-01", {
				raw: invoiceRaw,
				lines: [itemLine("L1", { raw: lineRaw })],
			}),
			context,
		);
		const record = parseRecord(salePayloadRecord(write));
		const line = record.lines.L1 ?? {};
		const rebuilt = Object.fromEntries(
			Object.keys(lineRaw).map((key) => [
				key,
				Object.hasOwn(line, key) ? line[key] : record.invoice?.[key],
			]),
		);
		expect(rebuilt).toEqual(lineRaw);
		expect(Object.keys(line).sort()).toEqual([
			"amount_origin",
			"id",
			"quantity",
		]);
	});

	it("keeps one record on one line when a payload holds line breaks", () => {
		const { write } = mapSale(
			sale("T-4", "2026-11-01T03:15:00.000Z", "2026-11-01", {
				raw: { id: "T-4", note: "ít đá\nmang về" },
			}),
			context,
		);
		const record = salePayloadRecord(write);
		expect(record).not.toContain("\n");
		expect(parseRecord(record).invoice).toEqual({
			id: "T-4",
			note: "ít đá\nmang về",
		});
	});
});
