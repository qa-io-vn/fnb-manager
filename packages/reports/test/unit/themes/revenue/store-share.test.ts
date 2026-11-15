import { describe, expect, it } from "vitest";
import { buildStoreShareCard } from "../../../../src/themes/revenue/cards/store-share.js";
import { revenueKeys } from "../../../../src/themes/revenue/keys.js";
import { revenueCalls } from "../../../../src/themes/revenue/support.js";
import { rangeValue } from "../../../../src/themes/support.js";
import { coverageRow, STORE_A, STORE_B } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import { cardInput, sales, totalsRow } from "./support.js";

const M = 1_000_000;

describe("the Doanh thu store share card", () => {
	it("gives each store's share of net now and in the previous range, with the change in points", () => {
		const context = themeContext("28d", [STORE_A, STORE_B]);
		const card = buildStoreShareCard(
			cardInput(
				context,
				{
					[revenueCalls.totals]: [
						totalsRow(context, "current", null, sales(150 * M, 3000, 4500)),
						totalsRow(context, "previous", null, sales(120 * M, 2400, 3600)),
						totalsRow(context, "current", STORE_A, sales(100 * M, 2000, 3000)),
						totalsRow(context, "previous", STORE_A, sales(60 * M, 1200, 1800)),
						totalsRow(context, "current", STORE_B, sales(50 * M, 1000, 1500)),
						totalsRow(context, "previous", STORE_B, sales(60 * M, 1200, 1800)),
					],
				},
				[coverageRow(STORE_A), coverageRow(STORE_B)],
			),
		);
		expect(card.headline).toEqual({
			value: 0.666667,
			unit: "fraction",
			caption: {
				key: revenueKeys.storeShare.caption,
				values: { store: { kind: "text", value: "Store 1" } },
			},
		});
		expect(card.narrative).toEqual([
			{
				key: revenueKeys.storeShare.main,
				values: {
					range: rangeValue(context),
					store: { kind: "text", value: "Store 1" },
					share: { kind: "percent", value: 0.666667 },
					delta: { kind: "percentPoints", value: 0.166667 },
				},
			},
		]);
		expect(card.tables[0]?.rows).toEqual([
			{
				id: STORE_A,
				cells: {
					store: "Store 1",
					net: 100 * M,
					share: 0.666667,
					previousShare: 0.5,
					change: 0.166667,
				},
			},
			{
				id: STORE_B,
				cells: {
					store: "Store 2",
					net: 50 * M,
					share: 0.333333,
					previousShare: 0.5,
					change: -0.166667,
				},
			},
		]);
		expect(card.tables[0]?.initialSort).toEqual({
			key: "share",
			direction: "descending",
		});
		expect(card.chart?.categories).toEqual([
			{ kind: "message", value: revenueKeys.storeShare.previous },
			{ kind: "message", value: revenueKeys.storeShare.current },
		]);
		expect(
			card.chart?.series.map((series) => [
				series.label,
				series.tone,
				series.stack,
				series.values,
			]),
		).toEqual([
			[
				{
					key: revenueKeys.storeShare.storeSeries,
					values: { store: { kind: "text", value: "Store 1" } },
				},
				"primary",
				"share",
				[0.5, 0.666667],
			],
			[
				{
					key: revenueKeys.storeShare.storeSeries,
					values: { store: { kind: "text", value: "Store 2" } },
				},
				"secondary",
				"share",
				[0.5, 0.333333],
			],
		]);
		expect(card.chart?.leftUnit).toBe("fraction");
	});

	it("counts a store that was not open in the previous range at a previous share of zero", () => {
		const context = themeContext("28d", [STORE_A, STORE_B]);
		const card = buildStoreShareCard(
			cardInput(
				context,
				{
					[revenueCalls.totals]: [
						totalsRow(context, "current", null, sales(150 * M, 3000, 4500)),
						totalsRow(context, "previous", null, sales(60 * M, 1200, 1800)),
						totalsRow(context, "current", STORE_A, sales(100 * M, 2000, 3000)),
						totalsRow(context, "previous", STORE_A, sales(60 * M, 1200, 1800)),
						totalsRow(context, "current", STORE_B, sales(50 * M, 1000, 1500)),
					],
				},
				[
					coverageRow(STORE_A),
					coverageRow(STORE_B, { history_start: "2026-10-10" }),
				],
			),
		);
		expect(
			card.tables[0]?.rows.map((row) => [
				row.cells.share,
				row.cells.previousShare,
				row.cells.change,
			]),
		).toEqual([
			[0.666667, 1, -0.333333],
			[0.333333, 0, 0.333333],
		]);
	});

	it("says there is no data without totals", () => {
		const context = themeContext("28d", [STORE_A, STORE_B]);
		const card = buildStoreShareCard(cardInput(context, {}));
		expect(card.headline).toEqual({
			value: null,
			unit: "fraction",
			caption: null,
		});
		expect(card.narrative).toEqual([
			{
				key: revenueKeys.storeShare.noData,
				values: { range: rangeValue(context) },
			},
		]);
		expect(card.chart).toBeNull();
		expect(card.tables[0]?.rows.map((row) => row.cells.share)).toEqual([
			null,
			null,
		]);
	});
});
