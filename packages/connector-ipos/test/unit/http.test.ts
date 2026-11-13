import { describe, expect, it } from "vitest";
import {
	createIposClient,
	IposError,
	IposHttpError,
	IposNetworkError,
	IposSchemaError,
	LOGIN_PATH,
} from "../../src/index.js";
import {
	BRAND_UID,
	COMPANY_UID,
	envelope,
	errorEnvelope,
	makeJwt,
	makeLoginPayload,
	makeStore,
	TEST_APP_ACCESS_TOKEN,
	TEST_EMAIL,
	TEST_PASSWORD,
} from "../fixtures/factories.js";
import {
	createFakeFetch,
	jsonResponse,
	type Responder,
	routeByPath,
	sequence,
} from "../fixtures/fake-fetch.js";

const STORES_PATH = "/api/mdata/v1/stores";
const CUSTOM_APP_ACCESS_TOKEN = "ffffffffffffffffffffffffffffffff";
const scope = { companyUid: COMPANY_UID, brandUid: BRAND_UID };

function clientFor(storesResponder: Responder, attempts = 3) {
	const fake = createFakeFetch(
		routeByPath({
			[LOGIN_PATH]: () => jsonResponse(envelope(makeLoginPayload(makeJwt()))),
			[STORES_PATH]: storesResponder,
		}),
	);
	const client = createIposClient({
		email: TEST_EMAIL,
		password: TEST_PASSWORD,
		appAccessToken: TEST_APP_ACCESS_TOKEN,
		fetch: fake.fetch,
		retry: { attempts, baseDelayMs: 0 },
	});
	return { fake, client };
}

describe("request headers", () => {
	it("sends exactly the headers the CMS sends, with the raw JWT as authorization", async () => {
		const token = makeJwt();
		const fake = createFakeFetch(
			routeByPath({
				[LOGIN_PATH]: () => jsonResponse(envelope(makeLoginPayload(token))),
				[STORES_PATH]: () => jsonResponse(envelope([makeStore(1)])),
			}),
		);
		const client = createIposClient({
			email: TEST_EMAIL,
			password: TEST_PASSWORD,
			appAccessToken: TEST_APP_ACCESS_TOKEN,
			fetch: fake.fetch,
			baseUrl: "https://pos.example.test",
		});

		await client.listStores(scope);

		const [request] = fake.requestsTo(STORES_PATH);
		expect(request?.url.origin).toBe("https://pos.example.test");
		expect(request?.headers.get("authorization")).toBe(token);
		expect(request?.headers.get("authorization")?.startsWith("Bearer")).toBe(
			false,
		);
		expect(request?.headers.get("access_token")).toBe(TEST_APP_ACCESS_TOKEN);
		expect(request?.headers.get("fabi_type")).toBe("pos-cms");
		expect(request?.headers.get("x-client-timezone")).toBe("25200000");
		expect(request?.headers.get("accept-language")).toBe("vi");
		expect(request?.headers.get("accept")).toBe("application/json");
		expect(request?.headers.has("content-type")).toBe(false);
		expect(request?.url.searchParams.get("skip_limit")).toBe("true");
		expect(request?.url.searchParams.get("company_uid")).toBe(COMPANY_UID);
		expect(request?.url.searchParams.get("brand_uid")).toBe(BRAND_UID);
	});

	it("honours custom app token and timezone offset", async () => {
		const fake = createFakeFetch(
			routeByPath({
				[LOGIN_PATH]: () => jsonResponse(envelope(makeLoginPayload())),
				[STORES_PATH]: () => jsonResponse(envelope([makeStore(1)])),
			}),
		);
		const client = createIposClient({
			email: TEST_EMAIL,
			password: TEST_PASSWORD,
			appAccessToken: CUSTOM_APP_ACCESS_TOKEN,
			fetch: fake.fetch,
			clientTimezoneOffsetMs: 0,
		});

		await client.listStores(scope);

		const [loginRequest] = fake.requestsTo(LOGIN_PATH);
		expect(loginRequest?.headers.get("access_token")).toBe(
			CUSTOM_APP_ACCESS_TOKEN,
		);
		expect(loginRequest?.headers.get("x-client-timezone")).toBe("0");
	});
});

describe("application key", () => {
	it.each([
		["missing", undefined],
		["too short", "0123456789abcdef"],
		["not hex", "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"],
	])("rejects a %s appAccessToken at construction", (_label, value) => {
		expect(() =>
			createIposClient({
				email: TEST_EMAIL,
				password: TEST_PASSWORD,
				appAccessToken: value as string,
			}),
		).toThrowError(IposError);
	});
});

