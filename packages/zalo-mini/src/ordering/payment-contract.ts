// The wire contract of the Edge Function checkout-order (online payment; native-till.md 6, online-ordering.md 2.5 and
// 6.2): the request builders, which refuse a malformed request before it is sent, and a reader per answer that refuses
// anything malformed. Snake case is the wire; the readers return camel case. Amounts are whole đồng.
//
// What the function answers is never a payment result: it opens (or resumes) an attempt and hands the app what Zalo's
// Checkout SDK or the customer's bank needs. Only the server moves an order to paid, when the gateway or the bank
// reports the money; the apps learn it by reading the order (customer_order, counter_order), never from the SDK.

import { isOrderId, ORDER_POLL_MS } from "./contract";

export const CHECKOUT_ORDER_FUNCTION = "checkout-order";
export const FUNCTIONS_PATH = "/functions/v1";

export const ONLINE_PAYMENT_METHODS = ["zalo_checkout", "vietqr"] as const;
export type OnlinePaymentMethod = (typeof ONLINE_PAYMENT_METHODS)[number];

/** How often the customer's payment step reads the order (the order screen's pace). */
export const PAYMENT_POLL_MS = ORDER_POLL_MS;
/** How often the counter's VietQR tab reads the order (the board's pace). */
export const COUNTER_PAYMENT_POLL_MS = 2000;

/** An idempotency key: one per placement of an attempt, so a retry after a lost answer opens no second attempt. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;
/** Zalo's order id of a Checkout SDK order, as the link takes it. */
export const PLATFORM_ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** The transfer reference ("Nội dung chuyển khoản"): letters and digits, a space, dot, dash or underscore inside. */
export const PAYMENT_REFERENCE_PATTERN =
	/^[A-Za-z0-9][A-Za-z0-9 ._-]{2,48}[A-Za-z0-9]$/;
/** The request MAC of the Checkout SDK: HMAC-SHA256 in hex, made by the server with a key the app never holds. */
export const CHECKOUT_MAC_PATTERN = /^[0-9a-f]{64}$/i;
const BANK_BIN_PATTERN = /^[0-9]{6}$/;
const ACCOUNT_NUMBER_PATTERN = /^[0-9]{4,19}$/;
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_TEXT = 200;
const MAX_QR_PAYLOAD = 512;
const MAX_CHECKOUT_ITEMS = 100;

export const START_REFUSALS = [
	"unknown_order",
	"not_awaiting_payment",
	"method_differs",
	"too_many_attempts",
	"provider_off",
	"not_payable",
	"already_paid",
	"order_cancelled",
] as const;
export type StartRefusal = (typeof START_REFUSALS)[number];

export const LINK_REFUSALS = ["unknown_payment", "not_pending"] as const;
export type LinkRefusal = (typeof LINK_REFUSALS)[number];

export const PAYMENT_ERROR_CODES = [
	"invalid_request",
	"unauthorized",
	"method_not_allowed",
	"body_too_large",
	"not_configured",
	"provider_unavailable",
	"backend_unavailable",
	"internal_error",
] as const;
export type PaymentErrorCode = (typeof PAYMENT_ERROR_CODES)[number];

