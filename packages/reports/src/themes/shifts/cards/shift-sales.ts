import type {
	CardModel,
	ChartModel,
	NoticeModel,
	TableColumnModel,
} from "../../../model/card.js";
import { groupRows } from "../../../model/grouping.js";
import { reportKeys } from "../../../model/keys.js";
import { sumMoney } from "../../../model/money.js";
import { ratio } from "../../../model/numeric.js";
import { cashierCell, shiftNumberValue } from "../../../model/shifts.js";
import { column, STORE_COLUMN, tableModel } from "../../../model/tables.js";
import { numberValue, part, type SentencePart } from "../../../model/values.js";
import { wallClock } from "../../../reports/day/cards/shifts.js";
import type { ThemeContext } from "../../context.js";
import type { ThemeCardDefinition, ThemeCardInput } from "../../definition.js";
import {
	DRAWER_PREVIEW_ROWS,
	type ShiftLabeller,
	shiftLabeller,
	shiftOnLabel,
} from "../../payments/cards/drawer.js";
import { rangeValue, themeMarkers } from "../../support.js";
import { shiftsKeys } from "../keys.js";
import {
	reviewRows,
	type ShiftRow,
	shiftsCsvName,
	shiftsNeeds,
} from "../support.js";

export const SALES_CHART_SHIFTS = 40;
const MONEY_DIGITS = 2;

export interface ShiftSlot {
	readonly number: number;
	readonly shifts: number;
	readonly meanNet: number;
}

function meanNet(rows: readonly ShiftRow[]): number | null {
	return ratio(
		sumMoney(rows.map((row) => row.sales_amount)),
		rows.length,
		MONEY_DIGITS,
	);
}

export function shiftSlots(
	rows: readonly ShiftRow[],
	labeller: ShiftLabeller,
): ShiftSlot[] {
	return [...groupRows(rows, (row) => String(labeller.numberOf(row)))]
		.map(([number, members]) => ({
			number: Number(number),
			shifts: members.length,
			meanNet: meanNet(members) ?? 0,
		}))
		.sort((left, right) => left.number - right.number);
}

function storePosition(context: ThemeContext, row: ShiftRow): number {
	const index = context.stores.findIndex((store) => store.id === row.store_id);
	return index < 0 ? context.stores.length : index;
}

function openedMillis(row: ShiftRow): number {
	const millis = Date.parse(row.opened_at);
	return Number.isNaN(millis) ? Number.POSITIVE_INFINITY : millis;
}

function byOpening(left: ShiftRow, right: ShiftRow): number {
	const difference = openedMillis(left) - openedMillis(right);
	return Number.isNaN(difference) ? 0 : difference;
}

export function chronological(
	context: ThemeContext,
	rows: readonly ShiftRow[],
	labeller: ShiftLabeller,
): ShiftRow[] {
	return [...rows].sort(
		(left, right) =>
			left.business_date.localeCompare(right.business_date) ||
			byOpening(left, right) ||
			storePosition(context, left) - storePosition(context, right) ||
			labeller.numberOf(left) - labeller.numberOf(right),
	);
}

export function newestFirst(
	context: ThemeContext,
	rows: readonly ShiftRow[],
	labeller: ShiftLabeller,
): ShiftRow[] {
	return [...rows].sort(
		(left, right) =>
			right.business_date.localeCompare(left.business_date) ||
			byOpening(right, left) ||
			storePosition(context, left) - storePosition(context, right) ||
			labeller.numberOf(right) - labeller.numberOf(left),
	);
}

