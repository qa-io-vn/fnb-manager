import type { CardDefinition } from "../../../definition.js";
import { reportKeys } from "../../../model/keys.js";
import { dayKeys } from "../keys.js";
import {
	buildTotalsCard,
	type TotalsCardSpec,
	totalsNeeds,
} from "./totals-card.js";

export const netRevenueSpec: TotalsCardSpec = {
	id: "net_revenue",
	keys: dayKeys.net,
	metricId: "net_revenue",
	relatedMetricIds: ["invoices", "avg_ticket", "same_weekday_baseline"],
	unit: "money",
	valueLabelKey: reportKeys.table.netAmount,
	pick: (row) => row.net_amount,
	hourCurrent: (row) => row.current_net_amount,
	hourBaseline: (row) => row.baseline_net_amount,
	decomposes: true,
	notesYoungStore: true,
};

export const netRevenueCard: CardDefinition = {
	id: "net_revenue",
	needs: totalsNeeds,
	visible: () => true,
	build: (input) => buildTotalsCard(netRevenueSpec, input),
};
