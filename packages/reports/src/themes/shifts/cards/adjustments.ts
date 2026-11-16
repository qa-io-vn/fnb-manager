import type {
	CardModel,
	ChartModel,
	NoticeModel,
	TableColumnModel,
} from "../../../model/card.js";
import { reportKeys } from "../../../model/keys.js";
import { cashierCell, cashierShownValue } from "../../../model/shifts.js";
import { column, STORE_COLUMN, tableModel } from "../../../model/tables.js";
import {
	messageValue,
	numberValue,
	part,
	type SentencePart,
} from "../../../model/values.js";
import type { ThemeCardDefinition, ThemeCardInput } from "../../definition.js";
import {
	DRAWER_PREVIEW_ROWS,
	drawerSettings,
	type ShiftLabeller,
	shiftLabeller,
	shiftOnLabel,
} from "../../payments/cards/drawer.js";
import { paymentsKeys } from "../../payments/keys.js";
import { Z_THRESHOLD } from "../../settings.js";
import { rangeValue, themeMarkers } from "../../support.js";
import { adjustmentReasonsKey, shiftsKeys } from "../keys.js";
import {
	type AdjustmentRow,
	adjustmentRows,
	shiftsCalls,
	shiftsCsvName,
	shiftsNeeds,
} from "../support.js";

export const ADJUSTMENTS_CHART_SHIFTS = 20;
export const MIN_EARLIER_SHIFTS = 3;
export const TRAILING_DAYS = 56;

export function largerZ(row: AdjustmentRow): number | null {
	const scores = [row.void_z_score, row.removed_z_score].filter(
		(score): score is number => score !== null,
	);
	return scores.length === 0 ? null : Math.max(...scores);
}

function zRank(row: AdjustmentRow): number {
	return largerZ(row) ?? Number.NEGATIVE_INFINITY;
}

export function byAdjustmentRank(
	rows: readonly AdjustmentRow[],
): AdjustmentRow[] {
	return rows
		.map((row, index) => ({ row, index }))
		.sort((left, right) => {
			const scores = zRank(right.row) - zRank(left.row);
			return (
				(Number.isNaN(scores) ? 0 : scores) ||
				right.row.edits_after_close - left.row.edits_after_close ||
				left.index - right.index
			);
		})
		.map(({ row }) => row);
}

export function isScored(row: AdjustmentRow): boolean {
	return row.void_z_score !== null || row.removed_z_score !== null;
}

export function isFullyScored(row: AdjustmentRow): boolean {
	return row.void_z_score !== null && row.removed_z_score !== null;
}

const RATE_REASONS: readonly string[] = ["voids", "removed_lines"];

export function isFlaggedForRates(row: AdjustmentRow): boolean {
	return (
		row.flagged &&
		(row.reasons ?? []).some((reason) => RATE_REASONS.includes(reason))
	);
}

function mainPart(
	rows: readonly AdjustmentRow[],
	flagged: readonly AdjustmentRow[],
	labeller: ShiftLabeller,
): SentencePart {
	const top = flagged[0];
	if (top === undefined) {
		const measured = rows.filter(isScored).length;
		return measured === 0
			? part(shiftsKeys.adjustments.unmeasured, {
					count: numberValue("count", rows.length),
				})
			: part(shiftsKeys.adjustments.none, {
					measured: numberValue("count", measured),
					count: numberValue("count", rows.length),
				});
	}
	return part(shiftsKeys.adjustments.main, {
		count: numberValue("count", flagged.length),
		shift: shiftOnLabel(top, labeller),
		cashier: cashierShownValue(top.cashier_name),
		reasons: messageValue(
			adjustmentReasonsKey(top.reasons) ?? shiftsKeys.reasons.after_close,
		),
	});
}

function noticeOf(rows: readonly AdjustmentRow[]): NoticeModel | null {
	if (rows.length === 0) {
		return { tone: "info", part: part(shiftsKeys.noShifts), action: null };
	}
	if (rows.some((row) => !isFullyScored(row))) {
		return {
			tone: "info",
			part: part(shiftsKeys.adjustments.unscored, {
				count: numberValue("count", MIN_EARLIER_SHIFTS),
			}),
			action: null,
		};
	}
	return null;
}

