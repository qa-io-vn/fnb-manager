import type { PromotionRule, PromotionRuleId } from "@fnb/core";
import type { DateRange, IsoDate } from "../contract/values.js";
import { addDays } from "../period/dates.js";

export type RuleOf<Id extends PromotionRuleId> = Extract<
	PromotionRule,
	{ readonly id: Id }
>;

export interface RuleSegment<Id extends PromotionRuleId> {
	readonly from: IsoDate;
	readonly to: IsoDate;
	readonly rule: RuleOf<Id> | null;
}

export type DiscountClass = "none" | "within_cap" | "over_cap" | "full";

export interface LuckyDrawMatch {
	readonly keyword: string;
	readonly exact: boolean;
}

export const DISCOUNT_RATE_EPSILON = 1e-9;

const NOT_ALPHANUMERIC_BEFORE = "(?<![\\p{L}\\p{N}])";
const NOT_ALPHANUMERIC_AFTER = "(?![\\p{L}\\p{N}])";
const WORD_SEPARATOR = "[\\s_-]*";

export function isRuleInForce(rule: PromotionRule, date: IsoDate): boolean {
	return (
		rule.validFrom <= date && (rule.validTo === null || date <= rule.validTo)
	);
}

export function rulesInForce(
	rules: readonly PromotionRule[],
	date: IsoDate,
): PromotionRule[] {
	return rules.filter((rule) => isRuleInForce(rule, date));
}

export function ruleInForce<Id extends PromotionRuleId>(
	rules: readonly PromotionRule[],
	id: Id,
	date: IsoDate,
): RuleOf<Id> | null {
	const found = rules.filter(
		(rule): rule is RuleOf<Id> => rule.id === id && isRuleInForce(rule, date),
	);
	if (found.length > 1) {
		throw new Error(`two ${id} rules are in force on ${date}`);
	}
	return found[0] ?? null;
}

export function ruleSegments<Id extends PromotionRuleId>(
	rules: readonly PromotionRule[],
	id: Id,
	range: DateRange,
): RuleSegment<Id>[] {
	if (range.from > range.to) {
		throw new Error("the range ends before it starts");
	}
	const cuts = new Set<IsoDate>([range.from]);
	for (const rule of rules) {
		if (rule.id !== id) continue;
		const starts = [
			rule.validFrom,
			...(rule.validTo === null ? [] : [addDays(rule.validTo, 1)]),
		];
		for (const start of starts) {
			if (start > range.from && start <= range.to) cuts.add(start);
		}
	}
	const starts = [...cuts].sort();
	return starts.map((from, index) => {
		const next = starts[index + 1];
		return {
			from,
			to: next === undefined ? range.to : addDays(next, -1),
			rule: ruleInForce(rules, id, from),
		};
	});
}

export function discountClass(
	discount: number,
	base: number,
	cap: number,
): DiscountClass {
	if (!Number.isFinite(cap) || cap <= 0 || cap > 1) {
		throw new RangeError("a discount cap is a share above 0 and at most 1");
	}
	if (!Number.isFinite(discount) || !Number.isFinite(base)) {
		throw new RangeError("a discount and its base are finite amounts");
	}
	if (base <= 0 || discount <= 0) return "none";
	const rate = discount / base;
	if (rate >= 1 - DISCOUNT_RATE_EPSILON) return "full";
	return rate > cap + DISCOUNT_RATE_EPSILON ? "over_cap" : "within_cap";
}

function lowered(text: string): string {
	return text.normalize("NFC").toLocaleLowerCase("vi");
}

function withoutTones(text: string): string {
	return lowered(text)
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.replaceAll("đ", "d")
		.normalize("NFC");
}

function escaped(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function keywordPattern(keyword: string): RegExp {
	const words = keyword
		.trim()
		.split(/[\s_-]+/)
		.map(escaped);
	return new RegExp(
		`${NOT_ALPHANUMERIC_BEFORE}${words.join(WORD_SEPARATOR)}${NOT_ALPHANUMERIC_AFTER}`,
		"u",
	);
}

export function luckyDrawMatches(
	name: string,
	keywords: readonly string[],
): LuckyDrawMatch[] {
	const exactText = lowered(name);
	const plainText = withoutTones(name);
	return keywords.flatMap((keyword): LuckyDrawMatch[] => {
		if (keyword.trim() === "") return [];
		if (keywordPattern(lowered(keyword)).test(exactText)) {
			return [{ keyword, exact: true }];
		}
		return keywordPattern(withoutTones(keyword)).test(plainText)
			? [{ keyword, exact: false }]
			: [];
	});
}

export function luckyDrawKeywordsOn(
	rules: readonly PromotionRule[],
	date: IsoDate,
): readonly string[] {
	return (
		ruleInForce(rules, "lucky_draw_registration", date)?.parameters.keywords ??
		[]
	);
}
