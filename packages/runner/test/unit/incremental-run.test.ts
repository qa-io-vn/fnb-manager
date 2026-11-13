import { createRedactor } from "@fnb/sync";
import { describe, expect, it } from "vitest";
import {
	type IncrementalStoreRunInput,
	MemoryNotifier,
	outcomeLine,
	outcomeReport,
	runIncrementalStore,
} from "../../src/index.js";
import { createRunnerBed, FIXED_NOW, type RunnerBed } from "../support/bed.js";

function inputFor(
	bed: RunnerBed,
	notifier: MemoryNotifier,
	overrides: Partial<IncrementalStoreRunInput> = {},
): IncrementalStoreRunInput {
	return {
		repository: bed.repository,
		database: bed.database,
		entries: bed.entries,
		environment: {},
		storeId: bed.store.id,
		notifier,
		redact: createRedactor(),
		triggeredBy: "schedule",
		now: () => FIXED_NOW,
		log: () => undefined,
		...overrides,
	};
}

function accountStatus(bed: RunnerBed): string | undefined {
	return bed.repository.tables.accounts.find(
		(account) => account.id === bed.account.id,
	)?.status;
}

describe("incremental store run", () => {
	it("syncs the changed days of one store and pulls nothing new the second time", async () => {
		const bed = await createRunnerBed();
		const notifier = new MemoryNotifier();
		const first = await runIncrementalStore(inputFor(bed, notifier));
		expect(first.kind).toBe("ran");
		if (first.kind !== "ran") {
			return;
		}
		expect(first.label).toBe("account 2 store 1");
		expect(first.summary.status).toBe("succeeded");
		expect(first.summary.days.map((day) => day.outcome)).toEqual([
			"synced",
			"synced",
			"synced",
		]);
		expect(first.summary.store.pulledSales).toBeGreaterThan(0);
		const second = await runIncrementalStore(inputFor(bed, notifier));
		expect(second.kind).toBe("ran");
		if (second.kind !== "ran") {
			return;
		}
		expect(second.summary.days.map((day) => day.outcome)).toEqual([
			"unchanged",
			"unchanged",
			"unchanged",
		]);
		expect(second.summary.connectorCalls).toBe(1);
		expect(second.summary.store.pulledSales).toBe(0);
		expect(notifier.sent).toEqual([]);
		expect(
			bed.repository.tables.runs.map((run) => [
				run.kind,
				run.store_id,
				run.triggered_by,
			]),
		).toEqual([
			["incremental", bed.store.id, "schedule"],
			["incremental", bed.store.id, "schedule"],
		]);
	});

	it("raises the dead-man's switch before running when the store went too long without a sync", async () => {
		const bed = await createRunnerBed();
		bed.database.gap = 125;
		const notifier = new MemoryNotifier();
		const outcome = await runIncrementalStore(inputFor(bed, notifier));
		expect(outcome.kind).toBe("ran");
		expect(notifier.sent).toEqual([
			expect.objectContaining({
				kind: "sync_stale",
				severity: "critical",
				label: "account 2 store 1",
				subject: {
					tenantId: bed.account.tenant_id,
					accountId: bed.account.id,
					storeId: bed.store.id,
				},
				facts: {
					scope: "now",
					minutes_without_sync: 125,
					threshold_minutes: 90,
				},
			}),
		]);
		expect(bed.database.gapQueries).toEqual([
			{ storeId: bed.store.id, at: FIXED_NOW.toISOString() },
		]);
		bed.database.gap = 90;
		const quiet = new MemoryNotifier();
		await runIncrementalStore(inputFor(bed, quiet));
		expect(quiet.sent).toEqual([]);
	});

	it("skips paused accounts and inactive or unknown stores without touching the POS", async () => {
		const bed = await createRunnerBed();
		const notifier = new MemoryNotifier();
		await bed.repository.updateAccountStatus(bed.account.id, "paused", [
			"active",
		]);
		expect(await runIncrementalStore(inputFor(bed, notifier))).toEqual({
			kind: "skipped",
			label: "account 2 store 1",
			reason: "account_paused",
		});
		expect(
			await runIncrementalStore(
				inputFor(bed, notifier, { storeId: "store-unknown" }),
			),
		).toMatchObject({ kind: "skipped", reason: "store_unknown" });
		await bed.repository.updateAccountStatus(bed.account.id, "active", [
			"paused",
		]);
		await bed.repository.upsertStores(bed.account, []);
		expect(await runIncrementalStore(inputFor(bed, notifier))).toMatchObject({
			kind: "skipped",
			reason: "store_inactive",
		});
		expect(bed.repository.tables.runs).toEqual([]);
		expect(notifier.sent).toEqual([]);
	});

	it("marks the account auth_failed once, alerts once and resumes after a good login", async () => {
		const bed = await createRunnerBed();
		const notifier = new MemoryNotifier();
		const rejected = bed.entries.map((entry) =>
			entry.key === bed.account.account_key && entry.connector === "mock"
				? { ...entry, seed: -1 }
				: entry,
		);
		const failed = await runIncrementalStore(
			inputFor(bed, notifier, { entries: rejected }),
		);
		expect(failed).toMatchObject({ kind: "failed", stage: "auth" });
		expect(accountStatus(bed)).toBe("auth_failed");
		expect(notifier.sent.map((sent) => sent.kind)).toEqual(["auth_failed"]);
		expect(bed.repository.tables.runs).toEqual([
			expect.objectContaining({
				kind: "incremental",
				store_id: bed.store.id,
				status: "failed",
				rows_upserted: { summary: { stage: "auth", connector_calls: 0 } },
			}),
		]);

		expect(
			await runIncrementalStore(inputFor(bed, notifier, { entries: rejected })),
		).toMatchObject({ kind: "skipped", reason: "account_auth_failed" });
		await runIncrementalStore(
			inputFor(bed, notifier, { entries: rejected, retryAuthFailed: true }),
		);
		expect(notifier.sent.map((sent) => sent.kind)).toEqual(["auth_failed"]);

		const resumed = await runIncrementalStore(
			inputFor(bed, notifier, { retryAuthFailed: true }),
		);
		expect(resumed.kind).toBe("ran");
		expect(accountStatus(bed)).toBe("active");
	});

	it("reports a store whose account has no credentials entry as a configuration failure", async () => {
		const bed = await createRunnerBed();
		const notifier = new MemoryNotifier();
		const outcome = await runIncrementalStore(
			inputFor(bed, notifier, { entries: [] }),
		);
		expect(outcome).toMatchObject({
			kind: "failed",
			stage: "config",
			label: "an account missing from POS_ACCOUNTS_JSON store 1",
		});
		expect(notifier.sent).toEqual([
			expect.objectContaining({
				kind: "run_failed",
				facts: { stage: "config", connector_calls: 0 },
			}),
		]);
		expect(accountStatus(bed)).toBe("active");
	});

	it("notifies a failed run with its run id and a redacted message", async () => {
		const bed = await createRunnerBed();
		const notifier = new MemoryNotifier();
		const secret = "s3cret-database-password";
		const original = bed.repository.applyStoreDay.bind(bed.repository);
		bed.repository.applyStoreDay = async () => {
			throw new Error(`connection lost for postgres:${secret}@db`);
		};
		const outcome = await runIncrementalStore(
			inputFor(bed, notifier, { redact: createRedactor([secret]) }),
		);
		bed.repository.applyStoreDay = original;
		expect(outcome.kind).toBe("failed");
		if (outcome.kind !== "failed") {
			return;
		}
		expect(outcome.stage).toBe("run");
		expect(outcome.error).not.toContain(secret);
		const [notification] = notifier.sent;
		expect(notification?.kind).toBe("run_failed");
		expect(notification?.subject.runId).toBe(outcome.summary?.runId);
		expect(notification?.message).not.toContain(secret);
	});

	it("reports counts without store names, account keys or money", async () => {
		const bed = await createRunnerBed();
		const outcome = await runIncrementalStore(
			inputFor(bed, new MemoryNotifier()),
		);
		const text = `${JSON.stringify(outcomeReport(outcome))}\n${outcomeLine(outcome)}`;
		expect(text).not.toContain(bed.store.name);
		expect(text).not.toContain(bed.account.account_key);
		expect(text).not.toContain(bed.store.external_id);
		expect(text).not.toMatch(/net|amount|₫/i);
		expect(outcomeReport(outcome)).toMatchObject({
			outcome: "ran",
			label: "account 2 store 1",
			status: "succeeded",
			days: { checked: 3, changed: 3, synced: 3, handed_off: 0 },
		});
	});

	it("reports days a cut-off run never checked as handed off, not as checked", async () => {
		const bed = await createRunnerBed();
		const outcome = await runIncrementalStore(
			inputFor(bed, new MemoryNotifier()),
		);
		expect(outcome.kind).toBe("ran");
		if (outcome.kind !== "ran") {
			return;
		}
		const cutOff = {
			...outcome,
			summary: {
				...outcome.summary,
				status: "partial" as const,
				stopped: "wall_time" as const,
				days: outcome.summary.days.map((day) => ({
					...day,
					reason: null,
					outcome: "handed_off" as const,
				})),
			},
		};
		expect(outcomeReport(cutOff)).toMatchObject({
			status: "partial",
			stopped: "wall_time",
			days: { checked: 0, changed: 0, synced: 0, handed_off: 3 },
		});
		expect(outcomeLine(cutOff)).toContain(
			"0 days checked, 0 changed, 0 synced, 3 handed off",
		);
	});
});
