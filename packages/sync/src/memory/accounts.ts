import type { StoreUpsertResult } from "../repository.js";
import type {
	AccountRecord,
	AccountUpsert,
	StoreRecord,
	StoreUpsert,
} from "../rows.js";
import {
	byText,
	type MemoryState,
	type MemoryTenant,
	type StoredAccount,
	type StoredStore,
} from "./tables.js";

export function addTenant(
	state: MemoryState,
	slug: string,
	currency: string,
): MemoryTenant {
	const tenant = { id: state.nextId("tenant"), slug, currency_code: currency };
	state.tables.tenants.push(tenant);
	return tenant;
}

export function accountRecord(
	state: MemoryState,
	account: StoredAccount,
): AccountRecord {
	const tenant = state.tables.tenants.find(
		(candidate) => candidate.id === account.tenant_id,
	);
	if (!tenant) {
		throw new Error(`account ${account.id} has no tenant`);
	}
	return {
		id: account.id,
		tenant_id: account.tenant_id,
		tenant_slug: tenant.slug,
		tenant_currency: tenant.currency_code,
		connector: account.connector,
		account_key: account.account_key,
		display_name: account.display_name,
		status: account.status,
		last_synced_at: account.last_synced_at,
	};
}

export function storeRecord(store: StoredStore): StoreRecord {
	return {
		id: store.id,
		tenant_id: store.tenant_id,
		pos_account_id: store.pos_account_id,
		external_id: store.external_id,
		code: store.code,
		name: store.name,
		address: store.address,
		timezone: store.timezone,
		business_day_start_minutes: store.business_day_start_minutes,
		opened_on: store.opened_on,
		active: store.active,
	};
}

export function findAccounts(
	state: MemoryState,
	accountKey: string,
	tenantSlug: string | undefined,
): AccountRecord[] {
	return state.tables.accounts
		.filter((account) => account.account_key === accountKey)
		.map((account) => accountRecord(state, account))
		.filter(
			(account) =>
				tenantSlug === undefined || account.tenant_slug === tenantSlug,
		)
		.sort((left, right) => byText(left.tenant_slug, right.tenant_slug));
}

export function upsertAccount(
	state: MemoryState,
	account: AccountUpsert,
): AccountRecord {
	const existing = state.tables.accounts.find(
		(candidate) =>
			candidate.tenant_id === account.tenant_id &&
			candidate.account_key === account.account_key,
	);
	if (existing) {
		existing.connector = account.connector;
		existing.display_name = account.display_name;
		return accountRecord(state, existing);
	}
	const created: StoredAccount = {
		id: state.nextId("account"),
		tenant_id: account.tenant_id,
		connector: account.connector,
		account_key: account.account_key,
		display_name: account.display_name,
		status: "active",
		last_synced_at: null,
	};
	state.tables.accounts.push(created);
	return accountRecord(state, created);
}

export function markAccountSynced(
	state: MemoryState,
	accountId: string,
	finishedAt: string,
): void {
	const account = state.tables.accounts.find(
		(candidate) => candidate.id === accountId,
	);
	if (account) {
		account.last_synced_at = finishedAt;
	}
}

export function addStore(
	state: MemoryState,
	account: Pick<AccountRecord, "id" | "tenant_id">,
	store: StoreUpsert,
): StoreRecord {
	const stamp = state.timestamp();
	const stored: StoredStore = {
		id: state.nextId("store"),
		tenant_id: account.tenant_id,
		pos_account_id: account.id,
		external_id: store.external_id,
		code: null,
		name: store.name,
		address: store.address,
		timezone: store.timezone,
		business_day_start_minutes: store.business_day_start_minutes,
		opened_on: store.opened_on,
		active: true,
		raw: store.raw,
		first_seen_at: stamp,
		last_seen_at: stamp,
	};
	state.tables.stores.push(stored);
	return storeRecord(stored);
}

export function listStores(
	state: MemoryState,
	accountId: string,
): StoreRecord[] {
	return state.tables.stores
		.filter((store) => store.pos_account_id === accountId)
		.sort((left, right) => byText(left.external_id, right.external_id))
		.map(storeRecord);
}

export function upsertStores(
	state: MemoryState,
	account: Pick<AccountRecord, "id" | "tenant_id">,
	stores: readonly StoreUpsert[],
): StoreUpsertResult {
	const stamp = state.timestamp();
	const seen = new Set(stores.map((store) => store.external_id));
	for (const store of stores) {
		const existing = state.tables.stores.find(
			(candidate) =>
				candidate.pos_account_id === account.id &&
				candidate.external_id === store.external_id,
		);
		if (existing) {
			Object.assign(existing, {
				name: store.name,
				address: store.address,
				timezone: store.timezone,
				business_day_start_minutes: store.business_day_start_minutes,
				opened_on: existing.opened_on ?? store.opened_on,
				raw: store.raw,
				active: true,
				last_seen_at: stamp,
			});
		} else {
			addStore(state, account, store);
		}
	}
	for (const store of state.tables.stores) {
		if (store.pos_account_id === account.id && !seen.has(store.external_id)) {
			store.active = false;
		}
	}
	return {
		stores: listStores(state, account.id),
		counts: { stores: stores.length },
	};
}
