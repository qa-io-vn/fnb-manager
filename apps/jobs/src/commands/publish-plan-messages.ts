import {
	INITIATIVE_FIELDS,
	PLAN_SECTIONS,
	type PlanLintCode,
	planIssueParameter,
	planLintCodeOf,
} from "@fnb/datapack";

type Message = (parameter: string) => string;

function sectionTitle(parameter: string): string {
	const section = PLAN_SECTIONS.find(
		(entry) => String(entry.number) === parameter,
	);
	return section === undefined
		? `section ${parameter}`
		: `section ${parameter} (${section.title.en})`;
}

function initiativeField(parameter: string): string {
	const colon = parameter.indexOf(":");
	const number = colon === -1 ? parameter : parameter.slice(0, colon);
	const id = colon === -1 ? "" : parameter.slice(colon + 1);
	const field = INITIATIVE_FIELDS.find((entry) => entry.id === id);
	const label = field === undefined ? id : `${field.label.en} (${id})`;
	return `initiative ${number} lacks its field ${label}, or the field is empty`;
}

export const PLAN_LINT_MESSAGES: Readonly<Record<PlanLintCode, Message>> = {
	front_matter_missing: () =>
		"the plan does not start with its front matter, a JSON object between two --- lines, or the front matter is never closed",
	front_matter_invalid: () =>
		"the front matter is not a JSON object or fails the fnb-plan/1 schema at the path given",
	content_too_large: () => "the plan is over 200,000 bytes of UTF-8",
	pack_mismatch: () =>
		"the front matter names another pack than this one: write the pack_id of the pack the plan was written from",
	horizon_mismatch: () => "the front matter's horizon is not the pack's",
	section_missing: (parameter) => `${sectionTitle(parameter)} is missing`,
	initiatives_count: (parameter) =>
		`initiatives in the plan: ${parameter}; a plan needs 5 to 7`,
	initiative_number: (parameter) =>
		`initiatives are numbered 1, 2, 3 and so on without gaps; initiative ${parameter} is out of place`,
	initiative_field_missing: initiativeField,
	initiative_uncited: (parameter) =>
		`initiative ${parameter} holds no citation whose written number matches its cell`,
	citation_unknown: (parameter) =>
		`[[${parameter}]] names no cell of the pack; context is never cited`,
	citation_mismatch: (parameter) =>
		`the number written before [[${parameter}]] does not match the cited cell`,
	kpis_count: (parameter) =>
		`KPIs in the front matter: ${parameter}; a plan needs 1 to 8`,
	kpi_unknown: (parameter) => `${parameter} is not a metric id of the registry`,
	kpi_untracked: (parameter) =>
		`${parameter} is a metric that KPI follow-up cannot track`,
	kpi_scope_unknown: (parameter) =>
		`the scope of ${parameter} is a store label the pack does not hold`,
	kpi_unmeasured: (parameter) =>
		`the pack's kpi table has no w28 value for ${parameter} in its scope`,
	kpi_baseline_mismatch: (parameter) =>
		`the baseline written for ${parameter} does not match w28 in the pack`,
	kpi_target_unchanged: (parameter) =>
		`the target of ${parameter} equals its baseline`,
	kpi_initiative_unknown: (parameter) =>
		`${parameter} names an initiative the plan does not have`,
	kpi_initiative_unlinked: (parameter) =>
		`an initiative linked to ${parameter} does not mention it in its KPI field`,
	preamble_text: () => "text before the front matter was left out",
	front_matter_extra_fields: () =>
		"unknown front-matter keys were dropped; the plan stays valid",
	uncited_numbers: (parameter) =>
		`numbers without a citation in sections 1 and 2 or in an Evidence field: ${parameter}`,
};

export function planIssueMessage(code: string): string {
	const base = planLintCodeOf(code);
	if (base === null) return "unknown lint code";
	return PLAN_LINT_MESSAGES[base](planIssueParameter(code) ?? "");
}
