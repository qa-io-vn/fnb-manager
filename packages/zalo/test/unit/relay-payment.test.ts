import { describe, expect, it } from "vitest";
import {
	graphCallOf,
	importRelayKey,
	newRelayKey,
	openRelayRequest,
	PAYMENT_REFUND_PATH,
	PAYMENT_REFUND_STATUS_PATH,
	PAYMENT_STATUS_PATH,
	paymentCallValid,
	RelayError,
	ReplayGuard,
	relayFetch,
	relayTargetOf,
	sealRelayAnswer,
	validateRelayRequest,
	ZALO_PAYMENT_ORIGIN,
	type ZaloRequestInit,
} from "../../src/index.js";

// zalo:unit/relay-payment (ADR-067): the relay's allow-list for Zalo's Checkout SDK server APIs. Equivalence classes and
// boundaries of each of the four calls (the exact fields, a 64-hex MAC, the amount from 1 to 100,000,000, a description
// of at most 100 characters on one line, resultCode 1, 0 or -1, the purchase path naming the body's app), and the
// security cases: any other path, method, header, field or origin is not carried, so a stolen relay key cannot turn
// the relay into a proxy for anything else.

const NOW = Date.parse("2026-11-28T04:00:00Z");
const MAC = "0123456789abcdef".repeat(4);
const APP = "synthetic-app-1";
const get: ZaloRequestInit = { method: "GET", headers: {} };
const post = (
	body: unknown,
	headers: Record<string, string> = { "content-type": "application/json" },
): ZaloRequestInit => ({
	method: "POST",
	headers,
	body: typeof body === "string" ? body : JSON.stringify(body),
});
const statusUrl = (query: string) =>
	`${ZALO_PAYMENT_ORIGIN}${PAYMENT_STATUS_PATH}?${query}`;
const refund = (overrides: Record<string, unknown> = {}) => ({
	appId: APP,
	transId: "t-1",
	amount: 35_000,
	description: "Hoàn tiền",
	mac: MAC,
	...overrides,
});
const purchase = (overrides: Record<string, unknown> = {}) => ({
	appId: APP,
	orderId: "zorder-1",
	resultCode: 1,
	mac: MAC,
	...overrides,
});
const purchaseUrl = (app = APP) =>
	`${ZALO_PAYMENT_ORIGIN}/api/transaction/${app}/purchase-payment`;

