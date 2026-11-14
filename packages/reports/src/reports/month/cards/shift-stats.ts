import type { AnalyticsRow } from "../../../contract/functions.js";
import type { CardDefinition, CardInput } from "../../../definition.js";
import type {
	CardModel,
	Comparison,
	NoticeModel,
	TableColumnModel,
} from "../../../model/card.js";
import {
	comparison,
	likeForLikeLabel,
	noCoverageReason,
} from "../../../model/comparison.js";
import { groupRows } from "../../../model/grouping.js";
import { previousLabelKey, reportKeys } from "../../../model/keys.js";
import { sumMoney } from "../../../model/money.js";
import { ratio } from "../../../model/numeric.js";
import {
	cashierShownValue,
	shiftNumbers,
	shiftNumberValue,
	shownCashier,
	storeAndLabelValue,
} from "../../../model/shifts.js";
import { column, STORE_COLUMN, tableModel } from "../../../model/tables.js";
import {
	numberValue,
	part,
	type SentencePart,
	type TypedValue,
	textValue,
} from "../../../model/values.js";
import { monthKeys } from "../keys.js";
import {
	isMultiStore,
	monthCalls,
	monthCsvName,
	monthMarkers,
	monthNeeds,
	monthRanges,
	monthValue,
	storeName,
} from "../support.js";

type ShiftRow = AnalyticsRow<"shift_review">;

const MONEY_DIGITS = 2;

export interface ShiftTotals {
	readonly shifts: number;
	readonly flagged: number;
	readonly totalVariance: number;
	readonly meanVariance: number | null;
	readonly largestShortage: number | null;
	readonly largestOverage: number | null;
}

export interface ShiftGroup extends ShiftTotals {
	readonly id: string;
	readonly storeId: string | null;
	readonly cashier: string | null;
	readonly shift: number | null;
}

export function shiftTotals(members: readonly ShiftRow[]): ShiftTotals {
	const variances = members
		.map((row) => row.variance_amount)
		.filter((value): value is number => value !== null);
	const totalVariance = sumMoney(variances.map((value) => Math.abs(value)));
	const shortages = variances.filter((value) => value < 0);
	const overages = variances.filter((value) => value > 0);
	return {
		shifts: members.length,
		flagged: members.filter((row) => row.flagged).length,
		totalVariance,
		meanVariance: ratio(totalVariance, variances.length, MONEY_DIGITS),
		largestShortage: shortages.length === 0 ? null : Math.min(...shortages),
		largestOverage: overages.length === 0 ? null : Math.max(...overages),
	};
}

function byFlags(left: ShiftTotals, right: ShiftTotals): number {
	return (
		right.flagged - left.flagged ||
		right.totalVariance - left.totalVariance ||
		right.shifts - left.shifts
	);
}

export function shiftGroups(
	rows: readonly ShiftRow[],
	options: { readonly byStore: boolean; readonly bySlot: boolean },
): ShiftGroup[] {
	const numbers = shiftNumbers(rows);
	const slotOf = (row: ShiftRow) => numbers.get(row.shift_id) ?? null;
	const groups = groupRows(rows, (row) =>
		JSON.stringify([
			options.byStore ? row.store_id : null,
			shownCashier(row.cashier_name),
			options.bySlot ? slotOf(row) : null,
		]),
	);
	return [...groups.entries()]
		.map(([id, members]) => {
			const first = members[0] as ShiftRow;
			return {
				id,
				storeId: options.byStore ? first.store_id : null,
				cashier: shownCashier(first.cashier_name),
				shift: options.bySlot ? slotOf(first) : null,
				...shiftTotals(members),
			};
		})
		.sort(byFlags);
}

function mostFlagged(
	rows: readonly ShiftRow[],
	key: (row: ShiftRow) => string,
): { readonly row: ShiftRow; readonly flagged: number } | null {
	let best: {
		readonly row: ShiftRow;
		readonly totals: ShiftTotals;
	} | null = null;
	for (const members of groupRows(rows, key).values()) {
		const totals = shiftTotals(members);
		if (best === null || byFlags(totals, best.totals) < 0) {
			best = { row: members[0] as ShiftRow, totals };
		}
	}
	return best === null ? null : { row: best.row, flagged: best.totals.flagged };
}

function flaggedComparison(
	input: CardInput,
	rows: readonly ShiftRow[],
	previous: readonly ShiftRow[],
): Comparison {
	const ranges = monthRanges(input.context);
	const coverage = input.coverage.forReference(ranges.previousStart);
	const label = part(previousLabelKey("month"));
	const range = { from: ranges.previousStart, to: ranges.previousEnd };
	const flaggedIn = (entries: readonly ShiftRow[]) =>
		entries.length === 0 ? null : entries.filter((row) => row.flagged).length;
	if (coverage.state === "none") {
		return comparison({
			kind: "previous",
			label,
			range,
			current: flaggedIn(rows),
			reference: null,
			coveredStores: 0,
			totalStores: coverage.storeCount,
			unavailable: noCoverageReason(
				input.coverage,
				coverage.youngStoreIds,
				ranges.previousStart,
			),
		});
	}
	const partial = coverage.state === "partial";
	const covered = new Set(coverage.coveredStoreIds);
	const keep = (entries: readonly ShiftRow[]) =>
		partial
			? entries.filter(
					(row) => row.store_id !== null && covered.has(row.store_id),
				)
			: entries;
	return comparison({
		kind: "previous",
		label: partial ? likeForLikeLabel(label, coverage) : label,
		range,
		current: flaggedIn(keep(rows)),
		reference: flaggedIn(keep(previous)),
		basis: partial ? "like_for_like" : "all_stores",
		coveredStores: coverage.coveredStoreIds.length,
		totalStores: coverage.storeCount,
	});
}

