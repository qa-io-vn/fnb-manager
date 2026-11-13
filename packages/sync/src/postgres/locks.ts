import type { ISql, ReservedSql, Sql } from "postgres";
import { storeLockKey, storeWindowLockKey } from "../lock-key.js";
import type { StoreLockOptions } from "../repository.js";
import {
	LOCK_POLL_INTERVAL_MS,
	lockDeadline,
	StoreLockBusyError,
} from "../store-lock.js";

export async function lockStore(sql: ISql, storeId: string): Promise<void> {
	await sql`select pg_advisory_xact_lock(${storeLockKey(storeId)}::int8)`;
}

function pause(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireWithin(
	reserved: ReservedSql,
	key: string,
	waitMs: number,
): Promise<void> {
	const deadline = lockDeadline(waitMs, Date.now());
	for (;;) {
		const [row] = await reserved<{ locked: boolean }[]>`
			select pg_try_advisory_lock(${key}::int8) as locked
		`;
		if (row?.locked) {
			return;
		}
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			throw new StoreLockBusyError(waitMs);
		}
		await pause(Math.min(LOCK_POLL_INTERVAL_MS, remaining));
	}
}

export async function withStoreWindowLock<T>(
	sql: Sql,
	storeId: string,
	work: () => Promise<T>,
	options: StoreLockOptions = {},
): Promise<T> {
	const key = storeWindowLockKey(storeId);
	const reserved = await sql.reserve();
	try {
		if (options.waitMs === undefined) {
			await reserved`select pg_advisory_lock(${key}::int8)`;
		} else {
			await acquireWithin(reserved, key, options.waitMs);
		}
		try {
			return await work();
		} finally {
			await reserved`select pg_advisory_unlock(${key}::int8)`;
		}
	} finally {
		reserved.release();
	}
}
