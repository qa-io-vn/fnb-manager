import { describe, expect, it } from "vitest";
import type { AnalyticsArgs } from "../../../src/contract/functions.js";
import { coverageModel } from "../../../src/model/coverage.js";
import type { ThemeArgs } from "../../../src/themes/contract.js";
import {
	comparisonsFromRangeRows,
	lastDaysWindow,
	likeForLikeRangeCalls,
	RANGE_INDEX,
	referenceLabel,
	reportCall,
	runTheme,
	type ThemeDefinition,
	themeCoverageCall,
	totalsCall,
} from "../../../src/themes/definition.js";
import { rangeOfPreset } from "../../../src/themes/range.js";
import type { ReportSource } from "../../../src/themes/source.js";
import { coverageRow } from "../fixtures.js";
import {
	rangeTotalsRow,
	STORE_A,
	STORE_B,
	THEME_AS_OF,
	themeContext,
} from "./fixtures.js";

const YOUNG_START = "2026-10-20";

function fakeSource(): {
	source: ReportSource;
	calls: { name: string; args: unknown }[];
} {
	const calls: { name: string; args: unknown }[] = [];
	const source: ReportSource = {
		kind: "demo",
		call(name, args: AnalyticsArgs<typeof name>) {
			calls.push({ name, args });
			if (name === "store_coverage") {
				return Promise.resolve([
					coverageRow(STORE_A, { history_start: "2025-01-01" }),
					coverageRow(STORE_B, { history_start: YOUNG_START }),
				]) as never;
			}
			return Promise.resolve([]) as never;
		},
		callTheme(name, args: ThemeArgs<typeof name>) {
			calls.push({ name, args });
			return Promise.resolve([]) as never;
		},
	};
	return { source, calls };
}

describe("theme call planning", () => {
	it("asks for coverage over the range and totals over the range and its references", () => {
		const context = themeContext("28d");
		expect(themeCoverageCall(context).args).toEqual({
			store_ids: [STORE_A, STORE_B],
			from_date: "2026-10-10",
			to_date: THEME_AS_OF,
		});
		expect(totalsCall(context).args).toEqual({
			store_ids: [STORE_A, STORE_B],
			from_dates: ["2026-10-10", "2026-09-12", "2025-10-11"],
			to_dates: [THEME_AS_OF, "2026-10-09", "2025-11-07"],
		});
		expect(totalsCall(themeContext("364d")).args.from_dates).toHaveLength(2);
	});

	it("plans like-for-like totals only for references where coverage is partial", () => {
		const context = themeContext("28d");
		const coverage = coverageModel(
			[
				coverageRow(STORE_A, { history_start: "2025-01-01" }),
				coverageRow(STORE_B, { history_start: YOUNG_START }),
			],
			context,
		);
		const calls = likeForLikeRangeCalls(context, coverage);
		expect(calls.map((call) => call.key)).toEqual([
			"totalsLfl.previous",
			"totalsLfl.last_year",
		]);
		expect(calls[0]?.args).toEqual({
			store_ids: [STORE_A],
			from_dates: ["2026-10-10", "2026-09-12"],
			to_dates: [THEME_AS_OF, "2026-10-09"],
		});
		const full = coverageModel(
			[coverageRow(STORE_A), coverageRow(STORE_B)],
			context,
		);
		expect(likeForLikeRangeCalls(context, full)).toEqual([]);
	});

	it("runs follow-ups with the primary results and builds the visible cards", async () => {
		const { source, calls } = fakeSource();
		const seen: unknown[] = [];
		const definition: ThemeDefinition = {
			kind: "revenue",
			slug: "doanh-thu",
			titleKey: "theme.revenue.title",
			defaultPreset: "28d",
			maxRangeDays: 400,
			params: [],
			cards: [
				{
					id: "shown",
					needs: ["coverage"],
					visible: () => true,
					build: ({ results }) => {
						seen.push(results.rows("coverage", "store_coverage")?.length);
						return { id: "shown" } as never;
					},
				},
				{
					id: "hidden",
					needs: [],
					visible: () => false,
					build: () => {
						throw new Error("hidden cards are never built");
					},
				},
			],
			primaryCalls: (context) => [
				themeCoverageCall(context),
				totalsCall(context),
				reportCall("again", "store_coverage", {
					store_ids: [STORE_A, STORE_B],
					from_date: context.range.from,
					to_date: context.range.to,
				}),
			],
			followUpCalls: (context, coverage, results) => {
				seen.push(results.rows("totals", "range_totals"));
				return likeForLikeRangeCalls(context, coverage);
			},
		};
		const models = await runTheme(definition, themeContext("28d"), source);
		expect(models.map((model) => model.id)).toEqual(["shown"]);
		expect(seen).toEqual([[], 2]);
		expect(calls.map((call) => call.name)).toEqual([
			"store_coverage",
			"range_totals",
			"range_totals",
			"range_totals",
		]);
	});

	it("refuses a key planned twice", async () => {
		const { source } = fakeSource();
		const context = themeContext("7d");
		const definition: ThemeDefinition = {
			kind: "revenue",
			slug: "doanh-thu",
			titleKey: "theme.revenue.title",
			defaultPreset: "28d",
			maxRangeDays: 400,
			params: [],
			cards: [],
			primaryCalls: () => [
				themeCoverageCall(context),
				themeCoverageCall(context),
			],
			followUpCalls: () => [],
		};
		await expect(runTheme(definition, context, source)).rejects.toThrow(
			"call key coverage is planned twice",
		);
	});
});