describe("retries", () => {
	it("retries a 500 and then succeeds", async () => {
		const { fake, client } = clientFor(
			sequence(
				jsonResponse(errorEnvelope(500, "boom"), 500),
				jsonResponse(envelope([makeStore(1)])),
			),
		);

		const stores = await client.listStores(scope);

		expect(stores).toHaveLength(1);
		expect(fake.requestsTo(STORES_PATH)).toHaveLength(2);
	});

	it("retries a 429 and then succeeds", async () => {
		const { fake, client } = clientFor(
			sequence(
				jsonResponse(errorEnvelope(429, "slow down"), 429),
				jsonResponse(envelope([makeStore(1)])),
			),
		);

		await client.listStores(scope);

		expect(fake.requestsTo(STORES_PATH)).toHaveLength(2);
	});

	it("stops after the configured number of attempts and throws the last failure", async () => {
		const { fake, client } = clientFor(
			() => jsonResponse(errorEnvelope(503, "unavailable", "track-503"), 503),
			3,
		);

		const failure = await client
			.listStores(scope)
			.catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(IposHttpError);
		expect((failure as IposHttpError).status).toBe(503);
		expect((failure as IposHttpError).trackId).toBe("track-503");
		expect(fake.requestsTo(STORES_PATH)).toHaveLength(3);
	});

	it("does not retry a 400 and exposes status, endpoint, track id and server message", async () => {
		const { fake, client } = clientFor(() =>
			jsonResponse(
				errorEnvelope(400, "value is not a valid integer", "track-400"),
				400,
			),
		);

		const failure = await client
			.listStores(scope)
			.catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(IposHttpError);
		const httpError = failure as IposHttpError;
		expect(httpError.status).toBe(400);
		expect(httpError.endpoint).toBe(STORES_PATH);
		expect(httpError.trackId).toBe("track-400");
		expect(httpError.serverMessage).toBe("value is not a valid integer");
		expect(fake.requestsTo(STORES_PATH)).toHaveLength(1);
	});

	it("retries a network failure and wraps it when attempts run out", async () => {
		const { fake, client } = clientFor(() => new TypeError("fetch failed"), 2);

		const failure = await client
			.listStores(scope)
			.catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(IposNetworkError);
		expect(fake.requestsTo(STORES_PATH)).toHaveLength(2);
	});
});

describe("response validation", () => {
	it("throws IposSchemaError with endpoint and issues when a row is malformed", async () => {
		const { client } = clientFor(() =>
			jsonResponse(envelope([{ id: 42, store_name: null }])),
		);

		const failure = await client
			.listStores(scope)
			.catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(IposSchemaError);
		const schemaError = failure as IposSchemaError;
		expect(schemaError.endpoint).toBe(STORES_PATH);
		expect(schemaError.issues.length).toBeGreaterThan(0);
		expect(schemaError.issues.map((issue) => issue.path.join("."))).toContain(
			"data.0.id",
		);
	});

	it("throws IposSchemaError when the body is not JSON", async () => {
		const { client } = clientFor(() => ({
			status: 200,
			text: "<html>maintenance</html>",
		}));

		await expect(client.listStores(scope)).rejects.toBeInstanceOf(
			IposSchemaError,
		);
	});

	it("treats an error envelope inside a 200 response as an HTTP error", async () => {
		const { client } = clientFor(() =>
			jsonResponse(errorEnvelope(1001, "something went wrong")),
		);

		const failure = await client
			.listStores(scope)
			.catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(IposHttpError);
		expect((failure as IposHttpError).serverMessage).toBe(
			"something went wrong",
		);
	});

	it("keeps unknown extra fields on validated rows", async () => {
		const { client } = clientFor(() =>
			jsonResponse(envelope([{ ...makeStore(1), extra_field: "kept" }])),
		);

		const [store] = await client.listStores(scope);

		expect(store?.extra_field).toBe("kept");
	});
});

