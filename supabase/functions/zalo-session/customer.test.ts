import {
	createFakeBackend,
	createMockZalo,
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
const TENANT = "11111111-1111-4111-8111-111111111111";
const APP = "33333333-3333-4333-8333-333333333333";
const ZALO_USER = "8800000000000000042";
const ZALO_NAME = "Khách thử";
const PHONE_LOCAL = "0900000789";
const PHONE = `+84${PHONE_LOCAL.slice(1)}`;
const POLICY = "privacy-1";
const LOGIN_ID = "00000000-0000-4000-8000-0000000000c1";
const ENVIRONMENT: FunctionEnvironment = {
	ZALO_APP_SECRET_BRAND_1: APP_SECRET,
};
const FUNCTION_URL = "http://127.0.0.1:54321/functions/v1/zalo-session";
const SHOWN_AT = "2026-11-18T03:00:00.000Z";

interface Harness {
	readonly zalo: MockZalo;
	readonly backend: FakeBackend;
	readonly lines: string[];
	readonly token: string;
	send(body: unknown): Promise<Response>;
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
	backend.setCustomerPolicy(TENANT, POLICY);
	backend.addCustomerStore(TENANT, "mau-1");
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
		send(body) {
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
					backend,
					log: (line) => lines.push(line),
					requestId: () => "request-1",
					newLoginId: () => LOGIN_ID,
				},
			);
		},
	};
}

function join(
	phoneToken: string,
	overrides: Readonly<Record<string, unknown>> = {},
) {
	return {
		phone_token: phoneToken,
		loyalty_consent: true,
		marketing_consent: false,
		policy_version: POLICY,
		screen_version: "join-1",
		store: "mau-1",
		shown_at: SHOWN_AT,
		...overrides,
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

Deno.test("a first open gets a visitor session from a new customer login with the customer claims", async () => {
	const test = harness();
	const response = await test.send({
		kind: "customer",
		access_token: test.token,
		brand: "brand-1",
	});
	assertEquals(response.status, 200, "status");
	const body = await response.json();
	const [login] = test.backend.logins();
	assert(login !== undefined, "a login was created");
	assertEquals(
		login.email,
		`customer-${LOGIN_ID}@zalo-customer.invalid`,
		"login e-mail",
	);
	assertEquals(
		test.backend.appMetadataOf(login.userId),
		{ kind: "customer", tenant_id: TENANT, customer_id: null },
		"app metadata",
	);
	const [session] = test.backend.minted();
	assert(session !== undefined, "a session was minted");
	assertEquals(
		body,
		{
			status: "customer",
			access_token: session.accessToken,
			refresh_token: session.refreshToken,
			expires_at: session.expiresAt,
			customer: {
				tenant_id: TENANT,
				customer_id: null,
				display_name: ZALO_NAME,
			},
		},
		"answer",
	);
	const again = await test.send({
		kind: "customer",
		access_token: test.token,
		brand: "brand-1",
	});
	assertEquals(again.status, 200, "second status");
	assertEquals(test.backend.logins().length, 1, "one login");
	assertEquals(
		test.backend.calls().filter((call) => call === "createLogin").length,
		1,
		"one login created",
	);
	assertEquals(
		test.zalo.requests().filter((request) => request.path.includes("/me/info"))
			.length,
		0,
		"no phone call without a join",
	);
	assertNoPersonalData(test.lines, [
		test.token,
		ZALO_USER,
		ZALO_NAME,
		login.email,
	]);
});

Deno.test("joining decodes the phone once, records the consents with their evidence and puts the customer in the claims", async () => {
	const test = harness();
	const phoneToken = test.zalo.issuePhoneToken(test.token, PHONE_LOCAL);
	const response = await test.send({
		kind: "customer",
		access_token: test.token,
		brand: "brand-1",
		join: join(phoneToken),
	});
	assertEquals(response.status, 200, "status");
	const body = await response.json();
	const [customer] = test.backend.customers();
	assert(customer !== undefined, "a customer was created");
	assertEquals(customer.phone, PHONE, "the phone in E.164");
	assertEquals(customer.zaloUserId, ZALO_USER, "the Zalo user id");
	assertEquals(body.customer.customer_id, customer.customerId, "customer id");
	assertEquals(
		body.joined,
		{
			membership_id: customer.customerId.replace("-9000-", "-a000-"),
			welcome_stamps: 1,
			already_member: false,
		},
		"join outcome",
	);
	assertEquals(
		test.backend
			.customerConsents()
			.map((consent) => [
				consent.purpose,
				consent.policyVersion,
				consent.screenVersion,
				consent.shownAt,
				consent.channel,
			]),
		[["loyalty", POLICY, "join-1", SHOWN_AT, "mini_app"]],
		"only the loyalty consent",
	);
	const [login] = test.backend.logins();
	assert(login !== undefined, "a login exists");
	assertEquals(
		test.backend.appMetadataOf(login.userId),
		{ kind: "customer", tenant_id: TENANT, customer_id: customer.customerId },
		"the customer claim",
	);
	const reused = await test.send({
		kind: "customer",
		access_token: test.token,
		brand: "brand-1",
		join: join(phoneToken),
	});
	assertEquals(reused.status, 409, "a used phone token");
	assertEquals((await reused.json()).error, "phone_token_used", "used code");
	assertNoPersonalData(test.lines, [
		PHONE,
		PHONE_LOCAL,
		phoneToken,
		test.token,
	]);
});

Deno.test("a marketing consent is recorded only when its toggle was ticked", async () => {
	const test = harness();
	const phoneToken = test.zalo.issuePhoneToken(test.token, PHONE_LOCAL);
	const response = await test.send({
		kind: "customer",
		access_token: test.token,
		brand: "brand-1",
		join: join(phoneToken, { marketing_consent: true, store: null }),
	});
	assertEquals(response.status, 200, "status");
	assertEquals(
		test.backend.customerConsents().map((consent) => consent.purpose),
		["loyalty", "marketing"],
		"both consents",
	);
});

Deno.test("an expired phone token is refused and nothing is joined", async () => {
	const test = harness();
	const phoneToken = test.zalo.issuePhoneToken(test.token, PHONE_LOCAL);
	test.zalo.advance(121_000);
	const response = await test.send({
		kind: "customer",
		access_token: test.token,
		brand: "brand-1",
		join: join(phoneToken),
	});
	assertEquals(response.status, 422, "status");
	assertEquals((await response.json()).error, "phone_token_refused", "error");
	assertEquals(test.backend.customers().length, 0, "no customer");
	assertEquals(test.backend.customerConsents().length, 0, "no consent");
});

Deno.test("joining without the loyalty consent is refused before any phone exchange", async () => {
	const test = harness();
	const phoneToken = test.zalo.issuePhoneToken(test.token, PHONE_LOCAL);
	const response = await test.send({
		kind: "customer",
		access_token: test.token,
		brand: "brand-1",
		join: join(phoneToken, { loyalty_consent: false }),
	});
	assertEquals(response.status, 400, "status");
	assertEquals(
		(await response.json()).error,
		"loyalty_consent_required",
		"error",
	);
	assertEquals(test.zalo.requests().length, 0, "no Zalo call");
	assertEquals(test.backend.logins().length, 0, "no login");
});

Deno.test("an old policy version, an unknown store and a phone of another Zalo user are refused with their codes", async () => {
	const test = harness();
	for (const [overrides, status, error] of [
		[{ policy_version: "privacy-0" }, 409, "policy_outdated"],
		[{ store: "mau-9" }, 404, "unknown_store"],
	] as const) {
		const phoneToken = test.zalo.issuePhoneToken(test.token, PHONE_LOCAL);
		const response = await test.send({
			kind: "customer",
			access_token: test.token,
			brand: "brand-1",
			join: join(phoneToken, overrides),
		});
		assertEquals(response.status, status, `${error} status`);
		assertEquals((await response.json()).error, error, "error");
	}
	const first = test.zalo.issuePhoneToken(test.token, PHONE_LOCAL);
	await test.send({
		kind: "customer",
		access_token: test.token,
		brand: "brand-1",
		join: join(first),
	});
	const other = test.zalo.issueAccessToken(APP_SECRET, {
		id: "8800000000000000043",
		name: "Khách khác",
	});
	const response = await handleZaloSession(
		new Request(FUNCTION_URL, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				kind: "customer",
				access_token: other,
				brand: "brand-1",
				join: join(test.zalo.issuePhoneToken(other, PHONE_LOCAL)),
			}),
		}),
		ENVIRONMENT,
		{
			fetch: test.zalo.fetch,
			backend: test.backend,
			log: () => undefined,
			newLoginId: () => "00000000-0000-4000-8000-0000000000c2",
		},
	);
	assertEquals(response.status, 409, "phone in use");
	assertEquals((await response.json()).error, "phone_in_use", "error");
	assertEquals(test.backend.customers().length, 1, "one customer");
});

