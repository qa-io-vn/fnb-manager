import type { CanonicalShift } from "@fnb/core";
import { describe, expect, it } from "vitest";
import { refreshRanges } from "../../src/engine/refresh.js";
import { mapSale } from "../../src/index.js";
import { createFakeConnector } from "../support/fake-connector.js";
import { cashPayment, itemLine, sale, totalsFor } from "../support/sales.js";
import { createTestBed, FIXED_NOW } from "../support/setup.js";

const WINDOW = { fromDate: "2026-11-01", toDate: "2026-11-02" };

function eventRows(
	events: readonly { invoice_external_id: string; kind: string }[],
) {
	return events.map((event) => `${event.invoice_external_id}:${event.kind}`);
}

describe("overlapping runs on one store", () => {
	it("records one void and one edit when two runs re-pull the same change at once", async () => {
		const bed = await createTestBed();
		const sales = [
			sale("A", "2026-11-01T02:00:00.000Z", "2026-11-01"),
			sale("B", "2026-11-01T03:00:00.000Z", "2026-11-01"),
			sale("C", "2026-11-01T04:00:00.000Z", "2026-11-01"),
		];
		const connector = createFakeConnector({ sales, totals: totalsFor(sales) });
		await bed
			.engine(connector)
			.syncWindow(bed.account, [bed.store], WINDOW, "backfill");
		const changedC = sale("C", "2026-11-01T04:00:00.000Z", "2026-11-01", {
			netAmount: 70_000,
		});
		connector.data.sales = [sales[0], changedC].flatMap((entry) =>
			entry ? [entry] : [],
		);
		connector.data.totals = totalsFor(connector.data.sales);
		const clock = (offsetMs: number) => () =>
			new Date(FIXED_NOW.getTime() + offsetMs);
		const runs = await Promise.all([
			bed
				.engine(connector, { now: clock(0) })
				.syncWindow(bed.account, [bed.store], WINDOW, "nightly"),
			bed
				.engine(connector, { now: clock(1_000) })
				.syncWindow(bed.account, [bed.store], WINDOW, "manual"),
		]);
		expect(eventRows(bed.repository.tables.events).sort()).toEqual([
			"B:voided",
			"C:edited",
		]);
		expect(runs.map((run) => run.tables.invoice_events ?? 0).sort()).toEqual([
			0, 2,
		]);
		expect(bed.repository.windowLockLog).toHaveLength(3);
		expect(bed.repository.windowLocksHeld).toBe(0);
	});
});

