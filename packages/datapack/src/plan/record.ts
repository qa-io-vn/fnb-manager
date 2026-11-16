import type { IsoDate } from "@fnb/reports";
import { notImplemented } from "../pack/errors.js";
import type { Horizon, PackLanguage } from "../pack/request.js";
import type { DataPack } from "../pack/schema.js";
import type { PlanLintResult, PlanLintSummary } from "./lint.js";
import type { ParsedPlan } from "./parse.js";

export const PLAN_VIAS = ["skill", "routine", "pasted"] as const;
export type PlanVia = (typeof PLAN_VIAS)[number];

export interface StoredKpi {
	readonly scope: string;
	readonly store_ids: readonly string[];
	readonly baseline: number;
	readonly target: number;
	readonly lo: number | null;
	readonly hi: number | null;
	readonly initiatives: readonly number[];
	readonly due_on: IsoDate;
	readonly window_days: number;
}

export interface PlanLintRecord {
	readonly summary: PlanLintSummary;
	readonly warnings: readonly string[];
}

export interface PlanPublishInput {
	readonly p_store_ids: readonly string[];
	readonly p_title: string;
	readonly p_content_markdown: string;
	readonly p_kpis: Readonly<Record<string, StoredKpi>>;
	readonly p_horizon: Horizon;
	readonly p_language: PackLanguage;
	readonly p_as_of_date: IsoDate;
	readonly p_pack_id: string;
	readonly p_prompt_version: string;
	readonly p_data_pack: DataPack;
	readonly p_lint: PlanLintRecord;
	readonly p_generated_via: PlanVia;
}

export function planRecord(
	_plan: ParsedPlan,
	_pack: DataPack,
	_lint: PlanLintResult,
	_via: PlanVia,
): PlanPublishInput {
	return notImplemented("planRecord");
}
