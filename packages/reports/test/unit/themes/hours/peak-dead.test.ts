import { describe, expect, it } from "vitest";
import { buildPeakDeadCard } from "../../../../src/themes/hours/cards/peak-dead.js";
import { hoursKeys } from "../../../../src/themes/hours/keys.js";
import { hoursCalls } from "../../../../src/themes/hours/support.js";
import { themeKeys } from "../../../../src/themes/keys.js";
import { rangeValue } from "../../../../src/themes/support.js";
import { coverageRow, STORE_A, STORE_B } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import { cardInput, dayProfile, profileSummary } from "./support.js";

const previousLabel = {
	key: themeKeys.compare.previousWeeks,
	values: { weeks: { kind: "count", value: 4 } },
};

function twoPeakDay() {
	return dayProfile("all", 7, [
		{ level: "dead", net: 150_000, share: 0.03 },
		{ level: "peak", net: 900_000, share: 0.18 },
		{ level: "peak", net: 800_000, share: 0.16 },
		{ level: "normal", net: 400_000, share: 0.08 },
		{ level: "normal", net: 450_000, share: 0.09 },
		{ level: "peak", net: 850_000, share: 0.17 },
		{ level: "normal", net: 400_000, share: 0.08 },
		{ level: "dead", net: 0, share: 0 },
		{ level: "normal", net: 500_000, share: 0.1 },
		{ level: "normal", net: 500_000, share: 0.1 },
		{ level: "dead", net: 50_000, share: 0.01 },
	]);
}

describe("the Giờ & ngày peak and quiet hours card", () => {
	it("reads the peak-hours share with a chip in points and names the peak and quiet windows", () => {
		const context = themeContext("28d", [STORE_A]);
		const card = buildPeakDeadCard(
			cardInput(
				context,
				{
					[hoursCalls.hours]: [
						...twoPeakDay(),
						profileSummary("all", { peak_share: 0.51, dead_share: 0.04 }),
						profileSummary("weekdays", { peak_share: 0.9 }),
					],
					[hoursCalls.hoursPrevious]: [
						profileSummary("all", { peak_share: 0.45, dead_share: 0.05 }),
					],
				},
				[coverageRow(STORE_A)],
			),
		);
		expect(card.headline).toEqual({
			value: 0.51,
			unit: "fraction",
			caption: {
				key: hoursKeys.peakDead.window,
				values: { hours: { kind: "count", value: 3 } },
			},
		});
		expect(card.comparisons).toHaveLength(1);
		expect(card.comparisons[0]).toMatchObject({
			kind: "previous",
			label: previousLabel,
			range: { from: "2026-09-12", to: "2026-10-09" },
			current: 0.51,
			reference: 0.45,
			difference: 0.06,
			unit: "fraction",
			unavailable: null,
		});
		expect(card.comparisons[0]?.change).toBeCloseTo(0.133333, 6);
		expect(card.narrative).toEqual([
			{
				key: hoursKeys.peakDead.main,
				values: {
					range: rangeValue(context),
					peak: { kind: "text", value: "08:00–10:00, 12:00–13:00" },
					peakShare: { kind: "percent", value: 0.51 },
					peakHours: { kind: "count", value: 3 },
					dead: {
						kind: "text",
						value: "07:00–08:00, 14:00–15:00, 17:00–18:00",
					},
					deadShare: { kind: "percent", value: 0.04 },
				},
			},
		]);
		const table = card.tables[0];
		expect(table?.captionKey).toBe(hoursKeys.peakDead.table);
		expect(table?.columns.map((column) => [column.key, column.kind])).toEqual([
			["hour", "hour"],
			["meanNet", "money"],
			["share", "percent"],
			["level", "message"],
		]);
		expect(table?.rows.map((row) => row.id)).toEqual([
			"7",
			"8",
			"9",
			"10",
			"11",
			"12",
			"13",
			"14",
			"15",
			"16",
			"17",
		]);
		expect(table?.rows[7]?.cells).toEqual({
			hour: 14,
			meanNet: 0,
			share: 0,
			level: hoursKeys.level.dead,
		});
		expect(table?.rows[1]?.cells.level).toBe(hoursKeys.level.peak);
		const chart = card.chart;
		expect(chart?.categories).toEqual(
			[7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map((hour) => ({
				kind: "hour",
				value: hour,
			})),
		);
		expect(
			chart?.series.map((series) => [
				series.label.key,
				series.tone,
				series.stack,
			]),
		).toEqual([
			[hoursKeys.level.peak, "primary", "level"],
			[hoursKeys.level.normal, "secondary", "level"],
			[hoursKeys.level.dead, "muted", "level"],
		]);
		expect(chart?.series[0]?.values).toEqual([
			null,
			900_000,
			800_000,
			null,
			null,
			850_000,
			null,
			null,
			null,
			null,
			null,
		]);
		expect(chart?.series[2]?.values).toEqual([
			150_000,
			null,
			null,
			null,
			null,
			null,
			null,
			0,
			null,
			null,
			50_000,
		]);
		expect(card.csvName).toBe("gio-ngay-peak_dead-2026-10-10_2026-11-06");
	});

	it("leaves the quiet windows out of the sentence without dead hours and marks the chip unavailable without a previous range", () => {
		const context = themeContext("28d", [STORE_A, STORE_B]);
		const card = buildPeakDeadCard(
			cardInput(context, {
				[hoursCalls.hours]: [
					...dayProfile("all", 8, [
						{ level: "peak" },
						{ level: "peak" },
						{ level: "peak" },
						{ level: "normal" },
					]),
					profileSummary("all", { peak_share: 0.7, dead_share: 0 }),
				],
			}),
		);
		expect(card.comparisons[0]).toMatchObject({
			current: 0.7,
			reference: null,
			change: null,
			unavailable: "no_data",
			totalStores: 2,
		});
		expect(card.narrative).toEqual([
			{
				key: hoursKeys.peakDead.noDead,
				values: {
					range: rangeValue(context),
					peak: { kind: "text", value: "08:00–11:00" },
					peakShare: { kind: "percent", value: 0.7 },
					peakHours: { kind: "count", value: 3 },
				},
			},
		]);
	});

	it("says there is no data and draws nothing without a profile", () => {
		const context = themeContext("28d", [STORE_A]);
		const card = buildPeakDeadCard(cardInput(context, {}));
		expect(card.headline).toEqual({
			value: null,
			unit: "fraction",
			caption: null,
		});
		expect(card.comparisons).toEqual([]);
		expect(card.narrative).toEqual([
			{
				key: hoursKeys.peakDead.noData,
				values: { range: rangeValue(context) },
			},
		]);
		expect(card.tables).toEqual([]);
		expect(card.chart).toBeNull();
	});
});
