import { addDays, type IsoDate } from "@fnb/reports";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DemoReportSource } from "../../src/index.js";
import { ParityReport } from "./compare.js";
import {
	inWindow,
	monthEnds,
	parityClock,
	parityDatasets,
	seededDates,
} from "./datasets.js";
import {
	type OpenParityDatabase,
	openParityDatabase,
	type SeededDataset,
} from "./harness.js";
import { STORE_SETS } from "./matrix.js";
import { applySecondAccount } from "./settings-fixture.js";
import { compareThemeCall, themeEngine } from "./theme-harness.js";

const clock = parityClock();
const datasets = parityDatasets(clock);
const RANDOM_DAYS = 3;

describe("promotion_catalogue in the engine equals the SQL", () => {
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
			`promotion_catalogue parity: ${report.summary().split("\n")[0]}`,
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

	function asOfDays(seeded: SeededDataset): IsoDate[] {
		const young = seeded.stores["MOCK-S2"].definition.openedOn;
		return [
			...new Set([
				clock.asOf,
				addDays(clock.asOf, -1),
				...monthEnds(clock, 2),
				addDays(young, -1),
				addDays(young, 6),
				addDays(seeded.window.from, -1),
				...seededDates(seeded.dataset, RANDOM_DAYS, 83),
			]),
		]
			.filter((date) => date >= addDays(seeded.window.from, -1))
			.sort();
	}

	async function compareAll(label: string): Promise<void> {
		const context = active();
		for (const seeded of context.datasets) {
			for (const asOf of asOfDays(seeded)) {
				for (const stores of STORE_SETS) {
					await compareThemeCall(
						report,
						context,
						seeded,
						engineOf(seeded),
						"promotion_catalogue",
						{ store_ids: [...stores], as_of_date: asOf },
						{
							key: ["promotion_kind", "promotion_key"],
							checkOrder: true,
							timestampColumns: ["starts_at", "ends_at"],
						},
						label,
					);
				}
			}
		}
	}

	it("matches every store set at the as-of day, month ends, the young store's opening, before the data and seeded days, listing unused catalogue promotions with no last use", async () => {
		await compareAll("");
		expect(report.rows).toBeGreaterThan(100);
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
		const seeded = active().datasets[0];
		if (seeded === undefined) throw new Error("no dataset");
		const rows = await engineOf(seeded).callTheme("promotion_catalogue", {
			store_ids: ["MOCK-S1", "MOCK-S2"],
			as_of_date: clock.asOf,
		});
		const unused = rows.filter(
			(row) => row.in_catalogue && row.last_used_on === null,
		);
		expect(unused.length).toBeGreaterThan(0);
		expect(unused.every((row) => row.days_used_365 === 0)).toBe(true);
		expect(rows.at(-1)?.last_used_on).toBeNull();
		expect(
			rows.some((row) => !row.in_catalogue && row.catalogue_active === null),
		).toBe(true);
	}, 900_000);

	it("counts a use on the as-of day minus 364 and drops it on the next day, in both engines", async () => {
		const context = active();
		const seeded = context.datasets.find(
			(candidate) => candidate.dataset.id === "D2",
		);
		if (seeded === undefined) throw new Error("no D2 dataset");
		const [first] = (
			await engineOf(seeded).callTheme("promotion_catalogue", {
				store_ids: ["MOCK-S1"],
				as_of_date: clock.asOf,
			})
		)
			.filter((row) => row.first_used_on !== null)
			.sort((left, right) =>
				(left.first_used_on ?? "") < (right.first_used_on ?? "") ? -1 : 1,
			);
		const firstUse = first?.first_used_on;
		if (firstUse === null || firstUse === undefined) {
			throw new Error("no promotion use in D2");
		}
		expect(addDays(firstUse, 365) <= clock.asOf).toBe(true);
		const counts: number[] = [];
		for (const asOf of [addDays(firstUse, 364), addDays(firstUse, 365)]) {
			await compareThemeCall(
				report,
				context,
				seeded,
				engineOf(seeded),
				"promotion_catalogue",
				{ store_ids: ["MOCK-S1"], as_of_date: asOf },
				{
					key: ["promotion_kind", "promotion_key"],
					checkOrder: true,
					timestampColumns: ["starts_at", "ends_at"],
				},
				" 365-day edge",
			);
			const row = (
				await engineOf(seeded).callTheme("promotion_catalogue", {
					store_ids: ["MOCK-S1"],
					as_of_date: asOf,
				})
			).find(
				(candidate) =>
					candidate.promotion_kind === first?.promotion_kind &&
					candidate.promotion_key === first?.promotion_key,
			);
			expect(row?.first_used_on).toBe(firstUse);
			counts.push(row?.invoices_365 ?? 0);
		}
		expect(counts[0]).toBeGreaterThan(0);
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 900_000);

	it("lists no catalogue for a store moved to an account without one, in both engines", async () => {
		const context = active();
		const seeded = context.datasets.find(
			(candidate) => candidate.dataset.id === "D3",
		);
		if (seeded === undefined) throw new Error("no D3 dataset");
		await applySecondAccount(context, seeded, engineOf(seeded));
		for (const stores of STORE_SETS) {
			await compareThemeCall(
				report,
				context,
				seeded,
				engineOf(seeded),
				"promotion_catalogue",
				{ store_ids: [...stores], as_of_date: clock.asOf },
				{
					key: ["promotion_kind", "promotion_key"],
					checkOrder: true,
					timestampColumns: ["starts_at", "ends_at"],
				},
				" second account",
			);
		}
		const youngOnly = await engineOf(seeded).callTheme("promotion_catalogue", {
			store_ids: ["MOCK-S2"],
			as_of_date: clock.asOf,
		});
		expect(youngOnly.every((row) => !row.in_catalogue)).toBe(true);
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
		expect(inWindow(seeded.dataset, clock.asOf)).toBe(true);
	}, 900_000);
});
