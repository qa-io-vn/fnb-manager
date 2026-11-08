import type { ISql, Sql } from "postgres";
import { storeLockKey, storeWindowLockKey } from "../lock-key.js";

export async function lockStore(sql: ISql, storeId: string): Promise<void> {
	await sql`select pg_advisory_xact_lock(${storeLockKey(storeId)}::int8)`;
}

export async function withStoreWindowLock<T>(
	sql: Sql,
	storeId: string,
	work: () => Promise<T>,
): Promise<T> {
	const key = storeWindowLockKey(storeId);
	const reserved = await sql.reserve();
	try {
		await reserved`select pg_advisory_lock(${key}::int8)`;
		try {
			return await work();
		} finally {
			await reserved`select pg_advisory_unlock(${key}::int8)`;
		}
	} finally {
		reserved.release();
	}
}
