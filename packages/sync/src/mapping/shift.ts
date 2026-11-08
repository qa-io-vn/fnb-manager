import type { CanonicalShift } from "@fnb/core";
import { toJson } from "../json.js";
import { formatMoney, formatOptionalMoney } from "../numeric.js";
import type { ShiftRow } from "../rows.js";
import { isoOrNull, text, textOrNull } from "./text.js";

export interface ShiftMappingContext {
	tenantId: string;
	storeId: string;
	cashByShift: ReadonlyMap<string, number>;
}

export function mapShift(
	shift: CanonicalShift,
	context: ShiftMappingContext,
): ShiftRow {
	const cash = context.cashByShift.get(shift.externalId) ?? 0;
	return {
		tenant_id: context.tenantId,
		store_id: context.storeId,
		external_id: text(shift.externalId),
		name: textOrNull(shift.name),
		cashier_external_id: textOrNull(shift.cashierExternalId),
		cashier_name: textOrNull(shift.cashierName),
		opened_at: shift.openedAt.toISOString(),
		closed_at: isoOrNull(shift.closedAt),
		sales_amount: formatMoney(shift.salesAmount),
		orders_count: shift.ordersCount,
		cash_drawer_amount: formatOptionalMoney(shift.cashDrawerAmount),
		opening_float_amount: formatOptionalMoney(shift.openingFloatAmount),
		expected_cash_amount:
			shift.openingFloatAmount === undefined
				? null
				: formatMoney(shift.openingFloatAmount + cash),
		changed_after_close: shift.changedAfterClose,
		status: textOrNull(shift.status),
		device_code: textOrNull(shift.deviceCode),
		raw: toJson(shift.raw),
	};
}
