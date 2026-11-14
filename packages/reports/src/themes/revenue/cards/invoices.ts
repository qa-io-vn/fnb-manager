import { reportKeys } from "../../../model/keys.js";
import type { ThemeCardDefinition } from "../../definition.js";
import { revenueKeys } from "../keys.js";
import { revenueNeeds } from "../support.js";
import { buildRevenueTotalsCard, type RevenueTotalsSpec } from "./totals.js";

export const revenueInvoicesSpec: RevenueTotalsSpec = {
	id: "invoices",
	keys: revenueKeys.invoices,
	metricId: "invoices",
	relatedMetricIds: ["net_revenue", "avg_ticket"],
	unit: "count",
	valueLabelKey: reportKeys.table.invoices,
	pick: (row) => row.invoices,
	decomposes: null,
	storeDrivers: true,
};

export const revenueInvoicesCard: ThemeCardDefinition = {
	id: "invoices",
	needs: revenueNeeds.totals,
	visible: () => true,
	build: (input) => buildRevenueTotalsCard(revenueInvoicesSpec, input),
};
