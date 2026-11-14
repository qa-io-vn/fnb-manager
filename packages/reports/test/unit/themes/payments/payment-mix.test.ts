import { describe, expect, it } from "vitest";
import {
	RANGE_INDEX,
	TOTALS_LIKE_FOR_LIKE_KEYS,
} from "../../../../src/themes/definition.js";
import { buildPaymentMixCard } from "../../../../src/themes/payments/cards/payment-mix.js";
import { paymentsKeys } from "../../../../src/themes/payments/keys.js";
import { paymentsCalls } from "../../../../src/themes/payments/support.js";
import { coverageRow, STORE_A, STORE_B } from "../../fixtures.js";
import { rangeTotalsRow, themeContext } from "../fixtures.js";
import { cardInput, paymentRow } from "./support.js";

const methods = [
	paymentRow({
		method_key: "CASH",
		kind: "cash",
		amount: 2_000_000,
		share: 0.2,
		compare_amount: 2_500_000,
	}),
	paymentRow({
		method_key: "QR",
		kind: "ewallet",
		payment_method_name: "Ví QR",
		amount: 5_000_000,
		share: 0.5,
		compare_amount: 4_000_000,
	}),
	paymentRow({
		method_key: "MOMO",
		kind: "ewallet",
		payment_method_name: "MoMo",
		amount: 1_000_000,
		share: 0.1,
		compare_amount: 1_000_000,
	}),
	paymentRow({
		method_key: "BANK",
		kind: "bank_transfer",
		payment_method_name: "Chuyển khoản",
		amount: 2_000_000,
		share: 0.2,
		compare_amount: 2_500_000,
	}),
];

function totals(
	context: ReturnType<typeof themeContext>,
	current: number,
	previous: number,
) {
	return [
		rangeTotalsRow(
			RANGE_INDEX.current,
			null,
			context.range.from,
			context.range.to,
			{ cash_share: current },
		),
		rangeTotalsRow(
			RANGE_INDEX.previous,
			null,
			context.range.previous.from,
			context.range.previous.to,
			{ cash_share: previous },
		),
	];
}

describe("the Thanh toán payment mix card", () => {
	it("reads the cash share with a chip in points and sums the kinds from the methods", () => {
		const context = themeContext("28d", [STORE_A]);
		const card = buildPaymentMixCard(
			cardInput(
				context,
				{
					[paymentsCalls.totals]: totals(context, 0.2, 0.25),
					[paymentsCalls.payments]: methods,
				},
				[coverageRow(STORE_A)],
			),
		);
		expect(card.headline).toEqual({
			value: 0.2,
			unit: "fraction",
			caption: null,
		});
		expect(card.comparisons[0]?.difference).toBe(-0.05);
		expect(card.comparisons[0]?.unit).toBe("fraction");
		expect(card.narrative[0]?.key).toBe(paymentsKeys.mix.down);
		expect(card.narrative[1]?.key).toBe(paymentsKeys.mix.otherMover);
		expect(card.narrative[1]?.values.delta).toEqual({
			kind: "percentPoints",
			value: 0.1,
		});
		const kinds = card.tables[0]?.rows ?? [];
		expect(kinds.map((row) => [row.id, row.cells.share])).toEqual([
			["cash", 0.2],
			["bank_transfer", 0.2],
			["ewallet", 0.6],
		]);
		expect(
			kinds.reduce((sum, row) => sum + Number(row.cells.share), 0),
		).toBeCloseTo(1, 6);
		expect(card.tables[1]?.rows.map((row) => row.id)).toEqual([
			"CASH",
			"QR",
			"MOMO",
			"BANK",
		]);
		expect(card.chart?.series.map((series) => series.stack)).toEqual([
			"share",
			"share",
			"share",
		]);
	});

	it("compares like for like while one store lacks the previous range", () => {
		const context = themeContext("28d", [STORE_A, STORE_B]);
		const card = buildPaymentMixCard(
			cardInput(
				context,
				{
					[paymentsCalls.totals]: totals(context, 0.3, 0.2),
					[TOTALS_LIKE_FOR_LIKE_KEYS.previous]: totals(context, 0.22, 0.2),
					[paymentsCalls.payments]: methods,
				},
				[
					coverageRow(STORE_A),
					coverageRow(STORE_B, { history_start: context.range.from }),
				],
			),
		);
		expect(card.headline.value).toBe(0.3);
		expect(card.comparisons[0]?.basis).toBe("like_for_like");
		expect(card.comparisons[0]?.difference).toBe(0.02);
	});

	it("marks the card stale while a catch-up range overlaps", () => {
		const context = {
			...themeContext("28d", [STORE_A]),
			catchUpPending: { from: "2026-10-20", to: "2026-10-25" },
		};
		const card = buildPaymentMixCard(
			cardInput(context, { [paymentsCalls.payments]: methods }, [
				coverageRow(STORE_A),
			]),
		);
		expect(card.markers.stale).toBe(true);
	});

	it("says no payment was taken without any", () => {
		const context = themeContext("28d", [STORE_A]);
		const card = buildPaymentMixCard(cardInput(context, {}));
		expect(card.headline.value).toBeNull();
		expect(card.narrative[0]?.key).toBe(paymentsKeys.mix.noData);
		expect(card.tables).toEqual([]);
		expect(card.chart).toBeNull();
	});
});
