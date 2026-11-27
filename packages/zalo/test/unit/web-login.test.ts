import { describe, expect, it } from "vitest";
import {
	codeChallengeOf,
	deviceLineOf,
	exchangeWebLoginCode,
	graphCallOf,
	importRelayKey,
	newRelayKey,
	openIdentityTicket,
	openRelayRequest,
	RELAY_WEB_LOGIN_PATH,
	type RelayRequest,
	ReplayGuard,
	relayFetch,
	relayTargetOf,
	sealIdentityTicket,
	sealingKey,
	sealLoginState,
	sealRelayAnswer,
	sealRelayRequest,
	validateRelayRequest,
	verifyLoginState,
	WebLoginError,
	webLoginAuthorizeUrl,
	webLoginFormValid,
	ZALO_OAUTH_ORIGIN,
} from "../../src/index.js";
import { createMockZalo, MOCK_ZALO_ERRORS } from "../../src/testing/index.js";
import { base64UrlOf } from "../../src/web-login.js";

// zalo:unit/web-login (ADR-066): the counter's Zalo web login. Equivalence classes and boundaries of the sealed
// state and identity ticket (valid, expired at the instant, another redirect, another verifier, another purpose,
// another App secret, tampered, junk), the token exchange against the mock Zalo (a code used twice, a wrong verifier,
// a wrong secret), the relay's one new call (exactly four form fields, never a refresh) and the device line.

const NOW = Date.parse("2026-11-28T03:00:00Z");
const SECRET = "synthetic-app-secret-0001";
const VERIFIER = "v".repeat(43);
const REDIRECT = "https://counter.example.com/";

describe("the sealed login state", () => {
	it("verifies with the same redirect and verifier before it expires", async () => {
		const key = await sealingKey(SECRET, "state");
		const state = await sealLoginState(key, {
			challenge: await codeChallengeOf(VERIFIER),
			redirectUri: REDIRECT,
			expiresAt: NOW + 1,
		});
		await expect(
			verifyLoginState(key, state, {
				redirectUri: REDIRECT,
				codeVerifier: VERIFIER,
				now: NOW,
			}),
		).resolves.toBeUndefined();
	});

	it("is expired at the instant it expires (boundary)", async () => {
		const key = await sealingKey(SECRET, "state");
		const state = await sealLoginState(key, {
			challenge: await codeChallengeOf(VERIFIER),
			redirectUri: REDIRECT,
			expiresAt: NOW,
		});
		await expect(
			verifyLoginState(key, state, {
				redirectUri: REDIRECT,
				codeVerifier: VERIFIER,
				now: NOW,
			}),
		).rejects.toMatchObject({ code: "expired" });
	});

	it("refuses another redirect address and another verifier", async () => {
		const key = await sealingKey(SECRET, "state");
		const state = await sealLoginState(key, {
			challenge: await codeChallengeOf(VERIFIER),
			redirectUri: REDIRECT,
			expiresAt: NOW + 60_000,
		});
		await expect(
			verifyLoginState(key, state, {
				redirectUri: "https://evil.example.com/",
				codeVerifier: VERIFIER,
				now: NOW,
			}),
		).rejects.toMatchObject({ code: "mismatch" });
		await expect(
			verifyLoginState(key, state, {
				redirectUri: REDIRECT,
				codeVerifier: "w".repeat(43),
				now: NOW,
			}),
		).rejects.toMatchObject({ code: "mismatch" });
	});

	it("refuses a state sealed with another secret, for another purpose, tampered or made up", async () => {
		const key = await sealingKey(SECRET, "state");
		const other = await sealingKey("another-secret", "state");
		const ticketKey = await sealingKey(SECRET, "ticket");
		const input = {
			challenge: await codeChallengeOf(VERIFIER),
			redirectUri: REDIRECT,
			expiresAt: NOW + 60_000,
		};
		const callback = {
			redirectUri: REDIRECT,
			codeVerifier: VERIFIER,
			now: NOW,
		};
		const foreign = await sealLoginState(other, input);
		await expect(verifyLoginState(key, foreign, callback)).rejects.toThrow(
			WebLoginError,
		);
		const state = await sealLoginState(key, input);
		await expect(
			verifyLoginState(ticketKey, state, callback),
		).rejects.toMatchObject({ code: "sealed" });
		const flipped = `${state.slice(0, 20)}${state[20] === "A" ? "B" : "A"}${state.slice(21)}`;
		await expect(verifyLoginState(key, flipped, callback)).rejects.toThrow(
			WebLoginError,
		);
		for (const junk of ["", "x", "a".repeat(39), "!".repeat(60)]) {
			await expect(verifyLoginState(key, junk, callback)).rejects.toThrow(
				WebLoginError,
			);
		}
	});
});

