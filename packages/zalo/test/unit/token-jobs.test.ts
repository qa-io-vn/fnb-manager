import { describe, expect, it } from "vitest";
import {
	createMockZalo,
	MOCK_OAUTH_PATHS,
	type MockZalo,
} from "../../src/testing/mock-zalo.js";
import {
	beginOaAuthorization,
	codeChallengeS256,
	completeOaAuthorization,
	OA_TOKEN_ERRORS,
	refreshToken,
	stateKey,
	type TokenJobDependencies,
	type TokenKind,
	type TokenTarget,
	UNANSWERED_ALERT_MARGIN_SECONDS,
} from "../../src/tokens/index.js";
import {
	createFakeTokenStore,
	type FakeTokenStore,
} from "../../src/tokens/testing.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const BRAND = "22222222-2222-4222-8222-222222222222";
const APP_ID = "synthetic-app-jobs";
const OA_ID = "synthetic-oa-jobs";
const SECRET_NAME = "ZALO_APP_SECRET_BRAND_1";
const APP_SECRET = "synthetic-app-secret-jobs";
const NOW = new Date("2026-11-18T03:00:00.000Z");
const HOUR = 3_600_000;
const REDIRECT = "https://example.invalid/functions/v1/zalo-oauth";

interface Harness {
	readonly mock: MockZalo;
	readonly store: FakeTokenStore;
	readonly dependencies: TokenJobDependencies;
	readonly secrets: Map<string, string>;
	target(kind: TokenKind): TokenTarget;
}

function harness(options: { readonly timeoutMs?: number } = {}): Harness {
	const mock = createMockZalo({ startAt: NOW.getTime() });
	mock.registerApp({ appId: APP_ID, appSecret: APP_SECRET, oaId: OA_ID });
	const store = createFakeTokenStore();
	store.addBrand({
		tenantId: TENANT,
		tenantSlug: "zalo-it-jobs",
		brandId: BRAND,
		brandKey: "brand-1",
		appId: APP_ID,
		appSecretName: SECRET_NAME,
		oaId: OA_ID,
	});
	const secrets = new Map([[SECRET_NAME, APP_SECRET]]);
	return {
		mock,
		store,
		secrets,
		dependencies: {
			store,
			oauth: { fetch: mock.fetch, timeoutMs: options.timeoutMs },
			secret: (name) => secrets.get(name) ?? null,
			clock: () => NOW,
			source: "cli",
		},
		target: (kind) => ({
			tenantId: TENANT,
			tenantSlug: "zalo-it-jobs",
			brandId: BRAND,
			brandKey: "brand-1",
			kind,
			appId: APP_ID,
			appSecretName: SECRET_NAME,
			hasToken: true,
		}),
	};
}

function seedFromMock(
	test: Harness,
	kind: TokenKind,
	ageMs: number,
	accessLeftMs = 13 * HOUR,
): string {
	const pair = test.mock.issueTokens(APP_ID, kind);
	test.store.seed(BRAND, kind, {
		accessToken: pair.accessToken,
		refreshToken: pair.refreshToken,
		refreshedAt: new Date(NOW.getTime() - ageMs),
		accessExpiresAt: new Date(NOW.getTime() + accessLeftMs),
	});
	return pair.refreshToken;
}

