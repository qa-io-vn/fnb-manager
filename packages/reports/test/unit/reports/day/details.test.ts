import { describe, expect, it } from "vitest";
import {
	coverageModel,
	paymentKindKey,
	promotionKindKey,
	reportKeys,
	shiftNumberValue,
	shiftReasonsKey,
	storeAndLabelValue,
} from "../../../../src/index.js";
import {
	buildDiscountsCard,
	buildMembersCard,
	buildPaymentsCard,
	buildShiftsCard,
	buildTopItemsCard,
	dayKeys,
	wallClock,
} from "../../../../src/reports/day/index.js";
import { coverageRow } from "../../fixtures.js";
import {
	block,
	dayInput,
	itemRow,
	metricRow,
	paymentRow,
	promotionRow,
	STORE_A,
	STORE_B,
	shiftRow,
} from "./fixtures.js";

describe("Ngày top items", () => {
	it("leads with the best seller and names the item that changed most", () => {
		const card = buildTopItemsCard(
			dayInput({
				items: [
					itemRow("A", {
						net_amount: 900_000,
						compare_net_amount: 850_000,
						net_share: 0.3,
					}),
					itemRow("B", { net_amount: 700_000, compare_net_amount: 200_000 }),
					itemRow("C", {
						quantity: 0,
						net_amount: 0,
						compare_net_amount: 300_000,
					}),
				],
			}),
		);
		expect(card.headline.value).toBe(900_000);
		expect(card.headline.caption?.values.item).toEqual({
			kind: "text",
			value: "Item A",
		});
		expect(card.tables[0]?.rows.map((row) => row.id)).toEqual(["A", "B"]);
		expect(card.narrative[0]?.key).toBe(dayKeys.items.leader);
		expect(card.narrative[1]?.key).toBe(dayKeys.items.mover);
		expect(card.narrative[1]?.values.item).toEqual({
			kind: "text",
			value: "Item B",
		});
		expect(card.narrative[1]?.values.delta).toEqual({
			kind: "moneySigned",
			value: 500_000,
		});
		expect(card.markers.stale).toBe(false);
	});

	it("marks stale aggregates and says when nothing was sold", () => {
		const coverage = [
			coverageRow(STORE_A, { stale_days: 1 }),
			coverageRow(STORE_B),
		];
		const card = buildTopItemsCard(dayInput({ coverage }));
		expect(card.headline.value).toBeNull();
		expect(card.chart).toBeNull();
		expect(card.narrative[0]?.key).toBe(dayKeys.items.noData);
		expect(card.markers.stale).toBe(true);
	});
});

describe("Ngày payments", () => {
	it("counts the cash to count and compares the cash share in points", () => {
		const card = buildPaymentsCard(
			dayInput({
				payments: [
					paymentRow("ewallet", "QR", 6_000_000, 5_000_000, 0.6),
					paymentRow("cash", "Cash", 3_000_000, 2_000_000, 0.3),
					paymentRow("cash", "Cash 2", 1_000_000, 1_000_000, 0.1),
				],
				compare: [
					...block(null, {
						current: { cash_share: 0.4 },
						previous: { cash_share: 0.375 },
					}),
					...block(STORE_A),
					...block(STORE_B),
				],
			}),
		);
		expect(card.headline.value).toBe(4_000_000);
		expect(card.headline.caption?.key).toBe(dayKeys.payments.caption);
		expect(card.comparisons[0]?.unit).toBe("fraction");
		expect(card.comparisons[0]?.difference).toBeCloseTo(0.025, 10);
		expect(card.narrative[0]?.values.kind).toEqual({
			kind: "message",
			value: paymentKindKey("ewallet"),
		});
		expect(card.narrative[1]?.values.amount).toEqual({
			kind: "moneyExact",
			value: 4_000_000,
		});
		expect(card.chart?.series.map((series) => series.values)).toEqual([
			[0.375, 0.4],
			[0.625, 0.6],
		]);
		expect(card.markers.stale).toBe(false);
	});

	it("measures zero cash when every payment is cashless", () => {
		const card = buildPaymentsCard(
			dayInput({ payments: [paymentRow("card", "Card", 500_000, 0)] }),
		);
		expect(card.headline.value).toBe(0);
	});
});

