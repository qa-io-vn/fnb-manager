import { describe, expect, it } from "vitest";
import { reportKeys } from "../../../../src/model/keys.js";
import {
	buildTrendCard,
	movingAverages,
} from "../../../../src/themes/revenue/cards/trend.js";
import { revenueKeys } from "../../../../src/themes/revenue/keys.js";
import { revenueCalls } from "../../../../src/themes/revenue/support.js";
import { rangeValue } from "../../../../src/themes/support.js";
import { coverageRow, STORE_A } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import { cardInput, dayRows, totalsRow, weekRows } from "./support.js";

const M = 1_000_000;
const RANGE_DAYS = [
	"2026-10-31",
	"2026-11-01",
	"2026-11-02",
	"2026-11-03",
	"2026-11-04",
	"2026-11-05",
	"2026-11-06",
];
const RISING = [7, 7, 7, 7, 7, 7, 7, 14, 14, 14, 14, 14, 14].map(
	(net) => net * M,
);
const FALLING = [14, 14, 14, 14, 14, 14, 14, 7, 7, 7, 7, 7, 7].map(
	(net) => net * M,
);

function weekContext() {
	return themeContext("7d", [STORE_A]);
}

describe("the Doanh thu trend card", () => {
	it("reads net per day with data, rises from the first to the last 7-day average and lines up last year", () => {
		const context = weekContext();
		const card = buildTrendCard(
			cardInput(
				context,
				{
					[revenueCalls.series]: dayRows("2026-10-25", RISING),
					[revenueCalls.seriesLastYear]: dayRows(
						"2025-10-26",
						Array.from({ length: 13 }, () => 10 * M),
					),
					[revenueCalls.totals]: [
						totalsRow(context, "current", null, {
							net_amount: 91 * M,
							days_with_data: 7,
						}),
					],
				},
				[coverageRow(STORE_A)],
			),
		);
		expect(card.headline).toEqual({
			value: 13 * M,
			unit: "money",
			caption: {
				key: revenueKeys.trend.caption,
				values: { points: { kind: "count", value: 7 } },
			},
		});
		expect(card.comparisons).toEqual([]);
		expect(card.narrative).toEqual([
			{
				key: revenueKeys.trend.rising,
				values: {
					range: rangeValue(context),
					from: { kind: "money", value: 7 * M },
					to: { kind: "money", value: 13 * M },
					delta: { kind: "percent", value: 6 / 7 },
				},
			},
		]);
		const table = card.tables[0];
		expect(table?.captionKey).toBe(revenueKeys.trend.table);
		expect(table?.columns).toEqual([
			{ key: "date", labelKey: reportKeys.table.date, kind: "date" },
			{ key: "net", labelKey: reportKeys.table.netAmount, kind: "money" },
			{
				key: "average",
				labelKey: revenueKeys.trend.movingAverage,
				kind: "money",
			},
			{
				key: "lastYearAverage",
				labelKey: revenueKeys.trend.lastYearAverage,
				kind: "money",
			},
			{
				key: "change",
				labelKey: revenueKeys.table.changeLastYear,
				kind: "signedPercent",
			},
		]);
		expect(table?.rows.map((row) => row.id)).toEqual(RANGE_DAYS);
		expect(table?.rows.map((row) => row.cells.net)).toEqual([
			7 * M,
			14 * M,
			14 * M,
			14 * M,
			14 * M,
			14 * M,
			14 * M,
		]);
		expect(table?.rows.map((row) => row.cells.average)).toEqual([
			7 * M,
			8 * M,
			9 * M,
			10 * M,
			11 * M,
			12 * M,
			13 * M,
		]);
		expect(table?.rows.map((row) => row.cells.lastYearAverage)).toEqual(
			Array.from({ length: 7 }, () => 10 * M),
		);
		expect(table?.rows.map((row) => row.cells.change)).toEqual([
			-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3,
		]);
		const chart = card.chart;
		expect(chart?.labelKey).toBe(revenueKeys.trend.chart);
		expect(chart?.categories).toEqual(
			RANGE_DAYS.map((date) => ({ kind: "date", value: date })),
		);
		expect(
			chart?.series.map((series) => [
				series.label.key,
				series.kind,
				series.tone,
			]),
		).toEqual([
			[revenueKeys.trend.netSeries, "bar", "primary"],
			[revenueKeys.trend.movingAverage, "line", "secondary"],
			[revenueKeys.trend.lastYearAverage, "line", "muted"],
		]);
		expect(chart?.series[1]?.values).toEqual([
			7 * M,
			8 * M,
			9 * M,
			10 * M,
			11 * M,
			12 * M,
			13 * M,
		]);
		expect(chart?.markAreas).toEqual([]);
		expect(card.notice).toBeNull();
		expect(card.csvName).toBe("doanh-thu-trend-2026-10-31_2026-11-06");
	});

	it("marks each run of Tết days inside the range and adds the Tết note", () => {
		const tetDays = new Set([
			"2026-10-28",
			"2026-11-02",
			"2026-11-03",
			"2026-11-05",
		]);
		const card = buildTrendCard(
			cardInput(weekContext(), {
				[revenueCalls.series]: dayRows("2026-10-25", RISING, (date) =>
					tetDays.has(date) ? { holiday_kind: "tet" } : {},
				),
			}),
		);
		expect(card.chart?.markAreas).toEqual([
			{
				label: { key: reportKeys.holiday.tet, values: {} },
				fromIndex: 2,
				toIndex: 3,
			},
			{
				label: { key: reportKeys.holiday.tet, values: {} },
				fromIndex: 5,
				toIndex: 5,
			},
		]);
		expect(card.narrative.map((part) => part.key)).toEqual([
			revenueKeys.trend.rising,
			revenueKeys.trend.tetNote,
		]);
	});

	it("says falling when the last average is lower and steady when it has not moved", () => {
		const falling = buildTrendCard(
			cardInput(weekContext(), {
				[revenueCalls.series]: dayRows("2026-10-25", FALLING),
			}),
		);
		expect(falling.narrative[0]?.key).toBe(revenueKeys.trend.falling);
		expect(falling.narrative[0]?.values.from).toEqual({
			kind: "money",
			value: 14 * M,
		});
		expect(falling.narrative[0]?.values.to).toEqual({
			kind: "money",
			value: 8 * M,
		});
		expect(falling.narrative[0]?.values.delta).toEqual({
			kind: "percent",
			value: 3 / 7,
		});
		const steady = buildTrendCard(
			cardInput(weekContext(), {
				[revenueCalls.series]: dayRows(
					"2026-10-25",
					Array.from({ length: 13 }, () => 9 * M),
				),
			}),
		);
		expect(steady.narrative[0]?.key).toBe(revenueKeys.trend.steady);
		expect(steady.narrative[0]?.values.delta).toEqual({
			kind: "percent",
			value: 0,
		});
	});

	it("leaves a day without data out of the bars and out of the average's divisor", () => {
		const card = buildTrendCard(
			cardInput(weekContext(), {
				[revenueCalls.series]: dayRows(
					"2026-10-25",
					Array.from({ length: 13 }, () => 7 * M),
					(date) =>
						date === "2026-11-03" ? { days_with_data: 0, net_amount: 0 } : {},
				),
			}),
		);
		const rows = card.tables[0]?.rows ?? [];
		expect(rows.map((row) => row.cells.net)).toEqual([
			7 * M,
			7 * M,
			7 * M,
			null,
			7 * M,
			7 * M,
			7 * M,
		]);
		expect(rows.map((row) => row.cells.average)).toEqual(
			Array.from({ length: 7 }, () => 7 * M),
		);
		expect(card.chart?.series[0]?.values[3]).toBeNull();
		expect(card.chart?.series).toHaveLength(3);
		expect(rows[0]?.cells.lastYearAverage).toBeNull();
	});

	it("tells that the average needs more points when the series is shorter than its window", () => {
		const context = weekContext();
		const card = buildTrendCard(
			cardInput(context, {
				[revenueCalls.series]: dayRows("2026-11-03", [
					5 * M,
					6 * M,
					7 * M,
					8 * M,
				]),
			}),
		);
		expect(card.notice).toEqual({
			tone: "info",
			part: {
				key: revenueKeys.trend.short,
				values: { points: { kind: "count", value: 7 } },
			},
			action: null,
		});
		expect(card.narrative).toEqual([
			{ key: revenueKeys.trend.noData, values: { range: rangeValue(context) } },
		]);
		expect(card.tables[0]?.rows.map((row) => row.cells.average)).toEqual([
			null,
			null,
			null,
			null,
		]);
		expect(card.chart?.series[0]?.values).toEqual([5 * M, 6 * M, 7 * M, 8 * M]);
	});

	it("draws nothing and says nothing without a series", () => {
		const card = buildTrendCard(cardInput(weekContext(), {}));
		expect(card.headline.value).toBeNull();
		expect(card.narrative).toEqual([]);
		expect(card.chart).toBeNull();
		expect(card.notice).toBeNull();
		expect(card.tables[0]?.rows).toEqual([]);
	});

	it("keeps the headline empty when the range had no day with data", () => {
		const context = weekContext();
		const card = buildTrendCard(
			cardInput(context, {
				[revenueCalls.totals]: [
					totalsRow(context, "current", null, {
						net_amount: 0,
						days_with_data: 0,
					}),
				],
			}),
		);
		expect(card.headline.value).toBeNull();
	});

	it("switches a long range to weeks with a 4-week average, starting at the week that holds the first day", () => {
		const context = themeContext("364d", [STORE_A]);
		const card = buildTrendCard(
			cardInput(context, {
				[revenueCalls.series]: weekRows(
					"2025-10-13",
					[4, 8, 12, 16, 20, 24].map((net) => net * M),
					(start) => (start === "2025-11-10" ? { tet_days: 2 } : {}),
				),
				[revenueCalls.totals]: [
					totalsRow(context, "current", null, {
						net_amount: 3640 * M,
						days_with_data: 364,
					}),
				],
			}),
		);
		expect(card.headline).toEqual({
			value: 10 * M,
			unit: "money",
			caption: {
				key: revenueKeys.trend.caption,
				values: { points: { kind: "count", value: 4 } },
			},
		});
		const table = card.tables[0];
		expect(table?.columns.map((column) => column.key)).toEqual([
			"date",
			"net",
			"average",
		]);
		expect(table?.columns[0]?.labelKey).toBe(revenueKeys.table.week);
		expect(table?.rows.map((row) => row.id)).toEqual([
			"2025-11-03",
			"2025-11-10",
			"2025-11-17",
		]);
		expect(table?.rows.map((row) => row.cells.average)).toEqual([
			10 * M,
			14 * M,
			18 * M,
		]);
		expect(card.chart?.series.map((series) => series.label.key)).toEqual([
			revenueKeys.trend.netSeries,
			revenueKeys.trend.movingAverage,
		]);
		expect(card.chart?.markAreas).toEqual([
			{
				label: { key: reportKeys.holiday.tet, values: {} },
				fromIndex: 1,
				toIndex: 1,
			},
		]);
		expect(card.narrative.map((part) => part.key)).toEqual([
			revenueKeys.trend.rising,
			revenueKeys.trend.tetNote,
		]);
		expect(card.narrative[0]?.values.delta).toEqual({
			kind: "percent",
			value: 0.8,
		});
		expect(card.notice).toBeNull();
	});
});

describe("the Doanh thu moving average", () => {
	it("averages the last points with data and stays empty until the window is full", () => {
		const rows = dayRows("2026-11-01", [3 * M, 6 * M, 9 * M, 12 * M], (date) =>
			date === "2026-11-03" ? { days_with_data: 0, net_amount: 0 } : {},
		);
		expect(movingAverages(rows, 3)).toEqual([null, null, 4.5 * M, 9 * M]);
		expect(movingAverages(rows, 5)).toEqual([null, null, null, null]);
	});
});
