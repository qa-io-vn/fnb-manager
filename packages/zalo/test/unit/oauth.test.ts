import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { UpstreamError } from "../../src/http.js";
import { ZaloConfigError } from "../../src/settings.js";
import {
	createMockZalo,
	MOCK_AUTHORIZATION_CODE_LIFETIME_MS,
	MOCK_OAUTH_PATHS,
	MOCK_ZALO_ERRORS,
	type MockZalo,
} from "../../src/testing/mock-zalo.js";
import {
	CODE_VERIFIER_LENGTH,
	codeChallengeS256,
	createCodeVerifier,
	createState,
	DEVELOPER_TOKEN_PATH,
	exchangeOaCode,
	isCodeVerifier,
	isState,
	OA_ACCESS_TOKEN_PATH,
	OA_PERMISSION_PATH,
	OA_TOKEN_ERRORS,
	oaPermissionUrl,
	parseTokenAnswer,
	refreshTokenPair,
	STATE_LENGTH,
	startPkce,
	stateKey,
	TOKEN_LIFETIMES,
	tokenJobSettings,
	ZALO_OAUTH_BASE_URL,
} from "../../src/tokens/index.js";

const APP_ID = "synthetic-app-oauth";
const OA_ID = "synthetic-oa-oauth";
const APP_SECRET = "synthetic-app-secret-oauth";
const REDIRECT = "https://example.invalid/functions/v1/zalo-oauth";
const NOW = new Date("2026-11-18T03:00:00.000Z");
const RFC_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function counting(): (length: number) => Uint8Array {
	let next = 0;
	return (length) =>
		Uint8Array.from({ length }, () => {
			next = (next + 37) % 256;
			return next;
		});
}

function mockWithApp(): MockZalo {
	const mock = createMockZalo({ startAt: NOW.getTime() });
	mock.registerApp({ appId: APP_ID, appSecret: APP_SECRET, oaId: OA_ID });
	return mock;
}

async function permissionCode(
	mock: MockZalo,
	verifier: string,
	state: string,
): Promise<URL> {
	const response = await mock.handle(
		new Request(
			oaPermissionUrl({
				baseUrl: "http://127.0.0.1:9",
				appId: APP_ID,
				redirectUri: REDIRECT,
				codeChallenge: await codeChallengeS256(verifier),
				state,
			}),
		),
	);
	expect(response.status).toBe(302);
	return new URL(response.headers.get("location") ?? "");
}

describe("PKCE", () => {
	it("makes a 43-character base64url verifier from 32 random bytes", () => {
		const verifier = createCodeVerifier();
		expect(verifier).toHaveLength(CODE_VERIFIER_LENGTH);
		expect(verifier).toMatch(BASE64URL);
		expect(isCodeVerifier(verifier)).toBe(true);
		expect(createCodeVerifier()).not.toBe(verifier);
	});

	it("uses only the RFC 7636 unreserved alphabet", () => {
		const verifier = createCodeVerifier(() => new Uint8Array(32).fill(255));
		expect(verifier).toBe(`${"_".repeat(42)}8`);
		expect(isCodeVerifier("a".repeat(42))).toBe(false);
		expect(isCodeVerifier("a".repeat(129))).toBe(false);
		expect(isCodeVerifier(`${"a".repeat(42)}+`)).toBe(false);
		expect(isCodeVerifier(`${"a".repeat(42)}~`)).toBe(true);
		expect(isCodeVerifier(42)).toBe(false);
	});

	it("derives the S256 challenge of the RFC 7636 appendix B vector", async () => {
		expect(await codeChallengeS256(RFC_VERIFIER)).toBe(RFC_CHALLENGE);
	});

	it("matches SHA-256 then base64url without padding for any verifier", async () => {
		const verifier = createCodeVerifier(counting());
		const expected = createHash("sha256").update(verifier).digest("base64url");
		expect(await codeChallengeS256(verifier)).toBe(expected);
		expect(expected).not.toContain("=");
	});

	it("refuses to derive a challenge from a malformed verifier", async () => {
		await expect(codeChallengeS256("too-short")).rejects.toThrow(TypeError);
	});

	it("makes a 32-character state and keeps only its SHA-256", async () => {
		const state = createState();
		expect(state).toHaveLength(STATE_LENGTH);
		expect(isState(state)).toBe(true);
		expect(await stateKey(state)).toBe(
			createHash("sha256").update(state).digest("hex"),
		);
	});

	it("refuses a state of the wrong length or alphabet", async () => {
		expect(isState("a".repeat(31))).toBe(false);
		expect(isState("a".repeat(33))).toBe(false);
		expect(isState(`${"a".repeat(31)}=`)).toBe(false);
		expect(isState(null)).toBe(false);
		await expect(stateKey("a".repeat(31))).rejects.toThrow(TypeError);
	});

	it("starts an authorisation with a fresh verifier, its challenge and a state", async () => {
		const pkce = await startPkce(counting());
		expect(pkce.codeChallenge).toBe(await codeChallengeS256(pkce.codeVerifier));
		expect(pkce.stateKey).toBe(await stateKey(pkce.state));
		expect(pkce.state).not.toBe(pkce.codeVerifier.slice(0, STATE_LENGTH));
	});
});

