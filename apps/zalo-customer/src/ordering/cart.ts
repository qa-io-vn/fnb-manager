import {
	LINE_NOTE_MAX,
	MAX_CART_LINES,
	MAX_LINE_QUANTITY,
	type Menu,
	type MenuItem,
	MIN_LINE_QUANTITY,
	type OptionGroup,
	type PlaceRequest,
} from "@fnb/zalo-mini/ordering";

// The basket of the customer app (design spec C03, C04; native-till.md 5.3). It lives in memory only, for one store,
// and never prices an order: the prices it holds are the menu's, to show a total before the server's check, and the
// server prices the order again from its own menu at placement. Its limits are the database's (app.order_lines_valid):
// 1 to 20 of a line, 30 lines, a line note of at most 100 characters without a control character.

export interface CartOption {
	readonly id: string;
	readonly name: string;
	readonly groupName: string;
	readonly price: number;
}

export interface CartLine {
	readonly key: string;
	readonly itemId: string;
	readonly itemName: string;
	readonly sizeId: string;
	readonly sizeLabel: string | null;
	readonly unitPrice: number;
	readonly options: readonly CartOption[];
	readonly quantity: number;
	readonly note: string | null;
	readonly countsForStamps: boolean;
}

export interface Cart {
	readonly store: string | null;
	readonly lines: readonly CartLine[];
}

export const EMPTY_CART: Cart = { store: null, lines: [] };

export type NewLine = Omit<CartLine, "key">;

export type AddOutcome = "added" | "merged" | "capped" | "full" | "invalid";

export type NoteProblem = "too_long" | "control" | null;

/** A control character or a bidirectional override, which the database refuses in a note (app.order_text_ok). */
export function hasForbiddenCharacter(text: string): boolean {
	for (const character of text) {
		const code = character.codePointAt(0) ?? 0;
		if (
			code <= 0x1f ||
			(code >= 0x7f && code <= 0x9f) ||
			code === 0x200e ||
			code === 0x200f ||
			(code >= 0x202a && code <= 0x202e) ||
			(code >= 0x2066 && code <= 0x2069)
		)
			return true;
	}
	return false;
}

/** The number of characters as Postgres counts them (code points), so the app's limit is the server's. */
export function characterCount(text: string): number {
	return [...text].length;
}

export function noteProblem(
	note: string,
	max: number = LINE_NOTE_MAX,
): NoteProblem {
	const trimmed = note.trim();
	if (hasForbiddenCharacter(trimmed)) return "control";
	if (characterCount(trimmed) > max) return "too_long";
	return null;
}

/** A note as the order sends it: trimmed, and null when empty. */
export function cleanNote(note: string): string | null {
	const trimmed = note.trim();
	return trimmed === "" ? null : trimmed;
}

export function validQuantity(quantity: number): boolean {
	return (
		Number.isInteger(quantity) &&
		quantity >= MIN_LINE_QUANTITY &&
		quantity <= MAX_LINE_QUANTITY
	);
}

function sameChoice(a: NewLine, b: NewLine): boolean {
	if (a.sizeId !== b.sizeId || a.note !== b.note) return false;
	const left = a.options.map((option) => option.id).sort();
	const right = b.options.map((option) => option.id).sort();
	return (
		left.length === right.length &&
		left.every((value, index) => value === right[index])
	);
}

let nextKey = 0;

function newKey(): string {
	nextKey += 1;
	return `line-${nextKey}`;
}

/**
 * Adds a line: the same size with the same options and note adds to the line already there (up to 20, "capped" when
 * it reached it), another choice makes a new line unless the basket holds 30 ("full"). A line of another store
 * empties the basket first. A quantity outside 1 to 20 or a note the server would refuse is "invalid".
 */
export function addToCart(
	cart: Cart,
	store: string,
	line: NewLine,
): { readonly cart: Cart; readonly outcome: AddOutcome } {
	if (
		!validQuantity(line.quantity) ||
		(line.note !== null && noteProblem(line.note) !== null)
	) {
		return { cart, outcome: "invalid" };
	}
	const base = cart.store === store ? cart : { store, lines: [] };
	const same = base.lines.find((entry) => sameChoice(entry, line));
	if (same !== undefined) {
		const wanted = same.quantity + line.quantity;
		const quantity = Math.min(wanted, MAX_LINE_QUANTITY);
		return {
			cart: {
				store,
				lines: base.lines.map((entry) =>
					entry.key === same.key ? { ...entry, quantity } : entry,
				),
			},
			outcome: wanted > MAX_LINE_QUANTITY ? "capped" : "merged",
		};
	}
	if (base.lines.length >= MAX_CART_LINES) return { cart, outcome: "full" };
	return {
		cart: { store, lines: [...base.lines, { ...line, key: newKey() }] },
		outcome: "added",
	};
}