describe("Ngày shifts", () => {
	it("counts flagged shifts and describes the largest variance", () => {
		const card = buildShiftsCard(
			dayInput({
				shifts: [
					shiftRow("S1", { variance_amount: 5_000 }),
					shiftRow("S2", {
						variance_amount: -120_000,
						flagged: true,
						over_abs_threshold: true,
						over_rel_threshold: true,
						reasons: ["absolute", "relative"],
						cashier_name: null,
					}),
					shiftRow("S3", { variance_amount: null, z_score: null }),
				],
			}),
		);
		expect(card.headline.value).toBe(1);
		expect(card.headline.caption?.values.count).toEqual({
			kind: "count",
			value: 3,
		});
		expect(card.tables[0]?.rows.map((row) => row.id)).toEqual([
			"S2",
			"S1",
			"S3",
		]);
		expect(card.tables[0]?.rows[0]?.cells.reasons).toBe(
			shiftReasonsKey(["relative", "absolute"]),
		);
		expect(card.tables[0]?.rows[0]?.cells.openedAt).toBe("06:30");
		const sentence = card.narrative[0];
		expect(sentence?.key).toBe(dayKeys.shifts.largest);
		expect(sentence?.values.cashier).toEqual({
			kind: "message",
			value: reportKeys.label.unknownCashier,
		});
		expect(sentence?.values.variance).toEqual({
			kind: "moneySigned",
			value: -120_000,
		});
		expect(card.chart?.series[1]?.values).toEqual([-120_000, null, null]);
	});

	it("labels shifts Ca n by opening time and never shows a POS name or e-mail", () => {
		const card = buildShiftsCard(
			dayInput({
				shifts: [
					shiftRow("S9", {
						opened_at: "2026-11-03T09:00:00.000Z",
						shift_name: "minh@example.com - ca tối",
						cashier_name: "minh@example.com",
						variance_amount: -90_000,
						flagged: true,
						reasons: ["absolute"],
					}),
					shiftRow("S1", {
						opened_at: "2026-11-03T01:00:00.000Z",
						shift_name: "lan@example.com - ca sáng",
						cashier_name: "Lan",
					}),
				],
			}),
		);
		const cells = Object.fromEntries(
			(card.tables[0]?.rows ?? []).map((row) => [row.id, row.cells]),
		);
		expect(cells.S1?.shift).toBe(1);
		expect(cells.S9?.shift).toBe(2);
		expect(cells.S9?.cashier).toBe(reportKeys.label.unknownCashier);
		expect(cells.S1?.cashier).toBe("Lan");
		expect(
			card.tables[0]?.columns.find((col) => col.key === "shift")?.kind,
		).toBe("shift");
		expect(card.narrative[0]?.values.shift).toEqual(shiftNumberValue(2));
		expect(card.narrative[0]?.values.cashier).toEqual({
			kind: "message",
			value: reportKeys.label.unknownCashier,
		});
		expect(card.chart?.categories[0]).toEqual(
			storeAndLabelValue("Store 1", shiftNumberValue(2)),
		);
		expect(JSON.stringify(card)).not.toMatch(/@|example\.com|ca (sáng|tối)/);
	});

	it("has no headline and a notice on a day without shifts", () => {
		const card = buildShiftsCard(dayInput());
		expect(card.headline.value).toBeNull();
		expect(card.notice?.part.key).toBe(dayKeys.shifts.noShifts);
		expect(card.narrative[0]?.key).toBe(dayKeys.shifts.noData);
	});

	it("formats wall-clock times in the store time zone", () => {
		expect(wallClock("2026-11-03T13:05:00.000Z", "Asia/Ho_Chi_Minh")).toBe(
			"20:05",
		);
		expect(wallClock(null, "Asia/Ho_Chi_Minh")).toBeNull();
	});
});

