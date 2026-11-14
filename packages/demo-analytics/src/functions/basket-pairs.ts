import type { ThemeRow } from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import { PAIR_SEPARATOR } from "../ingest.js";
import { count } from "../pg-numeric.js";
import { byteOrder } from "../text-order.js";
import {
	invalidTheme,
	requireThemeDateRange,
	requireThemeRows,
	requireThemeStoreIds,
	type ThemeHandlerArgs,
	type ThemeHandlerContext,
} from "./theme-support.js";

type Row = ThemeRow<"basket_pairs">;

export const BASKET_PAIRS_MAX_DAYS = 92;
const DEFAULT_MIN_PAIR_INVOICES = 3;
const DEFAULT_MAX_PAIRS = 50;

function maxText(left: string | null, right: string | null): string | null {
	if (left === null) return right;
	if (right === null) return left;
	return right > left ? right : left;
}

export function basketPairs(
	store: AggregateStore,
	args: ThemeHandlerArgs<"basket_pairs">,
	_context: ThemeHandlerContext,
): Row[] {
	requireThemeStoreIds("basket_pairs", args.store_ids);
	requireThemeDateRange(
		"basket_pairs",
		args.from_date,
		args.to_date,
		BASKET_PAIRS_MAX_DAYS,
	);
	const minPairs = args.min_pair_invoices ?? DEFAULT_MIN_PAIR_INVOICES;
	const maxPairs = args.max_pairs ?? DEFAULT_MAX_PAIRS;
	if (minPairs < 1 || minPairs > 50) {
		invalidTheme(
			"basket_pairs",
			"basket_pairs needs min_pair_invoices between 1 and 50",
		);
	}
	if (maxPairs < 1 || maxPairs > 900) {
		invalidTheme(
			"basket_pairs",
			"basket_pairs needs max_pairs between 1 and 900",
		);
	}
	if (args.store_ids.length === 0) return [];
	let windowInvoices = 0;
	const itemInvoices = new Map<string, number>();
	const names = new Map<string, string | null>();
	const pairs = new Map<string, number>();
	for (const entry of store.visibleStores(args.store_ids)) {
		for (const day of store.daysOf(entry, args.from_date, args.to_date)) {
			windowInvoices += day.invoicesWithItems;
			for (const item of day.items) {
				itemInvoices.set(
					item.itemExternalId,
					(itemInvoices.get(item.itemExternalId) ?? 0) + item.invoices,
				);
				names.set(
					item.itemExternalId,
					maxText(names.get(item.itemExternalId) ?? null, item.itemName),
				);
			}
			for (const [key, together] of day.pairs) {
				pairs.set(key, (pairs.get(key) ?? 0) + together);
			}
		}
	}
	const total = count(windowInvoices);
	const scored = [...pairs.entries()]
		.filter(([, together]) => together >= minPairs)
		.map(([key, together]) => {
			const [itemA, itemB] = key.split(PAIR_SEPARATOR) as [string, string];
			const invoicesA = itemInvoices.get(itemA) ?? 0;
			const invoicesB = itemInvoices.get(itemB) ?? 0;
			const pairShare = count(together).div(total);
			const shareA = count(invoicesA).div(total);
			const shareB = count(invoicesB).div(total);
			const lift = pairShare.div(shareA.mul(shareB)).round(4);
			return { itemA, itemB, together, invoicesA, invoicesB, lift };
		})
		.sort(
			(left, right) =>
				right.together - left.together ||
				right.lift.compare(left.lift) ||
				byteOrder(left.itemA, right.itemA) ||
				byteOrder(left.itemB, right.itemB),
		)
		.slice(0, maxPairs);
	const rows: Row[] = scored.map((pair) => ({
		item_a_external_id: pair.itemA,
		item_a_name: names.get(pair.itemA) ?? null,
		item_b_external_id: pair.itemB,
		item_b_name: names.get(pair.itemB) ?? null,
		pair_invoices: pair.together,
		invoices_a: pair.invoicesA,
		invoices_b: pair.invoicesB,
		window_invoices: windowInvoices,
		support_a: count(pair.invoicesA).div(total).round(6).toNumber(),
		support_b: count(pair.invoicesB).div(total).round(6).toNumber(),
		confidence_a_to_b: count(pair.together)
			.div(count(pair.invoicesA))
			.round(6)
			.toNumber(),
		confidence_b_to_a: count(pair.together)
			.div(count(pair.invoicesB))
			.round(6)
			.toNumber(),
		lift: pair.lift.toNumber(),
	}));
	requireThemeRows("basket_pairs", rows.length);
	return rows;
}
