import { type AnalyticsRow, addDays, type IsoDate } from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import type { DemoStoreDefinition } from "../calendar.js";
import type { ShiftAggregate } from "../ingest.js";
import { money, PgDecimal, stddevSample } from "../pg-numeric.js";
import {
	type HandlerArgs,
	type HandlerContext,
	requireDateRange,
	requireReportRows,
	requireStoreIds,
} from "./support.js";

type Row = AnalyticsRow<"shift_review">;

export const SHIFT_REVIEW_MAX_DAYS = 92;
export const DEFAULT_ABS_THRESHOLD = 50_000;
export const DEFAULT_REL_THRESHOLD = 0.005;
export const TRAILING_DAYS = 56;
export const MIN_TRAILING_SHIFTS = 3;
export const Z_THRESHOLD = 2;

export interface ShiftScore {
	readonly trailingShifts: number;
	readonly trailingMean: PgDecimal | null;
	readonly trailingStddev: PgDecimal | null;
	readonly zScore: PgDecimal | null;
	readonly overAbs: boolean;
	readonly overRel: boolean;
	readonly overZ: boolean;
	readonly reasons: string[];
}

export interface StoreShift {
	readonly store: DemoStoreDefinition;
	readonly shift: ShiftAggregate;
}

export function shiftsBetween(
	store: AggregateStore,
	storeIds: readonly string[],
	from: IsoDate,
	to: IsoDate,
): StoreShift[] {
	const shifts: StoreShift[] = [];
	for (const visible of store.visibleStores(storeIds)) {
		for (const day of store.daysOf(visible, from, to)) {
			for (const shift of day.shifts) {
				if (shift.businessDate >= from && shift.businessDate <= to) {
					shifts.push({ store: visible, shift });
				}
			}
		}
	}
	return shifts;
}

function thresholdDecimal(value: number): PgDecimal {
	return PgDecimal.parse(String(value));
}

export function scoreShift(
	store: AggregateStore,
	entry: StoreShift,
	absThreshold: number,
	relThreshold: number,
): ShiftScore | null {
	const variance = entry.shift.varianceMinor;
	if (variance === null) return null;
	const trailing = shiftsBetween(
		store,
		[entry.store.id],
		addDays(entry.shift.businessDate, -TRAILING_DAYS),
		addDays(entry.shift.businessDate, -1),
	)
		.map((item) => item.shift.varianceMinor)
		.filter((value): value is number => value !== null)
		.map((value) => money(value));
	const mean = PgDecimal.avg(trailing)?.round(2) ?? null;
	const stddev = stddevSample(trailing)?.round(2) ?? null;
	const varianceValue = money(variance);
	const zScore =
		trailing.length >= MIN_TRAILING_SHIFTS &&
		stddev !== null &&
		mean !== null &&
		stddev.sign() > 0
			? varianceValue.sub(mean).div(stddev).round(3)
			: null;
	const magnitude = varianceValue.abs();
	const cashSales = money(entry.shift.cashSalesMinor);
	const overAbs = magnitude.compare(thresholdDecimal(absThreshold)) > 0;
	const overRel =
		cashSales.sign() > 0 &&
		magnitude.compare(thresholdDecimal(relThreshold).mul(cashSales)) > 0;
	const overZ =
		zScore !== null && zScore.abs().compare(PgDecimal.integer(Z_THRESHOLD)) > 0;
	const reasons = [
		overAbs ? "absolute" : null,
		overRel ? "relative" : null,
		overZ ? "z_score" : null,
	].filter((reason): reason is string => reason !== null);
	return {
		trailingShifts: trailing.length,
		trailingMean: mean,
		trailingStddev: stddev,
		zScore,
		overAbs,
		overRel,
		overZ,
		reasons,
	};
}

function byCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function minorValue(value: number | null): number | null {
	return value === null ? null : money(value).toNumber();
}

export function shiftReview(
	store: AggregateStore,
	args: HandlerArgs<"shift_review">,
	_context: HandlerContext,
): Row[] {
	requireStoreIds("shift_review", args.store_ids);
	requireDateRange(
		"shift_review",
		args.from_date,
		args.to_date,
		SHIFT_REVIEW_MAX_DAYS,
	);
	const absThreshold = args.abs_threshold ?? DEFAULT_ABS_THRESHOLD;
	const relThreshold = args.rel_threshold ?? DEFAULT_REL_THRESHOLD;
	const rows = shiftsBetween(
		store,
		args.store_ids,
		args.from_date,
		args.to_date,
	)
		.sort(
			(left, right) =>
				byCodeUnits(left.shift.businessDate, right.shift.businessDate) ||
				byCodeUnits(left.store.id, right.store.id) ||
				Date.parse(left.shift.openedAt) - Date.parse(right.shift.openedAt) ||
				byCodeUnits(left.shift.shiftExternalId, right.shift.shiftExternalId),
		)
		.map((entry): Row => {
			const score = scoreShift(store, entry, absThreshold, relThreshold);
			const { shift } = entry;
			const flagged =
				score !== null && (score.overAbs || score.overRel || score.overZ);
			return {
				store_id: entry.store.id,
				shift_id: shift.shiftId,
				shift_external_id: shift.shiftExternalId,
				shift_name: shift.shiftName,
				business_date: shift.businessDate,
				cashier_name: shift.cashierName,
				opened_at: shift.openedAt,
				closed_at: shift.closedAt,
				orders: shift.orders,
				sales_amount: money(shift.salesMinor).toNumber(),
				cash_sales_amount: money(shift.cashSalesMinor).toNumber(),
				opening_float_amount: minorValue(shift.openingFloatMinor),
				expected_cash_amount: minorValue(shift.expectedCashMinor),
				drawer_amount: minorValue(shift.drawerMinor),
				variance_amount: minorValue(shift.varianceMinor),
				trailing_shifts: score?.trailingShifts ?? null,
				z_score: score?.zScore?.toNumber() ?? null,
				over_abs_threshold: score?.overAbs ?? false,
				over_rel_threshold: score?.overRel ?? false,
				over_z_threshold: score?.overZ ?? false,
				flagged,
				reasons: score?.reasons ?? [],
			};
		});
	requireReportRows("shift_review", rows.length);
	return rows;
}
