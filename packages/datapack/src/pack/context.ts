import {
	type DiscountCapParameters,
	type DiscountDaysParameters,
	formatLegalBasis,
	type PromotionRule,
	promotionRules,
} from "@fnb/core";
import { benchmarkContext } from "@fnb/metrics";
import { type IsoDate, roundHalfAwayFromZero } from "@fnb/reports";
import { formatDecimal } from "./decimal.js";
import type { PackLanguage } from "./request.js";
import type { DataPack } from "./schema.js";

export type PackContext = DataPack["context"];

export const CONTEXT_NOTE: Readonly<Record<PackLanguage, string>> = {
	vi: "Bối cảnh thị trường và quy định để tham khảo: không phải số đo của cửa hàng, không dùng làm mục tiêu và không trích dẫn. Quy định ghi theo nguồn tại ngày kiểm tra, không phải tư vấn pháp lý.",
	en: "Market context and rules for reference: not the stores' measurements, never a target and never cited. Rules follow their sources as of the check date; not legal advice.",
};

function percent(rate: number): string {
	return formatDecimal(roundHalfAwayFromZero(rate * 100, 2));
}

const DISCOUNT_CAP: Readonly<
	Record<PackLanguage, (parameters: DiscountCapParameters) => string>
> = {
	vi: (parameters) =>
		`Mức giảm giá không được vượt quá ${percent(parameters.maxDiscountRate)} % giá ngay trước thời gian khuyến mại; chương trình khuyến mại tập trung do cơ quan nhà nước tổ chức được giảm đến ${percent(parameters.concentratedMaxDiscountRate)} %.`,
	en: (parameters) =>
		`A discount may not exceed ${percent(parameters.maxDiscountRate)} % of the price just before the promotion; state-run concentrated promotion programmes allow up to ${percent(parameters.concentratedMaxDiscountRate)} %.`,
};

const DISCOUNT_DAYS: Readonly<
	Record<PackLanguage, (parameters: DiscountDaysParameters) => string>
> = {
	vi: (parameters) =>
		`Mỗi mặt hàng được giảm giá tối đa ${parameters.maxDaysPerItemYear} ngày trong một năm, chỉ tính các ngày giảm giá, không tính quà tặng hay phiếu mua hàng.`,
	en: (parameters) =>
		`An item may be discounted on at most ${parameters.maxDaysPerItemYear} days a year, counting price discounts only, not gifts or vouchers.`,
};

const LUCKY_DRAW: Readonly<Record<PackLanguage, string>> = {
	vi: "Chương trình khuyến mại mang tính may rủi phải đăng ký với Sở Công Thương nếu thực hiện trong một tỉnh, hoặc với Bộ Công Thương nếu thực hiện ở nhiều tỉnh.",
	en: "A lucky draw must be registered with the provincial Department of Industry and Trade when it runs in one province, or with the Ministry of Industry and Trade when it runs in several.",
};

const SOURCE_NOTE: Readonly<
	Record<PackLanguage, (basis: string, checkedOn: IsoDate) => string>
> = {
	vi: (basis, checkedOn) => {
		const [year, month, day] = checkedOn.split("-");
		return `(${basis}; nguồn kiểm tra ngày ${day}/${month}/${year}; không phải tư vấn pháp lý)`;
	},
	en: (basis, checkedOn) =>
		`(${basis}; sources checked on ${checkedOn}; not legal advice)`,
};

function ruleText(rule: PromotionRule, language: PackLanguage): string {
	switch (rule.id) {
		case "discount_cap":
			return DISCOUNT_CAP[language](rule.parameters);
		case "discount_days":
			return DISCOUNT_DAYS[language](rule.parameters);
		case "lucky_draw_registration":
			return LUCKY_DRAW[language];
	}
}

export function ruleSentence(
	rule: PromotionRule,
	language: PackLanguage,
): string {
	return `${ruleText(rule, language)} ${SOURCE_NOTE[language](
		formatLegalBasis(rule.legalBasis, language),
		rule.checkedOn,
	)}`;
}

export function isInForce(rule: PromotionRule, asOf: IsoDate): boolean {
	return (
		rule.validFrom <= asOf && (rule.validTo === null || rule.validTo >= asOf)
	);
}

export function rulesInForce(
	country: string,
	asOf: IsoDate,
): readonly PromotionRule[] {
	return promotionRules(country).filter((rule) => isInForce(rule, asOf));
}

export function packContext(
	language: PackLanguage,
	country: string,
	asOf: IsoDate,
): PackContext {
	return {
		benchmarks: benchmarkContext.map((entry) => [
			entry.id,
			entry.figure,
			entry.year,
			entry.source,
		]),
		note: CONTEXT_NOTE[language],
		rules: rulesInForce(country, asOf).map((rule) => [
			rule.id,
			rule.countryCode,
			rule.validFrom,
			ruleSentence(rule, language),
		]),
	};
}
