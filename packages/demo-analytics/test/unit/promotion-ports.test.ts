import { addDays, INVALID_ARGUMENTS_CODE, type ThemeArgs } from "@fnb/reports";
import { describe, expect, it } from "vitest";
import {
	createDemoReportSource,
	DemoSettingsStore,
	demoSettings,
} from "../../src/index.js";

const NOW = new Date("2026-11-04T05:30:00.000Z");
const AS_OF = "2026-11-03";

function source() {
	return createDemoReportSource({
		now: () => NOW,
		volumeScale: 0.1,
		settings: new DemoSettingsStore(demoSettings(AS_OF)),
	});
}

const lift: ThemeArgs<"promotion_lift"> = {
	store_ids: ["MOCK-S1"],
	promotion_kind: "item",
	promotion_key: "PROMO-04",
	from_date: addDays(AS_OF, -27),
	to_date: AS_OF,
	comparator: "baseline",
};

describe("the promotion ports' arguments", () => {
	it("refuse what the SQL refuses: an unknown comparator, more than 92 days, a pre-period outside 2 to 8 weeks, more than 50 stores (refused by the contract, as on the client)", async () => {
		const demo = source();
		await expect(
			demo.callTheme("promotion_lift", {
				...lift,
				comparator: "sister" as "baseline",
			}),
		).rejects.toMatchObject({ code: INVALID_ARGUMENTS_CODE });
		await expect(
			demo.callTheme("promotion_lift", {
				...lift,
				from_date: addDays(AS_OF, -92),
			}),
		).rejects.toMatchObject({ code: "22023", functionName: "promotion_lift" });
		for (const preWeeks of [1, 9]) {
			await expect(
				demo.callTheme("promotion_lift", { ...lift, pre_weeks: preWeeks }),
				String(preWeeks),
			).rejects.toMatchObject({ code: INVALID_ARGUMENTS_CODE });
		}
		await expect(
			demo.callTheme("promotion_lift", {
				...lift,
				store_ids: Array.from({ length: 51 }, () => "MOCK-S1"),
			}),
		).rejects.toMatchObject({ code: INVALID_ARGUMENTS_CODE });
		await expect(
			demo.callTheme("promotion_days", {
				store_ids: ["MOCK-S1"],
				from_date: addDays(AS_OF, -400),
				to_date: AS_OF,
			}),
		).rejects.toMatchObject({ code: "22023", functionName: "promotion_days" });
		await expect(
			demo.callTheme("promotion_days", {
				store_ids: ["MOCK-S1"],
				from_date: AS_OF,
				to_date: AS_OF,
				key_filter: "PROMO-04",
			}),
		).rejects.toMatchObject({ code: INVALID_ARGUMENTS_CODE });
	});

	it("answers nothing for an empty store list and flags a promotion no store ran", async () => {
		const demo = source();
		expect(
			await demo.callTheme("promotion_lift", { ...lift, store_ids: [] }),
		).toEqual([]);
		const rows = await demo.callTheme("promotion_lift", {
			...lift,
			promotion_key: "no-such-promotion",
			comparator: "sister_store",
		});
		expect(rows).toHaveLength(29);
		expect(rows.slice(0, -1).every((row) => row.promo_day === false)).toBe(
			true,
		);
		expect(rows.at(-1)).toMatchObject({
			business_date: null,
			test_store_count: 0,
			control_store_count: 1,
			promo_days: 0,
			measured_days: 0,
			control_days: null,
			net_lift_amount: null,
			lift_rate: null,
			flags: ["no_test_store", "few_promo_days"],
		});
	});

	it("reads the pre-period length from the tenant's report settings unless the call gives one", async () => {
		const settings = new DemoSettingsStore(demoSettings(AS_OF));
		const demo = createDemoReportSource({
			now: () => NOW,
			volumeScale: 0.1,
			settings,
		});
		const withDefault = await demo.callTheme("promotion_lift", {
			...lift,
			comparator: "prior_weeks",
		});
		settings.saveReportSettings({
			...settings.reportSettings(),
			promoPreWeeks: 2,
		});
		const withTenant = await demo.callTheme("promotion_lift", {
			...lift,
			comparator: "prior_weeks",
		});
		const withCall = await demo.callTheme("promotion_lift", {
			...lift,
			comparator: "prior_weeks",
			pre_weeks: 2,
		});
		expect(withTenant).toEqual(withCall);
		expect(withTenant).not.toEqual(withDefault);
	});
});
