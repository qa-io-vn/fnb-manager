import { createRedactor } from "@fnb/sync";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	guardIposTenant,
	type IncrementalStoreRunInput,
	IposSourceError,
	MemoryNotifier,
	outcomeLine,
	runIncrementalStore,
	sourceConflict,
} from "../../src/index.js";
import { createRunnerBed, FIXED_NOW, type RunnerBed } from "../support/bed.js";
import {
	IPOS_ENTRY,
	memorySnapshots,
	SNAPSHOT_STORE_UID,
	tinySnapshot,
} from "../support/snapshot.js";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("tenant iPOS source guard", () => {
	it("names the conflict in both directions and nothing else", () => {
		expect(sourceConflict("real", null)).toBeNull();
		expect(sourceConflict("snapshot", null)).toBeNull();
		expect(sourceConflict("real", "api")).toBeNull();
		expect(sourceConflict("snapshot", "snapshot")).toBeNull();
		expect(sourceConflict("snapshot", "api")).toContain(
			"holds data from the real iPOS API",
		);
		expect(sourceConflict("real", "snapshot")).toContain(
			"was loaded from the iPOS snapshot",
		);
	});

	it("records the first source of a tenant and refuses the other one afterwards", async () => {
		const { database } = await createRunnerBed();
		await guardIposTenant(database, "t-snap", "snapshot", { claim: true });
		await guardIposTenant(database, "t-snap", "snapshot", { claim: true });
		await expect(
			guardIposTenant(database, "t-snap", "real", { claim: true }),
		).rejects.toThrow(IposSourceError);
		await guardIposTenant(database, "t-real", "real", { claim: true });
		await expect(
			guardIposTenant(database, "t-real", "snapshot", { claim: true }),
		).rejects.toThrow(IposSourceError);
		expect(Object.fromEntries(database.sources)).toEqual({
			"t-snap": "snapshot",
			"t-real": "api",
		});
	});

	it("checks without recording on a dry run", async () => {
		const { database } = await createRunnerBed();
		await guardIposTenant(database, "t-new", "snapshot", { claim: false });
		expect(database.sources.size).toBe(0);
		database.sources.set("t-real", "api");
		await expect(
			guardIposTenant(database, "t-real", "snapshot", { claim: false }),
		).rejects.toThrow(IposSourceError);
	});

	it("lets the real API through, but not the snapshot, when the database cannot record a source", async () => {
		const { database } = await createRunnerBed();
		database.sourcesRecordable = false;
		await guardIposTenant(database, "t-old", "real", { claim: true });
		await expect(
			guardIposTenant(database, "t-old", "snapshot", { claim: true }),
		).rejects.toThrow("apply the migrations");
	});
});

describe("incremental store run and the tenant iPOS source", () => {
	function inputFor(
		bed: RunnerBed,
		notifier: MemoryNotifier,
		overrides: Partial<IncrementalStoreRunInput>,
	): IncrementalStoreRunInput {
		return {
			repository: bed.repository,
			database: bed.database,
			entries: [IPOS_ENTRY],
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

	it("refuses a snapshot run into a tenant holding real data, before any write or request", async () => {
		const bed = await createRunnerBed();
		bed.database.sources.set(bed.account.tenant_id, "api");
		bed.database.gap = 500;
		const notifier = new MemoryNotifier();
		const injected = vi.fn<typeof fetch>();
		const outcome = await runIncrementalStore(
			inputFor(bed, notifier, {
				environment: { IPOS_REAL_API: "off" },
				fetch: injected,
				snapshots: memorySnapshots({ [IPOS_ENTRY.key]: await tinySnapshot() }),
			}),
		);
		expect(outcome).toMatchObject({ kind: "failed", stage: "config" });
		expect(outcomeLine(outcome)).toContain("holds data from the real iPOS API");
		expect(bed.repository.tables.runs).toEqual([]);
		expect(notifier.sent).toEqual([]);
		expect(bed.database.gapQueries).toEqual([]);
		expect(injected).not.toHaveBeenCalled();
	});

	it("refuses a real run into a tenant loaded from the snapshot, without calling iPOS", async () => {
		const bed = await createRunnerBed();
		bed.database.sources.set(bed.account.tenant_id, "snapshot");
		const notifier = new MemoryNotifier();
		const injected = vi.fn<typeof fetch>();
		const network = vi.spyOn(globalThis, "fetch");
		const outcome = await runIncrementalStore(
			inputFor(bed, notifier, { fetch: injected }),
		);
		expect(outcome).toMatchObject({ kind: "failed", stage: "config" });
		expect(outcomeLine(outcome)).toContain("was loaded from the iPOS snapshot");
		expect(bed.repository.tables.runs).toEqual([]);
		expect(injected).not.toHaveBeenCalled();
		expect(network).not.toHaveBeenCalled();
	});

	it("runs a snapshot tenant from the snapshot and labels its requests", async () => {
		const bed = await createRunnerBed();
		const store = bed.repository.addStore(bed.account, {
			external_id: SNAPSHOT_STORE_UID,
			name: "Snapshot store",
			address: null,
			timezone: "Asia/Ho_Chi_Minh",
			business_day_start_minutes: 0,
			opened_on: null,
			raw: null,
		});
		const notifier = new MemoryNotifier();
		const injected = vi.fn<typeof fetch>();
		const network = vi.spyOn(globalThis, "fetch");
		const outcome = await runIncrementalStore(
			inputFor(bed, notifier, {
				environment: { IPOS_REAL_API: "off" },
				fetch: injected,
				storeId: store.id,
				snapshots: memorySnapshots({ [IPOS_ENTRY.key]: await tinySnapshot() }),
			}),
		);
		expect(outcome.kind, outcomeLine(outcome)).toBe("ran");
		expect(outcomeLine(outcome)).toContain(
			"iPOS snapshot requests (no network)",
		);
		expect(bed.database.sources.get(bed.account.tenant_id)).toBe("snapshot");
		expect(injected).not.toHaveBeenCalled();
		expect(network).not.toHaveBeenCalled();
	});
});
