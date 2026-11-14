import { describe, expect, it } from "vitest";
import {
	buildCashTrendCard,
	cashRisesWhileNetFalls,
	signalHalves,
} from "../../../../src/themes/payments/cards/cash-trend.js";
import { paymentsKeys } from "../../../../src/themes/payments/keys.js";
import {
	bucketGrain,
	paymentsCalls,
} from "../../../../src/themes/payments/support.js";
import { coverageRow, STORE_A, STORE_B } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import { cardInput, seriesRow } from "./support.js";

function bucket(day: number, cash: number, net: number) {
	return seriesRow(`2026-10-${String(day).padStart(2, "0")}`, {
		cash_amount: cash,
		paid_amount: net,
		net_amount: net,
		cash_share: cash / net,
	});
}

describe("the Thanh toán cash trend card", () => {
	it("reads the last bucket's cash share against the first in points", () => {
		const card = buildCashTrendCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[paymentsCalls.series]: [
					bucket(11, 1_000_000, 5_000_000),
					bucket(10, 1_000_000, 4_000_000),
					seriesRow("2026-10-12", {
						cash_share: null,
						paid_amount: 0,
						cash_amount: 0,
						days_with_data: 0,
					}),
					bucket(13, 1_500_000, 5_000_000),
				],
			}),
		);
		expect(card.headline.value).toBe(0.3);
		expect(card.comparisons[0]?.reference).toBe(0.25);
		expect(card.comparisons[0]?.difference).toBe(0.05);
		expect(card.comparisons[0]?.label.key).toBe(paymentsKeys.trend.firstBucket);
		expect(card.narrative[0]?.key).toBe(paymentsKeys.trend.up);
		expect(card.narrative[0]?.values.bucket).toEqual({
			kind: "part",
			value: {
				key: paymentsKeys.trend.dayBucket,
				values: { date: { kind: "date", value: "2026-10-13" } },
			},
		});
		expect(card.tables[0]?.rows.map((row) => row.id)).toEqual([
			"2026-10-10",
			"2026-10-11",
			"2026-10-12",
			"2026-10-13",
		]);
		expect(card.tables[0]?.initialSort).toEqual({
			key: "bucket",
			direction: "descending",
		});
		expect(card.tables[0]?.previewRows).toBe(10);
		expect(
			card.chart?.series.map((series) => [series.kind, series.axis]),
		).toEqual([
			["bar", "left"],
			["line", "right"],
		]);
	});

	it("warns when the recent weeks' cash share rises while revenue per day falls", () => {
		const days = (cash: number, net: number, count: number, from: number) =>
			Array.from({ length: count }, (_, index) =>
				bucket(from + index, cash, net),
			);
		const rising = [
			...days(2_000_000, 10_000_000, 14, 1),
			...days(2_000_000, 8_000_000, 14, 15),
		];
		expect(cashRisesWhileNetFalls(rising, "day")).toBe(true);
		const card = buildCashTrendCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[paymentsCalls.series]: rising,
			}),
		);
		expect(card.narrative.map((part) => part.key)).toContain(
			paymentsKeys.trend.signal,
		);
		const growing = [
			...days(2_000_000, 10_000_000, 14, 1),
			...days(3_000_000, 12_000_000, 14, 15),
		];
		expect(cashRisesWhileNetFalls(growing, "day")).toBe(false);
		const barelyMoving = [
			...days(2_000_000, 10_000_000, 14, 1),
			...days(1_640_000, 8_000_000, 14, 15),
		];
		expect(cashRisesWhileNetFalls(barelyMoving, "day")).toBe(false);
		expect(cashRisesWhileNetFalls(rising.slice(0, 27), "day")).toBe(false);
	});

	it("compares whole weeks only, so the weekdays match", () => {
		const week = (start: string, cash: number, net: number, calendarDays = 7) =>
			seriesRow(start, {
				calendar_days: calendarDays,
				cash_amount: cash,
				paid_amount: net,
				net_amount: net,
				cash_share: cash / net,
			});
		const weeks = [
			week("2026-08-27", 9_000_000, 9_000_000, 4),
			week("2026-08-31", 14_000_000, 70_000_000),
			week("2026-09-07", 14_000_000, 70_000_000),
			week("2026-09-14", 15_000_000, 60_000_000),
			week("2026-09-21", 15_000_000, 60_000_000),
		];
		expect(
			signalHalves(weeks, "week")?.[0].map((row) => row.bucket_start),
		).toEqual(["2026-08-31", "2026-09-07"]);
		expect(cashRisesWhileNetFalls(weeks, "week")).toBe(true);
		expect(signalHalves(weeks.slice(0, 4), "week")).toBeNull();
		expect(
			signalHalves(
				Array.from({ length: 20 }, (_, index) => bucket(index + 1, 1, 2)),
				"day",
			),
		).toBeNull();
	});

	it("leaves out the chip and says why when a store's data starts after the first bucket", () => {
		const context = themeContext("28d", [STORE_A, STORE_B]);
		const card = buildCashTrendCard(
			cardInput(
				context,
				{
					[paymentsCalls.series]: [
						bucket(10, 1_000_000, 5_000_000),
						bucket(13, 1_500_000, 5_000_000),
					],
				},
				[
					coverageRow(STORE_A),
					coverageRow(STORE_B, { history_start: "2026-10-12" }),
				],
			),
		);
		expect(card.comparisons).toEqual([]);
		expect(card.narrative.map((part) => part.key)).toEqual([
			paymentsKeys.trend.noReference,
			paymentsKeys.trend.storesJoined,
		]);
	});

	it("buckets by day up to 35 days and by week beyond", () => {
		expect(bucketGrain(35)).toBe("day");
		expect(bucketGrain(36)).toBe("week");
		const card = buildCashTrendCard(
			cardInput(themeContext("91d", [STORE_A]), {
				[paymentsCalls.series]: [bucket(5, 1_000_000, 5_000_000)],
			}),
		);
		expect(card.tables[0]?.columns[0]?.labelKey).toBe(
			paymentsKeys.table.weekFrom,
		);
		expect(card.comparisons).toEqual([]);
		expect(card.narrative[0]?.key).toBe(paymentsKeys.trend.noReference);
	});

	it("says no payment was taken without buckets", () => {
		const card = buildCashTrendCard(
			cardInput(themeContext("28d", [STORE_A]), {}),
		);
		expect(card.headline.value).toBeNull();
		expect(card.narrative[0]?.key).toBe(paymentsKeys.trend.noData);
		expect(card.chart).toBeNull();
	});
});
