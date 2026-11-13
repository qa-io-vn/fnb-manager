import { describe, expect, it } from "vitest";
import { reportKeys, roleKey } from "../../../../src/index.js";
import {
	buildCategoryMixCard,
	buildMoversCard,
	buildPromotionsCard,
	categoryShares,
	MIN_VELOCITY_QUANTITY,
	moversOf,
	UNCATEGORISED_ID,
	weekKeys,
} from "../../../../src/reports/week/index.js";
import { coverageRow } from "../../fixtures.js";
import {
	itemRow,
	metricRows,
	promotionRow,
	STORE_A,
	STORE_B,
	velocityRow,
	weekContext,
	weekInput,
	youngStoreCoverage,
} from "./fixtures.js";

const velocity = [
	velocityRow("riser-big", 30, 10),
	velocityRow("riser-small", 22, 20),
	velocityRow("faller-thin-recent", 9, 10),
	velocityRow("riser-thin-prior", 40, 9),
	velocityRow("faller", 5, 20),
	velocityRow("faller-gone", 0, 12),
	velocityRow("faller-thin", 1, 9),
	velocityRow("steady", 15, 15),
	velocityRow("new-one", 25, 0, 1_500_000),
	velocityRow("new-two", 12, 0, 600_000),
	velocityRow("new-three", 10, 0, 900_000),
	velocityRow("new-four", 14, 0, 300_000),
	velocityRow("new-thin", 9, 0, 2_000_000),
];

describe("Tuần movers", () => {
	it("applies the quantity thresholds to risers, fallers and new items", () => {
		const movers = moversOf(velocity);
		expect(MIN_VELOCITY_QUANTITY).toBe(10);
		expect(movers.risers.map((row) => row.item_external_id)).toEqual([
			"riser-big",
			"riser-small",
		]);
		expect(movers.fallers.map((row) => row.item_external_id)).toEqual([
			"faller-gone",
			"faller",
			"faller-thin-recent",
		]);
		expect(movers.newItems.map((row) => row.item_external_id)).toEqual([
			"new-one",
			"new-three",
			"new-two",
		]);
	});

	it("keeps five risers and five fallers at most", () => {
		const many = Array.from({ length: 8 }, (_, index) => [
			velocityRow(`up-${index}`, 20 + index, 10),
			velocityRow(`down-${index}`, 9 - index, 10),
		]).flat();
		const movers = moversOf(many);
		expect(movers.risers.map((row) => row.item_external_id)).toEqual([
			"up-7",
			"up-6",
			"up-5",
			"up-4",
			"up-3",
		]);
		expect(movers.fallers.map((row) => row.item_external_id)).toEqual([
			"down-7",
			"down-6",
			"down-5",
			"down-4",
			"down-3",
		]);
	});

	it("leads with the top riser and tabulates the three groups", () => {
		const card = buildMoversCard(weekInput({ velocity }));
		expect(card.metricId).toBe("item_velocity");
		expect(card.headline).toEqual({
			value: 200,
			unit: "percentChange",
			caption: {
				key: weekKeys.movers.caption,
				values: { item: { kind: "text", value: "Item riser-big" } },
			},
		});
		expect(card.subtitle).toEqual({
			key: weekKeys.movers.window,
			values: { end: { kind: "date", value: "2026-11-01" } },
		});
		expect(card.narrative[0]?.key).toBe(weekKeys.movers.main);
		expect(card.narrative[0]?.values.faller).toEqual({
			kind: "text",
			value: "Item faller-gone",
		});
		expect(card.narrative[1]?.key).toBe(weekKeys.movers.newItem);
		const groups = card.tables[0]?.rows.map((row) => row.cells.group);
		expect(groups).toEqual([
			weekKeys.movers.group.up,
			weekKeys.movers.group.up,
			weekKeys.movers.group.down,
			weekKeys.movers.group.down,
			weekKeys.movers.group.down,
			weekKeys.movers.group.new,
			weekKeys.movers.group.new,
			weekKeys.movers.group.new,
		]);
		expect(card.markers.stale).toBe(false);
		expect(card.notice).toBeNull();
	});

	it("asks for eight weeks of data when no store has them", () => {
		const card = buildMoversCard(
			weekInput({
				stores: [STORE_B],
				coverage: [coverageRow(STORE_B, { history_start: "2026-09-15" })],
				velocity,
			}),
		);
		expect(card.headline.value).toBeNull();
		expect(card.notice?.part.key).toBe(weekKeys.movers.buildingBaseline);
		expect(card.narrative[0]?.key).toBe(
			weekKeys.movers.buildingBaselineSentence,
		);
		expect(card.tables[0]?.rows).toEqual([]);
	});

	it("reads the covered stores' velocity like for like", () => {
		const card = buildMoversCard(
			weekInput({
				coverage: youngStoreCoverage("2026-09-15"),
				velocity: [velocityRow("all-stores", 50, 10)],
				velocityCovered: velocity,
			}),
		);
		expect(card.headline.value).toBe(200);
		expect(card.headline.caption).toEqual({
			key: weekKeys.movers.captionLikeForLike,
			values: {
				item: { kind: "text", value: "Item riser-big" },
				covered: { kind: "count", value: 1 },
				total: { kind: "count", value: 2 },
			},
		});
	});

	it("explains an empty headline when nothing rose", () => {
		const card = buildMoversCard(
			weekInput({ velocity: [velocityRow("faller", 5, 20)] }),
		);
		expect(card.headline.value).toBeNull();
		expect(card.notice?.part.key).toBe(weekKeys.movers.noRiser);
		expect(card.narrative[0]?.key).toBe(weekKeys.movers.fallersOnly);
	});

	it("marks the card while item aggregates catch up", () => {
		const card = buildMoversCard(
			weekInput({
				coverage: [
					coverageRow(STORE_A, { history_start: "2025-01-01", stale_days: 1 }),
					coverageRow(STORE_B, { history_start: "2025-01-01" }),
				],
				velocity,
			}),
		);
		expect(card.markers.stale).toBe(true);
	});
});

