import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DataPack } from "../../src/pack/schema.js";
import { PLAN_SECTIONS } from "../../src/plan/sections.js";
import { sampleKpis, samplePlan } from "../../src/testing/sample-plan.js";

export const PLANS_DIRECTORY = join(
	import.meta.dirname,
	"..",
	"fixtures",
	"plans",
);
export const GOLDEN_PACK_PATH = join(
	import.meta.dirname,
	"..",
	"fixtures",
	"demo-pack.json",
);
export const MINI_PACK_PATH = join(PLANS_DIRECTORY, "mini-pack.json");
export const PROMPT_EXAMPLE = "prompt-example.md";
export const MISSING_SECTION = "missing-section.md";
export const UNKNOWN_KPI = "unknown-kpi.md";
export const MISSING_SECTION_NUMBER = 7;
export const UNKNOWN_KPI_ID = "net_sales";

const PACK_LINE = /^(\s*"pack":\s*")[0-9a-f]{64}(",?)$/m;

export function goldenPack(): DataPack {
	return JSON.parse(readFileSync(GOLDEN_PACK_PATH, "utf8")) as DataPack;
}

export function planFixture(name: string): string {
	return readFileSync(join(PLANS_DIRECTORY, name), "utf8").replace(
		/\r\n/g,
		"\n",
	);
}

export function withoutSection(
	plan: string,
	pack: DataPack,
	number: number,
): string {
	const section = PLAN_SECTIONS.find((entry) => entry.number === number);
	if (section === undefined) throw new Error(`no section ${number}`);
	const lines = plan.split("\n");
	const start = lines.indexOf(
		`## ${section.number}. ${section.title[pack.request.language]}`,
	);
	if (start === -1) throw new Error(`the plan has no section ${number}`);
	const next = lines.findIndex(
		(line, index) => index > start && line.startsWith("## "),
	);
	const end = next === -1 ? lines.length : next;
	return [...lines.slice(0, start), ...lines.slice(end)].join("\n");
}

export function withKpiRenamed(plan: string, from: string, to: string): string {
	const key = new RegExp(`^(\\t+)"${from}": \\{`, "m");
	if (!key.test(plan)) throw new Error(`the front matter has no ${from}`);
	const field = new RegExp(`^(- \\*\\*KPI:\\*\\* )${from}$`, "gm");
	if (plan.match(field) === null) {
		throw new Error(`no KPI field names ${from}`);
	}
	return plan.replace(key, `$1"${to}": {`).replace(field, `$1${to}`);
}

export function derivedPlanFixtures(
	pack: DataPack,
): Readonly<Record<string, string>> {
	const plan = samplePlan(pack);
	const [first] = sampleKpis(pack);
	if (first === undefined) throw new Error("the sample plan has no KPI");
	return {
		[MISSING_SECTION]: withoutSection(plan, pack, MISSING_SECTION_NUMBER),
		[UNKNOWN_KPI]: withKpiRenamed(plan, first.id, UNKNOWN_KPI_ID),
	};
}

export function withPackId(plan: string, packId: string): string {
	if (!PACK_LINE.test(plan)) throw new Error("the plan names no pack id");
	return plan.replace(PACK_LINE, `$1${packId}$2`);
}
