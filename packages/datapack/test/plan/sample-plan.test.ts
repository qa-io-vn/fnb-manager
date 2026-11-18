import { findMetric } from "@fnb/metrics";
import { addDays } from "@fnb/reports";
import { beforeAll, describe, expect, it } from "vitest";
import { DataPackError } from "../../src/pack/errors.js";
import { trackableMetricIds } from "../../src/pack/kpi-ids.js";
import { PACK_LANGUAGES } from "../../src/pack/request.js";
import type { DataPack } from "../../src/pack/schema.js";
import { lintPlan } from "../../src/plan/lint.js";
import type { ParsedPlan } from "../../src/plan/parse.js";
import { MIN_INITIATIVES, PLAN_FORMAT } from "../../src/plan/sections.js";
import { samplePlan } from "../../src/testing/index.js";
import {
	SAMPLE_KPI_COUNT,
	SAMPLE_KPI_IDS,
	sampleKpis,
	sampleTarget,
} from "../../src/testing/sample-plan.js";
import {
	buildWith,
	demoRequest,
	demoSource,
	GOLDEN_AS_OF,
} from "../pack/support/demo.js";
import { goldenPack } from "./fixture-plans.js";

const DAYS = 30;
const DETAIL_TABLES = [
	"items",
	"weekday",
	"payments",
	"categories",
	"month_to_date",
	"weekly",
];

const source = demoSource();
const asOfDays = Array.from({ length: DAYS }, (_, index) =>
	addDays(GOLDEN_AS_OF, -index),
);

function withRows(
	pack: DataPack,
	rows: Readonly<Record<string, DataPack["tables"][string]["rows"]>>,
): DataPack {
	const tables = { ...pack.tables };
	for (const [id, replaced] of Object.entries(rows)) {
		const table = tables[id];
		if (table === undefined) throw new Error(`no table ${id}`);
		tables[id] = { ...table, rows: replaced };
	}
	return { ...pack, tables };
}

function withKpiBaseline(
	pack: DataPack,
	row: string,
	value: number | null,
): DataPack {
	const kpi = pack.tables.kpi;
	const cells = kpi?.rows[row];
	if (kpi === undefined || cells === undefined) throw new Error(`no ${row}`);
	return withRows(pack, {
		kpi: { ...kpi.rows, [row]: [value, ...cells.slice(1)] },
	});
}

function sectionCitations(plan: ParsedPlan, numbers: readonly number[]) {
	const starts = plan.sections.map((section) => section.line);
	return plan.sections.flatMap((section, index) => {
		if (section.number === null || !numbers.includes(section.number)) {
			return [];
		}
		const end = starts[index + 1] ?? Number.POSITIVE_INFINITY;
		return plan.citations.filter(
			(entry) => entry.line > section.line && entry.line < end,
		);
	});
}

function cleanLint(pack: DataPack) {
	const text = samplePlan(pack);
	const lint = lintPlan(text, pack);
	return { text, lint };
}

describe("the KPIs a sample plan can choose", () => {
	it("are a fixed list of distinct trackable ids with a direction and digits", () => {
		const trackable = new Set(trackableMetricIds());
		expect(new Set(SAMPLE_KPI_IDS).size).toBe(SAMPLE_KPI_IDS.length);
		expect(SAMPLE_KPI_IDS.length).toBeGreaterThan(SAMPLE_KPI_COUNT);
		for (const id of SAMPLE_KPI_IDS) {
			expect(trackable.has(id), id).toBe(true);
			expect(findMetric(id)?.direction, id).not.toBe("neutral");
			expect(findMetric(id)?.label.vi, id).not.toMatch(/[0-9]/);
			expect(findMetric(id)?.label.en, id).not.toMatch(/[0-9]/);
		}
	});

	it("are the first three of the list whose ALL row has a w28 value", () => {
		const pack = goldenPack();
		expect(sampleKpis(pack).map((kpi) => kpi.id)).toEqual([
			"avg_ticket",
			"attach_rate_topping",
			"discount_rate",
		]);
		const unmeasured = withKpiBaseline(pack, "ALL/avg_ticket", null);
		expect(sampleKpis(unmeasured).map((kpi) => kpi.id)).toEqual([
			"attach_rate_topping",
			"discount_rate",
			"items_per_ticket",
		]);
		for (const kpi of sampleKpis(pack)) {
			expect(trackableMetricIds()).toContain(kpi.id);
		}
	});

	it("link the five initiatives in turn and refuse a pack that measures none of them", () => {
		expect(
			sampleKpis(goldenPack()).map((kpi) => [kpi.id, kpi.initiatives]),
		).toEqual([
			["avg_ticket", [1, 4]],
			["attach_rate_topping", [2, 5]],
			["discount_rate", [3]],
		]);
		let pack = goldenPack();
		for (const id of SAMPLE_KPI_IDS) {
			pack = withKpiBaseline(pack, `ALL/${id}`, null);
		}
		expect(() => samplePlan(pack)).toThrow(DataPackError);
		expect(() => samplePlan(pack)).toThrow(/^pack_invalid: /);
		let two = goldenPack();
		for (const id of SAMPLE_KPI_IDS.slice(2)) {
			two = withKpiBaseline(two, `ALL/${id}`, null);
		}
		expect(sampleKpis(two).map((kpi) => [kpi.id, kpi.initiatives])).toEqual([
			["avg_ticket", [1, 3, 5]],
			["attach_rate_topping", [2, 4]],
		]);
		expect(lintPlan(samplePlan(two), two).issues).toEqual([]);
	});
});

