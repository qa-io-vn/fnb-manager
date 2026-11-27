import { createOrderMacInput, hmacSha256Hex, parseVietQr } from "@fnb/payments";
import { UpstreamError } from "@fnb/zalo";
import type { FunctionEnvironment } from "../_shared/http.ts";
import {
	assert,
	assertEquals,
	bankRow,
	CHECKOUT_KEY,
	checkoutRow,
	ENVIRONMENT,
	fakeBackend,
	ORDER_ID,
	PAYMENT_ID,
	SESSION,
	USER_ID,
} from "../_shared/payments-fakes.ts";
import { handleCheckoutOrder } from "./handler.ts";

// checkout-order: the session decides who asks (never the body), the database decides the attempt, the provider makes
// what the device needs. Equivalence classes of requests (start, link, malformed, unknown fields, the counter's wallet),
// sessions (none, unknown), answers (pending, refused), provider rows (a missing secret, a mock where mocks are off);
// security: the private key never in an answer or a log, CORS only for the Mini App's and the counter's origins.

const URL_ = "http://127.0.0.1:54321/functions/v1/checkout-order";

function attempt(method: "vietqr" | "zalo_checkout", provider: unknown) {
	return {
		state: "pending",
		refusal: null,
		replayed: false,
		resumed: false,
		payment: {
			id: PAYMENT_ID,
			order_id: ORDER_ID,
			method,
			amount: 64000,
			reference: method === "vietqr" ? "FNB7K2M9Q4T" : "ZC7K2M9Q4T",
			expires_at: "2026-11-28T03:15:00+00:00",
			mode: "sandbox",
			platform_order_id: null,
		},
		provider,
		order: {
			store_name: "Cửa hàng mẫu",
			lines: [
				{ id: "line-1", amount: 35000 },
				{ id: "line-2", amount: 29000 },
			],
		},
	};
}

async function send(
	body: unknown,
	options: {
		readonly backend: ReturnType<typeof fakeBackend>;
		readonly session?: string | null;
		readonly environment?: FunctionEnvironment;
		readonly origin?: string;
		readonly lines?: string[];
	},
): Promise<Response> {
	const headers = new Headers({ "content-type": "application/json" });
	if (options.session !== null) {
		headers.set("authorization", `Bearer ${options.session ?? SESSION}`);
	}
	if (options.origin !== undefined) {
		headers.set("origin", options.origin);
	}
	return await handleCheckoutOrder(
		new Request(URL_, {
			method: "POST",
			headers,
			body: typeof body === "string" ? body : JSON.stringify(body),
		}),
		options.environment ?? ENVIRONMENT,
		{ backend: options.backend, log: (line) => options.lines?.push(line) },
	);
}

const start = (method: string, extra: Record<string, unknown> = {}) => ({
	action: "start",
	order_id: ORDER_ID,
	method,
	idempotency_key: "key-checkout-order-1",
	...extra,
});

Deno.test("a VietQR start answers the dynamic payload of the attempt, asked for the session's user", async () => {
	const backend = fakeBackend({
		checkout_begin: () => attempt("vietqr", bankRow),
	});
	const response = await send(start("vietqr", { user_id: "ignored" }), {
		backend,
	});
	assertEquals(response.status, 400, "a body naming a user is refused");
	const ok = await send(start("vietqr"), { backend });
	assertEquals(ok.status, 200, "status");
	const answer = await ok.json();
	assertEquals(answer.state, "pending", "state");
	assertEquals(answer.payment.checkout, null, "no checkout for a VietQR");
	assertEquals(
		answer.payment.qr.popup_method,
		"BANK_SANDBOX",
		"the sandbox popup",
	);
	assertEquals(
		parseVietQr(answer.payment.qr.payload)?.amount,
		64000,
		"the amount in the payload",
	);
	assertEquals(
		parseVietQr(answer.payment.qr.payload)?.purpose,
		"FNB7K2M9Q4T",
		"the reference in the payload",
	);
	assertEquals(
		backend.callsTo("checkout_begin")[0]?.args,
		{
			p_request: {
				user_id: USER_ID,
				order_id: ORDER_ID,
				method: "vietqr",
				idempotency_key: "key-checkout-order-1",
				for: "customer",
			},
		},
		"the database is asked for the session's user",
	);
});

Deno.test("a wallet start answers createOrder's parameters with the MAC made here, and the key stays here", async () => {
	const lines: string[] = [];
	const backend = fakeBackend({
		checkout_begin: () => attempt("zalo_checkout", checkoutRow),
	});
	const response = await send(start("zalo_checkout"), { backend, lines });
	const text = await response.text();
	const answer = JSON.parse(text);
	const checkout = answer.payment.checkout;
	assertEquals(answer.payment.qr, null, "no QR for a wallet");
	assertEquals(
		checkout.mac,
		await hmacSha256Hex(CHECKOUT_KEY, createOrderMacInput(checkout)),
		"the MAC signs what the app sends",
	);
	assertEquals(
		JSON.parse(checkout.method),
		{ id: "ZALOPAY_SANDBOX", isCustom: false },
		"the sandbox wallet is forced",
	);
	assert(!text.includes(CHECKOUT_KEY), "the private key is not in the answer");
	assert(!lines.join("\n").includes(CHECKOUT_KEY), "nor in the log");
	assert(!lines.join("\n").includes(SESSION), "nor the session");
});

