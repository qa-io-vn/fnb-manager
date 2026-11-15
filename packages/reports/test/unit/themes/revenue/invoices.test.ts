import { describe, expect, it } from "vitest";
import { reportKeys } from "../../../../src/model/keys.js";
import { themeKeys } from "../../../../src/themes/keys.js";
import { revenueInvoicesCard } from "../../../../src/themes/revenue/cards/invoices.js";
import { revenueKeys } from "../../../../src/themes/revenue/keys.js";
import { revenueCalls } from "../../../../src/themes/revenue/support.js";
import { rangeValue } from "../../../../src/themes/support.js";
import { coverageRow, STORE_A, STORE_B } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import { cardInput, sales, totalsRow } from "./support.js";

const previousLabel = {
	key: themeKeys.compare.previousWeeks,
	values: { weeks: { kind: "count", value: 4 } },
};

describe("the Doanh thu invoices card", () => {
	it("counts one store's invoices, calls a change under half a percent flat and adds no split", () => {
		const context = themeContext("28d", [STORE_A]);
		const card = revenueInvoicesCard.build(
			cardInput(
				context,
				{
					[revenueCalls.totals]: [
						totalsRow(context, "current", null, sales(150_000_000, 3000, 4500)),
						totalsRow(
							context,
							"previous",
							null,
							sales(149_000_000, 2990, 4485),
						),
						totalsRow(
							context,
							"last_year",
							null,
							sales(100_000_000, 2000, 3000),
						),
					],
				},
				[coverageRow(STORE_A)],
			),
		);
		expect(card.id).toBe("invoices");
		expect(card.headline).toEqual({
			value: 3000,
			unit: "count",
			caption: null,
		});
		expect(card.comparisons[0]).toMatchObject({
			kind: "previous",
			current: 3000,
			reference: 2990,
			difference: 10,
			basis: "all_stores",
		});
		expect(card.comparisons[1]).toMatchObject({
			kind: "last_year",
			reference: 2000,
			change: 0.5,
			difference: 1000,
		});
		expect(card.decomposition).toBeNull();
		expect(card.narrative).toEqual([
			{
				key: revenueKeys.invoices.flat,
				values: {
					range: rangeValue(context),
					value: { kind: "count", value: 3000 },
					reference: { kind: "part", value: previousLabel },
					delta: { kind: "percent", value: 10 / 2990 },
				},
			},
		]);
		expect(card.tables[0]?.captionKey).toBe(revenueKeys.invoices.periodTable);
		expect(card.tables[0]?.rows.map((row) => row.cells.invoices)).toEqual([
			3000, 2990, 2000,
		]);
		expect(card.chart).toBeNull();
		expect(card.csvName).toBe("doanh-thu-invoices-2026-10-10_2026-11-06");
	});

	it("names the store that lost the invoices, keeping its real zero in the store table", () => {
		const context = themeContext("28d", [STORE_A, STORE_B]);
		const card = revenueInvoicesCard.build(
			cardInput(
				context,
				{
					[revenueCalls.totals]: [
						totalsRow(context, "current", null, sales(100_000_000, 2000, 3000)),
						totalsRow(
							context,
							"previous",
							null,
							sales(170_000_000, 3400, 5100),
						),
						totalsRow(
							context,
							"last_year",
							null,
							sales(120_000_000, 2400, 3600),
						),
						totalsRow(
							context,
							"current",
							STORE_A,
							sales(100_000_000, 2000, 3000),
						),
						totalsRow(
							context,
							"previous",
							STORE_A,
							sales(100_000_000, 2000, 3000),
						),
						totalsRow(
							context,
							"last_year",
							STORE_A,
							sales(80_000_000, 1600, 2400),
						),
						totalsRow(context, "current", STORE_B, sales(0, 0, 0)),
						totalsRow(
							context,
							"previous",
							STORE_B,
							sales(70_000_000, 1400, 2100),
						),
						totalsRow(
							context,
							"last_year",
							STORE_B,
							sales(40_000_000, 800, 1200),
						),
					],
				},
				[coverageRow(STORE_A), coverageRow(STORE_B)],
			),
		);
		expect(card.headline.value).toBe(2000);
		expect(card.comparisons[0]?.difference).toBe(-1400);
		expect(card.narrative).toEqual([
			{
				key: revenueKeys.invoices.down,
				values: {
					range: rangeValue(context),
					value: { kind: "count", value: 2000 },
					reference: { kind: "part", value: previousLabel },
					delta: { kind: "percent", value: 1400 / 3400 },
				},
			},
			{
				key: reportKeys.clause.driver.store,
				values: {
					store: { kind: "text", value: "Store 2" },
					delta: { kind: "countSigned", value: -1400 },
				},
			},
		]);
		const table = card.tables[0];
		expect(table?.captionKey).toBe(revenueKeys.invoices.storeTable);
		expect(table?.columns.map((column) => [column.key, column.kind])).toEqual([
			["store", "text"],
			["value", "count"],
			["previous", "count"],
			["changePrevious", "signedPercent"],
			["lastYear", "count"],
			["changeLastYear", "signedPercent"],
		]);
		expect(table?.columns[1]?.labelKey).toBe(reportKeys.table.invoices);
		expect(table?.rows.map((row) => row.cells)).toEqual([
			{
				store: "Store 1",
				value: 2000,
				previous: 2000,
				changePrevious: 0,
				lastYear: 1600,
				changeLastYear: 0.25,
				state: null,
			},
			{
				store: "Store 2",
				value: 0,
				previous: 1400,
				changePrevious: -1,
				lastYear: 800,
				changeLastYear: -1,
				state: null,
			},
		]);
		expect(card.chart?.labelKey).toBe(revenueKeys.invoices.chart);
		expect(card.chart?.leftUnit).toBe("count");
		expect(card.chart?.series.map((series) => series.values)).toEqual([
			[2000, 0],
			[2000, 1400],
		]);
	});

	it("gives no number to compare with for a store opened inside the range", () => {
		const context = themeContext("28d", [STORE_A]);
		const card = revenueInvoicesCard.build(
			cardInput(
				context,
				{
					[revenueCalls.totals]: [
						totalsRow(context, "current", null, sales(30_000_000, 600, 900)),
					],
				},
				[coverageRow(STORE_A, { history_start: "2026-10-20" })],
			),
		);
		expect(card.headline.value).toBe(600);
		expect(
			card.comparisons.map((entry) => [entry.kind, entry.unavailable]),
		).toEqual([
			["previous", "store_too_young"],
			["last_year", "store_too_young"],
		]);
		expect(card.narrative.map((part) => part.key)).toEqual([
			revenueKeys.invoices.noReference,
			reportKeys.clause.coverage.youngStore,
		]);
		expect(card.narrative[1]?.values.date).toEqual({
			kind: "date",
			value: "2026-10-20",
		});
		expect(card.tables[0]?.rows.map((row) => row.cells.state)).toEqual([
			null,
			null,
			"report.unavailable.store_too_young.last_year",
		]);
	});
});
