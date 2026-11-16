import type {
	CardModel,
	NoticeModel,
	TableColumnModel,
	TableModel,
} from "../../../model/card.js";
import { groupRows } from "../../../model/grouping.js";
import { reportKeys } from "../../../model/keys.js";
import { sumMoney } from "../../../model/money.js";
import {
	cashierCell,
	cashierShownValue,
	shownCashier,
	storeAndLabelValue,
} from "../../../model/shifts.js";
import { column, STORE_COLUMN, tableModel } from "../../../model/tables.js";
import { isMultiStore } from "../../../model/totals.js";
import {
	numberValue,
	part,
	type SentencePart,
	type TypedValue,
} from "../../../model/values.js";
import { shiftTotals } from "../../../reports/month/cards/shift-stats.js";
import type { ThemeContext } from "../../context.js";
import type { ThemeCardDefinition, ThemeCardInput } from "../../definition.js";
import { rangeValue, themeMarkers } from "../../support.js";
import { shiftsKeys } from "../keys.js";
import {
	type AdjustmentRow,
	adjustmentRows,
	reviewRows,
	type ShiftRow,
	shiftsCsvName,
	shiftsNeeds,
} from "../support.js";

export interface CashierShift {
	readonly shiftId: string;
	readonly storeId: string | null;
	readonly cashierName: string | null;
	readonly review: ShiftRow | null;
	readonly adjustment: AdjustmentRow | null;
}

export interface CashierGroup {
	readonly storeId: string | null;
	readonly cashier: string | null;
	readonly shifts: number;
	readonly net: number;
	readonly flagged: number;
	readonly totalVariance: number;
	readonly voids: number;
	readonly removedLines: number;
	readonly editsAfterClose: number;
}

export function cashierShifts(
	reviews: readonly ShiftRow[],
	adjustments: readonly AdjustmentRow[],
): CashierShift[] {
	const adjustmentOf = new Map(
		adjustments.map((row) => [row.shift_id, row] as const),
	);
	const reviewed = new Set(reviews.map((row) => row.shift_id));
	return [
		...reviews.map((review) => ({
			shiftId: review.shift_id,
			storeId: review.store_id,
			cashierName: review.cashier_name,
			review,
			adjustment: adjustmentOf.get(review.shift_id) ?? null,
		})),
		...adjustments
			.filter((adjustment) => !reviewed.has(adjustment.shift_id))
			.map((adjustment) => ({
				shiftId: adjustment.shift_id,
				storeId: adjustment.store_id,
				cashierName: adjustment.cashier_name,
				review: null,
				adjustment,
			})),
	];
}

function present<Row>(rows: readonly (Row | null)[]): Row[] {
	return rows.filter((row): row is Row => row !== null);
}

function countOf(
	rows: readonly AdjustmentRow[],
	value: (row: AdjustmentRow) => number,
): number {
	return rows.reduce((total, row) => total + value(row), 0);
}

function byFlags(left: CashierGroup, right: CashierGroup): number {
	return (
		right.flagged - left.flagged ||
		right.totalVariance - left.totalVariance ||
		right.shifts - left.shifts
	);
}

export function cashierGroups(
	shifts: readonly CashierShift[],
	byStore: boolean,
): CashierGroup[] {
	const groups = groupRows(shifts, (shift) =>
		JSON.stringify([
			byStore ? shift.storeId : null,
			shownCashier(shift.cashierName),
		]),
	);
	return [...groups.values()]
		.map((members) => {
			const first = members[0] as CashierShift;
			const reviews = present(members.map((member) => member.review));
			const adjustments = present(members.map((member) => member.adjustment));
			const totals = shiftTotals(reviews);
			return {
				storeId: byStore ? first.storeId : null,
				cashier: shownCashier(first.cashierName),
				shifts: members.length,
				net: sumMoney(reviews.map((row) => row.sales_amount)),
				flagged: totals.flagged,
				totalVariance: totals.totalVariance,
				voids: countOf(adjustments, (row) => row.voids),
				removedLines: countOf(adjustments, (row) => row.removed_lines),
				editsAfterClose: countOf(adjustments, (row) => row.edits_after_close),
			};
		})
		.sort(byFlags);
}

