import { VIETNAM_HOLIDAYS } from "@fnb/core";
import {
	addDays,
	type DateRange,
	daysBetween,
	NAMED_PRESETS,
	rangeOfPreset,
} from "@fnb/reports";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DemoReportSource } from "../../src/index.js";
import { ParityReport } from "./compare.js";
import {
	inWindow,
	monthEnds,
	parityClock,
	parityDatasets,
	seededRanges,
} from "./datasets.js";
import {
	type OpenParityDatabase,
	openParityDatabase,
	type SeededDataset,
} from "./harness.js";
import { STORE_SETS } from "./matrix.js";
import {
	applySettingsVariant,
	compareThemeCall,
	SETTINGS_VARIANTS,
	seedSeats,
	themeEngine,
} from "./theme-harness.js";

const clock = parityClock();
const datasets = parityDatasets(clock);
const RANDOM_RANGES = 10;
const HOUR_PROFILE_MAX_DAYS = 400;

interface NamedRange extends DateRange {
	readonly name: string;
	readonly references: readonly DateRange[];
}

function overlapsWindow(seeded: SeededDataset, range: DateRange): boolean {
	return range.from <= seeded.window.to && seeded.window.from <= range.to;
}

function tetRanges(seeded: SeededDataset): (DateRange & { name: string })[] {
	const tet = VIETNAM_HOLIDAYS.find(
		(holiday) =>
			holiday.kind === "tet" && inWindow(seeded.dataset, holiday.holidayDate),
	);
	return tet === undefined
		? []
		: [
				{
					name: "tet",
					from: addDays(tet.holidayDate, -6),
					to: addDays(tet.holidayDate, 6),
				},
			];
}

function rangesOf(seeded: SeededDataset): NamedRange[] {
	const presets = NAMED_PRESETS.map((preset) => {
		const range = rangeOfPreset(preset, clock.asOf);
		return {
			name: preset,
			from: range.from,
			to: range.to,
			references: [range.previous, ...(range.lastYear ? [range.lastYear] : [])],
		};
	});
	const young = seeded.stores["MOCK-S2"].definition.openedOn;
	const monthEnd = monthEnds(clock, 1)[0] ?? clock.asOf;
	const extra: (DateRange & { name: string })[] = [
		{ name: "young-first-28", from: young, to: addDays(young, 27) },
		{
			name: "month-end",
			from: addDays(monthEnd, -10),
			to: addDays(monthEnd, 10),
		},
		...tetRanges(seeded),
		...seededRanges(
			seeded.dataset,
			RANDOM_RANGES,
			seeded.dataset.id.charCodeAt(1) + 41,
			HOUR_PROFILE_MAX_DAYS,
		).map((range, index) => ({ name: `random-${index}`, ...range })),
	];
	return [
		...presets,
		...extra.map((range) => ({
			...range,
			references: [
				{
					from: addDays(range.from, -lengthOf(range)),
					to: addDays(range.from, -1),
				},
			],
		})),
	].filter((range) => overlapsWindow(seeded, range));
}

function lengthOf(range: DateRange): number {
	return daysBetween(range.from, range.to) + 1;
}

