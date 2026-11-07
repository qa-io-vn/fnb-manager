import type { ZodType } from "zod";
import {
	IposAuthError,
	IposHttpError,
	IposNetworkError,
	IposSchemaError,
} from "./errors.js";
import type { IposLogger } from "./logger.js";
import { readErrorEnvelope } from "./schemas/envelope.js";

export type QueryValue = string | number | boolean | undefined;
export type QueryParams = Record<string, QueryValue>;
export type HeaderMap = Record<string, string>;
export type FetchLike = typeof fetch;

export interface RetryOptions {
	attempts?: number;
	baseDelayMs?: number;
}

export type RetryPolicy = Required<RetryOptions>;

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
	attempts: 3,
	baseDelayMs: 500,
};

export interface RequestSpec<T> {
	method?: "GET" | "POST";
	path: string;
	query?: QueryParams;
	body?: unknown;
	headers?: HeaderMap;
	schema: ZodType<T>;
	signal?: AbortSignal | undefined;
}

export interface Transport {
	request<T>(spec: RequestSpec<T>): Promise<T>;
}

export interface TransportOptions {
	baseUrl: string;
	fetchImpl: FetchLike;
	defaultHeaders: HeaderMap;
	retry: RetryPolicy;
	logger: IposLogger;
	sleep?: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
}

export function buildUrl(
	baseUrl: string,
	path: string,
	query: QueryParams | undefined,
): URL {
	const url = new URL(path, baseUrl);
	for (const [name, value] of Object.entries(query ?? {})) {
		if (value !== undefined) {
			url.searchParams.set(name, String(value));
		}
	}
	return url;
}

export function isRetryableStatus(status: number): boolean {
	return status === 429 || status >= 500;
}

export function backoffDelayMs(baseDelayMs: number, attempt: number): number {
	return baseDelayMs * 2 ** (attempt - 1);
}

export function sleepUnlessAborted(
	ms: number,
	signal: AbortSignal | undefined,
): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason);
			return;
		}
		const onAbort = () => {
			clearTimeout(timer);
			reject(signal?.reason);
		};
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

function parseJsonBody(
	bodyText: string,
): { ok: true; value: unknown } | { ok: false } {
	if (bodyText.trim() === "") {
		return { ok: true, value: null };
	}
	try {
		return { ok: true, value: JSON.parse(bodyText) as unknown };
	} catch {
		return { ok: false };
	}
}

function failureFromResponse(
	status: number,
	bodyText: string,
	endpoint: string,
): IposHttpError | IposAuthError {
	const parsed = parseJsonBody(bodyText);
	const envelope = parsed.ok ? readErrorEnvelope(parsed.value) : null;
	const details = {
		status,
		endpoint,
		trackId: envelope?.track_id ?? null,
		serverMessage: envelope?.error.message ?? null,
	};
	return status === 401
		? new IposAuthError(details)
		: new IposHttpError(details);
}

function validateSuccess<T>(
	status: number,
	bodyText: string,
	endpoint: string,
	schema: ZodType<T>,
): T {
	const parsed = parseJsonBody(bodyText);
	if (!parsed.ok) {
		throw new IposSchemaError(endpoint, [], "returned a body that is not JSON");
	}
	const errorEnvelope = readErrorEnvelope(parsed.value);
	if (errorEnvelope) {
		throw new IposHttpError({
			status,
			endpoint,
			trackId: errorEnvelope.track_id ?? null,
			serverMessage: errorEnvelope.error.message ?? null,
		});
	}
	const result = schema.safeParse(parsed.value);
	if (!result.success) {
		throw new IposSchemaError(endpoint, result.error.issues);
	}
	return result.data;
}

export function createTransport(options: TransportOptions): Transport {
	const { baseUrl, fetchImpl, defaultHeaders, retry, logger } = options;
	const sleep = options.sleep ?? sleepUnlessAborted;
	const maxAttempts = Math.max(1, retry.attempts);

	async function request<T>(spec: RequestSpec<T>): Promise<T> {
		const method = spec.method ?? "GET";
		const url = buildUrl(baseUrl, spec.path, spec.query);
		const init: RequestInit = {
			method,
			headers: { ...defaultHeaders, ...spec.headers },
		};
		if (spec.body !== undefined) {
			init.body = JSON.stringify(spec.body);
		}
		if (spec.signal) {
			init.signal = spec.signal;
		}

		for (let attempt = 1; ; attempt += 1) {
			spec.signal?.throwIfAborted();
			const startedAt = Date.now();
			let response: Response;
			try {
				response = await fetchImpl(url.toString(), init);
			} catch (error) {
				if (
					isAbortError(error) ||
					spec.signal?.aborted ||
					attempt >= maxAttempts
				) {
					throw isAbortError(error)
						? error
						: new IposNetworkError(spec.path, error);
				}
				logger.warn("ipos request failed before a response arrived, retrying", {
					method,
					endpoint: spec.path,
					attempt,
				});
				await sleep(backoffDelayMs(retry.baseDelayMs, attempt), spec.signal);
				continue;
			}

			const bodyText = await response.text();
			logger.debug("ipos response", {
				method,
				endpoint: spec.path,
				status: response.status,
				attempt,
				durationMs: Date.now() - startedAt,
			});

			if (response.ok) {
				return validateSuccess(
					response.status,
					bodyText,
					spec.path,
					spec.schema,
				);
			}

			const failure = failureFromResponse(response.status, bodyText, spec.path);
			if (isRetryableStatus(response.status) && attempt < maxAttempts) {
				logger.warn("ipos request failed, retrying", {
					method,
					endpoint: spec.path,
					status: response.status,
					attempt,
				});
				await sleep(backoffDelayMs(retry.baseDelayMs, attempt), spec.signal);
				continue;
			}
			throw failure;
		}
	}

	return { request };
}