describe("the OA token refresh", () => {
	it("leaves a pair younger than 11 hours alone and calls nobody", async () => {
		const test = harness();
		seedFromMock(test, "oa", 10 * HOUR);
		expect(await refreshToken(test.dependencies, test.target("oa"))).toEqual({
			outcome: "fresh",
			ageSeconds: 36_000,
			version: 1,
		});
		expect(test.mock.requests()).toHaveLength(0);
	});

	it("refreshes a pair older than 11 hours and stores the new pair first", async () => {
		const test = harness();
		const spent = seedFromMock(test, "oa", 11 * HOUR + 1_000);
		const result = await refreshToken(test.dependencies, test.target("oa"));
		expect(result).toEqual({
			outcome: "refreshed",
			version: 2,
			ageSeconds: 39_601,
		});
		const stored = test.store.token(BRAND, "oa");
		expect(test.mock.refreshTokenState(spent)).toBe("spent");
		expect(test.mock.refreshTokenState(stored?.refreshToken ?? "")).toBe(
			"live",
		);
		expect(test.mock.accessTokenLive(stored?.accessToken ?? "")).toBe(true);
		expect(stored?.refreshedAt).toEqual(NOW);
		expect(stored?.accessExpiresAt).toEqual(
			new Date(NOW.getTime() + 25 * HOUR),
		);
		expect(test.store.alerts).toEqual([]);
	});

	it("refreshes exactly once when two runs start together", async () => {
		const test = harness();
		seedFromMock(test, "oa", 12 * HOUR);
		const results = await Promise.all([
			refreshToken(test.dependencies, test.target("oa")),
			refreshToken(test.dependencies, test.target("oa")),
		]);
		expect(results.map((result) => result.outcome).sort()).toEqual([
			"fresh",
			"refreshed",
		]);
		expect(test.mock.oauthCounts().refreshes).toBe(1);
		expect(test.store.token(BRAND, "oa")?.version).toBe(2);
	});

	it("refreshes twice in a row once each pair is old enough", async () => {
		const test = harness();
		seedFromMock(test, "oa", 12 * HOUR);
		let now = NOW;
		const dependencies = { ...test.dependencies, clock: () => now };
		expect((await refreshToken(dependencies, test.target("oa"))).outcome).toBe(
			"refreshed",
		);
		now = new Date(NOW.getTime() + 6 * HOUR);
		expect((await refreshToken(dependencies, test.target("oa"))).outcome).toBe(
			"fresh",
		);
		now = new Date(NOW.getTime() + 12 * HOUR);
		expect(await refreshToken(dependencies, test.target("oa"))).toMatchObject({
			outcome: "refreshed",
			version: 3,
		});
		expect(test.mock.oauthCounts().refreshes).toBe(2);
	});

	for (const code of Object.values(OA_TOKEN_ERRORS)) {
		it(`raises zalo_token_failed once for ${code} and counts a repeat on the same episode`, async () => {
			const test = harness();
			const refresh = seedFromMock(test, "oa", 12 * HOUR);
			for (const expected of ["opened", "repeated"]) {
				test.mock.failNext(MOCK_OAUTH_PATHS.oaAccessToken, {
					kind: "error",
					error: code,
				});
				expect(
					await refreshToken(test.dependencies, test.target("oa")),
				).toEqual({ outcome: "refused", errorCode: code, alert: expected });
			}
			expect(test.store.alerts.map((alert) => alert.failure)).toEqual([
				{ reason: "refused", errorCode: code },
				{ reason: "refused", errorCode: code },
			]);
			expect(test.store.openAlerts()).toEqual([`${BRAND}:oa`]);
			expect(test.store.token(BRAND, "oa")?.refreshToken).toBe(refresh);
			expect(test.store.token(BRAND, "oa")?.version).toBe(1);
		});
	}

	it("resolves the open episode once a refresh succeeds again", async () => {
		const test = harness();
		seedFromMock(test, "oa", 12 * HOUR);
		test.mock.failNext(MOCK_OAUTH_PATHS.oaAccessToken, {
			kind: "error",
			error: OA_TOKEN_ERRORS.accessTokenExpired,
		});
		await refreshToken(test.dependencies, test.target("oa"));
		expect(
			(await refreshToken(test.dependencies, test.target("oa"))).outcome,
		).toBe("refreshed");
		expect(test.store.openAlerts()).toEqual([]);
		expect(test.store.resolved).toEqual([`${BRAND}:oa`]);
	});

	it("raises zalo_token_failed when the App secret is missing, before any call", async () => {
		const test = harness();
		seedFromMock(test, "oa", 12 * HOUR);
		test.secrets.clear();
		expect(await refreshToken(test.dependencies, test.target("oa"))).toEqual({
			outcome: "not_configured",
			alert: "opened",
		});
		expect(test.mock.requests()).toHaveLength(0);
	});

	it("does not retry after a lost answer and reads the row again instead", async () => {
		const test = harness({ timeoutMs: 20 });
		const spent = seedFromMock(test, "oa", 12 * HOUR);
		test.mock.failNext(MOCK_OAUTH_PATHS.oaAccessToken, { kind: "lost" });
		expect(await refreshToken(test.dependencies, test.target("oa"))).toEqual({
			outcome: "uncertain",
			failure: "timeout",
			alert: null,
		});
		expect(test.mock.requests(MOCK_OAUTH_PATHS.oaAccessToken)).toHaveLength(1);
		expect(test.mock.refreshTokenState(spent)).toBe("spent");
		expect(test.store.token(BRAND, "oa")?.version).toBe(1);
	});

	it("raises the alert after a lost answer once the access token is close to expiry", async () => {
		const test = harness({ timeoutMs: 20 });
		seedFromMock(
			test,
			"oa",
			20 * HOUR,
			UNANSWERED_ALERT_MARGIN_SECONDS * 1000 - 1,
		);
		test.mock.failNext(MOCK_OAUTH_PATHS.oaAccessToken, { kind: "hang" });
		expect(await refreshToken(test.dependencies, test.target("oa"))).toEqual({
			outcome: "uncertain",
			failure: "timeout",
			alert: "opened",
		});
		expect(test.store.alerts[0]?.failure).toEqual({
			reason: "unanswered",
			errorCode: null,
		});
	});

	it("counts a pair whose commit answer was lost as refreshed when the row shows it", async () => {
		const test = harness();
		seedFromMock(test, "oa", 12 * HOUR);
		test.store.failNextWrite("after");
		expect(await refreshToken(test.dependencies, test.target("oa"))).toEqual({
			outcome: "refreshed",
			version: 2,
			ageSeconds: 0,
		});
	});

	it("raises the alert when the new pair could not be written", async () => {
		const test = harness();
		seedFromMock(test, "oa", 12 * HOUR);
		test.store.failNextWrite("before");
		expect(await refreshToken(test.dependencies, test.target("oa"))).toEqual({
			outcome: "uncertain",
			failure: "database",
			alert: "opened",
		});
		expect(test.store.token(BRAND, "oa")?.version).toBe(1);
	});

	it("reports a brand without a stored pair as missing", async () => {
		const test = harness();
		expect(await refreshToken(test.dependencies, test.target("oa"))).toEqual({
			outcome: "missing",
		});
	});
});

