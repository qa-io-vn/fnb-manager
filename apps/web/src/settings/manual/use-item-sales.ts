import { type AnalyticsRow, addDays, type IsoDate } from "@fnb/reports";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { useAnalyticsSourceState } from "../../data/analytics-source-context";
import { useAsOf } from "../../reports/use-as-of";
import { fetchOptions, type PlannedCall } from "../../reports/use-cards-load";
import { useReadyTenantScope } from "../../state/tenant-scope";
import { COST_SALES_WINDOW_DAYS, type CostSale } from "./costs";

export type ItemSummaryRow = AnalyticsRow<"item_summary">;

export interface ItemSales {
	readonly status: "loading" | "failed" | "ready";
	readonly sales: readonly CostSale[];
	readonly canRetry: boolean;
	readonly retry: () => void;
}

export function costSalesWindow(asOf: IsoDate): { from: IsoDate; to: IsoDate } {
	return { from: addDays(asOf, 1 - COST_SALES_WINDOW_DAYS), to: asOf };
}

export function costSalesOf(rows: readonly ItemSummaryRow[]): CostSale[] {
	return rows
		.map((row) => ({
			itemExternalId: row.item_external_id,
			name: row.item_name,
			sizeLabel: row.size_label,
			category: row.item_type_name,
			netAmount: row.net_amount,
		}))
		.sort((left, right) => right.netAmount - left.netAmount);
}

export function useItemSales(storeIds: readonly string[]): ItemSales {
	const state = useAnalyticsSourceState();
	const { tenant, stores } = useReadyTenantScope();
	const scopeStores = useMemo(
		() => stores.filter((store) => storeIds.includes(store.id)),
		[stores, storeIds],
	);
	const asOf = useAsOf(scopeStores);
	const source = state.status === "ready" ? state.source : null;
	const call = useMemo((): PlannedCall | null => {
		if (scopeStores.length === 0) return null;
		const window = costSalesWindow(asOf);
		return {
			key: "cost-sales",
			name: "item_summary",
			args: {
				store_ids: scopeStores.map((store) => store.id),
				from_date: window.from,
				to_date: window.to,
			},
		};
	}, [scopeStores, asOf]);
	const queries: ReturnType<typeof fetchOptions>[] =
		source === null || call === null
			? []
			: [fetchOptions(source, tenant.id, asOf, call)];
	const [result] = useQueries({ queries });
	const rows = result?.data as readonly ItemSummaryRow[] | undefined;
	const sales = useMemo(() => costSalesOf(rows ?? []), [rows]);
	if (call === null) {
		return {
			status: "ready",
			sales: [],
			canRetry: false,
			retry: () => undefined,
		};
	}
	const failed = state.status === "failed" || result?.isError === true;
	return {
		status: failed
			? "failed"
			: source === null || result === undefined || result.isPending
				? "loading"
				: "ready",
		sales,
		canRetry: result?.isError === true,
		retry: () => {
			void result?.refetch();
		},
	};
}