describe("the OA permission URL", () => {
	it("carries the app id, the redirect URI, the challenge and the state", () => {
		const state = "s".repeat(32);
		const url = new URL(
			oaPermissionUrl({
				appId: APP_ID,
				redirectUri: REDIRECT,
				codeChallenge: RFC_CHALLENGE,
				state,
			}),
		);
		expect(`${url.origin}${url.pathname}`).toBe(
			`${ZALO_OAUTH_BASE_URL}${OA_PERMISSION_PATH}`,
		);
		expect(Object.fromEntries(url.searchParams)).toEqual({
			app_id: APP_ID,
			redirect_uri: REDIRECT,
			code_challenge: RFC_CHALLENGE,
			state,
		});
	});

	it("refuses a malformed app id or state", () => {
		const input = {
			appId: APP_ID,
			redirectUri: REDIRECT,
			codeChallenge: RFC_CHALLENGE,
			state: "s".repeat(32),
		};
		expect(() => oaPermissionUrl({ ...input, appId: "app id" })).toThrow(
			TypeError,
		);
		expect(() => oaPermissionUrl({ ...input, state: "short" })).toThrow(
			TypeError,
		);
	});
});

describe("token answers", () => {
	it("reads expires_in given as a string and defaults the refresh life", () => {
		const answer = parseTokenAnswer(
			{ access_token: "a-1", refresh_token: "r-1", expires_in: "90000" },
			"oa",
			NOW,
		);
		expect(answer).toEqual({
			ok: true,
			pair: {
				accessToken: "a-1",
				refreshToken: "r-1",
				accessExpiresAt: new Date(NOW.getTime() + 90_000_000),
				refreshExpiresAt: new Date(
					NOW.getTime() + TOKEN_LIFETIMES.oa.refreshSeconds * 1000,
				),
			},
		});
	});

	it("uses the developer lifetimes and a refresh life the answer gives", () => {
		const answer = parseTokenAnswer(
			{
				access_token: "a-2",
				refresh_token: "r-2",
				refresh_token_expires_in: 86_400,
			},
			"developer",
			NOW,
		);
		expect(answer.ok && answer.pair.accessExpiresAt).toEqual(
			new Date(NOW.getTime() + 3_600_000),
		);
		expect(answer.ok && answer.pair.refreshExpiresAt).toEqual(
			new Date(NOW.getTime() + 86_400_000),
		);
	});

	it("turns an error answer into its code", () => {
		expect(
			parseTokenAnswer({ error: -216, message: "invalid" }, "oa", NOW),
		).toEqual({ ok: false, error: -216 });
		expect(parseTokenAnswer({ error: "-224" }, "oa", NOW)).toEqual({
			ok: false,
			error: -224,
		});
	});

	it("refuses an answer without a usable pair", () => {
		for (const body of [
			null,
			[],
			{ access_token: "a" },
			{ access_token: "a", refresh_token: "a" },
			{ access_token: "a b", refresh_token: "r" },
			{ access_token: "a", refresh_token: "r", expires_in: "-5" },
			{ access_token: "a", refresh_token: "r", expires_in: 0 },
			{ error: "boom" },
		]) {
			expect(() => parseTokenAnswer(body, "oa", NOW)).toThrow(UpstreamError);
		}
	});
});

