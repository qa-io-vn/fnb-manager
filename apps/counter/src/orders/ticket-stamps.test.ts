import { describe, expect, it } from "vitest";
import en from "../i18n/en.json";
import vi from "../i18n/vi.json";
import type { CounterMenuItem, StampCardSetting } from "../menu/menu-api";
import { ticketStamps } from "./member";

// counter:unit/ticket-stamps (Q01 "Đơn này cộng thêm N dấu", native-till.md 18.1): the stamps a ticket keyed for a
// member will earn, by the server's rule (app.stamps_on_completion: one per unit of the lines whose item counts for
// stamps, at the order's brand, which counter_create_order takes from the first line; nothing while the card is off).
// - equivalence partitions: drinks only, a drink and a pastry, pastries only, an empty ticket;
// - boundary values of a line's quantity: 0 and below ignored, 1, the most a line holds (20);
// - decision table of when the ticket says it: card on / off / not answered × units 0 / more × first line known or not;
// - error guessing: a line of another brand, an item the menu no longer lists, a fractional quantity.

const BRAND = "b1";
const OTHER_BRAND = "b2";

type Item = Pick<CounterMenuItem, "id" | "brand_id" | "counts_for_stamps">;

const ITEMS: readonly Item[] = [
	{ id: "coffee", brand_id: BRAND, counts_for_stamps: true },
	{ id: "tea", brand_id: BRAND, counts_for_stamps: true },
	{ id: "cake", brand_id: BRAND, counts_for_stamps: false },
	{ id: "other-coffee", brand_id: OTHER_BRAND, counts_for_stamps: true },
];

const ON: readonly StampCardSetting[] = [
	{ brand_id: BRAND, enabled: true, stamps_per_reward: 9 },
	{ brand_id: OTHER_BRAND, enabled: true, stamps_per_reward: 9 },
];
const OFF: readonly StampCardSetting[] = [
	{ brand_id: BRAND, enabled: false, stamps_per_reward: 9 },
	{ brand_id: OTHER_BRAND, enabled: true, stamps_per_reward: 9 },
];

const line = (itemId: string, qty: number) => ({ itemId, qty });

describe("the stamps of a ticket (EP)", () => {
	it("counts one stamp per unit of the drinks", () => {
		expect(ticketStamps([line("coffee", 1)], ITEMS, ON)).toBe(1);
		expect(ticketStamps([line("coffee", 1), line("tea", 2)], ITEMS, ON)).toBe(
			3,
		);
	});

	it("leaves out the lines that do not count (a pastry)", () => {
		expect(
			ticketStamps(
				[line("coffee", 1), line("tea", 2), line("cake", 1)],
				ITEMS,
				ON,
			),
		).toBe(3);
		expect(ticketStamps([line("cake", 1), line("tea", 1)], ITEMS, ON)).toBe(1);
	});

	it("says nothing for a ticket without a line or with pastries only", () => {
		expect(ticketStamps([], ITEMS, ON)).toBeNull();
		expect(ticketStamps([line("cake", 3)], ITEMS, ON)).toBeNull();
	});
});

describe("a line's quantity (BVA)", () => {
	it.each([
		[-1, null],
		[0, null],
		[1, 1],
		[2, 2],
		[20, 20],
	])("quantity %d → %s", (qty, stamps) => {
		expect(ticketStamps([line("coffee", qty)], ITEMS, ON)).toBe(stamps);
	});

	it("ignores a quantity that is not a whole number (error guessing)", () => {
		expect(ticketStamps([line("coffee", 1.5)], ITEMS, ON)).toBeNull();
		expect(
			ticketStamps([line("coffee", Number.NaN), line("tea", 1)], ITEMS, ON),
		).toBe(1);
	});
});

describe("when the ticket says it (decision table)", () => {
	const rows: readonly [
		string,
		readonly { itemId: string; qty: number }[],
		readonly StampCardSetting[],
		number | null,
	][] = [
		["card on, drinks", [line("coffee", 2)], ON, 2],
		["card off, drinks", [line("coffee", 2)], OFF, null],
		["card not answered, drinks", [line("coffee", 2)], [], null],
		["card on, nothing counts", [line("cake", 2)], ON, null],
		[
			"first line unknown to the menu",
			[line("gone", 1), line("coffee", 1)],
			ON,
			null,
		],
	];
	it.each(rows)("%s", (_name, lines, cards, stamps) => {
		expect(ticketStamps(lines, ITEMS, cards)).toBe(stamps);
	});

	it("takes the brand of the first line, as counter_create_order does (error guessing)", () => {
		// a line of another brand does not count towards this order's card
		expect(
			ticketStamps([line("coffee", 1), line("other-coffee", 4)], ITEMS, ON),
		).toBe(1);
		// the first line of the other brand: that brand's card decides, the first brand's being off does not matter
		expect(
			ticketStamps([line("other-coffee", 2), line("coffee", 5)], ITEMS, OFF),
		).toBe(2);
		// an item the menu no longer lists does not count
		expect(ticketStamps([line("coffee", 1), line("gone", 3)], ITEMS, ON)).toBe(
			1,
		);
	});
});

describe("the ticket's words", () => {
	it("are in both catalogs with the count", () => {
		expect(vi["member.ticketEarn"]).toContain("{count}");
		expect(en["member.ticketEarn"]).toContain("{count}");
	});
});
