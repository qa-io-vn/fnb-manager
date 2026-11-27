import type { Menu, MenuItem, OptionGroup } from "@fnb/zalo-mini/ordering";
import { describe, expect, it } from "vitest";
import {
	addToCart,
	againstMenu,
	type Cart,
	cartCount,
	cartSubtotal,
	characterCount,
	cleanNote,
	defaultChoice,
	EMPTY_CART,
	groupsOf,
	lineTotal,
	type NewLine,
	noteProblem,
	removeLine,
	replaceLine,
	requestLines,
	selectionProblem,
	setQuantity,
	unavailableLines,
	validQuantity,
} from "./cart";

// Test design (ISTQB) for the basket model (design spec C03, C04; the limits of app.order_lines_valid):
// - boundary values of a line's quantity: 0 and 21 refused, 1 and 20 accepted (and a fraction, NaN refused);
// - boundary values of the number of lines: the 30th line added, the 31st refused ("full"); a merge into a line at
//   30 lines still works;
// - equivalence partitions and boundaries of a note: empty (null), 100 characters (as Postgres counts them, a
//   Vietnamese letter with its marks is one) accepted, 101 refused; a control character and a bidirectional override
//   refused; surrounding spaces trimmed;
// - decision table of adding: same size, options (any order) and note merge; another size, option set or note is a
//   new line; a merge above 20 caps at 20; a line of another store empties the basket;
// - totals: a line is quantity x (size price + option prices); the basket's count and subtotal sum the lines;
// - the basket against a new menu: a changed size or option price is reported and taken; an item gone from the menu
//   or listed unavailable is reported (criterion 2);
// - option group limits: below min "missing", above max "too_many", min..max fine; the default choice.

const SIZE_M = "11111111-1111-4111-8111-111111111101";
const SIZE_L = "11111111-1111-4111-8111-111111111102";
const SIZE_TEA = "11111111-1111-4111-8111-111111111103";
const ITEM_COFFEE = "22222222-2222-4222-8222-222222222201";
const ITEM_TEA = "22222222-2222-4222-8222-222222222202";
const ICE = "44444444-4444-4444-8444-444444444401";
const LESS_ICE = "55555555-5555-4555-8555-555555555501";
const NO_ICE = "55555555-5555-4555-8555-555555555502";
const SHOT = "55555555-5555-4555-8555-555555555503";

function line(overrides: Partial<NewLine> = {}): NewLine {
	return {
		itemId: ITEM_COFFEE,
		itemName: "Cà phê sữa",
		sizeId: SIZE_M,
		sizeLabel: "Vừa",
		unitPrice: 35000,
		options: [],
		quantity: 1,
		note: null,
		countsForStamps: true,
		...overrides,
	};
}

function fill(count: number): Cart {
	let cart: Cart = EMPTY_CART;
	for (let index = 0; index < count; index += 1) {
		cart = addToCart(cart, "mau-1", line({ note: `ly ${index}` })).cart;
	}
	return cart;
}

describe("a line's quantity", () => {
	it.each([
		[0, false],
		[1, true],
		[20, true],
		[21, false],
		[1.5, false],
		[Number.NaN, false],
		[-1, false],
	])("%s is valid: %s", (quantity, valid) => {
		expect(validQuantity(quantity)).toBe(valid);
	});

	it("is refused when added outside 1 to 20, and set only within it", () => {
		expect(addToCart(EMPTY_CART, "mau-1", line({ quantity: 0 })).outcome).toBe(
			"invalid",
		);
		expect(addToCart(EMPTY_CART, "mau-1", line({ quantity: 21 })).outcome).toBe(
			"invalid",
		);
		const { cart } = addToCart(EMPTY_CART, "mau-1", line({ quantity: 20 }));
		const key = cart.lines[0]?.key ?? "";
		expect(setQuantity(cart, key, 21)).toBe(cart);
		expect(setQuantity(cart, key, 0)).toBe(cart);
		expect(setQuantity(cart, key, 1).lines[0]?.quantity).toBe(1);
	});
});

describe("the number of lines", () => {
	it("takes the 30th line and refuses the 31st", () => {
		const twentyNine = fill(29);
		const thirty = addToCart(twentyNine, "mau-1", line({ note: "thứ 30" }));
		expect(thirty.outcome).toBe("added");
		expect(thirty.cart.lines).toHaveLength(30);
		const full = addToCart(thirty.cart, "mau-1", line({ note: "thứ 31" }));
		expect(full.outcome).toBe("full");
		expect(full.cart).toBe(thirty.cart);
	});

	it("still merges into a line of a full basket", () => {
		const thirty = fill(30);
		const merged = addToCart(thirty, "mau-1", line({ note: "ly 3" }));
		expect(merged.outcome).toBe("merged");
		expect(merged.cart.lines).toHaveLength(30);
	});
});

