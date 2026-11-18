import {
	isRecord,
	readJson,
	timedFetch,
	UpstreamError,
	type ZaloFetch,
} from "../http.js";
import { isCodeVerifier, isState } from "./pkce.js";

export const ZALO_OAUTH_BASE_URL = "https://oauth.zaloapp.com";
export const OA_PERMISSION_PATH = "/v4/oa/permission";
export const OA_ACCESS_TOKEN_PATH = "/v4/oa/access_token";
export const DEVELOPER_TOKEN_PATH = "/v4/access_token";

export const TOKEN_KINDS = ["oa", "developer"] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];

export const OA_TOKEN_ERRORS = {
	accessTokenInvalid: -216,
	accessTokenExpired: -220,
	packageExpired: -224,
} as const;

export const TOKEN_LIFETIMES: Readonly<
	Record<
		TokenKind,
		{ readonly accessSeconds: number; readonly refreshSeconds: number }
	>
> = {
	oa: { accessSeconds: 90_000, refreshSeconds: 90 * 86_400 },
	developer: { accessSeconds: 3_600, refreshSeconds: 30 * 86_400 },
};

export const TOKEN_PATTERN = /^[\x21-\x7e]{1,4096}$/;
export const AUTHORIZATION_CODE_PATTERN = /^[\x21-\x7e]{1,2048}$/;
export const ZALO_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const MAX_EXPIRES_IN_SECONDS = 400 * 86_400;

export interface ZaloOauthOptions {
	readonly baseUrl?: string | undefined;
	readonly fetch?: ZaloFetch | undefined;
	readonly timeoutMs?: number | undefined;
}

export interface TokenPair {
	readonly accessToken: string;
	readonly refreshToken: string;
	readonly accessExpiresAt: Date;
	readonly refreshExpiresAt: Date;
}

export type TokenAnswer =
	| { readonly ok: true; readonly pair: TokenPair }
	| { readonly ok: false; readonly error: number };

export interface AppCredentials {
	readonly appId: string;
	readonly appSecret: string;
}

function baseOf(options: ZaloOauthOptions): string {
	return (options.baseUrl ?? ZALO_OAUTH_BASE_URL).replace(/\/+$/, "");
}

export interface PermissionUrlInput {
	readonly baseUrl?: string | undefined;
	readonly appId: string;
	readonly redirectUri: string;
	readonly codeChallenge: string;
	readonly state: string;
}

export function oaPermissionUrl(input: PermissionUrlInput): string {
	if (!ZALO_ID_PATTERN.test(input.appId)) {
		throw new TypeError("the Zalo App id is malformed");
	}
	if (!isState(input.state)) {
		throw new TypeError("the authorisation state is malformed");
	}
	const query = new URLSearchParams({
		app_id: input.appId,
		redirect_uri: input.redirectUri,
		code_challenge: input.codeChallenge,
		state: input.state,
	});
	return `${baseOf(input)}${OA_PERMISSION_PATH}?${query.toString()}`;
}

function errorCode(body: Record<string, unknown>): number | null {
	const error = body.error;
	if (error === undefined || error === null || error === 0 || error === "0") {
		return null;
	}
	if (typeof error === "number" && Number.isInteger(error)) {
		return error;
	}
	if (typeof error === "string" && /^-?[0-9]{1,9}$/.test(error)) {
		return Number(error);
	}
	throw new UpstreamError("zalo", "invalid_answer");
}

function seconds(value: unknown): number | null {
	const number =
		typeof value === "number"
			? value
			: typeof value === "string" && /^[0-9]{1,9}$/.test(value)
				? Number(value)
				: Number.NaN;
	return Number.isInteger(number) &&
		number > 0 &&
		number <= MAX_EXPIRES_IN_SECONDS
		? number
		: null;
}

function tokenOf(value: unknown): string {
	if (typeof value !== "string" || !TOKEN_PATTERN.test(value)) {
		throw new UpstreamError("zalo", "invalid_answer");
	}
	return value;
}

export function parseTokenAnswer(
	body: unknown,
	kind: TokenKind,
	now: Date,
): TokenAnswer {
	if (!isRecord(body)) {
		throw new UpstreamError("zalo", "invalid_answer");
	}
	const error = errorCode(body);
	if (error !== null) {
		return { ok: false, error };
	}
	const accessToken = tokenOf(body.access_token);
	const refreshToken = tokenOf(body.refresh_token);
	if (accessToken === refreshToken) {
		throw new UpstreamError("zalo", "invalid_answer");
	}
	const lifetimes = TOKEN_LIFETIMES[kind];
	const accessSeconds =
		body.expires_in === undefined
			? lifetimes.accessSeconds
			: seconds(body.expires_in);
	if (accessSeconds === null) {
		throw new UpstreamError("zalo", "invalid_answer");
	}
	const refreshSeconds =
		seconds(body.refresh_token_expires_in) ?? lifetimes.refreshSeconds;
	return {
		ok: true,
		pair: {
			accessToken,
			refreshToken,
			accessExpiresAt: new Date(now.getTime() + accessSeconds * 1000),
			refreshExpiresAt: new Date(now.getTime() + refreshSeconds * 1000),
		},
	};
}

async function tokenRequest(
	options: ZaloOauthOptions,
	path: string,
	credentials: AppCredentials,
	form: Readonly<Record<string, string>>,
	kind: TokenKind,
	now: Date,
): Promise<TokenAnswer> {
	if (!ZALO_ID_PATTERN.test(credentials.appId)) {
		throw new TypeError("the Zalo App id is malformed");
	}
	const response = await timedFetch(
		`${baseOf(options)}${path}`,
		{
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				secret_key: credentials.appSecret,
			},
			body: new URLSearchParams({
				app_id: credentials.appId,
				...form,
			}).toString(),
		},
		{ service: "zalo", fetch: options.fetch, timeoutMs: options.timeoutMs },
	);
	const body = await readJson(response, "zalo");
	if (isRecord(body) && errorCode(body) !== null) {
		return parseTokenAnswer(body, kind, now);
	}
	if (!response.ok) {
		throw new UpstreamError("zalo", "status", response.status);
	}
	return parseTokenAnswer(body, kind, now);
}

export interface CodeExchange extends AppCredentials {
	readonly code: string;
	readonly codeVerifier: string;
}

export function exchangeOaCode(
	options: ZaloOauthOptions,
	input: CodeExchange,
	now: Date,
): Promise<TokenAnswer> {
	if (!AUTHORIZATION_CODE_PATTERN.test(input.code)) {
		throw new TypeError("the authorisation code is malformed");
	}
	if (!isCodeVerifier(input.codeVerifier)) {
		throw new TypeError("the PKCE code verifier is malformed");
	}
	return tokenRequest(
		options,
		OA_ACCESS_TOKEN_PATH,
		input,
		{
			code: input.code,
			grant_type: "authorization_code",
			code_verifier: input.codeVerifier,
		},
		"oa",
		now,
	);
}

export interface TokenRefresh extends AppCredentials {
	readonly refreshToken: string;
}

export function refreshTokenPair(
	options: ZaloOauthOptions,
	kind: TokenKind,
	input: TokenRefresh,
	now: Date,
): Promise<TokenAnswer> {
	if (!TOKEN_PATTERN.test(input.refreshToken)) {
		throw new TypeError("the stored refresh token is malformed");
	}
	return tokenRequest(
		options,
		kind === "oa" ? OA_ACCESS_TOKEN_PATH : DEVELOPER_TOKEN_PATH,
		input,
		{ refresh_token: input.refreshToken, grant_type: "refresh_token" },
		kind,
		now,
	);
}
