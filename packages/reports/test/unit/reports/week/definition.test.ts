import { describe, expect, it } from "vitest";
import {
	type AnalyticsFunctionName,
	type AnalyticsSource,
	COMPARE_LIKE_FOR_LIKE_KEYS,
	coverageModel,
	METRICS_LIKE_FOR_LIKE_KEYS,
	reportDefinitions,
	runReport,
} from "../../../../src/index.js";
import {
	WEEK_METRIC_IDS,
	weekCalls,
	weekFollowUpCalls,
	weekKeys,
	weekPrimaryCalls,
	weekReport,
	weekReportKeys,
} from "../../../../src/reports/week/index.js";
import { coverageRow } from "../../fixtures.js";
import {
	RUNNING_WEEK_DAY,
	STORE_A,
	STORE_B,
	weekContext,
	youngStoreCoverage,
} from "./fixtures.js";

describe("the Tuần definition", () => {
	it("is registered as the week report with the eight cards in order", () => {
		expect(reportDefinitions.week).toBe(weekReport);
		expect(weekReport.slug).toBe("tuan");
		expect(weekReport.titleKey).toBe(weekKeys.title);
		expect(weekReport.cards.map((card) => card.id)).toEqual([
			"net_revenue",
			"invoices",
			"avg_ticket",
			"weekday_curve",
			"movers",
			"category_mix",
			"promotions",
			"best_worst_days",
		]);
	});

	it("plans the primary calls of the spec for the running week", () => {
		const context = weekContext({ date: RUNNING_WEEK_DAY });
		const calls = weekPrimaryCalls(context);
		expect(calls.map((entry) => [entry.key, entry.name, entry.args])).toEqual([
			[
				weekCalls.coverage,
				"store_coverage",
				{
					store_ids: [STORE_A, STORE_B],
					from_date: "2026-11-02",
					to_date: "2026-11-03",
				},
			],
			[
				weekCalls.compare,
				"period_compare_by_store",
				{ store_ids: [STORE_A, STORE_B], grain: "week", anchor: "2026-11-03" },
			],
			[
				weekCalls.days,
				"period_series",
				{
					store_ids: [STORE_A, STORE_B],
					grain: "day",
					from_date: "2026-10-05",
					to_date: "2026-11-03",
				},
			],
			[
				weekCalls.baselines,
				"daily_baselines",
				{
					store_ids: [STORE_A, STORE_B],
					from_date: "2026-11-02",
					to_date: "2026-11-03",
					weeks: 8,
				},
			],
			[
				weekCalls.velocity,
				"item_velocity",
				{ store_ids: [STORE_A, STORE_B], as_of_date: "2026-11-03" },
			],
			[
				weekCalls.items,
				"item_summary",
				{
					store_ids: [STORE_A, STORE_B],
					from_date: "2026-11-02",
					to_date: "2026-11-03",
					compare_from: "2026-10-26",
					compare_to: "2026-10-27",
				},
			],
			[
				weekCalls.promotions,
				"promotion_summary",
				{
					store_ids: [STORE_A, STORE_B],
					from_date: "2026-11-02",
					to_date: "2026-11-03",
				},
			],
			[
				weekCalls.promotionsPrevious,
				"promotion_summary",
				{
					store_ids: [STORE_A, STORE_B],
					from_date: "2026-10-26",
					to_date: "2026-10-27",
				},
			],
			[
				weekCalls.metrics,
				"metric_compare",
				{
					store_ids: [STORE_A, STORE_B],
					metric_ids: [...WEEK_METRIC_IDS],
					grain: "week",
					anchor: "2026-11-03",
				},
			],
		]);
		expect(WEEK_METRIC_IDS).toEqual(["discount_rate", "voucher_invoice_share"]);
	});

	it("needs no follow-up call when every store is covered", () => {
		const context = weekContext();
		const coverage = coverageModel(
			[coverageRow(STORE_A), coverageRow(STORE_B)],
			context,
		);
		expect(weekFollowUpCalls(context, coverage)).toEqual([]);
	});

	it("adds like-for-like calls and the covered stores' velocity for a young store", () => {
		const context = weekContext();
		const coverage = coverageModel(youngStoreCoverage("2026-09-15"), context);
		const calls = weekFollowUpCalls(context, coverage);
		expect(calls.map((entry) => [entry.key, entry.args])).toEqual([
			[
				COMPARE_LIKE_FOR_LIKE_KEYS.last_year,
				{ store_ids: [STORE_A], grain: "week", anchor: "2026-11-01" },
			],
			[
				METRICS_LIKE_FOR_LIKE_KEYS.last_year,
				{
					store_ids: [STORE_A],
					metric_ids: [...WEEK_METRIC_IDS],
					grain: "week",
					anchor: "2026-11-01",
				},
			],
			[
				weekCalls.velocityCovered,
				{ store_ids: [STORE_A], as_of_date: "2026-11-01" },
			],
		]);
	});

	it("skips the covered velocity when no store has eight weeks", () => {
		const context = weekContext({ stores: [STORE_B] });
		const coverage = coverageModel(
			[coverageRow(STORE_B, { history_start: "2026-09-15" })],
			context,
		);
		expect(
			weekFollowUpCalls(context, coverage).map((entry) => entry.key),
		).toEqual([]);
	});

	it("lists only planned or follow-up keys as card needs", () => {
		const planned = new Set([
			...weekPrimaryCalls(weekContext()).map((entry) => entry.key),
			weekCalls.velocityCovered,
			...Object.values(COMPARE_LIKE_FOR_LIKE_KEYS),
			...Object.values(METRICS_LIKE_FOR_LIKE_KEYS),
		]);
		for (const card of weekReport.cards) {
			expect(card.needs).toContain(weekCalls.coverage);
			for (const need of card.needs) {
				expect(planned.has(need), `${card.id} ${need}`).toBe(true);
			}
		}
	});

	it("keeps every key under the report.week prefix", () => {
		expect(
			weekReportKeys().filter((key) => !key.startsWith("report.week.")),
		).toEqual([]);
		expect(new Set(weekReportKeys()).size).toBe(weekReportKeys().length);
	});

	it("runs each distinct call once and builds every card", async () => {
		const seen: AnalyticsFunctionName[] = [];
		const source: AnalyticsSource = {
			kind: "demo",
			async call(name) {
				seen.push(name);
				if (name === "store_coverage") {
					return [coverageRow(STORE_A), coverageRow(STORE_B)] as never;
				}
				return [] as never;
			},
		};
		const cards = await runReport(weekReport, weekContext(), source);
		expect(cards.map((card) => card.id)).toHaveLength(8);
		expect(seen).toHaveLength(9);
		expect(cards.every((card) => card.narrative.length > 0)).toBe(true);
	});
});