/** Replaces a line edited on the item screen; the same choice as another line merges into it. */
export function replaceLine(cart: Cart, key: string, line: NewLine): Cart {
	if (
		!validQuantity(line.quantity) ||
		(line.note !== null && noteProblem(line.note) !== null)
	) {
		return cart;
	}
	const others = cart.lines.filter((entry) => entry.key !== key);
	const same = others.find((entry) => sameChoice(entry, line));
	if (same !== undefined) {
		return {
			...cart,
			lines: others.map((entry) =>
				entry.key === same.key
					? {
							...entry,
							quantity: Math.min(
								entry.quantity + line.quantity,
								MAX_LINE_QUANTITY,
							),
						}
					: entry,
			),
		};
	}
	return {
		...cart,
		lines: cart.lines.map((entry) =>
			entry.key === key ? { ...line, key } : entry,
		),
	};
}

/** Sets the quantity of a line to a whole number from 1 to 20; anything else leaves the basket as it is. */
export function setQuantity(cart: Cart, key: string, quantity: number): Cart {
	if (!validQuantity(quantity)) return cart;
	return {
		...cart,
		lines: cart.lines.map((line) =>
			line.key === key ? { ...line, quantity } : line,
		),
	};
}

export function removeLine(cart: Cart, key: string): Cart {
	return { ...cart, lines: cart.lines.filter((line) => line.key !== key) };
}

export function lineUnit(
	line: Pick<CartLine, "unitPrice" | "options">,
): number {
	return line.unitPrice + line.options.reduce((sum, o) => sum + o.price, 0);
}

export function lineTotal(line: CartLine): number {
	return line.quantity * lineUnit(line);
}

export function cartCount(cart: Cart): number {
	return cart.lines.reduce((sum, line) => sum + line.quantity, 0);
}

export function cartSubtotal(cart: Cart): number {
	return cart.lines.reduce((sum, line) => sum + lineTotal(line), 0);
}

/** The lines whose item the store no longer sells (sold out, not offered): they block the order (criterion 2). */
export function unavailableLines(
	cart: Cart,
	unavailable: ReadonlySet<string>,
): readonly CartLine[] {
	return cart.lines.filter((line) => unavailable.has(line.itemId));
}

export interface PriceChange {
	readonly key: string;
	readonly itemName: string;
	readonly before: number;
	readonly after: number;
}

/**
 * The basket against a menu the server answered again: the prices of each line from the new menu (size and options),
 * which lines changed price, and the items gone from it (not listed any more, or listed as unavailable).
 */
export function againstMenu(
	cart: Cart,
	menu: Menu,
): {
	readonly cart: Cart;
	readonly changes: readonly PriceChange[];
	readonly gone: ReadonlySet<string>;
} {
	const sizes = new Map<string, { item: MenuItem; price: number }>();
	for (const category of menu.categories) {
		for (const item of category.items) {
			for (const size of item.sizes)
				sizes.set(size.id, { item, price: size.price });
		}
	}
	const optionPrices = new Map<string, number>();
	for (const group of menu.optionGroups) {
		for (const option of group.options)
			optionPrices.set(option.id, option.priceDelta);
	}
	const gone = new Set<string>(menu.unavailableItems);
	const changes: PriceChange[] = [];
	const lines = cart.lines.map((line) => {
		const found = sizes.get(line.sizeId);
		if (found === undefined) {
			gone.add(line.itemId);
			return line;
		}
		const options = line.options.map((option) => ({
			...option,
			price: optionPrices.get(option.id) ?? option.price,
		}));
		const repriced = { ...line, unitPrice: found.price, options };
		const before = lineUnit(line);
		const after = lineUnit(repriced);
		if (before !== after)
			changes.push({ key: line.key, itemName: line.itemName, before, after });
		return repriced;
	});
	return { cart: { ...cart, lines }, changes, gone };
}

/** The lines as customer_place_order and customer_check_cart take them: no price, the server prices them. */
export function requestLines(cart: Cart): PlaceRequest["lines"] {
	return cart.lines.map((line) => ({
		size: line.sizeId,
		qty: line.quantity,
		...(line.options.length === 0
			? {}
			: { options: line.options.map((option) => option.id) }),
		...(line.note === null ? {} : { note: line.note }),
	}));
}

export type SelectionProblem = "missing" | "too_many" | null;

export function selectionProblem(
	group: OptionGroup,
	chosen: readonly string[],
): SelectionProblem {
	const count = chosen.filter((id) =>
		group.options.some((option) => option.id === id),
	).length;
	if (count < group.minSelect) return "missing";
	if (count > group.maxSelect) return "too_many";
	return null;
}

/** The size and options an item screen starts with: the default size, and each group's defaults within its limit. */
export function defaultChoice(
	item: MenuItem,
	groups: readonly OptionGroup[],
): {
	readonly sizeId: string;
	readonly options: Readonly<Record<string, readonly string[]>>;
} {
	const size = item.sizes.find((entry) => entry.isDefault) ?? item.sizes[0];
	const options: Record<string, readonly string[]> = {};
	for (const group of groups) {
		options[group.id] = group.options
			.filter((option) => option.isDefault)
			.slice(0, group.maxSelect)
			.map((option) => option.id);
	}
	return { sizeId: size?.id ?? "", options };
}

/** The option groups of an item, in the order the item lists them. */
export function groupsOf(
	item: MenuItem,
	groups: readonly OptionGroup[],
): readonly OptionGroup[] {
	return item.optionGroupIds.flatMap((id) => {
		const group = groups.find((entry) => entry.id === id);
		return group === undefined ? [] : [group];
	});
}
