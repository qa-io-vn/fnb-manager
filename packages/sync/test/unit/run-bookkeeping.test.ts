import {
	ConnectorAuthError,
	ConnectorRateLimitError,
} from "@fnb/connector-core";
import { describe, expect, it } from "vitest";
import {
	createRedactor,
	SyncBudgetError,
	SyncRunError,
	type WindowSummary,
} from "../../src/index.js";
import { createFakeConnector } from "../support/fake-connector.js";
import { sale, totalsFor } from "../support/sales.js";
import { createTestBed } from "../support/setup.js";

const WINDOW = { fromDate: "2026-11-01", toDate: "2026-11-02" };
const SECRET = "hunter2-very-secret";

function salesFixture() {
	return [
		sale("T-1", "2026-11-01T02:00:00.000Z", "2026-11-01"),
		sale("T-2", "2026-11-02T02:00:00.000Z", "2026-11-02"),
	];
}

async function captureFailure(
	work: Promise<unknown>,
): Promise<SyncRunError<WindowSummary>> {
	try {
		await work;
	} catch (error) {
		if (error instanceof SyncRunError) {
			return error as SyncRunError<WindowSummary>;
		}
		throw error;
	}
	throw new Error("expected the run to fail");
}

describe("run bookkeeping", () => {
	it("closes a failed run with a credential-free message and releases the store lock", async () => {
		let applied = 0;
		const bed = await createTestBed({
			failOn: (operation) => {
				if (operation === "applyStoreDay") {
					applied += 1;
					if (applied === 2) {
						return new Error(
							`connection to postgresql://owner:${SECRET}@db.internal:5432/postgres reset`,
						);
					}
				}
				return undefined;
			},
		});
		const sales = salesFixture();
		const connector = createFakeConnector({ sales, totals: totalsFor(sales) });
		const failure = await captureFailure(
			bed
				.engine(connector, { redact: createRedactor([SECRET]) })
				.syncWindow(bed.account, [bed.store], WINDOW, "backfill"),
		);
		const [run] = bed.repository.tables.runs;
		expect(run?.status).toBe("failed");
		expect(run?.finished_at).not.toBeNull();
		expect(run?.error_message).toContain(
			"connection to postgresql://***@db.internal",
		);
		expect(run?.error_message).not.toContain(SECRET);
		expect(run?.error_message).not.toContain("owner");
		expect(failure.summary.status).toBe("failed");
		expect(bed.repository.heldLocks.size).toBe(0);
		expect(bed.repository.lockLog).toHaveLength(2);
		expect(
			bed.repository.tables.invoices.map((row) => row.external_id),
		).toEqual(["T-1"]);
		expect(bed.repository.tables.accounts[0]?.last_synced_at).toBeNull();
		expect(bed.repository.refreshCalls).toHaveLength(0);
	});

	it("fails the run once the connector call budget is spent", async () => {
		const bed = await createTestBed();
		const connector = createFakeConnector({ sales: salesFixture() });
		const failure = await captureFailure(
			bed
				.engine(connector, { calls: { budget: 2 } })
				.syncWindow(bed.account, [bed.store], WINDOW, "backfill"),
		);
		expect(failure.cause).toBeInstanceOf(SyncBudgetError);
		expect(failure.summary.connectorCalls).toBe(2);
		expect(bed.repository.tables.runs[0]).toMatchObject({ status: "failed" });
		expect(bed.repository.tables.runs[0]?.error_message).toContain(
			"budget of 2 calls",
		);
	});

	it("retries transient and rate-limit errors with backoff but not authentication errors", async () => {
		const bed = await createTestBed();
		const sales = salesFixture();
		const connector = createFakeConnector({ sales, totals: totalsFor(sales) });
		connector.failures.set("sales", [
			new Error("socket hang up"),
			new ConnectorRateLimitError("fake", 2_500),
		]);
		const summary = await bed
			.engine(connector)
			.syncWindow(bed.account, [bed.store], WINDOW, "backfill");
		expect(summary.retries).toBe(2);
		expect(bed.sleeps).toEqual([1_000, 2_500]);
		expect(summary.connectorCalls).toBe(6);
		connector.failures.set("sales", [
			new ConnectorAuthError("fake", "expired"),
		]);
		const failure = await captureFailure(
			bed
				.engine(connector)
				.syncWindow(bed.account, [bed.store], WINDOW, "backfill"),
		);
		expect(failure.cause).toBeInstanceOf(ConnectorAuthError);
		expect(bed.sleeps).toHaveLength(2);
	});

	it("keeps the run succeeded and flags it when the analytics refresh fails", async () => {
		const bed = await createTestBed({
			failOn: (operation) =>
				operation === "refreshAnalytics"
					? new Error("refresh broke")
					: undefined,
		});
		const connector = createFakeConnector({ sales: salesFixture() });
		const summary = await bed
			.engine(connector)
			.syncWindow(bed.account, [bed.store], WINDOW, "backfill");
		expect(summary.status).toBe("succeeded");
		expect(summary.refresh).toMatchObject({
			status: "failed",
			error: "refresh broke",
		});
		expect(summary.flags).toContainEqual({
			code: "analytics_refresh_failed",
			severity: "warn",
			count: 1,
		});
	});

	it("records an absent refresh function as unavailable", async () => {
		const bed = await createTestBed({ analyticsAvailable: false });
		const connector = createFakeConnector({ sales: salesFixture() });
		const summary = await bed
			.engine(connector)
			.syncWindow(bed.account, [bed.store], WINDOW, "manual");
		expect(summary.refresh).toEqual({ status: "unavailable" });
		expect(bed.repository.tables.runs[0]).toMatchObject({
			kind: "backfill",
			status: "succeeded",
		});
		expect(bed.repository.tables.accounts[0]?.last_synced_at).toBe(
			summary.finishedAt,
		);
	});
});

describe("store ownership", () => {
	it("refuses stores of another account before opening a run", async () => {
		const bed = await createTestBed();
		const connector = createFakeConnector({ sales: salesFixture() });
		await expect(
			bed
				.engine(connector)
				.syncWindow(
					bed.account,
					[{ ...bed.store, pos_account_id: "other-account" }],
					WINDOW,
					"backfill",
				),
		).rejects.toThrow(/another POS account/);
		expect(bed.repository.tables.runs).toHaveLength(0);
	});
});
