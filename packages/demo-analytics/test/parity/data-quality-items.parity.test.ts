import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	DEMO_UNCATEGORISED_ITEM,
	type DemoReportSource,
} from "../../src/index.js";
import { ParityReport } from "./compare.js";
import { parityClock, parityDatasets } from "./datasets.js";
import {
	type OpenParityDatabase,
	openParityDatabase,
	type SeededDataset,
	type SqlRow,
} from "./harness.js";
import { STORE_SETS } from "./matrix.js";
import {
	accountIds,
	compareQuality,
	qualityRanges,
} from "./quality-harness.js";
import {
	applyMenuVariant,
	applySecondAccount,
	SNACK_TYPE,
} from "./settings-fixture.js";
import { themeEngine } from "./theme-harness.js";

const clock = parityClock();
const datasets = parityDatasets(clock);
const RANDOM_RANGES = 3;
const OPTIONS = { key: ["item_external_id"], checkOrder: true };

describe("data_quality_items in the engine equals the SQL", () => {
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
		console.info(
			`data_quality_items parity: ${report.summary().split("\n")[0]}`,
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

	async function compareAll(label: string): Promise<SqlRow[]> {
		const context = active();
		const seen: SqlRow[] = [];
		for (const seeded of context.datasets) {
			const accounts = await accountIds(context, seeded);
			for (const range of qualityRanges(seeded, clock, RANDOM_RANGES, 97)) {
				for (const stores of STORE_SETS) {
					const result = await compareQuality(
						report,
						context,
						seeded,
						engineOf(seeded),
						"data_quality_items",
						{
							store_ids: [...stores],
							from_date: range.from,
							to_date: range.to,
						},
						OPTIONS,
						accounts,
						label,
					);
					seen.push(...(result?.engine ?? []));
				}
			}
		}
		return seen;
	}

	it("matches every store set over the presets, the young store's first weeks, a month end and seeded ranges with the demo's defaults, the uncategorised item shown without a type and a modifier sold as an item flagged", async () => {
		const rows = await compareAll(" defaults");
		const untyped = rows.filter(
			(row) => row.item_external_id === DEMO_UNCATEGORISED_ITEM,
		);
		expect(untyped.length).toBeGreaterThan(0);
		expect(
			untyped.every(
				(row) =>
					row.pos_type_external_id === null &&
					row.item_type_external_id === null &&
					row.type_known === false,
			),
		).toBe(true);
		expect(rows.some((row) => row.catalogue_modifier === true)).toBe(true);
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 900_000);

	it("matches again with type overrides, costs and the young store on a second POS account", async () => {
		const context = active();
		for (const seeded of context.datasets) {
			await applyMenuVariant(context, seeded, engineOf(seeded));
			await applySecondAccount(context, seeded, engineOf(seeded));
		}
		const rows = await compareAll(" variant");
		const mapped = rows.filter(
			(row) =>
				row.item_external_id === DEMO_UNCATEGORISED_ITEM &&
				row.override_type_external_id === SNACK_TYPE,
		);
		expect(mapped.length).toBeGreaterThan(0);
		expect(mapped.every((row) => row.type_known === true)).toBe(true);
		expect(rows.some((row) => row.cost_known === true)).toBe(true);
		expect(rows.some((row) => row.cost_known === false)).toBe(true);
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 900_000);
});