describe("abort signals", () => {
	it("rejects immediately when the signal is already aborted", async () => {
		const { fake, client } = clientFor(() =>
			jsonResponse(envelope([makeStore(1)])),
		);
		const controller = new AbortController();
		controller.abort();

		await expect(
			client.listStores({ ...scope, signal: controller.signal }),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(fake.requestsTo(STORES_PATH)).toHaveLength(0);
	});

	it("interrupts the retry backoff sleep when the signal aborts", async () => {
		const controller = new AbortController();
		const fake = createFakeFetch(
			routeByPath({
				[LOGIN_PATH]: () => jsonResponse(envelope(makeLoginPayload(makeJwt()))),
				[STORES_PATH]: () => {
					setTimeout(() => controller.abort(), 5);
					return jsonResponse(errorEnvelope(500, "boom"), 500);
				},
			}),
		);
		const client = createIposClient({
			email: TEST_EMAIL,
			password: TEST_PASSWORD,
			appAccessToken: TEST_APP_ACCESS_TOKEN,
			fetch: fake.fetch,
			retry: { attempts: 3, baseDelayMs: 60_000 },
		});
		const startedAt = Date.now();

		await expect(
			client.listStores({ ...scope, signal: controller.signal }),
		).rejects.toMatchObject({ name: "AbortError" });

		expect(Date.now() - startedAt).toBeLessThan(5_000);
		expect(fake.requestsTo(STORES_PATH)).toHaveLength(1);
	});
});

describe("request timeout", () => {
	function hangingStores(answerAfterMs: number | null) {
		let storeRequests = 0;
		const answer = jsonResponse(envelope([makeStore(1)]));
		const fetch = async (
			input: string | URL | Request,
			init?: RequestInit,
		): Promise<Response> => {
			const url = new URL(
				typeof input === "string"
					? input
					: input instanceof URL
						? input.href
						: input.url,
			);
			if (url.pathname === LOGIN_PATH) {
				return new Response(
					JSON.stringify(envelope(makeLoginPayload(makeJwt()))),
					{ status: 200 },
				);
			}
			storeRequests += 1;
			const signal = init?.signal;
			return new Promise<Response>((resolve, reject) => {
				signal?.addEventListener("abort", () => reject(signal.reason), {
					once: true,
				});
				if (answerAfterMs !== null && storeRequests > 1) {
					setTimeout(
						() => resolve(new Response(JSON.stringify(answer.json))),
						answerAfterMs,
					);
				}
			});
		};
		return { fetch, storeRequests: () => storeRequests };
	}

	it("gives up an attempt that gets no answer within the timeout and retries it", async () => {
		const fake = hangingStores(1);
		const client = createIposClient({
			email: TEST_EMAIL,
			password: TEST_PASSWORD,
			appAccessToken: TEST_APP_ACCESS_TOKEN,
			fetch: fake.fetch,
			retry: { attempts: 3, baseDelayMs: 0 },
			requestTimeoutMs: 20,
		});

		const stores = await client.listStores(scope);

		expect(stores).toHaveLength(1);
		expect(fake.storeRequests()).toBe(2);
	});

	it("fails as unreachable when every attempt times out", async () => {
		const fake = hangingStores(null);
		const client = createIposClient({
			email: TEST_EMAIL,
			password: TEST_PASSWORD,
			appAccessToken: TEST_APP_ACCESS_TOKEN,
			fetch: fake.fetch,
			retry: { attempts: 2, baseDelayMs: 0 },
			requestTimeoutMs: 20,
		});

		const failure = await client
			.listStores(scope)
			.catch((error: unknown) => error);

		expect(failure).toBeInstanceOf(IposNetworkError);
		expect((failure as IposNetworkError).message).toContain(
			"no answer within 20 ms",
		);
		expect(fake.storeRequests()).toBe(2);
	});

	it("stops at once when the caller's own deadline aborts the attempt", async () => {
		const fake = hangingStores(null);
		const client = createIposClient({
			email: TEST_EMAIL,
			password: TEST_PASSWORD,
			appAccessToken: TEST_APP_ACCESS_TOKEN,
			fetch: fake.fetch,
			retry: { attempts: 3, baseDelayMs: 0 },
			requestTimeoutMs: 60_000,
		});
		const deadline = new AbortController();
		const reason = new Error("the run reached its budget");
		setTimeout(() => deadline.abort(reason), 10);

		const failure = await client
			.listStores({ ...scope, signal: deadline.signal })
			.catch((error: unknown) => error);

		expect(failure).toBe(reason);
		expect(fake.storeRequests()).toBe(1);
	});

	it("refuses a timeout that is not a positive number", () => {
		expect(() =>
			createIposClient({
				email: TEST_EMAIL,
				password: TEST_PASSWORD,
				appAccessToken: TEST_APP_ACCESS_TOKEN,
				requestTimeoutMs: 0,
			}),
		).toThrow(RangeError);
	});
});
