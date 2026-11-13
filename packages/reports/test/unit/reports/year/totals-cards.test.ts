import { describe, expect, it } from "vitest";
import { reportKeys, roundHalfAwayFromZero } from "../../../../src/index.js";
import {
	buildItemLifecycleCard,
	buildSinceOpeningCard,
	buildTicketTrendCard,
	buildYearOverYearCard,
	LIFECYCLE_STATUSES,
	yearCards,
	yearKeys,
} from "../../../../src/reports/year/index.js";
import { coverageRow } from "../../fixtures.js";
import {
	AS_OF,
	type CompareFigures,
	compareRows,
	dayRows,
	establishedAndYoung,
	lflCompare,
	lifecycleRow,
	monthRows,
	STORE_A,
	STORE_B,
	STORE_C,
	steadyMonths,
	YOUNG_START,
	yearInput,
} from "./fixtures.js";

const established: CompareFigures = {
	current: { net: 1_100_000_000, invoices: 22_000, items: 44_550 },
	lastYear: { net: 1_000_000_000, invoices: 21_000, items: 42_000 },
};
const young: CompareFigures = {
	current: { net: 130_000_000, invoices: 2_600, items: 5_200 },
	lastYear: null,
};

const establishedMonths = {
	...steadyMonths("2024-12-01", AS_OF, (key) =>
		key.startsWith("2025")
			? 100_000_000
			: key === "2026-03"
				? 160_000_000
				: 110_000_000,
	),
	"2026-09": { net: 110_000_000, invoices: 2_000, items: 4_200 },
};
const youngMonths = steadyMonths(YOUNG_START, AS_OF, () => 40_000_000);

function sceneWithYoungStore() {
	return {
		coverage: establishedAndYoung(),
		compare: compareRows({ [STORE_A]: established, [STORE_B]: young }),
		compareLfl: lflCompare(established),
		months: monthRows(
			{ [STORE_A]: establishedMonths, [STORE_B]: youngMonths },
			"2024-01-01",
			AS_OF,
		),
	};
}

function youngAlone() {
	return {
		stores: [STORE_B],
		coverage: [coverageRow(STORE_B, { history_start: YOUNG_START })],
		compare: compareRows({ [STORE_B]: young }),
		months: monthRows({ [STORE_B]: youngMonths }, "2024-01-01", AS_OF),
	};
}

describe("Năm ticket trend", () => {
	it("compares the year-to-date ticket with last year like for like and splits it two ways", () => {
		const card = buildTicketTrendCard(yearInput(sceneWithYoungStore()));
		expect(card.headline.value).toBe(
			roundHalfAwayFromZero(1_230_000_000 / 24_600, 2),
		);
		const chip = card.comparisons[0];
		expect(chip?.kind).toBe("last_year");
		expect(chip?.basis).toBe("like_for_like");
		expect(chip?.label.key).toBe(reportKeys.compare.likeForLike);
		expect(chip?.label.values.label).toEqual({
			kind: "part",
			value: { key: reportKeys.compare.lastYear.year, values: {} },
		});
		const split = card.decomposition;
		expect(split?.metric).toBe("avg_ticket");
		expect(split?.against).toBe("last_year");
		expect(split?.basis).toBe("like_for_like");
		expect(split?.parts.map((entry) => entry.factor)).toEqual([
			"items_per_ticket",
			"avg_item_price",
		]);
		const sum = (split?.parts ?? []).reduce(
			(total, entry) => total + entry.effect,
			0,
		);
		expect(roundHalfAwayFromZero(sum, 2)).toBe(split?.total);
		expect(card.narrative.map((sentence) => sentence.key)).toEqual([
			yearKeys.ticket.up,
			reportKeys.clause.coverage.likeForLikeValues,
			"report.clause.decomposition.avg_item_price",
		]);
		expect(card.narrative[1]?.values).toMatchObject({
			covered: { kind: "count", value: 1 },
			total: { kind: "count", value: 2 },
			current: { kind: "money", value: chip?.current },
			reference: { kind: "money", value: chip?.reference },
		});
	});

	it("tabulates each month against the same month last year on the covered stores", () => {
		const card = buildTicketTrendCard(yearInput(sceneWithYoungStore()));
		const table = card.tables[0];
		expect(table?.columns.map((column) => column.key)).toEqual([
			"month",
			"avgTicket",
			"itemsPerTicket",
			"avgItemPrice",
			"coveredTicket",
			"lastYearTicket",
			"change",
			"itemsEffect",
			"priceEffect",
			"state",
		]);
		expect(table?.rows.map((row) => row.cells.month)).toHaveLength(11);
		const september = table?.rows.find((row) => row.cells.month === "2026-09");
		expect(september?.cells).toMatchObject({
			state: yearKeys.table.likeForLike,
			lastYearTicket: 50_000,
			itemsEffect: 2_559.52,
			priceEffect: 2_440.48,
		});
		expect(september?.cells.change).toBeCloseTo(0.1, 12);
		expect(card.chart?.series).toHaveLength(2);
		expect(card.chart?.categories).toHaveLength(12);
	});

	it("shows the young state for a store without last year", () => {
		const card = buildTicketTrendCard(yearInput(youngAlone()));
		expect(card.comparisons[0]?.unavailable).toBe("store_too_young");
		expect(card.decomposition).toBeNull();
		expect(card.narrative[0]?.key).toBe(yearKeys.ticket.noReference);
		expect(card.tables[0]?.rows[0]?.cells.state).toBe(
			"report.unavailable.store_too_young.last_year",
		);
	});
});

