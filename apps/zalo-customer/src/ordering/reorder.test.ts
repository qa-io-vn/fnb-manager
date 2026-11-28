import type {
	Menu,
	MenuItem,
	OptionGroup,
	Order,
	OrderSummary,
	PricedLine,
} from "@fnb/zalo-mini/ordering";
import { describe, expect, it } from "vitest";
import {
	addToCart,
	type Cart,
	cartCount,
	choiceNeeded,
	EMPTY_CART,
	type NewLine,
	requestLines,
} from "./cart";
import {
	applyReorder,
	lineName,
	planReorder,
	reportIsEmpty,
	reportOf,
	sameStore,
} from "./reorder";

// Test design (ISTQB) for "Đặt lại" (design spec C14, GA-073): the basket an earlier order makes again.
// - decision table of a line against the current menu: item listed and on sale → added; item gone (not listed, or no
//   id any more) → left out; sold out (the menu's list or the version poll's) → left out; size gone → left out;
//   option gone → left out; a group now required with a default → the default taken; without a default → added and
//   asking for the choice; more options than a group now takes → asking; a price changed → the menu's price, never
//   the order's;
// - boundary values: a line's quantity 0, 1, 20, 21 (and a fraction); a merge into a line of the basket at 20 and at
//   21; a note of 100 and 101 characters as Postgres counts them, a control character and a bidirectional override;
//   the basket's 30th and 31st line;
// - equivalence partitions of orders: at a table, taken away, cancelled, cancelled and refunded: the same lines make
//   the same basket whatever became of the order;
// - state transitions of the basket: empty → filled; holding items → replaced; holding items → added to (merged); a
//   basket of another store → the plan's store;
// - security: the order's prices never reach the basket or the request; markup in a name or a note stays the text it
//   was; the store check compares the history's store with the menu's.

const STORE = "mau-1";
const COFFEE = "dddddddd-0000-4000-8000-000000000101";
const TEA = "dddddddd-0000-4000-8000-000000000102";
const CAKE = "dddddddd-0000-4000-8000-000000000103";
const COFFEE_M = "eeeeeeee-0000-4000-8000-000000000101";
const COFFEE_L = "eeeeeeee-0000-4000-8000-000000000102";
const TEA_SIZE = "eeeeeeee-0000-4000-8000-000000000103";
const CAKE_SIZE = "eeeeeeee-0000-4000-8000-000000000104";
const ICE = "aaaaaaaa-0000-4000-8000-000000000101";
const SWEET = "aaaaaaaa-0000-4000-8000-000000000102";
const EXTRA = "aaaaaaaa-0000-4000-8000-000000000103";
const ICE_NORMAL = "bbbbbbbb-0000-4000-8000-000000000101";
const ICE_LESS = "bbbbbbbb-0000-4000-8000-000000000102";
const SWEET_NORMAL = "bbbbbbbb-0000-4000-8000-000000000103";
const SWEET_LESS = "bbbbbbbb-0000-4000-8000-000000000104";
const SHOT = "bbbbbbbb-0000-4000-8000-000000000105";
const CREAM = "bbbbbbbb-0000-4000-8000-000000000106";

function group(overrides: Partial<OptionGroup> & Pick<OptionGroup, "id">) {
	return {
		name: "Nhóm",
		minSelect: 0,
		maxSelect: 1,
		options: [],
		...overrides,
	} satisfies OptionGroup;
}

const ICE_GROUP = group({
	id: ICE,
	name: "Đá",
	minSelect: 1,
	maxSelect: 1,
	options: [
		{ id: ICE_NORMAL, name: "Bình thường", priceDelta: 0, isDefault: true },
		{ id: ICE_LESS, name: "Ít đá", priceDelta: 0, isDefault: false },
	],
});
const SWEET_GROUP = group({
	id: SWEET,
	name: "Độ ngọt",
	minSelect: 0,
	maxSelect: 1,
	options: [
		{ id: SWEET_NORMAL, name: "Bình thường", priceDelta: 0, isDefault: true },
		{ id: SWEET_LESS, name: "Ít ngọt", priceDelta: 0, isDefault: false },
	],
});
const EXTRA_GROUP = group({
	id: EXTRA,
	name: "Thêm",
	minSelect: 0,
	maxSelect: 2,
	options: [
		{ id: SHOT, name: "Thêm một shot", priceDelta: 10000, isDefault: false },
		{ id: CREAM, name: "Kem muối", priceDelta: 8000, isDefault: false },
	],
});