describe("the OAuth calls against the mock", () => {
	it("exchanges a code from the permission redirect with the verifier", async () => {
		const mock = mockWithApp();
		const verifier = createCodeVerifier();
		const state = createState();
		const redirect = await permissionCode(mock, verifier, state);
		expect(`${redirect.origin}${redirect.pathname}`).toBe(REDIRECT);
		expect(redirect.searchParams.get("state")).toBe(state);
		expect(redirect.searchParams.get("oa_id")).toBe(OA_ID);
		const answer = await exchangeOaCode(
			{ fetch: mock.fetch },
			{
				appId: APP_ID,
				appSecret: APP_SECRET,
				code: redirect.searchParams.get("code") ?? "",
				codeVerifier: verifier,
			},
			NOW,
		);
		expect(answer.ok).toBe(true);
		expect(answer.ok && mock.accessTokenLive(answer.pair.accessToken)).toBe(
			true,
		);
		expect(answer.ok && answer.pair.accessExpiresAt).toEqual(
			new Date(NOW.getTime() + 90_000_000),
		);
		expect(mock.oauthCounts()).toMatchObject({
			authorizations: 1,
			exchanges: 1,
		});
	});

	it("refuses a code a second time, after 10 minutes, or with another verifier", async () => {
		const mock = mockWithApp();
		const verifier = createCodeVerifier();
		const exchange = async (code: string, codeVerifier = verifier) =>
			exchangeOaCode(
				{ fetch: mock.fetch },
				{ appId: APP_ID, appSecret: APP_SECRET, code, codeVerifier },
				NOW,
			);
		const first = await permissionCode(mock, verifier, createState());
		const code = first.searchParams.get("code") ?? "";
		expect((await exchange(code)).ok).toBe(true);
		expect(await exchange(code)).toEqual({
			ok: false,
			error: MOCK_ZALO_ERRORS.codeUsed,
		});
		const late = await permissionCode(mock, verifier, createState());
		mock.advance(MOCK_AUTHORIZATION_CODE_LIFETIME_MS);
		expect(await exchange(late.searchParams.get("code") ?? "")).toEqual({
			ok: false,
			error: MOCK_ZALO_ERRORS.codeExpired,
		});
		const other = await permissionCode(mock, verifier, createState());
		expect(
			await exchange(
				other.searchParams.get("code") ?? "",
				createCodeVerifier(),
			),
		).toEqual({ ok: false, error: MOCK_ZALO_ERRORS.verifierInvalid });
	});

	it("refuses a wrong App secret", async () => {
		const mock = mockWithApp();
		const verifier = createCodeVerifier();
		const redirect = await permissionCode(mock, verifier, createState());
		expect(
			await exchangeOaCode(
				{ fetch: mock.fetch },
				{
					appId: APP_ID,
					appSecret: "synthetic-wrong-secret",
					code: redirect.searchParams.get("code") ?? "",
					codeVerifier: verifier,
				},
				NOW,
			),
		).toEqual({ ok: false, error: MOCK_ZALO_ERRORS.appSecretInvalid });
	});

	it("rotates an OA pair once: the old refresh token is spent and its access token dies", async () => {
		const mock = mockWithApp();
		const first = mock.issueTokens(APP_ID, "oa");
		const refresh = (refreshToken: string) =>
			refreshTokenPair(
				{ fetch: mock.fetch },
				"oa",
				{ appId: APP_ID, appSecret: APP_SECRET, refreshToken },
				NOW,
			);
		const answer = await refresh(first.refreshToken);
		expect(answer.ok).toBe(true);
		expect(mock.refreshTokenState(first.refreshToken)).toBe("spent");
		expect(mock.accessTokenLive(first.accessToken)).toBe(false);
		expect(answer.ok && mock.refreshTokenState(answer.pair.refreshToken)).toBe(
			"live",
		);
		expect(await refresh(first.refreshToken)).toEqual({
			ok: false,
			error: MOCK_ZALO_ERRORS.refreshTokenUsed,
		});
		expect(mock.oauthCounts().refreshes).toBe(1);
		const sent = mock.requests(OA_ACCESS_TOKEN_PATH);
		expect(sent[0]?.headerNames).toContain("secret_key");
	});

	it("rotates a developer pair on its own path and keeps the kinds apart", async () => {
		const mock = mockWithApp();
		const developer = mock.issueTokens(APP_ID, "developer");
		const oa = mock.issueTokens(APP_ID, "oa");
		const answer = await refreshTokenPair(
			{ fetch: mock.fetch },
			"developer",
			{
				appId: APP_ID,
				appSecret: APP_SECRET,
				refreshToken: developer.refreshToken,
			},
			NOW,
		);
		expect(answer.ok && answer.pair.refreshExpiresAt).toEqual(
			new Date(NOW.getTime() + TOKEN_LIFETIMES.developer.refreshSeconds * 1000),
		);
		expect(mock.requests(DEVELOPER_TOKEN_PATH)).toHaveLength(1);
		expect(
			await refreshTokenPair(
				{ fetch: mock.fetch },
				"developer",
				{ appId: APP_ID, appSecret: APP_SECRET, refreshToken: oa.refreshToken },
				NOW,
			),
		).toEqual({ ok: false, error: MOCK_ZALO_ERRORS.refreshTokenInvalid });
	});

	it("answers the OA token errors -216, -220 and -224 as codes", async () => {
		const mock = mockWithApp();
		const pair = mock.issueTokens(APP_ID, "oa");
		for (const code of Object.values(OA_TOKEN_ERRORS)) {
			mock.failNext(MOCK_OAUTH_PATHS.oaAccessToken, {
				kind: "error",
				error: code,
			});
			expect(
				await refreshTokenPair(
					{ fetch: mock.fetch },
					"oa",
					{
						appId: APP_ID,
						appSecret: APP_SECRET,
						refreshToken: pair.refreshToken,
					},
					NOW,
				),
			).toEqual({ ok: false, error: code });
		}
		expect(mock.refreshTokenState(pair.refreshToken)).toBe("live");
	});

	it("times out without naming the secret, and a lost answer still spent the token", async () => {
		const mock = mockWithApp();
		const pair = mock.issueTokens(APP_ID, "oa");
		mock.failNext(MOCK_OAUTH_PATHS.oaAccessToken, { kind: "lost" });
		const error = await refreshTokenPair(
			{ fetch: mock.fetch, timeoutMs: 20 },
			"oa",
			{ appId: APP_ID, appSecret: APP_SECRET, refreshToken: pair.refreshToken },
			NOW,
		).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(UpstreamError);
		expect((error as UpstreamError).failure).toBe("timeout");
		expect(String(error)).not.toContain(APP_SECRET);
		expect(String(error)).not.toContain(pair.refreshToken);
		expect(mock.refreshTokenState(pair.refreshToken)).toBe("spent");
	});

	it("reports an HTTP error without an error code as a status failure", async () => {
		const mock = mockWithApp();
		const pair = mock.issueTokens(APP_ID, "oa");
		mock.failNext(MOCK_OAUTH_PATHS.oaAccessToken, {
			kind: "status",
			status: 503,
		});
		const error = await refreshTokenPair(
			{ fetch: mock.fetch },
			"oa",
			{ appId: APP_ID, appSecret: APP_SECRET, refreshToken: pair.refreshToken },
			NOW,
		).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(UpstreamError);
		expect((error as UpstreamError).status).toBe(503);
	});
});

