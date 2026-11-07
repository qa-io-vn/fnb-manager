import { ConnectorError } from "@fnb/connector-core";
import type { CanonicalStore } from "@fnb/core";
import type { IposClient } from "../client.js";
import type { LoginPayload } from "../schemas/login.js";
import { IPOS_CONNECTOR_ID } from "./descriptor.js";
import { MINUTES_PER_HOUR, type ResolvedIposOptions } from "./options.js";

export interface StoreScopeEntry {
	companyUid: string;
	brandUid: string;
	storeUid: string;
	currency: string;
	dayStartMinutes: number;
}

const DEFAULT_CURRENCY = "VND";

interface StoreLike {
	id: string;
	store_name: string;
	address?: string | null | undefined;
	brand_uid: string;
	open_at?: number | null | undefined;
}

export class StoreDirectory {
	private readonly entries = new Map<string, StoreScopeEntry>();

	set(entry: StoreScopeEntry): void {
		this.entries.set(entry.storeUid, entry);
	}

	get(storeUid: string): StoreScopeEntry | undefined {
		return this.entries.get(storeUid);
	}

	require(storeUid: string): StoreScopeEntry {
		const entry = this.entries.get(storeUid);
		if (!entry) {
			throw new ConnectorError(
				IPOS_CONNECTOR_ID,
				`store ${storeUid} is unknown to this session; call discoverStores() first`,
			);
		}
		return entry;
	}
}

export function dayStartFromOpenAt(
	openAtHours: number | null | undefined,
): number {
	const hours = Math.trunc(openAtHours ?? 0);
	return hours > 0 && hours < 24 ? hours * MINUTES_PER_HOUR : 0;
}

export function resolveDayStart(
	store: Pick<StoreLike, "open_at">,
	options: ResolvedIposOptions,
): number {
	return options.dayStartMinutes ?? dayStartFromOpenAt(store.open_at);
}

function toCanonicalStore(
	store: StoreLike,
	currency: string,
	options: ResolvedIposOptions,
): CanonicalStore {
	const address = store.address?.trim();
	return {
		externalId: store.id,
		name: store.store_name,
		...(address ? { address } : {}),
		timezone: options.timezone,
		dayStartMinutes: resolveDayStart(store, options),
		currency,
	};
}

function mergeStoreRows(
	fromLogin: readonly StoreLike[],
	listed: readonly StoreLike[],
): StoreLike[] {
	const merged = new Map<string, StoreLike>();
	for (const store of listed) {
		merged.set(store.id, store);
	}
	for (const store of fromLogin) {
		const existing = merged.get(store.id);
		merged.set(store.id, {
			...existing,
			...store,
			address: store.address?.trim() || existing?.address,
			open_at: store.open_at ?? existing?.open_at,
		});
	}
	return [...merged.values()];
}

export async function discoverIposStores(
	client: IposClient,
	payload: LoginPayload,
	options: ResolvedIposOptions,
	directory: StoreDirectory,
): Promise<CanonicalStore[]> {
	const companyUid = payload.company.id;
	const stores: CanonicalStore[] = [];
	for (const brand of payload.brands) {
		const currency = brand.currency?.trim() || DEFAULT_CURRENCY;
		const listed = await client.listStores({ companyUid, brandUid: brand.id });
		const fromLogin = payload.stores.filter(
			(store) => store.brand_uid === brand.id,
		);
		for (const store of mergeStoreRows(fromLogin, listed)) {
			const canonical = toCanonicalStore(store, currency, options);
			directory.set({
				companyUid,
				brandUid: brand.id,
				storeUid: store.id,
				currency,
				dayStartMinutes: canonical.dayStartMinutes,
			});
			stores.push(canonical);
		}
	}
	return stores;
}
