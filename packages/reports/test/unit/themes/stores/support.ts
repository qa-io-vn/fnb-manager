import type { IsoDate } from "../../../../src/contract/values.js";
import { addDays } from "../../../../src/period/dates.js";
import type { ThemeContext } from "../../../../src/themes/context.js";
import type { NamedPreset } from "../../../../src/themes/range.js";
import { coverageRow } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import { type SeriesRow, seriesRow } from "../revenue/support.js";

export { productivityRow } from "../hours/support.js";
export { cardInput, sales, totalsRow } from "../revenue/support.js";
export { coverageRow, type SeriesRow, seriesRow };

export const STORE_C = "44444444-4444-4444-8444-444444444444";

export function storeIds(count: number): string[] {
	return Array.from(
		{ length: count },
		(_, index) =>
			`${String(index + 1).padStart(8, "0")}-0000-4000-8000-000000000000`,
	);
}

export function storesContext(
	ids: readonly string[],
	preset: NamedPreset = "28d",
): ThemeContext {
	return themeContext(preset, ids);
}

export function storeDays(
	storeId: string,
	from: IsoDate,
	nets: readonly (number | null)[],
): SeriesRow[] {
	return nets.map((net, index) =>
		seriesRow(addDays(from, index), {
			store_id: storeId,
			net_amount: net,
			days_with_data: net === null ? 0 : 1,
			invoices: net === null ? 0 : 100,
		}),
	);
}

export function storeWeeks(
	storeId: string,
	monday: IsoDate,
	weeks: readonly { readonly net: number; readonly days: number }[],
): SeriesRow[] {
	return weeks.map((week, index) => {
		const start = addDays(monday, 7 * index);
		return seriesRow(start, {
			store_id: storeId,
			bucket_end: addDays(start, 6),
			calendar_days: 7,
			days_with_data: week.days,
			net_amount: week.net,
		});
	});
}

export function sinceDays(
	from: IsoDate,
	days: number,
	net: (offset: number) => number | null,
	overrides: (offset: number) => Partial<SeriesRow> = () => ({}),
): SeriesRow[] {
	return Array.from({ length: days }, (_, offset) => {
		const value = net(offset);
		return seriesRow(addDays(from, offset), {
			net_amount: value,
			days_with_data: value === null ? 0 : 1,
			...overrides(offset),
		});
	});
}

export const STORE_D = "55555555-5555-4555-8555-555555555555";
