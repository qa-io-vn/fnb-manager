import { describe, expect, it } from "vitest";
import { reportKeys } from "../../../../src/index.js";
import {
	buildGrowthCard,
	buildMonthMatrixCard,
	buildSeasonalityCard,
	MATRIX_HEAT_COLUMNS,
	yearKeys,
} from "../../../../src/reports/year/index.js";
import { coverageRow } from "../../fixtures.js";
import {
	AS_OF,
	establishedAndYoung,
	type Figures,
	monthRows,
	STORE_A,
	STORE_B,
	steadyMonths,
	weekdayRows,
	weekRows,
	YOUNG_START,
	yearInput,
} from "./fixtures.js";

const TET_DAYS = { "2025-01": 4, "2025-02": 2, "2026-02": 6 };

const establishedMonths = steadyMonths("2024-12-01", AS_OF, (key) => {
	const special: Record<string, number> = {
		"2024-12": 100_000_000,
		"2025-01": 80_000_000,
		"2026-01": 120_000_000,
		"2026-02": 90_000_000,
		"2026-05": 130_000_000,
		"2026-11": 12_000_000,
	};
	return special[key] ?? (key.startsWith("2025") ? 100_000_000 : 110_000_000);
});

const youngMonths: Record<string, Figures> = {
	"2026-08": { net: 2_000_000, invoices: 40, items: 80, days: 1 },
	"2026-09": { net: 60_000_000, invoices: 1_200, items: 2_400 },
	"2026-10": { net: 70_000_000, invoices: 1_400, items: 2_800 },
	"2026-11": { net: 7_000_000, invoices: 140, items: 280, days: 3 },
};

const bothStores = monthRows(
	{ [STORE_A]: establishedMonths, [STORE_B]: youngMonths },
	"2024-01-01",
	AS_OF,
	TET_DAYS,
);

const establishedOnly = monthRows(
	{ [STORE_A]: establishedMonths },
	"2024-01-01",
	AS_OF,
	TET_DAYS,
);

const youngOnly = monthRows(
	{ [STORE_B]: youngMonths },
	"2024-01-01",
	AS_OF,
	TET_DAYS,
);

function chipless<T extends { comparisons: readonly unknown[] }>(card: T): T {
	expect(card.comparisons).toEqual([]);
	return card;
}

describe("Năm month × year matrix", () => {
	it("lays the years from two years back to this year against the twelve months, heat on the months", () => {
		const card = chipless(
			buildMonthMatrixCard(
				yearInput({ coverage: establishedAndYoung(), months: bothStores }),
			),
		);
		const table = card.tables[0];
		expect(table?.variant).toBe("heat");
		expect(table?.heatColumns).toEqual(MATRIX_HEAT_COLUMNS);
		expect(table?.columns.map((column) => column.key)).toEqual([
			"year",
			...MATRIX_HEAT_COLUMNS,
			"total",
		]);
		expect(table?.rows.map((row) => row.id)).toEqual(["2024", "2025", "2026"]);
		const [first, , current] = table?.rows ?? [];
		expect(first?.cells.m11).toBeNull();
		expect(first?.cells.m12).toBe(100_000_000);
		expect(first?.cells.total).toBe(100_000_000);
		expect(current?.cells.m11).toBe(19_000_000);
		expect(current?.cells.m12).toBeNull();
		expect(table?.captionKey).toBe(yearKeys.matrix.partial);
		expect(card.chart).toBeNull();
		expect(card.csvName).toBe("nam-month-matrix-2026");
	});

	it("heads with the best complete month of the year and compares it with last year's best", () => {
		const card = buildMonthMatrixCard(
			yearInput({ coverage: establishedAndYoung(), months: bothStores }),
		);
		expect(card.headline).toEqual({
			value: 180_000_000,
			unit: "money",
			caption: {
				key: yearKeys.matrix.caption,
				values: { month: { kind: "month", value: "2026-10" } },
			},
		});
		expect(card.narrative.map((sentence) => sentence.key)).toEqual([
			yearKeys.matrix.peak,
			yearKeys.matrix.lastYearUpLikeForLike,
			reportKeys.clause.coverage.youngStore,
		]);
		expect(card.narrative[1]?.values).toEqual({
			covered: { kind: "count", value: 1 },
			total: { kind: "count", value: 2 },
			lastYear: { kind: "year", value: "2025" },
			month: { kind: "month", value: "2025-02" },
			value: { kind: "money", value: 100_000_000 },
			currentMonth: { kind: "month", value: "2026-05" },
			currentValue: { kind: "money", value: 130_000_000 },
			delta: { kind: "percent", value: 0.3 },
		});
		expect(card.notice).toBeNull();
		expect(card.markers.stale).toBe(false);
	});

	it("uses the running month, marked partial, before any month is complete", () => {
		const months = monthRows(
			{
				[STORE_A]: steadyMonths("2024-12-01", "2026-01-10", () => 90_000_000),
			},
			"2024-01-01",
			"2026-01-10",
		);
		const card = buildMonthMatrixCard(
			yearInput({ stores: [STORE_A], asOf: "2026-01-10", months }),
		);
		expect(card.headline.caption?.key).toBe(yearKeys.matrix.captionPartial);
		expect(card.narrative[0]?.key).toBe(yearKeys.matrix.peakPartial);
	});

	it("says a past year is complete and explains a year without sales", () => {
		const past = buildMonthMatrixCard(
			yearInput({
				stores: [STORE_A],
				date: "2025-06-01",
				months: establishedOnly,
			}),
		);
		expect(past.tables[0]?.captionKey).toBe(yearKeys.matrix.table);
		expect(past.tables[0]?.rows.map((row) => row.id)).toEqual([
			"2023",
			"2024",
			"2025",
		]);
		const empty = buildMonthMatrixCard(
			yearInput({ stores: [STORE_B], date: "2025-06-01", months: [] }),
		);
		expect(empty.headline.value).toBeNull();
		expect(empty.notice?.part.key).toBe(yearKeys.noSales);
		expect(empty.narrative.map((sentence) => sentence.key)).toEqual([
			yearKeys.matrix.noData,
		]);
	});
});

