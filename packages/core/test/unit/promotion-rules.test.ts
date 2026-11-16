import { describe, expect, it } from "vitest";
import {
	formatLegalBasis,
	ISO_DATE_PATTERN,
	LUCKY_DRAW_KEYWORDS,
	PROMOTION_RULES_CHECKED_ON,
	type PromotionRule,
	type PromotionRuleId,
	promotionRules,
} from "../../src/index.js";

const VN = promotionRules("VN");
const REPEAL_DATE = "2026-06-26";
const LAST_DAY_OF_THE_DAYS_RULE = "2026-06-25";

function isRealDate(value: string): boolean {
	if (!ISO_DATE_PATTERN.test(value)) return false;
	const parsed = new Date(`${value}T00:00:00Z`);
	return (
		!Number.isNaN(parsed.getTime()) &&
		parsed.toISOString().slice(0, 10) === value
	);
}

function inForce(rule: PromotionRule, date: string): boolean {
	return (
		rule.validFrom <= date && (rule.validTo === null || date <= rule.validTo)
	);
}

function versionOn<Id extends PromotionRuleId>(
	id: Id,
	date: string,
): Extract<PromotionRule, { id: Id }> | undefined {
	return VN.find(
		(rule): rule is Extract<PromotionRule, { id: Id }> =>
			rule.id === id && inForce(rule, date),
	);
}

