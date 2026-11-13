import { describe, expect, it } from "vitest";
import { reportKeys } from "../../../../src/index.js";
import {
	bestAndWorst,
	buildBestWorstDaysCard,
	buildWeekdayCurveCard,
	dayDeviations,
	MIN_COMPARED_DAYS,
	weekKeys,
} from "../../../../src/reports/week/index.js";
import {
	baselineRow,
	type DayPlan,
	RUNNING_WEEK_DAY,
	STORE_A,
	STORE_B,
	weekInput,
	youngStoreCoverage,
} from "./fixtures.js";

const netByDate: Readonly<Record<string, number>> = {
	"2026-10-26": 900_000,
	"2026-10-27": 1_100_000,
	"2026-10-28": 1_000_000,
	"2026-10-29": 1_200_000,
	"2026-10-30": 1_500_000,
	"2026-10-31": 2_000_000,
	"2026-11-01": 1_800_000,
};

const shapedWeek: DayPlan = (_storeId, date) => ({
	net: netByDate[date] ?? 1_000_000,
	invoices: 20,
	items: 30,
});

describe("Tuần weekday curve", () => {
	it("names the strongest weekday and its share of the week", () => {
		const card = buildWeekdayCurveCard(
			weekInput({ stores: [STORE_A], plan: shapedWeek }),
		);
		expect(card.metricId).toBe("weekday_net");
		expect(card.relatedMetricIds).toEqual(["weekday_share"]);
		expect(card.headline.value).toBe(2_000_000);
		expect(card.headline.caption).toEqual({
			key: weekKeys.curve.caption,
			values: {
				weekday: { kind: "weekday", value: "6" },
				date: { kind: "date", value: "2026-10-31" },
			},
		});
		expect(card.narrative[0]?.key).toBe(weekKeys.curve.main);
		expect(card.narrative[0]?.values.share).toEqual({
			kind: "percent",
			value: 0.210526,
		});
		const driver = card.narrative[1];
		expect(driver?.key).toBe(weekKeys.curve.driver);
		expect(driver?.values).toEqual({
			weekday: { kind: "weekday", value: "6" },
			delta: { kind: "moneySigned", value: 1_000_000 },
		});
	});

	it("lists all seven weekdays with last week and the 4-week weekday average", () => {
		const card = buildWeekdayCurveCard(
			weekInput({ stores: [STORE_A], plan: shapedWeek }),
		);
		const table = card.tables[0];
		expect(table?.columns.map((entry) => entry.key)).toEqual([
			"weekday",
			"date",
			"net",
			"share",
			"lastWeek",
			"changeLastWeek",
			"average",
			"changeAverage",
		]);
		expect(table?.rows).toHaveLength(7);
		expect(table?.rows[5]?.cells).toEqual({
			weekday: 6,
			date: "2026-10-31",
			net: 2_000_000,
			share: 0.210526,
			lastWeek: 1_000_000,
			changeLastWeek: 1,
			average: 1_000_000,
			changeAverage: 1,
		});
		const shares = table?.rows.map((row) => Number(row.cells.share)) ?? [];
		expect(shares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 5);
		expect(card.chart?.series.map((series) => series.kind)).toEqual([
			"bar",
			"line",
			"line",
		]);
		expect(card.chart?.categories).toHaveLength(7);
		expect(card.csvName).toBe("tuan-weekday-curve-2026-W44");
	});

	it("leaves the days after the as-of day as gaps", () => {
		const card = buildWeekdayCurveCard(
			weekInput({ date: RUNNING_WEEK_DAY, stores: [STORE_A] }),
		);
		const bars = card.chart?.series[0]?.values ?? [];
		expect(bars).toEqual([1_000_000, 1_000_000, null, null, null, null, null]);
		expect(card.chart?.series[1]?.values.every((value) => value !== null)).toBe(
			true,
		);
		expect(card.chart?.series[2]?.values.every((value) => value !== null)).toBe(
			true,
		);
		expect(card.tables[0]?.rows[6]?.cells.net).toBeNull();
	});

	it("marks the average as like for like when a store opened within four weeks", () => {
		const plan: DayPlan = (storeId, date) =>
			storeId === STORE_B && date < "2026-10-12"
				? null
				: {
						net: storeId === STORE_A ? 1_000_000 : 500_000,
						invoices: 10,
						items: 12,
					};
		const card = buildWeekdayCurveCard(
			weekInput({ coverage: youngStoreCoverage("2026-10-12"), plan }),
		);
		expect(card.tables[0]?.columns[6]?.labelKey).toBe(
			weekKeys.table.weekdayAverageLikeForLike,
		);
		expect(card.chart?.series[2]?.label.key).toBe(
			weekKeys.curve.averageSeriesLikeForLike,
		);
		expect(card.tables[0]?.rows[0]?.cells.changeAverage).toBe(0);
		expect(card.tables[0]?.rows[0]?.cells.net).toBe(1_500_000);
	});

	it("shows no data with a notice when the week has no sales", () => {
		const card = buildWeekdayCurveCard(
			weekInput({ stores: [STORE_A], plan: () => null }),
		);
		expect(card.headline.value).toBeNull();
		expect(card.narrative[0]?.key).toBe(weekKeys.curve.noData);
		expect(card.notice?.part.key).toBe(weekKeys.noDataNotice);
	});
});

