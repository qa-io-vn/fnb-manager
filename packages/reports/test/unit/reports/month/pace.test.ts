import { describe, expect, it } from "vitest";
import {
	type CallSpec,
	coverageModel,
	periodContaining,
	reportKeys,
} from "../../../../src/index.js";
import {
	buildMonthPaceCard,
	COVERED_PACE_NEEDS,
	coveredPaceKey,
	forecastOrder,
	leadingForecast,
	monthCalls,
	monthCards,
	monthFollowUpCalls,
	monthKeys,
	monthPrimaryCalls,
	monthRanges,
	STORE_PACE_NEEDS,
} from "../../../../src/reports/month/index.js";
import { context, coverageRow } from "../../fixtures.js";
import {
	accuracyRows,
	dayRow,
	monthBlock,
	monthInput,
	PREVIOUS_START,
	paceRow,
	STORE_A,
	STORE_B,
	seriesRow,
	youngAtPreviousMonth,
} from "./fixtures.js";

function argsOf(calls: readonly CallSpec[], key: string) {
	return calls.find((spec) => spec.key === key)?.args as
		| Readonly<Record<string, unknown>>
		| undefined;
}

const previousMonth = (net: number, storeId: string | null = null) =>
	seriesRow(storeId, PREVIOUS_START, "2026-10-31", { net_amount: net });

describe("Tháng forecast order", () => {
	it("puts the forecast with the lower MAE first", () => {
		expect(forecastOrder(accuracyRows(900_000, 800_000))).toEqual([
			"forecast_seasonal_naive",
			"forecast_weekday_profile",
		]);
		expect(forecastOrder(accuracyRows(700_000, 800_000))).toEqual([
			"forecast_weekday_profile",
			"forecast_seasonal_naive",
		]);
	});

	it("keeps the weekday profile first on a tie and without a score", () => {
		expect(forecastOrder(accuracyRows(800_000, 800_000))).toEqual([
			"forecast_weekday_profile",
			"forecast_seasonal_naive",
		]);
		expect(forecastOrder(accuracyRows(null, null, 0))).toEqual([
			"forecast_weekday_profile",
			"forecast_seasonal_naive",
		]);
		expect(forecastOrder([])).toEqual([
			"forecast_weekday_profile",
			"forecast_seasonal_naive",
		]);
	});

	it("leads with the first forecast that has a value", () => {
		const pace = paceRow({ forecast_seasonal_naive_net_amount: null });
		expect(leadingForecast(accuracyRows(900_000, 800_000), pace)).toEqual({
			method: "forecast_weekday_profile",
			value: 50_000_000,
		});
	});
});

describe("Tháng periods", () => {
	it("compares the same elapsed days of the previous month, clipped to its end", () => {
		const march = context("month", "2026-03-31", [STORE_A], {
			asOf: "2026-04-05",
		});
		const ranges = monthRanges(march);
		expect(ranges).toMatchObject({
			monthStart: "2026-03-01",
			end: "2026-03-31",
			previousStart: "2026-02-01",
			previousEnd: "2026-02-28",
			previousMonthEnd: "2026-02-28",
			lastYearStart: "2025-03-01",
			lastYearEnd: "2025-03-31",
		});
		const calls = monthPrimaryCalls(march);
		expect(argsOf(calls, monthCalls.items)).toMatchObject({
			compare_from: "2026-02-01",
			compare_to: "2026-02-28",
		});
		expect(argsOf(calls, monthCalls.shiftsPrevious)).toMatchObject({
			from_date: "2026-02-01",
			to_date: "2026-02-28",
		});
		expect(argsOf(calls, monthCalls.months)).toMatchObject({
			grain: "month",
			from_date: "2026-02-01",
			to_date: "2026-03-31",
		});
	});

	it("covers the same elapsed days of a running month", () => {
		const ranges = monthRanges(context("month", "2026-11-03", [STORE_A]));
		expect(ranges.previousEnd).toBe("2026-10-03");
		expect(ranges.lastYearEnd).toBe("2025-11-03");
		expect(ranges.monthEnd).toBe("2026-11-30");
	});
});

