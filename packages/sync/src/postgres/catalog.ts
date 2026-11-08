import type { PaymentKind } from "@fnb/core";
import type { ISql } from "postgres";
import type { CatalogWrite, TableCounts } from "../rows.js";
import { CATALOG_COLUMNS, CATALOG_TABLES } from "./columns.js";
import { chunkRows, excludedAssignments, toSqlRow } from "./values.js";

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
		const tableColumns: readonly string[] = CATALOG_COLUMNS[table];
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
		counts[table] = written;
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
