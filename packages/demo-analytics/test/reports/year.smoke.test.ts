import {
	type CardModel,
	coverageCall,
	coverageModel,
	runReport,
	sumMoney,
	yearReport,
} from "@fnb/reports";
import { describe, expect, it } from "vitest";
import { createDemoAnalyticsSource, DemoDayCache } from "../../src/index.js";
import {
	SMOKE_NOW,
	STORE_SELECTIONS,
	smokeContext,
	unknownKeys,
} from "./report-keys.js";

const days = new DemoDayCache({ now: () => SMOKE_NOW });
const source = createDemoAnalyticsSource({
	now: () => SMOKE_NOW,
	days,
	validateRows: true,
});

function card(cards: readonly CardModel[], id: string): CardModel {
	const found = cards.find((candidate) => candidate.id === id);
	if (found === undefined) throw new Error(`Năm has no card ${id}`);
	return found;
}

describe("Năm on the demo engine", () => {
	for (const stores of STORE_SELECTIONS) {
		it(`builds every visible card for ${stores.join(" + ")}`, async () => {
			const context = smokeContext("year", stores);
			const cards = await runReport(yearReport, context, source);
			const coverage = coverageModel(
				await source.call("store_coverage", coverageCall(context).args),
				context,
			);
			const visible = yearReport.cards.filter((definition) =>
				definition.visible({ context, coverage }),
			);
			expect(cards.map((entry) => entry.id)).toEqual(
				visible.map((definition) => definition.id),
			);
			expect(
				cards.every((entry) => entry.markers.verification === "sample"),
			).toBe(true);
			expect(unknownKeys(cards, "report.year.")).toEqual([]);
			for (const entry of cards) {
				expect(entry.narrative.length, entry.id).toBeGreaterThan(0);
				if (entry.headline.value === null) {
					expect(entry.notice, entry.id).not.toBeNull();
				}
			}
			expect(cards.some((entry) => entry.id === "since_opening")).toBe(
				stores.includes("MOCK-S2"),
			);
		});
	}

	it("adds the month buckets of the year up to the year-to-date headline", async () => {
		const context = smokeContext("year", ["MOCK-S1", "MOCK-S2"]);
		const cards = await runReport(yearReport, context, source);
		const months = await source.call("period_series", {
			store_ids: ["MOCK-S1", "MOCK-S2"],
			grain: "month",
			from_date: context.period.from,
			to_date: context.period.end,
		});
		const total = sumMoney(
			months
				.filter((row) => row.store_id === null)
				.map((row) => row.net_amount),
		);
		expect(card(cards, "year_over_year").headline.value).toBe(total);
		const lastYear = card(cards, "year_over_year").comparisons.find(
			(comparison) => comparison.kind === "last_year",
		);
		expect(lastYear?.basis).toBe("like_for_like");
		const peak = Object.values(
			card(cards, "month_matrix").headline.caption?.values ?? {},
		).find((value) => value.kind === "month");
		expect(peak?.value).toMatch(/^2026-(0[1-9]|10)$/);
		expect(
			card(cards, "month_matrix").tables[0]?.rows.map((row) => row.id),
		).toEqual(["2024", "2025", "2026"]);
	});

	it("shows the young store without last year and follows it since opening", async () => {
		const cards = await runReport(
			yearReport,
			smokeContext("year", ["MOCK-S2"]),
			source,
		);
		const lastYear = card(cards, "year_over_year").comparisons.find(
			(comparison) => comparison.kind === "last_year",
		);
		expect(lastYear?.unavailable).toBe("store_too_young");
		const since = card(cards, "since_opening");
		expect(since.headline.value).toBeGreaterThan(0);
		expect(since.tables[0]?.rows.length).toBeGreaterThanOrEqual(8);
		expect(card(cards, "item_lifecycle").notice).not.toBeNull();
	});

	it("builds the previous year, where the established store has no full last year", async () => {
		const context = smokeContext("year", ["MOCK-S1", "MOCK-S2"], "2025-06-01");
		const cards = await runReport(yearReport, context, source);
		expect(cards.map((entry) => entry.id)).not.toContain("since_opening");
		expect(card(cards, "seasonality").headline.value).not.toBeNull();
		expect(unknownKeys(cards, "report.year.")).toEqual([]);
	});
});
