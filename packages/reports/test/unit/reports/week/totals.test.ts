import { describe, expect, it } from "vitest";
import {
	type CardModel,
	reportKeys,
	unavailableKey,
} from "../../../../src/index.js";
import {
	buildWeekAvgTicketCard,
	buildWeekTotalsCard,
	weekInvoicesSpec,
	weekKeys,
	weekNetRevenueSpec,
} from "../../../../src/reports/week/index.js";
import { compareRow, coverageRow } from "../../fixtures.js";
import {
	boundsOf,
	type DayPlan,
	RUNNING_WEEK_DAY,
	STORE_A,
	STORE_B,
	weekBlock,
	weekContext,
	weekInput,
	youngStoreCoverage,
} from "./fixtures.js";

function chip(card: CardModel, kind: string) {
	return card.comparisons.find((entry) => entry.kind === kind);
}

const growingMondays: DayPlan = (storeId, date) => ({
	net:
		(storeId === STORE_A ? 600_000 : 400_000) +
		(date === "2026-10-26" ? 500_000 : 0),
	invoices: 10,
	items: 15,
});

describe("Tuần net revenue and invoices", () => {
	it("compares with last week, the 4-week average and the same week last year", () => {
		const card = buildWeekTotalsCard(weekNetRevenueSpec, weekInput());
		expect(card.id).toBe("net_revenue");
		expect(card.titleKey).toBe(weekKeys.net.title);
		expect(card.metricId).toBe("net_revenue");
		expect(card.relatedMetricIds).toEqual(["invoices", "avg_ticket"]);
		expect(card.headline).toEqual({
			value: 7_000_000,
			unit: "money",
			caption: null,
		});
		expect(card.comparisons.map((entry) => entry.kind)).toEqual([
			"previous",
			"average_4_weeks",
			"last_year",
		]);
		expect(chip(card, "previous")?.label.key).toBe(
			reportKeys.compare.previous.week,
		);
		expect(chip(card, "previous")?.change).toBeCloseTo(1 / 6, 10);
		expect(chip(card, "average_4_weeks")?.label).toEqual({
			key: reportKeys.compare.average4Weeks,
			values: { weeks: { kind: "count", value: 4 } },
		});
		expect(chip(card, "average_4_weeks")?.reference).toBe(14_000_000);
		expect(chip(card, "last_year")?.label.key).toBe(
			reportKeys.compare.lastYear.week,
		);
		expect(chip(card, "last_year")?.range).toEqual({
			from: "2025-10-27",
			to: "2025-11-02",
		});
		expect(card.narrative[0]?.key).toBe(weekKeys.net.up);
		expect(card.narrative[0]?.values.period).toEqual({
			kind: "isoWeek",
			value: "2026-W44",
		});
		expect(card.csvName).toBe("tuan-net-revenue-2026-W44");
		expect(card.markers).toEqual({
			provisional: false,
			stale: false,
			verification: "verified",
		});
	});

	it("decomposes net revenue against last week and adds up exactly", () => {
		const card = buildWeekTotalsCard(weekNetRevenueSpec, weekInput());
		expect(card.decomposition?.against).toBe("previous");
		expect(card.decomposition?.basis).toBe("all_stores");
		expect(card.decomposition?.total).toBe(1_000_000);
		const parts = card.decomposition?.parts ?? [];
		expect(parts.map((entry) => entry.factor)).toEqual([
			"invoices",
			"items_per_ticket",
			"avg_item_price",
		]);
		expect(parts.reduce((sum, entry) => sum + entry.effect, 0)).toBe(1_000_000);
	});

	it("tabulates every store against last week, the 4-week average and last year", () => {
		const card = buildWeekTotalsCard(weekNetRevenueSpec, weekInput());
		const table = card.tables[0];
		expect(table?.captionKey).toBe(weekKeys.net.storeTable);
		expect(table?.columns.map((entry) => entry.key)).toEqual([
			"store",
			"value",
			"previous",
			"changePrevious",
			"average",
			"changeAverage",
			"lastYear",
			"changeLastYear",
		]);
		expect(table?.rows.map((row) => row.cells.average)).toEqual([
			7_000_000, 7_000_000,
		]);
		expect(card.chart?.categories).toEqual([
			{ kind: "message", value: weekKeys.periodRow.current },
			{ kind: "message", value: weekKeys.periodRow.previous },
			{ kind: "message", value: weekKeys.periodRow.average4Weeks },
			{ kind: "message", value: weekKeys.periodRow.lastYear },
		]);
		expect(card.chart?.series[0]?.values).toEqual([
			7_000_000, 6_000_000, 14_000_000, 5_500_000,
		]);
	});

	it("names the store that moved most against last week", () => {
		const context = weekContext();
		const compare = [
			...weekBlock(context, null, {
				current: { net_amount: 9_000_000 },
				previous: { net_amount: 7_000_000 },
			}),
			...weekBlock(context, STORE_A, {
				current: { net_amount: 6_500_000 },
				previous: { net_amount: 4_000_000 },
			}),
			...weekBlock(context, STORE_B, {
				current: { net_amount: 2_500_000 },
				previous: { net_amount: 3_000_000 },
			}),
		];
		const card = buildWeekTotalsCard(
			weekNetRevenueSpec,
			weekInput({ compare }),
		);
		const driver = card.narrative.at(-1);
		expect(driver?.key).toBe(reportKeys.clause.driver.store);
		expect(driver?.values).toEqual({
			store: { kind: "text", value: "Store 1" },
			delta: { kind: "moneySigned", value: 2_500_000 },
		});
	});

	it("names the weekday that moved most for one store", () => {
		const card = buildWeekTotalsCard(
			weekNetRevenueSpec,
			weekInput({ stores: [STORE_A], plan: growingMondays }),
		);
		expect(card.tables[0]?.captionKey).toBe(weekKeys.net.periodTable);
		const driver = card.narrative.at(-1);
		expect(driver?.key).toBe(reportKeys.clause.driver.weekday);
		expect(driver?.values).toEqual({
			weekday: { kind: "weekday", value: "1" },
			delta: { kind: "moneySigned", value: 500_000 },
		});
	});

	it("lists this week, last week, the 4-week average and last year for one store", () => {
		const card = buildWeekTotalsCard(
			weekNetRevenueSpec,
			weekInput({ stores: [STORE_A] }),
		);
		const table = card.tables[0];
		expect(table?.columns.map((entry) => entry.key)).toEqual([
			"period",
			"net",
			"invoices",
			"avgTicket",
		]);
		expect(table?.rows.map((row) => row.cells.period)).toEqual([
			weekKeys.periodRow.current,
			weekKeys.periodRow.previous,
			weekKeys.periodRow.average4Weeks,
			weekKeys.periodRow.lastYear,
		]);
		expect(table?.rows[2]?.cells).toEqual({
			period: weekKeys.periodRow.average4Weeks,
			net: 7_000_000,
			invoices: 140,
			avgTicket: 50_000,
		});
	});

	it("shows the young store's state on last year and compares like for like", () => {
		const context = weekContext();
		const bounds = boundsOf(context);
		const input = weekInput({
			coverage: youngStoreCoverage("2026-08-31"),
			compareLfl: {
				last_year: [
					compareRow("current", bounds.current.from, bounds.current.to, {
						net_amount: 4_000_000,
					}),
					compareRow("previous", bounds.previous.from, bounds.previous.to),
					compareRow("last_year", bounds.last_year.from, bounds.last_year.to, {
						net_amount: 3_200_000,
					}),
				],
			},
		});
		const card = buildWeekTotalsCard(weekNetRevenueSpec, input);
		const lastYear = chip(card, "last_year");
		expect(lastYear?.basis).toBe("like_for_like");
		expect(lastYear?.label.key).toBe(reportKeys.compare.likeForLike);
		expect(lastYear?.change).toBeCloseTo(0.25, 10);
		expect(card.narrative[1]?.key).toBe(reportKeys.clause.coverage.youngStore);
		const states = card.tables[0]?.rows.map((row) => row.cells.state);
		expect(states).toEqual([
			null,
			unavailableKey("store_too_young", "last_year"),
		]);
	});

	it("reads chưa có dữ liệu năm trước for the young store alone", () => {
		const card = buildWeekTotalsCard(
			weekNetRevenueSpec,
			weekInput({
				stores: [STORE_B],
				coverage: [coverageRow(STORE_B, { history_start: "2026-08-31" })],
			}),
		);
		expect(chip(card, "last_year")?.unavailable).toBe("store_too_young");
		expect(chip(card, "previous")?.unavailable).toBeNull();
		expect(chip(card, "average_4_weeks")?.unavailable).toBeNull();
		const lastYearRow = card.tables[0]?.rows.find(
			(row) => row.id === "last_year",
		);
		expect(lastYearRow?.cells.state).toBe(
			unavailableKey("store_too_young", "last_year"),
		);
	});

	it("marks a running week with đến hết and compares the same elapsed days", () => {
		const input = weekInput({ date: RUNNING_WEEK_DAY });
		const card = buildWeekTotalsCard(weekInvoicesSpec, input);
		expect(card.headline.caption).toEqual({
			key: weekKeys.partial,
			values: { end: { kind: "date", value: "2026-11-03" } },
		});
		expect(chip(card, "previous")?.range).toEqual({
			from: "2026-10-26",
			to: "2026-10-27",
		});
		expect(card.decomposition).toBeNull();
		expect(card.relatedMetricIds).toEqual([]);
		expect(card.csvName).toBe("tuan-invoices-2026-W45");
	});

	it("handles a week of one day when the as-of day is a Monday", () => {
		const input = weekInput({
			date: "2026-11-02",
			asOf: "2026-11-02",
			stores: [STORE_A],
		});
		expect(input.context.period.elapsedDays).toBe(1);
		const card = buildWeekTotalsCard(weekNetRevenueSpec, input);
		expect(chip(card, "previous")?.range).toEqual({
			from: "2026-10-26",
			to: "2026-10-26",
		});
		expect(chip(card, "average_4_weeks")?.reference).toBe(1_000_000);
		expect(chip(card, "average_4_weeks")?.range).toEqual({
			from: "2026-10-05",
			to: "2026-10-26",
		});
		expect(card.headline.caption?.key).toBe(weekKeys.partial);
	});

	it("follows ISO week 53 and the weeks around it", () => {
		const input = weekInput({ date: "2026-12-30", asOf: "2027-01-05" });
		expect(input.context.period.key).toBe("2026-W53");
		expect(input.context.period.from).toBe("2026-12-28");
		expect(input.context.period.to).toBe("2027-01-03");
		const card = buildWeekTotalsCard(weekNetRevenueSpec, input);
		expect(card.csvName).toBe("tuan-net-revenue-2026-W53");
		expect(chip(card, "previous")?.range).toEqual({
			from: "2026-12-21",
			to: "2026-12-27",
		});
		expect(chip(card, "last_year")?.range).toEqual({
			from: "2025-12-29",
			to: "2026-01-04",
		});
		expect(chip(card, "average_4_weeks")?.range).toEqual({
			from: "2026-11-30",
			to: "2026-12-27",
		});
		const next = weekInput({ date: "2027-01-04", asOf: "2027-01-12" });
		expect(next.context.period.key).toBe("2027-W01");
		const nextCard = buildWeekTotalsCard(weekNetRevenueSpec, next);
		expect(chip(nextCard, "previous")?.range).toEqual({
			from: "2026-12-28",
			to: "2027-01-03",
		});
	});

	it("shows no data with a notice when the week has no invoices", () => {
		const context = weekContext({ stores: [STORE_A] });
		const empty = { days_with_data: 0, net_amount: null, invoices: null };
		const card = buildWeekTotalsCard(
			weekNetRevenueSpec,
			weekInput({
				stores: [STORE_A],
				plan: () => null,
				compare: [
					...weekBlock(context, null, { current: empty }),
					...weekBlock(context, STORE_A, { current: empty }),
				],
			}),
		);
		expect(card.headline.value).toBeNull();
		expect(card.narrative).toEqual([
			{
				key: weekKeys.net.noData,
				values: { period: { kind: "isoWeek", value: "2026-W44" } },
			},
		]);
		expect(card.notice?.part.key).toBe(weekKeys.noDataNotice);
	});
});

