import {
	isEmailLike,
	type NamedPreset,
	runTheme,
	shiftsKeys,
	shiftsTheme,
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

function shiftsCatalog(language: "vi" | "en") {
	return {
		...themeCatalog("theme-shifts", language),
		...messageFile("theme-payments", language),
	};
}

const catalogs = { vi: shiftsCatalog("vi"), en: shiftsCatalog("en") };

const PRESETS: readonly NamedPreset[] = ["7d", "28d", "91d", "last_month"];

describe("the Ca & két tiền message file", () => {
	it("holds exactly the keys of the Ca & két tiền model in both languages", () => {
		const modelKeys = stringsOf(shiftsKeys).sort();
		for (const language of ["vi", "en"] as const) {
			expect(Object.keys(messageFile("theme-shifts", language)).sort()).toEqual(
				modelKeys,
			);
		}
	});
});

describe("Ca & két tiền on the demo engine", () => {
	const source = themeSource();

	for (const preset of PRESETS) {
		for (const stores of STORE_SELECTIONS) {
			it(`builds every card for ${stores.join(" + ")} over ${preset}`, async () => {
				const context = themeSmokeContext(stores, preset);
				const cards = await runTheme(shiftsTheme, context, source);
				expect(cards.map((card) => card.id)).toEqual(
					await visibleCardIds(shiftsTheme, context, source),
				);
				expect(cards.map((card) => card.id)).toEqual([
					"shift_sales",
					"drawer",
					"adjustments",
				]);
				expect(missingKeys(cards, catalogs)).toEqual([]);
				expect(unfilledPlaceholders(cards, catalogs)).toEqual([]);
				expect(isEmailLike(JSON.stringify(cards))).toBe(false);
				for (const card of cards) {
					expect(card.markers.verification, card.id).toBe("sample");
					expect(card.narrative.length, card.id).toBeGreaterThan(0);
					expect(card.narrative.length, card.id).toBeLessThanOrEqual(3);
					expect(card.headline.value, card.id).not.toBeNull();
					expect(card.csvName, card.id).toMatch(
						/^ca-ket-tien-[a-z_]+-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/,
					);
				}
			}, 60_000);
		}
	}

	it("flags in the drawer card exactly the shifts shift_review flags, and labels each shift alike in every card", async () => {
		const context = themeSmokeContext(["MOCK-S1", "MOCK-S2"], "28d");
		const cards = await runTheme(shiftsTheme, context, source);
		const reviewed = await source.call("shift_review", {
			store_ids: ["MOCK-S1", "MOCK-S2"],
			from_date: context.range.from,
			to_date: context.range.to,
		});
		const drawer = cards.find((card) => card.id === "drawer");
		expect(drawer?.headline.value).toBe(
			reviewed.filter((row) => row.flagged).length,
		);
		const numbers = (id: string) =>
			new Map(
				(cards.find((card) => card.id === id)?.tables[0]?.rows ?? []).map(
					(row) => [row.id, row.cells.shift],
				),
			);
		const sales = numbers("shift_sales");
		const adjustments = numbers("adjustments");
		expect(sales.size).toBe(reviewed.length);
		expect(adjustments.size).toBe(reviewed.length);
		for (const [id, number] of numbers("drawer")) {
			expect(sales.get(id), id).toBe(number);
			expect(adjustments.get(id), id).toBe(number);
		}
	}, 60_000);
});
