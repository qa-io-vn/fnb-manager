import { type PromotionRule, promotionRules } from "@fnb/core";
import { describe, expect, it } from "vitest";
import {
	discountClass,
	isRuleInForce,
	type LuckyDrawMatch,
	luckyDrawKeywordsOn,
	luckyDrawMatches,
	ruleInForce,
	ruleSegments,
	rulesInForce,
} from "../../../src/themes/rules.js";

const VN = promotionRules("VN");

function capRule(
	validFrom: string,
	validTo: string | null,
	maxDiscountRate: number,
): PromotionRule {
	return {
		id: "discount_cap",
		countryCode: "XX",
		validFrom,
		validTo,
		parameters: { maxDiscountRate, concentratedMaxDiscountRate: 1 },
		legalBasis: {
			instrument: "circular",
			number: "1/2030/TT-BCT",
			articles: [1],
		},
		sources: [{ title: "Synthetic", url: "https://example.com/rule" }],
		checkedOn: "2030-01-01",
		legalWatch: false,
		notes: [{ en: "Synthetic rule.", vi: "Quy định giả lập." }],
	};
}

function exact(...keywords: string[]): LuckyDrawMatch[] {
	return keywords.map((keyword) => ({ keyword, exact: true }));
}

describe("rules in force", () => {
	it("keeps the discount-day limit up to 25 June 2026 and a cap on both sides", () => {
		expect(rulesInForce(VN, "2026-06-25").map((rule) => rule.id)).toEqual([
			"discount_cap",
			"discount_days",
			"lucky_draw_registration",
		]);
		expect(rulesInForce(VN, "2026-06-26").map((rule) => rule.id)).toEqual([
			"discount_cap",
			"lucky_draw_registration",
		]);
		expect(ruleInForce(VN, "discount_days", "2026-06-26")).toBe(null);
		expect(
			ruleInForce(VN, "discount_cap", "2026-06-26")?.parameters.maxDiscountRate,
		).toBe(0.5);
		expect(
			ruleInForce(VN, "discount_cap", "2025-06-30")?.legalBasis.number,
		).toBe("81/2018/NĐ-CP");
		expect(ruleInForce(VN, "discount_cap", "2018-05-21")).toBe(null);
	});

	it("treats both ends of a rule's dates as in force", () => {
		const rule = capRule("2030-01-01", "2030-01-31", 0.4);
		expect(isRuleInForce(rule, "2029-12-31")).toBe(false);
		expect(isRuleInForce(rule, "2030-01-01")).toBe(true);
		expect(isRuleInForce(rule, "2030-01-31")).toBe(true);
		expect(isRuleInForce(rule, "2030-02-01")).toBe(false);
	});

	it("refuses two versions of one rule in force on the same day", () => {
		const overlapping = [
			capRule("2030-01-01", "2030-01-31", 0.4),
			capRule("2030-01-15", null, 0.3),
		];
		expect(() =>
			ruleInForce(overlapping, "discount_cap", "2030-01-20"),
		).toThrow(/two discount_cap rules/);
	});
});

describe("rule segments", () => {
	it("splits a range at the repeal of the discount-day limit", () => {
		expect(
			ruleSegments(VN, "discount_days", {
				from: "2026-06-01",
				to: "2026-07-31",
			}).map(({ from, to, rule }) => [from, to, rule?.id ?? null]),
		).toEqual([
			["2026-06-01", "2026-06-25", "discount_days"],
			["2026-06-26", "2026-07-31", null],
		]);
	});

	it("keeps the cap as one segment across that change and splits it where the circular takes over", () => {
		expect(
			ruleSegments(VN, "discount_cap", {
				from: "2026-06-01",
				to: "2026-07-31",
			}),
		).toHaveLength(1);
		expect(
			ruleSegments(VN, "discount_cap", {
				from: "2025-06-01",
				to: "2025-07-10",
			}).map(({ from, to, rule }) => [from, to, rule?.legalBasis.number]),
		).toEqual([
			["2025-06-01", "2025-06-30", "81/2018/NĐ-CP"],
			["2025-07-01", "2025-07-10", "39/2025/TT-BCT"],
		]);
	});

	it("gives each version of a rule its own parameters and leaves the uncovered days without a rule", () => {
		const rules = [
			capRule("2030-01-10", "2030-01-19", 0.4),
			capRule("2030-01-20", null, 0.3),
		];
		expect(
			ruleSegments(rules, "discount_cap", {
				from: "2030-01-01",
				to: "2030-01-31",
			}).map(({ from, to, rule }) => [
				from,
				to,
				rule?.parameters.maxDiscountRate ?? null,
			]),
		).toEqual([
			["2030-01-01", "2030-01-09", null],
			["2030-01-10", "2030-01-19", 0.4],
			["2030-01-20", "2030-01-31", 0.3],
		]);
	});

	it("covers a one-day range and refuses a backwards one", () => {
		expect(
			ruleSegments(VN, "discount_days", {
				from: "2026-06-25",
				to: "2026-06-25",
			}),
		).toHaveLength(1);
		expect(() =>
			ruleSegments(VN, "discount_days", {
				from: "2026-06-26",
				to: "2026-06-25",
			}),
		).toThrow(/ends before it starts/);
	});
});

