import {
	type QueryClient,
	useInfiniteQuery,
	useQuery,
} from "@tanstack/react-query";
import { useReadyTenantScope } from "../../state/tenant-scope";
import { useSettingsSourceState } from "../settings-source-context";
import { HISTORY_PAGE_SIZE, type NotifySource } from "./source";

export const NOTIFY_QUERY_ROOT = "notify";

export function notifyQueryKey(
	kind: string,
	tenantId: string,
	...rest: readonly unknown[]
): readonly unknown[] {
	return [NOTIFY_QUERY_ROOT, kind, tenantId, ...rest];
}

export interface NotifySourceHandle {
	readonly source: NotifySource | null;
	readonly failed: boolean;
}

export function useNotifySource(): NotifySourceHandle {
	const state = useSettingsSourceState();
	if (state.status === "failed") return { source: null, failed: true };
	if (state.status !== "ready") return { source: null, failed: false };
	return { source: state.notify ?? null, failed: state.notify === null };
}

export async function invalidateNotify(
	client: QueryClient,
	kind: string,
	tenantId: string,
): Promise<void> {
	await client.invalidateQueries({
		queryKey: [NOTIFY_QUERY_ROOT, kind, tenantId],
	});
}

function useTenantId(): string {
	return useReadyTenantScope().tenant.id;
}

export function useNotifyOverview(source: NotifySource | null) {
	const tenantId = useTenantId();
	return useQuery({
		queryKey: notifyQueryKey(source?.kind ?? "none", tenantId, "overview"),
		queryFn: () => (source as NotifySource).overview(tenantId),
		enabled: source !== null,
	});
}

export function useRuleCatalogue(source: NotifySource | null) {
	const tenantId = useTenantId();
	return useQuery({
		queryKey: notifyQueryKey(source?.kind ?? "none", tenantId, "catalogue"),
		queryFn: () => (source as NotifySource).catalogue(),
		enabled: source !== null,
		staleTime: 5 * 60_000,
	});
}

export function useEffectiveRules(
	source: NotifySource | null,
	storeId: string | null,
) {
	const tenantId = useTenantId();
	return useQuery({
		queryKey: notifyQueryKey(
			source?.kind ?? "none",
			tenantId,
			"rules",
			storeId,
		),
		queryFn: () => (source as NotifySource).rules(tenantId, storeId),
		enabled: source !== null,
	});
}

export function useEffectivePolicies(source: NotifySource | null) {
	const tenantId = useTenantId();
	return useQuery({
		queryKey: notifyQueryKey(source?.kind ?? "none", tenantId, "policies"),
		queryFn: () => (source as NotifySource).policies(tenantId),
		enabled: source !== null,
	});
}

export function nextPageOf(lastPage: readonly unknown[], pages: number) {
	return lastPage.length < HISTORY_PAGE_SIZE ? undefined : pages;
}

export function useAlertHistory(source: NotifySource | null) {
	const tenantId = useTenantId();
	return useInfiniteQuery({
		queryKey: notifyQueryKey(source?.kind ?? "none", tenantId, "history"),
		queryFn: ({ pageParam }) =>
			(source as NotifySource).alertHistory(tenantId, pageParam),
		initialPageParam: 0,
		getNextPageParam: (lastPage, allPages) =>
			nextPageOf(lastPage, allPages.length),
		enabled: source !== null,
	});
}

export function useMessageLog(source: NotifySource | null) {
	const tenantId = useTenantId();
	return useInfiniteQuery({
		queryKey: notifyQueryKey(source?.kind ?? "none", tenantId, "log"),
		queryFn: ({ pageParam }) =>
			(source as NotifySource).messageLog(tenantId, pageParam),
		initialPageParam: 0,
		getNextPageParam: (lastPage, allPages) =>
			nextPageOf(lastPage, allPages.length),
		enabled: source !== null,
	});
}

export function useDigestRecords(source: NotifySource | null) {
	const tenantId = useTenantId();
	return useQuery({
		queryKey: notifyQueryKey(source?.kind ?? "none", tenantId, "digests"),
		queryFn: () => (source as NotifySource).digests(tenantId),
		enabled: source !== null,
	});
}
