import type { BusinessDateWindow } from "@fnb/connector-core";
import { windowInstants } from "@fnb/connector-core";
import {
	businessDate,
	type CanonicalDailyTotal,
	type CanonicalStore,
	ISO_DATE_PATTERN,
} from "@fnb/core";
import type { SaleDayRow } from "../schemas/sale-summary.js";
import { assertWholeHourDayStart, MINUTES_PER_HOUR } from "./options.js";

export interface DaysViewRange {
	startDate: number;
	endDate: number;
	storeOpenAt: number;
}

export function daysViewRange(
	window: BusinessDateWindow,
	store: Pick<CanonicalStore, "timezone" | "dayStartMinutes">,
): DaysViewRange {
	assertWholeHourDayStart(store.dayStartMinutes);
	const midnight = windowInstants(window, {
		timezone: store.timezone,
		dayStartMinutes: 0,
	});
	return {
		startDate: midnight.from.getTime(),
		endDate: midnight.to.getTime(),
		storeOpenAt: store.dayStartMinutes / MINUTES_PER_HOUR,
	};
}

export function dayRowBusinessDate(
	row: Pick<SaleDayRow, "date" | "tran_date">,
	timezone: string,
): string {
	const labelled = row.date?.trim();
	return labelled && ISO_DATE_PATTERN.test(labelled)
		? labelled
		: businessDate(new Date(row.tran_date), timezone, 0);
}

export function mapDayRow(
	row: SaleDayRow,
	store: Pick<CanonicalStore, "timezone">,
): CanonicalDailyTotal {
	return {
		businessDate: dayRowBusinessDate(row, store.timezone),
		invoiceCount: Math.max(0, Math.trunc(row.total_sales)),
		grossAmount: row.revenue_gross,
		discountAmount: row.discount_amount ?? undefined,
		voucherAmount: row.voucher_amount ?? undefined,
		netAmount: row.revenue_net,
		raw: row,
	};
}
