import type { ThemeRow } from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import { count, roundedRatio } from "../pg-numeric.js";
import { byteOrder } from "../text-order.js";
import {
	requireThemeDateRange,
	requireThemeRows,
	requireThemeStoreIds,
	type ThemeHandlerArgs,
	type ThemeHandlerContext,
} from "./theme-support.js";

type Row = ThemeRow<"item_attach">;

export const ITEM_ATTACH_MAX_DAYS = 92;

interface Counts {
	name: string | null;
	drinks: number;
	toppingBase: number;
	withTopping: number;
	snackBase: number;
	withSnack: number;
}

function emptyCounts(): Counts {
	return {
		name: null,
		drinks: 0,
		toppingBase: 0,
		withTopping: 0,
		snackBase: 0,
		withSnack: 0,
	};
}

function maxText(left: string | null, right: string | null): string | null {
	if (left === null) return right;
	if (right === null) return left;
	return right > left ? right : left;
}

function rowOf(key: string | null, counts: Counts): Row {
	return {
		item_external_id: key,
		item_name: counts.name,
		drink_invoices: counts.drinks,
		topping_base_invoices: counts.toppingBase,
		topping_invoices: counts.withTopping,
		snack_base_invoices: counts.snackBase,
		snack_invoices: counts.withSnack,
		topping_rate: roundedRatio(
			count(counts.withTopping),
			counts.toppingBase === 0 ? null : count(counts.toppingBase),
			6,
		),
		snack_rate: roundedRatio(
			count(counts.withSnack),
			counts.snackBase === 0 ? null : count(counts.snackBase),
			6,
		),
	};
}

export function itemAttach(
	store: AggregateStore,
	args: ThemeHandlerArgs<"item_attach">,
	_context: ThemeHandlerContext,
): Row[] {
	requireThemeStoreIds("item_attach", args.store_ids);
	requireThemeDateRange(
		"item_attach",
		args.from_date,
		args.to_date,
		ITEM_ATTACH_MAX_DAYS,
	);
	if (args.store_ids.length === 0) return [];
	const mappings = store.mappings();
	const summary = emptyCounts();
	const drinks = new Map<string, Counts>();
	for (const entry of store.visibleStores(args.store_ids)) {
		const account = mappings.accountOf(entry.id);
		const mapsTopping = mappings.mapsRole(account, "topping");
		const mapsSnack = mappings.mapsRole(account, "snack");
		for (const day of store.daysOf(entry, args.from_date, args.to_date)) {
			if (day.attach !== null) {
				summary.drinks += day.attach.drinkInvoices;
				if (mapsTopping) {
					summary.toppingBase += day.attach.drinkInvoices;
					summary.withTopping += day.attach.toppingInvoices;
				}
				if (mapsSnack) {
					summary.snackBase += day.attach.drinkInvoices;
					summary.withSnack += day.attach.snackInvoices;
				}
			}
			for (const drink of day.drinks) {
				const known = drinks.get(drink.itemExternalId) ?? emptyCounts();
				known.name = maxText(known.name, drink.itemName);
				known.drinks += drink.drinkInvoices;
				if (mapsTopping) {
					known.toppingBase += drink.drinkInvoices;
					known.withTopping += drink.toppingInvoices;
				}
				if (mapsSnack) {
					known.snackBase += drink.drinkInvoices;
					known.withSnack += drink.snackInvoices;
				}
				drinks.set(drink.itemExternalId, known);
			}
		}
	}
	const rows = [
		rowOf(null, summary),
		...[...drinks.entries()]
			.sort(
				([leftKey, left], [rightKey, right]) =>
					right.drinks - left.drinks || byteOrder(leftKey, rightKey),
			)
			.map(([key, counts]) => rowOf(key, counts)),
	];
	requireThemeRows("item_attach", rows.length);
	return rows;
}
