import { describe, expect, it } from "vitest";
import { buildSinceOpeningCard } from "../../../../src/themes/stores/cards/since-opening.js";
import { storesKeys } from "../../../../src/themes/stores/keys.js";
import { STORE_A, STORE_B } from "../../fixtures.js";
import {
	cardInput,
	coverageRow,
	type SeriesRow,
	STORE_C,
	STORE_D,
	sinceDays,
	storesContext,
} from "./support.js";

const ALIGNED_DAYS = 56;

function sinceInput(
	starts: Readonly<Record<string, string | null>>,
	since: Readonly<Record<string, readonly SeriesRow[]>>,
) {
	const ids = Object.keys(starts);
	return cardInput(
		storesContext(ids),
		Object.fromEntries(
			Object.entries(since).map(([storeId, rows]) => [
				`since.${storeId}`,
				rows,
			]),
		),
		ids.map((id) => coverageRow(id, { history_start: starts[id] ?? null })),
	);
}

const store = (name: string) => ({ kind: "text", value: name });

describe("the So sánh since-opening card", () => {
	it("aligns the stores on their own week k, takes K from the youngest with a complete week and leaves a store younger than a week blank", () => {
		const card = buildSinceOpeningCard(
			sinceInput(
				{
					[STORE_A]: "2025-01-01",
					[STORE_B]: "2026-09-07",
					[STORE_C]: "2026-11-03",
				},
				{
					[STORE_A]: sinceDays("2025-01-01", ALIGNED_DAYS, () => 1000),
					[STORE_B]: sinceDays("2026-09-07", ALIGNED_DAYS, (offset) =>
						offset === ALIGNED_DAYS - 1 ? null : 800,
					),
				},
			),
		);
		expect(card.metricId).toBe("since_opening_net");
		expect(card.subtitle).toEqual({
			key: storesKeys.sinceOpening.subtitle,
			values: { weeks: { kind: "count", value: 8 } },
		});
		expect(card.headline).toEqual({
			value: 800,
			unit: "money",
			caption: {
				key: storesKeys.sinceOpening.caption,
				values: { week: { kind: "count", value: 8 }, store: store("Store 2") },
			},
		});
		expect(card.narrative).toEqual([
			{
				key: storesKeys.sinceOpening.main,
				values: {
					week: { kind: "count", value: 8 },
					store: store("Store 2"),
					share: { kind: "percent", value: 0.8 },
					other: store("Store 1"),
				},
			},
			{
				key: storesKeys.sinceOpening.tooYoung,
				values: {
					store: store("Store 3"),
					date: { kind: "date", value: "2026-11-03" },
				},
			},
		]);
		const rows = card.tables[0]?.rows ?? [];
		expect(rows).toHaveLength(8 * 3);
		expect(card.tables[0]?.initialSort).toEqual({
			key: "week",
			direction: "descending",
		});
		expect(card.tables[0]?.previewRows).toBe(14);
		expect(rows.slice(0, 3)).toEqual([
			{
				id: `1-${STORE_A}`,
				cells: {
					week: 1,
					store: "Store 1",
					from: "2025-01-01",
					to: "2025-01-07",
					daysWithData: 7,
					net: 7000,
					avgPerDay: 1000,
				},
			},
			{
				id: `1-${STORE_B}`,
				cells: {
					week: 1,
					store: "Store 2",
					from: "2026-09-07",
					to: "2026-09-13",
					daysWithData: 7,
					net: 5600,
					avgPerDay: 800,
				},
			},
			{
				id: `1-${STORE_C}`,
				cells: {
					week: 1,
					store: "Store 3",
					from: null,
					to: null,
					daysWithData: null,
					net: null,
					avgPerDay: null,
				},
			},
		]);
		const lastOfB = rows.find((row) => row.id === `8-${STORE_B}`)?.cells;
		expect(lastOfB).toMatchObject({ daysWithData: 6, avgPerDay: 800 });
		expect(
			rows
				.filter((row) => row.id.endsWith(STORE_C))
				.every((row) => row.cells.avgPerDay === null),
		).toBe(true);
		expect(card.chart?.categories).toHaveLength(8);
		expect(
			card.chart?.series.map((series) => [
				series.label.values.store,
				series.tone,
				series.values[0],
			]),
		).toEqual([
			[store("Store 1"), "primary", 1000],
			[store("Store 2"), "secondary", 800],
		]);
	});

	it("gives the youngest store's average alone when no other store has that week", () => {
		const card = buildSinceOpeningCard(
			sinceInput(
				{ [STORE_A]: "2026-09-07", [STORE_B]: "2026-11-03" },
				{ [STORE_A]: sinceDays("2026-09-07", ALIGNED_DAYS, () => 900) },
			),
		);
		expect(card.narrative[0]).toEqual({
			key: storesKeys.sinceOpening.single,
			values: {
				week: { kind: "count", value: 8 },
				store: store("Store 1"),
				value: { kind: "money", value: 900 },
			},
		});
		expect(card.narrative[1]?.key).toBe(storesKeys.sinceOpening.tooYoung);
	});

	it("compares at the latest week without a Tết day at either store, says why, and marks the Tết week in the table", () => {
		const tetWeek = (offset: number) => offset >= 49;
		const card = buildSinceOpeningCard(
			sinceInput(
				{ [STORE_A]: "2025-01-01", [STORE_B]: "2026-09-07" },
				{
					[STORE_A]: sinceDays(
						"2025-01-01",
						ALIGNED_DAYS,
						(offset) => (tetWeek(offset) ? 300 : 1000),
						(offset) =>
							offset === 50 ? { holiday_kind: "tet", tet_days: 1 } : {},
					),
					[STORE_B]: sinceDays("2026-09-07", ALIGNED_DAYS, () => 800),
				},
			),
		);
		expect(card.headline.value).toBe(800);
		expect(card.narrative).toEqual([
			{
				key: storesKeys.sinceOpening.main,
				values: {
					week: { kind: "count", value: 7 },
					store: store("Store 2"),
					share: { kind: "percent", value: 0.8 },
					other: store("Store 1"),
				},
			},
			{
				key: storesKeys.sinceOpening.tetSkipped,
				values: { week: { kind: "count", value: 7 } },
			},
		]);
		const [table] = card.tables;
		expect(table?.columns.at(-1)).toEqual({
			key: "tet",
			labelKey: storesKeys.table.tet,
			kind: "message",
		});
		const tetOf = (id: string) =>
			table?.rows.find((row) => row.id === id)?.cells.tet;
		expect(tetOf(`8-${STORE_A}`)).toBe(storesKeys.sinceOpening.tetWeek);
		expect(tetOf(`8-${STORE_B}`)).toBeNull();
		expect(tetOf(`7-${STORE_A}`)).toBeNull();
	});

	it("leaves the Tết column out when no aligned week holds a Tết day", () => {
		const card = buildSinceOpeningCard(
			sinceInput(
				{ [STORE_A]: "2025-01-01", [STORE_B]: "2026-09-07" },
				{
					[STORE_A]: sinceDays("2025-01-01", ALIGNED_DAYS, () => 1000),
					[STORE_B]: sinceDays("2026-09-07", ALIGNED_DAYS, () => 800),
				},
			),
		);
		expect(card.tables[0]?.columns.map((column) => column.key)).not.toContain(
			"tet",
		);
		expect(card.narrative).toHaveLength(1);
	});

	it("names every store younger than a complete week in one note, however many there are", () => {
		const card = buildSinceOpeningCard(
			sinceInput(
				{
					[STORE_A]: "2025-01-01",
					[STORE_B]: "2026-09-07",
					[STORE_C]: "2026-11-03",
					[STORE_D]: "2026-11-04",
				},
				{
					[STORE_A]: sinceDays("2025-01-01", ALIGNED_DAYS, () => 1000),
					[STORE_B]: sinceDays("2026-09-07", ALIGNED_DAYS, () => 800),
				},
			),
		);
		expect(card.narrative.at(-1)).toEqual({
			key: storesKeys.sinceOpening.tooYoungMany,
			values: { stores: store("Store 3, Store 4") },
		});
		expect(card.tables[0]?.rows).toHaveLength(8 * 4);
	});

	it("says no store has a complete week yet instead of an empty comparison", () => {
		const card = buildSinceOpeningCard(
			sinceInput({ [STORE_A]: "2026-11-02", [STORE_B]: null }, {}),
		);
		expect(card.headline.value).toBeNull();
		expect(card.subtitle).toBeNull();
		expect(card.narrative.map((part) => part.key)).toEqual([
			storesKeys.sinceOpening.noData,
			storesKeys.sinceOpening.tooYoung,
		]);
		expect(card.tables[0]?.rows).toEqual([]);
		expect(card.chart).toBeNull();
	});
});