describe("the developer token rotation", () => {
	it("rotates a pair older than 20 hours", async () => {
		const test = harness();
		const spent = seedFromMock(test, "developer", 21 * HOUR, HOUR);
		expect(
			await refreshToken(test.dependencies, test.target("developer")),
		).toMatchObject({ outcome: "refreshed", version: 2 });
		expect(test.mock.refreshTokenState(spent)).toBe("spent");
		expect(test.mock.oauthCounts().developerRefreshes).toBe(1);
		expect(test.store.token(BRAND, "developer")?.accessExpiresAt).toEqual(
			new Date(NOW.getTime() + HOUR),
		);
	});

	it("rotates on demand with a refresh age of zero", async () => {
		const test = harness();
		seedFromMock(test, "developer", 60_000, HOUR);
		expect(
			(
				await refreshToken(test.dependencies, test.target("developer"), {
					refreshAfterSeconds: 0,
				})
			).outcome,
		).toBe("refreshed");
	});

	it("raises zalo_token_failed for any failed rotation", async () => {
		const test = harness({ timeoutMs: 20 });
		seedFromMock(test, "developer", 21 * HOUR, HOUR);
		test.mock.failNext(MOCK_OAUTH_PATHS.developerToken, { kind: "hang" });
		expect(
			await refreshToken(test.dependencies, test.target("developer")),
		).toEqual({ outcome: "uncertain", failure: "timeout", alert: "opened" });
		test.mock.failNext(MOCK_OAUTH_PATHS.developerToken, {
			kind: "error",
			error: -9999,
		});
		expect(
			await refreshToken(test.dependencies, test.target("developer")),
		).toEqual({ outcome: "refused", errorCode: -9999, alert: "repeated" });
		expect(test.store.openAlerts()).toEqual([`${BRAND}:developer`]);
	});
});

