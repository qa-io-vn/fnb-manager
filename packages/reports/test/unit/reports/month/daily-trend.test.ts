import { describe, expect, it } from "vitest";
import { reportKeys } from "../../../../src/index.js";
import {
	buildDailyTrendCard,
	monthKeys,
} from "../../../../src/reports/month/index.js";
import { baselineRow, dayRow, monthInput } from "./fixtures.js";

describe("Tháng daily trend", () => {
	it("averages the dates with data and names the best and the weakest day against the baseline", () => {
		const card = buildDailyTrendCard(
			monthInput({
				days: [
					dayRow("2026-11-03", 1_200_000),
					dayRow("2026-11-01", 1_000_000),
					dayRow("2026-11-02", 900_000),
				],
				baselines: [
					baselineRow("2026-11-01", 1_000_000),
					baselineRow("2026-11-02", 1_000_000),
					baselineRow("2026-11-03", 1_000_000),
				],
			}),
		);
		expect(card.metricId).toBe("daily_net");
		expect(card.headline).toMatchObject({ value: 1_033_333.33, unit: "money" });
		expect(card.tables[0]?.rows.map((row) => row.id)).toEqual([
			"2026-11-01",
			"2026-11-02",
			"2026-11-03",
		]);
		expect(card.narrative).toHaveLength(1);
		expect(card.narrative[0]?.key).toBe(monthKeys.days.main);
		expect(card.narrative[0]?.values.best).toEqual({
			kind: "date",
			value: "2026-11-03",
		});
		expect(card.narrative[0]?.values.worst).toEqual({
			kind: "date",
			value: "2026-11-02",
		});
		expect(card.narrative[0]?.values.bestDelta?.value).toBeCloseTo(0.2, 10);
		expect(card.chart?.series.map((series) => series.label.key)).toEqual([
			monthKeys.days.regularDays,
			reportKeys.periodRow.baseline,
		]);
	});

	it("breaks ties in favour of the earlier date", () => {
		const card = buildDailyTrendCard(
			monthInput({
				days: [
					dayRow("2026-11-01", 1_100_000),
					dayRow("2026-11-02", 1_100_000),
					dayRow("2026-11-03", 900_000),
				],
				baselines: [
					baselineRow("2026-11-01", 1_000_000),
					baselineRow("2026-11-02", 1_000_000),
					baselineRow("2026-11-03", 1_000_000),
				],
			}),
		);
		expect(card.narrative[0]?.values.best?.value).toBe("2026-11-01");
	});

	it("marks closed days, mutes holidays and shades the Tết run", () => {
		const card = buildDailyTrendCard(
			monthInput({
				date: "2026-02-28",
				asOf: "2026-03-05",
				days: [
					dayRow("2026-02-15", 1_000_000),
					dayRow("2026-02-16", 600_000, { holiday_kind: "tet" }),
					dayRow("2026-02-17", null, { holiday_kind: "tet", checked_days: 1 }),
					dayRow("2026-02-18", 500_000, { holiday_kind: "tet" }),
					dayRow("2026-02-19", 1_000_000),
					dayRow("2026-02-20", null, { checked_days: 0 }),
				],
				baselines: [
					baselineRow("2026-02-15", 1_000_000),
					baselineRow("2026-02-16", 1_000_000),
					baselineRow("2026-02-18", 1_000_000),
					baselineRow("2026-02-19", 1_000_000, 0),
				],
			}),
		);
		const table = card.tables[0];
		expect(table?.columns.at(-1)?.key).toBe("state");
		const cells = (id: string) =>
			table?.rows.find((row) => row.id === id)?.cells ?? {};
		expect(cells("2026-02-17")).toMatchObject({
			net: null,
			holiday: reportKeys.holiday.tet,
			state: monthKeys.days.closed,
		});
		expect(cells("2026-02-20")).toMatchObject({ net: null, state: null });
		expect(cells("2026-02-19")).toMatchObject({
			baseline: null,
			deviation: null,
		});
		expect(card.chart?.series[1]?.label.key).toBe(monthKeys.days.holidayDays);
		expect(card.chart?.series[0]?.values.slice(0, 4)).toEqual([
			1_000_000,
			null,
			null,
			null,
		]);
		expect(card.chart?.series[1]?.values.slice(0, 4)).toEqual([
			null,
			600_000,
			null,
			500_000,
		]);
		expect(card.chart?.markAreas).toEqual([
			{
				label: { key: reportKeys.holiday.tet, values: {} },
				fromIndex: 1,
				toIndex: 3,
			},
		]);
		expect(card.narrative[0]?.values.worst?.value).toBe("2026-02-18");
		expect(card.narrative[1]?.key).toBe(monthKeys.days.holidayNote);
		expect(card.narrative[1]?.values.holiday).toEqual({
			kind: "message",
			value: reportKeys.holiday.tet,
		});
	});

	it("falls back to the average when fewer than two days have a baseline", () => {
		const card = buildDailyTrendCard(
			monthInput({
				days: [dayRow("2026-11-01", 1_000_000), dayRow("2026-11-02", 800_000)],
				baselines: [
					baselineRow("2026-11-01", 900_000),
					baselineRow("2026-11-02", null, 0),
				],
			}),
		);
		expect(card.narrative[0]?.key).toBe(monthKeys.days.average);
		expect(card.narrative[0]?.values.days).toEqual({ kind: "count", value: 2 });
	});

	it("has no headline and no chart in a month without data", () => {
		const card = buildDailyTrendCard(
			monthInput({ days: [dayRow("2026-11-01", null)] }),
		);
		expect(card.headline.value).toBeNull();
		expect(card.chart).toBeNull();
		expect(card.narrative[0]?.key).toBe(monthKeys.days.noData);
	});
});
