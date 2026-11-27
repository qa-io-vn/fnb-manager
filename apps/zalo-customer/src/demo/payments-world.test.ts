import {
	createMemoryStorage,
	createZaloCustomerSessionClient,
} from "@fnb/zalo-mini";
import {
	createPaymentClient,
	createRestOrderingClient,
	isVietQrPayload,
	type OrderingClient,
	type PaymentClient,
	PaymentError,
} from "@fnb/zalo-mini/ordering";
import { describe, expect, it } from "vitest";
import {
	DEMO_BANK,
	DEMO_ORDERING_STORE,
	DEMO_SIZES,
} from "./ordering-fixtures";
import { createOrderingWorld } from "./ordering-world";
import { createDemoWorld, DEMO_DEFAULTS } from "./world";

// Test design (ISTQB) for the demo world's online payments, the stand-in of the server, the gateway and the bank that
// the browser tests run on (it must answer as checkout-order is specified, or the app is tested against a fiction):
// - state transitions of an order paid online: placed → awaiting_payment (no number) → accepted with a number by the
//   gateway or the bank's exact transfer; → stays waiting on a failed attempt or another amount; → cancelled with
//   payment_timeout by the window, after which a transfer matches no attempt;
// - equivalence partitions of start: a new attempt, the same key (replayed), a new key while one is pending (the same
//   attempt resumed), a new key after a failure (a new attempt), the fourth after three failures (too_many_attempts),
//   and each refusal (provider_off, method_differs, not_awaiting_payment, already_paid, order_cancelled, unknown_order
//   for another customer's order: no IDOR); a malformed body (400) and no session (401);
// - link: linked while pending, not_pending after, unknown_payment for another order's payment.

const START = Date.UTC(2026, 10, 27, 3, 0, 0);
const CAKE = DEMO_SIZES.bananaCake;
const TABLE = "demo-table-12";

async function setup(onlinePayments = true) {
	let clock = START;
	const world = createDemoWorld(
		{ ...DEMO_DEFAULTS, onlinePayments },
		() => clock,
	);
	const ordering = createOrderingWorld(world.now, null, onlinePayments);
	world.extend(ordering);
	const sessions = createZaloCustomerSessionClient({
		endpoint: "demo",
		brandKey: "brand-1",
		publishableKey: "demo",
		storage: createMemoryStorage(),
		getAccessToken: async () => "mock-zalo-access-token",
		fetch: world.sessionFetch,
		now: () => clock,
	});
	const state = await sessions.connect();
	if (state.status !== "ready") throw new Error("no session");
	const token = state.session.accessToken;
	const client: OrderingClient = createRestOrderingClient(world.rest(token));
	const payments: PaymentClient = createPaymentClient({
		url: "stand-in:",
		publishableKey: "stand-in",
		accessToken: token,
		fetch: world.functionFetch,
	});
	let requests = 0;
	const place = async (payment: "counter" | "zalo_checkout" | "vietqr") => {
		requests += 1;
		const answer = await client.placeOrder({
			request_id: `12345678-1234-4234-8234-${String(requests).padStart(12, "0")}`,
			store: DEMO_ORDERING_STORE,
			type: "table",
			table_token: TABLE,
			lines: [{ size: CAKE, qty: 2 }],
			payment,
			expected_total: 50000,
		});
		if (answer.order === null) throw new Error(`refused: ${answer.refusal}`);
		return answer;
	};
	return {
		world,
		till: ordering.till,
		client,
		payments,
		place,
		tick: (ms: number) => {
			clock += ms;
		},
	};
}

