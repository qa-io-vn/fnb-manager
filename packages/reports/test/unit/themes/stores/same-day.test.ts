import { describe, expect, it } from "vitest";
import { reportKeys } from "../../../../src/model/keys.js";
import { buildSameDayCard } from "../../../../src/themes/stores/cards/same-day.js";
import { storesKeys } from "../../../../src/themes/stores/keys.js";
import { storesCalls } from "../../../../src/themes/stores/support.js";
import { rangeValue } from "../../../../src/themes/support.js";
import { STORE_A, STORE_B } from "../../fixtures.js";
import {
	cardInput,
	coverageRow,
	type SeriesRow,
	seriesRow,
	storeDays,
	storeIds,
	storesContext,
	storeWeeks,
} from "./support.js";

const coverage = [coverageRow(STORE_A), coverageRow(STORE_B)];

function sameDay(rows: readonly SeriesRow[], preset: "28d" | "364d" = "28d") {
	const context = storesContext([STORE_A, STORE_B], preset);
	return {
		context,
		card: buildSameDayCard(
			cardInput(context, { [storesCalls.days]: rows }, coverage),
		),
	};
}

describe("the So sánh same-day card", () => {
	it("indexes each store's day against its own average over the range and names the day the stores diverged most", () => {
		const { card } = sameDay([
			seriesRow("2026-10-10", { store_id: null, net_amount: 150 }),
			...storeDays(STORE_A, "2026-10-10", [100, 100, 200, 100]),
			...storeDays(STORE_B, "2026-10-10", [50, null, 50, 100]),
		]);
		const bucket = {
			kind: "part",
			value: {
				key: storesKeys.sameDay.dayBucket,
				values: { date: { kind: "date", value: "2026-10-12" } },
			},
		};
		expect(card.metricId).toBe("store_day_gap");
		expect(card.relatedMetricIds).toEqual(["store_day_index", "net_revenue"]);
		expect(card.headline).toEqual({
			value: 0.85,
			unit: "ratio",
			caption: { key: storesKeys.sameDay.caption, values: { bucket } },
		});
		expect(card.narrative).toEqual([
			{
				key: storesKeys.sameDay.main,
				values: {
					bucket,
					high: { kind: "text", value: "Store 1" },
					highIndex: { kind: "ratio", value: 1.6 },
					low: { kind: "text", value: "Store 2" },
					lowIndex: { kind: "ratio", value: 0.75 },
				},
			},
		]);
		const [table] = card.tables;
		expect(
			table?.columns.map((column) => [column.key, column.labelKey]),
		).toEqual([
			["bucket", reportKeys.table.date],
			["store", reportKeys.table.store],
			["net", reportKeys.table.netAmount],
			["index", storesKeys.table.index],
		]);
		expect(table?.rows.slice(0, 4)).toEqual([
			{
				id: `2026-10-13-${STORE_A}`,
				cells: { bucket: "2026-10-13", store: "Store 1", net: 100, index: 0.8 },
			},
			{
				id: `2026-10-13-${STORE_B}`,
				cells: { bucket: "2026-10-13", store: "Store 2", net: 100, index: 1.5 },
			},
			{
				id: `2026-10-12-${STORE_A}`,
				cells: { bucket: "2026-10-12", store: "Store 1", net: 200, index: 1.6 },
			},
			{
				id: `2026-10-12-${STORE_B}`,
				cells: { bucket: "2026-10-12", store: "Store 2", net: 50, index: 0.75 },
			},
		]);
		expect(table?.rows).toHaveLength(8);
		expect(
			table?.rows.find((row) => row.id === `2026-10-11-${STORE_B}`)?.cells
				.index,
		).toBeNull();
		expect(table?.initialSort).toEqual({
			key: "bucket",
			direction: "descending",
		});
		expect(card.chart?.categories).toEqual(
			["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13"].map((date) => ({
				kind: "date",
				value: date,
			})),
		);
		expect(card.chart?.series.map((series) => series.values)).toEqual([
			[0.8, 0.8, 1.6, 0.8],
			[0.75, null, 0.75, 1.5],
		]);
		expect(card.chart?.series.map((series) => series.kind)).toEqual([
			"line",
			"line",
		]);
		expect(card.chart?.markLines).toEqual([
			{
				label: { key: storesKeys.sameDay.average, values: {} },
				value: 1,
				axis: "left",
			},
		]);
		expect(card.chart?.zeroBased).toBe(false);
	});

	it("divides a clipped week by its days with sales, so a short week is not read as a weak one", () => {
		const { card } = sameDay(
			[
				...storeWeeks(STORE_A, "2026-10-26", [
					{ net: 700, days: 7 },
					{ net: 300, days: 3 },
				]),
				...storeWeeks(STORE_B, "2026-10-26", [
					{ net: 1400, days: 7 },
					{ net: 200, days: 2 },
				]),
			],
			"364d",
		);
		expect(card.tables[0]?.columns[0]?.labelKey).toBe(
			storesKeys.table.weekFrom,
		);
		expect(card.chart?.series.map((series) => series.values)).toEqual([
			[1, 1],
			[1.125, 0.5625],
		]);
		expect(card.headline.value).toBe(0.4375);
		expect(card.headline.caption?.values.bucket).toEqual({
			kind: "part",
			value: {
				key: storesKeys.sameDay.weekBucket,
				values: { date: { kind: "date", value: "2026-11-02" } },
			},
		});
	});

	it("gives each of the first five stores its own colour and dashes the lines from the sixth store on", () => {
		const ids = storeIds(7);
		const context = storesContext(ids);
		const card = buildSameDayCard(
			cardInput(
				context,
				{
					[storesCalls.days]: ids.flatMap((id) =>
						storeDays(id, "2026-10-10", [100, 120]),
					),
				},
				ids.map((id) => coverageRow(id)),
			),
		);
		expect(
			card.chart?.series.map((series) => [series.tone, series.dashed ?? false]),
		).toEqual([
			["primary", false],
			["secondary", false],
			["tertiary", false],
			["quaternary", false],
			["quinary", false],
			["primary", true],
			["secondary", true],
		]);
	});

	it("says so when no two stores sold on the same day", () => {
		const { context, card } = sameDay([
			...storeDays(STORE_A, "2026-10-10", [100, null]),
			...storeDays(STORE_B, "2026-10-10", [null, 80]),
		]);
		expect(card.headline.value).toBeNull();
		expect(card.narrative).toEqual([
			{
				key: storesKeys.sameDay.noOverlap,
				values: { range: rangeValue(context) },
			},
		]);
	});

	it("says there were no sales instead of drawing empty lines", () => {
		const { context, card } = sameDay([]);
		expect(card.headline.value).toBeNull();
		expect(card.narrative).toEqual([
			{
				key: storesKeys.sameDay.noData,
				values: { range: rangeValue(context) },
			},
		]);
		expect(card.chart).toBeNull();
		expect(card.tables[0]?.rows).toEqual([]);
	});
});
