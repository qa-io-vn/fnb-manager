import { shiftIsoDate } from "../../src/rules/business-date.js";
import {
	type DiscountCapRule,
	PROMOTION_RULE_COUNTRIES,
	type PromotionRule,
	promotionDiscountCap,
	promotionRules,
} from "../../src/rules/promotion-rules.js";

export const UNRULED_COUNTRY = "ZZ";

export interface DiscountCapFixtureRule {
	readonly countryCode: string;
	readonly validFrom: string;
	readonly validTo: string | null;
	readonly maxDiscountRate: number;
}

export interface DiscountCapCase {
	readonly countryCode: string;
	readonly from: string | null;
	readonly to: string | null;
	readonly cap: number | null;
}

export interface DiscountCapFixture {
	readonly rules: readonly DiscountCapFixtureRule[];
	readonly cases: readonly DiscountCapCase[];
}

function isDiscountCap(rule: PromotionRule): rule is DiscountCapRule {
	return rule.id === "discount_cap";
}

export function datedDiscountCapRules(): readonly DiscountCapRule[] {
	return PROMOTION_RULE_COUNTRIES.flatMap((country) =>
		promotionRules(country).filter(isDiscountCap),
	);
}

type Range = readonly [country: string, from: string | null, to: string | null];

function rangesOf(rule: DiscountCapRule): readonly Range[] {
	const country = rule.countryCode;
	const before = shiftIsoDate(rule.validFrom, -1);
	const after = shiftIsoDate(rule.validTo ?? rule.validFrom, 1);
	const ranges: Range[] = [
		[country, rule.validFrom, rule.validFrom],
		[country, before, before],
		[country, rule.validFrom, null],
		[country, null, before],
		[country, null, rule.validFrom],
		[country, before, after],
	];
	if (rule.validTo !== null) {
		ranges.push(
			[country, rule.validTo, rule.validTo],
			[country, after, after],
			[country, after, null],
			[country, null, rule.validTo],
			[country, rule.validFrom, rule.validTo],
		);
	}
	return ranges;
}

export function buildDiscountCapFixture(): DiscountCapFixture {
	const rules = datedDiscountCapRules();
	const ranges: Range[] = PROMOTION_RULE_COUNTRIES.map(
		(country) => [country, null, null] as const,
	);
	for (const rule of rules) {
		ranges.push(...rangesOf(rule));
	}
	const first = rules[0];
	if (first !== undefined) {
		ranges.push([
			` ${first.countryCode.toLowerCase()} `,
			first.validFrom,
			first.validFrom,
		]);
	}
	ranges.push([UNRULED_COUNTRY, null, null]);
	const seen = new Set<string>();
	const cases: DiscountCapCase[] = [];
	for (const [countryCode, from, to] of ranges) {
		const key = JSON.stringify([countryCode, from, to]);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		cases.push({
			countryCode,
			from,
			to,
			cap: promotionDiscountCap(countryCode, from, to),
		});
	}
	return {
		rules: rules.map((rule) => ({
			countryCode: rule.countryCode,
			validFrom: rule.validFrom,
			validTo: rule.validTo,
			maxDiscountRate: rule.parameters.maxDiscountRate,
		})),
		cases,
	};
}
