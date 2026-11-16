import {
	type NamedPreset,
	qualityKeys,
	qualityTheme,
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
	vi: themeCatalog("theme-quality", "vi"),
	en: themeCatalog("theme-quality", "en"),
};

const PRESETS: readonly NamedPreset[] = [
	"7d",
	"28d",
	"this_year",
	"last_month",
];

describe("the Chất lượng dữ liệu message file", () => {
	it("holds exactly the keys of the Chất lượng dữ liệu model in both languages", () => {
		const modelKeys = stringsOf(qualityKeys).sort();
		for (const language of ["vi", "en"] as const) {
			expect(
				Object.keys(messageFile("theme-quality", language)).sort(),
			).toEqual(modelKeys);
		}
	});
});

describe("Chất lượng dữ liệu on the demo engine", () => {
	const source = themeSource();

	for (const preset of PRESETS) {
		for (const stores of STORE_SELECTIONS) {
			it(`builds every card for ${stores.join(" + ")} over ${preset}`, async () => {
				const context = themeSmokeContext(stores, preset);
				const cards = await runTheme(qualityTheme, context, source);
				expect(cards.map((card) => card.id)).toEqual(
					await visibleCardIds(qualityTheme, context, source),
				);
				expect(cards).toHaveLength(qualityTheme.cards.length);
				expect(missingKeys(cards, catalogs)).toEqual([]);
				expect(unfilledPlaceholders(cards, catalogs)).toEqual([]);
				for (const card of cards) {
					expect(card.markers.verification, card.id).toBe("sample");
					expect(card.narrative.length, card.id).toBeGreaterThan(0);
					expect(card.narrative.length, card.id).toBeLessThanOrEqual(3);
					expect(card.csvName, card.id).toMatch(
						/^chat-luong-[a-z_]+-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/,
					);
				}
			}, 60_000);
		}
	}

	const youngStoreName = themeSmokeContext(["MOCK-S2"], "28d").stores[0]?.name;

	it("flags MOCK-S2 for e-invoicing, sells no catalogue modifier as an item and lists the demo's uncategorised item", async () => {
		const cards = await runTheme(
			qualityTheme,
			themeSmokeContext(["MOCK-S1", "MOCK-S2"], "28d"),
			source,
		);
		const compliance = cards.find((card) => card.id === "compliance");
		expect(compliance?.headline.value).toBe(1);
		expect(compliance?.notice?.action).toBe("settings_e_invoice");
		const eInvoiceRows = (compliance?.tables[0]?.rows ?? []).filter(
			(row) =>
				row.cells.finding === qualityKeys.finding.eInvoice.not_configured,
		);
		expect(eInvoiceRows).toEqual([
			{
				id: "MOCK-S2|eInvoice",
				cells: {
					store: youngStoreName,
					finding: qualityKeys.finding.eInvoice.not_configured,
					fix: qualityKeys.fix.pos.eInvoice,
				},
			},
		]);
		expect(
			(compliance?.tables[0]?.rows ?? []).every((row) =>
				row.id.startsWith("MOCK-S2|"),
			),
		).toBe(true);
		expect(compliance?.tables[1]?.rows.map((row) => row.id)).toEqual([
			"MOCK-S1",
			"MOCK-S2",
		]);
		expect(compliance?.tables[1]?.rows[1]?.cells.eInvoice).toBe(
			qualityKeys.eInvoice.not_configured,
		);
		const modifiers = cards.find((card) => card.id === "modifiers");
		expect(
			modifiers?.tables[0]?.rows.map((row) => row.cells.catalogueModifiers),
		).toEqual([0, 0]);
		const uncategorised = cards.find((card) => card.id === "uncategorised");
		expect(uncategorised?.headline.value).toBe(1);
		expect(uncategorised?.notice?.action).toBe("settings_categories");
	}, 60_000);
});
