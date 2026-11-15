import {
	QueryClient,
	QueryClientProvider,
	useQuery,
} from "@tanstack/react-query";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { analyticsQueryKey } from "../reports/use-cards-load";
import {
	invalidateAnalytics,
	isTenantAnalyticsKey,
} from "./invalidate-analytics";

const STALE_FOR_AN_HOUR = 60 * 60 * 1000;

function Reader({
	queryKey,
	read,
}: {
	queryKey: readonly unknown[];
	read: () => Promise<number>;
}) {
	const { data } = useQuery({
		queryKey,
		queryFn: read,
		staleTime: STALE_FOR_AN_HOUR,
	});
	return <span>{data ?? ""}</span>;
}

function keyOf(sourceKind: "demo" | "supabase", tenantId: string, fn: string) {
	return analyticsQueryKey(sourceKind, tenantId, { name: fn, args: {} });
}

describe("invalidateAnalytics", () => {
	it("recognises the analytics keys of one tenant only", () => {
		expect(
			isTenantAnalyticsKey(keyOf("supabase", "t1", "range_totals"), "t1"),
		).toBe(true);
		expect(
			isTenantAnalyticsKey(keyOf("demo", "t1", "range_totals"), "t1"),
		).toBe(true);
		expect(
			isTenantAnalyticsKey(keyOf("supabase", "t2", "range_totals"), "t1"),
		).toBe(false);
		expect(isTenantAnalyticsKey(["settings", "supabase", "t1"], "t1")).toBe(
			false,
		);
	});

	it("refetches a mounted query of the tenant at once and leaves another tenant's alone", async () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const own = vi.fn(async () => 1);
		const other = vi.fn(async () => 2);
		const settings = vi.fn(async () => 3);
		render(
			<QueryClientProvider client={client}>
				<Reader queryKey={keyOf("supabase", "t1", "range_totals")} read={own} />
				<Reader
					queryKey={keyOf("supabase", "t2", "range_totals")}
					read={other}
				/>
				<Reader queryKey={["settings", "supabase", "t1"]} read={settings} />
			</QueryClientProvider>,
		);
		await waitFor(() => {
			expect(own).toHaveBeenCalledTimes(1);
			expect(other).toHaveBeenCalledTimes(1);
			expect(settings).toHaveBeenCalledTimes(1);
		});
		await act(async () => {
			await invalidateAnalytics(client, "t1");
		});
		await waitFor(() => expect(own).toHaveBeenCalledTimes(2));
		expect(other).toHaveBeenCalledTimes(1);
		expect(settings).toHaveBeenCalledTimes(1);
	});

	it("marks an unmounted query of the tenant so that it refetches on its next mount", async () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const key = keyOf("supabase", "t1", "payment_summary");
		const read = vi.fn(async () => 1);
		const first = render(
			<QueryClientProvider client={client}>
				<Reader queryKey={key} read={read} />
			</QueryClientProvider>,
		);
		await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
		first.unmount();
		await act(async () => {
			await invalidateAnalytics(client, "t1");
		});
		expect(read).toHaveBeenCalledTimes(1);
		expect(client.getQueryState(key)?.isInvalidated).toBe(true);
		render(
			<QueryClientProvider client={client}>
				<Reader queryKey={key} read={read} />
			</QueryClientProvider>,
		);
		await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
	});
});
