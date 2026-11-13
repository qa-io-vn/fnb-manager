import { MENU } from "@fnb/connector-mock";
import { describe, expect, it } from "vitest";
import {
	captureRate,
	demoDayPlan,
	demoMenu,
	demoRoles,
	demoStores,
	demoSyncCheck,
	demoTargets,
	expectedInvoices,
	isClosedTetDay,
	isFirstIsoWeekOfMonth,
	isOnMenu,
	isPreTetDay,
	launchDate,
	menuVariantFor,
	openingMinutes,
	salesFactor,
	youngStoreOpenedOn,
} from "../../src/index.js";

const AS_OF = "2026-11-03";
const [established, young] = demoStores(AS_OF);

function store(index: 0 | 1) {
	const found = index === 0 ? established : young;
	if (found === undefined) throw new Error("missing demo store");
	return found;
}

describe("demo stores", () => {
	it("opens the young store on the Monday 8 to 13 weeks before the as-of month", () => {
		expect(youngStoreOpenedOn("2026-11-03")).toBe("2026-08-31");
		expect(store(1).openedOn).toBe("2026-08-31");
		expect(youngStoreOpenedOn("2026-11-30")).toBe("2026-08-31");
		expect(youngStoreOpenedOn("2026-12-01")).toBe("2026-10-05");
		expect(store(0).openedOn).toBe("2024-12-02");
	});

	it("gives only the established store opening hours and targets", () => {
		expect(store(0)).toMatchObject({ id: "MOCK-S1", hasMonthlyTargets: true });
		expect(store(1)).toMatchObject({
			id: "MOCK-S2",
			openingHours: null,
			hasMonthlyTargets: false,
		});
		expect(openingMinutes(store(0).openingHours, "2026-11-03")).toBe(930);
		expect(openingMinutes(null, "2026-11-03")).toBeNull();
	});
});

describe("demoDayPlan", () => {
	it("closes before the opening and on Tết days 1 to 3", () => {
		expect(demoDayPlan(store(1), "2026-08-30", AS_OF).open).toBe(false);
		expect(demoDayPlan(store(1), "2026-08-31", AS_OF).open).toBe(true);
		expect(isClosedTetDay("2026-02-17")).toBe(true);
		expect(isClosedTetDay("2026-02-19")).toBe(true);
		expect(isClosedTetDay("2026-02-20")).toBe(false);
		expect(demoDayPlan(store(0), "2026-02-18", AS_OF).open).toBe(false);
	});

	it("applies the Tết, holiday, month, growth and ramp factors in order", () => {
		const base = store(0).profile.averageSalesPerDay;
		expect(salesFactor(store(0), "2025-01-01")).toBeCloseTo(1.04 * 1.1, 10);
		expect(salesFactor(store(0), "2026-02-20")).toBeCloseTo(
			0.5 * 0.97 * 1.06 ** (415 / 365.25),
			10,
		);
		expect(isPreTetDay("2026-02-09")).toBe(true);
		expect(isPreTetDay("2026-02-08")).toBe(false);
		expect(salesFactor(store(1), "2026-08-31")).toBeCloseTo(
			0.55 * 1.02 * 1.06 ** (607 / 365.25),
			10,
		);
		expect(expectedInvoices(store(0), "2025-01-01")).toBe(
			Math.round(base * 1.04 * 1.1),
		);
		expect(
			expectedInvoices(store(0), "2025-01-01", { volumeScale: 0.0001 }),
		).toBe(1);
	});

	it("overrides capture, item discount and voucher rates by date", () => {
		expect(captureRate("2026-09-30")).toBe(0);
		expect(captureRate("2026-10-01")).toBeCloseTo(0.02, 12);
		expect(captureRate("2026-10-31")).toBeCloseTo(0.02 + (0.28 * 30) / 120, 12);
		expect(captureRate("2027-06-01")).toBe(0.3);
		expect(
			demoDayPlan(store(0), "2026-11-03", AS_OF).profile.itemDiscountRate,
		).toBe(0.15);
		expect(
			demoDayPlan(store(0), "2026-11-04", AS_OF).profile.itemDiscountRate,
		).toBe(0.03);
		expect(isFirstIsoWeekOfMonth("2026-11-01")).toBe(true);
		expect(isFirstIsoWeekOfMonth("2026-11-02")).toBe(false);
		expect(isFirstIsoWeekOfMonth("2026-10-04")).toBe(true);
		expect(demoDayPlan(store(0), "2026-10-02", AS_OF).profile.voucherRate).toBe(
			0.2,
		);
		expect(demoDayPlan(store(0), "2026-10-05", AS_OF).profile.voucherRate).toBe(
			0.08,
		);
	});
});

