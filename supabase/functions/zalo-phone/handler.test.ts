import {
	createFakeBackend,
	createMockZalo,
	type FakeBackend,
	MOCK_PHONE_TOKEN_LIFETIME_MS,
	type MockZalo,
} from "@fnb/zalo/testing";
import type { FunctionEnvironment } from "../_shared/http.ts";
import { handleZaloPhone } from "./handler.ts";

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

const APP_SECRET = "synthetic-app-secret-brand-1";
const TENANT = "11111111-1111-4111-8111-111111111111";
const APP = "33333333-3333-4333-8333-333333333333";
const MEMBER = "44444444-4444-4444-8444-444444444444";
const MEMBER_EMAIL = "zalo-phone-member@example.com";
const ZALO_USER = "8800000000000000001";
const NUMBER = "84912345678";
const ENVIRONMENT: FunctionEnvironment = {
	ZALO_APP_SECRET_BRAND_1: APP_SECRET,
};
const FUNCTION_URL = "http://127.0.0.1:54321/functions/v1/zalo-phone";

interface Harness {
	readonly zalo: MockZalo;
	readonly backend: FakeBackend;
	readonly lines: string[];
	readonly accessToken: string;
	readonly session: string;
	send(
		body: unknown,
		options?: {
			readonly session?: string | null;
			readonly environment?: FunctionEnvironment;
		},
	): Promise<Response>;
}

async function harness(): Promise<Harness> {
	const zalo = createMockZalo();
	const backend = createFakeBackend();
	backend.addApp({
		brandKey: "brand-1",
		tenantId: TENANT,
		tenantSlug: "synthetic-tenant",
		zaloAppId: APP,
		secretName: "ZALO_APP_SECRET_BRAND_1",
		status: "active",
	});
	backend.addMember({
		userId: MEMBER,
		tenantId: TENANT,
		role: "owner",
		storeIds: null,
		stores: ["Cửa hàng Mẫu 1"],
		email: MEMBER_EMAIL,
	});
	const minted = await backend.mintSession(MEMBER_EMAIL);
	const lines: string[] = [];
	const accessToken = zalo.issueAccessToken(APP_SECRET, { id: ZALO_USER });
	return {
		zalo,
		backend,
		lines,
		accessToken,
		session: minted.accessToken,
		send(body, options = {}) {
			const session =
				options.session === undefined ? minted.accessToken : options.session;
			return handleZaloPhone(
				new Request(FUNCTION_URL, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						...(session === null ? {} : { authorization: `Bearer ${session}` }),
					},
					body: JSON.stringify(body),
				}),
				options.environment ?? ENVIRONMENT,
				{
					fetch: zalo.fetch,
					backend,
					log: (line) => lines.push(line),
					requestId: () => "request-1",
				},
			);
		},
	};
}

function assertNoPersonalData(
	lines: readonly string[],
	values: readonly string[],
): void {
	for (const line of lines) {
		for (const value of values) {
			assert(
				!line.includes(value),
				`a log line names a protected value: ${line}`,
			);
		}
	}
}

Deno.test("a phone token inside its life returns the number once in international form", async () => {
	const test = await harness();
	const phoneToken = test.zalo.issuePhoneToken(test.accessToken, NUMBER);
	test.zalo.advance(MOCK_PHONE_TOKEN_LIFETIME_MS - 1);
	const response = await test.send({
		brand: "brand-1",
		access_token: test.accessToken,
		phone_token: phoneToken,
	});
	assertEquals(response.status, 200, "status");
	assertEquals(
		await response.json(),
		{ phone_number: `+84${NUMBER.slice(2)}` },
		"answer",
	);
	assertEquals(
		test.zalo.requests("/v2.0/me/info").length,
		1,
		"decoded exactly once",
	);
	assertEquals(
		test.lines,
		["zalo-phone request-1: phone number decoded"],
		"log",
	);
	assertNoPersonalData(test.lines, [
		NUMBER,
		"912345678",
		phoneToken,
		test.accessToken,
		test.session,
	]);
});

