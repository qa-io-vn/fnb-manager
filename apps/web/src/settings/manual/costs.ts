import { addDays, type IsoDate } from "../../lib/business-dates";
import type { Formatters } from "../../lib/format";
import { searchTextOf } from "../categories/categories";
import { readDateDraft } from "../forms/date-field";
import { readMoneyText } from "../forms/money-text";
import type { NumberDraft } from "../number-text";
import type { ItemEntry, ItemTypeEntry } from "../source";
import {
	FIRST_BUSINESS_DATE,
	itemCost,
	type ValidationIssue,
} from "../validation";
import type { ItemCostChange, ItemCostRow } from "./source";

export const COST_SALES_WINDOW_DAYS = 90;
export const COST_PAGE_SIZE = 25;

export type CostScope = string | null;

export interface CostSale {
	readonly itemExternalId: string;
	readonly name: string;
	readonly sizeLabel: string | null;
	readonly category: string | null;
	readonly netAmount: number;
}

export interface CostItem {
	readonly itemExternalId: string;
	readonly name: string;
	readonly sizeLabel: string | null;
	readonly category: string | null;
	readonly listPrice: number | null;
	readonly soldAmount: number | null;
}

export interface CurrentCost {
	readonly row: ItemCostRow;
	readonly inherited: boolean;
}

export type DateHintKind =
	| "wholeHistory"
	| "keepsEarlier"
	| "keepsShared"
	| "replacesShared"
	| "replaces"
	| "fromDate";

export interface DateHint {
	readonly kind: DateHintKind;
	readonly until: IsoDate | null;
}

export interface CostHistory {
	readonly own: readonly ItemCostRow[];
	readonly shared: readonly ItemCostRow[];
}

export interface CostEdit {
	readonly cost: string;
	readonly date: IsoDate | null;
}

export type CostDraft = Readonly<Record<string, CostEdit>>;

export interface CostFieldIssues {
	readonly cost: ValidationIssue | null;
	readonly date: ValidationIssue | null;
}

export interface CostReading {
	readonly changes: readonly ItemCostChange[];
	readonly pendingCount: number;
	readonly invalid: boolean;
	readonly issues: ReadonlyMap<string, CostFieldIssues>;
	readonly unsaved: ReadonlySet<string>;
}

const NAME_ORDER = new Intl.Collator("vi", { sensitivity: "base" });

function typeNameOf(
	entry: ItemEntry,
	itemTypes: readonly ItemTypeEntry[],
): string | null {
	const typeId =
		entry.overrideItemTypeExternalId ?? entry.posItemTypeExternalId;
	if (typeId === null) return null;
	return (
		itemTypes.find(
			(type) =>
				type.posAccountId === entry.posAccountId &&
				type.itemTypeExternalId === typeId,
		)?.name ?? null
	);
}

function itemOfEntry(
	entry: ItemEntry,
	itemTypes: readonly ItemTypeEntry[],
	soldAmount: number | null,
): CostItem {
	return {
		itemExternalId: entry.itemExternalId,
		name: entry.name,
		sizeLabel: entry.sizeLabel,
		category: typeNameOf(entry, itemTypes),
		listPrice: entry.listPrice,
		soldAmount,
	};
}

function byActivityThenName(left: ItemEntry, right: ItemEntry): number {
	if (left.active !== right.active) return left.active ? -1 : 1;
	return (
		NAME_ORDER.compare(left.name, right.name) ||
		NAME_ORDER.compare(left.sizeLabel ?? "", right.sizeLabel ?? "") ||
		left.itemExternalId.localeCompare(right.itemExternalId)
	);
}

export interface CostItemsInput {
	readonly entries: readonly ItemEntry[];
	readonly itemTypes: readonly ItemTypeEntry[];
	readonly sales: readonly CostSale[];
	readonly posAccountIds: ReadonlySet<string> | null;
	readonly costedItemIds: readonly string[];
}