function item(overrides: Partial<MenuItem> & Pick<MenuItem, "id" | "name">) {
	return {
		categoryId: "cccccccc-0000-4000-8000-000000000101",
		description: null,
		photoPath: null,
		labels: [],
		orderTypes: ["table"],
		countsForStamps: true,
		sizes: [],
		optionGroupIds: [],
		...overrides,
	} satisfies MenuItem;
}

const COFFEE_ITEM = item({
	id: COFFEE,
	name: "Cà phê sữa",
	sizes: [
		{ id: COFFEE_M, label: "Vừa", price: 35000, isDefault: true },
		{ id: COFFEE_L, label: "Lớn", price: 45000, isDefault: false },
	],
	optionGroupIds: [ICE, SWEET, EXTRA],
});
const TEA_ITEM = item({
	id: TEA,
	name: "Trà sen",
	sizes: [{ id: TEA_SIZE, label: null, price: 49000, isDefault: true }],
});
const CAKE_ITEM = item({
	id: CAKE,
	name: "Bánh chuối",
	countsForStamps: false,
	sizes: [{ id: CAKE_SIZE, label: null, price: 25000, isDefault: true }],
});

function menu(
	options: {
		readonly items?: readonly MenuItem[];
		readonly groups?: readonly OptionGroup[];
		readonly unavailable?: readonly string[];
		readonly name?: string;
	} = {},
): Menu {
	return {
		store: {
			code: STORE,
			name: options.name ?? "Cửa hàng Mẫu 1",
			address: null,
			openingHours: {
				mon: [],
				tue: [],
				wed: [],
				thu: [],
				fri: [],
				sat: [],
				sun: [],
			},
		},
		orderType: null,
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
		menuVersion: 1,
		categories: [
			{
				id: "cccccccc-0000-4000-8000-000000000101",
				name: "Đồ uống",
				items: options.items ?? [COFFEE_ITEM, TEA_ITEM, CAKE_ITEM],
			},
		],
		optionGroups: options.groups ?? [ICE_GROUP, SWEET_GROUP, EXTRA_GROUP],
		unavailableItems: options.unavailable ?? [],
	} as Menu;
}

function sold(
	overrides: Partial<PricedLine> & Pick<PricedLine, "itemId" | "sizeId">,
): PricedLine {
	return {
		lineNo: 1,
		itemName: "Cà phê sữa",
		sizeLabel: "Vừa",
		quantity: 1,
		// what the order was sold at: never what the basket takes
		unitPrice: 1,
		options: [],
		optionsAmount: 0,
		lineTotal: 1,
		countsForStamps: true,
		note: null,
		...overrides,
	};
}

function chosen(groupId: string, optionId: string, name = "Tùy chọn") {
	return { groupId, group: "Nhóm", optionId, name, price: 1 };
}

const COFFEE_LINE = sold({
	itemId: COFFEE,
	sizeId: COFFEE_L,
	sizeLabel: "Lớn",
	quantity: 2,
	options: [chosen(ICE, ICE_LESS), chosen(EXTRA, SHOT)],
	note: "ít ngọt",
});

function order(lines: readonly PricedLine[]): Pick<Order, "lines"> {
	return { lines };
}

function newLine(overrides: Partial<NewLine> = {}): NewLine {
	return {
		itemId: TEA,
		itemName: "Trà sen",
		sizeId: TEA_SIZE,
		sizeLabel: null,
		unitPrice: 49000,
		options: [],
		quantity: 1,
		note: null,
		countsForStamps: true,
		...overrides,
	};
}