describe("Năm growth", () => {
	it("heads with the latest complete month against the same month last year, like for like", () => {
		const card = chipless(
			buildGrowthCard(
				yearInput({ coverage: establishedAndYoung(), months: bothStores }),
			),
		);
		expect(card.headline.value).toBeCloseTo(0.1, 12);
		expect(card.headline.unit).toBe("signedFraction");
		expect(card.headline.caption?.values.month).toEqual({
			kind: "month",
			value: "2026-10",
		});
		const table = card.tables[0];
		expect(table?.rows).toHaveLength(10);
		expect(table?.columns.map((column) => column.key)).toEqual([
			"month",
			"net",
			"lastYear",
			"coveredNet",
			"coveredLastYear",
			"yoy",
			"state",
			"mom",
			"threeMonths",
		]);
		const january = table?.rows[0]?.cells;
		expect(january?.yoy).toBeCloseTo(0.5, 12);
		expect(january?.state).toBe(yearKeys.table.likeForLike);
		expect(
			(january?.coveredNet as number) / (january?.coveredLastYear as number) -
				1,
		).toBeCloseTo(january?.yoy as number, 12);
		expect(january?.threeMonths).toBeNull();
		expect(table?.rows.at(-1)?.cells.threeMonths).toBeCloseTo(
			462 / 350 - 1,
			12,
		);
	});

	it("names the largest rise and fall, the like-for-like basis and the Tết shift", () => {
		const card = buildGrowthCard(
			yearInput({ coverage: establishedAndYoung(), months: bothStores }),
		);
		expect(card.narrative[0]).toEqual({
			key: yearKeys.growth.main,
			values: {
				rise: { kind: "month", value: "2026-01" },
				riseDelta: { kind: "signedPercent", value: 0.5 },
				fall: { kind: "month", value: "2026-02" },
				fallDelta: { kind: "signedPercent", value: -0.1 },
			},
		});
		expect(card.narrative[1]).toEqual({
			key: reportKeys.clause.coverage.likeForLike,
			values: {
				covered: { kind: "count", value: 1 },
				total: { kind: "count", value: 2 },
			},
		});
		expect(card.narrative[2]).toEqual({
			key: reportKeys.clause.tet.shift,
			values: {
				month: { kind: "month", value: "2026-02" },
				otherMonth: { kind: "month", value: "2025-01" },
			},
		});
		const [rise, fall] = card.chart?.series ?? [];
		expect(rise?.tone).toBe("positive");
		expect(fall?.tone).toBe("negative");
		expect(rise?.values[0]).toBeCloseTo(0.5, 12);
		expect(fall?.values[1]).toBeCloseTo(-0.1, 12);
		expect(card.chart?.categories[0]).toEqual({
			kind: "message",
			value: "report.year.month.1",
		});
	});

	it("leaves the Tết note out when Tết falls in the same month both years", () => {
		const sameMonth = monthRows(
			{ [STORE_A]: establishedMonths },
			"2024-01-01",
			AS_OF,
			{ "2025-02": 6, "2026-02": 6 },
		);
		const card = buildGrowthCard(
			yearInput({ stores: [STORE_A], months: sameMonth }),
		);
		expect(card.narrative.map((sentence) => sentence.key)).toEqual([
			yearKeys.growth.main,
		]);
		expect(card.tables[0]?.columns.map((column) => column.key)).not.toContain(
			"state",
		);
	});

	it("shows the young-store notice when no month can be compared", () => {
		const card = buildGrowthCard(
			yearInput({
				stores: [STORE_B],
				coverage: [coverageRow(STORE_B, { history_start: YOUNG_START })],
				months: youngOnly,
			}),
		);
		expect(card.headline.value).toBeNull();
		expect(card.headline.caption).toBeNull();
		expect(card.notice?.part.key).toBe(reportKeys.clause.coverage.youngStore);
		expect(card.narrative[0]?.key).toBe(yearKeys.growth.noReference);
		expect(card.tables[0]?.rows[0]?.cells.state).toBe(
			"report.unavailable.store_too_young.last_year",
		);
		expect(card.chart).toBeNull();
	});

	it("waits for the first complete month of the year", () => {
		const card = buildGrowthCard(
			yearInput({
				stores: [STORE_A],
				asOf: "2026-01-10",
				months: monthRows(
					{ [STORE_A]: establishedMonths },
					"2024-01-01",
					"2026-01-10",
				),
			}),
		);
		expect(card.headline.value).toBeNull();
		expect(card.notice?.part.key).toBe(yearKeys.growth.noCompleteMonth);
		expect(card.narrative[0]?.key).toBe(yearKeys.growth.noData);
	});
});

