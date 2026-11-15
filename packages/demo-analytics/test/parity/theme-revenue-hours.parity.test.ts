import { VIETNAM_HOLIDAYS } from "@fnb/core";
import {
	addDays,
	type DateRange,
	daysBetween,
	minDate,
	NAMED_PRESETS,
	rangeOfPreset,
	SERIES_ROW_LIMIT,
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
	callSql,
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
	themeSql,
} from "./theme-harness.js";

const clock = parityClock();
const datasets = parityDatasets(clock);
const RANDOM_RANGES = 10;
const HOUR_PROFILE_MAX_DAYS = 400;
const MONEY_EPSILON = 0.005;

interface Totals {
	readonly net: number;
	readonly invoices: number;
}

function totalsOfRange(rows: readonly Record<string, unknown>[]): Totals {
	const row = rows.find(
		(candidate) =>
			Number(candidate.range_index) === 1 && candidate.store_id === null,
	);
	if (row === undefined) throw new Error("range_totals returned no total row");
	return {
		net: Number(row?.net_amount ?? 0),
		invoices: Number(row?.invoices ?? 0),
	};
}

function totalsOfSeries(rows: readonly Record<string, unknown>[]): Totals {
	return rows
		.filter((row) => row.store_id === null || row.store_id === undefined)
		.reduce<Totals>(
			(sum, row) => ({
				net: sum.net + Number(row.net_amount ?? 0),
				invoices: sum.invoices + Number(row.invoices ?? 0),
			}),
			{ net: 0, invoices: 0 },
		);
}

function addTotals(left: Totals, right: Totals): Totals {
	return {
		net: left.net + right.net,
		invoices: left.invoices + right.invoices,
	};
}

function seriesChunks(range: DateRange, storeCount: number): DateRange[] {
	const days = Math.floor(SERIES_ROW_LIMIT / (storeCount + 1));
	const chunks: DateRange[] = [];
	for (let from = range.from; from <= range.to; ) {
		const to = minDate(addDays(from, days - 1), range.to);
		chunks.push({ from, to });
		from = addDays(to, 1);
	}
	return chunks;
}

function sameTotals(left: Totals, right: Totals): boolean {
	return (
		Math.abs(left.net - right.net) < MONEY_EPSILON &&
		left.invoices === right.invoices
	);
}

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

	it("totals equal the day buckets of period_series for the same stores and range, in SQL and in the port", async () => {
		const context = active();
		const failures: string[] = [];
		let compared = 0;
		let withSales = 0;
		for (const seeded of context.datasets) {
			const engine = engineOf(seeded);
			for (const range of rangesOf(seeded)) {
				for (const stores of STORE_SETS) {
					const storeIds = [...stores];
					const totalsArgs = {
						store_ids: storeIds,
						from_dates: [range.from],
						to_dates: [range.to],
					};
					const totalsStatement = themeSql(seeded, "range_totals", totalsArgs);
					let sqlSeries: Totals = { net: 0, invoices: 0 };
					let portSeries: Totals = { net: 0, invoices: 0 };
					for (const chunk of seriesChunks(range, storeIds.length)) {
						const seriesArgs = {
							store_ids: storeIds,
							grain: "day" as const,
							from_date: chunk.from,
							to_date: chunk.to,
						};
						const seriesStatement = callSql(
							seeded,
							"period_series",
							seriesArgs,
						);
						sqlSeries = addTotals(
							sqlSeries,
							totalsOfSeries(
								await context.connection.rows(
									seriesStatement.text,
									seriesStatement.params,
								),
							),
						);
						portSeries = addTotals(
							portSeries,
							totalsOfSeries(
								(await engine.call(
									"period_series",
									seriesArgs,
								)) as unknown as Record<string, unknown>[],
							),
						);
					}
					const sides: Record<string, readonly [Totals, Totals]> = {
						sql: [
							totalsOfRange(
								await context.connection.rows(
									totalsStatement.text,
									totalsStatement.params,
								),
							),
							sqlSeries,
						],
						port: [
							totalsOfRange(
								(await engine.callTheme(
									"range_totals",
									totalsArgs,
								)) as unknown as Record<string, unknown>[],
							),
							portSeries,
						],
					};
					for (const [side, [totals, series]] of Object.entries(sides)) {
						compared += 1;
						if (totals.invoices > 0) withSales += 1;
						if (!sameTotals(totals, series)) {
							failures.push(
								`${seeded.dataset.id} ${side} ${range.name} ${storeIds.join("+")}`,
							);
						}
					}
				}
			}
		}
		expect(compared).toBeGreaterThan(0);
		expect(withSales).toBeGreaterThan(compared / 2);
		expect(failures).toEqual([]);
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
