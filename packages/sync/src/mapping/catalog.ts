import {
	type CanonicalCatalog,
	type CanonicalItem,
	type CanonicalItemClass,
	type CanonicalPaymentMethod,
	classifyPaymentKind,
	type PaymentKind,
	type PaymentKindOptions,
} from "@fnb/core";
import { toJson } from "../json.js";
import { formatMoney, formatOptionalMoney } from "../numeric.js";
import type {
	CatalogEntryRow,
	CatalogWrite,
	ItemRow,
	PaymentMethodRow,
} from "../rows.js";
import { textOrNull } from "./text.js";

export interface CatalogMappingContext {
	tenantId: string;
	posAccountId: string;
	includeCosts: boolean;
	paymentKinds?: PaymentKindOptions;
}

function mergeByExternalId<T extends { externalId: string }>(
	lists: readonly (readonly T[])[],
): T[] {
	const merged = new Map<string, T>();
	for (const list of lists) {
		for (const entry of list) {
			if (!merged.has(entry.externalId)) {
				merged.set(entry.externalId, entry);
			}
		}
	}
	return [...merged.values()].sort((left, right) =>
		left.externalId < right.externalId
			? -1
			: left.externalId > right.externalId
				? 1
				: 0,
	);
}

export function mergeCatalogs(
	catalogs: readonly CanonicalCatalog[],
): CanonicalCatalog {
	return {
		items: mergeByExternalId(catalogs.map((catalog) => catalog.items)),
		itemTypes: mergeByExternalId(catalogs.map((catalog) => catalog.itemTypes)),
		itemClasses: mergeByExternalId(
			catalogs.map((catalog) => catalog.itemClasses),
		),
		modifiers: mergeByExternalId(catalogs.map((catalog) => catalog.modifiers)),
		paymentMethods: mergeByExternalId(
			catalogs.map((catalog) => catalog.paymentMethods),
		),
		sources: mergeByExternalId(catalogs.map((catalog) => catalog.sources)),
		promotions: mergeByExternalId(
			catalogs.map((catalog) => catalog.promotions),
		),
		packages: mergeByExternalId(catalogs.map((catalog) => catalog.packages)),
	};
}

export function resolvePaymentKind(
	method: Pick<CanonicalPaymentMethod, "name" | "kind">,
	options: PaymentKindOptions = {},
): PaymentKind {
	const classified = classifyPaymentKind(method.name, options);
	return classified === "other" ? method.kind : classified;
}

function classIdsByName(
	classes: readonly CanonicalItemClass[],
): Map<string, string | null> {
	const ids = new Map<string, string | null>();
	for (const itemClass of classes) {
		ids.set(
			itemClass.name,
			ids.has(itemClass.name) ? null : itemClass.externalId,
		);
	}
	return ids;
}

function mapItem(
	item: CanonicalItem,
	classIds: ReadonlyMap<string, string | null>,
	includeCosts: boolean,
): ItemRow {
	const className = textOrNull(item.itemClassName);
	return {
		external_id: item.externalId,
		name: item.name,
		base_name: textOrNull(item.baseName),
		size_label: textOrNull(item.sizeLabel),
		item_type_external_id: textOrNull(item.itemTypeExternalId),
		item_class_external_id:
			className === null ? null : (classIds.get(className) ?? null),
		unit_external_id: null,
		unit_name: null,
		list_price: formatMoney(item.listPrice),
		takeaway_price: formatOptionalMoney(item.takeawayPrice),
		cost_price: includeCosts ? formatOptionalMoney(item.costPrice) : null,
		is_modifier: item.isModifier,
		active: item.active,
		raw: null,
	};
}

function entry(
	externalId: string,
	name: string,
	raw: unknown,
): CatalogEntryRow {
	return { external_id: externalId, name, raw: toJson(raw) };
}

export function mapCatalog(
	catalog: CanonicalCatalog,
	context: CatalogMappingContext,
): CatalogWrite {
	const classIds = classIdsByName(catalog.itemClasses);
	const paymentMethods: PaymentMethodRow[] = catalog.paymentMethods.map(
		(method) => ({
			external_id: method.externalId,
			name: method.name,
			kind: resolvePaymentKind(method, context.paymentKinds),
			raw: null,
		}),
	);
	return {
		tenant_id: context.tenantId,
		pos_account_id: context.posAccountId,
		item_types: catalog.itemTypes.map((type) =>
			entry(type.externalId, type.name, null),
		),
		item_classes: catalog.itemClasses.map((itemClass) =>
			entry(itemClass.externalId, itemClass.name, null),
		),
		units: null,
		items: catalog.items.map((item) =>
			mapItem(item, classIds, context.includeCosts),
		),
		packages: catalog.packages.map((pack) => ({
			external_id: pack.externalId,
			name: pack.name,
			list_price: formatOptionalMoney(pack.listPrice),
			raw: toJson(pack.raw),
		})),
		customizations: catalog.modifiers.map((modifier) =>
			entry(modifier.externalId, modifier.name, modifier.raw),
		),
		sources: catalog.sources.map((source) =>
			entry(source.externalId, source.name, null),
		),
		payment_methods: paymentMethods,
		promotions: catalog.promotions.map((promotion) => ({
			external_id: promotion.externalId,
			name: promotion.name,
			starts_at: null,
			ends_at: null,
			raw: toJson(promotion.raw),
		})),
		devices: null,
	};
}
