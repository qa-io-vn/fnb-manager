import type {
	CardModel,
	ChartModel,
	Comparison,
	TableColumnModel,
	TableModel,
} from "../../../model/card.js";
import { comparison } from "../../../model/comparison.js";
import { reportKeys } from "../../../model/keys.js";
import { ratio } from "../../../model/numeric.js";
import { shiftNumberValue, storeAndLabelValue } from "../../../model/shifts.js";
import { column, STORE_COLUMN, tableModel } from "../../../model/tables.js";
import { isMultiStore } from "../../../model/totals.js";
import {
	messageValue,
	numberValue,
	part,
	type SentencePart,
	type TypedValue,
} from "../../../model/values.js";
import type { ThemeContext } from "../../context.js";
import {
	referenceLabel,
	type ThemeCardDefinition,
	type ThemeCardInput,
} from "../../definition.js";
import { themeKeys } from "../../keys.js";
import { spanValue, themeMarkers } from "../../support.js";
import { shiftsKeys } from "../keys.js";
import {
	type MemberShareRow,
	memberShareRows,
	memberShareWindows,
	shiftsCalls,
	shiftsCsvName,
	shiftsNeeds,
} from "../support.js";

export const MEMBER_SHARE_ID = "member_share";
export const MEMBER_SHARE_METRIC = "member_invoice_share";
export const MEMBER_SHARE_PREVIEW_ROWS = 10;
const SHARE_DIGITS = 6;

export interface MemberTotals {
	readonly invoices: number;
	readonly members: number;
	readonly share: number | null;
}

export interface MemberSlot {
	readonly storeId: string | null;
	readonly position: number;
	readonly ordinal: number | null;
	readonly invoices: number;
	readonly members: number;
	readonly share: number | null;
}

export function memberTotals(rows: readonly MemberShareRow[]): MemberTotals {
	let invoices = 0;
	let members = 0;
	for (const row of rows) {
		invoices += row.invoices;
		members += row.member_invoices;
	}
	return {
		invoices,
		members,
		share: invoices > 0 ? ratio(members, invoices, SHARE_DIGITS) : null,
	};
}

function storePosition(
	context: Pick<ThemeContext, "stores">,
	storeId: string | null,
): number {
	const index = context.stores.findIndex((store) => store.id === storeId);
	return index < 0 ? context.stores.length : index;
}

function ordinalOrder(ordinal: number | null): number {
	return ordinal ?? Number.MAX_SAFE_INTEGER;
}

export function memberSlots(
	context: Pick<ThemeContext, "stores">,
	rows: readonly MemberShareRow[],
): MemberSlot[] {
	const slots = new Map<
		string,
		{ storeId: string | null; ordinal: number | null; rows: MemberShareRow[] }
	>();
	for (const row of rows) {
		const key = `${row.store_id ?? ""}|${row.shift_ordinal ?? ""}`;
		const known = slots.get(key);
		if (known === undefined) {
			slots.set(key, {
				storeId: row.store_id,
				ordinal: row.shift_ordinal,
				rows: [row],
			});
		} else {
			known.rows.push(row);
		}
	}
	return [...slots.values()]
		.map((slot) => {
			const totals = memberTotals(slot.rows);
			return {
				storeId: slot.storeId,
				position: storePosition(context, slot.storeId),
				ordinal: slot.ordinal,
				invoices: totals.invoices,
				members: totals.members,
				share: totals.share,
			};
		})
		.sort(
			(left, right) =>
				left.position - right.position ||
				ordinalOrder(left.ordinal) - ordinalOrder(right.ordinal),
		);
}

export function lowestShift(slots: readonly MemberSlot[]): MemberSlot | null {
	const measured = slots.filter(
		(slot) => slot.ordinal !== null && slot.share !== null,
	);
	if (measured.length < 2) return null;
	return measured.reduce((kept, slot) =>
		(slot.share ?? 0) < (kept.share ?? 0) ? slot : kept,
	);
}

function highestShare(slots: readonly MemberSlot[]): number | null {
	const shares = slots
		.filter((slot) => slot.ordinal !== null && slot.share !== null)
		.map((slot) => slot.share ?? 0);
	return shares.length === 0 ? null : Math.max(...shares);
}

function storeName(
	context: Pick<ThemeContext, "stores">,
	storeId: string | null,
): string {
	return (
		context.stores.find((store) => store.id === storeId)?.name ?? storeId ?? ""
	);
}

function shiftLabel(ordinal: number | null): TypedValue {
	return ordinal === null
		? messageValue(shiftsKeys.memberShare.unknownShift)
		: shiftNumberValue(ordinal);
}

function slotLabel(
	context: Pick<ThemeContext, "stores">,
	slot: Pick<MemberSlot, "storeId" | "ordinal">,
): TypedValue {
	const label = shiftLabel(slot.ordinal);
	return isMultiStore(context)
		? storeAndLabelValue(storeName(context, slot.storeId), label)
		: label;
}

