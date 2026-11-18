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
} as const;

export const MOCK_ACCESS_TOKEN_LIFETIME_MS = 3_600_000;
export const MOCK_PHONE_TOKEN_LIFETIME_MS = 120_000;

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
	| { readonly kind: "hang" };

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

function answer(body: Record<string, unknown>, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json; charset=utf-8" },
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
			return answer({ message: "mock fault" }, fault.status);
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
	outgoing.writeHead(response.status, {
		"content-type": response.headers.get("content-type") ?? "application/json",
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
