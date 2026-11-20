import {
	addDays,
	daysBetween,
	INVALID_ARGUMENTS_CODE,
	type ThemeArgs,
	type ThemeFunctionName,
	themeFunctions,
} from "@fnb/reports";
import { describe, expect, it } from "vitest";
import { BASKET_PAIRS_MAX_DAYS } from "../../src/functions/basket-pairs.js";
import { DATA_QUALITY_ITEMS_MAX_DAYS } from "../../src/functions/data-quality-items.js";
import { DATA_QUALITY_PAYMENTS_MAX_DAYS } from "../../src/functions/data-quality-payments.js";
import { ITEM_ATTACH_MAX_DAYS } from "../../src/functions/item-attach.js";
import { ITEM_MARGINS_MAX_DAYS } from "../../src/functions/item-margins.js";
import { MODIFIER_SUMMARY_MAX_DAYS } from "../../src/functions/modifier-summary.js";
import { PROMOTION_COMPLIANCE_MAX_DAYS } from "../../src/functions/promotion-compliance.js";
import { PROMOTION_DAYS_MAX_DAYS } from "../../src/functions/promotion-days.js";
import {
	createDemoAnalyticsSource,
	createDemoReportSource,
	DemoDayCache,
	DemoSettingsStore,
	demoSettings,
	ESTABLISHED_STORE_OPENED_ON,
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
	promotion_days: {
		store_ids: STORES,
		from_date: "2026-10-28",
		to_date: AS_OF,
	},
	promotion_catalogue: { store_ids: STORES, as_of_date: AS_OF },
	promotion_lift: {
		store_ids: STORES,
		promotion_kind: "item",
		promotion_key: "PROMO-1",
		from_date: "2026-08-04",
		to_date: AS_OF,
		comparator: "baseline",
	},
	promotion_compliance: {
		store_ids: STORES,
		from_date: "2026-10-28",
		to_date: AS_OF,
	},
	item_discount_days: { store_ids: STORES, calendar_year: 2026 },
	shift_adjustments: {
		store_ids: STORES,
		from_date: "2026-10-28",
		to_date: AS_OF,
	},
	data_quality_items: {
		store_ids: STORES,
		from_date: "2026-10-28",
		to_date: AS_OF,
	},
	data_quality_summary: {
		store_ids: STORES,
		from_date: "2026-10-28",
		to_date: AS_OF,
	},
	data_quality_payments: {
		store_ids: STORES,
		from_date: "2026-10-28",
		to_date: AS_OF,
	},
	store_profiles: { store_ids: STORES },
	metric_windows: {
		store_ids: STORES,
		metric_ids: ["net_revenue", "avg_ticket"],
		from_dates: ["2026-10-07", "2026-09-09"],
		to_dates: [AS_OF, "2026-10-06"],
	},
	holiday_calendar: {
		store_ids: STORES,
		from_date: "2026-01-01",
		to_date: "2026-12-31",
	},
	plan_kpi_review: { store_ids: STORES, as_of_date: AS_OF },
	redemption_summary: {
		store_ids: STORES,
		from_date: "2026-10-28",
		to_date: AS_OF,
	},
	member_share_by_shift: {
		store_ids: STORES,
		from_date: "2026-10-28",
		to_date: AS_OF,
	},
	loyalty_rail_flags: { p_store_ids: STORES },
};

