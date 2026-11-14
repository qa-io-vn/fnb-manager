import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_REPORT_SETTINGS,
	REPORT_SETTINGS_COLUMNS,
	settingsOf,
	Z_THRESHOLD,
} from "../../../src/themes/settings.js";

const migrationsRoot = join(
	import.meta.dirname,
	"..",
	"..",
	"..",
	"..",
	"..",
	"supabase",
	"migrations",
);

function reportSettingsTable(): string {
	const file = readdirSync(migrationsRoot).find((name) =>
		name.endsWith("_report_settings_and_mappings.sql"),
	);
	if (file === undefined) throw new Error("the settings migration is missing");
	const sql = readFileSync(join(migrationsRoot, file), "utf8");
	const start = sql.indexOf("create table public.report_settings (");
	const end = sql.indexOf("\n);", start);
	return sql.slice(start, end);
}

function columnDefaults(table: string): Record<string, number> {
	const defaults: Record<string, number> = {};
	for (const match of table.matchAll(
		/^\s+([a-z_]+) [^\n]*? default ([0-9.]+)/gm,
	)) {
		const [, column, value] = match;
		if (column !== undefined && value !== undefined) {
			defaults[column] = Number(value);
		}
	}
	return defaults;
}

describe("DEFAULT_REPORT_SETTINGS", () => {
	it("equals the column defaults of report_settings in the migration", () => {
		const defaults = columnDefaults(reportSettingsTable());
		const expected = Object.fromEntries(
			Object.entries(REPORT_SETTINGS_COLUMNS).map(([key, column]) => [
				key,
				defaults[column],
			]),
		);
		expect(DEFAULT_REPORT_SETTINGS).toEqual(expected);
		expect(Object.keys(defaults).sort()).toEqual(
			Object.values(REPORT_SETTINGS_COLUMNS).sort(),
		);
	});
});

describe("settingsOf", () => {
	it("falls back to the defaults and the fixed z threshold without rows", () => {
		expect(settingsOf([])).toEqual({
			settings: DEFAULT_REPORT_SETTINGS,
			zThreshold: Z_THRESHOLD,
			stores: [],
		});
	});

	it("reads the first store's thresholds and every store's flags", () => {
		const row = {
			store_id: "S1",
			tenant_id: "T",
			has_tenant_row: true,
			menu_window_days: 21,
			menu_popularity_factor: 0.75,
			menu_low_sample_items: 5,
			cash_abs_threshold: 80000,
			cash_rel_threshold: 0.008,
			z_threshold: 2,
			peak_hours: 4,
			dead_hour_ratio: 0.4,
			busy_hour_ratio: 1.3,
			promo_pre_weeks: 3,
			seat_count: 40,
			opening_hours_known: true,
			fee_rates_configured: false,
			costs_configured: true,
			roles_configured: true,
		};
		const summary = settingsOf([
			row,
			{ ...row, store_id: "S2", seat_count: null },
		]);
		expect(summary.settings.peakHours).toBe(4);
		expect(summary.stores.map((store) => store.seatCount)).toEqual([40, null]);
		expect(summary.stores[0]?.costsConfigured).toBe(true);
	});
});
