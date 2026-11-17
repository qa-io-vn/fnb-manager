import {
	formatLegalBasis,
	type PromotionRule,
	promotionRules,
} from "@fnb/core";
import { benchmarkContext } from "@fnb/metrics";
import { describe, expect, it } from "vitest";
import {
	CONTEXT_NOTE,
	packContext,
	ruleSentence,
	rulesInForce,
} from "../../src/pack/context.js";
import { PACK_LANGUAGES } from "../../src/pack/request.js";

function ids(rules: readonly PromotionRule[]): string[] {
	return rules.map((rule) => `${rule.id}@${rule.validFrom}`);
}

describe("the promotion rules in the context", () => {
	it("holds only the rules in force in the tenant's country on the as-of day", () => {
		expect(ids(rulesInForce("VN", "2026-11-11"))).toEqual([
			"discount_cap@2025-07-01",
			"lucky_draw_registration@2018-05-22",
		]);
		expect(ids(rulesInForce("VN", "2026-06-25"))).toEqual([
			"discount_cap@2025-07-01",
			"discount_days@2018-05-22",
			"lucky_draw_registration@2018-05-22",
		]);
		expect(ids(rulesInForce("VN", "2025-06-30"))).toEqual([
			"discount_cap@2018-05-22",
			"discount_days@2018-05-22",
			"lucky_draw_registration@2018-05-22",
		]);
		expect(rulesInForce("vn", "2026-11-11")).toHaveLength(2);
		expect(rulesInForce("TH", "2026-11-11")).toEqual([]);
		expect(rulesInForce("VN", "2018-05-21")).toEqual([]);
	});

	it("does not send the yearly cap on discount days after its reported repeal", () => {
		for (const language of PACK_LANGUAGES) {
			const context = packContext(language, "VN", "2026-11-11");
			expect(context.rules.map(([id]) => id)).toEqual([
				"discount_cap",
				"lucky_draw_registration",
			]);
			expect(JSON.stringify(context.rules)).not.toContain("120");
		}
	});

	it("phrases every rule in both languages from its template, with basis, check date and the advice caveat", () => {
		const rules = promotionRules("VN");
		expect(new Set(rules.map((rule) => rule.id))).toEqual(
			new Set(["discount_cap", "discount_days", "lucky_draw_registration"]),
		);
		for (const rule of rules) {
			const vi = ruleSentence(rule, "vi");
			const en = ruleSentence(rule, "en");
			expect(vi).not.toBe(en);
			expect(vi).toContain(formatLegalBasis(rule.legalBasis, "vi"));
			expect(en).toContain(formatLegalBasis(rule.legalBasis, "en"));
			expect(vi).toContain("12/11/2026");
			expect(en).toContain("2026-11-12");
			expect(vi).toContain("không phải tư vấn pháp lý");
			expect(en).toContain("not legal advice");
		}
		const cap = rules.find((rule) => rule.id === "discount_cap");
		if (cap === undefined) throw new Error("no cap rule");
		expect(ruleSentence(cap, "en")).toMatch(/^A discount may not exceed 50 % /);
		expect(ruleSentence(cap, "vi")).toMatch(
			/^Mức giảm giá không được vượt quá 50 % /,
		);
	});

	it("keeps the dated benchmark entries apart, in registry order, with a note in the pack's language", () => {
		for (const language of PACK_LANGUAGES) {
			const context = packContext(language, "VN", "2026-11-11");
			expect(context.benchmarks).toEqual(
				benchmarkContext.map((entry) => [
					entry.id,
					entry.figure,
					entry.year,
					entry.source,
				]),
			);
			expect(context.note).toBe(CONTEXT_NOTE[language]);
			for (const [id, country, validFrom] of context.rules) {
				expect(country).toBe("VN");
				expect(
					promotionRules("VN").some(
						(rule) => rule.id === id && rule.validFrom === validFrom,
					),
				).toBe(true);
			}
		}
		expect(packContext("vi", "TH", "2026-11-11").rules).toEqual([]);
	});
});
