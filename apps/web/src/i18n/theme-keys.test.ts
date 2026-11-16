import {
	createDemoReportSource,
	DemoDayCache,
	demoStores,
} from "@fnb/demo-analytics";
import {
	buildLiftCard,
	type CardModel,
	coverageModel,
	type NamedPreset,
	PROMOTION_COMPARATORS,
	parseThemeParams,
	promotionParams,
	promotionsCalls,
	promotionsKeys,
	promotionsTheme,
	rangeOfPreset,
	runTheme,
	type ThemeContext,
	type ThemeDefinition,
	themeDefinitions,
	themeKeys,
} from "@fnb/reports";
import { describe, expect, it } from "vitest";
import type { TableSpec } from "../components/report-card/types";
import { isWebMetricId } from "../metrics/registry";
import { toReportCardProps } from "../reports/card-adapter";
import { modelKeys } from "../test/card-keys";
import { vndFormatters } from "../test/render";
import { isMessageKey, messages, translate } from "./index";

const NOW = new Date("2026-11-04T05:30:00.000Z");
const days = new DemoDayCache({ now: () => NOW });
const source = createDemoReportSource({ now: () => NOW, validateRows: true });
const asOf = days.asOf();
const stores = demoStores(asOf);
const SELECTIONS: readonly (readonly string[])[] = [
	["MOCK-S1"],
	["MOCK-S2"],
	["MOCK-S1", "MOCK-S2"],
];
const PRESETS: readonly NamedPreset[] = ["7d", "28d", "this_year"];
const RAW_KEY = /\b(report|metric|theme)\.[a-z]+[A-Za-z_]*\./;

function stringsOf(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (value !== null && typeof value === "object") {
		return Object.values(value).flatMap(stringsOf);
	}
	return [];
}

function shownCells(table: TableSpec | null | undefined): unknown[] {
	if (table === null || table === undefined) return [];
	return table.rows.map((row) =>
		table.columns.map((column) => row.cells[column.key] ?? null),
	);
}

function contextOf(
	definition: ThemeDefinition,
	storeIds: readonly string[],
	preset: NamedPreset,
	search: Readonly<Record<string, string>> = {},
): ThemeContext {
	return {
		tenantId: "demo-tenant",
		stores: stores
			.filter((store) => storeIds.includes(store.id))
			.map((store) => ({
				id: store.id,
				name: store.name,
				timeZone: store.timeZone,
				businessDayStartMinutes: store.businessDayStartMinutes,
			})),
		allStoresSelected: storeIds.length === stores.length,
		range: rangeOfPreset(preset, asOf),
		sample: true,
		params: parseThemeParams(definition.params, search),
		catchUpPending: null,
	};
}

const definitions: readonly ThemeDefinition[] = Object.values(themeDefinitions);

const runs = definitions.flatMap((definition) =>
	SELECTIONS.flatMap((selection) =>
		PRESETS.map((preset) => ({ definition, selection, preset })),
	),
);

const comparatorRuns = SELECTIONS.flatMap((selection) =>
	PRESETS.flatMap((preset) =>
		PROMOTION_COMPARATORS.map((comparator) => ({
			selection,
			preset,
			comparator,
		})),
	),
);

const UNFILLED_PLACEHOLDER = /\{\w+\}/;