export function costItemsOf({
	entries,
	itemTypes,
	sales,
	posAccountIds,
	costedItemIds,
}: CostItemsInput): CostItem[] {
	const catalogue = entries
		.filter(
			(entry) =>
				entry.inCatalogue &&
				!entry.isModifier &&
				(posAccountIds === null || posAccountIds.has(entry.posAccountId)),
		)
		.sort(byActivityThenName);
	const entryOf = new Map<string, ItemEntry>();
	for (const entry of catalogue) {
		if (!entryOf.has(entry.itemExternalId)) {
			entryOf.set(entry.itemExternalId, entry);
		}
	}
	const listed = new Set<string>();
	const sellers: CostItem[] = [];
	for (const sale of [...sales].sort(
		(left, right) => right.netAmount - left.netAmount,
	)) {
		if (listed.has(sale.itemExternalId)) continue;
		listed.add(sale.itemExternalId);
		const entry = entryOf.get(sale.itemExternalId);
		sellers.push(
			entry === undefined
				? {
						itemExternalId: sale.itemExternalId,
						name: sale.name,
						sizeLabel: sale.sizeLabel,
						category: sale.category,
						listPrice: null,
						soldAmount: sale.netAmount,
					}
				: itemOfEntry(entry, itemTypes, sale.netAmount),
		);
	}
	const rest: CostItem[] = [];
	for (const entry of entryOf.values()) {
		if (listed.has(entry.itemExternalId)) continue;
		listed.add(entry.itemExternalId);
		rest.push(itemOfEntry(entry, itemTypes, null));
	}
	const costedOnly = [...new Set(costedItemIds)]
		.filter((itemExternalId) => !listed.has(itemExternalId))
		.sort()
		.map(
			(itemExternalId): CostItem => ({
				itemExternalId,
				name: itemExternalId,
				sizeLabel: null,
				category: null,
				listPrice: null,
				soldAmount: null,
			}),
		);
	return [...sellers, ...rest, ...costedOnly];
}

export function sizeShownOf(item: Pick<CostItem, "name" | "sizeLabel">) {
	const size = item.sizeLabel?.trim() ?? "";
	if (size === "" || item.name.includes(`(${size})`)) return null;
	return size;
}

export function searchCostItems(
	items: readonly CostItem[],
	query: string,
): CostItem[] {
	const words = searchTextOf(query).split(/\s+/).filter(Boolean);
	if (words.length === 0) return [...items];
	return items.filter((item) => {
		const text = searchTextOf(
			[
				item.name,
				item.sizeLabel ?? "",
				item.itemExternalId,
				item.category ?? "",
			].join(" "),
		);
		return words.every((word) => text.includes(word));
	});
}

export function scopeRowsOf(
	rows: readonly ItemCostRow[],
	storeId: CostScope,
	itemExternalId: string,
): ItemCostRow[] {
	return rows
		.filter(
			(row) => row.storeId === storeId && row.itemExternalId === itemExternalId,
		)
		.sort((left, right) =>
			left.effectiveFrom.localeCompare(right.effectiveFrom),
		);
}

function inForceOn(
	scopeRows: readonly ItemCostRow[],
	date: IsoDate,
): ItemCostRow | null {
	let found: ItemCostRow | null = null;
	for (const row of scopeRows) {
		if (row.effectiveFrom <= date) found = row;
	}
	return found;
}

export function currentCostOf(
	rows: readonly ItemCostRow[],
	storeId: CostScope,
	itemExternalId: string,
	today: IsoDate,
): CurrentCost | null {
	const own = inForceOn(scopeRowsOf(rows, storeId, itemExternalId), today);
	if (own !== null) return { row: own, inherited: false };
	if (storeId === null) return null;
	const tenantWide = inForceOn(scopeRowsOf(rows, null, itemExternalId), today);
	return tenantWide === null ? null : { row: tenantWide, inherited: true };
}

export function costHistoryOf(
	rows: readonly ItemCostRow[],
	storeId: CostScope,
	itemExternalId: string,
): CostHistory {
	return {
		own: scopeRowsOf(rows, storeId, itemExternalId),
		shared: storeId === null ? [] : scopeRowsOf(rows, null, itemExternalId),
	};
}

export function defaultEffectiveFrom(
	history: CostHistory,
	today: IsoDate,
): IsoDate {
	return history.own.length === 0 && history.shared.length === 0
		? FIRST_BUSINESS_DATE
		: today;
}

