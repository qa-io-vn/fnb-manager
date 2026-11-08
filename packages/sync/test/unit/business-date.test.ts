import { describe, expect, it } from "vitest";
import { createFakeConnector } from "../support/fake-connector.js";
import { sale, totalsFor } from "../support/sales.js";
import { createTestBed } from "../support/setup.js";

describe("business-date assignment", () => {
	it("books a 00:30 sale to the previous date with a 05:00 day start", async () => {
		const bed = await createTestBed({ dayStartMinutes: 300 });
		const late = sale("T-LATE", "2026-11-01T17:30:00.000Z", "2026-11-01");
		const early = sale("T-EARLY", "2026-11-01T22:05:00.000Z", "2026-11-02");
		const connector = createFakeConnector({
			sales: [late, early],
			totals: totalsFor([late, early]),
		});
		const summary = await bed
			.engine(connector)
			.syncWindow(
				bed.account,
				[bed.store],
				{ fromDate: "2026-11-01", toDate: "2026-11-02" },
				"backfill",
			);
		const dates = Object.fromEntries(
			bed.repository.tables.invoices.map((row) => [
				row.external_id,
				row.business_date,
			]),
		);
		expect(dates).toEqual({ "T-LATE": "2026-11-01", "T-EARLY": "2026-11-02" });
		const payments = bed.repository.tables.payments
			.map((payment) => payment.business_date)
			.sort();
		expect(payments).toEqual(["2026-11-01", "2026-11-02"]);
		expect(summary.flags).toEqual([]);
	});

	it("uses the store's stored day start and flags a connector date that disagrees", async () => {
		const bed = await createTestBed({ dayStartMinutes: 300 });
		const disputed = sale("T-1", "2026-11-01T20:00:00.000Z", "2026-11-02");
		const connector = createFakeConnector({
			sales: [disputed],
			totals: [
				{
					businessDate: "2026-11-01",
					invoiceCount: 1,
					netAmount: 45_000,
					raw: null,
				},
			],
		});
		const summary = await bed
			.engine(connector)
			.syncWindow(
				bed.account,
				[bed.store],
				{ fromDate: "2026-11-01", toDate: "2026-11-02" },
				"backfill",
			);
		expect(bed.repository.tables.invoices[0]?.business_date).toBe("2026-11-01");
		expect(summary.flags).toContainEqual({
			code: "business_date_reassigned",
			severity: "warn",
			count: 1,
		});
		expect(summary.checks.unmatched).toBe(0);
	});

	it("drops a sale whose business date falls outside the window", async () => {
		const bed = await createTestBed();
		const outside = sale("T-OUT", "2026-10-31T10:00:00.000Z", "2026-11-01");
		const connector = createFakeConnector({ sales: [] });
		connector.fetchSales = async function* () {
			yield [outside];
		};
		const summary = await bed
			.engine(connector)
			.syncWindow(
				bed.account,
				[bed.store],
				{ fromDate: "2026-11-01", toDate: "2026-11-01" },
				"backfill",
			);
		expect(bed.repository.tables.invoices).toHaveLength(0);
		expect(summary.flags).toContainEqual({
			code: "sale_outside_window",
			severity: "warn",
			count: 1,
		});
	});
});
