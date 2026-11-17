import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	aggregatesOnlyIssues,
	canonicalJson,
	type DataPack,
	dataPackSchema,
	estimateTokens,
	lintPlan,
	parsePack,
	validatePack,
} from "../../src/index.js";
import { packIdOf } from "../../src/pack/hash.js";
import {
	PLAN_LINT_CODE_IDS,
	PLAN_LINT_CODES,
	planIssueParameter,
	planLintCodeOf,
} from "../../src/plan/codes.js";
import {
	cleanPlan,
	expectedLintCodes,
	GENERATED_LINT_FIXTURES,
	LINT_PACK_ID,
	lintFixtureNames,
	lintFixtureText,
	lintPack,
	lintPackJson,
	lintResultsText,
	PLAN_FIXTURES,
	replacing,
} from "./support.js";

const CLEAN_FIXTURES = ["clean.en.md", "clean.vi.md"];
const RESULTS_SNAPSHOT = "../fixtures/plans/lint/results.json";

function codesOf(text: string, pack: DataPack = lintPack()): string[] {
	return lintPlan(text, pack).issues.map((issue) => issue.code);
}

describe("the lint codes", () => {
	it("keep the issue code style: snake_case, then the parameter after a colon", () => {
		for (const code of PLAN_LINT_CODE_IDS) {
			expect(code).toMatch(/^[a-z][a-z0-9_]*$/);
			expect(planLintCodeOf(code)).toBe(code);
			expect(planLintCodeOf(`${code}:x:y`)).toBe(code);
		}
		expect(planLintCodeOf("toString")).toBeNull();
		expect(planLintCodeOf("not_a_code:1")).toBeNull();
		expect(planIssueParameter("citation_unknown:kpi:ALL/x:w28")).toBe(
			"kpi:ALL/x:w28",
		);
		expect(planIssueParameter("pack_mismatch")).toBeNull();
	});

	it("have one fixture each, named after the code", () => {
		const expected = expectedLintCodes();
		expect(Object.keys(expected).sort()).toEqual(
			[...lintFixtureNames(), ...Object.keys(GENERATED_LINT_FIXTURES)].sort(),
		);
		for (const code of PLAN_LINT_CODE_IDS) {
			const codes = expected[`${code}.md`];
			expect(codes, code).toBeDefined();
			expect(codes?.map((entry) => planLintCodeOf(entry))).toContain(code);
		}
	});

	it.each(Object.entries(expectedLintCodes()))(
		"%s gives exactly %j at the declared level",
		(name, codes) => {
			const result = lintPlan(lintFixtureText(name), lintPack());
			expect(result.issues.map((issue) => issue.code)).toEqual(codes);
			for (const issue of result.issues) {
				const code = planLintCodeOf(issue.code);
				expect(code).not.toBeNull();
				expect(issue.level).toBe(PLAN_LINT_CODES[code ?? "pack_mismatch"]);
			}
			expect(result.ok).toBe(
				result.issues.every((issue) => issue.level === "warning"),
			);
		},
	);

	it("finds no problem at all in the clean fixtures", () => {
		for (const name of CLEAN_FIXTURES) {
			const result = lintPlan(lintFixtureText(name), lintPack());
			expect(result.ok, name).toBe(true);
			expect(result.issues, name).toEqual([]);
			expect(result.summary).toMatchObject({
				initiatives: 5,
				citedInitiatives: 5,
				citations: 19,
				validCitations: 19,
				kpis: 4,
				uncitedNumbers: 0,
			});
			expect(result.summary.words).toBeGreaterThan(400);
		}
	});

	it("matches the recorded results of every fixture", async () => {
		await expect(await lintResultsText()).toMatchFileSnapshot(RESULTS_SNAPSHOT);
	});
});

describe("the rejections of #24, client half", () => {
	it("names a missing section by its number", () => {
		const result = lintPlan(lintFixtureText("section_missing.md"), lintPack());
		expect(result.ok).toBe(false);
		expect(result.issues).toEqual([
			{ code: "section_missing:7", level: "error", line: null, detail: null },
		]);
	});

	it("names an unknown KPI id with the line of its front-matter key", () => {
		const result = lintPlan(lintFixtureText("kpi_unknown.md"), lintPack());
		expect(result.ok).toBe(false);
		expect(result.issues).toEqual([
			{ code: "kpi_unknown:net_sales", level: "error", line: 9, detail: null },
		]);
		expect(result.normalized.split("\n")[8]).toContain('"net_sales"');
	});

	it("names every missing section, not only the first", () => {
		const text = replacing(
			replacing(cleanPlan(), "## 8. Rủi ro", "## 8. Rủi ro và cơ hội"),
			"## 5. Thực đơn",
			"## 5. Món",
		);
		expect(codesOf(text)).toEqual(["section_missing:5", "section_missing:8"]);
	});
});

