import { describe, expect, it } from "vitest";
import {
	type AnalyticsFunctionName,
	type AnalyticsSource,
	assertUniqueKeys,
	COMPARE_LIKE_FOR_LIKE_KEYS,
	callIdentity,
	coverageModel,
	reportDefinitions,
	runReport,
} from "../../../../src/index.js";
import {
	sinceCallKey,
	yearCalls,
	yearNeeds,
	yearReport,
} from "../../../../src/reports/year/index.js";
import { coverageRow } from "../../fixtures.js";
import {
	establishedAndYoung,
	STORE_A,
	STORE_B,
	YOUNG_START,
	yearContext,
} from "./fixtures.js";

function plan(
	scene: Parameters<typeof yearContext>[0],
	coverage = establishedAndYoung(),
) {
	const context = yearContext(scene);
	const model = coverageModel(coverage, context);
	return {
		primary: yearReport.primaryCalls(context),
		followUps: yearReport.followUpCalls(context, model),
	};
}

describe("Năm calls", () => {
	it("plans the spec's primary calls over the year, last year and two years back", () => {
		const { primary } = plan({});
		expect(reportDefinitions.year).toBe(yearReport);
		expect(yearReport.slug).toBe("nam");
		expect(primary.map((call) => [call.key, call.name, call.args])).toEqual([
			[
				"coverage",
				"store_coverage",
				{
					store_ids: [STORE_A, STORE_B],
					from_date: "2026-01-01",
					to_date: "2026-11-03",
				},
			],
			[
				"compare",
				"period_compare_by_store",
				{ store_ids: [STORE_A, STORE_B], grain: "year", anchor: "2026-11-03" },
			],
			[
				"months",
				"period_series",
				{
					store_ids: [STORE_A, STORE_B],
					grain: "month",
					from_date: "2024-01-01",
					to_date: "2026-11-03",
				},
			],
			[
				"weeks",
				"period_series",
				{
					store_ids: [STORE_A, STORE_B],
					grain: "week",
					from_date: "2025-01-01",
					to_date: "2026-11-03",
					include_stores: false,
				},
			],
			[
				"weekdays",
				"period_series",
				{
					store_ids: [STORE_A, STORE_B],
					grain: "weekday",
					from_date: "2026-01-01",
					to_date: "2026-11-03",
					include_stores: false,
				},
			],
			[
				"lifecycle",
				"item_lifecycle",
				{ store_ids: [STORE_A, STORE_B], as_of_date: "2026-11-03" },
			],
		]);
	});

	it("follows up like for like, the covered lifecycle and each young store's days", () => {
		const { primary, followUps } = plan({});
		assertUniqueKeys([...primary, ...followUps]);
		expect(followUps.map((call) => [call.key, call.name, call.args])).toEqual([
			[
				COMPARE_LIKE_FOR_LIKE_KEYS.previous,
				"period_compare",
				{ store_ids: [STORE_A], grain: "year", anchor: "2026-11-03" },
			],
			[
				COMPARE_LIKE_FOR_LIKE_KEYS.last_year,
				"period_compare",
				{ store_ids: [STORE_A], grain: "year", anchor: "2026-11-03" },
			],
			[
				yearCalls.lifecycleCovered,
				"item_lifecycle",
				{ store_ids: [STORE_A], as_of_date: "2026-11-03" },
			],
			[
				sinceCallKey(STORE_B),
				"period_series",
				{
					store_ids: [STORE_B],
					grain: "day",
					from_date: YOUNG_START,
					to_date: "2026-11-03",
				},
			],
		]);
	});

	it("plans the like-for-like year as one distinct call, since the previous year is last year", () => {
		const { followUps } = plan({});
		const compares = followUps.filter((call) => call.name === "period_compare");
		expect(compares.map((call) => call.key)).toEqual([
			COMPARE_LIKE_FOR_LIKE_KEYS.previous,
			COMPARE_LIKE_FOR_LIKE_KEYS.last_year,
		]);
		expect(new Set(compares.map(callIdentity)).size).toBe(1);
	});

	it("plans no follow-up when every store has last year and none is young", () => {
		const { followUps } = plan({ stores: [STORE_A] }, [
			coverageRow(STORE_A, { history_start: "2024-12-02" }),
		]);
		expect(followUps).toEqual([]);
	});

	it("skips the since-opening days of a store that opens after the year", () => {
		const { followUps } = plan({ stores: [STORE_B], date: "2025-06-01" }, [
			coverageRow(STORE_B, { history_start: YOUNG_START }),
		]);
		expect(followUps).toEqual([]);
	});

	it("needs only planned keys, the since-opening wildcard or follow-ups that may be absent", () => {
		const known = new Set<string>([
			...Object.values(yearCalls),
			COMPARE_LIKE_FOR_LIKE_KEYS.previous,
			COMPARE_LIKE_FOR_LIKE_KEYS.last_year,
			"since.*",
		]);
		for (const card of yearReport.cards) {
			for (const need of card.needs) expect(known.has(need), need).toBe(true);
		}
		expect(yearNeeds.since).toContain("since.*");
		expect(yearReport.cards.map((card) => card.id)).toEqual([
			"month_matrix",
			"growth",
			"seasonality",
			"ticket_trend",
			"item_lifecycle",
			"year_over_year",
			"since_opening",
		]);
	});

	it("runs every visible card on an empty source without failing", async () => {
		const calls: AnalyticsFunctionName[] = [];
		const source: AnalyticsSource = {
			kind: "demo",
			async call(name, args) {
				calls.push(name);
				if (name === "store_coverage") {
					return (args.store_ids ?? []).map((id) =>
						coverageRow(id, {
							history_start: id === STORE_B ? YOUNG_START : "2024-12-02",
						}),
					) as never;
				}
				return [];
			},
		};
		const cards = await runReport(yearReport, yearContext({}), source);
		expect(cards.map((card) => card.id)).toHaveLength(7);
		expect(calls.filter((name) => name === "period_compare")).toHaveLength(1);
		for (const card of cards) {
			expect(card.narrative.length, card.id).toBeGreaterThan(0);
			if (card.headline.value === null) {
				expect(card.notice, card.id).not.toBeNull();
			}
		}
	});
});
