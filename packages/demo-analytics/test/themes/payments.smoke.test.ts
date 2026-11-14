import {
	type NamedPreset,
	paymentsKeys,
	paymentsTheme,
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
	vi: themeCatalog("theme-payments", "vi"),
	en: themeCatalog("theme-payments", "en"),
};

const PRESETS: readonly NamedPreset[] = [
	"7d",
	"28d",
	"this_year",
	"last_month",
];

describe("the Thanh toán message file", () => {
	it("holds exactly the keys of the Thanh toán model in both languages", () => {
		const modelKeys = stringsOf(paymentsKeys).sort();
		for (const language of ["vi", "en"] as const) {
			expect(
				Object.keys(messageFile("theme-payments", language)).sort(),
			).toEqual(modelKeys);
		}
	});
});

describe("Thanh toán on the demo engine", () => {
	const source = themeSource();

	for (const preset of PRESETS) {
		for (const stores of STORE_SELECTIONS) {
			it(`builds every visible card for ${stores.join(" + ")} over ${preset}`, async () => {
				const context = themeSmokeContext(stores, preset);
				const cards = await runTheme(paymentsTheme, context, source);
				expect(cards.map((card) => card.id)).toEqual(
					await visibleCardIds(paymentsTheme, context, source),
				);
				expect(missingKeys(cards, catalogs)).toEqual([]);
				expect(unfilledPlaceholders(cards, catalogs)).toEqual([]);
				for (const card of cards) {
					expect(card.markers.verification, card.id).toBe("sample");
					expect(card.narrative.length, card.id).toBeGreaterThan(0);
					expect(card.narrative.length, card.id).toBeLessThanOrEqual(3);
					expect(card.csvName, card.id).toMatch(
						/^thanh-toan-[a-z_]+-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/,
					);
				}
			}, 60_000);
		}
	}

	it("sums the kind shares to one and matches them to the method rows by kind", async () => {
		const cards = await runTheme(
			paymentsTheme,
			themeSmokeContext(["MOCK-S1", "MOCK-S2"], "28d"),
			source,
		);
		const mix = cards.find((card) => card.id === "payment_mix");
		const [kinds, methods] = mix?.tables ?? [];
		const kindShares = (kinds?.rows ?? []).map((row) =>
			Number(row.cells.share),
		);
		expect(kindShares.reduce((sum, share) => sum + share, 0)).toBeCloseTo(1, 5);
		for (const row of kinds?.rows ?? []) {
			const methodTotal = (methods?.rows ?? [])
				.filter((method) => method.cells.kind === row.cells.kind)
				.reduce((sum, method) => sum + Number(method.cells.share), 0);
			expect(methodTotal).toBeCloseTo(Number(row.cells.share), 5);
		}
		expect(mix?.headline.value).toBeGreaterThan(0);
		const trend = cards.find((card) => card.id === "cash_trend");
		expect(trend?.tables[0]?.rows.length).toBe(28);
		expect(trend?.chart?.rightUnit).toBe("fraction");
	}, 60_000);
});
