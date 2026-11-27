import { describe, expect, it } from "vitest";
import {
	CHECKOUT_MAC_PATTERN,
	emvCrc16,
	emvFields,
	IDEMPOTENCY_KEY_PATTERN,
	isOnlineMethod,
	isVietQrPayload,
	linkBody,
	newIdempotencyKey,
	PAYMENT_REFERENCE_PATTERN,
	readLinkAnswer,
	readPaymentAttempt,
	readPaymentError,
	readStartAnswer,
	startBody,
	vietQrPayload,
} from "../../src/ordering/payment-contract";

// Test design (ISTQB) for the wire contract of checkout-order (online payment; native-till.md 6):
// - equivalence partitions per answer: a pending wallet attempt, a pending transfer attempt, each refusal, a link and
//   its refusals, and malformed answers (a missing field, a wrong type, an id that is not a UUID, a method's part on the
//   other method, a refusal with a payment), which every reader refuses;
// - boundary values: amounts (1 and the largest safe integer accepted; 0, -1, 1.5, a string refused), the idempotency
//   key (8 and 100 characters accepted, 7 and 101 refused), the Zalo order id (1 and 64 accepted, 0 and 65 refused),
//   the reference (4 and 50 accepted, 3 and 51 refused), the MAC (64 hex digits only);
// - the QR payload: the CRC (the EMVCo check value of a known string), a changed digit, a changed amount, a payload of
//   another amount than the screen's, markup, a payload that is not EMVCo;
// - security: the request builders refuse a malformed id or key before anything is sent, and the counter's form only
//   with a VietQR; the readers keep amounts integral, so nothing can price an order on the client.

const ORDER = "66666666-6666-4666-8666-666666666601";
const PAYMENT = "77777777-7777-4777-8777-777777777701";
const MAC = "a".repeat(64);

function walletPayment(overrides: Record<string, unknown> = {}) {
	return {
		id: PAYMENT,
		order_id: ORDER,
		method: "zalo_checkout",
		amount: 58000,
		reference: "FNB7K2M9Q4T",
		expires_at: "2026-11-27T10:15:00.000Z",
		mode: "sandbox",
		checkout: {
			amount: 58000,
			desc: "Cửa hàng Mẫu 1 - Đơn trực tuyến",
			item: [
				{ id: "item-1", amount: 29000 },
				{ id: "item-2", amount: 29000 },
			],
			extradata: JSON.stringify({ o: ORDER, s: "mau-1", v: 1 }),
			method: null,
			mac: MAC,
		},
		qr: null,
		...overrides,
	};
}

function transferPayment(overrides: Record<string, unknown> = {}) {
	const payload = vietQrPayload({
		bankBin: "970400",
		accountNumber: "0123456789",
		amount: 58000,
		reference: "FNB7K2M9Q4T",
	});
	return {
		...walletPayment(),
		method: "vietqr",
		checkout: null,
		qr: {
			payload,
			bank_bin: "970400",
			bank_name: "Ngân hàng Mẫu",
			account_number: "0123456789",
			account_name: "CUA HANG MAU",
			amount: 58000,
			reference: "FNB7K2M9Q4T",
			popup_method: "BANK_SANDBOX",
		},
		...overrides,
	};
}

function pending(payment: unknown) {
	return { state: "pending", refusal: null, replayed: false, payment };
}

