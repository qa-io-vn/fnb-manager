import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { GRAPH_ME_INFO_PATH, GRAPH_ME_PATH } from "../graph.js";
import type { ZaloFetch } from "../http.js";
import { appSecretProof } from "../proof.js";

export const MOCK_ZALO_ERRORS = {
	accessTokenInvalid: -9001,
	accessTokenExpired: -9002,
	proofInvalid: -9003,
	phoneTokenInvalid: -9004,
	phoneTokenExpired: -9005,
	phoneTokenUsed: 119,
	appUnknown: -9101,
	appSecretInvalid: -9102,
	grantInvalid: -9103,
	codeInvalid: -9104,
	codeExpired: -9105,
	codeUsed: -9106,
	verifierInvalid: -9107,
	refreshTokenInvalid: -9108,
	refreshTokenUsed: -9109,
	refreshTokenExpired: -9110,
} as const;

export const MOCK_ACCESS_TOKEN_LIFETIME_MS = 3_600_000;
export const MOCK_PHONE_TOKEN_LIFETIME_MS = 120_000;
export const MOCK_AUTHORIZATION_CODE_LIFETIME_MS = 600_000;

export const MOCK_OAUTH_PATHS = {
	permission: "/v4/oa/permission",
	oaAccessToken: "/v4/oa/access_token",
	developerToken: "/v4/access_token",
} as const;

export const MOCK_TOKEN_LIFETIMES = {
	oa: { accessSeconds: 90_000, refreshSeconds: 90 * 86_400 },
	developer: { accessSeconds: 3_600, refreshSeconds: 30 * 86_400 },
} as const;

export type MockTokenKind = keyof typeof MOCK_TOKEN_LIFETIMES;

export interface MockZaloUser {
	readonly id: string;
	readonly name?: string | null;
}

export interface MockZaloRequest {
	readonly path: string;
	readonly headerNames: readonly string[];
	readonly at: number;
}

export type MockZaloFault =
	| { readonly kind: "status"; readonly status: number }
	| { readonly kind: "hang" }
	| { readonly kind: "error"; readonly error: number }
	| { readonly kind: "lost" };

export interface MockOauthApp {
	readonly appId: string;
	readonly appSecret: string;
	readonly oaId?: string;
}

export interface MockTokenPair {
	readonly accessToken: string;
	readonly refreshToken: string;
}

export type MockRefreshTokenState = "live" | "spent" | "unknown";

export interface MockOauthCounts {
	readonly authorizations: number;
	readonly exchanges: number;
	readonly refreshes: number;
	readonly developerRefreshes: number;
}

export interface MockZalo {
	readonly fetch: ZaloFetch;
	handle(request: Request): Promise<Response>;
	issueAccessToken(
		appSecret: string,
		user: MockZaloUser,
		options?: { readonly lifetimeMs?: number },
	): string;
	issuePhoneToken(
		accessToken: string,
		number: string,
		options?: { readonly lifetimeMs?: number },
	): string;
	registerApp(app: MockOauthApp): void;
	issueTokens(appId: string, kind: MockTokenKind): MockTokenPair;
	refreshTokenState(refreshToken: string): MockRefreshTokenState;
	accessTokenLive(accessToken: string): boolean;
	oauthCounts(): MockOauthCounts;
	advance(milliseconds: number): void;
	now(): number;
	requests(path?: string): readonly MockZaloRequest[];
	failNext(path: string, fault: MockZaloFault): void;
	reset(): void;
}

export interface MockZaloOptions {
	readonly startAt?: number;
}

interface AccessEntry {
	readonly appSecret: string;
	readonly user: MockZaloUser;
	readonly expiresAt: number;
}

interface PhoneEntry {
	readonly accessToken: string;
	readonly number: string;
	readonly expiresAt: number;
	used: boolean;
}

interface CodeEntry {
	readonly appId: string;
	readonly challenge: string;
	readonly expiresAt: number;
	used: boolean;
}

