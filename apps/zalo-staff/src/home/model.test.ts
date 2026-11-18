import { STAND_IN_STORES } from "@fnb/zalo-mini";
import { describe, expect, it } from "vitest";
import {
	brandStores,
	homeCards,
	hoursOn,
	memberStores,
	readOpeningHours,
	revenueAccess,
	storeDays,
	weekdayOf,
} from "./model";
import { SAMPLE_STORES } from "./sample";

describe("the home's revenue access", () => {
	it("gives owners, managers and viewers every card whatever the staff level", () => {
		for (const role of ["owner", "manager", "viewer"] as const) {
			for (const level of ["all", "store_totals", "none"] as const) {
				expect(revenueAccess(role, level)).toBe("all");
			}
		}
	});

	it("follows the tenant's staff_revenue_visibility for staff and shows publishers no revenue", () => {
		expect(revenueAccess("staff", "all")).toBe("all");
		expect(revenueAccess("staff", "store_totals")).toBe("store_totals");
		expect(revenueAccess("staff", "none")).toBe("none");
		expect(revenueAccess("publisher", "all")).toBe("none");
	});

	it("chooses the cards of each level", () => {
		expect(homeCards("all")).toEqual([
			"net-revenue",
			"invoices",
			"yesterday",
			"opening-hours",
		]);
		expect(homeCards("store_totals")).toEqual([
			"net-revenue",
			"invoices",
			"opening-hours",
		]);
		expect(homeCards("none")).toEqual(["opening-hours"]);
	});
});

describe("the home's stores and days", () => {
	it("keeps only the stores of the app's brand that the session names", () => {
		const stores = [{ name: "A" }, { name: "B" }, { name: "C" }];
		expect(brandStores(stores, ["C", "A"])).toEqual([
			{ name: "A" },
			{ name: "C" },
		]);
		expect(brandStores(stores, [])).toEqual([]);
	});

	it("picks the member's stores by id, whatever their names", () => {
		const stores = [
			{ id: "a", name: "A" },
			{ id: "b", name: "Same" },
			{ id: "c", name: "Same" },
		];
		expect(memberStores(stores, ["c", "a"], ["Same", "A"])).toEqual([
			{ id: "a", name: "A" },
			{ id: "c", name: "Same" },
		]);
		expect(memberStores(stores, [], ["A"])).toEqual([]);
	});

	it("samples the stand-in's stores, so the stand-in session's ids find them", () => {
		expect(
			SAMPLE_STORES.map((store) => ({ id: store.id, name: store.name })),
		).toEqual(STAND_IN_STORES);
	});

	it("matches names only for a session minted before the store ids", () => {
		const stores = [
			{ id: "a", name: "A" },
			{ id: "b", name: "B" },
		];
		expect(memberStores(stores, null, ["B"])).toEqual([{ id: "b", name: "B" }]);
	});

	it("counts the business day from each store's day start, as the database does", () => {
		const night = new Date("2026-11-18T19:30:00Z");
		expect(
			storeDays(night, {
				timeZone: "Asia/Ho_Chi_Minh",
				businessDayStartMinutes: 0,
			}),
		).toEqual({ today: "2026-11-19", yesterday: "2026-11-18" });
		expect(
			storeDays(night, {
				timeZone: "Asia/Ho_Chi_Minh",
				businessDayStartMinutes: 180,
			}),
		).toEqual({ today: "2026-11-18", yesterday: "2026-11-17" });
	});
});

describe("opening hours today", () => {
	it("reads the spans of the weekday, padded to HH:MM", () => {
		const hours = readOpeningHours({
			wed: [
				["7:00", "11:30"],
				["16:00", "24:00"],
			],
			sun: [],
		});
		expect(weekdayOf("2026-11-18")).toBe("wed");
		expect(hoursOn(hours, "2026-11-18")).toEqual({
			kind: "open",
			spans: [
				["07:00", "11:30"],
				["16:00", "24:00"],
			],
		});
		expect(hoursOn(hours, "2026-11-22")).toEqual({ kind: "closed" });
		expect(hoursOn(hours, "2026-11-19")).toEqual({ kind: "closed" });
	});

	it("are unknown until a usable span is entered", () => {
		for (const value of [
			null,
			{},
			{ mon: [] },
			{ mon: [["7h", "22h"]] },
			[["07:00", "22:00"]],
		]) {
			expect(hoursOn(readOpeningHours(value), "2026-11-16")).toEqual({
				kind: "unknown",
			});
		}
	});
});
