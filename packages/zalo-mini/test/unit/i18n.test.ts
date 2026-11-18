import { describe, expect, it } from "vitest";
import en from "../../src/i18n/messages/en.json";
import vi from "../../src/i18n/messages/vi.json";
import {
	catalogParity,
	createTranslator,
	interpolate,
	languageFrom,
	mergeCatalogs,
} from "../../src/i18n/translate";
import { MEMBER_ROLES } from "../../src/session/types";

describe("shared catalogues", () => {
	it("have the same keys and placeholders in Vietnamese and English", () => {
		expect(catalogParity(vi, en)).toEqual({
			missingInEnglish: [],
			missingInVietnamese: [],
			placeholderMismatches: [],
			empty: [],
		});
	});

	it("name every member role", () => {
		for (const role of MEMBER_ROLES) {
			expect(Object.hasOwn(vi, `role.${role}`)).toBe(true);
		}
	});

	it("report a missing English key, a stray key and a placeholder mismatch", () => {
		expect(
			catalogParity(
				{ a: "Xin chào {name}", b: "Có" },
				{ a: "Hello {person}", c: "Extra" },
			),
		).toEqual({
			missingInEnglish: ["b"],
			missingInVietnamese: ["c"],
			placeholderMismatches: ["a"],
			empty: [],
		});
	});
});

describe("translator", () => {
	it("fills placeholders and reports a missing key", () => {
		const missing: string[] = [];
		const t = createTranslator(vi, (key) => missing.push(key));
		expect(t("session.greeting", { name: "An" })).toBe("Xin chào, An");
		expect(t("session.unknown")).toBe("session.unknown");
		expect(missing).toEqual(["session.unknown"]);
		expect(interpolate("{a} {b}", { a: 1 })).toBe("1 {b}");
	});

	it("follows Zalo's language and defaults to Vietnamese", () => {
		expect(languageFrom("en")).toBe("en");
		expect(languageFrom("en-US")).toBe("en");
		expect(languageFrom("vi")).toBe("vi");
		expect(languageFrom("")).toBe("vi");
		expect(languageFrom(undefined)).toBe("vi");
	});

	it("refuses a key defined twice when catalogues merge", () => {
		expect(() => mergeCatalogs({ a: "1" }, { a: "2" })).toThrow(
			"message key a is defined twice",
		);
	});
});
