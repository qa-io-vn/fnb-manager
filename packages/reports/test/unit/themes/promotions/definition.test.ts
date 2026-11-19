import { describe, expect, it } from "vitest";
import { coverageModel } from "../../../../src/model/coverage.js";
import {
	type ReportCallSpec,
	reportCallIdentity,
	type ThemeCallResults,
} from "../../../../src/themes/definition.js";
import { promotionsTheme } from "../../../../src/themes/promotions/definition.js";
import {
	liftWindow,
	promotionsCalls,
} from "../../../../src/themes/promotions/support.js";
import { themeDefinitionOf } from "../../../../src/themes/registry.js";
import { coverageRow, STORE_A, STORE_B } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import { promotionRow, settingsRow } from "./support.js";

const W92 = [
	promotionRow({
		promotion_kind: "item",
		promotion_key: "KM-01",
		discount_amount: 1_000_000,
	}),
	promotionRow({
		promotion_kind: "voucher",
		promotion_key: "Voucher 20k",
		promotion_name: "Voucher 20k",
		discount_amount: 2_000_000,
	}),
];

const SETTINGS = [settingsRow({ promo_pre_weeks: 4 })];

function results(
	rows: readonly unknown[] | undefined,
	settings: readonly unknown[] | null,
): ThemeCallResults {
	const answered: Readonly<Record<string, readonly unknown[] | undefined>> = {
		[promotionsCalls.promotionsW92]: rows,
		[promotionsCalls.settings]: settings ?? undefined,
	};
	return { rows: (key: string) => answered[key] as never };
}

function callOf(
	calls: readonly ReportCallSpec[],
	key: string,
): ReportCallSpec | undefined {
	return calls.find((call) => call.key === key);
}

function followUps(
	params: Record<string, string>,
	rows: readonly unknown[] | undefined,
	preset: "28d" | "this_year" = "28d",
	settings: readonly unknown[] | null = SETTINGS,
) {
	const context = themeContext(preset, [STORE_A, STORE_B], { params });
	return {
		context,
		calls: promotionsTheme.followUpCalls(
			context,
			coverageModel([coverageRow(STORE_A), coverageRow(STORE_B)], context),
			results(rows, settings),
		),
	};
}

describe("the Khuyến mãi theme", () => {
	it("is registered under its slug with a 28-day default, at most 400 days and seven cards", () => {
		expect(themeDefinitionOf("promotions")).toBe(promotionsTheme);
		expect(promotionsTheme.slug).toBe("khuyen-mai");
		expect(promotionsTheme.defaultPreset).toBe("28d");
		expect(promotionsTheme.maxRangeDays).toBe(400);
		expect(promotionsTheme.cards.map((card) => card.id)).toEqual([
			"discount_cost",
			"vouchers",
			"lift",
			"catalogue",
			"rule_cap",
			"rule_days",
			"redemptions",
		]);
		expect(promotionsTheme.params.map((spec) => spec.id)).toEqual([
			"promo",
			"cmp",
		]);
	});

	it("asks for the promotions of the range and of its last 92 days as one call when they are the same days", () => {
		const short = themeContext("28d", [STORE_A]);
		const calls = promotionsTheme.primaryCalls(short);
		expect(calls.map((call) => call.key)).toEqual([
			"coverage",
			"totals",
			"promotions",
			"promotionsW92",
			"series",
			"settings",
			"catalogue",
			"compliance.1",
			"discountDays",
			"discountDaysUnderRule",
			"redemptions",
			"redemptionsPrevious",
		]);
		expect(
			promotionsTheme
				.primaryCalls(themeContext("28d", [STORE_A], { sample: true }))
				.map((call) => call.key),
		).not.toContain("redemptions");
		const range = callOf(calls, "promotions");
		const window = callOf(calls, "promotionsW92");
		expect(range && window && reportCallIdentity(range)).toBe(
			window && reportCallIdentity(window),
		);
		expect(callOf(calls, "series")?.args).toMatchObject({ grain: "day" });
		const long = themeContext("this_year", [STORE_A]);
		const longCalls = promotionsTheme.primaryCalls(long);
		expect(callOf(longCalls, "promotionsW92")?.args).toEqual({
			store_ids: [STORE_A],
			from_date: liftWindow(long).from,
			to_date: long.range.to,
		});
		expect(liftWindow(long).days).toBe(92);
		expect(callOf(longCalls, "promotions")?.args).toMatchObject({
			from_date: long.range.from,
		});
		expect(callOf(longCalls, "series")?.args).toMatchObject({ grain: "week" });
	});

	it("asks for the lift of the promotion with the largest discount in the last 92 days against the same-weekday baseline by default", () => {
		const { context, calls } = followUps({}, W92, "this_year");
		expect(callOf(calls, "lift")).toEqual({
			key: "lift",
			name: "promotion_lift",
			args: {
				store_ids: [STORE_A, STORE_B],
				promotion_kind: "voucher",
				promotion_key: "Voucher 20k",
				from_date: liftWindow(context).from,
				to_date: context.range.to,
				comparator: "baseline",
				pre_weeks: 4,
			},
		});
	});

	it("passes the tenant's pre-period weeks, so the SQL and the subtitle read one value and a new value asks again", () => {
		const four = callOf(followUps({ cmp: "prior_weeks" }, W92).calls, "lift");
		const six = callOf(
			followUps({ cmp: "prior_weeks" }, W92, "28d", [
				settingsRow({ promo_pre_weeks: 6 }),
			]).calls,
			"lift",
		);
		expect(four?.args).toMatchObject({ pre_weeks: 4 });
		expect(six?.args).toMatchObject({ pre_weeks: 6 });
		expect(four && reportCallIdentity(four)).not.toBe(
			six && reportCallIdentity(six),
		);
	});

	it("asks for the chosen promotion and comparator, and for the default when the address names a promotion the window lacks", () => {
		expect(
			callOf(
				followUps({ promo: "item:KM-01", cmp: "prior_weeks" }, W92).calls,
				"lift",
			)?.args,
		).toMatchObject({
			promotion_kind: "item",
			promotion_key: "KM-01",
			comparator: "prior_weeks",
		});
		expect(
			callOf(
				followUps({ promo: "bill:gone", cmp: "sister_store" }, W92).calls,
				"lift",
			)?.args,
		).toMatchObject({
			promotion_kind: "voucher",
			promotion_key: "Voucher 20k",
			comparator: "sister_store",
		});
	});

	it("asks for no lift before the 92-day promotions and the settings have answered, or when there were no promotions", () => {
		expect(callOf(followUps({}, undefined).calls, "lift")).toBeUndefined();
		expect(callOf(followUps({}, []).calls, "lift")).toBeUndefined();
		expect(
			callOf(followUps({}, W92, "28d", null).calls, "lift"),
		).toBeUndefined();
		expect(callOf(followUps({}, W92, "28d", []).calls, "lift")).toBeUndefined();
	});
});
