import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { type CatchUpStatus, NO_CATCH_UP, SettingsWriteError } from "../source";
import {
	CatchUpProvider,
	type CatchUpRunner,
	pendingKeyOf,
	useCatchUpRunner,
} from "./catch-up-context";
import {
	MAX_CHUNKS_WITHOUT_PROGRESS,
	pendingDaysThrough,
	runCatchUp,
	samePending,
} from "./run-catch-up";
import {
	type AnalyticsCatchUp,
	lastDayAStoreShows,
	useAnalyticsCatchUp,
} from "./use-analytics-catch-up";

const TENANT = "33333333-3333-4333-8333-333333333333";
const OTHER_TENANT = "44444444-4444-4444-8444-444444444444";
const CHANGED_AT = "2026-11-01T03:00:00+00:00";

const current = vi.hoisted(() => ({
	source: null as unknown,
	tenantId: "33333333-3333-4333-8333-333333333333",
	stores: [{ timeZone: "Asia/Ho_Chi_Minh", businessDayStartMinutes: 0 }],
}));

vi.mock("../../state/tenant-scope", () => ({
	useReadyTenantScope: () => ({
		tenant: { id: current.tenantId },
		stores: current.stores,
	}),
}));

vi.mock("../settings-source-context", () => ({
	useSettingsSourceState: () =>
		current.source === null
			? { status: "loading" }
			: { status: "ready", source: current.source },
}));

function pending(
	from: string,
	to: string,
	days: number,
	overrides: Partial<CatchUpStatus> = {},
): CatchUpStatus {
	return {
		inputsChangedAt: CHANGED_AT,
		pendingFrom: from,
		pendingTo: to,
		pendingDays: days,
		canRefresh: true,
		...overrides,
	};
}

const WHOLE = pending("2026-05-01", "2026-11-15", 199);
const AFTER_ONE = pending("2026-05-01", "2026-08-15", 107);
const AFTER_TWO = pending("2026-05-01", "2026-05-15", 15);
const CAUGHT_UP: CatchUpStatus = {
	...NO_CATCH_UP,
	inputsChangedAt: CHANGED_AT,
	canRefresh: true,
};

type StatusCall = (tenantId: string) => Promise<CatchUpStatus>;

interface FakeSource {
	readonly kind: "demo";
	readonly catchUpStatus: Mock<StatusCall>;
	readonly refreshChunk: Mock<StatusCall>;
}

function fakeSource(
	first: CatchUpStatus,
	chunks: readonly (CatchUpStatus | Error)[],
): FakeSource {
	const refreshChunk = vi.fn<StatusCall>();
	for (const chunk of chunks) {
		if (chunk instanceof Error) refreshChunk.mockRejectedValueOnce(chunk);
		else refreshChunk.mockResolvedValueOnce(chunk);
	}
	return {
		kind: "demo",
		catchUpStatus: vi.fn<StatusCall>(async () => first),
		refreshChunk,
	};
}

function heldChunk(source: FakeSource): (status: CatchUpStatus) => void {
	let release: (status: CatchUpStatus) => void = () => undefined;
	source.refreshChunk.mockImplementationOnce(
		() =>
			new Promise<CatchUpStatus>((resolve) => {
				release = resolve;
			}),
	);
	return (status) => release(status);
}

let client: QueryClient;

const STATUS_KEY = ["settings", "demo", TENANT, "catchUp"];
const ANALYTICS_KEY = ["analytics", "demo", TENANT, "item_attach", {}];
const OTHER_TENANT_KEY = ["analytics", "demo", OTHER_TENANT, "item_attach", {}];

function staleAnalytics(): boolean {
	return client.getQueryState(ANALYTICS_KEY)?.isInvalidated === true;
}

function wrapper({ children }: { children: ReactNode }) {
	return (
		<QueryClientProvider client={client}>
			<CatchUpProvider>{children}</CatchUpProvider>
		</QueryClientProvider>
	);
}

function renderCatchUp(source: FakeSource) {
	current.source = source;
	return renderHook(() => useAnalyticsCatchUp(), { wrapper });
}

