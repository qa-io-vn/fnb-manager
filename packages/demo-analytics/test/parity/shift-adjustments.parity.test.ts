import { addDays, type ThemeArgs } from "@fnb/reports";
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
import { ORPHAN_STORE, orphanDay } from "./orphan-cases.js";
import {
	applySettingsVariant,
	compareThemeCall,
	SETTINGS_VARIANTS,
	themeEngine,
} from "./theme-harness.js";

const clock = parityClock();
const datasets = parityDatasets(clock);
const RANDOM_ANCHORS = 1;
const RANGE_DAYS = [7, 92] as const;
const OPTIONS = {
	key: ["store_id", "shift_external_id"],
	ignore: ["shift_id"],
	timestampColumns: ["opened_at", "closed_at"],
	checkOrder: true,
};

describe("shift_adjustments in the engine equals the SQL", () => {
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
			`shift_adjustments parity: ${report.summary().split("\n")[0]}`,
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

	async function compare(
		seeded: SeededDataset,
		args: ThemeArgs<"shift_adjustments">,
		label: string,
	): Promise<void> {
		await compareThemeCall(
			report,
			active(),
			seeded,
			engineOf(seeded),
			"shift_adjustments",
			args,
			OPTIONS,
			label,
		);
	}

	it("matches over 92 days for every store set and 7 days for both stores at each anchor of the matrix, with their 56 trailing days, under both settings variants and an explicit threshold", async () => {
		const context = active();
		for (const variant of SETTINGS_VARIANTS) {
			for (const seeded of context.datasets) {
				await applySettingsVariant(context, seeded, engineOf(seeded), variant);
				const anchors =
					variant.settings === null
						? matrixAnchors(seeded, clock, RANDOM_ANCHORS)
						: [clock.asOf];
				for (const anchor of anchors) {
					for (const days of RANGE_DAYS) {
						const range = {
							from_date: addDays(anchor, -(days - 1)),
							to_date: anchor,
						};
						const storeSets =
							days === 92 && variant.settings === null
								? STORE_SETS
								: [["MOCK-S1", "MOCK-S2"] as const];
						for (const stores of storeSets) {
							await compare(
								seeded,
								{ store_ids: [...stores], ...range },
								` ${variant.id}`,
							);
						}
					}
				}
				if (variant.settings === null) {
					await compare(
						seeded,
						{
							store_ids: ["MOCK-S1", "MOCK-S2"],
							from_date: addDays(clock.asOf, -91),
							to_date: clock.asOf,
							z_threshold: 1,
						},
						" z 1",
					);
				}
			}
		}
		expect(report.rows).toBeGreaterThan(1_000);
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 900_000);

	it("flags a rate above the threshold and never one below the store's mean, gives null z-scores with fewer than 3 earlier shifts, and refuses the same calls", async () => {
		const context = active();
		let flagged = 0;
		let belowMean = 0;
		let nullScores = 0;
		for (const seeded of context.datasets) {
			for (const threshold of [undefined, 0.5]) {
				const rows = await engineOf(seeded).callTheme("shift_adjustments", {
					store_ids: ["MOCK-S1", "MOCK-S2"],
					from_date: addDays(clock.asOf, -91),
					to_date: clock.asOf,
					...(threshold === undefined ? {} : { z_threshold: threshold }),
				});
				const limit = threshold ?? 2;
				for (const row of rows) {
					for (const [score, reason] of [
						[row.void_z_score, "voids"],
						[row.removed_z_score, "removed_lines"],
					] as const) {
						if (score !== null && score < 0) {
							expect(row.reasons).not.toContain(reason);
							belowMean += 1;
						}
						if (score !== null && score <= limit) {
							expect(row.reasons).not.toContain(reason);
						}
						if (score !== null && score > limit) {
							expect(row.reasons).toContain(reason);
							flagged += 1;
						}
					}
					if (row.trailing_shifts < 3) {
						expect(row.void_z_score).toBeNull();
						expect(row.removed_z_score).toBeNull();
						nullScores += 1;
					}
				}
			}
		}
		expect(flagged).toBeGreaterThan(0);
		expect(belowMean).toBeGreaterThan(0);
		expect(nullScores).toBeGreaterThan(0);
		const seeded = context.datasets[0];
		if (seeded === undefined) throw new Error("no dataset");
		for (const args of [
			{
				store_ids: ["MOCK-S1"],
				from_date: addDays(clock.asOf, -92),
				to_date: clock.asOf,
			},
			{
				store_ids: ["MOCK-S1"],
				from_date: clock.asOf,
				to_date: addDays(clock.asOf, -1),
			},
			{ store_ids: [], from_date: clock.asOf, to_date: clock.asOf },
		]) {
			await compare(seeded, args, " edges");
		}
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 900_000);

	it("attributes a void whose sale never reached the sales report to the shift open at its time, in both engines", async () => {
		const context = active();
		const seeded = context.datasets.find(
			(candidate) => candidate.dataset.id === "D1",
		);
		if (seeded === undefined) throw new Error("no D1 dataset");
		const day = orphanDay(clock.asOf);
		const [orphan] = await context.connection.rows(
			`select e.occurred_at::text as at,
				(
					select a.shift_external_id
					from public.agg_shift_cash a
					where a.store_id = e.store_id
						and e.occurred_at >= a.opened_at
						and e.occurred_at < coalesce(a.closed_at, a.opened_at + interval '1 day')
					order by a.opened_at desc
					limit 1
				) as shift
			from public.invoice_events e
			where e.store_id = $1::uuid and e.invoice_id is null and e.kind = 'voided'
				and (e.occurred_at at time zone 'Asia/Ho_Chi_Minh')::date = $2::date`,
			[seeded.uuidOf(ORPHAN_STORE), day],
		);
		expect(orphan?.shift).toBeTruthy();
		const args = {
			store_ids: [ORPHAN_STORE],
			from_date: day,
			to_date: day,
		};
		await compare(seeded, args, " orphan void");
		const rows = await engineOf(seeded).callTheme("shift_adjustments", args);
		const holder = rows.find((row) => row.shift_external_id === orphan?.shift);
		const invoiceVoids = await context.connection.rows(
			`select count(*)::integer as voids
			from public.invoice_events e
			join public.invoices i on i.id = e.invoice_id
			where e.store_id = $1::uuid and e.kind = 'voided'
				and i.shift_external_id = $2`,
			[seeded.uuidOf(ORPHAN_STORE), orphan?.shift],
		);
		expect(holder?.voids).toBe(Number(invoiceVoids[0]?.voids ?? 0) + 1);
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 900_000);
});
