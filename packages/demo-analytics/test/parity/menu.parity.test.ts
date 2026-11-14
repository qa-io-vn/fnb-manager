import { randomUUID } from "node:crypto";
import { addDays } from "@fnb/reports";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DemoReportSource } from "../../src/index.js";
import { ParityReport } from "./compare.js";
import { parityClock, parityDatasets } from "./datasets.js";
import {
	type OpenParityDatabase,
	openParityDatabase,
	type ParityContext,
	type SeededDataset,
} from "./harness.js";
import { applyMenuVariant, applySecondAccount } from "./settings-fixture.js";
import {
	applySettingsVariant,
	compareThemeCall,
	SETTINGS_VARIANTS,
	themeEngine,
} from "./theme-harness.js";

const clock = parityClock();
const datasets = parityDatasets(clock);
const UNKNOWN_STORE = randomUUID();
const STORE_SETS: readonly (readonly string[])[] = [
	["MOCK-S1"],
	["MOCK-S2"],
	["MOCK-S1", "MOCK-S2"],
	["MOCK-S2", "MOCK-S1"],
	[],
	["MOCK-S1", "MOCK-S1"],
	["MOCK-S1", UNKNOWN_STORE],
];
const SPANS = [7, 28, 91] as const;

async function compareMenuCalls(
	report: ParityReport,
	context: ParityContext,
	seeded: SeededDataset,
	engine: DemoReportSource,
	label: string,
): Promise<void> {
	const end = seeded.window.to;
	for (const stores of STORE_SETS) {
		const storeIds = [...stores];
		for (const asOf of [end, addDays(end, -20)]) {
			await compareThemeCall(
				report,
				context,
				seeded,
				engine,
				"menu_engineering",
				{ store_ids: storeIds, as_of_date: asOf },
				{ key: ["role", "item_external_id"], checkOrder: true },
				` ${label}`,
			);
		}
		await compareThemeCall(
			report,
			context,
			seeded,
			engine,
			"menu_engineering",
			{
				store_ids: storeIds,
				as_of_date: end,
				window_days: 14,
				popularity_factor: 0.6,
				low_sample_items: 3,
			},
			{ key: ["role", "item_external_id"], checkOrder: true },
			` ${label} explicit`,
		);
		for (const invalid of [
			{ window_days: 92 },
			{ popularity_factor: 1.5 },
			{ low_sample_items: 1 },
		]) {
			await compareThemeCall(
				report,
				context,
				seeded,
				engine,
				"menu_engineering",
				{ store_ids: storeIds, as_of_date: end, ...invalid },
				{ key: ["role", "item_external_id"], checkOrder: true },
				` ${label} ${JSON.stringify(invalid)}`,
			);
		}
		for (const span of SPANS) {
			const range = {
				store_ids: storeIds,
				from_date: addDays(end, -(span - 1)),
				to_date: end,
			};
			await compareThemeCall(
				report,
				context,
				seeded,
				engine,
				"item_margins",
				range,
				{ key: ["item_external_id"], checkOrder: true },
				` ${label} ${span}d`,
			);
			await compareThemeCall(
				report,
				context,
				seeded,
				engine,
				"item_attach",
				range,
				{ key: ["item_external_id"], checkOrder: true },
				` ${label} ${span}d`,
			);
		}
		await compareThemeCall(
			report,
			context,
			seeded,
			engine,
			"item_attach",
			{ store_ids: storeIds, from_date: addDays(end, -92), to_date: end },
			{ key: ["item_external_id"], checkOrder: true },
			` ${label} 93d`,
		);
		const sqlRows = await context.call(seeded, "item_summary", {
			store_ids: storeIds,
			from_date: addDays(end, -27),
			to_date: end,
			compare_from: addDays(end, -55),
			compare_to: addDays(end, -28),
		});
		const engineRows = await engine.call("item_summary", {
			store_ids: storeIds,
			from_date: addDays(end, -27),
			to_date: end,
			compare_from: addDays(end, -55),
			compare_to: addDays(end, -28),
		});
		report.compareRows(
			`${seeded.dataset.id} ${label} item_summary`,
			sqlRows,
			engineRows as unknown as typeof sqlRows,
			{
				key: ["item_external_id"],
				checkOrder: true,
				demoIdOf: seeded.demoIdOf,
			},
		);
	}
}

async function expectMatrixCostEqualsMargins(
	engine: DemoReportSource,
	seeded: SeededDataset,
): Promise<void> {
	const end = seeded.window.to;
	for (const stores of STORE_SETS) {
		const matrix = await engine.callTheme("menu_engineering", {
			store_ids: [...stores],
			as_of_date: end,
			window_days: 28,
		});
		const margins = await engine.callTheme("item_margins", {
			store_ids: [...stores],
			from_date: addDays(end, -27),
			to_date: end,
		});
		const byItem = new Map(margins.map((row) => [row.item_external_id, row]));
		for (const row of matrix) {
			if (row.unit_cost === null) continue;
			const margin = byItem.get(row.item_external_id);
			if (margin === undefined || margin.cost_amount === null) continue;
			const sameRole = matrix.filter(
				(other) => other.item_external_id === row.item_external_id,
			);
			if (sameRole.length > 1) continue;
			expect(row.unit_cost).toBeCloseTo(
				Math.round((margin.cost_amount / margin.costed_quantity) * 100) / 100,
				2,
			);
		}
	}
}

describe("the menu functions in the engine equal the SQL", () => {
	let database: OpenParityDatabase | null = null;
	const report = new ParityReport();

	beforeAll(async () => {
		database = await openParityDatabase(
			[datasets.D1, datasets.D2, datasets.D3],
			clock,
		);
	});

	afterAll(async () => {
		console.info(`menu parity: ${report.summary().split("\n")[0]}`);
		await database?.close();
	});

	it("matches without overrides or costs, then with them, under both settings variants", async () => {
		const active = database;
		if (active === null) throw new Error("the parity database did not open");
		for (const seeded of active.datasets) {
			const engine = themeEngine(seeded, clock);
			seeded.days.useMappings(engine.settings);
			for (const variant of SETTINGS_VARIANTS) {
				await applySettingsVariant(active, seeded, engine, variant);
				await compareMenuCalls(
					report,
					active,
					seeded,
					engine,
					`plain ${variant.id}`,
				);
			}
			await applyMenuVariant(active, seeded, engine);
			for (const variant of SETTINGS_VARIANTS) {
				await applySettingsVariant(active, seeded, engine, variant);
				await compareMenuCalls(
					report,
					active,
					seeded,
					engine,
					`overrides ${variant.id}`,
				);
			}
			await expectMatrixCostEqualsMargins(engine, seeded);
			const toppings = await engine.callTheme("menu_engineering", {
				store_ids: ["MOCK-S1"],
				as_of_date: seeded.window.to,
			});
			expect(
				toppings.some((row) => row.role === "topping" && !row.provisional),
			).toBe(true);
			await applySecondAccount(active, seeded, engine);
			for (const variant of SETTINGS_VARIANTS) {
				await applySettingsVariant(active, seeded, engine, variant);
				await compareMenuCalls(
					report,
					active,
					seeded,
					engine,
					`second account ${variant.id}`,
				);
			}
		}
		expect(report.differences).toEqual([]);
		expect(report.mismatches).toBe(0);
	}, 1_200_000);
});
