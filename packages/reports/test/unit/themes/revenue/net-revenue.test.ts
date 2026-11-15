import { describe, expect, it } from "vitest";
import { reportKeys } from "../../../../src/model/keys.js";
import { TOTALS_LIKE_FOR_LIKE_KEYS } from "../../../../src/themes/definition.js";
import { themeKeys } from "../../../../src/themes/keys.js";
import { revenueNetCard } from "../../../../src/themes/revenue/cards/net-revenue.js";
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
const lastYearLabel = { key: themeKeys.compare.lastYear, values: {} };
const PREVIOUS_SPAN = { from: "2026-09-12", to: "2026-10-09" };
const LAST_YEAR_SPAN = { from: "2025-10-11", to: "2025-11-07" };
const YOUNG_LAST_YEAR = "report.unavailable.store_too_young.last_year";

describe("the Doanh thu net revenue card", () => {
	it("reads one store's net against both references and explains the change by traffic", () => {
		const context = themeContext("28d", [STORE_A]);
		const card = revenueNetCard.build(
			cardInput(
				context,
				{
					[revenueCalls.totals]: [
						totalsRow(context, "current", null, sales(150_000_000, 3000, 4500)),
						totalsRow(
							context,
							"previous",
							null,
							sales(120_000_000, 2400, 3600),
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
		expect(card.headline).toEqual({
			value: 150_000_000,
			unit: "money",
			caption: null,
		});
		expect(card.comparisons).toEqual([
			{
				kind: "previous",
				label: previousLabel,
				range: PREVIOUS_SPAN,
				current: 150_000_000,
				reference: 120_000_000,
				change: 0.25,
				difference: 30_000_000,
				basis: "all_stores",
				coveredStores: 1,
				totalStores: 1,
				sampleDays: null,
				unavailable: null,
			},
			{
				kind: "last_year",
				label: lastYearLabel,
				range: LAST_YEAR_SPAN,
				current: 150_000_000,
				reference: 100_000_000,
				change: 0.5,
				difference: 50_000_000,
				basis: "all_stores",
				coveredStores: 1,
				totalStores: 1,
				sampleDays: null,
				unavailable: null,
			},
		]);
		expect(card.decomposition).toEqual({
			metric: "net_revenue",
			against: "previous",
			basis: "all_stores",
			total: 30_000_000,
			parts: [
				{ factor: "invoices", from: 2400, to: 3000, effect: 30_000_000 },
				{ factor: "items_per_ticket", from: 1.5, to: 1.5, effect: 0 },
				{
					factor: "avg_item_price",
					from: 33_333.33,
					to: 33_333.33,
					effect: 0,
				},
			],
		});
		expect(card.narrative).toEqual([
			{
				key: revenueKeys.net.up,
				values: {
					range: rangeValue(context),
					value: { kind: "money", value: 150_000_000 },
					reference: { kind: "part", value: previousLabel },
					delta: { kind: "percent", value: 0.25 },
				},
			},
			{
				key: reportKeys.clause.decomposition.invoices,
				values: { effect: { kind: "moneySigned", value: 30_000_000 } },
			},
		]);
		expect(card.tables).toHaveLength(1);
		expect(card.tables[0]?.captionKey).toBe(revenueKeys.net.periodTable);
		expect(card.tables[0]?.columns.map((column) => column.key)).toEqual([
			"period",
			"net",
			"invoices",
			"avgTicket",
		]);
		expect(card.tables[0]?.rows).toEqual([
			{
				id: "current",
				cells: {
					period: revenueKeys.periodRow.current,
					net: 150_000_000,
					invoices: 3000,
					avgTicket: 50_000,
				},
			},
			{
				id: "previous",
				cells: {
					period: revenueKeys.periodRow.previous,
					net: 120_000_000,
					invoices: 2400,
					avgTicket: 50_000,
				},
			},
			{
				id: "last_year",
				cells: {
					period: revenueKeys.periodRow.lastYear,
					net: 100_000_000,
					invoices: 2000,
					avgTicket: 50_000,
				},
			},
		]);
		expect(card.chart).toBeNull();
		expect(card.notice).toBeNull();
		expect(card.markers).toEqual({
			provisional: false,
			stale: false,
			verification: "verified",
		});
		expect(card.csvName).toBe("doanh-thu-net_revenue-2026-10-10_2026-11-06");
	});

	it("names the store that moved most with two stores and lays out a store table and grouped bars", () => {
		const context = themeContext("28d", [STORE_A, STORE_B]);
		const card = revenueNetCard.build(
			cardInput(
				context,
				{
					[revenueCalls.totals]: [
						totalsRow(context, "current", null, sales(150_000_000, 3000, 4500)),
						totalsRow(
							context,
							"previous",
							null,
							sales(120_000_000, 2400, 3600),
						),
						totalsRow(
							context,
							"last_year",
							null,
							sales(100_000_000, 2000, 3000),
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
							sales(60_000_000, 1200, 1800),
						),
						totalsRow(
							context,
							"last_year",
							STORE_A,
							sales(75_000_000, 1500, 2250),
						),
						totalsRow(
							context,
							"current",
							STORE_B,
							sales(50_000_000, 1000, 1500),
						),
						totalsRow(
							context,
							"previous",
							STORE_B,
							sales(60_000_000, 1200, 1800),
						),
						totalsRow(
							context,
							"last_year",
							STORE_B,
							sales(25_000_000, 500, 750),
						),
					],
				},
				[coverageRow(STORE_A), coverageRow(STORE_B)],
			),
		);
		expect(card.headline.value).toBe(150_000_000);
		expect(card.comparisons[0]?.change).toBe(0.25);
		expect(card.comparisons[0]?.totalStores).toBe(2);
		expect(card.narrative.map((part) => part.key)).toEqual([
			revenueKeys.net.up,
			reportKeys.clause.driver.store,
		]);
		expect(card.narrative[1]?.values).toEqual({
			store: { kind: "text", value: "Store 1" },
			delta: { kind: "moneySigned", value: 40_000_000 },
		});
		const table = card.tables[0];
		expect(card.tables).toHaveLength(1);
		expect(table?.captionKey).toBe(revenueKeys.net.storeTable);
		expect(table?.columns).toEqual([
			{ key: "store", labelKey: reportKeys.table.store, kind: "text" },
			{ key: "value", labelKey: reportKeys.table.netAmount, kind: "money" },
			{ key: "previous", labelKey: revenueKeys.table.previous, kind: "money" },
			{
				key: "changePrevious",
				labelKey: revenueKeys.table.changePrevious,
				kind: "signedPercent",
			},
			{ key: "lastYear", labelKey: revenueKeys.table.lastYear, kind: "money" },
			{
				key: "changeLastYear",
				labelKey: revenueKeys.table.changeLastYear,
				kind: "signedPercent",
			},
		]);
		expect(table?.rows).toEqual([
			{
				id: STORE_A,
				cells: {
					store: "Store 1",
					value: 100_000_000,
					previous: 60_000_000,
					changePrevious: 2 / 3,
					lastYear: 75_000_000,
					changeLastYear: 1 / 3,
					state: null,
				},
			},
			{
				id: STORE_B,
				cells: {
					store: "Store 2",
					value: 50_000_000,
					previous: 60_000_000,
					changePrevious: -1 / 6,
					lastYear: 25_000_000,
					changeLastYear: 1,
					state: null,
				},
			},
		]);
		expect(table?.initialSort).toEqual({
			key: "value",
			direction: "descending",
		});
		expect(card.chart?.labelKey).toBe(revenueKeys.net.chart);
		expect(card.chart?.categories).toEqual([
			{ kind: "text", value: "Store 1" },
			{ kind: "text", value: "Store 2" },
		]);
		expect(
			card.chart?.series.map((series) => [
				series.label.key,
				series.kind,
				series.tone,
				series.values,
			]),
		).toEqual([
			[
				revenueKeys.periodRow.current,
				"bar",
				"primary",
				[100_000_000, 50_000_000],
			],
			[
				revenueKeys.periodRow.previous,
				"bar",
				"muted",
				[60_000_000, 60_000_000],
			],
		]);
		expect(card.chart?.leftUnit).toBe("money");
	});

	it("compares like for like while one store is too young, and takes the driver and the split from the covered store", () => {
		const context = themeContext("28d", [STORE_A, STORE_B]);
		const card = revenueNetCard.build(
			cardInput(
				context,
				{
					[revenueCalls.totals]: [
						totalsRow(context, "current", null, sales(150_000_000, 3000, 4500)),
						totalsRow(context, "previous", null, sales(80_000_000, 1600, 2400)),
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
							sales(80_000_000, 1600, 2400),
						),
						totalsRow(
							context,
							"current",
							STORE_B,
							sales(50_000_000, 1000, 1500),
						),
						totalsRow(context, "previous", STORE_B, {
							...sales(0, 0, 0),
							days_with_data: 0,
						}),
					],
					[TOTALS_LIKE_FOR_LIKE_KEYS.previous]: likeForLikeRows(
						context,
						"previous",
						sales(100_000_000, 2000, 3000),
						sales(80_000_000, 1600, 2400),
					),
					[TOTALS_LIKE_FOR_LIKE_KEYS.last_year]: likeForLikeRows(
						context,
						"last_year",
						sales(100_000_000, 2000, 3000),
						sales(125_000_000, 2500, 3750),
					),
				},
				[
					coverageRow(STORE_A),
					coverageRow(STORE_B, { history_start: "2026-10-10" }),
				],
			),
		);
		const likeForLikeLabel = (label: object) => ({
			key: reportKeys.compare.likeForLike,
			values: {
				label: { kind: "part", value: label },
				covered: { kind: "count", value: 1 },
				total: { kind: "count", value: 2 },
			},
		});
		expect(card.headline.value).toBe(150_000_000);
		expect(card.comparisons).toEqual([
			{
				kind: "previous",
				label: likeForLikeLabel(previousLabel),
				range: PREVIOUS_SPAN,
				current: 100_000_000,
				reference: 80_000_000,
				change: 0.25,
				difference: 20_000_000,
				basis: "like_for_like",
				coveredStores: 1,
				totalStores: 2,
				sampleDays: null,
				unavailable: null,
			},
			{
				kind: "last_year",
				label: likeForLikeLabel(lastYearLabel),
				range: LAST_YEAR_SPAN,
				current: 100_000_000,
				reference: 125_000_000,
				change: -0.2,
				difference: -25_000_000,
				basis: "like_for_like",
				coveredStores: 1,
				totalStores: 2,
				sampleDays: null,
				unavailable: null,
			},
		]);
		expect(card.narrative).toEqual([
			{
				key: revenueKeys.net.up,
				values: {
					range: rangeValue(context),
					value: { kind: "money", value: 150_000_000 },
					reference: { kind: "part", value: likeForLikeLabel(previousLabel) },
					delta: { kind: "percent", value: 0.25 },
				},
			},
			{
				key: reportKeys.clause.coverage.likeForLikeValues,
				values: {
					covered: { kind: "count", value: 1 },
					total: { kind: "count", value: 2 },
					current: { kind: "money", value: 100_000_000 },
					reference: { kind: "money", value: 80_000_000 },
				},
			},
			{
				key: reportKeys.clause.driver.store,
				values: {
					store: { kind: "text", value: "Store 1" },
					delta: { kind: "moneySigned", value: 20_000_000 },
				},
			},
		]);
		expect(card.decomposition?.basis).toBe("like_for_like");
		expect(card.decomposition?.total).toBe(20_000_000);
		expect(card.decomposition?.parts[0]).toEqual({
			factor: "invoices",
			from: 1600,
			to: 2000,
			effect: 20_000_000,
		});
		const table = card.tables[0];
		expect(table?.columns.at(-1)).toEqual({
			key: "state",
			labelKey: reportKeys.table.state,
			kind: "message",
		});
		expect(table?.rows.map((row) => row.cells.state)).toEqual([
			null,
			YOUNG_LAST_YEAR,
		]);
		expect(table?.rows[1]?.cells.changePrevious).toBeNull();
	});

	it("marks both chips unavailable and says when the young store's history starts without any coverage", () => {
		const context = themeContext("28d", [STORE_A]);
		const card = revenueNetCard.build(
			cardInput(
				context,
				{
					[revenueCalls.totals]: [
						totalsRow(context, "current", null, sales(150_000_000, 3000, 4500)),
					],
				},
				[coverageRow(STORE_A, { history_start: "2026-10-10" })],
			),
		);
		expect(card.headline.value).toBe(150_000_000);
		expect(card.comparisons).toEqual([
			{
				kind: "previous",
				label: previousLabel,
				range: PREVIOUS_SPAN,
				current: 150_000_000,
				reference: null,
				change: null,
				difference: null,
				basis: "all_stores",
				coveredStores: 0,
				totalStores: 1,
				sampleDays: null,
				unavailable: "store_too_young",
			},
			{
				kind: "last_year",
				label: lastYearLabel,
				range: LAST_YEAR_SPAN,
				current: 150_000_000,
				reference: null,
				change: null,
				difference: null,
				basis: "all_stores",
				coveredStores: 0,
				totalStores: 1,
				sampleDays: null,
				unavailable: "store_too_young",
			},
		]);
		expect(card.decomposition).toBeNull();
		expect(card.narrative).toEqual([
			{
				key: revenueKeys.net.noReference,
				values: {
					range: rangeValue(context),
					value: { kind: "money", value: 150_000_000 },
					reference: { kind: "part", value: previousLabel },
				},
			},
			{
				key: reportKeys.clause.coverage.youngStore,
				values: {
					store: { kind: "text", value: "Store 1" },
					date: { kind: "date", value: "2026-10-10" },
				},
			},
		]);
		expect(card.tables[0]?.columns.map((column) => column.key)).toEqual([
			"period",
			"net",
			"invoices",
			"avgTicket",
			"state",
		]);
		expect(card.tables[0]?.rows).toEqual([
			{
				id: "current",
				cells: {
					period: revenueKeys.periodRow.current,
					net: 150_000_000,
					invoices: 3000,
					avgTicket: 50_000,
					state: null,
				},
			},
			{
				id: "previous",
				cells: {
					period: revenueKeys.periodRow.previous,
					net: null,
					invoices: null,
					avgTicket: null,
					state: null,
				},
			},
			{
				id: "last_year",
				cells: {
					period: revenueKeys.periodRow.lastYear,
					net: null,
					invoices: null,
					avgTicket: null,
					state: YOUNG_LAST_YEAR,
				},
			},
		]);
	});

	it("says there is no data without rows or coverage", () => {
		const context = themeContext("28d", [STORE_A]);
		const card = revenueNetCard.build(cardInput(context, {}));
		expect(card.headline.value).toBeNull();
		expect(card.comparisons.map((entry) => entry.unavailable)).toEqual([
			"no_data",
			"no_data",
		]);
		expect(card.decomposition).toBeNull();
		expect(card.narrative).toEqual([
			{
				key: revenueKeys.net.noData,
				values: {
					range: rangeValue(context),
					reference: { kind: "part", value: previousLabel },
				},
			},
		]);
		expect(card.tables[0]?.columns.map((column) => column.key)).toEqual([
			"period",
			"net",
			"invoices",
			"avgTicket",
		]);
		expect(card.tables[0]?.rows.map((row) => row.cells.net)).toEqual([
			null,
			null,
			null,
		]);
		expect(card.markers.verification).toBe("unverified");
	});

	it("keeps a real zero as zero, falling by the whole previous net without a split", () => {
		const context = themeContext("28d", [STORE_A]);
		const card = revenueNetCard.build(
			cardInput(
				context,
				{
					[revenueCalls.totals]: [
						totalsRow(context, "current", null, sales(0, 0, 0)),
						totalsRow(context, "previous", null, sales(50_000_000, 1000, 1500)),
						totalsRow(context, "last_year", null, sales(40_000_000, 800, 1200)),
					],
				},
				[coverageRow(STORE_A)],
			),
		);
		expect(card.headline.value).toBe(0);
		expect(card.comparisons[0]?.change).toBe(-1);
		expect(card.comparisons[0]?.difference).toBe(-50_000_000);
		expect(card.comparisons[0]?.unavailable).toBeNull();
		expect(card.decomposition).toBeNull();
		expect(card.narrative).toEqual([
			{
				key: revenueKeys.net.down,
				values: {
					range: rangeValue(context),
					value: { kind: "money", value: 0 },
					reference: { kind: "part", value: previousLabel },
					delta: { kind: "percent", value: 1 },
				},
			},
		]);
		expect(card.tables[0]?.rows[0]?.cells).toEqual({
			period: revenueKeys.periodRow.current,
			net: 0,
			invoices: 0,
			avgTicket: null,
		});
	});

	it("splits the change against last year and names that reference when the previous range has no data", () => {
		const context = themeContext("28d", [STORE_A]);
		const card = revenueNetCard.build(
			cardInput(
				context,
				{
					[revenueCalls.totals]: [
						totalsRow(context, "current", null, sales(150_000_000, 3000, 4500)),
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
		expect(card.comparisons[0]?.unavailable).toBe("no_data");
		expect(card.decomposition?.against).toBe("last_year");
		expect(card.decomposition?.total).toBe(50_000_000);
		expect(card.narrative).toEqual([
			{
				key: revenueKeys.net.noReference,
				values: {
					range: rangeValue(context),
					value: { kind: "money", value: 150_000_000 },
					reference: { kind: "part", value: previousLabel },
				},
			},
			{
				key: reportKeys.clause.decompositionReference.invoices,
				values: {
					against: { kind: "part", value: lastYearLabel },
					total: { kind: "moneySigned", value: 50_000_000 },
					effect: { kind: "moneySigned", value: 50_000_000 },
				},
			},
		]);
	});
});
