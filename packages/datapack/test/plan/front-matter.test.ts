import { describe, expect, it } from "vitest";
import {
	DataPackError,
	lintPlan,
	parsePlan,
	planFrontMatterSchema,
} from "../../src/index.js";
import {
	frontMatterKeyLine,
	readFrontMatter,
} from "../../src/plan/front-matter.js";
import {
	cleanPlan,
	LINT_PACK_ID,
	lintFixtureText,
	lintPack,
	replacing,
} from "./support.js";

function frontMatterLines(
	value: unknown,
	body = "## 1. Tóm tắt tình hình",
): string[] {
	return [
		"---",
		...JSON.stringify(value, null, "\t").split("\n"),
		"---",
		"",
		body,
	];
}

const VALID = {
	format: "fnb-plan/1",
	pack: LINT_PACK_ID,
	title: "Kế hoạch 90 ngày",
	horizon: "90d",
	language: "vi",
	kpis: {
		avg_ticket: { target: 55000, initiatives: [1] },
		invoices: { scope: "S2", target: 11000, baseline: 10400, initiatives: [5] },
	},
};

describe("readFrontMatter", () => {
	it("reads valid front matter through planFrontMatterSchema with scope ALL by default", () => {
		const lines = frontMatterLines(VALID);
		const read = readFrontMatter(lines);
		expect(read.status).toBe("valid");
		expect(read.invalidPaths).toEqual([]);
		expect(read.extraKeys).toEqual([]);
		expect(read.bodyStart).toBe(lines.indexOf("", 1));
		expect(read.frontMatter).toEqual(planFrontMatterSchema.parse(VALID));
		expect(read.frontMatter?.kpis.avg_ticket?.scope).toBe("ALL");
		expect(read.frontMatter?.kpis.invoices).toEqual({
			scope: "S2",
			target: 11000,
			baseline: 10400,
			initiatives: [5],
		});
	});

	it("keeps the KPI order of the text", () => {
		const read = readFrontMatter(
			frontMatterLines({
				...VALID,
				kpis: {
					invoices: { target: 1, initiatives: [1] },
					avg_ticket: { target: 1, initiatives: [1] },
				},
			}),
		);
		expect(Object.keys(read.frontMatter?.kpis ?? {})).toEqual([
			"invoices",
			"avg_ticket",
		]);
	});

	it("reports missing front matter when the text does not open with three dashes or never closes them", () => {
		for (const lines of [
			["# Kế hoạch", "---", "{}", "---"],
			["", "---", "{}", "---"],
			["---", "{}", "## 1. Tóm tắt tình hình"],
			[],
		]) {
			const read = readFrontMatter(lines);
			expect(read.status).toBe("missing");
			expect(read.frontMatter).toBeNull();
			expect(read.bodyStart).toBe(0);
		}
	});

	it("reports front matter that is not a JSON object at the root", () => {
		for (const inside of [
			"format: fnb-plan/1",
			"[1, 2]",
			"null",
			'"text"',
			"{,}",
		]) {
			const read = readFrontMatter(["---", inside, "---", "body"]);
			expect(read.status).toBe("invalid");
			expect(read.invalidPaths).toEqual([""]);
			expect(read.bodyStart).toBe(3);
		}
	});

	it("reports each failing path of the schema once", () => {
		const read = readFrontMatter(
			frontMatterLines({
				...VALID,
				pack: "abc",
				horizon: "3 tháng",
				kpis: {
					AvgTicket: { target: 1, initiatives: [1] },
					invoices: { target: "nhiều", initiatives: [] },
				},
			}),
		);
		expect(read.status).toBe("invalid");
		expect(read.frontMatter).toBeNull();
		expect(read.invalidPaths).toEqual([
			"pack",
			"horizon",
			"kpis.AvgTicket",
			"kpis.invoices.target",
			"kpis.invoices.initiatives",
		]);
	});

	it("drops unknown keys and names them, at the top and inside a KPI", () => {
		const read = readFrontMatter(
			frontMatterLines({
				...VALID,
				note: "bản nháp",
				kpis: {
					avg_ticket: { target: 55000, initiatives: [1], unit: "VND" },
				},
			}),
		);
		expect(read.status).toBe("valid");
		expect(read.extraKeys).toEqual(["note", "kpis.avg_ticket.unit"]);
		expect(read.frontMatter).not.toHaveProperty("note");
		expect(read.frontMatter?.kpis.avg_ticket).not.toHaveProperty("unit");
	});

	it("names unknown keys of invalid front matter too", () => {
		const read = readFrontMatter(
			frontMatterLines({ ...VALID, horizon: "1y", author: "x" }),
		);
		expect(read.status).toBe("invalid");
		expect(read.extraKeys).toEqual(["author"]);
	});

	it("finds the line of a key for the issue it causes", () => {
		const lines = frontMatterLines(VALID);
		const read = readFrontMatter(lines);
		expect(frontMatterKeyLine(read, "pack")).toBe(
			lines.indexOf(`\t"pack": "${LINT_PACK_ID}",`) + 1,
		);
		expect(lines[frontMatterKeyLine(read, "invoices") - 1]).toContain(
			'"invoices": {',
		);
		expect(frontMatterKeyLine(read, "absent")).toBe(1);
		expect(frontMatterKeyLine(readFrontMatter(["# x"]), "pack")).toBe(1);
	});
});

