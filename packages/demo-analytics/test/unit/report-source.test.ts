import {
	addDays,
	daysBetween,
	type ThemeArgs,
	type ThemeFunctionName,
	themeFunctions,
} from "@fnb/reports";
import { describe, expect, it } from "vitest";
import { BASKET_PAIRS_MAX_DAYS } from "../../src/functions/basket-pairs.js";
import { ITEM_ATTACH_MAX_DAYS } from "../../src/functions/item-attach.js";
import { ITEM_MARGINS_MAX_DAYS } from "../../src/functions/item-margins.js";
import { MODIFIER_SUMMARY_MAX_DAYS } from "../../src/functions/modifier-summary.js";
import {
	createDemoAnalyticsSource,
	createDemoReportSource,
	DemoDayCache,
	DemoSettingsStore,
	demoSettings,
	handlers,
	themeHandlers,
	themeReads,
} from "../../src/index.js";

const NOW = new Date("2026-11-04T05:30:00.000Z");
const AS_OF = "2026-11-03";
const STORES = ["MOCK-S1", "MOCK-S2"];
const MENU_WINDOW_MAX_DAYS = 91;

function sorted(names: readonly string[]): string[] {
	return [...names].sort();
}

const minimalArgs: { [N in ThemeFunctionName]: ThemeArgs<N> } = {
	report_settings_of: { store_ids: STORES },
	range_totals: {
		store_ids: STORES,
		from_dates: ["2026-10-01", "2026-10-20"],
		to_dates: ["2026-10-07", "2026-11-03"],
	},
	opening_productivity: {
		store_ids: STORES,
		from_date: "2026-10-28",
		to_date: AS_OF,
	},
	hour_weekday_heatmap: {
		store_ids: STORES,
		from_date: "2026-10-28",
		to_date: AS_OF,
	},
	hour_profile: { store_ids: STORES, from_date: "2026-10-28", to_date: AS_OF },
	menu_engineering: { store_ids: STORES, as_of_date: AS_OF, window_days: 14 },
	item_margins: { store_ids: STORES, from_date: "2026-10-28", to_date: AS_OF },
	item_attach: { store_ids: STORES, from_date: "2026-10-28", to_date: AS_OF },
	basket_pairs: { store_ids: STORES, from_date: "2026-10-28", to_date: AS_OF },
	modifier_summary: {
		store_ids: STORES,
		from_date: "2026-10-28",
		to_date: AS_OF,
		compare_from: "2026-10-21",
		compare_to: "2026-10-27",
	},
};

describe("createDemoReportSource", () => {
	it("has a handler and a read plan for every thematic function of the contract, and keeps phase 9's handlers", async () => {
		expect(sorted(Object.keys(themeHandlers))).toEqual(
			sorted(Object.keys(themeFunctions)),
		);
		expect(sorted(Object.keys(themeReads))).toEqual(
			sorted(Object.keys(themeFunctions)),
		);
		expect(sorted(Object.keys(minimalArgs))).toEqual(
			sorted(Object.keys(themeFunctions)),
		);
		const source = createDemoReportSource({
			now: () => NOW,
			volumeScale: 0.2,
		});
		const analytics = createDemoAnalyticsSource({
			now: () => NOW,
			volumeScale: 0.2,
		});
		expect(source.kind).toBe("demo");
		expect(typeof source.callTheme).toBe("function");
		expect(sorted(Object.keys(handlers))).toHaveLength(16);
		expect(
			await source.call("store_coverage", {
				store_ids: STORES,
				from_date: "2026-11-01",
				to_date: AS_OF,
			}),
		).toEqual(
			await analytics.call("store_coverage", {
				store_ids: STORES,
				from_date: "2026-11-01",
				to_date: AS_OF,
			}),
		);
	});

	it("answers every thematic function with rows of its contract and reads only the store-days it planned", async () => {
		for (const name of Object.keys(themeFunctions) as ThemeFunctionName[]) {
			const source = createDemoReportSource({
				now: () => NOW,
				volumeScale: 0.2,
				validateRows: true,
				settings: new DemoSettingsStore(demoSettings(AS_OF)),
			});
			const rows = await source.callTheme(name, minimalArgs[name] as never);
			expect(Array.isArray(rows), name).toBe(true);
			expect(rows.length, name).toBeGreaterThan(0);
			expect(source.aggregates.misses(), name).toBe(0);
		}
	});

	it("shares the day cache and the settings store it is given", async () => {
		const days = new DemoDayCache({ now: () => NOW, volumeScale: 0.2 });
		const settings = new DemoSettingsStore(demoSettings(AS_OF));
		const source = createDemoReportSource({ now: () => NOW, days, settings });
		expect(source.settings).toBe(settings);
		expect(source.aggregates.days).toBe(days);
		expect(days.currentMappings()).toBe(settings);
		await source.callTheme("report_settings_of", { store_ids: ["MOCK-S1"] });
		expect(days.generations()).toBe(0);
	});
});

