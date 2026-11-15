import { describe, expect, it } from "vitest";
import { buildHeatmapCard } from "../../../../src/themes/hours/cards/heatmap.js";
import { hoursKeys } from "../../../../src/themes/hours/keys.js";
import { hoursCalls } from "../../../../src/themes/hours/support.js";
import { themeKeys } from "../../../../src/themes/keys.js";
import { rangeValue } from "../../../../src/themes/support.js";
import { coverageRow, STORE_A, STORE_B } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import {
	cardInput,
	heatRow,
	profileRow,
	profileSummary,
	withDayStart,
} from "./support.js";

const SEVEN_O_CLOCK = [
	[1_000_000, 20],
	[1_100_000, 22],
	[1_200_000, 24],
	[1_300_000, 26],
	[1_400_000, 28],
	[3_000_000, 60],
	[2_000_000, 40],
] as const;

const NO_CELLS = {
	d1: null,
	d2: null,
	d3: null,
	d4: null,
	d5: null,
	d6: null,
	d7: null,
};

function hourIds(from: number, count: number): string[] {
	return Array.from({ length: count }, (_, offset) =>
		String((from + offset) % 24),
	);
}

function heatRows() {
	return [
		...SEVEN_O_CLOCK.map(([net, invoices], index) =>
			heatRow({
				weekday: index + 1,
				hour_local: 7,
				avg_net_amount: net,
				net_amount: net * 4,
				avg_invoices: invoices,
				invoices: invoices * 4,
			}),
		),
		heatRow({
			weekday: 1,
			hour_local: 23,
			avg_net_amount: 500_000,
			net_amount: 2_000_000,
			avg_invoices: 10,
			invoices: 40,
		}),
		heatRow({
			weekday: 6,
			hour_local: 0,
			avg_net_amount: 1_500_000,
			net_amount: 6_000_000,
			avg_invoices: 30,
			invoices: 120,
		}),
		heatRow({
			weekday: 3,
			hour_local: 1,
			avg_net_amount: 200_000,
			net_amount: 800_000,
			avg_invoices: 4,
			invoices: 16,
		}),
		heatRow({
			weekday: 2,
			hour_local: 5,
			avg_net_amount: 0,
			net_amount: 0,
			avg_invoices: 0.75,
			invoices: 3,
		}),
	];
}

function hourProfile() {
	return [
		profileRow({
			hour_local: 7,
			hour_position: 1,
			avg_net_amount: 1_570_000,
			avg_invoices: 31.5,
		}),
		profileRow({
			hour_local: 23,
			hour_position: 17,
			avg_net_amount: 70_000,
			avg_invoices: 1.5,
		}),
		profileRow({
			hour_local: 0,
			hour_position: 18,
			avg_net_amount: 210_000,
			avg_invoices: 4.25,
		}),
		profileRow({
			hour_local: 1,
			hour_position: 19,
			avg_net_amount: 30_000,
			avg_invoices: 0.5,
		}),
		profileSummary("all"),
	];
}

function weekdayCoverage() {
	return Array.from({ length: 7 }, (_, index) =>
		heatRow({ weekday: index + 1, hour_local: 9, days_with_data: 4 }),
	);
}

