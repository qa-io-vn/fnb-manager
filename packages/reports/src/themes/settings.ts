import type { ThemeRow } from "./contract.js";

export interface ReportSettings {
	readonly menuWindowDays: number;
	readonly menuPopularityFactor: number;
	readonly menuLowSampleItems: number;
	readonly cashAbsThreshold: number;
	readonly cashRelThreshold: number;
	readonly peakHours: number;
	readonly deadHourRatio: number;
	readonly busyHourRatio: number;
	readonly promoPreWeeks: number;
}

export const Z_THRESHOLD = 2;

export const DEFAULT_REPORT_SETTINGS: ReportSettings = {
	menuWindowDays: 28,
	menuPopularityFactor: 0.7,
	menuLowSampleItems: 10,
	cashAbsThreshold: 50000,
	cashRelThreshold: 0.005,
	peakHours: 3,
	deadHourRatio: 0.5,
	busyHourRatio: 1.25,
	promoPreWeeks: 4,
};

export const REPORT_SETTINGS_COLUMNS: Readonly<
	Record<keyof ReportSettings, string>
> = {
	menuWindowDays: "menu_window_days",
	menuPopularityFactor: "menu_popularity_factor",
	menuLowSampleItems: "menu_low_sample_items",
	cashAbsThreshold: "cash_abs_threshold",
	cashRelThreshold: "cash_rel_threshold",
	peakHours: "peak_hours",
	deadHourRatio: "dead_hour_ratio",
	busyHourRatio: "busy_hour_ratio",
	promoPreWeeks: "promo_pre_weeks",
};

export interface ReportSettingLimit {
	readonly min: number;
	readonly max: number;
	readonly fractionDigits: number;
}

export const MONEY_COLUMN_MAX = 999_999_999_999.99;

const FRACTION_TOLERANCE_EPSILONS = 8;

export const REPORT_SETTING_LIMITS: Readonly<
	Record<keyof ReportSettings, ReportSettingLimit>
> = {
	menuWindowDays: { min: 7, max: 91, fractionDigits: 0 },
	menuPopularityFactor: { min: 0.1, max: 1, fractionDigits: 3 },
	menuLowSampleItems: { min: 2, max: 50, fractionDigits: 0 },
	cashAbsThreshold: { min: 0, max: MONEY_COLUMN_MAX, fractionDigits: 2 },
	cashRelThreshold: { min: 0, max: 0.1, fractionDigits: 4 },
	peakHours: { min: 1, max: 6, fractionDigits: 0 },
	deadHourRatio: { min: 0.1, max: 0.9, fractionDigits: 3 },
	busyHourRatio: { min: 1.05, max: 3, fractionDigits: 3 },
	promoPreWeeks: { min: 2, max: 8, fractionDigits: 0 },
};

export function hasAtMostFractionDigits(
	value: number,
	fractionDigits: number,
): boolean {
	const scaled = value * 10 ** fractionDigits;
	const tolerance = FRACTION_TOLERANCE_EPSILONS * Number.EPSILON;
	return (
		Math.abs(scaled - Math.round(scaled)) <=
		tolerance * Math.max(1, Math.abs(scaled))
	);
}

export function withinReportSettingLimit(
	value: number,
	limit: ReportSettingLimit,
): boolean {
	return (
		Number.isFinite(value) &&
		value >= limit.min &&
		value <= limit.max &&
		hasAtMostFractionDigits(value, limit.fractionDigits)
	);
}

export interface StoreSettingsState {
	readonly storeId: string | null;
	readonly settings: ReportSettings;
	readonly zThreshold: number;
	readonly hasTenantRow: boolean;
	readonly seatCount: number | null;
	readonly openingHoursKnown: boolean;
	readonly feeRatesConfigured: boolean;
	readonly costsConfigured: boolean;
	readonly rolesConfigured: boolean;
}

export function settingsOfRow(
	row: ThemeRow<"report_settings_of">,
): StoreSettingsState {
	return {
		storeId: row.store_id,
		settings: {
			menuWindowDays: row.menu_window_days,
			menuPopularityFactor: row.menu_popularity_factor,
			menuLowSampleItems: row.menu_low_sample_items,
			cashAbsThreshold: row.cash_abs_threshold,
			cashRelThreshold: row.cash_rel_threshold,
			peakHours: row.peak_hours,
			deadHourRatio: row.dead_hour_ratio,
			busyHourRatio: row.busy_hour_ratio,
			promoPreWeeks: row.promo_pre_weeks,
		},
		zThreshold: row.z_threshold,
		hasTenantRow: row.has_tenant_row,
		seatCount: row.seat_count,
		openingHoursKnown: row.opening_hours_known,
		feeRatesConfigured: row.fee_rates_configured,
		costsConfigured: row.costs_configured,
		rolesConfigured: row.roles_configured,
	};
}

export interface SettingsSummary {
	readonly settings: ReportSettings;
	readonly zThreshold: number;
	readonly stores: readonly StoreSettingsState[];
}

export function settingsOf(
	rows: readonly ThemeRow<"report_settings_of">[],
): SettingsSummary {
	const stores = rows.map(settingsOfRow);
	const first = stores[0];
	return {
		settings: first?.settings ?? DEFAULT_REPORT_SETTINGS,
		zThreshold: first?.zThreshold ?? Z_THRESHOLD,
		stores,
	};
}