Deno.test("a refusal of the database is answered as data, without a payment", async () => {
	const backend = fakeBackend({
		checkout_begin: () => ({
			state: "refused",
			refusal: "provider_off",
			replayed: false,
			payment: null,
		}),
	});
	const response = await send(start("vietqr"), { backend });
	assertEquals(
		await response.json(),
		{
			state: "refused",
			refusal: "provider_off",
			replayed: false,
			payment: null,
		},
		"refused",
	);
});

Deno.test("no session, an unknown session and malformed requests are refused before the database", async () => {
	const backend = fakeBackend({
		checkout_begin: () => attempt("vietqr", bankRow),
	});
	assertEquals(
		(await send(start("vietqr"), { backend, session: null })).status,
		401,
		"no session",
	);
	assertEquals(
		(await send(start("vietqr"), { backend, session: "someone-else" })).status,
		401,
		"unknown session",
	);
	for (const body of [
		start("cash"),
		start("vietqr", { order_id: "not-a-uuid" }),
		start("vietqr", { idempotency_key: "short" }),
		start("zalo_checkout", { for: "counter" }),
		start("vietqr", { for: "admin" }),
		{ action: "delete", order_id: ORDER_ID },
		"[]",
		"{",
	]) {
		const response = await send(body, { backend });
		assert(
			response.status === 400,
			`${JSON.stringify(body)}: expected 400, got ${response.status}`,
		);
	}
	assertEquals(
		backend.callsTo("checkout_begin").length,
		0,
		"the database was never asked",
	);
});

Deno.test("a provider row naming an unset secret, or a mock where mocks are off, is not configured", async () => {
	const backend = fakeBackend({
		checkout_begin: () => attempt("vietqr", bankRow),
	});
	const noSecret = await send(start("vietqr"), {
		backend,
		environment: { PAYMENTS_MOCK: "on" },
	});
	assertEquals(
		[noSecret.status, (await noSecret.json()).error],
		[500, "not_configured"],
		"missing secret",
	);
	const mocksOff = await send(start("vietqr"), {
		backend,
		environment: { PAYMENT_BANK_BRAND_1: "x" },
	});
	assertEquals(
		[mocksOff.status, (await mocksOff.json()).error],
		[500, "not_configured"],
		"mock off",
	);
});

Deno.test("a link passes Zalo's order id for the session's user and answers the database's outcome", async () => {
	const backend = fakeBackend({
		checkout_link: () => ({ state: "linked", refusal: null }),
	});
	const response = await send(
		{
			action: "link",
			order_id: ORDER_ID,
			payment_id: PAYMENT_ID,
			platform_order_id: "zorder-1",
		},
		{ backend },
	);
	assertEquals(
		await response.json(),
		{ state: "linked", refusal: null },
		"linked",
	);
	assertEquals(
		backend.callsTo("checkout_link")[0]?.args,
		{
			p_request: {
				user_id: USER_ID,
				order_id: ORDER_ID,
				payment_id: PAYMENT_ID,
				platform_order_id: "zorder-1",
				for: "customer",
			},
		},
		"the link request",
	);
	const bad = await send(
		{
			action: "link",
			order_id: ORDER_ID,
			payment_id: PAYMENT_ID,
			platform_order_id: "a b",
		},
		{ backend },
	);
	assertEquals(bad.status, 400, "an order id with a space is refused");
});

Deno.test("CORS lets in the Mini App and the counter's configured origin, nothing else", async () => {
	const backend = fakeBackend({
		checkout_begin: () => attempt("vietqr", bankRow),
	});
	const environment = {
		...ENVIRONMENT,
		COUNTER_REDIRECT_URIS: "https://counter.example.com/",
	};
	for (const [origin, allowed] of [
		["https://h5.zdn.vn", true],
		["https://counter.example.com", true],
		["https://evil.example.com", false],
	] as const) {
		const response = await send(start("vietqr"), {
			backend,
			environment,
			origin,
		});
		assertEquals(
			response.headers.get("access-control-allow-origin") === origin,
			allowed,
			origin,
		);
	}
});

Deno.test("an unreachable database is 503, never a guess", async () => {
	const backend = fakeBackend({});
	const unreachable = {
		...backend,
		rpc: () => Promise.reject(new UpstreamError("supabase", "network")),
	};
	const response = await handleCheckoutOrder(
		new Request(URL_, {
			method: "POST",
			headers: {
				authorization: `Bearer ${SESSION}`,
				"content-type": "application/json",
			},
			body: JSON.stringify(start("vietqr")),
		}),
		ENVIRONMENT,
		{ backend: unreachable },
	);
	assertEquals(response.status, 503, "status");
});