function expectCardsTranslated(
	kind: ThemeDefinition["kind"],
	cards: readonly CardModel[],
): string[] {
	const shown: string[] = [];
	const missing = [...new Set(cards.flatMap(modelKeys))].filter(
		(key) => !isMessageKey(key) || messages.en[key].trim() === "",
	);
	expect(missing).toEqual([]);
	for (const card of cards) {
		expect(isWebMetricId(card.metricId), card.metricId).toBe(true);
		for (const related of card.relatedMetricIds) {
			expect(isWebMetricId(related), related).toBe(true);
		}
		for (const language of ["vi", "en"] as const) {
			const props = toReportCardProps(
				card,
				kind,
				(key, params) => translate(language, key, params),
				vndFormatters(language === "vi" ? "vi-VN" : "en-GB"),
			);
			const visible = JSON.stringify([
				props.title,
				props.subtitle ?? "",
				props.sentence,
				props.headline.caption ?? "",
				props.chips.map((chip) => chip.label),
				props.notice?.text ?? "",
				props.decomposition?.label ?? "",
				props.table?.caption ?? "",
				props.table?.columns.map((column) => column.label) ?? [],
				props.chart?.label ?? "",
				props.chart?.series.map((series) => series.name) ?? [],
				shownCells(props.table),
				shownCells(props.secondaryTable),
				props.secondaryTable?.caption ?? "",
				props.secondaryTable?.columns.map((column) => column.label) ?? [],
			]);
			expect(RAW_KEY.test(visible), `${card.id} ${visible}`).toBe(false);
			expect(UNFILLED_PLACEHOLDER.test(visible), `${card.id} ${visible}`).toBe(
				false,
			);
			expect(props.sentence.trim(), card.id).not.toBe("");
			shown.push(visible);
		}
	}
	return shown;
}

async function expectEveryKeyTranslated(
	definition: ThemeDefinition,
	context: ThemeContext,
): Promise<void> {
	const cards = await runTheme(definition, context, source);
	expect(cards.length).toBeGreaterThan(0);
	expectCardsTranslated(definition.kind, cards);
}

const LIFT_W92 = [
	{
		promotion_kind: "bill",
		promotion_key: "unnamed",
		promotion_name: null,
		invoices: 30,
		lines: null,
		discount_amount: 1_500_000,
		first_used_on: "2026-10-09",
		last_used_on: "2026-11-01",
		days_used: 20,
	},
];

function liftRow(overrides: Readonly<Record<string, unknown>>) {
	return {
		business_date: null,
		promo_day: null,
		control_day: null,
		test_gross_amount: null,
		test_net_amount: null,
		test_invoices: null,
		discount_amount: null,
		reference_gross_amount: null,
		reference_days: null,
		counterfactual_gross_amount: null,
		gross_lift_amount: null,
		test_store_count: null,
		control_store_count: null,
		promo_days: null,
		measured_days: null,
		control_days: null,
		trend_adjustment_amount: null,
		net_lift_amount: null,
		lift_rate: null,
		flags: null,
		...overrides,
	};
}

const LIFT_DAYS = [
	liftRow({
		business_date: "2026-10-20",
		promo_day: true,
		control_day: false,
		test_gross_amount: 5_600_000,
		reference_gross_amount: 4_800_000,
		counterfactual_gross_amount: 5_200_000,
		gross_lift_amount: 400_000,
		discount_amount: 100_000,
	}),
	liftRow({
		business_date: "2026-10-12",
		promo_day: false,
		control_day: true,
		test_gross_amount: 5_000_000,
		reference_gross_amount: 4_800_000,
	}),
];

const MEASURED_LIFTS = [
	{
		name: "a gain with the trend taken out",
		cmp: "baseline",
		summary: {
			gross_lift_amount: 1_200_000,
			discount_amount: 300_000,
			net_lift_amount: 900_000,
			measured_days: 3,
			control_days: 9,
			control_store_count: 1,
			trend_adjustment_amount: 150_000,
			flags: ["other_promotions"],
		},
		expected: {
			vi: ["lãi ròng", "Đã trừ xu hướng chung", "Doanh thu gộp tăng thêm"],
			en: ["earned", "general trend", "Gross lift"],
		},
	},
	{
		name: "a loss against the weeks before",
		cmp: "prior_weeks",
		summary: {
			gross_lift_amount: -369_571.48,
			discount_amount: 163_000,
			net_lift_amount: -532_571.48,
			measured_days: 18,
			control_days: 7,
			control_store_count: 0,
			trend_adjustment_amount: -162_857.14,
			flags: ["few_reference_days", "unmeasured_days"],
		},
		expected: {
			vi: ["lỗ ròng", "Đã trừ xu hướng chung", "6 tuần"],
			en: ["lost", "general trend", "6 weeks"],
		},
	},
	{
		name: "a gain against another store",
		cmp: "sister_store",
		summary: {
			gross_lift_amount: 500_000,
			discount_amount: 200_000,
			net_lift_amount: 300_000,
			measured_days: 4,
			control_store_count: 1,
			flags: ["control_differs_in_size"],
		},
		expected: {
			vi: ["lãi ròng", "cửa hàng không chạy chương trình"],
			en: ["earned", "stores that did not run it"],
		},
	},
] as const;