describe("Năm item lifecycle", () => {
	const covered = [
		lifecycleRow("NEW-1", {
			first_sold_on: "2026-11-03",
			quantity_ytd: 7,
			quantity_last_ytd: null,
			net_ytd: 338_000,
			net_last_ytd: null,
		}),
		lifecycleRow("GROW-1", { quantity_ytd: 1_500, net_ytd: 75_000_000 }),
		lifecycleRow("DOWN-1", { quantity_ytd: 700, net_ytd: 35_000_000 }),
		lifecycleRow("GONE-1", {
			last_sold_on: "2026-07-31",
			quantity_ytd: 600,
			net_ytd: 30_000_000,
			net_lifetime: 90_000_000,
		}),
		lifecycleRow("GONE-2", {
			last_sold_on: "2026-08-15",
			quantity_ytd: 300,
			net_ytd: 15_000_000,
			net_lifetime: 20_000_000,
		}),
		lifecycleRow("STEADY-1", { net_ytd: 50_000_000 }),
		lifecycleRow("OLD-1", { last_sold_on: "2024-12-30" }),
	];
	const all = [
		...covered,
		lifecycleRow("YOUNG-ONLY", { first_sold_on: "2026-09-01" }),
	];

	it("classifies the covered stores' items when only some stores have last year", () => {
		const card = buildItemLifecycleCard(
			yearInput({
				coverage: establishedAndYoung(),
				lifecycle: all,
				lifecycleCovered: covered,
			}),
		);
		expect(card.headline).toEqual({
			value: 1,
			unit: "count",
			caption: {
				key: yearKeys.lifecycle.caption,
				values: { item: { kind: "text", value: "Item NEW-1" } },
			},
		});
		expect(card.subtitle?.key).toBe(reportKeys.clause.coverage.likeForLike);
		const table = card.tables[0];
		expect(table?.captionKey).toBe(yearKeys.lifecycle.tableLikeForLike);
		expect(table?.rows.map((row) => [row.id, row.cells.stage])).toEqual([
			["NEW-1", yearKeys.lifecycle.status.new],
			["GROW-1", yearKeys.lifecycle.status.growing],
			["DOWN-1", yearKeys.lifecycle.status.declining],
			["GONE-1", yearKeys.lifecycle.status.discontinued],
			["GONE-2", yearKeys.lifecycle.status.discontinued],
			["STEADY-1", yearKeys.lifecycle.status.steady],
		]);
		expect(card.narrative).toEqual([
			{
				key: yearKeys.lifecycle.main,
				values: {
					year: { kind: "year", value: "2026" },
					new: { kind: "count", value: 1 },
					growing: { kind: "count", value: 1 },
					declining: { kind: "count", value: 1 },
					discontinued: { kind: "count", value: 2 },
					steady: { kind: "count", value: 1 },
				},
			},
			{
				key: yearKeys.lifecycle.topNew,
				values: {
					item: { kind: "text", value: "Item NEW-1" },
					value: { kind: "money", value: 338_000 },
				},
			},
			{
				key: yearKeys.lifecycle.topDiscontinued,
				values: {
					item: { kind: "text", value: "Item GONE-1" },
					date: { kind: "date", value: "2026-07-31" },
				},
			},
		]);
		expect(card.chart?.categories.map((category) => category.value)).toEqual(
			LIFECYCLE_STATUSES.map((status) => yearKeys.lifecycle.status[status]),
		);
		expect(card.chart?.series[0]?.values).toEqual([1, 1, 1, 2, 1]);
	});

	it("limits a store without last year to new and discontinued items", () => {
		const card = buildItemLifecycleCard(
			yearInput({
				stores: [STORE_B],
				coverage: [coverageRow(STORE_B, { history_start: YOUNG_START })],
				lifecycle: [
					lifecycleRow("A", { first_sold_on: YOUNG_START }),
					lifecycleRow("B", { first_sold_on: "2026-09-02", net_ytd: 9 }),
				],
			}),
		);
		expect(card.headline.value).toBe(2);
		expect(card.notice?.part.key).toBe(yearKeys.lifecycle.tooYoung);
		expect(card.narrative[0]?.key).toBe(yearKeys.lifecycle.mainYoung);
		expect(card.chart?.categories.map((category) => category.value)).toEqual([
			yearKeys.lifecycle.status.new,
			yearKeys.lifecycle.status.discontinued,
		]);
	});

	it("reads aggregates, so a lagging store marks the card stale", () => {
		const card = buildItemLifecycleCard(
			yearInput({
				stores: [STORE_A],
				coverage: [
					coverageRow(STORE_A, { history_start: "2024-12-02", stale_days: 1 }),
				],
				lifecycle: covered,
			}),
		);
		expect(card.markers.stale).toBe(true);
		expect(card.tables[0]?.captionKey).toBe(yearKeys.lifecycle.table);
		expect(card.subtitle).toBeNull();
	});
});