describe("the sample targets", () => {
	it("move 5 % in the metric's good direction, rounded to its digits", () => {
		expect(sampleTarget(91401.96, "higher", 0)).toBe(95972);
		expect(sampleTarget(0.228824, "higher", 4)).toBe(0.2403);
		expect(sampleTarget(0.02052, "lower", 4)).toBe(0.0195);
		expect(sampleTarget(2.2157, "higher", 2)).toBe(2.33);
		expect(sampleTarget(5100, "higher", 0)).toBe(5355);
	});

	it("move one unit more when rounding gives the baseline back", () => {
		expect(sampleTarget(5, "higher", 0)).toBe(6);
		expect(sampleTarget(5, "lower", 0)).toBe(4);
		expect(sampleTarget(0.0001, "higher", 4)).toBe(0.0002);
		expect(sampleTarget(0, "higher", 4)).toBe(0.0001);
		expect(sampleTarget(0, "lower", 2)).toBe(-0.01);
	});

	it("are written in the front matter with the exact baselines", () => {
		const pack = goldenPack();
		const { lint } = cleanLint(pack);
		const kpis = lint.plan?.frontMatter.kpis ?? {};
		for (const kpi of sampleKpis(pack)) {
			expect(kpis[kpi.id]).toEqual({
				scope: "ALL",
				baseline: pack.tables.kpi?.rows[`ALL/${kpi.id}`]?.[0],
				target: kpi.target,
				initiatives: kpi.initiatives,
			});
			expect(kpi.target).not.toBe(kpi.baseline);
		}
	});
});

describe("samplePlan of the demo pack", () => {
	describe.each(asOfDays)("as of %s", (asOf) => {
		it.each(PACK_LANGUAGES)(
			"in %s lints without an issue",
			async (language) => {
				const built = await buildWith(source, demoRequest({ asOf, language }));
				const { text, lint } = cleanLint(built.pack);
				expect(lint.issues).toEqual([]);
				expect(lint.ok).toBe(true);
				expect(lint.summary).toMatchObject({
					initiatives: MIN_INITIATIVES,
					citedInitiatives: MIN_INITIATIVES,
					kpis: SAMPLE_KPI_COUNT,
					uncitedNumbers: 0,
				});
				expect(lint.plan?.frontMatter.language).toBe(language);
				expect(lint.plan?.frontMatter.format).toBe(PLAN_FORMAT);
				expect(samplePlan(JSON.parse(built.text) as DataPack)).toBe(text);
			},
		);
	});

	it("lints without an issue for a pack of one store", async () => {
		for (const language of PACK_LANGUAGES) {
			const built = await buildWith(
				source,
				demoRequest({ storeIds: ["MOCK-S1"], language }),
			);
			expect(cleanLint(built.pack).lint.issues).toEqual([]);
		}
	});
});