describe("the start answer", () => {
	it("reads a pending wallet attempt with the server's signed Checkout parameters, untouched", () => {
		const answer = readStartAnswer(pending(walletPayment()));
		expect(answer).toEqual({
			state: "pending",
			replayed: false,
			payment: {
				id: PAYMENT,
				orderId: ORDER,
				method: "zalo_checkout",
				amount: 58000,
				reference: "FNB7K2M9Q4T",
				expiresAt: "2026-11-27T10:15:00.000Z",
				mode: "sandbox",
				checkout: {
					amount: 58000,
					desc: "Cửa hàng Mẫu 1 - Đơn trực tuyến",
					item: [
						{ id: "item-1", amount: 29000 },
						{ id: "item-2", amount: 29000 },
					],
					extradata: JSON.stringify({ o: ORDER, s: "mau-1", v: 1 }),
					method: null,
					mac: MAC,
				},
				qr: null,
			},
		});
	});

	it("reads a forced method as the JSON string it is, and a replay", () => {
		const method = JSON.stringify({ id: "ZALOPAY_SANDBOX", isCustom: false });
		const answer = readStartAnswer({
			...pending(
				walletPayment({
					checkout: { ...walletPayment().checkout, method },
				}),
			),
			replayed: true,
		});
		expect(answer.state === "pending" && answer.payment.checkout?.method).toBe(
			method,
		);
		expect(answer.state === "pending" && answer.replayed).toBe(true);
	});

	it("reads a pending transfer with its QR, bank, account and reference", () => {
		const answer = readStartAnswer(pending(transferPayment()));
		if (answer.state !== "pending") throw new Error("not pending");
		expect(answer.payment.checkout).toBeNull();
		expect(answer.payment.qr).toMatchObject({
			bankBin: "970400",
			bankName: "Ngân hàng Mẫu",
			accountNumber: "0123456789",
			accountName: "CUA HANG MAU",
			amount: 58000,
			reference: "FNB7K2M9Q4T",
			popupMethod: "BANK_SANDBOX",
		});
	});

	it.each([
		"unknown_order",
		"not_awaiting_payment",
		"method_differs",
		"too_many_attempts",
		"provider_off",
		"not_payable",
		"already_paid",
		"order_cancelled",
		"a_new_refusal",
	])("reads the refusal %s", (refusal) => {
		expect(
			readStartAnswer({
				state: "refused",
				refusal,
				replayed: false,
				payment: null,
			}),
		).toEqual({ state: "refused", refusal });
	});

	it.each([
		["no state", { refusal: null, payment: null }],
		["an unknown state", { state: "paid", payment: null }],
		["a refusal that is not a code", { state: "refused", refusal: "<b>x</b>" }],
		[
			"a refusal with a payment",
			{ state: "refused", refusal: "provider_off", payment: walletPayment() },
		],
		[
			"a pending state with a refusal",
			{ ...pending(walletPayment()), refusal: "x" },
		],
		["a pending state without a payment", pending(null)],
		["an array", []],
		["a string", "pending"],
	])("refuses %s", (_name, value) => {
		expect(() => readStartAnswer(value)).toThrow(/payment answer/);
	});

	it.each([
		["an id that is not a UUID", { id: "1" }],
		["an order id that is not a UUID", { order_id: "x" }],
		["an unknown method", { method: "cash" }],
		["an unknown mode", { mode: "test" }],
		["an expiry that is not a time", { expires_at: "soon" }],
		["a reference with markup", { reference: "<FNB123>" }],
		["a wallet attempt with a QR", { qr: transferPayment().qr }],
		["a wallet attempt without Checkout parameters", { checkout: null }],
		[
			"Checkout parameters of another amount",
			{ checkout: { ...walletPayment().checkout, amount: 57000 } },
		],
		[
			"a MAC that is not hex",
			{ checkout: { ...walletPayment().checkout, mac: "z".repeat(64) } },
		],
		[
			"a short MAC",
			{ checkout: { ...walletPayment().checkout, mac: "a".repeat(63) } },
		],
		["no items", { checkout: { ...walletPayment().checkout, item: [] } }],
		[
			"an item of a fractional amount",
			{
				checkout: {
					...walletPayment().checkout,
					item: [{ id: "a", amount: 1.5 }],
				},
			},
		],
		[
			"extradata that is not JSON",
			{ checkout: { ...walletPayment().checkout, extradata: "{o:" } },
		],
		[
			"a method that is not JSON",
			{ checkout: { ...walletPayment().checkout, method: "ZALOPAY" } },
		],
		[
			"an empty description",
			{ checkout: { ...walletPayment().checkout, desc: " " } },
		],
	])("refuses a wallet attempt with %s", (_name, overrides) => {
		expect(() => readStartAnswer(pending(walletPayment(overrides)))).toThrow(
			/payment answer/,
		);
	});

	it.each([
		[
			"a transfer attempt with Checkout parameters",
			{ checkout: walletPayment().checkout },
		],
		["a transfer attempt without a QR", { qr: null }],
		[
			"a QR of another amount",
			{ qr: { ...transferPayment().qr, amount: 57000 } },
		],
		[
			"a QR of another reference",
			{ qr: { ...transferPayment().qr, reference: "FNB0000000" } },
		],
		[
			"a BIN of five digits",
			{ qr: { ...transferPayment().qr, bank_bin: "97040" } },
		],
		[
			"an account number with letters",
			{ qr: { ...transferPayment().qr, account_number: "01234A" } },
		],
		[
			"an empty account name",
			{ qr: { ...transferPayment().qr, account_name: "" } },
		],
		[
			"an account name with a control character",
			{ qr: { ...transferPayment().qr, account_name: "CUA\u0007" } },
		],
		[
			"an unknown popup method",
			{ qr: { ...transferPayment().qr, popup_method: "ZALOPAY" } },
		],
		[
			"a payload with a wrong CRC",
			{
				qr: {
					...transferPayment().qr,
					payload: `${transferPayment().qr.payload.slice(0, -1)}0`,
				},
			},
		],
		[
			"a payload of another amount",
			{
				qr: {
					...transferPayment().qr,
					payload: vietQrPayload({
						bankBin: "970400",
						accountNumber: "0123456789",
						amount: 1000,
						reference: "FNB7K2M9Q4T",
					}),
				},
			},
		],
		[
			"a payload that is not EMVCo",
			{ qr: { ...transferPayment().qr, payload: "https://example.com/pay" } },
		],
	])("refuses %s", (_name, overrides) => {
		expect(() => readStartAnswer(pending(transferPayment(overrides)))).toThrow(
			/payment answer/,
		);
	});

	// boundary values of the amount: the smallest payable and the largest safe integer, and just outside
	it.each([
		[1, true],
		[Number.MAX_SAFE_INTEGER, true],
		[0, false],
		[-1, false],
		[1.5, false],
		["58000", false],
		[Number.MAX_SAFE_INTEGER + 1, false],
	])("takes an amount of %s: %s", (amount, valid) => {
		const value = pending(
			walletPayment({
				amount,
				checkout: { ...walletPayment().checkout, amount },
			}),
		);
		if (valid) expect(readStartAnswer(value).state).toBe("pending");
		else expect(() => readStartAnswer(value)).toThrow(/payment answer/);
	});

	// boundary values of the reference: 4 and 50 characters, and just outside
	it.each([
		["FNB1", true],
		["F".repeat(50), true],
		["FN1", false],
		["F".repeat(51), false],
		["FNB 1234", true],
		[" FNB1234", false],
		["FNB1234\n", false],
	])("takes the reference %j: %s", (reference, valid) => {
		expect(PAYMENT_REFERENCE_PATTERN.test(reference)).toBe(valid);
	});
});

