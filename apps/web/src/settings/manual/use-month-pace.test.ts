import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { monthPaceCall, useMonthPace } from "./use-month-pace";

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

const ROW = {
	period_start: "2026-11-01",
	as_of_date: "2026-11-03",
	elapsed_days: 3,
	remaining_days: 27,
	month_to_date_net_amount: 1_000,
	month_to_date_invoices: 10,
	forecast_weekday_profile_net_amount: 10_000,
	forecast_seasonal_naive_net_amount: 9_000,
	target_net_amount: null,
};

function renderPace(storeId: string | null, monthStart = "2026-11-01") {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const wrapper = ({ children }: { children: ReactNode }) =>
		createElement(QueryClientProvider, { client }, children);
	return renderHook(() => useMonthPace(storeId, monthStart), { wrapper });
}

describe("useMonthPace", () => {
	beforeEach(() => {
		vi.useFakeTimers({
			toFake: ["Date"],
			now: new Date("2026-11-04T05:30:00.000Z"),
		});
		current.state = { status: "ready", source: { kind: "demo" } };
		current.calls = [];
		current.fetch = () => Promise.resolve([ROW]);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("asks month_pace for the one store and the month up to the last complete day, as Tháng does", async () => {
		const { result } = renderPace("S2");
		await waitFor(() => expect(result.current.status).toBe("ready"));
		expect(current.calls).toEqual([
			monthPaceCall("S2", "2026-11-01", "2026-11-03"),
		]);
		expect(current.calls[0]).toMatchObject({
			name: "month_pace",
			args: {
				store_ids: ["S2"],
				month_start: "2026-11-01",
				as_of: "2026-11-03",
			},
		});
		expect(result.current.row).toEqual(ROW);
	});

	it("waits without a store, reports a failed read and reads again on retry", async () => {
		const waiting = renderPace(null);
		expect(waiting.result.current.status).toBe("loading");
		expect(current.calls).toEqual([]);
		current.fetch = () => Promise.reject(new Error("offline"));
		const { result } = renderPace("S1");
		await waitFor(() => expect(result.current.status).toBe("failed"));
		expect(result.current.canRetry).toBe(true);
		current.fetch = () => Promise.resolve([ROW]);
		act(() => result.current.retry());
		await waitFor(() => expect(result.current.status).toBe("ready"));
		expect(current.calls).toHaveLength(2);
	});

	it("fails without a retry when the analytics source failed", () => {
		current.state = { status: "failed" };
		const { result } = renderPace("S1");
		expect(result.current).toMatchObject({
			status: "failed",
			row: null,
			canRetry: false,
		});
		expect(current.calls).toEqual([]);
	});
});
