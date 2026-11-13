import { addDays, type IsoDate } from "@fnb/reports";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ParityReport } from "./compare.js";
import { parityClock, parityDatasets } from "./datasets.js";
import { type OpenParityDatabase, openParityDatabase } from "./harness.js";
import { compareCall, matrixAnchors, STORE_SETS } from "./matrix.js";

const clock = parityClock();
const datasets = parityDatasets(clock);
const RANDOM_ANCHORS = 10;
const LIFECYCLE_KEY = ["item_external_id"] as const;

describe("item_lifecycle in the engine equals the SQL", () => {
	let database: OpenParityDatabase | null = null;
	const report = new ParityReport();

	beforeAll(async () => {
		database = await openParityDatabase([datasets.D2], clock);
	});

	afterAll(async () => {
		console.info(`item_lifecycle parity: ${report.summary().split("\n")[0]}`);
		await database?.close();
	});

	function active(): OpenParityDatabase {
		if (database === null) throw new Error("the parity database did not open");
		return database;
	}

	function lifecycleAnchors(): IsoDate[] {
		const seeded = active().datasets[0];
		if (seeded === undefined) throw new Error("D2 was not seeded");
		const young = seeded.stores["MOCK-S2"].definition.openedOn;
		return [
			...new Set([
				...matrixAnchors(seeded, clock, RANDOM_ANCHORS),
				addDays(young, -1),
				addDays(clock.asOf, -55),
				addDays(clock.asOf, -56),
				addDays(clock.today, 30),
			]),
		].sort();
	}

	it("item_lifecycle over D2 for every store set and anchor", async () => {
		const seeded = active().datasets[0];
		if (seeded === undefined) throw new Error("D2 was not seeded");
		for (const anchor of lifecycleAnchors()) {
			for (const stores of STORE_SETS) {
				await compareCall(
					report,
					active(),
					seeded,
					"item_lifecycle",
					{ store_ids: [...stores], as_of_date: anchor },
					{ key: LIFECYCLE_KEY },
				);
			}
		}
		expect(report.calls).toBeGreaterThan(0);
		expect(report.rows).toBeGreaterThan(0);
		expect(report.mismatches, report.summary()).toBe(0);
	});

	it("item_lifecycle returns no rows for an empty store list", async () => {
		const seeded = active().datasets[0];
		if (seeded === undefined) throw new Error("D2 was not seeded");
		const empty = new ParityReport();
		await compareCall(
			empty,
			active(),
			seeded,
			"item_lifecycle",
			{ store_ids: [], as_of_date: clock.asOf },
			{ key: LIFECYCLE_KEY },
		);
		expect(empty.calls).toBe(1);
		expect(empty.rows).toBe(0);
		expect(empty.mismatches, empty.summary()).toBe(0);
	});
});
