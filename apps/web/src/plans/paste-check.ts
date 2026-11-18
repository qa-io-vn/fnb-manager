import {
	type DataPack,
	INITIATIVE_FIELDS,
	lintPlan,
	normalizePlanText,
	PLAN_SECTIONS,
	type PlanIssue,
	type PlanLintCode,
	type PlanLintResult,
	parsePack,
	planIssueParameter,
	planLintCodeOf,
} from "@fnb/datapack";
import { cachedPackText, rememberPack } from "../datapack/pack-cache";
import type { Language, MessageParams, Translate } from "../i18n";

const FRONT_MATTER_DELIMITER = "---";
const PACK_ID = /^[0-9a-f]{64}$/;
const BYTE_ORDER_MARK = "﻿";
const EXCERPT_LENGTH = 160;

export interface LoadedPack {
	readonly packId: string;
	readonly pack: DataPack;
	readonly text: string;
}

export type PackRead =
	| { readonly ok: true; readonly pack: LoadedPack }
	| { readonly ok: false; readonly codes: readonly string[] };

export interface PlanIssueView {
	readonly code: string;
	readonly base: PlanLintCode | null;
	readonly level: PlanIssue["level"];
	readonly line: number | null;
	readonly detail: string | null;
	readonly excerpt: string | null;
}

export interface CheckedPlan {
	readonly lint: PlanLintResult;
	readonly pack: LoadedPack;
	readonly planPackId: string | null;
	readonly issues: readonly PlanIssueView[];
	readonly errors: number;
	readonly warnings: number;
	readonly sections: number;
	readonly lines: readonly string[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function planPackId(text: string): string | null {
	const lines = normalizePlanText(text).split("\n");
	if (lines[0] !== FRONT_MATTER_DELIMITER) return null;
	const end = lines.indexOf(FRONT_MATTER_DELIMITER, 1);
	if (end === -1) return null;
	let value: unknown;
	try {
		value = JSON.parse(lines.slice(1, end).join("\n"));
	} catch {
		return null;
	}
	if (!isPlainObject(value)) return null;
	const pack = value.pack;
	return typeof pack === "string" && PACK_ID.test(pack) ? pack : null;
}

export async function readPackText(raw: string): Promise<PackRead> {
	const text = raw.startsWith(BYTE_ORDER_MARK) ? raw.slice(1) : raw;
	const parsed = await parsePack(text);
	if (!parsed.valid || parsed.pack === null || parsed.packId === null) {
		return {
			ok: false,
			codes: [...new Set(parsed.issues.map((issue) => issue.code))],
		};
	}
	return {
		ok: true,
		pack: { packId: parsed.packId, pack: parsed.pack, text },
	};
}

export async function findPack(
	packId: string,
	attached: ReadonlyMap<string, LoadedPack>,
	now: Date,
): Promise<LoadedPack | null> {
	const cached = cachedPackText(packId, now);
	if (cached !== null) {
		const read = await readPackText(cached);
		if (read.ok && read.pack.packId === packId) return read.pack;
	}
	return attached.get(packId) ?? null;
}

export function keepPack(pack: LoadedPack, now: Date): void {
	rememberPack(pack.packId, pack.text, now);
}

function excerptOf(lines: readonly string[], line: number | null) {
	if (line === null) return null;
	const text = lines[line - 1]?.trim() ?? "";
	if (text === "") return null;
	return text.length > EXCERPT_LENGTH
		? `${text.slice(0, EXCERPT_LENGTH)}…`
		: text;
}

export function checkPlan(
	text: string,
	pack: LoadedPack,
	planPackIdValue: string | null,
): CheckedPlan {
	const lint = lintPlan(text, pack.pack);
	const lines = lint.normalized.split("\n");
	if (lines[lines.length - 1] === "") lines.pop();
	const issues = lint.issues.map((issue) => ({
		code: issue.code,
		base: planLintCodeOf(issue.code),
		level: issue.level,
		line: issue.line,
		detail: issue.detail,
		excerpt: excerptOf(lines, issue.line),
	}));
	const errors = issues.filter((issue) => issue.level === "error").length;
	const sections = new Set(
		(lint.plan?.sections ?? []).flatMap((section) =>
			section.id === null ? [] : [section.id],
		),
	).size;
	return {
		lint,
		pack,
		planPackId: planPackIdValue,
		issues,
		errors,
		warnings: issues.length - errors,
		sections,
		lines,
	};
}

function splitFirst(parameter: string): readonly [string, string] {
	const colon = parameter.indexOf(":");
	return colon === -1
		? [parameter, ""]
		: [parameter.slice(0, colon), parameter.slice(colon + 1)];
}

export function lintParams(
	base: PlanLintCode,
	parameter: string,
	language: Language,
): MessageParams {
	switch (base) {
		case "section_missing": {
			const section = PLAN_SECTIONS.find(
				(entry) => String(entry.number) === parameter,
			);
			return {
				number: parameter,
				title: section === undefined ? parameter : section.title[language],
			};
		}
		case "initiatives_count":
		case "kpis_count":
		case "uncited_numbers":
			return { count: parameter };
		case "initiative_number":
		case "initiative_uncited":
			return { number: parameter };
		case "initiative_field_missing": {
			const [number, id] = splitFirst(parameter);
			const field = INITIATIVE_FIELDS.find((entry) => entry.id === id);
			return {
				number,
				field: field === undefined ? id : field.label[language],
			};
		}
		case "citation_unknown":
		case "citation_mismatch":
			return { ref: parameter };
		case "kpi_unknown":
		case "kpi_untracked":
		case "kpi_scope_unknown":
		case "kpi_unmeasured":
		case "kpi_baseline_mismatch":
		case "kpi_target_unchanged":
		case "kpi_initiative_unknown":
		case "kpi_initiative_unlinked":
			return { id: parameter };
		default:
			return {};
	}
}

export function issueMessage(
	t: Translate,
	language: Language,
	code: string,
): string {
	const base = planLintCodeOf(code);
	if (base === null) return code;
	return t(
		`plans.lint.${base}`,
		lintParams(base, planIssueParameter(code) ?? "", language),
	);
}

export function issueLabel(t: Translate, issue: PlanIssueView): string {
	return issue.line === null
		? t("plans.result.wholePlan")
		: t("plans.result.line", { line: issue.line });
}

export function issueListText(
	t: Translate,
	language: Language,
	checked: CheckedPlan,
	packShown: string,
): string {
	return [
		t("plans.copy.heading", {
			pack: packShown,
			errors: checked.errors,
			warnings: checked.warnings,
		}),
		...checked.issues.map((issue) => {
			const detail =
				issue.detail === null
					? ""
					: ` (${t("plans.result.detail", { detail: issue.detail })})`;
			return `- ${issueLabel(t, issue)} · ${t(`plans.result.level.${issue.level}`)} · ${issue.code}: ${issueMessage(t, language, issue.code)}${detail}`;
		}),
	].join("\n");
}
