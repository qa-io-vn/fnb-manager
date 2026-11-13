import { describe, expect, it } from "vitest";
import { paymentKindKey, reportKeys } from "../../../../src/index.js";
import {
	buildAttachRateCard,
	buildDiscountCostCard,
	buildPaymentMixCard,
	kindShares,
	monthKeys,
} from "../../../../src/reports/month/index.js";
import { coverageRow } from "../../fixtures.js";
import {
	metricRows,
	monthBlock,
	monthInput,
	paymentRow,
	promotionRow,
	STORE_A,
	STORE_B,
} from "./fixtures.js";

describe("Tháng attach rates", () => {
	it("shows the topping rate with both rates compared in points and names the larger mover", () => {
		const card = buildAttachRateCard(
			monthInput({
				metrics: [
					...metricRows("attach_rate_topping", 0.23, 0.24, 0.2),
					...metricRows("attach_rate_snack", 0.1, 0.13, 0.09),
				],
			}),
		);
		expect(card.headline).toMatchObject({ value: 0.23, unit: "fraction" });
		expect(card.headline.caption).toMatchObject({
			key: monthKeys.attach.caption,
			values: { value: { kind: "percent", value: 0.1 } },
		});
		expect(card.comparisons.map((entry) => entry.label.key)).toEqual([
			monthKeys.attach.toppingPrevious,
			monthKeys.attach.toppingLastYear,
			monthKeys.attach.snackPrevious,
			monthKeys.attach.snackLastYear,
		]);
		expect(card.comparisons.every((entry) => entry.unit === "fraction")).toBe(
			true,
		);
		expect(card.narrative[0]?.key).toBe(monthKeys.attach.down);
		expect(card.narrative[1]).toMatchObject({
			key: monthKeys.attach.mover,
			values: { rate: { kind: "message", value: monthKeys.attach.snack } },
		});
		expect(card.narrative[1]?.values.delta?.value).toBeCloseTo(-0.03, 10);
		expect(card.tables[0]?.rows.map((row) => row.cells.metric)).toEqual([
			monthKeys.attach.topping,
			monthKeys.attach.snack,
		]);
		expect(card.chart?.series).toHaveLength(3);
		expect(card.notice).toBeNull();
		expect(card.metricId).toBe("attach_rate_topping");
		expect(card.relatedMetricIds).toEqual(["attach_rate_snack"]);
	});

	it("asks for item roles when neither rate is measured", () => {
		const card = buildAttachRateCard(
			monthInput({
				metrics: [
					...metricRows("attach_rate_topping", null, null, null),
					...metricRows("attach_rate_snack", null, null, null),
				],
			}),
		);
		expect(card.headline.value).toBeNull();
		expect(card.notice).toEqual({
			tone: "info",
			part: { key: monthKeys.attach.notConfigured, values: {} },
			action: "settings_roles",
		});
		expect(card.chart).toBeNull();
		expect(card.narrative.map((entry) => entry.key)).toEqual([
			monthKeys.attach.noData,
		]);
	});

	it("asks for the topping role when only the snack rate is measured", () => {
		const card = buildAttachRateCard(
			monthInput({
				metrics: [
					...metricRows("attach_rate_topping", null, null, null),
					...metricRows("attach_rate_snack", 0.1, 0.08, null),
				],
			}),
		);
		expect(card.notice?.part.key).toBe(monthKeys.attach.toppingNotConfigured);
		expect(card.notice?.action).toBe("settings_roles");
	});
});

