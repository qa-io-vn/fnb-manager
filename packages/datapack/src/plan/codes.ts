export type PlanIssueLevel = "error" | "warning";

export const PLAN_LINT_CODES = {
	front_matter_missing: "error",
	front_matter_invalid: "error",
	content_too_large: "error",
	pack_mismatch: "error",
	horizon_mismatch: "error",
	section_missing: "error",
	initiatives_count: "error",
	initiative_number: "error",
	initiative_field_missing: "error",
	initiative_uncited: "error",
	citation_unknown: "error",
	citation_mismatch: "error",
	kpis_count: "error",
	kpi_unknown: "error",
	kpi_untracked: "error",
	kpi_scope_unknown: "error",
	kpi_unmeasured: "error",
	kpi_baseline_mismatch: "error",
	kpi_target_unchanged: "error",
	kpi_initiative_unknown: "error",
	preamble_text: "warning",
	front_matter_extra_fields: "warning",
	kpi_initiative_unlinked: "warning",
	uncited_numbers: "warning",
} as const satisfies Readonly<Record<string, PlanIssueLevel>>;

export type PlanLintCode = keyof typeof PLAN_LINT_CODES;

export const PLAN_LINT_CODE_IDS = Object.keys(
	PLAN_LINT_CODES,
) as readonly PlanLintCode[];

export function planIssueCode(
	code: PlanLintCode,
	parameter: string | number | null = null,
): string {
	return parameter === null ? code : `${code}:${parameter}`;
}

export function planLintCodeOf(issueCode: string): PlanLintCode | null {
	const colon = issueCode.indexOf(":");
	const base = colon === -1 ? issueCode : issueCode.slice(0, colon);
	return Object.hasOwn(PLAN_LINT_CODES, base) ? (base as PlanLintCode) : null;
}

export function planIssueParameter(issueCode: string): string | null {
	const colon = issueCode.indexOf(":");
	return colon === -1 ? null : issueCode.slice(colon + 1);
}

export function planIssueLevel(code: PlanLintCode): PlanIssueLevel {
	return PLAN_LINT_CODES[code];
}
