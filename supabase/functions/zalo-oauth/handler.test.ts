import { createMockZalo, MOCK_OAUTH_PATHS } from "@fnb/zalo/testing";
import {
	beginOaAuthorization,
	OA_TOKEN_ERRORS,
	type TokenKind,
} from "@fnb/zalo/tokens";
import {
	createFakeTokenStore,
	type FakeTokenStore,
} from "@fnb/zalo/tokens/testing";
import { type FunctionEnvironment, serveFunction } from "../_shared/http.ts";
import {
	createZaloOauthHandler,
	FUNCTION_NAME,
	type TicketClaim,
} from "./handler.ts";

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

function assertEquals(actual: unknown, expected: unknown, label: string): void {
	const left = JSON.stringify(actual);
	const right = JSON.stringify(expected);
	assert(left === right, `${label}: expected ${right}, got ${left}`);
}

const FUNCTION_URL = "http://127.0.0.1:54321/functions/v1/zalo-oauth";
const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "33333333-3333-4333-8333-333333333333";
const BRAND = "22222222-2222-4222-8222-222222222222";
const APP_ID = "synthetic-app-oauth-fn";
const OA_ID = "synthetic-oa-oauth-fn";
const SECRET_NAME = "ZALO_APP_SECRET_BRAND_1";
const SECRET = "synthetic-app-secret-oauth-fn";
const NOW = new Date("2026-11-18T03:00:00.000Z");
const HOUR = 3_600_000;
const TICKET = "44444444-4444-4444-8444-444444444444";

interface Harness {
	readonly store: FakeTokenStore;
	readonly mock: ReturnType<typeof createMockZalo>;
	readonly tickets: Map<string, TicketClaim>;
	readonly logs: string[];
	clock: Date;
	call(
		request: Request,
		environment?: FunctionEnvironment,
	): Promise<{
		status: number;
		body: Record<string, unknown>;
		headers: Headers;
	}>;
}

function harness(slug = "zalo-it-oauth-fn"): Harness {
	const store = createFakeTokenStore();
	store.addBrand({
		tenantId: TENANT,
		tenantSlug: slug,
		brandId: BRAND,
		brandKey: "brand-1",
		appId: APP_ID,
		appSecretName: SECRET_NAME,
		oaId: OA_ID,
	});
	const mock = createMockZalo({ startAt: NOW.getTime() });
	mock.registerApp({ appId: APP_ID, appSecret: SECRET, oaId: OA_ID });
	const tickets = new Map<string, TicketClaim>();
	const logs: string[] = [];
	const test: Harness = {
		store,
		mock,
		tickets,
		logs,
		clock: NOW,
		async call(request, environment = { [SECRET_NAME]: SECRET }) {
			const handler = createZaloOauthHandler({
				database: () => ({
					tokens: store,
					claimTicket: (ticket) => {
						const claim = tickets.get(ticket) ?? { outcome: "unknown" };
						tickets.delete(ticket);
						return Promise.resolve(claim);
					},
				}),
				fetch: mock.fetch,
				clock: () => test.clock,
			});
			const response = await serveFunction(request, environment, handler, {
				name: FUNCTION_NAME,
				origins: [],
				log: (line) => logs.push(line),
				requestId: () => "request-1",
			});
			const text = await response.text();
			return {
				status: response.status,
				body: text === "" ? {} : JSON.parse(text),
				headers: response.headers,
			};
		},
	};
	return test;
}

function claimFor(
	kind: TokenKind,
	tenantSlug = "zalo-it-oauth-fn",
): TicketClaim {
	return {
		outcome: "claimed",
		source: "schedule",
		target: {
			tenantId: TENANT,
			tenantSlug,
			brandId: BRAND,
			brandKey: "brand-1",
			kind,
			appId: APP_ID,
			appSecretName: SECRET_NAME,
			hasToken: true,
		},
	};
}

function seed(test: Harness, kind: TokenKind, ageMs: number): string {
	const pair = test.mock.issueTokens(APP_ID, kind);
	test.store.seed(BRAND, kind, {
		accessToken: pair.accessToken,
		refreshToken: pair.refreshToken,
		refreshedAt: new Date(NOW.getTime() - ageMs),
		accessExpiresAt: new Date(NOW.getTime() + 13 * HOUR),
	});
	return pair.refreshToken;
}

async function callbackUrl(test: Harness): Promise<string> {
	const link = await beginOaAuthorization(
		{ store: test.store, oauthBaseUrl: "http://127.0.0.1:9", clock: () => NOW },
		{
			tenantId: TENANT,
			tenantSlug: "zalo-it-oauth-fn",
			brandId: BRAND,
			brandKey: "brand-1",
			kind: "oa",
			appId: APP_ID,
			appSecretName: SECRET_NAME,
			hasToken: false,
		},
		FUNCTION_URL,
	);
	const response = await test.mock.handle(new Request(link.url));
	return response.headers.get("location") ?? "";
}

