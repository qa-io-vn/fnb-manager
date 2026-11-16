import { describe, expect, it } from "vitest";
import { TOTALS_LIKE_FOR_LIKE_KEYS } from "../../../../src/themes/definition.js";
import { buildDiscountCostCard } from "../../../../src/themes/promotions/cards/discount-cost.js";
import { promotionsKeys } from "../../../../src/themes/promotions/keys.js";
import { promotionsCalls } from "../../../../src/themes/promotions/support.js";
import { coverageRow, STORE_A, STORE_B } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import { cardInput, promotionRow, seriesRow, threeRanges } from "./support.js";

const promotions = [
	promotionRow({
		promotion_kind: "item",
		promotion_key: "KM-01",
		promotion_name: "Mua 2 tặng 1",
		invoices: 120,
		discount_amount: 2_500_000,
		first_used_on: "2026-10-10",
		last_used_on: "2026-11-04",
	}),
	promotionRow({
		promotion_kind: "voucher",
		promotion_key: "Voucher 20k",
		promotion_name: "Voucher 20k",
		invoices: 100,
		lines: null,
		discount_amount: 2_000_000,
		first_used_on: "2026-10-12",
		last_used_on: "2026-11-05",
	}),
	promotionRow({
		promotion_kind: "bill",
		promotion_key: "unnamed",
		promotion_name: null,
		invoices: 30,
		lines: null,
		discount_amount: 1_500_000,
		first_used_on: "2026-10-09",
		last_used_on: "2026-11-01",
	}),
];

const current = {
	discount_amount: 6_000_000,
	item_discount_amount: 2_500_000,
	bill_discount_amount: 1_500_000,
	voucher_amount: 2_000_000,
	discount_rate: 0.04,
};

