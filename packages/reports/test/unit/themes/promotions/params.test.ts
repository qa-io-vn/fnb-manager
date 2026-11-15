import { describe, expect, it } from "vitest";
import {
	parseThemeParams,
	type ThemeParamSpec,
	themeParamOptions,
	themeParamsOfCard,
} from "../../../../src/themes/context.js";
import type { ThemeCallResults } from "../../../../src/themes/definition.js";
import {
	COMPARATOR_PARAM,
	chosenPromotion,
	LIFT_CARD_ID,
	PROMOTION_PARAM,
	PROMOTIONS_W92_CALL_KEY,
	parsePromotionParam,
	promotionOptions,
	promotionParams,
	promotionParamValue,
} from "../../../../src/themes/promotions/params.js";

function resultsWith(rows: readonly unknown[] | undefined): ThemeCallResults {
	return {
		rows: (key: string) =>
			key === PROMOTIONS_W92_CALL_KEY ? (rows as never) : undefined,
	};
}

const SUMMARY = [
	{
		promotion_kind: "bill",
		promotion_key: "unnamed",
		promotion_name: null,
		invoices: 3,
		lines: null,
		discount_amount: 90_000,
		first_used_on: "2026-09-02",
		last_used_on: "2026-10-30",
		days_used: 3,
	},
	{
		promotion_kind: "voucher",
		promotion_key: "Giảm 20k",
		promotion_name: "Giảm 20k",
		invoices: 21,
		lines: null,
		discount_amount: 410_000,
		first_used_on: "2026-08-10",
		last_used_on: "2026-11-01",
		days_used: 19,
	},
	{
		promotion_kind: "item",
		promotion_key: "KM-01",
		promotion_name: "Mua 2 tặng 1",
		invoices: 30,
		lines: 33,
		discount_amount: 410_000,
		first_used_on: "2026-08-04",
		last_used_on: "2026-11-02",
		days_used: 22,
	},
];

function spec(id: string): ThemeParamSpec {
	const found = promotionParams.find((entry) => entry.id === id);
	if (found === undefined) throw new Error(`no parameter ${id}`);
	return found;
}

describe("the promotion parameter", () => {
	it("joins a kind and a key and reads them back, the key kept whole", () => {
		const value = promotionParamValue({ kind: "voucher", key: "Mã: VIP 10%" });
		expect(value).toBe("voucher:Mã: VIP 10%");
		expect(parsePromotionParam(value)).toEqual({
			kind: "voucher",
			key: "Mã: VIP 10%",
		});
		expect(parsePromotionParam("item:KM-01")).toEqual({
			kind: "item",
			key: "KM-01",
		});
	});

	it("refuses a value without a known kind or without a key", () => {
		for (const value of ["", "KM-01", ":KM-01", "item:", "combo:KM-01"]) {
			expect(parsePromotionParam(value), value).toBeNull();
		}
	});

	it("offers the promotions of the 92-day call, the largest discount first, named with their kind, an unnamed one by its kind", () => {
		expect(promotionOptions(resultsWith(SUMMARY as never))).toEqual([
			{
				value: "item:KM-01",
				labelKey: "theme.promotions.lift.option",
				labelValues: {
					name: { text: "Mua 2 tặng 1" },
					kind: { key: "report.promotionKind.item" },
				},
			},
			{
				value: "voucher:Giảm 20k",
				labelKey: "theme.promotions.lift.option",
				labelValues: {
					name: { text: "Giảm 20k" },
					kind: { key: "report.promotionKind.voucher" },
				},
			},
			{
				value: "bill:unnamed",
				labelKey: "theme.promotions.lift.optionUnnamed",
				labelValues: { kind: { key: "report.promotionKind.bill" } },
			},
		]);
		expect(promotionOptions(resultsWith([]))).toEqual([]);
		expect(promotionOptions(resultsWith(undefined))).toBeNull();
	});

	it("breaks a tie between equal discounts by kind and key in code-point order, whatever the reader's language", () => {
		const tied = [
			{
				...SUMMARY[1],
				promotion_kind: "item",
				promotion_key: "b",
				promotion_name: "B",
			},
			{
				...SUMMARY[1],
				promotion_kind: "item",
				promotion_key: "Z",
				promotion_name: "Z",
			},
			{
				...SUMMARY[1],
				promotion_kind: "bill",
				promotion_key: "a",
				promotion_name: "A",
			},
		];
		expect(
			promotionOptions(resultsWith(tied as never))?.map(
				(option) => option.value,
			),
		).toEqual(["bill:a", "item:Z", "item:b"]);
	});

	it("names a key without a POS name by its key", () => {
		const keyed = [
			{ ...SUMMARY[0], promotion_key: "GIAM10", promotion_name: null },
		];
		expect(promotionOptions(resultsWith(keyed as never))?.[0]).toEqual({
			value: "bill:GIAM10",
			labelKey: "theme.promotions.lift.option",
			labelValues: {
				name: { text: "GIAM10" },
				kind: { key: "report.promotionKind.bill" },
			},
		});
	});

	it("chooses the promotion asked for while it is offered, the first offered otherwise, and none without promotions", () => {
		const options = promotionOptions(resultsWith(SUMMARY as never)) ?? [];
		expect(chosenPromotion("bill:unnamed", options)).toEqual({
			kind: "bill",
			key: "unnamed",
		});
		expect(chosenPromotion("", options)).toEqual({
			kind: "item",
			key: "KM-01",
		});
		expect(chosenPromotion("item:gone", options)).toEqual({
			kind: "item",
			key: "KM-01",
		});
		expect(chosenPromotion("item:KM-01", [])).toBeNull();
		const firstDisabled = options.map((option, index) =>
			index === 0 ? { ...option, disabled: true } : option,
		);
		expect(chosenPromotion("item:KM-01", firstDisabled)).toEqual({
			kind: "voucher",
			key: "Giảm 20k",
		});
	});
});

