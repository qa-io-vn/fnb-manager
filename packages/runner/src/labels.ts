import type { StoreRecord } from "@fnb/sync";
import { type AccountEntry, entryForKey } from "./accounts.js";

export function accountLabel(
	entries: readonly AccountEntry[],
	accountKey: string,
): string {
	const numbered = entryForKey(entries, accountKey);
	return numbered
		? `account ${numbered.position}`
		: "an account missing from POS_ACCOUNTS_JSON";
}

export function storeLabel(
	stores: readonly Pick<StoreRecord, "id" | "external_id">[],
	storeId: string,
): string {
	const ordered = [...stores].sort((left, right) =>
		left.external_id < right.external_id
			? -1
			: left.external_id > right.external_id
				? 1
				: 0,
	);
	const index = ordered.findIndex((store) => store.id === storeId);
	return index < 0 ? "store ?" : `store ${index + 1}`;
}
