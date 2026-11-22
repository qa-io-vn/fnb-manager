import type { BusinessDateWindow } from "@fnb/connector-core";
import type { FastLaneRun, LoyaltyCounts } from "@fnb/runner";
import { createRedactor, type StoreContext } from "@fnb/sync";
import { describe, expect, it, vi } from "vitest";
import {
	NIGHTLY_RECONCILE_DAYS,
	nightlyFailures,
	nightlyLines,
	runFastLane,
	runLoyaltyNightly,
} from "../../src/commands/loyalty.js";
import { fakeSql, TENANT_ROW, tenantRows } from "../support/fake-services.js";
import {
	ECHOING_ERRORS,
	expectNoIdentifiers,
	identifierFindings,
	PATH_SEGMENT,
	PHONES,
	POOL_CODES,
	ZALO_USER_ID,
} from "../support/identifiers.js";
import { runFakeCli } from "../support/run-fake-cli.js";

vi.mock("../../src/services.js", async () => {
	const { FakeServices } = await import("../support/fake-services.js");
	return { Services: FakeServices };
});

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

// G-24 (security, component). Technique: error guessing. A database error is the
// one place where text the command did not write can reach its output, because a
// server echoes the value it refused. Each case below makes one step fail with a
// message that carries one kind of identifier, and every line of stdout, stderr
// and the job summary is checked against the shapes of a phone, a pool code, a
// 43-character path segment and a Zalo user id. Equivalence partitions: the
// success run, a failed reconcile step, a failed nightly step, a failed
// tenant lookup and an unknown tenant; each with CI set (the rule) and, as a
// control, without it.

interface FakeRunner {
	loyaltyTenants: () => Promise<{ tenantId: string; slug: string }[]>;
	reconcileLoyalty: () => Promise<LoyaltyCounts | null>;
	loyaltyNightly: () => Promise<LoyaltyCounts>;
}

function healthyRunner(overrides: Partial<FakeRunner> = {}): FakeRunner {
	return {
		loyaltyTenants: async () => [
			{ tenantId: "tenant-id-1", slug: "fixture-a" },
		],
		reconcileLoyalty: async () => ({ a_earned: 1, c_matched: 0 }),
		loyaltyNightly: async () => ({
			clawbacks: 2,
			expired_points: 0,
			expired_stamps: 3,
			liability_rows: 1,
		}),
		...overrides,
	};
}

async function fnbNightly(
	argv: readonly string[],
	runner: FakeRunner,
	options: { ci?: boolean; tenants?: readonly Record<string, unknown>[] } = {},
) {
	const sql = fakeSql([tenantRows(options.tenants ?? [TENANT_ROW])]);
	return runFakeCli(
		argv,
		{ sql, runner },
		{
			env: options.ci === false ? {} : { CI: "1" },
			now: () => AT,
		},
	);
}

describe("fnb loyalty nightly prints no identifier (G-24)", () => {
	it("prints counts only on a healthy run, to stdout and to the job summary, and nothing to stderr", async () => {
		const result = await fnbNightly(
			["loyalty", "nightly", "--tenant", "fixture-a"],
			healthyRunner(),
		);
		expect(result.code).toBe(0);
		expect(result.stdout).toBe(
			"tenant 1: loyalty: reconciled, a_earned 1\ntenant 1: nightly clawbacks 2, expired_points 0, expired_stamps 3, liability_rows 1\n",
		);
		expect(result.stderr).toBe("");
		expect(result.summary).toContain("- tenant 1: nightly clawbacks 2");
		expectNoIdentifiers(result);
	});

	it.each(ECHOING_ERRORS)(
		"keeps a %s out of the output when the reconcile step fails with it",
		async (_kind, message) => {
			const result = await fnbNightly(
				["loyalty", "nightly", "--tenant", "fixture-a"],
				healthyRunner({
					reconcileLoyalty: async () => {
						throw new Error(message);
					},
				}),
			);
			expect(result.code).toBe(1);
			expect(result.stdout).toContain("tenant 1: loyalty: failed (");
			expectNoIdentifiers(result);
		},
	);

	it.each(ECHOING_ERRORS)(
		"keeps a %s out of the output when the nightly step fails with it",
		async (_kind, message) => {
			const result = await fnbNightly(
				["loyalty", "nightly", "--all-tenants"],
				healthyRunner({
					loyaltyNightly: async () => {
						throw new Error(message);
					},
				}),
			);
			expect(result.code).toBe(1);
			expect(result.stdout).toContain("tenant 1: nightly failed (");
			expectNoIdentifiers(result);
		},
	);

	it.each(ECHOING_ERRORS)(
		"keeps a %s out of the output when the whole run fails with it",
		async (_kind, message) => {
			const result = await fnbNightly(
				["loyalty", "nightly", "--all-tenants"],
				healthyRunner({
					loyaltyTenants: async () => {
						throw new Error(message);
					},
				}),
			);
			expect(result.code).toBe(1);
			expect(result.stderr).toContain("fnb loyalty nightly failed");
			expectNoIdentifiers(result);
		},
	);

	it.each([
		["a phone", PHONES[2] ?? ""],
		["a Zalo user id", ZALO_USER_ID],
		["a path segment", PATH_SEGMENT],
		["a pool code", POOL_CODES[0] ?? ""],
	])(
		"does not repeat %s given as the tenant when no tenant has that slug",
		async (_kind, slug) => {
			const result = await fnbNightly(
				["loyalty", "nightly", "--tenant", slug],
				healthyRunner(),
				{ tenants: [] },
			);
			expect(result.code).toBe(2);
			expect(result.stderr).toContain("no tenant with that slug");
			expectNoIdentifiers(result);
		},
	);

	it("control: with CI unset the same run names the tenant, and the harness sees it in stdout and in the summary", async () => {
		const result = await fnbNightly(
			["loyalty", "nightly", "--tenant", PATH_SEGMENT],
			healthyRunner(),
			{ ci: false, tenants: [{ ...TENANT_ROW, slug: PATH_SEGMENT }] },
		);
		expect(result.code).toBe(0);
		expect(identifierFindings("stdout", result.stdout)).not.toEqual([]);
		expect(identifierFindings("summary", result.summary)).not.toEqual([]);
	});
});
