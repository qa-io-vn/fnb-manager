import { hmacSha256Hex, signatureEqual } from "./crypto.js";
import {
	type AttemptLine,
	type CheckoutParams,
	isRecord,
	type NotificationOutcome,
	type NotificationReply,
	type NotificationResult,
	type PaymentEvent,
	type PaymentFetch,
	ProviderUnavailableError,
	type RefundAnswer,
	type StatusAnswer,
} from "./types.js";

/**
 * Zalo's Checkout SDK (docs.zaloplatforms.com/docs/MA/checkoutSdk, pages of 9/11/2026). Every MAC is HMAC-SHA256 in
 * lower-case hex under the private key of the Mini App's Checkout settings, which never leaves the server:
 *
 * - createOrder: the parameters' keys sorted ascending as key=value joined by "&" (amount, desc, extradata, item,
 *   method; item as JSON, extradata and method already JSON strings, method left out when not forced).
 * - callback (ZaloPay, MoMo, VNPay, PayME): mac over appId, amount, description, orderId, message, resultCode,
 *   transId in that fixed order; overallMac over every key of data, sorted ascending (it is the one that protects
 *   method and extradata).
 * - notify (COD and bank transfer chosen in the sheet): mac over appId, orderId, method.
 * - the server APIs sign their fields followed by privateKey=<key> (the key is signed over, never sent).
 *
 * Whether getOrderStatus and getRefundStatus take query parameters and whether the POST APIs take a JSON body is not
 * written in the pages; this follows the HTTP methods they name and must be confirmed in the sandbox (ADR-067).
 */

export const ZALO_PAYMENT_ORIGIN = "https://payment-mini.zalo.me";
export const GET_STATUS_PATH = "/api/transaction/get-status";
export const REFUND_CREATE_PATH = "/api/refund/create";
export const REFUND_STATUS_PATH = "/api/refund";
export const PURCHASE_PAYMENT_PATH = (appId: string) =>
	`/api/transaction/${appId}/purchase-payment`;

export const WALLET_METHODS = [
	"ZALOPAY",
	"MOMO",
	"VNPAY",
	"ATM",
	"CC",
	"PAYME_CC",
	"PAYME_ATM",
] as const;
export type WalletMethod = (typeof WALLET_METHODS)[number];

export const APP_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const PLATFORM_ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const TRANS_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
export const DESCRIPTION_MAX = 100;

export function isWalletMethod(value: unknown): value is WalletMethod {
	return (
		typeof value === "string" &&
		(WALLET_METHODS as readonly string[]).includes(value)
	);
}

function macValue(value: unknown): string {
	if (value === null || value === undefined) {
		return "";
	}
	return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** The text a createOrder MAC signs: the present parameters, keys sorted ascending, as key=value joined by "&". */
export function createOrderMacInput(params: {
	readonly amount: number;
	readonly desc: string;
	readonly item: readonly AttemptLine[];
	readonly extradata: string;
	readonly method: string | null;
}): string {
	const entries: [string, unknown][] = [
		["amount", params.amount],
		["desc", params.desc],
		["extradata", params.extradata],
		["item", params.item],
	];
	if (params.method !== null) {
		entries.push(["method", params.method]);
	}
	return entries
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([key, value]) => `${key}=${macValue(value)}`)
		.join("&");
}

/** One line of text without control characters, cut to the length a sheet shows. */
export function oneLine(text: string, max: number): string {
	const clean = [
		...text
			.replace(/[\p{Cc}\p{Cf}]+/gu, " ")
			.replace(/\s+/g, " ")
			.trim(),
	];
	return clean.slice(0, max).join("");
}

export interface CheckoutOrderInput {
	readonly amount: number;
	readonly description: string;
	readonly lines: readonly AttemptLine[];
	readonly reference: string;
	/** one wallet forced in the sheet, or null to let the customer choose among the console's methods */
	readonly walletMethod: WalletMethod | null;
	readonly sandbox: boolean;
}

/**
 * The createOrder parameters of an attempt with their MAC. The sheet lists the order's lines when they add up to the
 * total (a stamp reward makes them larger), else one line for the order. extradata names the attempt's reference,
 * which the callback brings back under overallMac.
 */
