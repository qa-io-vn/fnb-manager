import type {
	CardModel,
	ChartModel,
	NoticeModel,
	TableColumnModel,
	TableModel,
} from "../../../model/card.js";
import { reportKeys, shiftReasonsKey } from "../../../model/keys.js";
import {
	cashierCell,
	cashierShownValue,
	type NumberedShift,
	shiftNumbers,
	shiftNumberValue,
} from "../../../model/shifts.js";
import { column, STORE_COLUMN, tableModel } from "../../../model/tables.js";
import { isMultiStore } from "../../../model/totals.js";
import {
	messageValue,
	numberValue,
	part,
	partValue,
	type SentencePart,
	type TypedValue,
	textValue,
} from "../../../model/values.js";
import { byVariance } from "../../../reports/day/cards/shifts.js";
import type { ThemeContext } from "../../context.js";
import type { ThemeCardDefinition, ThemeCardInput } from "../../definition.js";
import { themeKeys } from "../../keys.js";
import { themeMarkers } from "../../support.js";
import { paymentsKeys } from "../keys.js";
import {
	paymentsCalls,
	paymentsCsvName,
	paymentsNeeds,
	type SettingsRow,
	type ShiftRow,
	shiftWindow,
} from "../support.js";

export const DRAWER_CHART_SHIFTS = 20;
export const DRAWER_PREVIEW_ROWS = 10;

export type LabelledShift = Pick<
	NumberedShift,
	"shift_id" | "store_id" | "business_date"
>;

export interface ShiftLabeller {
	readonly numberOf: (row: LabelledShift) => number;
	readonly storeName: (row: LabelledShift) => string | null;
	readonly multiStore: boolean;
}

export function shiftLabeller(
	context: Pick<ThemeContext, "stores">,
	rows: readonly NumberedShift[],
): ShiftLabeller {
	const numbers = shiftNumbers(rows);
	return {
		numberOf: (row) => numbers.get(row.shift_id) ?? 0,
		storeName: (row) =>
			context.stores.find((store) => store.id === row.store_id)?.name ?? null,
		multiStore: isMultiStore(context),
	};
}

export function shiftOnLabel(
	row: LabelledShift,
	labeller: ShiftLabeller,
): TypedValue {
	const values = {
		shift: shiftNumberValue(labeller.numberOf(row)),
		date: textValue("date", row.business_date),
	};
	const store = labeller.storeName(row);
	return partValue(
		labeller.multiStore && store !== null
			? part(paymentsKeys.drawer.shiftOnAt, {
					...values,
					store: textValue("text", store),
				})
			: part(paymentsKeys.drawer.shiftOn, values),
	);
}

export function drawerSettings(
	input: ThemeCardInput,
	key: string,
): SettingsRow | null {
	const rows = input.results.rows(key, "report_settings_of");
	const first = input.context.stores[0]?.id;
	return rows?.find((row) => row.store_id === first) ?? rows?.[0] ?? null;
}

export function drawerThresholdsPart(
	settings: SettingsRow | null,
): SentencePart | null {
	if (settings === null) return null;
	return part(paymentsKeys.drawer.thresholds, {
		abs: numberValue("moneyExact", settings.cash_abs_threshold),
		rel: numberValue("percentExact", settings.cash_rel_threshold),
		z: numberValue("decimal", settings.z_threshold),
	});
}

export function drawerFlaggedPart(
	rows: readonly ShiftRow[],
	flagged: readonly ShiftRow[],
	labeller: ShiftLabeller,
): SentencePart {
	const largest = flagged[0];
	if (largest === undefined || largest.variance_amount === null) {
		return part(reportKeys.shifts.none, {
			count: numberValue("count", rows.length),
		});
	}
	return part(reportKeys.shifts.largest, {
		count: numberValue("count", flagged.length),
		shift: shiftOnLabel(largest, labeller),
		cashier: cashierShownValue(largest.cashier_name),
		variance: numberValue("moneySigned", largest.variance_amount),
		reasons: messageValue(
			shiftReasonsKey(largest.reasons) ?? reportKeys.shiftReasons.absolute,
		),
	});
}

