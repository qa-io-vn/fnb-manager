import { type PaymentKind, paymentKindSchema } from "@fnb/core";
import { toJson } from "../json.js";
import type { CatalogWrite, JsonValue, TableCounts } from "../rows.js";
import {
	MEMORY_CATALOG_TABLES,
	type MemoryState,
	type StoredCatalogRow,
} from "./tables.js";

function catalogValues(row: object): Record<string, JsonValue> {
	const values = toJson(row);
	if (values === null || typeof values !== "object" || Array.isArray(values)) {
		throw new TypeError("a catalogue row must be an object");
	}
	return values;
}

export function catalogRows(
	state: MemoryState,
	table: string,
): StoredCatalogRow[] {
	return state.tables.catalog.get(table) ?? [];
}

export function replaceCatalog(
	state: MemoryState,
	catalog: CatalogWrite,
): TableCounts {
	const counts: TableCounts = {};
	const stamp = state.timestamp();
	for (const table of MEMORY_CATALOG_TABLES) {
		const rows = catalog[table];
		if (rows === null) {
			continue;
		}
		const stored = catalogRows(state, table);
		const seen = new Set<string>();
		for (const row of rows) {
			seen.add(row.external_id);
			const values = catalogValues(row);
			const active = "active" in row ? row.active : true;
			const existing = stored.find(
				(candidate) =>
					candidate.pos_account_id === catalog.pos_account_id &&
					candidate.external_id === row.external_id,
			);
			if (existing) {
				existing.values = values;
				existing.active = active;
				existing.last_seen_at = stamp;
			} else {
				stored.push({
					id: state.nextId(table),
					tenant_id: catalog.tenant_id,
					pos_account_id: catalog.pos_account_id,
					external_id: row.external_id,
					active,
					first_seen_at: stamp,
					last_seen_at: stamp,
					values,
				});
			}
		}
		for (const row of stored) {
			if (
				row.pos_account_id === catalog.pos_account_id &&
				!seen.has(row.external_id)
			) {
				row.active = false;
			}
		}
		state.tables.catalog.set(table, stored);
		counts[table] = rows.length;
	}
	return counts;
}

export function paymentMethodKinds(
	state: MemoryState,
	accountId: string,
): Record<string, PaymentKind> {
	return Object.fromEntries(
		catalogRows(state, "payment_methods")
			.filter((row) => row.pos_account_id === accountId)
			.flatMap((row) => {
				const kind = paymentKindSchema.safeParse(row.values.kind);
				return kind.success ? [[row.external_id, kind.data] as const] : [];
			}),
	);
}