describe("the link answer", () => {
	it("reads a link and its refusals", () => {
		expect(readLinkAnswer({ state: "linked", refusal: null })).toEqual({
			state: "linked",
		});
		for (const refusal of ["unknown_payment", "not_pending"])
			expect(readLinkAnswer({ state: "refused", refusal })).toEqual({
				state: "refused",
				refusal,
			});
	});

	it("refuses an unknown state or a refusal that is not a code", () => {
		expect(() => readLinkAnswer({ state: "paid" })).toThrow(/payment answer/);
		expect(() => readLinkAnswer({ state: "refused", refusal: 3 })).toThrow(
			/payment answer/,
		);
		expect(() => readLinkAnswer(null)).toThrow(/payment answer/);
	});
});

describe("the error answer", () => {
	it("reads a known error code and a request id, and nothing from another body", () => {
		expect(
			readPaymentError({ error: "provider_unavailable", request_id: "req-1" }),
		).toEqual({ code: "provider_unavailable", requestId: "req-1" });
		expect(readPaymentError({ error: "boom", request_id: "<x>" })).toEqual({
			code: null,
			requestId: null,
		});
		expect(readPaymentError("oops")).toEqual({ code: null, requestId: null });
	});
});

describe("the request builders", () => {
	it("send a start with the order, the method and the key, and the counter's form for a VietQR only", () => {
		expect(
			startBody({
				orderId: ORDER,
				method: "zalo_checkout",
				idempotencyKey: "key-1234",
			}),
		).toEqual({
			action: "start",
			order_id: ORDER,
			method: "zalo_checkout",
			idempotency_key: "key-1234",
		});
		expect(
			startBody({
				orderId: ORDER,
				method: "vietqr",
				idempotencyKey: "key-1234",
				forCounter: true,
			}),
		).toEqual({
			action: "start",
			order_id: ORDER,
			method: "vietqr",
			idempotency_key: "key-1234",
			for: "counter",
		});
		expect(() =>
			startBody({
				orderId: ORDER,
				method: "zalo_checkout",
				idempotencyKey: "key-1234",
				forCounter: true,
			}),
		).toThrow(/VietQR/);
	});

	it("send no price: only ids, the method and the key", () => {
		const body = startBody({
			orderId: ORDER,
			method: "vietqr",
			idempotencyKey: "key-1234",
		});
		expect(Object.keys(body).sort()).toEqual([
			"action",
			"idempotency_key",
			"method",
			"order_id",
		]);
	});

	// boundary values of the idempotency key: 8 and 100 characters, and just outside
	it.each([
		["a".repeat(8), true],
		["a".repeat(100), true],
		["a".repeat(7), false],
		["a".repeat(101), false],
		["key 1234", false],
		["key/1234", false],
	])("takes the key %j: %s", (key, valid) => {
		expect(IDEMPOTENCY_KEY_PATTERN.test(key)).toBe(valid);
		const build = () =>
			startBody({ orderId: ORDER, method: "vietqr", idempotencyKey: key });
		if (valid) expect(build).not.toThrow();
		else expect(build).toThrow();
	});

	it("refuse an order id that is not a UUID and a method that is not online", () => {
		expect(() =>
			startBody({
				orderId: "1 or 1=1",
				method: "vietqr",
				idempotencyKey: "key-1234",
			}),
		).toThrow(/UUID/);
		expect(() =>
			startBody({
				orderId: ORDER,
				method: "counter" as never,
				idempotencyKey: "key-1234",
			}),
		).toThrow(/online/);
	});

	// boundary values of Zalo's order id: 1 and 64 characters, and just outside
	it.each([
		["1", true],
		["z".repeat(64), true],
		["", false],
		["z".repeat(65), false],
		["a b", false],
	])("links the Zalo order id %j: %s", (platformOrderId, valid) => {
		const build = () =>
			linkBody({ orderId: ORDER, paymentId: PAYMENT, platformOrderId });
		if (valid)
			expect(build()).toEqual({
				action: "link",
				order_id: ORDER,
				payment_id: PAYMENT,
				platform_order_id: platformOrderId,
			});
		else expect(build).toThrow();
	});

	it("make fresh keys of the allowed form", () => {
		const first = newIdempotencyKey();
		expect(first).toMatch(IDEMPOTENCY_KEY_PATTERN);
		expect(newIdempotencyKey()).not.toBe(first);
		expect(isOnlineMethod("vietqr")).toBe(true);
		expect(isOnlineMethod("counter")).toBe(false);
	});
});

