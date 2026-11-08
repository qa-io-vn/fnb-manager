import { fnv1a64 } from "./hash.js";

export const STORE_LOCK_NAMESPACE = "fnb-sync:store:";

export function storeLockKey(storeId: string): string {
	return BigInt.asIntN(
		64,
		fnv1a64(`${STORE_LOCK_NAMESPACE}${storeId}`),
	).toString();
}

export const STORE_WINDOW_LOCK_NAMESPACE = "fnb-sync:store-window:";

export function storeWindowLockKey(storeId: string): string {
	return BigInt.asIntN(
		64,
		fnv1a64(`${STORE_WINDOW_LOCK_NAMESPACE}${storeId}`),
	).toString();
}
