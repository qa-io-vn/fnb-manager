import type { IsoDate } from "@fnb/reports";
import type { AggregateStore } from "../aggregates.js";
import type { DemoStoreDefinition } from "../calendar.js";
import { minorUnits } from "../ingest.js";
import type { DemoRoleName, IngestMappings } from "../mappings.js";
import { money, type PgDecimal } from "../pg-numeric.js";
import type { DemoItemCost } from "../settings.js";

interface CostRow {
	readonly from: IsoDate;
	readonly amount: PgDecimal;
}

interface ItemCostRows {
	readonly tenant: CostRow[];
	readonly stores: Map<string, CostRow[]>;
}

export class CostBook {
	private readonly items = new Map<string, ItemCostRows>();

	constructor(costs: readonly DemoItemCost[]) {
		for (const cost of costs) {
			const rows = this.items.get(cost.itemExternalId) ?? {
				tenant: [],
				stores: new Map<string, CostRow[]>(),
			};
			const row = {
				from: cost.effectiveFrom,
				amount: money(minorUnits(cost.costAmount)),
			};
			if (cost.storeId === null) rows.tenant.push(row);
			else {
				const list = rows.stores.get(cost.storeId) ?? [];
				list.push(row);
				rows.stores.set(cost.storeId, list);
			}
			this.items.set(cost.itemExternalId, rows);
		}
	}

	costOn(storeId: string, itemKey: string, date: IsoDate): PgDecimal | null {
		const rows = this.items.get(itemKey);
		if (rows === undefined) return null;
		return (
			latestOn(rows.stores.get(storeId) ?? [], date) ??
			latestOn(rows.tenant, date)
		);
	}
}

function latestOn(rows: readonly CostRow[], date: IsoDate): PgDecimal | null {
	let best: CostRow | null = null;
	for (const row of rows) {
		if (row.from > date) continue;
		if (best === null || row.from > best.from) best = row;
	}
	return best?.amount ?? null;
}

function maxText(left: string | null, right: string | null): string | null {
	if (left === null) return right;
	if (right === null) return left;
	return right > left ? right : left;
}

export interface EffectiveType {
	readonly typeId: string | null;
	readonly typeName: string | null;
	readonly source: "override" | "pos" | "none";
	readonly role: DemoRoleName | null;
}

export function effectiveItemTypes(
	store: AggregateStore,
	storeIds: readonly string[],
	from: IsoDate,
	to: IsoDate,
): Map<string, EffectiveType> {
	const mappings: IngestMappings = store.mappings();
	const visible: DemoStoreDefinition[] = store.visibleStores(storeIds);
	const accounts = visible.map((entry) => mappings.accountOf(entry.id));
	const seller = new Map<string, string>();
	const posType = new Map<string, string | null>();
	const posName = new Map<string, string | null>();
	visible.forEach((entry, position) => {
		for (const day of store.daysOf(entry, from, to)) {
			for (const item of day.items) {
				const key = item.itemExternalId;
				if (!seller.has(key)) seller.set(key, accounts[position] as string);
				posType.set(
					key,
					maxText(posType.get(key) ?? null, item.itemTypeExternalId),
				);
				posName.set(key, maxText(posName.get(key) ?? null, item.itemTypeName));
			}
		}
	});
	const types = new Map<string, EffectiveType>();
	for (const [key, account] of seller) {
		const override = mappings.overrideOf(account, key);
		const typeId = override?.itemTypeExternalId ?? posType.get(key) ?? null;
		const ordered = [account, ...accounts.filter((other) => other !== account)];
		let role: DemoRoleName | null = null;
		for (const candidate of ordered) {
			role = mappings.roleOf(candidate, typeId);
			if (role !== null) break;
		}
		types.set(key, {
			typeId,
			typeName:
				override !== null ? override.itemTypeName : (posName.get(key) ?? null),
			source: override !== null ? "override" : typeId === null ? "none" : "pos",
			role,
		});
	}
	return types;
}
