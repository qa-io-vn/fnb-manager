import { describe, expect, it } from "vitest";
import { coverageModel } from "../../../../src/model/coverage.js";
import { TOTALS_LIKE_FOR_LIKE_KEYS } from "../../../../src/themes/definition.js";
import { revenueTheme } from "../../../../src/themes/revenue/definition.js";
import {
	DAY_SERIES_MAX_DAYS,
	revenueCalls,
	revenueFollowUpCalls,
	revenuePrimaryCalls,
	trendGrain,
	trendPlan,
} from "../../../../src/themes/revenue/support.js";
import { coverageRow, STORE_A, STORE_B } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";

function plannedCalls(context: ReturnType<typeof themeContext>) {
	return new Map(revenuePrimaryCalls(context).map((call) => [call.key, call]));
}

describe("the Doanh thu calls", () => {
	it("asks for coverage, three ranges of totals and day series that start six days early over 28 days", () => {
		const context = themeContext("28d", [STORE_A, STORE_B]);
		const calls = plannedCalls(context);
		expect([...calls.keys()]).toEqual([
			revenueCalls.coverage,
			revenueCalls.totals,
			revenueCalls.series,
			revenueCalls.seriesLastYear,
		]);
		expect(calls.get(revenueCalls.coverage)?.args).toEqual({
			store_ids: [STORE_A, STORE_B],
			from_date: "2026-10-10",
			to_date: "2026-11-06",
		});
		expect(calls.get(revenueCalls.totals)).toEqual({
			key: "totals",
			name: "range_totals",
			args: {
				store_ids: [STORE_A, STORE_B],
				from_dates: ["2026-10-10", "2026-09-12", "2025-10-11"],
				to_dates: ["2026-11-06", "2026-10-09", "2025-11-07"],
			},
		});
		expect(calls.get(revenueCalls.series)).toEqual({
			key: "series",
			name: "period_series",
			args: {
				store_ids: [STORE_A, STORE_B],
				grain: "day",
				from_date: "2026-10-04",
				to_date: "2026-11-06",
				include_stores: false,
			},
		});
		expect(calls.get(revenueCalls.seriesLastYear)?.args).toEqual({
			store_ids: [STORE_A, STORE_B],
			grain: "day",
			from_date: "2025-10-05",
			to_date: "2025-11-07",
			include_stores: false,
		});
	});

	it("keeps 91 days by day and adds the month series of both years", () => {
		const context = themeContext("91d", [STORE_A]);
		const calls = plannedCalls(context);
		expect([...calls.keys()]).toEqual([
			revenueCalls.coverage,
			revenueCalls.totals,
			revenueCalls.series,
			revenueCalls.seriesLastYear,
			revenueCalls.months,
			revenueCalls.monthsLastYear,
		]);
		expect(calls.get(revenueCalls.series)?.args).toMatchObject({
			grain: "day",
			from_date: "2026-08-02",
			to_date: "2026-11-06",
		});
		expect(calls.get(revenueCalls.months)?.args).toEqual({
			store_ids: [STORE_A],
			grain: "month",
			from_date: "2026-08-08",
			to_date: "2026-11-06",
			include_stores: true,
		});
		expect(calls.get(revenueCalls.monthsLastYear)?.args).toEqual({
			store_ids: [STORE_A],
			grain: "month",
			from_date: "2025-08-08",
			to_date: "2025-11-06",
			include_stores: true,
		});
	});

	it("switches 364 days to weeks from three Mondays before the range's first week, with two ranges and no last-year series", () => {
		const context = themeContext("364d", [STORE_A]);
		const calls = plannedCalls(context);
		expect([...calls.keys()]).toEqual([
			revenueCalls.coverage,
			revenueCalls.totals,
			revenueCalls.series,
			revenueCalls.months,
			revenueCalls.monthsLastYear,
		]);
		expect(calls.get(revenueCalls.totals)?.args).toEqual({
			store_ids: [STORE_A],
			from_dates: ["2025-11-08", "2024-11-09"],
			to_dates: ["2026-11-06", "2025-11-07"],
		});
		expect(calls.get(revenueCalls.series)?.args).toEqual({
			store_ids: [STORE_A],
			grain: "week",
			from_date: "2025-10-13",
			to_date: "2026-11-06",
			include_stores: false,
		});
	});

	it("leaves out the month series under 56 days", () => {
		const keys = [...plannedCalls(themeContext("7d", [STORE_A])).keys()];
		expect(keys).not.toContain(revenueCalls.months);
		expect(keys).not.toContain(revenueCalls.monthsLastYear);
	});

	it("adds like-for-like totals only for the references that some stores lack", () => {
		const context = themeContext("28d", [STORE_A, STORE_B]);
		const full = coverageModel(
			[coverageRow(STORE_A), coverageRow(STORE_B)],
			context,
		);
		expect(revenueFollowUpCalls(context, full)).toEqual([]);
		const youngThisRange = coverageModel(
			[
				coverageRow(STORE_A),
				coverageRow(STORE_B, { history_start: "2026-10-10" }),
			],
			context,
		);
		expect(revenueFollowUpCalls(context, youngThisRange)).toEqual([
			{
				key: TOTALS_LIKE_FOR_LIKE_KEYS.previous,
				name: "range_totals",
				args: {
					store_ids: [STORE_A],
					from_dates: ["2026-10-10", "2026-09-12"],
					to_dates: ["2026-11-06", "2026-10-09"],
				},
			},
			{
				key: TOTALS_LIKE_FOR_LIKE_KEYS.last_year,
				name: "range_totals",
				args: {
					store_ids: [STORE_A],
					from_dates: ["2026-10-10", "2025-10-11"],
					to_dates: ["2026-11-06", "2025-11-07"],
				},
			},
		]);
		const youngThisYear = coverageModel(
			[
				coverageRow(STORE_A),
				coverageRow(STORE_B, { history_start: "2026-01-01" }),
			],
			context,
		);
		expect(
			revenueFollowUpCalls(context, youngThisYear).map((call) => call.key),
		).toEqual([TOTALS_LIKE_FOR_LIKE_KEYS.last_year]);
	});

	it("plans no like-for-like totals when no selected store has the references", () => {
		const context = themeContext("28d", [STORE_A]);
		const none = coverageModel(
			[coverageRow(STORE_A, { history_start: "2026-10-10" })],
			context,
		);
		expect(revenueFollowUpCalls(context, none)).toEqual([]);
	});
});

