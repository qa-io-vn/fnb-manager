import {
	type CardModel,
	callReport,
	coverageModel,
	type NamedPreset,
	runTheme,
	storesCalls,
	storesFollowUpCalls,
	storesKeys,
	storesPrimaryCalls,
	storesTheme,
	themeCoverageCall,
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
	vi: themeCatalog("theme-stores", "vi"),
	en: themeCatalog("theme-stores", "en"),
};

const PRESETS: readonly NamedPreset[] = [
	"7d",
	"28d",
	"this_year",
	"last_month",
];

const BOTH = ["MOCK-S1", "MOCK-S2"] as const;
const NOT_CONFIGURED = "report.unavailable.not_configured.previous";
const SERIES_ROW_LIMIT = 900;

function cardOf(cards: readonly CardModel[], id: string): CardModel {
	const card = cards.find((entry) => entry.id === id);
	if (card === undefined) throw new Error(`no ${id} card`);
	return card;
}

function sumOf(values: readonly unknown[]): number {
	return values.reduce<number>((total, value) => total + Number(value), 0);
}

describe("the So sánh message file", () => {
	it("holds exactly the keys of the So sánh model in both languages", () => {
		const modelKeys = stringsOf(storesKeys).sort();
		for (const language of ["vi", "en"] as const) {
			expect(Object.keys(messageFile("theme-stores", language)).sort()).toEqual(
				modelKeys,
			);
		}
	});
});

describe("So sánh on the demo engine", () => {
	const source = themeSource();

	for (const preset of PRESETS) {
		for (const stores of STORE_SELECTIONS) {
			it(`builds every visible card for ${stores.join(" + ")} over ${preset}`, async () => {
				const context = themeSmokeContext(stores, preset);
				const cards = await runTheme(storesTheme, context, source);
				expect(cards.map((card) => card.id)).toEqual(
					await visibleCardIds(storesTheme, context, source),
				);
				expect(missingKeys(cards, catalogs)).toEqual([]);
				expect(unfilledPlaceholders(cards, catalogs)).toEqual([]);
				for (const card of cards) {
					expect(card.markers.verification, card.id).toBe("sample");
					expect(card.narrative.length, card.id).toBeGreaterThan(0);
					expect(card.narrative.length, card.id).toBeLessThanOrEqual(3);
					expect(card.csvName, card.id).toMatch(
						/^so-sanh-[a-z_]+-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/,
					);
					if (stores.length === 1) {
						expect(card.narrative, card.id).toEqual([
							{ key: storesKeys.needTwo, values: {} },
						]);
						expect(card.headline.value, card.id).toBeNull();
					}
				}
			}, 60_000);
		}
	}

	it("runs no call but coverage for one store", async () => {
		const context = themeSmokeContext(["MOCK-S2"], "28d");
		expect(storesPrimaryCalls(context)).toEqual([themeCoverageCall(context)]);
		const coverage = coverageModel(
			await source.call("store_coverage", themeCoverageCall(context).args),
			context,
		);
		expect(storesFollowUpCalls(context, coverage)).toEqual([]);
	});

	it("adds the stores' net and invoices up to the all-stores row and takes the ratios after summing", async () => {
		const cards = await runTheme(
			storesTheme,
			themeSmokeContext(BOTH, "28d"),
			source,
		);
		const rows = cardOf(cards, "kpis").tables[0]?.rows ?? [];
		const stores = rows.filter((row) => row.id !== "all");
		const all = rows.find((row) => row.id === "all");
		expect(stores.map((row) => row.id).sort()).toEqual([...BOTH]);
		expect(all?.cells.store).toBe(storesKeys.kpis.allStores);
		const net = sumOf(stores.map((row) => row.cells.net));
		const invoices = sumOf(stores.map((row) => row.cells.invoices));
		expect(Number(all?.cells.net)).toBeCloseTo(net, 2);
		expect(all?.cells.invoices).toBe(invoices);
		expect(Number(all?.cells.avgTicket)).toBeCloseTo(net / invoices, 1);
		const young = rows.find((row) => row.id === "MOCK-S2");
		const established = rows.find((row) => row.id === "MOCK-S1");
		expect(young?.cells.salesPerHour).toBe(NOT_CONFIGURED);
		expect(young?.cells.revpash).toBe(NOT_CONFIGURED);
		expect(all?.cells.revpash).toBe(NOT_CONFIGURED);
		expect(typeof established?.cells.salesPerHour).toBe("number");
		expect(typeof established?.cells.revpash).toBe("number");
		expect(cardOf(cards, "kpis").notice?.action).toBe("settings_store");
	}, 60_000);

	it("indexes each store's days against its own average and aligns both stores since opening", async () => {
		const context = themeSmokeContext(BOTH, "28d");
		const cards = await runTheme(storesTheme, context, source);
		const sameDay = cardOf(cards, "same_day");
		expect(sameDay.tables[0]?.rows).toHaveLength(28 * BOTH.length);
		expect(sameDay.headline.value).toBeGreaterThan(0);
		expect(sameDay.chart?.series).toHaveLength(BOTH.length);
		const since = cardOf(cards, "since_opening");
		const weeks = since.chart?.categories.length ?? 0;
		expect(weeks).toBeGreaterThan(0);
		expect(weeks).toBeLessThanOrEqual(26);
		expect(since.tables[0]?.rows).toHaveLength(weeks * BOTH.length);
		expect(
			since.tables[0]?.rows.every((row) => row.cells.avgPerDay !== null),
		).toBe(true);
		const [main, tetNote] = since.narrative;
		expect(main?.key).toBe(storesKeys.sinceOpening.main);
		const compared = Number(main?.values.week?.value);
		const rows = since.tables[0]?.rows ?? [];
		const tetWeeks = rows
			.filter((row) => row.cells.tet === storesKeys.sinceOpening.tetWeek)
			.map((row) => Number(row.cells.week));
		expect(tetWeeks.length).toBeGreaterThan(0);
		expect(tetWeeks).not.toContain(compared);
		expect(compared).toBeLessThan(weeks);
		expect(tetNote?.key).toBe(storesKeys.sinceOpening.tetSkipped);
	}, 60_000);

	it("keeps the days call within the row limit at every preset for both stores", async () => {
		for (const preset of [
			"7d",
			"28d",
			"91d",
			"364d",
			"this_month",
			"last_month",
			"this_year",
		] as const) {
			const context = themeSmokeContext(BOTH, preset);
			const days = storesPrimaryCalls(context).find(
				(call) => call.key === storesCalls.days,
			);
			if (days === undefined) throw new Error(`no days call over ${preset}`);
			expect(days.name, preset).toBe("period_series");
			const rows = await callReport(source, days);
			expect(rows.length, preset).toBeLessThanOrEqual(SERIES_ROW_LIMIT);
		}
	}, 60_000);
});
