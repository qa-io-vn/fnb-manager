import { capabilities } from "@fnb/connector-core";
import type { CanonicalAdjustment } from "@fnb/core";
import { describe, expect, it } from "vitest";
import { createFakeConnector } from "../support/fake-connector.js";
import { itemLine, sale, totalsFor } from "../support/sales.js";
import { createTestBed } from "../support/setup.js";

const WINDOW = { fromDate: "2026-11-01", toDate: "2026-11-02" };

function dayOfSales() {
	return [
		sale("T-1", "2026-11-01T02:00:00.000Z", "2026-11-01"),
		sale("T-2", "2026-11-01T03:00:00.000Z", "2026-11-01", {
			netAmount: 60_000,
		}),
		sale("T-3", "2026-11-02T04:00:00.000Z", "2026-11-02"),
	];
}

describe("void detection", () => {
	it("voids a stored sale missing from the re-pull with exactly one event", async () => {
		const bed = await createTestBed();
		const sales = dayOfSales();
		const connector = createFakeConnector({ sales, totals: totalsFor(sales) });
		await bed
			.engine(connector)
			.syncWindow(bed.account, [bed.store], WINDOW, "backfill");
		connector.data.sales = sales.filter((entry) => entry.externalId !== "T-2");
		connector.data.totals = totalsFor(connector.data.sales);
		const second = await bed
			.engine(connector)
			.syncWindow(bed.account, [bed.store], WINDOW, "nightly");
		const voided = bed.repository.tables.invoices.find(
			(row) => row.external_id === "T-2",
		);
		expect(voided?.status).toBe("voided");
		expect(bed.repository.tables.events).toEqual([
			expect.objectContaining({
				invoice_external_id: "T-2",
				kind: "voided",
				source: "resync_diff",
				amount: "60000.00",
				invoice_id: voided?.id,
			}),
		]);
		expect(second.stores[0]?.voided).toBe(1);
		expect(second.checks).toEqual({
			available: true,
			matched: 2,
			unmatched: 0,
		});
		const third = await bed
			.engine(connector)
			.syncWindow(bed.account, [bed.store], WINDOW, "nightly");
		expect(bed.repository.tables.events).toHaveLength(1);
		expect(third.tables.invoice_events ?? 0).toBe(0);
	});

	it("does not add a second event when the POS already reported the void", async () => {
		const bed = await createTestBed();
		const sales = dayOfSales();
		const connector = createFakeConnector({ sales, totals: totalsFor(sales) });
		await bed
			.engine(connector)
			.syncWindow(bed.account, [bed.store], WINDOW, "backfill");
		connector.data.sales = sales.filter((entry) => entry.externalId !== "T-1");
		connector.data.adjustments = [
			{
				kind: "voided",
				saleExternalId: "T-1",
				occurredAt: new Date("2026-11-01T05:00:00.000Z"),
				amount: 45_000,
				reason: "Khách huỷ",
				raw: { status: "DELETE" },
			},
		];
		await bed
			.engine(connector)
			.syncWindow(bed.account, [bed.store], WINDOW, "nightly");
		expect(
			bed.repository.tables.events.map((event) => [
				event.invoice_external_id,
				event.kind,
				event.source,
			]),
		).toEqual([["T-1", "voided", "pos_report"]]);
	});

	it("keeps a whole day when the re-pull returns nothing and no control total confirms it", async () => {
		const bed = await createTestBed();
		const sales = dayOfSales();
		const connector = createFakeConnector(
			{ sales },
			capabilities({ lines: true, payments: true }),
		);
		await bed
			.engine(connector)
			.syncWindow(bed.account, [bed.store], WINDOW, "backfill");
		connector.data.sales = sales.filter(
			(entry) => entry.businessDate !== "2026-11-01",
		);
		const second = await bed
			.engine(connector)
			.syncWindow(bed.account, [bed.store], WINDOW, "nightly");
		expect(
			bed.repository.tables.invoices.every((row) => row.status === "completed"),
		).toBe(true);
		expect(second.stores[0]?.voidsSkipped).toBe(2);
		expect(second.flags).toContainEqual({
			code: "empty_day_kept",
			severity: "warn",
			count: 1,
		});
	});

	it("marks an edited bill's superseded original as voided without a void event", async () => {
		const bed = await createTestBed();
		const sales = dayOfSales();
		const connector = createFakeConnector({ sales, totals: totalsFor(sales) });
		await bed
			.engine(connector)
			.syncWindow(bed.account, [bed.store], WINDOW, "backfill");
		const replacement = sale("T-2B", "2026-11-01T03:05:00.000Z", "2026-11-01", {
			netAmount: 50_000,
		});
		connector.data.sales = [
			...sales.filter((entry) => entry.externalId !== "T-2"),
			replacement,
		];
		connector.data.totals = totalsFor(connector.data.sales);
		connector.data.adjustments = [
			{
				kind: "edited",
				saleExternalId: "T-2B",
				relatedSaleExternalId: "T-2",
				occurredAt: new Date("2026-11-01T03:06:00.000Z"),
				amount: 10_000,
				raw: null,
			},
		];
		await bed
			.engine(connector)
			.syncWindow(bed.account, [bed.store], WINDOW, "nightly");
		const byId = new Map(
			bed.repository.tables.invoices.map((row) => [
				row.external_id,
				row.status,
			]),
		);
		expect(byId.get("T-2")).toBe("voided");
		expect(byId.get("T-2B")).toBe("edited");
		expect(
			bed.repository.tables.events.map((event) => [
				event.invoice_external_id,
				event.kind,
				event.source,
			]),
		).toEqual([["T-2B", "edited", "pos_report"]]);
	});
});

