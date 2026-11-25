import {
	isRecord,
	UpstreamError,
	type ZaloFetch,
	type ZaloRequestInit,
} from "./http.js";

/**
 * The Zalo Graph relay (G-109, ADR-057). graph.zalo.me answers error -501 to calls from servers outside Vietnam,
 * which is every Supabase Edge region, so the zalo-session and zalo-phone functions send their Graph calls through a
 * small relay that runs in Vietnam. Function and relay share one 256-bit key (ZALO_RELAY_KEY): every request,
 * answer and address announcement is sealed with AES-256-GCM under it, so whatever carries the traffic (a Cloudflare
 * tunnel) can neither read the access token, the proof or the App secret nor forge or swap a message. The relay
 * forwards only GET calls to two Graph paths with a fixed set of headers, refuses stale and replayed requests, and
 * binds each answer to its request.
 */

export const ZALO_RELAY_KEY_VARIABLE = "ZALO_RELAY_KEY";
export const ZALO_GRAPH_ORIGIN = "https://graph.zalo.me";
export const RELAY_PATH = "/relay";
export const RELAY_KEY_BYTES = 32;
export const RELAY_MAX_SKEW_MS = 60_000;
export const RELAY_ANNOUNCE_MAX_SKEW_MS = 120_000;
export const RELAY_HEARTBEAT_MS = 5 * 60_000;
export const RELAY_MAX_ENVELOPE_BYTES = 96 * 1024;
export const RELAY_MAX_ANSWER_BYTES = 64 * 1024;
export const RELAY_MAX_HEADER_LENGTH = 4096;
export const RELAY_URL_MAX_LENGTH = 200;

const ENVELOPE_VERSION = 1;
const IV_BYTES = 12;
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const QUERY_PATTERN = /^(fields=[a-z_]{1,20}(,[a-z_]{1,20}){0,5})?$/;
const HOST_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const TOP_LEVEL_LABEL = /^[a-z]{2,63}$/;

export const RELAY_GRAPH_PATHS = ["/v2.0/me", "/v2.0/me/info"] as const;
export type RelayGraphPath = (typeof RELAY_GRAPH_PATHS)[number];

const ALLOWED_HEADERS: Readonly<Record<RelayGraphPath, readonly string[]>> = {
	"/v2.0/me": ["access_token", "appsecret_proof"],
	"/v2.0/me/info": ["access_token", "code", "secret_key"],
};

export type RelayPurpose = "request" | "answer" | "announce";

export type RelayRefusal =
	| "bad_key"
	| "sealed"
	| "stale"
	| "replayed"
	| "not_allowed"
	| "invalid";

export class RelayError extends Error {
	readonly code: RelayRefusal;

	constructor(code: RelayRefusal, message: string) {
		super(message);
		this.name = "RelayError";
		this.code = code;
	}
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function toBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> | null {
	const normal = text.trim().replace(/-/g, "+").replace(/_/g, "/");
	if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normal)) {
		return null;
	}
	const padded = normal.padEnd(Math.ceil(normal.length / 4) * 4, "=");
	try {
		const binary = atob(padded);
		const bytes = new Uint8Array(new ArrayBuffer(binary.length));
		for (let index = 0; index < binary.length; index += 1) {
			bytes[index] = binary.charCodeAt(index);
		}
		return bytes;
	} catch {
		return null;
	}
}

/** A new relay key: 32 random bytes in base64. */
export function newRelayKey(): string {
	return toBase64(crypto.getRandomValues(new Uint8Array(RELAY_KEY_BYTES)));
}

export async function importRelayKey(encoded: string): Promise<CryptoKey> {
	const bytes = fromBase64(encoded);
	if (bytes === null || bytes.length !== RELAY_KEY_BYTES) {
		throw new RelayError(
			"bad_key",
			`${ZALO_RELAY_KEY_VARIABLE} must be ${RELAY_KEY_BYTES} bytes in base64`,
		);
	}
	return await crypto.subtle.importKey(
		"raw",
		bytes,
		{ name: "AES-GCM" },
		false,
		["encrypt", "decrypt"],
	);
}

function additionalData(
	purpose: RelayPurpose,
	context: string,
): Uint8Array<ArrayBuffer> {
	return encoder.encode(
		`fnb-zalo-relay/v${ENVELOPE_VERSION}/${purpose}/${context}`,
	);
}

/** Seals a JSON value for one purpose (and, for an answer, one request id) as a small JSON envelope. */
export async function seal(
	key: CryptoKey,
	purpose: RelayPurpose,
	payload: unknown,
	context = "",
): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const data = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: "AES-GCM", iv, additionalData: additionalData(purpose, context) },
			key,
			encoder.encode(JSON.stringify(payload)),
		),
	);
	return JSON.stringify({
		v: ENVELOPE_VERSION,
		iv: toBase64(iv),
		data: toBase64(data),
	});
}

