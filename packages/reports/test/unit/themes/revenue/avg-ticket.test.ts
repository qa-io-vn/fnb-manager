import { describe, expect, it } from "vitest";
import { reportKeys } from "../../../../src/model/keys.js";
import { TOTALS_LIKE_FOR_LIKE_KEYS } from "../../../../src/themes/definition.js";
import { themeKeys } from "../../../../src/themes/keys.js";
import { revenueTicketCard } from "../../../../src/themes/revenue/cards/avg-ticket.js";
import { revenueKeys } from "../../../../src/themes/revenue/keys.js";
import { revenueCalls } from "../../../../src/themes/revenue/support.js";
import { rangeValue } from "../../../../src/themes/support.js";
import { coverageRow, STORE_A, STORE_B } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import { cardInput, likeForLikeRows, sales, totalsRow } from "./support.js";

const previousLabel = {
	key: themeKeys.compare.previousWeeks,
	values: { weeks: { kind: "count", value: 4 } },
};

describe("the Doanh thu average ticket card", () => {
	it("reads the ticket, items per ticket and item price, and splits a rise into more items per ticket", () => {
		const context = themeContext("28d", [STORE_A]);
		const card = revenueTicketCard.build(
			cardInput(
				context,
				{
					[revenueCalls.totals]: [
						totalsRow(context, "current", null, sales(150_000_000, 3000, 6000)),
						totalsRow(
							context,
							"previous",
							null,
							sales(100_000_000, 2500, 4000),
						),
						totalsRow(
							context,
							"last_year",
							null,
							sales(90_000_000, 2250, 3600),
						),
					],
				},
				[coverageRow(STORE_A)],
			),
		);
		expect(card.id).toBe("avg_ticket");
		expect(card.metricId).toBe("avg_ticket");
		expect(card.relatedMetricIds).toEqual([
			"items_per_ticket",
			"avg_item_price",
		]);
		expect(card.headline).toEqual({
			value: 50_000,
			unit: "money",
			caption: null,
		});
		expect(
			card.comparisons.map((entry) => [
				entry.kind,
				entry.reference,
				entry.change,
				entry.difference,
			]),
		).toEqual([
			["previous", 40_000, 0.25, 10_000],
			["last_year", 40_000, 0.25, 10_000],
		]);
		expect(card.decomposition).toEqual({
			metric: "avg_ticket",
			against: "previous",
			basis: "all_stores",
			total: 10_000,
			parts: [
				{ factor: "items_per_ticket", from: 1.6, to: 2, effect: 10_000 },
				{ factor: "avg_item_price", from: 25_000, to: 25_000, effect: 0 },
			],
		});
		expect(card.narrative).toEqual([
			{
				key: revenueKeys.avgTicket.up,
				values: {
					range: rangeValue(context),
					value: { kind: "money", value: 50_000 },
					reference: { kind: "part", value: previousLabel },
					delta: { kind: "percent", value: 0.25 },
				},
			},
			{
				key: reportKeys.clause.decomposition.items_per_ticket,
				values: { effect: { kind: "moneySigned", value: 10_000 } },
			},
		]);
		expect(card.tables).toHaveLength(1);
		expect(card.tables[0]?.captionKey).toBe(revenueKeys.avgTicket.periodTable);
		expect(card.tables[0]?.columns).toEqual([
			{ key: "period", labelKey: reportKeys.table.period, kind: "message" },
			{ key: "avgTicket", labelKey: reportKeys.table.avgTicket, kind: "money" },
			{
				key: "itemsPerTicket",
				labelKey: reportKeys.table.itemsPerTicket,
				kind: "decimal",
			},
			{
				key: "avgItemPrice",
				labelKey: reportKeys.table.avgItemPrice,
				kind: "money",
			},
		]);
		expect(card.tables[0]?.rows).toEqual([
			{
				id: "current",
				cells: {
					period: revenueKeys.periodRow.current,
					avgTicket: 50_000,
					itemsPerTicket: 2,
					avgItemPrice: 25_000,
				},
			},
			{
				id: "previous",
				cells: {
					period: revenueKeys.periodRow.previous,
					avgTicket: 40_000,
					itemsPerTicket: 1.6,
					avgItemPrice: 25_000,
				},
			},
			{
				id: "last_year",
				cells: {
					period: revenueKeys.periodRow.lastYear,
					avgTicket: 40_000,
					itemsPerTicket: 1.6,
					avgItemPrice: 25_000,
				},
			},
		]);
		expect(card.chart).toBeNull();
	});

	it("splits a fall into a lower item price and names no store, keeping the period table with two stores", () => {
		const context = themeContext("28d", [STORE_A, STORE_B]);
		const card = revenueTicketCard.build(
			cardInput(
				context,
				{
					[revenueCalls.totals]: [
						totalsRow(context, "current", null, sales(90_000_000, 3000, 4500)),
						totalsRow(
							context,
							"previous",
							null,
							sales(100_000_000, 2500, 3750),
						),
						totalsRow(
							context,
							"last_year",
							null,
							sales(80_000_000, 2000, 3000),
						),
						totalsRow(
							context,
							"current",
							STORE_A,
							sales(30_000_000, 1000, 1500),
						),
						totalsRow(
							context,
							"previous",
							STORE_A,
							sales(75_000_000, 1500, 2250),
						),
						totalsRow(
							context,
							"current",
							STORE_B,
							sales(60_000_000, 2000, 3000),
						),
						totalsRow(
							context,
							"previous",
							STORE_B,
							sales(25_000_000, 1000, 1500),
						),
					],
				},
				[coverageRow(STORE_A), coverageRow(STORE_B)],
			),
		);
		expect(card.headline.value).toBe(30_000);
		expect(card.comparisons[0]?.change).toBe(-0.25);
		expect(card.decomposition).toEqual({
			metric: "avg_ticket",
			against: "previous",
			basis: "all_stores",
			total: -10_000,
			parts: [
				{ factor: "items_per_ticket", from: 1.5, to: 1.5, effect: 0 },
				{
					factor: "avg_item_price",
					from: 26_666.67,
					to: 20_000,
					effect: -10_000,
				},
			],
		});
		expect(card.narrative).toEqual([
			{
				key: revenueKeys.avgTicket.down,
				values: {
					range: rangeValue(context),
					value: { kind: "money", value: 30_000 },
					reference: { kind: "part", value: previousLabel },
					delta: { kind: "percent", value: 0.25 },
				},
			},
			{
				key: reportKeys.clause.decomposition.avg_item_price,
				values: { effect: { kind: "moneySigned", value: -10_000 } },
			},
		]);
		expect(card.tables).toHaveLength(1);
		expect(card.tables[0]?.captionKey).toBe(revenueKeys.avgTicket.periodTable);
		expect(card.tables[0]?.rows.map((row) => row.id)).toEqual([
			"current",
			"previous",
			"last_year",
		]);
		expect(card.chart).toBeNull();
	});

	it("compares like for like and splits the covered store's ticket while one store is too young", () => {
		const context = themeContext("28d", [STORE_A, STORE_B]);
		const card = revenueTicketCard.build(
			cardInput(
				context,
				{
					[revenueCalls.totals]: [
						totalsRow(context, "current", null, sales(150_000_000, 3000, 6000)),
						totalsRow(context, "previous", null, sales(80_000_000, 2000, 3200)),
						totalsRow(
							context,
							"current",
							STORE_A,
							sales(100_000_000, 2000, 4000),
						),
						totalsRow(
							context,
							"previous",
							STORE_A,
							sales(80_000_000, 2000, 3200),
						),
						totalsRow(
							context,
							"current",
							STORE_B,
							sales(50_000_000, 1000, 2000),
						),
					],
					[TOTALS_LIKE_FOR_LIKE_KEYS.previous]: likeForLikeRows(
						context,
						"previous",
						sales(100_000_000, 2000, 4000),
						sales(80_000_000, 2000, 3200),
					),
					[TOTALS_LIKE_FOR_LIKE_KEYS.last_year]: likeForLikeRows(
						context,
						"last_year",
						sales(100_000_000, 2000, 4000),
						sales(90_000_000, 2250, 3600),
					),
				},
				[
					coverageRow(STORE_A),
					coverageRow(STORE_B, { history_start: "2026-10-10" }),
				],
			),
		);
		expect(card.headline.value).toBe(50_000);
		expect(card.comparisons[0]).toMatchObject({
			basis: "like_for_like",
			current: 50_000,
			reference: 40_000,
			change: 0.25,
			coveredStores: 1,
			totalStores: 2,
		});
		expect(card.decomposition).toEqual({
			metric: "avg_ticket",
			against: "previous",
			basis: "like_for_like",
			total: 10_000,
			parts: [
				{ factor: "items_per_ticket", from: 1.6, to: 2, effect: 10_000 },
				{ factor: "avg_item_price", from: 25_000, to: 25_000, effect: 0 },
			],
		});
		expect(card.narrative.map((part) => part.key)).toEqual([
			revenueKeys.avgTicket.up,
			reportKeys.clause.coverage.likeForLikeValues,
			reportKeys.clause.decomposition.items_per_ticket,
		]);
		expect(card.narrative[1]?.values).toEqual({
			covered: { kind: "count", value: 1 },
			total: { kind: "count", value: 2 },
			current: { kind: "money", value: 50_000 },
			reference: { kind: "money", value: 40_000 },
		});
	});
});
