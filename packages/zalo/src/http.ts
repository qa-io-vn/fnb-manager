export const ZALO_HTTP_TIMEOUT_MS = 10_000;

export interface ZaloRequestInit {
	readonly method: "GET" | "POST" | "DELETE";
	readonly headers: Readonly<Record<string, string>>;
	readonly body?: string;
	readonly signal?: AbortSignal;
}

export type ZaloFetch = (
	url: string,
	init: ZaloRequestInit,
) => Promise<Response>;

export type UpstreamFailure =
	| "timeout"
	| "network"
	| "status"
	| "invalid_answer";

export type UpstreamService = "zalo" | "supabase";

const SERVICE_NAMES: Readonly<Record<UpstreamService, string>> = {
	zalo: "the Zalo graph",
	supabase: "the Supabase API",
};

const FAILURE_TEXT: Readonly<Record<UpstreamFailure, string>> = {
	timeout: "did not answer in time",
	network: "could not be reached",
	status: "answered with an HTTP error",
	invalid_answer: "answered with something other than the expected JSON",
};

export class UpstreamError extends Error {
	readonly service: UpstreamService;
	readonly failure: UpstreamFailure;
	readonly status: number | null;

	constructor(
		service: UpstreamService,
		failure: UpstreamFailure,
		status: number | null = null,
	) {
		super(
			`${SERVICE_NAMES[service]} ${FAILURE_TEXT[failure]}${status === null ? "" : ` (HTTP ${status})`}`,
		);
		this.name = "UpstreamError";
		this.service = service;
		this.failure = failure;
		this.status = status;
	}
}

export interface TimedFetchOptions {
	readonly service: UpstreamService;
	readonly fetch?: ZaloFetch | undefined;
	readonly timeoutMs?: number | undefined;
}

const globalFetch: ZaloFetch = (url, init) => fetch(url, init);

export async function timedFetch(
	url: string,
	init: ZaloRequestInit,
	options: TimedFetchOptions,
): Promise<Response> {
	const send = options.fetch ?? globalFetch;
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const expired = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			controller.abort();
			reject(new UpstreamError(options.service, "timeout"));
		}, options.timeoutMs ?? ZALO_HTTP_TIMEOUT_MS);
	});
	const sent = send(url, { ...init, signal: controller.signal }).catch(
		(error: unknown) => {
			throw error instanceof UpstreamError
				? error
				: new UpstreamError(options.service, "network");
		},
	);
	try {
		return await Promise.race([sent, expired]);
	} finally {
		clearTimeout(timer);
	}
}

export async function readJson(
	response: Response,
	service: UpstreamService,
): Promise<unknown> {
	let text: string;
	try {
		text = await response.text();
	} catch {
		throw new UpstreamError(service, "network", response.status);
	}
	if (text.trim() === "") {
		return null;
	}
	try {
		return JSON.parse(text);
	} catch {
		throw new UpstreamError(service, "invalid_answer", response.status);
	}
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
