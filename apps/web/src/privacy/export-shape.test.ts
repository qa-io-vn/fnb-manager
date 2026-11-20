import { describe, expect, it } from "vitest";
import { ExportShapeError, parseSubjectExport } from "./export-shape";

function exportJson(overrides: Record<string, unknown> = {}) {
	return {
		request: {
			id: "r1",
			request_type: "access",
			received_at: "2026-11-18T02:00:00Z",
		},
		exported_at: "2026-11-20T03:00:00Z",
		customer: {
			id: "c1",
			name: "Khách mẫu",
			phone: "+84".concat("900016101"),
			first_seen_at: "2026-10-01T02:00:00Z",
			last_seen_at: "2026-11-01T02:00:00Z",
		},
		invoices: [{ id: "i1" }],
		memberships: [{ id: "m1" }],
		loyalty_ledger: [{ id: "l1" }, { id: "l2" }],
		stamps: [],
		receipt_claims: [],
		redemptions: [],
		consent_records: [{ id: "k1" }],
		messages: [],
		counts: {
			invoices: 1,
			memberships: 1,
			loyalty_ledger: 2,
			stamps: 0,
			receipt_claims: 0,
			redemptions: 0,
			consent_records: 1,
			messages: 0,
		},
		...overrides,
	};
}

describe("the export JSON shape", () => {
	it("accepts the database answer and returns the counts and the file text", () => {
		const parsed = parseSubjectExport(exportJson());
		expect(parsed.counts.loyalty_ledger).toBe(2);
		expect(JSON.parse(parsed.json)).toEqual(exportJson());
	});

	it("refuses a missing table", () => {
		const { stamps: _stamps, ...rest } = exportJson();
		expect(() => parseSubjectExport(rest)).toThrow(ExportShapeError);
	});

	it("refuses a count that differs from its rows (a truncated export)", () => {
		expect(() =>
			parseSubjectExport(
				exportJson({ counts: { ...exportJson().counts, loyalty_ledger: 3 } }),
			),
		).toThrow(ExportShapeError);
	});

	it("refuses a negative or fractional count", () => {
		expect(() =>
			parseSubjectExport(
				exportJson({ counts: { ...exportJson().counts, stamps: -1 } }),
			),
		).toThrow(ExportShapeError);
		expect(() =>
			parseSubjectExport(
				exportJson({ counts: { ...exportJson().counts, stamps: 0.5 } }),
			),
		).toThrow(ExportShapeError);
	});

	it("refuses non-objects", () => {
		for (const value of [null, undefined, 3, "x", []]) {
			expect(() => parseSubjectExport(value)).toThrow(ExportShapeError);
		}
	});
});