describe("a line against the current menu (decision table)", () => {
	it("is added with its size, options and note when everything is still sold", () => {
		const plan = planReorder(order([COFFEE_LINE]), menu());
		expect(plan.leftOut).toEqual([]);
		expect(plan.lines).toHaveLength(1);
		expect(plan.lines[0]).toMatchObject({
			itemId: COFFEE,
			itemName: "Cà phê sữa",
			sizeId: COFFEE_L,
			sizeLabel: "Lớn",
			quantity: 2,
			note: "ít ngọt",
			countsForStamps: true,
		});
		expect(plan.lines[0]?.options.map((option) => option.id)).toEqual([
			ICE_LESS,
			SHOT,
		]);
		expect(plan.toChoose).toEqual([]);
	});

	it.each([
		[
			"an item gone from the menu",
			sold({
				itemId: "dddddddd-0000-4000-8000-000000000999",
				sizeId: COFFEE_M,
			}),
			menu(),
			"item_gone",
		],
		[
			"an item the catalogue no longer has (no id)",
			sold({ itemId: null, sizeId: null }),
			menu(),
			"item_gone",
		],
		[
			"an item the menu lists as sold out",
			sold({
				itemId: TEA,
				sizeId: TEA_SIZE,
				itemName: "Trà sen",
				sizeLabel: null,
			}),
			menu({ unavailable: [TEA] }),
			"sold_out",
		],
		[
			"a size gone",
			sold({ itemId: COFFEE, sizeId: "eeeeeeee-0000-4000-8000-000000000999" }),
			menu(),
			"size_gone",
		],
		[
			"an option gone",
			sold({
				itemId: COFFEE,
				sizeId: COFFEE_M,
				options: [chosen(ICE, "bbbbbbbb-0000-4000-8000-000000000999")],
			}),
			menu(),
			"option_gone",
		],
		[
			"an option whose group the item no longer has",
			sold({ itemId: TEA, sizeId: TEA_SIZE, options: [chosen(EXTRA, SHOT)] }),
			menu(),
			"option_gone",
		],
	] as const)("leaves out %s and names it", (_case, line, current, reason) => {
		const plan = planReorder(order([line]), current);
		expect(plan.lines).toEqual([]);
		expect(plan.leftOut).toEqual([{ name: lineName(line), reason }]);
	});

	it("leaves out an item the version poll says is sold out, though the menu still lists it", () => {
		const line = sold({
			itemId: CAKE,
			sizeId: CAKE_SIZE,
			itemName: "Bánh chuối",
			sizeLabel: null,
		});
		const plan = planReorder(order([line]), menu(), new Set([CAKE]));
		expect(plan.leftOut).toEqual([{ name: "Bánh chuối", reason: "sold_out" }]);
	});

	it("takes the default of a group that became required", () => {
		const line = sold({ itemId: COFFEE, sizeId: COFFEE_M, options: [] });
		const plan = planReorder(order([line]), menu());
		expect(plan.lines[0]?.options.map((option) => option.id)).toEqual([
			ICE_NORMAL,
		]);
		expect(plan.toChoose).toEqual([]);
	});

	it("adds the line and asks for the choice when the newly required group has no default", () => {
		const noDefault = {
			...ICE_GROUP,
			options: ICE_GROUP.options.map((option) => ({
				...option,
				isDefault: false,
			})),
		};
		const line = sold({ itemId: COFFEE, sizeId: COFFEE_M, options: [] });
		const current = menu({ groups: [noDefault, SWEET_GROUP, EXTRA_GROUP] });
		const plan = planReorder(order([line]), current);
		expect(plan.lines).toHaveLength(1);
		expect(plan.lines[0]?.options).toEqual([]);
		expect(plan.toChoose).toEqual(["Cà phê sữa (Vừa)"]);
		// the basket then flags the line with the group to choose
		const cart = applyReorder(EMPTY_CART, STORE, plan, "replace").cart;
		const [first] = cart.lines;
		if (first === undefined) throw new Error("no line");
		expect(choiceNeeded(first, current)?.id).toBe(ICE);
	});

	it("asks for the choice when a group now takes fewer options than the line had", () => {
		const oneExtra = { ...EXTRA_GROUP, maxSelect: 1 };
		const line = sold({
			itemId: COFFEE,
			sizeId: COFFEE_M,
			options: [
				chosen(ICE, ICE_NORMAL),
				chosen(EXTRA, SHOT),
				chosen(EXTRA, CREAM),
			],
		});
		const plan = planReorder(
			order([line]),
			menu({ groups: [ICE_GROUP, SWEET_GROUP, oneExtra] }),
		);
		expect(plan.toChoose).toEqual(["Cà phê sữa (Vừa)"]);
	});

	it("prices every line from the current menu, never from the order", () => {
		const repriced = {
			...COFFEE_ITEM,
			sizes: COFFEE_ITEM.sizes.map((size) => ({
				...size,
				price: size.price + 2000,
			})),
		};
		const plan = planReorder(
			order([COFFEE_LINE]),
			menu({ items: [repriced, TEA_ITEM, CAKE_ITEM] }),
		);
		expect(plan.lines[0]?.unitPrice).toBe(47000);
		expect(plan.lines[0]?.options.map((option) => option.price)).toEqual([
			0, 10000,
		]);
		// the order's unit price (1) and option prices (1) are nowhere in the basket
		const cart = applyReorder(EMPTY_CART, STORE, plan, "replace").cart;
		expect(JSON.stringify(cart)).not.toMatch(/"(?:unitPrice|price)":1\b/);
	});

	it("names the item as the menu calls it now, and a left-out line as the order had it", () => {
		const renamed = { ...TEA_ITEM, name: "Trà sen vàng" };
		const plan = planReorder(
			order([
				sold({
					itemId: TEA,
					sizeId: TEA_SIZE,
					itemName: "Trà sen",
					sizeLabel: null,
				}),
				sold({
					itemId: null,
					sizeId: null,
					itemName: "Bánh cũ",
					sizeLabel: null,
				}),
			]),
			menu({ items: [COFFEE_ITEM, renamed, CAKE_ITEM] }),
		);
		expect(plan.lines[0]?.itemName).toBe("Trà sen vàng");
		expect(plan.leftOut.map((entry) => entry.name)).toEqual(["Bánh cũ"]);
	});
});

