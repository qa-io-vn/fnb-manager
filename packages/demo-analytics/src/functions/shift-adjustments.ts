import { addDays, type ThemeRow, Z_THRESHOLD } from "@fnb/reports";
import type { DemoStoreDefinition } from "../calendar.js";
import type { AdjustmentEvent, ShiftAggregate } from "../ingest.js";
import { money, PgDecimal, stddevSample } from "../pg-numeric.js";
import { byteOrder } from "../text-order.js";
import {
	requireThemeDateRange,
	requireThemeRows,
	requireThemeStoreIds,
	type ThemeHandler,
} from "./theme-support.js";

export const SHIFT_ADJUSTMENTS_MAX_DAYS = 92;
export const SHIFT_ADJUSTMENTS_TRAILING_DAYS = 56;

const MIN_TRAILING_SHIFTS = 3;
const DAY_MS = 86_400_000;
const EVENT_DAYS_AROUND = 1;

type Row = ThemeRow<"shift_adjustments">;

interface Measured {
	readonly store: DemoStoreDefinition;
	readonly position: number;
	readonly shift: ShiftAggregate;
	readonly windowFrom: number;
	readonly windowTo: number;
	orders: number;
	lines: number;
	voids: number;
	voidMinor: number | null;
	edits: number;
	removed: number;
	removedMinor: number | null;
	afterClose: number;
	voidRate: PgDecimal | null;
	removedRate: PgDecimal | null;
}

function plus(known: number | null, amount: number | null): number | null {
	if (amount === null) return known;
	return (known ?? 0) + amount;
}

function decimalValue(value: PgDecimal | null): number | null {
	return value === null ? null : value.toNumber();
}

function count(measured: Measured, event: AdjustmentEvent): void {
	if (event.kind === "voided") {
		measured.voids += 1;
		measured.voidMinor = plus(measured.voidMinor, event.amountMinor);
	} else if (event.kind === "edited") {
		measured.edits += 1;
	} else if (event.kind === "line_removed") {
		measured.removed += 1;
		measured.removedMinor = plus(measured.removedMinor, event.amountMinor);
	}
}

function zScore(
	value: PgDecimal | null,
	trailing: readonly PgDecimal[],
): PgDecimal | null {
	if (value === null || trailing.length < MIN_TRAILING_SHIFTS) return null;
	const sd = stddevSample(trailing);
	const mean = PgDecimal.avg(trailing);
	if (sd === null || mean === null || sd.sign() <= 0) return null;
	return value.sub(mean).div(sd).round(4);
}

