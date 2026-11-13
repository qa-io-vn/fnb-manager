import { capabilities } from "@fnb/connector-core";
import { describe, expect, it } from "vitest";
import {
	ABANDONED_RUN_MESSAGE,
	IncrementalRunError,
	type IncrementalSummary,
	incrementalDayCounts,
	type RunBudget,
	STALE_REFRESH_LOOKBACK_DAYS,
	WindowRunError,
	type WorkCostModel,
} from "../../src/index.js";
import {
	createFakeConnector,
	FULL_CAPABILITIES,
} from "../support/fake-connector.js";
import { sale, totalsFor } from "../support/sales.js";
import { createTestBed } from "../support/setup.js";

const FLAT_MODEL: WorkCostModel = {
	setupCpuMs: 0,
	dayCpuMs: 100,
	saleCpuMs: 0,
	dayWallMs: 0,
	saleWallMs: 0,
	closingWallMs: 0,
};

function threeDays() {
	return [
		sale("T-1", "2026-11-03T02:00:00.000Z", "2026-11-03"),
		sale("T-2", "2026-11-04T02:00:00.000Z", "2026-11-04"),
		sale("T-3", "2026-11-05T01:00:00.000Z", "2026-11-05"),
	];
}

function outcomes(summary: IncrementalSummary) {
	return summary.days.map((day) => [day.date, day.reason, day.outcome]);
}

const NO_COST: WorkCostModel = {
	setupCpuMs: 0,
	dayCpuMs: 0,
	saleCpuMs: 0,
	dayWallMs: 0,
	saleWallMs: 0,
	closingWallMs: 0,
};

async function failureOf(run: Promise<unknown>): Promise<IncrementalRunError> {
	const failure = await run.then(
		() => null,
		(error: unknown) => error,
	);
	expect(failure).toBeInstanceOf(IncrementalRunError);
	return failure as IncrementalRunError;
}

