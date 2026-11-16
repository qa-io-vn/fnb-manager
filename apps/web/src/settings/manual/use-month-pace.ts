import type { AnalyticsRow, IsoDate } from "@fnb/reports";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { useAnalyticsSourceState } from "../../data/analytics-source-context";
import { useAsOf } from "../../reports/use-as-of";
import { fetchOptions, type PlannedCall } from "../../reports/use-cards-load";
import { useReadyTenantScope } from "../../state/tenant-scope";

export type MonthPaceRow = AnalyticsRow<"month_pace">;

export interface MonthPace {
	readonly status: "loading" | "failed" | "ready";
	readonly row: MonthPaceRow | null;
	readonly canRetry: boolean;
	readonly retry: () => void;
}

export function monthPaceCall(
	storeId: string,
	monthStart: IsoDate,
	asOf: IsoDate,
): PlannedCall {
	return {
		key: "target-pace",
		name: "month_pace",
		args: { store_ids: [storeId], month_start: monthStart, as_of: asOf },
	};
}

export function useMonthPace(
	storeId: string | null,
	monthStart: IsoDate,
): MonthPace {
	const state = useAnalyticsSourceState();
	const { tenant, stores } = useReadyTenantScope();
	const scopeStores = useMemo(
		() => stores.filter((store) => store.id === storeId),
		[stores, storeId],
	);
	const asOf = useAsOf(scopeStores);
	const source = state.status === "ready" ? state.source : null;
	const store = scopeStores[0] ?? null;
	const call = useMemo(
		() => (store === null ? null : monthPaceCall(store.id, monthStart, asOf)),
		[store, monthStart, asOf],
	);
	const queries: ReturnType<typeof fetchOptions>[] =
		source === null || call === null
			? []
			: [fetchOptions(source, tenant.id, asOf, call)];
	const [result] = useQueries({ queries });
	const rows = result?.data as readonly MonthPaceRow[] | undefined;
	const failed = state.status === "failed" || result?.isError === true;
	return {
		status: failed
			? "failed"
			: call === null ||
					source === null ||
					result === undefined ||
					result.isPending
				? "loading"
				: "ready",
		row: rows?.[0] ?? null,
		canRetry: result?.isError === true,
		retry: () => {
			void result?.refetch();
		},
	};
}