Deno.test("a second use of a phone token is refused as phone_token_used (error 119)", async () => {
	const test = await harness();
	const phoneToken = test.zalo.issuePhoneToken(test.accessToken, NUMBER);
	const body = {
		brand: "brand-1",
		access_token: test.accessToken,
		phone_token: phoneToken,
	};
	assertEquals((await test.send(body)).status, 200, "first use");
	const second = await test.send(body);
	assertEquals(
		[second.status, (await second.json()).error],
		[409, "phone_token_used"],
		"second use",
	);
	assert(
		test.lines.includes(
			"zalo-phone request-1: the Zalo graph refused the phone token (error 119)",
		),
		"the error code is logged",
	);
});

Deno.test("a phone token after its two minutes is refused", async () => {
	const test = await harness();
	const phoneToken = test.zalo.issuePhoneToken(test.accessToken, NUMBER);
	test.zalo.advance(MOCK_PHONE_TOKEN_LIFETIME_MS);
	const response = await test.send({
		brand: "brand-1",
		access_token: test.accessToken,
		phone_token: phoneToken,
	});
	assertEquals(
		[response.status, (await response.json()).error],
		[422, "phone_token_refused"],
		"expired",
	);
	assertEquals(test.zalo.requests("/v2.0/me/info").length, 1, "no retry");
});

Deno.test("a lost answer is not retried, because the token may be spent", async () => {
	const test = await harness();
	const phoneToken = test.zalo.issuePhoneToken(test.accessToken, NUMBER);
	test.zalo.failNext("/v2.0/me/info", { kind: "status", status: 500 });
	const response = await test.send({
		brand: "brand-1",
		access_token: test.accessToken,
		phone_token: phoneToken,
	});
	assertEquals(
		[response.status, (await response.json()).error],
		[502, "zalo_unavailable"],
		"unavailable",
	);
	assertEquals(test.zalo.requests("/v2.0/me/info").length, 1, "one call only");
});

Deno.test("the caller's session is required", async () => {
	const test = await harness();
	const phoneToken = test.zalo.issuePhoneToken(test.accessToken, NUMBER);
	const body = {
		brand: "brand-1",
		access_token: test.accessToken,
		phone_token: phoneToken,
	};
	for (const session of [null, "not-a-session"]) {
		const response = await test.send(body, { session });
		assertEquals(
			[response.status, (await response.json()).error],
			[401, "session_required"],
			`session ${session}`,
		);
	}
	assertEquals(test.zalo.requests(), [], "Zalo was not called");
});

Deno.test("probe mode records consent and the exchange with the error code, never the number", async () => {
	const test = await harness();
	const phoneToken = test.zalo.issuePhoneToken(test.accessToken, NUMBER);
	const granted = await test.send({
		brand: "brand-1",
		access_token: test.accessToken,
		phone_token: phoneToken,
		mode: "probe",
	});
	const grantedText = await granted.text();
	assertEquals(
		JSON.parse(grantedText),
		{ probe: { consent: true, exchange: "ok", error_code: null } },
		"granted",
	);
	assert(!grantedText.includes("912345678"), "the answer holds no number");
	const reused = await test.send({
		brand: "brand-1",
		access_token: test.accessToken,
		phone_token: phoneToken,
		mode: "probe",
	});
	assertEquals(
		await reused.json(),
		{ probe: { consent: true, exchange: "refused", error_code: 119 } },
		"reused",
	);
	const refused = await test.send({
		brand: "brand-1",
		access_token: test.accessToken,
		mode: "probe",
		consent_error_code: -1403,
	});
	assertEquals(
		await refused.json(),
		{ probe: { consent: false, exchange: "skipped", error_code: -1403 } },
		"no consent",
	);
	assertEquals(
		test.lines,
		[
			"zalo-phone request-1: probe: consent yes, exchange ok, error none",
			"zalo-phone request-1: probe: consent yes, exchange refused, error 119",
			"zalo-phone request-1: probe: consent no, exchange skipped, error -1403",
		],
		"log",
	);
	assertNoPersonalData(test.lines, [NUMBER, "912345678", phoneToken]);
});

