import { daysBetween, type IsoDate } from "@fnb/reports";
import { HORIZON_DAYS, type Horizon } from "../pack/request.js";
import { initiativeTitleKey } from "./normalize.js";
import type { StoredKpi } from "./record.js";
import { type KpiStatus, kpiStatus } from "./status.js";

export interface PlanForComparison {
	readonly id: string;
	readonly createdAt: string;
	readonly asOf: IsoDate;
	readonly horizon: Horizon;
	readonly promptVersion: string;
	readonly packId: string;
	readonly kpis: Readonly<Record<string, StoredKpi>>;
	readonly initiativeTitles: readonly string[];
}

export interface KpiLiveValues {
	readonly asOf: IsoDate;
	readonly current: ReadonlyMap<string, number | null>;
}

export interface PlanComparisonHeader {
	readonly id: string;
	readonly createdAt: string;
	readonly asOf: IsoDate;
	readonly horizon: Horizon;
	readonly promptVersion: string;
	readonly packIdPrefix: string;
	readonly initiatives: number;
}

export interface PlanKpiSide {
	readonly baseline: number;
	readonly target: number;
	readonly dueOn: IsoDate;
	readonly status: KpiStatus;
}

export interface PlanKpiComparison {
	readonly metricId: string;
	readonly storeIds: readonly string[];
	readonly left: PlanKpiSide | null;
	readonly right: PlanKpiSide | null;
	readonly current: number | null;
	readonly change: "kept" | "added" | "dropped";
}

export interface PlanInitiativeComparison {
	readonly title: string;
	readonly change: "kept" | "added" | "removed";
}

export interface PlanComparison {
	readonly left: PlanComparisonHeader;
	readonly right: PlanComparisonHeader;
	readonly kpis: readonly PlanKpiComparison[];
	readonly initiatives: readonly PlanInitiativeComparison[];
}

export const PACK_ID_PREFIX_LENGTH = 8;

export function planKpiKey(
	metricId: string,
	storeIds: readonly string[],
): string {
	return `${metricId}|${[...storeIds].sort().join(",")}`;
}

function headerOf(plan: PlanForComparison): PlanComparisonHeader {
	return {
		id: plan.id,
		createdAt: plan.createdAt,
		asOf: plan.asOf,
		horizon: plan.horizon,
		promptVersion: plan.promptVersion,
		packIdPrefix: plan.packId.slice(0, PACK_ID_PREFIX_LENGTH),
		initiatives: plan.initiativeTitles.length,
	};
}

function sideOf(
	plan: PlanForComparison,
	kpi: StoredKpi,
	current: number | null,
	liveAsOf: IsoDate,
): PlanKpiSide {
	const band =
		kpi.lo !== null && kpi.hi !== null ? { lo: kpi.lo, hi: kpi.hi } : null;
	return {
		baseline: kpi.baseline,
		target: kpi.target,
		dueOn: kpi.due_on,
		status: kpiStatus({
			baseline: kpi.baseline,
			target: kpi.target,
			current,
			elapsedDays: daysBetween(plan.asOf, liveAsOf),
			horizonDays: HORIZON_DAYS[plan.horizon],
			band,
		}).status,
	};
}

interface KeyedKpi {
	readonly key: string;
	readonly metricId: string;
	readonly storeIds: readonly string[];
	readonly kpi: StoredKpi;
}

function keyedKpis(plan: PlanForComparison): Map<string, KeyedKpi> {
	const keyed = new Map<string, KeyedKpi>();
	for (const [metricId, kpi] of Object.entries(plan.kpis)) {
		const storeIds = [...kpi.store_ids].sort();
		const key = planKpiKey(metricId, storeIds);
		keyed.set(key, { key, metricId, storeIds, kpi });
	}
	return keyed;
}

function compareInitiatives(
	left: readonly string[],
	right: readonly string[],
): PlanInitiativeComparison[] {
	const leftKeys = new Set(left.map(initiativeTitleKey));
	const rightKeys = new Set(right.map(initiativeTitleKey));
	const seen = new Set<string>();
	const result: PlanInitiativeComparison[] = [];
	for (const title of right) {
		const key = initiativeTitleKey(title);
		if (seen.has(key)) continue;
		seen.add(key);
		result.push({ title, change: leftKeys.has(key) ? "kept" : "added" });
	}
	for (const title of left) {
		const key = initiativeTitleKey(title);
		if (seen.has(key) || rightKeys.has(key)) continue;
		seen.add(key);
		result.push({ title, change: "removed" });
	}
	return result;
}

export function comparePlans(
	left: PlanForComparison,
	right: PlanForComparison,
	live: KpiLiveValues,
): PlanComparison {
	const leftKpis = keyedKpis(left);
	const rightKpis = keyedKpis(right);
	const keys = [...new Set([...leftKpis.keys(), ...rightKpis.keys()])].sort();
	const kpis = keys.map((key): PlanKpiComparison => {
		const onLeft = leftKpis.get(key);
		const onRight = rightKpis.get(key);
		const any = (onRight ?? onLeft) as KeyedKpi;
		const current = live.current.get(key) ?? null;
		return {
			metricId: any.metricId,
			storeIds: any.storeIds,
			left:
				onLeft === undefined
					? null
					: sideOf(left, onLeft.kpi, current, live.asOf),
			right:
				onRight === undefined
					? null
					: sideOf(right, onRight.kpi, current, live.asOf),
			current,
			change:
				onLeft !== undefined && onRight !== undefined
					? "kept"
					: onRight !== undefined
						? "added"
						: "dropped",
		};
	});
	return {
		left: headerOf(left),
		right: headerOf(right),
		kpis,
		initiatives: compareInitiatives(
			left.initiativeTitles,
			right.initiativeTitles,
		),
	};
}

export { initiativeTitleKey };
