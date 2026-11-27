import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createPaymentClient,
	PAYMENT_NETWORK_FAILURE,
	PaymentError,
} from "../../src/ordering/fetch-payment-client";
import { vietQrPayload } from "../../src/ordering/payment-contract";

// Test design (ISTQB) for the fetch client of checkout-order:
// - the request: the address under /functions/v1, the session's bearer token and the publishable key, a JSON body
//   with ids only (no price), the counter's form, and a token read at each call when it is a function;
// - equivalence partitions of the answer: 200 pending, 200 refused, a 4xx/5xx with the error shape, a 5xx without it,
//   an unreadable 200, no answer at all (network), a timeout, and an answer about another order or method (refused);
// - security: no call leaves without a token, and a malformed request never leaves the app.

const ORDER = "66666666-6666-4666-8666-666666666601";
const OTHER_ORDER = "66666666-6666-4666-8666-666666666602";
const PAYMENT = "77777777-7777-4777-8777-777777777701";

interface Sent {
	readonly url: string;
	readonly init: RequestInit;
}

function recorder(answer: () => Response | Promise<Response>) {
	const sent: Sent[] = [];
	const send: typeof fetch = async (input, init) => {
		sent.push({ url: String(input), init: init ?? {} });
		return answer();
	};
	return { sent, send };
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function transfer(orderId = ORDER) {
	return {
		state: "pending",
		refusal: null,
		replayed: false,
		payment: {
			id: PAYMENT,
			order_id: orderId,
			method: "vietqr",
			amount: 29000,
			reference: "FNB12345678",
			expires_at: "2026-11-27T10:15:00.000Z",
			mode: "sandbox",
			checkout: null,
			qr: {
				payload: vietQrPayload({
					bankBin: "970400",
					accountNumber: "0123456789",
					amount: 29000,
					reference: "FNB12345678",
				}),
				bank_bin: "970400",
				bank_name: "Ngân hàng Mẫu",
				account_number: "0123456789",
				account_name: "CUA HANG MAU",
				amount: 29000,
				reference: "FNB12345678",
				popup_method: "BANK_SANDBOX",
			},
		},
	};
}

function client(
	send: typeof fetch,
	accessToken: string | (() => string | null) = "session-test",
) {
	return createPaymentClient({
		url: "https://project.example.com/",
		publishableKey: "publishable-test",
		accessToken,
		fetch: send,
	});
}

afterEach(() => {
	vi.useRealTimers();
});

describe("the checkout-order client", () => {
	it("starts an attempt at the function with the session and the publishable key, sending ids only", async () => {
		const { sent, send } = recorder(() => json(transfer()));
		const answer = await client(send).start({
			orderId: ORDER,
			method: "vietqr",
			idempotencyKey: "key-12345678",
		});
		expect(answer.state).toBe("pending");
		expect(sent).toHaveLength(1);
		expect(sent[0]?.url).toBe(
			"https://project.example.com/functions/v1/checkout-order",
		);
		const headers = sent[0]?.init.headers as Record<string, string>;
		expect(headers.Authorization).toBe("Bearer session-test");
		expect(headers.apikey).toBe("publishable-test");
		expect(headers["content-type"]).toBe("application/json");
		expect(sent[0]?.init.method).toBe("POST");
		expect(JSON.parse(String(sent[0]?.init.body))).toEqual({
			action: "start",
			order_id: ORDER,
			method: "vietqr",
			idempotency_key: "key-12345678",
		});
	});

	it("sends the counter's form and reads the current token of a session that refreshes", async () => {
		const { sent, send } = recorder(() => json(transfer()));
		let token = "first-token";
		const payments = client(send, () => token);
		await payments.start({
			orderId: ORDER,
			method: "vietqr",
			idempotencyKey: "key-12345678",
			forCounter: true,
		});
		token = "second-token";
		await payments.start({
			orderId: ORDER,
			method: "vietqr",
			idempotencyKey: "key-12345678",
			forCounter: true,
		});
		expect(JSON.parse(String(sent[0]?.init.body)).for).toBe("counter");
		expect(
			sent.map(
				(call) => (call.init.headers as Record<string, string>).Authorization,
			),
		).toEqual(["Bearer first-token", "Bearer second-token"]);
	});

	it("takes a function served on its own address", async () => {
		const { sent, send } = recorder(() =>
			json({ state: "linked", refusal: null }),
		);
		const payments = createPaymentClient({
			url: "https://project.example.com",
			publishableKey: "publishable-test",
			accessToken: "session-test",
			endpoint: "http://127.0.0.1:5768",
			fetch: send,
		});
		expect(
			await payments.link({
				orderId: ORDER,
				paymentId: PAYMENT,
				platformOrderId: "zp-1",
			}),
		).toEqual({ state: "linked" });
		expect(sent[0]?.url).toBe("http://127.0.0.1:5768");
		expect(JSON.parse(String(sent[0]?.init.body))).toEqual({
			action: "link",
			order_id: ORDER,
			payment_id: PAYMENT,
			platform_order_id: "zp-1",
		});
	});

	it("reads a refusal as an answer, not an error", async () => {
		const { send } = recorder(() =>
			json({
				state: "refused",
				refusal: "too_many_attempts",
				replayed: false,
				payment: null,
			}),
		);
		expect(
			await client(send).start({
				orderId: ORDER,
				method: "vietqr",
				idempotencyKey: "key-12345678",
			}),
		).toEqual({ state: "refused", refusal: "too_many_attempts" });
	});

	it.each([
		[400, "invalid_request"],
		[401, "unauthorized"],
		[413, "body_too_large"],
		[502, "provider_unavailable"],
		[503, "backend_unavailable"],
		[500, "internal_error"],
	] as const)(
		"turns a %s with %s into a payment error with its code and request id",
		async (status, code) => {
			const { send } = recorder(() =>
				json({ error: code, request_id: "req-9" }, status),
			);
			const error = await client(send)
				.start({
					orderId: ORDER,
					method: "vietqr",
					idempotencyKey: "key-12345678",
				})
				.catch((caught: unknown) => caught);
			expect(error).toBeInstanceOf(PaymentError);
			expect((error as PaymentError).status).toBe(status);
			expect((error as PaymentError).code).toBe(code);
			expect((error as PaymentError).requestId).toBe("req-9");
			expect((error as PaymentError).retryable).toBe(status >= 500);
		},
	);

	it("turns a server error without the error shape into a payment error without a code", async () => {
		const { send } = recorder(
			() => new Response("<html>bad gateway</html>", { status: 502 }),
		);
		const error = await client(send)
			.start({
				orderId: ORDER,
				method: "vietqr",
				idempotencyKey: "key-12345678",
			})
			.catch((caught: unknown) => caught);
		expect(error).toMatchObject({ status: 502, code: null, requestId: null });
	});

	it("treats no answer and an unreadable 200 as a network failure the same key may retry", async () => {
		const lost = await client(async () => {
			throw new TypeError("offline");
		})
			.start({
				orderId: ORDER,
				method: "vietqr",
				idempotencyKey: "key-12345678",
			})
			.catch((caught: unknown) => caught);
		expect(lost).toBeInstanceOf(PaymentError);
		expect((lost as PaymentError).status).toBe(PAYMENT_NETWORK_FAILURE);
		expect((lost as PaymentError).network).toBe(true);
		const garbled = await client(
			async () => new Response("not json", { status: 200 }),
		)
			.start({
				orderId: ORDER,
				method: "vietqr",
				idempotencyKey: "key-12345678",
			})
			.catch((caught: unknown) => caught);
		expect((garbled as PaymentError).network).toBe(true);
	});

	it("gives up after the timeout", async () => {
		vi.useFakeTimers();
		const send: typeof fetch = (_input, init) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () =>
					reject(new Error("aborted")),
				);
			});
		const pending = createPaymentClient({
			url: "https://project.example.com",
			publishableKey: "k",
			accessToken: "t",
			fetch: send,
			timeoutMs: 1000,
		})
			.start({
				orderId: ORDER,
				method: "vietqr",
				idempotencyKey: "key-12345678",
			})
			.catch((caught: unknown) => caught);
		await vi.advanceTimersByTimeAsync(1000);
		expect(((await pending) as PaymentError).network).toBe(true);
	});

	it("refuses an answer about another order or another method", async () => {
		const other = await client(recorder(() => json(transfer(OTHER_ORDER))).send)
			.start({
				orderId: ORDER,
				method: "vietqr",
				idempotencyKey: "key-12345678",
			})
			.catch((caught: unknown) => caught);
		expect(String(other)).toMatch(/another order/);
		const method = await client(recorder(() => json(transfer())).send)
			.start({
				orderId: ORDER,
				method: "zalo_checkout",
				idempotencyKey: "key-12345678",
			})
			.catch((caught: unknown) => caught);
		expect(String(method)).toMatch(/another order or method/);
	});

	it("sends nothing without a token, nor a malformed request", async () => {
		const { sent, send } = recorder(() => json(transfer()));
		await expect(
			client(send, () => null).start({
				orderId: ORDER,
				method: "vietqr",
				idempotencyKey: "key-12345678",
			}),
		).rejects.toMatchObject({ status: 401, code: "unauthorized" });
		await expect(
			client(send).start({
				orderId: "../rest/v1",
				method: "vietqr",
				idempotencyKey: "key-12345678",
			}),
		).rejects.toThrow(/UUID/);
		await expect(
			client(send).link({
				orderId: ORDER,
				paymentId: PAYMENT,
				platformOrderId: "a/b",
			}),
		).rejects.toThrow(/Zalo order id/);
		expect(sent).toHaveLength(0);
	});

	it("refuses a malformed 200", async () => {
		await expect(
			client(
				recorder(() => json({ state: "pending", payment: { id: "x" } })).send,
			).start({
				orderId: ORDER,
				method: "vietqr",
				idempotencyKey: "key-12345678",
			}),
		).rejects.toThrow(/payment answer/);
	});
});