describe("an order paid online in the demo world", () => {
	it("waits for its payment without a number, and the wallet's gateway accepts it with one", async () => {
		const demo = await setup();
		const placed = await demo.place("zalo_checkout");
		expect(placed.state).toBe("awaiting_payment");
		expect(placed.order?.displayNo).toBeNull();
		expect(placed.order?.paymentDueAt).toBe(
			new Date(START + 15 * 60_000).toISOString(),
		);
		const id = placed.order?.id ?? "";
		const start = await demo.payments.start({
			orderId: id,
			method: "zalo_checkout",
			idempotencyKey: "key-00000001",
		});
		if (start.state !== "pending") throw new Error("not pending");
		expect(start.payment.checkout?.amount).toBe(50000);
		expect(start.payment.checkout?.mac).toMatch(/^[0-9a-f]{64}$/);
		expect(start.payment.qr).toBeNull();
		expect(
			await demo.payments.link({
				orderId: id,
				paymentId: start.payment.id,
				platformOrderId: "standin-1",
			}),
		).toEqual({ state: "linked" });
		expect(demo.till.walletResult(id, "paid")).toBe("accepted");
		const order = await demo.client.order(id);
		if (order.state !== "ok") throw new Error("no order");
		expect(order.order.status).toBe("accepted");
		expect(order.order.paymentStatus).toBe("paid");
		expect(order.order.displayNo).toBe("#002");
		expect(order.order.money?.payments).toEqual([
			expect.objectContaining({ id: start.payment.id, status: "succeeded" }),
		]);
		expect(
			await demo.payments.link({
				orderId: id,
				paymentId: start.payment.id,
				platformOrderId: "standin-2",
			}),
		).toEqual({ state: "refused", refusal: "not_pending" });
	});

	it("pays by an exact transfer, holds another amount, and answers an unknown reference as unknown", async () => {
		const demo = await setup();
		const id = (await demo.place("vietqr")).order?.id ?? "";
		const start = await demo.payments.start({
			orderId: id,
			method: "vietqr",
			idempotencyKey: "key-00000001",
		});
		if (start.state !== "pending" || start.payment.qr === null)
			throw new Error("no QR");
		expect(start.payment.qr).toMatchObject({
			bankBin: DEMO_BANK.bin,
			accountNumber: DEMO_BANK.accountNumber,
			accountName: DEMO_BANK.accountName,
			amount: 50000,
		});
		expect(isVietQrPayload(start.payment.qr.payload, 50000)).toBe(true);
		const reference = start.payment.reference;
		expect(demo.till.reference(id)).toBe(reference);
		expect(demo.till.bankTransfer(reference, 49000)).toBe("held");
		expect(demo.till.bankTransfer(reference, 50001)).toBe("held");
		expect(demo.till.bankTransfer("FNB-NOT-OURS", 50000)).toBe("unknown");
		let order = await demo.client.order(id);
		expect(order.state === "ok" && order.order.status).toBe("awaiting_payment");
		expect(demo.till.bankTransfer(reference.toLowerCase(), 50000)).toBe("paid");
		order = await demo.client.order(id);
		expect(order.state === "ok" && order.order.status).toBe("accepted");
		expect(order.state === "ok" && order.order.paymentStatus).toBe("paid");
	});

	it("is cancelled with payment_timeout when the window passes, after which a transfer matches nothing", async () => {
		const demo = await setup();
		const id = (await demo.place("vietqr")).order?.id ?? "";
		const start = await demo.payments.start({
			orderId: id,
			method: "vietqr",
			idempotencyKey: "key-00000001",
		});
		if (start.state !== "pending") throw new Error("not pending");
		expect(demo.till.expirePayment(id)).toBe("cancelled");
		const order = await demo.client.order(id);
		expect(order.state === "ok" && order.order.cancelReason).toBe(
			"payment_timeout",
		);
		expect(demo.till.bankTransfer(start.payment.reference, 50000)).toBe(
			"unknown",
		);
		expect(
			await demo.payments.start({
				orderId: id,
				method: "vietqr",
				idempotencyKey: "key-00000002",
			}),
		).toEqual({ state: "refused", refusal: "order_cancelled" });
	});
});