describe("Năm seasonality and Tết", () => {
	const tetDates = new Set([
		"2025-01-28",
		"2025-01-29",
		"2025-01-30",
		"2025-01-31",
		"2025-02-01",
		"2025-02-02",
		"2026-02-16",
		"2026-02-17",
		"2026-02-18",
		"2026-02-19",
		"2026-02-20",
		"2026-02-21",
	]);
	const weeks = weekRows(
		"2025-01-01",
		AS_OF,
		(date) => (tetDates.has(date) ? 300_000 : 1_000_000),
		tetDates,
	);
	const weekdays = weekdayRows([
		10_000_000, 10_000_000, 10_000_000, 10_000_000, 20_000_000, 20_000_000,
		20_000_000,
	]);

	it("heads with the highest seasonality index over the 12 complete months", () => {
		const card = chipless(
			buildSeasonalityCard(
				yearInput({
					stores: [STORE_A],
					months: establishedOnly,
					weeks,
					weekdays,
				}),
			),
		);
		const monthly = card.tables[0];
		expect(monthly?.captionKey).toBe(yearKeys.seasonality.table);
		expect(monthly?.rows.map((row) => row.cells.month)).toEqual([
			"2025-11",
			"2025-12",
			"2026-01",
			"2026-02",
			"2026-03",
			"2026-04",
			"2026-05",
			"2026-06",
			"2026-07",
			"2026-08",
			"2026-09",
			"2026-10",
		]);
		const indices = (monthly?.rows ?? []).map(
			(row) => row.cells.index as number,
		);
		expect(indices.reduce((total, value) => total + value, 0)).toBeCloseTo(
			12,
			2,
		);
		const highest = Math.max(...indices);
		const may = monthly?.rows.find((row) => row.cells.month === "2026-05");
		expect(may?.cells.index).toBe(highest);
		expect(card.headline).toEqual({
			value: highest,
			unit: "ratio",
			caption: {
				key: yearKeys.seasonality.caption,
				values: { month: { kind: "month", value: "2026-05" } },
			},
		});
		expect(card.narrative[0]?.key).toBe(yearKeys.seasonality.main);
		expect(card.narrative[1]?.key).toBe(yearKeys.seasonality.tetBoth);
		expect(card.tables[1]?.captionKey).toBe(yearKeys.seasonality.weekdayTable);
		expect(card.tables[1]?.rows[4]?.cells.share).toBeCloseTo(0.2, 6);
		expect(card.notice).toBeNull();
	});

	it("draws both years by ISO week with the Tết weeks marked for each year", () => {
		const card = buildSeasonalityCard(
			yearInput({
				stores: [STORE_A],
				months: establishedOnly,
				weeks,
				weekdays,
			}),
		);
		expect(card.chart?.categories).toHaveLength(53);
		expect(
			card.chart?.series.map((series) => series.label.values.year),
		).toEqual([
			{ kind: "year", value: "2026" },
			{ kind: "year", value: "2025" },
		]);
		expect(card.chart?.markAreas).toEqual([
			{
				label: {
					key: yearKeys.seasonality.tet,
					values: { year: { kind: "year", value: "2026" } },
				},
				fromIndex: 7,
				toIndex: 7,
			},
			{
				label: {
					key: yearKeys.seasonality.tet,
					values: { year: { kind: "year", value: "2025" } },
				},
				fromIndex: 4,
				toIndex: 4,
			},
		]);
	});

	it("flags a like-for-like index while a selected store is younger than the window", () => {
		const card = buildSeasonalityCard(
			yearInput({
				coverage: establishedAndYoung(),
				months: bothStores,
				weeks,
				weekdays,
			}),
		);
		expect(card.tables[0]?.captionKey).toBe(
			yearKeys.seasonality.tableLikeForLike,
		);
	});

	it("keeps the weekday table with a notice when there are not 12 months", () => {
		const card = buildSeasonalityCard(
			yearInput({
				stores: [STORE_B],
				coverage: [coverageRow(STORE_B, { history_start: YOUNG_START })],
				months: youngOnly,
				weeks,
				weekdays,
			}),
		);
		expect(card.headline.value).toBeNull();
		expect(card.notice?.part.key).toBe(yearKeys.seasonality.tooShort);
		expect(card.tables.map((table) => table.captionKey)).toEqual([
			yearKeys.seasonality.weekdayTable,
		]);
		expect(card.narrative[0]?.key).toBe(yearKeys.seasonality.tooShortSentence);
	});
});
