import { describe, expect, it } from "vitest";
import {
	allowedDifference,
	buildChecks,
	totalsMatch,
} from "../../src/index.js";
import { createFakeConnector } from "../support/fake-connector.js";
import { sale, totalsFor } from "../support/sales.js";
import { createTestBed } from "../support/setup.js";

describe("control-total tolerance", () => {
	it("allows the larger of 1,000 and 0.05 percent of the POS net", () => {
		expect(allowedDifference(100_000)).toBe(1_000);
		expect(allowedDifference(2_000_000)).toBe(1_000);
		expect(allowedDifference(10_000_000)).toBe(5_000);
		expect(allowedDifference(-10_000_000)).toBe(5_000);
	});

	it("matches on the boundary and fails just past it", () => {
		const source = { invoiceCount: 10, netAmount: 1_500_000 };
		expect(
			totalsMatch(source, { invoiceCount: 10, netAmount: 1_501_000 }),
		).toBe(true);
		expect(
			totalsMatch(source, { invoiceCount: 10, netAmount: 1_498_999.99 }),
		).toBe(false);
		const large = { invoiceCount: 300, netAmount: 20_000_000 };
		expect(
			totalsMatch(large, { invoiceCount: 300, netAmount: 20_010_000 }),
		).toBe(true);
		expect(
			totalsMatch(large, { invoiceCount: 300, netAmount: 20_010_001 }),
		).toBe(false);
	});

	it("requires the invoice count to be exact", () => {
		expect(
			totalsMatch(
				{ invoiceCount: 10, netAmount: 100 },
				{ invoiceCount: 9, netAmount: 100 },
			),
		).toBe(false);
	});

	it("treats a day missing on either side as zero", () => {
		const rows = buildChecks(
			["2026-11-01", "2026-11-02"],
			[
				{
					businessDate: "2026-11-01",
					invoiceCount: 2,
					netAmount: 90_000,
					raw: null,
				},
			],
			[
				{
					business_date: "2026-11-02",
					invoice_count: 1,
					net_amount: "45000.00",
				},
			],
			{
				tenantId: "t",
				storeId: "s",
				tolerance: { absolute: 1_000, relative: 0.0005 },
			},
		);
		expect(
			rows.map((row) => [
				row.business_date,
				row.source_invoice_count,
				row.source_net_amount,
				row.local_invoice_count,
				row.local_net_amount,
				row.is_matched,
			]),
		).toEqual([
			["2026-11-01", 2, "90000.00", 0, "0.00", false],
			["2026-11-02", 0, "0.00", 1, "45000.00", false],
		]);
	});

	it("flags an unmatched day in the run summary", async () => {
		const bed = await createTestBed();
		const sales = [sale("T-1", "2026-11-01T02:00:00.000Z", "2026-11-01")];
		const totals = totalsFor(sales).map((total) => ({
			...total,
			netAmount: total.netAmount + 1_001,
		}));
		const connector = createFakeConnector({ sales, totals });
		const summary = await bed
			.engine(connector)
			.syncWindow(
				bed.account,
				[bed.store],
				{ fromDate: "2026-11-01", toDate: "2026-11-01" },
				"backfill",
			);
		expect(summary.checks).toEqual({
			available: true,
			matched: 0,
			unmatched: 1,
		});
		expect(bed.repository.tables.checks[0]).toMatchObject({
			source_net_amount: "46001.00",
			local_net_amount: "45000.00",
			is_matched: false,
		});
	});
});
