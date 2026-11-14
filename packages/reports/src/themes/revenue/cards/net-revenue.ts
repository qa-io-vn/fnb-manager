import { reportKeys } from "../../../model/keys.js";
import type { ThemeCardDefinition } from "../../definition.js";
import { revenueKeys } from "../keys.js";
import { revenueNeeds } from "../support.js";
import { buildRevenueTotalsCard, type RevenueTotalsSpec } from "./totals.js";

export const revenueNetSpec: RevenueTotalsSpec = {
	id: "net_revenue",
	keys: revenueKeys.net,
	metricId: "net_revenue",
	relatedMetricIds: ["invoices", "avg_ticket"],
	unit: "money",
	valueLabelKey: reportKeys.table.netAmount,
	pick: (row) => row.net_amount,
	decomposes: "net",
	storeDrivers: true,
};

export const revenueNetCard: ThemeCardDefinition = {
	id: "net_revenue",
	needs: revenueNeeds.totals,
	visible: () => true,
	build: (input) => buildRevenueTotalsCard(revenueNetSpec, input),
};
