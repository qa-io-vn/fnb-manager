import { SERVER_INCREMENTAL_BUDGET } from "@fnb/sync";
import { describe, expect, it } from "vitest";
import {
	alertCounts,
	alertsCheck,
	openingHoursCheck,
} from "../../src/commands/doctor-checks.js";
import { alertText } from "../../src/commands/status.js";
import { freshnessLine } from "../../src/commands/sync-alerts.js";
import { incrementalBudgetOption } from "../../src/commands/sync-incremental.js";
import { UsageError } from "../../src/context.js";

const OPENED = new Date("2026-11-06T03:00:00Z");

describe("incremental sync health", () => {
	it("turns doctor red while the scheduler holds an open alert, counting only", () => {
		expect(alertsCheck(alertCounts([]), true).health).toBe("green");
		expect(alertsCheck(alertCounts([]), false).detail).toBe(
			"no open alert; the schedule is disabled, so no tick evaluates the stores",
		);
		const check = alertsCheck(
			alertCounts([
				{ kind: "sync_stale", minutes: 150, occurrences: 2, http_status: null },
				{ kind: "sync_stale", minutes: 95, occurrences: 1, http_status: null },
				{
					kind: "dispatch_failed",
					minutes: null,
					occurrences: 3,
					http_status: 503,
				},
			]),
			true,
		);
		expect(check.health).toBe("red");
		expect(check.detail).toContain(
			"2 store(s) over the 90-minute dead-man threshold (longest 150 min",
		);
		expect(check.detail).toContain(
			"3 scheduled call(s) to 1 store(s) expired unclaimed, last answers HTTP 503",
		);
	});

	it("warns about opening hours entered without a usable span", () => {
		expect(
			openingHoursCheck({ active: 2, never_entered: 2, without_span: 0 }),
		).toMatchObject({ health: "green" });
		const check = openingHoursCheck({
			active: 3,
			never_entered: 1,
			without_span: 1,
		});
		expect(check.health).toBe("yellow");
		expect(check.detail).toContain(
			"1 of 3 active store(s) have opening hours; 1 never entered, 1 entered without a usable span",
		);
	});

	it("shows a store's open alerts in fnb status", () => {
		expect(alertText([])).toBe("–");
		expect(
			alertText([
				{
					store_id: "s",
					kind: "dispatch_failed",
					minutes: null,
					occurrences: 2,
					http_status: null,
					opened_at: OPENED,
				},
				{
					store_id: "s",
					kind: "sync_stale",
					minutes: 120,
					occurrences: 1,
					http_status: null,
					opened_at: OPENED,
				},
			]),
		).toBe("dispatch failed x2, stale 120 min");
	});

	it("says why the nightly check skipped a store", () => {
		expect(
			freshnessLine({
				storeId: "s",
				label: "account 1 store 2",
				businessDate: "2026-11-07",
				watched: false,
				longestGapMinutes: null,
				stale: false,
			}),
		).toBe(
			"account 1 store 2: not watched (inactive, paused or opted out of the incremental sync), yesterday's dead-man's check skipped",
		);
	});

	it("gives the CLI runner a server budget unless told otherwise", () => {
		expect(incrementalBudgetOption({})).toEqual(SERVER_INCREMENTAL_BUDGET);
		expect(
			incrementalBudgetOption({
				"wall-budget-ms": "105000",
				"cpu-budget-ms": "1200",
			}),
		).toEqual({ wallClockMs: 105_000, cpuMs: 1_200 });
		expect(() => incrementalBudgetOption({ "wall-budget-ms": "soon" })).toThrow(
			UsageError,
		);
	});
});