describe("the OA authorisation", () => {
	async function authorise(test: Harness): Promise<URL> {
		const link = await beginOaAuthorization(
			{
				store: test.store,
				oauthBaseUrl: "http://127.0.0.1:9",
				clock: () => NOW,
			},
			test.target("oa"),
			REDIRECT,
		);
		expect(link.expiresAt).toEqual(new Date(NOW.getTime() + 600_000));
		const response = await test.mock.handle(new Request(link.url));
		return new URL(response.headers.get("location") ?? "");
	}

	function callbackOf(url: URL) {
		return {
			state: url.searchParams.get("state"),
			code: url.searchParams.get("code"),
			oaId: url.searchParams.get("oa_id"),
		};
	}

	it("keeps the verifier behind the state hash and sends only the challenge", async () => {
		const test = harness();
		const link = await beginOaAuthorization(
			{
				store: test.store,
				oauthBaseUrl: "http://127.0.0.1:9",
				clock: () => NOW,
			},
			test.target("oa"),
			REDIRECT,
		);
		const url = new URL(link.url);
		const state = url.searchParams.get("state") ?? "";
		const pending = test.store.pending.get(await stateKey(state));
		expect(pending?.brandId).toBe(BRAND);
		expect(url.searchParams.get("code_challenge")).toBe(
			await codeChallengeS256(pending?.codeVerifier ?? ""),
		);
		expect(link.url).not.toContain(pending?.codeVerifier ?? "-");
	});

	it("stores the pair once the callback brings the right state and code", async () => {
		const test = harness();
		const redirect = await authorise(test);
		expect(
			await completeOaAuthorization(test.dependencies, callbackOf(redirect)),
		).toEqual({ outcome: "authorized", brandKey: "brand-1", version: 1 });
		const stored = test.store.token(BRAND, "oa");
		expect(test.mock.accessTokenLive(stored?.accessToken ?? "")).toBe(true);
		expect(test.store.pending.size).toBe(0);
	});

	it("refuses a wrong state, a replayed state and an expired one", async () => {
		const test = harness();
		const redirect = await authorise(test);
		const input = callbackOf(redirect);
		expect(
			await completeOaAuthorization(test.dependencies, {
				...input,
				state: "x".repeat(32),
			}),
		).toEqual({ outcome: "invalid_state" });
		expect(
			await completeOaAuthorization(test.dependencies, {
				...input,
				state: "short",
			}),
		).toEqual({ outcome: "invalid_state" });
		expect(
			(await completeOaAuthorization(test.dependencies, input)).outcome,
		).toBe("authorized");
		expect(await completeOaAuthorization(test.dependencies, input)).toEqual({
			outcome: "invalid_state",
		});
		const late = callbackOf(await authorise(test));
		expect(
			await completeOaAuthorization(
				{
					...test.dependencies,
					clock: () => new Date(NOW.getTime() + 600_000),
				},
				late,
			),
		).toEqual({ outcome: "expired_state" });
	});

	it("refuses a callback for another OA, without a code or without the App secret", async () => {
		const test = harness();
		expect(
			await completeOaAuthorization(test.dependencies, {
				...callbackOf(await authorise(test)),
				oaId: "synthetic-other-oa",
			}),
		).toEqual({ outcome: "wrong_oa" });
		expect(
			await completeOaAuthorization(test.dependencies, {
				...callbackOf(await authorise(test)),
				code: null,
			}),
		).toEqual({ outcome: "invalid_code" });
		test.secrets.clear();
		expect(
			await completeOaAuthorization(
				test.dependencies,
				callbackOf(await authorise(test)),
			),
		).toEqual({ outcome: "not_configured" });
		expect(test.store.token(BRAND, "oa")).toBeUndefined();
	});

	it("reports Zalo's refusal of the code", async () => {
		const test = harness();
		const input = callbackOf(await authorise(test));
		test.mock.failNext(MOCK_OAUTH_PATHS.oaAccessToken, {
			kind: "error",
			error: -14_019,
		});
		expect(await completeOaAuthorization(test.dependencies, input)).toEqual({
			outcome: "refused",
			errorCode: -14_019,
		});
	});
});
