import { describe, expect, it } from "vitest";
import {
	type AnalyticsArgs,
	type AnalyticsFunctionName,
	type AnalyticsRow,
	type AnalyticsSource,
	type CardDefinition,
	type CardModel,
	call,
	coverageCall,
	coverageModel,
	csvName,
	likeForLikeCalls,
	type ReportDefinition,
	reportDefinitions,
	resultsOf,
	runReport,
	sharedReportKeys,
	withNoDataNotice,
} from "../../src/index.js";
import { context, coverageRow, STORE_A, STORE_B } from "./fixtures.js";

interface Recorded {
	readonly name: AnalyticsFunctionName;
	readonly args: unknown;
}

function fakeSource(coverage: readonly AnalyticsRow<"store_coverage">[]): {
	source: AnalyticsSource;
	calls: Recorded[];
} {
	const calls: Recorded[] = [];
	return {
		calls,
		source: {
			kind: "demo",
			async call<N extends AnalyticsFunctionName>(
				name: N,
				args: AnalyticsArgs<N>,
			) {
				calls.push({ name, args });
				if (name === "store_coverage") return coverage as AnalyticsRow<N>[];
				return [] as AnalyticsRow<N>[];
			},
		},
	};
}

function emptyCard(id: string): CardModel {
	return {
		id,
		titleKey: `report.day.${id}.title`,
		subtitle: null,
		metricId: "net_revenue",
		relatedMetricIds: [],
		headline: { value: null, unit: "money", caption: null },
		comparisons: [],
		decomposition: null,
		narrative: [],
		tables: [],
		chart: null,
		notice: null,
		markers: { provisional: false, stale: false, verification: "sample" },
		csvName: csvName("ngay", id, "2026-11-03"),
	};
}

const young = [
	coverageRow(STORE_A, { history_start: "2024-12-02" }),
	coverageRow(STORE_B, { history_start: "2026-08-31" }),
];

describe("planning calls", () => {
	it("reads coverage for the period up to its end", () => {
		const day = context("month", "2026-11-03");
		expect(coverageCall(day)).toEqual({
			key: "coverage",
			name: "store_coverage",
			args: {
				store_ids: [STORE_A, STORE_B],
				from_date: "2026-11-01",
				to_date: "2026-11-03",
			},
		});
	});

	it("plans like-for-like calls only where coverage is partial", () => {
		const report = context("day", "2026-11-03");
		const coverage = coverageModel(young, report);
		const calls = likeForLikeCalls(report, coverage, {
			grain: "day",
			metricIds: ["discount_rate"],
		});
		expect(calls).toEqual([
			{
				key: "compareLfl.last_year",
				name: "period_compare",
				args: { store_ids: [STORE_A], grain: "day", anchor: "2026-11-03" },
			},
			{
				key: "metricsLfl.last_year",
				name: "metric_compare",
				args: {
					store_ids: [STORE_A],
					metric_ids: ["discount_rate"],
					grain: "day",
					anchor: "2026-11-03",
				},
			},
		]);
		const full = coverageModel(
			[coverageRow(STORE_A), coverageRow(STORE_B)],
			context("day", "2026-11-03"),
		);
		expect(likeForLikeCalls(report, full, { grain: "day" })).toEqual([]);
	});
});