describe("the revenue and hours theme functions in the engine equal the SQL", () => {
	let database: OpenParityDatabase | null = null;
	const report = new ParityReport();
	const engines = new Map<string, DemoReportSource>();

	beforeAll(async () => {
		database = await openParityDatabase(
			[datasets.D1, datasets.D2, datasets.D3],
			clock,
		);
		for (const seeded of database.datasets) {
			await seedSeats(database, seeded);
			engines.set(seeded.dataset.id, themeEngine(seeded, clock));
		}
	});

	afterAll(async () => {
		console.info(
			`theme revenue and hours parity: ${report.summary().split("\n")[0]}`,
		);
		await database?.close();
	});

	function active(): OpenParityDatabase {
		if (database === null) throw new Error("the parity database did not open");
		return database;
	}

	function engineOf(seeded: SeededDataset): DemoReportSource {
		const engine = engines.get(seeded.dataset.id);
		if (engine === undefined) throw new Error("no theme engine");
		return engine;
	}

	it("matches range_totals, the heatmap and opening productivity over every range and store set", async () => {
		const context = active();
		for (const seeded of context.datasets) {
			const engine = engineOf(seeded);
			for (const range of rangesOf(seeded)) {
				for (const stores of STORE_SETS) {
					const storeIds = [...stores];
					const spans = [range, ...range.references];
					await compareThemeCall(
						report,
						context,
						seeded,
						engine,
						"range_totals",
						{
							store_ids: storeIds,
							from_dates: spans.map((span) => span.from),
							to_dates: spans.map((span) => span.to),
						},
						{ key: ["range_index", "store_id"], checkOrder: true },
						` ${range.name}`,
					);
					const window = {
						store_ids: storeIds,
						from_date: range.from,
						to_date: range.to,
					};
					await compareThemeCall(
						report,
						context,
						seeded,
						engine,
						"hour_weekday_heatmap",
						window,
						{
							key: ["weekday", "hour_local"],
							checkOrder: true,
						},
						` ${range.name}`,
					);
					await compareThemeCall(
						report,
						context,
						seeded,
						engine,
						"opening_productivity",
						window,
						{
							key: ["store_id"],
							checkOrder: true,
						},
						` ${range.name}`,
					);
				}
			}
		}
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 600_000);

	it("matches hour_profile and report_settings_of with the default and a tenant's thresholds", async () => {
		const context = active();
		for (const variant of SETTINGS_VARIANTS) {
			for (const seeded of context.datasets) {
				const engine = engineOf(seeded);
				await applySettingsVariant(context, seeded, engine, variant);
				for (const stores of STORE_SETS) {
					await compareThemeCall(
						report,
						context,
						seeded,
						engine,
						"report_settings_of",
						{
							store_ids: [...stores],
						},
						{ key: ["store_id"], checkOrder: true, ignore: ["tenant_id"] },
						` ${variant.id}`,
					);
				}
				for (const range of rangesOf(seeded)) {
					if (lengthOf(range) > HOUR_PROFILE_MAX_DAYS) continue;
					for (const stores of STORE_SETS) {
						await compareThemeCall(
							report,
							context,
							seeded,
							engine,
							"hour_profile",
							{
								store_ids: [...stores],
								from_date: range.from,
								to_date: range.to,
							},
							{
								key: ["scope", "weekday", "hour_position"],
								checkOrder: true,
							},
							` ${variant.id} ${range.name}`,
						);
					}
				}
			}
		}
		const [seeded] = context.datasets;
		if (seeded !== undefined) {
			await compareThemeCall(
				report,
				context,
				seeded,
				engineOf(seeded),
				"hour_profile",
				{
					store_ids: ["MOCK-S1"],
					from_date: clock.asOf,
					to_date: clock.asOf,
					peak_hours: 6,
					dead_hour_ratio: 0.3,
					busy_hour_ratio: 2,
				},
				{ key: ["scope", "weekday", "hour_position"], checkOrder: true },
				" explicit",
			);
			await compareThemeCall(
				report,
				context,
				seeded,
				engineOf(seeded),
				"hour_profile",
				{
					store_ids: ["MOCK-S1"],
					from_date: addDays(clock.asOf, -HOUR_PROFILE_MAX_DAYS),
					to_date: clock.asOf,
				},
				{ key: ["scope"] },
				" too long",
			);
			await compareThemeCall(
				report,
				context,
				seeded,
				engineOf(seeded),
				"hour_profile",
				{
					store_ids: ["MOCK-S1"],
					from_date: clock.asOf,
					to_date: clock.asOf,
					peak_hours: 7,
				},
				{ key: ["scope"] },
				" too many peaks",
			);
		}
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 600_000);
});
