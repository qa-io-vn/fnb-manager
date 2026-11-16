import { describe, expect, it } from "vitest";
import type { ThemeContext } from "../../../../src/themes/context.js";
import { themeKeys } from "../../../../src/themes/keys.js";
import {
	BLOCKING_FLAGS,
	buildLiftCard,
} from "../../../../src/themes/promotions/cards/lift.js";
import {
	LIFT_FLAGS,
	promotionsKeys,
} from "../../../../src/themes/promotions/keys.js";
import { promotionsCalls } from "../../../../src/themes/promotions/support.js";
import { coverageRow, STORE_A } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import {
	cardInput,
	type LiftRow,
	liftDay,
	liftSummaryRow,
	promotionRow,
	settingsRow,
} from "./support.js";

const W92 = [
	promotionRow({
		promotion_kind: "item",
		promotion_key: "KM-01",
		promotion_name: "Mua 2 tặng 1",
		discount_amount: 1_000_000,
	}),
	promotionRow({
		promotion_kind: "voucher",
		promotion_key: "Voucher 20k",
		promotion_name: "Voucher 20k",
		lines: null,
		discount_amount: 2_000_000,
	}),
];

const DAYS: readonly LiftRow[] = [
	liftDay("2026-10-12", { control_day: true }),
	liftDay("2026-10-20", {
		promo_day: true,
		control_day: false,
		test_gross_amount: 5_600_000,
		counterfactual_gross_amount: 5_200_000,
		gross_lift_amount: 400_000,
		discount_amount: 100_000,
	}),
	liftDay("2026-10-11", { control_day: true }),
	liftDay("2026-10-18", {
		promo_day: true,
		control_day: false,
		test_gross_amount: 5_500_000,
		counterfactual_gross_amount: 5_100_000,
		gross_lift_amount: 400_000,
		discount_amount: 100_000,
	}),
	liftDay("2026-10-19", {
		promo_day: true,
		control_day: false,
		test_gross_amount: 5_400_000,
		counterfactual_gross_amount: 5_000_000,
		gross_lift_amount: 400_000,
		discount_amount: 100_000,
	}),
];

const DAYS_WITHOUT: readonly LiftRow[] = [
	"2026-10-01",
	"2026-10-02",
	"2026-10-03",
	"2026-10-04",
	"2026-10-05",
	"2026-10-06",
	"2026-10-07",
].map((date) => liftDay(date, { control_day: true }));

function build(
	summary: LiftRow | null,
	params: Record<string, string> = {},
	extra: Record<string, readonly unknown[]> = {},
	context: ThemeContext = themeContext("28d", [STORE_A], { params }),
	days: readonly LiftRow[] = DAYS,
) {
	return buildLiftCard(
		cardInput(
			context,
			{
				[promotionsCalls.promotionsW92]: W92,
				[promotionsCalls.lift]: summary === null ? [] : [...days, summary],
				...extra,
			},
			[coverageRow(STORE_A)],
		),
	);
}

function moneyOf(value: { kind: string; value: unknown } | undefined): number {
	return typeof value?.value === "number" ? value.value : Number.NaN;
}

function definitionOf(card: ReturnType<typeof build>) {
	const value = card.subtitle?.values.definition;
	return value?.kind === "part" ? value.value : null;
}

