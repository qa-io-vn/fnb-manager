import { describe, expect, it } from "vitest";
import { buildWeekdayCard } from "../../../../src/themes/hours/cards/weekday.js";
import { hoursKeys } from "../../../../src/themes/hours/keys.js";
import { hoursCalls } from "../../../../src/themes/hours/support.js";
import { themeKeys } from "../../../../src/themes/keys.js";
import { rangeValue } from "../../../../src/themes/support.js";
import { coverageRow, STORE_A, STORE_B } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import {
	cardInput,
	profileRow,
	profileSummary,
	weekdayRow,
} from "./support.js";

const M = 1_000_000;
const WEEK = [
	[4 * M, 80, 0.11],
	[4.2 * M, 84, 0.115],
	[4.4 * M, 88, 0.12],
	[4.6 * M, 92, 0.125],
	[5 * M, 100, 0.14],
	[8 * M, 160, 0.22],
	[6 * M, 120, 0.17],
] as const;
const PREVIOUS_WEEK = [4, 4, 4, 4, 5, 7, 8].map((mean) => mean * M);

function currentRows() {
	const rows = WEEK.map(([mean, invoices, share], index) =>
		weekdayRow(index + 1, mean, { avg_invoices: invoices, net_share: share }),
	);
	return [
		rows[6],
		rows[2],
		profileSummary("all"),
		rows[0],
		profileRow({ hour_local: 9 }),
		rows[5],
		rows[1],
		rows[4],
		rows[3],
	];
}

describe("the Giờ & ngày weekday card", () => {
	it("heads with the best weekday, names the weakest with the gap and the weekday that changed most", () => {
		const context = themeContext("28d", [STORE_A, STORE_B]);
		const card = buildWeekdayCard(
			cardInput(
				context,
				{
					[hoursCalls.hours]: currentRows(),
					[hoursCalls.hoursPrevious]: PREVIOUS_WEEK.map((mean, index) =>
						weekdayRow(index + 1, mean),
					),
				},
				[coverageRow(STORE_A), coverageRow(STORE_B)],
			),
		);
		expect(card.headline).toEqual({
			value: 8 * M,
			unit: "money",
			caption: {
				key: hoursKeys.weekday.caption,
				values: {
					weekday: { kind: "message", value: themeKeys.weekday.long[6] },
				},
			},
		});
		expect(card.narrative).toEqual([
			{
				key: hoursKeys.weekday.main,
				values: {
					range: rangeValue(context),
					best: { kind: "message", value: themeKeys.weekday.long[6] },
					bestValue: { kind: "money", value: 8 * M },
					worst: { kind: "message", value: themeKeys.weekday.long[1] },
					gap: { kind: "percent", value: 1 },
				},
			},
			{
				key: hoursKeys.weekday.driver,
				values: {
					weekday: { kind: "message", value: themeKeys.weekday.long[7] },
					delta: { kind: "signedPercent", value: -0.25 },
				},
			},
		]);
		const table = card.tables[0];
		expect(table?.captionKey).toBe(hoursKeys.weekday.table);
		expect(table?.columns.map((column) => [column.key, column.kind])).toEqual([
			["weekday", "message"],
			["meanNet", "money"],
			["meanInvoices", "decimal"],
			["share", "percent"],
			["previousMean", "money"],
			["change", "signedPercent"],
		]);
		expect(table?.rows.map((row) => row.id)).toEqual([
			"1",
			"2",
			"3",
			"4",
			"5",
			"6",
			"7",
		]);
		expect(table?.rows.map((row) => row.cells.change)).toEqual([
			0,
			0.05,
			0.1,
			0.15,
			0,
			1 / 7,
			-0.25,
		]);
		expect(table?.rows[6]?.cells).toEqual({
			weekday: themeKeys.weekday.long[7],
			meanNet: 6 * M,
			meanInvoices: 120,
			share: 0.17,
			previousMean: 8 * M,
			change: -0.25,
		});
		expect(card.chart?.categories).toEqual(
			[1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
				kind: "message",
				value:
					themeKeys.weekday.long[
						weekday as keyof typeof themeKeys.weekday.long
					],
			})),
		);
		expect(card.chart?.series[0]?.values).toEqual(WEEK.map(([mean]) => mean));
		expect(card.csvName).toBe("gio-ngay-weekday-2026-10-10_2026-11-06");
	});

	it("keeps the earlier weekday on a tie and names no driver without a previous range", () => {
		const context = themeContext("28d", [STORE_A]);
		const card = buildWeekdayCard(
			cardInput(context, {
				[hoursCalls.hours]: [
					weekdayRow(1, 3 * M),
					weekdayRow(2, 5 * M),
					weekdayRow(3, 4 * M),
					weekdayRow(5, 5 * M),
					weekdayRow(7, 3 * M),
				],
			}),
		);
		expect(card.narrative).toEqual([
			{
				key: hoursKeys.weekday.main,
				values: {
					range: rangeValue(context),
					best: { kind: "message", value: themeKeys.weekday.long[2] },
					bestValue: { kind: "money", value: 5 * M },
					worst: { kind: "message", value: themeKeys.weekday.long[1] },
					gap: { kind: "percent", value: 2 / 3 },
				},
			},
		]);
		expect(card.tables[0]?.rows.map((row) => row.id)).toEqual([
			"1",
			"2",
			"3",
			"5",
			"7",
		]);
		expect(
			card.tables[0]?.rows.map((row) => [
				row.cells.previousMean,
				row.cells.change,
			]),
		).toEqual([
			[null, null],
			[null, null],
			[null, null],
			[null, null],
			[null, null],
		]);
	});

	it("says there is no data and draws nothing without weekday rows", () => {
		const context = themeContext("28d", [STORE_A]);
		const card = buildWeekdayCard(
			cardInput(context, {
				[hoursCalls.hours]: [profileSummary("all"), profileRow({})],
			}),
		);
		expect(card.headline).toEqual({
			value: null,
			unit: "money",
			caption: null,
		});
		expect(card.narrative).toEqual([
			{ key: hoursKeys.weekday.noData, values: { range: rangeValue(context) } },
		]);
		expect(card.tables).toEqual([]);
		expect(card.chart).toBeNull();
	});
});
