import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useRoleUsage } from "./use-role-usage";

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

const current = vi.hoisted(() => ({ call: vi.fn() }));

vi.mock("../../state/tenant-scope", () => ({
	useReadyTenantScope: () => ({ tenant: { id: "tenant-1" }, stores: STORES }),
}));

vi.mock("../../reports/use-as-of", () => ({
	useAsOf: () => "2026-11-14",
}));

vi.mock("../../data/analytics-source-context", () => ({
	useAnalyticsSourceState: () => ({
		status: "ready",
		source: { kind: "demo", call: current.call },
	}),
}));

function wrapper({ children }: { children: ReactNode }) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function row(type: string, net: number, name: string) {
	return {
		item_type_external_id: type,
		net_amount: net,
		item_name: name,
		base_name: null,
	};
}

describe("useRoleUsage", () => {
	it("asks item_summary once per POS account over that account's stores and the 28 days to the last complete day", async () => {
		current.call.mockImplementation(
			async (_name, args: { store_ids: string[] }) =>
				args.store_ids.includes("s3")
					? [row("T1", 300, "Cà phê")]
					: [row("T1", 100, "Trà sữa"), row("T2", 100, "Trân châu")],
		);
		const { result } = renderHook(() => useRoleUsage(), { wrapper });
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect(current.call).toHaveBeenCalledTimes(2);
		expect(current.call).toHaveBeenCalledWith("item_summary", {
			store_ids: ["s1", "s2"],
			from_date: "2026-10-18",
			to_date: "2026-11-14",
		});
		expect(current.call).toHaveBeenCalledWith("item_summary", {
			store_ids: ["s3"],
			from_date: "2026-10-18",
			to_date: "2026-11-14",
		});
		expect(result.current.byKey.get("A|T1")).toEqual({ items: 1, share: 0.2 });
		expect(result.current.byKey.get("B|T1")).toEqual({ items: 1, share: 0.6 });
		expect(result.current.failedAccounts.size).toBe(0);
	});

	it("marks only the account whose sales could not be read", async () => {
		current.call.mockReset();
		current.call.mockImplementation(
			async (_name, args: { store_ids: string[] }) => {
				if (args.store_ids.includes("s3")) throw new Error("too many rows");
				return [row("T1", 100, "Trà sữa")];
			},
		);
		const { result } = renderHook(() => useRoleUsage(), { wrapper });
		await waitFor(() => expect(result.current.loading).toBe(false));
		expect([...result.current.failedAccounts]).toEqual(["B"]);
		expect(result.current.byKey.get("A|T1")).toEqual({ items: 1, share: 1 });
		expect(result.current.failed).toBe(false);
	});
});
