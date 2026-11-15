import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	DEFAULT_REPORT_SETTINGS,
	hasAtMostFractionDigits,
	isDefaultReportSettings,
	REPORT_SETTING_LIMITS,
	REPORT_SETTINGS_COLUMNS,
	type ReportSettingLimit,
	settingsOf,
	withinReportSettingLimit,
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

function scaleOf(type: string): { precision: number; scale: number } | null {
	const numeric = /^numeric\((\d+), (\d+)\)$/.exec(type);
	if (numeric === null) return null;
	return { precision: Number(numeric[1]), scale: Number(numeric[2]) };
}

function columnLimits(table: string): Record<string, ReportSettingLimit> {
	const limits: Record<string, ReportSettingLimit> = {};
	for (const match of table.matchAll(
		/^\s+([a-z_]+) (smallint|numeric\(\d+, \d+\)) not null default [0-9.]+ check \(([^\n]*)\),?$/gm,
	)) {
		const [, column, type, check] = match;
		if (column === undefined || type === undefined || check === undefined) {
			continue;
		}
		const numeric = scaleOf(type);
		const fractionDigits = numeric?.scale ?? 0;
		const between = new RegExp(
			`^${column} between ([0-9.]+) and ([0-9.]+)$`,
		).exec(check);
		if (between !== null) {
			limits[column] = {
				min: Number(between[1]),
				max: Number(between[2]),
				fractionDigits,
			};
			continue;
		}
		const atLeast = new RegExp(`^${column} >= ([0-9.]+)$`).exec(check);
		if (atLeast !== null && numeric !== null) {
			limits[column] = {
				min: Number(atLeast[1]),
				max: 10 ** (numeric.precision - numeric.scale) - 10 ** -numeric.scale,
				fractionDigits,
			};
		}
	}
	return limits;
}

describe("REPORT_SETTING_LIMITS", () => {
	it("equals the check clauses and scales of report_settings in the migration", () => {
		const limits = columnLimits(reportSettingsTable());
		const expected = Object.fromEntries(
			Object.entries(REPORT_SETTINGS_COLUMNS).map(([key, column]) => [
				key,
				limits[column],
			]),
		);
		expect(REPORT_SETTING_LIMITS).toEqual(expected);
	});

	it("accepts every boundary and refuses one step outside it", () => {
		for (const limit of Object.values(REPORT_SETTING_LIMITS)) {
			const step = 10 ** -limit.fractionDigits;
			expect(withinReportSettingLimit(limit.min, limit)).toBe(true);
			expect(withinReportSettingLimit(limit.max, limit)).toBe(true);
			expect(withinReportSettingLimit(limit.min - step, limit)).toBe(false);
			expect(withinReportSettingLimit(limit.max + step, limit)).toBe(false);
		}
	});

	it("refuses a value with more decimals than the column keeps", () => {
		expect(hasAtMostFractionDigits(0.1001, 4)).toBe(true);
		expect(hasAtMostFractionDigits(0.10015, 4)).toBe(false);
		expect(hasAtMostFractionDigits(1.25, 3)).toBe(true);
		expect(hasAtMostFractionDigits(1.2505, 3)).toBe(false);
		expect(hasAtMostFractionDigits(999_999_999_999.99, 2)).toBe(true);
		expect(
			withinReportSettingLimit(Number.NaN, REPORT_SETTING_LIMITS.peakHours),
		).toBe(false);
	});
});

describe("isDefaultReportSettings", () => {
	it("is true only when every setting equals its default", () => {
		expect(isDefaultReportSettings({ ...DEFAULT_REPORT_SETTINGS })).toBe(true);
		for (const key of Object.keys(DEFAULT_REPORT_SETTINGS)) {
			expect(
				isDefaultReportSettings({
					...DEFAULT_REPORT_SETTINGS,
					[key]:
						REPORT_SETTING_LIMITS[key as keyof typeof REPORT_SETTING_LIMITS]
							.max,
				}),
				key,
			).toBe(false);
		}
	});
});

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