describe("a line's quantity and note (boundary values)", () => {
	it.each([
		[0, null, null],
		[1, 1, null],
		[20, 20, null],
		[21, 20, "capped"],
		[1.5, null, null],
	] as const)("a quantity of %s gives %s", (quantity, kept, flag) => {
		const line = sold({
			itemId: TEA,
			sizeId: TEA_SIZE,
			itemName: "Trà sen",
			sizeLabel: null,
			quantity,
		});
		const plan = planReorder(order([line]), menu());
		if (kept === null) {
			expect(plan.lines).toEqual([]);
			expect(plan.leftOut).toEqual([{ name: "Trà sen", reason: "quantity" }]);
		} else {
			expect(plan.lines[0]?.quantity).toBe(kept);
			expect(plan.capped).toEqual(flag === null ? [] : ["Trà sen"]);
		}
	});

	it.each([
		["100 characters", "đ".repeat(100), "đ".repeat(100), false],
		["101 characters", "đ".repeat(101), null, true],
		["a control character", "ít\u0007đá", null, true],
		["a bidirectional override", "abc‮def", null, true],
		[
			"markup",
			'<img src=x onerror="alert(1)">',
			'<img src=x onerror="alert(1)">',
			false,
		],
		["spaces around", "  ít đá  ", "ít đá", false],
	] as const)("a note of %s", (_case, note, kept, dropped) => {
		const line = sold({
			itemId: TEA,
			sizeId: TEA_SIZE,
			itemName: "Trà sen",
			sizeLabel: null,
			note,
		});
		const plan = planReorder(order([line]), menu());
		expect(plan.lines[0]?.note).toBe(kept);
		expect(plan.notesDropped).toEqual(dropped ? ["Trà sen"] : []);
	});

	it("merges into a line of the basket up to 20, and caps above it", () => {
		const teaLine = (quantity: number) =>
			sold({
				itemId: TEA,
				sizeId: TEA_SIZE,
				itemName: "Trà sen",
				sizeLabel: null,
				quantity,
			});
		const holding = addToCart(
			EMPTY_CART,
			STORE,
			newLine({ quantity: 15 }),
		).cart;
		const at20 = applyReorder(
			holding,
			STORE,
			planReorder(order([teaLine(5)]), menu()),
			"add",
		);
		expect(at20.cart.lines[0]?.quantity).toBe(20);
		expect(at20.report.capped).toEqual([]);
		const at21 = applyReorder(
			holding,
			STORE,
			planReorder(order([teaLine(6)]), menu()),
			"add",
		);
		expect(at21.cart.lines[0]?.quantity).toBe(20);
		expect(at21.report.capped).toEqual(["Trà sen"]);
	});

	it("fills the basket to its 30th line and names what did not fit", () => {
		let cart: Cart = EMPTY_CART;
		for (let index = 0; index < 29; index += 1)
			cart = addToCart(cart, STORE, newLine({ note: `ly ${index}` })).cart;
		const two = planReorder(
			order([
				sold({
					itemId: CAKE,
					sizeId: CAKE_SIZE,
					itemName: "Bánh chuối",
					sizeLabel: null,
				}),
				COFFEE_LINE,
			]),
			menu(),
		);
		const result = applyReorder(cart, STORE, two, "add");
		expect(result.cart.lines).toHaveLength(30);
		expect(result.report.full).toEqual(["Cà phê sữa (Lớn)"]);
		// a line that did not fit is not reported for its note or its choice
		expect(result.report.notesDropped).toEqual([]);
	});
});