interface RefreshEntry {
	readonly appId: string;
	readonly kind: MockTokenKind;
	readonly accessToken: string;
	readonly expiresAt: number;
	spent: boolean;
}

interface OauthAccessEntry {
	readonly expiresAt: number;
	live: boolean;
}

const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function answer(body: Record<string, unknown>, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
	});
}

async function s256(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(verifier),
	);
	let binary = "";
	for (const byte of new Uint8Array(digest)) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
}

function redirectTo(location: string): Response {
	return new Response(null, {
		status: 302,
		headers: { location, "cache-control": "no-store" },
	});
}

function failure(error: number, message: string): Response {
	return answer({ error, message });
}

function randomPart(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(12));
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

function hang(signal: AbortSignal | null | undefined): Promise<Response> {
	return new Promise((_, reject) => {
		signal?.addEventListener("abort", () =>
			reject(new Error("the request was aborted")),
		);
	});
}

export function createMockZalo(options: MockZaloOptions = {}): MockZalo {
	let clock = options.startAt ?? Date.UTC(2026, 10, 18, 3, 0, 0);
	const accessTokens = new Map<string, AccessEntry>();
	const phoneTokens = new Map<string, PhoneEntry>();
	const recorded: MockZaloRequest[] = [];
	const faults = new Map<string, MockZaloFault>();
	const apps = new Map<string, MockOauthApp>();
	const codes = new Map<string, CodeEntry>();
	const refreshTokens = new Map<string, RefreshEntry>();
	const oauthAccess = new Map<string, OauthAccessEntry>();
	const counts = {
		authorizations: 0,
		exchanges: 0,
		refreshes: 0,
		developerRefreshes: 0,
	};

	const pairFor = (appId: string, kind: MockTokenKind): MockTokenPair => {
		const lifetimes = MOCK_TOKEN_LIFETIMES[kind];
		const accessToken = `mock-zalo-${kind}-access-${randomPart()}`;
		const refreshToken = `mock-zalo-${kind}-refresh-${randomPart()}`;
		oauthAccess.set(accessToken, {
			expiresAt: clock + lifetimes.accessSeconds * 1000,
			live: true,
		});
		refreshTokens.set(refreshToken, {
			appId,
			kind,
			accessToken,
			expiresAt: clock + lifetimes.refreshSeconds * 1000,
			spent: false,
		});
		return { accessToken, refreshToken };
	};

	const tokenAnswer = (pair: MockTokenPair, kind: MockTokenKind): Response =>
		answer({
			access_token: pair.accessToken,
			refresh_token: pair.refreshToken,
			expires_in: String(MOCK_TOKEN_LIFETIMES[kind].accessSeconds),
			...(kind === "developer"
				? {
						refresh_token_expires_in: String(
							MOCK_TOKEN_LIFETIMES.developer.refreshSeconds,
						),
					}
				: {}),
		});

	const permission = (url: URL): Response => {
		const app = apps.get(url.searchParams.get("app_id") ?? "");
		if (app?.oaId === undefined) {
			return failure(MOCK_ZALO_ERRORS.appUnknown, "app_id is unknown");
		}
		const challenge = url.searchParams.get("code_challenge") ?? "";
		const state = url.searchParams.get("state") ?? "";
		let redirect: URL;
		try {
			redirect = new URL(url.searchParams.get("redirect_uri") ?? "");
		} catch {
			return failure(MOCK_ZALO_ERRORS.grantInvalid, "redirect_uri is invalid");
		}
		if (!CHALLENGE_PATTERN.test(challenge) || state === "") {
			return failure(
				MOCK_ZALO_ERRORS.grantInvalid,
				"code_challenge or state is missing",
			);
		}
		const code = `mock-zalo-code-${randomPart()}`;
		codes.set(code, {
			appId: app.appId,
			challenge,
			expiresAt: clock + MOCK_AUTHORIZATION_CODE_LIFETIME_MS,
			used: false,
		});
		counts.authorizations += 1;
		redirect.searchParams.set("code", code);
		redirect.searchParams.set("oa_id", app.oaId);
		redirect.searchParams.set("code_challenge", challenge);
		redirect.searchParams.set("state", state);
		return redirectTo(redirect.toString());
	};

	const exchange = async (
		form: URLSearchParams,
		app: MockOauthApp,
	): Promise<Response> => {
		const code = codes.get(form.get("code") ?? "");
		if (code === undefined || code.appId !== app.appId) {
			return failure(MOCK_ZALO_ERRORS.codeInvalid, "code is invalid");
		}
		if (code.used) {
			return failure(MOCK_ZALO_ERRORS.codeUsed, "code is used");
		}
		if (code.expiresAt <= clock) {
			return failure(MOCK_ZALO_ERRORS.codeExpired, "code has expired");
		}
		code.used = true;
		if ((await s256(form.get("code_verifier") ?? "")) !== code.challenge) {
			return failure(
				MOCK_ZALO_ERRORS.verifierInvalid,
				"code_verifier is invalid",
			);
		}
		counts.exchanges += 1;
		return tokenAnswer(pairFor(app.appId, "oa"), "oa");
	};

	const refresh = (
		form: URLSearchParams,
		app: MockOauthApp,
		kind: MockTokenKind,
	): Response => {
		const entry = refreshTokens.get(form.get("refresh_token") ?? "");
		if (
			entry === undefined ||
			entry.appId !== app.appId ||
			entry.kind !== kind
		) {
			return failure(
				MOCK_ZALO_ERRORS.refreshTokenInvalid,
				"refresh_token is invalid",
			);
		}
		if (entry.spent) {
			return failure(
				MOCK_ZALO_ERRORS.refreshTokenUsed,
				"refresh_token is used",
			);
		}
		if (entry.expiresAt <= clock) {
			return failure(
				MOCK_ZALO_ERRORS.refreshTokenExpired,
				"refresh_token has expired",
			);
		}
		entry.spent = true;
		const previous = oauthAccess.get(entry.accessToken);
		if (previous !== undefined) {
			previous.live = false;
		}
		if (kind === "oa") {
			counts.refreshes += 1;
		} else {
			counts.developerRefreshes += 1;
		}
		return tokenAnswer(pairFor(app.appId, kind), kind);
	};

	const token = async (
		request: Request,
		kind: MockTokenKind,
	): Promise<Response> => {
		const form = new URLSearchParams(await request.text());
		const app = apps.get(form.get("app_id") ?? "");
		if (app === undefined) {
			return failure(MOCK_ZALO_ERRORS.appUnknown, "app_id is unknown");
		}
		if (request.headers.get("secret_key") !== app.appSecret) {
			return failure(
				MOCK_ZALO_ERRORS.appSecretInvalid,
				"secret_key is invalid",
			);
		}
		const grant = form.get("grant_type");
		if (grant === "authorization_code" && kind === "oa") {
			return exchange(form, app);
		}
		if (grant === "refresh_token") {
			return refresh(form, app, kind);
		}
		return failure(MOCK_ZALO_ERRORS.grantInvalid, "grant_type is invalid");
	};

	const accessEntry = (
		token: string | null,
	): AccessEntry | { readonly refusal: Response } => {
		const entry = token === null ? undefined : accessTokens.get(token);
		if (entry === undefined) {
			return {
				refusal: failure(
					MOCK_ZALO_ERRORS.accessTokenInvalid,
					"Access token is invalid",
				),
			};
		}
		if (entry.expiresAt <= clock) {
			return {
				refusal: failure(
					MOCK_ZALO_ERRORS.accessTokenExpired,
					"Access token has expired",
				),
			};
		}
		return entry;
	};

	const me = async (request: Request): Promise<Response> => {
		const token = request.headers.get("access_token");
		const entry = accessEntry(token);
		if ("refusal" in entry) {
			return entry.refusal;
		}
		const expected = await appSecretProof(token ?? "", entry.appSecret);
		if (request.headers.get("appsecret_proof") !== expected) {
			return failure(
				MOCK_ZALO_ERRORS.proofInvalid,
				"appsecret_proof is invalid",
			);
		}
		return answer({
			id: entry.user.id,
			...(entry.user.name === undefined || entry.user.name === null
				? {}
				: { name: entry.user.name }),
			error: 0,
			message: "Success",
		});
	};

	const meInfo = (request: Request): Response => {
		const token = request.headers.get("access_token");
		const entry = accessEntry(token);
		if ("refusal" in entry) {
			return entry.refusal;
		}
		if (request.headers.get("secret_key") !== entry.appSecret) {
			return failure(MOCK_ZALO_ERRORS.proofInvalid, "secret_key is invalid");
		}
		const code = request.headers.get("code");
		const phone = code === null ? undefined : phoneTokens.get(code);
		if (phone === undefined || phone.accessToken !== token) {
			return failure(MOCK_ZALO_ERRORS.phoneTokenInvalid, "code is invalid");
		}
		if (phone.used) {
			return failure(MOCK_ZALO_ERRORS.phoneTokenUsed, "code is used");
		}
		if (phone.expiresAt <= clock) {
			return failure(MOCK_ZALO_ERRORS.phoneTokenExpired, "code has expired");
		}
		phone.used = true;
		return answer({
			data: { number: phone.number },
			error: 0,
			message: "Success",
		});
	};

	const handle = async (request: Request): Promise<Response> => {
		const url = new URL(request.url);
		recorded.push({
			path: url.pathname,
			headerNames: [...request.headers.keys()].sort(),
			at: clock,
		});
		const fault = faults.get(url.pathname);
		if (fault !== undefined) {
			faults.delete(url.pathname);
			if (fault.kind === "hang") {
				return hang(request.signal);
			}
			if (fault.kind === "error") {
				return failure(fault.error, "mock fault");
			}
			if (fault.kind === "lost") {
				await route(request, url);
				return hang(request.signal);
			}
			return answer({ message: "mock fault" }, fault.status);
		}
		return route(request, url);
	};

	const route = (request: Request, url: URL): Promise<Response> | Response => {
		if (url.pathname === MOCK_OAUTH_PATHS.permission) {
			return request.method === "GET"
				? permission(url)
				: answer({ message: "method not allowed" }, 405);
		}
		if (url.pathname === MOCK_OAUTH_PATHS.oaAccessToken) {
			return request.method === "POST"
				? token(request, "oa")
				: answer({ message: "method not allowed" }, 405);
		}
		if (url.pathname === MOCK_OAUTH_PATHS.developerToken) {
			return request.method === "POST"
				? token(request, "developer")
				: answer({ message: "method not allowed" }, 405);
		}
		if (request.method !== "GET") {
			return answer({ message: "method not allowed" }, 405);
		}
		if (url.pathname === GRAPH_ME_PATH) {
			return me(request);
		}
		if (url.pathname === GRAPH_ME_INFO_PATH) {
			return meInfo(request);
		}
		return answer({ message: "not found" }, 404);
	};

	const mockFetch: ZaloFetch = (url, init) =>
		handle(
			new Request(url, {
				method: init.method,
				headers: init.headers,
				...(init.body === undefined ? {} : { body: init.body }),
				...(init.signal === undefined ? {} : { signal: init.signal }),
			}),
		);

	return {
		fetch: mockFetch,
		handle,
		issueAccessToken(appSecret, user, tokenOptions = {}) {
			const token = `mock-zalo-access-${randomPart()}`;
			accessTokens.set(token, {
				appSecret,
				user,
				expiresAt:
					clock + (tokenOptions.lifetimeMs ?? MOCK_ACCESS_TOKEN_LIFETIME_MS),
			});
			return token;
		},
		issuePhoneToken(accessToken, number, tokenOptions = {}) {
			const token = `mock-zalo-phone-${randomPart()}`;
			phoneTokens.set(token, {
				accessToken,
				number,
				expiresAt:
					clock + (tokenOptions.lifetimeMs ?? MOCK_PHONE_TOKEN_LIFETIME_MS),
				used: false,
			});
			return token;
		},
		registerApp(app) {
			apps.set(app.appId, app);
		},
		issueTokens(appId, kind) {
			return pairFor(appId, kind);
		},
		refreshTokenState(refreshToken) {
			const entry = refreshTokens.get(refreshToken);
			if (entry === undefined) {
				return "unknown";
			}
			return entry.spent ? "spent" : "live";
		},
		accessTokenLive(accessToken) {
			const entry = oauthAccess.get(accessToken);
			return entry?.live === true && entry.expiresAt > clock;
		},
		oauthCounts() {
			return { ...counts };
		},
		advance(milliseconds) {
			clock += milliseconds;
		},
		now() {
			return clock;
		},
		requests(path) {
			return path === undefined
				? [...recorded]
				: recorded.filter((request) => request.path === path);
		},
		failNext(path, fault) {
			faults.set(path, fault);
		},
		reset() {
			accessTokens.clear();
			phoneTokens.clear();
			recorded.length = 0;
			faults.clear();
			apps.clear();
			codes.clear();
			refreshTokens.clear();
			oauthAccess.clear();
			counts.authorizations = 0;
			counts.exchanges = 0;
			counts.refreshes = 0;
			counts.developerRefreshes = 0;
		},
	};
}

