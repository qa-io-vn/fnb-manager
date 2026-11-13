import { describe, expect, it } from "vitest";
import {
	checkPreviousDayFreshness,
	DEAD_MAN_THRESHOLD_MINUTES,
	isStale,
	MemoryNotifier,
	previousBusinessDay,
} from "../../src/index.js";
import { createRunnerBed } from "../support/bed.js";

describe("dead-man's switch", () => {
	it("fires only past 90 minutes of opening time and never for a store that was never synced", () => {
		expect(DEAD_MAN_THRESHOLD_MINUTES).toBe(90);
		expect(isStale(null)).toBe(false);
		expect(isStale(90)).toBe(false);
		expect(isStale(91)).toBe(true);
		expect(isStale(31, 30)).toBe(true);
	});

	it("bounds the previous business day in the store's timezone and day start", () => {
		const at = new Date("2026-11-05T20:23:00.000Z");
		expect(
			previousBusinessDay(
				{ timezone: "Asia/Ho_Chi_Minh", business_day_start_minutes: 0 },
				at,
			),
		).toEqual({
			businessDate: "2026-11-05",
			from: new Date("2026-11-04T17:00:00.000Z"),
			to: new Date("2026-11-05T16:59:59.999Z"),
		});
		expect(
			previousBusinessDay(
				{ timezone: "Asia/Ho_Chi_Minh", business_day_start_minutes: 300 },
				at,
			),
		).toEqual({
			businessDate: "2026-11-04",
			from: new Date("2026-11-03T22:00:00.000Z"),
			to: new Date("2026-11-04T21:59:59.999Z"),
		});
	});

	it("checks yesterday's longest gap of each store only while the schedule is enabled", async () => {
		const bed = await createRunnerBed();
		const notifier = new MemoryNotifier();
		const stores = [
			{
				store: bed.store,
				label: "account 2 store 1",
				tenantId: bed.account.tenant_id,
				accountId: bed.account.id,
			},
		];
		const at = new Date("2026-11-05T20:23:00.000Z");
		bed.database.enabled = false;
		expect(
			await checkPreviousDayFreshness({
				database: bed.database,
				notifier,
				stores,
				at,
				onError: () => undefined,
			}),
		).toBeNull();
		expect(bed.database.longestQueries).toEqual([]);

		bed.database.enabled = true;
		bed.database.longest.set(bed.store.id, 140);
		const readings = await checkPreviousDayFreshness({
			database: bed.database,
			notifier,
			stores,
			at,
			onError: () => undefined,
		});
		expect(readings).toEqual([
			{
				storeId: bed.store.id,
				label: "account 2 store 1",
				businessDate: "2026-11-05",
				watched: true,
				longestGapMinutes: 140,
				stale: true,
			},
		]);
		expect(bed.database.longestQueries).toEqual([
			{
				storeId: bed.store.id,
				from: "2026-11-04T17:00:00.000Z",
				to: "2026-11-05T16:59:59.999Z",
			},
		]);
		expect(notifier.sent).toEqual([
			expect.objectContaining({
				kind: "sync_stale",
				facts: {
					business_date: "2026-11-05",
					scope: "previous_day",
					minutes_without_sync: 140,
					threshold_minutes: 90,
				},
			}),
		]);
	});

	it("raises nothing for a store the incremental sync does not watch", async () => {
		const bed = await createRunnerBed();
		const notifier = new MemoryNotifier();
		bed.database.unwatched.add(bed.store.id);
		bed.database.longest.set(bed.store.id, 900);
		const readings = await checkPreviousDayFreshness({
			database: bed.database,
			notifier,
			stores: [
				{
					store: bed.store,
					label: "account 2 store 1",
					tenantId: bed.account.tenant_id,
					accountId: bed.account.id,
				},
			],
			at: new Date("2026-11-05T20:23:00.000Z"),
			onError: () => undefined,
		});
		expect(readings).toEqual([
			{
				storeId: bed.store.id,
				label: "account 2 store 1",
				businessDate: "2026-11-05",
				watched: false,
				longestGapMinutes: null,
				stale: false,
			},
		]);
		expect(bed.database.longestQueries).toEqual([]);
		expect(notifier.sent).toEqual([]);
	});
});
