export const KPI_STATUSES = [
	"no_data",
	"too_early",
	"achieved",
	"missed",
	"off_course",
	"on_track",
	"behind",
] as const;

export type KpiStatus = (typeof KPI_STATUSES)[number];

export const KPI_TOO_EARLY_DAYS = 14;
export const KPI_ON_TRACK_SLACK = 0.25;

export interface KpiStatusInput {
	readonly baseline: number;
	readonly target: number;
	readonly current: number | null;
	readonly elapsedDays: number;
	readonly horizonDays: number;
	readonly band: { readonly lo: number; readonly hi: number } | null;
}

export interface KpiStatusResult {
	readonly status: KpiStatus;
	readonly progress: number | null;
	readonly withinBand: boolean;
}

function progressOf(baseline: number, target: number, current: number): number {
	const span = target - baseline;
	if (span === 0) return current === target ? 1 : 0;
	return (current - baseline) / span;
}

function statusOf(input: KpiStatusInput, progress: number | null): KpiStatus {
	if (input.current === null || progress === null) return "no_data";
	if (input.elapsedDays < KPI_TOO_EARLY_DAYS) return "too_early";
	if (progress >= 1) return "achieved";
	if (input.elapsedDays >= input.horizonDays) return "missed";
	if (progress < 0) return "off_course";
	const elapsedShare =
		input.horizonDays > 0
			? Math.min(input.elapsedDays / input.horizonDays, 1)
			: 1;
	return progress >= elapsedShare - KPI_ON_TRACK_SLACK ? "on_track" : "behind";
}

export function kpiStatus(input: KpiStatusInput): KpiStatusResult {
	const current =
		input.current !== null && Number.isFinite(input.current)
			? input.current
			: null;
	const progress =
		current === null ? null : progressOf(input.baseline, input.target, current);
	const withinBand =
		current !== null &&
		input.band !== null &&
		current >= Math.min(input.band.lo, input.band.hi) &&
		current <= Math.max(input.band.lo, input.band.hi);
	return {
		status: statusOf({ ...input, current }, progress),
		progress,
		withinBand,
	};
}
