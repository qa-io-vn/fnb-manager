import type { IposClient } from "../client.js";
import type {
	Customization,
	Item,
	ItemClass,
	ItemType,
	Package,
	PaymentMethod,
	Promotion,
	Source,
	Unit,
} from "../schemas/master-data.js";
import { normaliseName } from "./options.js";
import type { StoreScopeEntry } from "./scope.js";

export interface MasterData {
	items: Item[];
	itemTypes: ItemType[];
	itemClasses: ItemClass[];
	units: Unit[];
	customizations: Customization[];
	sources: Source[];
	paymentMethods: PaymentMethod[];
	promotions: Promotion[];
	packages: Package[];
}

export interface MasterIndex {
	itemsByKey: ReadonlyMap<string, Item>;
	itemTypesByKey: ReadonlyMap<string, ItemType>;
	itemClassesByKey: ReadonlyMap<string, ItemClass>;
	unitsByKey: ReadonlyMap<string, Unit>;
	optionIds: ReadonlySet<string>;
	optionNames: ReadonlySet<string>;
}

const UNCATEGORISED = "uncategory";

export async function loadMasterData(
	client: IposClient,
	scope: StoreScopeEntry,
): Promise<MasterData> {
	const brandScope = {
		companyUid: scope.companyUid,
		brandUid: scope.brandUid,
	};
	const storeScope = { ...brandScope, storeUid: scope.storeUid };
	const [
		items,
		itemTypes,
		itemClasses,
		units,
		customizations,
		sources,
		paymentMethods,
		promotions,
		packages,
	] = await Promise.all([
		client.listItems(storeScope),
		client.listItemTypes(brandScope),
		client.listItemClasses(brandScope),
		client.listUnits(brandScope),
		client.listCustomizations(storeScope),
		client.listSources(brandScope),
		client.listPaymentMethods(brandScope),
		client.listPromotions(brandScope),
		client.listPackages(storeScope),
	]);
	return {
		items,
		itemTypes,
		itemClasses,
		units,
		customizations,
		sources,
		paymentMethods,
		promotions,
		packages,
	};
}

function indexBy<T>(
	rows: readonly T[],
	keys: (row: T) => (string | null | undefined)[],
): Map<string, T> {
	const index = new Map<string, T>();
	for (const row of rows) {
		for (const key of keys(row)) {
			if (key && !index.has(key)) {
				index.set(key, row);
			}
		}
	}
	return index;
}

export function buildMasterIndex(data: MasterData): MasterIndex {
	const itemsByKey = indexBy(data.items, (item) => [item.item_id, item.id]);
	const optionIds = new Set<string>();
	const optionNames = new Set<string>();
	for (const customization of data.customizations) {
		for (const option of customization.data?.LstItem_Options ?? []) {
			for (const optionId of option.LstItem_Id ?? []) {
				optionIds.add(optionId);
				const optionItem = itemsByKey.get(optionId);
				if (optionItem) {
					optionNames.add(normaliseName(optionItem.item_name));
				}
			}
		}
	}
	return {
		itemsByKey,
		itemTypesByKey: indexBy(data.itemTypes, (type) => [
			type.item_type_id,
			type.id,
		]),
		itemClassesByKey: indexBy(data.itemClasses, (itemClass) => [
			itemClass.item_class_id,
			itemClass.id,
		]),
		unitsByKey: indexBy(data.units, (unit) => [unit.unit_id, unit.id]),
		optionIds,
		optionNames,
	};
}

export function isUncategorised(name: string | null | undefined): boolean {
	if (!name) {
		return true;
	}
	const normalised = normaliseName(name);
	return normalised === "" || normalised === UNCATEGORISED;
}

export function isCustomisationOption(
	index: MasterIndex,
	line: { item_id: string; item_name: string },
): boolean {
	return (
		index.optionIds.has(line.item_id) ||
		index.optionNames.has(normaliseName(line.item_name))
	);
}

export function isPricedInMaster(index: MasterIndex, itemId: string): boolean {
	return (index.itemsByKey.get(itemId)?.ots_price ?? 0) > 0;
}

export function isZeroPricedOption(
	index: MasterIndex,
	itemId: string,
): boolean {
	return index.optionIds.has(itemId) && !isPricedInMaster(index, itemId);
}

export function isModifierItem(
	index: MasterIndex,
	item: { item_id: string; item_name: string },
): boolean {
	return (
		isCustomisationOption(index, item) && !isPricedInMaster(index, item.item_id)
	);
}

export interface ResolvedItemType {
	externalId: string | undefined;
	name: string | undefined;
}

export function resolveItemType(
	index: MasterIndex,
	line: {
		item_id: string;
		item_type_id?: string | null | undefined;
		item_type_name?: string | null | undefined;
	},
): ResolvedItemType {
	const direct = line.item_type_id
		? index.itemTypesByKey.get(line.item_type_id)
		: undefined;
	if (!isUncategorised(line.item_type_name)) {
		return {
			externalId:
				direct?.item_type_id ?? line.item_type_id?.trim() ?? undefined,
			name: line.item_type_name?.trim(),
		};
	}
	const viaMaster = index.itemsByKey.get(line.item_id)?.item_type_uid;
	const resolved =
		direct ?? (viaMaster ? index.itemTypesByKey.get(viaMaster) : undefined);
	if (resolved && !isUncategorised(resolved.item_type_name)) {
		return {
			externalId: resolved.item_type_id,
			name: resolved.item_type_name.trim(),
		};
	}
	const fallbackId = resolved?.item_type_id ?? line.item_type_id?.trim();
	return { externalId: fallbackId || undefined, name: undefined };
}

export function resolveItemClassName(
	index: MasterIndex,
	line: { item_id: string; item_class_name?: string | null | undefined },
): string | undefined {
	const own = line.item_class_name?.trim();
	if (own && !isUncategorised(own)) {
		return own;
	}
	const classUid = index.itemsByKey.get(line.item_id)?.item_class_uid;
	const resolved = classUid ? index.itemClassesByKey.get(classUid) : undefined;
	const name = resolved?.item_class_name.trim();
	return name && !isUncategorised(name) ? name : own || undefined;
}

export function resolveUnitName(
	index: MasterIndex,
	unitId: string | null | undefined,
): string | undefined {
	return unitId ? index.unitsByKey.get(unitId)?.unit_name : undefined;
}