const seen: { page: AnalyticsCatchUp | null; runner: CatchUpRunner | null } = {
	page: null,
	runner: null,
};

function Page() {
	seen.page = useAnalyticsCatchUp();
	return null;
}

function RunnerProbe() {
	seen.runner = useCatchUpRunner();
	return null;
}

function Shell({ page }: { page: boolean }) {
	return (
		<QueryClientProvider client={client}>
			<CatchUpProvider>
				{page ? <Page /> : null}
				<RunnerProbe />
			</CatchUpProvider>
		</QueryClientProvider>
	);
}

describe("pendingDaysThrough", () => {
	it("counts the pending days a report can show, up to the last complete day", () => {
		expect(pendingDaysThrough(WHOLE, "2026-11-14")).toBe(198);
		expect(pendingDaysThrough(WHOLE, "2026-11-20")).toBe(199);
		expect(pendingDaysThrough(AFTER_TWO, "2026-11-14")).toBe(15);
	});

	it("counts nothing when only today or later is pending, or nothing at all", () => {
		expect(
			pendingDaysThrough(pending("2026-11-15", "2026-11-16", 2), "2026-11-14"),
		).toBe(0);
		expect(pendingDaysThrough(CAUGHT_UP, "2026-11-14")).toBe(0);
	});
});

describe("lastDayAStoreShows", () => {
	const now = new Date("2026-11-15T20:30:00Z");

	it("is the latest last complete day among the stores, so no store's report shows a later one", () => {
		const midnight = {
			timeZone: "Asia/Ho_Chi_Minh",
			businessDayStartMinutes: 0,
		};
		const lateStart = {
			timeZone: "Asia/Ho_Chi_Minh",
			businessDayStartMinutes: 300,
		};
		expect(lastDayAStoreShows([midnight], now)).toBe("2026-11-15");
		expect(lastDayAStoreShows([lateStart], now)).toBe("2026-11-14");
		expect(lastDayAStoreShows([lateStart, midnight], now)).toBe("2026-11-15");
	});

	it("falls back to yesterday when the business has no store", () => {
		expect(lastDayAStoreShows([], now)).toBe("2026-11-14");
	});
});

describe("runCatchUp", () => {
	const quiet = {
		tenantId: TENANT,
		aborted: () => false,
		afterStatus: () => undefined,
		afterChunk: () => undefined,
	};

	it("refreshes one chunk at a time from the re-read status until nothing is pending", async () => {
		const source = fakeSource(WHOLE, [AFTER_ONE, AFTER_TWO, CAUGHT_UP]);
		const statuses: CatchUpStatus[] = [];
		const result = await runCatchUp({
			...quiet,
			source,
			afterStatus: (status) => statuses.push(status),
			afterChunk: (status) => statuses.push(status),
		});
		expect(result).toEqual({ end: "done", status: CAUGHT_UP, chunks: 3 });
		expect(statuses).toEqual([WHOLE, AFTER_ONE, AFTER_TWO, CAUGHT_UP]);
		expect(source.refreshChunk).toHaveBeenCalledTimes(3);
		expect(source.refreshChunk).toHaveBeenCalledWith(TENANT);
	});

	it("does nothing when no day is pending", async () => {
		const source = fakeSource(CAUGHT_UP, []);
		expect(await runCatchUp({ ...quiet, source })).toEqual({
			end: "done",
			status: CAUGHT_UP,
			chunks: 0,
		});
		expect(source.refreshChunk).not.toHaveBeenCalled();
	});

	it("leaves the refresh to an owner or manager", async () => {
		const source = fakeSource({ ...WHOLE, canRefresh: false }, []);
		expect((await runCatchUp({ ...quiet, source })).end).toBe("notAllowed");
		expect(source.refreshChunk).not.toHaveBeenCalled();
	});

	it("carries on from the whole history when a mapping changed while a chunk ran", async () => {
		const changedAgain = {
			...WHOLE,
			inputsChangedAt: "2026-11-02T04:00:00+00:00",
		};
		expect(samePending(changedAgain, WHOLE)).toBe(false);
		const source = fakeSource(WHOLE, [changedAgain, AFTER_ONE, CAUGHT_UP]);
		expect(await runCatchUp({ ...quiet, source })).toEqual({
			end: "done",
			status: CAUGHT_UP,
			chunks: 3,
		});
	});

	it("stops as stalled when chunks in a row change nothing", async () => {
		const source = fakeSource(WHOLE, [WHOLE, WHOLE, WHOLE, WHOLE]);
		const result = await runCatchUp({ ...quiet, source });
		expect(result.end).toBe("stalled");
		expect(result.chunks).toBe(MAX_CHUNKS_WITHOUT_PROGRESS);
	});
});

