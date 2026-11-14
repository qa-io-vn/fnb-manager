import { reportKeys } from "../../../model/keys.js";
import type { ThemeCardDefinition } from "../../definition.js";
import { revenueKeys } from "../keys.js";
import { revenueNeeds } from "../support.js";
import { buildRevenueTotalsCard, type RevenueTotalsSpec } from "./totals.js";

export const revenueTicketSpec: RevenueTotalsSpec = {
	id: "avg_ticket",
	keys: revenueKeys.avgTicket,
	metricId: "avg_ticket",
	relatedMetricIds: ["items_per_ticket", "avg_item_price"],
	unit: "money",
	valueLabelKey: reportKeys.table.avgTicket,
	pick: (row) => row.avg_ticket,
	decomposes: "ticket",
	storeDrivers: false,
};

export const revenueTicketCard: ThemeCardDefinition = {
	id: "avg_ticket",
	needs: revenueNeeds.totals,
	visible: () => true,
	build: (input) => buildRevenueTotalsCard(revenueTicketSpec, input),
};
