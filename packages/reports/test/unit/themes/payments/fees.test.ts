import { describe, expect, it } from "vitest";
import { buildFeesCard } from "../../../../src/themes/payments/cards/fees.js";
import { paymentsKeys } from "../../../../src/themes/payments/keys.js";
import { paymentsCalls } from "../../../../src/themes/payments/support.js";
import { coverageRow, STORE_A } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import { cardInput, paymentRow, settingsRow } from "./support.js";

const current = [
	paymentRow({
		method_key: "CASH",
		kind: "cash",
		amount: 4_000_000,
		fee_estimate_amount: 0,
	}),
	paymentRow({
		method_key: "CARD",
		kind: "card",
		payment_method_name: "Thẻ",
		amount: 4_000_000,
		fee_estimate_amount: 88_000,
		fee_amount: 90_000,
	}),
	paymentRow({
		method_key: "QR",
		kind: "ewallet",
		payment_method_name: "Ví QR",
		amount: 2_000_000,
		fee_estimate_amount: 12_000,
	}),
];
const previous = [
	paymentRow({
		method_key: "CARD",
		kind: "card",
		amount: 4_000_000,
		fee_estimate_amount: 80_000,
	}),
];
const configured = [settingsRow({ fee_rates_configured: true })];

describe("the Thanh toán fee card", () => {
	it("sums the estimated fees with their rate on non-cash revenue and a chip against the previous range", () => {
		const card = buildFeesCard(
			cardInput(
				themeContext("28d", [STORE_A]),
				{
					[paymentsCalls.payments]: current,
					[paymentsCalls.paymentsPrevious]: previous,
					[paymentsCalls.settings]: configured,
				},
				[coverageRow(STORE_A)],
			),
		);
		expect(card.headline.value).toBe(100_000);
		expect(card.headline.caption?.values.rate).toEqual({
			kind: "percent",
			value: 0.016667,
		});
		expect(card.comparisons[0]?.reference).toBe(80_000);
		expect(card.comparisons[0]?.change).toBe(0.25);
		expect(card.narrative.map((part) => part.key)).toEqual([
			paymentsKeys.fees.up,
			paymentsKeys.fees.costliest,
		]);
		expect(
			card.tables[0]?.rows.find((row) => row.id === "CARD")?.cells,
		).toEqual({
			method: "Thẻ",
			kind: "report.paymentKind.card",
			amount: 4_000_000,
			effectiveRate: 0.022,
			feeEstimate: 88_000,
			posFee: 90_000,
		});
	});

	it("has no reference when the previous range has no payments", () => {
		const card = buildFeesCard(
			cardInput(
				themeContext("28d", [STORE_A]),
				{
					[paymentsCalls.payments]: current,
					[paymentsCalls.paymentsPrevious]: [],
					[paymentsCalls.settings]: configured,
				},
				[coverageRow(STORE_A)],
			),
		);
		expect(card.comparisons[0]?.unavailable).toBe("no_data");
		expect(card.narrative[0]?.key).toBe(paymentsKeys.fees.noReference);
	});

	it("shows a dash and the fees action while no fee rate is configured", () => {
		const card = buildFeesCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[paymentsCalls.payments]: current,
				[paymentsCalls.settings]: [
					settingsRow({ fee_rates_configured: false }),
				],
			}),
		);
		expect(card.headline.value).toBeNull();
		expect(card.comparisons).toEqual([]);
		expect(card.notice?.action).toBe("settings_fees");
		expect(card.narrative[0]?.key).toBe(paymentsKeys.fees.notConfigured);
		const cardRow = card.tables[0]?.rows.find((row) => row.id === "CARD");
		expect(cardRow?.cells.feeEstimate).toBeNull();
		expect(cardRow?.cells.effectiveRate).toBeNull();
		expect(cardRow?.cells.posFee).toBe(90_000);
	});

	it("marks the card stale while a catch-up range overlaps", () => {
		const context = {
			...themeContext("28d", [STORE_A]),
			catchUpPending: { from: "2026-10-20", to: "2026-10-25" },
		};
		const card = buildFeesCard(
			cardInput(context, {
				[paymentsCalls.payments]: current,
				[paymentsCalls.settings]: configured,
			}),
		);
		expect(card.markers.stale).toBe(true);
	});
});
