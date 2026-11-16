import { describe, expect, it } from "vitest";
import type { IsoDate } from "../../../../src/contract/values.js";
import { coverageModel } from "../../../../src/model/coverage.js";
import { addDays } from "../../../../src/period/dates.js";
import { mondayOf } from "../../../../src/period/iso-week.js";
import {
	customRange,
	MAX_THEME_RANGE_DAYS,
	NAMED_PRESETS,
	type NamedPreset,
	type RangeSeriesGrain,
	SERIES_ROW_LIMIT,
} from "../../../../src/themes/range.js";
import { themeDefinitions } from "../../../../src/themes/registry.js";
import { storesTheme } from "../../../../src/themes/stores/definition.js";
import {
	completeWeeksSince,
	SINCE_MAX_WEEKS,
	storesCalls,
	storesFollowUpCalls,
	storesPrimaryCalls,
} from "../../../../src/themes/stores/support.js";
import { STORE_A, STORE_B } from "../../fixtures.js";
import { coverageRow, STORE_C, storeIds, storesContext } from "./support.js";

function bucketCount(
	grain: RangeSeriesGrain,
	from: IsoDate,
	to: IsoDate,
): number {
	const buckets = new Set<string>();
	for (let date = from; date <= to; date = addDays(date, 1)) {
		buckets.add(
			grain === "day"
				? date
				: grain === "week"
					? mondayOf(date)
					: date.slice(0, 7),
		);
	}
	return buckets.size;
}

const EXPECTED_GRAINS: Readonly<
	Record<NamedPreset, readonly [RangeSeriesGrain, RangeSeriesGrain]>
> = {
	"7d": ["day", "day"],
	"28d": ["day", "day"],
	"91d": ["day", "week"],
	"364d": ["week", "week"],
	this_month: ["day", "day"],
	last_month: ["day", "day"],
	this_year: ["week", "week"],
};

function withHistory(
	context: ReturnType<typeof storesContext>,
	starts: Readonly<Record<string, IsoDate | null>>,
) {
	return coverageModel(
		Object.entries(starts).map(([storeId, start]) =>
			coverageRow(storeId, { history_start: start }),
		),
		context,
	);
}