describe("useAnalyticsCatchUp with the app's one runner", () => {
	beforeEach(() => {
		current.tenantId = TENANT;
		seen.page = null;
		seen.runner = null;
		client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		client.setQueryData(ANALYTICS_KEY, 1);
		client.setQueryData(OTHER_TENANT_KEY, 1);
	});

	it("reads the status when a page mounts and runs nothing by itself", async () => {
		const source = fakeSource(WHOLE, []);
		const { result } = renderCatchUp(source);
		expect(result.current.pendingDays).toBe(0);
		await waitFor(() => expect(result.current.status).toEqual(WHOLE));
		expect(result.current.pendingDays).toBeGreaterThan(0);
		expect(result.current.running).toBe(false);
		expect(result.current.completed).toBe(false);
		expect(source.refreshChunk).not.toHaveBeenCalled();
		expect(staleAnalytics()).toBe(false);
	});

	it("counts no pending day while only days after the last complete one are pending", async () => {
		const future = pending("2999-01-01", "2999-01-02", 2);
		const { result } = renderCatchUp(fakeSource(future, []));
		await waitFor(() => expect(result.current.status).toEqual(future));
		expect(result.current.pendingDays).toBe(0);
	});

	it("runs every chunk, shows the days left after each and drops the tenant's cached analytics each time", async () => {
		const source = fakeSource(WHOLE, [AFTER_ONE, CAUGHT_UP]);
		const invalidate = vi.spyOn(client, "invalidateQueries");
		const { result } = renderCatchUp(source);
		await waitFor(() => expect(result.current.status).toEqual(WHOLE));
		act(() => result.current.start());
		expect(result.current.running).toBe(true);
		await waitFor(() => expect(result.current.running).toBe(false));
		expect(source.refreshChunk).toHaveBeenCalledTimes(2);
		expect(invalidate).toHaveBeenCalledTimes(2);
		expect(result.current.status).toEqual(CAUGHT_UP);
		expect(result.current.problem).toBeNull();
		expect(result.current.completed).toBe(true);
		expect(staleAnalytics()).toBe(true);
		expect(client.getQueryState(OTHER_TENANT_KEY)?.isInvalidated).toBe(false);
		act(() => result.current.dismiss());
		expect(result.current.completed).toBe(false);
	});

	it("finishes nothing and claims nothing when no day was pending", async () => {
		const source = fakeSource(CAUGHT_UP, []);
		const { result } = renderCatchUp(source);
		await waitFor(() => expect(result.current.status).toEqual(CAUGHT_UP));
		act(() => result.current.start());
		await waitFor(() => expect(result.current.running).toBe(false));
		expect(result.current.completed).toBe(false);
		expect(staleAnalytics()).toBe(false);
	});

	it("stops on an error with its reason, drops the cached analytics, and carries on from the status when retried", async () => {
		const source = fakeSource(WHOLE, [
			AFTER_ONE,
			new SettingsWriteError("network"),
			AFTER_TWO,
			CAUGHT_UP,
		]);
		const { result } = renderCatchUp(source);
		await waitFor(() => expect(result.current.status).toEqual(WHOLE));
		act(() => result.current.start());
		await waitFor(() => expect(result.current.problem).toBe("network"));
		expect(result.current.running).toBe(false);
		expect(result.current.completed).toBe(false);
		expect(source.refreshChunk).toHaveBeenCalledTimes(2);
		expect(result.current.status).toEqual(AFTER_ONE);
		expect(staleAnalytics()).toBe(true);
		source.catchUpStatus.mockResolvedValue(AFTER_ONE);
		act(() => result.current.start());
		await waitFor(() => expect(result.current.running).toBe(false));
		expect(result.current.problem).toBeNull();
		expect(source.refreshChunk).toHaveBeenCalledTimes(4);
		expect(result.current.status).toEqual(CAUGHT_UP);
	});

	it("drops the cached analytics when the status cannot be read after a chunk, and names no cause it does not know", async () => {
		const source = fakeSource(WHOLE, [new Error("status read failed")]);
		const { result } = renderCatchUp(source);
		await waitFor(() => expect(result.current.status).toEqual(WHOLE));
		act(() => result.current.start());
		await waitFor(() => expect(result.current.problem).toBe("failed"));
		expect(staleAnalytics()).toBe(true);
	});

	it("finishes the chunk in flight and runs no further one when aborted", async () => {
		const source = fakeSource(WHOLE, []);
		const release = heldChunk(source);
		source.refreshChunk.mockResolvedValue(CAUGHT_UP);
		const { result } = renderCatchUp(source);
		await waitFor(() => expect(result.current.status).toEqual(WHOLE));
		act(() => result.current.start());
		await waitFor(() => expect(source.refreshChunk).toHaveBeenCalledTimes(1));
		act(() => result.current.abort());
		await act(async () => release(AFTER_ONE));
		await waitFor(() => expect(result.current.running).toBe(false));
		expect(source.refreshChunk).toHaveBeenCalledTimes(1);
		expect(result.current.status).toEqual(AFTER_ONE);
		expect(result.current.problem).toBeNull();
		expect(result.current.completed).toBe(false);
		expect(staleAnalytics()).toBe(true);
	});

	it("keeps running when the page that started it is left, and the next page sees it", async () => {
		const source = fakeSource(WHOLE, []);
		const release = heldChunk(source);
		source.refreshChunk.mockResolvedValue(CAUGHT_UP);
		current.source = source;
		const { rerender } = render(<Shell page />);
		await waitFor(() => expect(seen.page?.status).toEqual(WHOLE));
		act(() => seen.page?.start());
		await waitFor(() => expect(source.refreshChunk).toHaveBeenCalledTimes(1));
		rerender(<Shell page={false} />);
		expect(seen.runner?.running).toBe(true);
		await act(async () => release(AFTER_ONE));
		await waitFor(() => expect(seen.runner?.running).toBe(false));
		expect(source.refreshChunk).toHaveBeenCalledTimes(2);
		expect(seen.runner?.completed).toBe(true);
		expect(staleAnalytics()).toBe(true);
		rerender(<Shell page />);
		expect(seen.page?.completed).toBe(true);
	});

	it("starts after a save even when the page that saved is already gone", async () => {
		const source = fakeSource(WHOLE, [CAUGHT_UP]);
		current.source = source;
		const { rerender } = render(<Shell page />);
		await waitFor(() => expect(seen.page?.status).toEqual(WHOLE));
		rerender(<Shell page={false} />);
		act(() => seen.runner?.start(source as never));
		await waitFor(() => expect(seen.runner?.completed).toBe(true));
		expect(source.refreshChunk).toHaveBeenCalledTimes(1);
	});

	it("never runs two refreshes at once, whoever asks", async () => {
		const source = fakeSource(WHOLE, [AFTER_ONE, CAUGHT_UP]);
		current.source = source;
		render(<Shell page />);
		await waitFor(() => expect(seen.page?.status).toEqual(WHOLE));
		act(() => {
			seen.page?.start();
			seen.page?.start();
			seen.runner?.start(source as never);
		});
		await waitFor(() => expect(seen.runner?.running).toBe(false));
		expect(source.refreshChunk).toHaveBeenCalledTimes(2);
		expect(source.catchUpStatus).toHaveBeenCalledTimes(2);
	});

	it("stops after the chunk in flight when the app closes", async () => {
		const source = fakeSource(WHOLE, []);
		const release = heldChunk(source);
		source.refreshChunk.mockResolvedValue(CAUGHT_UP);
		const { result, unmount } = renderCatchUp(source);
		await waitFor(() => expect(result.current.status).toEqual(WHOLE));
		act(() => result.current.start());
		await waitFor(() => expect(source.refreshChunk).toHaveBeenCalledTimes(1));
		unmount();
		release(AFTER_ONE);
		await waitFor(() =>
			expect(client.getQueryData(STATUS_KEY)).toEqual(AFTER_ONE),
		);
		expect(source.refreshChunk).toHaveBeenCalledTimes(1);
	});

	it("stops the run of the business that was left and starts clean for the next", async () => {
		const source = fakeSource(WHOLE, []);
		const release = heldChunk(source);
		source.refreshChunk.mockResolvedValue(CAUGHT_UP);
		current.source = source;
		const { rerender } = render(<Shell page />);
		await waitFor(() => expect(seen.page?.status).toEqual(WHOLE));
		act(() => seen.page?.start());
		await waitFor(() => expect(source.refreshChunk).toHaveBeenCalledTimes(1));
		current.tenantId = OTHER_TENANT;
		rerender(<Shell page />);
		expect(seen.runner?.running).toBe(false);
		await act(async () => release(AFTER_ONE));
		expect(source.refreshChunk).toHaveBeenCalledTimes(1);
		expect(seen.runner).toMatchObject({
			running: false,
			problem: null,
			completed: false,
		});
	});

	it("reports chunks that change nothing as stalled instead of looping", async () => {
		const source = fakeSource(WHOLE, [WHOLE, WHOLE, WHOLE]);
		const { result } = renderCatchUp(source);
		await waitFor(() => expect(result.current.status).toEqual(WHOLE));
		act(() => result.current.start());
		await waitFor(() => expect(result.current.problem).toBe("stalled"));
		expect(source.refreshChunk).toHaveBeenCalledTimes(
			MAX_CHUNKS_WITHOUT_PROGRESS,
		);
	});
});

