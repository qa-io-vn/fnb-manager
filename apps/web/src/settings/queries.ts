import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { useReadyTenantScope } from "../state/tenant-scope";
import { useSettingsSourceState } from "./settings-source-context";
import type { CatchUpStatus, SettingsSource } from "./source";

export const SETTINGS_QUERY_ROOT = "settings";

export type SettingsRead =
	| "membership"
	| "itemTypes"
	| "reportSettings"
	| "catchUp";

export function settingsQueryKey(
	sourceKind: SettingsSource["kind"],
	tenantId: string,
	read: SettingsRead,
) {
	return [SETTINGS_QUERY_ROOT, sourceKind, tenantId, read] as const;
}

export function isTenantSettingsKey(
	queryKey: readonly unknown[],
	tenantId: string,
): boolean {
	return queryKey[0] === SETTINGS_QUERY_ROOT && queryKey[2] === tenantId;
}

export async function invalidateSettings(
	queryClient: QueryClient,
	tenantId: string,
): Promise<void> {
	await queryClient.invalidateQueries({
		predicate: (query) => isTenantSettingsKey(query.queryKey, tenantId),
	});
}

function useSettingsRead<T>(
	read: SettingsRead,
	load: (source: SettingsSource, tenantId: string) => Promise<T>,
	pollEvery: (data: T | undefined, failed: boolean) => number | false = () =>
		false,
) {
	const state = useSettingsSourceState();
	const { tenant } = useReadyTenantScope();
	const source = state.status === "ready" ? state.source : null;
	return useQuery({
		queryKey: settingsQueryKey(source?.kind ?? "demo", tenant.id, read),
		queryFn: () => {
			if (source === null) throw new Error("settings source not ready");
			return load(source, tenant.id);
		},
		enabled: source !== null,
		refetchInterval: (query) =>
			pollEvery(query.state.data, query.state.status === "error"),
	});
}

export function useMembership() {
	return useSettingsRead("membership", (source, tenantId) =>
		source.membership(tenantId),
	);
}

export function useItemTypes() {
	return useSettingsRead("itemTypes", (source, tenantId) =>
		source.itemTypes(tenantId),
	);
}

export function useReportSettings() {
	return useSettingsRead("reportSettings", (source, tenantId) =>
		source.reportSettings(tenantId),
	);
}

export const CATCH_UP_POLL_MS = 60_000;

export function catchUpPollMs(
	status: CatchUpStatus | undefined,
	failed: boolean,
	now: Date,
): number | false {
	if (failed) return CATCH_UP_POLL_MS;
	const today = now.toISOString().slice(0, 10);
	return status !== undefined &&
		status.pendingFrom !== null &&
		status.pendingFrom <= today
		? CATCH_UP_POLL_MS
		: false;
}

export function useCatchUpStatus() {
	return useSettingsRead(
		"catchUp",
		(source, tenantId) => source.catchUpStatus(tenantId),
		(status, failed) => catchUpPollMs(status, failed, new Date()),
	);
}
