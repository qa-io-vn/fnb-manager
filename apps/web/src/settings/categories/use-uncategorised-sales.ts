import { addDays, type IsoDate, type ThemeRow } from "@fnb/reports";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { useAnalyticsSourceState } from "../../data/analytics-source-context";
import { useAsOf } from "../../reports/use-as-of";
import { fetchOptions, type PlannedCall } from "../../reports/use-cards-load";
import { useReadyTenantScope } from "../../state/tenant-scope";
import type { SoldUncategorisedItem } from "./categories";

export const UNCATEGORISED_WINDOW_DAYS = 90;

export type DataQualityItemRow = ThemeRow<"data_quality_items">;

export interface AccountQualityRows {
	readonly posAccountId: string;
	readonly rows: readonly DataQualityItemRow[];
}

export interface UncategorisedSales {
	readonly status: "loading" | "failed" | "ready";
	readonly items: readonly SoldUncategorisedItem[];
	readonly canRetry: boolean;
	readonly retry: () => void;
}

export function uncategorisedWindow(asOf: IsoDate): {
	from: IsoDate;
	to: IsoDate;
} {
	return { from: addDays(asOf, 1 - UNCATEGORISED_WINDOW_DAYS), to: asOf };
}

export function isUncategorisedSale(row: DataQualityItemRow): boolean {
	return (
		!row.type_known &&
		!row.catalogue_modifier &&
		row.override_type_external_id === null
	);
}

export function uncategorisedSoldItems(
	accounts: readonly AccountQualityRows[],
): SoldUncategorisedItem[] {
	return accounts
		.flatMap(({ posAccountId, rows }) =>
			rows.filter(isUncategorisedSale).map((row) => ({
				posAccountId: row.pos_account_id ?? posAccountId,
				itemExternalId: row.item_external_id,
				itemName: row.item_name,
				posTypeExternalId: row.pos_type_external_id,
				netAmount: row.net_amount,
			})),
		)
		.sort((left, right) => right.netAmount - left.netAmount);
}

function storeIdsByAccount(
	stores: readonly { id: string; posAccountId: string }[],
): Map<string, string[]> {
	const byAccount = new Map<string, string[]>();
	for (const store of stores) {
		byAccount.set(store.posAccountId, [
			...(byAccount.get(store.posAccountId) ?? []),
			store.id,
		]);
	}
	return byAccount;
}

export function useUncategorisedSales(): UncategorisedSales {
	const state = useAnalyticsSourceState();
	const { tenant, stores } = useReadyTenantScope();
	const asOf = useAsOf(stores);
	const source = state.status === "ready" ? state.source : null;
	const calls = useMemo(() => {
		const window = uncategorisedWindow(asOf);
		return [...storeIdsByAccount(stores)].map(([posAccountId, storeIds]) => ({
			posAccountId,
			call: {
				key: `uncategorised-${posAccountId}`,
				name: "data_quality_items",
				args: {
					store_ids: storeIds,
					from_date: window.from,
					to_date: window.to,
				},
			} satisfies PlannedCall,
		}));
	}, [stores, asOf]);
	const results = useQueries({
		queries:
			source === null
				? []
				: calls.map(({ call }) => fetchOptions(source, tenant.id, asOf, call)),
	});
	const failedResults = results.filter((result) => result.isError);
	const retry = () => {
		for (const result of failedResults) void result.refetch();
	};
	const accounts: AccountQualityRows[] = [];
	calls.forEach(({ posAccountId }, index) => {
		const rows = results[index]?.data as
			| readonly DataQualityItemRow[]
			| undefined;
		if (rows !== undefined) accounts.push({ posAccountId, rows });
	});
	const failed = state.status === "failed" || failedResults.length > 0;
	const loading =
		!failed && (source === null || results.some((result) => result.isPending));
	return {
		status: failed ? "failed" : loading ? "loading" : "ready",
		items: uncategorisedSoldItems(accounts),
		canRetry: failedResults.length > 0,
		retry,
	};
}