describe("the identity ticket", () => {
	it("carries the verified person for the app until it expires", async () => {
		const key = await sealingKey(SECRET, "ticket");
		const ticket = await sealIdentityTicket(key, {
			zaloAppId: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
			zaloUserId: "zalo-user-1",
			displayName: "Synthetic",
			expiresAt: NOW + 1,
		});
		await expect(
			openIdentityTicket(key, ticket, {
				zaloAppId: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
				now: NOW,
			}),
		).resolves.toMatchObject({
			zaloUserId: "zalo-user-1",
			displayName: "Synthetic",
		});
		await expect(
			openIdentityTicket(key, ticket, {
				zaloAppId: "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
				now: NOW + 1,
			}),
		).rejects.toMatchObject({ code: "expired" });
		await expect(
			openIdentityTicket(key, ticket, {
				zaloAppId: "aaaaaaaa-aaaa-4aaa-8aaa-000000000002",
				now: NOW,
			}),
		).rejects.toMatchObject({ code: "sealed" });
	});

	it("does not open as a state", async () => {
		const ticketKey = await sealingKey(SECRET, "ticket");
		const stateKey = await sealingKey(SECRET, "state");
		const ticket = await sealIdentityTicket(ticketKey, {
			zaloAppId: "a",
			zaloUserId: "u",
			displayName: null,
			expiresAt: NOW + 60_000,
		});
		await expect(
			verifyLoginState(stateKey, ticket, {
				redirectUri: REDIRECT,
				codeVerifier: VERIFIER,
				now: NOW,
			}),
		).rejects.toMatchObject({ code: "sealed" });
	});
});

