import type { AnalyticsRow } from "../../../contract/functions.js";
import type { CardDefinition, CardInput } from "../../../definition.js";
import type {
	CardModel,
	NoticeModel,
	TableColumnModel,
} from "../../../model/card.js";
import { reportKeys, shiftReasonsKey } from "../../../model/keys.js";
import { column, STORE_COLUMN, tableModel } from "../../../model/tables.js";
import {
	messageValue,
	numberValue,
	part,
	type SentencePart,
	type TypedValue,
	textValue,
} from "../../../model/values.js";
import { dayKeys } from "../keys.js";
import {
	dayCalls,
	dayCsvName,
	dayMarkers,
	dayNeeds,
	dayValue,
	isMultiStore,
} from "../support.js";

type ShiftRow = AnalyticsRow<"shift_review">;

const clockFormats = new Map<string, Intl.DateTimeFormat>();

export function wallClock(
	timestamp: string | null,
	timeZone: string,
): string | null {
	if (timestamp === null) return null;
	const instant = new Date(timestamp);
	if (Number.isNaN(instant.getTime())) return null;
	let format = clockFormats.get(timeZone);
	if (format === undefined) {
		format = new Intl.DateTimeFormat("en-GB", {
			timeZone,
			hour: "2-digit",
			minute: "2-digit",
			hourCycle: "h23",
		});
		clockFormats.set(timeZone, format);
	}
	return format.format(instant);
}

function magnitude(row: ShiftRow): number {
	return row.variance_amount === null ? -1 : Math.abs(row.variance_amount);
}

export function byVariance(rows: readonly ShiftRow[]): ShiftRow[] {
	return rows
		.map((row, index) => ({ row, index }))
		.sort(
			(left, right) =>
				magnitude(right.row) - magnitude(left.row) || left.index - right.index,
		)
		.map(({ row }) => row);
}

function shiftLabel(row: ShiftRow): string {
	return row.shift_name ?? row.shift_external_id;
}

function cashierValue(row: ShiftRow): TypedValue {
	return row.cashier_name === null
		? messageValue(reportKeys.label.unknownCashier)
		: textValue("text", row.cashier_name);
}

function narrativeOf(
	input: CardInput,
	rows: readonly ShiftRow[],
	flagged: readonly ShiftRow[],
): readonly SentencePart[] {
	const day = dayValue(input.context);
	if (rows.length === 0) return [part(dayKeys.shifts.noData, { day })];
	const largest = flagged[0];
	if (largest === undefined || largest.variance_amount === null) {
		return [
			part(dayKeys.shifts.none, {
				day,
				count: numberValue("count", rows.length),
			}),
		];
	}
	const reasons = shiftReasonsKey(largest.reasons);
	return [
		part(dayKeys.shifts.largest, {
			day,
			count: numberValue("count", flagged.length),
			shift: textValue("text", shiftLabel(largest)),
			cashier: cashierValue(largest),
			variance: numberValue("moneySigned", largest.variance_amount),
			reasons: messageValue(reasons ?? reportKeys.shiftReasons.absolute),
		}),
	];
}

export function buildShiftsCard(input: CardInput): CardModel {
	const { context } = input;
	const rows = byVariance(
		input.results.rows(dayCalls.shifts, "shift_review") ?? [],
	);
	const flagged = rows.filter((row) => row.flagged);
	const multiStore = isMultiStore(context);
	const storeOf = (storeId: string | null) =>
		context.stores.find((store) => store.id === storeId);
	const columns: TableColumnModel[] = [
		...(multiStore ? [STORE_COLUMN] : []),
		column("shift", reportKeys.table.shift, "text"),
		column("cashier", reportKeys.table.cashier, "text"),
		column("openedAt", reportKeys.table.openedAt, "text"),
		column("closedAt", reportKeys.table.closedAt, "text"),
		column("cashSales", reportKeys.table.cashSales, "money"),
		column("expectedCash", reportKeys.table.expectedCash, "money"),
		column("drawer", reportKeys.table.drawer, "money"),
		column("variance", reportKeys.table.variance, "money"),
		column("zScore", reportKeys.table.zScore, "decimal"),
		column("reasons", reportKeys.table.reasons, "message"),
	];
	const categoryOf = (row: ShiftRow) =>
		multiStore
			? `${storeOf(row.store_id)?.name ?? ""} · ${shiftLabel(row)}`
			: shiftLabel(row);
	const notice: NoticeModel | null =
		rows.length === 0
			? { tone: "info", part: part(dayKeys.shifts.noShifts), action: null }
			: null;
	return {
		id: "shifts",
		titleKey: dayKeys.shifts.title,
		subtitle: null,
		metricId: "flagged_shifts",
		relatedMetricIds: ["cash_variance", "cash_variance_zscore"],
		headline: {
			value: rows.length === 0 ? null : flagged.length,
			unit: "count",
			caption:
				rows.length === 0
					? null
					: part(dayKeys.shifts.caption, {
							count: numberValue("count", rows.length),
						}),
		},
		comparisons: [],
		decomposition: null,
		narrative: narrativeOf(input, rows, flagged),
		tables: [
			tableModel({
				captionKey: dayKeys.shifts.table,
				columns,
				rows: rows.map((row) => {
					const store = storeOf(row.store_id);
					const timeZone = store?.timeZone ?? "UTC";
					return {
						id: row.shift_id,
						cells: {
							store: store?.name ?? null,
							shift: shiftLabel(row),
							cashier: row.cashier_name,
							openedAt: wallClock(row.opened_at, timeZone),
							closedAt: wallClock(row.closed_at, timeZone),
							cashSales: row.cash_sales_amount,
							expectedCash: row.expected_cash_amount,
							drawer: row.drawer_amount,
							variance: row.variance_amount,
							zScore: row.z_score,
							reasons: shiftReasonsKey(row.reasons),
						},
					};
				}),
			}),
		],
		chart:
			rows.length === 0
				? null
				: {
						labelKey: dayKeys.shifts.chart,
						categories: rows.map((row) => textValue("text", categoryOf(row))),
						series: [
							{
								label: part(dayKeys.shifts.over),
								kind: "bar",
								tone: "positive",
								axis: "left",
								stack: "variance",
								values: rows.map((row) =>
									row.variance_amount !== null && row.variance_amount >= 0
										? row.variance_amount
										: null,
								),
							},
							{
								label: part(dayKeys.shifts.short),
								kind: "bar",
								tone: "negative",
								axis: "left",
								stack: "variance",
								values: rows.map((row) =>
									row.variance_amount !== null && row.variance_amount < 0
										? row.variance_amount
										: null,
								),
							},
						],
						leftUnit: "money",
						rightUnit: null,
						markLines: [],
						markAreas: [],
					},
		notice,
		markers: dayMarkers(input, true),
		csvName: dayCsvName(context, "shifts"),
	};
}

export const shiftsCard: CardDefinition = {
	id: "shifts",
	needs: dayNeeds.shifts,
	visible: () => true,
	build: buildShiftsCard,
};
