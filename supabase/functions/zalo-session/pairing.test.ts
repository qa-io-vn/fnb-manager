import { type SupabaseBackend, UpstreamError } from "@fnb/zalo";
import {
	createFakeBackend,
	createMockZalo,
	FAKE_PAIRING_WAIT_SECONDS,
	type FakeBackend,
	type MockZalo,
} from "@fnb/zalo/testing";
import type { FunctionEnvironment } from "../_shared/http.ts";
import { handleZaloSession } from "./handler.ts";

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
const SECOND_SECRET = "synthetic-app-secret-brand-2";
const TENANT = "11111111-1111-4111-8111-111111111111";
const APP = "33333333-3333-4333-8333-333333333333";
const SECOND_APP = "33333333-3333-4333-8333-333333333334";
const OWNER = "55555555-5555-4555-8555-555555555555";
const OWNER_EMAIL = "pairing-owner@example.com";
const ROSTER = "66666666-6666-4666-8666-666666666601";
const SECOND_ROSTER = "66666666-6666-4666-8666-666666666602";
const STORE = "77777777-7777-4777-8777-777777777771";
const LOGIN_ID = "99999999-9999-4999-8999-999999999901";
const EMAIL_KEY = "99999999-9999-4999-8999-999999999902";
const CREATED_LOGIN = "00000000-0000-4000-8000-000000000001";
const ZALO_USER = "8800000000000000101";
const ZALO_NAME = "Nhân viên thử";
const CODE = "482913";
const NOTICE = {
	version: "staff-notice-2026-01",
	title: "Thông báo cho nhân viên",
	bodyMarkdown: "# Thông báo\n\nVăn bản thử.",
	publishedAt: "2026-11-01T00:00:00+00:00",
};
const NOTICE_ANSWER = {
	version: NOTICE.version,
	title: NOTICE.title,
	body_markdown: NOTICE.bodyMarkdown,
	published_at: NOTICE.publishedAt,
};
const ACCEPTED = {
	version: NOTICE.version,
	shown_at: "2026-11-18T03:00:00.000Z",
};
const ENVIRONMENT: FunctionEnvironment = {
	ZALO_APP_SECRET_BRAND_1: APP_SECRET,
	ZALO_APP_SECRET_BRAND_2: SECOND_SECRET,
};
const FUNCTION_URL = "http://127.0.0.1:54321/functions/v1/zalo-session";

