import { describe, expect, it } from "vitest";
import {
	createIposClient,
	createMemoryTokenStore,
	decodeJwtPayload,
	IposAuthError,
	IposError,
	IposHttpError,
	isTokenFresh,
	LOGIN_PATH,
	toStoredToken,
} from "../../src/index.js";
import {
	BRAND_UID,
	COMPANY_UID,
	DAY_MS,
	envelope,
	errorEnvelope,
	HOUR_MS,
	makeJwt,
	makeLoginPayload,
	makeStore,
	TEST_APP_ACCESS_TOKEN,
	TEST_EMAIL,
	TEST_PASSWORD,
	USER_UID,
} from "../fixtures/factories.js";
import {
	createFakeFetch,
	jsonResponse,
	routeByPath,
} from "../fixtures/fake-fetch.js";

const STORES_PATH = "/api/mdata/v1/stores";
const scope = { companyUid: COMPANY_UID, brandUid: BRAND_UID };

function clientWith(
	fake: ReturnType<typeof createFakeFetch>,
	extra: Partial<Parameters<typeof createIposClient>[0]> = {},
) {
	return createIposClient({
		email: TEST_EMAIL,
		password: TEST_PASSWORD,
		appAccessToken: TEST_APP_ACCESS_TOKEN,
		fetch: fake.fetch,
		retry: { attempts: 1, baseDelayMs: 0 },
		...extra,
	});
}

describe("JWT handling", () => {
	it("decodes the payload claims", () => {
		const expiresAt = Date.now() + 7 * DAY_MS;
		const claims = decodeJwtPayload(makeJwt({ expiresAt }));
		expect(claims.id).toBe(USER_UID);
		expect(claims.cp).toBe(COMPANY_UID);
		expect(claims.exp).toBe(Math.floor(expiresAt / 1000));
	});

	it("turns a token into a stored token with millisecond expiry", () => {
		const expiresAt = Date.now() + 7 * DAY_MS;
		const stored = toStoredToken(makeJwt({ expiresAt }));
		expect(stored.expiresAt).toBe(Math.floor(expiresAt / 1000) * 1000);
		expect(stored.companyUid).toBe(COMPANY_UID);
		expect(stored.userUid).toBe(USER_UID);
	});

	it("rejects a token that is not a JWT", () => {
		expect(() => decodeJwtPayload("not-a-jwt")).toThrow(IposAuthError);
	});

	it("treats tokens within 12 hours of expiry as stale", () => {
		const now = Date.now();
		expect(
			isTokenFresh(
				{
					token: "t",
					expiresAt: now + 13 * HOUR_MS,
					companyUid: "c",
					userUid: "u",
				},
				now,
			),
		).toBe(true);
		expect(
			isTokenFresh(
				{
					token: "t",
					expiresAt: now + 11 * HOUR_MS,
					companyUid: "c",
					userUid: "u",
				},
				now,
			),
		).toBe(false);
	});
});

