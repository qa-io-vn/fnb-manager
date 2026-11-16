import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { defaultPeriod } from "../lib/period";
import {
	defaultPreferences,
	loadPreferences,
	PREFERENCES_KEY,
	PreferencesProvider,
	storedPreferencesOf,
	usePreferences,
	withDefaultLanguage,
} from "./preferences";

const morning = new Date("2026-11-08T02:00:00.000Z");

function store(value: unknown) {
	window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(value));
}

describe("stored preferences", () => {
	afterEach(() => window.localStorage.clear());

	it("keeps the stored period on the day it was chosen", () => {
		store({
			language: "en",
			period: { ...defaultPeriod("2026-11-03"), kind: "week" },
			periodSetOn: "2026-11-08",
		});
		const preferences = loadPreferences(morning);
		expect(preferences.language).toBe("en");
		expect(preferences.period.kind).toBe("week");
		expect(preferences.period.anchor).toBe("2026-11-03");
	});

	it("moves the anchor to today on a later day and keeps the kind and custom range", () => {
		const custom = { from: "2026-10-01", to: "2026-10-31" };
		store({
			period: { kind: "month", anchor: "2026-11-05", custom },
			periodSetOn: "2026-11-05",
		});
		const preferences = loadPreferences(morning);
		expect(preferences.period).toEqual({
			kind: "month",
			anchor: "2026-11-08",
			custom,
		});
		expect(preferences.periodSetOn).toBe("2026-11-08");
	});

	it("re-anchors a period stored without its date", () => {
		store({ period: defaultPeriod("2026-10-20") });
		expect(loadPreferences(morning).period.anchor).toBe("2026-11-08");
	});

	it("keeps the device's CSV format and falls back to comma", () => {
		expect(loadPreferences(morning).csvDialect).toBe("comma");
		store({ csvDialect: "semicolon" });
		expect(loadPreferences(morning).csvDialect).toBe("semicolon");
		store({ csvDialect: "tab" });
		expect(loadPreferences(morning).csvDialect).toBe("comma");
	});

	it("keeps the last theme preset and drops one it does not know", () => {
		expect(loadPreferences(morning).themePreset).toBeNull();
		store({ themePreset: "91d" });
		expect(loadPreferences(morning).themePreset).toBe("91d");
		store({ themePreset: "custom" });
		expect(loadPreferences(morning).themePreset).toBeNull();
		store({ themePreset: 28 });
		expect(loadPreferences(morning).themePreset).toBeNull();
	});

	it("falls back to the defaults when storage holds something else", () => {
		window.localStorage.setItem(PREFERENCES_KEY, "not json");
		expect(loadPreferences(morning).period).toEqual(
			defaultPeriod("2026-11-08"),
		);
	});
});

function stored(): Record<string, unknown> {
	return JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) ?? "{}");
}

describe("the tenant's default language", () => {
	afterEach(() => window.localStorage.clear());

	it("counts a language as chosen only when this device stored it as chosen", () => {
		expect(loadPreferences(morning)).toMatchObject({
			language: "vi",
			languageChosen: false,
		});
		store({ language: "vi", languageChosen: true });
		expect(loadPreferences(morning)).toMatchObject({
			language: "vi",
			languageChosen: true,
		});
		store({ language: "en", languageChosen: true });
		expect(loadPreferences(morning)).toMatchObject({
			language: "en",
			languageChosen: true,
		});
		store({ language: "fr", languageChosen: true });
		expect(loadPreferences(morning).languageChosen).toBe(false);
	});

	it("ignores the Vietnamese an earlier version saved without a choice, and keeps an English only the toggle could have saved", () => {
		store({ language: "vi", csvDialect: "semicolon" });
		expect(loadPreferences(morning)).toMatchObject({
			language: "vi",
			languageChosen: false,
			csvDialect: "semicolon",
		});
		store({ language: "en" });
		expect(loadPreferences(morning)).toMatchObject({
			language: "en",
			languageChosen: true,
		});
	});

	it("applies the tenant's language only without a chosen one", () => {
		const fresh = defaultPreferences(morning);
		expect(withDefaultLanguage(fresh, "en").language).toBe("en");
		const chosen = { ...fresh, languageChosen: true };
		expect(withDefaultLanguage(chosen, "en")).toBe(chosen);
	});

	it("stores the language only once it was chosen, marked as chosen", () => {
		const fresh = { ...defaultPreferences(morning), language: "en" as const };
		expect(storedPreferencesOf(fresh)).not.toHaveProperty("language");
		expect(storedPreferencesOf(fresh)).not.toHaveProperty("languageChosen");
		expect(
			storedPreferencesOf({ ...fresh, languageChosen: true }),
		).toMatchObject({ language: "en", languageChosen: true });
	});

	it("follows the tenant's language on a device without a stored one, until the toggle is used", () => {
		const { result } = renderHook(() => usePreferences(), {
			wrapper: PreferencesProvider,
		});
		act(() => result.current.adoptDefaultLanguage("en"));
		expect(result.current.preferences.language).toBe("en");
		act(() => result.current.update({ csvDialect: "semicolon" }));
		expect(stored()).not.toHaveProperty("language");
		expect(stored().csvDialect).toBe("semicolon");
		act(() => result.current.update({ language: "vi" }));
		expect(stored()).toMatchObject({ language: "vi", languageChosen: true });
		act(() => result.current.adoptDefaultLanguage("en"));
		expect(result.current.preferences.language).toBe("vi");
	});

	it("keeps a chosen language over the tenant's, and follows the tenant's over an old unmarked one", () => {
		store({ language: "vi" });
		const before = renderHook(() => usePreferences(), {
			wrapper: PreferencesProvider,
		});
		act(() => before.result.current.adoptDefaultLanguage("en"));
		expect(before.result.current.preferences.language).toBe("en");
		before.unmount();
		store({ language: "vi", languageChosen: true });
		const { result } = renderHook(() => usePreferences(), {
			wrapper: PreferencesProvider,
		});
		act(() => result.current.adoptDefaultLanguage("en"));
		expect(result.current.preferences.language).toBe("vi");
	});
});
