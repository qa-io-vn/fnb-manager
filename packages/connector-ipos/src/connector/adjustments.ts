import type { BusinessDateWindow } from "@fnb/connector-core";
import { isWithinWindow, windowInstants } from "@fnb/connector-core";
import {
	adjustmentKey,
	businessDate,
	type CanonicalAdjustment,
	type CanonicalStore,
	type DataQualityFlag,
	MILLISECONDS_PER_DAY,
	roundMoney,
} from "@fnb/core";
import {
	type ChangeLogLine,
	hasRemovedLineSuffix,
	isRemovedLine,
	knownEditDeleteStatus,
	type RemovedItemEvent,
	type SaleEditDeleteRow,
} from "../schemas/pos-cms.js";
import { type EpochMsRange, splitRangeByCalendarMonth } from "../time.js";
import { FLAG_CODES, flag } from "./flags.js";
import { text } from "./text.js";

export interface AdjustmentSources {
	editedOrDeleted: readonly SaleEditDeleteRow[];
	removedItemEvents: readonly RemovedItemEvent[];
}

export interface BuiltAdjustments {
	adjustments: CanonicalAdjustment[];
	flags: DataQualityFlag[];
}

export interface MappedAdjustments {
	adjustments: CanonicalAdjustment[];
	flags: DataQualityFlag[];
}

export const ADJUSTMENT_QUERY_PADDING_MS = MILLISECONDS_PER_DAY;

type StoreDay = Pick<CanonicalStore, "timezone" | "dayStartMinutes">;

export function adjustmentQueryRange(
	window: BusinessDateWindow,
	store: StoreDay,
): EpochMsRange {
	const instants = windowInstants(window, store);
	return {
		startDate: instants.from.getTime() - ADJUSTMENT_QUERY_PADDING_MS,
		endDate: instants.to.getTime() + ADJUSTMENT_QUERY_PADDING_MS,
	};
}

export function adjustmentQueryRanges(
	window: BusinessDateWindow,
	store: StoreDay,
): EpochMsRange[] {
	return splitRangeByCalendarMonth(
		adjustmentQueryRange(window, store),
		store.timezone,
	);
}

function voidedAdjustment(row: SaleEditDeleteRow): MappedAdjustments {
	const reason = text(row.sale_note);
	return {
		adjustments: [
			{
				kind: "voided",
				saleExternalId: row.tran_id,
				occurredAt: new Date(row.updated_at),
				amount: row.total_amount_origin,
				...(reason ? { reason } : {}),
				raw: row,
			},
		],
		flags: [],
	};
}

function editedAdjustment(row: SaleEditDeleteRow): MappedAdjustments {
	const reason = text(row.sale_note);
	const origin = text(row.origin_tran_id) ?? text(row.first_origin_tran_id);
	const flags =
		origin === undefined
			? [
					flag(
						FLAG_CODES.editWithoutOrigin,
						"the edited-invoice row names no origin invoice (origin_tran_id and first_origin_tran_id are empty)",
						"warn",
						row.tran_id,
					),
				]
			: [];
	return {
		adjustments: [
			{
				kind: "edited",
				saleExternalId: row.tran_id,
				...(origin ? { relatedSaleExternalId: origin } : {}),
				occurredAt: new Date(row.updated_at),
				amount: roundMoney(
					Math.abs(row.total_amount_origin - row.total_amount),
				),
				...(reason ? { reason } : {}),
				raw: row,
			},
		],
		flags,
	};
}

export function mapEditDeleteRow(row: SaleEditDeleteRow): MappedAdjustments {
	switch (knownEditDeleteStatus(row.status)) {
		case "DELETE":
			return voidedAdjustment(row);
		case "EDIT":
			return editedAdjustment(row);
		default:
			return {
				adjustments: [],
				flags: [
					flag(
						FLAG_CODES.unknownAdjustmentStatus,
						`the edited/cancelled invoice report returned status "${row.status}", which is neither DELETE nor EDIT; the row was dropped`,
						"warn",
						row.tran_id,
					),
				],
			};
	}
}

function removedLineAdjustment(
	event: RemovedItemEvent,
	line: ChangeLogLine,
): CanonicalAdjustment {
	const quantity = Math.abs(line.quantity);
	const itemId = text(line.item_id);
	const itemName = text(line.item_name);
	return {
		kind: "line_removed",
		saleExternalId: event.tran_id,
		lineExternalId: line.id_sale_detail,
		...(itemId ? { itemExternalId: itemId } : {}),
		...(itemName ? { itemName } : {}),
		quantity,
		occurredAt: new Date(event.log_date),
		amount: roundMoney(line.price * quantity),
		raw: { ...event, sale_detail: [line] },
	};
}

function unsuffixedRemovalFlag(
	event: RemovedItemEvent,
	line: ChangeLogLine,
): DataQualityFlag {
	return flag(
		FLAG_CODES.removedLineWithoutSuffix,
		`removed line ${line.id_sale_detail} has quantity ${line.quantity} and sort_index ${line.sort_index ?? "none"} but no _REMOVE suffix; it was still emitted as line_removed`,
		"info",
		event.tran_id,
	);
}

export function mapRemovedItemEvent(
	event: RemovedItemEvent,
): MappedAdjustments {
	const removedLines = (event.sale_detail ?? []).filter(isRemovedLine);
	return {
		adjustments: removedLines.map((line) => removedLineAdjustment(event, line)),
		flags: removedLines
			.filter((line) => !hasRemovedLineSuffix(line))
			.map((line) => unsuffixedRemovalFlag(event, line)),
	};
}

function dedupe(adjustments: readonly CanonicalAdjustment[]) {
	const seen = new Set<string>();
	return adjustments.filter((adjustment) => {
		const key = adjustmentKey(adjustment);
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
}

export function buildAdjustments(
	sources: AdjustmentSources,
	store: StoreDay,
	window: BusinessDateWindow,
): BuiltAdjustments {
	const mapped = [
		...sources.editedOrDeleted.map(mapEditDeleteRow),
		...sources.removedItemEvents.map(mapRemovedItemEvent),
	];
	const candidates = mapped.flatMap((entry) => entry.adjustments);
	const inWindow = candidates.filter((adjustment) =>
		isWithinWindow(
			businessDate(
				adjustment.occurredAt,
				store.timezone,
				store.dayStartMinutes,
			),
			window,
		),
	);
	const adjustments = dedupe(inWindow).sort(
		(left, right) =>
			left.occurredAt.getTime() - right.occurredAt.getTime() ||
			adjustmentKey(left).localeCompare(adjustmentKey(right)),
	);
	return { adjustments, flags: mapped.flatMap((entry) => entry.flags) };
}
