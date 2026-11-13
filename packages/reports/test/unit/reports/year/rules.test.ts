import { describe, expect, it } from "vitest";
import { periodContaining } from "../../../../src/index.js";
import {
	isoWeekCount,
	isYoungForYear,
	latestCompleteMonth,
	lifecycleStatus,
	monthGrowth,
	monthOnMonth,
	opensWithinYear,
	PEAK_COMPLETE_MONTHS_ONLY,
	peakMonth,
	SeriesIndex,
	seasonality,
	sinceOpeningBlocks,
	tetDip,
	tetMonth,
	threeMonthChange,
	weeklyNet,
	yearBounds,
} from "../../../../src/reports/year/index.js";
import {
	AS_OF,
	dayRows,
	monthRows,
	STORE_A,
	STORE_B,
	steadyMonths,
	weekRows,
} from "./fixtures.js";

const bounds2026 = yearBounds(periodContaining("year", AS_OF, AS_OF));

function index(rows: Parameters<typeof monthRows>[0], to = AS_OF) {
	return new SeriesIndex(monthRows(rows, "2024-01-01", to));
}

describe("Năm periods", () => {
	it("derives the year, last year and the matrix's first year from the period", () => {
		expect(bounds2026).toEqual({
			year: 2026,
			yearStart: "2026-01-01",
			yearEnd: AS_OF,
			lastYearStart: "2025-01-01",
			firstYearStart: "2024-01-01",
			asOf: AS_OF,
		});
		const past = yearBounds(periodContaining("year", "2025-06-01", AS_OF));
		expect(past.yearEnd).toBe("2025-12-31");
		expect(past.firstYearStart).toBe("2023-01-01");
	});

	it("finds the latest complete month on or before the year end", () => {
		expect(latestCompleteMonth("2026-11-03", "2026-11-03")).toBe("2026-10-01");
		expect(latestCompleteMonth("2026-10-31", "2026-10-31")).toBe("2026-10-01");
		expect(latestCompleteMonth("2025-12-31", AS_OF)).toBe("2025-12-01");
		expect(latestCompleteMonth("2026-01-10", "2026-01-10")).toBe("2025-12-01");
	});
});

describe("peak month", () => {
	const months = steadyMonths("2025-01-01", AS_OF, (key) =>
		key === "2026-10"
			? 300_000_000
			: key === "2026-11"
				? 400_000_000
				: 100_000_000,
	);

	it("takes the complete month with the highest net and leaves the running month out", () => {
		expect(PEAK_COMPLETE_MONTHS_ONLY).toBe(true);
		expect(peakMonth(index({ [STORE_A]: months }), 2026, AS_OF)).toEqual({
			month: "2026-10-01",
			net: 300_000_000,
			partial: false,
		});
	});

	it("counts the running month only when complete months are not required", () => {
		expect(peakMonth(index({ [STORE_A]: months }), 2026, AS_OF, false)).toEqual(
			{ month: "2026-11-01", net: 400_000_000, partial: true },
		);
	});

	it("falls back to the latest month, marked partial, without a complete month", () => {
		const january = steadyMonths("2025-01-01", "2026-01-15", () => 90_000_000);
		expect(
			peakMonth(
				index({ [STORE_A]: january }, "2026-01-15"),
				2026,
				"2026-01-15",
			),
		).toEqual({ month: "2026-01-01", net: 90_000_000, partial: true });
	});

	it("is null for a year without sales", () => {
		expect(peakMonth(index({ [STORE_A]: {} }), 2026, AS_OF)).toBeNull();
	});

	it("keeps the earlier month on a tie", () => {
		const tie = steadyMonths("2026-01-01", AS_OF, () => 100_000_000);
		expect(peakMonth(index({ [STORE_A]: tie }), 2026, AS_OF)?.month).toBe(
			"2026-01-01",
		);
	});
});

