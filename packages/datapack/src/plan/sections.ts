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

export interface HeadingLine {
	readonly level: number;
	readonly text: string;
}

export interface SectionHeading {
	readonly section: PlanSection | null;
	readonly number: number | null;
}

export interface InitiativeHeading {
	readonly number: number;
	readonly title: string;
}

export interface FieldLine {
	readonly id: InitiativeFieldId;
	readonly text: string;
}

const HEADING_LINE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const EMPHASIS_EDGES = /^(\*\*|__)(.*)\1$/;
const LEADING_NUMBER = /^([0-9]{1,2})(?:[.):]|\s*[–—-])?\s+(.*)$/;
const INITIATIVE_LINE =
	/^(?:\*\*|__)?\s*(?:sáng kiến|initiative)\s+([0-9]{1,2})(?![0-9])\s*(?:[:：.–—-]\s*)?(.*)$/iu;
const EMPHASIS_START = /^(?:\*\*|__)\s*/;
const EMPHASIS_END = /\s*(?:\*\*|__)$/;
const EMPHASIS = "(?:\\*{1,2}|_{1,2})?";

function collapsed(text: string): string {
	return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function withoutEmphasis(text: string): string {
	const match = EMPHASIS_EDGES.exec(text.trim());
	return (match === null ? text : (match[2] ?? "")).trim();
}

function escapedPattern(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SECTION_BY_TITLE: ReadonlyMap<string, PlanSection> = new Map(
	PLAN_SECTIONS.flatMap((section) => [
		[collapsed(section.title.vi), section],
		[collapsed(section.title.en), section],
	]),
);

const FIELD_BY_LABEL: ReadonlyMap<string, InitiativeFieldId> = new Map(
	INITIATIVE_FIELDS.flatMap((field) => [
		[collapsed(field.label.vi), field.id],
		[collapsed(field.label.en), field.id],
	]),
);

const FIELD_LINE = new RegExp(
	`^\\s*(?:[-*+]\\s+|[0-9]{1,2}[.)]\\s+)?${EMPHASIS}\\s*(${[
		...FIELD_BY_LABEL.keys(),
	]
		.sort((left, right) => right.length - left.length)
		.map(escapedPattern)
		.join("|")})\\s*${EMPHASIS}\\s*[:：]\\s*${EMPHASIS}\\s*(.*)$`,
	"iu",
);

export function headingOf(line: string): HeadingLine | null {
	const match = HEADING_LINE.exec(line);
	if (match === null) return null;
	return { level: (match[1] ?? "").length, text: (match[2] ?? "").trim() };
}

export function sectionHeading(text: string): SectionHeading {
	let title = withoutEmphasis(text);
	let number: number | null = null;
	const numbered = LEADING_NUMBER.exec(title);
	if (numbered !== null) {
		number = Number(numbered[1]);
		title = withoutEmphasis(numbered[2] ?? "");
	}
	const key = collapsed(title).replace(/\s*[:：]$/, "");
	return { section: SECTION_BY_TITLE.get(key) ?? null, number };
}

export function initiativeHeading(text: string): InitiativeHeading | null {
	const match = INITIATIVE_LINE.exec(text.trim());
	if (match === null) return null;
	return {
		number: Number(match[1]),
		title: (match[2] ?? "")
			.replace(EMPHASIS_START, "")
			.replace(EMPHASIS_END, "")
			.trim(),
	};
}

export function fieldLine(line: string): FieldLine | null {
	const match = FIELD_LINE.exec(line);
	if (match === null) return null;
	const id = FIELD_BY_LABEL.get(collapsed(match[1] ?? ""));
	if (id === undefined) return null;
	return {
		id,
		text: (match[2] ?? "")
			.replace(EMPHASIS_START, "")
			.replace(EMPHASIS_END, "")
			.trim(),
	};
}
