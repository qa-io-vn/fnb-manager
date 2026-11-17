import { describe, expect, it } from "vitest";
import {
	type ExportRequest,
	type ExportStore,
	MAX_EXPORT_MONTHS,
	monthOptions,
	monthsBetween,
	planExport,
} from "./plan";

const S1: ExportStore = {
	id: "11111111-1111-4111-8111-111111111111",
	label: "S1",
	name: "Cửa hàng một",
	timeZone: "Asia/Ho_Chi_Minh",
	businessDayStartMinutes: 0,
	asOf: "2026-11-15",
};

const S2: ExportStore = {
	...S1,
	id: "22222222-2222-4222-8222-222222222222",
	label: "S2",
	name: "Cửa hàng hai",
};

const S10: ExportStore = {
	...S1,
	id: "33333333-3333-4333-8333-333333333333",
	label: "S10",
	name: "Cửa hàng mười",
};

function request(overrides: Partial<ExportRequest> = {}): ExportRequest {
	return {
		stores: [S2, S1],
		firstMonth: "2026-10",
		lastMonth: "2026-11",
		tables: [
			"invoices",
			"invoice_lines",
			"invoice_payments",
			"shifts",
			"daily_summary",
		],
		format: "csv",
		dialect: "comma",
		personal: false,
		...overrides,
	};
}

describe("planning an export", () => {
	it("splits the range into store-months with the archive's fixed file order", () => {
		const result = planExport(request());
		if (!result.ok) throw new Error(result.error);
		expect(result.plan.archiveName).toBe(
			"fnb-xuat-du-lieu_2026-10_2026-11.zip",
		);
		expect(result.plan.files.map((file) => file.path)).toEqual([
			"2026-10/tong-hop-ngay.csv",
			"2026-10/S1/hoa-don.csv",
			"2026-10/S1/dong-hoa-don.csv",
			"2026-10/S1/thanh-toan.csv",
			"2026-10/S1/ca.csv",
			"2026-10/S2/hoa-don.csv",
			"2026-10/S2/dong-hoa-don.csv",
			"2026-10/S2/thanh-toan.csv",
			"2026-10/S2/ca.csv",
			"2026-11/tong-hop-ngay.csv",
			"2026-11/S1/hoa-don.csv",
			"2026-11/S1/dong-hoa-don.csv",
			"2026-11/S1/thanh-toan.csv",
			"2026-11/S1/ca.csv",
			"2026-11/S2/hoa-don.csv",
			"2026-11/S2/dong-hoa-don.csv",
			"2026-11/S2/thanh-toan.csv",
			"2026-11/S2/ca.csv",
		]);
	});

	it("ends the running month at each store's as-of day and marks it running", () => {
		const result = planExport(request({ stores: [S1] }));
		if (!result.ok) throw new Error(result.error);
		const [october, november] = result.plan.months;
		expect(october?.storeMonths[0]).toMatchObject({
			from: "2026-10-01",
			to: "2026-10-31",
			running: false,
		});
		expect(november?.storeMonths[0]).toMatchObject({
			from: "2026-11-01",
			to: "2026-11-15",
			running: true,
		});
	});

	it("leaves out a store-month before its first complete day", () => {
		const late = { ...S2, asOf: "2026-10-31" };
		const result = planExport(request({ stores: [S1, late] }));
		if (!result.ok) throw new Error(result.error);
		expect(
			result.plan.months[1]?.storeMonths.map((month) => month.store.label),
		).toEqual(["S1"]);
		expect(result.plan.months[0]?.storeMonths[1]?.running).toBe(false);
		expect(
			planExport(request({ stores: [{ ...S1, asOf: "2026-09-30" }] })),
		).toEqual({ ok: false, error: "nothing_to_export" });
	});

	it("orders stores by their label number, so S10 comes after S2", () => {
		const result = planExport(request({ stores: [S10, S2, S1] }));
		if (!result.ok) throw new Error(result.error);
		expect(result.plan.stores.map((store) => store.label)).toEqual([
			"S1",
			"S2",
			"S10",
		]);
	});

	it("allows twelve months and refuses thirteen", () => {
		expect(monthsBetween("2025-12", "2026-11")).toHaveLength(MAX_EXPORT_MONTHS);
		expect(
			planExport(request({ firstMonth: "2025-12", lastMonth: "2026-11" })).ok,
		).toBe(true);
		expect(
			planExport(request({ firstMonth: "2025-11", lastMonth: "2026-11" })),
		).toEqual({ ok: false, error: "too_many_months" });
	});

	it("refuses an empty selection, a reversed range and a malformed month", () => {
		expect(planExport(request({ stores: [] }))).toEqual({
			ok: false,
			error: "no_stores",
		});
		expect(planExport(request({ tables: [] }))).toEqual({
			ok: false,
			error: "no_tables",
		});
		expect(
			planExport(request({ firstMonth: "2026-11", lastMonth: "2026-10" })),
		).toEqual({ ok: false, error: "month_order" });
		expect(planExport(request({ firstMonth: "2026-13" }))).toEqual({
			ok: false,
			error: "invalid_month",
		});
	});

	it("writes JSON paths and skips the daily summary when it is not ticked", () => {
		const result = planExport(
			request({ format: "json", tables: ["shifts"], stores: [S1] }),
		);
		if (!result.ok) throw new Error(result.error);
		expect(result.plan.dailySummary).toBe(false);
		expect(result.plan.files.map((file) => file.path)).toEqual([
			"2026-10/S1/ca.json",
			"2026-11/S1/ca.json",
		]);
	});

	it("offers months from the earliest history start to the as-of month", () => {
		expect(monthOptions("2025-11-20", "2026-02-03")).toEqual([
			"2025-11",
			"2025-12",
			"2026-01",
			"2026-02",
		]);
		expect(monthOptions(null, "2026-02-03")).toEqual(["2026-02"]);
		expect(monthOptions("2026-03-01", "2026-02-03")).toEqual(["2026-02"]);
	});
});