function ticketRequest(ticket: unknown): Request {
	return new Request(FUNCTION_URL, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ ticket }),
	});
}

function assertNoSecretsLogged(test: Harness, values: readonly string[]): void {
	for (const line of test.logs) {
		for (const value of values) {
			assert(!line.includes(value), `a log line carries a secret: ${line}`);
		}
	}
}

Deno.test("the callback stores the OA pair for the right state and code", async () => {
	const test = harness();
	const location = await callbackUrl(test);
	const url = new URL(location);
	const result = await test.call(new Request(location));
	assertEquals(result.status, 200, "status");
	assertEquals(result.body, { ok: true, brand: "brand-1" }, "body");
	assertEquals(
		result.headers.get("referrer-policy"),
		"no-referrer",
		"referrer",
	);
	assertEquals(
		result.headers.get("access-control-allow-origin"),
		null,
		"no CORS",
	);
	const stored = test.store.token(BRAND, "oa");
	assert(stored !== undefined, "the pair is stored");
	assert(test.mock.accessTokenLive(stored.accessToken), "a live access token");
	assertEquals(
		test.logs,
		[`${FUNCTION_NAME} request-1: callback outcome authorized`],
		"logs",
	);
	assertNoSecretsLogged(test, [
		SECRET,
		stored.accessToken,
		stored.refreshToken,
		url.searchParams.get("code") ?? "-",
		url.searchParams.get("state") ?? "-",
	]);
});

Deno.test("the callback refuses a wrong, a replayed and an expired state", async () => {
	const test = harness();
	const location = await callbackUrl(test);
	const wrong = new URL(location);
	wrong.searchParams.set("state", "w".repeat(32));
	const refused = await test.call(new Request(wrong));
	assertEquals(refused.status, 400, "wrong state");
	assertEquals(
		refused.body,
		{ error: "invalid_state", request_id: "request-1" },
		"wrong body",
	);
	assertEquals(
		(await test.call(new Request(location))).status,
		200,
		"the right state",
	);
	assertEquals(
		(await test.call(new Request(location))).body.error,
		"invalid_state",
		"replayed",
	);
	const late = await callbackUrl(test);
	test.clock = new Date(NOW.getTime() + 600_000);
	const expired = await test.call(new Request(late));
	assertEquals(
		[expired.status, expired.body.error],
		[400, "expired_state"],
		"expired",
	);
	assertEquals(test.store.pending.size, 0, "every claimed row is gone");
});

Deno.test("the callback refuses another OA, a repeated parameter and a declined grant", async () => {
	const test = harness();
	const other = new URL(await callbackUrl(test));
	other.searchParams.set("oa_id", "synthetic-other-oa");
	assertEquals(
		(await test.call(new Request(other))).body.error,
		"wrong_oa",
		"another OA",
	);
	const doubled = new URL(await callbackUrl(test));
	doubled.searchParams.append("state", "d".repeat(32));
	const twice = await test.call(new Request(doubled));
	assertEquals(
		[twice.status, twice.body.error],
		[400, "invalid_callback"],
		"repeated state",
	);
	const declined = await test.call(
		new Request(`${FUNCTION_URL}?error=access_denied&state=${"x".repeat(32)}`),
	);
	assertEquals(
		[declined.status, declined.body.error],
		[400, "declined"],
		"declined",
	);
	assertEquals(test.store.token(BRAND, "oa"), undefined, "nothing stored");
});

Deno.test("the callback answers Zalo's refusal and a missing App secret", async () => {
	const test = harness();
	const location = await callbackUrl(test);
	test.mock.failNext(MOCK_OAUTH_PATHS.oaAccessToken, {
		kind: "error",
		error: -14_019,
	});
	const refused = await test.call(new Request(location));
	assertEquals(
		[refused.status, refused.body.error, refused.body.zalo_error],
		[502, "refused", -14_019],
		"refused",
	);
	const missing = await test.call(new Request(await callbackUrl(test)), {});
	assertEquals(
		[missing.status, missing.body.error],
		[500, "not_configured"],
		"no secret",
	);
	assert(
		test.logs.some((line) =>
			line.includes(`the function secret ${SECRET_NAME} is not set`),
		),
		"the log names the missing secret",
	);
});

Deno.test("a ticket refreshes a due OA pair and leaves a fresh one", async () => {
	const test = harness();
	const spent = seed(test, "oa", 12 * HOUR);
	test.tickets.set(TICKET, claimFor("oa"));
	const refreshed = await test.call(ticketRequest(TICKET));
	assertEquals(refreshed.status, 200, "status");
	assertEquals(
		refreshed.body,
		{ outcome: "refreshed", version: 2 },
		"refreshed",
	);
	assertEquals(test.mock.refreshTokenState(spent), "spent", "spent");
	test.tickets.set(TICKET, claimFor("oa"));
	const fresh = await test.call(ticketRequest(TICKET));
	assertEquals(
		fresh.body,
		{ outcome: "fresh", version: 2, age_seconds: 0 },
		"fresh",
	);
	assertEquals(test.mock.oauthCounts().refreshes, 1, "one refresh");
	assertNoSecretsLogged(test, [
		SECRET,
		spent,
		test.store.token(BRAND, "oa")?.refreshToken ?? "-",
	]);
});