describe("Tháng month pace", () => {
	it("compares month to date with last month and orders the two forecasts by MAE", () => {
		const card = buildMonthPaceCard(
			monthInput({
				months: [previousMonth(48_000_000), dayRow("2026-11-01", 1)],
				days: [
					dayRow("2026-11-01", 1_500_000),
					dayRow("2026-11-02", 2_000_000),
					dayRow("2026-11-03", 1_500_000),
				],
			}),
		);
		expect(card.headline).toMatchObject({ value: 5_000_000, unit: "money" });
		expect(card.metricId).toBe("net_revenue");
		expect(card.comparisons.map((entry) => entry.kind)).toEqual([
			"previous",
			"last_year",
			"forecast",
			"forecast",
		]);
		const [, , first, second] = card.comparisons;
		expect(first?.label.key).toBe(reportKeys.compare.forecast.seasonalNaive);
		expect(first?.current).toBe(52_000_000);
		expect(first?.reference).toBe(48_000_000);
		expect(first?.change).toBeCloseTo(4_000_000 / 48_000_000, 10);
		expect(second?.label.key).toBe(reportKeys.compare.forecast.weekdayProfile);
		expect(card.narrative[0]?.key).toBe(monthKeys.pace.up);
		expect(card.narrative.at(-1)?.key).toBe(monthKeys.pace.forecast);
		expect(card.narrative.at(-1)?.values.method).toEqual({
			kind: "message",
			value: reportKeys.compare.forecast.seasonalNaive,
		});
		const table = card.tables[0];
		expect(table?.rows.map((row) => row.id)).toEqual([
			"month_to_date",
			"previous_same_days",
			"last_year_same_days",
			"previous_month",
			"forecast_seasonal_naive",
			"forecast_weekday_profile",
		]);
		expect(table?.rows[4]?.cells).toMatchObject({
			value: 52_000_000,
			mae: 800_000,
			mape: 0.06,
			sampleDays: 28,
		});
		expect(card.decomposition).toMatchObject({
			metric: "net_revenue",
			against: "previous",
			total: 1_000_000,
		});
		expect(card.notice).toBeNull();
	});

	it("draws the cumulative net up to the as-of day with a line per forecast and the target", () => {
		const card = buildMonthPaceCard(
			monthInput({
				days: [
					dayRow("2026-11-01", 1_500_000),
					dayRow("2026-11-02", null),
					dayRow("2026-11-03", 2_000_000.5),
				],
				targets: [
					{ store_id: STORE_A, net_target_amount: 30_000_000 },
					{ store_id: STORE_B, net_target_amount: 20_000_000 },
				],
			}),
		);
		const values = card.chart?.series[0]?.values ?? [];
		expect(values).toHaveLength(30);
		expect(values.slice(0, 4)).toEqual([
			1_500_000,
			1_500_000,
			3_500_000.5,
			null,
		]);
		expect(card.chart?.markLines.map((line) => line.value)).toEqual([
			52_000_000, 50_000_000, 50_000_000,
		]);
		expect(card.chart?.markLines[2]?.label.key).toBe(monthKeys.pace.targetLine);
		expect(card.tables[0]?.rows.at(-1)).toMatchObject({
			id: "target",
			cells: { value: 50_000_000 },
		});
	});

	it("closes a complete month without forecasts", () => {
		const october = { date: "2026-10-31" };
		const card = buildMonthPaceCard(
			monthInput({
				...october,
				compare: [
					...monthBlock(
						null,
						{ current: { net_amount: 150_000_000 } },
						{
							current: ["2026-10-01", "2026-10-31"],
							previous: ["2026-09-01", "2026-09-30"],
							lastYear: ["2025-10-01", "2025-10-31"],
						},
					),
				],
				pace: [
					paceRow({
						period_start: "2026-10-01",
						as_of_date: "2026-10-31",
						elapsed_days: 31,
						remaining_days: 0,
						month_to_date_net_amount: 150_000_000,
						forecast_weekday_profile_net_amount: 150_000_000,
						forecast_seasonal_naive_net_amount: 150_000_000,
					}),
				],
			}),
		);
		expect(card.comparisons.map((entry) => entry.kind)).toEqual([
			"previous",
			"last_year",
		]);
		expect(card.narrative.map((entry) => entry.key)).toEqual([
			monthKeys.pace.closed,
			monthKeys.pace.closedUp,
			reportKeys.clause.decomposition.avg_item_price,
		]);
		expect(
			card.narrative.some((entry) => entry.key === monthKeys.pace.forecast),
		).toBe(false);
		expect(card.tables[0]?.columns.map((entry) => entry.key)).toEqual([
			"row",
			"from",
			"to",
			"value",
		]);
		expect(card.tables[0]?.rows.map((row) => row.id)).not.toContain(
			"forecast_weekday_profile",
		);
		expect(card.chart?.markLines).toEqual([]);
	});

	it("shows a notice when neither forecast can be made", () => {
		const card = buildMonthPaceCard(
			monthInput({
				pace: [
					paceRow({
						forecast_weekday_profile_net_amount: null,
						forecast_seasonal_naive_net_amount: null,
					}),
				],
			}),
		);
		expect(card.notice?.part.key).toBe(monthKeys.pace.noForecast);
		const forecasts = card.comparisons.filter(
			(entry) => entry.kind === "forecast",
		);
		expect(forecasts.map((entry) => entry.unavailable)).toEqual([
			"building_baseline",
			"building_baseline",
		]);
		expect(
			card.narrative.some((entry) => entry.key === monthKeys.pace.forecast),
		).toBe(false);
	});

	it("compares the forecasts like for like when a store opened in the previous month", () => {
		const card = buildMonthPaceCard(
			monthInput({
				coverage: youngAtPreviousMonth(),
				months: [
					previousMonth(40_000_000),
					previousMonth(36_000_000, STORE_A),
					previousMonth(4_000_000, STORE_B),
				],
				storePace: {
					[STORE_A]: paceRow({
						forecast_weekday_profile_net_amount: 38_000_000,
						forecast_seasonal_naive_net_amount: 39_600_000,
					}),
					[STORE_B]: paceRow({
						forecast_weekday_profile_net_amount: 12_000_000,
						forecast_seasonal_naive_net_amount: 12_400_000,
					}),
				},
			}),
		);
		const forecast = card.comparisons.find(
			(entry) => entry.kind === "forecast",
		);
		expect(forecast).toMatchObject({
			basis: "like_for_like",
			current: 39_600_000,
			reference: 36_000_000,
			coveredStores: 1,
			totalStores: 2,
		});
		expect(forecast?.label.key).toBe(reportKeys.compare.likeForLike);
		expect(card.narrative.at(-1)?.key).toBe(monthKeys.pace.forecastOnly);
	});

	it("waits for per-store pace calls only when the previous month is partly covered", () => {
		const report = monthInput().context;
		const covered = (coverage: ReturnType<typeof youngAtPreviousMonth>) =>
			monthFollowUpCalls(report, coverageModel(coverage, report)).filter(
				(spec) => spec.key.startsWith("paceCovered."),
			);
		expect(covered([coverageRow(STORE_A), coverageRow(STORE_B)])).toEqual([]);
		expect(covered(youngAtPreviousMonth())).toEqual([
			{
				key: coveredPaceKey(STORE_A),
				name: "month_pace",
				args: {
					store_ids: [STORE_A],
					month_start: "2026-11-01",
					as_of: "2026-11-03",
				},
			},
		]);
		const needs = monthCards.find((card) => card.id === "month_pace")?.needs;
		expect(needs).toContain(COVERED_PACE_NEEDS);
		expect(needs).not.toContain(STORE_PACE_NEEDS);
	});

	it("says the store is too young when no selected store had the previous month", () => {
		const card = buildMonthPaceCard(
			monthInput({
				stores: [STORE_B],
				coverage: [coverageRow(STORE_B, { history_start: "2026-10-20" })],
				compare: monthBlock(null),
				months: [previousMonth(4_000_000)],
			}),
		);
		const forecasts = card.comparisons.filter(
			(entry) => entry.kind === "forecast",
		);
		expect(forecasts.map((entry) => entry.unavailable)).toEqual([
			"store_too_young",
			"store_too_young",
		]);
	});

	it("names the young store and the month when there is no data", () => {
		const empty = buildMonthPaceCard(
			monthInput({
				compare: monthBlock(null, {
					current: { days_with_data: 0, net_amount: null },
				}),
			}),
		);
		expect(empty.headline.value).toBeNull();
		expect(empty.chart).toBeNull();
		expect(empty.narrative[0]?.key).toBe(monthKeys.pace.noData);
		const young = buildMonthPaceCard(
			monthInput({ coverage: youngAtPreviousMonth("2026-03-02") }),
		);
		expect(young.narrative[1]?.key).toBe(reportKeys.clause.coverage.youngStore);
		expect(young.comparisons[1]?.basis).toBe("like_for_like");
	});
});

