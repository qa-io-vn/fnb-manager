import { describe, expect, it } from "vitest";
import type { ThemeContext } from "../../../../src/themes/context.js";
import { qualityTheme } from "../../../../src/themes/quality/definition.js";
import { qualityCalls } from "../../../../src/themes/quality/support.js";
import { coverageRow, STORE_A } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import {
	type CoverageRow,
	cardInput,
	dayRow,
	itemRow,
	marginRow,
	paymentRow,
	summaryRow,
} from "./support.js";

const AGGREGATE_CARDS = ["uncategorised", "costs", "payments"];

function staleByCard(
	context: ThemeContext,
	coverage: readonly CoverageRow[],
): Record<string, boolean> {
	const input = cardInput(
		context,
		{
			[qualityCalls.days]: [dayRow(STORE_A, context.range.to)],
			[qualityCalls.items]: [itemRow({})],
			[qualityCalls.summary]: [summaryRow(null), summaryRow(STORE_A)],
			[qualityCalls.payments]: [paymentRow({})],
			[qualityCalls.margins]: [marginRow({})],
		},
		coverage,
	);
	return Object.fromEntries(
		qualityTheme.cards.map((card) => [
			card.id,
			card.build(input).markers.stale,
		]),
	);
}

describe("the Chất lượng dữ liệu 'đang cập nhật' marker", () => {
	it("marks only the cards that read item or payment aggregates while a store's aggregates lag", () => {
		const stale = staleByCard(themeContext("28d", [STORE_A]), [
			coverageRow(STORE_A, { stale_days: 2 }),
		]);
		expect(Object.keys(stale).sort()).toEqual(
			qualityTheme.cards.map((card) => card.id).sort(),
		);
		for (const [id, marked] of Object.entries(stale)) {
			expect(marked, id).toBe(AGGREGATE_CARDS.includes(id));
		}
	});

	it("marks the same cards while a catch-up range overlaps the page's range", () => {
		const context = themeContext("28d", [STORE_A]);
		const stale = staleByCard(
			{
				...context,
				catchUpPending: { from: context.range.from, to: context.range.to },
			},
			[coverageRow(STORE_A)],
		);
		for (const [id, marked] of Object.entries(stale)) {
			expect(marked, id).toBe(AGGREGATE_CARDS.includes(id));
		}
	});

	it("marks no card while the aggregates are current", () => {
		const stale = staleByCard(themeContext("28d", [STORE_A]), [
			coverageRow(STORE_A),
		]);
		expect(Object.values(stale).every((marked) => !marked)).toBe(true);
	});
});
