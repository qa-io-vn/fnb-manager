import type { Draft } from "../forms/draft";
import type {
	CategoryOverrideChange,
	ItemEntry,
	ItemTypeEntry,
} from "../source";

export const SEARCH_RESULT_LIMIT = 50;

export type CategoryDraft = Draft<string>;

export type AccountTypes = ReadonlyMap<string, readonly ItemTypeEntry[]>;

export type PosCategory =
	| { readonly kind: "known"; readonly type: ItemTypeEntry }
	| { readonly kind: "missing" }
	| { readonly kind: "unknown"; readonly itemTypeExternalId: string };

export interface SearchResult {
	readonly items: readonly ItemEntry[];
	readonly total: number;
}

export interface SoldUncategorisedItem {
	readonly posAccountId: string;
	readonly itemExternalId: string;
	readonly itemName: string | null;
	readonly posTypeExternalId: string | null;
	readonly netAmount: number;
}

const NAME_ORDER = new Intl.Collator("vi", { sensitivity: "base" });

export function itemKeyOf(
	entry: Pick<ItemEntry, "posAccountId" | "itemExternalId">,
): string {
	return `${entry.posAccountId}|${entry.itemExternalId}`;
}

export function savedCategoryDraftOf(
	entries: readonly ItemEntry[],
): CategoryDraft {
	return Object.fromEntries(
		entries.map((entry) => [
			itemKeyOf(entry),
			entry.overrideItemTypeExternalId,
		]),
	);
}

export function categoryChangesOf(
	entries: readonly ItemEntry[],
	draft: CategoryDraft,
): CategoryOverrideChange[] {
	return entries.flatMap((entry) => {
		const chosen = draft[itemKeyOf(entry)] ?? null;
		return chosen === entry.overrideItemTypeExternalId
			? []
			: [
					{
						posAccountId: entry.posAccountId,
						itemExternalId: entry.itemExternalId,
						itemTypeExternalId: chosen,
					},
				];
	});
}

function overrideOnlyEntry(change: CategoryOverrideChange): ItemEntry {
	return {
		posAccountId: change.posAccountId,
		itemExternalId: change.itemExternalId,
		name: change.itemExternalId,
		sizeLabel: null,
		listPrice: null,
		isModifier: false,
		active: false,
		inCatalogue: false,
		posItemTypeExternalId: null,
		overrideItemTypeExternalId: change.itemTypeExternalId,
		audit: null,
	};
}

export function withCategoryChanges(
	entries: readonly ItemEntry[] | undefined,
	changes: readonly CategoryOverrideChange[],
): ItemEntry[] | undefined {
	if (entries === undefined) return entries;
	const changed = new Map(changes.map((change) => [itemKeyOf(change), change]));
	const updated = entries.flatMap((entry) => {
		const change = changed.get(itemKeyOf(entry));
		if (change === undefined) return [entry];
		if (!entry.inCatalogue && change.itemTypeExternalId === null) return [];
		return [
			{ ...entry, overrideItemTypeExternalId: change.itemTypeExternalId },
		];
	});
	const present = new Set(entries.map(itemKeyOf));
	const added = [...changed.values()]
		.filter(
			(change) =>
				change.itemTypeExternalId !== null && !present.has(itemKeyOf(change)),
		)
		.map(overrideOnlyEntry);
	return [...updated, ...added];
}

export function entryOfSale(sale: SoldUncategorisedItem): ItemEntry {
	return {
		posAccountId: sale.posAccountId,
		itemExternalId: sale.itemExternalId,
		name: sale.itemName ?? sale.itemExternalId,
		sizeLabel: null,
		listPrice: null,
		isModifier: false,
		active: true,
		inCatalogue: false,
		posItemTypeExternalId: sale.posTypeExternalId,
		overrideItemTypeExternalId: null,
		audit: null,
	};
}

export function withSoldItems(
	entries: readonly ItemEntry[],
	sold: readonly SoldUncategorisedItem[],
): ItemEntry[] {
	const present = new Set(entries.map(itemKeyOf));
	const added = new Map<string, ItemEntry>();
	for (const sale of sold) {
		const key = itemKeyOf(sale);
		if (!present.has(key) && !added.has(key)) {
			added.set(key, entryOfSale(sale));
		}
	}
	return [...entries, ...added.values()];
}

