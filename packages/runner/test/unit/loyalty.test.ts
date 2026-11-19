import type { BusinessDateWindow } from "@fnb/connector-core";
import { createRedactor } from "@fnb/sync";
import { describe, expect, it } from "vitest";
import {
	FAST_LANE_WINDOW_MINUTES,
	fastLaneEnabled,
	fastLaneWindow,
	type LoyaltyCounts,
	loyaltyLine,
	MemoryNotifier,
	outcomeReport,
	reconcileLoyaltySafely,
	runIncrementalStore,
	windowDays,
} from "../../src/index.js";
import {
	createRunnerBed,
	FakeRunnerDatabase,
	FIXED_NOW,
} from "../support/bed.js";

const store = { timezone: "Asia/Ho_Chi_Minh", business_day_start_minutes: 0 };

class LoyaltyRunnerDatabase extends FakeRunnerDatabase {
	readonly reconciled: {
		tenantId: string;
		window: BusinessDateWindow;
		at: string;
	}[] = [];
	failWith: Error | null = null;
	answer: LoyaltyCounts | null = { a_earned: 2, b_matched: 1 };

	async reconcileLoyalty(
		tenantId: string,
		window: BusinessDateWindow,
		at: Date,
	): Promise<LoyaltyCounts | null> {
		this.reconciled.push({ tenantId, window, at: at.toISOString() });
		if (this.failWith) {
			throw this.failWith;
		}
		return this.answer;
	}
}

describe("the fast-lane window", () => {
	it("covers the last 60 minutes", () => {
		expect(FAST_LANE_WINDOW_MINUTES).toBe(60);
	});

	it("stays on one business day in the middle of the day", () => {
		const window = fastLaneWindow(store, new Date("2026-11-19T07:30:00.000Z"));
		expect(window).toEqual({ fromDate: "2026-11-19", toDate: "2026-11-19" });
		expect(windowDays(window)).toBe(1);
	});

	it("reaches back into the previous business day just after the day starts", () => {
		const window = fastLaneWindow(store, new Date("2026-11-18T17:20:00.000Z"));
		expect(window).toEqual({ fromDate: "2026-11-18", toDate: "2026-11-19" });
		expect(windowDays(window)).toBe(2);
	});

	it("follows the store's business day start", () => {
		const late = {
			timezone: "Asia/Ho_Chi_Minh",
			business_day_start_minutes: 300,
		};
		expect(fastLaneWindow(late, new Date("2026-11-18T22:30:00.000Z"))).toEqual({
			fromDate: "2026-11-18",
			toDate: "2026-11-19",
		});
		expect(fastLaneWindow(late, new Date("2026-11-18T19:00:00.000Z"))).toEqual({
			fromDate: "2026-11-18",
			toDate: "2026-11-18",
		});
	});

	it("refuses a window outside 1 to 1440 minutes", () => {
		expect(() => fastLaneWindow(store, FIXED_NOW, 0)).toThrow(RangeError);
		expect(() => fastLaneWindow(store, FIXED_NOW, 1441)).toThrow(RangeError);
	});
});

describe("the fast-lane switch", () => {
	it("is off unless LOYALTY_FAST_LANE is on", () => {
		expect(fastLaneEnabled({})).toBe(false);
		expect(fastLaneEnabled({ LOYALTY_FAST_LANE: "off" })).toBe(false);
		expect(fastLaneEnabled({ LOYALTY_FAST_LANE: "1" })).toBe(false);
		expect(fastLaneEnabled({ LOYALTY_FAST_LANE: " ON " })).toBe(true);
	});
});