describe("the text of a sample plan", () => {
	let pack: DataPack;

	beforeAll(() => {
		pack = goldenPack();
	});

	it("is titled as a sample generated to illustrate, in the pack's language", () => {
		const vi = cleanLint(pack).lint.plan;
		expect(vi?.frontMatter.title).toBe("Kế hoạch mẫu, tạo tự động để minh họa");
		const english: DataPack = {
			...pack,
			request: { ...pack.request, language: "en" },
		};
		const en = cleanLint(english);
		expect(en.lint.issues).toEqual([]);
		expect(en.lint.plan?.frontMatter.title).toBe(
			"Sample plan, generated automatically to illustrate",
		);
		expect(en.text).toContain("## 1. Situation summary");
		expect(en.text).toContain("### Initiative 5: ");
	});

	it("cites only kpi cells in sections 1 and 2 and a detail cell in every Evidence field", () => {
		const plan = cleanLint(pack).lint.plan;
		if (plan === null) throw new Error("no plan");
		const summary = sectionCitations(plan, [1, 2]);
		expect(summary.length).toBeGreaterThanOrEqual(SAMPLE_KPI_COUNT * 2);
		expect(new Set(summary.map((entry) => entry.table))).toEqual(
			new Set(["kpi"]),
		);
		expect(plan.initiatives).toHaveLength(MIN_INITIATIVES);
		for (const initiative of plan.initiatives) {
			const evidence = initiative.fields.evidence;
			const cited = plan.citations.filter(
				(entry) => entry.line === evidence?.line,
			);
			expect(cited, `initiative ${initiative.number}`).toHaveLength(1);
			expect(DETAIL_TABLES).toContain(cited[0]?.table);
			expect(cited[0]?.written).not.toBeNull();
		}
		expect(
			plan.citations
				.filter((entry) => entry.table !== "kpi")
				.map((entry) => entry.table),
		).toEqual(["items", "weekday", "payments", "categories", "month_to_date"]);
	});

	it("writes numbers by the language's rules", () => {
		const vi = samplePlan(pack);
		expect(vi).toContain("91.402 đ [[kpi:ALL/avg_ticket:w28]]");
		expect(vi).toContain("22,88% [[kpi:ALL/attach_rate_topping:w28]]");
		expect(vi).toContain(
			"giảm 1,1 điểm [[kpi:ALL/attach_rate_topping:p28_change]]",
		);
		expect(vi).toContain("13.415.000 đ [[items:ALL/r01:net]]");
		const en = samplePlan({
			...pack,
			request: { ...pack.request, language: "en" },
		});
		expect(en).toContain("91,402 VND [[kpi:ALL/avg_ticket:w28]]");
		expect(en).toContain("22.88% [[kpi:ALL/attach_rate_topping:w28]]");
		expect(en).toContain(
			"down 1.1 points [[kpi:ALL/attach_rate_topping:p28_change]]",
		);
		expect(en).toContain("13,415,000 VND [[items:ALL/r01:net]]");
	});

	it("falls back to another detail cell, and then to the KPI, when tables are empty", () => {
		const noItems = withRows(pack, { items: {} });
		const first = cleanLint(noItems);
		expect(first.lint.issues).toEqual([]);
		expect(first.text).toContain("Ngày vắng nhất trong tuần chỉ chiếm");
		expect(first.text).toContain("món dẫn đầu doanh thu ở đầu thực đơn");
		const empty = withRows(
			pack,
			Object.fromEntries(DETAIL_TABLES.map((id) => [id, {}])),
		);
		const bare = cleanLint(empty);
		expect(bare.lint.issues).toEqual([]);
		expect(bare.lint.summary.citedInitiatives).toBe(MIN_INITIATIVES);
		expect(
			bare.lint.plan?.citations.every((entry) => entry.table === "kpi"),
		).toBe(true);
	});

	it("leaves a name out unless it is plain text", () => {
		const items = pack.tables.items?.rows ?? {};
		const top = items["ALL/r01"];
		if (top === undefined) throw new Error("no top item");
		const named = withRows(pack, {
			items: {
				...items,
				"ALL/r01": ["Trà [[kpi:ALL/x:w28]] 0901234567", ...top.slice(1)],
			},
		});
		const { text, lint } = cleanLint(named);
		expect(lint.issues).toEqual([]);
		expect(text).not.toContain("0901234567");
	});

	it("depends on nothing but the pack", () => {
		const text = samplePlan(pack);
		expect(samplePlan(structuredClone(pack))).toBe(text);
		expect(text.endsWith("\n")).toBe(true);
		expect(text).not.toMatch(/\r/);
		expect(
			text.startsWith(
				`---\n{\n\t"format": "${PLAN_FORMAT}",\n\t"pack": "${pack.pack_id}",`,
			),
		).toBe(true);
	});
});