export function uncategorisedEntries(
	sold: readonly SoldUncategorisedItem[],
	entries: readonly ItemEntry[],
): ItemEntry[] {
	const byKey = new Map(entries.map((entry) => [itemKeyOf(entry), entry]));
	const listed = new Set<string>();
	return sold.flatMap((sale) => {
		const key = itemKeyOf(sale);
		if (listed.has(key)) return [];
		listed.add(key);
		const entry = byKey.get(key) ?? entryOfSale(sale);
		if (entry.overrideItemTypeExternalId !== null) return [];
		return [{ ...entry, posItemTypeExternalId: sale.posTypeExternalId }];
	});
}

export function sizeToShow(entry: ItemEntry): string | null {
	const size = entry.sizeLabel;
	if (size === null || size.trim() === "") return null;
	return entry.name.includes(`(${size})`) ? null : size;
}

export function typesByAccount(
	itemTypes: readonly ItemTypeEntry[],
): AccountTypes {
	const byAccount = new Map<string, ItemTypeEntry[]>();
	for (const type of itemTypes) {
		byAccount.set(type.posAccountId, [
			...(byAccount.get(type.posAccountId) ?? []),
			type,
		]);
	}
	for (const [account, types] of byAccount) {
		byAccount.set(
			account,
			[...types].sort((left, right) =>
				NAME_ORDER.compare(left.name, right.name),
			),
		);
	}
	return byAccount;
}

export function typeOf(
	types: AccountTypes,
	posAccountId: string,
	itemTypeExternalId: string,
): ItemTypeEntry | null {
	return (
		types
			.get(posAccountId)
			?.find((type) => type.itemTypeExternalId === itemTypeExternalId) ?? null
	);
}

export function posCategoryOf(
	entry: ItemEntry,
	types: AccountTypes,
): PosCategory {
	const id = entry.posItemTypeExternalId;
	if (id === null) return { kind: "missing" };
	const type = typeOf(types, entry.posAccountId, id);
	return type === null
		? { kind: "unknown", itemTypeExternalId: id }
		: { kind: "known", type };
}

function byActivityThenName(left: ItemEntry, right: ItemEntry): number {
	if (left.active !== right.active) return left.active ? -1 : 1;
	return (
		NAME_ORDER.compare(left.name, right.name) ||
		NAME_ORDER.compare(left.sizeLabel ?? "", right.sizeLabel ?? "") ||
		left.itemExternalId.localeCompare(right.itemExternalId)
	);
}

export function overriddenItems(entries: readonly ItemEntry[]): ItemEntry[] {
	return entries
		.filter((entry) => entry.overrideItemTypeExternalId !== null)
		.sort((left, right) => {
			if (left.inCatalogue !== right.inCatalogue) {
				return left.inCatalogue ? -1 : 1;
			}
			return byActivityThenName(left, right);
		});
}

export function searchTextOf(text: string): string {
	return text
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.replace(/đ/gi, "d")
		.toLowerCase();
}

function searchableTextOf(entry: ItemEntry, types: AccountTypes): string {
	const typeNames = [
		entry.posItemTypeExternalId,
		entry.overrideItemTypeExternalId,
	].flatMap((id) =>
		id === null ? [] : [typeOf(types, entry.posAccountId, id)?.name ?? id],
	);
	return searchTextOf(
		[
			entry.name,
			entry.sizeLabel ?? "",
			entry.itemExternalId,
			...typeNames,
		].join(" "),
	);
}

export function searchItems(
	entries: readonly ItemEntry[],
	types: AccountTypes,
	query: string,
	firstKeys: ReadonlySet<string> = new Set(),
	limit: number = SEARCH_RESULT_LIMIT,
): SearchResult {
	const words = searchTextOf(query).split(/\s+/).filter(Boolean);
	if (words.length === 0) return { items: [], total: 0 };
	const matches = entries
		.filter((entry) => {
			const text = searchableTextOf(entry, types);
			return words.every((word) => text.includes(word));
		})
		.sort((left, right) => {
			const leftFirst = firstKeys.has(itemKeyOf(left));
			if (leftFirst !== firstKeys.has(itemKeyOf(right))) {
				return leftFirst ? -1 : 1;
			}
			return byActivityThenName(left, right);
		});
	return { items: matches.slice(0, limit), total: matches.length };
}
