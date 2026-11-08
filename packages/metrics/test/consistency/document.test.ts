import { describe, expect, it } from "vitest";
import {
	benchmarkContext,
	findMetric,
	metricGrains,
	metricStatuses,
	metrics,
} from "../../src/index.js";
import {
	readMetricsDocument,
	splitTableRow,
} from "../support/metrics-document.js";

const documented = readMetricsDocument();
const snakeCase = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const vietnameseMark = /[\u0300-\u036fĐđ]/u;

function duplicates(values: readonly string[]): string[] {
	return values.filter((value, index) => values.indexOf(value) !== index);
}

describe("docs/metrics.md reading", () => {
	it("reads every metric and context table without a problem", () => {
		expect(documented.problems).toEqual([]);
		expect(documented.metrics.length).toBeGreaterThan(0);
		expect(documented.context.length).toBeGreaterThan(0);
	});

	it("splits table rows on unescaped pipes only", () => {
		expect(splitTableRow("| `a` | mean of \\|x\\| | b |")).toEqual([
			"`a`",
			"mean of |x|",
			"b",
		]);
	});

	it("reports a table of ids whose columns changed", () => {
		const reading = readMetricsDocument(
			"## Sales, ticket and basket\n\n| id | Tiếng Việt | English |\n| --- | --- | --- |\n| `x` | X | X |\n",
		);
		expect(reading.problems).toHaveLength(1);
		expect(reading.metrics).toEqual([]);
	});

	it("reports an unknown unit, grain, direction, report or status with its line", () => {
		const row = (cells: string) =>
			readMetricsDocument(
				`## Menu\n\n| id | Tiếng Việt | English | Unit | Formula | Grain | Direction | Source | Reports | Status |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n${cells}\n`,
			).problems;
		expect(
			row(
				"| `x` | Món | Item | litre | f | item-period | higher | s | Thực đơn | available now |",
			),
		).toEqual(['line 5: unknown unit "litre"']);
		expect(
			row(
				"| `x` | Món | Item | count | f | item-week | higher | s | Thực đơn | available now |",
			),
		).toEqual(['line 5: unknown grain "item-week"']);
		expect(
			row(
				"| `x` | Món | Item | count | f | item-period | up | s | Thực đơn | available now |",
			),
		).toEqual(['line 5: unknown direction "up"']);
		expect(
			row(
				"| `x` | Món | Item | count | f | item-period | higher | s | Kho | available now |",
			),
		).toEqual(['line 5: unknown report "Kho"']);
		expect(
			row(
				"| `x` | Món | Item | count | f | item-period | higher | s | Thực đơn | soon |",
			),
		).toEqual(['line 5: unknown status "soon"']);
	});
});

describe("packages/metrics equals docs/metrics.md", () => {
	it("lists the same metric ids in the same order", () => {
		expect(metrics.map((metric) => metric.id)).toEqual(
			documented.metrics.map((metric) => metric.id),
		);
	});

	it.each(documented.metrics)("mirrors $id field by field", (metric) => {
		expect(findMetric(metric.id)).toEqual(metric);
	});

	it("lists the same benchmark context entries", () => {
		expect(benchmarkContext).toEqual(documented.context);
	});

	it("uses exactly the grains the conventions define", () => {
		expect([...metricGrains]).toEqual(documented.grainVocabulary);
	});

	it("builds every status from the statuses the conventions define", () => {
		const needs = documented.statusVocabulary.filter((status) =>
			status.startsWith("needs "),
		);
		const composed = (status: string) =>
			status
				.replace(/^needs /, "")
				.split(" and ")
				.every((need) => needs.includes(`needs ${need}`));
		for (const status of metricStatuses) {
			expect(
				documented.statusVocabulary.includes(status) || composed(status),
				status,
			).toBe(true);
		}
	});
});

describe("metric registry lint", () => {
	it("gives every metric a unique snake_case id", () => {
		const ids = metrics.map((metric) => metric.id);
		expect(ids.filter((id) => !snakeCase.test(id))).toEqual([]);
		expect(duplicates(ids)).toEqual([]);
	});

	it.each(metrics)(
		"gives $id a Vietnamese and an English label, a unit, a formula, a grain, a direction, a source, a status and a report",
		(metric) => {
			expect(metric.label.vi.trim()).not.toBe("");
			expect(metric.label.en.trim()).not.toBe("");
			expect(metric.label.vi.normalize("NFD")).toMatch(vietnameseMark);
			expect(metric.label.vi).not.toBe(metric.label.en);
			expect(metric.unit.trim()).not.toBe("");
			expect(metric.formula.trim()).not.toBe("");
			expect(metric.grains.length).toBeGreaterThan(0);
			expect(metric.direction.trim()).not.toBe("");
			expect(metric.source.trim()).not.toBe("");
			expect(metric.status.trim()).not.toBe("");
			expect(metric.reports.length).toBeGreaterThan(0);
			expect(duplicates(metric.reports)).toEqual([]);
		},
	);

	it("keeps report notes on reports the metric is mapped to", () => {
		for (const metric of metrics) {
			const reports: readonly string[] = metric.reports;
			const notes = "reportNotes" in metric ? metric.reportNotes : {};
			expect(
				Object.keys(notes).filter((report) => !reports.includes(report)),
				metric.id,
			).toEqual([]);
		}
	});

	it("keeps benchmark context entries apart from tenant metrics", () => {
		const ids = benchmarkContext.map((entry) => entry.id);
		expect(ids.filter((id) => !/^ctx_[a-z0-9_]+$/.test(id))).toEqual([]);
		expect(duplicates(ids)).toEqual([]);
		expect(ids.filter((id) => findMetric(id) !== undefined)).toEqual([]);
		for (const entry of benchmarkContext) {
			expect(entry.figure.trim(), entry.id).not.toBe("");
			expect(entry.year.trim(), entry.id).not.toBe("");
			expect(entry.source.trim(), entry.id).not.toBe("");
		}
	});
});
