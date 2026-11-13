export class StoreLockBusyError extends Error {
	readonly waitMs: number;

	constructor(waitMs: number) {
		super(
			`another sync run held the store's window lock for longer than ${waitMs} ms`,
		);
		this.name = "StoreLockBusyError";
		this.waitMs = waitMs;
	}
}

export const LOCK_POLL_INTERVAL_MS = 250;

export function lockDeadline(waitMs: number, now: number): number {
	if (!Number.isFinite(waitMs) || waitMs < 0) {
		throw new RangeError(
			`a lock wait must be zero or more milliseconds, got ${waitMs}`,
		);
	}
	return now + waitMs;
}