describe("login and token caching", () => {
	it("logs in lazily once and reuses the token for later calls", async () => {
		const token = makeJwt();
		const fake = createFakeFetch(
			routeByPath({
				[LOGIN_PATH]: () => jsonResponse(envelope(makeLoginPayload(token))),
				[STORES_PATH]: () => jsonResponse(envelope([makeStore(1)])),
			}),
		);
		const client = clientWith(fake);

		expect(fake.requests).toHaveLength(0);
		const stores = await client.listStores(scope);
		await client.listStores(scope);

		expect(stores).toHaveLength(1);
		expect(fake.requestsTo(LOGIN_PATH)).toHaveLength(1);
		expect(fake.requestsTo(STORES_PATH)).toHaveLength(2);
		for (const request of fake.requestsTo(STORES_PATH)) {
			expect(request.headers.get("authorization")).toBe(token);
		}
	});

	it("sends the login as a JSON POST without an authorization header", async () => {
		const fake = createFakeFetch(
			routeByPath({
				[LOGIN_PATH]: () => jsonResponse(envelope(makeLoginPayload())),
			}),
		);
		const client = clientWith(fake);

		const payload = await client.login();

		const [request] = fake.requestsTo(LOGIN_PATH);
		expect(request?.method).toBe("POST");
		expect(request?.headers.get("content-type")).toBe("application/json");
		expect(request?.headers.has("authorization")).toBe(false);
		expect(request?.body).toEqual({
			email: TEST_EMAIL,
			password: TEST_PASSWORD,
		});
		expect(payload.company.id).toBe(COMPANY_UID);
		expect(payload.stores[0]?.store_name).toBe("Store A");
	});

	it("reuses a fresh token from the token store without logging in", async () => {
		const token = makeJwt();
		const tokenStore = createMemoryTokenStore();
		await tokenStore.set(TEST_EMAIL, toStoredToken(token));
		const fake = createFakeFetch(
			routeByPath({
				[STORES_PATH]: () => jsonResponse(envelope([makeStore(1)])),
			}),
		);
		const client = clientWith(fake, { tokenStore });

		await client.listStores(scope);

		expect(fake.requestsTo(LOGIN_PATH)).toHaveLength(0);
		expect(fake.requestsTo(STORES_PATH)[0]?.headers.get("authorization")).toBe(
			token,
		);
	});

	it("logs in again when the stored token is within 12 hours of expiry", async () => {
		const staleToken = makeJwt({ expiresAt: Date.now() + 6 * HOUR_MS });
		const freshToken = makeJwt();
		const tokenStore = createMemoryTokenStore();
		await tokenStore.set(TEST_EMAIL, toStoredToken(staleToken));
		const fake = createFakeFetch(
			routeByPath({
				[LOGIN_PATH]: () =>
					jsonResponse(envelope(makeLoginPayload(freshToken))),
				[STORES_PATH]: () => jsonResponse(envelope([makeStore(1)])),
			}),
		);
		const client = clientWith(fake, { tokenStore });

		await client.listStores(scope);

		expect(fake.requestsTo(LOGIN_PATH)).toHaveLength(1);
		expect(fake.requestsTo(STORES_PATH)[0]?.headers.get("authorization")).toBe(
			freshToken,
		);
		expect((await tokenStore.get(TEST_EMAIL))?.token).toBe(freshToken);
	});

	it("re-logs-in after a 401 and retries the call once", async () => {
		const firstToken = makeJwt({ issuedAt: Date.now() - HOUR_MS });
		const secondToken = makeJwt();
		let logins = 0;
		const fake = createFakeFetch(
			routeByPath({
				[LOGIN_PATH]: () => {
					logins += 1;
					return jsonResponse(
						envelope(makeLoginPayload(logins === 1 ? firstToken : secondToken)),
					);
				},
				[STORES_PATH]: (request) =>
					request.headers.get("authorization") === firstToken
						? jsonResponse(errorEnvelope(401, "please log in"), 401)
						: jsonResponse(envelope([makeStore(1)])),
			}),
		);
		const client = clientWith(fake);

		const stores = await client.listStores(scope);

		expect(stores).toHaveLength(1);
		expect(fake.requestsTo(LOGIN_PATH)).toHaveLength(2);
		const storeRequests = fake.requestsTo(STORES_PATH);
		expect(storeRequests).toHaveLength(2);
		expect(storeRequests[0]?.headers.get("authorization")).toBe(firstToken);
		expect(storeRequests[1]?.headers.get("authorization")).toBe(secondToken);
	});

	it("gives up after a second 401 instead of looping", async () => {
		const fake = createFakeFetch(
			routeByPath({
				[LOGIN_PATH]: () => jsonResponse(envelope(makeLoginPayload())),
				[STORES_PATH]: () =>
					jsonResponse(errorEnvelope(401, "still rejected"), 401),
			}),
		);
		const client = clientWith(fake);

		await expect(client.listStores(scope)).rejects.toBeInstanceOf(
			IposAuthError,
		);
		expect(fake.requestsTo(LOGIN_PATH)).toHaveLength(2);
		expect(fake.requestsTo(STORES_PATH)).toHaveLength(2);
	});

	it("reports wrong credentials as an IposAuthError carrying the server message", async () => {
		const fake = createFakeFetch(
			routeByPath({
				[LOGIN_PATH]: () =>
					jsonResponse(
						errorEnvelope(401, "wrong password", "track-login"),
						401,
					),
			}),
		);
		const client = clientWith(fake);

		const failure = await client
			.listStores(scope)
			.catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(IposAuthError);
		expect(failure).toBeInstanceOf(IposError);
		const authError = failure as IposAuthError;
		expect(authError.status).toBe(401);
		expect(authError.serverMessage).toBe("wrong password");
		expect(authError.trackId).toBe("track-login");
		expect(authError.endpoint).toBe(LOGIN_PATH);
	});

	it("reports a 403 on login as an IposAuthError", async () => {
		const fake = createFakeFetch(
			routeByPath({
				[LOGIN_PATH]: () =>
					jsonResponse(errorEnvelope(403, "account locked"), 403),
			}),
		);
		const client = clientWith(fake);

		const failure = await client
			.listStores(scope)
			.catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(IposAuthError);
		expect((failure as IposAuthError).status).toBe(403);
	});

	it("keeps a rate-limited login as an IposHttpError instead of a credential failure", async () => {
		const fake = createFakeFetch(
			routeByPath({
				[LOGIN_PATH]: () =>
					jsonResponse(errorEnvelope(429, "slow down", "track-429"), 429),
			}),
		);
		const client = clientWith(fake, { retry: { attempts: 2, baseDelayMs: 0 } });

		const failure = await client
			.listStores(scope)
			.catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(IposHttpError);
		expect(failure).not.toBeInstanceOf(IposAuthError);
		expect((failure as IposHttpError).status).toBe(429);
		expect(fake.requestsTo(LOGIN_PATH)).toHaveLength(2);
	});

	it("lets other concurrent callers finish the shared login when one caller aborts", async () => {
		let releaseLogin: () => void = () => undefined;
		const loginGate = new Promise<void>((resolve) => {
			releaseLogin = resolve;
		});
		const fake = createFakeFetch(
			routeByPath({
				[LOGIN_PATH]: () => jsonResponse(envelope(makeLoginPayload())),
				[STORES_PATH]: () => jsonResponse(envelope([makeStore(1)])),
			}),
		);
		const gatedFetch: typeof fetch = async (input, init) => {
			const url = new URL(
				input instanceof URL
					? input.toString()
					: typeof input === "string"
						? input
						: input.url,
			);
			if (url.pathname === LOGIN_PATH) {
				await loginGate;
			}
			return fake.fetch(input, init);
		};
		const client = clientWith(fake, { fetch: gatedFetch });
		const controller = new AbortController();

		const aborting = client.listStores({ ...scope, signal: controller.signal });
		const patient = client.listStores(scope);
		const abortingOutcome = aborting.catch((error: unknown) => error);
		controller.abort();
		releaseLogin();

		expect(await abortingOutcome).toMatchObject({ name: "AbortError" });
		expect(await patient).toHaveLength(1);
		expect(fake.requestsTo(LOGIN_PATH)).toHaveLength(1);
		expect(fake.requestsTo(STORES_PATH)).toHaveLength(1);
	});

	it("shares one login between concurrent first calls", async () => {
		const fake = createFakeFetch(
			routeByPath({
				[LOGIN_PATH]: () => jsonResponse(envelope(makeLoginPayload())),
				[STORES_PATH]: () => jsonResponse(envelope([makeStore(1)])),
			}),
		);
		const client = clientWith(fake);

		await Promise.all([
			client.listStores(scope),
			client.listStores(scope),
			client.listStores(scope),
		]);

		expect(fake.requestsTo(LOGIN_PATH)).toHaveLength(1);
	});
});