const items = [
	itemRow("tea-1", {
		item_type_external_id: "TYPE-001",
		item_type_name: "Trà sữa",
		role: "drink",
		net_amount: 600_000,
		compare_net_amount: 300_000,
		quantity: 12,
	}),
	itemRow("tea-2", {
		item_type_external_id: "TYPE-001",
		item_type_name: "Trà sữa",
		role: "drink",
		net_amount: 200_000,
		compare_net_amount: 300_000,
		quantity: 4,
	}),
	itemRow("pearl", {
		item_type_external_id: "TYPE-007",
		item_type_name: "Topping",
		role: "topping",
		net_amount: 100_000,
		compare_net_amount: 200_000,
		quantity: 20,
	}),
	itemRow("loose", {
		item_type_external_id: null,
		item_type_name: null,
		role: null,
		net_amount: 100_000,
		compare_net_amount: 200_000,
		quantity: 2,
	}),
];

describe("Tuần category mix", () => {
	it("groups items by type, with a null type uncategorised", () => {
		const shares = categoryShares(items);
		expect(shares.map((entry) => entry.id)).toEqual([
			"type:TYPE-001",
			"type:TYPE-007",
			UNCATEGORISED_ID,
		]);
		expect(shares[0]).toMatchObject({
			typeId: "TYPE-001",
			name: "Trà sữa",
			role: "drink",
			net: 800_000,
			compareNet: 600_000,
			quantity: 16,
			share: 0.8,
			lastWeekShare: 0.6,
			shareChange: 0.2,
		});
		expect(shares[2]).toMatchObject({
			typeId: null,
			name: null,
			share: 0.1,
			lastWeekShare: 0.2,
			shareChange: -0.1,
		});
	});

	it("leads with the top category and names the largest share change", () => {
		const card = buildCategoryMixCard(weekInput({ items }));
		expect(card.metricId).toBe("category_net_share");
		expect(card.headline).toEqual({
			value: 0.8,
			unit: "fraction",
			caption: {
				key: weekKeys.categories.caption,
				values: { category: { kind: "text", value: "Trà sữa" } },
			},
		});
		expect(card.narrative[0]?.key).toBe(weekKeys.categories.main);
		expect(card.narrative[1]).toEqual({
			key: reportKeys.clause.driver.category,
			values: {
				category: { kind: "text", value: "Trà sữa" },
				delta: { kind: "percentPoints", value: 0.2 },
			},
		});
		const rows = card.tables[0]?.rows ?? [];
		expect(rows.map((row) => row.cells.category)).toEqual([
			"Trà sữa",
			"Topping",
			reportKeys.label.uncategorised,
		]);
		expect(
			card.tables[0]?.columns.find((entry) => entry.key === "category")?.kind,
		).toBe("label");
		expect(rows.map((row) => row.cells.role)).toEqual([
			roleKey("drink"),
			roleKey("topping"),
			roleKey(null),
		]);
		expect(card.chart?.categories[2]).toEqual({
			kind: "message",
			value: reportKeys.label.uncategorised,
		});
		expect(card.chart?.series.map((series) => series.values)).toEqual([
			[0.8, 0.1, 0.1],
			[0.6, 0.2, 0.2],
		]);
		expect(card.markers.stale).toBe(false);
		expect(card.csvName).toBe("tuan-category-mix-2026-W44");
	});

	it("shows no data with a notice without items", () => {
		const card = buildCategoryMixCard(weekInput({ items: [] }));
		expect(card.headline.value).toBeNull();
		expect(card.narrative[0]?.key).toBe(weekKeys.categories.noData);
		expect(card.notice?.part.key).toBe(weekKeys.noDataNotice);
		expect(card.chart).toBeNull();
	});
});

