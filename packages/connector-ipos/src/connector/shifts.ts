import type { CanonicalShift } from "@fnb/core";
import type { Shift } from "../schemas/reports.js";
import { text } from "./text.js";

export function hasNoStore(row: Shift): boolean {
	return text(row.store_uid) === undefined;
}

export function belongsToStore(row: Shift, storeUid: string): boolean {
	return text(row.store_uid) === storeUid;
}

export function mapShift(row: Shift): CanonicalShift {
	const closedAt =
		row.end_date === null || row.end_date === undefined
			? undefined
			: new Date(row.end_date);
	return {
		externalId: row.shift_id,
		name: text(row.shift_name),
		cashierExternalId: text(row.user_uid),
		cashierName: text(row.user_name),
		openedAt: new Date(row.start_date),
		...(closedAt ? { closedAt } : {}),
		salesAmount: row.amount,
		ordersCount: Math.max(0, Math.trunc(row.number_order ?? 0)),
		cashDrawerAmount: row.cash_drawer_total ?? undefined,
		openingFloatAmount: row.balance ?? undefined,
		changedAfterClose: (row.change_after_close ?? 0) > 0,
		status: text(row.status),
		deviceCode: text(row.device_code),
		raw: row,
	};
}
