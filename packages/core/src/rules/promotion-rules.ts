export type PromotionRuleId =
	| "discount_cap"
	| "discount_days"
	| "lucky_draw_registration";

export type LegalLanguage = "vi" | "en";

export type LegalInstrumentKind = "decree" | "circular";

export interface LegalBasis {
	readonly instrument: LegalInstrumentKind;
	readonly number: string;
	readonly articles: readonly number[];
}

export interface LegalSource {
	readonly title: string;
	readonly url: string;
}

export type RuleNote = Readonly<Record<LegalLanguage, string>>;

export interface DiscountCapParameters {
	readonly maxDiscountRate: number;
	readonly concentratedMaxDiscountRate: number;
}

export interface DiscountDaysParameters {
	readonly maxDaysPerItemYear: number;
	readonly counts: "price_discounts";
}

export interface LuckyDrawParameters {
	readonly keywords: readonly string[];
}

interface RuleCommon<Id extends PromotionRuleId, Parameters> {
	readonly id: Id;
	readonly countryCode: string;
	readonly validFrom: string;
	readonly validTo: string | null;
	readonly parameters: Parameters;
	readonly legalBasis: LegalBasis;
	readonly sources: readonly LegalSource[];
	readonly checkedOn: string;
	readonly legalWatch: boolean;
	readonly notes: readonly RuleNote[];
}

export type DiscountCapRule = RuleCommon<"discount_cap", DiscountCapParameters>;
export type DiscountDaysRule = RuleCommon<
	"discount_days",
	DiscountDaysParameters
>;
export type LuckyDrawRule = RuleCommon<
	"lucky_draw_registration",
	LuckyDrawParameters
>;

export type PromotionRule = DiscountCapRule | DiscountDaysRule | LuckyDrawRule;

export const PROMOTION_RULES_CHECKED_ON = "2026-11-12";

const INSTRUMENT_WORDS: Readonly<
	Record<LegalLanguage, Readonly<Record<LegalInstrumentKind, string>>>
> = {
	vi: { decree: "Nghị định", circular: "Thông tư" },
	en: { decree: "Decree", circular: "Circular" },
};

const ARTICLE_WORDS: Readonly<
	Record<LegalLanguage, { one: string; many: string; and: string }>
> = {
	vi: { one: "Điều", many: "Điều", and: "và" },
	en: { one: "Article", many: "Articles", and: "and" },
};

function articleList(articles: readonly number[], and: string): string {
	if (articles.length <= 1) return articles.join("");
	return `${articles.slice(0, -1).join(", ")} ${and} ${articles.at(-1)}`;
}

export function formatLegalBasis(
	basis: LegalBasis,
	language: LegalLanguage,
): string {
	const words = ARTICLE_WORDS[language];
	const article = basis.articles.length === 1 ? words.one : words.many;
	return `${INSTRUMENT_WORDS[language][basis.instrument]} ${basis.number}, ${article} ${articleList(basis.articles, words.and)}`;
}

const SOURCES = {
	circular39: {
		title: "Circular 39/2025/TT-BCT (LuatVietnam)",
		url: "https://english.luatvietnam.vn/thuong-mai/circular-39-2025-tt-bct-maximum-value-of-promotional-goods-maximum-discount-rate-for-promoted-goods-403613-d1.html",
	},
	decree81: {
		title: "Decree 81/2018/NĐ-CP (Dữ liệu pháp luật)",
		url: "https://dulieuphapluat.vn/van-ban/thuong-mai-van-ban/nghi-dinh-812018nd-cp-huong-dan-luat-thuong-mai-ve-hoat-dong-xuc-tien-thuong-mai-78245.html",
	},
	decree239Kpmg: {
		title: "Decree 239/2026/NĐ-CP on sales promotion (KPMG Vietnam)",
		url: "https://kpmg.com/vn/en/insights/2026/07/decree-239-on-sales-promotion.html",
	},
	decree239LuatVietnam: {
		title:
			"Điểm mới về xúc tiến thương mại tại Nghị định 239/2026/NĐ-CP (LuatVietnam)",
		url: "https://luatvietnam.vn/doanh-nghiep/diem-moi-ve-xuc-tien-thuong-mai-tai-nghi-dinh-239-2026-nd-cp-561-111132-article.html",
	},
	vcciCaps: {
		title: "Đề xuất sửa quy định về hạn mức khuyến mại (VCCI)",
		url: "https://vcci.com.vn/news/de-xuat-sua-quy-dinh-ve-han-muc-khuyen-mai",
	},
	registration: {
		title: "Thông báo hoặc đăng ký thực hiện khuyến mại (Thư viện Pháp luật)",
		url: "https://thuvienphapluat.vn/phap-luat-doanh-nghiep/cong-viec-phap-ly/thong-bao-hoac-dang-ky-thuc-hien-khuyen-mai-2025-388.html",
	},
	luckyDrawChanges: {
		title:
			"Sửa đổi, bổ sung một số quy định về hoạt động khuyến mại (Tạp chí Công Thương)",
		url: "https://tapchicongthuong.vn/sua-doi--bo-sung-mot-so-quy-dinh-ve-hoat-dong-khuyen-mai-529209.htm",
	},
} as const satisfies Readonly<Record<string, LegalSource>>;