describe("Tuần promotions", () => {
	const context = weekContext();

	it("matches last week's promotions by kind and key", () => {
		const card = buildPromotionsCard(
			weekInput({
				promotions: [
					promotionRow("voucher", "V20", 200_000, "Voucher 20k"),
					promotionRow("item", "P1", 150_000, "Giảm giá món"),
					promotionRow("bill", "unnamed", 50_000, null),
				],
				promotionsPrevious: [
					promotionRow("voucher", "V20", 100_000, "Voucher 20k"),
					promotionRow("bill", "P1", 80_000, "Khác"),
				],
				metrics: metricRows(context, {
					discount_rate: { current: 0.04, previous: 0.035 },
					voucher_invoice_share: { current: 0.12, previous: 0.1 },
				}),
			}),
		);
		expect(card.metricId).toBe("discount_cost");
		expect(card.relatedMetricIds).toEqual([
			"discount_rate",
			"voucher_invoice_share",
		]);
		expect(card.headline.value).toBe(300_000);
		expect(card.headline.caption).toEqual({
			key: weekKeys.promotions.caption,
			values: { rate: { kind: "percent", value: 0.04 } },
		});
		expect(card.comparisons.map((entry) => [entry.kind, entry.unit])).toEqual([
			["previous", undefined],
			["previous", "fraction"],
		]);
		expect(card.comparisons[1]?.difference).toBeCloseTo(0.005, 10);
		const rows = card.tables[0]?.rows ?? [];
		expect(
			rows.map((row) => [row.id, row.cells.lastWeek, row.cells.change]),
		).toEqual([
			["voucher|V20", 100_000, 1],
			["item|P1", 0, null],
			["bill|unnamed", 0, null],
		]);
		expect(rows[2]?.cells.promotion).toBeNull();
		expect(card.narrative.map((entry) => entry.key)).toEqual([
			weekKeys.promotions.up,
			weekKeys.promotions.largest,
			weekKeys.promotions.voucherShare,
		]);
		expect(card.chart?.categories).toEqual([
			{ kind: "isoWeek", value: "2026-W43" },
			{ kind: "isoWeek", value: "2026-W44" },
		]);
		expect(card.chart?.series.map((series) => series.values)).toEqual([
			[120_000, 150_000],
			[80_000, 100_000],
			[50_000, 50_000],
		]);
	});

	it("says no promotion ran in a week without discounts", () => {
		const card = buildPromotionsCard(
			weekInput({
				blocks: {
					all: {
						current: {
							discount_amount: 0,
							item_discount_amount: 0,
							bill_discount_amount: 0,
							voucher_amount: 0,
						},
					},
				},
			}),
		);
		expect(card.headline.value).toBe(0);
		expect(card.narrative).toEqual([
			{
				key: weekKeys.promotions.none,
				values: { period: { kind: "isoWeek", value: "2026-W44" } },
			},
		]);
		expect(card.tables[0]?.rows).toEqual([]);
	});
});