export async function buildCheckoutOrder(
	input: CheckoutOrderInput,
	privateKey: string,
): Promise<CheckoutParams> {
	if (!Number.isSafeInteger(input.amount) || input.amount < 1) {
		throw new Error("a checkout amount is a whole number of đồng from 1");
	}
	const sum = input.lines.reduce((total, line) => total + line.amount, 0);
	const item: AttemptLine[] =
		input.lines.length > 0 &&
		sum === input.amount &&
		input.lines.every(
			(line) => Number.isSafeInteger(line.amount) && line.amount > 0,
		)
			? input.lines.map((line) => ({ id: line.id, amount: line.amount }))
			: [{ id: input.reference, amount: input.amount }];
	const params = {
		amount: input.amount,
		desc: oneLine(input.description, DESCRIPTION_MAX) || input.reference,
		item,
		extradata: JSON.stringify({ ref: input.reference }),
		method:
			input.walletMethod === null
				? null
				: JSON.stringify({
						id: input.sandbox
							? `${input.walletMethod}_SANDBOX`
							: input.walletMethod,
						isCustom: false,
					}),
	};
	return {
		...params,
		mac: await hmacSha256Hex(privateKey, createOrderMacInput(params)),
	};
}

export interface CallbackData {
	readonly appId: string;
	readonly orderId: string;
	readonly transId: string;
	readonly amount: number;
	readonly description: string;
	readonly resultCode: number;
	readonly message: string;
	readonly method: string | null;
	readonly extradata: string | null;
	readonly transTime: number | null;
	readonly raw: Readonly<Record<string, unknown>>;
}

/** The text the callback's mac signs, in Zalo's fixed order. */
export function callbackMacInput(data: {
	readonly appId: string;
	readonly amount: number;
	readonly description: string;
	readonly orderId: string;
	readonly message: string;
	readonly resultCode: number;
	readonly transId: string;
}): string {
	return `appId=${data.appId}&amount=${data.amount}&description=${data.description}&orderId=${data.orderId}&message=${data.message}&resultCode=${data.resultCode}&transId=${data.transId}`;
}

/** The text overallMac signs: every key of data, sorted ascending, as key=value joined by "&". */
export function overallMacInput(
	data: Readonly<Record<string, unknown>>,
): string {
	return Object.keys(data)
		.sort()
		.map((key) => `${key}=${macValue(data[key])}`)
		.join("&");
}

export function notifyMacInput(data: {
	readonly appId: string;
	readonly orderId: string;
	readonly method: string;
}): string {
	return `appId=${data.appId}&orderId=${data.orderId}&method=${data.method}`;
}

function stringField(
	record: Readonly<Record<string, unknown>>,
	key: string,
): string | null {
	const value = record[key];
	return typeof value === "string" ? value : null;
}

function integerField(
	record: Readonly<Record<string, unknown>>,
	key: string,
): number | null {
	const value = record[key];
	if (typeof value === "number" && Number.isSafeInteger(value)) {
		return value;
	}
	if (typeof value === "string" && /^-?[0-9]{1,15}$/.test(value)) {
		return Number(value);
	}
	return null;
}