Deno.test("a join while the tenant has no open programme is refused with 409 no_programme and joins nothing", async () => {
	const test = harness();
	test.backend.closeCustomerProgramme(TENANT);
	const phoneToken = test.zalo.issuePhoneToken(test.token, PHONE_LOCAL);
	const response = await test.send({
		kind: "customer",
		access_token: test.token,
		brand: "brand-1",
		join: join(phoneToken),
	});
	assertEquals(response.status, 409, "status");
	const body = await response.json();
	assertEquals(body.error, "no_programme", "error");
	assertEquals(body.request_id, "request-1", "request id");
	assertEquals(test.backend.customers().length, 0, "no customer");
	assertEquals(test.backend.customerConsents().length, 0, "no consent");
	assertEquals(test.backend.minted().length, 0, "no session minted");
	assert(
		test.lines.some((line) => line.includes("join refused: no_programme")),
		"the refusal is logged by its reason",
	);
	const visitor = await test.send({
		kind: "customer",
		access_token: test.token,
		brand: "brand-1",
	});
	assertEquals(visitor.status, 200, "browsing still signs in");
	assertEquals(
		(await visitor.json()).customer.customer_id,
		null,
		"as a visitor",
	);
	assertNoPersonalData(test.lines, [
		PHONE,
		PHONE_LOCAL,
		phoneToken,
		test.token,
	]);
});

Deno.test("a refused Zalo token, a wrong kind and staff fields on a customer request are refused", async () => {
	const test = harness();
	const refused = await test.send({
		kind: "customer",
		access_token: "not-a-token",
		brand: "brand-1",
	});
	assertEquals(refused.status, 401, "refused token");
	assertEquals((await refused.json()).error, "zalo_token_refused", "error");
	for (const body of [
		{ kind: "staff", access_token: test.token, brand: "brand-1" },
		{
			kind: "customer",
			access_token: test.token,
			brand: "brand-1",
			binding_code: "123456",
		},
	]) {
		const response = await test.send(body);
		assertEquals(response.status, 400, "status");
		assertEquals((await response.json()).error, "invalid_kind", "error");
	}
	const badJoin = await test.send({
		kind: "customer",
		access_token: test.token,
		brand: "brand-1",
		join: join("phone", { shown_at: "yesterday" }),
	});
	assertEquals(badJoin.status, 400, "bad join");
	assertEquals((await badJoin.json()).error, "invalid_join", "error");
	assertEquals(test.backend.logins().length, 0, "no login");
});