describe("incremental sync", () => {
	it("pulls every unchecked day first, then nothing but the control totals", async () => {
		const bed = await createTestBed();
		const sales = threeDays();
		const connector = createFakeConnector({ sales, totals: totalsFor(sales) });
		const first = await bed
			.engine(connector)
			.syncIncremental(bed.account, bed.store);
		expect(first.status).toBe("succeeded");
		expect(first.window).toEqual({
			fromDate: "2026-11-03",
			toDate: "2026-11-05",
		});
		expect(outcomes(first)).toEqual([
			["2026-11-03", "unchecked", "synced"],
			["2026-11-04", "unchecked", "synced"],
			["2026-11-05", "unchecked", "synced"],
		]);
		expect(first.store.inserted).toBe(3);
		expect(first.checks).toEqual({ available: true, matched: 3, unmatched: 0 });
		expect(connector.calls.filter((call) => call === "sales")).toHaveLength(3);
		expect(bed.repository.refreshCalls).toEqual([
			{
				tenantId: bed.account.tenant_id,
				range: { from: "2026-11-03", to: "2026-11-05" },
			},
		]);

		connector.calls.length = 0;
		const second = await bed
			.engine(connector)
			.syncIncremental(bed.account, bed.store);
		expect(second.status).toBe("succeeded");
		expect(outcomes(second)).toEqual([
			["2026-11-03", "unchanged", "unchanged"],
			["2026-11-04", "unchanged", "unchanged"],
			["2026-11-05", "unchanged", "unchanged"],
		]);
		expect(connector.calls).toEqual(["controlTotals"]);
		expect(second.connectorCalls).toBe(1);
		expect(second.tables).toEqual({});
		expect(second.refresh).toEqual({ status: "skipped" });
		expect(bed.repository.refreshCalls).toHaveLength(1);
	});

	it("records one incremental run per store with its counts and day outcomes", async () => {
		const bed = await createTestBed();
		const sales = threeDays();
		const connector = createFakeConnector({ sales, totals: totalsFor(sales) });
		const summary = await bed
			.engine(connector)
			.syncIncremental(bed.account, bed.store);
		const [run] = bed.repository.tables.runs;
		expect(run).toMatchObject({
			id: summary.runId,
			kind: "incremental",
			store_id: bed.store.id,
			range_start: "2026-11-03",
			range_end: "2026-11-05",
			status: "succeeded",
			triggered_by: "test",
		});
		expect(run?.rows_upserted).toMatchObject({
			invoices: 3,
			summary: {
				connector_calls: 13,
				days_checked: 3,
				days_changed: 3,
				days_synced: 3,
				days_handed_off: 0,
				stopped: null,
				checks: "available",
				refresh: "refreshed",
			},
		});
		expect(
			bed.repository.tables.accounts.find(
				(account) => account.id === bed.account.id,
			)?.last_synced_at,
		).toBe(summary.finishedAt);
	});

	it("pulls only the day whose POS totals moved and refreshes only that day", async () => {
		const bed = await createTestBed();
		const sales = threeDays();
		const connector = createFakeConnector({ sales, totals: totalsFor(sales) });
		await bed.engine(connector).syncIncremental(bed.account, bed.store);
		connector.data.sales = [
			...sales,
			sale("T-4", "2026-11-05T02:30:00.000Z", "2026-11-05", {
				netAmount: 30_000,
			}),
		];
		connector.data.totals = totalsFor(connector.data.sales);
		connector.calls.length = 0;
		const next = await bed
			.engine(connector)
			.syncIncremental(bed.account, bed.store);
		expect(outcomes(next)).toEqual([
			["2026-11-03", "unchanged", "unchanged"],
			["2026-11-04", "unchanged", "unchanged"],
			["2026-11-05", "pos_changed", "synced"],
		]);
		expect(next.store.inserted).toBe(1);
		expect(connector.calls).toEqual([
			"controlTotals",
			"sales",
			"adjustments",
			"controlTotals",
			"shifts",
		]);
		expect(bed.repository.refreshCalls.at(-1)?.range).toEqual({
			from: "2026-11-05",
			to: "2026-11-05",
		});
	});

	it("hands the older changed days to the nightly job when the budget runs out", async () => {
		const bed = await createTestBed();
		const sales = threeDays();
		const connector = createFakeConnector({ sales, totals: totalsFor(sales) });
		const summary = await bed
			.engine(connector)
			.syncIncremental(bed.account, bed.store, {
				budget: { wallClockMs: 60_000, cpuMs: 150 },
				costModel: FLAT_MODEL,
			});
		expect(summary.status).toBe("partial");
		expect(summary.stopped).toBe("cpu_time");
		expect(outcomes(summary)).toEqual([
			["2026-11-03", "unchecked", "handed_off"],
			["2026-11-04", "unchecked", "handed_off"],
			["2026-11-05", "unchecked", "synced"],
		]);
		expect(summary.flags).toContainEqual({
			code: "incremental_handed_off",
			severity: "warn",
			count: 2,
		});
		const [run] = bed.repository.tables.runs;
		expect(run?.status).toBe("partial");
		expect(run?.rows_upserted).toMatchObject({
			summary: {
				days_synced: 1,
				days_handed_off: 2,
				stopped: "cpu_time",
				flags_warn: 2,
			},
		});
		expect(
			bed.repository.tables.accounts.find(
				(account) => account.id === bed.account.id,
			)?.last_synced_at,
		).toBeNull();
		expect(bed.repository.refreshCalls.at(-1)?.range).toEqual({
			from: "2026-11-05",
			to: "2026-11-05",
		});
	});

	it("stops before any detail when the wall-clock budget is already spent", async () => {
		const bed = await createTestBed();
		const sales = threeDays();
		const connector = createFakeConnector({ sales, totals: totalsFor(sales) });
		const summary = await bed
			.engine(connector)
			.syncIncremental(bed.account, bed.store, {
				budget: { wallClockMs: 10_000, cpuMs: 10_000 },
				costModel: { ...FLAT_MODEL, dayWallMs: 2_000 },
				clock: () => 9_000,
				startedAt: 0,
			});
		expect(summary.stopped).toBe("wall_time");
		expect(summary.days.every((day) => day.outcome === "handed_off")).toBe(
			true,
		);
		expect(connector.calls).toEqual(["controlTotals"]);
		expect(summary.refresh).toEqual({ status: "skipped" });
	});

	it("leaves a store held by another run alone and records the run as partial", async () => {
		const bed = await createTestBed();
		const sales = threeDays();
		const connector = createFakeConnector({ sales, totals: totalsFor(sales) });
		let release = (): void => undefined;
		const holding = bed.repository.withStoreLock(
			bed.store.id,
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		const summary = await bed
			.engine(connector)
			.syncIncremental(bed.account, bed.store, { lockWaitMs: 5 });
		release();
		await holding;
		expect(summary.status).toBe("partial");
		expect(summary.stopped).toBe("store_busy");
		expect(summary.days).toEqual([]);
		expect(connector.calls).toEqual([]);
		expect(bed.repository.tables.runs[0]?.status).toBe("partial");
		const after = await bed
			.engine(connector)
			.syncIncremental(bed.account, bed.store, { lockWaitMs: 5 });
		expect(after.status).toBe("succeeded");
	});

	it("closes a failing run as failed and rethrows with the summary", async () => {
		const bed = await createTestBed({
			failOn: (operation) =>
				operation === "applyStoreDay"
					? new Error("disk full on the database host")
					: undefined,
		});
		const sales = threeDays();
		const connector = createFakeConnector({ sales, totals: totalsFor(sales) });
		const failure = await bed
			.engine(connector)
			.syncIncremental(bed.account, bed.store)
			.then(
				() => null,
				(error: unknown) => error,
			);
		expect(failure).toBeInstanceOf(IncrementalRunError);
		const summary = (failure as IncrementalRunError).summary;
		expect(summary.status).toBe("failed");
		expect(summary.error).toContain("disk full");
		expect(bed.repository.tables.runs[0]).toMatchObject({
			status: "failed",
			error_message: "disk full on the database host",
		});
		expect(bed.repository.windowLocksHeld).toBe(0);
	});

	it("pulls every day when the connector has no control totals", async () => {
		const bed = await createTestBed();
		const sales = threeDays();
		const connector = createFakeConnector(
			{ sales },
			capabilities({ ...FULL_CAPABILITIES, controlTotals: false }),
		);
		await bed.engine(connector).syncIncremental(bed.account, bed.store);
		const again = await bed
			.engine(connector)
			.syncIncremental(bed.account, bed.store);
		expect(
			outcomes(again).map(([, reason, outcome]) => [reason, outcome]),
		).toEqual([
			["unchecked", "synced"],
			["unchecked", "synced"],
			["unchecked", "synced"],
		]);
		expect(again.checks.available).toBe(false);
		expect(again.store.unchanged).toBe(3);
	});

	it("records the store on a window run of one store and leaves it null for several", async () => {
		const bed = await createTestBed();
		const sister = bed.repository.addStore(bed.account, {
			external_id: "STORE-2",
			name: "Cửa hàng thứ hai",
			address: null,
			timezone: "Asia/Ho_Chi_Minh",
			business_day_start_minutes: 0,
			opened_on: null,
			raw: null,
		});
		const connector = createFakeConnector();
		const window = { fromDate: "2026-11-04", toDate: "2026-11-05" };
		await bed
			.engine(connector)
			.syncWindow(bed.account, [bed.store], window, "nightly");
		await bed
			.engine(connector)
			.syncWindow(bed.account, [bed.store, sister], window, "nightly");
		expect(bed.repository.tables.runs.map((run) => run.store_id)).toEqual([
			bed.store.id,
			null,
		]);
	});

	it("closes the store's incremental runs a killed worker left running", async () => {
		const bed = await createTestBed();
		const open = (startedAt: string, storeId: string) =>
			bed.repository.openRun({
				tenant_id: bed.account.tenant_id,
				pos_account_id: bed.account.id,
				store_id: storeId,
				kind: "incremental",
				range_start: "2026-11-03",
				range_end: "2026-11-05",
				started_at: startedAt,
				triggered_by: "schedule",
			});
		const stale = await open("2026-11-05T02:30:00.000Z", bed.store.id);
		const recent = await open("2026-11-05T02:55:00.000Z", bed.store.id);
		const other = await open("2026-11-05T02:30:00.000Z", "another-store");
		const connector = createFakeConnector();
		const summary = await bed
			.engine(connector)
			.syncIncremental(bed.account, bed.store);
		const byId = new Map(
			bed.repository.tables.runs.map((run) => [run.id, run]),
		);
		expect(byId.get(stale)).toMatchObject({
			status: "failed",
			error_message: ABANDONED_RUN_MESSAGE,
		});
		expect(byId.get(recent)?.status).toBe("running");
		expect(byId.get(other)?.status).toBe("running");
		expect(summary.flags).toContainEqual({
			code: "abandoned_runs_closed",
			severity: "warn",
			count: 1,
		});
	});

	it("refreshes the dates a run committed but never refreshed, without pulling them again", async () => {
		let refreshFails = true;
		const bed = await createTestBed({
			failOn: (operation) =>
				operation === "refreshAnalytics" && refreshFails
					? new Error("canceling statement due to statement timeout")
					: undefined,
		});
		const sales = threeDays();
		const connector = createFakeConnector({ sales, totals: totalsFor(sales) });
		const first = await bed
			.engine(connector)
			.syncIncremental(bed.account, bed.store);
		expect(first.refresh.status).toBe("failed");
		expect(bed.repository.refreshCalls).toEqual([]);

		refreshFails = false;
		connector.calls.length = 0;
		const second = await bed
			.engine(connector)
			.syncIncremental(bed.account, bed.store);
		expect(outcomes(second).map(([, , outcome]) => outcome)).toEqual([
			"unchanged",
			"unchanged",
			"unchanged",
		]);
		expect(connector.calls).toEqual(["controlTotals"]);
		expect(second.refresh.status).toBe("refreshed");
		expect(second.refreshRetried).toEqual([
			"2026-11-03",
			"2026-11-04",
			"2026-11-05",
		]);
		expect(bed.repository.refreshCalls).toEqual([
			{
				tenantId: bed.account.tenant_id,
				range: { from: "2026-11-03", to: "2026-11-05" },
			},
		]);
		expect(second.flags).toContainEqual({
			code: "analytics_refresh_retried",
			severity: "info",
			count: 3,
		});
		expect(bed.repository.tables.runs.at(-1)?.rows_upserted).toMatchObject({
			summary: { refresh: "refreshed", stale_days_refreshed: 3 },
		});

		const third = await bed
			.engine(connector)
			.syncIncremental(bed.account, bed.store);
		expect(third.refresh).toEqual({ status: "skipped" });
		expect(third.refreshRetried).toEqual([]);
		expect(bed.repository.refreshCalls).toHaveLength(1);
	});

	it("records the day a failed run committed and refreshes it on the next run", async () => {
		const bed = await createTestBed();
		const sales = threeDays();
		const connector = createFakeConnector({ sales, totals: totalsFor(sales) });
		const outage = new Error("socket hang up");
		connector.failures.set("sales", [
			undefined as unknown as Error,
			outage,
			outage,
			outage,
		]);
		const failure = await failureOf(
			bed.engine(connector).syncIncremental(bed.account, bed.store),
		);
		expect(outcomes(failure.summary)).toEqual([
			["2026-11-03", "unchecked", "pending"],
			["2026-11-04", "unchecked", "pending"],
			["2026-11-05", "unchecked", "synced"],
		]);
		expect(bed.repository.tables.runs[0]?.rows_upserted).toMatchObject({
			summary: {
				days_checked: 3,
				days_changed: 3,
				days_synced: 1,
				days_handed_off: 0,
			},
		});
		expect(
			bed.repository.tables.invoices.map((invoice) => invoice.business_date),
		).toEqual(["2026-11-05"]);
		expect(bed.repository.refreshCalls).toEqual([]);

		const next = await bed
			.engine(connector)
			.syncIncremental(bed.account, bed.store);
		expect(outcomes(next)).toEqual([
			["2026-11-03", "unchecked", "synced"],
			["2026-11-04", "unchecked", "synced"],
			["2026-11-05", "unchanged", "unchanged"],
		]);
		expect(next.refreshRetried).toEqual(["2026-11-05"]);
		expect(bed.repository.refreshCalls.at(-1)?.range).toEqual({
			from: "2026-11-03",
			to: "2026-11-05",
		});
	});

	it("looks for unrefreshed dates over the last two weeks of the store", async () => {
		expect(STALE_REFRESH_LOOKBACK_DAYS).toBe(14);
		const bed = await createTestBed();
		const old = [sale("T-0", "2026-10-22T02:00:00.000Z", "2026-10-22")];
		const connector = createFakeConnector({
			sales: old,
			totals: totalsFor(old),
		});
		await bed
			.engine(connector)
			.syncWindow(
				bed.account,
				[bed.store],
				{ fromDate: "2026-10-22", toDate: "2026-10-22" },
				"backfill",
				{ refreshAnalytics: false },
			);
		const summary = await bed
			.engine(connector)
			.syncIncremental(bed.account, bed.store);
		expect(summary.refreshRetried).toEqual([]);
		const recent = [sale("T-9", "2026-10-30T02:00:00.000Z", "2026-10-30")];
		connector.data.sales = recent;
		connector.data.totals = totalsFor(recent);
		await bed
			.engine(connector)
			.syncWindow(
				bed.account,
				[bed.store],
				{ fromDate: "2026-10-30", toDate: "2026-10-30" },
				"backfill",
				{ refreshAnalytics: false },
			);
		const later = await bed
			.engine(connector)
			.syncIncremental(bed.account, bed.store);
		expect(later.refreshRetried).toEqual(["2026-10-30"]);
	});

	it("hands a day off when a POS call hangs past the wall-clock budget", async () => {
		const bed = await createTestBed();
		const sales = threeDays();
		const connector = createFakeConnector({ sales, totals: totalsFor(sales) });
		connector.fetchSales = async function* () {
			await new Promise(() => undefined);
			yield [];
		};
		const budget: RunBudget = { wallClockMs: 400, cpuMs: 10_000 };
		const startedAt = performance.now();
		const summary = await bed
			.engine(connector)
			.syncIncremental(bed.account, bed.store, {
				budget,
				costModel: { ...NO_COST, closingWallMs: 200 },
			});
		expect(performance.now() - startedAt).toBeLessThan(5_000);
		expect(summary.status).toBe("partial");
		expect(summary.stopped).toBe("wall_time");
		expect(outcomes(summary).map(([, , outcome]) => outcome)).toEqual([
			"handed_off",
			"handed_off",
			"handed_off",
		]);
		expect(summary.flags).toContainEqual({
			code: "deadline_reached",
			severity: "warn",
			count: 1,
		});
		expect(summary.retries).toBe(0);
		expect(bed.repository.tables.runs[0]?.status).toBe("partial");
		expect(bed.repository.windowLocksHeld).toBe(0);
	});

	it("hands the whole window off unchecked when the deadline cuts off the control totals", async () => {
		const bed = await createTestBed();
		const sales = threeDays();
		const connector = createFakeConnector({ sales, totals: totalsFor(sales) });
		connector.fetchControlTotals = async () => {
			await new Promise(() => undefined);
			return [];
		};
		const budget: RunBudget = { wallClockMs: 400, cpuMs: 10_000 };
		const startedAt = performance.now();
		const summary = await bed
			.engine(connector)
			.syncIncremental(bed.account, bed.store, {
				budget,
				costModel: { ...NO_COST, closingWallMs: 200 },
			});
		expect(performance.now() - startedAt).toBeLessThan(5_000);
		expect(summary.status).toBe("partial");
		expect(summary.stopped).toBe("wall_time");
		expect(outcomes(summary)).toEqual([
			["2026-11-03", null, "handed_off"],
			["2026-11-04", null, "handed_off"],
			["2026-11-05", null, "handed_off"],
		]);
		expect(incrementalDayCounts(summary.days)).toEqual({
			checked: 0,
			changed: 0,
			synced: 0,
			handedOff: 3,
		});
		expect(summary.flags).toEqual(
			expect.arrayContaining([
				{ code: "deadline_reached", severity: "warn", count: 1 },
				{ code: "incremental_handed_off", severity: "warn", count: 3 },
			]),
		);
		expect(bed.repository.tables.runs[0]?.rows_upserted).toMatchObject({
			summary: {
				days_checked: 0,
				days_changed: 0,
				days_synced: 0,
				days_handed_off: 3,
				stopped: "wall_time",
			},
		});
		expect(bed.repository.windowLocksHeld).toBe(0);
	});

	it("records the store ids every run covered", async () => {
		const bed = await createTestBed();
		const sister = bed.repository.addStore(bed.account, {
			external_id: "STORE-2",
			name: "Cửa hàng thứ hai",
			address: null,
			timezone: "Asia/Ho_Chi_Minh",
			business_day_start_minutes: 0,
			opened_on: null,
			raw: null,
		});
		const connector = createFakeConnector();
		await bed
			.engine(connector)
			.syncWindow(
				bed.account,
				[sister, bed.store],
				{ fromDate: "2026-11-04", toDate: "2026-11-05" },
				"nightly",
			);
		await bed.engine(connector).syncIncremental(bed.account, bed.store);
		expect(bed.repository.tables.runs.map((run) => run.store_ids)).toEqual([
			[bed.store.id, sister.id].sort(),
			[bed.store.id],
		]);
	});

	it("gives up a store whose window lock another run holds past the window run's wait", async () => {
		const bed = await createTestBed();
		const connector = createFakeConnector();
		let release = (): void => undefined;
		const holding = bed.repository.withStoreLock(
			bed.store.id,
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		const failure = await bed
			.engine(connector)
			.syncWindow(
				bed.account,
				[bed.store],
				{ fromDate: "2026-11-04", toDate: "2026-11-05" },
				"nightly",
				{ lockWaitMs: 5 },
			)
			.then(
				() => null,
				(error: unknown) => error,
			);
		release();
		await holding;
		expect(failure).toBeInstanceOf(WindowRunError);
		expect((failure as WindowRunError).summary.error).toContain(
			"held the store's window lock for longer than 5 ms",
		);
		expect(bed.repository.tables.runs[0]?.status).toBe("failed");
	});

	it("refuses a store that belongs to another account", async () => {
		const bed = await createTestBed();
		const connector = createFakeConnector();
		await expect(
			bed
				.engine(connector)
				.syncIncremental({ ...bed.account, id: "another-account" }, bed.store),
		).rejects.toThrow(RangeError);
	});
});
