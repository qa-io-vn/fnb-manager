import { type ThemeRow, Z_THRESHOLD } from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import { openingHoursPresent } from "./opening-hours.js";
import {
	requireThemeStoreIds,
	type ThemeHandlerArgs,
	type ThemeHandlerContext,
} from "./theme-support.js";

type Row = ThemeRow<"report_settings_of">;

export const DEMO_TENANT_SETTINGS_ID = "demo-tenant";

export function reportSettingsOf(
	store: AggregateStore,
	args: ThemeHandlerArgs<"report_settings_of">,
	context: ThemeHandlerContext,
): Row[] {
	requireThemeStoreIds("report_settings_of", args.store_ids);
	const settings = context.settings.reportSettings();
	return store.visibleStores(args.store_ids).map((visible) => ({
		store_id: visible.id,
		tenant_id: DEMO_TENANT_SETTINGS_ID,
		has_tenant_row: context.settings.hasReportSettingsRow(),
		menu_window_days: settings.menuWindowDays,
		menu_popularity_factor: settings.menuPopularityFactor,
		menu_low_sample_items: settings.menuLowSampleItems,
		cash_abs_threshold: settings.cashAbsThreshold,
		cash_rel_threshold: settings.cashRelThreshold,
		z_threshold: Z_THRESHOLD,
		peak_hours: settings.peakHours,
		dead_hour_ratio: settings.deadHourRatio,
		busy_hour_ratio: settings.busyHourRatio,
		promo_pre_weeks: settings.promoPreWeeks,
		seat_count: context.settings.seatCount(visible.id),
		opening_hours_known: openingHoursPresent(visible.openingHours),
		fee_rates_configured: context.settings.feeRatesConfigured(visible.id),
		costs_configured: context.settings.costsConfigured(visible.id),
		roles_configured: context.settings.rolesConfigured(visible.id),
	}));
}
