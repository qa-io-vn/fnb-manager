import {
	hoursKeys,
	hoursTheme,
	type NamedPreset,
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
	vi: themeCatalog("theme-hours", "vi"),
	en: themeCatalog("theme-hours", "en"),
};

const PRESETS: readonly NamedPreset[] = ["7d", "28d", "91d", "this_month"];

describe("the Giờ & ngày message file", () => {
	it("holds exactly the keys of the Giờ & ngày model in both languages", () => {
		const modelKeys = stringsOf(hoursKeys).sort();
		for (const language of ["vi", "en"] as const) {
			expect(Object.keys(messageFile("theme-hours", language)).sort()).toEqual(
				modelKeys,
			);
		}
	});
});

describe("Giờ & ngày on the demo engine", () => {
	const source = themeSource();

	for (const preset of PRESETS) {
		for (const stores of STORE_SELECTIONS) {
			it(`builds every visible card for ${stores.join(" + ")} over ${preset}`, async () => {
				const context = themeSmokeContext(stores, preset);
				const cards = await runTheme(hoursTheme, context, source);
				expect(cards.map((card) => card.id)).toEqual(
					await visibleCardIds(hoursTheme, context, source),
				);
				expect(missingKeys(cards, catalogs)).toEqual([]);
				expect(unfilledPlaceholders(cards, catalogs)).toEqual([]);
				for (const card of cards) {
					expect(card.narrative.length, card.id).toBeGreaterThan(0);
					expect(card.narrative.length, card.id).toBeLessThanOrEqual(3);
					expect(card.csvName, card.id).toMatch(
						/^gio-ngay-[a-z_]+-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/,
					);
					if (card.headline.value === null && card.id !== "heatmap") {
						expect(
							card.notice !== null || card.narrative.length > 0,
							`${card.id} explains its empty headline`,
						).toBe(true);
					}
				}
			}, 60_000);
		}
	}

	it("lays out the heat table Monday to Sunday with an average column", async () => {
		const cards = await runTheme(
			hoursTheme,
			themeSmokeContext(["MOCK-S1"], "28d"),
			source,
		);
		const heat = cards.find((card) => card.id === "heatmap");
		const table = heat?.tables[0];
		expect(table?.variant).toBe("heat");
		expect(table?.columns.map((column) => column.key)).toEqual([
			"hour",
			"d1",
			"d2",
			"d3",
			"d4",
			"d5",
			"d6",
			"d7",
			"average",
		]);
		expect(table?.heatColumns).toHaveLength(7);
		expect(table?.rows.length).toBeGreaterThan(8);
	}, 60_000);

	it("marks three peak hours and gives a peak share", async () => {
		const cards = await runTheme(
			hoursTheme,
			themeSmokeContext(["MOCK-S1", "MOCK-S2"], "28d"),
			source,
		);
		const peaks = cards.find((card) => card.id === "peak_dead");
		expect(peaks?.headline.value).toBeGreaterThan(0);
		expect(peaks?.headline.value).toBeLessThan(1);
		const levels = peaks?.tables[0]?.rows.map((row) => row.cells.level) ?? [];
		expect(
			levels.filter((level) => level === hoursKeys.level.peak),
		).toHaveLength(3);
	}, 60_000);

	it("computes RevPASH for the store with seats and asks for opening hours of the young store", async () => {
		const established = await runTheme(
			hoursTheme,
			themeSmokeContext(["MOCK-S1"], "28d"),
			source,
		);
		const seats = established.find((card) => card.id === "productivity");
		expect(seats?.headline.value).toBeGreaterThan(0);
		expect(seats?.notice).toBeNull();
		const young = await runTheme(
			hoursTheme,
			themeSmokeContext(["MOCK-S2"], "28d"),
			source,
		);
		const missing = young.find((card) => card.id === "productivity");
		expect(missing?.headline.value).toBeNull();
		expect(missing?.notice?.action).toBe("settings_store");
	}, 60_000);

	it("asks for two weeks before suggesting shift windows", async () => {
		const cards = await runTheme(
			hoursTheme,
			themeSmokeContext(["MOCK-S1"], "7d"),
			source,
		);
		const windows = cards.find((card) => card.id === "shift_windows");
		expect(windows?.notice?.part.key).toBe(hoursKeys.shiftWindows.short);
	}, 60_000);
});