describe("Ngày discounts", () => {
	it("compares the cost with yesterday and the rate in points", () => {
		const card = buildDiscountsCard(
			dayInput({
				metrics: [
					metricRow("discount_rate", "current", 0.04),
					metricRow("discount_rate", "previous", 0.03),
					metricRow("discount_rate", "last_year", 0.05),
				],
				promotions: [
					promotionRow("item", "PROMO-1", 150_000, "Happy hour"),
					promotionRow("bill", "unnamed", 50_000, null),
				],
			}),
		);
		expect(card.headline.value).toBe(200_000);
		expect(card.comparisons.map((entry) => [entry.kind, entry.unit])).toEqual([
			["previous", undefined],
			["previous", "fraction"],
			["last_year", "fraction"],
		]);
		expect(card.comparisons[1]?.difference).toBeCloseTo(0.01, 10);
		expect(card.tables).toHaveLength(2);
		expect(card.tables[0]?.rows[1]?.cells.promotion).toBeNull();
		expect(card.tables[1]?.rows.map((row) => row.cells.component)).toEqual([
			promotionKindKey("item"),
			promotionKindKey("bill"),
			promotionKindKey("voucher"),
		]);
		const largest = card.narrative.at(-1);
		expect(largest?.key).toBe(dayKeys.discounts.largestPromotion);
		expect(largest?.values.promotion).toEqual({
			kind: "text",
			value: "Happy hour",
		});
		expect(largest?.values).not.toHaveProperty("kind");
		const unnamed = buildDiscountsCard(
			dayInput({
				promotions: [promotionRow("bill", "unnamed", 50_000, null)],
			}),
		).narrative.at(-1);
		expect(unnamed).toEqual({
			key: dayKeys.discounts.largestPromotionUnnamed,
			values: {
				kind: { kind: "message", value: promotionKindKey("bill") },
				amount: { kind: "money", value: 50_000 },
			},
		});
	});

	it("says there was no discount when the cost is zero", () => {
		const zero = {
			discount_amount: 0,
			item_discount_amount: 0,
			bill_discount_amount: 0,
			voucher_amount: 0,
			discount_rate: 0,
		};
		const card = buildDiscountsCard(
			dayInput({
				compare: [
					...block(null, { current: zero }),
					...block(STORE_A, { current: zero }),
					...block(STORE_B, { current: zero }),
				],
			}),
		);
		expect(card.headline.value).toBe(0);
		expect(card.narrative).toEqual([
			{
				key: dayKeys.discounts.none,
				values: { day: { kind: "date", value: "2026-11-03" } },
			},
		]);
		expect(card.tables[0]?.rows).toEqual([]);
	});
});

describe("Ngày member invoices", () => {
	it("shows a measured zero with the hint, never as missing", () => {
		const card = buildMembersCard(dayInput());
		expect(card.headline).toEqual({
			value: 0,
			unit: "fraction",
			caption: null,
		});
		expect(card.narrative).toEqual([{ key: dayKeys.members.zero, values: {} }]);
	});

	it("names the store with the lowest share", () => {
		const card = buildMembersCard(
			dayInput({
				compare: [
					...block(null, { current: { member_share: 0.08 } }),
					...block(STORE_A, { current: { member_share: 0.1 } }),
					...block(STORE_B, { current: { member_share: 0.05 } }),
				],
			}),
		);
		expect(card.narrative.at(-1)?.key).toBe(dayKeys.members.lowestStore);
		expect(card.narrative.at(-1)?.values.store).toEqual({
			kind: "text",
			value: "Store 2",
		});
		expect(card.tables[0]?.columns.map((column) => column.key)).toEqual([
			"store",
			"invoices",
			"memberInvoices",
			"memberShare",
			"captureRate",
		]);
	});

	it("marks the cards of a demo context as sample data", () => {
		const input = dayInput({ sample: true });
		expect(coverageModel(input.coverage.rows, input.context).verification).toBe(
			"sample",
		);
		expect(buildMembersCard(input).markers.verification).toBe("sample");
	});
});
