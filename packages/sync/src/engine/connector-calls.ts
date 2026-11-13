import { ConnectorError, ConnectorRateLimitError } from "@fnb/connector-core";

export class SyncBudgetError extends Error {
	readonly limit: number;

	constructor(limit: number, label: string) {
		super(
			`connector call budget of ${limit} calls exhausted before ${label}; split the window or raise the budget`,
		);
		this.name = "SyncBudgetError";
		this.limit = limit;
	}
}

export interface RetryPolicy {
	attempts: number;
	baseDelayMs: number;
	maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
	attempts: 3,
	baseDelayMs: 1_000,
	maxDelayMs: 30_000,
};

export const DEFAULT_CALL_BUDGET = 400;

export type Sleep = (milliseconds: number) => Promise<void>;

export const realSleep: Sleep = (milliseconds) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));

function sleepUntilAborted(
	sleep: Sleep,
	milliseconds: number,
	signal: AbortSignal | undefined,
): Promise<void> {
	if (!signal) {
		return sleep(milliseconds);
	}
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const onAbort = () => reject(signal.reason);
		signal.addEventListener("abort", onAbort, { once: true });
		sleep(milliseconds).then(
			() => {
				signal.removeEventListener("abort", onAbort);
				resolve();
			},
			(error: unknown) => {
				signal.removeEventListener("abort", onAbort);
				reject(error);
			},
		);
	});
}

export function isRetryable(error: unknown): boolean {
	if (error instanceof ConnectorRateLimitError) {
		return true;
	}
	return (
		!(error instanceof ConnectorError) && !(error instanceof SyncBudgetError)
	);
}

export function retryDelay(
	error: unknown,
	attempt: number,
	policy: RetryPolicy,
): number {
	if (error instanceof ConnectorRateLimitError && error.retryAfterMs !== null) {
		return Math.min(error.retryAfterMs, policy.maxDelayMs);
	}
	return Math.min(policy.baseDelayMs * 2 ** (attempt - 1), policy.maxDelayMs);
}

function settleUntilAborted<T>(
	work: Promise<T>,
	signal: AbortSignal | undefined,
): Promise<T> {
	if (!signal) {
		return work;
	}
	return new Promise((resolve, reject) => {
		const onAbort = () => reject(signal.reason);
		if (signal.aborted) {
			onAbort();
			return;
		}
		signal.addEventListener("abort", onAbort, { once: true });
		work.then(
			(value) => {
				signal.removeEventListener("abort", onAbort);
				resolve(value);
			},
			(error: unknown) => {
				signal.removeEventListener("abort", onAbort);
				reject(error);
			},
		);
	});
}

export interface ConnectorCallerOptions {
	budget?: number;
	retry?: RetryPolicy;
	sleep?: Sleep;
	signal?: AbortSignal;
}

export class ConnectorCaller {
	readonly limit: number;
	private readonly policy: RetryPolicy;
	private readonly sleep: Sleep;
	private readonly signal: AbortSignal | undefined;
	private used = 0;
	private retries = 0;

	constructor(options: ConnectorCallerOptions = {}) {
		this.limit = options.budget ?? DEFAULT_CALL_BUDGET;
		this.policy = options.retry ?? DEFAULT_RETRY_POLICY;
		this.sleep = options.sleep ?? realSleep;
		this.signal = options.signal;
	}

	get calls(): number {
		return this.used;
	}

	get retried(): number {
		return this.retries;
	}

	async call<T>(label: string, work: () => Promise<T>): Promise<T> {
		for (let attempt = 1; ; attempt += 1) {
			this.signal?.throwIfAborted();
			if (this.used >= this.limit) {
				throw new SyncBudgetError(this.limit, label);
			}
			this.used += 1;
			try {
				return await settleUntilAborted(work(), this.signal);
			} catch (error) {
				if (
					attempt >= this.policy.attempts ||
					!isRetryable(error) ||
					this.signal?.aborted
				) {
					throw error;
				}
				this.retries += 1;
				await sleepUntilAborted(
					this.sleep,
					retryDelay(error, attempt, this.policy),
					this.signal,
				);
			}
		}
	}
}