describe("cached analytics follow the pending range", () => {
	beforeEach(() => {
		current.tenantId = TENANT;
		current.source = null;
		client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		client.setQueryData(ANALYTICS_KEY, 1);
		client.setQueryData(OTHER_TENANT_KEY, 1);
	});

	function renderShell() {
		return render(<Shell page={false} />);
	}

	it("are dropped when someone else's refresh moves the range this session was watching", () => {
		renderShell();
		act(() => {
			client.setQueryData(STATUS_KEY, WHOLE);
		});
		expect(staleAnalytics()).toBe(false);
		act(() => {
			client.setQueryData(STATUS_KEY, AFTER_ONE);
		});
		expect(staleAnalytics()).toBe(true);
		expect(client.getQueryState(OTHER_TENANT_KEY)?.isInvalidated).toBe(false);
	});

	it("are dropped when a mapping changes again while nothing else moves", () => {
		renderShell();
		act(() => {
			client.setQueryData(STATUS_KEY, WHOLE);
		});
		act(() => {
			client.setQueryData(STATUS_KEY, {
				...WHOLE,
				inputsChangedAt: "2026-11-02T04:00:00+00:00",
			});
		});
		expect(staleAnalytics()).toBe(true);
	});

	it("stay when the same status is read again", () => {
		renderShell();
		act(() => {
			client.setQueryData(STATUS_KEY, WHOLE);
		});
		act(() => {
			client.setQueryData(STATUS_KEY, { ...WHOLE });
		});
		expect(pendingKeyOf(WHOLE)).toBe(pendingKeyOf({ ...WHOLE }));
		expect(staleAnalytics()).toBe(false);
	});

	it("are dropped on the first look when a mapping changed since this session began", () => {
		renderShell();
		act(() => {
			client.setQueryData(STATUS_KEY, {
				...WHOLE,
				inputsChangedAt: new Date(Date.now() + 1000).toISOString(),
			});
		});
		expect(staleAnalytics()).toBe(true);
	});

	it("ignore another business's status", () => {
		renderShell();
		const otherKey = ["settings", "demo", OTHER_TENANT, "catchUp"];
		act(() => {
			client.setQueryData(otherKey, WHOLE);
		});
		act(() => {
			client.setQueryData(otherKey, AFTER_ONE);
		});
		expect(staleAnalytics()).toBe(false);
	});
});