/** Opens an envelope sealed for this purpose and context; anything else is refused as `sealed`. */
export async function open(
	key: CryptoKey,
	purpose: RelayPurpose,
	envelope: string,
	context = "",
): Promise<unknown> {
	const refused = new RelayError(
		"sealed",
		"the message is not sealed with the relay key for this purpose",
	);
	if (envelope.length > RELAY_MAX_ENVELOPE_BYTES * 2) {
		throw refused;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(envelope);
	} catch {
		throw refused;
	}
	if (
		!isRecord(parsed) ||
		parsed.v !== ENVELOPE_VERSION ||
		typeof parsed.iv !== "string" ||
		typeof parsed.data !== "string"
	) {
		throw refused;
	}
	const iv = fromBase64(parsed.iv);
	const data = fromBase64(parsed.data);
	if (iv === null || iv.length !== IV_BYTES || data === null) {
		throw refused;
	}
	let plain: ArrayBuffer;
	try {
		plain = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv, additionalData: additionalData(purpose, context) },
			key,
			data,
		);
	} catch {
		throw refused;
	}
	try {
		return JSON.parse(decoder.decode(plain));
	} catch {
		throw refused;
	}
}

export interface GraphCall {
	readonly path: RelayGraphPath;
	readonly query: string;
	readonly headers: Readonly<Record<string, string>>;
}

export interface RelayRequest extends GraphCall {
	readonly id: string;
	readonly at: number;
}

export interface RelayAnswer {
	readonly status: number;
	readonly body: string;
}

function isGraphPath(value: unknown): value is RelayGraphPath {
	return (
		typeof value === "string" &&
		(RELAY_GRAPH_PATHS as readonly string[]).includes(value)
	);
}

function headerValueProblem(value: unknown): boolean {
	return (
		typeof value !== "string" ||
		value === "" ||
		value.length > RELAY_MAX_HEADER_LENGTH ||
		hasControlCharacter(value)
	);
}

/** A control character (below a space, or DEL) would let a header value split into a second header. */
function hasControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code < 0x20 || code === 0x7f) {
			return true;
		}
	}
	return false;
}

/** The allowed Graph call behind a URL and request, or null for anything the relay must not carry. */
export function graphCallOf(
	url: string,
	init: ZaloRequestInit,
): GraphCall | null {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	if (
		parsed.origin !== ZALO_GRAPH_ORIGIN ||
		parsed.username !== "" ||
		parsed.password !== "" ||
		parsed.hash !== "" ||
		init.method !== "GET" ||
		init.body !== undefined ||
		!isGraphPath(parsed.pathname)
	) {
		return null;
	}
	const query = parsed.search.replace(/^\?/, "");
	if (!QUERY_PATTERN.test(query)) {
		return null;
	}
	const allowed = ALLOWED_HEADERS[parsed.pathname];
	const headers: Record<string, string> = {};
	for (const [name, value] of Object.entries(init.headers)) {
		const lower = name.toLowerCase();
		if (!allowed.includes(lower) || headerValueProblem(value)) {
			return null;
		}
		headers[lower] = value;
	}
	if (headers.access_token === undefined) {
		return null;
	}
	return { path: parsed.pathname, query, headers };
}

/** Checks a decrypted request: shape, allowed path, query and headers, and that it is fresh. */
export function validateRelayRequest(
	value: unknown,
	now: number,
): RelayRequest {
	if (!isRecord(value)) {
		throw new RelayError("invalid", "the request is not an object");
	}
	const { id, at, path, query, headers } = value;
	if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
		throw new RelayError("invalid", "the request id is not a lower-case uuid");
	}
	if (typeof at !== "number" || !Number.isSafeInteger(at)) {
		throw new RelayError("invalid", "the request time is not a number");
	}
	if (Math.abs(now - at) > RELAY_MAX_SKEW_MS) {
		throw new RelayError(
			"stale",
			"the request is older or newer than a minute",
		);
	}
	if (!isGraphPath(path)) {
		throw new RelayError("not_allowed", "the relay carries no such path");
	}
	if (typeof query !== "string" || !QUERY_PATTERN.test(query)) {
		throw new RelayError("not_allowed", "the relay carries no such query");
	}
	if (!isRecord(headers)) {
		throw new RelayError("invalid", "the request headers are not an object");
	}
	const allowed = ALLOWED_HEADERS[path];
	const checked: Record<string, string> = {};
	for (const [name, header] of Object.entries(headers)) {
		if (!allowed.includes(name)) {
			throw new RelayError("not_allowed", "the relay carries no such header");
		}
		if (headerValueProblem(header)) {
			throw new RelayError("invalid", "a header value is empty or unsafe");
		}
		checked[name] = header as string;
	}
	if (checked.access_token === undefined) {
		throw new RelayError("invalid", "the request has no access token");
	}
	return { id, at, path, query, headers: checked };
}

/** Remembers request ids for twice the allowed skew, so a captured request cannot be sent again. */
export class ReplayGuard {
	private readonly seenAt = new Map<string, number>();

	/** True the first time an id is presented, false for a replay. */
	admit(id: string, now: number): boolean {
		for (const [seen, at] of this.seenAt) {
			if (now - at > RELAY_MAX_SKEW_MS * 2) {
				this.seenAt.delete(seen);
			}
		}
		if (this.seenAt.has(id)) {
			return false;
		}
		this.seenAt.set(id, now);
		return true;
	}