export function drawerChart(
	rows: readonly ShiftRow[],
	labeller: ShiftLabeller,
): ChartModel | null {
	const shown = rows
		.filter((row) => row.variance_amount !== null)
		.slice(0, DRAWER_CHART_SHIFTS);
	if (shown.length === 0) return null;
	return {
		labelKey: paymentsKeys.drawer.chart,
		categories: shown.map((row) => shiftOnLabel(row, labeller)),
		series: [
			{
				label: part(reportKeys.shifts.over),
				kind: "bar",
				tone: "positive",
				axis: "left",
				stack: "variance",
				values: shown.map((row) =>
					(row.variance_amount ?? 0) >= 0 ? row.variance_amount : null,
				),
			},
			{
				label: part(reportKeys.shifts.short),
				kind: "bar",
				tone: "negative",
				axis: "left",
				stack: "variance",
				values: shown.map((row) =>
					(row.variance_amount ?? 0) < 0 ? row.variance_amount : null,
				),
			},
		],
		leftUnit: "money",
		rightUnit: null,
		markLines: [],
		markAreas: [],
	};
}

export function drawerTable(
	rows: readonly ShiftRow[],
	labeller: ShiftLabeller,
): TableModel {
	const columns: TableColumnModel[] = [
		...(labeller.multiStore ? [STORE_COLUMN] : []),
		column("date", reportKeys.table.date, "date"),
		column("shift", reportKeys.table.shift, "shift"),
		column("cashier", reportKeys.table.cashier, "label"),
		column("cashSales", reportKeys.table.cashSales, "money"),
		column("expectedCash", reportKeys.table.expectedCash, "money"),
		column("drawer", reportKeys.table.drawer, "money"),
		column("variance", reportKeys.table.variance, "money"),
		column("zScore", reportKeys.table.zScore, "decimal"),
		column("reasons", reportKeys.table.reasons, "message"),
	];
	return tableModel({
		captionKey: paymentsKeys.drawer.table,
		columns,
		rows: rows.map((row) => ({
			id: row.shift_id,
			cells: {
				store: labeller.storeName(row),
				date: row.business_date,
				shift: labeller.numberOf(row),
				cashier: cashierCell(row.cashier_name),
				cashSales: row.cash_sales_amount,
				expectedCash: row.expected_cash_amount,
				drawer: row.drawer_amount,
				variance: row.variance_amount,
				zScore: row.z_score,
				reasons: shiftReasonsKey(row.reasons),
			},
		})),
		previewRows: DRAWER_PREVIEW_ROWS,
	});
}

function mainPart(
	rows: readonly ShiftRow[],
	flagged: readonly ShiftRow[],
	labeller: ShiftLabeller,
	days: number,
): SentencePart {
	if (rows.length === 0) {
		return part(paymentsKeys.drawer.noData, {
			days: numberValue("count", days),
		});
	}
	return drawerFlaggedPart(rows, flagged, labeller);
}

export function buildDrawerCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const window = shiftWindow(context);
	const rows = byVariance(
		input.results.rows(paymentsCalls.shifts, "shift_review") ?? [],
	);
	const flagged = rows.filter((row) => row.flagged);
	const labeller = shiftLabeller(context, rows);
	const thresholds = drawerThresholdsPart(
		drawerSettings(input, paymentsCalls.settings),
	);
	const notice: NoticeModel | null =
		rows.length === 0
			? {
					tone: "info",
					part: part(paymentsKeys.drawer.noShifts),
					action: null,
				}
			: null;
	return {
		id: "drawer",
		titleKey: paymentsKeys.drawer.title,
		subtitle: part(themeKeys.subtitle.lastDays, {
			days: numberValue("count", window.days),
		}),
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
			mainPart(rows, flagged, labeller, window.days),
			...(thresholds === null ? [] : [thresholds]),
		],
		tables: [drawerTable(rows, labeller)],
		chart: drawerChart(rows, labeller),
		notice,
		markers: themeMarkers(input, true),
		csvName: paymentsCsvName(context, "drawer"),
	};
}

export const drawerCard: ThemeCardDefinition = {
	id: "drawer",
	needs: paymentsNeeds.drawer,
	visible: () => true,
	build: buildDrawerCard,
};