describe("the So sánh calls", () => {
	it("asks only for coverage when one store is selected, and plans no follow-up", () => {
		const context = storesContext([STORE_A]);
		expect(storesPrimaryCalls(context)).toEqual([
			{
				key: storesCalls.coverage,
				name: "store_coverage",
				args: {
					store_ids: [STORE_A],
					from_date: "2026-10-10",
					to_date: "2026-11-06",
				},
			},
		]);
		expect(
			storesFollowUpCalls(
				context,
				withHistory(context, { [STORE_A]: "2025-01-01" }),
			),
		).toEqual([]);
	});

	it("asks for coverage, the range and the range before, opening productivity and the days with store rows for two stores", () => {
		const stores = [STORE_A, STORE_B];
		const range = { from_date: "2026-10-10", to_date: "2026-11-06" };
		expect(storesPrimaryCalls(storesContext(stores))).toEqual([
			{
				key: storesCalls.coverage,
				name: "store_coverage",
				args: { store_ids: stores, ...range },
			},
			{
				key: storesCalls.totals,
				name: "range_totals",
				args: {
					store_ids: stores,
					from_dates: ["2026-10-10", "2026-09-12"],
					to_dates: ["2026-11-06", "2026-10-09"],
				},
			},
			{
				key: storesCalls.productivity,
				name: "opening_productivity",
				args: { store_ids: stores, ...range },
			},
			{
				key: storesCalls.days,
				name: "period_series",
				args: {
					store_ids: stores,
					grain: "day",
					...range,
					include_stores: true,
				},
			},
		]);
	});

	it.each(
		NAMED_PRESETS.flatMap((preset) =>
			([2, 9] as const).map((count, index) => ({
				preset,
				count,
				grain: EXPECTED_GRAINS[preset][index],
			})),
		),
	)(
		"keeps the days call of $count stores over $preset within 900 rows at the $grain grain",
		({ preset, count, grain }) => {
			const context = storesContext(storeIds(count), preset);
			const days = storesPrimaryCalls(context).find(
				(call) => call.key === storesCalls.days,
			);
			const args = days?.args as {
				grain: RangeSeriesGrain;
				from_date: IsoDate;
				to_date: IsoDate;
				include_stores: boolean;
			};
			expect(args.grain).toBe(grain);
			expect(args.include_stores).toBe(true);
			const rows =
				bucketCount(args.grain, args.from_date, args.to_date) * (count + 1);
			expect(rows).toBeLessThanOrEqual(SERIES_ROW_LIMIT);
		},
	);

	it("turns a 92-day range weekly from nine stores and a 93-day range weekly for any number", () => {
		const grainOf = (count: number, from: IsoDate) => {
			const context = storesContext(storeIds(count));
			return storesPrimaryCalls({
				...context,
				range: customRange(from, context.range.to, context.range.asOf),
			}).find((call) => call.key === storesCalls.days)?.args;
		};
		expect(grainOf(8, "2026-08-07")).toMatchObject({ grain: "day" });
		expect(grainOf(9, "2026-08-07")).toMatchObject({ grain: "week" });
		expect(grainOf(2, "2026-08-06")).toMatchObject({ grain: "week" });
	});

	it("counts the complete weeks since a store's history start up to the as-of day", () => {
		expect(completeWeeksSince(null, "2026-11-06")).toBe(0);
		expect(completeWeeksSince("2026-11-07", "2026-11-06")).toBe(0);
		expect(completeWeeksSince("2026-10-31", "2026-11-06")).toBe(1);
		expect(completeWeeksSince("2026-11-01", "2026-11-06")).toBe(0);
		expect(completeWeeksSince("2026-09-07", "2026-11-06")).toBe(8);
	});

	it("plans a daily since-opening call per store over the first K complete weeks, K from the youngest store", () => {
		const context = storesContext([STORE_A, STORE_B]);
		const coverage = withHistory(context, {
			[STORE_A]: "2025-01-01",
			[STORE_B]: "2026-09-07",
		});
		expect(storesFollowUpCalls(context, coverage)).toEqual([
			{
				key: `since.${STORE_A}`,
				name: "period_series",
				args: {
					store_ids: [STORE_A],
					grain: "day",
					from_date: "2025-01-01",
					to_date: "2025-02-25",
					include_stores: false,
				},
			},
			{
				key: `since.${STORE_B}`,
				name: "period_series",
				args: {
					store_ids: [STORE_B],
					grain: "day",
					from_date: "2026-09-07",
					to_date: "2026-11-01",
					include_stores: false,
				},
			},
		]);
	});

	it("caps the aligned weeks at 26", () => {
		const context = storesContext([STORE_A, STORE_B]);
		const calls = storesFollowUpCalls(
			context,
			withHistory(context, {
				[STORE_A]: "2023-03-01",
				[STORE_B]: "2024-05-06",
			}),
		);
		expect(calls.map((call) => call.args)).toEqual([
			expect.objectContaining({
				from_date: "2023-03-01",
				to_date: addDays("2023-03-01", 7 * SINCE_MAX_WEEKS - 1),
			}),
			expect.objectContaining({
				from_date: "2024-05-06",
				to_date: addDays("2024-05-06", 7 * SINCE_MAX_WEEKS - 1),
			}),
		]);
	});

	it("leaves out a store younger than one complete week and aligns the others on the youngest store that has one", () => {
		const context = storesContext([STORE_A, STORE_B, STORE_C]);
		const calls = storesFollowUpCalls(
			context,
			withHistory(context, {
				[STORE_A]: "2025-01-01",
				[STORE_B]: "2026-09-07",
				[STORE_C]: "2026-11-03",
			}),
		);
		expect(calls.map((call) => call.key)).toEqual([
			storesCalls.totalsLikeForLike,
			`since.${STORE_A}`,
			`since.${STORE_B}`,
		]);
		expect(calls[2]?.args).toMatchObject({ to_date: "2026-11-01" });
	});

	it("adds the range and the range before over the covered stores only while the range before covers some of them", () => {
		const context = storesContext([STORE_A, STORE_B]);
		const partial = storesFollowUpCalls(
			context,
			withHistory(context, {
				[STORE_A]: "2025-01-01",
				[STORE_B]: "2026-09-20",
			}),
		);
		expect(partial[0]).toEqual({
			key: storesCalls.totalsLikeForLike,
			name: "range_totals",
			args: {
				store_ids: [STORE_A],
				from_dates: ["2026-10-10", "2026-09-12"],
				to_dates: ["2026-11-06", "2026-10-09"],
			},
		});
		for (const starts of [
			{ [STORE_A]: "2025-01-01", [STORE_B]: "2025-02-01" },
			{ [STORE_A]: "2026-09-15", [STORE_B]: "2026-09-20" },
		]) {
			expect(
				storesFollowUpCalls(context, withHistory(context, starts)).map(
					(call) => call.key,
				),
			).not.toContain(storesCalls.totalsLikeForLike);
		}
	});

	it("plans no since-opening call while no store has a complete week", () => {
		const context = storesContext([STORE_A, STORE_B]);
		expect(
			storesFollowUpCalls(
				context,
				withHistory(context, {
					[STORE_A]: "2026-11-02",
					[STORE_B]: null,
				}),
			),
		).toEqual([]);
	});
});

describe("the So sánh definition", () => {
	it("defaults to 28 days, allows 400, orders its three cards and joins the theme registry", () => {
		expect(storesTheme.kind).toBe("stores");
		expect(storesTheme.slug).toBe("so-sanh");
		expect(storesTheme.defaultPreset).toBe("28d");
		expect(storesTheme.maxRangeDays).toBe(MAX_THEME_RANGE_DAYS);
		expect(storesTheme.params).toEqual([]);
		expect(storesTheme.cards.map((card) => card.id)).toEqual([
			"kpis",
			"same_day",
			"since_opening",
		]);
		expect(themeDefinitions.stores).toBe(storesTheme);
		expect(
			storesTheme.cards.find((card) => card.id === "since_opening")?.needs,
		).toEqual(["coverage", "since.*"]);
		expect(storesTheme.cards.find((card) => card.id === "kpis")?.needs).toEqual(
			["coverage", "totals", "totalsLfl.previous", "productivity"],
		);
	});
});
