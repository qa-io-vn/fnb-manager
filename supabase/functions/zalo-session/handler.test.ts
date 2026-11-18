import {
	createFakeBackend,
	createMockZalo,
	type FakeBackend,
	type MockZalo,
} from "@fnb/zalo/testing";
import type { FunctionEnvironment } from "../_shared/http.ts";
import { DEFAULT_DISPLAY_NAME, handleZaloSession } from "./handler.ts";

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
const OTHER_SECRET = "synthetic-app-secret-other";
const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const APP = "33333333-3333-4333-8333-333333333333";
const MANAGER = "44444444-4444-4444-8444-444444444444";
const OWNER = "55555555-5555-4555-8555-555555555555";
const ZALO_USER = "8800000000000000001";
const ZALO_NAME = "Quản lý thử";
const MANAGER_EMAIL = "zalo-session-manager@example.com";
const CODE = "482913";
const ENVIRONMENT: FunctionEnvironment = {
	ZALO_APP_SECRET_BRAND_1: APP_SECRET,
};
const FUNCTION_URL = "http://127.0.0.1:54321/functions/v1/zalo-session";

interface Harness {
	readonly zalo: MockZalo;
	readonly backend: FakeBackend;
	readonly lines: string[];
	readonly token: string;
	send(
		body: unknown,
		options?: {
			readonly environment?: FunctionEnvironment;
			readonly method?: string;
			readonly origin?: string;
		},
	): Promise<Response>;
}