Deno.test("phone requests are refused for an unknown brand, a missing secret or a malformed body", async () => {
	const test = await harness();
	const unknown = await test.send({
		brand: "brand-9",
		access_token: test.accessToken,
		phone_token: "synthetic-phone-token",
	});
	assertEquals(
		[unknown.status, (await unknown.json()).error],
		[404, "unknown_brand"],
		"unknown brand",
	);
	const unconfigured = await test.send(
		{
			brand: "brand-1",
			access_token: test.accessToken,
			phone_token: "synthetic-phone-token",
		},
		{ environment: {} },
	);
	assertEquals(
		[unconfigured.status, (await unconfigured.json()).error],
		[500, "not_configured"],
		"missing secret",
	);
	const cases: [unknown, string][] = [
		[
			{ brand: "brand-1", access_token: test.accessToken },
			"invalid_phone_token",
		],
		[{ brand: "brand-1", phone_token: "x" }, "invalid_access_token"],
		[
			{
				brand: "brand-1",
				access_token: test.accessToken,
				phone_token: "x",
				mode: "other",
			},
			"invalid_mode",
		],
		[
			{
				brand: "brand-1",
				access_token: test.accessToken,
				phone_token: "x",
				consent_error_code: 5,
			},
			"invalid_consent_error_code",
		],
		[
			{ brand: 1, access_token: test.accessToken, phone_token: "x" },
			"invalid_brand",
		],
	];
	for (const [body, code] of cases) {
		const response = await test.send(body);
		assertEquals(
			[response.status, (await response.json()).error],
			[400, code],
			code,
		);
	}
	assertEquals(test.zalo.requests(), [], "Zalo was not called");
});

const LOCAL_STACK: FunctionEnvironment = {
	...ENVIRONMENT,
	ZALO_LOCAL_DEV: "1",
	ZALO_TENANT_ID: TENANT,
	ZALO_GRAPH_BASE_URL: "http://127.0.0.1:8788",
	SUPABASE_URL: "http://127.0.0.1:54321",
	SUPABASE_DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
};

Deno.test("in the local loop ZALO_LOCAL_DEV=1 decodes the standing mock phone token against the loopback graph, every time", async () => {
	const test = await harness();
	const phoneToken = test.zalo.issuePhoneToken(test.accessToken, NUMBER, {
		token: "mock-phone-token",
		reusable: true,
	});
	const urls: string[] = [];
	for (let attempt = 0; attempt < 2; attempt += 1) {
		const response = await handleZaloPhone(
			new Request(FUNCTION_URL, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${test.session}`,
				},
				body: JSON.stringify({
					brand: "brand-1",
					access_token: test.accessToken,
					phone_token: phoneToken,
				}),
			}),
			LOCAL_STACK,
			{
				fetch: (url, init) => {
					urls.push(url);
					return test.zalo.fetch(url, init);
				},
				backend: test.backend,
				log: (line) => test.lines.push(line),
				requestId: () => "request-1",
			},
		);
		assertEquals(response.status, 200, `status ${attempt}`);
		assertEquals(
			await response.json(),
			{ phone_number: `+${NUMBER}` },
			`answer ${attempt}`,
		);
	}
	assertEquals(
		urls,
		[
			"http://127.0.0.1:8788/v2.0/me/info",
			"http://127.0.0.1:8788/v2.0/me/info",
		],
		"the loopback mock graph was asked, never graph.zalo.me",
	);
	assertNoPersonalData(test.lines, [NUMBER, test.accessToken, phoneToken]);
});

Deno.test("a deployed zalo-phone never meets the local switch: it is refused before Zalo is called", async () => {
	for (const overrides of [
		{ SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" },
		{ SUPABASE_URL: "http://kong:8000" },
		{ SUPABASE_DB_URL: "postgresql://postgres:postgres@db:5432/postgres" },
		{ ZALO_INTEGRATION: "1" },
	]) {
		const test = await harness();
		const phoneToken = test.zalo.issuePhoneToken(test.accessToken, NUMBER);
		const response = await test.send(
			{
				brand: "brand-1",
				access_token: test.accessToken,
				phone_token: phoneToken,
			},
			{ environment: { ...LOCAL_STACK, ...overrides } },
		);
		const label = Object.keys(overrides).join(", ");
		assertEquals(
			[response.status, (await response.json()).error],
			[500, "not_configured"],
			label,
		);
		assertEquals(test.zalo.requests(), [], `${label}: Zalo was not called`);
	}
});
