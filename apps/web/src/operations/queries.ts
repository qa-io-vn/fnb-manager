import type { IsoDate } from "@fnb/reports";
import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { useSettingsSourceState } from "../settings/settings-source-context";
import { useReadyTenantScope } from "../state/tenant-scope";
import type { OperationsSource } from "./source";

export const OPERATIONS_QUERY_ROOT = "operations";

export type OperationsRead =
	| "runs"
	| "runDetail"
	| "photo"
	| "cashCounts"
	| "incidents"
	| "handovers"
	| "categories"
	| "actors"
	| "announcements"
	| "announcementReadRate"
	| "announcementReaders";

export function operationsQueryKey(
	tenantId: string,
	read: OperationsRead,
	...parts: readonly (string | number)[]
) {
	return [OPERATIONS_QUERY_ROOT, tenantId, read, ...parts] as const;
}

export async function invalidateOperations(
	queryClient: QueryClient,
	tenantId: string,
): Promise<void> {
	await queryClient.invalidateQueries({
		predicate: (query) =>
			query.queryKey[0] === OPERATIONS_QUERY_ROOT &&
			query.queryKey[1] === tenantId &&
			query.queryKey[2] !== "photo",
	});
}

export type OperationsSourceState =
	| { readonly status: "loading" }
	| { readonly status: "failed" }
	| { readonly status: "unavailable" }
	| { readonly status: "ready"; readonly source: OperationsSource };

export function useOperationsSource(): OperationsSourceState {
	const state = useSettingsSourceState();
	if (state.status === "loading") return { status: "loading" };
	if (state.status === "failed") return { status: "failed" };
	const operations: OperationsSource | null | undefined = state.operations;
	return operations === undefined || operations === null
		? { status: "unavailable" }
		: { status: "ready", source: operations };
}

function useOperationsRead<T>(
	read: OperationsRead,
	parts: readonly (string | number)[],
	load: (source: OperationsSource, tenantId: string) => Promise<T>,
	options: { readonly enabled?: boolean; readonly staleTime?: number } = {},
) {
	const state = useOperationsSource();
	const { tenant } = useReadyTenantScope();
	const source = state.status === "ready" ? state.source : null;
	return useQuery({
		queryKey: operationsQueryKey(tenant.id, read, ...parts),
		queryFn: () => {
			if (source === null) throw new Error("operations source not ready");
			return load(source, tenant.id);
		},
		enabled: source !== null && (options.enabled ?? true),
		...(options.staleTime === undefined
			? {}
			: { staleTime: options.staleTime }),
	});
}

function storesPart(storeIds: readonly string[]): string {
	return [...storeIds].sort().join(",");
}

export function useChecklistRuns(
	storeIds: readonly string[],
	from: IsoDate,
	to: IsoDate,
	enabled = true,
) {
	return useOperationsRead(
		"runs",
		[storesPart(storeIds), from, to],
		(source) => source.checklistRuns(storeIds, from, to),
		{ enabled },
	);
}

export function useRunDetail(runId: string) {
	return useOperationsRead("runDetail", [runId], (source) =>
		source.runDetail(runId),
	);
}

export const PHOTO_STALE_MS = 5 * 60 * 1000;

export function usePhoto(bucket: string, path: string, enabled: boolean) {
	return useOperationsRead(
		"photo",
		[bucket, path],
		(source) => source.photo(bucket, path),
		{ enabled, staleTime: PHOTO_STALE_MS },
	);
}

export function useCashCounts(
	storeIds: readonly string[],
	from: IsoDate,
	to: IsoDate,
	enabled = true,
) {
	return useOperationsRead(
		"cashCounts",
		[storesPart(storeIds), from, to],
		(source) => source.cashCounts(storeIds, from, to),
		{ enabled },
	);
}

export function useIncidents(
	storeIds: readonly string[],
	from: IsoDate,
	to: IsoDate,
) {
	return useOperationsRead(
		"incidents",
		[storesPart(storeIds), from, to],
		(source) => source.incidents(storeIds, from, to),
	);
}

export function useHandovers(
	storeIds: readonly string[],
	from: IsoDate,
	to: IsoDate,
) {
	return useOperationsRead(
		"handovers",
		[storesPart(storeIds), from, to],
		(source) => source.handovers(storeIds, from, to),
	);
}

export function useIncidentCategories() {
	return useOperationsRead("categories", [], (source, tenantId) =>
		source.incidentCategories(tenantId),
	);
}

export function useActors() {
	return useOperationsRead("actors", [], (source, tenantId) =>
		source.actors(tenantId),
	);
}

export function useAnnouncements() {
	return useOperationsRead("announcements", [], (source, tenantId) =>
		source.announcements(tenantId),
	);
}

export function useAnnouncementReadRate(announcementId: string) {
	return useOperationsRead("announcementReadRate", [announcementId], (source) =>
		source.announcementReadRate(announcementId),
	);
}

export function useAnnouncementReaders(
	announcementId: string,
	enabled: boolean,
) {
	return useOperationsRead(
		"announcementReaders",
		[announcementId],
		(source) => source.announcementReaders(announcementId),
		{ enabled },
	);
}
