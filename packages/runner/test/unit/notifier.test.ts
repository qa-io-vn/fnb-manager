import { createRedactor } from "@fnb/sync";
import { describe, expect, it } from "vitest";
import {
	authFailedNotification,
	ConsoleNotifier,
	formatNotification,
	MemoryNotifier,
	type Notifier,
	notifySafely,
	runFailedNotification,
	staleSyncNotification,
} from "../../src/index.js";

const AT = new Date("2026-11-05T03:00:00.000Z");
const SUBJECT = {
	tenantId: "tenant-1",
	accountId: "account-1",
	storeId: "store-1",
};

describe("notifier", () => {
	it("prints one identifier-free line per notification with sorted facts", async () => {
		const lines: string[] = [];
		const notifier: Notifier = new ConsoleNotifier((line) => lines.push(line));
		await notifier.notify(
			staleSyncNotification({
				subject: SUBJECT,
				label: "account 1 store 1",
				occurredAt: AT,
				minutes: 120,
				thresholdMinutes: 90,
				facts: { scope: "now" },
			}),
		);
		expect(lines).toEqual([
			"[notify] critical sync_stale: account 1 store 1: no successful sync for 120 minutes of opening hours (threshold 90) (minutes_without_sync=120, scope=now, threshold_minutes=90)",
		]);
		expect(lines[0]).not.toContain("tenant-1");
		expect(lines[0]).not.toContain("store-1");
	});

	it("redacts what a channel prints", async () => {
		const lines: string[] = [];
		const notifier = new ConsoleNotifier(
			(line) => lines.push(line),
			createRedactor(["hunter2"]),
		);
		await notifier.notify(
			runFailedNotification({
				subject: SUBJECT,
				label: "account 1 store 1",
				occurredAt: AT,
				error: "login with hunter2 refused",
			}),
		);
		expect(lines[0]).toContain("***");
		expect(lines[0]).not.toContain("hunter2");
	});

	it("builds the three phase 7 kinds with their severities", () => {
		const input = { subject: SUBJECT, label: "account 1", occurredAt: AT };
		expect(runFailedNotification({ ...input, error: "x" })).toMatchObject({
			kind: "run_failed",
			severity: "warning",
			occurredAt: AT.toISOString(),
		});
		expect(authFailedNotification(input)).toMatchObject({
			kind: "auth_failed",
			severity: "critical",
		});
		expect(
			formatNotification(authFailedNotification(input)).startsWith(
				"[notify] critical auth_failed: account 1: ",
			),
		).toBe(true);
	});

	it("keeps a failing channel from failing the run", async () => {
		const errors: string[] = [];
		const broken: Notifier = {
			notify: async () => {
				throw new TypeError("network down");
			},
		};
		const delivered = await notifySafely(
			broken,
			authFailedNotification({
				subject: SUBJECT,
				label: "account 1",
				occurredAt: AT,
			}),
			(line) => errors.push(line),
		);
		expect(delivered).toBe(false);
		expect(errors).toEqual([
			"[notify] could not deliver auth_failed for account 1: TypeError",
		]);
		const memory = new MemoryNotifier();
		expect(
			await notifySafely(
				memory,
				authFailedNotification({
					subject: SUBJECT,
					label: "account 1",
					occurredAt: AT,
				}),
				(line) => errors.push(line),
			),
		).toBe(true);
		expect(memory.sent).toHaveLength(1);
	});
});
