import type { IsoDate } from "@fnb/reports";
import { notImplemented } from "../pack/errors.js";
import type { Horizon } from "../pack/request.js";
import type { StoredKpi } from "./record.js";
import type { KpiStatus } from "./status.js";

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

export function comparePlans(
	_left: PlanForComparison,
	_right: PlanForComparison,
	_live: KpiLiveValues,
): PlanComparison {
	return notImplemented("comparePlans");
}
