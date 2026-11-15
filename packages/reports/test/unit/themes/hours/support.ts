import type { AnalyticsRow } from "../../../../src/contract/functions.js";
import { coverageModel } from "../../../../src/model/coverage.js";
import type { ThemeContext } from "../../../../src/themes/context.js";
import type {
	HourLevel,
	HourScope,
	ThemeRow,
} from "../../../../src/themes/contract.js";
import type {
	ReportRow,
	ThemeCardInput,
} from "../../../../src/themes/definition.js";
import type { ReportFunctionName } from "../../../../src/themes/source.js";
import { STORE_A } from "../../fixtures.js";

export type ProfileRow = ThemeRow<"hour_profile">;
export type HeatRow = ThemeRow<"hour_weekday_heatmap">;
export type ProductivityRow = ThemeRow<"opening_productivity">;
export type SettingsRow = ThemeRow<"report_settings_of">;
export type CoverageRow = AnalyticsRow<"store_coverage">;

export function profileRow(overrides: Partial<ProfileRow>): ProfileRow {
	return {
		scope: "all",
		weekday: null,
		hour_local: 9,
		hour_position: 3,
		days_with_data: 28,
		invoices: 280,
		net_amount: 14_000_000,
		avg_net_amount: 500_000,
		avg_invoices: 10,
		net_share: 0.1,
		level: "normal",
		peak_share: null,
		dead_share: null,
		peak_hours_used: 3,
		dead_hour_ratio_used: 0.5,
		busy_hour_ratio_used: 1.25,
		...overrides,
	};
}

export function profileSummary(
	scope: Exclude<HourScope, "weekday">,
	overrides: Partial<ProfileRow> = {},
): ProfileRow {
	return profileRow({
		scope,
		hour_local: null,
		hour_position: null,
		level: null,
		net_share: 1,
		...overrides,
	});
}

export interface HourSpec {
	readonly level: HourLevel | null;
	readonly net?: number;
	readonly invoices?: number;
	readonly share?: number;
}

export function dayProfile(
	scope: Exclude<HourScope, "weekday">,
	firstHour: number,
	hours: readonly HourSpec[],
	firstPosition = 0,
): ProfileRow[] {
	return hours.map((spec, index) =>
		profileRow({
			scope,
			hour_local: (firstHour + index) % 24,
			hour_position: firstPosition + index,
			level: spec.level,
			avg_net_amount: spec.net ?? 500_000,
			avg_invoices: spec.invoices ?? 10,
			net_share: spec.share ?? 0.1,
		}),
	);
}

export function weekdayRow(
	weekday: number,
	meanNet: number,
	overrides: Partial<ProfileRow> = {},
): ProfileRow {
	return profileRow({
		scope: "weekday",
		weekday,
		hour_local: null,
		hour_position: null,
		days_with_data: 4,
		level: null,
		avg_net_amount: meanNet,
		...overrides,
	});
}

export function heatRow(overrides: Partial<HeatRow>): HeatRow {
	return {
		weekday: 1,
		hour_local: 9,
		days_with_data: 4,
		invoices: 40,
		net_amount: 2_000_000,
		avg_net_amount: 500_000,
		avg_invoices: 10,
		...overrides,
	};
}

export function productivityRow(
	overrides: Partial<ProductivityRow>,
): ProductivityRow {
	return {
		store_id: null,
		days_with_sales: 28,
		invoices: 2800,
		net_amount: 140_000_000,
		opening_minutes: 20_160,
		seat_count: 40,
		seat_minutes: 806_400,
		sales_per_opening_hour: 416_666.67,
		invoices_per_opening_hour: 8.3333,
		revpash: 10_416.67,
		...overrides,
	};
}

export function settingsRow(overrides: Partial<SettingsRow>): SettingsRow {
	return {
		store_id: STORE_A,
		tenant_id: "33333333-3333-4333-8333-333333333333",
		has_tenant_row: false,
		menu_window_days: 28,
		menu_popularity_factor: 0.7,
		menu_low_sample_items: 10,
		cash_abs_threshold: 50_000,
		cash_rel_threshold: 0.005,
		z_threshold: 2,
		peak_hours: 3,
		dead_hour_ratio: 0.5,
		busy_hour_ratio: 1.25,
		promo_pre_weeks: 4,
		seat_count: 40,
		opening_hours_known: true,
		fee_rates_configured: false,
		costs_configured: false,
		roles_configured: true,
		...overrides,
	};
}

export function withDayStart(
	context: ThemeContext,
	minutes: readonly number[],
): ThemeContext {
	return {
		...context,
		stores: context.stores.map((store, index) => ({
			...store,
			businessDayStartMinutes: minutes[index] ?? 0,
		})),
	};
}

export function cardInput(
	context: ThemeContext,
	calls: Readonly<Record<string, readonly unknown[]>>,
	coverageRows: readonly CoverageRow[] = [],
): ThemeCardInput {
	return {
		context,
		coverage: coverageModel(coverageRows, context),
		results: {
			rows<N extends ReportFunctionName>(key: string, _name: N) {
				return calls[key] as readonly ReportRow<N>[] | undefined;
			},
		},
	};
}