describe("dates outside the window", () => {
	it("refreshes and re-checks the earlier date of a sale voided by a later adjustment", async () => {
		const bed = await createTestBed();
		const sales = [
			sale("A", "2026-11-01T02:00:00.000Z", "2026-11-01"),
			sale("B", "2026-11-01T03:00:00.000Z", "2026-11-01", {
				netAmount: 30_000,
			}),
			sale("C", "2026-11-03T03:00:00.000Z", "2026-11-03"),
		];
		const connector = createFakeConnector({ sales, totals: totalsFor(sales) });
		await bed
			.engine(connector)
			.syncWindow(
				bed.account,
				[bed.store],
				{ fromDate: "2026-11-01", toDate: "2026-11-03" },
				"backfill",
			);
		connector.data.adjustments = [
			{
				kind: "voided",
				saleExternalId: "A",
				occurredAt: new Date("2026-11-03T05:00:00.000Z"),
				amount: 45_000,
				raw: null,
			},
		];
		connector.data.totals = totalsFor(
			sales.filter((entry) => entry.externalId !== "A"),
		);
		bed.repository.refreshCalls.length = 0;
		const summary = await bed
			.engine(connector)
			.syncWindow(
				bed.account,
				[bed.store],
				{ fromDate: "2026-11-03", toDate: "2026-11-03" },
				"incremental",
			);
		expect(
			bed.repository.tables.invoices.find((row) => row.external_id === "A")
				?.status,
		).toBe("voided");
		expect(summary.stores[0]?.touchedDates).toEqual(["2026-11-01"]);
		expect(bed.repository.refreshCalls.map((call) => call.range)).toEqual([
			{ from: "2026-11-01", to: "2026-11-01" },
			{ from: "2026-11-03", to: "2026-11-03" },
		]);
		expect(
			bed.repository.tables.checks.find(
				(check) => check.business_date === "2026-11-01",
			),
		).toMatchObject({
			source_invoice_count: 1,
			local_invoice_count: 1,
			local_net_amount: "30000.00",
			is_matched: true,
		});
		expect(summary.checks).toEqual({
			available: true,
			matched: 2,
			unmatched: 0,
		});
	});

	it("merges extra refresh dates with the window into contiguous ranges", () => {
		expect(
			refreshRanges({ fromDate: "2026-11-03", toDate: "2026-11-04" }, [
				"2026-10-20",
				"2026-11-02",
				"2026-10-21",
				"2026-11-04",
			]),
		).toEqual([
			{ from: "2026-10-20", to: "2026-10-21" },
			{ from: "2026-11-02", to: "2026-11-04" },
		]);
	});

	it("keeps a sale whose business date moved out of the window after a day-start change", async () => {
		const bed = await createTestBed();
		const sales = [
			sale("EARLY", "2026-10-31T19:30:00.000Z", "2026-11-01"),
			sale("NOON", "2026-11-01T05:00:00.000Z", "2026-11-01"),
			sale("NEXT", "2026-11-02T05:00:00.000Z", "2026-11-02"),
		];
		const connector = createFakeConnector({ sales });
		await bed
			.engine(connector)
			.syncWindow(bed.account, [bed.store], WINDOW, "backfill");
		const [stored] = bed.repository.tables.stores;
		if (!stored) {
			throw new Error("the test bed has no store");
		}
		stored.business_day_start_minutes = 240;
		const [store] = await bed.repository.listStores(bed.account.id);
		if (!store) {
			throw new Error("the test bed has no store");
		}
		const moved = await bed
			.engine(connector)
			.syncWindow(bed.account, [store], WINDOW, "nightly");
		expect(
			bed.repository.tables.invoices.find((row) => row.external_id === "EARLY"),
		).toMatchObject({ status: "completed", business_date: "2026-11-01" });
		expect(bed.repository.tables.events).toHaveLength(0);
		expect(moved.stores[0]?.movedOutOfWindow).toBe(1);
		expect(moved.flags).toContainEqual({
			code: "business_date_moved_out_of_window",
			severity: "warn",
			count: 1,
		});
		const covering = await bed
			.engine(connector)
			.syncWindow(
				bed.account,
				[store],
				{ fromDate: "2026-10-31", toDate: "2026-11-02" },
				"backfill",
			);
		expect(
			bed.repository.tables.invoices.find((row) => row.external_id === "EARLY"),
		).toMatchObject({ status: "completed", business_date: "2026-10-31" });
		expect(covering.stores[0]?.touchedDates).toEqual([]);
		expect(bed.repository.tables.events).toHaveLength(0);
	});
});

describe("empty days confirmed by control totals", () => {
	it("voids the last sale of a day when the control totals list no row for it", async () => {
		const bed = await createTestBed();
		const sales = [
			sale("ONLY", "2026-11-01T02:00:00.000Z", "2026-11-01"),
			sale("OTHER", "2026-11-02T02:00:00.000Z", "2026-11-02"),
		];
		const connector = createFakeConnector({ sales, totals: totalsFor(sales) });
		await bed
			.engine(connector)
			.syncWindow(bed.account, [bed.store], WINDOW, "backfill");
		connector.data.sales = sales.slice(1);
		connector.data.totals = totalsFor(connector.data.sales);
		const summary = await bed
			.engine(connector)
			.syncWindow(bed.account, [bed.store], WINDOW, "nightly");
		expect(
			bed.repository.tables.invoices.find((row) => row.external_id === "ONLY")
				?.status,
		).toBe("voided");
		expect(eventRows(bed.repository.tables.events)).toEqual(["ONLY:voided"]);
		expect(summary.checks).toEqual({
			available: true,
			matched: 2,
			unmatched: 0,
		});
	});
});