function liftCardOf(
	cmp: string,
	summary: Readonly<Record<string, unknown>>,
): CardModel {
	const context = contextOf(promotionsTheme, ["MOCK-S1"], "28d", { cmp });
	const rows: Readonly<Record<string, readonly unknown[]>> = {
		[promotionsCalls.promotionsW92]: LIFT_W92,
		[promotionsCalls.settings]: [{ promo_pre_weeks: 6 }],
		[promotionsCalls.lift]: [...LIFT_DAYS, liftRow(summary)],
	};
	return buildLiftCard({
		context,
		coverage: coverageModel([], context),
		results: { rows: (key: string) => rows[key] as never },
	});
}

describe("theme keys", () => {
	it("declares every shared theme key in both languages", () => {
		const missing = stringsOf(themeKeys).filter(
			(key) => !isMessageKey(key) || messages.en[key].trim() === "",
		);
		expect(missing).toEqual([]);
	});

	it("declares the Khuyến mãi keys and every parameter label and option label in both languages", () => {
		const keys = [
			...stringsOf(promotionsKeys),
			...promotionParams.flatMap((spec) => [
				spec.labelKey,
				...spec.options.flatMap((option) =>
					"labelKey" in option ? [option.labelKey] : [],
				),
			]),
		];
		expect(keys.length).toBeGreaterThan(5);
		expect(
			keys.filter(
				(key) => !isMessageKey(key) || messages.en[key].trim() === "",
			),
		).toEqual([]);
	});

	it.each(
		definitions.map((definition) => [definition.kind, definition] as const),
	)("declares the %s theme title in both languages", (_kind, definition) => {
		expect(isMessageKey(definition.titleKey), definition.titleKey).toBe(true);
	});

	it.each(
		runs.map(
			(run) =>
				[
					run.definition.kind,
					run.selection.join("+"),
					run.preset,
					run,
				] as const,
		),
	)(
		"translates every key of %s for %s over %s",
		async (_kind, _selection, _preset, run) => {
			await expectEveryKeyTranslated(
				run.definition,
				contextOf(run.definition, run.selection, run.preset),
			);
		},
		60_000,
	);

	it.each(MEASURED_LIFTS.map((lift) => [lift.name, lift] as const))(
		"translates a measured lift, %s, with every placeholder filled in both languages",
		(_name, lift) => {
			const card = liftCardOf(lift.cmp, lift.summary);
			expect(card.headline.value).toBe(lift.summary.net_lift_amount);
			const [vi, en] = expectCardsTranslated("promotions", [card]);
			for (const text of lift.expected.vi) expect(vi).toContain(text);
			for (const text of lift.expected.en) expect(en).toContain(text);
		},
	);

	it.each(
		comparatorRuns.map(
			(run) =>
				[run.comparator, run.selection.join("+"), run.preset, run] as const,
		),
	)(
		"translates every key of Khuyến mãi against %s for %s over %s",
		async (_comparator, _selection, _preset, run) => {
			await expectEveryKeyTranslated(
				promotionsTheme,
				contextOf(promotionsTheme, run.selection, run.preset, {
					cmp: run.comparator,
				}),
			);
		},
		60_000,
	);
});
