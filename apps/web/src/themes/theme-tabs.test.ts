import {
	SHIFT_THEME_RANGE_DAYS,
	THEME_ORDER,
	THEME_SLUGS,
	themeDefinitions,
} from "@fnb/reports";
import { describe, expect, it } from "vitest";
import { isMessageKey } from "../i18n";
import { themeTabEntries } from "./theme-tabs";

describe("the theme tabs", () => {
	it("list the eight themes in roadmap order, each from its definition", () => {
		const entries = themeTabEntries();
		expect(entries.map((entry) => entry.kind)).toEqual(THEME_ORDER);
		expect(entries.map((entry) => entry.slug)).toEqual([
			"doanh-thu",
			"gio-ngay",
			"thuc-don",
			"thanh-toan",
			"khuyen-mai",
			"ca-ket-tien",
			"so-sanh",
			"chat-luong",
		]);
		for (const entry of entries) {
			expect(isMessageKey(entry.titleKey), entry.titleKey).toBe(true);
			const definition = themeDefinitions[entry.kind];
			expect(entry.slug).toBe(definition.slug);
			expect(entry.slug).toBe(THEME_SLUGS[entry.kind]);
			expect(entry.titleKey).toBe(definition.titleKey);
			expect(entry.maxRangeDays).toBe(definition.maxRangeDays);
		}
	});

	it("shorten a range to 92 days on the way to Ca & két tiền", () => {
		const shifts = themeTabEntries().find(
			(entry) => entry.slug === "ca-ket-tien",
		);
		expect(shifts?.maxRangeDays).toBe(SHIFT_THEME_RANGE_DAYS);
	});
});