describe("themeReads", () => {
	it("plans no store-day for report_settings_of and one span per range of range_totals", () => {
		expect(themeReads.report_settings_of({ store_ids: STORES })).toEqual([]);
		expect(
			themeReads.range_totals({
				store_ids: STORES,
				from_dates: ["2026-10-01", "2026-10-20"],
				to_dates: ["2026-10-07", "2026-11-03"],
			}),
		).toEqual([
			{ storeIds: STORES, from: "2026-10-01", to: "2026-10-07" },
			{ storeIds: STORES, from: "2026-10-20", to: "2026-11-03" },
		]);
	});

	it("plans the requested range of the hour and opening functions as it is", () => {
		const range = {
			store_ids: STORES,
			from_date: "2024-01-01",
			to_date: AS_OF,
		};
		for (const name of [
			"opening_productivity",
			"hour_weekday_heatmap",
			"hour_profile",
		] as const) {
			expect(themeReads[name](range)).toEqual([
				{ storeIds: STORES, from: "2024-01-01", to: AS_OF },
			]);
		}
	});

	it("plans the menu window from its days, and clamps it to the longest window", () => {
		expect(
			themeReads.menu_engineering({
				store_ids: STORES,
				as_of_date: AS_OF,
				window_days: 14,
			}),
		).toEqual([{ storeIds: STORES, from: "2026-10-21", to: AS_OF }]);
		for (const window_days of [undefined, null, MENU_WINDOW_MAX_DAYS, 365]) {
			const [span] = themeReads.menu_engineering({
				store_ids: STORES,
				as_of_date: AS_OF,
				window_days,
			});
			expect(span).toEqual({
				storeIds: STORES,
				from: addDays(AS_OF, -(MENU_WINDOW_MAX_DAYS - 1)),
				to: AS_OF,
			});
		}
	});

	it("clamps the bounded functions to their longest range, ending on the requested day", () => {
		for (const [name, maxDays] of [
			["item_margins", ITEM_MARGINS_MAX_DAYS],
			["item_attach", ITEM_ATTACH_MAX_DAYS],
			["basket_pairs", BASKET_PAIRS_MAX_DAYS],
			["modifier_summary", MODIFIER_SUMMARY_MAX_DAYS],
		] as const) {
			const within = themeReads[name]({
				store_ids: STORES,
				from_date: "2026-10-28",
				to_date: AS_OF,
			});
			expect(within, name).toEqual([
				{ storeIds: STORES, from: "2026-10-28", to: AS_OF },
			]);
			const [clamped] = themeReads[name]({
				store_ids: STORES,
				from_date: "2020-01-01",
				to_date: AS_OF,
			});
			expect(clamped?.to, name).toBe(AS_OF);
			expect(daysBetween(clamped?.from ?? AS_OF, AS_OF) + 1, name).toBe(
				maxDays,
			);
			expect(
				themeReads[name]({
					store_ids: STORES,
					from_date: "2026-11-04",
					to_date: AS_OF,
				}),
				name,
			).toEqual([]);
		}
	});

	it("adds the compare range of modifier_summary, clamped alike, only when both ends are given", () => {
		const base = { store_ids: STORES, from_date: "2026-10-28", to_date: AS_OF };
		expect(
			themeReads.modifier_summary({
				...base,
				compare_from: "2020-01-01",
				compare_to: "2026-10-27",
			}),
		).toEqual([
			{ storeIds: STORES, from: "2026-10-28", to: AS_OF },
			{
				storeIds: STORES,
				from: addDays("2026-10-27", -(MODIFIER_SUMMARY_MAX_DAYS - 1)),
				to: "2026-10-27",
			},
		]);
		for (const compare of [
			{ compare_from: "2026-10-21", compare_to: null },
			{ compare_from: null, compare_to: "2026-10-27" },
			{},
		]) {
			expect(themeReads.modifier_summary({ ...base, ...compare })).toHaveLength(
				1,
			);
		}
	});
});