describe("year over year per month", () => {
	const established = steadyMonths("2025-01-01", AS_OF, (key) =>
		key.startsWith("2025") ? 100_000_000 : 110_000_000,
	);
	const young = steadyMonths("2025-03-01", AS_OF, (key) =>
		key.startsWith("2025") ? 50_000_000 : 80_000_000,
	);
	const months = index({ [STORE_A]: established, [STORE_B]: young });
	const history = (id: string) =>
		id === STORE_A ? "2024-12-02" : id === STORE_B ? "2025-03-01" : null;

	it("compares like for like while the young store has no history a year earlier", () => {
		const february = monthGrowth(
			months,
			"2026-02-01",
			[STORE_A, STORE_B],
			history,
		);
		expect(february.basis).toBe("like_for_like");
		expect(february.coveredStoreIds).toEqual([STORE_A]);
		expect(february.yoy).toBeCloseTo(0.1, 12);
		expect(february.coveredNet).toBe(110_000_000);
		expect(february.coveredLastYearNet).toBe(100_000_000);
		expect(february.net).toBe(190_000_000);
		expect(february.lastYearNet).toBe(100_000_000);
	});

	it("covers the young store from the month its history starts a year earlier", () => {
		const march = monthGrowth(
			months,
			"2026-03-01",
			[STORE_A, STORE_B],
			history,
		);
		expect(march.basis).toBe("all_stores");
		expect(march.yoy).toBeCloseTo(190 / 150 - 1, 12);
	});

	it("has no year-over-year value when no store is covered", () => {
		const alone = monthGrowth(months, "2026-02-01", [STORE_B], history);
		expect(alone.basis).toBe("none");
		expect(alone.yoy).toBeNull();
	});

	it("compares each month with the month before and the latest three with the three before", () => {
		const trend = index({
			[STORE_A]: steadyMonths("2025-01-01", AS_OF, (key) =>
				["2026-08", "2026-09", "2026-10"].includes(key)
					? 300_000_000
					: 200_000_000,
			),
		});
		expect(threeMonthChange(trend, "2026-10-01")).toBeCloseTo(0.5, 12);
		expect(monthOnMonth(trend, "2026-08-01")).toBeCloseTo(0.5, 12);
		expect(monthOnMonth(trend, "2026-01-01")).toBe(0);
		const gap = index({
			[STORE_A]: steadyMonths("2026-06-01", AS_OF, () => 100_000_000),
		});
		expect(threeMonthChange(gap, "2026-10-01")).toBeNull();
	});
});

describe("seasonality index", () => {
	const perDay = (key: string) => {
		const days = new Date(
			Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0),
		).getUTCDate();
		return (key === "2026-05" ? 2_000_000 : 1_000_000) * days;
	};

	it("needs 12 complete months of the covered stores", () => {
		const eleven = index({
			[STORE_A]: steadyMonths("2025-12-01", AS_OF, perDay),
		});
		const short = seasonality(
			eleven,
			"2026-10-01",
			[STORE_A],
			() => "2025-12-01",
		);
		expect(short.windowStart).toBe("2025-11-01");
		expect(short.coveredStoreIds).toEqual([]);
		expect(short.complete).toBe(false);
		expect(short.months.every((entry) => entry.index === null)).toBe(true);
	});

	it("divides each month's average daily net by the mean over the window", () => {
		const twelve = index({
			[STORE_A]: steadyMonths("2025-11-01", AS_OF, perDay),
		});
		const full = seasonality(
			twelve,
			"2026-10-01",
			[STORE_A],
			() => "2025-11-01",
		);
		expect(full.complete).toBe(true);
		expect(full.basis).toBe("all_stores");
		expect(full.months).toHaveLength(12);
		const may = full.months.find((entry) => entry.month === "2026-05-01");
		expect(may?.avgDailyNet).toBe(2_000_000);
		expect(may?.index).toBe(1.846);
		expect(full.months[0]?.index).toBe(0.923);
	});

	it("leaves a month out of the covered data when the covered store has no sales in it", () => {
		const closed = steadyMonths("2025-11-01", AS_OF, perDay);
		const { "2026-02": _closed, ...open } = closed;
		const gap = seasonality(
			index({ [STORE_A]: open }),
			"2026-10-01",
			[STORE_A],
			() => "2025-11-01",
		);
		expect(gap.complete).toBe(false);
	});
});

