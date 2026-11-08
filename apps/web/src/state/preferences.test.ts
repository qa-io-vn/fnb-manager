import { afterEach, describe, expect, it } from "vitest";
import { defaultPeriod } from "../lib/period";
import { loadPreferences, PREFERENCES_KEY } from "./preferences";

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

	it("falls back to the defaults when storage holds something else", () => {
		window.localStorage.setItem(PREFERENCES_KEY, "not json");
		expect(loadPreferences(morning).period).toEqual(
			defaultPeriod("2026-11-08"),
		);
	});
});
