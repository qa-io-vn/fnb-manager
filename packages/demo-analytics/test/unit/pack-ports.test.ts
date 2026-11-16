import { describe, expect, it } from "vitest";
import {
	createDemoReportSource,
	DemoSettingsStore,
	demoSettings,
	themeReads,
} from "../../src/index.js";

const NOW = new Date("2026-11-04T05:30:00.000Z");
const AS_OF = "2026-11-03";
const STORES = ["MOCK-S1", "MOCK-S2"];

function source(settings = new DemoSettingsStore(demoSettings(AS_OF))) {
	return createDemoReportSource({
		now: () => NOW,
		volumeScale: 0.2,
		validateRows: true,
		settings,
	});
}

describe("the demo ports of the data pack functions", () => {
	it("store_profiles labels the demo stores in their order, keeps the order asked and repeats no store", async () => {
		const rows = await source().callTheme("store_profiles", {
			store_ids: ["MOCK-S2", "MOCK-X", "MOCK-S1", "MOCK-S2"],
		});
		expect(rows.map((row) => [row.store_id, row.label])).toEqual([
			["MOCK-S2", "S2"],
			["MOCK-S1", "S1"],
		]);
		expect(rows[1]).toMatchObject({
			timezone: "Asia/Ho_Chi_Minh",
			business_day_start_minutes: 0,
			seat_count: 40,
			e_invoice_status: "configured",
			currency_code: "VND",
			country_code: "VN",
		});
		expect(rows[1]?.opening_hours?.mon).toEqual([["07:00", "22:30"]]);
		expect(rows[0]?.opening_hours).toBeNull();
	});

	it("metric_windows answers range by range and id by id from the metric_value port", async () => {
		const demo = source();
		const rows = await demo.callTheme("metric_windows", {
			store_ids: STORES,
			metric_ids: ["invoices", "net_revenue"],
			from_dates: ["2026-10-07", "2026-09-09"],
			to_dates: [AS_OF, "2026-10-06"],
		});
		expect(
			rows.map((row) => [row.range_index, row.from_date, row.metric_id]),
		).toEqual([
			[1, "2026-10-07", "invoices"],
			[1, "2026-10-07", "net_revenue"],
			[2, "2026-09-09", "invoices"],
			[2, "2026-09-09", "net_revenue"],
		]);
		expect(rows.every((row) => typeof row.value === "number")).toBe(true);
		expect(demo.aggregates.misses()).toBe(0);
	});

	it("metric_windows refuses what the SQL refuses with 22023, and answers nothing for no store", async () => {
		const demo = source();
		const base = {
			store_ids: STORES,
			metric_ids: ["net_revenue"],
			from_dates: ["2026-10-07"],
			to_dates: [AS_OF],
		};
		for (const args of [
			{ ...base, to_dates: [AS_OF, AS_OF] },
			{ ...base, from_dates: ["2026-11-04"] },
			{ ...base, from_dates: ["2025-09-28"] },
			{ ...base, metric_ids: ["net_revenue", "net_sales"] },
		]) {
			await expect(
				demo.callTheme("metric_windows", args),
			).rejects.toMatchObject({ code: "22023" });
		}
		expect(
			await demo.callTheme("metric_windows", {
				...base,
				store_ids: [],
				metric_ids: ["net_sales"],
			}),
		).toEqual([]);
		expect(
			themeReads.metric_windows({ ...base, from_dates: ["2025-09-28"] }),
		).toEqual([]);
		expect(themeReads.metric_windows(base)).toEqual([
			{ storeIds: STORES, from: "2026-10-06", to: AS_OF },
		]);
	});

	it("holiday_calendar gives the country's days and the tenant's own once each, by date then name in byte order", async () => {
		const settings = new DemoSettingsStore(demoSettings(AS_OF));
		settings.saveHolidays([
			{
				countryCode: "VN",
				holidayDate: "2026-12-24",
				name: "Đêm Giáng sinh",
				kind: "custom",
			},
			{
				countryCode: "VN",
				holidayDate: "2026-12-24",
				name: "Anniversary",
				kind: "custom",
			},
		]);
		const demo = source(settings);
		const rows = await demo.callTheme("holiday_calendar", {
			store_ids: STORES,
			from_date: "2026-12-01",
			to_date: "2026-12-31",
		});
		expect(rows).toEqual([
			{ holiday_date: "2026-12-24", name: "Anniversary", kind: "custom" },
			{ holiday_date: "2026-12-24", name: "Đêm Giáng sinh", kind: "custom" },
		]);
		expect(
			await demo.callTheme("holiday_calendar", {
				store_ids: ["MOCK-X"],
				from_date: "2026-12-01",
				to_date: "2026-12-31",
			}),
		).toEqual([]);
		await expect(
			demo.callTheme("holiday_calendar", {
				store_ids: STORES,
				from_date: "2026-01-01",
				to_date: "2027-02-05",
			}),
		).rejects.toMatchObject({ code: "22023" });
	});

	it("plan_kpi_review answers no plan in the demo and reads no day", async () => {
		const demo = source();
		expect(
			await demo.callTheme("plan_kpi_review", {
				store_ids: STORES,
				as_of_date: AS_OF,
			}),
		).toEqual([]);
		expect(
			themeReads.plan_kpi_review({ store_ids: STORES, as_of_date: AS_OF }),
		).toEqual([]);
		expect(themeReads.store_profiles({ store_ids: STORES })).toEqual([]);
	});
});