describe("discount classes", () => {
	it("counts a discount as over the cap only above the cap and below the whole amount", () => {
		expect(discountClass(0, 50_000, 0.5)).toBe("none");
		expect(discountClass(10_000, 50_000, 0.5)).toBe("within_cap");
		expect(discountClass(25_000, 50_000, 0.5)).toBe("within_cap");
		expect(discountClass(0.1 + 0.2 + 0.2, 1, 0.5)).toBe("within_cap");
		expect(discountClass(25_500, 50_000, 0.5)).toBe("over_cap");
		expect(discountClass(49_999, 50_000, 0.5)).toBe("over_cap");
		expect(discountClass(50_000, 50_000, 0.5)).toBe("full");
		expect(discountClass(60_000, 50_000, 0.5)).toBe("full");
		expect(discountClass(0, 0, 0.5)).toBe("none");
		expect(discountClass(50_000, 50_000, 1)).toBe("full");
		expect(discountClass(40_000, 50_000, 1)).toBe("within_cap");
	});

	it("refuses a cap outside (0, 1] and amounts that are not finite", () => {
		for (const cap of [Number.NaN, 0, -0.5, 1.5, Number.POSITIVE_INFINITY]) {
			expect(() => discountClass(10, 100, cap)).toThrow(RangeError);
		}
		expect(() => discountClass(Number.NaN, 100, 0.5)).toThrow(RangeError);
		expect(() => discountClass(10, Number.POSITIVE_INFINITY, 0.5)).toThrow(
			RangeError,
		);
	});
});

describe("lucky-draw keywords", () => {
	const keywords = luckyDrawKeywordsOn(VN, "2026-11-01");

	it("matches promotion names in any case, Unicode form and word separator", () => {
		expect(
			luckyDrawMatches("Chương trình BỐC THĂM tháng 11", keywords),
		).toEqual(exact("bốc thăm"));
		expect(
			luckyDrawMatches("Vòng quay may mắn".normalize("NFD"), keywords),
		).toEqual(exact("may mắn", "vòng quay"));
		expect(luckyDrawMatches("Lucky  Draw weekend", keywords)).toEqual(
			exact("lucky draw"),
		);
		expect(luckyDrawMatches("#LuckyDraw", keywords)).toEqual(
			exact("lucky draw"),
		);
		expect(luckyDrawMatches("bốc-thăm_trúng thưởng", keywords)).toEqual(
			exact("bốc thăm", "trúng thưởng"),
		);
	});

	it("reports a name written without tone marks as a possible match", () => {
		expect(luckyDrawMatches("CT_BOC_THAM_T11", keywords)).toEqual([
			{ keyword: "bốc thăm", exact: false },
		]);
		expect(luckyDrawMatches("QUAY SO MAY MAN", keywords)).toEqual([
			{ keyword: "quay số", exact: false },
			{ keyword: "may mắn", exact: false },
		]);
		expect(luckyDrawMatches("Rut li xi dau nam", keywords)).toEqual([
			{ keyword: "rút lì xì", exact: false },
		]);
	});

	it("does not match a word that merely contains a keyword", () => {
		expect(luckyDrawMatches("Raffles combo", keywords)).toEqual([]);
		expect(luckyDrawMatches("Giảm 20% toàn menu", keywords)).toEqual([]);
		expect(luckyDrawMatches("Mua 1 tặng 1", keywords)).toEqual([]);
		expect(luckyDrawMatches("Quà", ["quà"])).toEqual(exact("quà"));
		expect(luckyDrawMatches("Quày bar", ["quà"])).toEqual([]);
		expect(luckyDrawMatches("Quầy bar", ["quà"])).toEqual([]);
	});

	it("takes the keywords of the rule in force and none before it", () => {
		expect(keywords.length).toBeGreaterThan(0);
		expect(luckyDrawKeywordsOn(VN, "2018-05-21")).toEqual([]);
		expect(luckyDrawMatches("bốc thăm", ["", "  "])).toEqual([]);
		expect(luckyDrawMatches("a(b c++", ["a(b", "c++"])).toEqual(
			exact("a(b", "c++"),
		);
	});
});