Deno.test("a ticket refused with -216 raises zalo_token_failed from the scheduler", async () => {
	const test = harness();
	seed(test, "oa", 12 * HOUR);
	test.mock.failNext(MOCK_OAUTH_PATHS.oaAccessToken, {
		kind: "error",
		error: OA_TOKEN_ERRORS.accessTokenInvalid,
	});
	test.tickets.set(TICKET, claimFor("oa"));
	const refused = await test.call(ticketRequest(TICKET));
	assertEquals(refused.status, 502, "status");
	assertEquals(
		refused.body,
		{ outcome: "refused", zalo_error: -216, alert: "opened" },
		"body",
	);
	assertEquals(
		test.store.alerts.map((alert) => alert.source),
		["scheduler"],
		"source",
	);
});

Deno.test("a ticket rotates a due developer pair", async () => {
	const test = harness();
	seed(test, "developer", 21 * HOUR);
	test.tickets.set(TICKET, claimFor("developer"));
	const rotated = await test.call(ticketRequest(TICKET));
	assertEquals(rotated.body, { outcome: "refreshed", version: 2 }, "rotated");
	assertEquals(test.mock.oauthCounts().developerRefreshes, 1, "one rotation");
});

Deno.test("an unknown, used or malformed ticket is refused", async () => {
	const test = harness();
	const unknown = await test.call(ticketRequest(TICKET));
	assertEquals(
		[unknown.status, unknown.body.error],
		[401, "invalid_ticket"],
		"unknown",
	);
	const malformed = await test.call(ticketRequest("not-a-ticket"));
	assertEquals(
		[malformed.status, malformed.body.error],
		[400, "invalid_ticket"],
		"malformed",
	);
	const notJson = await test.call(
		new Request(FUNCTION_URL, { method: "POST", body: "ticket" }),
	);
	assertEquals(notJson.body.error, "invalid_json", "not JSON");
	test.tickets.set(TICKET, { outcome: "gone", kind: "oa" });
	assertEquals(
		(await test.call(ticketRequest(TICKET))).body,
		{ outcome: "missing" },
		"gone",
	);
	const put = await test.call(new Request(FUNCTION_URL, { method: "PUT" }));
	assertEquals(
		[put.status, put.body.error],
		[405, "method_not_allowed"],
		"method",
	);
});

Deno.test("an integration run refreshes only its fixture tenant against a loopback server", async () => {
	const test = harness();
	seed(test, "oa", 12 * HOUR);
	const integration = {
		[SECRET_NAME]: SECRET,
		ZALO_INTEGRATION: "1",
		ZALO_TENANT_ID: OTHER_TENANT,
		ZALO_OAUTH_BASE_URL: "http://127.0.0.1:9",
	};
	test.tickets.set(TICKET, claimFor("oa"));
	const other = await test.call(ticketRequest(TICKET), integration);
	assertEquals(
		[other.status, other.body.error],
		[401, "invalid_ticket"],
		"another tenant",
	);
	test.tickets.set(TICKET, claimFor("oa", "live-tenant"));
	const notFixture = await test.call(ticketRequest(TICKET), {
		...integration,
		ZALO_TENANT_ID: TENANT,
	});
	assertEquals(notFixture.status, 401, "a tenant that is not a fixture");
	const outsideIntegration = await test.call(ticketRequest(TICKET), {
		[SECRET_NAME]: SECRET,
		ZALO_OAUTH_BASE_URL: "http://127.0.0.1:9",
	});
	assertEquals(
		[outsideIntegration.status, outsideIntegration.body.error],
		[500, "not_configured"],
		"an override outside an integration run",
	);
	assertEquals(test.mock.oauthCounts().refreshes, 0, "no refresh");
});

Deno.test("an integration callback refuses a state of another tenant", async () => {
	const test = harness();
	const location = await callbackUrl(test);
	const result = await test.call(new Request(location), {
		[SECRET_NAME]: SECRET,
		ZALO_INTEGRATION: "1",
		ZALO_TENANT_ID: OTHER_TENANT,
	});
	assertEquals(
		[result.status, result.body.error],
		[400, "invalid_state"],
		"another tenant",
	);
	assertEquals(test.store.token(BRAND, "oa"), undefined, "nothing stored");
});

Deno.test("a preflight gets no CORS answer", async () => {
	const test = harness();
	const response = await test.call(
		new Request(FUNCTION_URL, {
			method: "OPTIONS",
			headers: { origin: "https://h5.zdn.vn" },
		}),
	);
	assertEquals(response.status, 204, "status");
	assertEquals(
		response.headers.get("access-control-allow-origin"),
		null,
		"no origin",
	);
});
