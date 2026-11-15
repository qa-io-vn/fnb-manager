import { generateDay, MENU, mockStore } from "@fnb/connector-mock";
import { describe, expect, it } from "vitest";
import {
	DEMO_BILL_DISCOUNT_NAME,
	DEMO_CASHIERS,
	DEMO_ITEM_PROMOTION_NAME,
	DEMO_SEED,
	DEMO_UNCATEGORISED_ITEM,
	DemoDayCache,
	demoCashierFor,
	demoMenu,
	dressDemoDay,
	menuVariantFor,
} from "../../src/index.js";

const NOW = new Date("2026-11-04T05:30:00.000Z");
const RENAMED_FIELDS = new Set([
	"cashierExternalId",
	"cashierName",
	"employeeExternalId",
	"employeeName",
	"billDiscountName",
	"promotionName",
]);
const TYPE_FIELDS = new Set(["itemTypeExternalId", "itemTypeName"]);

interface FieldChange {
	readonly path: string;
	readonly field: string;
	readonly before: unknown;
	readonly after: unknown;
}

function changes(before: unknown, after: unknown, path = ""): FieldChange[] {
	if (before instanceof Date || after instanceof Date) {
		return before instanceof Date &&
			after instanceof Date &&
			before.getTime() === after.getTime()
			? []
			: [{ path, field: path.split(".").pop() ?? "", before, after }];
	}
	if (
		before !== null &&
		after !== null &&
		typeof before === "object" &&
		typeof after === "object"
	) {
		const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
		return [...keys].flatMap((key) =>
			changes(
				(before as Record<string, unknown>)[key],
				(after as Record<string, unknown>)[key],
				path === "" ? key : `${path}.${key}`,
			),
		);
	}
	return Object.is(before, after)
		? []
		: [{ path, field: path.split(".").pop() ?? "", before, after }];
}

