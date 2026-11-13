import { isoWeekOf, type ReportPeriod } from "@fnb/reports";
import type { Translate } from "../i18n";
import type { Formatters } from "../lib/format";
import { monthLabel } from "./typed-values";

export function periodLabel(
	period: ReportPeriod,
	t: Translate,
	formatters: Formatters,
): string {
	switch (period.kind) {
		case "day":
			return t("report.period.day", {
				weekday: formatters.weekday(period.from),
				date: formatters.date(period.from),
			});
		case "week":
			return t("report.period.week", {
				week: isoWeekOf(period.from).isoWeek,
				from: formatters.date(period.from),
				to: formatters.date(period.to),
			});
		case "month":
			return t("report.period.month", { month: monthLabel(period.from) });
		case "year":
			return t("report.period.year", { year: period.from.slice(0, 4) });
	}
}