describe("the authorise address and the token exchange", () => {
	it("names the app, the redirect, the challenge and the state", async () => {
		const url = new URL(
			webLoginAuthorizeUrl(ZALO_OAUTH_ORIGIN, {
				appId: "123",
				redirectUri: REDIRECT,
				codeChallenge: "c".repeat(43),
				state: "s".repeat(40),
			}),
		);
		expect(url.origin + url.pathname).toBe(
			"https://oauth.zaloapp.com/v4/permission",
		);
		expect(Object.fromEntries(url.searchParams)).toEqual({
			app_id: "123",
			redirect_uri: REDIRECT,
			code_challenge: "c".repeat(43),
			state: "s".repeat(40),
		});
	});

	it("exchanges a code once, with the right verifier and secret (mock Zalo)", async () => {
		const mock = createMockZalo();
		mock.registerApp({ appId: "123", appSecret: SECRET });
		mock.setWebLoginUser("123", { id: "zalo-user-9", name: "Synthetic" });
		const challenge = await codeChallengeOf(VERIFIER);
		const authorize = webLoginAuthorizeUrl("http://127.0.0.1:1", {
			appId: "123",
			redirectUri: REDIRECT,
			codeChallenge: challenge,
			state: "s".repeat(40),
		});
		const redirect = await mock.handle(new Request(authorize));
		expect(redirect.status).toBe(302);
		const code =
			new URL(redirect.headers.get("location") ?? "").searchParams.get(
				"code",
			) ?? "";
		const options = { baseUrl: "http://127.0.0.1:1", fetch: mock.fetch };
		const wrongSecret = await exchangeWebLoginCode(options, {
			appId: "123",
			appSecret: "wrong",
			code,
			codeVerifier: VERIFIER,
		});
		expect(wrongSecret).toEqual({
			ok: false,
			error: MOCK_ZALO_ERRORS.appSecretInvalid,
		});
		const first = await exchangeWebLoginCode(options, {
			appId: "123",
			appSecret: SECRET,
			code,
			codeVerifier: VERIFIER,
		});
		expect(first.ok).toBe(true);
		const again = await exchangeWebLoginCode(options, {
			appId: "123",
			appSecret: SECRET,
			code,
			codeVerifier: VERIFIER,
		});
		expect(again).toEqual({ ok: false, error: MOCK_ZALO_ERRORS.codeUsed });
	});

	it("refuses a wrong verifier and a malformed input before any call", async () => {
		const mock = createMockZalo();
		mock.registerApp({ appId: "123", appSecret: SECRET });
		mock.setWebLoginUser("123", { id: "zalo-user-9" });
		const redirect = await mock.handle(
			new Request(
				webLoginAuthorizeUrl("http://127.0.0.1:1", {
					appId: "123",
					redirectUri: REDIRECT,
					codeChallenge: await codeChallengeOf(VERIFIER),
					state: "s".repeat(40),
				}),
			),
		);
		const code =
			new URL(redirect.headers.get("location") ?? "").searchParams.get(
				"code",
			) ?? "";
		const options = { baseUrl: "http://127.0.0.1:1", fetch: mock.fetch };
		await expect(
			exchangeWebLoginCode(options, {
				appId: "123",
				appSecret: SECRET,
				code,
				codeVerifier: "w".repeat(43),
			}),
		).resolves.toEqual({
			ok: false,
			error: MOCK_ZALO_ERRORS.verifierInvalid,
		});
		await expect(
			exchangeWebLoginCode(options, {
				appId: "123",
				appSecret: SECRET,
				code,
				codeVerifier: "short",
			}),
		).rejects.toThrow(TypeError);
		await expect(
			exchangeWebLoginCode(options, {
				appId: "bad id",
				appSecret: SECRET,
				code,
				codeVerifier: VERIFIER,
			}),
		).rejects.toThrow(TypeError);
	});
});

