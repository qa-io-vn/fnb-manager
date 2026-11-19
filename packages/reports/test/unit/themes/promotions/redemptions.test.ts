import { describe, expect, it } from "vitest";
import { themeFunctions } from "../../../../src/themes/contract.js";
import {
	buildRedemptionsCard,
	mostRedeemed,
	type RedemptionRow,
	redemptionTotals,
	rewardTotals,
} from "../../../../src/themes/promotions/cards/redemptions.js";
import { promotionsTheme } from "../../../../src/themes/promotions/definition.js";
import { promotionsKeys } from "../../../../src/themes/promotions/keys.js";
import {
	promotionsCalls,
	redemptionWindows,
} from "../../../../src/themes/promotions/support.js";
import { coverageRow, STORE_A, STORE_B } from "../../fixtures.js";
import { themeContext } from "../fixtures.js";
import { cardInput } from "./support.js";

const FREE_DRINK = "55555555-5555-4555-8555-555555555555";
const BILL_OFF = "66666666-6666-4666-8666-666666666666";

function redemption(overrides: Partial<RedemptionRow>): RedemptionRow {
	return {
		store_id: STORE_A,
		coupon_id: FREE_DRINK,
		reward_key: "ly-mien-phi",
		coupon_name: "Ly trà miễn phí",
		reward_kind: "free_item",
		redemptions: 4,
		held: 1,
		confirmed: 2,
		released: 1,
		stamps_redeemed: 16,
		points_redeemed: 0,
		reward_cost_amount: 0,
		member_invoices: 40,
		confirmed_share: 0.05,
		...overrides,
	};
}

const ROWS: readonly RedemptionRow[] = [
	redemption({}),
	redemption({
		coupon_id: BILL_OFF,
		reward_key: "giam-20",
		coupon_name: "Giảm 20% hóa đơn",
		reward_kind: "percent_off",
		redemptions: 3,
		held: 0,
		confirmed: 3,
		released: 0,
		stamps_redeemed: 0,
		points_redeemed: 900,
		reward_cost_amount: 45_000,
		confirmed_share: 0.075,
	}),
	redemption({
		store_id: STORE_B,
		redemptions: 2,
		held: 0,
		confirmed: 2,
		released: 0,
		stamps_redeemed: 16,
		member_invoices: 10,
		confirmed_share: 0.2,
	}),
];

