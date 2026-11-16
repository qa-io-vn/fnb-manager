import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	costSalesOf,
	costSalesWindow,
	type ItemSummaryRow,
	useItemSales,
} from "./use-item-sales";

const current = vi.hoisted(() => ({
	state: { status: "ready", source: { kind: "demo" } } as unknown,
	calls: [] as unknown[],
	fetch: (() => Promise.resolve([])) as () => Promise<unknown[]>,
}));

vi.mock("../../data/analytics-source-context", () => ({
	useAnalyticsSourceState: () => current.state,
}));

vi.mock("../../state/tenant-scope", () => ({
	useReadyTenantScope: () => ({
		tenant: { id: "tenant-1", timeZone: "Asia/Ho_Chi_Minh" },
		stores: [
			{ id: "S1", timeZone: "Asia/Ho_Chi_Minh", businessDayStartMinutes: 0 },
			{ id: "S2", timeZone: "Asia/Ho_Chi_Minh", businessDayStartMinutes: 0 },
		],
	}),
}));

vi.mock("../../reports/use-cards-load", () => ({
	fetchOptions: (
		_source: unknown,
		tenantId: string,
		_asOf: string,
		call: unknown,
	) => ({
		queryKey: ["analytics", tenantId, JSON.stringify(call)],
		queryFn: () => {
			current.calls.push(call);
			return current.fetch();
		},
	}),
}));

function renderSales(storeIds: readonly string[]) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const wrapper = ({ children }: { children: ReactNode }) =>
		createElement(QueryClientProvider, { client }, children);
	return renderHook(() => useItemSales(storeIds), { wrapper });
}

describe("useItemSales", () => {
	beforeEach(() => {
		current.state = { status: "ready", source: { kind: "demo" } };
		current.calls = [];
		current.fetch = () => Promise.resolve([]);
	});

	it("asks item_summary for the 90 days of the scope's stores and orders the answer", async () => {
		let answer: (rows: unknown[]) => void = () => undefined;
		current.fetch = () =>
			new Promise((resolve) => {
				answer = resolve;
			});
		const { result } = renderSales(["S1"]);
		await waitFor(() => expect(current.calls).toHaveLength(1));
		expect(result.current.status).toBe("loading");
		expect(current.calls[0]).toMatchObject({
			name: "item_summary",
			args: { store_ids: ["S1"] },
		});
		act(() => answer([row("A", 100), row("B", 300)]));
		await waitFor(() => expect(result.current.status).toBe("ready"));
		expect(result.current.sales.map((sale) => sale.itemExternalId)).toEqual([
			"B",
			"A",
		]);
	});

	it("reports a failed read and reads again on retry", async () => {
		current.fetch = () => Promise.reject(new Error("offline"));
		const { result } = renderSales(["S1", "S2"]);
		await waitFor(() => expect(result.current.status).toBe("failed"));
		expect(result.current.canRetry).toBe(true);
		current.fetch = () => Promise.resolve([row("A", 100)]);
		act(() => result.current.retry());
		await waitFor(() => expect(result.current.status).toBe("ready"));
		expect(result.current.sales).toHaveLength(1);
		expect(current.calls).toHaveLength(2);
	});

	it("asks nothing without a store and fails without a retry when the analytics source failed", async () => {
		const empty = renderSales([]);
		expect(empty.result.current).toMatchObject({
			status: "ready",
			sales: [],
			canRetry: false,
		});
		current.state = { status: "failed" };
		const failed = renderSales(["S1"]);
		expect(failed.result.current).toMatchObject({
			status: "failed",
			canRetry: false,
		});
		expect(current.calls).toEqual([]);
	});
});

function row(
	itemExternalId: string,
	netAmount: number,
	fields: Partial<ItemSummaryRow> = {},
): ItemSummaryRow {
	return {
		item_external_id: itemExternalId,
		item_name: `Món ${itemExternalId}`,
		base_name: null,
		size_label: null,
		item_type_external_id: null,
		item_type_name: null,
		role: null,
		quantity: 1,
		net_amount: netAmount,
		invoices: 1,
		days_sold: 1,
		net_share: null,
		compare_quantity: null,
		compare_net_amount: null,
		compare_net_share: null,
		first_sold_on: null,
		...fields,
	} as ItemSummaryRow;
}

describe("the 90-day sales behind the cost list", () => {
	it("covers the 90 days ending on the last complete day", () => {
		expect(costSalesWindow("2026-11-15")).toEqual({
			from: "2026-08-18",
			to: "2026-11-15",
		});
	});

	it("orders the items by revenue and keeps their size and category", () => {
		expect(
			costSalesOf([
				row("A", 100),
				row("B", 300, { size_label: "L", item_type_name: "Trà sữa" }),
				row("C", 200),
			]),
		).toEqual([
			{
				itemExternalId: "B",
				name: "Món B",
				sizeLabel: "L",
				category: "Trà sữa",
				netAmount: 300,
			},
			{
				itemExternalId: "C",
				name: "Món C",
				sizeLabel: null,
				category: null,
				netAmount: 200,
			},
			{
				itemExternalId: "A",
				name: "Món A",
				sizeLabel: null,
				category: null,
				netAmount: 100,
			},
		]);
	});
});
