import {
	authFailedNotification,
	MemoryNotifier,
	type Notification,
	type Notifier,
	notifySafely,
} from "@fnb/runner";
import type { Sql } from "postgres";
import { describe, expect, it } from "vitest";
import {
	CompositeNotifier,
	NotifierDeliveryError,
	OutboxNotifier,
} from "../../src/outbox/index.js";

const TENANT = "33333333-3333-4333-8333-333333333333";
const ACCOUNT = "66666666-6666-4666-8666-666666666666";

interface CapturedQuery {
	readonly text: string;
	readonly values: readonly unknown[];
}

function fakeSql(
	rows: unknown[],
	fail = false,
): { sql: () => Sql; queries: CapturedQuery[] } {
	const queries: CapturedQuery[] = [];
	const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
		queries.push({ text: strings.join("$"), values });
		return fail
			? Promise.reject(new Error("database unavailable"))
			: Promise.resolve(rows);
	};
	return { sql: () => tag as unknown as Sql, queries };
}

function notification(): Notification {
	return {
		...authFailedNotification({
			subject: { tenantId: TENANT, accountId: ACCOUNT },
			label: "account 1",
			occurredAt: new Date("2026-11-09T02:00:00.000Z"),
		}),
		facts: { stage: "auth", attempts: 2 },
	};
}

describe("OutboxNotifier", () => {
	it("records the notification through app.record_runner_notification with count-only facts", async () => {
		const { sql, queries } = fakeSql([
			{ event_id: "e-1", outcome: "opened", messages: 1 },
		]);
		const outcomes = await new OutboxNotifier(sql, "cli").record(
			notification(),
		);
		expect(outcomes).toEqual([
			{ eventId: "e-1", outcome: "opened", messages: 1 },
		]);
		const [query] = queries;
		expect(query?.text).toContain("from app.record_runner_notification(");
		expect(query?.values).toEqual([
			"auth_failed",
			"critical",
			TENANT,
			ACCOUNT,
			null,
			null,
			JSON.stringify({ stage: "auth", attempts: 2 }),
			"2026-11-09T02:00:00.000Z",
			"cli",
		]);
		expect(JSON.stringify(query?.values)).not.toContain("account 1");
		expect(JSON.stringify(query?.values)).not.toContain("rejected");
	});

	it("opens the connection only when a notification is sent", async () => {
		let opened = 0;
		const notifier = new OutboxNotifier(() => {
			opened += 1;
			return fakeSql([]).sql();
		}, "incremental");
		expect(opened).toBe(0);
		await notifier.notify(notification());
		expect(opened).toBe(1);
	});
});

describe("CompositeNotifier", () => {
	it("delivers to every notifier and reports a failed member", async () => {
		const memory = new MemoryNotifier();
		const failing: Notifier = {
			notify: () => Promise.reject(new Error("synthetic failure")),
		};
		const composite = new CompositeNotifier([memory, failing]);
		await expect(composite.notify(notification())).rejects.toBeInstanceOf(
			NotifierDeliveryError,
		);
		expect(memory.sent).toHaveLength(1);
		await expect(
			new CompositeNotifier([memory]).notify(notification()),
		).resolves.toBeUndefined();
		expect(memory.sent).toHaveLength(2);
	});

	it("never fails a run through notifySafely when the outbox write fails", async () => {
		const memory = new MemoryNotifier();
		const { sql } = fakeSql([], true);
		const lines: string[] = [];
		const delivered = await notifySafely(
			new CompositeNotifier([memory, new OutboxNotifier(sql, "cli")]),
			notification(),
			(line) => lines.push(line),
		);
		expect(delivered).toBe(false);
		expect(memory.sent).toHaveLength(1);
		expect(lines).toEqual([
			"[notify] could not deliver auth_failed for account 1: NotifierDeliveryError",
		]);
	});
});
