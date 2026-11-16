import { legalDraftSkeleton, legalVersionLabel } from "@fnb/demo-analytics";
import { describe, expect, it } from "vitest";
import type { LegalDocumentRow } from "../manual/source";
import {
	changedDraftFields,
	LEGAL_SKELETON_HEADINGS,
	LEGAL_VERSION_PATTERN,
	legalDraftChangeOf,
	legalDraftIssues,
	legalGroupsOf,
	legalSkeleton,
	legalVersionLabelOf,
	suggestedLegalVersion,
	takenVersionsOf,
} from "./legal-rules";

function row(overrides: Partial<LegalDocumentRow>): LegalDocumentRow {
	return {
		id: "doc",
		kind: "privacy_notice",
		language: "vi",
		version: "privacy-notice-2026-11",
		title: "Thông báo",
		bodyMarkdown: "## Liên hệ",
		status: "draft",
		publishedAt: null,
		retiredAt: null,
		audit: null,
		...overrides,
	};
}

describe("the legal version label", () => {
	it.each([
		["privacy-notice-2026-11", true],
		["v1", true],
		["2026.11-a", true],
		["a".repeat(40), true],
		["a".repeat(41), false],
		["Privacy-notice", false],
		["-privacy", false],
		[".privacy", false],
		["thông-báo", false],
		["privacy notice", false],
		["privacy_notice", false],
		["", false],
	])("%s passes the database's pattern: %s", (label, passes) => {
		expect(LEGAL_VERSION_PATTERN.test(label)).toBe(passes);
	});

	it("is suggested as <kind>-YYYY-MM like the demo engine, with a suffix when that label is taken", () => {
		expect(legalVersionLabelOf("marketing_consent_text", "2026-11-16")).toBe(
			legalVersionLabel("marketing_consent_text", "2026-11-16"),
		);
		expect(suggestedLegalVersion("staff_notice", "2026-11-16", new Set())).toBe(
			"staff-notice-2026-11",
		);
		expect(
			suggestedLegalVersion(
				"staff_notice",
				"2026-11-16",
				new Set(["staff-notice-2026-11", "staff-notice-2026-11.2"]),
			),
		).toBe("staff-notice-2026-11.3");
		expect(
			LEGAL_VERSION_PATTERN.test(
				suggestedLegalVersion(
					"marketing_consent_text",
					"2026-11-16",
					new Set(["marketing-consent-text-2026-11"]),
				),
			),
		).toBe(true);
	});
});

describe("the skeleton", () => {
	it.each(["vi", "en"] as const)(
		"in %s holds the six headings of the demo engine and nothing else",
		(language) => {
			const skeleton = legalSkeleton(language);
			expect(skeleton).toBe(legalDraftSkeleton(language));
			const lines = skeleton.split("\n").filter((line) => line !== "");
			expect(lines).toHaveLength(6);
			expect(lines.every((line) => /^## \S/.test(line))).toBe(true);
			expect(lines.map((line) => line.slice(3))).toEqual(
				LEGAL_SKELETON_HEADINGS[language],
			);
		},
	);
});

describe("a draft's fields", () => {
	const filled = {
		title: "Thông báo bảo mật",
		version: "privacy-notice-2026-11",
		bodyMarkdown: "## Liên hệ",
	};

	it("need a title, a valid and unused label and a text, within the database's lengths", () => {
		expect(legalDraftIssues(filled, new Set())).toEqual({});
		expect(
			legalDraftIssues(
				{ title: "  ", version: "", bodyMarkdown: "\n" },
				new Set(),
			),
		).toEqual({
			title: { key: "required" },
			version: { key: "required" },
			bodyMarkdown: { key: "required" },
		});
		expect(
			legalDraftIssues(
				{ ...filled, title: "ệ".repeat(201), version: "Bản 1" },
				new Set(),
			),
		).toEqual({
			title: { key: "textLength", max: 200 },
			version: { key: "versionFormat" },
		});
		expect(
			legalDraftIssues(
				{ ...filled, bodyMarkdown: "a".repeat(100_001) },
				new Set(),
			),
		).toEqual({ bodyMarkdown: { key: "textLength", max: 100_000 } });
		expect(
			legalDraftIssues(filled, new Set(["privacy-notice-2026-11"])),
		).toEqual({ version: { key: "versionTaken" } });
		expect(
			legalDraftIssues(
				{ ...filled, title: "ệ".repeat(200), version: " v2 " },
				new Set(),
			),
		).toEqual({});
	});

	it("are sent trimmed, with the id only for a draft that exists", () => {
		const fields = { ...filled, title: " Thông báo ", version: " v2 " };
		expect(legalDraftChangeOf("privacy_notice", "vi", null, fields)).toEqual({
			kind: "privacy_notice",
			language: "vi",
			title: "Thông báo",
			version: "v2",
			bodyMarkdown: "## Liên hệ",
		});
		expect(
			legalDraftChangeOf("privacy_notice", "en", "doc-1", fields),
		).toMatchObject({ id: "doc-1", language: "en" });
		expect(changedDraftFields(filled, { ...filled, title: " " })).toEqual([
			"title",
		]);
		expect(
			changedDraftFields(filled, { ...filled, version: ` ${filled.version}` }),
		).toEqual([]);
	});
});

describe("the lists", () => {
	it("hold one list per kind and language, the version in force first, then the drafts, then the retired ones newest first", () => {
		const rows = [
			row({
				id: "old",
				version: "a-old",
				status: "retired",
				publishedAt: "2026-01-01T00:00:00Z",
				retiredAt: "2026-03-01T00:00:00Z",
			}),
			row({ id: "draft", version: "c-draft" }),
			row({
				id: "newer",
				version: "b-newer",
				status: "retired",
				publishedAt: "2026-03-01T00:00:00Z",
				retiredAt: "2026-06-01T00:00:00Z",
			}),
			row({
				id: "now",
				version: "z-now",
				status: "published",
				publishedAt: "2026-06-01T00:00:00Z",
			}),
			row({ id: "english", language: "en", version: "en-1" }),
		];
		const groups = legalGroupsOf(rows);
		expect(groups.map((group) => `${group.kind}:${group.language}`)).toEqual([
			"privacy_notice:vi",
			"privacy_notice:en",
			"data_protection_rules:vi",
			"data_protection_rules:en",
			"mini_app_terms:vi",
			"mini_app_terms:en",
			"staff_notice:vi",
			"staff_notice:en",
			"loyalty_consent_text:vi",
			"loyalty_consent_text:en",
			"marketing_consent_text:vi",
			"marketing_consent_text:en",
		]);
		const [vietnamese, english] = groups;
		expect(vietnamese?.versions.map((version) => version.id)).toEqual([
			"now",
			"draft",
			"newer",
			"old",
		]);
		expect(vietnamese?.current?.id).toBe("now");
		expect(english?.current).toBeNull();
		expect(english?.versions.map((version) => version.id)).toEqual(["english"]);
		expect(
			vietnamese === undefined ? [] : [...takenVersionsOf(vietnamese, "draft")],
		).toEqual(["z-now", "b-newer", "a-old"]);
	});
});
