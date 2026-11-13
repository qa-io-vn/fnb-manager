import type { AnalyticsRow } from "../contract/functions.js";
import type { IsoDate } from "../contract/values.js";
import type { ReportContext } from "../definition.js";
import type { VerificationMarker } from "./card.js";

export type CoverageState = "full" | "partial" | "none";

export interface Coverage {
	readonly state: CoverageState;
	readonly coveredStoreIds: readonly string[];
	readonly storeCount: number;
	readonly youngStoreIds: readonly string[];
	readonly earliestHistoryStart: IsoDate | null;
}

export type StoreCoverageRow = AnalyticsRow<"store_coverage">;

export interface CoverageModel {
	readonly rows: readonly StoreCoverageRow[];
	readonly verification: VerificationMarker;
	readonly staleStoreIds: readonly string[];
	readonly storeCount: number;
	forReference(from: IsoDate): Coverage;
	historyStart(storeId: string): IsoDate | null;
	isYoungAt(storeId: string, from: IsoDate): boolean;
}

export function isCoveredAt(
	row: Pick<StoreCoverageRow, "history_start"> | undefined,
	from: IsoDate,
): boolean {
	return (
		row !== undefined && row.history_start !== null && row.history_start <= from
	);
}

export function coverageModel(
	rows: readonly StoreCoverageRow[],
	context: Pick<ReportContext, "stores" | "sample">,
): CoverageModel {
	const selectedIds = context.stores.map((store) => store.id);
	const byStore = new Map(
		rows
			.filter((row) => row.store_id !== null)
			.map((row) => [row.store_id as string, row]),
	);
	const selectedRows = selectedIds.map((id) => byStore.get(id));
	const verified =
		selectedRows.length > 0 &&
		selectedRows.every(
			(row) =>
				row !== undefined &&
				row.unmatched_days === 0 &&
				row.unchecked_sales_days === 0,
		);
	const verification: VerificationMarker = context.sample
		? "sample"
		: verified
			? "verified"
			: "unverified";
	const staleStoreIds = selectedIds.filter(
		(id) => (byStore.get(id)?.stale_days ?? 0) > 0,
	);
	const historyStarts = selectedRows
		.map((row) => row?.history_start ?? null)
		.filter((start): start is IsoDate => start !== null)
		.sort();
	const earliestHistoryStart = historyStarts[0] ?? null;

	return {
		rows,
		verification,
		staleStoreIds,
		storeCount: selectedIds.length,
		forReference(from) {
			const coveredStoreIds = selectedIds.filter((id) =>
				isCoveredAt(byStore.get(id), from),
			);
			const youngStoreIds = selectedIds.filter(
				(id) => !coveredStoreIds.includes(id),
			);
			const state: CoverageState =
				coveredStoreIds.length === 0
					? "none"
					: coveredStoreIds.length === selectedIds.length
						? "full"
						: "partial";
			return {
				state,
				coveredStoreIds,
				storeCount: selectedIds.length,
				youngStoreIds,
				earliestHistoryStart,
			};
		},
		historyStart(storeId) {
			return byStore.get(storeId)?.history_start ?? null;
		},
		isYoungAt(storeId, from) {
			const start = byStore.get(storeId)?.history_start ?? null;
			return start !== null && start > from;
		},
	};
}