describe("the payment calls the relay carries", () => {
	it("carries the order status and the refund status with exactly three query fields", () => {
		expect(
			graphCallOf(statusUrl(`appId=${APP}&orderId=zorder-1&mac=${MAC}`), get),
		).toEqual({
			path: PAYMENT_STATUS_PATH,
			query: `appId=${APP}&orderId=zorder-1&mac=${MAC}`,
			headers: {},
		});
		expect(
			graphCallOf(
				`${ZALO_PAYMENT_ORIGIN}${PAYMENT_REFUND_STATUS_PATH}?appId=${APP}&refundId=r.1:2&mac=${MAC}`,
				get,
			)?.path,
		).toBe(PAYMENT_REFUND_STATUS_PATH);
	});

	it("carries a refund and a purchase report as JSON with exactly their fields", () => {
		expect(
			graphCallOf(
				`${ZALO_PAYMENT_ORIGIN}${PAYMENT_REFUND_PATH}`,
				post(refund()),
			)?.body,
		).toBe(JSON.stringify(refund()));
		for (const resultCode of [1, 0, -1]) {
			expect(
				graphCallOf(purchaseUrl(), post(purchase({ resultCode }))),
				`resultCode ${resultCode}`,
			).not.toBeNull();
		}
	});

	it("takes a refund of 1 and of 100,000,000 đồng and a description of 100 characters", () => {
		for (const overrides of [
			{ amount: 1 },
			{ amount: 100_000_000 },
			{ description: "x".repeat(100) },
			{ description: "" },
		]) {
			expect(
				paymentCallValid(
					PAYMENT_REFUND_PATH,
					"",
					JSON.stringify(refund(overrides)),
				),
				JSON.stringify(overrides),
			).toBe(true);
		}
	});

	it("refuses a refund of 0, a fraction, one đồng over, a text amount, a long or two-line description", () => {
		for (const overrides of [
			{ amount: 0 },
			{ amount: 1.5 },
			{ amount: 100_000_001 },
			{ amount: "35000" },
			{ description: "x".repeat(101) },
			{ description: "a\nb" },
			{ transId: "t 1" },
			{ mac: MAC.toUpperCase() },
			{ mac: MAC.slice(1) },
			{ extra: 1 },
		]) {
			expect(
				paymentCallValid(
					PAYMENT_REFUND_PATH,
					"",
					JSON.stringify(refund(overrides)),
				),
				JSON.stringify(overrides),
			).toBe(false);
		}
		expect(
			paymentCallValid(PAYMENT_REFUND_PATH, "", JSON.stringify({ appId: APP })),
		).toBe(false);
		expect(
			paymentCallValid(PAYMENT_REFUND_PATH, "x=1", JSON.stringify(refund())),
		).toBe(false);
		expect(paymentCallValid(PAYMENT_REFUND_PATH, "", "not json")).toBe(false);
		expect(paymentCallValid(PAYMENT_REFUND_PATH, "", "[]")).toBe(false);
	});

	it("refuses a purchase report for another app than its path, another result or extra fields", () => {
		expect(
			graphCallOf(purchaseUrl("synthetic-app-2"), post(purchase())),
		).toBeNull();
		for (const overrides of [
			{ resultCode: 2 },
			{ resultCode: "1" },
			{ orderId: "a/b" },
			{ note: "x" },
		]) {
			expect(
				graphCallOf(purchaseUrl(), post(purchase(overrides))),
				JSON.stringify(overrides),
			).toBeNull();
		}
	});

	it("refuses an extra, missing or repeated query field and an unshaped MAC", () => {
		for (const query of [
			`appId=${APP}&orderId=zorder-1&mac=${MAC}&privateKey=x`,
			`appId=${APP}&orderId=zorder-1`,
			`appId=${APP}&orderId=zorder-1&orderId=zorder-2&mac=${MAC}`,
			`appId=${APP}&orderId=zorder-1&mac=${MAC.slice(2)}`,
			`appId=${APP}&orderId=z%20order&mac=${MAC}`,
		]) {
			expect(graphCallOf(statusUrl(query), get), query).toBeNull();
		}
	});

	it("leaves to the network any other method, header, path or origin (security)", () => {
		const query = `appId=${APP}&orderId=zorder-1&mac=${MAC}`;
		expect(
			graphCallOf(statusUrl(query), { method: "POST", headers: {} }),
		).toBeNull();
		expect(
			graphCallOf(statusUrl(query), {
				method: "GET",
				headers: { authorization: "Bearer x" },
			}),
		).toBeNull();
		expect(
			graphCallOf(
				`${ZALO_PAYMENT_ORIGIN}${PAYMENT_REFUND_PATH}`,
				post(refund(), { "content-type": "text/plain" }),
			),
		).toBeNull();
		expect(
			graphCallOf(
				`${ZALO_PAYMENT_ORIGIN}${PAYMENT_REFUND_PATH}`,
				post(refund(), { "content-type": "application/json", cookie: "x" }),
			),
		).toBeNull();
		expect(
			graphCallOf(`${ZALO_PAYMENT_ORIGIN}${PAYMENT_REFUND_PATH}`, {
				method: "GET",
				headers: {},
			}),
		).toBeNull();
		expect(
			graphCallOf(
				`${ZALO_PAYMENT_ORIGIN}/api/transaction/${APP}/cod-callback-payment`,
				post(purchase()),
			),
		).toBeNull();
		expect(graphCallOf(`${ZALO_PAYMENT_ORIGIN}/api/anything`, get)).toBeNull();
		expect(
			graphCallOf(
				`http://payment-mini.zalo.me${PAYMENT_STATUS_PATH}?${query}`,
				get,
			),
		).toBeNull();
		expect(
			graphCallOf(
				`https://user:pw${"@"}payment-mini.zalo.me${PAYMENT_STATUS_PATH}?${query}`,
				get,
			),
		).toBeNull();
	});

	it("sends each call to Zalo with its method and only the JSON content type", () => {
		expect(
			relayTargetOf({ path: PAYMENT_STATUS_PATH, query: "a=1", headers: {} }),
		).toEqual({
			url: `${ZALO_PAYMENT_ORIGIN}${PAYMENT_STATUS_PATH}?a=1`,
			method: "GET",
			headers: {},
		});
		expect(
			relayTargetOf({
				path: PAYMENT_REFUND_PATH,
				query: "",
				headers: {},
				body: "{}",
			}),
		).toEqual({
			url: `${ZALO_PAYMENT_ORIGIN}${PAYMENT_REFUND_PATH}`,
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});
	});
});

describe("a relayed payment request", () => {
	const valid = {
		id: "aaaaaaaa-1111-4111-8111-111111111111",
		at: NOW,
		path: PAYMENT_REFUND_PATH,
		query: "",
		headers: {},
		body: JSON.stringify(refund()),
	};

	it("is accepted on the relay's side when it is exactly an allowed call", () => {
		expect(validateRelayRequest(valid, NOW)).toEqual(valid);
	});

	it("is refused with a header, another body or a path outside the list", () => {
		for (const request of [
			{ ...valid, headers: { secret_key: "x" } },
			{ ...valid, body: JSON.stringify(refund({ amount: 0 })) },
			{ ...valid, body: 5 },
			{ ...valid, path: "/api/transaction/x/custom-callback-payment" },
		]) {
			expect(() => validateRelayRequest(request, NOW)).toThrow(RelayError);
		}
	});

	it("travels sealed through relayFetch and comes back bound to its request", async () => {
		const key = await importRelayKey(newRelayKey());
		const guard = new ReplayGuard();
		let seen: string | undefined;
		const fetch = relayFetch({
			key,
			relayUrl: async () => "https://relay.example.com",
			now: () => NOW,
			newId: () => valid.id,
			fetch: async (url, init) => {
				expect(url).toBe("https://relay.example.com/relay");
				expect(init.body).not.toContain("Hoàn tiền");
				const request = await openRelayRequest(
					key,
					init.body ?? "",
					NOW,
					guard,
				);
				seen = request.body;
				return new Response(
					await sealRelayAnswer(key, request.id, {
						status: 200,
						body: '{"refundId":"r-1","returnCode":2}',
					}),
				);
			},
		});
		const response = await fetch(
			`${ZALO_PAYMENT_ORIGIN}${PAYMENT_REFUND_PATH}`,
			post(refund()),
		);
		expect(await response.json()).toEqual({ refundId: "r-1", returnCode: 2 });
		expect(seen).toBe(JSON.stringify(refund()));
	});
});
