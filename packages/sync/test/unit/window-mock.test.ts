import { createMockConnector } from "@fnb/connector-mock";
import { describe, expect, it } from "vitest";
import { createTestBed } from "../support/setup.js";

const WINDOW = { fromDate: "2026-10-26", toDate: "2026-11-01" };

async function mockBed() {
	const bed = await createTestBed({ storeExternalId: "MOCK-S1" });
	const connector = createMockConnector();
	await connector.authenticate({ seed: 42 });
	return { ...bed, connector };
}

describe("syncWindow with the mock connector", () => {
	it("stores every non-voided sale the control totals count and matches every day", async () => {
		const { repository, account, store, engine, connector } = await mockBed();
		const summary = await engine(connector).syncWindow(
			account,
			[store],
			WINDOW,
			"backfill",
		);
		const totals = await connector.fetchControlTotals(
			{
				externalId: "MOCK-S1",
				name: "x",
				timezone: "Asia/Ho_Chi_Minh",
				dayStartMinutes: 0,
				currency: "VND",
			},
			WINDOW,
		);
		const expected = totals.reduce((sum, total) => sum + total.invoiceCount, 0);
		const stored = repository.tables.invoices.filter(
			(invoice) => invoice.status !== "voided",
		);
		expect(stored).toHaveLength(expected);
		expect(summary.status).toBe("succeeded");
		expect(summary.checks).toEqual({
			available: true,
			matched: 7,
			unmatched: 0,
		});
		expect(repository.tables.checks.every((check) => check.is_matched)).toBe(
			true,
		);
		expect(repository.tables.checks).toHaveLength(7);
		expect(summary.tables.invoices).toBe(repository.tables.invoices.length);
		expect(summary.tables.shifts).toBe(21);
		expect(summary.refresh).toMatchObject({ status: "refreshed" });
		expect(repository.refreshCalls).toEqual([
			{
				tenantId: account.tenant_id,
				range: { from: WINDOW.fromDate, to: WINDOW.toDate },
			},
		]);
		const run = repository.tables.runs[0];
		expect(run).toMatchObject({
			kind: "backfill",
			status: "succeeded",
			range_start: WINDOW.fromDate,
			range_end: WINDOW.toDate,
			triggered_by: "test",
			error_message: null,
		});
		expect(run?.rows_upserted).toMatchObject({
			invoices: summary.tables.invoices,
			summary: {
				checks: "available",
				checks_unmatched: 0,
				refresh: "refreshed",
			},
		});
		const shift = repository.tables.shifts[0];
		expect(shift?.expected_cash_amount).not.toBeNull();
	});

	it("records voided and edited statuses and one event per adjustment", async () => {
		const { repository, account, store, engine, connector } = await mockBed();
		await engine(connector).syncWindow(account, [store], WINDOW, "backfill");
		const adjustments = await connector.fetchAdjustments(
			{
				externalId: "MOCK-S1",
				name: "x",
				timezone: "Asia/Ho_Chi_Minh",
				dayStartMinutes: 0,
				currency: "VND",
			},
			WINDOW,
		);
		expect(adjustments.length).toBeGreaterThan(0);
		expect(repository.tables.events).toHaveLength(adjustments.length);
		expect(
			repository.tables.events.every((event) => event.source === "pos_report"),
		).toBe(true);
		for (const adjustment of adjustments) {
			const invoice = repository.tables.invoices.find(
				(row) => row.external_id === adjustment.saleExternalId,
			);
			expect(invoice?.status).toBe(
				adjustment.kind === "voided" ? "voided" : "edited",
			);
		}
	});

	it("changes nothing when the same window runs twice", async () => {
		const { repository, account, store, engine, connector } = await mockBed();
		await engine(connector).syncWindow(account, [store], WINDOW, "backfill");
		const before = repository.snapshot();
		const second = await engine(connector).syncWindow(
			account,
			[store],
			WINDOW,
			"nightly",
		);
		expect(repository.snapshot()).toEqual(before);
		expect(Object.values(second.tables).every((count) => count === 0)).toBe(
			true,
		);
		expect(second.stores[0]).toMatchObject({
			inserted: 0,
			updated: 0,
			statusChanged: 0,
			voided: 0,
			edited: 0,
			newAdjustmentEvents: 0,
		});
	});

	it("previews the writes without touching the repository in a dry run", async () => {
		const { repository, account, store, engine, connector } = await mockBed();
		const summary = await engine(connector).syncWindow(
			account,
			[store],
			WINDOW,
			"manual",
			{ dryRun: true },
		);
		expect(summary.runId).toBeNull();
		expect(summary.dryRun).toBe(true);
		expect(summary.tables.invoices).toBeGreaterThan(0);
		expect(summary.checks.unmatched).toBe(0);
		expect(repository.tables.invoices).toHaveLength(0);
		expect(repository.tables.runs).toHaveLength(0);
		expect(repository.refreshCalls).toHaveLength(0);
	});
});
