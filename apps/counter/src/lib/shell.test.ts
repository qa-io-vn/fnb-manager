import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, originOf } from "../../vite/csp";
import { counterEnvironment } from "../env";
import en from "../i18n/en.json";
import vi from "../i18n/vi.json";
import {
	addDays,
	clockOf,
	dayAndClock,
	minutesBetween,
	monthOf,
	vietnamDate,
} from "./time";

// counter:unit/shell: the environment, the CSP, the catalogs and Vietnam time.

describe("the environment", () => {
	it("is missing without the API address or the publishable key", () => {
		expect(counterEnvironment({}, "brand-1")).toBeNull();
		expect(
			counterEnvironment(
				{ VITE_SUPABASE_URL: "http://127.0.0.1:54321" },
				"brand-1",
			),
		).toBeNull();
	});

	it("names the sign-in function under the API by default and keeps an explicit one", () => {
		expect(
			counterEnvironment(
				{
					VITE_SUPABASE_URL: "https://x.example.com/",
					VITE_SUPABASE_PUBLISHABLE_KEY: "k",
				},
				"brand-2",
			),
		).toEqual({
			supabaseUrl: "https://x.example.com",
			publishableKey: "k",
			sessionUrl: "https://x.example.com/functions/v1/counter-session",
			checkoutUrl: "https://x.example.com/functions/v1/checkout-order",
			brand: "brand-2",
		});
		expect(
			counterEnvironment(
				{
					VITE_SUPABASE_URL: "https://x.example.com",
					VITE_SUPABASE_PUBLISHABLE_KEY: "k",
					VITE_COUNTER_SESSION_URL: "http://127.0.0.1:5767",
					VITE_BRAND_KEY: "brand-3",
				},
				"brand-1",
			)?.sessionUrl,
		).toBe("http://127.0.0.1:5767");
	});

	it("names the payment function under the API by default and keeps an explicit one", () => {
		expect(
			counterEnvironment(
				{
					VITE_SUPABASE_URL: "https://x.example.com",
					VITE_SUPABASE_PUBLISHABLE_KEY: "k",
					VITE_CHECKOUT_ORDER_URL: " http://127.0.0.1:5768 ",
				},
				"brand-1",
			)?.checkoutUrl,
		).toBe("http://127.0.0.1:5768");
	});
});

describe("the content security policy", () => {
	it("lets scripts come only from the app and calls go only to the app, the API and the function", () => {
		const policy = contentSecurityPolicy([
			originOf("https://api.example.com/rest"),
			originOf("https://fn.example.com/x"),
			null,
		]);
		expect(policy).toContain("script-src 'self'");
		expect(policy).toContain(
			"connect-src 'self' https://api.example.com https://fn.example.com",
		);
		expect(policy).toContain("object-src 'none'");
		expect(policy).not.toContain("unsafe-eval");
		expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
	});

	it("drops an address it cannot read", () => {
		expect(originOf("not a url")).toBeNull();
		expect(originOf(undefined)).toBeNull();
	});
});

describe("the catalogs", () => {
	it("have the same keys in Vietnamese and English, none empty", () => {
		expect(Object.keys(en).sort()).toEqual(Object.keys(vi).sort());
		for (const catalog of [vi, en]) {
			for (const [key, text] of Object.entries(catalog)) {
				expect(text.trim(), key).not.toBe("");
			}
		}
	});

	it("use the same placeholders in both languages", () => {
		const placeholders = (text: string) =>
			[...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
		for (const [key, text] of Object.entries(vi)) {
			expect(
				placeholders((en as Record<string, string>)[key] ?? ""),
				key,
			).toEqual(placeholders(text));
		}
	});
});

describe("Vietnam time", () => {
	it("writes a clock and a date seven hours ahead of UTC, across midnight (boundary)", () => {
		expect(clockOf("2026-11-27T16:59:00Z")).toBe("23:59");
		expect(vietnamDate("2026-11-27T16:59:59Z")).toBe("2026-11-27");
		expect(clockOf("2026-11-27T17:00:00Z")).toBe("00:00");
		expect(vietnamDate("2026-11-27T17:00:00Z")).toBe("2026-11-28");
		expect(dayAndClock("2026-11-27T07:36:00Z")).toBe("27/11 14:36");
	});

	it("counts whole minutes, never below zero", () => {
		const start = Date.parse("2026-11-27T07:00:00Z");
		expect(minutesBetween("2026-11-27T07:00:00Z", start + 59_999)).toBe(0);
		expect(minutesBetween("2026-11-27T07:00:00Z", start + 60_000)).toBe(1);
		expect(minutesBetween("2026-11-27T07:00:00Z", start - 60_000)).toBe(0);
		expect(minutesBetween("not a time", start)).toBe(0);
	});

	it("moves dates and finds the month", () => {
		expect(monthOf("2026-11-27")).toBe("2026-11-01");
		expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
		expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
		expect(() => clockOf("nope")).toThrow(RangeError);
	});
});