describe("demo dressing", () => {
	it("names promotions apart from their kind and rotates named cashiers", async () => {
		const days = new DemoDayCache({ now: () => NOW, volumeScale: 0.5 });
		const day = await days.generated("MOCK-S1", "2026-11-03");
		if (day === null) throw new Error("expected a generated day");
		const lineNames = new Set(
			day.sales.flatMap((sale) =>
				sale.lines.flatMap((line) =>
					line.promotionName === undefined ? [] : [line.promotionName],
				),
			),
		);
		expect([...lineNames]).toEqual([DEMO_ITEM_PROMOTION_NAME]);
		const week = await Promise.all(
			[
				"2026-10-28",
				"2026-10-29",
				"2026-10-30",
				"2026-10-31",
				"2026-11-01",
			].map((date) => days.generated("MOCK-S1", date)),
		);
		const billNames = new Set(
			[day, ...week].flatMap((entry) =>
				(entry?.sales ?? []).flatMap((sale) =>
					sale.billDiscountName === undefined ? [] : [sale.billDiscountName],
				),
			),
		);
		expect([...billNames]).toEqual([DEMO_BILL_DISCOUNT_NAME]);
		const cashiers = day.shifts.map((shift) => shift.cashierName);
		expect(new Set(cashiers).size).toBe(day.shifts.length);
		expect(cashiers).toEqual(
			day.shifts.map((_, index) => demoCashierFor("2026-11-03", index).name),
		);
		for (const sale of day.sales) {
			const shift = day.shifts.find(
				(entry) => entry.externalId === sale.shiftExternalId,
			);
			expect(sale.employeeName).toBe(shift?.cashierName);
		}
		expect(
			new Set(
				["2026-11-01", "2026-11-02", "2026-11-03"].map(
					(date) => demoCashierFor(date, 0).name,
				),
			).size,
		).toBe(DEMO_CASHIERS.length);
	});

	it("leaves the cheapest snack without an item type and changes nothing else", async () => {
		const days = new DemoDayCache({ now: () => NOW, volumeScale: 0.5 });
		const dates = [
			"2026-10-30",
			"2026-10-31",
			"2026-11-01",
			"2026-11-02",
			"2026-11-03",
		];
		const lines = (
			await Promise.all(dates.map((date) => days.generated("MOCK-S1", date)))
		).flatMap((day) => (day?.sales ?? []).flatMap((sale) => sale.lines));
		const uncategorised = lines.filter(
			(line) => line.itemExternalId === DEMO_UNCATEGORISED_ITEM,
		);
		expect(uncategorised.length).toBeGreaterThan(0);
		for (const line of uncategorised) {
			expect(line.itemTypeExternalId).toBeUndefined();
			expect(line.itemTypeName).toBeUndefined();
		}
		const otherSnacks = lines.filter(
			(line) =>
				line.itemExternalId?.startsWith("SN-") === true &&
				line.itemExternalId !== DEMO_UNCATEGORISED_ITEM,
		);
		expect(otherSnacks.length).toBeGreaterThan(0);
		expect(new Set(otherSnacks.map((line) => line.itemTypeExternalId))).toEqual(
			new Set(["TYPE-009"]),
		);
	});

	it("changes a generated day only in the uncategorised item's type and the display names", () => {
		const days = new DemoDayCache({ now: () => NOW });
		const store = days.store("MOCK-S1");
		if (store === undefined) throw new Error("missing demo store");
		let uncategorisedTotal = 0;
		for (const date of ["2026-10-27", "2026-11-01", "2026-11-03"]) {
			const plan = days.plan(store, date);
			const undressed = generateDay(
				DEMO_SEED,
				plan.profile,
				mockStore(store.index, plan.profile),
				date,
				plan.menu,
			);
			const snapshot = structuredClone(undressed);
			const dressed = dressDemoDay(undressed);
			expect(undressed).toEqual(snapshot);
			expect(days.generatedNow(store.id, date)).toEqual(dressed);
			const changed = changes(undressed, dressed);
			const typeChanges = changed.filter((change) =>
				TYPE_FIELDS.has(change.field),
			);
			expect(
				changed.filter(
					(change) =>
						!TYPE_FIELDS.has(change.field) && !RENAMED_FIELDS.has(change.field),
				),
			).toEqual([]);
			for (const change of changed) {
				if (!RENAMED_FIELDS.has(change.field)) continue;
				expect(typeof change.before).toBe("string");
				expect(typeof change.after).toBe("string");
			}
			const uncategorisedLines = undressed.sales.flatMap((sale, saleIndex) =>
				sale.lines.flatMap((line, lineIndex) =>
					line.itemExternalId === DEMO_UNCATEGORISED_ITEM
						? [`sales.${saleIndex}.lines.${lineIndex}`]
						: [],
				),
			);
			uncategorisedTotal += uncategorisedLines.length;
			expect(typeChanges.map((change) => change.path).sort()).toEqual(
				uncategorisedLines
					.flatMap((line) => [
						`${line}.itemTypeExternalId`,
						`${line}.itemTypeName`,
					])
					.sort(),
			);
			for (const change of typeChanges) {
				expect(change.after).toBeUndefined();
			}
		}
		expect(uncategorisedTotal).toBeGreaterThan(0);
	});

	it("leaves the uncategorised item without a type in the catalogue and every other entry as the mock menu has it", () => {
		const menu = demoMenu({
			seasonalSold: true,
			retired: false,
			priceStep: false,
			launched: false,
		});
		const dressed = menu.catalog.items.find(
			(item) => item.externalId === DEMO_UNCATEGORISED_ITEM,
		);
		const original = MENU.catalog.items.find(
			(item) => item.externalId === DEMO_UNCATEGORISED_ITEM,
		);
		expect(original?.itemTypeExternalId).toBe("TYPE-009");
		expect(dressed).toBeDefined();
		expect(dressed).not.toHaveProperty("itemTypeExternalId");
		expect(dressed).not.toHaveProperty("itemTypeName");
		expect(
			changes(original, dressed)
				.map((change) => change.field)
				.sort(),
		).toEqual(["itemTypeExternalId", "itemTypeName"]);
		expect(menu.catalog.items.map((item) => item.externalId).sort()).toEqual(
			MENU.catalog.items.map((item) => item.externalId).sort(),
		);
		const byId = new Map(
			MENU.catalog.items.map((item) => [item.externalId, item]),
		);
		for (const item of menu.catalog.items) {
			if (item.externalId === DEMO_UNCATEGORISED_ITEM) continue;
			expect(item).toEqual(byId.get(item.externalId));
		}
		for (const date of ["2026-03-01", "2026-11-03"]) {
			const variant = demoMenu(menuVariantFor(date, "2026-11-03", true));
			expect(
				variant.catalog.items.find(
					(item) => item.externalId === DEMO_UNCATEGORISED_ITEM,
				),
			).toEqual(dressed);
		}
		expect(
			menu.itemsById.get(DEMO_UNCATEGORISED_ITEM)?.itemTypeExternalId,
		).toBe("TYPE-009");
	});
});