describe("the relay's token exchange call", () => {
	const form = new URLSearchParams({
		app_id: "123",
		code: "code-1",
		code_verifier: VERIFIER,
		grant_type: "authorization_code",
	}).toString();
	const init = {
		method: "POST" as const,
		headers: {
			"content-type": "application/x-www-form-urlencoded",
			secret_key: SECRET,
		},
		body: form,
	};

	it("carries exactly the authorisation-code exchange", () => {
		const call = graphCallOf(
			`${ZALO_OAUTH_ORIGIN}${RELAY_WEB_LOGIN_PATH}`,
			init,
		);
		expect(call).toEqual({
			path: RELAY_WEB_LOGIN_PATH,
			query: "",
			headers: { secret_key: SECRET },
			body: form,
		});
		expect(
			relayTargetOf(call ?? { path: "/v2.0/me", query: "", headers: {} }),
		).toEqual({
			url: "https://oauth.zaloapp.com/v4/access_token",
			method: "POST",
			headers: {
				secret_key: SECRET,
				"content-type": "application/x-www-form-urlencoded",
			},
			body: form,
		});
	});

	it("refuses a refresh, extra or repeated fields, another path, a query, a GET and other headers", () => {
		const url = `${ZALO_OAUTH_ORIGIN}${RELAY_WEB_LOGIN_PATH}`;
		const refused = [
			graphCallOf(url, {
				...init,
				body: new URLSearchParams({
					app_id: "123",
					refresh_token: "r",
					grant_type: "refresh_token",
				}).toString(),
			}),
			graphCallOf(url, { ...init, body: `${form}&extra=1` }),
			graphCallOf(url, { ...init, body: `${form}&code=again` }),
			graphCallOf(`${ZALO_OAUTH_ORIGIN}/v4/oa/access_token`, init),
			graphCallOf(`${url}?x=1`, init),
			graphCallOf(url, { method: "GET", headers: init.headers }),
			graphCallOf(url, {
				...init,
				headers: { ...init.headers, access_token: "a" },
			}),
			graphCallOf(url, {
				...init,
				headers: { "content-type": "text/plain", secret_key: SECRET },
			}),
			graphCallOf(url, { ...init, headers: { secret_key: "a\r\nb" } }),
			graphCallOf(url, { ...init, headers: {} }),
			graphCallOf(
				"https://oauth.zaloapp.com.evil.example/v4/access_token",
				init,
			),
		];
		expect(refused.every((call) => call === null)).toBe(true);
		expect(webLoginFormValid(`${form}`)).toBe(true);
		expect(webLoginFormValid("a".repeat(5000))).toBe(false);
		expect(webLoginFormValid(undefined)).toBe(false);
	});

	it("validates the sealed request at the relay, and refuses a body on a Graph call", async () => {
		const key = await importRelayKey(newRelayKey());
		const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
		const good: RelayRequest = {
			id,
			at: NOW,
			path: RELAY_WEB_LOGIN_PATH,
			query: "",
			headers: { secret_key: SECRET },
			body: form,
		};
		expect(validateRelayRequest(good, NOW)).toEqual(good);
		expect(() =>
			validateRelayRequest({ ...good, body: `${form}&x=1` }, NOW),
		).toThrow(/form/);
		expect(() =>
			validateRelayRequest(
				{ ...good, headers: { secret_key: SECRET, access_token: "a" } },
				NOW,
			),
		).toThrow(/header/);
		expect(() =>
			validateRelayRequest(
				{
					...good,
					path: "/v2.0/me",
					headers: { access_token: "a" },
					body: "x=1",
				},
				NOW,
			),
		).toThrow(/body/);
		const envelope = await sealRelayRequest(key, good);
		await expect(
			openRelayRequest(key, envelope, NOW, new ReplayGuard()),
		).resolves.toEqual(good);
	});

	it("sends the exchange through an announced relay, sealed", async () => {
		const key = await importRelayKey(newRelayKey());
		const sent: { url: string; body: string | undefined }[] = [];
		const fetch = relayFetch({
			key,
			relayUrl: async () => "https://relay.example.com",
			now: () => NOW,
			newId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab",
			fetch: async (url, requestInit) => {
				sent.push({ url, body: requestInit.body });
				return new Response(
					await sealRelayAnswer(key, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab", {
						status: 200,
						body: JSON.stringify({ access_token: "t" }),
					}),
				);
			},
		});
		const answer = await fetch(
			`${ZALO_OAUTH_ORIGIN}${RELAY_WEB_LOGIN_PATH}`,
			init,
		);
		expect(await answer.json()).toEqual({ access_token: "t" });
		expect(sent).toHaveLength(1);
		expect(sent[0]?.url).toBe("https://relay.example.com/relay");
		expect(sent[0]?.body).not.toContain(SECRET);
		expect(sent[0]?.body).not.toContain("code-1");
	});
});

describe("the device line", () => {
	it.each([
		[
			"Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
			"Chrome · Android",
		],
		[
			"Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
			"Safari · iPad",
		],
		[
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0",
			"Edge · Windows",
		],
		["curl/8.0", null],
		["", null],
		[null, null],
	])("%s is %s", (agent, line) => {
		expect(deviceLineOf(agent)).toBe(line);
	});

	it("is never longer than 60 characters", () => {
		expect(
			(deviceLineOf("Chrome/1 Android ".repeat(100)) ?? "").length,
		).toBeLessThanOrEqual(60);
		expect(base64UrlOf(new Uint8Array([251, 255]))).toBe("-_8");
	});
});
