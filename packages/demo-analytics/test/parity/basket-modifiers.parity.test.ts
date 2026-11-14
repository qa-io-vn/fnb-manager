import { randomUUID } from "node:crypto";
import type { ThemeArgs, ThemeFunctionName } from "@fnb/reports";
import { addDays, ThemeCallError } from "@fnb/reports";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DemoReportSource } from "../../src/index.js";
import { ParityReport } from "./compare.js";
import { parityClock, parityDatasets } from "./datasets.js";
import type { ParityContext, SeededDataset } from "./harness.js";
import { type OpenParityDatabase, openParityDatabase } from "./harness.js";
import { compareThemeCall, themeEngine, themeSql } from "./theme-harness.js";

const REFUSALS = new Set(["22023", "invalid_arguments"]);

async function expectBothRefuse<N extends ThemeFunctionName>(
	context: ParityContext,
	seeded: SeededDataset,
	engine: DemoReportSource,
	name: N,
	args: ThemeArgs<N>,
): Promise<void> {
	const { text, params } = themeSql(seeded, name, args);
	const sqlCode = await context.connection.rows(text, params).then(
		() => null,
		(error: { code?: string }) => error.code ?? "error",
	);
	const engineCode = await engine.callTheme(name, args).then(
		() => null,
		(error: unknown) =>
			error instanceof ThemeCallError ? (error.code ?? "error") : "error",
	);
	expect(sqlCode, `${name} ${JSON.stringify(args)} in SQL`).toBe("22023");
	expect(
		REFUSALS.has(engineCode ?? ""),
		`${name} ${JSON.stringify(args)} in the engine: ${engineCode}`,
	).toBe(true);
}

const clock = parityClock();
const datasets = parityDatasets(clock);
const STORE_SETS: readonly (readonly string[])[] = [
	["MOCK-S1"],
	["MOCK-S2"],
	["MOCK-S1", "MOCK-S2"],
	["MOCK-S2", "MOCK-S1"],
	[],
	["MOCK-S1", "MOCK-S1"],
	["MOCK-S1", randomUUID()],
];
const SPANS = [7, 28, 91] as const;
const PAIR_OPTIONS = [
	{},
	{ min_pair_invoices: 1, max_pairs: 900 },
	{ min_pair_invoices: 5, max_pairs: 10 },
	{ min_pair_invoices: 50, max_pairs: 1 },
] as const;

describe("basket_pairs and modifier_summary in the engine equal the SQL", () => {
	let database: OpenParityDatabase | null = null;
	const report = new ParityReport();

	beforeAll(async () => {
		database = await openParityDatabase(
			[datasets.D1, datasets.D2, datasets.D3],
			clock,
		);
	});

	afterAll(async () => {
		console.info(
			`basket and modifier parity: ${report.summary().split("\n")[0]}`,
		);
		await database?.close();
	});

	it("matches over every store set, range and option, and refuses the same calls", async () => {
		const active = database;
		if (active === null) throw new Error("the parity database did not open");
		for (const seeded of active.datasets) {
			const engine = themeEngine(seeded, clock);
			const end = seeded.window.to;
			for (const stores of STORE_SETS) {
				const storeIds = [...stores];
				for (const span of SPANS) {
					for (const last of [end, addDays(end, -20)]) {
						const from = addDays(last, -(span - 1));
						for (const options of PAIR_OPTIONS) {
							await compareThemeCall(
								report,
								active,
								seeded,
								engine,
								"basket_pairs",
								{
									store_ids: storeIds,
									from_date: from,
									to_date: last,
									...options,
								},
								{
									key: ["item_a_external_id", "item_b_external_id"],
									checkOrder: true,
								},
								` ${span}d ${JSON.stringify(options)}`,
							);
						}
						for (const compare of [false, true]) {
							await compareThemeCall(
								report,
								active,
								seeded,
								engine,
								"modifier_summary",
								{
									store_ids: storeIds,
									from_date: from,
									to_date: last,
									...(compare
										? {
												compare_from: addDays(from, -span),
												compare_to: addDays(from, -1),
											}
										: {}),
								},
								{ key: ["modifier_name"], checkOrder: true },
								` ${span}d${compare ? " compared" : ""}`,
							);
						}
					}
				}
				for (const invalid of [
					{ from_date: addDays(end, -92), to_date: end },
					{ from_date: addDays(end, -6), to_date: end, min_pair_invoices: 0 },
					{ from_date: addDays(end, -6), to_date: end, max_pairs: 901 },
				]) {
					await expectBothRefuse(active, seeded, engine, "basket_pairs", {
						store_ids: storeIds,
						...invalid,
					});
				}
				for (const ranges of [
					{
						from_date: addDays(end, -27),
						to_date: end,
						compare_from: addDays(end, -13),
						compare_to: end,
					},
					{
						from_date: addDays(end, 1),
						to_date: addDays(end, 7),
						compare_from: addDays(end, -6),
						compare_to: end,
					},
				]) {
					await compareThemeCall(
						report,
						active,
						seeded,
						engine,
						"modifier_summary",
						{ store_ids: storeIds, ...ranges },
						{ key: ["modifier_name"], checkOrder: true },
						` ${JSON.stringify(ranges)}`,
					);
				}
				for (const invalid of [
					{
						from_date: addDays(end, -6),
						to_date: end,
						compare_from: end,
						compare_to: addDays(end, -6),
					},
					{ from_date: addDays(end, -6), to_date: end, compare_to: end },
					{ from_date: addDays(end, -400), to_date: end },
					{
						from_date: addDays(end, -6),
						to_date: end,
						compare_from: addDays(end, -13),
					},
				]) {
					await expectBothRefuse(active, seeded, engine, "modifier_summary", {
						store_ids: storeIds,
						...invalid,
					});
				}
			}
		}
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 1_800_000);
});
