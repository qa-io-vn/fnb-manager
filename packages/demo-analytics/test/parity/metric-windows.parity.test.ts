import { metricValueIds } from "@fnb/metrics";
import { addDays, type IsoDate, type ThemeArgs } from "@fnb/reports";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DemoReportSource } from "../../src/index.js";
import { ParityReport } from "./compare.js";
import { monthEnds, parityClock, parityDatasets } from "./datasets.js";
import {
	type OpenParityDatabase,
	openParityDatabase,
	type SeededDataset,
} from "./harness.js";
import { STORE_SETS } from "./matrix.js";
import { compareThemeCall, themeEngine } from "./theme-harness.js";

const clock = parityClock();
const datasets = parityDatasets(clock);
const OPTIONS = { key: ["range_index", "metric_id"], checkOrder: true };
const BAND_WINDOWS = 8;
const WEEK_DAYS = 7;
const LAST_YEAR_DAYS = 364;

interface Ranges {
	readonly from_dates: IsoDate[];
	readonly to_dates: IsoDate[];
}

function kpiRanges(asOf: IsoDate): Ranges {
	const w28 = { from: addDays(asOf, -27), to: asOf };
	const ranges = [
		w28,
		{ from: addDays(asOf, -55), to: addDays(asOf, -28) },
		{
			from: addDays(w28.from, -LAST_YEAR_DAYS),
			to: addDays(w28.to, -LAST_YEAR_DAYS),
		},
		...Array.from({ length: BAND_WINDOWS }, (_, index) => ({
			from: addDays(w28.from, -WEEK_DAYS * (index + 1)),
			to: addDays(w28.to, -WEEK_DAYS * (index + 1)),
		})),
	];
	return {
		from_dates: ranges.map((range) => range.from),
		to_dates: ranges.map((range) => range.to),
	};
}

describe("metric_windows in the engine equals the SQL", () => {
	let database: OpenParityDatabase | null = null;
	const report = new ParityReport();
	const engines = new Map<string, DemoReportSource>();

	beforeAll(async () => {
		database = await openParityDatabase(
			[datasets.D1, datasets.D2, datasets.D3],
			clock,
		);
		for (const seeded of database.datasets) {
			engines.set(seeded.dataset.id, themeEngine(seeded, clock));
		}
	});

	afterAll(async () => {
		console.info(`metric_windows parity: ${report.summary().split("\n")[0]}`);
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

	async function compare(
		seeded: SeededDataset,
		args: ThemeArgs<"metric_windows">,
		label: string,
	): Promise<void> {
		await compareThemeCall(
			report,
			active(),
			seeded,
			engineOf(seeded),
			"metric_windows",
			args,
			OPTIONS,
			label,
		);
	}

	it("matches every id of metricValueIds over the eleven KPI windows, per store and for both stores, at two as-of days", async () => {
		const ids = [...metricValueIds()];
		expect(ids.length).toBeGreaterThanOrEqual(18);
		const anchors = [clock.asOf, monthEnds(clock, 1)[0] ?? clock.asOf];
		for (const seeded of active().datasets) {
			for (const anchor of anchors) {
				const ranges = kpiRanges(anchor);
				expect(ranges.from_dates).toHaveLength(11);
				for (const stores of STORE_SETS) {
					await compare(
						seeded,
						{ store_ids: [...stores], metric_ids: ids, ...ranges },
						` as of ${anchor}`,
					);
				}
			}
		}
		expect(report.calls).toBeGreaterThan(0);
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 900_000);

	it("refuses an unknown id, a reversed range, 401 days and lists of different lengths with the same SQLSTATE, and answers nothing for no store", async () => {
		const seeded = active().datasets[0];
		if (seeded === undefined) throw new Error("no dataset");
		const base: ThemeArgs<"metric_windows"> = {
			store_ids: ["MOCK-S1", "MOCK-S2"],
			metric_ids: ["net_revenue"],
			from_dates: [addDays(clock.asOf, -27)],
			to_dates: [clock.asOf],
		};
		const cases: [string, ThemeArgs<"metric_windows">][] = [
			[" unknown id", { ...base, metric_ids: ["net_revenue", "net_sales"] }],
			[" reversed", { ...base, from_dates: [addDays(clock.asOf, 1)] }],
			[" 401 days", { ...base, from_dates: [addDays(clock.asOf, -400)] }],
			[" unequal", { ...base, to_dates: [clock.asOf, clock.asOf] }],
			[" no store", { ...base, store_ids: [], metric_ids: ["net_sales"] }],
		];
		for (const [label, args] of cases) {
			await compare(seeded, args, label);
		}
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	});
});