export function dateHintOf(
	{ own, shared }: CostHistory,
	date: IsoDate,
	today: IsoDate,
): DateHint {
	if (own.some((row) => row.effectiveFrom === date)) {
		return { kind: "replaces", until: null };
	}
	const next = own.find((row) => row.effectiveFrom > date);
	const until = next === undefined ? null : addDays(next.effectiveFrom, -1);
	if (own.some((row) => row.effectiveFrom < date)) {
		return { kind: "keepsEarlier", until };
	}
	const firstShared = shared[0]?.effectiveFrom;
	if (firstShared !== undefined) {
		const pastEnd =
			next === undefined || next.effectiveFrom > today
				? today
				: next.effectiveFrom;
		if (date < pastEnd && firstShared < pastEnd) {
			return { kind: "replacesShared", until };
		}
		if (firstShared < date) return { kind: "keepsShared", until };
	}
	return {
		kind: date === FIRST_BUSINESS_DATE ? "wholeHistory" : "fromDate",
		until,
	};
}

export function costShareOf(
	cost: number,
	listPrice: number | null,
): number | null {
	return listPrice === null || listPrice <= 0 ? null : cost / listPrice;
}

export function readCostText(
	text: string,
	formatters: Formatters,
	currencyCode: string,
): NumberDraft {
	return readMoneyText(
		text,
		formatters,
		currencyCode,
		itemCost(formatters.moneyFractionDigits),
	);
}

export interface CostDraftContext {
	readonly storeId: CostScope;
	readonly rows: readonly ItemCostRow[];
	readonly today: IsoDate;
	readonly readCost: (text: string) => NumberDraft;
}

export function editedDateOf(
	edit: CostEdit | undefined,
	history: CostHistory,
	today: IsoDate,
): IsoDate {
	return edit?.date ?? defaultEffectiveFrom(history, today);
}

export function readCostEdits(
	draft: CostDraft,
	{ storeId, rows, today, readCost }: CostDraftContext,
): CostReading {
	const changes: ItemCostChange[] = [];
	const issues = new Map<string, CostFieldIssues>();
	const unsaved = new Set<string>();
	for (const [itemExternalId, edit] of Object.entries(draft)) {
		const history = costHistoryOf(rows, storeId, itemExternalId);
		const date = editedDateOf(edit, history, today);
		const typedCost = edit.cost.trim() !== "";
		if (!typedCost && date === defaultEffectiveFrom(history, today)) continue;
		unsaved.add(itemExternalId);
		const cost: NumberDraft = typedCost
			? readCost(edit.cost)
			: { value: null, issue: { key: "required" } };
		const dateIssue = readDateDraft(date, today);
		if (cost.issue !== null || dateIssue !== null || cost.value === null) {
			issues.set(itemExternalId, { cost: cost.issue, date: dateIssue });
			continue;
		}
		changes.push({
			storeId,
			itemExternalId,
			costAmount: cost.value,
			effectiveFrom: date,
		});
	}
	return {
		changes,
		pendingCount: unsaved.size,
		invalid: issues.size > 0,
		issues,
		unsaved,
	};
}

export function withoutSaved(
	draft: CostDraft,
	saved: readonly ItemCostChange[],
): CostDraft {
	const savedItems = new Set(saved.map((change) => change.itemExternalId));
	return Object.fromEntries(
		Object.entries(draft).filter(
			([itemExternalId]) => !savedItems.has(itemExternalId),
		),
	);
}

function costKeyOf(
	row: Pick<ItemCostChange, "storeId" | "itemExternalId" | "effectiveFrom">,
): string {
	return `${row.storeId ?? ""}|${row.itemExternalId}|${row.effectiveFrom}`;
}

export function withSavedCosts(
	previous: readonly ItemCostRow[] | undefined,
	saved: readonly ItemCostRow[],
): ItemCostRow[] | undefined {
	if (previous === undefined) return previous;
	const savedByKey = new Map(saved.map((row) => [costKeyOf(row), row]));
	const kept = previous.map((row) => {
		const replaced = savedByKey.get(costKeyOf(row));
		if (replaced === undefined) return row;
		savedByKey.delete(costKeyOf(row));
		return replaced;
	});
	return [...kept, ...savedByKey.values()];
}

export function withoutCost(
	previous: readonly ItemCostRow[] | undefined,
	id: string,
): ItemCostRow[] | undefined {
	return previous?.filter((row) => row.id !== id);
}