describe("the Khuyến mãi discount cost card", () => {
	it("sums the discounts with their rate of gross revenue and compares cost and rate with the previous range and last year", () => {
		const context = themeContext("28d", [STORE_A, STORE_B]);
		const card = buildDiscountCostCard(
			cardInput(
				context,
				{
					[promotionsCalls.totals]: threeRanges(context, {
						current,
						lastYear: { discount_amount: 4_000_000, discount_rate: 0.03 },
					}),
					[promotionsCalls.promotions]: promotions,
					[promotionsCalls.series]: [
						seriesRow(context.range.from, {
							item_discount_amount: 100_000,
							bill_discount_amount: 50_000,
							voucher_amount: 20_000,
						}),
					],
				},
				[coverageRow(STORE_A), coverageRow(STORE_B)],
			),
		);
		expect(card.id).toBe("discount_cost");
		expect(card.metricId).toBe("discount_cost");
		expect(card.relatedMetricIds).toEqual(["discount_rate", "gross_revenue"]);
		expect(card.headline.value).toBe(6_000_000);
		expect(card.headline.unit).toBe("money");
		expect(card.headline.caption).toEqual({
			key: promotionsKeys.discountCost.caption,
			values: { rate: { kind: "percent", value: 0.04 } },
		});
		expect(
			card.comparisons.map((entry) => [
				entry.kind,
				entry.unit ?? "money",
				entry.label.key,
			]),
		).toEqual([
			["previous", "money", "theme.compare.previousWeeks"],
			["last_year", "money", "theme.compare.lastYear"],
			["previous", "fraction", promotionsKeys.discountCost.rateCompare],
			["last_year", "fraction", promotionsKeys.discountCost.rateCompare],
		]);
		expect(card.comparisons[0]?.change).toBe(0.2);
		expect(card.comparisons[1]?.change).toBe(0.5);
		expect(card.comparisons[2]?.difference).toBeCloseTo(0.005517, 6);
		expect(card.comparisons[3]?.difference).toBeCloseTo(0.01, 6);
		expect(card.narrative.map((part) => part.key)).toEqual([
			promotionsKeys.discountCost.up,
			promotionsKeys.discountCost.largest,
		]);
		expect(card.narrative[1]?.values).toEqual({
			promotion: { kind: "text", value: "Mua 2 tặng 1" },
			amount: { kind: "money", value: 2_500_000 },
			share: { kind: "percent", value: 0.416667 },
		});
		const [table, components] = card.tables;
		expect(table?.columns.map((column) => column.key)).toEqual([
			"kind",
			"promotion",
			"invoices",
			"discount",
			"costShare",
			"firstUsed",
			"lastUsed",
		]);
		expect(table?.rows.map((row) => row.cells)).toEqual([
			{
				kind: "report.promotionKind.item",
				promotion: "Mua 2 tặng 1",
				invoices: 120,
				discount: 2_500_000,
				costShare: 0.416667,
				firstUsed: "2026-10-10",
				lastUsed: "2026-11-04",
			},
			{
				kind: "report.promotionKind.voucher",
				promotion: "Voucher 20k",
				invoices: 100,
				discount: 2_000_000,
				costShare: 0.333333,
				firstUsed: "2026-10-12",
				lastUsed: "2026-11-05",
			},
			{
				kind: "report.promotionKind.bill",
				promotion: null,
				invoices: 30,
				discount: 1_500_000,
				costShare: 0.25,
				firstUsed: "2026-10-09",
				lastUsed: "2026-11-01",
			},
		]);
		expect(components?.rows.map((row) => [row.id, row.cells])).toEqual([
			[
				"item",
				{
					component: "report.promotionKind.item",
					current: 2_500_000,
					previous: 2_000_000,
					change: 0.25,
				},
			],
			[
				"bill",
				{
					component: "report.promotionKind.bill",
					current: 1_500_000,
					previous: 1_500_000,
					change: 0,
				},
			],
			[
				"voucher",
				{
					component: "report.promotionKind.voucher",
					current: 2_000_000,
					previous: 1_500_000,
					change: (2_000_000 - 1_500_000) / 1_500_000,
				},
			],
		]);
		expect(card.chart?.labelKey).toBe(promotionsKeys.discountCost.chartDay);
		expect(
			card.chart?.series.map((series) => [series.stack, series.values]),
		).toEqual([
			["discount", [100_000]],
			["discount", [50_000]],
			["discount", [20_000]],
		]);
		expect(card.markers).toEqual({
			provisional: false,
			stale: false,
			verification: "verified",
		});
		expect(card.csvName).toMatch(
			/^khuyen-mai-discount_cost-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/,
		);
	});

	it("names an unnamed promotion by its kind when it costs the most", () => {
		const context = themeContext("28d", [STORE_A]);
		const card = buildDiscountCostCard(
			cardInput(
				context,
				{
					[promotionsCalls.totals]: threeRanges(context, { current }),
					[promotionsCalls.promotions]: [
						promotionRow({
							promotion_kind: "bill",
							promotion_key: "unnamed",
							promotion_name: null,
							discount_amount: 4_000_000,
						}),
						promotionRow({ discount_amount: 2_000_000 }),
					],
				},
				[coverageRow(STORE_A)],
			),
		);
		expect(card.narrative.at(-1)).toEqual({
			key: promotionsKeys.discountCost.largestUnnamed,
			values: {
				kind: { kind: "message", value: "report.promotionKind.bill" },
				amount: { kind: "money", value: 4_000_000 },
				share: { kind: "percent", value: 0.666667 },
			},
		});
	});

	it("shows a measured zero with its own sentence when nothing was discounted", () => {
		const context = themeContext("28d", [STORE_A]);
		const card = buildDiscountCostCard(
			cardInput(
				context,
				{
					[promotionsCalls.totals]: threeRanges(context, {
						current: {
							discount_amount: 0,
							item_discount_amount: 0,
							bill_discount_amount: 0,
							voucher_amount: 0,
							discount_rate: 0,
						},
					}),
					[promotionsCalls.promotions]: [],
				},
				[coverageRow(STORE_A)],
			),
		);
		expect(card.headline.value).toBe(0);
		expect(card.narrative.map((part) => part.key)).toEqual([
			promotionsKeys.discountCost.none,
		]);
		expect(card.tables.map((table) => table.captionKey)).toEqual([
			promotionsKeys.discountCost.componentsTable,
		]);
	});

	it("says there are no invoices and draws nothing without data", () => {
		const context = themeContext("28d", [STORE_A]);
		const card = buildDiscountCostCard(
			cardInput(
				context,
				{
					[promotionsCalls.totals]: threeRanges(context, {
						current: { days_with_data: 0, discount_amount: null },
					}),
				},
				[coverageRow(STORE_A)],
			),
		);
		expect(card.headline.value).toBeNull();
		expect(card.headline.caption).toBeNull();
		expect(card.narrative.map((part) => part.key)).toEqual([
			promotionsKeys.discountCost.noData,
		]);
		expect(card.tables).toEqual([]);
		expect(card.chart).toBeNull();
	});

	it("compares like for like while one store lacks the previous range, the rate chip included", () => {
		const context = themeContext("28d", [STORE_A, STORE_B]);
		const card = buildDiscountCostCard(
			cardInput(
				context,
				{
					[promotionsCalls.totals]: threeRanges(context, { current }),
					[TOTALS_LIKE_FOR_LIKE_KEYS.previous]: threeRanges(context, {
						current: { discount_amount: 4_400_000, discount_rate: 0.04 },
						previous: { discount_amount: 4_000_000, discount_rate: 0.035 },
					}),
				},
				[
					coverageRow(STORE_A),
					coverageRow(STORE_B, { history_start: context.range.from }),
				],
			),
		);
		const previous = card.comparisons.filter(
			(entry) => entry.kind === "previous",
		);
		expect(previous.map((entry) => entry.basis)).toEqual([
			"like_for_like",
			"like_for_like",
		]);
		expect(previous[0]?.change).toBe(0.1);
		expect(previous[1]?.difference).toBeCloseTo(0.005, 6);
		expect(previous[1]?.label.values.reference).toMatchObject({
			kind: "part",
			value: { key: "report.compare.likeForLike" },
		});
		expect(card.narrative[1]?.key).toBe(
			"report.clause.coverage.likeForLikeValues",
		);
	});

	it("tells the young store's missing last year apart from missing data", () => {
		const context = themeContext("28d", [STORE_B]);
		const card = buildDiscountCostCard(
			cardInput(
				context,
				{ [promotionsCalls.totals]: threeRanges(context, { current }) },
				[coverageRow(STORE_B, { history_start: "2026-03-01" })],
			),
		);
		expect(
			card.comparisons
				.filter((entry) => entry.kind === "last_year")
				.map((entry) => entry.unavailable),
		).toEqual(["store_too_young", "store_too_young"]);
		expect(
			card.comparisons
				.filter((entry) => entry.kind === "previous")
				.map((entry) => entry.unavailable),
		).toEqual([null, null]);
	});

	it("marks lagging aggregates and an overlapping catch-up as stale and carries the verification", () => {
		const context = themeContext("28d", [STORE_A]);
		const lagging = buildDiscountCostCard(
			cardInput(
				context,
				{ [promotionsCalls.totals]: threeRanges(context, { current }) },
				[coverageRow(STORE_A, { stale_days: 2, unmatched_days: 1 })],
			),
		);
		expect(lagging.markers).toMatchObject({
			stale: true,
			verification: "unverified",
		});
		const catchingUp = buildDiscountCostCard(
			cardInput(
				{
					...context,
					catchUpPending: { from: context.range.to, to: context.range.to },
				},
				{ [promotionsCalls.totals]: threeRanges(context, { current }) },
				[coverageRow(STORE_A)],
			),
		);
		expect(catchingUp.markers.stale).toBe(true);
		const sample = buildDiscountCostCard(
			cardInput(
				themeContext("28d", [STORE_A], { sample: true }),
				{ [promotionsCalls.totals]: threeRanges(context, { current }) },
				[coverageRow(STORE_A)],
			),
		);
		expect(sample.markers.verification).toBe("sample");
	});

	it("stacks the components by week beyond five weeks", () => {
		const context = themeContext("91d", [STORE_A]);
		const card = buildDiscountCostCard(
			cardInput(
				context,
				{
					[promotionsCalls.totals]: threeRanges(context, { current }),
					[promotionsCalls.series]: [seriesRow(context.range.from)],
				},
				[coverageRow(STORE_A)],
			),
		);
		expect(card.chart?.labelKey).toBe(promotionsKeys.discountCost.chartWeek);
	});
});