describe("the Khuyến mãi lift card", () => {
	it("shows the net lift as signed money with the gross lift and the discount cost, under the default promotion and comparator", () => {
		const card = build(liftSummaryRow({ flags: ["other_promotions"] }));
		expect(card.id).toBe("lift");
		expect(card.metricId).toBe("promo_net_lift");
		expect(card.relatedMetricIds).toEqual(["promo_lift"]);
		expect(card.headline.value).toBe(900_000);
		expect(card.headline.unit).toBe("signedMoney");
		expect(card.headline.caption).toEqual({
			key: promotionsKeys.lift.caption,
			values: {
				gross: { kind: "moneySigned", value: 1_200_000 },
				cost: { kind: "money", value: 300_000 },
			},
		});
		const caption = card.headline.caption?.values;
		expect(card.headline.value).toBe(
			moneyOf(caption?.gross) - moneyOf(caption?.cost),
		);
		expect(card.narrative.map((part) => part.key)).toEqual([
			promotionsKeys.lift.gain,
			promotionsKeys.lift.trend,
			promotionsKeys.lift.flag.other_promotions,
		]);
		expect(card.narrative[0]?.values).toEqual({
			promotion: {
				kind: "part",
				value: {
					key: promotionsKeys.lift.option,
					values: {
						name: { kind: "text", value: "Voucher 20k" },
						kind: { kind: "message", value: "report.promotionKind.voucher" },
					},
				},
			},
			net: { kind: "money", value: 900_000 },
			gross: { kind: "moneySigned", value: 1_200_000 },
			cost: { kind: "money", value: 300_000 },
			days: { kind: "count", value: 3 },
		});
		expect(card.narrative[1]?.values).toEqual({
			amount: { kind: "moneySigned", value: 150_000 },
			days: { kind: "count", value: 9 },
		});
		expect(card.subtitle?.key).toBe(promotionsKeys.lift.subtitle);
		expect(card.subtitle?.values.days).toEqual({ kind: "count", value: 28 });
		expect(definitionOf(card)).toEqual({
			key: promotionsKeys.lift.definition.baseline,
			values: { weeks: { kind: "count", value: 8 } },
		});
		expect(card.comparisons).toEqual([]);
		expect(card.notice).toBeNull();
		expect(card.markers.verification).toBe("verified");
	});

	it("lists the promotion days first, then the other days, each by date, and draws gross bars against the expected line", () => {
		const card = build(liftSummaryRow());
		const table = card.tables[0];
		expect(table?.rows.map((row) => row.id)).toEqual([
			"2026-10-18",
			"2026-10-19",
			"2026-10-20",
			"2026-10-11",
			"2026-10-12",
		]);
		expect(table?.columns.map((column) => [column.key, column.kind])).toEqual([
			["date", "date"],
			["promotionDay", "message"],
			["controlDay", "message"],
			["gross", "money"],
			["reference", "money"],
			["counterfactual", "money"],
			["lift", "money"],
			["discount", "money"],
		]);
		expect(table?.rows[0]?.cells).toEqual({
			date: "2026-10-18",
			promotionDay: promotionsKeys.lift.yes,
			controlDay: promotionsKeys.lift.no,
			gross: 5_500_000,
			reference: 4_800_000,
			counterfactual: 5_100_000,
			lift: 400_000,
			discount: 100_000,
		});
		expect(table?.initialSort).toBeNull();
		expect(card.chart?.categories.map((category) => category.value)).toEqual([
			"2026-10-18",
			"2026-10-19",
			"2026-10-20",
		]);
		expect(
			card.chart?.series.map((series) => [series.kind, series.values]),
		).toEqual([
			["bar", [5_500_000, 5_400_000, 5_600_000]],
			["line", [5_100_000, 5_000_000, 5_200_000]],
		]);
	});

	it("reports a loss against the weeks before the promotion, with the tenant's weeks in the subtitle", () => {
		const card = build(
			liftSummaryRow({
				gross_lift_amount: 100_000,
				discount_amount: 400_000,
				net_lift_amount: -300_000,
			}),
			{ promo: "item:KM-01", cmp: "prior_weeks" },
			{
				[promotionsCalls.settings]: [settingsRow({ promo_pre_weeks: 6 })],
			},
		);
		expect(card.headline.value).toBe(-300_000);
		expect(card.narrative[0]?.key).toBe(promotionsKeys.lift.loss);
		expect(card.narrative[0]?.values.net).toEqual({
			kind: "money",
			value: 300_000,
		});
		expect(card.narrative[0]?.values.promotion).toMatchObject({
			value: { values: { name: { value: "Mua 2 tặng 1" } } },
		});
		expect(definitionOf(card)).toEqual({
			key: promotionsKeys.lift.definition.prior_weeks,
			values: { weeks: { kind: "count", value: 6 } },
		});
	});

	it("names the sister store as the control and adds no trend sentence when none applied", () => {
		const card = build(
			liftSummaryRow({
				trend_adjustment_amount: null,
				control_days: null,
				control_store_count: 1,
				flags: ["control_differs_in_size"],
			}),
			{ cmp: "sister_store" },
		);
		expect(card.narrative.map((part) => part.key)).toEqual([
			promotionsKeys.lift.gain,
			promotionsKeys.lift.flag.control_differs_in_size,
		]);
		expect(definitionOf(card)).toEqual({
			key: promotionsKeys.lift.definition.sister_store,
			values: { weeks: { kind: "count", value: 4 } },
		});
	});

	it("shows a dash with the reason and what to try when too few days went without the promotion, never a before-and-after figure", () => {
		const unmeasured = liftSummaryRow({
			gross_lift_amount: null,
			discount_amount: null,
			net_lift_amount: null,
			measured_days: 0,
			control_days: 2,
			trend_adjustment_amount: null,
			control_store_count: 1,
			flags: ["few_control_days", "few_reference_days", "unmeasured_days"],
		});
		const card = build(unmeasured);
		expect(card.headline.value).toBeNull();
		expect(card.headline.caption).toBeNull();
		expect(card.notice).toEqual({
			tone: "warning",
			part: { key: promotionsKeys.lift.flag.few_control_days, values: {} },
			action: null,
		});
		expect(card.narrative.map((part) => part.key)).toEqual([
			promotionsKeys.lift.notMeasured,
			promotionsKeys.lift.flag.few_reference_days,
		]);
		const alone = build({ ...unmeasured, control_store_count: 0 });
		expect(alone.notice?.part.key).toBe(
			promotionsKeys.lift.flagNoStore.few_control_days,
		);
	});

	it("keeps the dash even if a lift came back alongside a blocking flag", () => {
		const card = build(liftSummaryRow({ flags: ["few_control_days"] }));
		expect(card.headline.value).toBeNull();
		expect(card.headline.caption).toBeNull();
		expect(card.notice?.part.key).toBe(
			promotionsKeys.lift.flagNoStore.few_control_days,
		);
	});

	it("sends a sister-store reader to the weeks before only when the range has days without the promotion", () => {
		const noStore = liftSummaryRow({
			gross_lift_amount: null,
			discount_amount: null,
			net_lift_amount: null,
			measured_days: 0,
			control_days: null,
			trend_adjustment_amount: null,
			flags: ["no_control_store"],
		});
		const daily = build(noStore, { cmp: "sister_store" });
		expect(daily.notice?.part.key).toBe(
			promotionsKeys.lift.flagDaily.no_control_store,
		);
		const withDays = build(
			noStore,
			{ cmp: "sister_store" },
			{},
			themeContext("28d", [STORE_A], { params: { cmp: "sister_store" } }),
			[...DAYS, ...DAYS_WITHOUT],
		);
		expect(withDays.notice?.part.key).toBe(
			promotionsKeys.lift.flag.no_control_store,
		);
	});

	it("explains a store selection that never used the promotion with a notice", () => {
		const card = build(
			liftSummaryRow({
				gross_lift_amount: null,
				discount_amount: null,
				net_lift_amount: null,
				test_store_count: 0,
				promo_days: 0,
				measured_days: 0,
				flags: ["no_test_store", "few_promo_days"],
			}),
		);
		expect(card.headline.value).toBeNull();
		expect(card.notice?.part.key).toBe(promotionsKeys.lift.flag.no_test_store);
		expect(card.narrative.map((part) => part.key)).toEqual([
			promotionsKeys.lift.notMeasured,
			promotionsKeys.lift.flag.few_promo_days,
		]);
	});

	it("says there is nothing to measure when no promotion ran in the last 92 days", () => {
		const card = build(null, {}, { [promotionsCalls.promotionsW92]: [] });
		expect(card.headline.value).toBeNull();
		expect(card.subtitle).toEqual({
			key: themeKeys.subtitle.lastDays,
			values: { days: { kind: "count", value: 28 } },
		});
		expect(card.narrative.map((part) => part.key)).toEqual([
			promotionsKeys.lift.none,
		]);
		expect(card.notice).toEqual({
			tone: "info",
			part: { key: promotionsKeys.lift.noneNotice, values: {} },
			action: null,
		});
		expect(card.tables).toEqual([]);
		expect(card.chart).toBeNull();
	});

	it("names the last 92 days of a longer range in its subtitle", () => {
		const card = build(
			liftSummaryRow(),
			{},
			{},
			themeContext("this_year", [STORE_A]),
		);
		expect(card.subtitle?.values.days).toEqual({ kind: "count", value: 92 });
	});

	it("gives every flag a sentence, the blocking ones as a notice", () => {
		expect(BLOCKING_FLAGS).toEqual([
			"no_test_store",
			"no_control_store",
			"few_control_days",
		]);
		for (const flag of LIFT_FLAGS) {
			const card = build(
				liftSummaryRow({ flags: [flag], control_store_count: 1 }),
				{},
				{},
				themeContext("28d", [STORE_A]),
				[...DAYS, ...DAYS_WITHOUT],
			);
			if (BLOCKING_FLAGS.includes(flag)) {
				expect(card.notice?.part.key, flag).toBe(
					promotionsKeys.lift.flag[flag],
				);
				expect(card.headline.value, flag).toBeNull();
			} else {
				expect(card.narrative.at(-1)?.key, flag).toBe(
					promotionsKeys.lift.flag[flag],
				);
				expect(card.notice, flag).toBeNull();
			}
		}
	});

	it("ignores a flag it does not know rather than showing a raw key", () => {
		const card = build(
			liftSummaryRow({
				trend_adjustment_amount: null,
				flags: ["something_new"],
			}),
		);
		expect(card.narrative.map((part) => part.key)).toEqual([
			promotionsKeys.lift.gain,
		]);
	});
});