describe("planFrontMatterSchema", () => {
	function accepts(change: Record<string, unknown>): boolean {
		return planFrontMatterSchema.safeParse({ ...VALID, ...change }).success;
	}

	function acceptsKpi(kpi: Record<string, unknown>): boolean {
		return accepts({ kpis: { avg_ticket: kpi } });
	}

	it("refuses another format, a malformed pack id, title, horizon or language", () => {
		expect(accepts({})).toBe(true);
		expect(accepts({ format: "fnb-plan/2" })).toBe(false);
		expect(accepts({ pack: LINT_PACK_ID.toUpperCase() })).toBe(false);
		expect(accepts({ pack: LINT_PACK_ID.slice(1) })).toBe(false);
		expect(accepts({ title: "" })).toBe(false);
		expect(accepts({ title: "x".repeat(120) })).toBe(true);
		expect(accepts({ title: "x".repeat(121) })).toBe(false);
		expect(accepts({ horizon: "3m" })).toBe(false);
		expect(accepts({ language: "fr" })).toBe(false);
	});

	it("holds each KPI to its scope, target and initiative numbers", () => {
		expect(acceptsKpi({ target: 1, initiatives: [1, 7] })).toBe(true);
		expect(acceptsKpi({ scope: "S12", target: 1, initiatives: [1] })).toBe(
			true,
		);
		for (const scope of ["all", "S", "S123", "s1", "ALL/S1"]) {
			expect(acceptsKpi({ scope, target: 1, initiatives: [1] }), scope).toBe(
				false,
			);
		}
		expect(acceptsKpi({ target: Number.NaN, initiatives: [1] })).toBe(false);
		expect(acceptsKpi({ target: "55000", initiatives: [1] })).toBe(false);
		expect(acceptsKpi({ initiatives: [1] })).toBe(false);
		expect(acceptsKpi({ target: 1, initiatives: [] })).toBe(false);
		expect(acceptsKpi({ target: 1, initiatives: [0] })).toBe(false);
		expect(acceptsKpi({ target: 1, initiatives: [8] })).toBe(false);
		expect(acceptsKpi({ target: 1, initiatives: [1.5] })).toBe(false);
		expect(
			accepts({ kpis: { "Avg-Ticket": { target: 1, initiatives: [1] } } }),
		).toBe(false);
	});
});

