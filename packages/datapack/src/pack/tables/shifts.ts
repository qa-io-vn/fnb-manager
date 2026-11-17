import type { AnalyticsRow } from "@fnb/reports";
import { CALL_KEYS } from "../calls.js";
import { instantMilliseconds, localHourOf } from "../clock.js";
import { ALL_SCOPE, type PackTable } from "../schema.js";
import {
	byText,
	columns,
	type PackRows,
	packRow,
	packTable,
	ratioOf,
	storeScopeLabel,
	type TableContext,
	type TableSpec,
} from "./support.js";

type ShiftRow = AnalyticsRow<"shift_review">;

export const SHIFT_BANDS = [
	{ id: "morning", from: 5, to: 11 },
	{ id: "midday", from: 11, to: 17 },
	{ id: "evening", from: 17, to: 23 },
	{ id: "night", from: 23, to: 5 },
] as const;

export type ShiftBand = (typeof SHIFT_BANDS)[number]["id"];

const MILLISECONDS_PER_HOUR = 3_600_000;

export const SHIFTS_SPEC: TableSpec = {
	grain: "store-band",
	window: "w28",
	columns: columns([
		["shifts", "count"],
		["avg_orders", "ratio"],
		["avg_sales", "money"],
		["avg_hours", "hours"],
		["flagged", "count"],
		["avg_abs_variance", "money"],
	]),
};

export function shiftBandOf(hour: number): ShiftBand {
	for (const band of SHIFT_BANDS) {
		const inside =
			band.from < band.to
				? hour >= band.from && hour < band.to
				: hour >= band.from || hour < band.to;
		if (inside) return band.id;
	}
	return "night";
}

interface BandStats {
	shifts: number;
	orders: number;
	sales: number;
	closed: number;
	hours: number;
	flagged: number;
	variances: number;
	absoluteVariance: number;
}

function emptyStats(): BandStats {
	return {
		shifts: 0,
		orders: 0,
		sales: 0,
		closed: 0,
		hours: 0,
		flagged: 0,
		variances: 0,
		absoluteVariance: 0,
	};
}

function byShiftOrder(left: ShiftRow, right: ShiftRow): number {
	return (
		byText(left.store_id, right.store_id) ||
		(instantMilliseconds(left.opened_at) ?? 0) -
			(instantMilliseconds(right.opened_at) ?? 0) ||
		byText(left.shift_id, right.shift_id)
	);
}

function add(stats: BandStats, row: ShiftRow): void {
	stats.shifts += 1;
	stats.orders += row.orders;
	stats.sales += row.sales_amount;
	const opened = instantMilliseconds(row.opened_at);
	const closed = instantMilliseconds(row.closed_at);
	if (opened !== null && closed !== null) {
		stats.closed += 1;
		stats.hours += (closed - opened) / MILLISECONDS_PER_HOUR;
	}
	if (row.flagged) stats.flagged += 1;
	if (row.variance_amount !== null) {
		stats.variances += 1;
		stats.absoluteVariance += Math.abs(row.variance_amount);
	}
}

export function shiftsTable(context: TableContext): PackTable {
	const timezones = new Map(
		context.profiles.map((profile) => [profile.store_id, profile.timezone]),
	);
	const stats = new Map<string, BandStats>();
	const shiftRows = [
		...context.results.rows(CALL_KEYS.shifts, "shift_review"),
	].sort(byShiftOrder);
	for (const row of shiftRows) {
		const timezone =
			row.store_id === null ? undefined : timezones.get(row.store_id);
		const hour =
			timezone === undefined ? null : localHourOf(row.opened_at, timezone);
		const label = storeScopeLabel(context, row.store_id);
		if (hour === null || label === null) continue;
		const band = shiftBandOf(hour);
		const scopes = new Set([
			ALL_SCOPE,
			context.request.stores.length > 1 ? label : ALL_SCOPE,
		]);
		for (const scope of scopes) {
			const key = `${scope}/${band}`;
			const entry = stats.get(key) ?? emptyStats();
			add(entry, row);
			stats.set(key, entry);
		}
	}
	const rows: PackRows = {};
	for (const [key, entry] of stats) {
		rows[key] = packRow(
			SHIFTS_SPEC,
			[
				entry.shifts,
				ratioOf(entry.orders, entry.shifts),
				ratioOf(entry.sales, entry.shifts),
				ratioOf(entry.hours, entry.closed),
				entry.flagged,
				ratioOf(entry.absoluteVariance, entry.variances),
			],
			context.request.currency,
		);
	}
	return packTable("shifts", context, SHIFTS_SPEC, rows);
}