const NO_ROWS_IN_THE_DEMO: ReadonlySet<ThemeFunctionName> = new Set([
	"plan_kpi_review",
	"redemption_summary",
	"loyalty_rail_flags",
]);

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
			if (NO_ROWS_IN_THE_DEMO.has(name)) {
				expect(rows, name).toEqual([]);
			} else {
				expect(rows.length, name).toBeGreaterThan(0);
			}
			expect(source.aggregates.misses(), name).toBe(0);
		}
	});

	it("checks the arguments of a 10b function before its port runs", async () => {
		const source = createDemoReportSource({ now: () => NOW, volumeScale: 0.2 });
		await expect(
			source.callTheme("promotion_lift", {
				...minimalArgs.promotion_lift,
				comparator: "sister" as never,
			}),
		).rejects.toMatchObject({ code: INVALID_ARGUMENTS_CODE });
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
			["promotion_days", PROMOTION_DAYS_MAX_DAYS],
			["promotion_compliance", PROMOTION_COMPLIANCE_MAX_DAYS],
			["data_quality_items", DATA_QUALITY_ITEMS_MAX_DAYS],
			["data_quality_payments", DATA_QUALITY_PAYMENTS_MAX_DAYS],
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

	it("plans the promotion catalogue from the first demo sale to its as-of day", () => {
		expect(
			themeReads.promotion_catalogue({ store_ids: STORES, as_of_date: AS_OF }),
		).toEqual([
			{ storeIds: STORES, from: ESTABLISHED_STORE_OPENED_ON, to: AS_OF },
		]);
	});

	it("plans the lift's range with the 56 days before it, clamped to 92 days plus those 56", () => {
		const lift = {
			store_ids: STORES,
			promotion_kind: "item",
			promotion_key: "PROMO-1",
			comparator: "baseline",
		} as const;
		expect(
			themeReads.promotion_lift({
				...lift,
				from_date: "2026-10-28",
				to_date: AS_OF,
			}),
		).toEqual([{ storeIds: STORES, from: "2026-09-02", to: AS_OF }]);
		const [clamped] = themeReads.promotion_lift({
			...lift,
			from_date: "2025-01-01",
			to_date: AS_OF,
		});
		expect(daysBetween(clamped?.from ?? AS_OF, AS_OF) + 1).toBe(92 + 56);
	});

	it("plans the calendar year of item_discount_days up to its as-of day, and nothing for a year past 9999", () => {
		expect(
			themeReads.item_discount_days({ store_ids: STORES, calendar_year: 2025 }),
		).toEqual([{ storeIds: STORES, from: "2025-01-01", to: "2025-12-31" }]);
		expect(
			themeReads.item_discount_days({
				store_ids: STORES,
				calendar_year: 2026,
				as_of_date: AS_OF,
			}),
		).toEqual([{ storeIds: STORES, from: "2026-01-01", to: AS_OF }]);
		expect(
			themeReads.item_discount_days({
				store_ids: STORES,
				calendar_year: 2025,
				as_of_date: AS_OF,
			}),
		).toEqual([{ storeIds: STORES, from: "2025-01-01", to: "2025-12-31" }]);
		expect(
			themeReads.item_discount_days({
				store_ids: STORES,
				calendar_year: 10_000,
			}),
		).toEqual([]);
	});

	it("plans the shifts' 56 trailing days and a day either side for events, clamped alike", () => {
		const range = {
			store_ids: STORES,
			from_date: "2026-10-28",
			to_date: AS_OF,
		};
		expect(themeReads.shift_adjustments(range)).toEqual([
			{ storeIds: STORES, from: "2026-09-01", to: "2026-11-04" },
		]);
		const [clamped] = themeReads.shift_adjustments({
			...range,
			from_date: "2025-01-01",
		});
		expect(clamped?.to).toBe("2026-11-04");
		expect(daysBetween(clamped?.from ?? AS_OF, "2026-11-04") + 1).toBe(
			92 + 56 + 2,
		);
	});

	it("plans the data-quality summary over its range, the 120 receipt days and the shift windows around it", () => {
		expect(
			themeReads.data_quality_summary({
				store_ids: STORES,
				from_date: "2026-10-28",
				to_date: AS_OF,
			}),
		).toEqual([{ storeIds: STORES, from: "2026-07-07", to: "2026-11-04" }]);
		expect(
			themeReads.data_quality_summary({
				store_ids: STORES,
				from_date: addDays(AS_OF, -399),
				to_date: AS_OF,
			}),
		).toEqual([
			{ storeIds: STORES, from: addDays(AS_OF, -401), to: "2026-11-04" },
		]);
		const [clamped] = themeReads.data_quality_summary({
			store_ids: STORES,
			from_date: "2020-01-01",
			to_date: AS_OF,
		});
		expect(daysBetween(clamped?.from ?? AS_OF, "2026-11-04") + 1).toBe(403);
	});
});