describe("Tuần average ticket", () => {
	it("pools the 4-week ticket and decomposes against last week", () => {
		const card = buildWeekAvgTicketCard(weekInput());
		expect(card.headline.value).toBe(50_000);
		expect(card.relatedMetricIds).toEqual([
			"items_per_ticket",
			"avg_item_price",
		]);
		expect(chip(card, "average_4_weeks")?.reference).toBe(50_000);
		expect(chip(card, "average_4_weeks")?.current).toBe(50_000);
		expect(card.decomposition?.metric).toBe("avg_ticket");
		expect(card.decomposition?.against).toBe("previous");
		const parts = card.decomposition?.parts ?? [];
		const total = card.decomposition?.total ?? 0;
		expect(
			Math.round(parts.reduce((sum, entry) => sum + entry.effect, 0) * 100),
		).toBe(Math.round(total * 100));
		expect(card.narrative.at(-1)?.key).toMatch(
			/^report\.clause\.decomposition\./,
		);
		const table = card.tables[0];
		expect(table?.columns.map((entry) => entry.key)).toEqual([
			"period",
			"avgTicket",
			"itemsPerTicket",
			"avgItemPrice",
		]);
		expect(table?.rows[2]?.cells).toEqual({
			period: weekKeys.periodRow.average4Weeks,
			avgTicket: 50_000,
			itemsPerTicket: 1.5,
			avgItemPrice: 33_333.33,
		});
		expect(card.chart).toBeNull();
	});

	it("explains a missing 4-week reference in the state column", () => {
		const card = buildWeekAvgTicketCard(
			weekInput({
				stores: [STORE_B],
				coverage: [coverageRow(STORE_B, { history_start: "2026-10-12" })],
			}),
		);
		expect(chip(card, "average_4_weeks")?.unavailable).toBe("store_too_young");
		const row = card.tables[0]?.rows.find(
			(entry) => entry.id === "average_4_weeks",
		);
		expect(row?.cells.state).toBe(
			unavailableKey("store_too_young", "average_4_weeks"),
		);
	});
});
