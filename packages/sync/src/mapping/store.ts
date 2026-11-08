import type { CanonicalStore } from "@fnb/core";
import { toJson } from "../json.js";
import type { StoreRecord, StoreUpsert } from "../rows.js";
import { textOrNull } from "./text.js";

export function toStoreUpsert(store: CanonicalStore): StoreUpsert {
	return {
		external_id: store.externalId,
		name: store.name,
		address: textOrNull(store.address),
		timezone: store.timezone,
		business_day_start_minutes: store.dayStartMinutes,
		opened_on: store.openedOn ?? null,
		raw: toJson(store),
	};
}

export function toCanonicalStore(
	store: StoreRecord,
	currency: string,
): CanonicalStore {
	return {
		externalId: store.external_id,
		name: store.name,
		...(store.address ? { address: store.address } : {}),
		timezone: store.timezone,
		dayStartMinutes: store.business_day_start_minutes,
		currency,
		...(store.opened_on ? { openedOn: store.opened_on } : {}),
	};
}
