import {
	type AnalyticsRow,
	difference,
	relativeChange,
	type ThemeRow,
} from "@fnb/reports";
import { scopedKey } from "../calls.js";
import type { PackScope } from "../coverage.js";
import type { PackTable } from "../schema.js";
import {
	byNumberDescending,
	byText,
	columns,
	type PackRows,
	packRow,
	packTable,
	rankKey,
	ratioOf,
	sumOf,
	type TableContext,
	type TableSpec,
} from "./support.js";

type ItemRow = AnalyticsRow<"item_summary">;
type MarginRow = ThemeRow<"item_margins">;

export const ITEM_LIMIT = 10;
export const CATEGORY_LIMIT = 10;
export const SIZE_LIMIT = 6;

export const ITEMS_SPEC: TableSpec = {
	grain: "item-period",
	window: "w28",
	columns: columns([
		["name", "text"],
		["role", "class"],
		["qty", "quantity"],
		["net", "money"],
		["share", "fraction"],
		["net_change", "rel_change"],
		["first_sold", "date"],
		["margin_rate", "fraction"],
	]),
};

export const CATEGORIES_SPEC: TableSpec = {
	grain: "category-period",
	window: "w28",
	columns: columns([
		["name", "text"],
		["items", "count"],
		["qty", "quantity"],
		["net", "money"],
		["share", "fraction"],
		["net_change", "rel_change"],
	]),
};

export const SIZES_SPEC: TableSpec = {
	grain: "size-period",
	window: "w28",
	columns: columns([
		["size", "text"],
		["qty", "quantity"],
		["net", "money"],
		["qty_share", "fraction"],
		["qty_share_change", "pp_change"],
	]),
};

export function byItemOrder(left: ItemRow, right: ItemRow): number {
	return (
		byNumberDescending(left.net_amount, right.net_amount) ||
		byNumberDescending(left.quantity, right.quantity) ||
		byText(left.item_name, right.item_name) ||
		byText(left.item_external_id, right.item_external_id)
	);
}

function soldInWindow(row: ItemRow): boolean {
	return row.quantity !== 0 || row.net_amount !== 0;
}

export function scopeItems(
	context: TableContext,
	scope: PackScope,
): readonly ItemRow[] {
	return [
		...context.results.rows(scopedKey("items", scope), "item_summary"),
	].sort(byItemOrder);
}

export function scopeMargins(
	context: TableContext,
	scope: PackScope,
): readonly MarginRow[] {
	return [
		...context.results.rows(scopedKey("margins", scope), "item_margins"),
	].sort(
		(left, right) =>
			byNumberDescending(left.net_amount, right.net_amount) ||
			byText(left.item_external_id, right.item_external_id),
	);
}

export function itemsTable(context: TableContext): PackTable {
	const rows: PackRows = {};
	for (const scope of context.scopes) {
		const margins = new Map(
			scopeMargins(context, scope).map((row) => [row.item_external_id, row]),
		);
		const kept = scopeItems(context, scope)
			.filter(soldInWindow)
			.slice(0, ITEM_LIMIT);
		kept.forEach((item, index) => {
			rows[rankKey(scope.label, index, kept.length)] = packRow(
				ITEMS_SPEC,
				[
					item.item_name,
					item.role,
					item.quantity,
					item.net_amount,
					item.net_share,
					relativeChange(item.net_amount, item.compare_net_amount),
					item.first_sold_on,
					margins.get(item.item_external_id)?.margin_rate ?? null,
				],
				context.request.currency,
			);
		});
	}
	return packTable("items", context, ITEMS_SPEC, rows);
}

interface Group {
	readonly name: string | null;
	items: number;
	quantity: number;
	net: number;
	compareQuantity: number;
	compareNet: number;
}

function grouped(
	items: readonly ItemRow[],
	nameOf: (row: ItemRow) => string | null,
	include: (row: ItemRow) => boolean,
): Group[] {
	const groups = new Map<string | null, Group>();
	for (const row of items) {
		if (!include(row)) continue;
		const name = nameOf(row);
		const group = groups.get(name) ?? {
			name,
			items: 0,
			quantity: 0,
			net: 0,
			compareQuantity: 0,
			compareNet: 0,
		};
		if (soldInWindow(row)) group.items += 1;
		group.quantity += row.quantity;
		group.net += row.net_amount;
		group.compareQuantity += row.compare_quantity ?? 0;
		group.compareNet += row.compare_net_amount ?? 0;
		groups.set(name, group);
	}
	return [...groups.values()];
}

export function categoriesTable(context: TableContext): PackTable {
	const rows: PackRows = {};
	for (const scope of context.scopes) {
		const items = scopeItems(context, scope);
		const itemNet = sumOf(items.map((row) => row.net_amount));
		const kept = grouped(
			items,
			(row) => row.item_type_name,
			() => true,
		)
			.filter((group) => group.items > 0)
			.sort(
				(left, right) =>
					byNumberDescending(left.net, right.net) ||
					byNumberDescending(left.quantity, right.quantity) ||
					byText(left.name, right.name),
			)
			.slice(0, CATEGORY_LIMIT);
		kept.forEach((group, index) => {
			rows[rankKey(scope.label, index, kept.length)] = packRow(
				CATEGORIES_SPEC,
				[
					group.name,
					group.items,
					group.quantity,
					group.net,
					ratioOf(group.net, itemNet),
					relativeChange(group.net, group.compareNet),
				],
				context.request.currency,
			);
		});
	}
	return packTable("categories", context, CATEGORIES_SPEC, rows);
}

export function sizesTable(context: TableContext): PackTable {
	const rows: PackRows = {};
	for (const scope of context.scopes) {
		const sizes = grouped(
			scopeItems(context, scope),
			(row) => row.size_label,
			(row) => row.size_label !== null,
		);
		const quantity = sumOf(sizes.map((group) => group.quantity));
		const compareQuantity = sumOf(sizes.map((group) => group.compareQuantity));
		const kept = sizes
			.filter((group) => group.quantity !== 0)
			.sort(
				(left, right) =>
					byNumberDescending(left.quantity, right.quantity) ||
					byNumberDescending(left.net, right.net) ||
					byText(left.name, right.name),
			)
			.slice(0, SIZE_LIMIT);
		kept.forEach((group, index) => {
			const share = ratioOf(group.quantity, quantity);
			rows[rankKey(scope.label, index, kept.length)] = packRow(
				SIZES_SPEC,
				[
					group.name,
					group.quantity,
					group.net,
					share,
					difference(share, ratioOf(group.compareQuantity, compareQuantity)),
				],
				context.request.currency,
			);
		});
	}
	return packTable("sizes", context, SIZES_SPEC, rows);
}
