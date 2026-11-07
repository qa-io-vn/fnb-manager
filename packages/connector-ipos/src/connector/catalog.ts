import {
	type CanonicalCatalog,
	type CanonicalItem,
	type CanonicalModifier,
	classifyPaymentKind,
	parseSizeSuffix,
} from "@fnb/core";
import type { Item } from "../schemas/master-data.js";
import {
	isModifierItem,
	isUncategorised,
	isZeroPricedOption,
	type MasterData,
	type MasterIndex,
} from "./master-index.js";
import { normaliseName, type ResolvedIposOptions } from "./options.js";

function isActive(row: {
	active?: number | null | undefined;
	deleted?: boolean | null | undefined;
}): boolean {
	return (row.active ?? 1) !== 0 && row.deleted !== true;
}

function toCanonicalItem(
	item: Item,
	index: MasterIndex,
	options: ResolvedIposOptions,
): CanonicalItem {
	const { baseName, sizeLabel } = parseSizeSuffix(
		item.item_name,
		options.sizeLabels,
	);
	const itemType = item.item_type_uid
		? index.itemTypesByKey.get(item.item_type_uid)
		: undefined;
	const itemClass = item.item_class_uid
		? index.itemClassesByKey.get(item.item_class_uid)
		: undefined;
	const costPrice = item.cost_price ?? 0;
	return {
		externalId: item.item_id,
		name: item.item_name,
		baseName,
		sizeLabel,
		itemTypeExternalId: itemType?.item_type_id,
		itemTypeName:
			itemType && !isUncategorised(itemType.item_type_name)
				? itemType.item_type_name
				: undefined,
		itemClassName:
			itemClass && !isUncategorised(itemClass.item_class_name)
				? itemClass.item_class_name
				: undefined,
		listPrice: item.ots_price ?? 0,
		takeawayPrice: item.ta_price ?? undefined,
		costPrice: costPrice > 0 ? costPrice : undefined,
		isModifier: isModifierItem(index, item),
		active: isActive(item),
	};
}

function toModifiers(
	data: MasterData,
	index: MasterIndex,
): CanonicalModifier[] {
	const modifiers = new Map<string, CanonicalModifier>();
	for (const customization of data.customizations) {
		const appliesTo = customization.list_item ?? [];
		for (const option of customization.data?.LstItem_Options ?? []) {
			const groupName = option.Name?.trim() || customization.name;
			for (const optionId of option.LstItem_Id ?? []) {
				if (!isZeroPricedOption(index, optionId)) {
					continue;
				}
				const existing = modifiers.get(optionId);
				if (existing) {
					existing.appliesToItemExternalIds = [
						...new Set([...existing.appliesToItemExternalIds, ...appliesTo]),
					];
					continue;
				}
				const item = index.itemsByKey.get(optionId);
				modifiers.set(optionId, {
					externalId: optionId,
					name: item?.item_name ?? optionId,
					groupName,
					appliesToItemExternalIds: [...appliesTo],
					raw: { customizationUid: customization.id, option },
				});
			}
		}
	}
	return [...modifiers.values()];
}

function isDeliverySource(
	source: { source_id: string; source_name: string },
	options: ResolvedIposOptions,
): boolean {
	return (
		options.deliverySources.has(normaliseName(source.source_id)) ||
		options.deliverySources.has(normaliseName(source.source_name))
	);
}

export function toCanonicalCatalog(
	data: MasterData,
	index: MasterIndex,
	options: ResolvedIposOptions,
): CanonicalCatalog {
	return {
		items: data.items.map((item) => toCanonicalItem(item, index, options)),
		itemTypes: data.itemTypes.map((type) => ({
			externalId: type.item_type_id,
			name: type.item_type_name,
			parentExternalId: type.item_type_parent_id?.trim() || undefined,
		})),
		itemClasses: data.itemClasses.map((itemClass) => ({
			externalId: itemClass.item_class_id,
			name: itemClass.item_class_name,
		})),
		modifiers: toModifiers(data, index),
		paymentMethods: data.paymentMethods.map((method) => ({
			externalId: method.payment_method_id,
			name: method.payment_method_name,
			kind: classifyPaymentKind(method.payment_method_name, {
				overrides: options.paymentKindOverrides,
			}),
		})),
		sources: data.sources.map((source) => ({
			externalId: source.source_id,
			name: source.source_name,
			isDelivery: isDeliverySource(source, options),
		})),
		promotions: data.promotions.map((promotion) => ({
			externalId: promotion.promotion_id,
			name: promotion.promotion_name,
			raw: promotion,
		})),
		packages: data.packages.map((pack) => ({
			externalId: pack.package_id,
			name: pack.package_name,
			listPrice: pack.ots_value ?? undefined,
			raw: pack,
		})),
	};
}
