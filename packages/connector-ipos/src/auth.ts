import { z } from "zod";
import { IposAuthError, IposHttpError, IposSchemaError } from "./errors.js";
import type { Transport } from "./http.js";
import type { IposLogger } from "./logger.js";
import { optionalText } from "./schemas/common.js";
import { type LoginPayload, loginResponseSchema } from "./schemas/login.js";

export const LOGIN_PATH = "/api/accounts/v1/user/login";
export const TOKEN_REFRESH_WINDOW_MS = 12 * 60 * 60 * 1000;

export interface StoredToken {
	token: string;
	expiresAt: number;
	companyUid: string;
	userUid: string;
}

export interface TokenStore {
	get(key: string): Promise<StoredToken | null>;
	set(key: string, token: StoredToken): Promise<void>;
}

export function createMemoryTokenStore(): TokenStore {
	const tokens = new Map<string, StoredToken>();
	return {
		async get(key) {
			return tokens.get(key) ?? null;
		},
		async set(key, token) {
			tokens.set(key, token);
		},
	};
}

export const jwtClaimsSchema = z.looseObject({
	id: z.string(),
	ut: optionalText,
	email: optionalText,
	cp: z.string(),
	iat: z.number().optional(),
	exp: z.number(),
});

export type JwtClaims = z.infer<typeof jwtClaimsSchema>;

function malformedToken(reason: string): IposAuthError {
	return new IposAuthError({
		endpoint: LOGIN_PATH,
		status: null,
		trackId: null,
		serverMessage: reason,
	});
}

export function decodeBase64Url(segment: string): string {
	const base64 = segment.replaceAll("-", "+").replaceAll("_", "/");
	const padding = "=".repeat((4 - (base64.length % 4)) % 4);
	const binary = atob(`${base64}${padding}`);
	const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
	return new TextDecoder("utf-8").decode(bytes);
}

export function decodeJwtPayload(token: string): JwtClaims {
	const segments = token.split(".");
	const payloadSegment = segments[1];
	if (segments.length !== 3 || !payloadSegment) {
		throw malformedToken("login returned a token that is not a JWT");
	}
	let payload: unknown;
	try {
		payload = JSON.parse(decodeBase64Url(payloadSegment));
	} catch {
		throw malformedToken("login returned a JWT whose payload is not JSON");
	}
	const claims = jwtClaimsSchema.safeParse(payload);
	if (!claims.success) {
		throw new IposSchemaError(
			LOGIN_PATH,
			claims.error.issues,
			"returned a JWT with unexpected claims",
		);
	}
	return claims.data;
}

export function toStoredToken(token: string): StoredToken {
	const claims = decodeJwtPayload(token);
	return {
		token,
		expiresAt: claims.exp * 1000,
		companyUid: claims.cp,
		userUid: claims.id,
	};
}

export function isTokenFresh(stored: StoredToken, now: number): boolean {
	return stored.expiresAt - now > TOKEN_REFRESH_WINDOW_MS;
}

export interface AuthSessionOptions {
	email: string;
	password: string;
	tokenStore: TokenStore;
	transport: Transport;
	logger: IposLogger;
	now?: () => number;
}

export interface AuthSession {
	getToken(signal?: AbortSignal): Promise<string>;
	login(signal?: AbortSignal): Promise<LoginPayload>;
}

const CREDENTIAL_REJECTION_STATUSES = new Set([401, 403]);

function asAuthError(error: unknown): unknown {
	if (
		error instanceof IposHttpError &&
		CREDENTIAL_REJECTION_STATUSES.has(error.status)
	) {
		return new IposAuthError({
			endpoint: error.endpoint,
			status: error.status,
			trackId: error.trackId,
			serverMessage: error.serverMessage,
		});
	}
	return error;
}

export function settleUnlessAborted<T>(
	work: Promise<T>,
	signal: AbortSignal | undefined,
): Promise<T> {
	if (!signal) {
		return work;
	}
	if (signal.aborted) {
		work.catch(() => undefined);
		return Promise.reject(signal.reason);
	}
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(signal.reason);
		signal.addEventListener("abort", onAbort, { once: true });
		work.then(resolve, reject).finally(() => {
			signal.removeEventListener("abort", onAbort);
		});
	});
}

export function createAuthSession(options: AuthSessionOptions): AuthSession {
	const { email, password, tokenStore, transport, logger } = options;
	const now = options.now ?? Date.now;
	let inFlightLogin: Promise<LoginPayload> | null = null;

	async function performLogin(): Promise<LoginPayload> {
		logger.debug("ipos login", { endpoint: LOGIN_PATH });
		let payload: LoginPayload;
		try {
			const envelope = await transport.request({
				method: "POST",
				path: LOGIN_PATH,
				body: { email, password },
				headers: { "content-type": "application/json" },
				schema: loginResponseSchema,
			});
			payload = envelope.data;
		} catch (error) {
			throw asAuthError(error);
		}
		await tokenStore.set(email, toStoredToken(payload.token));
		logger.info("ipos login succeeded", {
			stores: payload.stores.length,
			brands: payload.brands.length,
		});
		return payload;
	}

	function login(signal?: AbortSignal): Promise<LoginPayload> {
		if (signal?.aborted) {
			return Promise.reject(signal.reason);
		}
		if (!inFlightLogin) {
			inFlightLogin = performLogin().finally(() => {
				inFlightLogin = null;
			});
		}
		return settleUnlessAborted(inFlightLogin, signal);
	}

	async function getToken(signal?: AbortSignal): Promise<string> {
		const stored = await tokenStore.get(email);
		if (stored && isTokenFresh(stored, now())) {
			return stored.token;
		}
		const payload = await login(signal);
		return payload.token;
	}

	return { getToken, login };
}
