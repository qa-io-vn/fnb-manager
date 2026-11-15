import type {
	CardModel,
	ChartModel,
	NoticeModel,
	TableColumnModel,
} from "../../../model/card.js";
import { reportKeys, shiftReasonsKey } from "../../../model/keys.js";
import {
	cashierCell,
	cashierShownValue,
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
const DRAWER_PREVIEW_ROWS = 10;

interface Labeller {
	readonly numberOf: (row: ShiftRow) => number;
	readonly storeName: (row: ShiftRow) => string | null;
	readonly multiStore: boolean;
}

function shiftLabel(row: ShiftRow, labeller: Labeller): TypedValue {
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

function settingsOf(input: ThemeCardInput): SettingsRow | null {
	const rows = input.results.rows(paymentsCalls.settings, "report_settings_of");
	const first = input.context.stores[0]?.id;
	return rows?.find((row) => row.store_id === first) ?? rows?.[0] ?? null;
}

function thresholdsPart(settings: SettingsRow | null): SentencePart | null {
	if (settings === null) return null;
	return part(paymentsKeys.drawer.thresholds, {
		abs: numberValue("money", settings.cash_abs_threshold),
		rel: numberValue("percent", settings.cash_rel_threshold),
		z: numberValue("decimal", settings.z_threshold),
	});
}

function mainPart(
	rows: readonly ShiftRow[],
	flagged: readonly ShiftRow[],
	labeller: Labeller,
	days: number,
): SentencePart {
	if (rows.length === 0) {
		return part(paymentsKeys.drawer.noData, {
			days: numberValue("count", days),
		});
	}
	const largest = flagged[0];
	if (largest === undefined || largest.variance_amount === null) {
		return part(reportKeys.shifts.none, {
			count: numberValue("count", rows.length),
		});
	}
	return part(reportKeys.shifts.largest, {
		count: numberValue("count", flagged.length),
		shift: shiftLabel(largest, labeller),
		cashier: cashierShownValue(largest.cashier_name),
		variance: numberValue("moneySigned", largest.variance_amount),
		reasons: messageValue(
			shiftReasonsKey(largest.reasons) ?? reportKeys.shiftReasons.absolute,
		),
	});
}

function chartOf(
	rows: readonly ShiftRow[],
	labeller: Labeller,
): ChartModel | null {
	const shown = rows
		.filter((row) => row.variance_amount !== null)
		.slice(0, DRAWER_CHART_SHIFTS);
	if (shown.length === 0) return null;
	return {
		labelKey: paymentsKeys.drawer.chart,
		categories: shown.map((row) => shiftLabel(row, labeller)),
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

export function buildDrawerCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const window = shiftWindow(context);
	const rows = byVariance(
		input.results.rows(paymentsCalls.shifts, "shift_review") ?? [],
	);
	const flagged = rows.filter((row) => row.flagged);
	const numbers = shiftNumbers(rows);
	const multiStore = isMultiStore(context);
	const storeName = (row: ShiftRow) =>
		context.stores.find((store) => store.id === row.store_id)?.name ?? null;
	const labeller: Labeller = {
		numberOf: (row) => numbers.get(row.shift_id) ?? 0,
		storeName,
		multiStore,
	};
	const thresholds = thresholdsPart(settingsOf(input));
	const columns: TableColumnModel[] = [
		...(multiStore ? [STORE_COLUMN] : []),
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
		tables: [
			tableModel({
				captionKey: paymentsKeys.drawer.table,
				columns,
				rows: rows.map((row) => ({
					id: row.shift_id,
					cells: {
						store: storeName(row),
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
			}),
		],
		chart: chartOf(rows, labeller),
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
