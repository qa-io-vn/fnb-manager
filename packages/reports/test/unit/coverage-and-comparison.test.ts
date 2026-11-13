import { describe, expect, it } from "vitest";
import {
	comparisonsFromMetricRows,
	comparisonsFromPeriodRows,
	coverageModel,
	type PeriodRowLike,
	part,
	reportKeys,
} from "../../src/index.js";
import {
	compareRow,
	context,
	coverageRow,
	STORE_A,
	STORE_B,
	totalsRow,
} from "./fixtures.js";

const DAY = "2026-11-03";
const labels = {
	previous: part(reportKeys.compare.previous.day),
	last_year: part(reportKeys.compare.lastYear.day),
	baseline: part(reportKeys.compare.baseline),
};
const pickNet = (row: PeriodRowLike) => row.net_amount;

function dayRows(
	options: { baselineDays?: number; lastYearNet?: number | null } = {},
) {
	return [
		totalsRow(null, "current", DAY, DAY, { net_amount: 5_500_000 }),
		totalsRow(null, "previous", "2026-11-02", "2026-11-02", {
			net_amount: 5_000_000,
		}),
		totalsRow(null, "last_year", "2025-11-04", "2025-11-04", {
			net_amount:
				options.lastYearNet === undefined ? 4_400_000 : options.lastYearNet,
		}),
		totalsRow(null, "baseline", "2026-09-08", "2026-10-27", {
			days_with_data: options.baselineDays ?? 8,
			net_amount: 5_000_000,
		}),
	];
}

describe("coverageModel", () => {
	const rows = [
		coverageRow(STORE_A, { history_start: "2024-12-02" }),
		coverageRow(STORE_B, { history_start: "2026-08-31", stale_days: 2 }),
	];

	it("is full, partial or none by the history start of each store", () => {
		const model = coverageModel(rows, context("day", DAY));
		expect(model.forReference("2026-11-02").state).toBe("full");
		const partial = model.forReference("2025-11-04");
		expect(partial.state).toBe("partial");
		expect(partial.coveredStoreIds).toEqual([STORE_A]);
		expect(partial.youngStoreIds).toEqual([STORE_B]);
		expect(model.forReference("2024-01-01").state).toBe("none");
		expect(partial.earliestHistoryStart).toBe("2024-12-02");
	});

	it("counts a store without history as never covered", () => {
		const model = coverageModel(
			[coverageRow(STORE_A, { history_start: null })],
			context("day", DAY, [STORE_A]),
		);
		expect(model.forReference(DAY).state).toBe("none");
	});

	it("marks verification and stale stores", () => {
		expect(coverageModel(rows, context("day", DAY)).verification).toBe(
			"verified",
		);
		expect(coverageModel(rows, context("day", DAY)).staleStoreIds).toEqual([
			STORE_B,
		]);
		expect(
			coverageModel(
				[
					coverageRow(STORE_A, { unchecked_sales_days: 1 }),
					rows[1] ?? coverageRow(STORE_B),
				],
				context("day", DAY),
			).verification,
		).toBe("unverified");
		expect(
			coverageModel(
				rows,
				context("day", DAY, [STORE_A, STORE_B], { sample: true }),
			).verification,
		).toBe("sample");
	});
});