const deviationPlan: DayPlan = (_storeId, date) => ({
	net:
		{
			"2026-10-26": 1_200_000,
			"2026-10-27": 900_000,
			"2026-10-28": 1_200_000,
			"2026-10-29": 900_000,
		}[date] ?? 1_000_000,
	invoices: 20,
	items: 30,
});

function baselinesFor(sampleDays: (date: string) => number) {
	return [
		"2026-10-26",
		"2026-10-27",
		"2026-10-28",
		"2026-10-29",
		"2026-10-30",
		"2026-10-31",
		"2026-11-01",
	].map((date) => {
		const days = sampleDays(date);
		return baselineRow(date, days, days === 0 ? null : 1_000_000);
	});
}

describe("Tuần best and worst days", () => {
	it("ranks the days against their median baseline with ties to the earlier date", () => {
		const input = weekInput({
			stores: [STORE_A],
			plan: deviationPlan,
			baselines: baselinesFor(() => 8),
			holidays: { "2026-10-27": "public" },
		});
		const pair = bestAndWorst(dayDeviations(input));
		expect(pair?.best.date).toBe("2026-10-26");
		expect(pair?.worst.date).toBe("2026-10-27");
		const card = buildBestWorstDaysCard(input);
		expect(card.metricId).toBe("net_revenue");
		expect(card.relatedMetricIds).toEqual(["same_weekday_baseline"]);
		expect(card.headline.value).toBeCloseTo(0.2, 10);
		expect(card.headline.unit).toBe("signedFraction");
		expect(card.headline.caption?.values.date).toEqual({
			kind: "date",
			value: "2026-10-26",
		});
		expect(card.narrative[0]?.key).toBe(weekKeys.days.main);
		expect(card.narrative[0]?.values.worstDate).toEqual({
			kind: "date",
			value: "2026-10-27",
		});
		expect(card.narrative[1]).toEqual({
			key: weekKeys.days.holiday,
			values: {
				weekday: { kind: "weekday", value: "2" },
				date: { kind: "date", value: "2026-10-27" },
				holiday: { kind: "message", value: reportKeys.holiday.public },
			},
		});
		const table = card.tables[0];
		expect(table?.columns.map((entry) => entry.key)).toEqual([
			"date",
			"weekday",
			"net",
			"baseline",
			"deviation",
			"holiday",
		]);
		expect(table?.rows[1]?.cells.holiday).toBe(reportKeys.holiday.public);
		const [above, below] = card.chart?.series ?? [];
		expect(above?.tone).toBe("positive");
		expect(below?.tone).toBe("negative");
		expect(above?.values[0]).toBeCloseTo(0.2, 10);
		expect(below?.values[1]).toBeCloseTo(-0.1, 10);
		expect(card.notice).toBeNull();
	});

	it("leaves out days without a baseline or without sales", () => {
		const input = weekInput({
			stores: [STORE_A],
			plan: (_storeId, date) =>
				date === "2026-10-30" ? null : deviationPlan(STORE_A, date),
			baselines: baselinesFor((date) => (date === "2026-10-26" ? 0 : 3)),
		});
		const entries = dayDeviations(input);
		expect(
			entries.find((entry) => entry.date === "2026-10-26")?.deviation,
		).toBeNull();
		expect(
			entries.find((entry) => entry.date === "2026-10-30")?.deviation,
		).toBeNull();
		const pair = bestAndWorst(entries);
		expect(pair?.best.date).toBe("2026-10-28");
		expect(pair?.worst.date).toBe("2026-10-27");
	});

	it("asks for at least two days with a baseline", () => {
		const input = weekInput({
			stores: [STORE_A],
			plan: deviationPlan,
			baselines: baselinesFor((date) => (date === "2026-10-26" ? 8 : 0)),
		});
		const card = buildBestWorstDaysCard(input);
		expect(MIN_COMPARED_DAYS).toBe(2);
		expect(card.headline.value).toBeNull();
		expect(card.notice?.part.key).toBe(weekKeys.days.tooFew);
		expect(card.narrative).toEqual([
			{
				key: weekKeys.days.tooFewSentence,
				values: {
					count: { kind: "count", value: 1 },
					period: { kind: "isoWeek", value: "2026-W44" },
				},
			},
		]);
	});

	it("compares only the elapsed days of a running week", () => {
		const input = weekInput({
			date: RUNNING_WEEK_DAY,
			stores: [STORE_A],
			baselines: [
				baselineRow("2026-11-02", 8, 800_000),
				baselineRow("2026-11-03", 8, 1_250_000),
			],
		});
		const card = buildBestWorstDaysCard(input);
		expect(card.tables[0]?.rows.map((row) => row.id)).toEqual([
			"2026-11-02",
			"2026-11-03",
		]);
		expect(card.headline.value).toBeCloseTo(0.25, 10);
		expect(card.narrative[0]?.values.worstDeviation).toEqual({
			kind: "signedPercent",
			value: -0.2,
		});
	});
});