describe("edit detection", () => {
	it("rewrites a sale whose amount changed and records one edited event", async () => {
		const bed = await createTestBed();
		const sales = dayOfSales();
		const connector = createFakeConnector({ sales, totals: totalsFor(sales) });
		await bed
			.engine(connector)
			.syncWindow(bed.account, [bed.store], WINDOW, "backfill");
		const originalLineIds = bed.repository.tables.lines
			.filter((line) => line.external_id.startsWith("T-1"))
			.map((line) => line.id);
		const changed = sale("T-1", "2026-11-01T02:00:00.000Z", "2026-11-01", {
			netAmount: 90_000,
			lines: [
				itemLine("T-1-L1", {
					quantity: 2,
					grossAmount: 90_000,
					netAmount: 90_000,
				}),
			],
		});
		connector.data.sales = [changed, ...sales.slice(1)];
		connector.data.totals = totalsFor(connector.data.sales);
		const second = await bed
			.engine(connector)
			.syncWindow(bed.account, [bed.store], WINDOW, "nightly");
		const invoice = bed.repository.tables.invoices.find(
			(row) => row.external_id === "T-1",
		);
		expect(invoice).toMatchObject({ status: "edited", net_amount: "90000.00" });
		const lines = bed.repository.tables.lines.filter(
			(line) => line.invoice_id === invoice?.id,
		);
		expect(lines.map((line) => line.quantity)).toEqual(["2.000"]);
		expect(lines.map((line) => line.id)).not.toEqual(originalLineIds);
		expect(bed.repository.tables.events).toEqual([
			expect.objectContaining({
				invoice_external_id: "T-1",
				kind: "edited",
				source: "resync_diff",
				amount: "45000.00",
			}),
		]);
		expect(second.stores[0]).toMatchObject({
			updated: 1,
			edited: 1,
			unchanged: 2,
		});
		await bed
			.engine(connector)
			.syncWindow(bed.account, [bed.store], WINDOW, "nightly");
		expect(bed.repository.tables.events).toHaveLength(1);
	});

	it("updates a changed label silently without an edit event", async () => {
		const bed = await createTestBed();
		const sales = dayOfSales();
		const connector = createFakeConnector({ sales, totals: totalsFor(sales) });
		await bed
			.engine(connector)
			.syncWindow(bed.account, [bed.store], WINDOW, "backfill");
		connector.data.sales = [
			{ ...sales[0], tableName: "BÀN 9" } as (typeof sales)[number],
			...sales.slice(1),
		];
		const second = await bed
			.engine(connector)
			.syncWindow(bed.account, [bed.store], WINDOW, "nightly");
		expect(second.stores[0]).toMatchObject({ updated: 1, edited: 0 });
		expect(
			bed.repository.tables.invoices.find((row) => row.external_id === "T-1"),
		).toMatchObject({ table_name: "BÀN 9", status: "completed" });
		expect(bed.repository.tables.events).toHaveLength(0);
	});
});

