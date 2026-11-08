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

export interface ConnectorCallerOptions {
	budget?: number;
	retry?: RetryPolicy;
	sleep?: Sleep;
}

export class ConnectorCaller {
	readonly limit: number;
	private readonly policy: RetryPolicy;
	private readonly sleep: Sleep;
	private used = 0;
	private retries = 0;

	constructor(options: ConnectorCallerOptions = {}) {
		this.limit = options.budget ?? DEFAULT_CALL_BUDGET;
		this.policy = options.retry ?? DEFAULT_RETRY_POLICY;
		this.sleep = options.sleep ?? realSleep;
	}

	get calls(): number {
		return this.used;
	}

	get retried(): number {
		return this.retries;
	}

	async call<T>(label: string, work: () => Promise<T>): Promise<T> {
		for (let attempt = 1; ; attempt += 1) {
			if (this.used >= this.limit) {
				throw new SyncBudgetError(this.limit, label);
			}
			this.used += 1;
			try {
				return await work();
			} catch (error) {
				if (attempt >= this.policy.attempts || !isRetryable(error)) {
					throw error;
				}
				this.retries += 1;
				await this.sleep(retryDelay(error, attempt, this.policy));
			}
		}
	}
}