describe("Tháng calls", () => {
	it("plans one month_pace per store only when several stores are selected", () => {
		const both = monthPrimaryCalls(context("month", "2026-11-03"));
		const keys = both.map((spec) => spec.key);
		expect(new Set(keys).size).toBe(keys.length);
		expect(keys).toEqual(
			expect.arrayContaining([
				"coverage",
				"compare",
				"pace",
				"accuracy",
				"days",
				"months",
				"baselines",
				"items",
				"metrics",
				"payments",
				"promotions",
				"shifts",
				"shiftsPrevious",
				"targets",
				`pace.${STORE_A}`,
				`pace.${STORE_B}`,
			]),
		);
		expect(argsOf(both, `pace.${STORE_B}`)).toEqual({
			store_ids: [STORE_B],
			month_start: "2026-11-01",
			as_of: "2026-11-03",
		});
		expect(argsOf(both, monthCalls.accuracy)).toEqual({
			store_ids: [STORE_A, STORE_B],
			as_of_date: "2026-11-03",
			days: 28,
		});
		const one = monthPrimaryCalls(context("month", "2026-11-03", [STORE_A]));
		expect(one.some((spec) => spec.key.startsWith("pace."))).toBe(false);
		expect(one).toHaveLength(14);
	});

	it("stops a future month at the as-of day", () => {
		const period = periodContaining("month", "2026-11-03", "2026-11-03");
		expect(period.end).toBe("2026-11-03");
		expect(period.complete).toBe(false);
	});
});
