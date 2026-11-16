import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DemoReportSource } from "../../src/index.js";
import { ATTRIBUTION_STORE } from "./attribution-cases.js";
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
import { DAILY_RECEIPT_STORE, RUNNING_RECEIPT_STORE } from "./receipt-cases.js";
import { applyMenuVariant, applySecondAccount } from "./settings-fixture.js";
import { seedSeats, themeEngine } from "./theme-harness.js";

const clock = parityClock();
const datasets = parityDatasets(clock);
const RANDOM_RANGES = 2;
const OPTIONS = { key: ["store_id"], checkOrder: true };

describe("data_quality_summary in the engine equals the SQL", () => {
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
			await seedSeats(database, seeded);
		}
	});

	afterAll(async () => {
		console.info(
			`data_quality_summary parity: ${report.summary().split("\n")[0]}`,
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

	async function compareAll(
		label: string,
	): Promise<{ dataset: string; rows: SqlRow[] }[]> {
		const context = active();
		const seen: { dataset: string; rows: SqlRow[] }[] = [];
		for (const seeded of context.datasets) {
			const accounts = await accountIds(context, seeded);
			for (const range of qualityRanges(seeded, clock, RANDOM_RANGES, 103)) {
				for (const stores of STORE_SETS) {
					const result = await compareQuality(
						report,
						context,
						seeded,
						engineOf(seeded),
						"data_quality_summary",
						{
							store_ids: [...stores],
							from_date: range.from,
							to_date: range.to,
						},
						OPTIONS,
						accounts,
						label,
					);
					seen.push({ dataset: seeded.dataset.id, rows: result?.engine ?? [] });
				}
			}
		}
		return seen;
	}

	it("matches every store set over the presets, the young store's first weeks, a month end and seeded ranges, with a modifier sold as an item, events no shift claims and the young store's e-invoicing not configured", async () => {
		const calls = await compareAll(" defaults");
		const rows = calls.flatMap((call) => call.rows);
		const attributed = calls
			.filter((call) => call.dataset === "D1")
			.flatMap((call) => call.rows)
			.filter((row) => row.store_id === ATTRIBUTION_STORE);
		expect(
			attributed.some(
				(row) =>
					Number(row.catalogue_modifier_lines) >= 1 &&
					Number(row.unattributed_events) >= 2,
			),
		).toBe(true);
		expect(
			calls
				.filter((call) => call.dataset !== "D1")
				.flatMap((call) => call.rows)
				.every((row) => row.catalogue_modifier_lines === 0),
		).toBe(true);
		expect(
			rows
				.filter((row) => row.store_id === "MOCK-S2")
				.every((row) => row.e_invoice_status === "not_configured"),
		).toBe(true);
		expect(
			rows.every(
				(row) =>
					row.identified_customers === 0 && row.consent_coverage === null,
			),
		).toBe(true);
		const d1 = calls
			.filter((call) => call.dataset === "D1")
			.flatMap((call) => call.rows);
		expect(
			d1.some(
				(row) =>
					row.store_id === DAILY_RECEIPT_STORE &&
					row.receipt_restarts_daily === true,
			),
		).toBe(true);
		expect(
			d1.some(
				(row) =>
					row.store_id === RUNNING_RECEIPT_STORE &&
					row.receipt_restarts_daily === false,
			),
		).toBe(true);
		const d3 = calls
			.filter((call) => call.dataset === "D3")
			.flatMap((call) => call.rows);
		expect(d3.every((row) => row.receipt_days === null)).toBe(true);
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 900_000);

	it("matches again with the settings variant and the young store on a second POS account, and answers nothing for an empty store list", async () => {
		const context = active();
		for (const seeded of context.datasets) {
			await applyMenuVariant(context, seeded, engineOf(seeded));
			await applySecondAccount(context, seeded, engineOf(seeded));
		}
		await compareAll(" variant");
		const seeded = context.datasets[0];
		if (seeded === undefined) throw new Error("no dataset");
		await compareQuality(
			report,
			context,
			seeded,
			engineOf(seeded),
			"data_quality_summary",
			{ store_ids: [], from_date: clock.asOf, to_date: clock.asOf },
			OPTIONS,
			await accountIds(context, seeded),
			" empty",
		);
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 900_000);
});
