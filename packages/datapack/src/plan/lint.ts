import { notImplemented } from "../pack/errors.js";
import type { DataPack } from "../pack/schema.js";
import type { ParsedPlan } from "./parse.js";

export interface PlanIssue {
	readonly code: string;
	readonly level: "error" | "warning";
	readonly line: number | null;
	readonly detail: string | null;
}

export interface PlanLintSummary {
	readonly initiatives: number;
	readonly citedInitiatives: number;
	readonly citations: number;
	readonly validCitations: number;
	readonly kpis: number;
	readonly uncitedNumbers: number;
	readonly words: number;
}

export interface PlanLintResult {
	readonly ok: boolean;
	readonly normalized: string;
	readonly issues: readonly PlanIssue[];
	readonly plan: ParsedPlan | null;
	readonly summary: PlanLintSummary;
}

export function lintPlan(_text: string, _pack: DataPack): PlanLintResult {
	return notImplemented("lintPlan");
}
