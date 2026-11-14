import {
	type NamedPreset,
	revenueKeys,
	revenueTheme,
	runTheme,
} from "@fnb/reports";
import { describe, expect, it } from "vitest";
import { STORE_SELECTIONS } from "../reports/report-keys.js";
import {
	messageFile,
	missingKeys,
	stringsOf,
	themeCatalog,
	themeSmokeContext,
	themeSource,
	unfilledPlaceholders,
	visibleCardIds,
} from "./theme-smoke.js";

const catalogs = {
	vi: themeCatalog("theme-revenue", "vi"),
	en: themeCatalog("theme-revenue", "en"),
};

const PRESETS: readonly NamedPreset[] = [
	"7d",
	"28d",
	"this_year",
	"last_month",
];

describe("the Doanh thu message file", () => {
	it("holds exactly the keys of the Doanh thu model in both languages", () => {
		const modelKeys = stringsOf(revenueKeys).sort();
		for (const language of ["vi", "en"] as const) {
			expect(
				Object.keys(messageFile("theme-revenue", language)).sort(),
			).toEqual(modelKeys);
		}
	});
});

describe("Doanh thu on the demo engine", () => {
	const source = themeSource();

	for (const preset of PRESETS) {
		for (const stores of STORE_SELECTIONS) {
			it(`builds every visible card for ${stores.join(" + ")} over ${preset}`, async () => {
				const context = themeSmokeContext(stores, preset);
				const cards = await runTheme(revenueTheme, context, source);
				expect(cards.map((card) => card.id)).toEqual(
					await visibleCardIds(revenueTheme, context, source),
				);
				expect(missingKeys(cards, catalogs)).toEqual([]);
				expect(unfilledPlaceholders(cards, catalogs)).toEqual([]);
				for (const card of cards) {
					expect(card.markers.verification, card.id).toBe("sample");
					expect(card.narrative.length, card.id).toBeGreaterThan(0);
					expect(card.narrative.length, card.id).toBeLessThanOrEqual(3);
					expect(card.csvName, card.id).toMatch(
						/^doanh-thu-[a-z_]+-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/,
					);
				}
			}, 60_000);
		}
	}

	it("compares the established store with the previous four weeks and last year", async () => {
		const cards = await runTheme(
			revenueTheme,
			themeSmokeContext(["MOCK-S1"], "28d"),
			source,
		);
		const net = cards.find((card) => card.id === "net_revenue");
		expect(net?.headline.value).toBeGreaterThan(0);
		expect(
			net?.comparisons.map((entry) => [entry.kind, entry.unavailable]),
		).toEqual([
			["previous", null],
			["last_year", null],
		]);
		expect(net?.decomposition?.against).toBe("previous");
		const trend = cards.find((card) => card.id === "trend");
		expect(trend?.chart?.series.map((series) => series.kind)).toEqual([
			"bar",
			"line",
			"line",
		]);
		expect(trend?.notice).toBeNull();
	}, 60_000);

	it("shows months and store shares on a long range of both stores", async () => {
		const cards = await runTheme(
			revenueTheme,
			themeSmokeContext(["MOCK-S1", "MOCK-S2"], "this_year"),
			source,
		);
		expect(cards.map((card) => card.id)).toContain("by_month");
		const shares = cards.find((card) => card.id === "store_share");
		const rows = shares?.tables[0]?.rows ?? [];
		expect(rows).toHaveLength(2);
		const total = rows.reduce(
			(sum, row) => sum + Number(row.cells.share ?? 0),
			0,
		);
		expect(total).toBeCloseTo(1, 5);
	}, 60_000);

	it("says the young store has no last year", async () => {
		const cards = await runTheme(
			revenueTheme,
			themeSmokeContext(["MOCK-S2"], "28d"),
			source,
		);
		const net = cards.find((card) => card.id === "net_revenue");
		expect(
			net?.comparisons.find((entry) => entry.kind === "last_year")?.unavailable,
		).toBe("store_too_young");
	}, 60_000);
});
