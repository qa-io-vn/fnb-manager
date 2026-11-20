import {
	buildDataPack,
	type DataPack,
	lintPlan,
	type PackLanguage,
	planRecord,
} from "@fnb/datapack";
import { samplePlan } from "@fnb/datapack/testing";
import type { ReportSource } from "@fnb/reports";
import type { IsoDate } from "../lib/business-dates";
import type { PlanDetail } from "./source";

export const DEMO_SAMPLE_PLAN_ID = "00000000-0000-4000-8000-0000000000d1";

export interface DemoSeedOptions {
	readonly source: ReportSource;
	readonly storeIds: readonly string[];
	readonly asOf: IsoDate;
	readonly language: PackLanguage;
	readonly now: Date;
}

export async function demoSamplePlan(
	options: DemoSeedOptions,
): Promise<PlanDetail | null> {
	const built = await buildDataPack(
		{
			storeIds: options.storeIds,
			asOf: options.asOf,
			horizon: "90d",
			language: options.language,
			focus: null,
			ownerNote: null,
			sample: true,
		},
		{
			source: options.source,
			clock: { now: () => options.now },
			fence: null,
			onProgress: () => undefined,
		},
	);
	const pack: DataPack = built.pack;
	const lint = lintPlan(samplePlan(pack), pack);
	if (!lint.ok || lint.plan === null) return null;
	const record = planRecord(
		lint.plan,
		{ ...pack, sample: false },
		lint,
		"pasted",
	);
	return {
		id: DEMO_SAMPLE_PLAN_ID,
		title: record.p_title,
		storeIds: record.p_store_ids,
		createdAt: options.now.toISOString(),
		asOf: record.p_as_of_date,
		horizon: record.p_horizon,
		language: record.p_language,
		via: "pasted",
		kpis: record.p_kpis,
		lint: record.p_lint,
		archivedAt: null,
		promptVersion: record.p_prompt_version,
		packId: record.p_pack_id,
		content: record.p_content_markdown,
		pack,
	};
}