describe("adjustments", () => {
	const removal: CanonicalAdjustment = {
		kind: "line_removed",
		saleExternalId: "T-3",
		lineExternalId: "T-3-L9",
		itemExternalId: "ITEM-9",
		itemName: "Bánh",
		quantity: 1,
		occurredAt: new Date("2026-11-02T04:10:00.000Z"),
		amount: 20_000,
		raw: { removed: true },
	};

	it("inserts each adjustment once across repeats and re-runs", async () => {
		const bed = await createTestBed();
		const sales = dayOfSales();
		const connector = createFakeConnector({
			sales,
			totals: totalsFor(sales),
			adjustments: [removal, { ...removal }],
		});
		const first = await bed
			.engine(connector)
			.syncWindow(bed.account, [bed.store], WINDOW, "backfill");
		expect(bed.repository.tables.events).toHaveLength(1);
		expect(first.flags).toContainEqual({
			code: "adjustment_repeated",
			severity: "info",
			count: 1,
		});
		expect(
			bed.repository.tables.invoices.find((row) => row.external_id === "T-3")
				?.status,
		).toBe("edited");
		const second = await bed
			.engine(connector)
			.syncWindow(bed.account, [bed.store], WINDOW, "nightly");
		expect(bed.repository.tables.events).toHaveLength(1);
		expect(second.stores[0]?.newAdjustmentEvents).toBe(0);
	});

	it("merges two removals that share the stored event key into one row", async () => {
		const bed = await createTestBed();
		const sales = dayOfSales();
		const other = {
			...removal,
			lineExternalId: "T-3-L8",
			amount: 15_000,
			raw: { removed: "second" },
		};
		const connector = createFakeConnector({
			sales,
			totals: totalsFor(sales),
			adjustments: [removal, other],
		});
		await bed
			.engine(connector)
			.syncWindow(bed.account, [bed.store], WINDOW, "backfill");
		expect(bed.repository.tables.events).toHaveLength(1);
		expect(bed.repository.tables.events[0]).toMatchObject({
			amount: "35000.00",
			raw: { merged: [{ removed: "second" }, { removed: true }] },
		});
	});

	it("records an adjustment for a sale that never reached the sales report", async () => {
		const bed = await createTestBed();
		const sales = dayOfSales();
		const connector = createFakeConnector({
			sales,
			totals: totalsFor(sales),
			adjustments: [
				{
					kind: "voided",
					saleExternalId: "GONE-1",
					occurredAt: new Date("2026-11-01T06:00:00.000Z"),
					amount: 30_000,
					raw: null,
				},
			],
		});
		await bed
			.engine(connector)
			.syncWindow(bed.account, [bed.store], WINDOW, "backfill");
		expect(bed.repository.tables.events).toEqual([
			expect.objectContaining({
				invoice_external_id: "GONE-1",
				invoice_id: null,
				kind: "voided",
			}),
		]);
	});

	it("skips adjustments, shifts and checks a connector does not declare", async () => {
		const bed = await createTestBed();
		const sales = dayOfSales();
		const connector = createFakeConnector(
			{ sales },
			capabilities({ lines: true, payments: true }),
		);
		const summary = await bed
			.engine(connector)
			.syncWindow(bed.account, [bed.store], WINDOW, "backfill");
		expect(connector.calls).toEqual(["sales"]);
		expect(summary.checks).toEqual({
			available: false,
			matched: 0,
			unmatched: 0,
		});
		expect(bed.repository.tables.checks).toHaveLength(0);
		expect(bed.repository.tables.runs[0]?.rows_upserted).toMatchObject({
			summary: { checks: "unavailable" },
		});
	});
});