describe("promotionRules", () => {
	it("gives Vietnam two versions of the cap, the discount-day limit and the lucky-draw registration", () => {
		expect(VN.map((rule) => `${rule.id} ${rule.validFrom}`)).toEqual([
			"discount_cap 2018-05-22",
			"discount_cap 2025-07-01",
			"discount_days 2018-05-22",
			"lucky_draw_registration 2018-05-22",
		]);
		expect(promotionRules(" vn ")).toBe(VN);
	});

	it("returns no rule for a country without rules", () => {
		expect(promotionRules("TH")).toEqual([]);
		expect(promotionRules("")).toEqual([]);
		expect(promotionRules("toString")).toEqual([]);
	});

	it.each(
		VN.map((rule) => [`${rule.id} from ${rule.validFrom}`, rule] as const),
	)(
		"%s carries real dates, parameters, its legal basis, sources, notes in both languages and the check date",
		(_label, rule) => {
			expect(rule.countryCode).toBe("VN");
			expect(isRealDate(rule.validFrom)).toBe(true);
			if (rule.validTo !== null) {
				expect(isRealDate(rule.validTo)).toBe(true);
				expect(rule.validTo >= rule.validFrom).toBe(true);
			}
			expect(Object.keys(rule.parameters).length).toBeGreaterThan(0);
			for (const value of Object.values(rule.parameters)) {
				expect(value ?? null).not.toBeNull();
			}
			expect(["decree", "circular"]).toContain(rule.legalBasis.instrument);
			expect(rule.legalBasis.number).toMatch(/^\d+\/\d{4}\/(TT-BCT|NĐ-CP)$/);
			expect(rule.legalBasis.articles.length).toBeGreaterThan(0);
			for (const article of rule.legalBasis.articles) {
				expect(Number.isInteger(article) && article > 0).toBe(true);
			}
			expect(rule.sources.length).toBeGreaterThan(0);
			for (const source of rule.sources) {
				expect(source.title.trim()).not.toBe("");
				expect(new URL(source.url).protocol).toBe("https:");
			}
			expect(isRealDate(rule.checkedOn)).toBe(true);
			expect(rule.checkedOn).toBe(PROMOTION_RULES_CHECKED_ON);
			expect(rule.notes.length).toBeGreaterThan(0);
			for (const note of rule.notes) {
				expect(note.vi.trim()).not.toBe("");
				expect(note.en.trim()).not.toBe("");
			}
		},
	);

	it("never has two versions of one rule in force on the same day", () => {
		const ids = [...new Set(VN.map((rule) => rule.id))];
		for (const id of ids) {
			const versions = VN.filter((rule) => rule.id === id).sort((a, b) =>
				a.validFrom.localeCompare(b.validFrom),
			);
			for (const [index, version] of versions.entries()) {
				const next = versions[index + 1];
				if (next === undefined) continue;
				expect(version.validTo, `${id} ends before its next version`).not.toBe(
					null,
				);
				expect((version.validTo ?? "") < next.validFrom).toBe(true);
			}
		}
	});

	it("ends the discount-day limit on 25 June 2026 and keeps a cap on both sides of the change", () => {
		expect(versionOn("discount_days", LAST_DAY_OF_THE_DAYS_RULE)?.validTo).toBe(
			LAST_DAY_OF_THE_DAYS_RULE,
		);
		expect(versionOn("discount_days", REPEAL_DATE)).toBeUndefined();
		expect(
			versionOn("discount_cap", LAST_DAY_OF_THE_DAYS_RULE)?.parameters
				.maxDiscountRate,
		).toBe(0.5);
		expect(
			versionOn("discount_cap", REPEAL_DATE)?.parameters.maxDiscountRate,
		).toBe(0.5);
		expect(versionOn("discount_cap", "2025-06-30")?.legalBasis.number).toBe(
			"81/2018/NĐ-CP",
		);
		expect(versionOn("discount_cap", "2025-07-01")?.legalBasis.number).toBe(
			"39/2025/TT-BCT",
		);
		expect(versionOn("discount_cap", "2018-05-21")).toBeUndefined();
	});

	it("lets state-run concentrated programmes reach 100 % under both versions of the cap", () => {
		for (const date of ["2025-06-30", "2025-07-01", REPEAL_DATE]) {
			expect(versionOn("discount_cap", date)?.parameters).toEqual({
				maxDiscountRate: 0.5,
				concentratedMaxDiscountRate: 1,
			});
		}
		for (const rule of VN.filter((entry) => entry.id === "discount_cap")) {
			expect(rule.notes.map((note) => note.en)).toContain(
				"State-run concentrated promotion programmes allow up to 100 %.",
			);
		}
	});

	it("records the day limit and the keywords as parameters and every rule as a legal-watch item", () => {
		expect(versionOn("discount_days", "2026-01-01")?.parameters).toEqual({
			maxDaysPerItemYear: 120,
			counts: "price_discounts",
		});
		const draw = versionOn("lucky_draw_registration", "2026-11-01");
		expect(draw?.parameters.keywords).toBe(LUCKY_DRAW_KEYWORDS);
		expect(draw?.parameters.keywords).toEqual(
			expect.arrayContaining(["bốc thăm", "quay số", "lucky draw"]),
		);
		for (const keyword of LUCKY_DRAW_KEYWORDS) {
			expect(keyword).toBe(keyword.normalize("NFC").toLowerCase().trim());
		}
		expect(VN.every((rule) => rule.legalWatch)).toBe(true);
	});
});

describe("formatLegalBasis", () => {
	it("names the instrument and its articles in Vietnamese and English", () => {
		const cap = versionOn("discount_cap", "2026-01-01");
		const draw = versionOn("lucky_draw_registration", "2026-01-01");
		if (cap === undefined || draw === undefined) throw new Error("no rule");
		expect(formatLegalBasis(cap.legalBasis, "vi")).toBe(
			"Thông tư 39/2025/TT-BCT, Điều 4",
		);
		expect(formatLegalBasis(cap.legalBasis, "en")).toBe(
			"Circular 39/2025/TT-BCT, Article 4",
		);
		expect(formatLegalBasis(draw.legalBasis, "vi")).toBe(
			"Nghị định 81/2018/NĐ-CP, Điều 13 và 19",
		);
		expect(formatLegalBasis(draw.legalBasis, "en")).toBe(
			"Decree 81/2018/NĐ-CP, Articles 13 and 19",
		);
		expect(
			formatLegalBasis(
				{ instrument: "decree", number: "1/2030/NĐ-CP", articles: [8, 9, 11] },
				"en",
			),
		).toBe("Decree 1/2030/NĐ-CP, Articles 8, 9 and 11");
	});
});
