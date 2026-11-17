import { describe, expect, it } from "vitest";
import {
	type DataPack,
	DataPackError,
	KPI_WINDOW_DAYS,
	lintPlan,
	PLAN_VIAS,
	type PlanLintResult,
	planRecord,
} from "../../src/index.js";
import {
	cleanPlan,
	LINT_PACK_ID,
	lintFixtureText,
	lintPack,
	oneStorePack,
	replacing,
	STORE_S1,
	STORE_S2,
} from "./support.js";

function linted(text: string, pack: DataPack = lintPack()): PlanLintResult {
	const result = lintPlan(text, pack);
	if (result.plan === null) throw new Error("the plan did not parse");
	return result;
}

function recordOf(text: string, pack: DataPack = lintPack()) {
	const lint = linted(text, pack);
	if (lint.plan === null) throw new Error("the plan did not parse");
	return planRecord(lint.plan, pack, lint, "pasted");
}

function refusal(call: () => unknown): string | null {
	try {
		call();
	} catch (error) {
		return error instanceof DataPackError ? error.code : "other";
	}
	return null;
}

describe("planRecord", () => {
	it("turns a clean plan into the arguments of publish_strategy_plan", () => {
		const pack = lintPack();
		const lint = linted(cleanPlan(), pack);
		if (lint.plan === null) return;
		const record = planRecord(lint.plan, pack, lint, "pasted");
		expect(record).toEqual({
			p_store_ids: [STORE_S1, STORE_S2],
			p_title: "Kế hoạch 90 ngày cho hai cửa hàng",
			p_content_markdown: lint.normalized,
			p_kpis: {
				avg_ticket: {
					scope: "ALL",
					store_ids: [STORE_S1, STORE_S2],
					baseline: 52314.27,
					target: 55000,
					lo: 49800.5,
					hi: 54100.25,
					initiatives: [1, 2],
					due_on: "2027-02-09",
					window_days: 28,
				},
				discount_rate: {
					scope: "ALL",
					store_ids: [STORE_S1, STORE_S2],
					baseline: 0.0425,
					target: 0.038,
					lo: 0.031,
					hi: 0.047,
					initiatives: [3],
					due_on: "2027-02-09",
					window_days: 28,
				},
				attach_rate_topping: {
					scope: "ALL",
					store_ids: [STORE_S1, STORE_S2],
					baseline: 0.3125,
					target: 0.34,
					lo: 0.29,
					hi: 0.34,
					initiatives: [4],
					due_on: "2027-02-09",
					window_days: 28,
				},
				invoices: {
					scope: "S2",
					store_ids: [STORE_S2],
					baseline: 10400,
					target: 11000,
					lo: 9600,
					hi: 11000,
					initiatives: [5],
					due_on: "2027-02-09",
					window_days: 28,
				},
			},
			p_horizon: "90d",
			p_language: "vi",
			p_as_of_date: "2026-11-11",
			p_pack_id: LINT_PACK_ID,
			p_prompt_version: "1.0.0",
			p_data_pack: pack,
			p_lint: { summary: lint.summary, warnings: [] },
			p_generated_via: "pasted",
		});
		expect(Object.keys(record.p_kpis)).toEqual(
			Object.keys(lint.plan.frontMatter.kpis),
		);
		expect(KPI_WINDOW_DAYS).toBe(28);
	});

	it("stores the normalised text, not the pasted one", () => {
		const pasted = `﻿${cleanPlan().replace(/\n/g, "\r\n")}`;
		const record = recordOf(pasted);
		expect(record.p_content_markdown).toBe(cleanPlan());
		expect(record.p_content_markdown.includes("\r")).toBe(false);
	});

	it("copies the baseline exactly from w28, whatever the front matter wrote", () => {
		const text = replacing(
			cleanPlan(),
			'"baseline": 52314.27',
			'"baseline": 52314',
		);
		expect(lintPlan(text, lintPack()).issues).toEqual([]);
		expect(recordOf(text).p_kpis.avg_ticket?.baseline).toBe(52314.27);
		const without = replacing(cleanPlan(), ', "baseline": 52314.27', "");
		expect(recordOf(without).p_kpis.avg_ticket?.baseline).toBe(52314.27);
	});

	it("maps each scope to its store ids, with S1 alone in a one-store pack", () => {
		const one = oneStorePack();
		const text = replacing(
			replacing(cleanPlan(), '"scope": "S2"', '"scope": "S1"'),
			'"target": 11000',
			'"target": 25000',
		);
		const record = recordOf(text, one);
		expect(record.p_store_ids).toEqual([STORE_S1]);
		expect(record.p_kpis.invoices).toMatchObject({
			scope: "S1",
			store_ids: [STORE_S1],
			baseline: 23600,
			lo: 21800,
			hi: 24900,
		});
		expect(record.p_kpis.avg_ticket?.store_ids).toEqual([STORE_S1]);
	});

	it("keeps a missing band as null and dates the KPIs at the end of the horizon", () => {
		const pack = lintPack();
		const kpi = pack.tables.kpi;
		if (kpi === undefined) throw new Error("no kpi table");
		const changed: DataPack = {
			...pack,
			calendar: {
				...pack.calendar,
				horizon: { from: "2026-11-12", to: "2027-01-10" },
			},
			tables: {
				...pack.tables,
				kpi: {
					...kpi,
					rows: {
						...kpi.rows,
						"S2/invoices": [10400, 10150, null, 0.0246, null, null, null, 8],
					},
				},
			},
		};
		const record = recordOf(cleanPlan(), changed);
		expect(record.p_kpis.invoices).toMatchObject({ lo: null, hi: null });
		for (const stored of Object.values(record.p_kpis)) {
			expect(stored.due_on).toBe("2027-01-10");
			expect(stored.window_days).toBe(KPI_WINDOW_DAYS);
		}
	});

	it("carries the lint summary with its warning codes and the way the plan came", () => {
		const lint = linted(lintFixtureText("uncited_numbers.md"));
		const pack = lintPack();
		for (const via of PLAN_VIAS) {
			if (lint.plan === null) return;
			const record = planRecord(lint.plan, pack, lint, via);
			expect(record.p_generated_via).toBe(via);
			expect(record.p_lint).toEqual({
				summary: lint.summary,
				warnings: ["uncited_numbers:2"],
			});
		}
		const both = linted(
			`Kế hoạch:\n\n${lintFixtureText("kpi_initiative_unlinked.md")}`,
		);
		if (both.plan === null) return;
		expect(planRecord(both.plan, pack, both, "skill").p_lint.warnings).toEqual([
			"preamble_text",
			"kpi_initiative_unlinked:avg_ticket",
		]);
	});

	it("refuses a sample pack", () => {
		const pack = lintPack();
		const sample: DataPack = {
			...pack,
			sample: true,
			request: {
				...pack.request,
				stores: [
					{ id: "MOCK-S1", label: "S1" },
					{ id: "MOCK-S2", label: "S2" },
				],
			},
		};
		const lint = linted(cleanPlan(), sample);
		expect(lint.issues).toEqual([]);
		for (const via of PLAN_VIAS) {
			expect(
				refusal(() => {
					if (lint.plan !== null) planRecord(lint.plan, sample, lint, via);
				}),
			).toBe("sample_pack_not_publishable");
		}
	});

	it("refuses a plan written from another pack", () => {
		const lint = linted(lintFixtureText("pack_mismatch.md"));
		expect(
			refusal(() => {
				if (lint.plan !== null)
					planRecord(lint.plan, lintPack(), lint, "pasted");
			}),
		).toBe("pack_id_mismatch");
	});
});