describe("the stand-in checkout-order", () => {
	it("replays the same key, resumes a pending attempt under a new key, and opens a new one after a failure", async () => {
		const demo = await setup();
		const id = (await demo.place("zalo_checkout")).order?.id ?? "";
		const first = await demo.payments.start({
			orderId: id,
			method: "zalo_checkout",
			idempotencyKey: "key-00000001",
		});
		const replay = await demo.payments.start({
			orderId: id,
			method: "zalo_checkout",
			idempotencyKey: "key-00000001",
		});
		const resumed = await demo.payments.start({
			orderId: id,
			method: "zalo_checkout",
			idempotencyKey: "key-00000002",
		});
		if (
			first.state !== "pending" ||
			replay.state !== "pending" ||
			resumed.state !== "pending"
		)
			throw new Error("not pending");
		expect(replay.replayed).toBe(true);
		expect(replay.payment.id).toBe(first.payment.id);
		expect(resumed.payment.id).toBe(first.payment.id);
		expect(resumed.payment.reference).toBe(first.payment.reference);
		expect(demo.till.attempts(id)).toBe(1);
		demo.till.walletResult(id, "failed");
		const second = await demo.payments.start({
			orderId: id,
			method: "zalo_checkout",
			idempotencyKey: "key-00000003",
		});
		if (second.state !== "pending") throw new Error("not pending");
		expect(second.payment.id).not.toBe(first.payment.id);
		expect(demo.till.attempts(id)).toBe(2);
	});

	it("refuses a fourth attempt after three failures (boundary: 3 failed, then too_many_attempts)", async () => {
		const demo = await setup();
		const id = (await demo.place("zalo_checkout")).order?.id ?? "";
		for (let attempt = 1; attempt <= 3; attempt += 1) {
			const answer = await demo.payments.start({
				orderId: id,
				method: "zalo_checkout",
				idempotencyKey: `key-0000000${attempt}`,
			});
			expect(answer.state).toBe("pending");
			demo.till.walletResult(id, "failed");
		}
		expect(
			await demo.payments.start({
				orderId: id,
				method: "zalo_checkout",
				idempotencyKey: "key-00000004",
			}),
		).toEqual({ state: "refused", refusal: "too_many_attempts" });
	});

	it.each([
		["a method the order did not choose", "vietqr", "method_differs"],
	] as const)("refuses %s", async (_name, method, refusal) => {
		const demo = await setup();
		const id = (await demo.place("zalo_checkout")).order?.id ?? "";
		expect(
			await demo.payments.start({
				orderId: id,
				method,
				idempotencyKey: "key-00000001",
			}),
		).toEqual({ state: "refused", refusal });
	});

	it("refuses a counter order, a paid order, another customer's order and the counter's form", async () => {
		const demo = await setup();
		const counter = (await demo.place("counter")).order?.id ?? "";
		expect(
			await demo.payments.start({
				orderId: counter,
				method: "vietqr",
				idempotencyKey: "key-00000001",
			}),
		).toEqual({ state: "refused", refusal: "not_awaiting_payment" });
		demo.till.act("pay", counter);
		expect(
			await demo.payments.start({
				orderId: counter,
				method: "vietqr",
				idempotencyKey: "key-00000001",
			}),
		).toEqual({ state: "refused", refusal: "already_paid" });
		expect(
			await demo.payments.start({
				orderId: "ffffffff-0000-4000-8000-000000000001",
				method: "vietqr",
				idempotencyKey: "key-00000001",
			}),
		).toEqual({ state: "refused", refusal: "unknown_order" });
		const online = (await demo.place("vietqr")).order?.id ?? "";
		expect(
			await demo.payments.start({
				orderId: online,
				method: "vietqr",
				idempotencyKey: "key-00000001",
				forCounter: true,
			}),
		).toEqual({ state: "refused", refusal: "not_payable" });
		expect(
			await demo.payments.link({
				orderId: online,
				paymentId: "77777777-0000-4000-8000-000000000099",
				platformOrderId: "standin-1",
			}),
		).toEqual({ state: "refused", refusal: "unknown_payment" });
	});

	it("answers provider_off where the store offers no online payment, and refuses online orders there", async () => {
		const demo = await setup(false);
		await expect(demo.place("vietqr")).rejects.toThrow(/payment_not_allowed/);
		const counter = (await demo.place("counter")).order?.id ?? "";
		expect(
			await demo.payments.start({
				orderId: counter,
				method: "vietqr",
				idempotencyKey: "key-00000001",
			}),
		).toEqual({ state: "refused", refusal: "provider_off" });
	});

	it("answers 401 without a session and 400 for a malformed body, at the wire level", async () => {
		const demo = await setup();
		const noSession = await createPaymentClient({
			url: "stand-in:",
			publishableKey: "stand-in",
			accessToken: "demo-visitor-999",
			fetch: demo.world.functionFetch,
		})
			.start({
				orderId: "99999999-0000-4000-8000-000000000002",
				method: "vietqr",
				idempotencyKey: "key-00000001",
			})
			.catch((error: unknown) => error);
		expect(noSession).toBeInstanceOf(PaymentError);
		expect((noSession as PaymentError).code).toBe("unauthorized");
		const token = "demo-visitor-1";
		const malformed = await demo.world.functionFetch(
			"stand-in:/functions/v1/checkout-order",
			{
				method: "POST",
				headers: { Authorization: `Bearer ${token}` },
				body: JSON.stringify({ action: "start", order_id: "x", price: 1 }),
			},
		);
		expect(malformed.status).toBe(400);
		expect(await malformed.json()).toEqual({
			error: "invalid_request",
			request_id: "demo",
		});
	});
});
