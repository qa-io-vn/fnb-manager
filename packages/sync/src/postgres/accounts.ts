import type { ISql } from "postgres";
import type {
	AccountRecord,
	AccountUpsert,
	StoreRecord,
	StoreUpsert,
	TableCounts,
	TokenRecord,
} from "../rows.js";
import { STORE_COLUMNS } from "./columns.js";
import {
	chunkRows,
	excludedAssignments,
	isoOrNull,
	toSqlRow,
} from "./values.js";

interface AccountQueryRow {
	id: string;
	tenant_id: string;
	tenant_slug: string;
	tenant_currency: string;
	connector: string;
	account_key: string;
	display_name: string;
	status: AccountRecord["status"];
	last_synced_at: Date | null;
}

function toAccount(row: AccountQueryRow): AccountRecord {
	return { ...row, last_synced_at: isoOrNull(row.last_synced_at) };
}

export async function findAccounts(
	sql: ISql,
	accountKey: string,
	tenantSlug: string | undefined,
): Promise<AccountRecord[]> {
	const rows = await sql<AccountQueryRow[]>`
		select a.id, a.tenant_id, t.slug as tenant_slug, t.currency_code as tenant_currency,
			a.connector, a.account_key, a.display_name, a.status::text as status, a.last_synced_at
		from public.pos_accounts a
		join public.tenants t on t.id = a.tenant_id
		where a.account_key = ${accountKey}
			and (${tenantSlug ?? null}::text is null or t.slug = ${tenantSlug ?? null}::text)
		order by t.slug, a.id
	`;
	return rows.map(toAccount);
}

export async function upsertAccount(
	sql: ISql,
	account: AccountUpsert,
): Promise<AccountRecord> {
	const rows = await sql<AccountQueryRow[]>`
		with upserted as (
			insert into public.pos_accounts (tenant_id, connector, account_key, display_name)
			values (${account.tenant_id}, ${account.connector}, ${account.account_key}, ${account.display_name})
			on conflict (tenant_id, account_key)
			do update set connector = excluded.connector, display_name = excluded.display_name
			returning id, tenant_id, connector, account_key, display_name, status, last_synced_at
		)
		select u.id, u.tenant_id, t.slug as tenant_slug, t.currency_code as tenant_currency,
			u.connector, u.account_key, u.display_name, u.status::text as status, u.last_synced_at
		from upserted u
		join public.tenants t on t.id = u.tenant_id
	`;
	const [row] = rows;
	if (!row) {
		throw new Error("pos account upsert returned no row");
	}
	return toAccount(row);
}

export async function readToken(
	sql: ISql,
	accountId: string,
): Promise<TokenRecord | null> {
	const rows = await sql<{ token: string; expires_at: Date }[]>`
		select token, expires_at from public.pos_account_tokens where pos_account_id = ${accountId}
	`;
	const [row] = rows;
	return row
		? { token: row.token, expires_at: row.expires_at.toISOString() }
		: null;
}

export async function writeToken(
	sql: ISql,
	accountId: string,
	token: TokenRecord,
): Promise<void> {
	await sql`
		insert into public.pos_account_tokens (pos_account_id, token, expires_at)
		values (${accountId}, ${token.token}, ${token.expires_at})
		on conflict (pos_account_id)
		do update set token = excluded.token, expires_at = excluded.expires_at
	`;
}

interface StoreQueryRow extends StoreRecord {}

export async function listStores(
	sql: ISql,
	accountId: string,
): Promise<StoreRecord[]> {
	return sql<StoreQueryRow[]>`
		select id, tenant_id, pos_account_id, external_id, code, name, address, timezone,
			business_day_start_minutes, opened_on::text as opened_on, active
		from public.stores
		where pos_account_id = ${accountId}
		order by external_id
	`;
}

const STORE_UPDATE_COLUMNS = [
	"name",
	"address",
	"timezone",
	"business_day_start_minutes",
	"raw",
];

export async function upsertStores(
	sql: ISql,
	account: Pick<AccountRecord, "id" | "tenant_id">,
	stores: readonly StoreUpsert[],
): Promise<TableCounts> {
	const columns = ["tenant_id", "pos_account_id", ...STORE_COLUMNS];
	let written = 0;
	for (const chunk of chunkRows(stores, columns.length)) {
		const rows = chunk.map((store) =>
			toSqlRow(
				{ ...store, tenant_id: account.tenant_id, pos_account_id: account.id },
				columns,
			),
		);
		const result = await sql`
			insert into public.stores ${sql(rows, columns)}
			on conflict (pos_account_id, external_id)
			do update set ${sql.unsafe(excludedAssignments(STORE_UPDATE_COLUMNS))},
				opened_on = coalesce(public.stores.opened_on, excluded.opened_on),
				active = true,
				last_seen_at = now()
		`;
		written += result.count;
	}
	await sql`
		update public.stores
		set active = false
		where pos_account_id = ${account.id}
			and active
			and external_id <> all(${stores.map((store) => store.external_id)}::text[])
	`;
	return { stores: written };
}

export async function markAccountSynced(
	sql: ISql,
	accountId: string,
	finishedAt: string,
): Promise<void> {
	await sql`
		update public.pos_accounts set last_synced_at = ${finishedAt} where id = ${accountId}
	`;
}
