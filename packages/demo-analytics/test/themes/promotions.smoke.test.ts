import {
	buildLiftCard,
	comparatorOptions,
	coverageModel,
	customRange,
	type NamedPreset,
	PROMOTION_COMPARATORS,
	promotionsCalls,
	promotionsKeys,
	promotionsTheme,
	runPlannedCalls,
	runTheme,
	type ThemeContext,
	themeResultsOf,
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
	vi: themeCatalog("theme-promotions", "vi"),
	en: themeCatalog("theme-promotions", "en"),
};

const PRESETS: readonly NamedPreset[] = ["7d", "28d", "this_year"];

const SPRING = {
	from: "2026-03-03",
	to: "2026-06-02",
	promotion: "bill:Giảm 5% hóa đơn",
} as const;

function withComparator(
	context: ThemeContext,
	comparator: string,
): ThemeContext {
	return { ...context, params: { cmp: comparator } };
}

describe("the Khuyến mãi message file", () => {
	it("holds exactly the keys of the Khuyến mãi model in both languages", () => {
		const modelKeys = stringsOf(promotionsKeys).sort();
		for (const language of ["vi", "en"] as const) {
			expect(
				Object.keys(messageFile("theme-promotions", language)).sort(),
			).toEqual(modelKeys);
		}
	});
});

describe("Khuyến mãi on the demo engine", () => {
	const source = themeSource();

	for (const preset of PRESETS) {
		for (const stores of STORE_SELECTIONS) {
			for (const comparator of PROMOTION_COMPARATORS) {
				it(`builds every visible card for ${stores.join(" + ")} over ${preset} against ${comparator}`, async () => {
					const context = withComparator(
						themeSmokeContext(stores, preset),
						comparator,
					);
					const cards = await runTheme(promotionsTheme, context, source);
					expect(cards.map((card) => card.id)).toEqual(
						await visibleCardIds(promotionsTheme, context, source),
					);
					expect(missingKeys(cards, catalogs)).toEqual([]);
					expect(unfilledPlaceholders(cards, catalogs)).toEqual([]);
					for (const card of cards) {
						expect(card.markers.verification, card.id).toBe("sample");
						expect(card.narrative.length, card.id).toBeGreaterThan(0);
						expect(card.narrative.length, card.id).toBeLessThanOrEqual(3);
						expect(card.csvName, card.id).toMatch(
							/^khuyen-mai-[a-z_]+-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/,
						);
					}
					const lift = cards.find((card) => card.id === "lift");
					if (lift?.headline.value === null) {
						expect(
							lift.notice !== null || lift.narrative.length > 1,
							"a dash comes with its reason",
						).toBe(true);
						expect(lift.headline.caption).toBeNull();
					}
				}, 60_000);
			}
		}
	}

	it("adds up the promotions table and the components to the discount cost", async () => {
		const cards = await runTheme(
			promotionsTheme,
			themeSmokeContext(["MOCK-S1", "MOCK-S2"], "28d"),
			source,
		);
		const cost = cards.find((card) => card.id === "discount_cost");
		const [promotions, components] = cost?.tables ?? [];
		const sum = (values: readonly unknown[]) =>
			values.reduce<number>((total, value) => total + Number(value ?? 0), 0);
		expect(cost?.headline.value).toBeGreaterThan(0);
		expect(sum((promotions?.rows ?? []).map((row) => row.cells.discount))).toBe(
			cost?.headline.value,
		);
		expect(sum((components?.rows ?? []).map((row) => row.cells.current))).toBe(
			cost?.headline.value,
		);
		expect(
			sum((promotions?.rows ?? []).map((row) => row.cells.costShare)),
		).toBeCloseTo(1, 5);
		const vouchers = cards.find((card) => card.id === "vouchers");
		expect(vouchers?.headline.value).toBeGreaterThan(0);
		expect(vouchers?.tables[0]?.rows.length).toBeGreaterThan(0);
	}, 60_000);

	async function answered(context: ThemeContext) {
		const entries = new Map<string, readonly unknown[]>();
		await runPlannedCalls(
			promotionsTheme.primaryCalls(context),
			source,
			entries,
		);
		const coverage = coverageModel(
			(entries.get(promotionsCalls.coverage) ?? []) as never,
			context,
		);
		const results = themeResultsOf(entries);
		await runPlannedCalls(
			promotionsTheme.followUpCalls(context, coverage, results),
			source,
			entries,
		);
		return { entries, coverage, results: themeResultsOf(entries) };
	}

	it("shows a dash with the reason for a promotion that runs every day, and disables the sister store when both stores ran it", async () => {
		const context = themeSmokeContext(["MOCK-S1", "MOCK-S2"], "28d");
		const { coverage, results } = await answered(context);
		const lift = buildLiftCard({ context, coverage, results });
		expect(lift.headline.value).toBeNull();
		expect(lift.notice?.part.key).toBe(
			promotionsKeys.lift.flagNoStore.few_control_days,
		);
		const sister = comparatorOptions(results)?.find(
			(option) => option.value === "sister_store",
		);
		expect(sister).toMatchObject({
			disabled: true,
			reasonKey: promotionsKeys.lift.noControl,
		});
	}, 60_000);

	it("measures the spring bill discount of both stores against the weeks before, with the sister store offered", async () => {
		const base = themeSmokeContext(["MOCK-S1", "MOCK-S2"], "28d");
		const context: ThemeContext = {
			...base,
			range: customRange(SPRING.from, SPRING.to, base.range.asOf),
			params: { promo: SPRING.promotion, cmp: "prior_weeks" },
		};
		const { coverage, results, entries } = await answered(context);
		const call = promotionsTheme
			.followUpCalls(context, coverage, results)
			.find((planned) => planned.key === promotionsCalls.lift);
		expect(call?.args).toMatchObject({
			promotion_kind: "bill",
			comparator: "prior_weeks",
			pre_weeks: 4,
			from_date: SPRING.from,
			to_date: SPRING.to,
		});
		expect(entries.get(promotionsCalls.lift)?.length).toBeGreaterThan(1);
		const lift = buildLiftCard({ context, coverage, results });
		const caption = lift.headline.caption?.values;
		expect(lift.headline.value).toBeLessThan(0);
		expect(lift.headline.value).toBe(
			Number(caption?.gross?.value) - Number(caption?.cost?.value),
		);
		expect(lift.narrative.map((part) => part.key).slice(0, 2)).toEqual([
			promotionsKeys.lift.loss,
			promotionsKeys.lift.trend,
		]);
		expect(lift.notice).toBeNull();
		expect(
			comparatorOptions(results)?.find(
				(option) => option.value === "sister_store",
			)?.disabled,
		).toBeUndefined();
	}, 60_000);
});
