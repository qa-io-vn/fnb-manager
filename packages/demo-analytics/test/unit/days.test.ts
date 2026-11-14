import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AggregateStore,
	DemoDayCache,
	DemoSettingsStore,
	demoRoles,
	demoSettings,
	sharedDemoDays,
} from "../../src/index.js";

const NOW = new Date("2026-11-04T05:30:00.000Z");

function cache(options: { window?: { from: string; to: string } } = {}) {
	return new DemoDayCache({ now: () => NOW, volumeScale: 0.2, ...options });
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("DemoDayCache", () => {
	it("knows the as-of day, the stores and today", () => {
		const days = cache();
		expect(days.asOf()).toBe("2026-11-03");
		expect(days.stores().map((store) => store.id)).toEqual([
			"MOCK-S1",
			"MOCK-S2",
		]);
		const young = days.store("MOCK-S2");
		if (young === undefined) throw new Error("missing store");
		expect(days.today(young)).toBe("2026-11-04");
		expect(days.storeRange(young)).toEqual({
			from: "2026-08-31",
			to: "2026-11-04",
		});
	});

	it("generates each store-day once and shares it between callers", async () => {
		const days = cache();
		const [first, second] = await Promise.all([
			days.aggregates("MOCK-S1", "2026-11-02"),
			days.aggregates("MOCK-S1", "2026-11-02"),
		]);
		expect(first).toBe(second);
		expect(days.generations()).toBe(1);
		const raw = await days.generated("MOCK-S1", "2026-11-02");
		expect(raw?.date).toBe("2026-11-02");
		expect(days.generations()).toBe(1);
		days.aggregatesNow("MOCK-S1", "2026-11-02");
		expect(days.generations()).toBe(1);
	});

	it("generates nothing for closed, unopened, future or windowed-out days", async () => {
		const days = cache({ window: { from: "2026-10-01", to: "2026-11-04" } });
		expect(await days.generated("MOCK-S1", "2026-02-17")).toBeNull();
		expect(await days.generated("MOCK-S2", "2026-08-30")).toBeNull();
		expect(await days.generated("MOCK-S1", "2026-11-05")).toBeNull();
		expect(await days.generated("MOCK-S1", "2026-09-30")).toBeNull();
		expect(await days.generated("MOCK-X", "2026-11-02")).toBeNull();
		expect(days.generations()).toBe(0);
	});

	it("generates today in full and keeps raw days only for the last 70 days", async () => {
		const days = cache();
		const today = await days.generated("MOCK-S1", "2026-11-04");
		expect(today?.sales.length).toBeGreaterThan(0);
		await days.generated("MOCK-S1", "2026-06-01");
		await days.generated("MOCK-S1", "2026-06-01");
		expect(days.generations()).toBe(3);
		await days.aggregates("MOCK-S1", "2026-06-01");
		expect(days.generations()).toBe(3);
	});

	it("yields to the scheduler before generating each store-day", async () => {
		const yieldTask = vi.fn(() => Promise.resolve());
		vi.stubGlobal("scheduler", { yield: yieldTask });
		const days = cache();
		const store = new AggregateStore(days);
		await store.ensure(["MOCK-S1", "MOCK-S2"], "2026-10-30", "2026-11-01");
		expect(days.generations()).toBe(6);
		expect(yieldTask).toHaveBeenCalledTimes(6);
		expect(store.day("MOCK-S2", "2026-10-31")?.daily?.invoices).toBeGreaterThan(
			0,
		);
		expect(store.misses()).toBe(0);
	});

	it("shares one cache between the demo sources", () => {
		expect(sharedDemoDays()).toBe(sharedDemoDays());
	});
});

describe("DemoDayCache and the settings' mappings", () => {
	it("re-ingests a cached day after roles change and keeps the raw day", () => {
		const days = cache();
		const settings = new DemoSettingsStore(demoSettings());
		days.useMappings(settings);
		const before = days.aggregatesNow("MOCK-S1", "2026-11-03");
		expect(before?.attach?.attachRateSnack).not.toBeNull();
		expect(days.hasAggregates("MOCK-S1", "2026-11-03")).toBe(true);
		const generated = days.generations();
		settings.saveRoles(demoRoles().filter((role) => role.role !== "snack"));
		expect(days.hasAggregates("MOCK-S1", "2026-11-03")).toBe(false);
		const after = days.aggregatesNow("MOCK-S1", "2026-11-03");
		expect(after?.attach?.attachRateSnack).toBeNull();
		expect(after?.daily).toEqual(before?.daily);
		expect(days.generations()).toBe(generated);
	});
});
