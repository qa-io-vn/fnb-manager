import {
	MAX_LINE_QUANTITY,
	type Menu,
	type MenuItem,
	MIN_LINE_QUANTITY,
	type Order,
	type OrderSummary,
	type PricedLine,
} from "@fnb/zalo-mini/ordering";
import {
	addToCart,
	type Cart,
	type CartOption,
	cleanNote,
	groupsOf,
	type NewLine,
	noteProblem,
	selectionProblem,
} from "./cart";

// "Đặt lại" (design spec C14, GA-073): the lines of an earlier order made into a basket again from the menu the store
// answers now. Nothing of the order's money is used: each line takes the price of its size and options from the
// current menu, and the server prices the order again at placement. A line whose item, size or option is gone, or
// whose item is sold out, is left out and named. A group that became required takes the menu's default; without one
// the line goes into the basket and asks for the choice there. A note the basket would refuse now is dropped and
// named, and the basket's limits hold: 20 of a line, 30 lines.

export type LeftOutReason =
	| "item_gone"
	| "sold_out"
	| "size_gone"
	| "option_gone"
	| "quantity";

export interface LeftOut {
	/** the line's name as the order has it (the item's name when it was sold, with its size) */
	readonly name: string;
	readonly reason: LeftOutReason;
}

export interface ReorderPlan {
	/** the lines to put in the basket, priced from the current menu */
	readonly lines: readonly NewLine[];
	readonly leftOut: readonly LeftOut[];
	/** lines whose quantity was above the limit and is brought to it */
	readonly capped: readonly string[];
	/** lines whose note the basket would refuse now: they go in without it */
	readonly notesDropped: readonly string[];
	/** lines still lacking a required choice (a group with no default): the basket asks for it */
	readonly toChoose: readonly string[];
}

export type ReorderMode = "replace" | "add";

/** What the customer is told after "Đặt lại": each list names the lines it concerns. */
export interface ReorderReport {
	readonly leftOut: readonly string[];
	/** lines that did not fit: the basket already held 30 */
	readonly full: readonly string[];
	readonly capped: readonly string[];
	readonly notesDropped: readonly string[];
	readonly toChoose: readonly string[];
}

/** A line's name for the customer: the item, with its size when it has one. */
export function lineName(line: {
	readonly itemName: string;
	readonly sizeLabel: string | null;
}): string {
	return line.sizeLabel === null
		? line.itemName
		: `${line.itemName} (${line.sizeLabel})`;
}

function itemsOf(menu: Menu): ReadonlyMap<string, MenuItem> {
	const items = new Map<string, MenuItem>();
	for (const category of menu.categories)
		for (const item of category.items) items.set(item.id, item);
	return items;
}

type Rebuilt =
	| { readonly kind: "line"; readonly line: NewLine; readonly choose: boolean }
	| { readonly kind: "left"; readonly reason: LeftOutReason };

function rebuildLine(
	line: PricedLine,
	menu: Menu,
	items: ReadonlyMap<string, MenuItem>,
	unavailable: ReadonlySet<string>,
	quantity: number,
	note: string | null,
): Rebuilt {
	if (line.itemId === null || line.sizeId === null)
		return { kind: "left", reason: "item_gone" };
	if (
		unavailable.has(line.itemId) ||
		menu.unavailableItems.includes(line.itemId)
	)
		return { kind: "left", reason: "sold_out" };
	const item = items.get(line.itemId);
	if (item === undefined) return { kind: "left", reason: "item_gone" };
	const size = item.sizes.find((entry) => entry.id === line.sizeId);
	if (size === undefined) return { kind: "left", reason: "size_gone" };
	const groups = groupsOf(item, menu.optionGroups);
	const wanted = new Set(line.options.map((option) => option.optionId));
	const known = new Set(
		groups.flatMap((group) => group.options.map((option) => option.id)),
	);
	if ([...wanted].some((id) => !known.has(id)))
		return { kind: "left", reason: "option_gone" };
	const options: CartOption[] = [];
	let choose = false;
	for (const group of groups) {
		const chosen = group.options.filter((option) => wanted.has(option.id));
		if (chosen.length < group.minSelect) {
			// a group that became required: the menu's defaults fill it, within its limit
			const room = Math.min(group.minSelect, group.maxSelect) - chosen.length;
			const defaults = group.options
				.filter((option) => option.isDefault && !wanted.has(option.id))
				.slice(0, Math.max(0, room));
			chosen.push(...defaults);
		}
		const ids = chosen.map((option) => option.id);
		if (selectionProblem(group, ids) !== null) choose = true;
		for (const option of group.options)
			if (ids.includes(option.id))
				options.push({
					id: option.id,
					name: option.name,
					groupName: group.name,
					price: option.priceDelta,
				});
	}
	return {
		kind: "line",
		line: {
			itemId: item.id,
			itemName: item.name,
			sizeId: size.id,
			sizeLabel: size.label,
			unitPrice: size.price,
			options,
			quantity,
			note,
			countsForStamps: item.countsForStamps,
		},
		choose,
	};
}

