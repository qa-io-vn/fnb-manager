import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { aggregatesOnlyIssues } from "../../src/pack/aggregates.js";
import { canonicalJson } from "../../src/pack/canonical.js";
import { parsePack } from "../../src/pack/invariants.js";
import { trackableMetricIds } from "../../src/pack/kpi-ids.js";
import type { DataPack } from "../../src/pack/schema.js";
import { TABLE_IDS } from "../../src/pack/tables/text.js";
import { lintPlan } from "../../src/plan/lint.js";
import { MIN_INITIATIVES } from "../../src/plan/sections.js";
import { strategyPrompt } from "../../src/prompt/prompt.js";
import { miniPack, samplePlan } from "../../src/testing/index.js";
import {
	derivedPlanFixtures,
	goldenPack,
	MINI_PACK_PATH,
	MISSING_SECTION,
	PROMPT_EXAMPLE,
	planFixture,
	UNKNOWN_KPI,
	withKpiRenamed,
	withoutSection,
	withPackId,
} from "./fixture-plans.js";

const SEED_STORES = [
	{ id: "22222222-2222-4222-8222-000000000001", label: "S1" },
	{ id: "22222222-2222-4222-8222-000000000002", label: "S2" },
];

function miniPackText(): string {
	return readFileSync(MINI_PACK_PATH, "utf8");
}

function codesOf(name: string, pack: DataPack): string[] {
	return lintPlan(planFixture(name), pack).issues.map((issue) => issue.code);
}

describe("mini-pack.json", () => {
	it("is a valid live-shaped pack of the seed's two synthetic stores", async () => {
		const parsed = await parsePack(miniPackText());
		expect(parsed.issues).toEqual([]);
		expect(parsed.valid).toBe(true);
		const pack = parsed.pack;
		if (pack === null) throw new Error("mini-pack.json did not parse");
		expect(parsed.packId).toBe(pack.pack_id);
		expect(pack.sample).toBe(false);
		expect(pack.request.stores).toEqual(SEED_STORES);
		expect(pack.request.language).toBe("vi");
		expect(pack.prompt).toEqual({ ...strategyPrompt("vi") });
		expect(Object.keys(pack.tables).sort()).toEqual([...TABLE_IDS].sort());
		expect(aggregatesOnlyIssues(pack)).toEqual([]);
		for (const scope of ["ALL", "S1", "S2"]) {
			for (const id of trackableMetricIds()) {
				expect(
					pack.tables.kpi?.rows[`${scope}/${id}`],
					`${scope}/${id}`,
				).toHaveLength(8);
			}
		}
	});

	it("is stored as its canonical text formatted, so the pack id recomputes", async () => {
		const text = miniPackText();
		const pack = JSON.parse(text) as DataPack;
		const canonical = canonicalJson(pack as never);
		expect((await parsePack(canonical)).packId).toBe(pack.pack_id);
		expect(text.endsWith("}\n")).toBe(true);
	});

	it("is what miniPack() returns, a fresh copy on every call", () => {
		const pack = miniPack();
		expect(pack).toEqual(JSON.parse(miniPackText()));
		pack.request.stores.length = 0;
		expect(miniPack().request.stores).toEqual(SEED_STORES);
	});

	it("gives a sample plan without any issue", () => {
		const pack = miniPack();
		expect(lintPlan(samplePlan(pack), pack).issues).toEqual([]);
	});
});

describe("prompt-example.md", () => {
	it("lints against the mini pack with no issue at all", () => {
		const pack = miniPack();
		const lint = lintPlan(planFixture(PROMPT_EXAMPLE), pack);
		expect(lint.issues).toEqual([]);
		expect(lint.ok).toBe(true);
		expect(lint.summary).toMatchObject({
			initiatives: MIN_INITIATIVES,
			citedInitiatives: MIN_INITIATIVES,
			kpis: 5,
			uncitedNumbers: 0,
		});
		expect(lint.summary.validCitations).toBe(lint.summary.citations);
		expect(lint.plan?.frontMatter.pack).toBe(pack.pack_id);
	});

	it("is written as the prompt asks: the prompt's front matter, its citation style, a target on each KPI line and worked estimates", () => {
		const text = planFixture(PROMPT_EXAMPLE);
		expect(
			text.startsWith('---\n{\n  "format": "fnb-plan/1",\n  "pack": '),
		).toBe(true);
		expect(text).not.toContain("```");
		expect(text).toContain("1,23 tỷ đồng [[kpi:ALL/net_revenue:w28]]");
		expect(text).toContain("124,8 triệu đồng [[items:ALL/r01:net]]");
		expect(text).toContain("52.314 đ [[kpi:ALL/avg_ticket:w28]]");
		const plan = lintPlan(text, miniPack()).plan;
		if (plan === null) throw new Error("no plan");
		for (const initiative of plan.initiatives) {
			const kpi = initiative.fields.kpi?.text ?? "";
			const impact = initiative.fields.impact?.text ?? "";
			expect(kpi, `initiative ${initiative.number}`).toMatch(/mục tiêu [0-9]/);
			expect(impact, `initiative ${initiative.number}`).toMatch(/^ước tính /);
			expect(impact, `initiative ${initiative.number}`).toMatch(/[×+−=≈]/);
		}
	});

	it("names the mini pack's id, which the fixtures script rewrites", () => {
		const text = planFixture(PROMPT_EXAMPLE);
		expect(withPackId(text, miniPack().pack_id)).toBe(text);
		expect(withPackId(text, "f".repeat(64))).toContain(
			`"pack": "${"f".repeat(64)}",`,
		);
	});
});

describe("the rejection fixtures", () => {
	it("missing-section.md gives exactly section_missing:7 against the golden demo pack", () => {
		expect(codesOf(MISSING_SECTION, goldenPack())).toEqual([
			"section_missing:7",
		]);
		expect(planFixture(MISSING_SECTION)).not.toContain("## 7. ");
	});

	it("unknown-kpi.md gives exactly kpi_unknown:net_sales against the golden demo pack", () => {
		const pack = goldenPack();
		const lint = lintPlan(planFixture(UNKNOWN_KPI), pack);
		expect(lint.issues).toEqual([
			{ code: "kpi_unknown:net_sales", level: "error", line: 9, detail: null },
		]);
		expect(lint.normalized.split("\n")[8]).toContain('"net_sales"');
		expect(
			lint.plan?.initiatives
				.filter((initiative) => initiative.fields.kpi?.text === "net_sales")
				.map((initiative) => initiative.number),
		).toEqual([1, 4]);
	});

	it("are the sample plan of the golden demo pack, changed in one place each", () => {
		const pack = goldenPack();
		const fixtures = derivedPlanFixtures(pack);
		expect(Object.keys(fixtures).sort()).toEqual([
			MISSING_SECTION,
			UNKNOWN_KPI,
		]);
		for (const [name, text] of Object.entries(fixtures)) {
			expect(planFixture(name), name).toBe(text);
		}
		const plan = samplePlan(pack);
		expect(lintPlan(plan, pack).issues).toEqual([]);
		expect(withoutSection(plan, pack, 7)).toBe(planFixture(MISSING_SECTION));
		expect(withKpiRenamed(plan, "avg_ticket", "net_sales")).toBe(
			planFixture(UNKNOWN_KPI),
		);
		expect(() => withKpiRenamed(plan, "invoices", "net_sales")).toThrow();
	});
});