describe("a note", () => {
	const hundred = "đ".repeat(100);
	it("of 100 characters is accepted and of 101 refused, as Postgres counts them", () => {
		expect(characterCount("ít ngọt")).toBe(7);
		expect(noteProblem(hundred)).toBeNull();
		expect(noteProblem(`${hundred}đ`)).toBe("too_long");
		expect(noteProblem(`  ${hundred}  `)).toBeNull();
		expect(noteProblem("x".repeat(200), 200)).toBeNull();
		expect(noteProblem("x".repeat(201), 200)).toBe("too_long");
	});

	it("with a control character or a bidirectional override is refused", () => {
		expect(noteProblem("ít\nđá")).toBe("control");
		expect(noteProblem("abc\u0007")).toBe("control");
		expect(noteProblem("abc‮def")).toBe("control");
		expect(noteProblem("<script>alert(1)</script>")).toBeNull();
		expect(addToCart(EMPTY_CART, "mau-1", line({ note: "a⁦b" })).outcome).toBe(
			"invalid",
		);
	});

	it("is trimmed and empty is none", () => {
		expect(cleanNote("  ít đá  ")).toBe("ít đá");
		expect(cleanNote("   ")).toBeNull();
	});
});

describe("adding to the basket", () => {
	it("merges the same size, options in any order and note, and makes a new line otherwise", () => {
		const options = [
			{ id: LESS_ICE, name: "Ít đá", groupName: "Đá", price: 0 },
			{ id: SHOT, name: "Thêm shot", groupName: "Thêm", price: 10000 },
		];
		let cart = addToCart(EMPTY_CART, "mau-1", line({ options })).cart;
		const reversed = [...options].reverse();
		const merged = addToCart(cart, "mau-1", line({ options: reversed }));
		expect(merged.outcome).toBe("merged");
		expect(merged.cart.lines[0]?.quantity).toBe(2);
		cart = merged.cart;
		expect(
			addToCart(cart, "mau-1", line({ options: options.slice(0, 1) })).cart
				.lines,
		).toHaveLength(2);
		expect(
			addToCart(cart, "mau-1", line({ options, sizeId: SIZE_L })).cart.lines,
		).toHaveLength(2);
		expect(
			addToCart(cart, "mau-1", line({ options, note: "nóng" })).cart.lines,
		).toHaveLength(2);
	});

	it("caps a merge at 20", () => {
		const { cart } = addToCart(EMPTY_CART, "mau-1", line({ quantity: 15 }));
		const capped = addToCart(cart, "mau-1", line({ quantity: 6 }));
		expect(capped.outcome).toBe("capped");
		expect(capped.cart.lines[0]?.quantity).toBe(20);
	});

	it("empties the basket for a line of another store", () => {
		const { cart } = addToCart(EMPTY_CART, "mau-1", line());
		const other = addToCart(cart, "mau-2", line({ sizeId: SIZE_TEA }));
		expect(other.cart.store).toBe("mau-2");
		expect(other.cart.lines.map((entry) => entry.sizeId)).toEqual([SIZE_TEA]);
	});

	it("replaces an edited line, merging it into a line of the same choice", () => {
		let cart = addToCart(EMPTY_CART, "mau-1", line()).cart;
		cart = addToCart(
			cart,
			"mau-1",
			line({ sizeId: SIZE_L, unitPrice: 45000 }),
		).cart;
		const large = cart.lines[1]?.key ?? "";
		const edited = replaceLine(cart, large, line({ quantity: 2 }));
		expect(edited.lines).toHaveLength(1);
		expect(edited.lines[0]?.quantity).toBe(3);
		expect(removeLine(edited, edited.lines[0]?.key ?? "").lines).toEqual([]);
	});
});