describe("front matter in the lint", () => {
	it("warns about dropped keys at line 1 and keeps the plan valid", () => {
		const text = replacing(
			replacing(
				cleanPlan(),
				'"horizon": "90d",',
				'"horizon": "90d",\n\t"author": "x",',
			),
			'"discount_rate": { "target": 0.038,',
			'"discount_rate": { "unit": "%", "target": 0.038,',
		);
		const result = lintPlan(text, lintPack());
		expect(result.ok).toBe(true);
		expect(result.issues).toEqual([
			{
				code: "front_matter_extra_fields",
				level: "warning",
				line: 1,
				detail: "author, kpis.discount_rate.unit",
			},
		]);
		expect(result.plan?.extraFrontMatterKeys).toEqual([
			"author",
			"kpis.discount_rate.unit",
		]);
		expect(result.plan?.frontMatter).not.toHaveProperty("author");
		expect(result.plan?.frontMatter.kpis.discount_rate).toEqual({
			scope: "ALL",
			target: 0.038,
			initiatives: [3],
		});
	});

	it("names each invalid path at the line of its key and skips the KPI checks", () => {
		const text = replacing(
			replacing(cleanPlan(), '"horizon": "90d"', '"horizon": "3 tháng"'),
			'"target": 55000',
			'"target": "nhiều"',
		);
		const result = lintPlan(text, lintPack());
		expect(result.plan).toBeNull();
		expect(result.summary.kpis).toBe(0);
		expect(result.issues).toEqual([
			{
				code: "front_matter_invalid",
				level: "error",
				line: 6,
				detail: "horizon",
			},
			{
				code: "front_matter_invalid",
				level: "error",
				line: 9,
				detail: "kpis.avg_ticket.target",
			},
		]);
	});

	it("refuses front matter that is not JSON at line 1", () => {
		const text = cleanPlan().replace(
			/^---\n[\s\S]*?\n---\n/,
			"---\nformat: fnb-plan/1\ntitle: Kế hoạch\n---\n",
		);
		const result = lintPlan(text, lintPack());
		expect(result.issues).toEqual([
			{ code: "front_matter_invalid", level: "error", line: 1, detail: null },
		]);
	});

	it("reads front matter given as an fnb-plan code block", () => {
		const text = replacing(
			replacing(cleanPlan(), "---\n", "```fnb-plan\n"),
			"}\n---\n",
			"}\n```\n",
		);
		const result = lintPlan(text, lintPack());
		expect(result.issues).toEqual([]);
		expect(result.normalized).toBe(cleanPlan());
	});

	it("names the pack and horizon the plan was written for", () => {
		expect(
			lintPlan(lintFixtureText("pack_mismatch.md"), lintPack()).issues,
		).toEqual([
			{
				code: "pack_mismatch",
				level: "error",
				line: 4,
				detail: "fedcba9876543210".repeat(4),
			},
		]);
		expect(
			lintPlan(lintFixtureText("horizon_mismatch.md"), lintPack()).issues,
		).toEqual([
			{ code: "horizon_mismatch", level: "error", line: 6, detail: "30d" },
		]);
	});
});

describe("parsePlan", () => {
	function codeOf(call: () => unknown): string | null {
		try {
			call();
		} catch (error) {
			return error instanceof DataPackError ? error.code : "other";
		}
		return null;
	}

	it("throws front_matter_missing or front_matter_invalid where the lint reports them", () => {
		expect(
			codeOf(() => parsePlan(lintFixtureText("front_matter_missing.md"))),
		).toBe("front_matter_missing");
		expect(
			codeOf(() => parsePlan(lintFixtureText("front_matter_invalid.md"))),
		).toBe("front_matter_invalid");
		expect(codeOf(() => parsePlan(cleanPlan()))).toBeNull();
	});

	it("parses the same plan that the lint returns", () => {
		const text = lintFixtureText("preamble_text.md");
		expect(parsePlan(text)).toEqual(lintPlan(text, lintPack()).plan);
	});
});
