import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_POS_ACCOUNT_ID, type DemoReportSource } from "../../src/index.js";
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
	KIND_OVERRIDE_METHOD,
} from "./settings-fixture.js";
import { themeEngine } from "./theme-harness.js";

const clock = parityClock();
const datasets = parityDatasets(clock);
const RANDOM_RANGES = 2;
const OPTIONS = {
	key: ["pos_account_id", "payment_method_external_id"],
	checkOrder: true,
};

describe("data_quality_payments in the engine equals the SQL", () => {
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
			`data_quality_payments parity: ${report.summary().split("\n")[0]}`,
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
			for (const range of qualityRanges(seeded, clock, RANDOM_RANGES, 101)) {
				for (const stores of STORE_SETS) {
					const result = await compareQuality(
						report,
						context,
						seeded,
						engineOf(seeded),
						"data_quality_payments",
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

	it("matches every store set over the presets, the young store's first weeks, a month end and seeded ranges with the demo's defaults", async () => {
		const rows = await compareAll(" defaults");
		expect(rows.some((row) => row.in_catalogue === true)).toBe(true);
		expect(rows.every((row) => row.override_kind === null)).toBe(true);
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 900_000);

	it("shows the overridden payment method's POS kind, override and effective kind identically, with the young store on a second POS account", async () => {
		const context = active();
		for (const seeded of context.datasets) {
			await applyMenuVariant(context, seeded, engineOf(seeded));
			await applySecondAccount(context, seeded, engineOf(seeded));
		}
		const rows = await compareAll(" variant");
		const overridden = rows.filter(
			(row) =>
				row.pos_account_id === DEMO_POS_ACCOUNT_ID &&
				row.payment_method_external_id === KIND_OVERRIDE_METHOD,
		);
		expect(overridden.length).toBeGreaterThan(0);
		expect(
			overridden.every(
				(row) =>
					row.pos_kind === "bank_transfer" &&
					row.override_kind === "cash" &&
					row.kind === "cash",
			),
		).toBe(true);
		expect(
			rows.some(
				(row) =>
					row.pos_account_id !== DEMO_POS_ACCOUNT_ID &&
					row.payment_method_external_id === KIND_OVERRIDE_METHOD &&
					row.override_kind === null,
			),
		).toBe(true);
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 900_000);
});