describe("comparisonsFromPeriodRows", () => {
	const coverage = coverageModel(
		[
			coverageRow(STORE_A, { history_start: "2024-12-02" }),
			coverageRow(STORE_B, { history_start: "2026-08-31" }),
		],
		context("day", DAY),
	);

	it("compares all stores when every store is covered", () => {
		const [previous] = comparisonsFromPeriodRows({
			all: dayRows(),
			likeForLike: {},
			coverage,
			kinds: ["previous"],
			pick: pickNet,
			labels,
		});
		expect(previous).toMatchObject({
			kind: "previous",
			basis: "all_stores",
			current: 5_500_000,
			reference: 5_000_000,
			difference: 500_000,
			unavailable: null,
			coveredStores: 2,
			totalStores: 2,
		});
		expect(previous?.change).toBeCloseTo(0.1, 12);
	});

	it("switches to like-for-like rows when coverage is partial", () => {
		const [lastYear] = comparisonsFromPeriodRows({
			all: dayRows(),
			likeForLike: {
				last_year: [
					compareRow("current", DAY, DAY, { net_amount: 3_300_000 }),
					compareRow("last_year", "2025-11-04", "2025-11-04", {
						net_amount: 3_000_000,
					}),
				],
			},
			coverage,
			kinds: ["last_year"],
			pick: pickNet,
			labels,
		});
		expect(lastYear).toMatchObject({
			basis: "like_for_like",
			current: 3_300_000,
			reference: 3_000_000,
			coveredStores: 1,
			totalStores: 2,
		});
		expect(lastYear?.label).toEqual({
			key: reportKeys.compare.likeForLike,
			values: {
				label: {
					kind: "part",
					value: { key: reportKeys.compare.lastYear.day, values: {} },
				},
				covered: { kind: "count", value: 1 },
				total: { kind: "count", value: 2 },
			},
		});
	});

	it("explains a missing reference by the young store", () => {
		const young = coverageModel(
			[coverageRow(STORE_B, { history_start: "2026-08-31" })],
			context("day", DAY, [STORE_B]),
		);
		const [lastYear] = comparisonsFromPeriodRows({
			all: dayRows({ lastYearNet: null }),
			likeForLike: {},
			coverage: young,
			kinds: ["last_year"],
			pick: pickNet,
			labels,
		});
		expect(lastYear).toMatchObject({
			unavailable: "store_too_young",
			reference: null,
			change: null,
			current: 5_500_000,
		});
		const empty = coverageModel(
			[coverageRow(STORE_B, { history_start: null })],
			context("day", DAY, [STORE_B]),
		);
		const [noData] = comparisonsFromPeriodRows({
			all: dayRows(),
			likeForLike: {},
			coverage: empty,
			kinds: ["previous"],
			pick: pickNet,
			labels,
		});
		expect(noData?.unavailable).toBe("no_data");
	});

	it("shows how many weeks a partial baseline holds", () => {
		const [baseline] = comparisonsFromPeriodRows({
			all: dayRows({ baselineDays: 3 }),
			likeForLike: {},
			coverage,
			kinds: ["baseline"],
			pick: pickNet,
			labels,
		});
		expect(baseline).toMatchObject({
			kind: "baseline",
			sampleDays: 3,
			basis: "all_stores",
			reference: 5_000_000,
			unavailable: null,
		});
		expect(baseline?.label).toEqual({
			key: reportKeys.compare.baselinePartial,
			values: { days: { kind: "count", value: 3 } },
		});
		const [building] = comparisonsFromPeriodRows({
			all: dayRows({ baselineDays: 0 }),
			likeForLike: {},
			coverage,
			kinds: ["baseline"],
			pick: pickNet,
			labels,
		});
		expect(building?.unavailable).toBe("building_baseline");
	});

	it("builds metric comparisons the same way", () => {
		const rows = [
			{
				metric_id: "discount_rate",
				period: "current" as const,
				from_date: DAY,
				to_date: DAY,
				value: 0.05,
			},
			{
				metric_id: "discount_rate",
				period: "previous" as const,
				from_date: "2026-11-02",
				to_date: "2026-11-02",
				value: 0.04,
			},
			{
				metric_id: "discount_rate",
				period: "last_year" as const,
				from_date: "2025-11-04",
				to_date: "2025-11-04",
				value: 0.03,
			},
		];
		const [previous, lastYear] = comparisonsFromMetricRows({
			all: rows,
			likeForLike: {},
			coverage,
			metricId: "discount_rate",
			kinds: ["previous", "last_year"],
			labels,
		});
		expect(previous?.difference).toBe(0.01);
		expect(previous?.basis).toBe("all_stores");
		expect(lastYear?.basis).toBe("like_for_like");
		expect(lastYear?.current).toBeNull();
	});
});