function harness(): Harness {
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
		userId: MANAGER,
		tenantId: TENANT,
		role: "manager",
		storeIds: ["66666666-6666-4666-8666-666666666661"],
		stores: ["Cửa hàng Mẫu 1"],
		email: MANAGER_EMAIL,
	});
	const lines: string[] = [];
	const token = zalo.issueAccessToken(APP_SECRET, {
		id: ZALO_USER,
		name: ZALO_NAME,
	});
	return {
		zalo,
		backend,
		lines,
		token,
		send(body, options = {}) {
			const headers: Record<string, string> = {
				"content-type": "application/json",
				apikey: "sb_publishable_synthetic",
			};
			if (options.origin !== undefined) {
				headers.origin = options.origin;
			}
			const method = options.method ?? "POST";
			return handleZaloSession(
				new Request(FUNCTION_URL, {
					method,
					headers,
					...(method === "POST" ? { body: JSON.stringify(body) } : {}),
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

Deno.test("a bound identity gets a genuine session with the member's role and stores", async () => {
	const test = harness();
	test.backend.bind(APP, ZALO_USER, MANAGER, null);
	const response = await test.send({
		access_token: test.token,
		brand: "brand-1",
	});
	assertEquals(response.status, 200, "status");
	const body = await response.json();
	const [session] = test.backend.minted();
	assert(session !== undefined, "a session was minted");
	assertEquals(
		body,
		{
			status: "bound",
			access_token: session.accessToken,
			refresh_token: session.refreshToken,
			expires_at: session.expiresAt,
			member: {
				display_name: ZALO_NAME,
				role: "manager",
				stores: ["Cửa hàng Mẫu 1"],
				tenant_id: TENANT,
			},
		},
		"answer",
	);
	assertEquals(
		test.backend.calls(),
		[
			"rpc zalo_session_app",
			"rpc zalo_session_sign_in",
			"userEmail",
			"mintSession",
		],
		"backend calls",
	);
	assertEquals(
		test.lines,
		["zalo-session request-1: session minted: manager, 1 stores"],
		"log",
	);
	assertNoPersonalData(test.lines, [
		test.token,
		ZALO_USER,
		ZALO_NAME,
		MANAGER_EMAIL,
		session.accessToken,
		session.refreshToken,
	]);
});

Deno.test("an unbound identity is unpaired and gets no session", async () => {
	const test = harness();
	const response = await test.send({
		access_token: test.token,
		brand: "brand-1",
	});
	assertEquals(response.status, 200, "status");
	assertEquals(await response.json(), { status: "unpaired" }, "answer");
	assertEquals(test.backend.minted(), [], "no session");
	assertEquals(
		test.lines,
		["zalo-session request-1: unpaired: the identity is not bound to a member"],
		"log",
	);
});

Deno.test("a binding code binds the identity once and the next sign-in needs no code", async () => {
	const test = harness();
	test.backend.issueCode(APP, MANAGER, CODE);
	const bound = await test.send({
		access_token: test.token,
		brand: "brand-1",
		binding_code: CODE,
	});
	assertEquals((await bound.json()).status, "bound", "bound with the code");
	assertEquals(
		test.backend.identities().map((identity) => identity.userId),
		[MANAGER],
		"identity",
	);
	const again = await test.send({ access_token: test.token, brand: "brand-1" });
	assertEquals((await again.json()).member.role, "manager", "bound again");
	const stranger = test.zalo.issueAccessToken(APP_SECRET, {
		id: "8800000000000000009",
	});
	const reused = await test.send({
		access_token: stranger,
		brand: "brand-1",
		binding_code: CODE,
	});
	assertEquals(await reused.json(), { status: "unpaired" }, "a spent code");
	assert(
		test.lines.includes(
			"zalo-session request-1: unpaired: the binding code was refused",
		),
		"the refusal is logged without the code",
	);
	assertNoPersonalData(test.lines, [CODE, test.token, stranger]);
});

Deno.test("a member without a Zalo name gets the default display name", async () => {
	const test = harness();
	const nameless = test.zalo.issueAccessToken(APP_SECRET, {
		id: "8800000000000000002",
	});
	test.backend.bind(APP, "8800000000000000002", MANAGER, null);
	const body = await (
		await test.send({ access_token: nameless, brand: "brand-1" })
	).json();
	assertEquals(body.member.display_name, DEFAULT_DISPLAY_NAME, "display name");
});

Deno.test("a wrong app-secret proof and an expired token are refused before any binding", async () => {
	const test = harness();
	test.backend.issueCode(APP, MANAGER, CODE);
	const foreign = test.zalo.issueAccessToken(OTHER_SECRET, { id: ZALO_USER });
	const wrongProof = await test.send({
		access_token: foreign,
		brand: "brand-1",
		binding_code: CODE,
	});
	assertEquals(wrongProof.status, 401, "wrong proof status");
	assertEquals(
		await wrongProof.json(),
		{ error: "zalo_token_refused", request_id: "request-1" },
		"wrong proof answer",
	);
	const short = test.zalo.issueAccessToken(
		APP_SECRET,
		{ id: ZALO_USER },
		{ lifetimeMs: 1000 },
	);
	test.zalo.advance(1000);
	const expired = await test.send({ access_token: short, brand: "brand-1" });
	assertEquals(expired.status, 401, "expired status");
	assertEquals(
		(await expired.json()).error,
		"zalo_token_refused",
		"expired code",
	);
	assertEquals(
		test.backend.calls().filter((call) => call !== "rpc zalo_session_app"),
		[],
		"no sign-in was attempted",
	);
	assertEquals(
		test.lines,
		[
			"zalo-session request-1: the Zalo graph refused the access token (error -9003)",
			"zalo-session request-1: the Zalo graph refused the access token (error -9002)",
		],
		"log",
	);
	assertNoPersonalData(test.lines, [foreign, short, CODE]);
});

Deno.test("an unknown brand, a disabled app and an ambiguous brand key are refused", async () => {
	const test = harness();
	const unknown = await test.send({
		access_token: test.token,
		brand: "brand-7",
	});
	assertEquals(
		[unknown.status, (await unknown.json()).error],
		[404, "unknown_brand"],
		"unknown",
	);
	test.backend.addApp({
		brandKey: "brand-2",
		tenantId: TENANT,
		tenantSlug: "synthetic-tenant",
		zaloAppId: "77777777-7777-4777-8777-777777777777",
		secretName: "ZALO_APP_SECRET_BRAND_2",
		status: "disabled",
	});
	const disabled = await test.send({
		access_token: test.token,
		brand: "brand-2",
	});
	assertEquals(
		[disabled.status, (await disabled.json()).error],
		[403, "app_disabled"],
		"disabled",
	);
	test.backend.addApp({
		brandKey: "brand-1",
		tenantId: OTHER_TENANT,
		tenantSlug: "synthetic-other",
		zaloAppId: "88888888-8888-4888-8888-888888888888",
		secretName: "ZALO_APP_SECRET_BRAND_1",
		status: "active",
	});
	const ambiguous = await test.send({
		access_token: test.token,
		brand: "brand-1",
	});
	assertEquals(
		[ambiguous.status, (await ambiguous.json()).error],
		[500, "not_configured"],
		"ambiguous",
	);
	const filtered = await test.send(
		{ access_token: test.token, brand: "brand-1" },
		{ environment: { ...ENVIRONMENT, ZALO_TENANT_ID: TENANT } },
	);
	assertEquals(
		(await filtered.json()).status,
		"unpaired",
		"a tenant filter decides",
	);
	assertEquals(
		test.zalo.requests().length,
		1,
		"only the filtered call reached Zalo",
	);
});

Deno.test("a missing App secret answers not_configured without naming it", async () => {
	const test = harness();
	const response = await test.send(
		{ access_token: test.token, brand: "brand-1" },
		{ environment: {} },
	);
	assertEquals(response.status, 500, "status");
	const text = await response.text();
	assertEquals(
		JSON.parse(text),
		{ error: "not_configured", request_id: "request-1" },
		"answer",
	);
	assert(!text.includes("ZALO_APP_SECRET"), "the answer names no secret");
	assertEquals(test.zalo.requests(), [], "Zalo was not called");
});

Deno.test("the integration switches are refused outside the gate", async () => {
	const test = harness();
	const response = await test.send(
		{ access_token: test.token, brand: "brand-1" },
		{
			environment: {
				...ENVIRONMENT,
				ZALO_GRAPH_BASE_URL: "http://127.0.0.1:8788",
			},
		},
	);
	assertEquals(response.status, 500, "status");
	assertEquals(
		test.lines,
		[
			"zalo-session request-1: ZALO_GRAPH_BASE_URL is accepted only with ZALO_INTEGRATION=1, or with ZALO_LOCAL_DEV=1 on the local stack",
		],
		"log",
	);
	const gated = await test.send(
		{ access_token: test.token, brand: "brand-1" },
		{
			environment: {
				...ENVIRONMENT,
				ZALO_INTEGRATION: "1",
				ZALO_TENANT_ID: TENANT,
			},
		},
	);
	assertEquals(
		(await gated.json()).error,
		"not_configured",
		"not a fixture tenant",
	);
});

const LOCAL_STACK: FunctionEnvironment = {
	...ENVIRONMENT,
	ZALO_LOCAL_DEV: "1",
	ZALO_TENANT_ID: TENANT,
	ZALO_GRAPH_BASE_URL: "http://127.0.0.1:8788",
	SUPABASE_URL: "http://127.0.0.1:54321",
	SUPABASE_DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
};

Deno.test("on the local stack ZALO_LOCAL_DEV=1 checks a mock user against the loopback graph", async () => {
	const test = harness();
	test.backend.bind(APP, ZALO_USER, MANAGER, null);
	const urls: string[] = [];
	const response = await handleZaloSession(
		new Request(FUNCTION_URL, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ access_token: test.token, brand: "brand-1" }),
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
	assertEquals(response.status, 200, "status");
	const body = await response.json();
	assertEquals(
		[body.status, body.member.role, body.member.stores],
		["bound", "manager", ["Cửa hàng Mẫu 1"]],
		"a session for a tenant that is not a zalo-it- fixture",
	);
	assertEquals(
		urls,
		["http://127.0.0.1:8788/v2.0/me?fields=id,name"],
		"the loopback mock graph was asked, never graph.zalo.me",
	);
});

Deno.test("a deployed function never meets the local switch: the override is refused before Zalo is called", async () => {
	const deployed: FunctionEnvironment[] = [
		{ SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" },
		{ SUPABASE_URL: "http://kong:8000" },
		{ SUPABASE_URL: "http://10.0.0.5:54321" },
		{ SUPABASE_URL: undefined },
		{
			SUPABASE_DB_URL:
				"postgresql://db.abcdefghijklmnopqrst.supabase.co:5432/postgres",
		},
		{ SUPABASE_DB_URL: "postgresql://postgres:postgres@db:5432/postgres" },
		{ SUPABASE_DB_URL: undefined },
	];
	for (const overrides of deployed) {
		const test = harness();
		test.backend.bind(APP, ZALO_USER, MANAGER, null);
		const response = await test.send(
			{ access_token: test.token, brand: "brand-1" },
			{ environment: { ...LOCAL_STACK, ...overrides } },
		);
		const label = Object.keys(overrides).join(", ");
		assertEquals(
			[response.status, (await response.json()).error],
			[500, "not_configured"],
			label,
		);
		assertEquals(test.zalo.requests(), [], `${label}: Zalo was not called`);
		assertEquals(test.backend.calls(), [], `${label}: no backend call`);
		assert(
			test.lines.length === 1 &&
				test.lines[0]?.includes(
					"ZALO_LOCAL_DEV=1 runs only on the local stack",
				),
			`${label}: the refusal is logged`,
		);
		assertNoPersonalData(test.lines, ["supabase.co", test.token]);
	}
	const both = harness();
	const gated = await both.send(
		{ access_token: both.token, brand: "brand-1" },
		{ environment: { ...LOCAL_STACK, ZALO_INTEGRATION: "1" } },
	);
	assertEquals(
		[gated.status, (await gated.json()).error],
		[500, "not_configured"],
		"the two switches exclude each other",
	);
});

Deno.test("Zalo or the database being down is a typed 502 or 503", async () => {
	const test = harness();
	test.backend.bind(APP, ZALO_USER, MANAGER, null);
	test.zalo.failNext("/v2.0/me", { kind: "status", status: 500 });
	const zaloDown = await test.send({
		access_token: test.token,
		brand: "brand-1",
	});
	assertEquals(
		[zaloDown.status, (await zaloDown.json()).error],
		[502, "zalo_unavailable"],
		"zalo",
	);
	test.backend.failNext("mintSession");
	const authDown = await test.send({
		access_token: test.token,
		brand: "brand-1",
	});
	assertEquals(
		[authDown.status, (await authDown.json()).error],
		[503, "backend_unavailable"],
		"auth",
	);
});

Deno.test("a removed login is unpaired and a login without e-mail gets no session", async () => {
	const test = harness();
	test.backend.addMember({
		userId: OWNER,
		tenantId: TENANT,
		role: "owner",
		storeIds: null,
		stores: ["Cửa hàng Mẫu 1", "Cửa hàng Mẫu 2"],
		email: null,
	});
	test.backend.bind(APP, ZALO_USER, OWNER, null);
	const noEmail = await test.send({
		access_token: test.token,
		brand: "brand-1",
	});
	assertEquals(
		[noEmail.status, (await noEmail.json()).error],
		[500, "session_unavailable"],
		"no e-mail",
	);
	test.backend.removeMember(OWNER);
	const removed = await test.send({
		access_token: test.token,
		brand: "brand-1",
	});
	assertEquals(await removed.json(), { status: "unpaired" }, "removed");
});

Deno.test("malformed requests are refused before Zalo is called", async () => {
	const test = harness();
	const cases: [unknown, string][] = [
		[{ brand: "brand-1" }, "invalid_access_token"],
		[{ access_token: "", brand: "brand-1" }, "invalid_access_token"],
		[
			{ access_token: "x".repeat(4097), brand: "brand-1" },
			"invalid_access_token",
		],
		[{ access_token: test.token, brand: "Brand One" }, "invalid_brand"],
		[
			{ access_token: test.token, brand: "brand-1", binding_code: "12345" },
			"invalid_binding_code",
		],
		[
			{ access_token: test.token, brand: "brand-1", binding_code: 123456 },
			"invalid_binding_code",
		],
		[[], "invalid_json"],
	];
	for (const [body, code] of cases) {
		const response = await test.send(body);
		assertEquals(
			[response.status, (await response.json()).error],
			[400, code],
			code,
		);
	}
	const get = await test.send(null, { method: "GET" });
	assertEquals(get.status, 405, "GET");
	assertEquals(test.zalo.requests(), [], "Zalo was not called");
});

Deno.test("the Mini App origin gets its CORS answer on the preflight and the request", async () => {
	const test = harness();
	const preflight = await test.send(null, {
		method: "OPTIONS",
		origin: "https://h5.zdn.vn",
	});
	assertEquals(preflight.status, 204, "preflight");
	assertEquals(
		preflight.headers.get("access-control-allow-origin"),
		"https://h5.zdn.vn",
		"preflight origin",
	);
	const answer = await test.send(
		{ access_token: test.token, brand: "brand-1" },
		{ origin: "zbrowser://h5.zdn.vn" },
	);
	assertEquals(
		answer.headers.get("access-control-allow-origin"),
		"zbrowser://h5.zdn.vn",
		"request origin",
	);
	assertEquals(answer.headers.get("x-request-id"), "request-1", "request id");
	const foreign = await test.send(
		{ access_token: test.token, brand: "brand-1" },
		{ origin: "https://example.com" },
	);
	assertEquals(
		foreign.headers.get("access-control-allow-origin"),
		null,
		"foreign",
	);
});
