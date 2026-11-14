import coreEn from "./messages/core.en.json";
import coreVi from "./messages/core.vi.json";
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
import themeHoursEn from "./messages/theme-hours.en.json";
import themeHoursVi from "./messages/theme-hours.vi.json";
import themeMenuEn from "./messages/theme-menu.en.json";
import themeMenuVi from "./messages/theme-menu.vi.json";
import themeRevenueEn from "./messages/theme-revenue.en.json";
import themeRevenueVi from "./messages/theme-revenue.vi.json";
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
	| keyof typeof themesVi
	| keyof typeof themeRevenueVi
	| keyof typeof themeHoursVi;

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
		excludedPrefixes: ["metric.", "report.", "theme."],
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
		name: "theme-menu",
		prefix: "theme.menu.",
		excludedPrefixes: [],
		vi: themeMenuVi,
		en: themeMenuEn,
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
