import { type AnalyticsRow, isoWeekKey, isoWeekOf } from "@fnb/reports";
import { CALL_KEYS } from "../calls.js";
import type { PackTable } from "../schema.js";
import {
	type CellValue,
	columns,
	type PackRows,
	packRow,
	packTable,
	ratioOf,
	scopeByLabel,
	storeScopeLabel,
	type TableContext,
	type TableSpec,
} from "./support.js";

type SeriesRow = AnalyticsRow<"period_series">;

export const WEEKDAY_KEYS = [
	"mon",
	"tue",
	"wed",
	"thu",
	"fri",
	"sat",
	"sun",
] as const;

const TOTAL_COLUMNS = [
	["net", "money"],
	["invoices", "count"],
	["avg_ticket", "money"],
	["store_days", "days"],
] as const;

export const WEEKLY_SPEC: TableSpec = {
	grain: "store-week",
	window: "weeks",
	columns: columns([...TOTAL_COLUMNS, ["holiday_days", "days"]]),
};

export const MONTHLY_SPEC: TableSpec = {
	grain: "store-month",
	window: "months",
	columns: columns([...TOTAL_COLUMNS, ["holiday_days", "days"]]),
};

export const WEEKDAY_SPEC: TableSpec = {
	grain: "store-weekday",
	window: "w84",
	columns: columns([...TOTAL_COLUMNS, ["share", "fraction"]]),
};

function totals(row: SeriesRow): CellValue[] {
	return [row.net_amount, row.invoices, row.avg_ticket, row.days_with_data];
}

export function scopeHistoryStart(
	context: TableContext,
	label: string,
): string | null {
	const starts = (scopeByLabel(context, label)?.storeIds ?? [])
		.map((id) => context.coverage.historyStart(id))
		.filter((start): start is string => start !== null)
		.sort();
	return starts[0] ?? null;
}

function beforeHistory(
	context: TableContext,
	scope: string,
	row: SeriesRow,
): boolean {
	const start = scopeHistoryStart(context, scope);
	return start === null ? row.days_with_data === 0 : row.bucket_end < start;
}

function seriesRows(
	context: TableContext,
	key: string,
	spec: TableSpec,
	bucketOf: (row: SeriesRow) => string | null,
	valuesOf: (row: SeriesRow, scope: string) => CellValue[],
): PackRows {
	const rows: PackRows = {};
	for (const row of context.results.rows(key, "period_series")) {
		const scope = storeScopeLabel(context, row.store_id);
		const bucket = bucketOf(row);
		if (scope === null || bucket === null) continue;
		if (beforeHistory(context, scope, row)) continue;
		rows[`${scope}/${bucket}`] = packRow(
			spec,
			valuesOf(row, scope),
			context.request.currency,
		);
	}
	return rows;
}

export function weekKey(row: SeriesRow): string {
	return row.iso_year !== null && row.iso_week !== null
		? isoWeekKey({ isoYear: row.iso_year, isoWeek: row.iso_week })
		: isoWeekKey(isoWeekOf(row.bucket_start));
}

export function weeklyTable(context: TableContext): PackTable {
	return packTable(
		"weekly",
		context,
		WEEKLY_SPEC,
		seriesRows(context, CALL_KEYS.weekly, WEEKLY_SPEC, weekKey, (row) => [
			...totals(row),
			row.excluded_days,
		]),
	);
}

export function monthlyTable(context: TableContext): PackTable {
	return packTable(
		"monthly",
		context,
		MONTHLY_SPEC,
		seriesRows(
			context,
			CALL_KEYS.monthly,
			MONTHLY_SPEC,
			(row) => row.bucket_start.slice(0, 7),
			(row) => [...totals(row), row.excluded_days],
		),
	);
}

function weekdayKey(row: SeriesRow): string | null {
	return row.weekday === null ? null : (WEEKDAY_KEYS[row.weekday - 1] ?? null);
}

export function weekdayTable(context: TableContext): PackTable {
	const seriesRowsOf = context.results.rows(CALL_KEYS.weekday, "period_series");
	const weekNet = new Map<string, number>();
	for (const row of [...seriesRowsOf].sort(
		(left, right) => (left.weekday ?? 0) - (right.weekday ?? 0),
	)) {
		const scope = storeScopeLabel(context, row.store_id);
		if (scope === null) continue;
		weekNet.set(scope, (weekNet.get(scope) ?? 0) + (row.net_amount ?? 0));
	}
	return packTable(
		"weekday",
		context,
		WEEKDAY_SPEC,
		seriesRows(
			context,
			CALL_KEYS.weekday,
			WEEKDAY_SPEC,
			weekdayKey,
			(row, scope) => [
				...totals(row),
				ratioOf(row.net_amount, weekNet.get(scope)),
			],
		),
	);
}