describe("orders of each kind (equivalence partitions)", () => {
	const lines = [
		COFFEE_LINE,
		sold({
			itemId: CAKE,
			sizeId: CAKE_SIZE,
			itemName: "Bánh chuối",
			sizeLabel: null,
		}),
	];
	it.each([
		[
			"at a table",
			{ type: "table", status: "completed", paymentStatus: "paid" },
		],
		[
			"taken away",
			{ type: "takeaway", status: "completed", paymentStatus: "paid" },
		],
		[
			"cancelled",
			{ type: "table", status: "cancelled", paymentStatus: "unpaid" },
		],
		[
			"cancelled and refunded",
			{ type: "table", status: "cancelled", paymentStatus: "refunded" },
		],
	] as const)("an order %s makes the same basket", (_case, kind) => {
		const plan = planReorder({ ...kind, lines } as unknown as Order, menu());
		expect(plan.lines.map((line) => [line.sizeId, line.quantity])).toEqual([
			[COFFEE_L, 2],
			[CAKE_SIZE, 1],
		]);
		expect(plan.leftOut).toEqual([]);
	});

	it.each([
		["the same store", "Cửa hàng Mẫu 1", true],
		["the same store with spaces around", "  Cửa hàng Mẫu 1 ", true],
		["another store", "Cửa hàng Mẫu 2", false],
	] as const)(
		"an order of %s may be ordered again: %s",
		(_case, name, same) => {
			const summary = { storeName: name } as Pick<OrderSummary, "storeName">;
			expect(sameStore(summary, menu())).toBe(same);
		},
	);
});

describe("the basket (state transitions)", () => {
	const plan = planReorder(order([COFFEE_LINE]), menu());

	it("empty → filled with the order's lines, in either mode", () => {
		for (const mode of ["replace", "add"] as const) {
			const result = applyReorder(EMPTY_CART, STORE, plan, mode);
			expect(result.cart.store).toBe(STORE);
			expect(cartCount(result.cart)).toBe(2);
			expect(reportIsEmpty(result.report)).toBe(true);
		}
	});

	it("holding items → replaced: only the order's lines remain", () => {
		const holding = addToCart(EMPTY_CART, STORE, newLine({ quantity: 3 })).cart;
		const result = applyReorder(holding, STORE, plan, "replace");
		expect(result.cart.lines.map((line) => line.itemId)).toEqual([COFFEE]);
	});

	it("holding items → added to: both stay, and the same choice merges", () => {
		const holding = addToCart(EMPTY_CART, STORE, newLine({ quantity: 3 })).cart;
		const added = applyReorder(holding, STORE, plan, "add");
		expect(added.cart.lines.map((line) => line.itemId)).toEqual([TEA, COFFEE]);
		const again = applyReorder(added.cart, STORE, plan, "add");
		expect(again.cart.lines).toHaveLength(2);
		expect(again.cart.lines[1]?.quantity).toBe(4);
	});

	it("a basket of another store → the plan's store only", () => {
		const elsewhere = addToCart(EMPTY_CART, "mau-2", newLine()).cart;
		const result = applyReorder(elsewhere, STORE, plan, "add");
		expect(result.cart.store).toBe(STORE);
		expect(result.cart.lines.map((line) => line.itemId)).toEqual([COFFEE]);
	});

	it("nothing to add → a report naming every line left out", () => {
		const gone = planReorder(
			order([
				sold({
					itemId: null,
					sizeId: null,
					itemName: "Bánh cũ",
					sizeLabel: null,
				}),
			]),
			menu(),
		);
		expect(gone.lines).toEqual([]);
		expect(reportOf(gone).leftOut).toEqual(["Bánh cũ"]);
		expect(reportIsEmpty(reportOf(gone))).toBe(false);
	});

	it("sends the rebuilt lines to the server without any price", () => {
		const cart = applyReorder(EMPTY_CART, STORE, plan, "replace").cart;
		expect(requestLines(cart)).toEqual([
			{ size: COFFEE_L, qty: 2, options: [ICE_LESS, SHOT], note: "ít ngọt" },
		]);
	});
});

describe("a basket line that lacks a required choice", () => {
	const coffee = (options: readonly string[]) =>
		newLine({
			itemId: COFFEE,
			itemName: "Cà phê sữa",
			sizeId: COFFEE_M,
			options: options.map((id) => ({ id, name: "", groupName: "", price: 0 })),
		});
	it.each([
		["every group satisfied", [ICE_NORMAL], null],
		["a required group empty", [], ICE],
		["a group above its limit", [ICE_NORMAL, ICE_LESS], ICE],
		["an item gone from the menu (the sold-out check's)", null, null],
	] as const)("%s → %s", (_case, options, group) => {
		const line =
			options === null
				? newLine({ itemId: "dddddddd-0000-4000-8000-000000000999" })
				: coffee(options);
		expect(choiceNeeded(line, menu())?.id ?? null).toBe(group);
	});
});
