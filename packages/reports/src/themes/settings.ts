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