function narrative(
	context: ThemeContext,
	rows: readonly MemberShareRow[],
	totals: MemberTotals,
): SentencePart[] {
	const range = spanValue(memberShareWindows(context).current);
	if (totals.invoices === 0) {
		return [part(shiftsKeys.memberShare.noInvoices, { range })];
	}
	if (totals.members === 0) {
		return [
			part(shiftsKeys.memberShare.none, {
				range,
				invoices: numberValue("count", totals.invoices),
			}),
		];
	}
	const parts: SentencePart[] = [
		part(shiftsKeys.memberShare.main, {
			range,
			share: numberValue("percent", totals.share ?? 0),
			members: numberValue("count", totals.members),
			invoices: numberValue("count", totals.invoices),
		}),
	];
	const slots = memberSlots(context, rows);
	const lowest = lowestShift(slots);
	if (lowest !== null) {
		parts.push(
			lowest.share === highestShare(slots)
				? part(shiftsKeys.memberShare.even, {
						share: numberValue("percent", lowest.share ?? 0),
					})
				: part(shiftsKeys.memberShare.lowest, {
						shift: slotLabel(context, lowest),
						share: numberValue("percent", lowest.share ?? 0),
						members: numberValue("count", lowest.members),
						invoices: numberValue("count", lowest.invoices),
					}),
		);
	}
	const unknown = rows
		.filter((row) => row.shift_ordinal === null)
		.reduce((sum, row) => sum + row.invoices, 0);
	if (unknown > 0) {
		parts.push(
			part(shiftsKeys.memberShare.unknown, {
				count: numberValue("count", unknown),
			}),
		);
	}
	return parts;
}

function shareComparison(
	context: ThemeContext,
	current: number | null,
	previousRows: readonly MemberShareRow[],
): Comparison {
	const windows = memberShareWindows(context);
	return comparison({
		kind: "previous",
		label: windows.clipped
			? part(themeKeys.compare.previousDays, {
					days: numberValue("count", windows.current.days),
				})
			: referenceLabel(context.range, "previous"),
		range: windows.previous,
		current,
		reference: memberTotals(previousRows).share,
		coveredStores: context.stores.length,
		totalStores: context.stores.length,
		unit: "fraction",
	});
}

function chartOf(
	context: ThemeContext,
	slots: readonly MemberSlot[],
): ChartModel | null {
	const shown = slots.filter((slot) => slot.invoices > 0);
	if (shown.length === 0) return null;
	return {
		labelKey: shiftsKeys.memberShare.chart,
		categories: shown.map((slot) => slotLabel(context, slot)),
		series: [
			{
				label: part(shiftsKeys.memberShare.series),
				kind: "bar",
				tone: "primary",
				axis: "left",
				stack: null,
				values: shown.map((slot) => slot.share),
			},
		],
		leftUnit: "fraction",
		rightUnit: null,
		markLines: [],
		markAreas: [],
		zeroBased: true,
	};
}

export function newestShiftsFirst(
	context: Pick<ThemeContext, "stores">,
	rows: readonly MemberShareRow[],
): MemberShareRow[] {
	return [...rows].sort(
		(left, right) =>
			right.business_date.localeCompare(left.business_date) ||
			storePosition(context, left.store_id) -
				storePosition(context, right.store_id) ||
			ordinalOrder(left.shift_ordinal) - ordinalOrder(right.shift_ordinal),
	);
}

function tableOf(
	context: ThemeContext,
	rows: readonly MemberShareRow[],
): TableModel {
	const multiStore = isMultiStore(context);
	const columns: TableColumnModel[] = [
		...(multiStore ? [STORE_COLUMN] : []),
		column("date", reportKeys.table.date, "date"),
		column("shift", reportKeys.table.shift, "shift"),
		column("invoices", reportKeys.table.invoices, "count"),
		column("memberInvoices", shiftsKeys.memberShare.memberInvoices, "count"),
		column("share", shiftsKeys.memberShare.share, "percent"),
	];
	return tableModel({
		captionKey: shiftsKeys.memberShare.table,
		columns,
		rows: newestShiftsFirst(context, rows).map((row) => ({
			id: `${row.store_id ?? ""}|${row.business_date}|${row.shift_ordinal ?? "none"}`,
			cells: {
				store: storeName(context, row.store_id),
				date: row.business_date,
				shift: row.shift_ordinal ?? shiftsKeys.memberShare.unknownShift,
				invoices: row.invoices,
				memberInvoices: row.member_invoices,
				share: row.member_share,
			},
		})),
		previewRows: MEMBER_SHARE_PREVIEW_ROWS,
	});
}

export function buildMemberShareCard(input: ThemeCardInput): CardModel {
	const { context } = input;
	const windows = memberShareWindows(context);
	const rows = memberShareRows(input.results);
	const previous = memberShareRows(
		input.results,
		shiftsCalls.memberSharePrevious,
	);
	const totals = memberTotals(rows);
	return {
		id: MEMBER_SHARE_ID,
		titleKey: shiftsKeys.memberShare.title,
		subtitle: windows.clipped
			? part(themeKeys.subtitle.lastDays, {
					days: numberValue("count", windows.current.days),
				})
			: null,
		metricId: MEMBER_SHARE_METRIC,
		relatedMetricIds: [],
		headline: {
			value: totals.share,
			unit: "fraction",
			caption:
				totals.invoices === 0
					? null
					: part(shiftsKeys.memberShare.caption, {
							members: numberValue("count", totals.members),
							invoices: numberValue("count", totals.invoices),
						}),
		},
		comparisons:
			totals.share === null
				? []
				: [shareComparison(context, totals.share, previous)],
		decomposition: null,
		narrative: narrative(context, rows, totals),
		tables: rows.length === 0 ? [] : [tableOf(context, rows)],
		chart:
			totals.members === 0
				? null
				: chartOf(context, memberSlots(context, rows)),
		notice: null,
		markers: themeMarkers(input, false),
		csvName: shiftsCsvName(context, MEMBER_SHARE_ID),
	};
}

export const memberShareCard: ThemeCardDefinition = {
	id: MEMBER_SHARE_ID,
	needs: shiftsNeeds.memberShare,
	visible: () => true,
	build: buildMemberShareCard,
};