describe("expected cash of a shift", () => {
	const shift: CanonicalShift = {
		externalId: "SH-1",
		openedAt: new Date("2026-11-01T01:00:00.000Z"),
		closedAt: new Date("2026-11-01T23:00:00.000Z"),
		salesAmount: 105_000,
		ordersCount: 2,
		openingFloatAmount: 500_000,
		cashDrawerAmount: 605_000,
		changedAfterClose: false,
		raw: null,
	};

	it("counts the shift's cash outside the window and drops sales voided by an adjustment", async () => {
		const bed = await createTestBed();
		const sales = [
			sale("X", "2026-11-01T02:00:00.000Z", "2026-11-01", {
				shiftExternalId: "SH-1",
			}),
			sale("Y", "2026-11-01T22:00:00.000Z", "2026-11-02", {
				shiftExternalId: "SH-1",
				netAmount: 60_000,
				payments: [cashPayment(60_000)],
			}),
		];
		const connector = createFakeConnector({
			sales,
			totals: totalsFor(sales),
			shifts: [shift],
		});
		await bed
			.engine(connector)
			.syncWindow(bed.account, [bed.store], WINDOW, "backfill");
		expect(bed.repository.tables.shifts[0]?.expected_cash_amount).toBe(
			"605000.00",
		);
		connector.data.adjustments = [
			{
				kind: "voided",
				saleExternalId: "X",
				occurredAt: new Date("2026-11-01T06:00:00.000Z"),
				amount: 45_000,
				raw: null,
			},
		];
		await bed
			.engine(connector)
			.syncWindow(
				bed.account,
				[bed.store],
				{ fromDate: "2026-11-01", toDate: "2026-11-01" },
				"incremental",
			);
		expect(bed.repository.tables.shifts[0]?.expected_cash_amount).toBe(
			"560000.00",
		);
	});
});

describe("text the database cannot store", () => {
	it("strips NUL characters from text and raw payloads, flags them and stays idempotent", async () => {
		const bed = await createTestBed();
		const sales = [
			sale("NUL-1", "2026-11-01T02:00:00.000Z", "2026-11-01", {
				customerName: "a\u0000b",
				lines: [itemLine("NUL-1-L1", { note: "ít\u0000 đá" })],
				raw: { "k\u0000ey": "v\u0000alue" },
			}),
		];
		const connector = createFakeConnector({ sales, totals: totalsFor(sales) });
		const first = await bed
			.engine(connector)
			.syncWindow(bed.account, [bed.store], WINDOW, "backfill");
		const [invoice] = bed.repository.tables.invoices;
		expect(invoice).toMatchObject({
			customer_name: "ab",
			raw: { key: "value" },
		});
		expect(bed.repository.tables.lines[0]?.note).toBe("ít đá");
		expect(first.flags).toContainEqual({
			code: "nul_character_removed",
			severity: "warn",
			count: 1,
		});
		const before = bed.repository.snapshot();
		const second = await bed
			.engine(connector)
			.syncWindow(bed.account, [bed.store], WINDOW, "nightly");
		expect(second.stores[0]).toMatchObject({ updated: 0, unchanged: 1 });
		expect(bed.repository.snapshot()).toEqual(before);
	});
});

describe("parent line links", () => {
	it("keeps the parent only on modifier lines", () => {
		const { write } = mapSale(
			sale("P-1", "2026-11-01T02:00:00.000Z", "2026-11-01", {
				lines: [
					itemLine("L1"),
					itemLine("L2", { parentLineExternalId: "L1", netAmount: 10_000 }),
					itemLine("L3", {
						lineKind: "modifier",
						parentLineExternalId: "L1",
						netAmount: 0,
					}),
				],
			}),
			{
				tenantId: "tenant",
				storeId: "store",
				posAccountId: "account",
				businessDate: "2026-11-01",
			},
		);
		expect(
			write.lines.map((line) => [line.line_kind, line.parent_line_external_id]),
		).toEqual([
			["item", null],
			["item", null],
			["modifier", "L1"],
		]);
	});
});
