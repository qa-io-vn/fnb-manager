import type { ReportDefinition } from "../definition.js";
import type { ReportKind } from "../period/periods.js";
import { dayReport } from "./day/index.js";
import { monthReport } from "./month/index.js";
import { weekReport } from "./week/index.js";
import { yearReport } from "./year/index.js";

export const reportDefinitions: Record<ReportKind, ReportDefinition> = {
	day: dayReport,
	week: weekReport,
	month: monthReport,
	year: yearReport,
};

export { dayCards, dayKeys, dayReport } from "./day/index.js";
export { monthCards, monthKeys, monthReport } from "./month/index.js";
export { weekCards, weekKeys, weekReport } from "./week/index.js";
export { yearCards, yearKeys, yearReport } from "./year/index.js";