describe("the loyalty step", () => {
	const redact = createRedactor(["synthetic-secret"]);
	const window = { fromDate: "2026-11-17", toDate: "2026-11-19" };

	it("reports counts only", async () => {
		const database = new LoyaltyRunnerDatabase();
		const outcome = await reconcileLoyaltySafely(
			database,
			"tenant",
			window,
			FIXED_NOW,
			redact,
		);
		expect(outcome).toEqual({
			status: "reconciled",
			counts: { a_earned: 2, b_matched: 1 },
		});
		expect(loyaltyLine(outcome)).toBe(
			"loyalty: reconciled, a_earned 2, b_matched 1",
		);
	});

	it("is skipped without a programme or without the database function", async () => {
		const database = new LoyaltyRunnerDatabase();
		database.answer = null;
		expect(
			await reconcileLoyaltySafely(
				database,
				"tenant",
				window,
				FIXED_NOW,
				redact,
			),
		).toEqual({
			status: "skipped",
			reason: "no_active_programme",
		});
		expect(
			await reconcileLoyaltySafely(
				undefined,
				"tenant",
				window,
				FIXED_NOW,
				redact,
			),
		).toEqual({
			status: "skipped",
			reason: "not_wired",
		});
	});

	it("contains a failure and redacts it", async () => {
		const database = new LoyaltyRunnerDatabase();
		database.failWith = new Error("connection to synthetic-secret refused");
		const outcome = await reconcileLoyaltySafely(
			database,
			"tenant",
			window,
			FIXED_NOW,
			redact,
		);
		expect(outcome.status).toBe("failed");
		expect(loyaltyLine(outcome)).not.toContain("synthetic-secret");
	});
});

describe("an incremental run", () => {
	it("ends with the loyalty reconciliation of its window", async () => {
		const bed = await createRunnerBed();
		const database = new LoyaltyRunnerDatabase();
		const lines: string[] = [];
		const outcome = await runIncrementalStore({
			repository: bed.repository,
			database,
			entries: bed.entries,
			environment: {},
			storeId: bed.store.id,
			notifier: new MemoryNotifier(),
			redact: createRedactor(),
			triggeredBy: "schedule",
			now: () => FIXED_NOW,
			log: (line) => lines.push(line),
		});
		expect(outcome.kind).toBe("ran");
		if (outcome.kind !== "ran") {
			return;
		}
		expect(database.reconciled).toEqual([
			{
				tenantId: bed.account.tenant_id,
				window: outcome.summary.window,
				at: FIXED_NOW.toISOString(),
			},
		]);
		expect(outcome.loyalty).toEqual({
			status: "reconciled",
			counts: { a_earned: 2, b_matched: 1 },
		});
		expect(outcomeReport(outcome)).toMatchObject({
			loyalty: { status: "reconciled", a_earned: 2 },
		});
		expect(lines.some((line) => line.includes("loyalty: reconciled"))).toBe(
			true,
		);
	});

	it("still succeeds when the loyalty step fails", async () => {
		const bed = await createRunnerBed();
		const database = new LoyaltyRunnerDatabase();
		database.failWith = new Error("loyalty step down");
		const outcome = await runIncrementalStore({
			repository: bed.repository,
			database,
			entries: bed.entries,
			environment: {},
			storeId: bed.store.id,
			notifier: new MemoryNotifier(),
			redact: createRedactor(),
			triggeredBy: "schedule",
			now: () => FIXED_NOW,
			log: () => undefined,
		});
		expect(outcome.kind).toBe("ran");
		if (outcome.kind === "ran") {
			expect(outcome.summary.status).toBe("succeeded");
			expect(outcome.loyalty?.status).toBe("failed");
			expect(outcomeReport(outcome)).toMatchObject({
				loyalty: { status: "failed" },
			});
		}
	});

	it("skips the step quietly where the database has no loyalty function", async () => {
		const bed = await createRunnerBed();
		const outcome = await runIncrementalStore({
			repository: bed.repository,
			database: bed.database,
			entries: bed.entries,
			environment: {},
			storeId: bed.store.id,
			notifier: new MemoryNotifier(),
			redact: createRedactor(),
			triggeredBy: "schedule",
			now: () => FIXED_NOW,
			log: () => undefined,
		});
		expect(outcome.kind === "ran" && outcome.loyalty).toEqual({
			status: "skipped",
			reason: "not_wired",
		});
	});
});