describe("runReport", () => {
	const seen: string[] = [];
	const card = (id: string, visible = true): CardDefinition => ({
		id,
		needs: ["coverage", "compare", "compareLfl.previous"],
		visible: () => visible,
		build: ({ results, coverage }) => {
			seen.push(
				`${id}:${results.rows("compare", "period_compare_by_store")?.length}:${results.rows("compareLfl.previous", "period_compare")?.length}:${coverage.rows.length}`,
			);
			return emptyCard(id);
		},
	});
	const definition: ReportDefinition = {
		kind: "day",
		slug: "ngay",
		titleKey: "report.day.title",
		cards: [card("net_revenue"), card("hidden", false)],
		primaryCalls: (report) => [
			coverageCall(report),
			call("compare", "period_compare_by_store", {
				store_ids: [STORE_A, STORE_B],
				grain: "day",
				anchor: report.period.end,
			}),
			call("compareAgain", "period_compare_by_store", {
				store_ids: [STORE_A, STORE_B],
				grain: "day",
				anchor: report.period.end,
			}),
		],
		followUpCalls: (report, coverage) =>
			likeForLikeCalls(report, coverage, { grain: "day" }),
	};

	it("runs primary calls, then follow-ups, then builds the visible cards", async () => {
		const fake = fakeSource(young);
		const cards = await runReport(
			definition,
			context("day", "2026-11-03"),
			fake.source,
		);
		expect(cards.map((model) => model.id)).toEqual(["net_revenue"]);
		expect(fake.calls.map((recorded) => recorded.name)).toEqual([
			"store_coverage",
			"period_compare_by_store",
			"period_compare",
		]);
		expect(seen).toEqual(["net_revenue:0:0:2"]);
	});

	it("refuses two calls with the same key", async () => {
		const duplicate: ReportDefinition = {
			...definition,
			primaryCalls: (report) => [coverageCall(report), coverageCall(report)],
		};
		await expect(
			runReport(
				duplicate,
				context("day", "2026-11-03"),
				fakeSource(young).source,
			),
		).rejects.toThrow(/planned twice/);
	});
});

describe("cards of a period without sales", () => {
	const empty = coverageModel(
		[
			coverageRow(STORE_A, { history_start: null, sales_days: 0 }),
			coverageRow(STORE_B, { history_start: null, sales_days: 0 }),
		],
		context("day", "2026-11-03"),
	);

	it.each([
		["day", "2026-11-03", "report.day.noDataNotice"],
		["week", "2026-11-03", "report.week.noDataNotice"],
		["month", "2026-11-03", "report.month.noDataNotice"],
		["year", "2026-11-03", "report.year.noSales"],
	] as const)(
		"pairs every unmeasured %s headline with a notice",
		async (kind, date, noticeKey) => {
			const report = context(kind, date);
			const cards = await runReport(
				reportDefinitions[kind],
				report,
				fakeSource(empty.rows).source,
			);
			expect(cards.length).toBeGreaterThan(0);
			for (const model of cards) {
				if (model.headline.value !== null) continue;
				expect(model.notice, model.id).not.toBeNull();
			}
			expect(cards.some((model) => model.notice?.part.key === noticeKey)).toBe(
				true,
			);
		},
	);

	it("leaves a card's own notice in place", () => {
		const own = {
			tone: "warning" as const,
			part: { key: "report.day.shifts.noShifts", values: {} },
			action: null,
		};
		const wrapped = withNoDataNotice(
			{
				id: "shifts",
				needs: [],
				visible: () => true,
				build: () => ({ ...emptyCard("shifts"), notice: own }),
			},
			"report.day.noDataNotice",
		);
		expect(
			wrapped.build({
				context: context("day", "2026-11-03"),
				coverage: empty,
				results: resultsOf(new Map()),
			}).notice,
		).toBe(own);
	});
});

describe("report definitions", () => {
	it("declares the four reports with their slugs and titles", () => {
		expect(
			Object.values(reportDefinitions).map((report) => [
				report.kind,
				report.slug,
				report.titleKey,
			]),
		).toEqual([
			["day", "ngay", "report.day.title"],
			["week", "tuan", "report.week.title"],
			["month", "thang", "report.month.title"],
			["year", "nam", "report.year.title"],
		]);
	});

	it("names CSV files in ASCII", () => {
		expect(csvName("thang", "pareto", "2026-10")).toBe("thang-pareto-2026-10");
		expect(csvName("tuần", "weekday curve", "2026-W45")).toBe(
			"tuan-weekday-curve-2026-W45",
		);
	});

	it("keeps every shared key under the report prefix", () => {
		const keys = sharedReportKeys();
		expect(keys.every((key) => key.startsWith("report."))).toBe(true);
		expect(keys).toContain("report.unavailable.store_too_young.last_year");
		expect(keys).toContain("report.clause.driver.cashierAgainst");
		expect(new Set(keys).size).toBe(keys.length);
	});
});
