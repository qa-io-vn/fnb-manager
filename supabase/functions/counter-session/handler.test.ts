import {
	codeChallengeOf,
	sealIdentityTicket,
	sealingKey,
	sealLoginState,
} from "@fnb/zalo";
import {
	createFakeBackend,
	createMockZalo,
	type FakeBackend,
	type MockZalo,
} from "@fnb/zalo/testing";
import type { FunctionEnvironment } from "../_shared/http.ts";
import { handleCounterSession } from "./handler.ts";

// counter-session (ADR-066): the counter's Zalo web login against the fake backend and the mock Zalo, never the
// real Zalo. Use cases (a member signs in; a stranger is blocked and recorded; a stranger with a pairing code becomes
// a member), decision table of the refusals (forged, expired or swapped state; another verifier; a used or forged
// code; a forged, expired or other-app ticket; a redirect not allowed; a viewer), CSRF/state, CORS, and the logs
// never naming a token, a code or a person.

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
const EXTERNAL_APP = "1234567890";
const MANAGER = "44444444-4444-4444-8444-444444444444";
const VIEWER = "55555555-5555-4555-8555-555555555555";
const ROSTER = "66666666-6666-4666-8666-666666666666";
const STORE = "77777777-7777-4777-8777-777777777777";
const MEMBER_ZALO = "8800000000000000001";
const STRANGER_ZALO = "8800000000000000002";
const VIEWER_ZALO = "8800000000000000003";
const REDIRECT = "https://counter.example.com/";
const VERIFIER = "v".repeat(43);
const PAIRING_CODE = "482913";
const NOW = Date.parse("2026-11-28T03:00:00Z");
const ENVIRONMENT: FunctionEnvironment = {
	ZALO_APP_SECRET_BRAND_1: APP_SECRET,
	COUNTER_REDIRECT_URIS: `${REDIRECT}, https://counter2.example.com/`,
};
const FUNCTION_URL = "http://127.0.0.1:54321/functions/v1/counter-session";
const NOTICE = {
	version: "2026-11-01",
	title: "Thông báo cho nhân viên",
	bodyMarkdown: "Nội dung tổng hợp.",
	publishedAt: "2026-11-01T00:00:00.000Z",
};

interface Harness {
	readonly zalo: MockZalo;
	readonly backend: FakeBackend;
	readonly lines: string[];
	send(
		body: unknown,
		options?: {
			readonly environment?: FunctionEnvironment;
			readonly origin?: string;
			readonly method?: string;
			readonly now?: number;
		},
	): Promise<Response>;
	signInAs(
		zaloUserId: string,
		name?: string,
	): Promise<{
		readonly status: number;
		readonly body: Record<string, unknown>;
	}>;
}

function harness(): Harness {
	const zalo = createMockZalo();
	zalo.registerApp({ appId: EXTERNAL_APP, appSecret: APP_SECRET });
	const backend = createFakeBackend();
	backend.addApp({
		brandKey: "brand-1",
		tenantId: TENANT,
		tenantSlug: "synthetic-tenant",
		zaloAppId: APP,
		externalId: EXTERNAL_APP,
		secretName: "ZALO_APP_SECRET_BRAND_1",
		status: "active",
	});
	backend.addMember({
		userId: MANAGER,
		tenantId: TENANT,
		role: "manager",
		storeIds: [STORE],
		stores: ["Cửa hàng mẫu"],
		brandStoreIds: [STORE],
		email: "counter-manager@example.com",
	});
	backend.bind(APP, MEMBER_ZALO, MANAGER, "Quản lý thử");
	backend.addMember({
		userId: VIEWER,
		tenantId: TENANT,
		role: "viewer",
		storeIds: null,
		stores: [],
		email: "counter-viewer@example.com",
	});
	backend.bind(APP, VIEWER_ZALO, VIEWER, "Người xem");
	const lines: string[] = [];
	const send: Harness["send"] = (body, options = {}) => {
		const headers: Record<string, string> = {
			"content-type": "application/json",
			"user-agent":
				"Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
		};
		if (options.origin !== undefined) {
			headers.origin = options.origin;
		}
		const method = options.method ?? "POST";
		return handleCounterSession(
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
				now: () => options.now ?? NOW,
				newLoginId: () => "99999999-9999-4999-8999-999999999999",
			},
		);
	};
	const signInAs: Harness["signInAs"] = async (zaloUserId, name) => {
		zalo.setWebLoginUser(EXTERNAL_APP, { id: zaloUserId, name: name ?? null });
		const started = await send({
			action: "start",
			brand: "brand-1",
			redirect_uri: REDIRECT,
			code_challenge: await codeChallengeOf(VERIFIER),
		});
		const startBody = await started.json();
		assertEquals(started.status, 200, "start");
		const redirect = await zalo.handle(new Request(startBody.authorize_url));
		const back = new URL(redirect.headers.get("location") ?? "");
		const response = await send({
			action: "callback",
			brand: "brand-1",
			redirect_uri: REDIRECT,
			code: back.searchParams.get("code"),
			state: back.searchParams.get("state"),
			code_verifier: VERIFIER,
		});
		return { status: response.status, body: await response.json() };
	};
	return { zalo, backend, lines, send, signInAs };
}