describe("comparisonsFromRangeRows", () => {
	const context = themeContext("28d");
	const range = context.range;
	const all = [
		rangeTotalsRow(RANGE_INDEX.current, null, range.from, range.to, {
			net_amount: 150_000_000,
		}),
		rangeTotalsRow(RANGE_INDEX.previous, null, "2026-09-12", "2026-10-09", {
			net_amount: 120_000_000,
		}),
		rangeTotalsRow(RANGE_INDEX.last_year, null, "2025-10-11", "2025-11-07", {
			net_amount: 100_000_000,
		}),
	];
	const pick = (row: { net_amount: number | null }) => row.net_amount;

	it("compares with every store when every store covers the reference", () => {
		const coverage = coverageModel(
			[coverageRow(STORE_A), coverageRow(STORE_B)],
			context,
		);
		const chips = comparisonsFromRangeRows({
			context,
			all,
			likeForLike: {},
			coverage,
			pick,
		});
		expect(chips.map((chip) => [chip.kind, chip.change, chip.basis])).toEqual([
			["previous", 0.25, "all_stores"],
			["last_year", 0.5, "all_stores"],
		]);
		expect(chips[0]?.label).toEqual({
			key: "theme.compare.previousWeeks",
			values: { weeks: { kind: "count", value: 4 } },
		});
	});

	it("uses the like-for-like rows when coverage is partial", () => {
		const coverage = coverageModel(
			[
				coverageRow(STORE_A),
				coverageRow(STORE_B, { history_start: YOUNG_START }),
			],
			context,
		);
		const chips = comparisonsFromRangeRows({
			context,
			all,
			likeForLike: {
				previous: [
					rangeTotalsRow(1, null, range.from, range.to, {
						net_amount: 110_000_000,
					}),
					rangeTotalsRow(2, null, "2026-09-12", "2026-10-09", {
						net_amount: 100_000_000,
					}),
				],
			},
			coverage,
			pick,
		});
		expect(chips[0]).toMatchObject({
			basis: "like_for_like",
			current: 110_000_000,
			reference: 100_000_000,
			coveredStores: 1,
			totalStores: 2,
		});
		expect(chips[1]).toMatchObject({ basis: "like_for_like", change: null });
	});

	it("says the store is too young when no selected store covers the reference", () => {
		const young = themeContext("28d", [STORE_B]);
		const coverage = coverageModel(
			[coverageRow(STORE_B, { history_start: YOUNG_START })],
			young,
		);
		const chips = comparisonsFromRangeRows({
			context: young,
			all,
			likeForLike: {},
			coverage,
			pick,
		});
		expect(chips.map((chip) => chip.unavailable)).toEqual([
			"store_too_young",
			"store_too_young",
		]);
	});

	it("gives 52 weeks and this year one chip", () => {
		const coverage = coverageModel([coverageRow(STORE_A)], context);
		for (const preset of ["364d", "this_year"] as const) {
			const chips = comparisonsFromRangeRows({
				context: themeContext(preset, [STORE_A]),
				all,
				likeForLike: {},
				coverage,
				pick,
			});
			expect(chips.map((chip) => chip.kind)).toEqual(["previous"]);
		}
	});
});

describe("labels and windows", () => {
	it("names each reference after the preset", () => {
		const keys = (preset: Parameters<typeof rangeOfPreset>[0]) => [
			referenceLabel(rangeOfPreset(preset, THEME_AS_OF), "previous").key,
			referenceLabel(rangeOfPreset(preset, THEME_AS_OF), "last_year").key,
		];
		expect(keys("7d")).toEqual([
			"theme.compare.previousDays",
			"theme.compare.lastYear",
		]);
		expect(keys("91d")).toEqual([
			"theme.compare.previousWeeks",
			"theme.compare.lastYear",
		]);
		expect(keys("this_month")).toEqual([
			"report.compare.previous.month",
			"report.compare.lastYear.month",
		]);
		expect(keys("this_year")[0]).toBe("report.compare.previous.year");
	});

	it("takes the last days of a range for functions that stop at 92 days", () => {
		expect(lastDaysWindow({ from: "2025-11-08", to: THEME_AS_OF }, 92)).toEqual(
			{ from: "2026-08-07", to: THEME_AS_OF, days: 92 },
		);
		expect(lastDaysWindow({ from: "2026-10-31", to: THEME_AS_OF }, 92)).toEqual(
			{ from: "2026-10-31", to: THEME_AS_OF, days: 7 },
		);
	});
});
