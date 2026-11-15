import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsWriteError } from "./source";
import {
	useSettingsMutation,
	WRITE_ERROR_KEYS,
	writeCodeOf,
} from "./use-settings-mutation";

const TENANT = "33333333-3333-4333-8333-333333333333";
const OTHER = "99999999-9999-4999-8999-999999999999";

vi.mock("../state/tenant-scope", () => ({
	useReadyTenantScope: () => ({ tenant: { id: TENANT } }),
}));

vi.mock("./settings-source-context", () => ({
	useSettingsSourceState: () => ({ status: "ready", source: { kind: "demo" } }),
}));

let client: QueryClient;

function seed() {
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const keys = [
		["analytics", "demo", TENANT, "item_summary", {}],
		["analytics", "demo", OTHER, "item_summary", {}],
		["settings", "demo", TENANT, "reportSettings"],
		["rows", "demo", TENANT],
	];
	for (const key of keys) client.setQueryData(key, 1);
	return keys;
}

function stale(key: readonly unknown[]): boolean {
	return client.getQueryState(key)?.isInvalidated === true;
}

function wrapper({ children }: { children: ReactNode }) {
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useSettingsMutation", () => {
	beforeEach(() => {
		seed();
	});

	it("invalidates the tenant's settings and analytics only after a successful write", async () => {
		const write = vi.fn(async () => undefined);
		const { result } = renderHook(() => useSettingsMutation(write), {
			wrapper,
		});
		let ok = false;
		await act(async () => {
			ok = await result.current.save({ value: 1 });
		});
		expect(ok).toBe(true);
		expect(write).toHaveBeenCalledWith({ kind: "demo" }, TENANT, { value: 1 });
		await waitFor(() => expect(result.current.saved).toBe(true));
		expect(stale(["analytics", "demo", TENANT, "item_summary", {}])).toBe(true);
		expect(stale(["settings", "demo", TENANT, "reportSettings"])).toBe(true);
		expect(stale(["analytics", "demo", OTHER, "item_summary", {}])).toBe(false);
		expect(stale(["rows", "demo", TENANT])).toBe(false);
	});

	it("keeps every cache and reports the mapped code when the write is refused", async () => {
		const write = vi.fn(async () => {
			throw new SettingsWriteError(
				"invalid",
				"report_settings_peak_hours_check",
			);
		});
		const { result } = renderHook(() => useSettingsMutation(write), {
			wrapper,
		});
		let ok = true;
		await act(async () => {
			ok = await result.current.save({ value: 1 });
		});
		expect(ok).toBe(false);
		await waitFor(() => expect(result.current.errorCode).toBe("invalid"));
		expect(result.current.errorConstraint).toBe(
			"report_settings_peak_hours_check",
		);
		expect(stale(["analytics", "demo", TENANT, "item_summary", {}])).toBe(
			false,
		);
		expect(stale(["settings", "demo", TENANT, "reportSettings"])).toBe(false);
	});

	it.each([
		[new SettingsWriteError("forbidden"), "forbidden"],
		[new SettingsWriteError("duplicate"), "duplicate"],
		[new SettingsWriteError("invalid"), "invalid"],
		[new SettingsWriteError("frozen"), "frozen"],
		[new SettingsWriteError("network"), "network"],
		[new TypeError("Failed to fetch"), "network"],
	] as const)("maps %s to %s with a message", (error, code) => {
		expect(writeCodeOf(error)).toBe(code);
		expect(WRITE_ERROR_KEYS[code]).toBe(`settings.error.${code}`);
	});
});