describe("the redemption analytics card", () => {
	it("reads the rows of redemption_summary as its contract parses them from PostgREST", () => {
		const parsed = themeFunctions.redemption_summary.row.parse({
			...redemption({}),
			redemptions: "4",
			reward_cost_amount: "45000.00",
			confirmed_share: "0.0500",
		});
		expect(parsed).toMatchObject({
			redemptions: 4,
			reward_cost_amount: 45_000,
			confirmed_share: 0.05,
		});
		expect(
			themeFunctions.redemption_summary.args.safeParse({
				store_ids: [STORE_A],
				from_date: "2026-10-10",
				to_date: "2026-11-06",
			}).success,
		).toBe(true);
	});

	it("totals redemptions and reward cost, counts each store's member invoices once and names the most redeemed reward", () => {
		expect(redemptionTotals(ROWS)).toEqual({
			redemptions: 9,
			held: 1,
			confirmed: 7,
			released: 1,
			stamps: 32,
			points: 900,
			cost: 45_000,
			memberInvoices: 50,
			confirmedShare: 0.14,
		});
		expect(
			rewardTotals(ROWS).map((row) => [row.name, row.redemptions]),
		).toEqual([
			["Ly trà miễn phí", 6],
			["Giảm 20% hóa đơn", 3],
		]);
		expect(mostRedeemed(ROWS)?.couponId).toBe(FREE_DRINK);
		expect(mostRedeemed([])).toBeNull();
	});

	it("equals redemption_summary: headline the reward cost, a chip against the previous range, the most redeemed reward, a chart by reward and the rows by reward and store", () => {
		const context = themeContext("28d", [STORE_A, STORE_B]);
		const card = buildRedemptionsCard(
			cardInput(
				context,
				{
					[promotionsCalls.redemptions]: ROWS,
					[promotionsCalls.redemptionsPrevious]: [
						redemption({ reward_cost_amount: 30_000 }),
					],
				},
				[coverageRow(STORE_A), coverageRow(STORE_B)],
			),
		);
		expect(card.id).toBe("redemptions");
		expect(card.metricId).toBe("reward_cost");
		expect(card.headline).toEqual({
			value: 45_000,
			unit: "money",
			caption: null,
		});
		expect(card.subtitle).toBeNull();
		expect(
			card.comparisons.map((entry) => [
				entry.kind,
				entry.reference,
				entry.difference,
				entry.unit,
				entry.range,
			]),
		).toEqual([["previous", 30_000, 15_000, "money", context.range.previous]]);
		expect(card.narrative.map((part) => part.key)).toEqual([
			promotionsKeys.redemptions.main,
			promotionsKeys.redemptions.top,
			promotionsKeys.redemptions.share,
		]);
		expect(card.narrative[0]?.values).toMatchObject({
			redemptions: { kind: "count", value: 9 },
			confirmed: { kind: "count", value: 7 },
			cost: { kind: "money", value: 45_000 },
		});
		expect(card.narrative[1]?.values).toEqual({
			reward: { kind: "text", value: "Ly trà miễn phí" },
			redemptions: { kind: "count", value: 6 },
			kind: {
				kind: "message",
				value: promotionsKeys.redemptions.rewardKind.free_item,
			},
		});
		expect(card.narrative[2]?.values).toEqual({
			share: { kind: "percent", value: 0.14 },
			confirmed: { kind: "count", value: 7 },
			invoices: { kind: "count", value: 50 },
		});
		expect(card.chart?.categories.map((entry) => entry.value)).toEqual([
			"Ly trà miễn phí",
			"Giảm 20% hóa đơn",
		]);
		expect(card.chart?.series.map((series) => series.values)).toEqual([
			[4, 3],
			[1, 0],
			[1, 0],
		]);
		const [table] = card.tables;
		expect(table?.columns.map((entry) => entry.key)).toContain("store");
		expect(table?.rows.map((row) => row.cells)).toEqual(
			ROWS.map((row) => ({
				reward: row.coupon_name,
				store: row.store_id === STORE_A ? "Store 1" : "Store 2",
				kind: promotionsKeys.redemptions.rewardKind[row.reward_kind],
				redemptions: row.redemptions,
				confirmed: row.confirmed,
				held: row.held,
				released: row.released,
				stamps: row.stamps_redeemed,
				points: row.points_redeemed,
				cost: row.reward_cost_amount,
				memberInvoices: row.member_invoices,
				confirmedShare: row.confirmed_share,
			})),
		);
		expect(card.csvName).toBe(`khuyen-mai-redemptions-${context.range.key}`);
	});

	it("says no reward was redeemed with a zero cost when the range has none, and drops the store column for one store", () => {
		const context = themeContext("28d", [STORE_A]);
		const card = buildRedemptionsCard(
			cardInput(context, {
				[promotionsCalls.redemptions]: [],
				[promotionsCalls.redemptionsPrevious]: [],
			}),
		);
		expect(card.headline.value).toBe(0);
		expect(card.narrative.map((part) => part.key)).toEqual([
			promotionsKeys.redemptions.none,
		]);
		expect(card.tables).toEqual([]);
		expect(card.chart).toBeNull();
		const one = buildRedemptionsCard(
			cardInput(context, { [promotionsCalls.redemptions]: [ROWS[0]] }),
		);
		expect(one.tables[0]?.columns.map((entry) => entry.key)).not.toContain(
			"store",
		);
	});

	it("shows the plain state in the demo, never zeros, and asks for nothing", () => {
		const context = themeContext("28d", [STORE_A], { sample: true });
		expect(
			promotionsTheme.primaryCalls(context).map((call) => call.name),
		).not.toContain("redemption_summary");
		const card = buildRedemptionsCard(cardInput(context, {}));
		expect(card.headline).toEqual({
			value: null,
			unit: "money",
			caption: null,
		});
		expect(card.comparisons).toEqual([]);
		expect(card.narrative).toEqual([
			{ key: promotionsKeys.redemptions.demo, values: {} },
		]);
		expect(card.tables).toEqual([]);
		expect(card.chart).toBeNull();
	});

	it("reads at most the last 92 days of a longer range against the 92 days before, as the function allows", () => {
		const context = themeContext("this_year", [STORE_A]);
		const windows = redemptionWindows(context);
		expect(windows.clipped).toBe(true);
		expect(windows.current).toEqual({
			from: "2026-08-07",
			to: "2026-11-06",
			days: 92,
		});
		expect(windows.previous).toEqual({ from: "2026-05-07", to: "2026-08-06" });
		const calls = promotionsTheme.primaryCalls(context);
		expect(
			calls
				.filter((call) => call.name === "redemption_summary")
				.map((call) => call.args),
		).toEqual([
			{ store_ids: [STORE_A], from_date: "2026-08-07", to_date: "2026-11-06" },
			{ store_ids: [STORE_A], from_date: "2026-05-07", to_date: "2026-08-06" },
		]);
		const card = buildRedemptionsCard(
			cardInput(context, { [promotionsCalls.redemptions]: [ROWS[0]] }),
		);
		expect(card.subtitle).toEqual({
			key: "theme.subtitle.lastDays",
			values: { days: { kind: "count", value: 92 } },
		});
		expect(card.comparisons[0]?.label).toEqual({
			key: "theme.compare.previousDays",
			values: { days: { kind: "count", value: 92 } },
		});
		const short = themeContext("28d", [STORE_A]);
		expect(redemptionWindows(short)).toEqual({
			current: { from: short.range.from, to: short.range.to, days: 28 },
			previous: short.range.previous,
			clipped: false,
		});
	});
});
