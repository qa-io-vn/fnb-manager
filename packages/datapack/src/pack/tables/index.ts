import type { PackTable } from "../schema.js";
import { modifiersTable, pairsTable } from "./basket.js";
import { gapsTable } from "./gaps.js";
import { calendarTable } from "./holidays.js";
import {
	heatmapInvoicesTable,
	heatmapNetTable,
	hourLevelsTable,
} from "./hours.js";
import { categoriesTable, itemsTable, sizesTable } from "./items.js";
import { kpiTable } from "./kpi.js";
import { metricsTable } from "./metrics.js";
import { monthToDateTable } from "./month-to-date.js";
import { paymentsTable, promotionsTable } from "./payments.js";
import { monthlyTable, weekdayTable, weeklyTable } from "./series.js";
import { shiftsTable } from "./shifts.js";
import { storesTable } from "./stores.js";
import type { TableContext } from "./support.js";
import type { TableId } from "./text.js";

export const TABLE_BUILDERS: Readonly<
	Record<TableId, (context: TableContext) => PackTable>
> = {
	stores: storesTable,
	kpi: kpiTable,
	weekly: weeklyTable,
	monthly: monthlyTable,
	weekday: weekdayTable,
	month_to_date: monthToDateTable,
	heatmap_net: heatmapNetTable,
	heatmap_invoices: heatmapInvoicesTable,
	hour_levels: hourLevelsTable,
	items: itemsTable,
	categories: categoriesTable,
	sizes: sizesTable,
	pairs: pairsTable,
	modifiers: modifiersTable,
	payments: paymentsTable,
	promotions: promotionsTable,
	shifts: shiftsTable,
	calendar: calendarTable,
	gaps: gapsTable,
	metrics: metricsTable,
};

export function packTables(context: TableContext): Record<string, PackTable> {
	return Object.fromEntries(
		Object.entries(TABLE_BUILDERS).map(([id, build]) => [id, build(context)]),
	);
}
