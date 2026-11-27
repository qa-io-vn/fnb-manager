import { type PaymentKind, paymentKindSchema } from "@fnb/core";
import { toJson } from "../json.js";
import type {
	CatalogWrite,
	JsonValue,
	OptionGroupWrite,
	TableCounts,
} from "../rows.js";
import {
	MEMORY_CATALOG_TABLES,
	type MemoryState,
	OPTION_GROUP_TABLE,
	type StoredCatalogRow,
	type StoredOptionGroupLinks,
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

export function optionGroupLinks(
	state: MemoryState,
	accountId: string,
): StoredOptionGroupLinks {
	return (
		state.tables.optionGroupLinks.get(accountId) ?? { options: [], targets: [] }
	);
}

function upsertRows(
	state: MemoryState,
	catalog: Pick<CatalogWrite, "tenant_id" | "pos_account_id">,
	table: string,
	rows: readonly ({ external_id: string } & object)[],
	stamp: string,
): void {
	const stored = catalogRows(state, table);
	const seen = new Set<string>();
	for (const row of rows) {
		seen.add(row.external_id);
		const values = catalogValues(row);
		const active = "active" in row ? Boolean(row.active) : true;
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
}

/** As the Postgres writer: groups upserted (missing ones inactive), options and targets replaced as a whole. */
function replaceOptionGroups(
	state: MemoryState,
	catalog: Pick<CatalogWrite, "tenant_id" | "pos_account_id">,
	write: OptionGroupWrite,
	stamp: string,
): TableCounts {
	upsertRows(state, catalog, OPTION_GROUP_TABLE, write.groups, stamp);
	state.tables.optionGroupLinks.set(catalog.pos_account_id, {
		options: write.options.map((option) => ({ ...option })),
		targets: write.targets.map((target) => ({ ...target })),
	});
	return {
		[OPTION_GROUP_TABLE]: write.groups.length,
		item_option_group_options: write.options.length,
		item_option_group_targets: write.targets.length,
	};
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
		upsertRows(state, catalog, table, rows, stamp);
		counts[table] = rows.length;
	}
	if (catalog.option_groups !== null) {
		Object.assign(
			counts,
			replaceOptionGroups(state, catalog, catalog.option_groups, stamp),
		);
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