function mainPart(
	context: ThemeContext,
	rows: readonly ShiftRow[],
	slots: readonly ShiftSlot[],
	mean: number,
): SentencePart {
	const range = rangeValue(context);
	const value = numberValue("money", mean);
	const best = slots.reduce<ShiftSlot | null>(
		(kept, slot) =>
			kept === null || slot.meanNet > kept.meanNet ? slot : kept,
		null,
	);
	const worst = slots.reduce<ShiftSlot | null>(
		(kept, slot) =>
			kept === null || slot.meanNet < kept.meanNet ? slot : kept,
		null,
	);
	if (
		slots.length < 2 ||
		best === null ||
		worst === null ||
		best.number === worst.number
	) {
		return part(shiftsKeys.sales.average, {
			range,
			value,
			count: numberValue("count", rows.length),
		});
	}
	return part(shiftsKeys.sales.main, {
		range,
		value,
		best: shiftNumberValue(best.number),
		bestValue: numberValue("money", best.meanNet),
		bestCount: numberValue("count", best.shifts),
		worst: shiftNumberValue(worst.number),
		worstValue: numberValue("money", worst.meanNet),
		worstCount: numberValue("count", worst.shifts),
	});
}

function chartOf(
	context: ThemeContext,
	rows: readonly ShiftRow[],
	labeller: ShiftLabeller,
): ChartModel | null {
	const shown = chronological(context, rows, labeller).slice(
		-SALES_CHART_SHIFTS,
	);
	if (shown.length === 0) return null;
	return {
		labelKey: shiftsKeys.sales.chart,
		categories: shown.map((row) => shiftOnLabel(row, labeller)),
		series: [
			{
				label: part(shiftsKeys.sales.series),
				kind: "bar",
				tone: "primary",
				axis: "left",
				stack: null,
				values: shown.map((row) => row.sales_amount),
			},
		],
		leftUnit: "money",
		rightUnit: null,
		markLines: [],
		markAreas: [],
	};
}

export function buildShiftSalesCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const rows = reviewRows(input.results);
	const labeller = shiftLabeller(context, rows);
	const mean = meanNet(rows);
	const slots = shiftSlots(rows, labeller);
	const timeZoneOf = (row: ShiftRow) =>
		context.stores.find((store) => store.id === row.store_id)?.timeZone ??
		"UTC";
	const columns: TableColumnModel[] = [
		...(labeller.multiStore ? [STORE_COLUMN] : []),
		column("date", reportKeys.table.date, "date"),
		column("shift", reportKeys.table.shift, "shift"),
		column("cashier", reportKeys.table.cashier, "label"),
		column("openedAt", reportKeys.table.openedAt, "text"),
		column("closedAt", reportKeys.table.closedAt, "text"),
		column("orders", reportKeys.table.invoices, "count"),
		column("net", reportKeys.table.netAmount, "money"),
	];
	const notice: NoticeModel | null =
		rows.length === 0
			? { tone: "info", part: part(shiftsKeys.noShifts), action: null }
			: null;
	return {
		id: "shift_sales",
		titleKey: shiftsKeys.sales.title,
		subtitle: null,
		metricId: "shift_net",
		relatedMetricIds: [],
		headline: {
			value: mean,
			unit: "money",
			caption:
				rows.length === 0
					? null
					: part(shiftsKeys.sales.caption, {
							count: numberValue("count", rows.length),
						}),
		},
		comparisons: [],
		decomposition: null,
		narrative: [
			mean === null
				? part(shiftsKeys.noData, { range: rangeValue(context) })
				: mainPart(context, rows, slots, mean),
		],
		tables: [
			tableModel({
				captionKey: shiftsKeys.sales.table,
				columns,
				rows: newestFirst(context, rows, labeller).map((row) => ({
					id: row.shift_id,
					cells: {
						store: labeller.storeName(row),
						date: row.business_date,
						shift: labeller.numberOf(row),
						cashier: cashierCell(row.cashier_name),
						openedAt: wallClock(row.opened_at, timeZoneOf(row)),
						closedAt: wallClock(row.closed_at, timeZoneOf(row)),
						orders: row.orders,
						net: row.sales_amount,
					},
				})),
				previewRows: DRAWER_PREVIEW_ROWS,
			}),
		],
		chart: chartOf(context, rows, labeller),
		notice,
		markers: themeMarkers(input, true),
		csvName: shiftsCsvName(context, "shift_sales"),
	};
}

export const shiftSalesCard: ThemeCardDefinition = {
	id: "shift_sales",
	needs: shiftsNeeds.sales,
	visible: () => true,
	build: buildShiftSalesCard,
};