/**
 * The basket an order makes against the current menu. `unavailable` holds the items the store does not sell now
 * besides the menu's own list (the version poll's sold-out items). The order's prices are never read.
 */
export function planReorder(
	order: Pick<Order, "lines">,
	menu: Menu,
	unavailable: ReadonlySet<string> = new Set(),
): ReorderPlan {
	const items = itemsOf(menu);
	const lines: NewLine[] = [];
	const leftOut: LeftOut[] = [];
	const capped: string[] = [];
	const notesDropped: string[] = [];
	const toChoose: string[] = [];
	for (const line of order.lines) {
		if (!Number.isInteger(line.quantity) || line.quantity < MIN_LINE_QUANTITY) {
			leftOut.push({ name: lineName(line), reason: "quantity" });
			continue;
		}
		const quantity = Math.min(line.quantity, MAX_LINE_QUANTITY);
		const refusedNote = line.note !== null && noteProblem(line.note) !== null;
		const note =
			line.note === null || refusedNote ? null : cleanNote(line.note);
		const rebuilt = rebuildLine(line, menu, items, unavailable, quantity, note);
		if (rebuilt.kind === "left") {
			leftOut.push({ name: lineName(line), reason: rebuilt.reason });
			continue;
		}
		const name = lineName(rebuilt.line);
		lines.push(rebuilt.line);
		if (line.quantity > MAX_LINE_QUANTITY) capped.push(name);
		if (refusedNote) notesDropped.push(name);
		if (rebuilt.choose) toChoose.push(name);
	}
	return { lines, leftOut, capped, notesDropped, toChoose };
}

/**
 * Puts the plan in the basket: in place of what it holds ("replace") or with it ("add"). The basket's own rules
 * apply: the same choice merges and stops at 20 ("capped"), a 31st line does not fit ("full"), and a basket of another
 * store is emptied first.
 */
export function applyReorder(
	cart: Cart,
	store: string,
	plan: ReorderPlan,
	mode: ReorderMode,
): { readonly cart: Cart; readonly report: ReorderReport } {
	let next: Cart =
		mode === "replace" || cart.store !== store ? { store, lines: [] } : cart;
	const leftOut = plan.leftOut.map((entry) => entry.name);
	const full: string[] = [];
	const capped = [...plan.capped];
	const added = new Set<string>();
	for (const line of plan.lines) {
		const name = lineName(line);
		const result = addToCart(next, store, line);
		if (result.outcome === "full") {
			full.push(name);
			continue;
		}
		if (result.outcome === "invalid") {
			leftOut.push(name);
			continue;
		}
		if (result.outcome === "capped" && !capped.includes(name))
			capped.push(name);
		added.add(name);
		next = result.cart;
	}
	return {
		cart: next,
		report: {
			leftOut,
			full,
			capped,
			notesDropped: plan.notesDropped.filter((name) => added.has(name)),
			toChoose: plan.toChoose.filter((name) => added.has(name)),
		},
	};
}

/** The report of a plan that put nothing in the basket (every line left out). */
export function reportOf(plan: ReorderPlan): ReorderReport {
	return {
		leftOut: plan.leftOut.map((entry) => entry.name),
		full: [],
		capped: [],
		notesDropped: [],
		toChoose: [],
	};
}

export function reportIsEmpty(report: ReorderReport): boolean {
	return (
		report.leftOut.length === 0 &&
		report.full.length === 0 &&
		report.capped.length === 0 &&
		report.notesDropped.length === 0 &&
		report.toChoose.length === 0
	);
}

/**
 * Whether an order of the history was placed at the store the app orders from now. customer_orders names the store
 * only by its name (no code), so the names are compared; see the server gap in the README.
 */
export function sameStore(
	order: Pick<OrderSummary, "storeName">,
	menu: Pick<Menu, "store">,
): boolean {
	return order.storeName.trim() === menu.store.name.trim();
}