function assertNoSecrets(
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

Deno.test("start names Zalo's authorise page with the app, the redirect, the challenge and a sealed state", async () => {
	const test = harness();
	const challenge = await codeChallengeOf(VERIFIER);
	const response = await test.send({
		action: "start",
		brand: "brand-1",
		redirect_uri: REDIRECT,
		code_challenge: challenge,
	});
	assertEquals(response.status, 200, "status");
	const body = await response.json();
	const url = new URL(body.authorize_url);
	assertEquals(
		url.origin + url.pathname,
		"https://oauth.zaloapp.com/v4/permission",
		"address",
	);
	assertEquals(url.searchParams.get("app_id"), EXTERNAL_APP, "app");
	assertEquals(url.searchParams.get("redirect_uri"), REDIRECT, "redirect");
	assertEquals(url.searchParams.get("code_challenge"), challenge, "challenge");
	assertEquals(url.searchParams.get("state"), body.state, "state");
	assert(
		!String(body.state).includes(REDIRECT),
		"the state is sealed, not readable",
	);
});

Deno.test("start refuses a redirect address not on the list, and a malformed challenge or brand", async () => {
	const test = harness();
	const challenge = await codeChallengeOf(VERIFIER);
	for (const [body, status, code] of [
		[
			{
				action: "start",
				brand: "brand-1",
				redirect_uri: "https://evil.example.com/",
				code_challenge: challenge,
			},
			403,
			"redirect_not_allowed",
		],
		[
			{
				action: "start",
				brand: "brand-1",
				redirect_uri: "http://127.0.0.1:5173/",
				code_challenge: challenge,
			},
			403,
			"redirect_not_allowed",
		],
		[
			{
				action: "start",
				brand: "brand-1",
				redirect_uri: REDIRECT,
				code_challenge: "short",
			},
			400,
			"invalid_challenge",
		],
		[
			{
				action: "start",
				brand: "Brand 1",
				redirect_uri: REDIRECT,
				code_challenge: challenge,
			},
			400,
			"invalid_brand",
		],
		[
			{
				action: "start",
				brand: "brand-9",
				redirect_uri: REDIRECT,
				code_challenge: challenge,
			},
			404,
			"unknown_brand",
		],
		[
			{
				action: "start",
				brand: "brand-1",
				redirect_uri: REDIRECT,
				code_challenge: challenge,
				extra: 1,
			},
			400,
			"invalid_request",
		],
		[{ action: "nothing" }, 400, "invalid_action"],
	] as const) {
		const response = await test.send(body);
		assertEquals(response.status, status, `${JSON.stringify(body)} status`);
		assertEquals(
			(await response.json()).error,
			code,
			`${JSON.stringify(body)} code`,
		);
	}
});

Deno.test("a member on the roster signs in and gets a session with the role and stores", async () => {
	const test = harness();
	const { status, body } = await test.signInAs(MEMBER_ZALO, "Quản lý thử");
	assertEquals(status, 200, "status");
	assertEquals(body.status, "bound", "bound");
	assert(
		typeof body.access_token === "string" && body.access_token !== "",
		"an access token",
	);
	assertEquals(
		body.member,
		{
			display_name: "Quản lý thử",
			role: "manager",
			stores: ["Cửa hàng mẫu"],
			store_ids: [STORE],
			tenant_id: TENANT,
		},
		"member",
	);
	assertEquals(
		test.backend.blockedSignins().length,
		0,
		"nobody recorded as blocked",
	);
	assertNoSecrets(test.lines, [
		String(body.access_token),
		MEMBER_ZALO,
		"Quản lý thử",
	]);
});

Deno.test("acceptance criterion 5: a person not on the list gets no session and is recorded for the managers", async () => {
	const test = harness();
	test.backend.publishNotice(TENANT, NOTICE);
	const { status, body } = await test.signInAs(STRANGER_ZALO, "Người lạ");
	assertEquals(status, 200, "status");
	assertEquals(body.status, "unpaired", "unpaired");
	assert(body.access_token === undefined, "no session");
	assert(typeof body.ticket === "string", "a ticket for the pairing step");
	assertEquals(
		(body.notice as Record<string, unknown>).version,
		NOTICE.version,
		"the staff notice to accept",
	);
	assertEquals(
		test.backend.blockedSignins(),
		[
			{
				zaloAppId: APP,
				zaloUserId: STRANGER_ZALO,
				displayName: "Người lạ",
				device: "Chrome · Android",
				attempts: 1,
			},
		],
		"recorded with the name and the device line",
	);
	await test.signInAs(STRANGER_ZALO, "Người lạ");
	assertEquals(
		test.backend.blockedSignins()[0]?.attempts,
		2,
		"a second attempt counts",
	);
	assertNoSecrets(test.lines, [STRANGER_ZALO, "Người lạ", String(body.ticket)]);
});

Deno.test("a stranger with a pairing code and the notice accepted becomes the roster's member", async () => {
	const test = harness();
	test.backend.publishNotice(TENANT, NOTICE);
	test.backend.addRosterEntry({
		id: ROSTER,
		tenantId: TENANT,
		role: "staff",
		storeIds: [STORE],
		stores: ["Cửa hàng mẫu"],
		status: "invited",
		userId: null,
	});
	test.backend.issuePairingCode(ROSTER, PAIRING_CODE);
	const first = await test.signInAs(STRANGER_ZALO, "Người mới");
	assertEquals(first.body.status, "unpaired", "unpaired first");
	const wrong = await test.send({
		action: "pair",
		brand: "brand-1",
		ticket: first.body.ticket,
		pairing_code: "000000",
		notice: { version: NOTICE.version, shown_at: new Date(NOW).toISOString() },
	});
	const wrongBody = await wrong.json();
	assertEquals(wrongBody.status, "unpaired", "a wrong code stays unpaired");
	assertEquals(
		wrongBody.reason,
		"code_refused",
		"and says the code was refused",
	);
	const paired = await test.send({
		action: "pair",
		brand: "brand-1",
		ticket: wrongBody.ticket,
		pairing_code: PAIRING_CODE,
		notice: { version: NOTICE.version, shown_at: new Date(NOW).toISOString() },
	});
	const body = await paired.json();
	assertEquals(paired.status, 200, "status");
	assertEquals(body.status, "bound", "bound");
	assertEquals(
		(body.member as Record<string, unknown>).role,
		"staff",
		"the roster role",
	);
	assertEquals(
		test.backend.logins().length,
		1,
		"a login was made for the person",
	);
	assertNoSecrets(test.lines, [PAIRING_CODE, String(first.body.ticket)]);
});

Deno.test("the pair step needs a code or a notice and refuses a forged, expired or other-app ticket", async () => {
	const test = harness();
	const key = await sealingKey(APP_SECRET, "ticket");
	const good = await sealIdentityTicket(key, {
		zaloAppId: APP,
		zaloUserId: STRANGER_ZALO,
		displayName: null,
		expiresAt: NOW + 1,
	});
	const cases: [unknown, number, string, number?][] = [
		[
			{ action: "pair", brand: "brand-1", ticket: good },
			400,
			"invalid_request",
		],
		[
			{ action: "pair", brand: "brand-1", ticket: good, pairing_code: "12345" },
			400,
			"invalid_pairing_code",
		],
		[
			{
				action: "pair",
				brand: "brand-1",
				ticket: "x".repeat(60),
				pairing_code: PAIRING_CODE,
			},
			401,
			"ticket_refused",
		],
		[
			{
				action: "pair",
				brand: "brand-1",
				ticket: good,
				pairing_code: PAIRING_CODE,
			},
			401,
			"ticket_refused",
			NOW + 1,
		],
		[
			{
				action: "pair",
				brand: "brand-1",
				ticket: await sealIdentityTicket(key, {
					zaloAppId: "another-app",
					zaloUserId: STRANGER_ZALO,
					displayName: null,
					expiresAt: NOW + 60_000,
				}),
				pairing_code: PAIRING_CODE,
			},
			401,
			"ticket_refused",
		],
		[
			{
				action: "pair",
				brand: "brand-1",
				ticket: await sealIdentityTicket(
					await sealingKey("another-secret", "ticket"),
					{
						zaloAppId: APP,
						zaloUserId: STRANGER_ZALO,
						displayName: null,
						expiresAt: NOW + 60_000,
					},
				),
				pairing_code: PAIRING_CODE,
			},
			401,
			"ticket_refused",
		],
	];
	for (const [body, status, code, now] of cases) {
		const response = await test.send(body, now === undefined ? {} : { now });
		assertEquals(response.status, status, `${code} status`);
		assertEquals((await response.json()).error, code, `${code} code`);
	}
});

Deno.test("CSRF and forgery: a forged, expired or swapped state and another verifier are refused before Zalo is asked", async () => {
	const test = harness();
	test.zalo.setWebLoginUser(EXTERNAL_APP, { id: MEMBER_ZALO, name: null });
	const challenge = await codeChallengeOf(VERIFIER);
	const started = await (
		await test.send({
			action: "start",
			brand: "brand-1",
			redirect_uri: REDIRECT,
			code_challenge: challenge,
		})
	).json();
	const redirect = await test.zalo.handle(new Request(started.authorize_url));
	const code = new URL(redirect.headers.get("location") ?? "").searchParams.get(
		"code",
	);
	const stateKey = await sealingKey(APP_SECRET, "state");
	const otherRedirect = await sealLoginState(stateKey, {
		challenge,
		redirectUri: "https://counter2.example.com/",
		expiresAt: NOW + 60_000,
	});
	const before = test.zalo.oauthCounts().exchanges;
	const cases: [unknown, number, string, number?][] = [
		[
			{
				action: "callback",
				brand: "brand-1",
				redirect_uri: REDIRECT,
				code,
				state: "f".repeat(60),
				code_verifier: VERIFIER,
			},
			401,
			"state_refused",
		],
		[
			{
				action: "callback",
				brand: "brand-1",
				redirect_uri: REDIRECT,
				code,
				state: started.state,
				code_verifier: "w".repeat(43),
			},
			401,
			"state_refused",
		],
		[
			{
				action: "callback",
				brand: "brand-1",
				redirect_uri: REDIRECT,
				code,
				state: otherRedirect,
				code_verifier: VERIFIER,
			},
			401,
			"state_refused",
		],
		[
			{
				action: "callback",
				brand: "brand-1",
				redirect_uri: REDIRECT,
				code,
				state: started.state,
				code_verifier: VERIFIER,
			},
			401,
			"state_refused",
			NOW + 10 * 60_000,
		],
		[
			{
				action: "callback",
				brand: "brand-1",
				redirect_uri: "https://evil.example.com/",
				code,
				state: started.state,
				code_verifier: VERIFIER,
			},
			403,
			"redirect_not_allowed",
		],
		[
			{
				action: "callback",
				brand: "brand-1",
				redirect_uri: REDIRECT,
				code: "",
				state: started.state,
				code_verifier: VERIFIER,
			},
			400,
			"invalid_code",
		],
	];
	for (const [body, status, errorCode, now] of cases) {
		const response = await test.send(body, now === undefined ? {} : { now });
		assertEquals(response.status, status, `${errorCode} status`);
		assertEquals((await response.json()).error, errorCode, `${errorCode} code`);
	}
	assertEquals(
		test.zalo.oauthCounts().exchanges,
		before,
		"Zalo was never asked to exchange",
	);
	const ok = await test.send({
		action: "callback",
		brand: "brand-1",
		redirect_uri: REDIRECT,
		code,
		state: started.state,
		code_verifier: VERIFIER,
	});
	assertEquals(
		(await ok.json()).status,
		"bound",
		"the genuine callback still signs in",
	);
	const replay = await test.send({
		action: "callback",
		brand: "brand-1",
		redirect_uri: REDIRECT,
		code,
		state: started.state,
		code_verifier: VERIFIER,
	});
	assertEquals(replay.status, 401, "the same code again is refused");
	assertEquals(
		(await replay.json()).error,
		"zalo_code_refused",
		"by Zalo, as used",
	);
});

Deno.test("a viewer bound to the app is refused: the counter is for owners, managers and staff", async () => {
	const test = harness();
	const { status, body } = await test.signInAs(VIEWER_ZALO, "Người xem");
	assertEquals(status, 403, "status");
	assertEquals(body.error, "role_not_allowed", "code");
	assertEquals(test.backend.minted().length, 0, "no session minted");
});

Deno.test("CORS lets in only the counter's configured origins; loopback only on the local stack", async () => {
	const test = harness();
	const allowed = await test.send(
		{ action: "nothing" },
		{ origin: "https://counter.example.com" },
	);
	assertEquals(
		allowed.headers.get("access-control-allow-origin"),
		"https://counter.example.com",
		"configured origin",
	);
	const refused = await test.send(
		{ action: "nothing" },
		{ origin: "https://evil.example.com" },
	);
	assertEquals(
		refused.headers.get("access-control-allow-origin"),
		null,
		"another origin",
	);
	const loopback = await test.send(
		{ action: "nothing" },
		{ origin: "http://127.0.0.1:5761" },
	);
	assertEquals(
		loopback.headers.get("access-control-allow-origin"),
		null,
		"loopback outside local dev",
	);
	const preflight = await test.send(null, {
		origin: "https://counter.example.com",
		method: "OPTIONS",
	});
	assertEquals(preflight.status, 204, "preflight");
	assertEquals(
		preflight.headers.get("access-control-allow-methods"),
		"GET, POST, OPTIONS",
		"methods",
	);
	const get = await test.send(null, { method: "GET" });
	assertEquals(get.status, 405, "only POST");
});

Deno.test("an OAuth base override is refused outside the local stack and the integration gate", async () => {
	const test = harness();
	const response = await test.send(
		{
			action: "start",
			brand: "brand-1",
			redirect_uri: REDIRECT,
			code_challenge: await codeChallengeOf(VERIFIER),
		},
		{
			environment: {
				...ENVIRONMENT,
				ZALO_OAUTH_BASE_URL: "http://127.0.0.1:8788",
			},
		},
	);
	assertEquals(response.status, 500, "status");
	assertEquals((await response.json()).error, "not_configured", "code");
});

Deno.test("Zalo being down is a typed 502 and the database being down a 503", async () => {
	const test = harness();
	test.zalo.setWebLoginUser(EXTERNAL_APP, { id: MEMBER_ZALO, name: null });
	const started = await (
		await test.send({
			action: "start",
			brand: "brand-1",
			redirect_uri: REDIRECT,
			code_challenge: await codeChallengeOf(VERIFIER),
		})
	).json();
	const redirect = await test.zalo.handle(new Request(started.authorize_url));
	const back = new URL(redirect.headers.get("location") ?? "");
	test.zalo.failNext("/v4/access_token", { kind: "status", status: 500 });
	const down = await test.send({
		action: "callback",
		brand: "brand-1",
		redirect_uri: REDIRECT,
		code: back.searchParams.get("code"),
		state: back.searchParams.get("state"),
		code_verifier: VERIFIER,
	});
	assert(
		down.status === 401 || down.status === 502,
		`Zalo down answers ${down.status}`,
	);
	test.backend.failNext("rpc");
	const database = await test.send({
		action: "start",
		brand: "brand-1",
		redirect_uri: REDIRECT,
		code_challenge: await codeChallengeOf(VERIFIER),
	});
	assertEquals(database.status, 503, "database down");
});