describe("the Giờ & ngày heat table card", () => {
	it("heads with the best cell, names the best and quietest cells with sales, and lays out every hour from the first to the last with sales, from the first store's day start", () => {
		const context = withDayStart(
			themeContext("28d", [STORE_A, STORE_B]),
			[360, 0],
		);
		const card = buildHeatmapCard(
			cardInput(
				context,
				{
					[hoursCalls.heat]: heatRows(),
					[hoursCalls.hours]: hourProfile(),
				},
				[coverageRow(STORE_A), coverageRow(STORE_B)],
			),
		);
		expect(card.subtitle).toEqual({ key: themeKeys.heat.legend, values: {} });
		expect(card.headline).toEqual({
			value: 3_000_000,
			unit: "money",
			caption: {
				key: hoursKeys.heatmap.caption,
				values: {
					weekday: { kind: "message", value: themeKeys.weekday.long[6] },
					hour: { kind: "hour", value: 7 },
				},
			},
		});
		expect(card.narrative).toEqual([
			{
				key: hoursKeys.heatmap.main,
				values: {
					range: rangeValue(context),
					bestDay: { kind: "message", value: themeKeys.weekday.long[6] },
					bestHour: { kind: "hour", value: 7 },
					best: { kind: "money", value: 3_000_000 },
					quietDay: { kind: "message", value: themeKeys.weekday.long[3] },
					quietHour: { kind: "hour", value: 1 },
					quiet: { kind: "money", value: 200_000 },
				},
			},
		]);
		expect(card.tables).toHaveLength(2);
		const [net, invoices] = card.tables;
		expect(net?.captionKey).toBe(hoursKeys.heatmap.netTable);
		expect(net?.variant).toBe("heat");
		expect(net?.heatColumns).toEqual([
			"d1",
			"d2",
			"d3",
			"d4",
			"d5",
			"d6",
			"d7",
		]);
		expect(net?.columns).toEqual([
			{ key: "hour", labelKey: hoursKeys.table.hour, kind: "hour" },
			{ key: "d1", labelKey: themeKeys.weekday.short[1], kind: "money" },
			{ key: "d2", labelKey: themeKeys.weekday.short[2], kind: "money" },
			{ key: "d3", labelKey: themeKeys.weekday.short[3], kind: "money" },
			{ key: "d4", labelKey: themeKeys.weekday.short[4], kind: "money" },
			{ key: "d5", labelKey: themeKeys.weekday.short[5], kind: "money" },
			{ key: "d6", labelKey: themeKeys.weekday.short[6], kind: "money" },
			{ key: "d7", labelKey: themeKeys.weekday.short[7], kind: "money" },
			{ key: "average", labelKey: hoursKeys.table.average, kind: "money" },
		]);
		expect(net?.rows.map((row) => row.id)).toEqual(hourIds(7, 19));
		const shown = new Set(["7", "23", "0", "1"]);
		for (const row of net?.rows ?? []) {
			if (shown.has(row.id)) continue;
			expect(row.cells).toEqual({
				...NO_CELLS,
				hour: Number(row.id),
				average: null,
			});
		}
		expect(net?.rows.filter((row) => shown.has(row.id))).toEqual([
			{
				id: "7",
				cells: {
					hour: 7,
					average: 1_570_000,
					d1: 1_000_000,
					d2: 1_100_000,
					d3: 1_200_000,
					d4: 1_300_000,
					d5: 1_400_000,
					d6: 3_000_000,
					d7: 2_000_000,
				},
			},
			{
				id: "23",
				cells: { ...NO_CELLS, hour: 23, average: 70_000, d1: 500_000 },
			},
			{
				id: "0",
				cells: { ...NO_CELLS, hour: 0, average: 210_000, d6: 1_500_000 },
			},
			{
				id: "1",
				cells: { ...NO_CELLS, hour: 1, average: 30_000, d3: 200_000 },
			},
		]);
		expect(invoices?.captionKey).toBe(hoursKeys.heatmap.invoicesTable);
		expect(invoices?.variant).toBe("heat");
		expect(invoices?.heatColumns).not.toContain("average");
		expect(invoices?.columns.map((column) => column.kind)).toEqual([
			"hour",
			"decimal",
			"decimal",
			"decimal",
			"decimal",
			"decimal",
			"decimal",
			"decimal",
			"decimal",
		]);
		expect(invoices?.rows[0]?.cells).toEqual({
			hour: 7,
			average: 31.5,
			d1: 20,
			d2: 22,
			d3: 24,
			d4: 26,
			d5: 28,
			d6: 60,
			d7: 40,
		});
		expect(
			invoices?.rows
				.filter((row) => shown.has(row.id))
				.map((row) => row.cells.average),
		).toEqual([31.5, 1.5, 4.25, 0.5]);
		expect(card.chart).toBeNull();
		expect(card.notice).toBeNull();
		expect(card.markers.verification).toBe("verified");
		expect(card.csvName).toBe("gio-ngay-heatmap-2026-10-10_2026-11-06");
	});

	it("starts the rows at midnight when the first selected store's day starts at midnight", () => {
		const context = withDayStart(
			themeContext("28d", [STORE_A, STORE_B]),
			[0, 360],
		);
		const card = buildHeatmapCard(
			cardInput(context, {
				[hoursCalls.heat]: heatRows(),
				[hoursCalls.hours]: hourProfile(),
			}),
		);
		expect(card.tables[0]?.rows.map((row) => row.id)).toEqual(hourIds(0, 24));
	});

	it("leaves the average empty for an hour the profile does not hold", () => {
		const card = buildHeatmapCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[hoursCalls.heat]: heatRows(),
			}),
		);
		const averages = card.tables[0]?.rows.map((row) => row.cells.average);
		expect(averages).toHaveLength(24);
		expect(averages?.every((average) => average === null)).toBe(true);
	});

	it("adds a notice when a weekday has fewer than two days of data", () => {
		const thinSunday = weekdayCoverage().map((row) =>
			row.weekday === 7 ? { ...row, days_with_data: 1 } : row,
		);
		const thin = buildHeatmapCard(
			cardInput(themeContext("28d", [STORE_A]), {
				[hoursCalls.heat]: thinSunday,
			}),
		);
		expect(thin.notice).toEqual({
			tone: "info",
			part: {
				key: hoursKeys.heatmap.thin,
				values: { days: { kind: "count", value: 2 } },
			},
			action: null,
		});
		const twoSundays = weekdayCoverage().map((row) =>
			row.weekday === 7 ? { ...row, days_with_data: 2 } : row,
		);
		expect(
			buildHeatmapCard(
				cardInput(themeContext("28d", [STORE_A]), {
					[hoursCalls.heat]: twoSundays,
				}),
			).notice,
		).toBeNull();
		const noSunday = weekdayCoverage().filter((row) => row.weekday !== 7);
		expect(
			buildHeatmapCard(
				cardInput(themeContext("28d", [STORE_A]), {
					[hoursCalls.heat]: noSunday,
				}),
			).notice?.part.key,
		).toBe(hoursKeys.heatmap.thin);
	});

	it("says there is no data and draws no table without cells", () => {
		const context = themeContext("28d", [STORE_A]);
		const card = buildHeatmapCard(cardInput(context, {}));
		expect(card.headline).toEqual({
			value: null,
			unit: "money",
			caption: null,
		});
		expect(card.narrative).toEqual([
			{ key: hoursKeys.heatmap.noData, values: { range: rangeValue(context) } },
		]);
		expect(card.tables).toEqual([]);
		expect(card.notice).toBeNull();
		expect(card.markers.verification).toBe("unverified");
	});
});
