import type { ThemeRow } from "@fnb/reports";
import { money, quantity } from "../pg-numeric.js";
import { byteOrder } from "../text-order.js";
import { demoItemCatalogue } from "./catalogue.js";
import { CostBook, effectiveItemTypes } from "./menu-support.js";
import {
	requireThemeDateRange,
	requireThemeRows,
	requireThemeStoreIds,
	type ThemeHandler,
} from "./theme-support.js";

export const DATA_QUALITY_ITEMS_MAX_DAYS = 400;

type Row = ThemeRow<"data_quality_items">;

interface Sold {
	readonly key: string;
	readonly stores: Set<string>;
	name: string | null;
	posType: string | null;
	posTypeName: string | null;
	quantityMilli: number;
	netMinor: number;
}

function maxText(left: string | null, right: string | null): string | null {
	if (left === null) return right;
	if (right === null) return left;
	return byteOrder(right, left) > 0 ? right : left;
}

export const dataQualityItems: ThemeHandler<"data_quality_items"> = (
	store,
	args,
	context,
) => {
	requireThemeStoreIds("data_quality_items", args.store_ids);
	requireThemeDateRange(
		"data_quality_items",
		args.from_date,
		args.to_date,
		DATA_QUALITY_ITEMS_MAX_DAYS,
	);
	const visible = store.visibleStores(args.store_ids);
	const sold = new Map<string, Sold>();
	for (const definition of visible) {
		for (const day of store.daysOf(definition, args.from_date, args.to_date)) {
			for (const item of day.items) {
				let entry = sold.get(item.itemExternalId);
				if (entry === undefined) {
					entry = {
						key: item.itemExternalId,
						stores: new Set(),
						name: null,
						posType: null,
						posTypeName: null,
						quantityMilli: 0,
						netMinor: 0,
					};
					sold.set(item.itemExternalId, entry);
				}
				entry.stores.add(definition.id);
				entry.name = maxText(entry.name, item.itemName);
				entry.posType = maxText(entry.posType, item.itemTypeExternalId);
				entry.posTypeName = maxText(entry.posTypeName, item.itemTypeName);
				entry.quantityMilli += item.quantityMilli;
				entry.netMinor += item.netMinor;
			}
		}
	}
	const totalMinor = [...sold.values()].reduce(
		(total, entry) => total + entry.netMinor,
		0,
	);
	const types = effectiveItemTypes(
		store,
		args.store_ids,
		args.from_date,
		args.to_date,
	);
	const costs = new CostBook(context.settings.costs());
	const mappings = store.mappings();
	const rows = [...sold.values()]
		.sort(
			(left, right) =>
				right.netMinor - left.netMinor || byteOrder(left.key, right.key),
		)
		.map((entry): Row => {
			const type = types.get(entry.key);
			const account = type?.accountId ?? null;
			const catalogue = account === null ? null : demoItemCatalogue(account);
			const override =
				account === null ? null : mappings.overrideOf(account, entry.key);
			const typeId = type?.typeId ?? null;
			return {
				item_external_id: entry.key,
				item_name: entry.name,
				pos_account_id: account,
				pos_type_external_id: entry.posType,
				pos_type_name: entry.posTypeName,
				override_type_external_id: override?.itemTypeExternalId ?? null,
				item_type_external_id: typeId,
				item_type_name: type?.typeName ?? null,
				type_known:
					catalogue !== null &&
					typeId !== null &&
					catalogue.itemTypes.has(typeId),
				role: type?.role ?? null,
				cost_known: [...entry.stores].every(
					(storeId) => costs.costOn(storeId, entry.key, args.to_date) !== null,
				),
				catalogue_modifier: catalogue?.modifiers.has(entry.key) ?? false,
				quantity: quantity(entry.quantityMilli).toNumber(),
				net_amount: money(entry.netMinor).toNumber(),
				net_share:
					totalMinor === 0
						? null
						: money(entry.netMinor).div(money(totalMinor)).round(6).toNumber(),
			};
		});
	requireThemeRows("data_quality_items", rows.length);
	return rows;
};
