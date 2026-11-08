import { storeLockKey, storeWindowLockKey } from "../lock-key.js";
import type { MemoryState } from "./tables.js";

export class MemoryLocks {
	readonly heldLocks = new Set<string>();
	readonly lockLog: string[] = [];
	readonly windowLockLog: string[] = [];
	private readonly windowQueues = new Map<string, Promise<void>>();

	async transaction<T>(
		state: MemoryState,
		storeId: string,
		work: () => T,
	): Promise<T> {
		const key = storeLockKey(storeId);
		if (this.heldLocks.has(key)) {
			throw new Error(`store ${storeId} is locked by another writer`);
		}
		this.heldLocks.add(key);
		this.lockLog.push(key);
		const before = structuredClone(state.tables);
		try {
			return work();
		} catch (error) {
			state.tables = before;
			throw error;
		} finally {
			this.heldLocks.delete(key);
		}
	}

	async withWindowLock<T>(storeId: string, work: () => Promise<T>): Promise<T> {
		const key = storeWindowLockKey(storeId);
		const previous = this.windowQueues.get(key) ?? Promise.resolve();
		let release = (): void => undefined;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const tail = previous.then(() => held);
		this.windowQueues.set(key, tail);
		await previous;
		this.windowLockLog.push(key);
		try {
			return await work();
		} finally {
			release();
			if (this.windowQueues.get(key) === tail) {
				this.windowQueues.delete(key);
			}
		}
	}

	get windowLocksHeld(): number {
		return this.windowQueues.size;
	}
}
