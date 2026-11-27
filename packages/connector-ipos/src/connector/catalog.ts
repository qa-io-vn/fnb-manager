import {
	type CanonicalCatalog,
	type CanonicalItem,
	type CanonicalModifier,
	type CanonicalOptionGroup,
	classifyPaymentKind,
	OPTION_GROUP_MAX_SELECT,
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

function clampSelect(value: number, low: number): number {
	return Math.min(OPTION_GROUP_MAX_SELECT, Math.max(low, Math.trunc(value)));
}

function selectCount(
	value: number | null | undefined,
	fallback: number,
): number {
	return value !== null && value !== undefined && Number.isFinite(value)
		? value
		: fallback;
}

function distinctIds(ids: readonly (string | null | undefined)[]): string[] {
	const seen = new Set<string>();
	for (const id of ids) {
		const trimmed = id?.trim();
		if (trimmed) {
			seen.add(trimmed);
		}
	}
	return [...seen];
}

/**
 * One option group per customization and position in its LstItem_Options (ADR-058 phase 3). Unlike the
 * modifiers, every option is kept, priced or not: an option's online price is the POS price of its item. The
 * limits are clamped to 0..20 (min) and 1..20 (max), and max is raised to min when the POS gives less.
 */
export function toOptionGroups(data: MasterData): CanonicalOptionGroup[] {
	const groups = new Map<string, CanonicalOptionGroup>();
	for (const customization of data.customizations) {
		const appliesTo = distinctIds(customization.list_item ?? []);
		const options = customization.data?.LstItem_Options ?? [];
		options.forEach((option, position) => {
			const externalId = `${customization.id}:${position}`;
			if (groups.has(externalId)) {
				return;
			}
			const optionItemExternalIds = distinctIds(option.LstItem_Id ?? []);
			const minSelect = clampSelect(selectCount(option.Min_Permitted, 0), 0);
			const maxSelect = Math.max(
				minSelect,
				clampSelect(
					selectCount(option.Max_Permitted, optionItemExternalIds.length),
					1,
				),
			);
			groups.set(externalId, {
				externalId,
				name:
					option.Name?.trim() || customization.name.trim() || customization.id,
				minSelect,
				maxSelect,
				optionItemExternalIds,
				appliesToItemExternalIds: appliesTo,
				active: isActive(customization),
				raw: {
					customizationUid: customization.id,
					customizationName: customization.name,
					position,
					option,
				},
			});
		});
	}
	return [...groups.values()];
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
		optionGroups: toOptionGroups(data),
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
