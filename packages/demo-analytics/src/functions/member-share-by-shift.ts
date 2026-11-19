import {
	addDays,
	MEMBER_SHARE_BY_SHIFT_MAX_DAYS,
	type ThemeRow,
} from "@fnb/reports";
import type { ShiftAggregate } from "../ingest.js";
import { PgDecimal } from "../pg-numeric.js";
import { byteOrder } from "../text-order.js";
import {
	requireThemeDateRange,
	requireThemeRows,
	requireThemeStoreIds,
	type ThemeHandler,
} from "./theme-support.js";

export const MEMBER_SHARE_DAYS_AROUND = 1;

type Row = ThemeRow<"member_share_by_shift">;

interface Counts {
	invoices: number;
	members: number;
	identified: number;
}

interface Placed {
	readonly position: number;
	readonly storeId: string;
	readonly businessDate: string;
	readonly ordinal: number | null;
	readonly openedAt: string | null;
	readonly closedAt: string | null;
	readonly counts: Counts;
}

function emptyCounts(): Counts {
	return { invoices: 0, members: 0, identified: 0 };
}

function share(part: number, whole: number): number | null {
	if (whole === 0) return null;
	return PgDecimal.integer(part)
		.div(PgDecimal.integer(whole))
		.round(6)
		.toNumber();
}

function byOpening(left: ShiftAggregate, right: ShiftAggregate): number {
	return (
		Date.parse(left.openedAt) - Date.parse(right.openedAt) ||
		byteOrder(left.shiftExternalId, right.shiftExternalId)
	);
}

function shiftKey(storeId: string, shiftExternalId: string): string {
	return `${storeId}\u0000${shiftExternalId}`;
}

export const memberShareByShift: ThemeHandler<"member_share_by_shift"> = (
	store,
	args,
) => {
	requireThemeStoreIds("member_share_by_shift", args.store_ids);
	requireThemeDateRange(
		"member_share_by_shift",
		args.from_date,
		args.to_date,
		MEMBER_SHARE_BY_SHIFT_MAX_DAYS,
	);
	const readFrom = addDays(args.from_date, -MEMBER_SHARE_DAYS_AROUND);
	const readTo = addDays(args.to_date, MEMBER_SHARE_DAYS_AROUND);
	const placed: Placed[] = [];
	for (const [position, definition] of store
		.visibleStores(args.store_ids)
		.entries()) {
		const days = store.daysOf(definition, readFrom, readTo);
		const shiftsByDate = new Map<string, ShiftAggregate[]>();
		const known = new Set<string>();
		for (const day of days) {
			for (const shift of day.shifts) {
				known.add(shiftKey(definition.id, shift.shiftExternalId));
				if (
					shift.businessDate < args.from_date ||
					shift.businessDate > args.to_date
				) {
					continue;
				}
				const members = shiftsByDate.get(shift.businessDate);
				if (members === undefined) {
					shiftsByDate.set(shift.businessDate, [shift]);
				} else {
					members.push(shift);
				}
			}
		}
		const byShift = new Map<string, Counts>();
		const unshifted = new Map<string, Counts>();
		for (const day of days) {
			for (const entry of day.shiftMembers) {
				const key =
					entry.shiftExternalId === null
						? null
						: shiftKey(definition.id, entry.shiftExternalId);
				let counts: Counts | undefined;
				if (key !== null && known.has(key)) {
					counts = byShift.get(key) ?? emptyCounts();
					byShift.set(key, counts);
				} else if (day.date >= args.from_date && day.date <= args.to_date) {
					counts = unshifted.get(day.date) ?? emptyCounts();
					unshifted.set(day.date, counts);
				}
				if (counts === undefined) continue;
				counts.invoices += entry.invoices;
				counts.members += entry.memberInvoices;
				counts.identified += entry.identifiedInvoices;
			}
		}
		for (const [businessDate, shifts] of shiftsByDate) {
			[...shifts].sort(byOpening).forEach((shift, index) => {
				placed.push({
					position,
					storeId: definition.id,
					businessDate,
					ordinal: index + 1,
					openedAt: shift.openedAt,
					closedAt: shift.closedAt,
					counts:
						byShift.get(shiftKey(definition.id, shift.shiftExternalId)) ??
						emptyCounts(),
				});
			});
		}
		for (const [businessDate, counts] of unshifted) {
			if (counts.invoices === 0) continue;
			placed.push({
				position,
				storeId: definition.id,
				businessDate,
				ordinal: null,
				openedAt: null,
				closedAt: null,
				counts,
			});
		}
	}
	requireThemeRows("member_share_by_shift", placed.length);
	return placed
		.sort(
			(left, right) =>
				byteOrder(left.businessDate, right.businessDate) ||
				left.position - right.position ||
				(left.ordinal ?? Number.POSITIVE_INFINITY) -
					(right.ordinal ?? Number.POSITIVE_INFINITY),
		)
		.map(
			(entry): Row => ({
				store_id: entry.storeId,
				business_date: entry.businessDate,
				shift_ordinal: entry.ordinal,
				opened_at: entry.openedAt,
				closed_at: entry.closedAt,
				invoices: entry.counts.invoices,
				member_invoices: entry.counts.members,
				identified_invoices: entry.counts.identified,
				member_share: share(entry.counts.members, entry.counts.invoices),
				identified_share: share(entry.counts.identified, entry.counts.invoices),
			}),
		);
};
