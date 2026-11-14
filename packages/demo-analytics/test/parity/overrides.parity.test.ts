import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ParityReport } from "./compare.js";
import { parityClock, parityDatasets } from "./datasets.js";
import { attachRows, itemRows } from "./engine-rows.js";
import {
	type OpenParityDatabase,
	openParityDatabase,
	type SeededDataset,
} from "./harness.js";
import { applyMenuVariant } from "./settings-fixture.js";
import { compareThemeCall, seedSeats, themeEngine } from "./theme-harness.js";

const clock = parityClock();
const datasets = parityDatasets(clock);
const STORE_SETS = [["MOCK-S1"], ["MOCK-S2"], ["MOCK-S1", "MOCK-S2"]] as const;

async function snackLines(
	database: OpenParityDatabase,
	seeded: SeededDataset,
): Promise<number> {
	const rows = await database.connection.rows(
		"select coalesce(sum(snack_lines), 0)::integer as lines from public.agg_attach_daily where tenant_id = $1::uuid",
		[seeded.tenantId],
	);
	return Number(rows[0]?.lines ?? 0);
}

describe("aggregates and settings follow category overrides and costs in both engines", () => {
	let database: OpenParityDatabase | null = null;
	const report = new ParityReport();
	const before = new Map<string, number>();

	beforeAll(async () => {
		database = await openParityDatabase(
			[datasets.D1, datasets.D2, datasets.D3],
			clock,
		);
		for (const seeded of database.datasets) {
			await seedSeats(database, seeded);
			before.set(seeded.dataset.id, await snackLines(database, seeded));
		}
	});

	afterAll(async () => {
		console.info(`overrides parity: ${report.summary().split("\n")[0]}`);
		await database?.close();
	});

	it("matches agg_attach_daily, agg_item_daily and report_settings_of after the overrides", async () => {
		const active = database;
		if (active === null) throw new Error("the parity database did not open");
		for (const seeded of active.datasets) {
			const engine = themeEngine(seeded, clock);
			await applyMenuVariant(active, seeded, engine);
			expect(await snackLines(active, seeded)).toBeGreaterThan(
				before.get(seeded.dataset.id) ?? 0,
			);
			for (const [table, rows, key] of [
				["agg_attach_daily", attachRows, ["store_id", "business_date"]],
				[
					"agg_item_daily",
					itemRows,
					["store_id", "business_date", "item_external_id"],
				],
			] as const) {
				const sqlRows = await active.connection.rows(
					`select * from public.${table} where tenant_id = $1::uuid order by store_id, business_date`,
					[seeded.tenantId],
				);
				report.compareRows(
					`${seeded.dataset.id} ${table} with overrides`,
					sqlRows,
					rows(seeded),
					{
						key,
						ignore: ["tenant_id", "refreshed_at"],
						demoIdOf: seeded.demoIdOf,
						checkOrder: false,
					},
				);
			}
			for (const stores of STORE_SETS) {
				await compareThemeCall(
					report,
					active,
					seeded,
					engine,
					"report_settings_of",
					{ store_ids: [...stores] },
					{ key: ["store_id"], checkOrder: true, ignore: ["tenant_id"] },
					" with costs",
				);
			}
		}
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 600_000);
});