export interface MockZaloServer {
	readonly baseUrl: string;
	readonly port: number;
	close(): Promise<void>;
}

function readRequestBody(request: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Uint8Array[] = [];
		request.on("data", (chunk: Uint8Array) => chunks.push(chunk));
		request.on("end", () => {
			const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
			const bytes = new Uint8Array(total);
			let offset = 0;
			for (const chunk of chunks) {
				bytes.set(chunk, offset);
				offset += chunk.byteLength;
			}
			resolve(new TextDecoder().decode(bytes));
		});
		request.on("error", reject);
	});
}

async function serve(
	mock: MockZalo,
	port: number,
	incoming: IncomingMessage,
	outgoing: ServerResponse,
): Promise<void> {
	const headers = new Headers();
	for (const [name, value] of Object.entries(incoming.headers)) {
		if (typeof value === "string") {
			headers.set(name, value);
		}
	}
	const body = await readRequestBody(incoming);
	const method = incoming.method ?? "GET";
	const response = await mock.handle(
		new Request(`http://127.0.0.1:${port}${incoming.url ?? "/"}`, {
			method,
			headers,
			...(method === "GET" || method === "HEAD" ? {} : { body }),
		}),
	);
	const location = response.headers.get("location");
	outgoing.writeHead(response.status, {
		"content-type": response.headers.get("content-type") ?? "application/json",
		...(location === null ? {} : { location }),
	});
	outgoing.end(await response.text());
}

export function startMockZalo(mock: MockZalo): Promise<MockZaloServer> {
	return new Promise((resolve, reject) => {
		let port = 0;
		const server = createServer((incoming, outgoing) => {
			serve(mock, port, incoming, outgoing).catch(() => {
				outgoing.writeHead(500);
				outgoing.end();
			});
		});
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (address === null || typeof address === "string") {
				reject(new Error("the mock Zalo server has no port"));
				return;
			}
			port = address.port;
			resolve({
				baseUrl: `http://127.0.0.1:${port}`,
				port,
				close: () =>
					new Promise<void>((done, fail) => {
						server.closeAllConnections();
						server.close((error) => (error ? fail(error) : done()));
					}),
			});
		});
	});
}
