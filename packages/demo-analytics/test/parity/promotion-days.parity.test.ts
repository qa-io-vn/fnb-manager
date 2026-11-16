import { VIETNAM_HOLIDAYS } from "@fnb/core";
import {
	addDays,
	type IsoDate,
	type PromotionKind,
	type ThemeArgs,
	ThemeCallError,
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
	pgArray,
	type SeededDataset,
} from "./harness.js";
import { STORE_SETS } from "./matrix.js";
import { compareThemeCall, themeEngine, themeSql } from "./theme-harness.js";

const clock = parityClock();
const datasets = parityDatasets(clock);
const MAX_DAYS = 400;
const PRESET_DAYS = [7, 28, 92, MAX_DAYS] as const;
const RANDOM_RANGES = 10;
const TET_DAY = "Tet, day 4";
const REFUSALS = new Set(["22023", "invalid_arguments"]);

interface Range {
	readonly from: IsoDate;
	readonly to: IsoDate;
}

type Filter = Pick<ThemeArgs<"promotion_days">, "kind_filter" | "key_filter">;

describe("promotion_days in the engine equals the SQL", () => {
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
		console.info(`promotion_days parity: ${report.summary().split("\n")[0]}`);
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

	async function filtersOf(seeded: SeededDataset): Promise<Filter[]> {
		const rows = await active().connection.rows(
			`select d.promotion_kind as kind, d.promotion_key as key, count(*)::integer as uses
			from app.discount_rows($1::uuid[], $2::date, $3::date) d
			group by 1, 2
			order by uses desc, d.promotion_kind collate "C", d.promotion_key collate "C"`,
			[
				pgArray(
					(["MOCK-S1", "MOCK-S2"] as const).map((id) => seeded.uuidOf(id)),
				),
				seeded.window.from,
				seeded.window.to,
			],
		);
		const filters: Filter[] = [{}];
		const kinds = new Set<string>();
		for (const row of rows) {
			const kind = row.kind as PromotionKind;
			if (kinds.has(kind)) continue;
			kinds.add(kind);
			filters.push(
				{ kind_filter: kind },
				{ kind_filter: kind, key_filter: String(row.key) },
			);
		}
		return filters;
	}

	function rangesOf(seeded: SeededDataset): Range[] {
		const clip = (from: IsoDate, to: IsoDate): Range => ({
			from: from < seeded.window.from ? seeded.window.from : from,
			to: to > seeded.window.to ? seeded.window.to : to,
		});
		const young = seeded.stores["MOCK-S2"].definition.openedOn;
		const ranges = PRESET_DAYS.map((days) =>
			clip(addDays(clock.asOf, -(days - 1)), clock.asOf),
		);
		if (inWindow(seeded.dataset, young)) {
			ranges.push(clip(young, addDays(young, 27)));
		}
		for (const monthEnd of monthEnds(clock, 1)) {
			ranges.push(clip(addDays(monthEnd, -6), addDays(monthEnd, 7)));
		}
		for (const holiday of VIETNAM_HOLIDAYS) {
			if (
				holiday.name === TET_DAY &&
				inWindow(seeded.dataset, holiday.holidayDate)
			) {
				ranges.push(
					clip(
						addDays(holiday.holidayDate, -14),
						addDays(holiday.holidayDate, 14),
					),
				);
			}
		}
		ranges.push(...seededRanges(seeded.dataset, RANDOM_RANGES, 71, MAX_DAYS));
		return ranges.filter((range) => range.from <= range.to);
	}

	it("matches every store set over the presets, the young store's first weeks, a month end, Tết and seeded ranges, with and without filters", async () => {
		const context = active();
		for (const seeded of context.datasets) {
			const filters = await filtersOf(seeded);
			expect(filters.length).toBeGreaterThan(3);
			for (const [index, range] of rangesOf(seeded).entries()) {
				for (const stores of STORE_SETS) {
					for (const filter of [
						{},
						filters[1 + (index % (filters.length - 1))] as Filter,
					]) {
						await compareThemeCall(
							report,
							context,
							seeded,
							engineOf(seeded),
							"promotion_days",
							{
								store_ids: [...stores],
								from_date: range.from,
								to_date: range.to,
								...filter,
							},
							{
								key: [
									"store_id",
									"business_date",
									"promotion_kind",
									"promotion_key",
								],
								checkOrder: true,
							},
						);
					}
				}
			}
		}
		expect(report.rows).toBeGreaterThan(1_000);
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 900_000);

	it("refuses the same calls (401 days, a key without a kind, an unknown kind) and accepts 400 days with a kind filter", async () => {
		const context = active();
		const seeded = context.datasets[0];
		if (seeded === undefined) throw new Error("no dataset");
		const engine = engineOf(seeded);
		const end = clock.asOf;
		for (const args of [
			{
				store_ids: ["MOCK-S1"],
				from_date: addDays(end, -MAX_DAYS),
				to_date: end,
			},
			{
				store_ids: ["MOCK-S1"],
				from_date: end,
				to_date: end,
				key_filter: "PROMO-04",
			},
			{
				store_ids: ["MOCK-S1"],
				from_date: end,
				to_date: end,
				kind_filter: "coupon" as PromotionKind,
			},
		] satisfies ThemeArgs<"promotion_days">[]) {
			const { text, params } = themeSql(seeded, "promotion_days", args);
			const sqlCode = await context.connection.rows(text, params).then(
				() => null,
				(error: { code?: string }) => error.code ?? "error",
			);
			const engineCode = await engine.callTheme("promotion_days", args).then(
				() => null,
				(error: unknown) =>
					error instanceof ThemeCallError ? (error.code ?? "error") : "error",
			);
			expect(sqlCode, JSON.stringify(args)).toBe("22023");
			expect(REFUSALS.has(engineCode ?? ""), JSON.stringify(args)).toBe(true);
		}
		const bills = await engine.callTheme("promotion_days", {
			store_ids: ["MOCK-S1"],
			from_date: addDays(end, -(MAX_DAYS - 1)),
			to_date: end,
			kind_filter: "bill",
		});
		expect(bills.length).toBeGreaterThan(0);
		expect(bills.every((row) => row.promotion_kind === "bill")).toBe(true);
	}, 900_000);
});
