import { notImplemented } from "../pack/errors.js";

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

export function kpiStatus(_input: KpiStatusInput): KpiStatusResult {
	return notImplemented("kpiStatus");
}
