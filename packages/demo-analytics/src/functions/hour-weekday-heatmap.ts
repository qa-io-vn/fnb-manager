import { isoWeekday, type ThemeRow } from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import { count, money, roundedRatio } from "../pg-numeric.js";
import { hourlySales } from "./support.js";
import type { ThemeHandlerArgs, ThemeHandlerContext } from "./theme-support.js";

type Row = ThemeRow<"hour_weekday_heatmap">;

interface CellSums {
	invoices: number;
	netMinor: number;
}

export function hourWeekdayHeatmap(
	store: AggregateStore,
	args: ThemeHandlerArgs<"hour_weekday_heatmap">,
	_context: ThemeHandlerContext,
): Row[] {
	const cells = new Map<string, CellSums & { weekday: number; hour: number }>();
	const datesByWeekday = new Map<number, Set<string>>();
	for (const row of hourlySales(
		store,
		args.store_ids,
		args.from_date,
		args.to_date,
	)) {
		const weekday = isoWeekday(row.date);
		const key = `${weekday}|${row.hourly.hour}`;
		const cell = cells.get(key) ?? {
			weekday,
			hour: row.hourly.hour,
			invoices: 0,
			netMinor: 0,
		};
		cell.invoices += row.hourly.invoices;
		cell.netMinor += row.hourly.netMinor;
		cells.set(key, cell);
		const dates = datesByWeekday.get(weekday) ?? new Set<string>();
		dates.add(row.date);
		datesByWeekday.set(weekday, dates);
	}
	return [...cells.values()]
		.sort(
			(left, right) => left.weekday - right.weekday || left.hour - right.hour,
		)
		.map((cell) => {
			const days = datesByWeekday.get(cell.weekday)?.size ?? 0;
			return {
				weekday: cell.weekday,
				hour_local: cell.hour,
				days_with_data: days,
				invoices: cell.invoices,
				net_amount: money(cell.netMinor).toNumber(),
				avg_net_amount: roundedRatio(money(cell.netMinor), count(days), 2),
				avg_invoices: roundedRatio(count(cell.invoices), count(days), 4),
			};
		});
}