export const PAYMENT_MODES = ["sandbox", "live"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

/** The method Zalo's QR popup (Payment.openCheckoutPopup) takes for a bank transfer. */
export const QR_POPUP_METHODS = ["BANK", "BANK_SANDBOX"] as const;
export type QrPopupMethod = (typeof QR_POPUP_METHODS)[number];

/** What CheckoutSDK.createOrder takes, exactly as the server signed it (`method` left out when null). */
export interface CheckoutParams {
	readonly amount: number;
	readonly desc: string;
	readonly item: readonly { readonly id: string; readonly amount: number }[];
	/** a JSON string the provider forwards */
	readonly extradata: string;
	/** a JSON string forcing one method, or null to let the customer choose */
	readonly method: string | null;
	readonly mac: string;
}

/** A dynamic VietQR for a bank transfer, with what the screen shows beside it. */
export interface TransferQr {
	/** the EMVCo VietQR string the QR code holds */
	readonly payload: string;
	readonly bankBin: string;
	readonly bankName: string;
	readonly accountNumber: string;
	readonly accountName: string;
	readonly amount: number;
	readonly reference: string;
	readonly popupMethod: QrPopupMethod;
}

export interface PaymentAttempt {
	readonly id: string;
	readonly orderId: string;
	readonly method: OnlinePaymentMethod;
	readonly amount: number;
	readonly reference: string;
	readonly expiresAt: string;
	readonly mode: PaymentMode;
	readonly checkout: CheckoutParams | null;
	readonly qr: TransferQr | null;
}

export type StartAnswer =
	| {
			readonly state: "pending";
			readonly replayed: boolean;
			readonly payment: PaymentAttempt;
	  }
	| {
			readonly state: "refused";
			/** one of START_REFUSALS; another snake-case refusal is read as it is and worded generally */
			readonly refusal: string;
	  };

export type LinkAnswer =
	| { readonly state: "linked" }
	| { readonly state: "refused"; readonly refusal: string };

export interface StartRequest {
	readonly orderId: string;
	readonly method: OnlinePaymentMethod;
	readonly idempotencyKey: string;
	/** the counter's own attempt for a counter order (VietQR only) */
	readonly forCounter?: boolean;
}

export interface LinkRequest {
	readonly orderId: string;
	readonly paymentId: string;
	readonly platformOrderId: string;
}

/** The online payment functions, with the caller's session. */
export interface PaymentClient {
	start(request: StartRequest): Promise<StartAnswer>;
	link(request: LinkRequest): Promise<LinkAnswer>;
}

type Row = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Row {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(what: string): never {
	throw new Error(`the payment answer has no valid ${what}`);
}

function record(value: unknown, what: string): Row {
	return isRecord(value) ? value : invalid(what);
}

function hasControl(value: string): boolean {
	for (const character of value) {
		const code = character.codePointAt(0) ?? 0;
		if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
	}
	return false;
}

function text(value: unknown, what: string, max = MAX_TEXT): string {
	return typeof value === "string" &&
		value.trim() !== "" &&
		[...value].length <= max &&
		!hasControl(value)
		? value
		: invalid(what);
}

function matching(value: unknown, pattern: RegExp, what: string): string {
	return typeof value === "string" && pattern.test(value)
		? value
		: invalid(what);
}

/** A whole number of đồng above zero (an order of nothing is never paid online). */
function amount(value: unknown, what: string): number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0
		? value
		: invalid(what);
}

function oneOf<T extends string>(
	allowed: readonly T[],
	value: unknown,
	what: string,
): T {
	return allowed.find((candidate) => candidate === value) ?? invalid(what);
}

function instant(value: unknown, what: string): string {
	return typeof value === "string" && !Number.isNaN(Date.parse(value))
		? value
		: invalid(what);
}

function jsonText(value: unknown, what: string): string {
	const raw = text(value, what, 2000);
	try {
		JSON.parse(raw);
	} catch {
		invalid(what);
	}
	return raw;
}

/** CRC-16/CCITT-FALSE as EMVCo QR codes end with it (tag 63), four upper-case hex digits. */
export function emvCrc16(data: string): string {
	let crc = 0xffff;
	for (let index = 0; index < data.length; index += 1) {
		crc ^= (data.charCodeAt(index) & 0xff) << 8;
		for (let bit = 0; bit < 8; bit += 1) {
			crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
		}
	}
	return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** The top-level fields of an EMVCo payload (two-digit tag, two-digit length, value), or null when it is not one. */
export function emvFields(payload: string): ReadonlyMap<string, string> | null {
	const fields = new Map<string, string>();
	let at = 0;
	while (at < payload.length) {
		const tag = payload.slice(at, at + 2);
		const size = payload.slice(at + 2, at + 4);
		if (!/^[0-9]{2}$/.test(tag) || !/^[0-9]{2}$/.test(size)) return null;
		const length = Number(size);
		const value = payload.slice(at + 4, at + 4 + length);
		if (value.length !== length || fields.has(tag)) return null;
		fields.set(tag, value);
		at += 4 + length;
	}
	return fields;
}

/**
 * Whether a string is a dynamic VietQR for this amount: printable ASCII, the EMVCo payload format first, well-formed
 * fields, the CRC last and right, and the amount (tag 54) the one the screen shows next to it.
 */
export function isVietQrPayload(
	payload: string,
	expectedAmount: number,
): boolean {
	if (payload.length > MAX_QR_PAYLOAD || !/^[\x20-\x7e]+$/.test(payload))
		return false;
	if (!payload.startsWith("000201")) return false;
	const crcAt = payload.length - 8;
	if (crcAt < 0 || payload.slice(crcAt, crcAt + 4) !== "6304") return false;
	if (
		emvCrc16(payload.slice(0, crcAt + 4)) !==
		payload.slice(crcAt + 4).toUpperCase()
	)
		return false;
	const fields = emvFields(payload);
	return fields !== null && fields.get("54") === String(expectedAmount);
}

function tlv(tag: string, value: string): string {
	return `${tag}${String(value.length).padStart(2, "0")}${value}`;
}

/**
 * A dynamic VietQR (NAPAS, EMVCo) for a transfer to an account: what a stand-in of the server builds for the demo
 * world and the tests. The real one comes from the server only.
 */
export function vietQrPayload(input: {
	readonly bankBin: string;
	readonly accountNumber: string;
	readonly amount: number;
	readonly reference: string;
}): string {
	const account = tlv(
		"38",
		tlv("00", "A000000727") +
			tlv("01", tlv("00", input.bankBin) + tlv("01", input.accountNumber)) +
			tlv("02", "QRIBFTTA"),
	);
	const body =
		tlv("00", "01") +
		tlv("01", "12") +
		account +
		tlv("53", "704") +
		tlv("54", String(input.amount)) +
		tlv("58", "VN") +
		tlv("62", tlv("08", input.reference));
	const signed = `${body}6304`;
	return `${signed}${emvCrc16(signed)}`;
}

function readCheckout(value: unknown, total: number): CheckoutParams {
	const row = record(value, "checkout");
	const items = row.item;
	if (
		!Array.isArray(items) ||
		items.length === 0 ||
		items.length > MAX_CHECKOUT_ITEMS
	)
		invalid("checkout items");
	const checkoutAmount = amount(row.amount, "checkout amount");
	if (checkoutAmount !== total) invalid("checkout amount");
	return {
		amount: checkoutAmount,
		desc: text(row.desc, "checkout description"),
		item: items.map((entry) => {
			const item = record(entry, "checkout item");
			const itemAmount = item.amount;
			return {
				id: text(item.id, "checkout item id", 64),
				amount:
					typeof itemAmount === "number" &&
					Number.isSafeInteger(itemAmount) &&
					itemAmount >= 0
						? itemAmount
						: invalid("checkout item amount"),
			};
		}),
		extradata: jsonText(row.extradata, "checkout extradata"),
		method:
			row.method === null || row.method === undefined
				? null
				: jsonText(row.method, "checkout method"),
		mac: matching(row.mac, CHECKOUT_MAC_PATTERN, "checkout mac"),
	};
}

function readQr(value: unknown, total: number, reference: string): TransferQr {
	const row = record(value, "qr");
	const qrAmount = amount(row.amount, "qr amount");
	if (qrAmount !== total) invalid("qr amount");
	const qrReference = matching(
		row.reference,
		PAYMENT_REFERENCE_PATTERN,
		"qr reference",
	);
	if (qrReference !== reference) invalid("qr reference");
	const payload = typeof row.payload === "string" ? row.payload : "";
	if (!isVietQrPayload(payload, qrAmount)) invalid("qr payload");
	return {
		payload,
		bankBin: matching(row.bank_bin, BANK_BIN_PATTERN, "bank bin"),
		bankName: text(row.bank_name, "bank name", 100),
		accountNumber: matching(
			row.account_number,
			ACCOUNT_NUMBER_PATTERN,
			"account number",
		),
		accountName: text(row.account_name, "account name", 100),
		amount: qrAmount,
		reference: qrReference,
		popupMethod: oneOf(QR_POPUP_METHODS, row.popup_method, "popup method"),
	};
}

export function readPaymentAttempt(value: unknown): PaymentAttempt {
	const row = record(value, "payment");
	const method = oneOf(ONLINE_PAYMENT_METHODS, row.method, "payment method");
	const total = amount(row.amount, "payment amount");
	const reference = matching(
		row.reference,
		PAYMENT_REFERENCE_PATTERN,
		"payment reference",
	);
	const wallet = method === "zalo_checkout";
	// the wallet carries the signed Checkout parameters and no QR; the transfer the QR and no Checkout parameters
	if (
		wallet
			? row.qr !== null && row.qr !== undefined
			: row.checkout !== null && row.checkout !== undefined
	)
		invalid(wallet ? "qr" : "checkout");
	return {
		id: matching(row.id, UUID_PATTERN, "payment id"),
		orderId: matching(row.order_id, UUID_PATTERN, "payment order"),
		method,
		amount: total,
		reference,
		expiresAt: instant(row.expires_at, "expires_at"),
		mode: oneOf(PAYMENT_MODES, row.mode, "payment mode"),
		checkout: wallet ? readCheckout(row.checkout, total) : null,
		qr: wallet ? null : readQr(row.qr, total, reference),
	};
}

export function readStartAnswer(value: unknown): StartAnswer {
	const row = record(value, "start answer");
	if (row.state === "refused") {
		if (row.payment !== null && row.payment !== undefined) invalid("refusal");
		return {
			state: "refused",
			refusal: matching(row.refusal, CODE_PATTERN, "refusal"),
		};
	}
	if (row.state !== "pending") return invalid("start state");
	if (row.refusal !== null && row.refusal !== undefined) invalid("refusal");
	return {
		state: "pending",
		replayed: row.replayed === true,
		payment: readPaymentAttempt(row.payment),
	};
}

export function readLinkAnswer(value: unknown): LinkAnswer {
	const row = record(value, "link answer");
	if (row.state === "linked") return { state: "linked" };
	if (row.state === "refused")
		return {
			state: "refused",
			refusal: matching(row.refusal, CODE_PATTERN, "refusal"),
		};
	return invalid("link state");
}

/** The error code and request id of a non-200 answer, when the body is the function's error shape. */
export function readPaymentError(value: unknown): {
	readonly code: PaymentErrorCode | null;
	readonly requestId: string | null;
} {
	if (!isRecord(value)) return { code: null, requestId: null };
	const code =
		PAYMENT_ERROR_CODES.find((candidate) => candidate === value.error) ?? null;
	const requestId =
		typeof value.request_id === "string" &&
		/^[A-Za-z0-9_-]{1,100}$/.test(value.request_id)
			? value.request_id
			: null;
	return { code, requestId };
}

/** The body of a start: refused before it is sent when it breaks the contract. */
export function startBody(
	request: StartRequest,
): Readonly<Record<string, unknown>> {
	if (!isOrderId(request.orderId)) throw new Error("an order id is a UUID");
	if (!ONLINE_PAYMENT_METHODS.includes(request.method))
		throw new Error("not an online payment method");
	if (!IDEMPOTENCY_KEY_PATTERN.test(request.idempotencyKey))
		throw new Error("an idempotency key is 8 to 100 letters, digits, - or _");
	if (request.forCounter === true && request.method !== "vietqr")
		throw new Error("the counter takes a VietQR only");
	return {
		action: "start",
		order_id: request.orderId,
		method: request.method,
		idempotency_key: request.idempotencyKey,
		...(request.forCounter === true ? { for: "counter" } : {}),
	};
}

export function linkBody(
	request: LinkRequest,
): Readonly<Record<string, unknown>> {
	if (!isOrderId(request.orderId)) throw new Error("an order id is a UUID");
	if (!UUID_PATTERN.test(request.paymentId))
		throw new Error("a payment id is a UUID");
	if (!PLATFORM_ORDER_ID_PATTERN.test(request.platformOrderId))
		throw new Error("not a Zalo order id");
	return {
		action: "link",
		order_id: request.orderId,
		payment_id: request.paymentId,
		platform_order_id: request.platformOrderId,
	};
}

/** A fresh idempotency key (a UUID: 36 characters of the allowed ones). */
export function newIdempotencyKey(): string {
	if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isOnlineMethod(value: string): value is OnlinePaymentMethod {
	return (ONLINE_PAYMENT_METHODS as readonly string[]).includes(value);
}
