import { describe, expect, it } from "vitest";
import { addDays, reportKeys } from "../../../../src/index.js";
import {
	AVERAGE_WEEKS,
	averageCoverageFrom,
	averageWeeks,
	fourWeekAverage,
	fourWeekComparison,
	MIN_AVERAGE_WEEKS,
	SKIP_TET_WEEKS,
	weekDays,
	weekKeys,
} from "../../../../src/reports/week/index.js";
import {
	type DayPlan,
	dayRows,
	RUNNING_WEEK_DAY,
	STORE_A,
	STORE_B,
	weekContext,
	weekInput,
	youngStoreCoverage,
} from "./fixtures.js";

const weekNet: Readonly<Record<string, number>> = {
	"2026-10-19": 2_100_000,
	"2026-10-12": 2_800_000,
	"2026-10-05": 3_500_000,
	"2026-09-28": 4_200_000,
};

const byWeek: DayPlan = (_storeId, date) => {
	const monday = Object.keys(weekNet).find(
		(start) => date >= start && date <= addDays(start, 6),
	);
	const net = monday === undefined ? 1_000_000 : (weekNet[monday] ?? 0) / 7;
	return { net, invoices: 10, items: 15 };
};

function averageOf(scene: Parameters<typeof weekInput>[0] = {}) {
	const input = weekInput(scene);
	return fourWeekAverage({
		period: input.context.period,
		coverage: input.coverage,
		days: weekDays(input.results.rows("days", "period_series") ?? []),
	});
}

