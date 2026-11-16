import { suggestRole } from "@fnb/core";
import { addDays, type IsoDate } from "@fnb/reports";
import type { MessageKey } from "../../i18n";
import type { Draft } from "../forms/draft";
import type { ItemTypeEntry, ItemTypeRole, RoleChange } from "../source";

export const USAGE_WINDOW_DAYS = 28;

export const ROLE_OPTIONS: readonly ItemTypeRole[] = [
	"drink",
	"food",
	"snack",
	"topping",
	"other",
];

export const ROLE_LABEL_KEYS: Readonly<Record<ItemTypeRole, MessageKey>> = {
	drink: "report.role.drink",
	topping: "report.role.topping",
	food: "report.role.food",
	snack: "report.role.snack",
	other: "report.role.other",
};

export { keepEdits } from "../forms/draft";

export type RoleDraft = Draft<ItemTypeRole>;

export interface AccountGroup {
	readonly posAccountId: string;
	readonly posAccountName: string;
	readonly entries: readonly ItemTypeEntry[];
}

export interface TypeUsage {
	readonly items: number;
	readonly share: number | null;
}

export interface ItemSalesRow {
	readonly item_name: string;
	readonly base_name: string | null;
	readonly item_type_external_id: string | null;
	readonly net_amount: number;
}

export interface AccountSales {
	readonly posAccountId: string;
	readonly rows: readonly ItemSalesRow[];
}

export function roleKeyOf(
	entry: Pick<ItemTypeEntry, "posAccountId" | "itemTypeExternalId">,
): string {
	return `${entry.posAccountId}|${entry.itemTypeExternalId}`;
}

export function savedDraftOf(entries: readonly ItemTypeEntry[]): RoleDraft {
	return Object.fromEntries(
		entries.map((entry) => [roleKeyOf(entry), entry.role]),
	);
}

export function groupsOf(entries: readonly ItemTypeEntry[]): AccountGroup[] {
	const groups = new Map<string, AccountGroup>();
	for (const entry of entries) {
		const group = groups.get(entry.posAccountId);
		groups.set(entry.posAccountId, {
			posAccountId: entry.posAccountId,
			posAccountName: entry.posAccountName,
			entries: [...(group?.entries ?? []), entry],
		});
	}
	return [...groups.values()];
}

export function roleChangesOf(
	entries: readonly ItemTypeEntry[],
	draft: RoleDraft,
): RoleChange[] {
	return entries.flatMap((entry) => {
		const role = draft[roleKeyOf(entry)] ?? null;
		return role === entry.role
			? []
			: [
					{
						posAccountId: entry.posAccountId,
						itemTypeExternalId: entry.itemTypeExternalId,
						role,
					},
				];
	});
}

export function suggestionOf(entry: ItemTypeEntry): ItemTypeRole | null {
	return suggestRole(entry.name);
}

export function suggestionsFor(
	entries: readonly ItemTypeEntry[],
	draft: RoleDraft,
): RoleDraft {
	return Object.fromEntries(
		entries.flatMap((entry) => {
			const key = roleKeyOf(entry);
			const suggestion = suggestionOf(entry);
			return (draft[key] ?? null) === null && suggestion !== null
				? [[key, suggestion]]
				: [];
		}),
	);
}

export function usageWindow(asOf: IsoDate): { from: IsoDate; to: IsoDate } {
	return { from: addDays(asOf, 1 - USAGE_WINDOW_DAYS), to: asOf };
}

export function usageOf(
	accounts: readonly AccountSales[],
): ReadonlyMap<string, TypeUsage> {
	const total = accounts.reduce(
		(sum, account) =>
			sum + account.rows.reduce((rows, row) => rows + row.net_amount, 0),
		0,
	);
	const byKey = new Map<string, { items: Set<string>; net: number }>();
	for (const account of accounts) {
		for (const row of account.rows) {
			if (row.item_type_external_id === null) continue;
			const key = roleKeyOf({
				posAccountId: account.posAccountId,
				itemTypeExternalId: row.item_type_external_id,
			});
			const current = byKey.get(key) ?? { items: new Set<string>(), net: 0 };
			current.items.add(row.base_name ?? row.item_name);
			byKey.set(key, {
				items: current.items,
				net: current.net + row.net_amount,
			});
		}
	}
	return new Map(
		[...byKey].map(([key, { items, net }]) => [
			key,
			{ items: items.size, share: total > 0 ? net / total : null },
		]),
	);
}