describe("Năm year over year", () => {
	it("compares the year to date like for like and tabulates the young store's state", () => {
		const card = buildYearOverYearCard(yearInput(sceneWithYoungStore()));
		expect(card.headline.value).toBe(1_230_000_000);
		const chip = card.comparisons[0];
		expect(chip?.kind).toBe("last_year");
		expect(chip?.basis).toBe("like_for_like");
		expect(chip?.change).toBeCloseTo(0.1, 12);
		expect(card.decomposition?.metric).toBe("net_revenue");
		const parts = card.decomposition?.parts ?? [];
		expect(parts.reduce((total, entry) => total + entry.effect, 0)).toBe(
			card.decomposition?.total,
		);
		const table = card.tables[0];
		expect(table?.rows.map((row) => row.cells)).toEqual([
			{
				store: "Store 1",
				ytd: 1_100_000_000,
				lastYtd: 1_000_000_000,
				change: 0.1,
				state: null,
			},
			{
				store: "Store 2",
				ytd: 130_000_000,
				lastYtd: null,
				change: null,
				state: "report.unavailable.store_too_young.last_year",
			},
		]);
		expect(card.chart?.series[1]?.values).toEqual([1_000_000_000, null]);
	});

	it("names the month that moved most when only one store compares", () => {
		const card = buildYearOverYearCard(yearInput(sceneWithYoungStore()));
		expect(card.narrative.map((sentence) => sentence.key)).toEqual([
			yearKeys.yearOverYear.up,
			reportKeys.clause.coverage.likeForLikeValues,
			reportKeys.clause.driver.month,
		]);
		expect(card.narrative[2]?.values.month).toEqual({
			kind: "month",
			value: "2026-03",
		});
		expect(card.narrative[2]?.values.delta).toEqual({
			kind: "moneySigned",
			value: 60_000_000,
		});
	});

	it("names the store that moved most when two or more stores compare", () => {
		const third: CompareFigures = {
			current: { net: 300_000_000, invoices: 6_000, items: 12_000 },
			lastYear: { net: 500_000_000, invoices: 10_000, items: 20_000 },
		};
		const card = buildYearOverYearCard(
			yearInput({
				stores: [STORE_A, STORE_C],
				coverage: [
					coverageRow(STORE_A, { history_start: "2024-12-02" }),
					coverageRow(STORE_C, { history_start: "2024-06-01" }),
				],
				compare: compareRows({ [STORE_A]: established, [STORE_C]: third }),
			}),
		);
		const driver = card.narrative.at(-1);
		expect(driver?.key).toBe(reportKeys.clause.driver.store);
		expect(driver?.values.store).toEqual({ kind: "text", value: "Store 2" });
		expect(driver?.values.delta).toEqual({
			kind: "moneySigned",
			value: -200_000_000,
		});
	});

	it("shows the young state and its notice for a store without last year", () => {
		const card = buildYearOverYearCard(yearInput(youngAlone()));
		expect(card.comparisons[0]?.unavailable).toBe("store_too_young");
		expect(card.notice?.part.key).toBe(reportKeys.clause.coverage.youngStore);
		expect(card.narrative[0]?.key).toBe(yearKeys.yearOverYear.noReference);
		const lastYear = card.tables[0]?.rows.find((row) => row.id === "last_year");
		expect(lastYear?.cells).toEqual({
			period: reportKeys.periodRow.lastYear,
			net: null,
			invoices: null,
			avgTicket: null,
			state: "report.unavailable.store_too_young.last_year",
		});
	});

	it("explains a year without sales", () => {
		const card = buildYearOverYearCard(
			yearInput({
				stores: [STORE_B],
				date: "2025-06-01",
				coverage: [coverageRow(STORE_B, { history_start: YOUNG_START })],
				compare: compareRows({ [STORE_B]: { current: null, lastYear: null } }),
			}),
		);
		expect(card.headline.value).toBeNull();
		expect(card.notice?.part.key).toBe(yearKeys.noSales);
		expect(card.narrative[0]?.key).toBe(yearKeys.yearOverYear.noData);
	});
});