describe("the Tuần 4-week average", () => {
	it("takes the same elapsed days of each of the four weeks before", () => {
		const context = weekContext({ date: RUNNING_WEEK_DAY });
		expect(context.period.from).toBe("2026-11-02");
		expect(context.period.end).toBe("2026-11-03");
		expect(averageWeeks(context.period)).toEqual([
			{ weeksBack: 1, from: "2026-10-26", to: "2026-10-27" },
			{ weeksBack: 2, from: "2026-10-19", to: "2026-10-20" },
			{ weeksBack: 3, from: "2026-10-12", to: "2026-10-13" },
			{ weeksBack: 4, from: "2026-10-05", to: "2026-10-06" },
		]);
		expect(averageCoverageFrom(context.period)).toBe("2026-10-05");
		expect(AVERAGE_WEEKS).toBe(4);
		expect(MIN_AVERAGE_WEEKS).toBe(2);
		expect(SKIP_TET_WEEKS).toBe(true);
	});

	it("is the mean of the four week sums with a pooled ticket", () => {
		const average = averageOf({ stores: [STORE_A], plan: byWeek });
		expect(average.weeks.map((week) => week.weeksBack)).toEqual([1, 2, 3, 4]);
		expect(average.unavailable).toBeNull();
		expect(average.basis).toBe("all_stores");
		expect(average.reference.net).toBe(3_150_000);
		expect(average.reference.invoices).toBe(70);
		expect(average.reference.avgTicket).toBe(45_000);
		expect(average.reference.itemsPerTicket).toBe(1.5);
		expect(average.reference.avgItemPrice).toBe(30_000);
		expect(average.range).toEqual({ from: "2026-09-28", to: "2026-10-25" });
	});

	it("skips a week that holds a Tết day and labels the weeks it used", () => {
		const average = averageOf({
			stores: [STORE_A],
			plan: byWeek,
			holidays: { "2026-10-14": "tet" },
		});
		expect(average.weeks.map((week) => week.weeksBack)).toEqual([1, 3, 4]);
		expect(average.skippedWeeks.map((week) => week.weeksBack)).toEqual([2]);
		expect(average.reference.net).toBe(3_266_666.67);
		const chip = fourWeekComparison(average, "net", 7_000_000);
		expect(chip.kind).toBe("average_4_weeks");
		expect(chip.label).toEqual({
			key: reportKeys.compare.average4Weeks,
			values: { weeks: { kind: "count", value: 3 } },
		});
		expect(chip.reference).toBe(3_266_666.67);
		expect(chip.change).toBeCloseTo(7_000_000 / 3_266_666.67 - 1, 10);
	});

	it("keeps public holidays in the average", () => {
		const average = averageOf({
			stores: [STORE_A],
			plan: byWeek,
			holidays: { "2026-10-14": "public" },
		});
		expect(average.weeks).toHaveLength(4);
	});

	it("has no reference with only one qualifying week", () => {
		const average = averageOf({
			stores: [STORE_A],
			plan: byWeek,
			holidays: {
				"2026-09-30": "tet",
				"2026-10-07": "tet",
				"2026-10-14": "tet",
			},
		});
		expect(average.weeks.map((week) => week.weeksBack)).toEqual([1]);
		expect(average.unavailable).toBe("no_reference");
		expect(average.reference.net).toBeNull();
		const chip = fourWeekComparison(average, "net", 7_000_000);
		expect(chip.unavailable).toBe("no_reference");
		expect(chip.reference).toBeNull();
		expect(chip.change).toBeNull();
		expect(chip.label.values.weeks).toEqual({ kind: "count", value: 1 });
	});

	it("counts a covered store-day without data as zero", () => {
		const plan: DayPlan = (_storeId, date) =>
			date >= "2026-10-12" && date <= "2026-10-18"
				? null
				: { net: 1_000_000, invoices: 20, items: 30 };
		const average = averageOf({ stores: [STORE_A], plan });
		expect(average.reference.net).toBe(5_250_000);
		expect(average.reference.invoices).toBe(105);
		expect(average.reference.avgTicket).toBe(50_000);
	});

	it("uses the stores covered four Mondays back, like for like", () => {
		const plan: DayPlan = (storeId, date) =>
			storeId === STORE_B && date < "2026-10-12"
				? null
				: {
						net: storeId === STORE_A ? 1_000_000 : 400_000,
						invoices: 10,
						items: 12,
					};
		const average = averageOf({
			coverage: youngStoreCoverage("2026-10-12"),
			plan,
		});
		expect(average.coverage.state).toBe("partial");
		expect(average.storeIds).toEqual([STORE_A]);
		expect(average.basis).toBe("like_for_like");
		expect(average.reference.net).toBe(7_000_000);
		expect(average.current.net).toBe(7_000_000);
		expect(average.forStore(STORE_A).net).toBe(7_000_000);
		expect(average.forStore(STORE_B).net).toBeNull();
		const chip = fourWeekComparison(average, "net", 9_800_000);
		expect(chip.basis).toBe("like_for_like");
		expect(chip.current).toBe(7_000_000);
		expect(chip.coveredStores).toBe(1);
		expect(chip.totalStores).toBe(2);
		expect(chip.label).toEqual({
			key: weekKeys.compare.average4WeeksLikeForLike,
			values: {
				weeks: { kind: "count", value: 4 },
				covered: { kind: "count", value: 1 },
				total: { kind: "count", value: 2 },
			},
		});
	});

	it("says the store is too young when no store is covered", () => {
		const average = averageOf({
			stores: [STORE_B],
			coverage: youngStoreCoverage("2026-10-12").slice(1),
		});
		expect(average.coverage.state).toBe("none");
		expect(average.unavailable).toBe("store_too_young");
		const chip = fourWeekComparison(average, "invoices", 140);
		expect(chip.unavailable).toBe("store_too_young");
		expect(chip.coveredStores).toBe(0);
	});

	it("averages each weekday over the qualifying weeks", () => {
		const plan: DayPlan = (_storeId, date) => ({
			net: date.endsWith("-19") || date.endsWith("-12") ? 2_000_000 : 1_000_000,
			invoices: 20,
			items: 30,
		});
		const context = weekContext({ stores: [STORE_A] });
		const average = fourWeekAverage({
			period: context.period,
			coverage: weekInput({ stores: [STORE_A] }).coverage,
			days: weekDays(dayRows(context, plan)),
		});
		expect(average.weekday(1).net).toBe(1_500_000);
		expect(average.weekday(2).net).toBe(1_000_000);
		expect(average.weekday(7).invoices).toBe(20);
	});
});
