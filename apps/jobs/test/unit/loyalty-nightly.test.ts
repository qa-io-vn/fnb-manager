import type { BusinessDateWindow } from "@fnb/connector-core";
import type { FastLaneRun, LoyaltyCounts } from "@fnb/runner";
import { createRedactor, type StoreContext } from "@fnb/sync";
import { describe, expect, it } from "vitest";
import {
	NIGHTLY_RECONCILE_DAYS,
	nightlyFailures,
	nightlyLines,
	runFastLane,
	runLoyaltyNightly,
} from "../../src/commands/loyalty.js";

const AT = new Date("2026-11-20T21:00:00.000Z");

class FakeLoyaltyDatabase {
	readonly calls: string[] = [];
	failNightlyFor = new Set<string>();
	failReconcileFor = new Set<string>();
	readonly windows: BusinessDateWindow[] = [];

	async reconcileLoyalty(
		tenantId: string,
		window: BusinessDateWindow,
	): Promise<LoyaltyCounts | null> {
		this.calls.push(`reconcile:${tenantId}`);
		this.windows.push(window);
		if (this.failReconcileFor.has(tenantId)) {
			throw new Error("reconcile refused for synthetic-password");
		}
		return { a_earned: 1, c_matched: 0 };
	}

	async loyaltyNightly(tenantId: string): Promise<LoyaltyCounts> {
		this.calls.push(`nightly:${tenantId}`);
		if (this.failNightlyFor.has(tenantId)) {
			throw new Error("nightly refused");
		}
		return {
			clawbacks: 2,
			expired_points: 0,
			expired_stamps: 3,
			liability_rows: 1,
		};
	}
}

const tenants = [
	{ tenantId: "tenant-a", slug: "fixture-a" },
	{ tenantId: "tenant-b", slug: "fixture-b" },
];

describe("fnb loyalty nightly", () => {
	it("reconciles the last 14 business days, then runs the nightly step, tenant by tenant", async () => {
		const database = new FakeLoyaltyDatabase();
		const outcomes = await runLoyaltyNightly({
			database,
			tenants,
			at: AT,
			businessDate: "2026-11-21",
			redact: createRedactor(),
		});
		expect(database.calls).toEqual([
			"reconcile:tenant-a",
			"nightly:tenant-a",
			"reconcile:tenant-b",
			"nightly:tenant-b",
		]);
		expect(database.windows[0]).toEqual({
			fromDate: "2026-11-08",
			toDate: "2026-11-21",
		});
		expect(NIGHTLY_RECONCILE_DAYS).toBe(14);
		expect(nightlyFailures(outcomes)).toBe(0);
	});

	it("prints counts only", async () => {
		const database = new FakeLoyaltyDatabase();
		const lines = nightlyLines(
			await runLoyaltyNightly({
				database,
				tenants: tenants.slice(0, 1),
				at: AT,
				businessDate: "2026-11-21",
				redact: createRedactor(),
			}),
		);
		expect(lines).toEqual([
			"fixture-a: loyalty: reconciled, a_earned 1",
			"fixture-a: nightly clawbacks 2, expired_points 0, expired_stamps 3, liability_rows 1",
		]);
		expect(lines.join("\n")).not.toMatch(/\+84|\d{9,}/);
	});

	it("reports a failed tenant, still runs the others and fails the exit code", async () => {
		const database = new FakeLoyaltyDatabase();
		database.failReconcileFor.add("tenant-a");
		database.failNightlyFor.add("tenant-b");
		const outcomes = await runLoyaltyNightly({
			database,
			tenants,
			at: AT,
			businessDate: "2026-11-21",
			redact: createRedactor(["synthetic-password"]),
		});
		expect(database.calls).toHaveLength(4);
		expect(nightlyFailures(outcomes)).toBe(2);
		const text = nightlyLines(outcomes).join("\n");
		expect(text).toContain("fixture-a: loyalty: failed");
		expect(text).toContain("fixture-b: nightly failed (nightly refused)");
		expect(text).not.toContain("synthetic-password");
	});

	it("says so when no tenant has a programme", () => {
		expect(nightlyLines([])).toEqual([
			"loyalty nightly: no tenant has an active or paused programme",
		]);
	});
});

describe("fnb loyalty fast-lane", () => {
	const storeContext = {
		store: { timezone: "Asia/Ho_Chi_Minh", business_day_start_minutes: 0 },
	} as unknown as StoreContext;

	it("runs each claimed store over the business days of its last 60 minutes and records the outcome", async () => {
		const finished: string[] = [];
		const ran: { storeId: string; days: number }[] = [];
		const runs: FastLaneRun[] = [
			{
				runId: "run-1",
				tenantId: "t",
				storeId: "store-1",
				windowFrom: "",
				windowTo: "",
			},
			{
				runId: "run-2",
				tenantId: "t",
				storeId: "store-gone",
				windowFrom: "",
				windowTo: "",
			},
		];
		const result = await runFastLane({
			database: {
				claimFastLaneRuns: async (_at, limit) => runs.slice(0, limit),
				finishFastLaneRun: async (runId, outcome) => {
					finished.push(`${runId}:${outcome}`);
				},
			},
			repository: {
				findStore: async (storeId) =>
					storeId === "store-1" ? storeContext : null,
			},
			at: new Date("2026-11-18T17:20:00.000Z"),
			limit: 5,
			run: async (run, days) => {
				ran.push({ storeId: run.storeId, days });
				return "succeeded";
			},
		});
		expect(ran).toEqual([{ storeId: "store-1", days: 2 }]);
		expect(finished).toEqual(["run-1:succeeded", "run-2:store_unknown"]);
		expect(result).toEqual({
			run: 2,
			outcomes: ["succeeded", "store_unknown"],
		});
	});
});