function chartOf(
	ranked: readonly AdjustmentRow[],
	labeller: ShiftLabeller,
	threshold: number,
): ChartModel | null {
	const shown = ranked
		.filter((row) => isFlaggedForRates(row) && largerZ(row) !== null)
		.slice(0, ADJUSTMENTS_CHART_SHIFTS);
	if (shown.length === 0) return null;
	return {
		labelKey: shiftsKeys.adjustments.chart,
		categories: shown.map((row) => shiftOnLabel(row, labeller)),
		series: [
			{
				label: part(shiftsKeys.adjustments.series),
				kind: "bar",
				tone: "negative",
				axis: "left",
				stack: null,
				values: shown.map(largerZ),
			},
		],
		leftUnit: "decimal",
		rightUnit: null,
		markLines: [
			{
				label: part(shiftsKeys.adjustments.threshold),
				value: threshold,
				axis: "left",
			},
		],
		markAreas: [],
	};
}

export function buildAdjustmentsCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const rows = byAdjustmentRank(adjustmentRows(input.results));
	const flagged = rows.filter((row) => row.flagged);
	const labeller = shiftLabeller(context, rows);
	const threshold =
		drawerSettings(input, shiftsCalls.settings)?.z_threshold ?? Z_THRESHOLD;
	const columns: TableColumnModel[] = [
		...(labeller.multiStore ? [STORE_COLUMN] : []),
		column("date", reportKeys.table.date, "date"),
		column("shift", reportKeys.table.shift, "shift"),
		column("cashier", reportKeys.table.cashier, "label"),
		column("orders", reportKeys.table.invoices, "count"),
		column("voids", shiftsKeys.table.voids, "count"),
		column("voidRate", shiftsKeys.table.voidRate, "percent"),
		column("voidZ", shiftsKeys.table.voidZ, "decimal"),
		column("removedLines", shiftsKeys.table.removedLines, "count"),
		column("removedRate", shiftsKeys.table.removedRate, "percent"),
		column("removedZ", shiftsKeys.table.removedZ, "decimal"),
		column("edits", shiftsKeys.table.edits, "count"),
		column("editsAfterClose", shiftsKeys.table.editsAfterClose, "count"),
		column("reasons", reportKeys.table.reasons, "message"),
	];
	return {
		id: "adjustments",
		titleKey: shiftsKeys.adjustments.title,
		subtitle: null,
		metricId: "shift_void_rate",
		relatedMetricIds: [
			"shift_void_rate_zscore",
			"removed_line_rate",
			"removed_line_rate_zscore",
			"edits_after_close",
			"edit_rate",
		],
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
		narrative:
			rows.length === 0
				? [part(shiftsKeys.noData, { range: rangeValue(context) })]
				: [
						mainPart(rows, flagged, labeller),
						part(shiftsKeys.adjustments.basis, {
							days: numberValue("count", TRAILING_DAYS),
						}),
					],
		tables: [
			tableModel({
				captionKey: shiftsKeys.adjustments.table,
				columns,
				rows: rows.map((row) => ({
					id: row.shift_id,
					cells: {
						store: labeller.storeName(row),
						date: row.business_date,
						shift: labeller.numberOf(row),
						cashier: cashierCell(row.cashier_name),
						orders: row.orders,
						voids: row.voids,
						voidRate: row.void_rate,
						voidZ: row.void_z_score,
						removedLines: row.removed_lines,
						removedRate: row.removed_line_rate,
						removedZ: row.removed_z_score,
						edits: row.edits,
						editsAfterClose: row.edits_after_close,
						reasons: adjustmentReasonsKey(row.reasons),
					},
				})),
				previewRows: DRAWER_PREVIEW_ROWS,
			}),
		],
		chart: chartOf(rows, labeller, threshold),
		notice: noticeOf(rows),
		markers: themeMarkers(input, true),
		csvName: shiftsCsvName(context, "adjustments"),
	};
}

export const adjustmentsCard: ThemeCardDefinition = {
	id: "adjustments",
	needs: shiftsNeeds.adjustments,
	visible: () => true,
	build: buildAdjustmentsCard,
};
