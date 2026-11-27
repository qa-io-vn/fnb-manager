import type { CounterMenuItem, OptionGroup } from "../menu/menu-api";

/**
 * The ticket of an order keyed at the counter (Q01), before the server prices it. Prices here are only for the screen:
 * the server prices every line from the menu (counter_create_order) and refuses a different total as price_changed.
 */

export const MAX_QTY = 20;
export const MAX_LINES = 30;
export const NOTE_MAX = 100;
export const ORDER_NOTE_MAX = 200;

export interface DraftOption {
	readonly id: string;
	readonly name: string;
	readonly price: number;
}

export interface DraftLine {
	readonly key: string;
	readonly itemId: string;
	readonly itemName: string;
	readonly sizeId: string;
	readonly sizeLabel: string | null;
	readonly unitPrice: number;
	readonly options: readonly DraftOption[];
	readonly qty: number;
	readonly note: string;
}

export interface Draft {
	readonly requestId: string;
	readonly type: "table" | "takeaway";
	readonly tableId: string | null;
	readonly lines: readonly DraftLine[];
	readonly note: string;
}

export function emptyDraft(requestId: string): Draft {
	return { requestId, type: "table", tableId: null, lines: [], note: "" };
}

/** The same item, size, options and note make one line whose quantity grows. */
export function lineKey(
	sizeId: string,
	options: readonly DraftOption[],
	note: string,
): string {
	return [
		sizeId,
		...options.map((option) => option.id).sort(),
		note.trim(),
	].join("|");
}

export function lineTotal(
	line: Pick<DraftLine, "qty" | "unitPrice" | "options">,
): number {
	return (
		line.qty *
		(line.unitPrice +
			line.options.reduce((sum, option) => sum + option.price, 0))
	);
}

export function draftTotal(draft: Draft): number {
	return draft.lines.reduce((sum, line) => sum + lineTotal(line), 0);
}

export function itemCount(draft: Draft, itemId: string): number {
	return draft.lines
		.filter((line) => line.itemId === itemId)
		.reduce((sum, line) => sum + line.qty, 0);
}

/** Adds a line (or more of the same line), never past MAX_QTY on a line nor MAX_LINES lines. */
export function addLine(draft: Draft, line: Omit<DraftLine, "key">): Draft {
	const key = lineKey(line.sizeId, line.options, line.note);
	const held = draft.lines.find((candidate) => candidate.key === key);
	if (held !== undefined) {
		return setQty(draft, key, held.qty + line.qty);
	}
	if (draft.lines.length >= MAX_LINES || line.qty < 1) return draft;
	return {
		...draft,
		lines: [
			...draft.lines,
			{
				...line,
				key,
				qty: Math.min(MAX_QTY, line.qty),
				note: line.note.trim(),
			},
		],
	};
}

/** A quantity of 0 removes the line; above MAX_QTY is held at MAX_QTY. */
export function setQty(draft: Draft, key: string, qty: number): Draft {
	if (qty <= 0)
		return { ...draft, lines: draft.lines.filter((line) => line.key !== key) };
	return {
		...draft,
		lines: draft.lines.map((line) =>
			line.key === key
				? { ...line, qty: Math.min(MAX_QTY, Math.trunc(qty)) }
				: line,
		),
	};
}

export function setType(draft: Draft, type: Draft["type"]): Draft {
	return {
		...draft,
		type,
		tableId: type === "takeaway" ? null : draft.tableId,
	};
}

/** What may be sent: lines, a table for a table order. */
export function draftReady(draft: Draft): boolean {
	return (
		draft.lines.length > 0 &&
		(draft.type === "takeaway" || draft.tableId !== null)
	);
}

/** The request of counter_create_order: ids, quantities, options and notes, and the total the screen showed. */
export function requestOf(draft: Draft): Record<string, unknown> {
	const note = draft.note.trim();
	return {
		request_id: draft.requestId,
		type: draft.type,
		...(draft.type === "table" && draft.tableId !== null
			? { table_id: draft.tableId }
			: {}),
		lines: draft.lines.map((line) => ({
			size: line.sizeId,
			qty: line.qty,
			options: line.options.map((option) => option.id),
			...(line.note === ""
				? {}
				: { note: [...line.note].slice(0, NOTE_MAX).join("") }),
		})),
		...(note === ""
			? {}
			: { note: [...note].slice(0, ORDER_NOTE_MAX).join("") }),
		expected_total: draftTotal(draft),
	};
}

/** Whether the choices of each option group are within its minimum and maximum. */
export function optionsValid(
	groups: readonly OptionGroup[],
	chosen: ReadonlySet<string>,
): boolean {
	return groups.every((group) => {
		const count = group.options.filter((option) =>
			chosen.has(option.id),
		).length;
		return count >= group.min_select && count <= group.max_select;
	});
}

/** The defaults of an item's groups, as the options dialog starts. */
export function defaultOptions(groups: readonly OptionGroup[]): Set<string> {
	return new Set(
		groups.flatMap((group) =>
			group.options
				.filter((option) => option.is_default)
				.map((option) => option.id),
		),
	);
}

/** Toggles an option: in a group of at most one, choosing another replaces it. */
export function toggleOption(
	group: OptionGroup,
	chosen: ReadonlySet<string>,
	optionId: string,
): Set<string> {
	const next = new Set(chosen);
	if (next.has(optionId)) {
		next.delete(optionId);
		return next;
	}
	if (group.max_select === 1) {
		for (const option of group.options) next.delete(option.id);
	} else if (
		group.options.filter((option) => next.has(option.id)).length >=
		group.max_select
	) {
		return next;
	}
	next.add(optionId);
	return next;
}

/** An item needs the options dialog when it has more than one size or any option group. */
export function needsChoices(item: CounterMenuItem): boolean {
	return item.sizes.length > 1 || item.option_group_ids.length > 0;
}
