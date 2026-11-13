import type { FetchLike, SendOutcome } from "./types.js";

const MAX_BODY_CHARACTERS = 65_536;

export type FailureCode = "timeout" | "network" | "connection_lost";

const NEVER_CONNECTED_ERROR_CODES: ReadonlySet<string> = new Set([
	"ECONNREFUSED",
	"ENOTFOUND",
	"EAI_AGAIN",
	"EAI_FAIL",
	"EAI_NONAME",
	"EAI_NODATA",
	"EHOSTUNREACH",
	"EHOSTDOWN",
	"ENETUNREACH",
	"ENETDOWN",
	"EADDRNOTAVAIL",
	"UND_ERR_CONNECT_TIMEOUT",
	"ERR_INVALID_URL",
	"ERR_TLS_CERT_ALTNAME_INVALID",
	"ERR_TLS_HANDSHAKE_TIMEOUT",
	"ERR_SSL_WRONG_VERSION_NUMBER",
	"CERT_HAS_EXPIRED",
	"CERT_NOT_YET_VALID",
	"CERT_REVOKED",
	"CERT_UNTRUSTED",
	"CERT_REJECTED",
	"CERT_SIGNATURE_FAILURE",
	"DEPTH_ZERO_SELF_SIGNED_CERT",
	"SELF_SIGNED_CERT_IN_CHAIN",
	"UNABLE_TO_VERIFY_LEAF_SIGNATURE",
	"UNABLE_TO_GET_ISSUER_CERT",
	"UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
	"HOSTNAME_MISMATCH",
]);

const NEVER_CONNECTED_ERROR_NAMES: ReadonlySet<string> = new Set([
	"ConnectionRefused",
	"AddrNotAvailable",
]);

const DENO_CONNECT_PHASE_MESSAGE = /client error \(Connect\)/;

const MAX_CAUSE_DEPTH = 5;

export interface TimedResponse {
	readonly kind: "response";
	readonly status: number;
	readonly headers: Headers;
	readonly body: string;
}

export interface TimedFailure {
	readonly kind: "failure";
	readonly code: FailureCode;
}

export type TimedFetchResult = TimedResponse | TimedFailure;

function isTimeoutError(error: unknown): boolean {
	return (
		error instanceof Error &&
		(error.name === "TimeoutError" || error.name === "AbortError")
	);
}

function errorChain(error: unknown): unknown[] {
	const chain: unknown[] = [];
	const pending: { value: unknown; depth: number }[] = [
		{ value: error, depth: 0 },
	];
	while (pending.length > 0) {
		const next = pending.shift();
		if (
			next === undefined ||
			next.depth > MAX_CAUSE_DEPTH ||
			!isRecord(next.value)
		) {
			continue;
		}
		chain.push(next.value);
		pending.push({ value: next.value.cause, depth: next.depth + 1 });
		const grouped = next.value.errors;
		if (Array.isArray(grouped)) {
			for (const member of grouped) {
				pending.push({ value: member, depth: next.depth + 1 });
			}
		}
	}
	return chain;
}

function showsNoConnectionWasMade(link: unknown): boolean {
	if (!isRecord(link)) {
		return false;
	}
	const { code, name, message } = link;
	return (
		(typeof code === "string" && NEVER_CONNECTED_ERROR_CODES.has(code)) ||
		(typeof name === "string" && NEVER_CONNECTED_ERROR_NAMES.has(name)) ||
		(typeof message === "string" && DENO_CONNECT_PHASE_MESSAGE.test(message))
	);
}

export function classifyFetchRejection(
	error: unknown,
	timedOut: boolean,
): FailureCode {
	if (timedOut || isTimeoutError(error)) {
		return "timeout";
	}
	return errorChain(error).some(showsNoConnectionWasMade)
		? "network"
		: "connection_lost";
}

export async function timedFetch(
	fetchLike: FetchLike,
	url: string,
	init: RequestInit,
	timeoutMs: number,
): Promise<TimedFetchResult> {
	const signal = AbortSignal.timeout(timeoutMs);
	try {
		const response = await fetchLike(url, { ...init, signal });
		const text = await response.text();
		return {
			kind: "response",
			status: response.status,
			headers: response.headers,
			body: text.slice(0, MAX_BODY_CHARACTERS),
		};
	} catch (error) {
		return {
			kind: "failure",
			code: classifyFetchRejection(error, signal.aborted),
		};
	}
}

export function failureOutcome(
	code: FailureCode,
	idempotent: boolean,
): SendOutcome {
	if (code !== "network" && !idempotent) {
		return { kind: "uncertain", code };
	}
	return { kind: "retry", code, retryAfterSeconds: null };
}

export function parseJson(text: string): unknown {
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return null;
	}
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function retryAfterSeconds(
	headers: Headers,
	now: () => Date,
): number | null {
	const value = headers.get("retry-after");
	if (value === null || value.trim() === "") {
		return null;
	}
	if (/^\d+$/.test(value.trim())) {
		return Number(value.trim());
	}
	const at = Date.parse(value);
	if (Number.isNaN(at)) {
		return null;
	}
	return Math.max(0, Math.ceil((at - now().getTime()) / 1000));
}

export function jsonHeaders(userAgent: string): Record<string, string> {
	return {
		"content-type": "application/json; charset=utf-8",
		accept: "application/json",
		"user-agent": userAgent,
	};
}

export function httpCode(status: number): string {
	return `http_${status}`;
}