describe("Năm since opening", () => {
	const sinceCard = yearCards.find((card) => card.id === "since_opening");
	const youngDays = dayRows(STORE_B, YOUNG_START, AS_OF, (date) =>
		date === "2026-09-02" ? null : date >= "2026-10-26" ? 1_500_000 : 1_000_000,
	);

	it("is visible only when a selected store opened within the last 364 days of the year", () => {
		const visible = (scene: Parameters<typeof yearInput>[0]) => {
			const input = yearInput(scene);
			return sinceCard?.visible(input) ?? false;
		};
		expect(visible({ coverage: establishedAndYoung() })).toBe(true);
		expect(
			visible({
				stores: [STORE_A],
				coverage: [coverageRow(STORE_A, { history_start: "2024-12-02" })],
			}),
		).toBe(false);
		expect(
			visible({
				stores: [STORE_B],
				date: "2025-06-01",
				coverage: [coverageRow(STORE_B, { history_start: YOUNG_START })],
			}),
		).toBe(false);
	});

	it("follows the young store week by week from its first day", () => {
		const card = buildSinceOpeningCard(
			yearInput({
				coverage: establishedAndYoung(),
				since: { [STORE_B]: youngDays },
			}),
		);
		expect(card.headline).toEqual({
			value: 1_500_000,
			unit: "money",
			caption: {
				key: yearKeys.since.caption,
				values: { week: { kind: "count", value: 9 } },
			},
		});
		const table = card.tables[0];
		expect(table?.columns.map((column) => column.key)).toEqual([
			"week",
			"from",
			"to",
			"daysWithData",
			"net",
			"avgPerDay",
			"change",
		]);
		expect(table?.rows).toHaveLength(9);
		expect(table?.rows[0]?.cells).toMatchObject({
			week: 1,
			from: YOUNG_START,
			to: "2026-09-06",
			daysWithData: 6,
			net: 6_000_000,
			avgPerDay: 1_000_000,
			change: null,
		});
		expect(card.narrative).toEqual([
			{
				key: yearKeys.since.main,
				values: {
					store: { kind: "text", value: "Store 2" },
					week: { kind: "count", value: 9 },
					value: { kind: "money", value: 1_500_000 },
					delta: { kind: "signedPercent", value: 0.5 },
				},
			},
		]);
		expect(card.notice).toEqual({
			tone: "info",
			part: {
				key: yearKeys.since.notice,
				values: { store: { kind: "text", value: "Store 2" } },
			},
			action: null,
		});
	});

	it("adds a store column and a line per store with several young stores", () => {
		const second = dayRows(STORE_C, "2026-10-05", AS_OF, () => 2_000_000);
		const card = buildSinceOpeningCard(
			yearInput({
				stores: [STORE_A, STORE_B, STORE_C],
				coverage: [
					...establishedAndYoung(),
					coverageRow(STORE_C, { history_start: "2026-10-05" }),
				],
				since: { [STORE_B]: youngDays, [STORE_C]: second },
			}),
		);
		expect(card.tables[0]?.columns[0]?.key).toBe("store");
		expect(card.chart?.series).toHaveLength(2);
		expect(card.chart?.series[1]?.values.slice(0, 4)).toEqual([
			2_000_000, 2_000_000, 2_000_000, 2_000_000,
		]);
		expect(card.notice?.part.values.store).toEqual({
			kind: "text",
			value: "Store 2, Store 3",
		});
	});

	it("waits for the first complete week", () => {
		const card = buildSinceOpeningCard(
			yearInput({
				stores: [STORE_B],
				coverage: [coverageRow(STORE_B, { history_start: "2026-10-30" })],
				since: {
					[STORE_B]: dayRows(STORE_B, "2026-10-30", AS_OF, () => 1_000_000),
				},
			}),
		);
		expect(card.headline.value).toBeNull();
		expect(card.narrative[0]?.key).toBe(yearKeys.since.tooEarly);
		expect(card.notice).not.toBeNull();
	});
});
