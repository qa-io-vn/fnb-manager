import { menuKeys, menuTheme, type NamedPreset, runTheme } from "@fnb/reports";
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
	vi: themeCatalog("theme-menu", "vi"),
	en: themeCatalog("theme-menu", "en"),
};

const PRESETS: readonly NamedPreset[] = [
	"7d",
	"28d",
	"this_year",
	"last_month",
];

describe("the Thực đơn message file", () => {
	it("holds exactly the keys of the Thực đơn model in both languages", () => {
		const modelKeys = stringsOf(menuKeys).sort();
		for (const language of ["vi", "en"] as const) {
			expect(Object.keys(messageFile("theme-menu", language)).sort()).toEqual(
				modelKeys,
			);
		}
	});
});

describe("Thực đơn on the demo engine", () => {
	const source = themeSource();

	for (const preset of PRESETS) {
		for (const stores of STORE_SELECTIONS) {
			it(`builds every visible card for ${stores.join(" + ")} over ${preset}`, async () => {
				const context = themeSmokeContext(stores, preset);
				const cards = await runTheme(menuTheme, context, source);
				expect(cards.map((card) => card.id)).toEqual(
					await visibleCardIds(menuTheme, context, source),
				);
				expect(missingKeys(cards, catalogs)).toEqual([]);
				expect(unfilledPlaceholders(cards, catalogs)).toEqual([]);
				for (const card of cards) {
					expect(card.markers.verification, card.id).toBe("sample");
					expect(card.narrative.length, card.id).toBeGreaterThan(0);
					expect(card.narrative.length, card.id).toBeLessThanOrEqual(3);
					expect(card.csvName, card.id).toMatch(
						/^thuc-don-[a-z_]+-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/,
					);
				}
			}, 60_000);
		}
	}

	it("classes the drinks of the established store and keeps them provisional without costs", async () => {
		const cards = await runTheme(
			menuTheme,
			themeSmokeContext(["MOCK-S1"], "28d"),
			source,
		);
		const matrix = cards.find((card) => card.id === "menu_matrix");
		expect(matrix?.headline.value).toBeGreaterThanOrEqual(0);
		expect(matrix?.markers.provisional).toBe(true);
		expect(matrix?.tables[0]?.rows.length).toBeGreaterThan(0);
		expect(matrix?.chart?.series.map((series) => series.stack)).toEqual([
			"classes",
			"classes",
			"classes",
			"classes",
		]);
		const margins = cards.find((card) => card.id === "margins");
		expect(margins?.headline.value).toBeNull();
		expect(margins?.notice?.action).toBe("settings_costs");
	}, 60_000);
});
