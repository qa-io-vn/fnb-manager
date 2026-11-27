import type { PaymentKind } from "@fnb/core";
import type { ISql } from "postgres";
import type { CatalogWrite, OptionGroupWrite, TableCounts } from "../rows.js";
import {
	CATALOG_COLUMNS,
	CATALOG_TABLES,
	OPTION_GROUP_COLUMNS,
	OPTION_GROUP_OPTION_COLUMNS,
	OPTION_GROUP_TARGET_COLUMNS,
} from "./columns.js";
import { chunkRows, excludedAssignments, toSqlRow } from "./values.js";

async function upsertEntries(
	sql: ISql,
	catalog: Pick<CatalogWrite, "tenant_id" | "pos_account_id">,
	table: string,
	tableColumns: readonly string[],
	entries: readonly { external_id: string }[],
): Promise<number> {
	const hasActive = tableColumns.includes("active");
	const columns = [
		"tenant_id",
		"pos_account_id",
		...tableColumns,
		...(hasActive ? [] : ["active"]),
	];
	const updates = tableColumns.filter((column) => column !== "external_id");
	const identifier = sql.unsafe(`public.${table}`);
	let written = 0;
	for (const chunk of chunkRows(entries, columns.length)) {
		const rows = chunk.map((entry) =>
			toSqlRow(
				{
					active: true,
					...entry,
					tenant_id: catalog.tenant_id,
					pos_account_id: catalog.pos_account_id,
				},
				columns,
			),
		);
		const result = await sql`
			insert into ${identifier} ${sql(rows, columns)}
			on conflict (pos_account_id, external_id)
			do update set ${sql.unsafe(excludedAssignments([...updates, ...(hasActive ? [] : ["active"])]))},
				last_seen_at = now()
		`;
		written += result.count;
	}
	await sql`
		update ${identifier}
		set active = false
		where pos_account_id = ${catalog.pos_account_id}
			and active
			and external_id <> all(${entries.map((entry) => entry.external_id)}::text[])
	`;
	return written;
}

async function insertLinks(
	sql: ISql,
	catalog: Pick<CatalogWrite, "tenant_id" | "pos_account_id">,
	table: string,
	linkColumns: readonly string[],
	links: readonly object[],
): Promise<number> {
	const columns = ["tenant_id", "pos_account_id", ...linkColumns];
	const identifier = sql.unsafe(`public.${table}`);
	let written = 0;
	for (const chunk of chunkRows(links, columns.length)) {
		const rows = chunk.map((link) =>
			toSqlRow(
				{
					...link,
					tenant_id: catalog.tenant_id,
					pos_account_id: catalog.pos_account_id,
				},
				columns,
				new Set(),
			),
		);
		const result = await sql`
			insert into ${identifier} ${sql(rows, columns)}
			on conflict do nothing
		`;
		written += result.count;
	}
	return written;
}

/**
 * Writes the option groups of one account (ADR-058 phase 3) inside the catalogue's transaction: the groups are
 * upserted (missing ones turn inactive), then the account's options and targets are deleted and inserted again,
 * so they always equal the POS. A database without the option-group tables (its migration not applied yet) is
 * left alone, so the rest of the catalogue still syncs; the counts then name no option-group table.
 */
async function replaceOptionGroups(
	sql: ISql,
	catalog: Pick<CatalogWrite, "tenant_id" | "pos_account_id">,
	write: OptionGroupWrite,
): Promise<TableCounts> {
	const [present] = await sql<{ ready: boolean }[]>`
		select to_regclass('public.item_option_groups') is not null
			and to_regclass('public.item_option_group_options') is not null
			and to_regclass('public.item_option_group_targets') is not null as ready
	`;
	if (!present?.ready) {
		return {};
	}
	const groups = await upsertEntries(
		sql,
		catalog,
		"item_option_groups",
		OPTION_GROUP_COLUMNS,
		write.groups,
	);
	await sql`
		delete from public.item_option_group_options
		where pos_account_id = ${catalog.pos_account_id}
	`;
	await sql`
		delete from public.item_option_group_targets
		where pos_account_id = ${catalog.pos_account_id}
	`;
	return {
		item_option_groups: groups,
		item_option_group_options: await insertLinks(
			sql,
			catalog,
			"item_option_group_options",
			OPTION_GROUP_OPTION_COLUMNS,
			write.options,
		),
		item_option_group_targets: await insertLinks(
			sql,
			catalog,
			"item_option_group_targets",
			OPTION_GROUP_TARGET_COLUMNS,
			write.targets,
		),
	};
}

export async function replaceCatalog(
	sql: ISql,
	catalog: CatalogWrite,
): Promise<TableCounts> {
	const counts: TableCounts = {};
	for (const table of CATALOG_TABLES) {
		const entries: readonly { external_id: string }[] | null = catalog[table];
		if (entries === null) {
			continue;
		}
		counts[table] = await upsertEntries(
			sql,
			catalog,
			table,
			CATALOG_COLUMNS[table],
			entries,
		);
	}
	if (catalog.option_groups !== null) {
		Object.assign(
			counts,
			await replaceOptionGroups(sql, catalog, catalog.option_groups),
		);
	}
	return counts;
}

export async function paymentMethodKinds(
	sql: ISql,
	accountId: string,
): Promise<Record<string, PaymentKind>> {
	const rows = await sql<{ external_id: string; kind: PaymentKind }[]>`
		select external_id, kind::text as kind
		from public.payment_methods
		where pos_account_id = ${accountId}
		order by external_id
	`;
	return Object.fromEntries(rows.map((row) => [row.external_id, row.kind]));
}
