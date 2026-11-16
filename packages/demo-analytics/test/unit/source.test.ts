import {
	type AnalyticsArgs,
	type AnalyticsFunctionName,
	analyticsFunctions,
} from "@fnb/reports";
import { describe, expect, it } from "vitest";
import {
	createDemoAnalyticsSource,
	DemoDayCache,
	DemoSettingsStore,
	demoSettings,
	demoStores,
	demoTargets,
} from "../../src/index.js";

const NOW = new Date("2026-11-04T05:30:00.000Z");

function source() {
	return createDemoAnalyticsSource({
		now: () => NOW,
		volumeScale: 0.2,
		validateRows: true,
	});
}

describe("createDemoAnalyticsSource", () => {
	it("answers like the database for the demo stores", async () => {
		const demo = source();
		expect(demo.kind).toBe("demo");
		const coverage = await demo.call("store_coverage", {
			store_ids: ["MOCK-S2", "MOCK-S1", "MOCK-S2", "unknown"],
			from_date: "2026-11-01",
			to_date: "2026-11-03",
		});
		expect(
			coverage.map((row) => [
				row.store_id,
				row.opened_on,
				row.history_start,
				row.store_as_of_date,
			]),
		).toEqual([
			["MOCK-S2", "2026-08-31", "2026-08-31", "2026-11-03"],
			["MOCK-S1", "2024-12-02", "2024-12-02", "2026-11-03"],
		]);
		expect(coverage.every((row) => row.stale_days === 0)).toBe(true);
	});

	it("returns per-store blocks after the all-stores block", async () => {
		const rows = await source().call("period_compare_by_store", {
			store_ids: ["MOCK-S1", "MOCK-S2"],
			grain: "day",
			anchor: "2026-11-03",
		});
		expect(rows.map((row) => `${row.store_id}:${row.period}`)).toEqual([
			"null:current",
			"null:previous",
			"null:last_year",
			"null:baseline",
			"MOCK-S1:current",
			"MOCK-S1:previous",
			"MOCK-S1:last_year",
			"MOCK-S1:baseline",
			"MOCK-S2:current",
			"MOCK-S2:previous",
			"MOCK-S2:last_year",
			"MOCK-S2:baseline",
		]);
		const [all, , , , first, , , , second] = rows;
		expect(all?.invoices).toBe(
			(first?.invoices ?? 0) + (second?.invoices ?? 0),
		);
		expect(
			rows.find(
				(row) => row.store_id === "MOCK-S2" && row.period === "last_year",
			)?.days_with_data,
		).toBe(0);
	});

	it("keeps targets for the established store only", async () => {
		const rows = await source().call("store_targets", {
			store_ids: ["MOCK-S1", "MOCK-S2"],
			period_kind: "month",
			period_start: "2026-11-01",
		});
		expect(rows.map((row) => row.store_id)).toEqual(["MOCK-S1"]);
		expect(rows[0]?.net_target_amount).toBeGreaterThan(0);
	});

	it("reads the targets from the settings store, the sample targets by default and a saved target once it is saved", async () => {
		const settings = new DemoSettingsStore(demoSettings("2026-11-03"));
		const demo = createDemoAnalyticsSource({
			now: () => NOW,
			settings,
			validateRows: true,
		});
		const established = demoStores("2026-11-03")[0];
		if (established === undefined) throw new Error("missing demo store");
		const sample = demoTargets(established, "2026-11-01");
		const month = {
			store_ids: ["MOCK-S1", "MOCK-S2"],
			period_kind: "month" as const,
			period_start: "2026-11-01",
		};
		const pace = {
			store_ids: ["MOCK-S1", "MOCK-S2"],
			month_start: "2026-11-01",
			as_of: "2026-11-03",
		};
		expect(await demo.call("store_targets", month)).toEqual([
			{ store_id: "MOCK-S1", net_target_amount: sample },
		]);
		expect((await demo.call("month_pace", pace))[0]?.target_net_amount).toBe(
			sample,
		);
		settings.saveTargets([
			...settings.targets(),
			{
				storeId: "MOCK-S2",
				periodKind: "month",
				periodStart: "2026-11-01",
				netTargetAmount: 90_000_000,
			},
		]);
		expect(await demo.call("store_targets", month)).toEqual([
			{ store_id: "MOCK-S1", net_target_amount: sample },
			{ store_id: "MOCK-S2", net_target_amount: 90_000_000 },
		]);
		expect((await demo.call("month_pace", pace))[0]?.target_net_amount).toBe(
			(sample ?? 0) + 90_000_000,
		);
		expect(
			(
				await demo.call("month_pace", {
					...pace,
					store_ids: ["MOCK-S2"],
				})
			)[0]?.target_net_amount,
		).toBe(90_000_000);
	});

	it("raises the SQL argument errors", async () => {
		await expect(
			source().call("promotion_summary", {
				store_ids: ["MOCK-S1"],
				from_date: "2025-09-29",
				to_date: "2026-11-03",
			}),
		).rejects.toMatchObject({
			code: "22023",
			functionName: "promotion_summary",
		});
		await expect(
			source().call("period_compare", {
				store_ids: ["MOCK-S1"],
				grain: "fortnight" as "day",
				anchor: "2026-11-03",
			}),
		).rejects.toMatchObject({ code: "invalid_arguments" });
	});

	it("answers every analytics function of the contract", async () => {
		const day = "2026-11-03";
		const stores = ["MOCK-S1"];
		const minimalArgs: { [N in AnalyticsFunctionName]: AnalyticsArgs<N> } = {
			store_coverage: { store_ids: stores, from_date: day, to_date: day },
			period_compare: { store_ids: stores, grain: "day", anchor: day },
			period_compare_by_store: { store_ids: stores, grain: "day", anchor: day },
			period_series: {
				store_ids: stores,
				grain: "day",
				from_date: day,
				to_date: day,
			},
			daily_baselines: { store_ids: stores, from_date: day, to_date: day },
			hourly_profile: { store_ids: stores, target_date: day },
			metric_compare: {
				store_ids: stores,
				metric_ids: ["net_revenue"],
				grain: "day",
				anchor: day,
			},
			item_summary: { store_ids: stores, from_date: day, to_date: day },
			payment_summary: { store_ids: stores, from_date: day, to_date: day },
			promotion_summary: { store_ids: stores, from_date: day, to_date: day },
			shift_review: { store_ids: stores, from_date: day, to_date: day },
			store_targets: {
				store_ids: stores,
				period_kind: "month",
				period_start: "2026-11-01",
			},
			item_velocity: { store_ids: stores, as_of_date: day },
			month_pace: { store_ids: stores, month_start: "2026-11-01", as_of: day },
			forecast_accuracy: { store_ids: stores, as_of_date: day, days: 28 },
			item_lifecycle: { store_ids: stores, as_of_date: day },
		};
		const demo = source();
		const names = Object.keys(analyticsFunctions) as AnalyticsFunctionName[];
		expect(names.sort()).toEqual(Object.keys(minimalArgs).sort());
		for (const name of names) {
			const rows = await demo.call(name, minimalArgs[name] as never);
			expect(Array.isArray(rows), name).toBe(true);
			expect(rows.length, name).toBeGreaterThan(0);
		}
	});

	it("refuses a volume scale that disagrees with a shared cache", () => {
		const days = new DemoDayCache({ now: () => NOW, volumeScale: 0.5 });
		expect(() =>
			createDemoAnalyticsSource({ now: () => NOW, days, volumeScale: 1 }),
		).toThrow(RangeError);
	});
});
