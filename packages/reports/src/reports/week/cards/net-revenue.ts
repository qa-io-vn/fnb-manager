import type { CardDefinition } from "../../../definition.js";
import { reportKeys } from "../../../model/keys.js";
import { weekKeys } from "../keys.js";
import {
	buildWeekTotalsCard,
	type WeekTotalsSpec,
	weekTotalsNeeds,
} from "./totals-card.js";

export const weekNetRevenueSpec: WeekTotalsSpec = {
	id: "net_revenue",
	keys: weekKeys.net,
	metricId: "net_revenue",
	relatedMetricIds: ["invoices", "avg_ticket"],
	unit: "money",
	sumUnit: "money",
	valueLabelKey: reportKeys.table.netAmount,
	average: "net",
	pick: (row) => row.net_amount,
	pickDay: (row) => row.net_amount,
	decomposes: true,
	notesYoungStore: true,
};

export const netRevenueCard: CardDefinition = {
	id: "net_revenue",
	needs: weekTotalsNeeds,
	visible: () => true,
	build: (input) => buildWeekTotalsCard(weekNetRevenueSpec, input),
};
