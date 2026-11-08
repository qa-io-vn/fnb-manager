import { useQuery } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { RowSource, StoreRow, TenantRow } from "../data/row-source";
import { useRowSourceState } from "../data/row-source-context";
import { usePreferences } from "./preferences";

export type TenantScope =
	| { status: "loading" }
	| { status: "failed"; retry: () => void }
	| { status: "no-membership" }
	| {
			status: "ready";
			source: RowSource;
			tenants: TenantRow[];
			tenant: TenantRow;
			stores: StoreRow[];
			selectedStores: StoreRow[];
			allStoresSelected: boolean;
			selectTenant: (tenantId: string) => void;
			selectStores: (storeIds: string[] | null) => void;
	  };

const TenantScopeContext = createContext<TenantScope>({ status: "loading" });

export function selectedStoresOf(
	stores: readonly StoreRow[],
	storeIds: readonly string[] | null,
): StoreRow[] {
	if (storeIds === null) return [...stores];
	const wanted = new Set(storeIds);
	const chosen = stores.filter((store) => wanted.has(store.id));
	return chosen.length === 0 ? [...stores] : chosen;
}

export function TenantScopeProvider({ children }: { children: ReactNode }) {
	const sourceState = useRowSourceState();
	const source = sourceState.status === "ready" ? sourceState.source : null;
	const { preferences, update } = usePreferences();

	const tenantsQuery = useQuery({
		queryKey: [source?.kind, "tenants"],
		queryFn: () => (source ? source.tenants() : Promise.resolve([])),
		enabled: source !== null,
	});
	const tenants = tenantsQuery.data ?? [];
	const tenant =
		tenants.find((candidate) => candidate.id === preferences.tenantId) ??
		tenants[0];

	const storesQuery = useQuery({
		queryKey: [source?.kind, "stores", tenant?.id],
		queryFn: () =>
			source && tenant ? source.stores(tenant.id) : Promise.resolve([]),
		enabled: source !== null && tenant !== undefined,
	});

	const scope = useMemo<TenantScope>(() => {
		if (
			sourceState.status === "failed" ||
			tenantsQuery.isError ||
			storesQuery.isError
		) {
			return {
				status: "failed",
				retry: () => {
					void tenantsQuery.refetch();
					void storesQuery.refetch();
				},
			};
		}
		if (!source || tenantsQuery.isPending) return { status: "loading" };
		if (!tenant) return { status: "no-membership" };
		if (storesQuery.isPending) return { status: "loading" };
		const stores = storesQuery.data ?? [];
		const selectedStores = selectedStoresOf(stores, preferences.storeIds);
		return {
			status: "ready",
			source,
			tenants,
			tenant,
			stores,
			selectedStores,
			allStoresSelected: selectedStores.length === stores.length,
			selectTenant: (tenantId) => update({ tenantId, storeIds: null }),
			selectStores: (storeIds) => update({ storeIds }),
		};
	}, [
		sourceState.status,
		source,
		tenantsQuery,
		storesQuery,
		tenant,
		tenants,
		preferences.storeIds,
		update,
	]);

	return (
		<TenantScopeContext.Provider value={scope}>
			{children}
		</TenantScopeContext.Provider>
	);
}

export function useTenantScope(): TenantScope {
	return useContext(TenantScopeContext);
}

export type ReadyTenantScope = Extract<TenantScope, { status: "ready" }>;

export function useReadyTenantScope(): ReadyTenantScope {
	const scope = useTenantScope();
	if (scope.status !== "ready") throw new Error("Tenant scope is not ready");
	return scope;
}
