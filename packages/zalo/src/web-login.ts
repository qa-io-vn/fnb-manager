import { isRecord, readJson, timedFetch, type ZaloFetch } from "./http.js";
import { RELAY_WEB_LOGIN_PATH, ZALO_OAUTH_ORIGIN } from "./relay.js";

/**
 * Zalo's web login (Zalo Login, OAuth v4 with PKCE) for the counter web app (ADR-066). The browser makes the PKCE
 * verifier and keeps it; the counter-session function names the authorise address with a sealed state that binds the
 * code challenge, the redirect address and an expiry, and later exchanges the code with the App secret. Both the state
 * and the short identity ticket that carries a verified Zalo person to the pairing step are sealed with AES-GCM under a
 * key derived from the App secret, so the browser can neither read nor forge them.
 */

export const WEB_LOGIN_PERMISSION_PATH = "/v4/permission";
export const WEB_LOGIN_STATE_TTL_MS = 10 * 60_000;
export const WEB_LOGIN_TICKET_TTL_MS = 10 * 60_000;
export const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
export const AUTHORIZATION_CODE_PATTERN = /^[\x21-\x7e]{1,2048}$/;
export const SEALED_TEXT_PATTERN = /^[A-Za-z0-9_-]{40,2048}$/;
export const ZALO_APP_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const SEAL_VERSION = 1;
const IV_BYTES = 12;

export type SealPurpose = "state" | "ticket";

export class WebLoginError extends Error {
	readonly code: "sealed" | "expired" | "mismatch";

	constructor(code: "sealed" | "expired" | "mismatch", message: string) {
		super(message);
		this.name = "WebLoginError";
		this.code = code;
	}
}

export function base64UrlOf(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
}

export function bytesOfBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
	if (!/^[A-Za-z0-9_-]*$/.test(text)) {
		return null;
	}
	const normal = text.replaceAll("-", "+").replaceAll("_", "/");
	try {
		const binary = atob(normal.padEnd(Math.ceil(normal.length / 4) * 4, "="));
		const bytes = new Uint8Array(new ArrayBuffer(binary.length));
		for (let index = 0; index < binary.length; index += 1) {
			bytes[index] = binary.charCodeAt(index);
		}
		return bytes;
	} catch {
		return null;
	}
}

/** The S256 code challenge of a PKCE verifier. */
export async function codeChallengeOf(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		encoder.encode(verifier),
	);
	return base64UrlOf(new Uint8Array(digest));
}

/** The sealing key of one purpose, derived from the App secret (HMAC-SHA-256 with a label), so each purpose has its own. */
export async function sealingKey(
	appSecret: string,
	purpose: SealPurpose,
): Promise<CryptoKey> {
	const hmac = await crypto.subtle.importKey(
		"raw",
		encoder.encode(appSecret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const raw = await crypto.subtle.sign(
		"HMAC",
		hmac,
		encoder.encode(`fnb-counter-session/v${SEAL_VERSION}/${purpose}`),
	);
	return await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
		"encrypt",
		"decrypt",
	]);
}

export async function sealValue(
	key: CryptoKey,
	purpose: SealPurpose,
	value: Readonly<Record<string, unknown>>,
): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const data = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: "AES-GCM", iv, additionalData: encoder.encode(purpose) },
			key,
			encoder.encode(JSON.stringify(value)),
		),
	);
	const out = new Uint8Array(IV_BYTES + data.length);
	out.set(iv, 0);
	out.set(data, IV_BYTES);
	return base64UrlOf(out);
}

export async function openValue(
	key: CryptoKey,
	purpose: SealPurpose,
	text: string,
): Promise<Record<string, unknown>> {
	const refused = new WebLoginError(
		"sealed",
		`the ${purpose} is not sealed for this app`,
	);
	if (!SEALED_TEXT_PATTERN.test(text)) {
		throw refused;
	}
	const bytes = bytesOfBase64Url(text);
	if (bytes === null || bytes.length <= IV_BYTES + 16) {
		throw refused;
	}
	let plain: ArrayBuffer;
	try {
		plain = await crypto.subtle.decrypt(
			{
				name: "AES-GCM",
				iv: bytes.slice(0, IV_BYTES),
				additionalData: encoder.encode(purpose),
			},
			key,
			bytes.slice(IV_BYTES),
		);
	} catch {
		throw refused;
	}
	let value: unknown;
	try {
		value = JSON.parse(decoder.decode(plain));
	} catch {
		throw refused;
	}
	if (!isRecord(value) || value.v !== SEAL_VERSION) {
		throw refused;
	}
	return value;
}

export interface LoginState {
	readonly challenge: string;
	readonly redirectUri: string;
	readonly expiresAt: number;
}

export function sealLoginState(
	key: CryptoKey,
	state: LoginState,
): Promise<string> {
	return sealValue(key, "state", {
		v: SEAL_VERSION,
		c: state.challenge,
		r: state.redirectUri,
		e: state.expiresAt,
		n: base64UrlOf(crypto.getRandomValues(new Uint8Array(9))),
	});
}

/**
 * Opens a state and checks it against the callback: not expired, the same redirect address, and the verifier's
 * challenge equal to the one sealed at the start (a code obtained for another browser's challenge cannot be used).
 */
export async function verifyLoginState(
	key: CryptoKey,
	text: string,
	callback: {
		readonly redirectUri: string;
		readonly codeVerifier: string;
		readonly now: number;
	},
): Promise<void> {
	const value = await openValue(key, "state", text);
	if (typeof value.e !== "number" || value.e <= callback.now) {
		throw new WebLoginError("expired", "the sign-in took too long");
	}
	if (value.r !== callback.redirectUri) {
		throw new WebLoginError("mismatch", "the redirect address differs");
	}
	if (value.c !== (await codeChallengeOf(callback.codeVerifier))) {
		throw new WebLoginError("mismatch", "the PKCE verifier does not match");
	}
}