	get size(): number {
		return this.seenAt.size;
	}
}

export function sealRelayRequest(
	key: CryptoKey,
	request: RelayRequest,
): Promise<string> {
	return seal(key, "request", request);
}

export async function openRelayRequest(
	key: CryptoKey,
	envelope: string,
	now: number,
	guard: ReplayGuard,
): Promise<RelayRequest> {
	const request = validateRelayRequest(
		await open(key, "request", envelope),
		now,
	);
	if (!guard.admit(request.id, now)) {
		throw new RelayError("replayed", "the request was already relayed");
	}
	return request;
}

export function sealRelayAnswer(
	key: CryptoKey,
	requestId: string,
	answer: RelayAnswer,
): Promise<string> {
	return seal(key, "answer", answer, requestId);
}

export async function openRelayAnswer(
	key: CryptoKey,
	requestId: string,
	envelope: string,
): Promise<RelayAnswer> {
	const value = await open(key, "answer", envelope, requestId);
	if (
		!isRecord(value) ||
		typeof value.status !== "number" ||
		!Number.isInteger(value.status) ||
		value.status < 200 ||
		value.status > 599 ||
		typeof value.body !== "string" ||
		value.body.length > RELAY_MAX_ANSWER_BYTES
	) {
		throw new RelayError("invalid", "the relay answer is malformed");
	}
	return { status: value.status, body: value.body };
}

/** Why an announced relay address is unacceptable, or null: an https origin on a DNS name, nothing more. */
export function relayUrlProblem(url: string): string | null {
	if (url.length > RELAY_URL_MAX_LENGTH) {
		return "the relay address is too long";
	}
	const match = /^https:\/\/([a-z0-9.-]+)$/.exec(url);
	if (match === null) {
		return "the relay address must be https://<host name> with nothing after the host";
	}
	const labels = (match[1] ?? "").split(".");
	if (
		labels.length < 2 ||
		!labels.every((label) => HOST_LABEL.test(label)) ||
		!TOP_LEVEL_LABEL.test(labels[labels.length - 1] ?? "")
	) {
		return "the relay host must be a DNS name, not an address";
	}
	return null;
}

export interface RelayAnnouncement {
	readonly url: string;
	readonly at: number;
}

export function sealAnnouncement(
	key: CryptoKey,
	announcement: RelayAnnouncement,
): Promise<string> {
	return seal(key, "announce", announcement);
}

export async function openAnnouncement(
	key: CryptoKey,
	envelope: string,
	now: number,
): Promise<RelayAnnouncement> {
	const value = await open(key, "announce", envelope);
	if (
		!isRecord(value) ||
		typeof value.url !== "string" ||
		typeof value.at !== "number" ||
		!Number.isSafeInteger(value.at)
	) {
		throw new RelayError("invalid", "the announcement is malformed");
	}
	if (Math.abs(now - value.at) > RELAY_ANNOUNCE_MAX_SKEW_MS) {
		throw new RelayError(
			"stale",
			"the announcement is older or newer than two minutes",
		);
	}
	const problem = relayUrlProblem(value.url);
	if (problem !== null) {
		throw new RelayError("invalid", problem);
	}
	return { url: value.url, at: value.at };
}

export interface RelayFetchOptions {
	readonly key: CryptoKey;
	/** The announced relay address, or null to call the Graph directly. */
	readonly relayUrl: () => Promise<string | null>;
	readonly fetch?: ZaloFetch | undefined;
	readonly now?: () => number;
	readonly newId?: () => string;
}

const directFetch: ZaloFetch = (url, init) => fetch(url, init);

/**
 * A fetch that sends the allowed Graph calls through the announced relay and everything else, or everything when no
 * relay is announced, straight to the network.
 */
export function relayFetch(options: RelayFetchOptions): ZaloFetch {
	const send = options.fetch ?? directFetch;
	const now = options.now ?? (() => Date.now());
	const newId = options.newId ?? (() => crypto.randomUUID());
	return async (url, init) => {
		const call = graphCallOf(url, init);
		if (call === null) {
			return send(url, init);
		}
		const base = await options.relayUrl();
		if (base === null) {
			return send(url, init);
		}
		const id = newId();
		const envelope = await sealRelayRequest(options.key, {
			...call,
			id,
			at: now(),
		});
		const response = await send(`${base}${RELAY_PATH}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: envelope,
			...(init.signal === undefined ? {} : { signal: init.signal }),
		});
		if (!response.ok) {
			throw new UpstreamError("zalo", "status", response.status);
		}
		let answer: RelayAnswer;
		try {
			answer = await openRelayAnswer(options.key, id, await response.text());
		} catch {
			throw new UpstreamError("zalo", "invalid_answer", response.status);
		}
		const bodyless = [204, 205, 304].includes(answer.status);
		return new Response(bodyless ? null : answer.body, {
			status: answer.status,
			headers: { "content-type": "application/json" },
		});
	};
}