describe("totals", () => {
	it("are quantity times the size and option prices, summed over the lines", () => {
		let cart = addToCart(
			EMPTY_CART,
			"mau-1",
			line({
				quantity: 2,
				options: [
					{ id: SHOT, name: "Thêm shot", groupName: "Thêm", price: 10000 },
				],
			}),
		).cart;
		cart = addToCart(
			cart,
			"mau-1",
			line({ itemId: ITEM_TEA, sizeId: SIZE_TEA, unitPrice: 29000 }),
		).cart;
		expect(cart.lines.map(lineTotal)).toEqual([90000, 29000]);
		expect(cartCount(cart)).toBe(3);
		expect(cartSubtotal(cart)).toBe(119000);
		expect(cartSubtotal(EMPTY_CART)).toBe(0);
	});

	it("go to the server as sizes, quantities, option ids and notes, without a price", () => {
		const cart = addToCart(
			EMPTY_CART,
			"mau-1",
			line({
				quantity: 2,
				note: "ít ngọt",
				options: [{ id: NO_ICE, name: "Không đá", groupName: "Đá", price: 0 }],
			}),
		).cart;
		expect(requestLines(cart)).toEqual([
			{ size: SIZE_M, qty: 2, options: [NO_ICE], note: "ít ngọt" },
		]);
		expect(JSON.stringify(requestLines(cart))).not.toContain("35000");
	});
});

describe("the basket against a new menu", () => {
	const groups: OptionGroup[] = [
		{
			id: ICE,
			name: "Đá",
			minSelect: 1,
			maxSelect: 1,
			options: [
				{ id: LESS_ICE, name: "Ít đá", priceDelta: 0, isDefault: true },
				{ id: NO_ICE, name: "Không đá", priceDelta: 0, isDefault: false },
			],
		},
	];
	const coffee: MenuItem = {
		id: ITEM_COFFEE,
		categoryId: "33333333-3333-4333-8333-333333333301",
		name: "Cà phê sữa",
		description: null,
		photoPath: null,
		labels: [],
		orderTypes: ["table"],
		countsForStamps: true,
		sizes: [
			{ id: SIZE_M, label: "Vừa", price: 39000, isDefault: true },
			{ id: SIZE_L, label: "Lớn", price: 45000, isDefault: false },
		],
		optionGroupIds: [ICE],
	};
	const menu = (unavailable: string[] = []): Menu => ({
		store: {
			code: "mau-1",
			name: "Quán",
			address: null,
			openingHours: {} as Menu["store"]["openingHours"],
		},
		orderType: "table",
		ordering: {
			accepting: true,
			reason: null,
			tillMode: "native",
			orderTypes: ["table"],
			paymentMethods: ["counter"],
			opensAt: null,
			closesAt: null,
			lastOrderAt: null,
			pausedUntil: null,
			closureReason: null,
			closureEndsOn: null,
		},
		menuVersion: 2,
		categories: [{ id: coffee.categoryId, name: "Cà phê", items: [coffee] }],
		optionGroups: groups,
		unavailableItems: unavailable,
	});

	it("takes a changed price and reports it", () => {
		const cart = addToCart(EMPTY_CART, "mau-1", line()).cart;
		const result = againstMenu(cart, menu());
		expect(result.changes).toEqual([
			{
				key: cart.lines[0]?.key,
				itemName: "Cà phê sữa",
				before: 35000,
				after: 39000,
			},
		]);
		expect(cartSubtotal(result.cart)).toBe(39000);
		expect(result.gone.size).toBe(0);
	});

	it("reports an item gone from the menu or listed unavailable, which blocks the order", () => {
		const cart = addToCart(
			addToCart(EMPTY_CART, "mau-1", line()).cart,
			"mau-1",
			line({ itemId: ITEM_TEA, sizeId: SIZE_TEA, unitPrice: 29000 }),
		).cart;
		const result = againstMenu(cart, menu());
		expect([...result.gone]).toEqual([ITEM_TEA]);
		expect(
			unavailableLines(cart, result.gone).map((entry) => entry.itemId),
		).toEqual([ITEM_TEA]);
		expect([...againstMenu(cart, menu([ITEM_COFFEE])).gone].sort()).toEqual(
			[ITEM_COFFEE, ITEM_TEA].sort(),
		);
	});

	it("checks option group limits and starts from the defaults", () => {
		const ice = groups[0] as OptionGroup;
		expect(selectionProblem(ice, [])).toBe("missing");
		expect(selectionProblem(ice, [LESS_ICE])).toBeNull();
		expect(selectionProblem(ice, [LESS_ICE, NO_ICE])).toBe("too_many");
		expect(
			selectionProblem(ice, ["99999999-9999-4999-8999-999999999999"]),
		).toBe("missing");
		expect(defaultChoice(coffee, groupsOf(coffee, groups))).toEqual({
			sizeId: SIZE_M,
			options: { [ICE]: [LESS_ICE] },
		});
	});
});