export const LUCKY_DRAW_KEYWORDS: readonly string[] = [
	"bốc thăm",
	"quay số",
	"quay thưởng",
	"rút thăm",
	"trúng thưởng",
	"may mắn",
	"vòng quay",
	"cào trúng",
	"bốc lì xì",
	"rút lì xì",
	"lucky draw",
	"prize draw",
	"raffle",
];

const DECREE_81: Pick<LegalBasis, "instrument" | "number"> = {
	instrument: "decree",
	number: "81/2018/NĐ-CP",
};

const CAP_NOTE: RuleNote = {
	en: "The discount may not exceed 50 % of the price just before the promotion.",
	vi: "Mức giảm giá không được vượt quá 50 % giá ngay trước thời gian khuyến mại.",
};

const CONCENTRATED_NOTE: RuleNote = {
	en: "State-run concentrated promotion programmes allow up to 100 %.",
	vi: "Các chương trình khuyến mại tập trung do cơ quan nhà nước tổ chức được giảm đến 100 %.",
};

const CAP_PARAMETERS: DiscountCapParameters = {
	maxDiscountRate: 0.5,
	concentratedMaxDiscountRate: 1,
};

const VIETNAM_RULES: readonly PromotionRule[] = [
	{
		id: "discount_cap",
		countryCode: "VN",
		validFrom: "2018-05-22",
		validTo: "2025-06-30",
		parameters: CAP_PARAMETERS,
		legalBasis: { ...DECREE_81, articles: [7] },
		sources: [SOURCES.decree81, SOURCES.vcciCaps],
		checkedOn: PROMOTION_RULES_CHECKED_ON,
		legalWatch: true,
		notes: [
			CAP_NOTE,
			CONCENTRATED_NOTE,
			{
				en: "Circular 39/2025/TT-BCT set the cap from 1 July 2025; how the two instruments handed over before that date is for the legal read to confirm.",
				vi: "Thông tư 39/2025/TT-BCT quy định mức tối đa từ ngày 1/7/2025; việc chuyển tiếp giữa hai văn bản trước ngày đó cần được rà soát pháp lý xác nhận.",
			},
		],
	},
	{
		id: "discount_cap",
		countryCode: "VN",
		validFrom: "2025-07-01",
		validTo: null,
		parameters: CAP_PARAMETERS,
		legalBasis: {
			instrument: "circular",
			number: "39/2025/TT-BCT",
			articles: [4],
		},
		sources: [SOURCES.circular39, SOURCES.vcciCaps, SOURCES.decree239Kpmg],
		checkedOn: PROMOTION_RULES_CHECKED_ON,
		legalWatch: true,
		notes: [
			CAP_NOTE,
			CONCENTRATED_NOTE,
			{
				en: "No cap applies to price-stabilised goods, fresh food or a business that is closing.",
				vi: "Không áp dụng mức tối đa với hàng hóa bình ổn giá, thực phẩm tươi sống và trường hợp chấm dứt hoạt động kinh doanh.",
			},
			{
				en: "Decree 239/2026/NĐ-CP is reported to have repealed the decree-level caps and left them to the Ministry of Industry and Trade, which sets them in this circular; no newer circular was found on the check date.",
				vi: "Nghị định 239/2026/NĐ-CP được cho là đã bãi bỏ các mức tối đa ở cấp nghị định và giao Bộ Công Thương quy định, như tại thông tư này; đến ngày kiểm tra chưa thấy thông tư mới hơn.",
			},
		],
	},
	{
		id: "discount_days",
		countryCode: "VN",
		validFrom: "2018-05-22",
		validTo: "2026-06-25",
		parameters: { maxDaysPerItemYear: 120, counts: "price_discounts" },
		legalBasis: { ...DECREE_81, articles: [10] },
		sources: [
			SOURCES.decree81,
			SOURCES.decree239Kpmg,
			SOURCES.decree239LuatVietnam,
		],
		checkedOn: PROMOTION_RULES_CHECKED_ON,
		legalWatch: true,
		notes: [
			{
				en: "The limit counted price discounts only, not gifts (Articles 8 and 9) or vouchers (Article 11).",
				vi: "Giới hạn chỉ tính các ngày giảm giá, không tính quà tặng (Điều 8 và 9) hay phiếu mua hàng (Điều 11).",
			},
			{
				en: "Decree 239/2026/NĐ-CP is reported to have repealed the limit from 26 June 2026; later days are counted as information only.",
				vi: "Nghị định 239/2026/NĐ-CP được cho là đã bãi bỏ giới hạn này từ ngày 26/6/2026; các ngày sau đó chỉ được đếm để tham khảo.",
			},
		],
	},
	{
		id: "lucky_draw_registration",
		countryCode: "VN",
		validFrom: "2018-05-22",
		validTo: null,
		parameters: { keywords: LUCKY_DRAW_KEYWORDS },
		legalBasis: { ...DECREE_81, articles: [13, 19] },
		sources: [SOURCES.registration, SOURCES.decree81, SOURCES.luckyDrawChanges],
		checkedOn: PROMOTION_RULES_CHECKED_ON,
		legalWatch: true,
		notes: [
			{
				en: "A lucky draw needs registration with the provincial Department of Industry and Trade when it runs in one province, or with the Ministry when it runs in several.",
				vi: "Chương trình khuyến mại mang tính may rủi phải đăng ký với Sở Công Thương nếu thực hiện trong một tỉnh, hoặc với Bộ Công Thương nếu thực hiện ở nhiều tỉnh.",
			},
			{
				en: "Decree 239/2026/NĐ-CP is reported to have changed how winners are witnessed and to have simplified the registration dossier.",
				vi: "Nghị định 239/2026/NĐ-CP được cho là đã thay đổi cách chứng kiến xác định người trúng thưởng và đơn giản hóa hồ sơ đăng ký.",
			},
			{
				en: "Detected from keywords in promotion names; the owner reviews each match.",
				vi: "Nhận biết qua từ khóa trong tên chương trình khuyến mại; chủ quán xem lại từng kết quả.",
			},
		],
	},
];

const RULES_BY_COUNTRY: Readonly<Record<string, readonly PromotionRule[]>> = {
	VN: VIETNAM_RULES,
};

export const PROMOTION_RULE_COUNTRIES: readonly string[] =
	Object.keys(RULES_BY_COUNTRY);

export function promotionRules(countryCode: string): readonly PromotionRule[] {
	const code = countryCode.trim().toUpperCase();
	return Object.hasOwn(RULES_BY_COUNTRY, code)
		? (RULES_BY_COUNTRY[code] ?? [])
		: [];
}

export function promotionDiscountCap(
	countryCode: string,
	from: string | null,
	to: string | null,
): number | null {
	const caps = promotionRules(countryCode)
		.filter(
			(rule): rule is DiscountCapRule =>
				rule.id === "discount_cap" &&
				(to === null || rule.validFrom <= to) &&
				(from === null || rule.validTo === null || rule.validTo >= from),
		)
		.map((rule) => rule.parameters.maxDiscountRate);
	return caps.length === 0 ? null : Math.min(...caps);
}
