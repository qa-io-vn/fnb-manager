// Test design: boundary values around the date line between UTC and Vietnam time (17:00 UTC is midnight in Vietnam),
// and a state transition from no stores to a store, which must give the store's day in the very first render.
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAsOf } from "./use-as-of";

const VIETNAM = { timeZone: "Asia/Ho_Chi_Minh", businessDayStartMinutes: 0 };

afterEach(() => {
	vi.useRealTimers();
});

function at(iso: string): void {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date(iso));
}

describe("useAsOf", () => {
	it.each([
		["2026-11-19T16:59:59Z", "2026-11-18"],
		["2026-11-19T17:00:00Z", "2026-11-19"],
		["2026-11-19T17:30:00Z", "2026-11-19"],
		["2026-11-20T05:30:00Z", "2026-11-19"],
	])("gives the day before the store's own today at %s as %s", (now, expected) => {
		at(now);
		const { result } = renderHook(() => useAsOf([VIETNAM]));
		expect(result.current).toBe(expected);
	});

	it("gives the store's day in the first render with the store, never the day of the empty list", () => {
		at("2026-11-19T17:30:00Z");
		const seen: string[] = [];
		const { rerender } = renderHook(
			({ stores }) => {
				const value = useAsOf(stores);
				seen.push(value);
				return value;
			},
			{ initialProps: { stores: [] as (typeof VIETNAM)[] } },
		);
		seen.length = 0;
		rerender({ stores: [VIETNAM] });
		expect(seen).toEqual(["2026-11-19"]);
	});

	it("reads the clock again when the page becomes visible", () => {
		at("2026-11-19T10:00:00Z");
		const { result } = renderHook(() => useAsOf([VIETNAM]));
		expect(result.current).toBe("2026-11-18");
		at("2026-11-19T17:30:00Z");
		act(() => {
			document.dispatchEvent(new Event("visibilitychange"));
		});
		expect(result.current).toBe("2026-11-19");
	});
});
