import {
	type DiscountCapRule,
	type DiscountDaysRule,
	type LegalBasis,
	type PromotionRule,
	promotionRules,
} from "@fnb/core";
import type { DateRange, IsoDate } from "../../contract/values.js";
import {
	part,
	partValue,
	type TypedValue,
	textValue,
} from "../../model/values.js";
import { addDays, firstOfYear, yearOf } from "../../period/dates.js";
import { DISCOUNT_DAYS_FIRST_YEAR } from "../contract.js";
import { ruleInForce, ruleSegments } from "../rules.js";
import { spanValue } from "../support.js";
import { promotionsKeys } from "./keys.js";

export const PROMOTION_RULES_COUNTRY = "VN";

export function themePromotionRules(): readonly PromotionRule[] {
	return promotionRules(PROMOTION_RULES_COUNTRY);
}

export interface CapSegment extends DateRange {
	readonly rule: DiscountCapRule;
}

export interface CapPeriod extends DateRange {
	readonly cap: number;
	readonly rule: DiscountCapRule;
	readonly segments: readonly CapSegment[];
}

export function capPeriods(
	rules: readonly PromotionRule[],
	range: DateRange,
): CapPeriod[] {
	const periods: CapPeriod[] = [];
	for (const segment of ruleSegments(rules, "discount_cap", range)) {
		const rule = segment.rule;
		if (rule === null) continue;
		const cap = rule.parameters.maxDiscountRate;
		const current: CapSegment = { from: segment.from, to: segment.to, rule };
		const last = periods.at(-1);
		if (
			last !== undefined &&
			last.cap === cap &&
			addDays(last.to, 1) === segment.from
		) {
			periods[periods.length - 1] = {
				...last,
				to: segment.to,
				rule,
				segments: [...last.segments, current],
			};
			continue;
		}
		periods.push({
			from: segment.from,
			to: segment.to,
			cap,
			rule,
			segments: [current],
		});
	}
	return periods;
}

function basisId(basis: LegalBasis): string {
	return `${basis.instrument}|${basis.number}|${basis.articles.join(",")}`;
}

export function capBases(periods: readonly CapPeriod[]): CapSegment[] {
	const bases: CapSegment[] = [];
	for (const segment of periods.flatMap((period) => period.segments)) {
		const last = bases.at(-1);
		if (
			last !== undefined &&
			basisId(last.rule.legalBasis) === basisId(segment.rule.legalBasis) &&
			addDays(last.to, 1) === segment.from
		) {
			bases[bases.length - 1] = { ...last, to: segment.to };
			continue;
		}
		bases.push(segment);
	}
	return bases;
}

export function datedBasesValue(bases: readonly CapSegment[]): TypedValue {
	const [only] = bases;
	if (only === undefined) throw new Error("a cap needs a legal basis");
	if (bases.length === 1) return legalBasisValue(only.rule.legalBasis);
	const dated = bases.map((segment) =>
		part(promotionsKeys.rules.basisDuring, {
			basis: legalBasisValue(segment.rule.legalBasis),
			dates: spanValue(segment),
		}),
	);
	const listed = dated.reduceRight<TypedValue | null>(
		(rest, sentence) =>
			rest === null
				? partValue(sentence)
				: partValue(
						part(promotionsKeys.rules.basisList, {
							first: partValue(sentence),
							rest,
						}),
					),
		null,
	);
	if (listed === null) throw new Error("a cap needs a legal basis");
	return listed;
}

export function latestCheck(bases: readonly CapSegment[]): IsoDate {
	return (
		bases
			.map((segment) => segment.rule.checkedOn)
			.sort()
			.at(-1) ?? ""
	);
}

export interface DiscountDaysPlan {
	readonly year: number;
	readonly yearStart: IsoDate;
	readonly asOf: IsoDate;
	readonly inForce: DiscountDaysRule | null;
	readonly ended: DiscountDaysRule | null;
	readonly underRule: {
		readonly rule: DiscountDaysRule;
		readonly to: IsoDate;
	} | null;
	readonly counted: boolean;
}

function lastEnded(
	rules: readonly PromotionRule[],
	date: IsoDate,
): DiscountDaysRule | null {
	let found: DiscountDaysRule | null = null;
	for (const rule of rules) {
		if (rule.id !== "discount_days" || rule.validTo === null) continue;
		if (rule.validTo >= date) continue;
		if (found === null || (found.validTo ?? "") < rule.validTo) found = rule;
	}
	return found;
}

export function discountDaysPlan(
	rules: readonly PromotionRule[],
	asOf: IsoDate,
): DiscountDaysPlan {
	const year = yearOf(asOf);
	const yearStart = firstOfYear(asOf);
	const inForce = ruleInForce(rules, "discount_days", asOf);
	const segments = ruleSegments(rules, "discount_days", {
		from: yearStart,
		to: asOf,
	});
	const last = segments.filter((segment) => segment.rule !== null).at(-1);
	return {
		year,
		yearStart,
		asOf,
		inForce,
		ended: inForce === null ? lastEnded(rules, asOf) : null,
		underRule:
			last?.rule === undefined || last.rule === null
				? null
				: { rule: last.rule, to: last.to },
		counted: year >= DISCOUNT_DAYS_FIRST_YEAR,
	};
}

export function needsDaysUnderRule(plan: DiscountDaysPlan): boolean {
	return (
		plan.counted && plan.underRule !== null && plan.underRule.to < plan.asOf
	);
}

export function legalBasisValue(basis: LegalBasis): TypedValue {
	const instrument = partValue(
		part(promotionsKeys.rules.instrument[basis.instrument], {
			number: textValue("text", basis.number),
		}),
	);
	const articles = basis.articles.map(String);
	const lastArticle = articles.at(-1) ?? "";
	return partValue(
		articles.length <= 1
			? part(promotionsKeys.rules.basisOne, {
					instrument,
					article: textValue("text", lastArticle),
				})
			: part(promotionsKeys.rules.basisMany, {
					instrument,
					articles: textValue("text", articles.slice(0, -1).join(", ")),
					last: textValue("text", lastArticle),
				}),
	);
}
