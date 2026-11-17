import coreEn from "./messages/core.en.json";
import coreVi from "./messages/core.vi.json";
import exportsEn from "./messages/exports.en.json";
import exportsVi from "./messages/exports.vi.json";
import metricsEn from "./messages/metrics.en.json";
import metricsVi from "./messages/metrics.vi.json";
import reportDayEn from "./messages/report-day.en.json";
import reportDayVi from "./messages/report-day.vi.json";
import reportMonthEn from "./messages/report-month.en.json";
import reportMonthVi from "./messages/report-month.vi.json";
import reportWeekEn from "./messages/report-week.en.json";
import reportWeekVi from "./messages/report-week.vi.json";
import reportYearEn from "./messages/report-year.en.json";
import reportYearVi from "./messages/report-year.vi.json";
import reportsEn from "./messages/reports.en.json";
import reportsVi from "./messages/reports.vi.json";
import settingsEn from "./messages/settings.en.json";
import settingsVi from "./messages/settings.vi.json";
import settingsFeesEn from "./messages/settings-fees.en.json";
import settingsFeesVi from "./messages/settings-fees.vi.json";
import settingsHolidaysEn from "./messages/settings-holidays.en.json";
import settingsHolidaysVi from "./messages/settings-holidays.vi.json";
import settingsLegalEn from "./messages/settings-legal.en.json";
import settingsLegalVi from "./messages/settings-legal.vi.json";
import settingsManualEn from "./messages/settings-manual.en.json";
import settingsManualVi from "./messages/settings-manual.vi.json";
import settingsMappingEn from "./messages/settings-mapping.en.json";
import settingsMappingVi from "./messages/settings-mapping.vi.json";
import settingsStoreEn from "./messages/settings-store.en.json";
import settingsStoreVi from "./messages/settings-store.vi.json";
import settingsTargetsEn from "./messages/settings-targets.en.json";
import settingsTargetsVi from "./messages/settings-targets.vi.json";
import settingsThresholdsEn from "./messages/settings-thresholds.en.json";
import settingsThresholdsVi from "./messages/settings-thresholds.vi.json";
import themeHoursEn from "./messages/theme-hours.en.json";
import themeHoursVi from "./messages/theme-hours.vi.json";
import themeMenuEn from "./messages/theme-menu.en.json";
import themeMenuVi from "./messages/theme-menu.vi.json";
import themePaymentsEn from "./messages/theme-payments.en.json";
import themePaymentsVi from "./messages/theme-payments.vi.json";
import themePromotionsEn from "./messages/theme-promotions.en.json";
import themePromotionsVi from "./messages/theme-promotions.vi.json";
import themeQualityEn from "./messages/theme-quality.en.json";
import themeQualityVi from "./messages/theme-quality.vi.json";
import themeRevenueEn from "./messages/theme-revenue.en.json";
import themeRevenueVi from "./messages/theme-revenue.vi.json";
import themeShiftsEn from "./messages/theme-shifts.en.json";
import themeShiftsVi from "./messages/theme-shifts.vi.json";
import themeStoresEn from "./messages/theme-stores.en.json";
import themeStoresVi from "./messages/theme-stores.vi.json";
import themesEn from "./messages/themes.en.json";
import themesVi from "./messages/themes.vi.json";

export type MessageKey =
	| keyof typeof coreVi
	| keyof typeof metricsVi
	| keyof typeof reportsVi
	| keyof typeof reportDayVi
	| keyof typeof reportWeekVi
	| keyof typeof reportMonthVi
	| keyof typeof reportYearVi
	| keyof typeof settingsVi
	| keyof typeof settingsThresholdsVi
	| keyof typeof settingsMappingVi
	| keyof typeof settingsStoreVi
	| keyof typeof settingsHolidaysVi
	| keyof typeof settingsManualVi
	| keyof typeof settingsLegalVi
	| keyof typeof settingsTargetsVi
	| keyof typeof settingsFeesVi
	| keyof typeof themesVi
	| keyof typeof themeRevenueVi
	| keyof typeof themeHoursVi
	| keyof typeof exportsVi;

export interface MessageFile {
	readonly name: string;
	readonly prefix: string | null;
	readonly excludedPrefixes: readonly string[];
	readonly vi: Readonly<Record<string, string>>;
	readonly en: Readonly<Record<string, string>>;
}

const themeFilePrefixes = [
	"theme.revenue.",
	"theme.hours.",
	"theme.menu.",
	"theme.payments.",
	"theme.promotions.",
	"theme.shifts.",
	"theme.stores.",
	"theme.quality.",
] as const;

const settingsFilePrefixes = [
	"settings.thresholds.",
	"settings.mapping.",
	"settings.store.",
	"settings.holidays.",
	"settings.manual.",
	"settings.legal.",
	"settings.targets.",
	"settings.fees.",
] as const;

const reportFilePrefixes = [
	"report.day.",
	"report.week.",
	"report.month.",
	"report.year.",
] as const;