describe("tokenJobSettings", () => {
	const tenant = "11111111-1111-4111-8111-111111111111";

	it("calls Zalo's OAuth server with no variable set", () => {
		expect(tokenJobSettings({})).toEqual({
			integration: false,
			tenantId: null,
			oauthBaseUrl: ZALO_OAUTH_BASE_URL,
		});
	});

	it("takes a loopback OAuth server only in an integration run with a tenant filter", () => {
		expect(
			tokenJobSettings({
				ZALO_INTEGRATION: "1",
				ZALO_TENANT_ID: tenant,
				ZALO_OAUTH_BASE_URL: "http://127.0.0.1:8788",
			}),
		).toEqual({
			integration: true,
			tenantId: tenant,
			oauthBaseUrl: "http://127.0.0.1:8788",
		});
		expect(() =>
			tokenJobSettings({ ZALO_OAUTH_BASE_URL: "http://127.0.0.1:8788" }),
		).toThrow(ZaloConfigError);
		expect(() =>
			tokenJobSettings({
				ZALO_INTEGRATION: "1",
				ZALO_TENANT_ID: tenant,
				ZALO_OAUTH_BASE_URL: "https://oauth.example.com",
			}),
		).toThrow(ZaloConfigError);
		expect(() =>
			tokenJobSettings({
				ZALO_INTEGRATION: "1",
				ZALO_OAUTH_BASE_URL: "http://127.0.0.1:8788",
			}),
		).toThrow("needs ZALO_TENANT_ID");
	});
});
