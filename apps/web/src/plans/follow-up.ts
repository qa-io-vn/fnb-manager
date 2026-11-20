import {
	HORIZON_DAYS,
	KPI_WINDOW_DAYS,
	type KpiStatus,
	kpiStatus,
	planKpiKey,
	type StoredKpi,
} from "@fnb/datapack";
import { addDays, daysBetween, type ReportSource } from "@fnb/reports";
import type { IsoDate } from "../lib/business-dates";
import type { PlanSummary } from "./source";

export interface KpiFollowUp {
	readonly metricId: string;
	readonly key: string;
	readonly kpi: StoredKpi;
	readonly current: number | null;
	readonly remeasured: number | null;
	readonly baselineChanged: boolean;
	readonly status: KpiStatus;
	readonly progress: number | null;
	readonly withinBand: boolean;
}

export interface PlanFollowUp {
	readonly asOf: IsoDate;
	readonly kpis: readonly KpiFollowUp[];
	readonly onTrack: number;
}

export interface FollowUpCall {
	readonly storeIds: readonly string[];
	readonly metricIds: readonly string[];
	readonly fromDates: readonly IsoDate[];
	readonly toDates: readonly IsoDate[];
}

export function windowEnding(end: IsoDate): { from: IsoDate; to: IsoDate } {
	return { from: addDays(end, -(KPI_WINDOW_DAYS - 1)), to: end };
}

export function followUpCalls(
	kpis: Readonly<Record<string, StoredKpi>>,
	planAsOf: IsoDate,
	asOf: IsoDate,
): FollowUpCall[] {
	const scopes = new Map<string, { storeIds: string[]; metricIds: string[] }>();
	for (const [metricId, kpi] of Object.entries(kpis)) {
		const storeIds = [...kpi.store_ids].sort();
		const key = storeIds.join(",");
		const scope = scopes.get(key) ?? { storeIds, metricIds: [] };
		scope.metricIds.push(metricId);
		scopes.set(key, scope);
	}
	const current = windowEnding(asOf);
	const baseline = windowEnding(planAsOf);
	return [...scopes.keys()].sort().map((key) => {
		const scope = scopes.get(key) as {
			storeIds: string[];
			metricIds: string[];
		};
		return {
			storeIds: scope.storeIds,
			metricIds: [...scope.metricIds].sort(),
			fromDates: [current.from, baseline.from],
			toDates: [current.to, baseline.to],
		};
	});
}

export async function liveValues(
	source: ReportSource,
	calls: readonly FollowUpCall[],
): Promise<Map<string, [number | null, number | null]>> {
	const values = new Map<string, [number | null, number | null]>();
	const answers = await Promise.all(
		calls.map((call) =>
			source.callTheme("metric_windows", {
				store_ids: [...call.storeIds],
				metric_ids: [...call.metricIds],
				from_dates: [...call.fromDates],
				to_dates: [...call.toDates],
			}),
		),
	);
	calls.forEach((call, index) => {
		for (const metricId of call.metricIds) {
			values.set(planKpiKey(metricId, call.storeIds), [null, null]);
		}
		for (const row of answers[index] ?? []) {
			const key = planKpiKey(row.metric_id, call.storeIds);
			const pair = values.get(key);
			if (pair === undefined) continue;
			const value =
				row.value === null || row.value === undefined
					? null
					: Number(row.value);
			if (Number(row.range_index) === 1) pair[0] = value;
			if (Number(row.range_index) === 2) pair[1] = value;
		}
	});
	return values;
}

export function sameValue(left: number | null, right: number): boolean {
	if (left === null) return true;
	const scale = Math.max(1, Math.abs(left), Math.abs(right));
	return Math.abs(left - right) <= scale * 1e-9;
}

export function followUpOf(
	plan: Pick<PlanSummary, "kpis" | "asOf" | "horizon">,
	asOf: IsoDate,
	values: ReadonlyMap<string, [number | null, number | null]>,
): PlanFollowUp {
	const elapsedDays = daysBetween(plan.asOf, asOf);
	const kpis = Object.entries(plan.kpis)
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([metricId, kpi]): KpiFollowUp => {
			const key = planKpiKey(metricId, kpi.store_ids);
			const [current, remeasured] = values.get(key) ?? [null, null];
			const band =
				kpi.lo !== null && kpi.hi !== null ? { lo: kpi.lo, hi: kpi.hi } : null;
			const result = kpiStatus({
				baseline: kpi.baseline,
				target: kpi.target,
				current,
				elapsedDays,
				horizonDays: HORIZON_DAYS[plan.horizon],
				band,
			});
			return {
				metricId,
				key,
				kpi,
				current,
				remeasured,
				baselineChanged: !sameValue(remeasured, kpi.baseline),
				...result,
			};
		});
	return {
		asOf,
		kpis,
		onTrack: kpis.filter(
			(kpi) => kpi.status === "on_track" || kpi.status === "achieved",
		).length,
	};
}

export async function planFollowUp(
	source: ReportSource,
	plan: Pick<PlanSummary, "kpis" | "asOf" | "horizon">,
	asOf: IsoDate,
): Promise<PlanFollowUp> {
	const calls = followUpCalls(plan.kpis, plan.asOf, asOf);
	return followUpOf(plan, asOf, await liveValues(source, calls));
}
