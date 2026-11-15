import { type AnalyticsArgs, addDays } from "@fnb/reports";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DemoReportSource } from "../../src/index.js";
import { ParityReport } from "./compare.js";
import { parityClock, parityDatasets } from "./datasets.js";
import {
	type OpenParityDatabase,
	openParityDatabase,
	type SeededDataset,
} from "./harness.js";
import { matrixAnchors, STORE_SETS } from "./matrix.js";
import {
	applySettingsVariant,
	SETTINGS_VARIANTS,
	themeEngine,
} from "./theme-harness.js";

const clock = parityClock();
const datasets = parityDatasets(clock);
const RANDOM_ANCHORS = 2;
const REVIEW_DAYS = [7, 92] as const;
const EXPLICIT_THRESHOLDS = { abs_threshold: 30_000, rel_threshold: 0.003 };

describe("shift_review in the engine follows the tenant's cash thresholds as the SQL does", () => {
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
		console.info(`shift_review parity: ${report.summary().split("\n")[0]}`);
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
		engine: DemoReportSource,
		args: AnalyticsArgs<"shift_review">,
		label: string,
	): Promise<void> {
		const call = `${seeded.dataset.id} ${label} shift_review(${JSON.stringify(args)})`;
		const sql = await active()
			.call(seeded, "shift_review", args)
			.then(
				(rows) => ({ rows, code: null as string | null }),
				(error: { code?: string }) => ({
					rows: null,
					code: error.code ?? "error",
				}),
			);
		const fromEngine = await engine.call("shift_review", args).then(
			(rows) => ({
				rows: rows as unknown as Record<string, unknown>[],
				code: null as string | null,
			}),
			(error: { code?: string }) => ({
				rows: null,
				code: error.code ?? "error",
			}),
		);
		if (sql.code !== null || fromEngine.code !== null) {
			report.compareValues(call, "error code", sql.code, fromEngine.code);
			return;
		}
		report.compareRows(call, sql.rows ?? [], fromEngine.rows ?? [], {
			key: ["store_id", "shift_external_id"],
			ignore: ["shift_id"],
			timestampColumns: ["opened_at", "closed_at"],
			demoIdOf: seeded.demoIdOf,
		});
	}

	it("flags the same shifts with the default thresholds, a tenant's thresholds and explicit ones", async () => {
		const context = active();
		for (const variant of SETTINGS_VARIANTS) {
			for (const seeded of context.datasets) {
				const engine = engineOf(seeded);
				await applySettingsVariant(context, seeded, engine, variant);
				for (const anchor of matrixAnchors(seeded, clock, RANDOM_ANCHORS)) {
					for (const days of REVIEW_DAYS) {
						for (const stores of STORE_SETS) {
							const window = {
								store_ids: [...stores],
								from_date: addDays(anchor, -(days - 1)),
								to_date: anchor,
							};
							await compare(seeded, engine, window, variant.id);
							await compare(
								seeded,
								engine,
								{ ...window, ...EXPLICIT_THRESHOLDS },
								`${variant.id} explicit`,
							);
						}
					}
				}
			}
		}
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 900_000);
});
