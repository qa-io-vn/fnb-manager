import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type DataQualityItemRow,
	uncategorisedWindow,
	useUncategorisedSales,
} from "./use-uncategorised-sales";

const STORES = [
	{
		id: "s1",
		posAccountId: "A",
		timeZone: "Asia/Ho_Chi_Minh",
		businessDayStartMinutes: 0,
	},
	{
		id: "s2",
		posAccountId: "A",
		timeZone: "Asia/Ho_Chi_Minh",
		businessDayStartMinutes: 0,
	},
	{
		id: "s3",
		posAccountId: "B",
		timeZone: "Asia/Ho_Chi_Minh",
		businessDayStartMinutes: 0,
	},
];

const current = vi.hoisted(() => ({ callTheme: vi.fn() }));

vi.mock("../../state/tenant-scope", () => ({
	useReadyTenantScope: () => ({ tenant: { id: "tenant-1" }, stores: STORES }),
}));

vi.mock("../../reports/use-as-of", () => ({
	useAsOf: () => "2026-11-14",
}));

vi.mock("../../data/analytics-source-context", () => ({
	useAnalyticsSourceState: () => ({
		status: "ready",
		source: {
			kind: "demo",
			call: vi.fn(),
			callTheme: current.callTheme,
		},
	}),
}));

function wrapper({ children }: { children: ReactNode }) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function row(
	account: string,
	key: string,
	net: number,
	fields: Partial<DataQualityItemRow> = {},
): DataQualityItemRow {
	return {
		item_external_id: key,
		item_name: key,
		pos_account_id: account,
		pos_type_external_id: null,
		pos_type_name: null,
		override_type_external_id: null,
		item_type_external_id: null,
		item_type_name: null,
		type_known: false,
		role: null,
		cost_known: false,
		catalogue_modifier: false,
		quantity: 1,
		net_amount: net,
		net_share: null,
		...fields,
	};
}

function rowsOf(storeIds: readonly string[]): DataQualityItemRow[] {
	return storeIds.includes("s3")
		? [
				row("B", "Bánh mì que", 500_000),
				row("B", "Cà phê", 300_000, { type_known: true }),
			]
		: [
				row("A", "ITEM-9", 800_000, { pos_type_external_id: "T9" }),
				row("A", "ITEM-1", 700_000, { type_known: true }),
				row("A", "Đường", 600_000, { catalogue_modifier: true }),
				row("A", "ITEM-6", 400_000, { override_type_external_id: "T2" }),
				row("A", "ITEM-5", 100_000),
			];
}

function answerFor(
	_name: string,
	args: { store_ids: string[] },
): Promise<DataQualityItemRow[]> {
	return Promise.resolve(rowsOf(args.store_ids));
}

describe("useUncategorisedSales", () => {
	beforeEach(() => {
		current.callTheme.mockReset();
	});

	it("asks data_quality_items once per POS account over that account's stores and the 90 days to the last complete day", async () => {
		current.callTheme.mockImplementation(answerFor);
		const { result } = renderHook(() => useUncategorisedSales(), { wrapper });
		expect(result.current.status).toBe("loading");
		await waitFor(() => expect(result.current.status).toBe("ready"));
		expect(uncategorisedWindow("2026-11-14")).toEqual({
			from: "2026-08-17",
			to: "2026-11-14",
		});
		expect(current.callTheme).toHaveBeenCalledTimes(2);
		expect(current.callTheme).toHaveBeenCalledWith("data_quality_items", {
			store_ids: ["s1", "s2"],
			from_date: "2026-08-17",
			to_date: "2026-11-14",
		});
		expect(current.callTheme).toHaveBeenCalledWith("data_quality_items", {
			store_ids: ["s3"],
			from_date: "2026-08-17",
			to_date: "2026-11-14",
		});
	});

	it("keeps the items without a known type, catalogue modifiers and overridden items aside, best sellers of every account first", async () => {
		current.callTheme.mockImplementation(answerFor);
		const { result } = renderHook(() => useUncategorisedSales(), { wrapper });
		await waitFor(() => expect(result.current.status).toBe("ready"));
		expect(
			result.current.items.map((item) => [
				item.posAccountId,
				item.itemExternalId,
				item.posTypeExternalId,
			]),
		).toEqual([
			["A", "ITEM-9", "T9"],
			["B", "Bánh mì que", null],
			["A", "ITEM-5", null],
		]);
	});

	it("reports a failed account, and its retry asks again", async () => {
		let failing = true;
		current.callTheme.mockImplementation(
			(name: string, args: { store_ids: string[] }) =>
				failing && args.store_ids.includes("s3")
					? Promise.reject(new Error("too many rows"))
					: answerFor(name, args),
		);
		const { result } = renderHook(() => useUncategorisedSales(), { wrapper });
		await waitFor(() => expect(result.current.status).toBe("failed"));
		expect(result.current.canRetry).toBe(true);
		failing = false;
		act(() => result.current.retry());
		await waitFor(() => expect(result.current.status).toBe("ready"));
		expect(result.current.items).toHaveLength(3);
	});
});