describe("the VietQR payload", () => {
	it("ends with the EMVCo CRC (the check value of 123456789 is 29B1)", () => {
		expect(emvCrc16("123456789")).toBe("29B1");
	});

	it("is built with the BIN, the account, the amount and the reference, and reads back", () => {
		const payload = vietQrPayload({
			bankBin: "970400",
			accountNumber: "0123456789",
			amount: 58000,
			reference: "FNB7K2M9Q4T",
		});
		expect(isVietQrPayload(payload, 58000)).toBe(true);
		expect(isVietQrPayload(payload, 58001)).toBe(false);
		const fields = emvFields(payload);
		expect(fields?.get("53")).toBe("704");
		expect(fields?.get("38")).toContain("970400");
		expect(fields?.get("62")).toContain("FNB7K2M9Q4T");
		expect(isVietQrPayload(payload.toLowerCase(), 58000)).toBe(false);
		expect(isVietQrPayload(`${payload}<b>`, 58000)).toBe(false);
		expect(emvFields("0002")).toBeNull();
	});

	it("matches the MAC pattern only for 64 hex digits", () => {
		expect(CHECKOUT_MAC_PATTERN.test("0f".repeat(32))).toBe(true);
		expect(CHECKOUT_MAC_PATTERN.test("0f".repeat(31))).toBe(false);
	});
});

describe("the attempt reader alone", () => {
	it("is the one the start answer uses", () => {
		expect(readPaymentAttempt(walletPayment()).method).toBe("zalo_checkout");
	});
});
