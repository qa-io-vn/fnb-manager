import { describe, expect, it } from "vitest";
import { buildVouchersCard } from "../../../../src/themes/promotions/cards/vouchers.js";
import { promotionsKeys } from "../../../../src/themes/promotions/keys.js";
import { promotionsCalls } from "../../../../src/themes/promotions/support.js";
import { coverageRow, STORE_A, STORE_B } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import { cardInput, promotionRow, threeRanges } from "./support.js";

const vouchers = [
	promotionRow({
		promotion_kind: "voucher",
		promotion_key: "Voucher 10k",
		promotion_name: "Voucher 10k",
		invoices: 100,
		lines: null,
		discount_amount: 1_000_000,
	}),
	promotionRow({
		promotion_kind: "voucher",
		promotion_key: "Voucher 20k",
		promotion_name: "Voucher 20k",
		invoices: 200,
		lines: null,
		discount_amount: 4_000_000,
	}),
	promotionRow({
		promotion_kind: "item",
		promotion_key: "KM-01",
		invoices: 900,
		discount_amount: 2_000_000,
	}),
];

describe("the Khuyến mãi voucher card", () => {
	it("reads the voucher invoice share with chips in points and names the voucher with the most invoices", () => {
		const context = themeContext("28d", [STORE_A, STORE_B]);
		const card = buildVouchersCard(
			cardInput(
				context,
				{
					[promotionsCalls.totals]: threeRanges(context, {
						current: { voucher_share: 0.12, invoices: 2500 },
						previous: { voucher_share: 0.1 },
						lastYear: { voucher_share: 0.08 },
					}),
					[promotionsCalls.promotions]: vouchers,
				},
				[coverageRow(STORE_A), coverageRow(STORE_B)],
			),
		);
		expect(card.metricId).toBe("voucher_invoice_share");
		expect(card.headline).toEqual({
			value: 0.12,
			unit: "fraction",
			caption: null,
		});
		expect(
			card.comparisons.map((entry) => [entry.kind, entry.unit, entry.basis]),
		).toEqual([
			["previous", "fraction", "all_stores"],
			["last_year", "fraction", "all_stores"],
		]);
		expect(card.comparisons[0]?.difference).toBeCloseTo(0.02, 6);
		expect(card.comparisons[1]?.difference).toBeCloseTo(0.04, 6);
		expect(card.narrative.map((part) => part.key)).toEqual([
			promotionsKeys.vouchers.up,
			promotionsKeys.vouchers.top,
		]);
		expect(card.narrative[0]?.values.points).toEqual({
			kind: "pointMagnitude",
			value: 2,
		});
		expect(card.narrative[1]?.values).toEqual({
			voucher: { kind: "text", value: "Voucher 20k" },
			invoices: { kind: "count", value: 200 },
			amount: { kind: "money", value: 4_000_000 },
		});
		expect(card.tables[0]?.rows.map((row) => row.cells)).toEqual([
			{
				voucher: "Voucher 10k",
				invoices: 100,
				amount: 1_000_000,
				invoiceShare: 0.04,
			},
			{
				voucher: "Voucher 20k",
				invoices: 200,
				amount: 4_000_000,
				invoiceShare: 0.08,
			},
		]);
		expect(card.tables[0]?.initialSort).toEqual({
			key: "invoices",
			direction: "descending",
		});
		expect(card.markers.stale).toBe(false);
	});

	it("names an unnamed voucher by what it is", () => {
		const context = themeContext("28d", [STORE_A]);
		const card = buildVouchersCard(
			cardInput(
				context,
				{
					[promotionsCalls.totals]: threeRanges(context),
					[promotionsCalls.promotions]: [
						promotionRow({
							promotion_kind: "voucher",
							promotion_key: "unnamed",
							promotion_name: null,
							invoices: 40,
							discount_amount: 400_000,
						}),
					],
				},
				[coverageRow(STORE_A)],
			),
		);
		expect(card.narrative.at(-1)?.key).toBe(promotionsKeys.vouchers.topUnnamed);
		expect(card.tables[0]?.rows[0]?.cells.voucher).toBeNull();
	});

	it("shows a measured zero with its own sentence when no invoice used a voucher", () => {
		const context = themeContext("28d", [STORE_A]);
		const card = buildVouchersCard(
			cardInput(
				context,
				{
					[promotionsCalls.totals]: threeRanges(context, {
						current: { voucher_share: 0, voucher_invoices: 0 },
					}),
					[promotionsCalls.promotions]: [vouchers[2]],
				},
				[coverageRow(STORE_A)],
			),
		);
		expect(card.headline.value).toBe(0);
		expect(card.narrative.map((part) => part.key)).toEqual([
			promotionsKeys.vouchers.none,
		]);
		expect(card.tables).toEqual([]);
	});

	it("says there are no invoices without data and keeps the young store's last year apart", () => {
		const context = themeContext("28d", [STORE_B]);
		const card = buildVouchersCard(
			cardInput(
				context,
				{
					[promotionsCalls.totals]: threeRanges(context, {
						current: { days_with_data: 0, voucher_share: null },
					}),
				},
				[coverageRow(STORE_B, { history_start: "2026-03-01" })],
			),
		);
		expect(card.headline.value).toBeNull();
		expect(card.narrative.map((part) => part.key)).toEqual([
			promotionsKeys.vouchers.noData,
		]);
		expect(card.comparisons[1]?.unavailable).toBe("store_too_young");
	});
});