describe("the parsed plan and the summary", () => {
	it("returns the parsed plan only when the front matter is valid", () => {
		for (const name of Object.keys(expectedLintCodes())) {
			const result = lintPlan(lintFixtureText(name), lintPack());
			const broken =
				name === "front_matter_missing.md" ||
				name === "front_matter_invalid.md";
			expect(result.plan === null, name).toBe(broken);
			if (result.plan !== null) {
				expect(result.plan.text).toBe(result.normalized);
				expect(result.summary.kpis).toBe(
					Object.keys(result.plan.frontMatter.kpis).length,
				);
			}
		}
	});

	it("orders errors before warnings, then by line", () => {
		const text = replacing(
			replacing(
				cleanPlan(),
				'"horizon": "90d",',
				'"horizon": "90d",\n\t"note": "x",',
			),
			"52.314 đ [[kpi:ALL/avg_ticket:w28]]",
			"52.314 đ [[kpi:ALL/avg_ticket:w29]]",
		);
		const result = lintPlan(`Kế hoạch:\n\n${text}`, lintPack());
		expect(result.issues.map((issue) => [issue.code, issue.line])).toEqual([
			["citation_unknown:kpi:ALL/avg_ticket:w29", 24],
			["preamble_text", null],
			["front_matter_extra_fields", 1],
		]);
		expect(result.ok).toBe(false);
	});
});

describe("lintPlan never throws", () => {
	const pack = lintPack();
	const awkward = [
		"",
		"\n\n",
		"---",
		"---\n---",
		"---\n{}\n---",
		"---\n[]\n---\n",
		'---\n{"format":"fnb-plan/1","kpis":{"__proto__":{"target":1,"initiatives":[1]}}}\n---',
		`---\n${"[".repeat(5000)}\n---`,
		"```",
		'```json\n{"format":"fnb-plan/1"}',
		"[[",
		"[[]] [[:::]] [[kpi:ALL/avg_ticket:w28]]",
		"𐀀\uD800 \u0000 ‮",
		"### Sáng kiến 99999999999999999999: x",
		"- **Căn cứ:** 1e400 [[kpi:ALL/avg_ticket:w28]]",
		"9".repeat(400),
		"#".repeat(7),
		`${"1.".repeat(2000)} [[kpi:ALL/avg_ticket:w28]]`,
	];

	it.each(awkward.map((text) => [text.slice(0, 40), text]))(
		"%j",
		(_label, text) => {
			const result = lintPlan(text, pack);
			expect(result.ok).toBe(false);
			expect(result.normalized.endsWith("\n")).toBe(true);
			expect(result.issues.length).toBeGreaterThan(0);
			expect(result.summary.kpis).toBeGreaterThanOrEqual(0);
		},
	);

	it("reports the size of an oversized plan and still checks it", () => {
		const result = lintPlan(lintFixtureText("content_too_large.md"), pack);
		expect(result.issues).toHaveLength(1);
		expect(Number(result.issues[0]?.detail)).toBeGreaterThan(200000);
		expect(result.summary.initiatives).toBe(5);
	});
});

describe("the pack a plan was written from", () => {
	it("is the lint fixture pack with its real pack id and token estimate", async () => {
		const json = lintPackJson();
		const pack = dataPackSchema.parse(json);
		expect(pack.pack_id).toBe(LINT_PACK_ID);
		expect(await packIdOf(pack)).toBe(LINT_PACK_ID);
		expect(estimateTokens(canonicalJson(pack))).toBe(
			pack.budget.estimated_tokens,
		);
		expect(aggregatesOnlyIssues(pack)).toEqual([]);
		const codes = (await validatePack(json)).issues.map((entry) => entry.code);
		expect(codes).not.toContain("pack_id_mismatch");
		expect(codes).not.toContain("budget_estimate");
	});

	it("is tied to the plan through the pack id that parsePack recomputes", async () => {
		const text = readFileSync(join(PLAN_FIXTURES, "lint-pack.json"), "utf8");
		const parsed = await parsePack(text);
		expect(parsed.packId).toBe(LINT_PACK_ID);
		expect(parsed.pack).not.toBeNull();
		if (parsed.pack === null) return;
		expect(lintPlan(cleanPlan(), parsed.pack).issues).toEqual([]);
		expect(codesOf(lintFixtureText("pack_mismatch.md"), parsed.pack)).toEqual([
			"pack_mismatch",
		]);
	});

	it("refuses a plan written from the same pack once its content changed", async () => {
		const pack = lintPack();
		const changed: DataPack = {
			...pack,
			tables: {
				...pack.tables,
				items: {
					...pack.tables.items,
					rows: {
						...pack.tables.items?.rows,
						"ALL/i03": ["Bánh mì que", 411, 6150000, 0.005, null, "C"],
					},
				},
			} as DataPack["tables"],
		};
		const changedId = await packIdOf(changed);
		expect(changedId).not.toBe(LINT_PACK_ID);
		const rebuilt = { ...changed, pack_id: changedId };
		const result = lintPlan(cleanPlan(), rebuilt);
		expect(result.issues).toEqual([
			{ code: "pack_mismatch", level: "error", line: 4, detail: LINT_PACK_ID },
		]);
		const rewritten = replacing(cleanPlan(), LINT_PACK_ID, changedId);
		expect(lintPlan(rewritten, rebuilt).issues).toEqual([]);
	});

	it("keeps a plan valid when only generated_at differs", async () => {
		const pack = lintPack();
		const later = { ...pack, generated_at: "2026-11-12T09:30:00Z" };
		expect(await packIdOf(later)).toBe(LINT_PACK_ID);
		expect(lintPlan(cleanPlan(), later).issues).toEqual([]);
	});
});
