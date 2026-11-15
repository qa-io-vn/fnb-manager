import type { QueryClient } from "@tanstack/react-query";

export const ANALYTICS_QUERY_ROOT = "analytics";

export function isTenantAnalyticsKey(
	queryKey: readonly unknown[],
	tenantId: string,
): boolean {
	return queryKey[0] === ANALYTICS_QUERY_ROOT && queryKey[2] === tenantId;
}

export async function invalidateAnalytics(
	queryClient: QueryClient,
	tenantId: string,
): Promise<void> {
	await queryClient.invalidateQueries({
		predicate: (query) => isTenantAnalyticsKey(query.queryKey, tenantId),
	});
}
