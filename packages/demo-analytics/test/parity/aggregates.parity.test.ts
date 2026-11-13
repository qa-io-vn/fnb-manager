import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ParityReport } from "./compare.js";
import { parityClock, parityDatasets } from "./datasets.js";
import {
	attachRows,
	dailyRows,
	type EngineRow,
	hourlyRows,
	itemRows,
	paymentRows,
	shiftCashRows,
	sizeRows,
} from "./engine-rows.js";
import {
	type OpenParityDatabase,
	openParityDatabase,
	type SeededDataset,
} from "./harness.js";

interface AggregateTable {
	readonly table: string;
	readonly key: readonly string[];
	readonly order: string;
	readonly engine: (seeded: SeededDataset) => EngineRow[];
	readonly ignore: readonly string[];
	readonly timestamps?: readonly string[];
}

const TABLES: readonly AggregateTable[] = [
	{
		table: "agg_daily_sales",
		key: ["store_id", "business_date"],
		order: "store_id, business_date",
		engine: dailyRows,
		ignore: ["tenant_id", "refreshed_at"],
	},
	{
		table: "agg_hourly_sales",
		key: ["store_id", "business_date", "hour_local"],
		order: "store_id, business_date, hour_local",
		engine: hourlyRows,
		ignore: ["tenant_id", "refreshed_at"],
	},
	{
		table: "agg_item_daily",
		key: ["store_id", "business_date", "item_external_id"],
		order: "store_id, business_date, item_external_id",
		engine: itemRows,
		ignore: ["tenant_id", "refreshed_at"],
	},
	{
		table: "agg_payment_daily",
		key: ["store_id", "business_date", "payment_method_external_id"],
		order: "store_id, business_date, payment_method_external_id",
		engine: paymentRows,
		ignore: ["tenant_id", "refreshed_at"],
	},
	{
		table: "agg_size_mix_daily",
		key: ["store_id", "business_date", "base_name", "size_label"],
		order: "store_id, business_date, base_name, size_label",
		engine: sizeRows,
		ignore: ["tenant_id", "refreshed_at"],
	},
	{
		table: "agg_attach_daily",
		key: ["store_id", "business_date"],
		order: "store_id, business_date",
		engine: attachRows,
		ignore: ["tenant_id", "refreshed_at"],
	},
	{
		table: "agg_shift_cash",
		key: ["store_id", "shift_external_id"],
		order: "store_id, business_date, shift_external_id",
		engine: shiftCashRows,
		ignore: ["tenant_id", "refreshed_at", "shift_id"],
		timestamps: ["opened_at", "closed_at"],
	},
];

const clock = parityClock();
const datasets = parityDatasets(clock);
const report = new ParityReport();

describe("aggregates the engine builds equal app.refresh_analytics", () => {
	let database: OpenParityDatabase | null = null;

	beforeAll(async () => {
		database = await openParityDatabase(
			[datasets.D1, datasets.D2, datasets.D3],
			clock,
		);
	});

	afterAll(async () => {
		await database?.close();
	});

	for (const table of TABLES) {
		it(`${table.table} row by row on every dataset`, async () => {
			const active = database;
			if (active === null) throw new Error("the parity database did not open");
			for (const seeded of active.datasets) {
				const sqlRows = await active.connection.rows(
					`select * from public.${table.table} where tenant_id = $1::uuid order by ${table.order}`,
					[seeded.tenantId],
				);
				report.compareRows(
					`${seeded.dataset.id} ${table.table}`,
					sqlRows,
					table.engine(seeded),
					{
						key: table.key,
						ignore: table.ignore,
						demoIdOf: seeded.demoIdOf,
						checkOrder: false,
						...(table.timestamps === undefined
							? {}
							: { timestampColumns: table.timestamps }),
					},
				);
			}
			expect(report.mismatches, report.summary()).toBe(0);
		});
	}

	it("reports the compared volume", () => {
		console.info(`aggregates parity: ${report.summary().split("\n")[0]}`);
		expect(report.compared).toBeGreaterThan(0);
	});
});
