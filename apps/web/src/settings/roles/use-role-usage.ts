import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { useAnalyticsSourceState } from "../../data/analytics-source-context";
import { useAsOf } from "../../reports/use-as-of";
import { fetchOptions, type PlannedCall } from "../../reports/use-cards-load";
import { useReadyTenantScope } from "../../state/tenant-scope";
import {
	type AccountSales,
	type ItemSalesRow,
	type TypeUsage,
	usageOf,
	usageWindow,
} from "./roles";

export interface RoleUsage {
	readonly loading: boolean;
	readonly failed: boolean;
	readonly failedAccounts: ReadonlySet<string>;
	readonly byKey: ReadonlyMap<string, TypeUsage>;
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

export function useRoleUsage(): RoleUsage {
	const state = useAnalyticsSourceState();
	const { tenant, stores } = useReadyTenantScope();
	const asOf = useAsOf(stores);
	const source = state.status === "ready" ? state.source : null;
	const calls = useMemo(() => {
		const window = usageWindow(asOf);
		return [...storeIdsByAccount(stores)].map(([posAccountId, storeIds]) => ({
			posAccountId,
			call: {
				key: `roles-usage-${posAccountId}`,
				name: "item_summary",
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
	const sales: AccountSales[] = [];
	const failedAccounts = new Set<string>();
	calls.forEach(({ posAccountId }, index) => {
		const result = results[index];
		if (result?.isError) failedAccounts.add(posAccountId);
		const rows = result?.data as readonly ItemSalesRow[] | undefined;
		if (rows !== undefined) sales.push({ posAccountId, rows });
	});
	return {
		loading: source === null || results.some((result) => result.isPending),
		failed: state.status === "failed",
		failedAccounts,
		byKey: usageOf(sales),
	};
}
