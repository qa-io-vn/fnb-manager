import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	afterCompositeKey,
	fetchAllByKey,
	fetchAllPages,
	quotedFilterValue,
} from "./paginate";

describe("fetchAllPages", () => {
	it("keeps requesting ranges until a short page arrives", async () => {
		const all = Array.from({ length: 2_345 }, (_, index) => ({ n: index }));
		const ranges: [number, number][] = [];
		const rows = await fetchAllPages(
			z.object({ n: z.number() }),
			async (from, to) => {
				ranges.push([from, to]);
				return { data: all.slice(from, to + 1), error: null };
			},
		);
		expect(rows).toHaveLength(2_345);
		expect(ranges).toEqual([
			[0, 999],
			[1000, 1999],
			[2000, 2999],
		]);
	});

	it("asks one more page when the last page is exactly full", async () => {
		let calls = 0;
		const rows = await fetchAllPages(
			z.number(),
			async (from) => {
				calls += 1;
				return { data: from === 0 ? [1, 2] : [], error: null };
			},
			2,
		);
		expect(rows).toEqual([1, 2]);
		expect(calls).toBe(2);
	});

	it("throws the API error", async () => {
		await expect(
			fetchAllPages(z.number(), async () => ({
				data: null,
				error: { message: "permission denied" },
			})),
		).rejects.toThrow("permission denied");
	});
});

interface Line {
	invoiceId: string;
	lineNo: number;
	rowId: number;
}

const lineSchema = z.object({
	invoiceId: z.string(),
	lineNo: z.number(),
	rowId: z.number(),
});

function compareLines(left: Line, right: Line): number {
	return (
		left.invoiceId.localeCompare(right.invoiceId) || left.lineNo - right.lineNo
	);
}

class ResyncingTable {
	private rows: Line[];
	private nextRowId = 1_000;

	constructor(invoices: number, linesPerInvoice: number) {
		this.rows = Array.from({ length: invoices }, (_, invoice) =>
			Array.from({ length: linesPerInvoice }, (_, lineNo) => ({
				invoiceId: `inv-${String(invoice).padStart(3, "0")}`,
				lineNo,
				rowId: invoice * linesPerInvoice + lineNo,
			})),
		).flat();
	}

	resync(newInvoiceId: string): void {
		const reinserted = [...this.rows]
			.sort((left, right) => compareLines(right, left))
			.map((row) => ({ ...row, rowId: this.nextRowId++ }));
		this.rows = [
			...reinserted,
			{ invoiceId: newInvoiceId, lineNo: 0, rowId: this.nextRowId++ },
		];
	}

	pageByRowId(from: number, to: number): Line[] {
		return [...this.rows]
			.sort((left, right) => left.rowId - right.rowId)
			.slice(from, to + 1);
	}

	pageAfter(after: Line | null, size: number): Line[] {
		return [...this.rows]
			.sort(compareLines)
			.filter((row) => after === null || compareLines(row, after) > 0)
			.slice(0, size);
	}

	keys(): string[] {
		return this.rows.map(lineKey).sort();
	}
}

const lineKey = (row: Line) => `${row.invoiceId}|${row.lineNo}`;

describe("fetchAllByKey", () => {
	it("reads every row once when a sync rewrites row ids between two pages", async () => {
		const table = new ResyncingTable(30, 4);
		const before = table.keys();
		let calls = 0;
		const rows = await fetchAllByKey(
			lineSchema,
			lineKey,
			async (after, size) => {
				calls += 1;
				const page = table.pageAfter(after, size);
				if (calls === 1) table.resync("inv-000a");
				return { data: page, error: null };
			},
			50,
		);
		const keys = rows.map(lineKey).sort();
		expect(new Set(keys).size).toBe(keys.length);
		expect(before.every((key) => keys.includes(key))).toBe(true);
		expect(keys).not.toContain("inv-000a|0");
	});

	it("shows why offset pages ordered by a rewritten id are not safe", async () => {
		const table = new ResyncingTable(30, 4);
		let calls = 0;
		const rows = await fetchAllPages(
			lineSchema,
			async (from, to) => {
				calls += 1;
				const page = table.pageByRowId(from, to);
				if (calls === 1) table.resync("inv-000a");
				return { data: page, error: null };
			},
			50,
		);
		const distinct = new Set(rows.map(lineKey));
		expect(rows.length).toBeGreaterThan(distinct.size);
		expect(distinct.size).toBeLessThan(121);
	});

	it("drops a row delivered twice", async () => {
		const pages = [
			[
				{ invoiceId: "a", lineNo: 0, rowId: 1 },
				{ invoiceId: "a", lineNo: 1, rowId: 2 },
			],
			[{ invoiceId: "a", lineNo: 1, rowId: 3 }],
		];
		const rows = await fetchAllByKey(
			lineSchema,
			lineKey,
			async (after) => ({ data: pages[after === null ? 0 : 1], error: null }),
			2,
		);
		expect(rows.map(lineKey)).toEqual(["a|0", "a|1"]);
	});
});

describe("keyset filters", () => {
	it("quotes text values for the PostgREST logic tree", () => {
		expect(quotedFilterValue('a,b"c\\d')).toBe('"a,b\\"c\\\\d"');
		expect(quotedFilterValue(3)).toBe("3");
	});

	it("continues after a composite key", () => {
		expect(
			afterCompositeKey(
				{ column: "invoice_id", value: "inv-1" },
				{ column: "sequence_no", value: 2 },
			),
		).toBe('invoice_id.gt."inv-1",and(invoice_id.eq."inv-1",sequence_no.gt.2)');
	});
});