describe("Tết", () => {
	const tet2025 = new Set([
		"2025-01-28",
		"2025-01-29",
		"2025-01-30",
		"2025-01-31",
		"2025-02-01",
		"2025-02-02",
	]);
	const closed = new Set(["2025-01-29", "2025-01-30", "2025-01-31"]);
	const halfDays = new Set(["2025-01-28", "2025-02-01", "2025-02-02"]);
	const netOfDay = (date: string) =>
		closed.has(date) ? null : halfDays.has(date) ? 500_000 : 1_000_000;

	it("compares the week with the most Tết days with the four weeks before, per calendar day", () => {
		const weeks = weekRows("2025-01-01", "2025-03-31", netOfDay, tet2025);
		const dip = tetDip(weeks, 2025);
		expect(dip?.week.bucket_start).toBe("2025-01-27");
		expect(dip?.week.calendar_days).toBe(7);
		expect(dip?.dip).toBeCloseTo(2_500_000 / 7 / 1_000_000 - 1, 12);
	});

	it("has no dip without four weeks before the Tết week", () => {
		const weeks = weekRows("2025-01-20", "2025-03-31", netOfDay, tet2025);
		expect(tetDip(weeks, 2025)).toBeNull();
		expect(tetDip(weeks, 2026)).toBeNull();
	});

	it("places Tết in the month with the most Tết days", () => {
		const months = new SeriesIndex(
			monthRows(
				{ [STORE_A]: steadyMonths("2025-01-01", AS_OF, () => 1) },
				"2025-01-01",
				AS_OF,
				{ "2025-01": 4, "2025-02": 2, "2026-02": 6 },
			),
		);
		expect(tetMonth(months, 2025)).toBe("2025-01-01");
		expect(tetMonth(months, 2026)).toBe("2026-02-01");
		expect(tetMonth(months, 2024)).toBeNull();
	});
});

describe("ISO week alignment", () => {
	const weeks = weekRows("2025-01-01", "2026-12-31", () => 1_000_000);

	it("lays both years on weeks 1 to 53 when either year has 53 ISO weeks", () => {
		expect(isoWeekCount([2026, 2025])).toBe(53);
		expect(isoWeekCount([2025, 2024])).toBe(52);
	});

	it("puts 29 December 2025 in week 1 of 2026 and leaves clipped weeks empty", () => {
		const current = weeklyNet(weeks, 2026, 53);
		const previous = weeklyNet(weeks, 2025, 53);
		expect(current).toHaveLength(53);
		expect(current[0]).toBe(7_000_000);
		expect(current[51]).toBe(7_000_000);
		expect(current[52]).toBeNull();
		expect(previous[0]).toBeNull();
		expect(previous[1]).toBe(7_000_000);
		expect(previous[51]).toBe(7_000_000);
		expect(previous[52]).toBeNull();
		const lastWeek = weeks.at(-1);
		expect([lastWeek?.iso_year, lastWeek?.iso_week]).toEqual([2026, 53]);
		expect(lastWeek?.calendar_days).toBe(4);
	});
});