export const messageFiles: readonly MessageFile[] = [
	{
		name: "core",
		prefix: null,
		excludedPrefixes: ["metric.", "report.", "theme.", "settings.", "exports."],
		vi: coreVi,
		en: coreEn,
	},
	{
		name: "metrics",
		prefix: "metric.",
		excludedPrefixes: [],
		vi: metricsVi,
		en: metricsEn,
	},
	{
		name: "reports",
		prefix: "report.",
		excludedPrefixes: reportFilePrefixes,
		vi: reportsVi,
		en: reportsEn,
	},
	{
		name: "report-day",
		prefix: "report.day.",
		excludedPrefixes: [],
		vi: reportDayVi,
		en: reportDayEn,
	},
	{
		name: "report-week",
		prefix: "report.week.",
		excludedPrefixes: [],
		vi: reportWeekVi,
		en: reportWeekEn,
	},
	{
		name: "report-month",
		prefix: "report.month.",
		excludedPrefixes: [],
		vi: reportMonthVi,
		en: reportMonthEn,
	},
	{
		name: "report-year",
		prefix: "report.year.",
		excludedPrefixes: [],
		vi: reportYearVi,
		en: reportYearEn,
	},
	{
		name: "themes",
		prefix: "theme.",
		excludedPrefixes: themeFilePrefixes,
		vi: themesVi,
		en: themesEn,
	},
	{
		name: "theme-revenue",
		prefix: "theme.revenue.",
		excludedPrefixes: [],
		vi: themeRevenueVi,
		en: themeRevenueEn,
	},
	{
		name: "theme-hours",
		prefix: "theme.hours.",
		excludedPrefixes: [],
		vi: themeHoursVi,
		en: themeHoursEn,
	},
	{
		name: "settings",
		prefix: "settings.",
		excludedPrefixes: settingsFilePrefixes,
		vi: settingsVi,
		en: settingsEn,
	},
	{
		name: "settings-mapping",
		prefix: "settings.mapping.",
		excludedPrefixes: [],
		vi: settingsMappingVi,
		en: settingsMappingEn,
	},
	{
		name: "settings-thresholds",
		prefix: "settings.thresholds.",
		excludedPrefixes: [],
		vi: settingsThresholdsVi,
		en: settingsThresholdsEn,
	},
	{
		name: "theme-menu",
		prefix: "theme.menu.",
		excludedPrefixes: [],
		vi: themeMenuVi,
		en: themeMenuEn,
	},
	{
		name: "theme-payments",
		prefix: "theme.payments.",
		excludedPrefixes: [],
		vi: themePaymentsVi,
		en: themePaymentsEn,
	},
	{
		name: "theme-promotions",
		prefix: "theme.promotions.",
		excludedPrefixes: [],
		vi: themePromotionsVi,
		en: themePromotionsEn,
	},
	{
		name: "theme-shifts",
		prefix: "theme.shifts.",
		excludedPrefixes: [],
		vi: themeShiftsVi,
		en: themeShiftsEn,
	},
	{
		name: "theme-stores",
		prefix: "theme.stores.",
		excludedPrefixes: [],
		vi: themeStoresVi,
		en: themeStoresEn,
	},
	{
		name: "theme-quality",
		prefix: "theme.quality.",
		excludedPrefixes: [],
		vi: themeQualityVi,
		en: themeQualityEn,
	},
	{
		name: "settings-store",
		prefix: "settings.store.",
		excludedPrefixes: [],
		vi: settingsStoreVi,
		en: settingsStoreEn,
	},
	{
		name: "settings-holidays",
		prefix: "settings.holidays.",
		excludedPrefixes: [],
		vi: settingsHolidaysVi,
		en: settingsHolidaysEn,
	},
	{
		name: "settings-manual",
		prefix: "settings.manual.",
		excludedPrefixes: [],
		vi: settingsManualVi,
		en: settingsManualEn,
	},
	{
		name: "settings-legal",
		prefix: "settings.legal.",
		excludedPrefixes: [],
		vi: settingsLegalVi,
		en: settingsLegalEn,
	},
	{
		name: "settings-targets",
		prefix: "settings.targets.",
		excludedPrefixes: [],
		vi: settingsTargetsVi,
		en: settingsTargetsEn,
	},
	{
		name: "settings-fees",
		prefix: "settings.fees.",
		excludedPrefixes: [],
		vi: settingsFeesVi,
		en: settingsFeesEn,
	},
	{
		name: "exports",
		prefix: "exports.",
		excludedPrefixes: [],
		vi: exportsVi,
		en: exportsEn,
	},
];

function merged(language: "vi" | "en"): Record<MessageKey, string> {
	return Object.assign(
		{},
		...messageFiles.map((file) => file[language]),
	) as Record<MessageKey, string>;
}

export const vi: Record<MessageKey, string> = merged("vi");
export const en: Record<MessageKey, string> = merged("en");
