import { describe, expect, it } from "vitest";
import { validatePack } from "../../../src/pack/invariants.js";
import { TABLE_IDS } from "../../../src/pack/tables/text.js";
import { buildWith, demoRequest, demoSource } from "../support/demo.js";
import { overriddenSource, type RowsOverride } from "../support/sources.js";

const NOTHING: RowsOverride = () => [];

describe("a pack without sales", () => {
	it("builds every table, empty where there is nothing to show, and validates", async () => {
		const overrides = Object.fromEntries(
			[
				"store_coverage",
				"metric_windows",
				"period_series",
				"month_pace",
				"hour_weekday_heatmap",
				"hour_profile",
				"item_summary",
				"item_margins",
				"basket_pairs",
				"modifier_summary",
				"payment_summary",
				"promotion_summary",
				"shift_review",
				"holiday_calendar",
			].map((name) => [name, NOTHING]),
		);
		const built = await buildWith(
			overriddenSource(demoSource(), overrides),
			demoRequest(),
		);
		expect((await validatePack(built.pack)).issues).toEqual([]);
		expect(Object.keys(built.pack.tables).sort()).toEqual(
			[...TABLE_IDS].sort(),
		);
		for (const id of [
			"weekly",
			"monthly",
			"weekday",
			"month_to_date",
			"heatmap_net",
			"heatmap_invoices",
			"hour_levels",
			"items",
			"categories",
			"sizes",
			"pairs",
			"modifiers",
			"payments",
			"promotions",
			"shifts",
			"calendar",
		]) {
			expect(built.pack.tables[id]?.rows, id).toEqual({});
		}
		expect(built.pack.tables.heatmap_net?.columns).toEqual([]);
		expect(Object.keys(built.pack.tables.stores?.rows ?? {})).toEqual([
			"S1",
			"S2",
		]);
		expect(built.pack.tables.kpi?.rows["ALL/net_revenue"]).toEqual([
			null,
			null,
			null,
			null,
			null,
			null,
			null,
			0,
		]);
		expect(Object.keys(built.pack.tables.gaps?.rows ?? {})).toEqual(
			expect.arrayContaining(["young_store/S1", "young_store/S2"]),
		);
		expect(built.pack.tables.gaps?.rows["young_store/S1"]?.[0]).toBe(0);
	});
});
