import { describe, expect, it } from "vitest";
import { coverageModel, reportKeys } from "../../../../src/index.js";
import {
	buildNewItemsCard,
	buildParetoCard,
	buildSizeMixCard,
	monthCalls,
	monthFollowUpCalls,
	monthKeys,
	paretoCount,
	paretoOf,
	sizeGroups,
} from "../../../../src/reports/month/index.js";
import { coverageRow } from "../../fixtures.js";
import {
	itemRow,
	metricRows,
	monthContext,
	monthInput,
	STORE_A,
	STORE_B,
	youngAtPreviousMonth,
} from "./fixtures.js";

const net = (row: { net_amount: number }) => row.net_amount;
const quantity = (row: { quantity: number }) => row.quantity;

describe("Tháng Pareto", () => {
	it("counts the items that reach exactly 80 % of item revenue", () => {
		const rows = [
			itemRow("A", { net_amount: 500_000 }),
			itemRow("B", { net_amount: 300_000 }),
			itemRow("C", { net_amount: 150_000 }),
			itemRow("D", { net_amount: 50_000 }),
		];
		const entries = paretoOf(rows, net, quantity);
		expect(entries.map((entry) => entry.cumulative)).toEqual([
			0.5, 0.8, 0.95, 1,
		]);
		expect(paretoCount(entries)).toBe(2);
		const card = buildParetoCard(monthInput({ items: rows }));
		expect(card.headline).toMatchObject({ value: 2, unit: "count" });
		expect(card.headline.caption?.key).toBe(monthKeys.pareto.caption);
		expect(card.chart?.markLines).toEqual([
			{
				label: { key: monthKeys.pareto.line, values: {} },
				value: 0.8,
				axis: "right",
			},
		]);
		expect(card.chart?.rightUnit).toBe("fraction");
		expect(card.chart?.series[1]?.axis).toBe("right");
		expect(card.narrative[0]?.values.item).toEqual({
			kind: "text",
			value: "Item A",
		});
		expect(card.markers.stale).toBe(false);
	});

	it("draws the top 20 items and ends the cumulative line at the rest of the menu", () => {
		const rows = Array.from({ length: 25 }, (_, index) =>
			itemRow(`I${String(index).padStart(2, "0")}`, {
				net_amount: 100_000,
				quantity: 25 - index,
			}),
		);
		const card = buildParetoCard(monthInput({ items: rows }));
		expect(card.headline.value).toBe(20);
		expect(card.tables[0]?.rows).toHaveLength(25);
		expect(card.chart?.categories).toHaveLength(21);
		expect(card.chart?.categories.at(-1)).toEqual({
			kind: "message",
			value: monthKeys.pareto.otherItems,
		});
		expect(card.chart?.series[0]?.values.at(-1)).toBeNull();
		expect(card.chart?.series[1]?.values.at(-1)).toBe(1);
		expect(card.chart?.series[1]?.values[19]).toBe(0.8);
	});

	it("compares the count with the same days of last month", () => {
		const card = buildParetoCard(
			monthInput({
				items: [
					itemRow("A", { net_amount: 400_000, compare_net_amount: 900_000 }),
					itemRow("B", { net_amount: 300_000, compare_net_amount: 50_000 }),
					itemRow("C", { net_amount: 300_000, compare_net_amount: 50_000 }),
				],
			}),
		);
		expect(card.headline.value).toBe(3);
		expect(card.comparisons[0]).toMatchObject({
			kind: "previous",
			current: 3,
			reference: 1,
			change: 2,
		});
		expect(card.narrative[1]).toMatchObject({
			key: monthKeys.pareto.previous,
			values: { count: { kind: "count", value: 1 } },
		});
	});

	it("leaves out unsold items and marks stale aggregates", () => {
		const card = buildParetoCard(
			monthInput({
				coverage: [
					coverageRow(STORE_A, { stale_days: 2 }),
					coverageRow(STORE_B),
				],
				items: [itemRow("A", { net_amount: 0, quantity: 0 })],
			}),
		);
		expect(card.headline.value).toBeNull();
		expect(card.chart).toBeNull();
		expect(card.narrative[0]?.key).toBe(monthKeys.pareto.noData);
		expect(card.markers.stale).toBe(true);
	});
});