export type CashierView = "empty" | "sharedLogin" | "unnamed" | "ranked";

export const MIN_SHARED_LOGIN_SHIFTS = 2;

function loginKey(shift: CashierShift): string {
	return (shift.cashierName ?? "").trim().toLowerCase();
}

function distinctLogins(shifts: readonly CashierShift[]): number {
	return new Set(shifts.map(loginKey)).size;
}

export function sharesOneLoginPerStore(
	shifts: readonly CashierShift[],
): boolean {
	return [...groupRows(shifts, (shift) => shift.storeId ?? "").values()].every(
		(members) => distinctLogins(members) <= 1,
	);
}

export function cashierView(shifts: readonly CashierShift[]): CashierView {
	if (shifts.length === 0) return "empty";
	if (
		shifts.length >= MIN_SHARED_LOGIN_SHIFTS &&
		sharesOneLoginPerStore(shifts)
	) {
		return "sharedLogin";
	}
	if (shifts.every((shift) => shownCashier(shift.cashierName) === null)) {
		return "unnamed";
	}
	return "ranked";
}

function storeNameOf(
	context: ThemeContext,
	storeId: string | null,
): string | null {
	return context.stores.find((store) => store.id === storeId)?.name ?? null;
}

function cashierValue(
	context: ThemeContext,
	group: CashierGroup,
	multiStore: boolean,
): TypedValue {
	const shown = cashierShownValue(group.cashier);
	const store = storeNameOf(context, group.storeId);
	return multiStore && store !== null
		? storeAndLabelValue(store, shown)
		: shown;
}

export function namedGroups(groups: readonly CashierGroup[]): CashierGroup[] {
	return groups.filter((group) => group.cashier !== null);
}

export function namedCashierCount(groups: readonly CashierGroup[]): number {
	return new Set(namedGroups(groups).map((group) => group.cashier)).size;
}

function leadingPart(
	context: ThemeContext,
	named: readonly CashierGroup[],
	cashiers: number,
	multiStore: boolean,
): SentencePart {
	const top = named[0] as CashierGroup;
	if (top.flagged === 0) {
		return part(shiftsKeys.cashiers.none, {
			range: rangeValue(context),
			count: numberValue("count", cashiers),
		});
	}
	const leaders = named.filter((group) => group.flagged === top.flagged);
	if (leaders.length > 1) {
		return part(shiftsKeys.cashiers.tied, {
			flagged: numberValue("count", top.flagged),
		});
	}
	return part(shiftsKeys.cashiers.main, {
		cashier: cashierValue(context, top, multiStore),
		flagged: numberValue("count", top.flagged),
		shifts: numberValue("count", top.shifts),
	});
}

function rankingParts(
	context: ThemeContext,
	groups: readonly CashierGroup[],
	multiStore: boolean,
): SentencePart[] {
	const unnamedShifts = groups
		.filter((group) => group.cashier === null)
		.reduce((total, group) => total + group.shifts, 0);
	return [
		leadingPart(
			context,
			namedGroups(groups),
			namedCashierCount(groups),
			multiStore,
		),
		...(unnamedShifts === 0
			? []
			: [
					part(shiftsKeys.cashiers.unnamed, {
						count: numberValue("count", unnamedShifts),
					}),
				]),
		part(shiftsKeys.cashiers.caution),
	];
}

