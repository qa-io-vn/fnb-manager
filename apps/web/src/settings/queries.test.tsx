import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CATCH_UP_POLL_MS,
	catchUpPollMs,
	isTenantSettingsKey,
	settingsQueryKey,
	useCatchUpStatus,
} from "./queries";
import { type CatchUpStatus, NO_CATCH_UP } from "./source";

const NOW = new Date("2026-11-15T03:00:00Z");
const TENANT = "33333333-3333-4333-8333-333333333333";

const current = vi.hoisted(() => ({ source: null as unknown }));

vi.mock("../state/tenant-scope", () => ({
	useReadyTenantScope: () => ({
		tenant: { id: "33333333-3333-4333-8333-333333333333" },
	}),
}));

vi.mock("./settings-source-context", () => ({
	useSettingsSourceState: () => ({ status: "ready", source: current.source }),
}));

function pending(from: string, to: string): CatchUpStatus {
	return {
		inputsChangedAt: "2026-11-14T07:55:00Z",
		pendingFrom: from,
		pendingTo: to,
		pendingDays: 1,
		canRefresh: true,
	};
}

describe("catchUpPollMs", () => {
	it("asks again every minute while a day up to today is pending", () => {
		expect(CATCH_UP_POLL_MS).toBe(60_000);
		expect(catchUpPollMs(pending("2026-05-01", "2026-11-16"), false, NOW)).toBe(
			CATCH_UP_POLL_MS,
		);
		expect(catchUpPollMs(pending("2026-11-15", "2026-11-16"), false, NOW)).toBe(
			CATCH_UP_POLL_MS,
		);
	});

	it("stops asking when nothing is pending, only a later day is, or nothing was read yet", () => {
		expect(catchUpPollMs(NO_CATCH_UP, false, NOW)).toBe(false);
		expect(catchUpPollMs(pending("2026-11-16", "2026-11-16"), false, NOW)).toBe(
			false,
		);
		expect(catchUpPollMs(undefined, false, NOW)).toBe(false);
	});

	it("asks again after a failed read, so a page is not left without its banner", () => {
		expect(catchUpPollMs(undefined, true, NOW)).toBe(CATCH_UP_POLL_MS);
		expect(catchUpPollMs(NO_CATCH_UP, true, NOW)).toBe(CATCH_UP_POLL_MS);
	});
});

describe("useCatchUpStatus", () => {
	afterEach(() => vi.useRealTimers());

	function renderStatus(catchUpStatus: () => Promise<CatchUpStatus>) {
		current.source = { kind: "demo", catchUpStatus };
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		return renderHook(() => useCatchUpStatus(), {
			wrapper: ({ children }: { children: ReactNode }) => (
				<QueryClientProvider client={client}>{children}</QueryClientProvider>
			),
		});
	}

	it("reads the status again a minute later while days are pending, and no more once caught up", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const read = vi
			.fn<() => Promise<CatchUpStatus>>()
			.mockResolvedValueOnce(pending("2026-05-01", "2026-11-14"))
			.mockResolvedValue(NO_CATCH_UP);
		const { result } = renderStatus(read);
		await waitFor(() => expect(result.current.data?.pendingDays).toBe(1));
		expect(read).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(CATCH_UP_POLL_MS);
		await waitFor(() => expect(result.current.data).toEqual(NO_CATCH_UP));
		expect(read).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(CATCH_UP_POLL_MS * 3);
		expect(read).toHaveBeenCalledTimes(2);
	});

	it("tries again a minute after a failed read", async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		const read = vi
			.fn<() => Promise<CatchUpStatus>>()
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValue(NO_CATCH_UP);
		const { result } = renderStatus(read);
		await waitFor(() => expect(result.current.status).toBe("error"));
		await vi.advanceTimersByTimeAsync(CATCH_UP_POLL_MS);
		await waitFor(() => expect(result.current.data).toEqual(NO_CATCH_UP));
		expect(read).toHaveBeenCalledTimes(2);
	});
});

describe("settings query keys", () => {
	it("belong to one tenant, whatever the source and the read", () => {
		const key = settingsQueryKey("supabase", TENANT, "catchUp");
		expect(key).toEqual(["settings", "supabase", TENANT, "catchUp"]);
		expect(isTenantSettingsKey(key, TENANT)).toBe(true);
		expect(isTenantSettingsKey(key, "another")).toBe(false);
		expect(isTenantSettingsKey(["analytics", "demo", TENANT], TENANT)).toBe(
			false,
		);
	});
});
