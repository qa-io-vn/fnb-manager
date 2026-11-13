import {
	type CardModel,
	coverageCall,
	coverageModel,
	monthKeys,
	monthReport,
	reportKeys,
	runReport,
} from "@fnb/reports";
import { describe, expect, it } from "vitest";
import {
	createDemoAnalyticsSource,
	DemoDayCache,
	youngStoreOpenedOn,
} from "../../src/index.js";
import {
	SMOKE_NOW,
	STORE_SELECTIONS,
	smokeContext,
	unknownKeys,
} from "./report-keys.js";

const FORECAST_LABELS: Readonly<Record<string, string>> = {
	forecast_weekday_profile: reportKeys.compare.forecast.weekdayProfile,
	forecast_seasonal_naive: reportKeys.compare.forecast.seasonalNaive,
};

const MONTH_CARD_IDS = [
	"month_pace",
	"daily_trend",
	"pareto",
	"size_mix",
	"attach_rate",
	"new_items",
	"payment_mix",
	"discount_cost",
	"shift_stats",
	"target_progress",
];

function sourceOf() {
	return createDemoAnalyticsSource({
		now: () => SMOKE_NOW,
		validateRows: true,
	});
}

function card(cards: readonly CardModel[], id: string): CardModel {
	const found = cards.find((entry) => entry.id === id);
	if (found === undefined) throw new Error(`card ${id} was not built`);
	return found;
}

describe("Tháng on the demo engine", () => {
	for (const stores of STORE_SELECTIONS) {
		it(`builds every card for ${stores.join(" + ")}`, async () => {
			const source = sourceOf();
			const context = smokeContext("month", stores);
			const cards = await runReport(monthReport, context, source);
			const coverage = coverageModel(
				await source.call("store_coverage", coverageCall(context).args),
				context,
			);
			expect(coverage.rows.map((row) => row.store_id)).toEqual([...stores]);
			expect(cards.map((entry) => entry.id)).toEqual(MONTH_CARD_IDS);
			expect(
				cards.every((entry) => entry.markers.verification === "sample"),
			).toBe(true);
			expect(unknownKeys(cards, "report.month.")).toEqual([]);
			for (const entry of cards) {
				expect(entry.narrative.length, entry.id).toBeGreaterThan(0);
				expect(entry.csvName, entry.id).toMatch(/^thang-[a-z-]+-2026-11$/);
			}
			const accuracy = await source.call("forecast_accuracy", {
				store_ids: [...stores],
				as_of_date: context.period.end,
				days: 28,
			});
			const forecasts = card(cards, "month_pace").comparisons.filter(
				(entry) => entry.kind === "forecast",
			);
			expect(forecasts).toHaveLength(2);
			expect(forecasts.every((entry) => entry.unavailable === null)).toBe(true);
			const maeOf = (labelKey: string | undefined) =>
				accuracy.find((row) => FORECAST_LABELS[row.forecast_id] === labelKey)
					?.mae ?? null;
			const [first, second] = forecasts.map((entry) => maeOf(entry.label.key));
			expect(first).not.toBeNull();
			expect(first ?? 0).toBeLessThanOrEqual(second ?? 0);
			expect(card(cards, "attach_rate").headline.value).not.toBeNull();
			expect(card(cards, "attach_rate").notice).toBeNull();
		});
	}

	it("shows target progress for the store with a target and names the store without one", async () => {
		const source = sourceOf();
		const single = await runReport(
			monthReport,
			smokeContext("month", ["MOCK-S1"]),
			source,
		);
		expect(card(single, "target_progress").headline.value).toBeGreaterThan(0);
		expect(card(single, "target_progress").notice).toBeNull();
		const both = await runReport(
			monthReport,
			smokeContext("month", ["MOCK-S1", "MOCK-S2"]),
			source,
		);
		const target = card(both, "target_progress");
		expect(target.headline.value).toBeNull();
		expect(target.notice?.part.key).toBe(monthKeys.target.missing);
		expect(target.notice?.part.values.stores).toEqual({
			kind: "text",
			value: "Cửa hàng mẫu 2",
		});
		expect(target.notice?.action).toBe("settings_targets");
	});

	it("finds the drinks launched this month as new items", async () => {
		const cards = await runReport(
			monthReport,
			smokeContext("month", ["MOCK-S1"]),
			sourceOf(),
		);
		const newItems = card(cards, "new_items");
		expect(newItems.headline.value).toBeGreaterThan(0);
		expect(
			newItems.tables[0]?.rows.every((row) =>
				String(row.id).startsWith("DR-NEW-"),
			),
		).toBe(true);
	});

	it("closes the previous month and handles the young store's first month", async () => {
		const asOf = new DemoDayCache({ now: () => SMOKE_NOW }).asOf();
		const source = sourceOf();
		const october = await runReport(
			monthReport,
			smokeContext("month", ["MOCK-S1", "MOCK-S2"], "2026-10-15"),
			source,
		);
		expect(october.map((entry) => entry.id)).toEqual(MONTH_CARD_IDS);
		const pace = card(october, "month_pace");
		expect(pace.comparisons.some((entry) => entry.kind === "forecast")).toBe(
			false,
		);
		expect(pace.narrative[0]?.key).toBe(monthKeys.pace.closed);
		const opening = youngStoreOpenedOn(asOf);
		const first = await runReport(
			monthReport,
			smokeContext("month", ["MOCK-S2"], opening),
			source,
		);
		expect(unknownKeys(first, "report.month.")).toEqual([]);
		const newItems = card(first, "new_items");
		expect(newItems.headline.value).toBeNull();
		expect(newItems.notice?.part.key).toBe(monthKeys.newItems.tooYoung);
		expect(
			card(first, "month_pace").comparisons.map((entry) => entry.unavailable),
		).toEqual(["store_too_young", "store_too_young"]);
	});
});
