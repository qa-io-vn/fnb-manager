import type { ThemeArgs } from "@fnb/reports";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
	DemoReportSource,
	DemoStoreId,
	OpeningHours,
} from "../../src/index.js";
import { ParityReport } from "./compare.js";
import { parityClock, parityDatasets } from "./datasets.js";
import {
	literal,
	type OpenParityDatabase,
	openParityDatabase,
	type SeededDataset,
	type SqlRow,
} from "./harness.js";
import { STORE_SETS } from "./matrix.js";
import { seedSeats, themeEngine, themeSql } from "./theme-harness.js";

const clock = parityClock();
const datasets = parityDatasets(clock);
const OPTIONS = {
	key: ["store_id"],
	ignore: ["tenant_id"],
	checkOrder: true,
};
const CHANGED_HOURS: OpeningHours = {
	mon: [["06:30", "11:00"]],
	sat: [["16:00", "23:30"]],
};

function stableJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
	if (value !== null && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).sort(
			([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
		);
		return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
	}
	return JSON.stringify(value);
}

function withStableHours(rows: readonly SqlRow[]): SqlRow[] {
	return rows.map((row) => ({
		...row,
		opening_hours:
			row.opening_hours === null ? null : stableJson(row.opening_hours),
	}));
}

const STORE_LISTS: readonly (readonly DemoStoreId[])[] = [
	...STORE_SETS,
	["MOCK-S2", "MOCK-S1", "MOCK-S2"],
	[],
];

describe("store_profiles in the engine equals the SQL", () => {
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
		console.info(`store_profiles parity: ${report.summary().split("\n")[0]}`);
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

	async function compareProfiles(
		seeded: SeededDataset,
		stores: readonly DemoStoreId[],
		label: string,
	): Promise<SqlRow[]> {
		const args: ThemeArgs<"store_profiles"> = { store_ids: [...stores] };
		const { text, params } = themeSql(seeded, "store_profiles", args);
		const sqlRows = await active().connection.rows(text, params);
		const engineRows = (await engineOf(seeded).callTheme(
			"store_profiles",
			args,
		)) as unknown as SqlRow[];
		report.compareRows(
			`${seeded.dataset.id}${label} store_profiles(${stores.join(",")})`,
			withStableHours(sqlRows),
			withStableHours(engineRows),
			{ ...OPTIONS, demoIdOf: seeded.demoIdOf },
		);
		return engineRows;
	}

	it("matches every store list with the demo's profiles: labels, zone, day start, opening date and hours, seats, e-invoicing, currency and country", async () => {
		const seen: SqlRow[] = [];
		for (const seeded of active().datasets) {
			for (const stores of STORE_LISTS) {
				seen.push(...(await compareProfiles(seeded, stores, " defaults")));
			}
		}
		expect(
			seen.some(
				(row) =>
					row.store_id === "MOCK-S1" &&
					row.label === "S1" &&
					row.seat_count === 40 &&
					row.opening_hours !== null,
			),
		).toBe(true);
		expect(
			seen.some(
				(row) =>
					row.store_id === "MOCK-S2" &&
					row.label === "S2" &&
					row.opening_hours === null,
			),
		).toBe(true);
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	});

	it("matches again after the young store's opening hours and e-invoicing change", async () => {
		for (const seeded of active().datasets) {
			const engine = engineOf(seeded);
			const profile = engine.settings.storeProfile("MOCK-S2");
			if (profile === null) throw new Error("no profile for MOCK-S2");
			engine.settings.saveStoreProfile({
				...profile,
				openingHours: CHANGED_HOURS,
				eInvoiceStatus: "configured",
			});
			await active().connection.rows(
				`update public.stores set opening_hours = ${literal(CHANGED_HOURS)}, e_invoice_status = 'configured' where id = $1::uuid`,
				[seeded.uuidOf("MOCK-S2")],
			);
			for (const stores of STORE_SETS) {
				await compareProfiles(seeded, stores, " changed");
			}
		}
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	});
});
