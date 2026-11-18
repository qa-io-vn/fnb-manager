import { LOGIN_PATH } from "@fnb/connector-ipos";
import {
	createMemorySnapshotStorage,
	createSnapshotReplay,
} from "@fnb/connector-ipos/snapshot";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AccountConfigError,
	connectAccount,
	credentialsFor,
	iposApiMode,
	iposModeLine,
	requestCountText,
	SNAPSHOT_APP_KEY,
} from "../../src/index.js";
import {
	IPOS_ENTRY,
	memorySnapshots,
	SNAPSHOT_STORE_UID,
	tinySnapshot,
} from "../support/snapshot.js";

function refusingFetch() {
	return vi.fn<typeof fetch>(async () => {
		throw new Error("the network must not be used");
	});
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("IPOS_REAL_API", () => {
	it("is on when unset or empty, and accepts on and off in any case", () => {
		expect(iposApiMode({})).toBe("real");
		expect(iposApiMode({ IPOS_REAL_API: "" })).toBe("real");
		expect(iposApiMode({ IPOS_REAL_API: " on " })).toBe("real");
		expect(iposApiMode({ IPOS_REAL_API: "ON" })).toBe("real");
		expect(iposApiMode({ IPOS_REAL_API: "off" })).toBe("snapshot");
		expect(iposApiMode({ IPOS_REAL_API: "Off" })).toBe("snapshot");
	});

	it("rejects any other value as a configuration error", () => {
		for (const value of ["true", "false", "1", "0", "fake", "of"]) {
			expect(() => iposApiMode({ IPOS_REAL_API: value })).toThrow(
				AccountConfigError,
			);
			expect(() => iposApiMode({ IPOS_REAL_API: value })).toThrow(
				"IPOS_REAL_API must be on or off",
			);
		}
	});

	it("names the mode in one line", () => {
		expect(iposModeLine("real", null)).toBe("iPOS: REAL API (posapi.ipos.vn)");
		expect(
			iposModeLine("snapshot", { from: "2026-09-01", to: "2026-11-18" }),
		).toBe("iPOS: snapshot of 2026-09-01..2026-11-18 (no network)");
		expect(iposModeLine("snapshot", null)).toBe(
			"iPOS: snapshot, none built yet (no network)",
		);
		expect(requestCountText(3, "real")).toBe("POS HTTP requests 3");
		expect(requestCountText(3, "snapshot")).toBe(
			"iPOS snapshot requests 3 (no network)",
		);
	});

	it("lets the snapshot stand in for a missing application key, and only when off", () => {
		const entry = { ...IPOS_ENTRY, appAccessToken: undefined };
		expect(credentialsFor(entry, {}, "snapshot")).toMatchObject({
			appAccessToken: SNAPSHOT_APP_KEY,
		});
		expect(() => credentialsFor(entry, {}, "real")).toThrow(AccountConfigError);
	});
});

describe("connectAccount with IPOS_REAL_API=off", () => {
	it("answers every iPOS request from the snapshot and never calls fetch", async () => {
		const injected = refusingFetch();
		const network = vi.spyOn(globalThis, "fetch");
		const warnings: string[] = [];
		const session = await connectAccount(
			IPOS_ENTRY,
			{ IPOS_REAL_API: "off" },
			{
				fetch: injected,
				snapshots: memorySnapshots(
					{ [IPOS_ENTRY.key]: await tinySnapshot() },
					{ warnings },
				),
			},
		);
		const [store] = await session.connector.discoverStores();
		expect(store?.externalId).toBe(SNAPSHOT_STORE_UID);
		const totals = await session.connector.fetchControlTotals?.(
			store as NonNullable<typeof store>,
			{ fromDate: "2026-11-03", toDate: "2026-11-08" },
		);
		expect(totals?.map((total) => total.invoiceCount)).toEqual([1]);
		expect(session.ipos).toBe("snapshot");
		expect(session.httpRequests()).toBeGreaterThan(1);
		expect(injected).not.toHaveBeenCalled();
		expect(network).not.toHaveBeenCalled();
		expect(warnings).toEqual(["iPOS snapshot has no data after 2026-11-05"]);
	});

	it("refuses to connect without a snapshot instead of calling the API", async () => {
		const injected = refusingFetch();
		const network = vi.spyOn(globalThis, "fetch");
		await expect(
			connectAccount(IPOS_ENTRY, { IPOS_REAL_API: "off" }, { fetch: injected }),
		).rejects.toThrow(AccountConfigError);
		await expect(
			connectAccount(
				IPOS_ENTRY,
				{ IPOS_REAL_API: "off" },
				{ fetch: injected, snapshots: memorySnapshots({}) },
			),
		).rejects.toThrow("has no iPOS snapshot yet");
		expect(injected).not.toHaveBeenCalled();
		expect(network).not.toHaveBeenCalled();
	});

	it("rejects an unknown value before any connector is built", async () => {
		await expect(
			connectAccount(
				{ key: "mock-1", connector: "mock", seed: 1 },
				{ IPOS_REAL_API: "maybe" },
			),
		).rejects.toThrow(AccountConfigError);
	});
});

describe("connectAccount with IPOS_REAL_API=on", () => {
	async function fakeApi() {
		return vi.fn<typeof fetch>(createSnapshotReplay(await tinySnapshot()));
	}

	it("uses the injected fetch and records each answer into the snapshot, without the token", async () => {
		const injected = await fakeApi();
		const recorded = createMemorySnapshotStorage();
		const session = await connectAccount(
			IPOS_ENTRY,
			{},
			{
				fetch: injected,
				snapshots: memorySnapshots({}, { recordTo: recorded }),
			},
		);
		await session.connector.discoverStores();
		expect(session.ipos).toBe("real");
		expect(injected).toHaveBeenCalled();
		expect(session.httpRequests()).toBe(injected.mock.calls.length);
		const login = await recorded.readResponse(`POST ${LOGIN_PATH}`);
		expect(login).not.toBeNull();
		expect(JSON.stringify(login)).not.toContain('"token"');
		expect((await recorded.readManifest())?.origin).toBe("api");
	});

	it("records nothing when the runner keeps no snapshot", async () => {
		const injected = await fakeApi();
		const session = await connectAccount(
			IPOS_ENTRY,
			{ IPOS_REAL_API: "on" },
			{ fetch: injected, snapshots: memorySnapshots({}) },
		);
		await session.connector.discoverStores();
		expect(injected).toHaveBeenCalled();
	});
});
