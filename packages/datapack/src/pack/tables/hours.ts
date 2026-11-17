import type { ThemeRow } from "@fnb/reports";
import { scopedKey } from "../calls.js";
import type { PackCell, PackColumn, PackTable } from "../schema.js";
import type { PackUnit } from "../units.js";
import { WEEKDAY_KEYS } from "./series.js";
import {
	type CellValue,
	type PackRows,
	packRow,
	packTable,
	type TableContext,
	type TableSpec,
} from "./support.js";

type HeatmapRow = ThemeRow<"hour_weekday_heatmap">;
type HourProfileRow = ThemeRow<"hour_profile">;

const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const THOUSAND = 1000;
const HOUR_GROUPS = ["all", "weekdays", "weekend"] as const;

export function hourColumnName(hour: number): string {
	return `h${String(hour).padStart(2, "0")}`;
}

export function dayStartHour(context: Pick<TableContext, "profiles">): number {
	const [first] = context.profiles;
	return first === undefined
		? 0
		: Math.floor(first.business_day_start_minutes / MINUTES_PER_HOUR) %
				HOURS_PER_DAY;
}

export function orderedHours(
	hours: Iterable<number>,
	startHour: number,
): number[] {
	const position = (hour: number) =>
		(hour - startHour + HOURS_PER_DAY) % HOURS_PER_DAY;
	return [...new Set(hours)]
		.filter(
			(hour) => Number.isInteger(hour) && hour >= 0 && hour < HOURS_PER_DAY,
		)
		.sort((left, right) => position(left) - position(right));
}

function hourColumns(hours: readonly number[], unit: PackUnit): PackColumn[] {
	return hours.map((hour) => ({ name: hourColumnName(hour), unit }));
}

function heatmapRowsOf(
	context: TableContext,
): ReadonlyMap<string, readonly HeatmapRow[]> {
	return new Map(
		context.scopes.map((scope) => [
			scope.label,
			context.results.rows(scopedKey("heatmap", scope), "hour_weekday_heatmap"),
		]),
	);
}

export function heatmapHours(context: TableContext): number[] {
	const hours: number[] = [];
	for (const rows of heatmapRowsOf(context).values()) {
		for (const row of rows) {
			if (row.invoices > 0 || row.net_amount !== 0) hours.push(row.hour_local);
		}
	}
	return orderedHours(hours, dayStartHour(context));
}

function heatmapTable(
	context: TableContext,
	id: "heatmap_net" | "heatmap_invoices",
	unit: PackUnit,
	cellOf: (row: HeatmapRow) => number | null,
): PackTable {
	const hours = heatmapHours(context);
	const spec: TableSpec = {
		grain: "weekday-hour",
		window: "w84",
		columns: hourColumns(hours, unit),
	};
	const rows: PackRows = {};
	for (const [scope, scopeRows] of heatmapRowsOf(context)) {
		WEEKDAY_KEYS.forEach((weekdayKey, index) => {
			const weekdayRows = scopeRows.filter((row) => row.weekday === index + 1);
			if (weekdayRows.length === 0) return;
			const values: CellValue[] = hours.map((hour) => {
				const row = weekdayRows.find((entry) => entry.hour_local === hour);
				return row === undefined ? 0 : cellOf(row);
			});
			rows[`${scope}/${weekdayKey}`] = packRow(
				spec,
				values,
				context.request.currency,
			);
		});
	}
	return packTable(id, context, spec, rows);
}

export function heatmapNetTable(context: TableContext): PackTable {
	return heatmapTable(context, "heatmap_net", "money_thousands", (row) =>
		row.avg_net_amount === null ? null : row.avg_net_amount / THOUSAND,
	);
}

export function heatmapInvoicesTable(context: TableContext): PackTable {
	return heatmapTable(
		context,
		"heatmap_invoices",
		"ratio",
		(row) => row.avg_invoices,
	);
}

export function hourLevelsTable(context: TableContext): PackTable {
	const profiles = new Map(
		context.scopes.map((scope) => [
			scope.label,
			context.results
				.rows(scopedKey("hours", scope), "hour_profile")
				.filter((row) =>
					(HOUR_GROUPS as readonly string[]).includes(row.scope),
				),
		]),
	);
	const hours = orderedHours(
		[...profiles.values()].flatMap((rows) =>
			rows.flatMap((row) => (row.hour_local === null ? [] : [row.hour_local])),
		),
		dayStartHour(context),
	);
	const spec: TableSpec = {
		grain: "weekday-hour",
		window: "w84",
		columns: [
			...hourColumns(hours, "class"),
			{ name: "peak_share", unit: "fraction" },
			{ name: "dead_share", unit: "fraction" },
		],
	};
	const rows: PackRows = {};
	for (const [scope, scopeRows] of profiles) {
		for (const group of HOUR_GROUPS) {
			const groupRows: readonly HourProfileRow[] = scopeRows.filter(
				(row) => row.scope === group,
			);
			if (groupRows.length === 0) continue;
			const summary = groupRows.find((row) => row.hour_local === null);
			const levels: PackCell[] = hours.map(
				(hour) =>
					groupRows.find((row) => row.hour_local === hour)?.level ?? null,
			);
			rows[`${scope}/${group}`] = packRow(
				spec,
				[...levels, summary?.peak_share, summary?.dead_share],
				context.request.currency,
			);
		}
	}
	return packTable("hour_levels", context, spec, rows);
}
