import type { CardInput, ReportStore } from "../../definition.js";
import { sumMoney } from "../../model/money.js";
import { monthCalls } from "./support.js";

export interface MonthTargets {
	readonly byStore: ReadonlyMap<string, number>;
	readonly missing: readonly ReportStore[];
	readonly total: number | null;
}

export function monthTargets(input: CardInput): MonthTargets {
	const rows = input.results.rows(monthCalls.targets, "store_targets") ?? [];
	const byStore = new Map<string, number>();
	for (const row of rows) {
		if (row.store_id !== null) byStore.set(row.store_id, row.net_target_amount);
	}
	const stores = input.context.stores;
	const missing = stores.filter((store) => !byStore.has(store.id));
	return {
		byStore,
		missing,
		total:
			stores.length > 0 && missing.length === 0
				? sumMoney(stores.map((store) => byStore.get(store.id)))
				: null,
	};
}
