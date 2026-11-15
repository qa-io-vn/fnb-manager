import { describe, expect, it } from "vitest";
import { reportKeys } from "../../../../src/model/keys.js";
import { buildByMonthCard } from "../../../../src/themes/revenue/cards/by-month.js";
import { revenueKeys } from "../../../../src/themes/revenue/keys.js";
import { revenueCalls } from "../../../../src/themes/revenue/support.js";
import { rangeValue } from "../../../../src/themes/support.js";
import { coverageRow, STORE_A, STORE_B } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import { cardInput, monthRow } from "./support.js";

const M = 1_000_000;

describe("the Doanh thu month-by-month card", () => {
	it("heads with the latest whole month, names the best month and compares every month with last year", () => {
		const context = themeContext("91d", [STORE_A, STORE_B]);
		const card = buildByMonthCard(
			cardInput(
				context,
				{
					[revenueCalls.months]: [
						monthRow(null, "2026-08-08", "2026-08-31", 72 * M),
						monthRow(null, "2026-09-01", "2026-09-30", 90 * M),
						monthRow(null, "2026-10-01", "2026-10-31", 100 * M),
						monthRow(null, "2026-11-01", "2026-11-06", 20 * M),
					],
					[revenueCalls.monthsLastYear]: [
						monthRow(null, "2025-08-08", "2025-08-31", 60 * M),
						monthRow(null, "2025-09-01", "2025-09-30", 75 * M),
						monthRow(null, "2025-10-01", "2025-10-31", 80 * M),
						monthRow(null, "2025-11-01", "2025-11-06", 25 * M),
					],
				},
				[coverageRow(STORE_A), coverageRow(STORE_B)],
			),
		);
		expect(card.headline).toEqual({
			value: 100 * M,
			unit: "money",
			caption: {
				key: revenueKeys.byMonth.caption,
				values: { month: { kind: "month", value: "2026-10-01" } },
			},
		});
		expect(card.narrative).toEqual([
			{
				key: revenueKeys.byMonth.main,
				values: {
					range: rangeValue(context),
					month: { kind: "month", value: "2026-10-01" },
					value: { kind: "money", value: 100 * M },
					delta: { kind: "signedPercent", value: 0.25 },
				},
			},
		]);
		const table = card.tables[0];
		expect(table?.columns.map((column) => column.key)).toEqual([
			"month",
			"net",
			"lastYear",
			"change",
		]);
		expect(table?.rows).toEqual([
			{
				id: "2026-08-08",
				cells: {
					month: "2026-08-08",
					net: 72 * M,
					lastYear: 60 * M,
					change: 0.2,
					basis: null,
				},
			},
			{
				id: "2026-09-01",
				cells: {
					month: "2026-09-01",
					net: 90 * M,
					lastYear: 75 * M,
					change: 0.2,
					basis: null,
				},
			},
			{
				id: "2026-10-01",
				cells: {
					month: "2026-10-01",
					net: 100 * M,
					lastYear: 80 * M,
					change: 0.25,
					basis: null,
				},
			},
			{
				id: "2026-11-01",
				cells: {
					month: "2026-11-01",
					net: 20 * M,
					lastYear: 25 * M,
					change: -0.2,
					basis: null,
				},
			},
		]);
		expect(
			card.chart?.series.map((series) => [
				series.label.key,
				series.tone,
				series.values,
			]),
		).toEqual([
			[
				revenueKeys.byMonth.thisYear,
				"primary",
				[72 * M, 90 * M, 100 * M, 20 * M],
			],
			[revenueKeys.byMonth.lastYear, "muted", [60 * M, 75 * M, 80 * M, 25 * M]],
		]);
		expect(card.csvName).toBe("doanh-thu-by_month-2026-08-08_2026-11-06");
	});

	it("compares the covered stores only while one store has no history last year", () => {
		const context = themeContext("91d", [STORE_A, STORE_B]);
		const card = buildByMonthCard(
			cardInput(
				context,
				{
					[revenueCalls.months]: [
						monthRow(null, "2026-09-01", "2026-09-30", 90 * M),
						monthRow(STORE_A, "2026-09-01", "2026-09-30", 60 * M),
						monthRow(STORE_B, "2026-09-01", "2026-09-30", 30 * M),
						monthRow(null, "2026-10-01", "2026-10-31", 100 * M),
						monthRow(STORE_A, "2026-10-01", "2026-10-31", 70 * M),
						monthRow(STORE_B, "2026-10-01", "2026-10-31", 30 * M),
					],
					[revenueCalls.monthsLastYear]: [
						monthRow(null, "2025-09-01", "2025-09-30", 50 * M),
						monthRow(STORE_A, "2025-09-01", "2025-09-30", 50 * M),
						monthRow(null, "2025-10-01", "2025-10-31", 56 * M),
						monthRow(STORE_A, "2025-10-01", "2025-10-31", 56 * M),
					],
				},
				[
					coverageRow(STORE_A),
					coverageRow(STORE_B, { history_start: "2026-01-01" }),
				],
			),
		);
		const table = card.tables[0];
		expect(table?.columns.at(-1)).toEqual({
			key: "basis",
			labelKey: reportKeys.table.state,
			kind: "message",
		});
		expect(table?.rows.map((row) => row.cells)).toEqual([
			{
				month: "2026-09-01",
				net: 90 * M,
				lastYear: 50 * M,
				change: 0.2,
				basis: revenueKeys.byMonth.likeForLike,
			},
			{
				month: "2026-10-01",
				net: 100 * M,
				lastYear: 56 * M,
				change: 0.25,
				basis: revenueKeys.byMonth.likeForLike,
			},
		]);
		expect(card.narrative[0]?.values.delta).toEqual({
			kind: "signedPercent",
			value: 0.25,
		});
	});

	it("leaves last year empty for a store without that history and says so", () => {
		const context = themeContext("91d", [STORE_A]);
		const card = buildByMonthCard(
			cardInput(
				context,
				{
					[revenueCalls.months]: [
						monthRow(null, "2026-09-01", "2026-09-30", 90 * M),
						monthRow(null, "2026-10-01", "2026-10-31", 100 * M),
					],
					[revenueCalls.monthsLastYear]: [
						monthRow(null, "2025-10-01", "2025-10-31", 10 * M),
					],
				},
				[coverageRow(STORE_A, { history_start: "2026-08-08" })],
			),
		);
		expect(card.narrative).toEqual([
			{
				key: revenueKeys.byMonth.noLastYear,
				values: {
					range: rangeValue(context),
					month: { kind: "month", value: "2026-10-01" },
					value: { kind: "money", value: 100 * M },
				},
			},
		]);
		expect(
			card.tables[0]?.rows.map((row) => [row.cells.lastYear, row.cells.change]),
		).toEqual([
			[null, null],
			[null, null],
		]);
	});

	it("says there is no data without month rows", () => {
		const context = themeContext("91d", [STORE_A]);
		const card = buildByMonthCard(cardInput(context, {}));
		expect(card.headline).toEqual({
			value: null,
			unit: "money",
			caption: null,
		});
		expect(card.narrative).toEqual([
			{
				key: revenueKeys.byMonth.noData,
				values: { range: rangeValue(context) },
			},
		]);
		expect(card.tables[0]?.rows).toEqual([]);
		expect(card.chart).toBeNull();
	});
});