describe("the Doanh thu trend grain", () => {
	it("keeps days up to 92 and switches to weeks from 93", () => {
		expect(DAY_SERIES_MAX_DAYS).toBe(92);
		expect(trendGrain(1)).toBe("day");
		expect(trendGrain(92)).toBe("day");
		expect(trendGrain(93)).toBe("week");
		expect(trendGrain(400)).toBe("week");
	});

	it("starts a day series six days early for a full 7-day average", () => {
		expect(trendPlan({ from: "2026-10-10", to: "2026-11-06" }, 28)).toEqual({
			grain: "day",
			points: 7,
			from: "2026-10-04",
			to: "2026-11-06",
		});
	});

	it("starts a week series three weeks before the Monday of the first day for a full 4-week average", () => {
		expect(trendPlan({ from: "2026-08-01", to: "2026-11-06" }, 98)).toEqual({
			grain: "week",
			points: 4,
			from: "2026-07-06",
			to: "2026-11-06",
		});
		expect(trendPlan({ from: "2026-07-27", to: "2026-11-06" }, 103)).toEqual({
			grain: "week",
			points: 4,
			from: "2026-07-06",
			to: "2026-11-06",
		});
	});
});

describe("the Doanh thu definition", () => {
	it("defaults to 28 days, allows 400 and orders its cards", () => {
		expect(revenueTheme.defaultPreset).toBe("28d");
		expect(revenueTheme.maxRangeDays).toBe(400);
		expect(revenueTheme.cards.map((card) => card.id)).toEqual([
			"net_revenue",
			"trend",
			"invoices",
			"avg_ticket",
			"by_month",
			"store_share",
		]);
	});

	it("shows the month card from 56 days and the store share only with two stores", () => {
		const visibleIds = (context: ReturnType<typeof themeContext>) =>
			revenueTheme.cards
				.filter((card) =>
					card.visible({ context, coverage: coverageModel([], context) }),
				)
				.map((card) => card.id);
		expect(visibleIds(themeContext("28d", [STORE_A]))).toEqual([
			"net_revenue",
			"trend",
			"invoices",
			"avg_ticket",
		]);
		expect(visibleIds(themeContext("91d", [STORE_A, STORE_B]))).toEqual([
			"net_revenue",
			"trend",
			"invoices",
			"avg_ticket",
			"by_month",
			"store_share",
		]);
	});
});