describe("menus", () => {
	it("sells the seasonal juice from April to September only", () => {
		expect(isOnMenu("DR-035-M", "MOCK-S1", "2026-04-01", AS_OF)).toBe(true);
		expect(isOnMenu("DR-035-M", "MOCK-S1", "2026-10-01", AS_OF)).toBe(false);
	});

	it("retires one tea and steps the milk tea prices", () => {
		expect(isOnMenu("DR-002-M", "MOCK-S1", "2026-07-31", AS_OF)).toBe(true);
		expect(isOnMenu("DR-002-M", "MOCK-S1", "2026-08-01", AS_OF)).toBe(false);
		const before = demoMenu(menuVariantFor("2026-02-28", AS_OF, true));
		const after = demoMenu(menuVariantFor("2026-03-01", AS_OF, true));
		const price = (menu: typeof before) =>
			menu.itemsById.get("DR-008-M")?.listPrice;
		expect(price(before)).toBe(38_000);
		expect(price(after)).toBe(41_000);
		expect(MENU.itemsById.get("DR-008-M")?.listPrice).toBe(38_000);
	});

	it("launches two drinks at the established store from day 3 of the as-of month", () => {
		expect(launchDate("2026-11-03")).toBe("2026-11-03");
		expect(launchDate("2026-11-02")).toBe("2026-10-03");
		expect(launchDate("2027-01-01")).toBe("2026-12-03");
		expect(isOnMenu("DR-NEW-001-L", "MOCK-S1", "2026-11-03", AS_OF)).toBe(true);
		expect(isOnMenu("DR-NEW-001-L", "MOCK-S1", "2026-11-02", AS_OF)).toBe(
			false,
		);
		expect(isOnMenu("DR-NEW-002-M", "MOCK-S2", "2026-11-03", AS_OF)).toBe(
			false,
		);
		const launched = demoMenu(menuVariantFor("2026-11-03", AS_OF, true));
		expect(launched.itemsById.get("DR-NEW-002-L")).toMatchObject({
			name: "Cà phê dừa đá xay (L)",
			itemTypeName: "Đá xay",
			listPrice: 60_000,
			sizeLabel: "L",
		});
	});
});

describe("roles, targets and checks", () => {
	it("maps drinks, toppings, snacks and other types", () => {
		const roles = Object.fromEntries(
			demoRoles().map((role) => [role.itemTypeExternalId, role.role]),
		);
		expect(roles).toMatchObject({
			"TYPE-001": "drink",
			"TYPE-006": "drink",
			"TYPE-007": "topping",
			"TYPE-008": "topping",
			"TYPE-009": "snack",
			"TYPE-010": "other",
		});
	});

	it("sets a rounded monthly target for the established store only", () => {
		let invoices = 0;
		for (let day = 1; day <= 30; day += 1) {
			invoices += expectedInvoices(
				store(0),
				`2026-11-${String(day).padStart(2, "0")}`,
			);
		}
		expect(demoTargets(store(0), "2026-11-01")).toBe(
			Math.round((invoices * 90_000 * 1.05) / 1_000_000) * 1_000_000,
		);
		expect(demoTargets(store(1), "2026-11-01")).toBeNull();
		expect(demoTargets(store(0), "2024-11-01")).toBeNull();
		expect(demoTargets(store(0), "2026-11-02")).toBeNull();
	});

	it("matches every check except one unmatched and one missing day", () => {
		expect(demoSyncCheck(store(0), "2026-11-02", AS_OF)).toEqual({
			matched: true,
		});
		expect(demoSyncCheck(store(0), "2026-10-25", AS_OF)).toEqual({
			matched: false,
		});
		expect(demoSyncCheck(store(1), "2026-10-30", AS_OF)).toBeNull();
		expect(demoSyncCheck(store(1), "2026-10-29", AS_OF)).toEqual({
			matched: true,
		});
		expect(demoSyncCheck(store(0), "2026-11-04", AS_OF)).toBeNull();
	});
});
