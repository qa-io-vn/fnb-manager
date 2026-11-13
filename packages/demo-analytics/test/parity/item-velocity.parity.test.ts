import { addDays, type IsoDate } from "@fnb/reports";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ParityReport } from "./compare.js";
import { inWindow, parityClock, parityDatasets } from "./datasets.js";
import {
	type OpenParityDatabase,
	openParityDatabase,
	type SeededDataset,
} from "./harness.js";
import { matrixAnchors, STORE_SETS } from "./matrix.js";

const clock = parityClock();
const datasets = parityDatasets(clock);
const RANDOM_ANCHORS = 10;
const WINDOW_EDGE_OFFSETS = [0, 27, 28, 54, 55, 56] as const;

type Row = Readonly<Record<string, unknown>>;

function recentNetOf(row: Row): number {
	return Number(row.recent_net_amount);
}

function descendingByRecentNet(rows: readonly Row[]): boolean {
	return rows.every(
		(row, index) =>
			index === 0 || recentNetOf(rows[index - 1] as Row) >= recentNetOf(row),
	);
}

function windowEdges(seeded: SeededDataset): IsoDate[] {
	return WINDOW_EDGE_OFFSETS.map((offset) =>
		addDays(seeded.window.from, offset),
	).filter((date) => inWindow(seeded.dataset, date));
}

describe("item_velocity in the engine equals the SQL", () => {
	let database: OpenParityDatabase | null = null;
	const report = new ParityReport();

	beforeAll(async () => {
		database = await openParityDatabase(
			[datasets.D1, datasets.D2, datasets.D3],
			clock,
		);
	});

	afterAll(async () => {
		console.info(`item_velocity parity: ${report.summary().split("\n")[0]}`);
		await database?.close();
	});

	function active(): OpenParityDatabase {
		if (database === null) throw new Error("the parity database did not open");
		return database;
	}

	async function compareVelocity(
		seeded: SeededDataset,
		storeIds: readonly string[],
		anchor: IsoDate,
	): Promise<void> {
		const args = { store_ids: [...storeIds], as_of_date: anchor };
		const label = `${seeded.dataset.id} item_velocity(${storeIds.join(",")}, ${anchor})`;
		const sqlRows = await active().call(seeded, "item_velocity", args);
		const engineRows = (await seeded.engine.call(
			"item_velocity",
			args,
		)) as unknown as Row[];
		report.compareRows(label, sqlRows, engineRows, {
			key: ["item_external_id"],
			checkOrder: false,
			demoIdOf: seeded.demoIdOf,
		});
		report.compareValues(
			label,
			"rows ordered by recent_net_amount desc",
			true,
			descendingByRecentNet(sqlRows) && descendingByRecentNet(engineRows),
		);
	}

	it("item_velocity over the matrix of every dataset", async () => {
		for (const seeded of active().datasets) {
			const anchors = [
				...new Set([
					...matrixAnchors(seeded, clock, RANDOM_ANCHORS),
					...windowEdges(seeded),
				]),
			].sort();
			for (const anchor of anchors) {
				for (const stores of STORE_SETS) {
					await compareVelocity(seeded, stores, anchor);
				}
			}
		}
		expect(report.calls).toBeGreaterThan(0);
		expect(report.rows).toBeGreaterThan(0);
		expect(report.mismatches, report.summary()).toBe(0);
	});

	it("returns no rows for an empty store list or a day before any sale", async () => {
		const seeded = active().datasets[0];
		if (seeded === undefined) throw new Error("no dataset");
		await compareVelocity(seeded, [], clock.asOf);
		await compareVelocity(
			seeded,
			["MOCK-S1", "MOCK-S2"],
			addDays(seeded.window.from, -1),
		);
		const rows = await active().call(seeded, "item_velocity", {
			store_ids: [],
			as_of_date: clock.asOf,
		});
		expect(rows).toEqual([]);
		expect(report.mismatches, report.summary()).toBe(0);
	});
});
