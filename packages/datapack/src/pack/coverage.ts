import {
	type AnalyticsRow,
	addDays,
	daysBetween,
	type IsoDate,
	isCoveredAt,
} from "@fnb/reports";
import {
	KPI_WINDOWS,
	type KpiWindowName,
	type KpiWindows,
} from "./calendar.js";
import type { PackStoreRef } from "./request.js";
import { ALL_SCOPE } from "./schema.js";

export interface PackScope {
	readonly label: string;
	readonly storeIds: readonly string[];
}

export type StoreCoverageRow = AnalyticsRow<"store_coverage">;

export interface ScopeCoverage {
	counts(scope: PackScope, window: KpiWindowName): boolean;
	nulledWindows(scope: PackScope): readonly KpiWindowName[];
	historyStart(storeId: string): IsoDate | null;
	historyDays(storeId: string): number;
	row(storeId: string): StoreCoverageRow | undefined;
}

export function packScopes(
	stores: readonly PackStoreRef[],
): readonly PackScope[] {
	const all: PackScope = {
		label: ALL_SCOPE,
		storeIds: stores.map((store) => store.id),
	};
	if (stores.length === 1) return [all];
	return [
		all,
		...stores.map((store) => ({ label: store.label, storeIds: [store.id] })),
	];
}

export function scopeCoverage(
	rows: readonly StoreCoverageRow[],
	windows: KpiWindows,
	asOf: IsoDate,
): ScopeCoverage {
	const byStore = new Map(
		rows
			.filter((row) => row.store_id !== null)
			.map((row) => [row.store_id as string, row]),
	);
	const counts = (scope: PackScope, window: KpiWindowName): boolean =>
		scope.storeIds.every((id) =>
			isCoveredAt(byStore.get(id), windows[window].from),
		);
	const historyStart = (storeId: string): IsoDate | null =>
		byStore.get(storeId)?.history_start ?? null;
	return {
		counts,
		nulledWindows: (scope) =>
			KPI_WINDOWS.filter((window) => !counts(scope, window)),
		historyStart,
		historyDays: (storeId) => {
			const start = historyStart(storeId);
			return start === null || start > asOf
				? 0
				: daysBetween(start, addDays(asOf, 1));
		},
		row: (storeId) => byStore.get(storeId),
	};
}