function narrativeOf(
	input: CardInput,
	rows: readonly ShiftRow[],
	flagged: number,
): SentencePart[] {
	const month = monthValue(input.context);
	if (rows.length === 0) return [part(monthKeys.shifts.noData, { month })];
	if (flagged === 0) {
		return [
			part(monthKeys.shifts.none, {
				month,
				count: numberValue("count", rows.length),
			}),
		];
	}
	const numbers = shiftNumbers(rows);
	const slotOf = (row: ShiftRow) => numbers.get(row.shift_id) ?? 0;
	const cashier = mostFlagged(
		rows,
		(row) => shownCashier(row.cashier_name) ?? "",
	);
	const slot = mostFlagged(rows, (row) => String(slotOf(row)));
	return [
		part(monthKeys.shifts.main, {
			month,
			count: numberValue("count", flagged),
			total: numberValue("count", rows.length),
			cashier: cashierShownValue(cashier?.row.cashier_name ?? null),
			cashierFlags: numberValue("count", cashier?.flagged ?? 0),
			shift:
				slot === null
					? textValue("text", "")
					: shiftNumberValue(slotOf(slot.row)),
			shiftFlags: numberValue("count", slot?.flagged ?? 0),
		}),
	];
}

export function buildShiftStatsCard(input: CardInput): CardModel {
	const { context } = input;
	const rows = input.results.rows(monthCalls.shifts, "shift_review") ?? [];
	const previous =
		input.results.rows(monthCalls.shiftsPrevious, "shift_review") ?? [];
	const flagged = rows.filter((row) => row.flagged).length;
	const multiStore = isMultiStore(context);
	const slots = shiftGroups(rows, { byStore: multiStore, bySlot: true });
	const cashiers = shiftGroups(rows, { byStore: multiStore, bySlot: false });
	const columns: TableColumnModel[] = [
		...(multiStore ? [STORE_COLUMN] : []),
		column("cashier", reportKeys.table.cashier, "label"),
		column("shift", reportKeys.table.shift, "shift"),
		column("shifts", monthKeys.table.shifts, "count"),
		column("flagged", monthKeys.table.flagged, "count"),
		column("totalVariance", monthKeys.table.totalVariance, "money"),
		column("meanVariance", monthKeys.table.meanVariance, "money"),
		column("largestShortage", monthKeys.table.largestShortage, "money"),
		column("largestOverage", monthKeys.table.largestOverage, "money"),
	];
	const cashierCategory = (group: ShiftGroup): TypedValue =>
		multiStore
			? storeAndLabelValue(
					storeName(context, group.storeId),
					cashierShownValue(group.cashier),
				)
			: cashierShownValue(group.cashier);
	const notice: NoticeModel | null =
		rows.length === 0
			? { tone: "info", part: part(monthKeys.shifts.noShifts), action: null }
			: null;
	return {
		id: "shift_stats",
		titleKey: monthKeys.shifts.title,
		subtitle: null,
		metricId: "flagged_shifts",
		relatedMetricIds: ["cash_variance", "cash_variance_zscore"],
		headline: {
			value: rows.length === 0 ? null : flagged,
			unit: "count",
			caption:
				rows.length === 0
					? null
					: part(monthKeys.shifts.caption, {
							count: numberValue("count", rows.length),
						}),
		},
		comparisons: [flaggedComparison(input, rows, previous)],
		decomposition: null,
		narrative: narrativeOf(input, rows, flagged),
		tables: [
			tableModel({
				captionKey: monthKeys.shifts.table,
				columns,
				rows: slots.map((group) => ({
					id: group.id,
					cells: {
						store: storeName(context, group.storeId),
						cashier: group.cashier ?? reportKeys.label.unknownCashier,
						shift: group.shift,
						shifts: group.shifts,
						flagged: group.flagged,
						totalVariance: group.totalVariance,
						meanVariance: group.meanVariance,
						largestShortage: group.largestShortage,
						largestOverage: group.largestOverage,
					},
				})),
				initialSort: { key: "flagged", direction: "descending" },
			}),
		],
		chart:
			cashiers.length === 0
				? null
				: {
						labelKey: monthKeys.shifts.chart,
						categories: cashiers.map(cashierCategory),
						series: [
							{
								label: part(monthKeys.shifts.flaggedSeries),
								kind: "bar",
								tone: "negative",
								axis: "left",
								stack: null,
								values: cashiers.map((group) => group.flagged),
							},
						],
						leftUnit: "count",
						rightUnit: null,
						markLines: [],
						markAreas: [],
					},
		notice,
		markers: monthMarkers(input, true),
		csvName: monthCsvName(context, "shift_stats"),
	};
}

export const shiftStatsCard: CardDefinition = {
	id: "shift_stats",
	needs: monthNeeds.shifts,
	visible: () => true,
	build: buildShiftStatsCard,
};
