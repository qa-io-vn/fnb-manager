import type { PackLanguage } from "../pack/request.js";

export const PLAN_FORMAT = "fnb-plan/1";

export const PLAN_SECTION_IDS = [
	"summary",
	"strengths_weaknesses",
	"initiatives",
	"plan_30_60_90",
	"menu",
	"hours_staffing",
	"promotions",
	"risks",
	"data_to_collect",
	"assumptions",
] as const;

export type PlanSectionId = (typeof PLAN_SECTION_IDS)[number];

export interface PlanSection {
	readonly number: number;
	readonly id: PlanSectionId;
	readonly title: Readonly<Record<PackLanguage, string>>;
}

export const PLAN_SECTIONS: readonly PlanSection[] = [
	{
		number: 1,
		id: "summary",
		title: { vi: "Tóm tắt tình hình", en: "Situation summary" },
	},
	{
		number: 2,
		id: "strengths_weaknesses",
		title: { vi: "Điểm mạnh và điểm yếu", en: "Strengths and weaknesses" },
	},
	{
		number: 3,
		id: "initiatives",
		title: { vi: "Sáng kiến ưu tiên", en: "Priority initiatives" },
	},
	{
		number: 4,
		id: "plan_30_60_90",
		title: { vi: "Kế hoạch 30/60/90 ngày", en: "30/60/90-day plan" },
	},
	{ number: 5, id: "menu", title: { vi: "Thực đơn", en: "Menu" } },
	{
		number: 6,
		id: "hours_staffing",
		title: { vi: "Giờ mở cửa và nhân sự", en: "Opening hours and staffing" },
	},
	{
		number: 7,
		id: "promotions",
		title: { vi: "Lịch khuyến mãi", en: "Promotion calendar" },
	},
	{ number: 8, id: "risks", title: { vi: "Rủi ro", en: "Risks" } },
	{
		number: 9,
		id: "data_to_collect",
		title: { vi: "Dữ liệu cần thu thập", en: "Data to collect" },
	},
	{
		number: 10,
		id: "assumptions",
		title: { vi: "Giả định", en: "Assumptions" },
	},
];

export const INITIATIVE_HEADING: Readonly<Record<PackLanguage, string>> = {
	vi: "Sáng kiến",
	en: "Initiative",
};

export const INITIATIVE_FIELD_IDS = [
	"evidence",
	"action",
	"impact",
	"effort",
	"kpi",
	"read",
	"first_step",
] as const;

export type InitiativeFieldId = (typeof INITIATIVE_FIELD_IDS)[number];

export interface InitiativeField {
	readonly id: InitiativeFieldId;
	readonly label: Readonly<Record<PackLanguage, string>>;
}

export const INITIATIVE_FIELDS: readonly InitiativeField[] = [
	{ id: "evidence", label: { vi: "Căn cứ", en: "Evidence" } },
	{ id: "action", label: { vi: "Hành động", en: "Action" } },
	{ id: "impact", label: { vi: "Tác động dự kiến", en: "Expected impact" } },
	{ id: "effort", label: { vi: "Công sức", en: "Effort" } },
	{ id: "kpi", label: { vi: "KPI", en: "KPI" } },
	{
		id: "read",
		label: {
			vi: "Cách đọc KPI trên ứng dụng",
			en: "How to read the KPI in the app",
		},
	},
	{ id: "first_step", label: { vi: "Bước đầu tiên", en: "First step" } },
];

export const MIN_INITIATIVES = 5;
export const MAX_INITIATIVES = 7;
export const MAX_PLAN_KPIS = 8;
export const MAX_PLAN_CONTENT_BYTES = 200000;
