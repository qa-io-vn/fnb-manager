import {
	MAX_THEME_RANGE_DAYS,
	SHIFT_THEME_RANGE_DAYS,
	THEME_ORDER,
	themeDefinitions,
} from "@fnb/reports";
import { describe, expect, it } from "vitest";
import { isMessageKey } from "../i18n";
import { laterThemeOfSlug, themeTabEntries } from "./theme-tabs";

describe("the theme tabs", () => {
	it("list the eight themes in roadmap order, the built ones from their definitions", () => {
		const entries = themeTabEntries();
		expect(entries.map((entry) => entry.kind)).toEqual(THEME_ORDER);
		expect(
			entries.filter((entry) => entry.built).map((entry) => entry.kind),
		).toEqual([
			"revenue",
			"hours",
			"menu",
			"payments",
			"promotions",
			"shifts",
			"stores",
		]);
		for (const entry of entries) {
			expect(isMessageKey(entry.titleKey), entry.titleKey).toBe(true);
			const definition = themeDefinitions[entry.kind];
			if (definition !== undefined) {
				expect(entry.slug).toBe(definition.slug);
				expect(entry.maxRangeDays).toBe(definition.maxRangeDays);
			}
		}
	});

	it("shorten a range to 92 days on the way to Ca & két tiền", () => {
		const shifts = themeTabEntries().find(
			(entry) => entry.slug === "ca-ket-tien",
		);
		expect(shifts?.built).toBe(true);
		expect(shifts?.maxRangeDays).toBe(SHIFT_THEME_RANGE_DAYS);
	});

	it("give the themes of 10b still to come their slugs and never shorten a range on the way to one", () => {
		const later = themeTabEntries().filter((entry) => !entry.built);
		expect(later.map((entry) => [entry.slug, entry.maxRangeDays])).toEqual([
			["chat-luong", MAX_THEME_RANGE_DAYS],
		]);
	});

	it("find a theme of 10b still to come by its slug, and nothing for a built or unknown one", () => {
		expect(laterThemeOfSlug("chat-luong")?.kind).toBe("quality");
		expect(laterThemeOfSlug("ca-ket-tien")).toBeNull();
		expect(laterThemeOfSlug("doanh-thu")).toBeNull();
		expect(laterThemeOfSlug("khuyen-mai")).toBeNull();
		expect(laterThemeOfSlug("so-sanh")).toBeNull();
		expect(laterThemeOfSlug("khong-co")).toBeNull();
		expect(laterThemeOfSlug(undefined)).toBeNull();
	});
});
