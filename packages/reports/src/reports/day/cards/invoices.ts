import type { CardDefinition } from "../../../definition.js";
import { reportKeys } from "../../../model/keys.js";
import { dayKeys } from "../keys.js";
import {
	buildTotalsCard,
	type TotalsCardSpec,
	totalsNeeds,
} from "./totals-card.js";

export const invoicesSpec: TotalsCardSpec = {
	id: "invoices",
	keys: dayKeys.invoices,
	metricId: "invoices",
	relatedMetricIds: ["same_weekday_baseline"],
	unit: "count",
	valueLabelKey: reportKeys.table.invoices,
	pick: (row) => row.invoices,
	hourCurrent: (row) => row.current_invoices,
	hourBaseline: (row) => row.baseline_invoices,
	decomposes: false,
	notesYoungStore: false,
};

export const invoicesCard: CardDefinition = {
	id: "invoices",
	needs: totalsNeeds,
	visible: () => true,
	build: (input) => buildTotalsCard(invoicesSpec, input),
};
