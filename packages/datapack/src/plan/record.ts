import type { IsoDate } from "@fnb/reports";
import { DataPackError } from "../pack/errors.js";
import { KPI_WINDOW_DAYS } from "../pack/kpi-ids.js";
import type { Horizon, PackLanguage } from "../pack/request.js";
import type { DataPack } from "../pack/schema.js";
import {
	ALL_SCOPE,
	BAND_HIGH_COLUMN,
	BAND_LOW_COLUMN,
	BASELINE_COLUMN,
	kpiValue,
} from "./citations.js";
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

function scopeStoreIds(pack: DataPack, scope: string): string[] {
	const stores = pack.request.stores;
	return scope === ALL_SCOPE
		? stores.map((store) => store.id)
		: stores.filter((store) => store.label === scope).map((store) => store.id);
}

export function planRecord(
	plan: ParsedPlan,
	pack: DataPack,
	lint: PlanLintResult,
	via: PlanVia,
): PlanPublishInput {
	if (pack.sample) {
		throw new DataPackError(
			"sample_pack_not_publishable",
			"a plan written from a sample pack cannot be published",
		);
	}
	if (plan.frontMatter.pack !== pack.pack_id) {
		throw new DataPackError(
			"pack_id_mismatch",
			"the plan names another pack than the one given",
		);
	}
	const dueOn = pack.calendar.horizon.to;
	const kpis = Object.entries(plan.frontMatter.kpis).map(
		([id, kpi]): [string, StoredKpi] => {
			const storeIds = scopeStoreIds(pack, kpi.scope);
			const baseline = kpiValue(pack, kpi.scope, id, BASELINE_COLUMN);
			if (storeIds.length === 0 || baseline === null) {
				throw new DataPackError(
					"front_matter_invalid",
					`the KPI ${id} has no store or no baseline in the pack`,
				);
			}
			return [
				id,
				{
					scope: kpi.scope,
					store_ids: storeIds,
					baseline,
					target: kpi.target,
					lo: kpiValue(pack, kpi.scope, id, BAND_LOW_COLUMN),
					hi: kpiValue(pack, kpi.scope, id, BAND_HIGH_COLUMN),
					initiatives: [...kpi.initiatives],
					due_on: dueOn,
					window_days: KPI_WINDOW_DAYS,
				},
			];
		},
	);
	return {
		p_store_ids: pack.request.stores.map((store) => store.id),
		p_title: plan.frontMatter.title,
		p_content_markdown: plan.text,
		p_kpis: Object.fromEntries(kpis),
		p_horizon: plan.frontMatter.horizon,
		p_language: plan.frontMatter.language,
		p_as_of_date: pack.request.as_of,
		p_pack_id: pack.pack_id,
		p_prompt_version: pack.prompt.version,
		p_data_pack: pack,
		p_lint: {
			summary: lint.summary,
			warnings: lint.issues
				.filter((issue) => issue.level === "warning")
				.map((issue) => issue.code),
		},
		p_generated_via: via,
	};
}