function parseJson(raw: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

/** The appId a callback or notify names, read before verification only to choose the brand's key. */
export function checkoutAppIdOf(rawBody: string): string | null {
	const body = parseJson(rawBody);
	if (!isRecord(body) || !isRecord(body.data)) {
		return null;
	}
	const appId = body.data.appId;
	return typeof appId === "string" && APP_ID_PATTERN.test(appId) ? appId : null;
}

function parseCallbackData(
	data: Readonly<Record<string, unknown>>,
): CallbackData | null {
	const appId = stringField(data, "appId");
	const orderId = stringField(data, "orderId");
	const transId =
		stringField(data, "transId") ??
		(typeof data.transId === "number" ? String(data.transId) : null);
	const amount = integerField(data, "amount");
	const resultCode = integerField(data, "resultCode");
	const description = stringField(data, "description") ?? "";
	const message = stringField(data, "message") ?? "";
	if (
		appId === null ||
		!APP_ID_PATTERN.test(appId) ||
		orderId === null ||
		!PLATFORM_ORDER_ID_PATTERN.test(orderId) ||
		transId === null ||
		!TRANS_ID_PATTERN.test(transId) ||
		amount === null ||
		amount < 0 ||
		resultCode === null
	) {
		return null;
	}
	return {
		appId,
		orderId,
		transId,
		amount,
		description,
		resultCode,
		message,
		method: stringField(data, "method"),
		extradata: stringField(data, "extradata"),
		transTime: integerField(data, "transTime"),
		raw: data,
	};
}

/** The reference our createOrder put in extradata ({"ref": …}), URI-encoded by Zalo; null when it does not read. */
export function referenceFromExtradata(
	extradata: string | null,
): string | null {
	if (extradata === null || extradata === "") {
		return null;
	}
	let text = extradata;
	try {
		text = decodeURIComponent(extradata);
	} catch {
		return null;
	}
	const parsed = parseJson(text);
	if (!isRecord(parsed) || typeof parsed.ref !== "string") {
		return null;
	}
	return /^[A-Z]{2,4}[2-9A-HJ-NP-Z]{8}$/.test(parsed.ref) ? parsed.ref : null;
}

/**
 * Verifies a callback: the shape, mac and overallMac (both required, compared in constant time), and that it names
 * the brand's app. A success is resultCode 1; anything else is a failure of the attempt.
 */
export async function verifyCheckoutCallback(
	rawBody: string,
	privateKey: string,
	appId: string,
): Promise<NotificationResult> {
	const body = parseJson(rawBody);
	if (!isRecord(body) || !isRecord(body.data)) {
		return { ok: false, refusal: "malformed" };
	}
	const data = parseCallbackData(body.data);
	if (
		data === null ||
		typeof body.mac !== "string" ||
		typeof body.overallMac !== "string"
	) {
		return { ok: false, refusal: "malformed" };
	}
	const [mac, overall] = await Promise.all([
		hmacSha256Hex(privateKey, callbackMacInput(data)),
		hmacSha256Hex(privateKey, overallMacInput(body.data)),
	]);
	const macGood = signatureEqual(mac, body.mac);
	const overallGood = signatureEqual(overall, body.overallMac);
	if (!macGood || !overallGood) {
		return { ok: false, refusal: "signature" };
	}
	if (data.appId !== appId) {
		return { ok: false, refusal: "wrong_app" };
	}
	const event: PaymentEvent = {
		providerRef: data.transId,
		amount: data.amount,
		success: data.resultCode === 1,
		reason:
			data.resultCode === 1
				? null
				: oneLine(`result ${data.resultCode}: ${data.message}`, 200),
		reference: referenceFromExtradata(data.extradata),
		candidates: [],
		platformOrderId: data.orderId,
		occurredAt:
			data.transTime !== null && data.transTime > 0
				? new Date(data.transTime).toISOString()
				: null,
	};
	return { ok: true, events: [event] };
}

export interface NotifyData {
	readonly appId: string;
	readonly orderId: string;
	readonly method: string;
}

export type NotifyResult =
	| { readonly ok: true; readonly notify: NotifyData }
	| {
			readonly ok: false;
			readonly refusal: "malformed" | "signature" | "wrong_app";
	  };

/** Verifies a notify (COD or bank transfer chosen in the sheet): the shape and its mac. */
export async function verifyCheckoutNotify(
	rawBody: string,
	privateKey: string,
	appId: string,
): Promise<NotifyResult> {
	const body = parseJson(rawBody);
	if (!isRecord(body) || !isRecord(body.data) || typeof body.mac !== "string") {
		return { ok: false, refusal: "malformed" };
	}
	const notifiedApp = stringField(body.data, "appId");
	const orderId = stringField(body.data, "orderId");
	const method = stringField(body.data, "method");
	if (
		notifiedApp === null ||
		!APP_ID_PATTERN.test(notifiedApp) ||
		orderId === null ||
		!PLATFORM_ORDER_ID_PATTERN.test(orderId) ||
		method === null ||
		!/^[A-Z_]{1,32}$/.test(method)
	) {
		return { ok: false, refusal: "malformed" };
	}
	const expected = await hmacSha256Hex(
		privateKey,
		notifyMacInput({ appId: notifiedApp, orderId, method }),
	);
	if (!signatureEqual(expected, body.mac)) {
		return { ok: false, refusal: "signature" };
	}
	if (notifiedApp !== appId) {
		return { ok: false, refusal: "wrong_app" };
	}
	return { ok: true, notify: { appId: notifiedApp, orderId, method } };
}

/**
 * The answer Checkout expects: returnCode 1 when the callback was handled (a payment applied, failed or kept for a
 * manager), 2 for a transId already handled, anything else a failure it does not retry.
 */
export function checkoutReply(outcome: NotificationOutcome): NotificationReply {
	switch (outcome) {
		case "accepted":
			return { status: 200, body: { returnCode: 1, returnMessage: "ok" } };
		case "replayed":
			return {
				status: 200,
				body: { returnCode: 2, returnMessage: "duplicate transId" },
			};
		case "refused":
			return {
				status: 200,
				body: { returnCode: -1, returnMessage: "refused" },
			};
		default:
			return {
				status: 200,
				body: { returnCode: 0, returnMessage: "try again" },
			};
	}
}

export interface ZaloPaymentApiOptions {
	readonly appId: string;
	readonly privateKey: string;
	readonly fetch: PaymentFetch;
	/** https://payment-mini.zalo.me, or a loopback mock in tests */
	readonly baseUrl?: string;
}

export interface OrderStatus {
	readonly state: "paid" | "failed" | "processing" | "unknown";
	readonly transId: string | null;
	readonly amount: number | null;
	readonly reference: string | null;
	readonly method: string | null;
	readonly message: string | null;
}

export interface ZaloPaymentApi {
	getOrderStatus(orderId: string): Promise<OrderStatus>;
	createRefund(
		transId: string,
		amount: number,
		description: string,
	): Promise<RefundAnswer>;
	getRefundStatus(refundId: string): Promise<RefundAnswer>;
	/** Reports a bank-transfer popup order paid (1), refunded (0) or failed (−1). */
	reportPurchase(orderId: string, resultCode: 1 | 0 | -1): Promise<boolean>;
}

async function readAnswer(
	response: Response,
	what: string,
): Promise<Readonly<Record<string, unknown>>> {
	if (!response.ok) {
		throw new ProviderUnavailableError(
			`${what} answered with HTTP ${response.status}`,
			response.status,
		);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(await response.text());
	} catch {
		throw new ProviderUnavailableError(
			`${what} answered with something other than JSON`,
			response.status,
		);
	}
	if (!isRecord(parsed)) {
		throw new ProviderUnavailableError(
			`${what} answered with something other than an object`,
			response.status,
		);
	}
	return isRecord(parsed.data) ? { ...parsed, ...parsed.data } : parsed;
}

function refundState(
	returnCode: number | null,
): "succeeded" | "pending" | "failed" {
	if (returnCode === 1) {
		return "succeeded";
	}
	return returnCode !== null && returnCode > 1 ? "pending" : "failed";
}

/** Zalo's payment server APIs, each signed with the private key; the fetch decides whether they go through the relay. */
export function createZaloPaymentApi(
	options: ZaloPaymentApiOptions,
): ZaloPaymentApi {
	if (!APP_ID_PATTERN.test(options.appId)) {
		throw new Error("a Mini App id is 1 to 64 letters, digits, _ or -");
	}
	const base = (options.baseUrl ?? ZALO_PAYMENT_ORIGIN).replace(/\/+$/, "");
	const key = options.privateKey;
	const appId = options.appId;
	const sign = (text: string) =>
		hmacSha256Hex(key, `${text}&privateKey=${key}`);
	const send = async (
		path: string,
		init: { method: "GET" | "POST"; body?: string },
	) => {
		try {
			return await options.fetch(`${base}${path}`, {
				method: init.method,
				headers:
					init.body === undefined ? {} : { "content-type": "application/json" },
				...(init.body === undefined ? {} : { body: init.body }),
			});
		} catch (error) {
			if (error instanceof ProviderUnavailableError) {
				throw error;
			}
			throw new ProviderUnavailableError(
				"the Zalo payment API could not be reached",
			);
		}
	};
	return {
		async getOrderStatus(orderId) {
			if (!PLATFORM_ORDER_ID_PATTERN.test(orderId)) {
				throw new Error("a Zalo order id is 1 to 64 letters, digits, _ or -");
			}
			const mac = await sign(`appId=${appId}&orderId=${orderId}`);
			const query = new URLSearchParams({ appId, orderId, mac }).toString();
			const answer = await readAnswer(
				await send(`${GET_STATUS_PATH}?${query}`, { method: "GET" }),
				"getOrderStatus",
			);
			const returnCode =
				integerField(answer, "returnCode") ??
				integerField(answer, "resultCode");
			const processing = answer.isProcessing === true;
			const transId =
				stringField(answer, "transId") ??
				(typeof answer.transId === "number" ? String(answer.transId) : null);
			return {
				state:
					returnCode === 1
						? "paid"
						: returnCode === -1
							? "failed"
							: returnCode === 0 || processing
								? "processing"
								: "unknown",
				transId:
					transId !== null && TRANS_ID_PATTERN.test(transId) ? transId : null,
				amount: integerField(answer, "amount"),
				reference: referenceFromExtradata(stringField(answer, "extradata")),
				method: stringField(answer, "method"),
				message: stringField(answer, "returnMessage"),
			};
		},
		async createRefund(transId, amount, description) {
			if (
				!TRANS_ID_PATTERN.test(transId) ||
				!Number.isSafeInteger(amount) ||
				amount < 1
			) {
				throw new Error(
					"a refund names a transaction id and a whole amount from 1",
				);
			}
			const text = oneLine(description, DESCRIPTION_MAX);
			const mac = await sign(
				`appId=${appId}&transId=${transId}&amount=${amount}&description=${text}`,
			);
			const answer = await readAnswer(
				await send(REFUND_CREATE_PATH, {
					method: "POST",
					body: JSON.stringify({
						appId,
						transId,
						amount,
						description: text,
						mac,
					}),
				}),
				"createRefund",
			);
			const refundId =
				stringField(answer, "refundId") ??
				(typeof answer.refundId === "number" ? String(answer.refundId) : null);
			const state = refundState(integerField(answer, "returnCode"));
			const providerRefundId =
				refundId !== null && TRANS_ID_PATTERN.test(refundId) ? refundId : null;
			return state === "failed"
				? {
						state,
						providerRefundId,
						reason: oneLine(
							stringField(answer, "returnMessage") ?? "refund refused",
							200,
						),
					}
				: { state, providerRefundId };
		},
		async getRefundStatus(refundId) {
			if (!TRANS_ID_PATTERN.test(refundId)) {
				throw new Error("a refund id is 1 to 64 letters, digits or . _ : -");
			}
			const mac = await sign(`appId=${appId}&refundId=${refundId}`);
			const query = new URLSearchParams({ appId, refundId, mac }).toString();
			const answer = await readAnswer(
				await send(`${REFUND_STATUS_PATH}?${query}`, { method: "GET" }),
				"getRefundStatus",
			);
			const state = refundState(integerField(answer, "returnCode"));
			return state === "failed"
				? {
						state,
						providerRefundId: refundId,
						reason: oneLine(
							stringField(answer, "returnMessage") ?? "refund failed",
							200,
						),
					}
				: { state, providerRefundId: refundId };
		},
		async reportPurchase(orderId, resultCode) {
			if (!PLATFORM_ORDER_ID_PATTERN.test(orderId)) {
				throw new Error("a Zalo order id is 1 to 64 letters, digits, _ or -");
			}
			const mac = await sign(
				`appId=${appId}&orderId=${orderId}&resultCode=${resultCode}`,
			);
			const answer = await readAnswer(
				await send(PURCHASE_PAYMENT_PATH(appId), {
					method: "POST",
					body: JSON.stringify({ appId, orderId, resultCode, mac }),
				}),
				"purchase-payment",
			);
			const err = integerField(answer, "err") ?? integerField(answer, "error");
			return err === 0;
		},
	};
}

/** A status answer of the provider seam from Zalo's order status, checked against the attempt's reference. */
export function statusFromOrder(
	status: OrderStatus,
	platformOrderId: string,
): StatusAnswer {
	if (status.state === "processing") {
		return { state: "processing" };
	}
	if (status.state === "unknown") {
		return { state: "unknown" };
	}
	if (
		status.state === "paid" &&
		(status.transId === null || status.amount === null)
	) {
		return { state: "unknown" };
	}
	const event: PaymentEvent = {
		// a failed order may have no transaction: the order id stands in, so a repeat is still one outcome
		providerRef: status.transId ?? `order:${platformOrderId}`,
		amount: status.amount ?? 0,
		success: status.state === "paid",
		reason:
			status.state === "paid"
				? null
				: oneLine(`status: ${status.message ?? "failed"}`, 200),
		reference: status.reference,
		candidates: [],
		platformOrderId,
		occurredAt: null,
	};
	return status.state === "paid"
		? { state: "paid", event }
		: { state: "failed", event };
}