describe("the Khuyến mãi parameters", () => {
	it("belong to the lift card, the promotion as a select and the comparator as a radio group", () => {
		expect(
			themeParamsOfCard(promotionParams, LIFT_CARD_ID).map((entry) => [
				entry.id,
				entry.control,
				entry.defaultValue,
			]),
		).toEqual([
			[PROMOTION_PARAM, "select", ""],
			[COMPARATOR_PARAM, "radio", "baseline"],
		]);
		expect(themeParamsOfCard(promotionParams, "discount_cost")).toEqual([]);
		expect(
			spec(COMPARATOR_PARAM).options.map((option) => option.value),
		).toEqual(["baseline", "prior_weeks", "sister_store"]);
	});

	it("keep values they can read and fall back to their defaults otherwise", () => {
		expect(
			parseThemeParams(promotionParams, {
				promo: "item:KM-01",
				cmp: "prior_weeks",
			}),
		).toEqual({ promo: "item:KM-01", cmp: "prior_weeks" });
		expect(
			parseThemeParams(promotionParams, {
				promo: "combo:KM-01",
				cmp: "sister",
			}),
		).toEqual({ promo: "", cmp: "baseline" });
		expect(parseThemeParams(promotionParams, {})).toEqual({
			promo: "",
			cmp: "baseline",
		});
		const withDisabled = promotionParams.map((entry) =>
			entry.id === COMPARATOR_PARAM
				? {
						...entry,
						options: entry.options.map((option) =>
							option.value === "sister_store"
								? { ...option, disabled: true }
								: option,
						),
					}
				: entry,
		);
		expect(parseThemeParams(withDisabled, { cmp: "sister_store" })).toEqual({
			promo: "",
			cmp: "baseline",
		});
	});

	it("take fixed options as they are and the promotion's options from the answered call only", () => {
		const comparator = spec(COMPARATOR_PARAM);
		expect(themeParamOptions(comparator, null)).toBe(comparator.options);
		const promotion = spec(PROMOTION_PARAM);
		expect(themeParamOptions(promotion, null)).toBeNull();
		expect(themeParamOptions(promotion, resultsWith(undefined))).toBeNull();
		expect(
			themeParamOptions(promotion, resultsWith(SUMMARY as never))?.[0],
		).toMatchObject({ value: "item:KM-01" });
	});
});