export const shiftAdjustments: ThemeHandler<"shift_adjustments"> = (
	store,
	args,
) => {
	requireThemeStoreIds("shift_adjustments", args.store_ids);
	requireThemeDateRange(
		"shift_adjustments",
		args.from_date,
		args.to_date,
		SHIFT_ADJUSTMENTS_MAX_DAYS,
	);
	const visible = store.visibleStores(args.store_ids);
	const trailingFrom = addDays(
		args.from_date,
		-SHIFT_ADJUSTMENTS_TRAILING_DAYS,
	);
	const readFrom = addDays(trailingFrom, -EVENT_DAYS_AROUND);
	const readTo = addDays(args.to_date, EVENT_DAYS_AROUND);
	const threshold = PgDecimal.parse(String(args.z_threshold ?? Z_THRESHOLD));

	const measured: Measured[] = [];
	const unattributed: { store: DemoStoreDefinition; event: AdjustmentEvent }[] =
		[];
	const byInvoice: {
		store: DemoStoreDefinition;
		shiftExternalId: string;
		event: AdjustmentEvent;
	}[] = [];
	const sales = new Map<string, { orders: number; lines: number }>();
	for (const [position, definition] of visible.entries()) {
		for (const day of store.daysOf(definition, readFrom, readTo)) {
			for (const shift of day.shifts) {
				if (
					shift.businessDate < trailingFrom ||
					shift.businessDate > args.to_date
				) {
					continue;
				}
				const opened = Date.parse(shift.openedAt);
				measured.push({
					store: definition,
					position,
					shift,
					windowFrom: opened,
					windowTo:
						shift.closedAt === null
							? opened + DAY_MS
							: Date.parse(shift.closedAt),
					orders: 0,
					lines: 0,
					voids: 0,
					voidMinor: null,
					edits: 0,
					removed: 0,
					removedMinor: null,
					afterClose: 0,
					voidRate: null,
					removedRate: null,
				});
			}
			for (const sold of day.shiftSales) {
				const key = `${definition.id}\u0000${sold.shiftExternalId}`;
				const known = sales.get(key) ?? { orders: 0, lines: 0 };
				known.orders += sold.orders;
				known.lines += sold.itemLines;
				sales.set(key, known);
			}
			for (const event of day.events) {
				if (event.saleExists && event.saleShiftExternalId !== null) {
					byInvoice.push({
						store: definition,
						shiftExternalId: event.saleShiftExternalId,
						event,
					});
				} else {
					unattributed.push({ store: definition, event });
				}
			}
		}
	}

	const inRange = measured.filter(
		(entry) => entry.shift.businessDate >= args.from_date,
	);
	requireThemeRows("shift_adjustments", inRange.length);

	const byShift = new Map(
		measured.map((entry) => [
			`${entry.store.id}\u0000${entry.shift.shiftExternalId}`,
			entry,
		]),
	);
	for (const entry of measured) {
		const sold = sales.get(
			`${entry.store.id}\u0000${entry.shift.shiftExternalId}`,
		);
		entry.orders = sold?.orders ?? 0;
		entry.lines = sold?.lines ?? 0;
	}
	for (const { store: definition, shiftExternalId, event } of byInvoice) {
		const entry = byShift.get(`${definition.id}\u0000${shiftExternalId}`);
		if (entry === undefined) continue;
		count(entry, event);
		if (
			entry.shift.closedAt !== null &&
			Date.parse(event.occurredAt) >= Date.parse(entry.shift.closedAt)
		) {
			entry.afterClose += 1;
		}
	}
	for (const { store: definition, event } of unattributed) {
		const at = Date.parse(event.occurredAt);
		let chosen: Measured | null = null;
		for (const entry of measured) {
			if (entry.store.id !== definition.id) continue;
			if (at < entry.windowFrom || at >= entry.windowTo) continue;
			if (chosen === null || entry.windowFrom > chosen.windowFrom) {
				chosen = entry;
			}
		}
		if (chosen !== null) count(chosen, event);
	}
	for (const entry of measured) {
		const attempts = entry.orders + entry.voids;
		entry.voidRate =
			attempts > 0
				? PgDecimal.integer(entry.voids).div(PgDecimal.integer(attempts))
				: null;
		entry.removedRate =
			entry.lines > 0
				? PgDecimal.integer(entry.removed).div(PgDecimal.integer(entry.lines))
				: null;
	}

	const rows = inRange
		.sort(
			(left, right) =>
				byteOrder(left.shift.businessDate, right.shift.businessDate) ||
				left.position - right.position ||
				left.windowFrom - right.windowFrom ||
				byteOrder(left.shift.shiftExternalId, right.shift.shiftExternalId),
		)
		.map((entry): Row => {
			const earlier = measured.filter(
				(other) =>
					other.store.id === entry.store.id &&
					other.shift.businessDate >=
						addDays(
							entry.shift.businessDate,
							-SHIFT_ADJUSTMENTS_TRAILING_DAYS,
						) &&
					other.shift.businessDate <= addDays(entry.shift.businessDate, -1),
			);
			const voidTrailing = earlier.flatMap((other) =>
				other.voidRate === null ? [] : [other.voidRate],
			);
			const removedTrailing = earlier.flatMap((other) =>
				other.removedRate === null ? [] : [other.removedRate],
			);
			const voidZ = zScore(entry.voidRate, voidTrailing);
			const removedZ = zScore(entry.removedRate, removedTrailing);
			const overVoids = voidZ !== null && voidZ.compare(threshold) > 0;
			const overRemoved = removedZ !== null && removedZ.compare(threshold) > 0;
			const reasons = [
				overVoids ? "voids" : null,
				overRemoved ? "removed_lines" : null,
				entry.afterClose > 0 ? "after_close" : null,
			].filter((reason): reason is string => reason !== null);
			return {
				store_id: entry.store.id,
				shift_id: entry.shift.shiftId,
				shift_external_id: entry.shift.shiftExternalId,
				shift_name: entry.shift.shiftName,
				business_date: entry.shift.businessDate,
				cashier_name: entry.shift.cashierName,
				opened_at: entry.shift.openedAt,
				closed_at: entry.shift.closedAt,
				orders: entry.orders,
				item_lines: entry.lines,
				voids: entry.voids,
				void_amount:
					entry.voids === 0
						? 0
						: entry.voidMinor === null
							? null
							: money(entry.voidMinor).toNumber(),
				edits: entry.edits,
				removed_lines: entry.removed,
				removed_amount:
					entry.removed === 0
						? 0
						: entry.removedMinor === null
							? null
							: money(entry.removedMinor).toNumber(),
				edits_after_close: entry.afterClose,
				changed_after_close: entry.shift.changedAfterClose,
				void_rate: decimalValue(entry.voidRate?.round(6) ?? null),
				removed_line_rate: decimalValue(entry.removedRate?.round(6) ?? null),
				trailing_shifts: voidTrailing.length,
				void_z_score: decimalValue(voidZ),
				removed_z_score: decimalValue(removedZ),
				flagged: overVoids || overRemoved || entry.afterClose > 0,
				reasons,
			};
		});
	requireThemeRows("shift_adjustments", rows.length);
	return rows;
};