interface Harness {
	readonly zalo: MockZalo;
	readonly backend: FakeBackend;
	readonly lines: string[];
	token(id: string, name?: string, secret?: string): string;
	send(
		body: unknown,
		options?: { readonly backend?: SupabaseBackend },
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
	backend.addApp({
		brandKey: "brand-2",
		tenantId: TENANT,
		tenantSlug: "synthetic-tenant",
		zaloAppId: SECOND_APP,
		secretName: "ZALO_APP_SECRET_BRAND_2",
		status: "active",
	});
	backend.addMember({
		userId: OWNER,
		tenantId: TENANT,
		role: "owner",
		storeIds: null,
		stores: ["Cửa hàng Mẫu 1", "Cửa hàng Mẫu 2"],
		email: OWNER_EMAIL,
	});
	backend.publishNotice(TENANT, NOTICE);
	backend.addRosterEntry({
		id: ROSTER,
		tenantId: TENANT,
		role: "staff",
		storeIds: [STORE],
		stores: ["Cửa hàng Mẫu 1"],
		status: "invited",
		userId: null,
	});
	const lines: string[] = [];
	return {
		zalo,
		backend,
		lines,
		token(id, name = ZALO_NAME, secret = APP_SECRET) {
			return zalo.issueAccessToken(secret, { id, name });
		},
		send(body, options = {}) {
			return handleZaloSession(
				new Request(FUNCTION_URL, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						apikey: "sb_publishable_synthetic",
					},
					body: JSON.stringify(body),
				}),
				ENVIRONMENT,
				{
					fetch: zalo.fetch,
					backend: options.backend ?? backend,
					log: (line) => lines.push(line),
					requestId: () => "request-1",
					newLoginId: () => EMAIL_KEY,
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

async function answer(response: Response): Promise<Record<string, unknown>> {
	assertEquals(response.status, 200, "status");
	return (await response.json()) as Record<string, unknown>;
}

Deno.test("an unpaired identity is shown the published staff notice and gets no session", async () => {
	const test = harness();
	const body = await answer(
		await test.send({ access_token: test.token(ZALO_USER), brand: "brand-1" }),
	);
	assertEquals(body, { status: "unpaired", notice: NOTICE_ANSWER }, "answer");
	assertEquals(test.backend.minted(), [], "no session");
	assertEquals(
		test.lines,
		["zalo-session request-1: unpaired: the identity is not bound to a member"],
		"log",
	);
});

Deno.test("a pairing code sent with the accepted notice creates the login, records the consent and answers a session with the roster role and stores", async () => {
	const test = harness();
	test.backend.issuePairingCode(ROSTER, CODE);
	const token = test.token(ZALO_USER);
	const body = await answer(
		await test.send({
			access_token: token,
			brand: "brand-1",
			pairing_code: CODE,
			notice: ACCEPTED,
		}),
	);
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
				role: "staff",
				stores: ["Cửa hàng Mẫu 1"],
				store_ids: [STORE],
				tenant_id: TENANT,
			},
		},
		"answer",
	);
	assertEquals(
		test.backend.calls(),
		[
			"rpc zalo_session_app",
			"rpc zalo_session_pair",
			"createLogin",
			"rpc zalo_session_pair",
			"userEmail",
			"mintSession",
		],
		"the first pairing asks for a login once, then pairs with it",
	);
	assertEquals(
		test.backend.logins(),
		[{ userId: CREATED_LOGIN, email: `staff-${EMAIL_KEY}@zalo-staff.invalid` }],
		"a login without a real e-mail or password",
	);
	assertEquals(
		test.backend.rosterEntry(ROSTER),
		{
			id: ROSTER,
			tenantId: TENANT,
			role: "staff",
			storeIds: [STORE],
			stores: ["Cửa hàng Mẫu 1"],
			status: "active",
			userId: CREATED_LOGIN,
		},
		"the roster row is active with the login",
	);
	assertEquals(
		test.backend.consents(),
		[
			{
				tenantId: TENANT,
				userId: CREATED_LOGIN,
				version: NOTICE.version,
				active: true,
			},
		],
		"the staff_ops consent names the notice",
	);
	assertEquals(
		test.lines,
		[
			"zalo-session request-1: session minted: staff, 1 stores, identity bound, login created",
		],
		"log",
	);
	assertNoPersonalData(test.lines, [
		CODE,
		token,
		ZALO_USER,
		ZALO_NAME,
		CREATED_LOGIN,
		EMAIL_KEY,
		session.accessToken,
		session.refreshToken,
	]);
	const again = await answer(
		await test.send({ access_token: token, brand: "brand-1" }),
	);
	assertEquals(again.status, "bound", "the next sign-in needs no code");
	assertEquals(test.backend.deletedLogins(), [], "the login stays");
});

Deno.test("a pairing code without the accepted notice, or with another version, is not checked", async () => {
	const test = harness();
	test.backend.issuePairingCode(ROSTER, CODE);
	const token = test.token(ZALO_USER);
	for (const notice of [
		undefined,
		{ version: "staff-notice-2025-12", shown_at: ACCEPTED.shown_at },
	]) {
		const body = await answer(
			await test.send({
				access_token: token,
				brand: "brand-1",
				pairing_code: CODE,
				...(notice === undefined ? {} : { notice }),
			}),
		);
		assertEquals(
			body,
			{ status: "unpaired", reason: "notice_outdated", notice: NOTICE_ANSWER },
			"answer",
		);
	}
	assertEquals(
		test.backend.pairingCodeFailures(ROSTER),
		0,
		"no attempt counted",
	);
	assertEquals(test.backend.logins(), [], "no login created");
	assert(
		test.lines.every((line) =>
			line.endsWith("unpaired: the accepted notice is not the published one"),
		),
		"logged as an outdated notice",
	);
});

Deno.test("wrong codes count per identity: the fifth makes it wait, and while it waits even the right code is not checked", async () => {
	const test = harness();
	test.backend.issuePairingCode(ROSTER, CODE);
	const token = test.token(ZALO_USER);
	const reasons: unknown[] = [];
	for (const wrong of ["000001", "000002", "000003", "000004", "000005"]) {
		const body = await answer(
			await test.send({
				access_token: token,
				brand: "brand-1",
				pairing_code: wrong,
				notice: ACCEPTED,
			}),
		);
		reasons.push(body.reason);
	}
	assertEquals(
		reasons,
		["code_refused", "code_refused", "code_refused", "code_refused", "wait"],
		"reasons",
	);
	const waiting = await answer(
		await test.send({
			access_token: token,
			brand: "brand-1",
			pairing_code: CODE,
			notice: ACCEPTED,
		}),
	);
	assertEquals(
		waiting,
		{
			status: "unpaired",
			reason: "wait",
			retry_after: FAKE_PAIRING_WAIT_SECONDS,
			notice: NOTICE_ANSWER,
		},
		"the right code waits too",
	);
	assertEquals(test.backend.logins(), [], "nothing paired");
	const other = await answer(
		await test.send({
			access_token: test.token("8800000000000000102"),
			brand: "brand-1",
			pairing_code: CODE,
			notice: ACCEPTED,
		}),
	);
	assertEquals(other.status, "bound", "another identity is not held back");
	assert(
		test.lines.includes(
			"zalo-session request-1: unpaired: the identity waits after too many wrong codes",
		),
		"the wait is logged",
	);
	assertNoPersonalData(test.lines, [CODE, "000005", token]);
});

Deno.test("wrong codes count per code: five are tolerated and the sixth burns it", async () => {
	const test = harness();
	test.backend.issuePairingCode(ROSTER, CODE);
	for (let n = 1; n <= 5; n += 1) {
		await test.send({
			access_token: test.token(`88000000000000002${n}`),
			brand: "brand-1",
			pairing_code: "000000",
			notice: ACCEPTED,
		});
	}
	assertEquals(test.backend.pairingCodeFailures(ROSTER), 5, "five counted");
	await test.send({
		access_token: test.token("8800000000000000206"),
		brand: "brand-1",
		pairing_code: "000000",
		notice: ACCEPTED,
	});
	assertEquals(
		test.backend.pairingCodeFailures(ROSTER),
		undefined,
		"the sixth burns the code",
	);
	const late = await answer(
		await test.send({
			access_token: test.token(ZALO_USER),
			brand: "brand-1",
			pairing_code: CODE,
			notice: ACCEPTED,
		}),
	);
	assertEquals(late.reason, "code_refused", "a burnt code no longer pairs");
});

Deno.test("refusals never hint whether a roster row exists", async () => {
	const test = harness();
	test.backend.addRosterEntry({
		id: SECOND_ROSTER,
		tenantId: TENANT,
		role: "manager",
		storeIds: null,
		stores: ["Cửa hàng Mẫu 1", "Cửa hàng Mẫu 2"],
		status: "inactive",
		userId: null,
	});
	test.backend.issuePairingCode(SECOND_ROSTER, "111111");
	test.backend.addRosterEntry({
		id: "66666666-6666-4666-8666-666666666603",
		tenantId: TENANT,
		role: "staff",
		storeIds: [STORE],
		stores: ["Cửa hàng Mẫu 1"],
		status: "invited",
		userId: OWNER,
	});
	test.backend.issuePairingCode(
		"66666666-6666-4666-8666-666666666603",
		"222222",
	);
	test.backend.issuePairingCode(ROSTER, CODE);
	await test.send({
		access_token: test.token("8800000000000000300"),
		brand: "brand-1",
		pairing_code: CODE,
		notice: ACCEPTED,
	});
	const bodies: string[] = [];
	for (const [n, code] of [
		[1, "999999"],
		[2, CODE],
		[3, "111111"],
		[4, "222222"],
	] as const) {
		const response = await test.send({
			access_token: test.token(`880000000000000030${n}`),
			brand: "brand-1",
			pairing_code: code,
			notice: ACCEPTED,
		});
		bodies.push(await response.text());
	}
	assertEquals(
		new Set(bodies).size,
		1,
		"a wrong code, a used one, one of a deactivated row and one of an owner's login answer alike",
	);
	assertEquals(
		JSON.parse(bodies[0] ?? "{}"),
		{ status: "unpaired", reason: "code_refused", notice: NOTICE_ANSWER },
		"answer",
	);
	assertEquals(
		test.backend.identities().length,
		1,
		"only the first pairing bound an identity",
	);
});

Deno.test("a missing or outdated staff_ops consent asks for the notice; accepting it signs in", async () => {
	const test = harness();
	test.backend.addRosterEntry({
		id: ROSTER,
		tenantId: TENANT,
		role: "staff",
		storeIds: [STORE],
		stores: ["Cửa hàng Mẫu 1"],
		status: "active",
		userId: LOGIN_ID,
	});
	test.backend.addMember({
		userId: LOGIN_ID,
		tenantId: TENANT,
		role: "staff",
		storeIds: [STORE],
		stores: ["Cửa hàng Mẫu 1"],
		email: `staff-${LOGIN_ID}@zalo-staff.invalid`,
	});
	test.backend.bind(APP, ZALO_USER, LOGIN_ID, null);
	const token = test.token(ZALO_USER);
	const missing = await answer(
		await test.send({ access_token: token, brand: "brand-1" }),
	);
	assertEquals(
		missing,
		{ status: "notice_required", notice: NOTICE_ANSWER },
		"missing consent",
	);
	test.backend.giveConsent(TENANT, LOGIN_ID, "staff-notice-2025-12");
	const outdated = await answer(
		await test.send({ access_token: token, brand: "brand-1" }),
	);
	assertEquals(outdated.status, "notice_required", "outdated consent");
	assertEquals(test.backend.minted(), [], "no session before the notice");
	const accepted = await answer(
		await test.send({
			access_token: token,
			brand: "brand-1",
			notice: ACCEPTED,
		}),
	);
	assertEquals(accepted.status, "bound", "accepting signs in");
	assertEquals(
		test.backend
			.consents()
			.map((consent) => `${consent.version}:${consent.active}`),
		["staff-notice-2025-12:false", `${NOTICE.version}:true`],
		"the consent now names the published notice",
	);
	assertEquals(
		test.lines,
		[
			"zalo-session request-1: notice required: the staff_ops consent is missing or outdated",
			"zalo-session request-1: notice required: the staff_ops consent is missing or outdated",
			"zalo-session request-1: session minted: staff, 1 stores, notice accepted",
		],
		"log",
	);
	test.backend.withdrawConsent(TENANT, LOGIN_ID);
	const withdrawn = await answer(
		await test.send({ access_token: token, brand: "brand-1" }),
	);
	assertEquals(
		withdrawn,
		{ status: "unpaired", notice: NOTICE_ANSWER },
		"a withdrawal unpairs the identity",
	);
});

Deno.test("a person paired in one brand's app pairs again in another and keeps the same login and roster row", async () => {
	const test = harness();
	test.backend.issuePairingCode(ROSTER, CODE);
	const first = await answer(
		await test.send({
			access_token: test.token(ZALO_USER),
			brand: "brand-1",
			pairing_code: CODE,
			notice: ACCEPTED,
		}),
	);
	assertEquals(first.status, "bound", "paired in the first brand");
	const secondToken = test.token(
		"8800000000000000401",
		ZALO_NAME,
		SECOND_SECRET,
	);
	const unpaired = await answer(
		await test.send({ access_token: secondToken, brand: "brand-2" }),
	);
	assertEquals(unpaired.status, "unpaired", "a new app is a new identity");
	test.backend.issuePairingCode(ROSTER, "731406");
	const second = await answer(
		await test.send({
			access_token: secondToken,
			brand: "brand-2",
			pairing_code: "731406",
			notice: ACCEPTED,
		}),
	);
	assertEquals(second.status, "bound", "paired in the second brand");
	assertEquals(
		test.backend.calls().filter((call) => call === "createLogin"),
		["createLogin"],
		"one login for both brands",
	);
	assertEquals(
		test.backend.identities().map((identity) => identity.userId),
		[CREATED_LOGIN, CREATED_LOGIN],
		"both identities point at it",
	);
	assertEquals(
		test.backend.consents().length,
		1,
		"the consent already given is kept",
	);
});

Deno.test("a binding code of fnb zalo bind also works through the pairing request, with no staff_ops consent for an owner", async () => {
	const test = harness();
	test.backend.issueCode(APP, OWNER, CODE);
	const body = await answer(
		await test.send({
			access_token: test.token(ZALO_USER),
			brand: "brand-1",
			pairing_code: CODE,
			notice: ACCEPTED,
		}),
	);
	assertEquals(
		[body.status, (body.member as Record<string, unknown>).role],
		["bound", "owner"],
		"bound as the owner",
	);
	assertEquals(test.backend.consents(), [], "no consent recorded");
	assertEquals(test.backend.logins(), [], "no login created");
});

Deno.test("a login created but not used is removed, and a failure after it is a typed 503", async () => {
	const test = harness();
	const created: string[] = [];
	let pairs = 0;
	const racing: SupabaseBackend = {
		...test.backend,
		rpc: async (name, args) => {
			if (name !== "zalo_session_pair") {
				return test.backend.rpc(name, args);
			}
			pairs += 1;
			return pairs === 1
				? { status: "login_needed" }
				: { status: "unpaired", reason: "code_refused" };
		},
		createLogin: async (email) => {
			const id = await test.backend.createLogin(email);
			created.push(id);
			return id;
		},
		deleteLogin: (id) => test.backend.deleteLogin(id),
	};
	const lost = await answer(
		await test.send(
			{
				access_token: test.token(ZALO_USER),
				brand: "brand-1",
				pairing_code: CODE,
				notice: ACCEPTED,
			},
			{ backend: racing },
		),
	);
	assertEquals(
		lost,
		{ status: "unpaired", reason: "code_refused" },
		"the race is lost",
	);
	assertEquals(test.backend.deletedLogins(), created, "the login is removed");
	pairs = 0;
	const failing: SupabaseBackend = {
		...racing,
		rpc: async (name, args) => {
			if (name !== "zalo_session_pair") {
				return test.backend.rpc(name, args);
			}
			pairs += 1;
			if (pairs === 1) {
				return { status: "login_needed" };
			}
			throw new UpstreamError("supabase", "status", 503);
		},
	};
	const failed = await test.send(
		{
			access_token: test.token(ZALO_USER),
			brand: "brand-1",
			pairing_code: CODE,
			notice: ACCEPTED,
		},
		{ backend: failing },
	);
	assertEquals(
		[failed.status, (await failed.json()).error],
		[503, "backend_unavailable"],
		"the database failing after the login was created",
	);
	assertEquals(
		test.backend.deletedLogins().length,
		2,
		"the second login is removed before the error goes on",
	);
	test.backend.failNext("createLogin");
	test.backend.issuePairingCode(ROSTER, CODE);
	const down = await test.send({
		access_token: test.token(ZALO_USER),
		brand: "brand-1",
		pairing_code: CODE,
		notice: ACCEPTED,
	});
	assertEquals(
		[down.status, (await down.json()).error],
		[503, "backend_unavailable"],
		"Auth refusing the login",
	);
	assertEquals(
		test.backend.rosterEntry(ROSTER)?.status,
		"invited",
		"nothing paired",
	);
});

Deno.test("malformed pairing requests are refused before Zalo is called", async () => {
	const test = harness();
	const token = test.token(ZALO_USER);
	const cases: [Record<string, unknown>, string][] = [
		[{ pairing_code: "12345" }, "invalid_pairing_code"],
		[{ pairing_code: 482913 }, "invalid_pairing_code"],
		[{ pairing_code: CODE, binding_code: CODE }, "invalid_pairing_code"],
		[{ notice: "accepted" }, "invalid_notice"],
		[{ notice: [] }, "invalid_notice"],
		[
			{ notice: { version: "Bad Version", shown_at: ACCEPTED.shown_at } },
			"invalid_notice",
		],
		[
			{ notice: { version: NOTICE.version, shown_at: "yesterday" } },
			"invalid_notice",
		],
		[
			{
				notice: {
					version: NOTICE.version,
					shown_at: `${ACCEPTED.shown_at}${" ".repeat(40)}`,
				},
			},
			"invalid_notice",
		],
		[{ notice: { version: NOTICE.version } }, "invalid_notice"],
	];
	for (const [extra, code] of cases) {
		const response = await test.send({
			access_token: token,
			brand: "brand-1",
			...extra,
		});
		assertEquals(
			[response.status, (await response.json()).error],
			[400, code],
			JSON.stringify(extra),
		);
	}
	assertEquals(test.zalo.requests(), [], "Zalo was not called");
});
