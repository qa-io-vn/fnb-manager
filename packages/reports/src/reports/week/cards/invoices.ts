import type { CardDefinition } from "../../../definition.js";
import { reportKeys } from "../../../model/keys.js";
import { weekKeys } from "../keys.js";
import {
	buildWeekTotalsCard,
	type WeekTotalsSpec,
	weekTotalsNeeds,
} from "./totals-card.js";

export const weekInvoicesSpec: WeekTotalsSpec = {
	id: "invoices",
	keys: weekKeys.invoices,
	metricId: "invoices",
	relatedMetricIds: [],
	unit: "count",
	sumUnit: "count",
	valueLabelKey: reportKeys.table.invoices,
	average: "invoices",
	pick: (row) => row.invoices,
	pickDay: (row) => row.invoices,
	decomposes: false,
	notesYoungStore: false,
};

export const invoicesCard: CardDefinition = {
	id: "invoices",
	needs: weekTotalsNeeds,
	visible: () => true,
	build: (input) => buildWeekTotalsCard(weekInvoicesSpec, input),
};
