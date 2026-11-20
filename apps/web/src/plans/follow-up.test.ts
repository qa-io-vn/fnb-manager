import type { StoredKpi } from "@fnb/datapack";
import { planKpiKey } from "@fnb/datapack";
import type { ReportSource } from "@fnb/reports";
import { describe, expect, it, vi } from "vitest";
import {
	followUpCalls,
	followUpOf,
	planFollowUp,
	sameValue,
	windowEnding,
} from "./follow-up";

const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";

function kpi(storeIds: string[], baseline: number, target: number): StoredKpi {
	return {
		scope: storeIds.length === 1 ? "S1" : "ALL",
		store_ids: storeIds,
		baseline,
		target,
		lo: baseline * 0.9,
		hi: baseline * 1.1,
		initiatives: [1],
		due_on: "2027-02-09",
		window_days: 28,
	};
}

const kpis = {
	avg_ticket: kpi([S2, S1], 90000, 99000),
	discount_rate: kpi([S1, S2], 0.05, 0.04),
	invoices: kpi([S1], 3000, 3300),
};

describe("followUpCalls", () => {
	it("makes one metric_windows call per store set with the current and the baseline window", () => {
		expect(followUpCalls(kpis, "2026-11-11", "2026-12-11")).toEqual([
			{
				storeIds: [S1],
				metricIds: ["invoices"],
				fromDates: ["2026-11-14", "2026-10-15"],
				toDates: ["2026-12-11", "2026-11-11"],
			},
			{
				storeIds: [S1, S2],
				metricIds: ["avg_ticket", "discount_rate"],
				fromDates: ["2026-11-14", "2026-10-15"],
				toDates: ["2026-12-11", "2026-11-11"],
			},
		]);
	});

	it("uses 28-day windows ending on the given day", () => {
		expect(windowEnding("2026-03-01")).toEqual({
			from: "2026-02-02",
			to: "2026-03-01",
		});
	});
});

describe("followUpOf", () => {
	const values = new Map<string, [number | null, number | null]>([
		[planKpiKey("avg_ticket", [S1, S2]), [97000, 90000]],
		[planKpiKey("discount_rate", [S1, S2]), [0.06, 0.0501]],
		[planKpiKey("invoices", [S1]), [null, 3000]],
	]);
	const result = followUpOf(
		{ kpis, asOf: "2026-11-11", horizon: "90d" },
		"2026-12-26",
		values,
	);

	it("gives each KPI its current value, status and band flag", () => {
		const byId = new Map(result.kpis.map((row) => [row.metricId, row]));
		expect(byId.get("avg_ticket")).toMatchObject({
			current: 97000,
			status: "on_track",
			withinBand: true,
		});
		expect(byId.get("discount_rate")?.status).toBe("off_course");
		expect(byId.get("invoices")?.status).toBe("no_data");
		expect(result.onTrack).toBe(1);
	});

	it("flags a re-measured baseline that differs, and no flag when the data has not changed", () => {
		const byId = new Map(result.kpis.map((row) => [row.metricId, row]));
		expect(byId.get("avg_ticket")?.baselineChanged).toBe(false);
		expect(byId.get("discount_rate")?.baselineChanged).toBe(true);
	});

	it("compares with a floating-point tolerance and treats a missing value as unchanged", () => {
		expect(sameValue(0.1 + 0.2, 0.3)).toBe(true);
		expect(sameValue(null, 5)).toBe(true);
		expect(sameValue(5.0001, 5)).toBe(false);
	});
});

describe("planFollowUp", () => {
	it("reads range 1 as current and range 2 as the re-measured baseline from the source", async () => {
		const callTheme = vi.fn(
			async (_name: string, args: { store_ids: string[] }) =>
				args.store_ids.length === 1
					? [
							{
								range_index: 1,
								from_date: "",
								to_date: "",
								metric_id: "invoices",
								value: 3100,
							},
							{
								range_index: 2,
								from_date: "",
								to_date: "",
								metric_id: "invoices",
								value: 3000,
							},
						]
					: [],
		);
		const source = { callTheme } as unknown as ReportSource;
		const result = await planFollowUp(
			source,
			{ kpis, asOf: "2026-11-11", horizon: "90d" },
			"2026-12-26",
		);
		expect(callTheme).toHaveBeenCalledTimes(2);
		expect(callTheme.mock.calls[0]?.[0]).toBe("metric_windows");
		const invoices = result.kpis.find((row) => row.metricId === "invoices");
		expect(invoices).toMatchObject({
			current: 3100,
			remeasured: 3000,
			baselineChanged: false,
		});
	});
});