export interface IdentityTicket {
	readonly zaloAppId: string;
	readonly zaloUserId: string;
	readonly displayName: string | null;
	readonly expiresAt: number;
}

export function sealIdentityTicket(
	key: CryptoKey,
	ticket: IdentityTicket,
): Promise<string> {
	return sealValue(key, "ticket", {
		v: SEAL_VERSION,
		a: ticket.zaloAppId,
		u: ticket.zaloUserId,
		d: ticket.displayName,
		e: ticket.expiresAt,
	});
}

export async function openIdentityTicket(
	key: CryptoKey,
	text: string,
	expected: { readonly zaloAppId: string; readonly now: number },
): Promise<IdentityTicket> {
	const value = await openValue(key, "ticket", text);
	if (typeof value.e !== "number" || value.e <= expected.now) {
		throw new WebLoginError("expired", "the identity ticket has expired");
	}
	if (
		value.a !== expected.zaloAppId ||
		typeof value.u !== "string" ||
		!/^[A-Za-z0-9_-]{1,64}$/.test(value.u) ||
		(value.d !== null && typeof value.d !== "string")
	) {
		throw new WebLoginError("sealed", "the identity ticket is malformed");
	}
	return {
		zaloAppId: value.a,
		zaloUserId: value.u,
		displayName: value.d,
		expiresAt: value.e,
	};
}

/** The address of Zalo's authorise page for a person, with the PKCE challenge and the sealed state. */
export function webLoginAuthorizeUrl(
	oauthBaseUrl: string,
	input: {
		readonly appId: string;
		readonly redirectUri: string;
		readonly codeChallenge: string;
		readonly state: string;
	},
): string {
	const url = new URL(
		`${oauthBaseUrl.replace(/\/+$/, "")}${WEB_LOGIN_PERMISSION_PATH}`,
	);
	url.searchParams.set("app_id", input.appId);
	url.searchParams.set("redirect_uri", input.redirectUri);
	url.searchParams.set("code_challenge", input.codeChallenge);
	url.searchParams.set("state", input.state);
	return url.toString();
}

export type WebLoginExchange =
	| { readonly ok: true; readonly accessToken: string }
	| { readonly ok: false; readonly error: number };

/**
 * Exchanges an authorisation code for the person's access token: a POST of exactly the four fields the relay allows,
 * with the App secret in the secret_key header. Zalo answers its errors as JSON with a negative number.
 */
export async function exchangeWebLoginCode(
	options: {
		readonly baseUrl?: string | undefined;
		readonly fetch?: ZaloFetch | undefined;
		readonly timeoutMs?: number | undefined;
	},
	input: {
		readonly appId: string;
		readonly appSecret: string;
		readonly code: string;
		readonly codeVerifier: string;
	},
): Promise<WebLoginExchange> {
	if (!ZALO_APP_ID_PATTERN.test(input.appId)) {
		throw new TypeError("the Zalo App id is malformed");
	}
	if (!AUTHORIZATION_CODE_PATTERN.test(input.code)) {
		throw new TypeError("the authorisation code is malformed");
	}
	if (!CODE_VERIFIER_PATTERN.test(input.codeVerifier)) {
		throw new TypeError("the PKCE code verifier is malformed");
	}
	const base = (options.baseUrl ?? ZALO_OAUTH_ORIGIN).replace(/\/+$/, "");
	const response = await timedFetch(
		`${base}${RELAY_WEB_LOGIN_PATH}`,
		{
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				secret_key: input.appSecret,
			},
			body: new URLSearchParams({
				app_id: input.appId,
				code: input.code,
				code_verifier: input.codeVerifier,
				grant_type: "authorization_code",
			}).toString(),
		},
		{ service: "zalo", fetch: options.fetch, timeoutMs: options.timeoutMs },
	);
	const body = await readJson(response, "zalo");
	if (!isRecord(body)) {
		return { ok: false, error: response.ok ? -1 : -response.status };
	}
	const error = body.error;
	if (typeof error === "number" && error !== 0) {
		return { ok: false, error };
	}
	const token = body.access_token;
	if (typeof token !== "string" || !/^[\x21-\x7e]{1,4096}$/.test(token)) {
		return { ok: false, error: -1 };
	}
	return { ok: true, accessToken: token };
}

/** A short line about the browser and the system from a User-Agent ("Chrome · Android"), for M02; never the full string. */
export function deviceLineOf(userAgent: string | null): string | null {
	if (userAgent === null || userAgent.trim() === "") {
		return null;
	}
	const ua = userAgent.slice(0, 512);
	const browser = /Edg\//.test(ua)
		? "Edge"
		: /Zalo/i.test(ua)
			? "Zalo"
			: /Firefox\//.test(ua)
				? "Firefox"
				: /(Chrome|CriOS)\//.test(ua)
					? "Chrome"
					: /Safari\//.test(ua)
						? "Safari"
						: null;
	const system = /iPad/.test(ua)
		? "iPad"
		: /iPhone/.test(ua)
			? "iPhone"
			: /Android/.test(ua)
				? "Android"
				: /Windows/.test(ua)
					? "Windows"
					: /Mac OS X|Macintosh/.test(ua)
						? "Mac"
						: /Linux/.test(ua)
							? "Linux"
							: null;
	const parts = [browser, system].filter((part) => part !== null);
	return parts.length === 0 ? null : parts.join(" · ");
}