describe("Tháng size mix", () => {
	const sized = [
		itemRow("TS-M", {
			item_name: "Trà sữa (M)",
			base_name: "Trà sữa",
			size_label: "M",
			quantity: 30,
			compare_quantity: 20,
		}),
		itemRow("TS-L", {
			item_name: "Trà sữa (L)",
			base_name: "Trà sữa",
			size_label: "L",
			quantity: 20,
			compare_quantity: 20,
		}),
		itemRow("CF-M", {
			item_name: "Cà phê (M)",
			base_name: "Cà phê",
			size_label: "M",
			quantity: 4,
			compare_quantity: 3,
		}),
		itemRow("CF-L", {
			item_name: "Cà phê (L)",
			base_name: "Cà phê",
			size_label: "L",
			quantity: 1,
			compare_quantity: 3,
		}),
		itemRow("BANH", { item_name: "Bánh", quantity: 9 }),
	];

	it("groups sized items by drink and compares the L share in points", () => {
		const groups = sizeGroups(sized);
		expect(groups.map((group) => group.drink)).toEqual(["Trà sữa", "Cà phê"]);
		expect(groups[0]).toMatchObject({
			largeQuantity: 20,
			sizedQuantity: 50,
			largeShare: 0.4,
			previousShare: 0.5,
		});
		expect(groups[0]?.change).toBeCloseTo(-0.1, 10);
		const card = buildSizeMixCard(
			monthInput({
				items: sized,
				metrics: metricRows("size_l_share", 0.381818, 0.5, 0.42),
			}),
		);
		expect(card.headline).toMatchObject({ value: 0.381818, unit: "fraction" });
		expect(card.comparisons.map((entry) => entry.unit)).toEqual([
			"fraction",
			"fraction",
		]);
		expect(card.narrative[0]?.key).toBe(monthKeys.size.down);
		expect(card.narrative[0]?.values.points).toEqual({
			kind: "pointMagnitude",
			value: 11.82,
		});
		expect(card.narrative[1]).toMatchObject({
			key: reportKeys.clause.driver.item,
			values: { item: { kind: "text", value: "Trà sữa" } },
		});
		expect(card.chart?.categories).toHaveLength(2);
		expect(card.markers).toMatchObject({ stale: false });
	});

	it("explains an unmeasured size share instead of showing zero", () => {
		const card = buildSizeMixCard(
			monthInput({
				items: [itemRow("BANH")],
				metrics: metricRows("size_l_share", null, null, null),
			}),
		);
		expect(card.headline.value).toBeNull();
		expect(card.notice).toMatchObject({
			tone: "info",
			part: { key: monthKeys.size.notMeasured },
		});
		expect(card.narrative[0]?.key).toBe(monthKeys.size.noData);
		expect(card.chart).toBeNull();
	});
});

describe("Tháng new items", () => {
	it("counts items first sold this month and ranks them among all items", () => {
		const card = buildNewItemsCard(
			monthInput({
				items: [
					itemRow("OLD", { net_amount: 900_000 }),
					itemRow("NEW-1", {
						net_amount: 400_000,
						first_sold_on: "2026-11-02",
						net_share: 0.25,
					}),
					itemRow("NEW-0", {
						net_amount: 0,
						quantity: 0,
						first_sold_on: "2026-11-03",
					}),
					itemRow("NEW-2", {
						net_amount: 100_000,
						first_sold_on: "2026-11-01",
					}),
				],
			}),
		);
		expect(card.headline).toMatchObject({ value: 2, unit: "count" });
		expect(card.headline.caption?.values.item).toEqual({
			kind: "text",
			value: "Item NEW-1",
		});
		expect(card.narrative[0]).toMatchObject({
			key: monthKeys.newItems.main,
			values: {
				rank: { kind: "count", value: 2 },
				total: { kind: "count", value: 3 },
			},
		});
		expect(card.tables[0]?.rows.map((row) => row.id)).toEqual([
			"NEW-1",
			"NEW-2",
		]);
		expect(card.notice).toBeNull();
	});

	it("leaves out the young store's items by reading only the covered stores", () => {
		const coverage = youngAtPreviousMonth();
		const reportContext = monthContext();
		const followUps = monthFollowUpCalls(
			reportContext,
			coverageModel(coverage, reportContext),
		);
		expect(
			followUps.find((spec) => spec.key === monthCalls.itemsCovered)?.args,
		).toEqual({
			store_ids: [STORE_A],
			from_date: "2026-11-01",
			to_date: "2026-11-03",
			compare_from: "2026-10-01",
			compare_to: "2026-10-03",
		});
		const card = buildNewItemsCard(
			monthInput({
				coverage,
				items: [
					itemRow("YOUNG", {
						first_sold_on: "2026-11-01",
						net_amount: 900_000,
					}),
				],
				itemsCovered: [itemRow("OLD", { net_amount: 500_000 })],
			}),
		);
		expect(card.headline.value).toBe(0);
		expect(card.narrative.map((entry) => entry.key)).toEqual([
			monthKeys.newItems.none,
			reportKeys.clause.coverage.likeForLike,
		]);
	});

	it("does not plan the covered call when every store has the previous month", () => {
		const reportContext = monthContext();
		const followUps = monthFollowUpCalls(
			reportContext,
			coverageModel(
				[coverageRow(STORE_A), coverageRow(STORE_B)],
				reportContext,
			),
		);
		expect(followUps).toEqual([]);
	});

	it("cannot tell new items apart for a store that opened this month", () => {
		const card = buildNewItemsCard(
			monthInput({
				stores: [STORE_B],
				coverage: [coverageRow(STORE_B, { history_start: "2026-11-01" })],
				items: [itemRow("ANY", { first_sold_on: "2026-11-01" })],
			}),
		);
		expect(card.headline.value).toBeNull();
		expect(card.notice).toMatchObject({
			tone: "info",
			part: { key: monthKeys.newItems.tooYoung },
		});
		expect(card.narrative[0]?.key).toBe(monthKeys.newItems.unknown);
		expect(card.tables[0]?.rows).toEqual([]);
	});
});