function cashierTable(
	context: ThemeContext,
	groups: readonly CashierGroup[],
	multiStore: boolean,
): TableModel {
	const columns: TableColumnModel[] = [
		...(multiStore ? [STORE_COLUMN] : []),
		column("cashier", reportKeys.table.cashier, "label"),
		column("shifts", shiftsKeys.table.shifts, "count"),
		column("net", reportKeys.table.netAmount, "money"),
		column("flagged", shiftsKeys.table.flagged, "count"),
		column("totalVariance", shiftsKeys.table.totalVariance, "money"),
		column("voids", shiftsKeys.table.voids, "count"),
		column("removedLines", shiftsKeys.table.removedLines, "count"),
		column("editsAfterClose", shiftsKeys.table.editsAfterClose, "count"),
	];
	return tableModel({
		captionKey: shiftsKeys.cashiers.table,
		columns,
		rows: groups.map((group, index) => ({
			id: `cashier-${index + 1}`,
			cells: {
				store: storeNameOf(context, group.storeId),
				cashier: cashierCell(group.cashier),
				shifts: group.shifts,
				net: group.net,
				flagged: group.flagged,
				totalVariance: group.totalVariance,
				voids: group.voids,
				removedLines: group.removedLines,
				editsAfterClose: group.editsAfterClose,
			},
		})),
		initialSort: { key: "flagged", direction: "descending" },
	});
}

function infoNotice(key: string): NoticeModel {
	return { tone: "info", part: part(key), action: null };
}

function noticeOf(view: CashierView): NoticeModel | null {
	switch (view) {
		case "empty":
			return infoNotice(shiftsKeys.noShifts);
		case "sharedLogin":
			return infoNotice(shiftsKeys.cashiers.logins);
		case "unnamed":
			return infoNotice(shiftsKeys.cashiers.displayNames);
		case "ranked":
			return null;
	}
}

function narrativeOf(
	context: ThemeContext,
	view: CashierView,
	shifts: readonly CashierShift[],
	groups: readonly CashierGroup[],
	multiStore: boolean,
): SentencePart[] {
	const values = {
		range: rangeValue(context),
		count: numberValue("count", shifts.length),
	};
	switch (view) {
		case "empty":
			return [part(shiftsKeys.noData, { range: values.range })];
		case "sharedLogin":
			return [
				part(
					distinctLogins(shifts) > 1
						? shiftsKeys.cashiers.singlePerStore
						: shiftsKeys.cashiers.single,
					values,
				),
			];
		case "unnamed":
			return [part(shiftsKeys.cashiers.unnamedAll, values)];
		case "ranked":
			return rankingParts(context, groups, multiStore);
	}
}

export function buildCashiersCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const shifts = cashierShifts(
		reviewRows(input.results),
		adjustmentRows(input.results),
	);
	const multiStore = isMultiStore(context);
	const view = cashierView(shifts);
	const groups = view === "ranked" ? cashierGroups(shifts, multiStore) : [];
	const leader = namedGroups(groups)[0];
	return {
		id: "cashiers",
		titleKey: shiftsKeys.cashiers.title,
		subtitle: null,
		metricId: "flagged_shifts",
		relatedMetricIds: [
			"shift_net",
			"cash_variance",
			"cash_variance_zscore",
			"shift_void_rate",
			"removed_line_rate",
			"edits_after_close",
		],
		headline: {
			value: leader === undefined ? null : leader.flagged,
			unit: "count",
			caption:
				leader === undefined
					? null
					: part(shiftsKeys.cashiers.caption, {
							count: numberValue("count", namedCashierCount(groups)),
						}),
		},
		comparisons: [],
		decomposition: null,
		narrative: narrativeOf(context, view, shifts, groups, multiStore),
		tables: [cashierTable(context, groups, multiStore)],
		chart: null,
		notice: noticeOf(view),
		markers: themeMarkers(input, true),
		csvName: shiftsCsvName(context, "cashiers"),
	};
}

export const cashiersCard: ThemeCardDefinition = {
	id: "cashiers",
	needs: shiftsNeeds.cashiers,
	visible: () => true,
	build: buildCashiersCard,
};