describe("Tháng payment mix", () => {
	const payments = [
		paymentRow("ewallet", "QR", 6_000_000, 4_000_000, {
			share: 0.6,
			compare_share: 0.5,
		}),
		paymentRow("cash", "Tiền mặt", 3_000_000, 3_200_000, {
			share: 0.3,
			compare_share: 0.4,
		}),
		paymentRow("bank_transfer", "Chuyển khoản", 1_000_000, 800_000, {
			share: 0.1,
			compare_share: 0.1,
		}),
	];

	it("compares the cash share in points and names the kind whose share moved most", () => {
		const card = buildPaymentMixCard(
			monthInput({
				payments,
				metrics: metricRows("cash_share", 0.3, 0.4, 0.35),
			}),
		);
		expect(card.headline).toMatchObject({ value: 0.3, unit: "fraction" });
		expect(card.comparisons[0]?.difference).toBeCloseTo(-0.1, 10);
		expect(card.narrative[0]?.key).toBe(monthKeys.payments.down);
		expect(card.narrative[0]?.values.points).toEqual({
			kind: "pointMagnitude",
			value: 10,
		});
		expect(card.narrative[1]).toMatchObject({
			key: monthKeys.payments.otherMover,
			values: {
				payment: { kind: "message", value: paymentKindKey("ewallet") },
			},
		});
		const delta = card.narrative[1]?.values.delta;
		expect(delta?.kind).toBe("percentPoints");
		expect(typeof delta?.value === "number" ? delta.value : null).toBeCloseTo(
			0.1,
			10,
		);
		expect(kindShares(payments).map((entry) => entry.share)).toEqual([
			0.3, 0.1, 0.6,
		]);
		expect(card.chart?.series.map((series) => series.values)).toEqual([
			[0.4, 0.3],
			[0.1, 0.1],
			[0.5, 0.6],
		]);
		expect(card.markers.stale).toBe(false);
	});

	it("hides the fee column without fee estimates and shows it with them", () => {
		const without = buildPaymentMixCard(monthInput({ payments }));
		expect(
			without.tables[0]?.columns.map((column) => column.key),
		).not.toContain("feeEstimate");
		const withFees = buildPaymentMixCard(
			monthInput({
				payments: [
					...payments,
					paymentRow("card", "Thẻ", 500_000, 0, { fee_estimate_amount: 9_000 }),
				],
			}),
		);
		expect(withFees.tables[0]?.columns.at(-1)?.key).toBe("feeEstimate");
	});

	it("marks the card stale while the aggregates catch up", () => {
		const card = buildPaymentMixCard(
			monthInput({
				payments,
				coverage: [
					coverageRow(STORE_A),
					coverageRow(STORE_B, { stale_days: 1 }),
				],
			}),
		);
		expect(card.markers.stale).toBe(true);
	});
});

describe("Tháng discount cost", () => {
	it("compares the cost with last month and last year and names the costliest promotion", () => {
		const card = buildDiscountCostCard(
			monthInput({
				compare: [
					...monthBlock(null, {
						current: {
							discount_amount: 300_000,
							item_discount_amount: 100_000,
							bill_discount_amount: 50_000,
							voucher_amount: 150_000,
						},
					}),
					...monthBlock(STORE_A),
					...monthBlock(STORE_B),
				],
				metrics: metricRows("discount_rate", 0.05, 0.04, 0.03),
				promotions: [
					promotionRow("voucher", "V20", 200_000),
					promotionRow("item", "PROMO", 100_000, null),
				],
			}),
		);
		expect(card.headline).toMatchObject({ value: 300_000, unit: "money" });
		expect(card.headline.caption).toMatchObject({
			key: monthKeys.discounts.caption,
			values: { rate: { kind: "percent", value: 0.05 } },
		});
		expect(card.comparisons.map((entry) => entry.kind)).toEqual([
			"previous",
			"last_year",
			"previous",
		]);
		expect(card.comparisons[2]?.unit).toBe("fraction");
		expect(card.comparisons[0]?.change).toBeCloseTo(1, 10);
		expect(card.narrative[1]).toMatchObject({
			key: monthKeys.discounts.largestPromotion,
			values: { promotion: { kind: "text", value: "V20" } },
		});
		expect(card.narrative[1]?.values).not.toHaveProperty("kind");
		expect(card.narrative[1]?.values.share?.value).toBeCloseTo(2 / 3, 5);
		expect(card.tables[0]?.rows[1]?.cells).toMatchObject({
			promotion: "PROMO",
			daysUsed: 3,
		});
		expect(card.tables[1]?.rows.map((row) => row.cells.current)).toEqual([
			100_000, 50_000, 150_000,
		]);
		expect(card.chart?.categories.map((category) => category.value)).toEqual([
			reportKeys.periodRow.lastYear,
			reportKeys.periodRow.previous,
			reportKeys.periodRow.current,
		]);
		expect(card.markers.stale).toBe(false);
	});

	it("says so when the month had no discount", () => {
		const card = buildDiscountCostCard(
			monthInput({
				compare: monthBlock(null, { current: { discount_amount: 0 } }),
			}),
		);
		expect(card.headline.value).toBe(0);
		expect(card.narrative.map((entry) => entry.key)).toEqual([
			monthKeys.discounts.none,
		]);
	});
});
