import type {
	CardModel,
	NoticeModel,
	TableColumnModel,
	TableModel,
} from "../../../model/card.js";
import { reportKeys } from "../../../model/keys.js";
import { column, STORE_COLUMN, tableModel } from "../../../model/tables.js";
import { numberValue, part } from "../../../model/values.js";
import { byVariance } from "../../../reports/day/cards/shifts.js";
import { shiftGroups } from "../../../reports/month/cards/shift-stats.js";
import type { ThemeContext } from "../../context.js";
import type { ThemeCardDefinition, ThemeCardInput } from "../../definition.js";
import {
	drawerChart,
	drawerFlaggedPart,
	drawerSettings,
	drawerTable,
	drawerThresholdsPart,
	shiftLabeller,
} from "../../payments/cards/drawer.js";
import { paymentsKeys } from "../../payments/keys.js";
import { rangeValue, themeMarkers } from "../../support.js";
import { shiftsKeys } from "../keys.js";
import {
	reviewRows,
	type ShiftRow,
	shiftsCalls,
	shiftsCsvName,
	shiftsNeeds,
} from "../support.js";

export function cashierTable(
	context: ThemeContext,
	rows: readonly ShiftRow[],
	multiStore: boolean,
): TableModel {
	const columns: TableColumnModel[] = [
		...(multiStore ? [STORE_COLUMN] : []),
		column("cashier", reportKeys.table.cashier, "label"),
		column("shifts", shiftsKeys.table.shifts, "count"),
		column("flagged", shiftsKeys.table.flagged, "count"),
		column("totalVariance", shiftsKeys.table.totalVariance, "money"),
		column("meanVariance", shiftsKeys.table.meanVariance, "money"),
		column("largestShortage", shiftsKeys.table.largestShortage, "money"),
		column("largestOverage", shiftsKeys.table.largestOverage, "money"),
	];
	const storeName = (storeId: string | null) =>
		context.stores.find((store) => store.id === storeId)?.name ?? null;
	return tableModel({
		captionKey: shiftsKeys.drawer.cashierTable,
		columns,
		rows: shiftGroups(rows, { byStore: multiStore, bySlot: false }).map(
			(group, index) => ({
				id: `cashier-${index + 1}`,
				cells: {
					store: storeName(group.storeId),
					cashier: group.cashier ?? reportKeys.label.unknownCashier,
					shifts: group.shifts,
					flagged: group.flagged,
					totalVariance: group.totalVariance,
					meanVariance: group.meanVariance,
					largestShortage: group.largestShortage,
					largestOverage: group.largestOverage,
				},
			}),
		),
		initialSort: { key: "flagged", direction: "descending" },
	});
}

export function buildShiftDrawerCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const rows = byVariance(reviewRows(input.results));
	const flagged = rows.filter((row) => row.flagged);
	const labeller = shiftLabeller(context, rows);
	const thresholds = drawerThresholdsPart(
		drawerSettings(input, shiftsCalls.settings),
	);
	const notice: NoticeModel | null =
		rows.length === 0
			? { tone: "info", part: part(shiftsKeys.noShifts), action: null }
			: null;
	return {
		id: "drawer",
		titleKey: shiftsKeys.drawer.title,
		subtitle: null,
		metricId: "flagged_shifts",
		relatedMetricIds: ["cash_variance", "cash_variance_zscore"],
		headline: {
			value: rows.length === 0 ? null : flagged.length,
			unit: "count",
			caption:
				rows.length === 0
					? null
					: part(paymentsKeys.drawer.caption, {
							count: numberValue("count", rows.length),
						}),
		},
		comparisons: [],
		decomposition: null,
		narrative: [
			rows.length === 0
				? part(shiftsKeys.noData, { range: rangeValue(context) })
				: drawerFlaggedPart(rows, flagged, labeller),
			...(thresholds === null ? [] : [thresholds]),
		],
		tables: [
			drawerTable(rows, labeller),
			cashierTable(context, rows, labeller.multiStore),
		],
		chart: drawerChart(rows, labeller),
		notice,
		markers: themeMarkers(input, true),
		csvName: shiftsCsvName(context, "drawer"),
	};
}

export const shiftDrawerCard: ThemeCardDefinition = {
	id: "drawer",
	needs: shiftsNeeds.drawer,
	visible: () => true,
	build: buildShiftDrawerCard,
};