describe("lifecycle statuses", () => {
	const base = {
		first_sold_on: "2025-01-02",
		last_sold_on: AS_OF,
		quantity_ytd: 1_000,
		quantity_last_ytd: 1_000,
	};

	it("puts new before discontinued and discontinued before growth", () => {
		expect(
			lifecycleStatus(
				{ ...base, first_sold_on: "2026-02-01", last_sold_on: "2026-03-01" },
				bounds2026,
			),
		).toBe("new");
		expect(
			lifecycleStatus(
				{ ...base, last_sold_on: "2026-09-08", quantity_ytd: 5_000 },
				bounds2026,
			),
		).toBe("discontinued");
		expect(
			lifecycleStatus({ ...base, last_sold_on: "2026-09-09" }, bounds2026),
		).toBe("steady");
	});

	it("grows from 1.2 times and declines from 0.8 times last year's quantity", () => {
		const status = (current: number, reference: number | null) =>
			lifecycleStatus(
				{ ...base, quantity_ytd: current, quantity_last_ytd: reference },
				bounds2026,
			);
		expect(status(12, 10)).toBe("growing");
		expect(status(11.999, 10)).toBe("steady");
		expect(status(8, 10)).toBe("declining");
		expect(status(8.001, 10)).toBe("steady");
		expect(status(0, 9.999)).toBe("steady");
		expect(status(100, null)).toBe("steady");
	});

	it("leaves out items last sold before last year and quiet items not sold this year", () => {
		expect(
			lifecycleStatus({ ...base, last_sold_on: "2024-12-31" }, bounds2026),
		).toBeNull();
		const january = { ...bounds2026, yearEnd: "2026-01-20" };
		expect(
			lifecycleStatus(
				{
					first_sold_on: "2025-01-02",
					last_sold_on: "2025-12-30",
					quantity_ytd: null,
					quantity_last_ytd: 5,
				},
				january,
			),
		).toBeNull();
		expect(
			lifecycleStatus(
				{
					first_sold_on: "2025-01-02",
					last_sold_on: "2025-12-30",
					quantity_ytd: null,
					quantity_last_ytd: 50,
				},
				january,
			),
		).toBe("declining");
	});

	it("keeps only new and discontinued for a store without last year", () => {
		expect(
			lifecycleStatus({ ...base, quantity_ytd: 2_000 }, bounds2026, true),
		).toBeNull();
		expect(
			lifecycleStatus(
				{ ...base, first_sold_on: "2026-09-01" },
				bounds2026,
				true,
			),
		).toBe("new");
		expect(
			lifecycleStatus(
				{ ...base, last_sold_on: "2026-08-01" },
				bounds2026,
				true,
			),
		).toBe("discontinued");
	});
});

describe("since-opening blocks", () => {
	const days = dayRows(STORE_B, "2026-08-31", "2026-09-20", (date) =>
		date === "2026-09-03" ? null : 1_000_000,
	);

	it("averages each 7-day block over the days with data, a closed day left out", () => {
		const blocks = sinceOpeningBlocks(days, "2026-08-31", "2026-09-17");
		expect(blocks.map((block) => [block.week, block.from, block.to])).toEqual([
			[1, "2026-08-31", "2026-09-06"],
			[2, "2026-09-07", "2026-09-13"],
			[3, "2026-09-14", "2026-09-20"],
		]);
		expect(blocks[0]).toMatchObject({
			complete: true,
			daysWithData: 6,
			net: 6_000_000,
			avgPerDay: 1_000_000,
		});
		expect(blocks[1]?.net).toBe(7_000_000);
		expect(blocks[2]).toMatchObject({ complete: false, daysWithData: 4 });
	});

	it("has no block for a store that opens after the year", () => {
		expect(sinceOpeningBlocks(days, "2026-08-31", "2025-12-31")).toEqual([]);
	});
});

describe("young stores for Năm", () => {
	it("is young when its history starts after the year end minus 364 days", () => {
		expect(isYoungForYear("2025-11-04", AS_OF)).toBe(false);
		expect(isYoungForYear("2025-11-05", AS_OF)).toBe(true);
		expect(isYoungForYear(null, AS_OF)).toBe(false);
	});

	it("opens within the year only when its history starts on or before the year end", () => {
		expect(opensWithinYear("2026-08-31", AS_OF)).toBe(true);
		expect(opensWithinYear("2026-08-31", "2025-12-31")).toBe(false);
		expect(opensWithinYear(null, AS_OF)).toBe(false);
	});
});
