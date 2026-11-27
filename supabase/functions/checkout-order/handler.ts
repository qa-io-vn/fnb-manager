import type { CreatedPayment, PaymentMethod } from "@fnb/payments";
import type { JsonObject } from "@fnb/sync";
import { bearerToken, type SupabaseBackend } from "@fnb/zalo";
import {
	type FunctionEnvironment,
	HttpError,
	json,
	type RequestContext,
	readJsonObject,
	requireMethod,
	serveFunction,
} from "../_shared/http.ts";
import {
	backendOf,
	paymentOrigins,
	providerOf,
	rpc,
} from "../_shared/payments.ts";

/**
 * checkout-order (ADR-067): the customer app (and the counter, for a walk-in's VietQR) opens an online payment here.
 * POST with the caller's Supabase session as the bearer token and JSON:
 *
 * - start: {action, order_id, method, idempotency_key, for?}. The function checks the session with Supabase Auth,
 *   asks the database to open or resume the attempt (checkout_begin: the customer's own order, or a counter order of
 *   a store the staff member works at), then has the provider make what the device needs: the createOrder parameters
 *   and their MAC (the Checkout SDK's private key never leaves the function) or the dynamic VietQR payload.
 * - link: {action, order_id, payment_id, platform_order_id}: Zalo's order id after createOrder or the bank-transfer
 *   popup, so a lost callback can be asked about and a paid transfer reported to Zalo.
 *
 * Nothing here marks anything paid: only the webhooks and the payments job do, with the provider's word.
 */

export const FUNCTION_NAME = "checkout-order";
export const MAX_BODY_BYTES = 4096;
const UUID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;
const PLATFORM_ORDER_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const START_FIELDS = ["action", "order_id", "method", "idempotency_key", "for"];
const LINK_FIELDS = [
	"action",
	"order_id",
	"payment_id",
	"platform_order_id",
	"for",
];

export interface CheckoutOrderDependencies {
	readonly backend?: SupabaseBackend;
	readonly log?: (line: string) => void;
	readonly requestId?: () => string;
}

type Body = Readonly<Record<string, unknown>>;

function field(body: Body, name: string, pattern: RegExp): string {
	const value = body[name];
	if (typeof value !== "string" || !pattern.test(value)) {
		throw new HttpError(400, "invalid_request");
	}
	return value;
}

function onlyFields(body: Body, allowed: readonly string[]): void {
	if (!Object.keys(body).every((name) => allowed.includes(name))) {
		throw new HttpError(400, "invalid_request");
	}
}

function forOf(body: Body): "customer" | "counter" {
	const value = body.for ?? "customer";
	if (value !== "customer" && value !== "counter") {
		throw new HttpError(400, "invalid_request");
	}
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function integer(value: unknown): number {
	const number = typeof value === "string" ? Number(value) : value;
	if (typeof number !== "number" || !Number.isSafeInteger(number)) {
		throw new HttpError(503, "backend_unavailable");
	}
	return number;
}

function text(value: unknown): string {
	if (typeof value !== "string") {
		throw new HttpError(503, "backend_unavailable");
	}
	return value;
}

function paymentAnswer(
	payment: Readonly<Record<string, unknown>>,
	created: CreatedPayment,
): JsonObject {
	return {
		id: text(payment.id),
		order_id: text(payment.order_id),
		method: text(payment.method),
		amount: integer(payment.amount),
		reference: text(payment.reference),
		expires_at: text(payment.expires_at),
		mode: text(payment.mode),
		checkout:
			created.checkout === null
				? null
				: {
						amount: created.checkout.amount,
						desc: created.checkout.desc,
						item: created.checkout.item.map((line) => ({
							id: line.id,
							amount: line.amount,
						})),
						extradata: created.checkout.extradata,
						method: created.checkout.method,
						mac: created.checkout.mac,
					},
		qr:
			created.qr === null
				? null
				: {
						payload: created.qr.payload,
						bank_bin: created.qr.bankBin,
						bank_name: created.qr.bankName,
						account_number: created.qr.accountNumber,
						account_name: created.qr.accountName,
						amount: created.qr.amount,
						reference: created.qr.reference,
						popup_method: created.qr.popupMethod,
					},
	};
}

async function start(
	backend: SupabaseBackend,
	user: string,
	body: Body,
	context: RequestContext,
): Promise<Response> {
	onlyFields(body, START_FIELDS);
	const method = body.method;
	if (method !== "zalo_checkout" && method !== "vietqr") {
		throw new HttpError(400, "invalid_request");
	}
	const request = {
		user_id: user,
		order_id: field(body, "order_id", UUID_PATTERN),
		method,
		idempotency_key: field(body, "idempotency_key", KEY_PATTERN),
		for: forOf(body),
	};
	if (request.for === "counter" && method !== "vietqr") {
		throw new HttpError(400, "invalid_request");
	}
	const answer = await rpc(backend, "checkout_begin", { p_request: request });
	if (!isRecord(answer)) {
		throw new HttpError(503, "backend_unavailable");
	}
	if (answer.state !== "pending") {
		const refusal =
			typeof answer.refusal === "string" ? answer.refusal : "not_payable";
		context.log(`start ${method} for ${request.for}: refused ${refusal}`);
		return json(
			{ state: "refused", refusal, replayed: false, payment: null },
			200,
		);
	}
	const payment = answer.payment;
	const order = answer.order;
	if (!isRecord(payment) || !isRecord(order)) {
		throw new HttpError(503, "backend_unavailable");
	}
	const { provider } = providerOf(answer.provider, context);
	const lines = Array.isArray(order.lines) ? order.lines : [];
	const created = await provider.createPayment({
		paymentId: text(payment.id),
		orderId: text(payment.order_id),
		method: payment.method as PaymentMethod,
		amount: integer(payment.amount),
		reference: text(payment.reference),
		expiresAt: text(payment.expires_at),
		description: typeof order.store_name === "string" ? order.store_name : "",
		lines: lines.filter(isRecord).map((line) => ({
			id: text(line.id),
			amount: integer(line.amount),
		})),
	});
	context.log(
		`start ${method} for ${request.for}: pending${answer.replayed === true ? " (replayed)" : ""}`,
	);
	return json(
		{
			state: "pending",
			refusal: null,
			replayed: answer.replayed === true,
			payment: paymentAnswer(payment, created),
		},
		200,
	);
}

async function link(
	backend: SupabaseBackend,
	user: string,
	body: Body,
	context: RequestContext,
): Promise<Response> {
	onlyFields(body, LINK_FIELDS);
	const answer = await rpc(backend, "checkout_link", {
		p_request: {
			user_id: user,
			order_id: field(body, "order_id", UUID_PATTERN),
			payment_id: field(body, "payment_id", UUID_PATTERN),
			platform_order_id: field(
				body,
				"platform_order_id",
				PLATFORM_ORDER_PATTERN,
			),
			for: forOf(body),
		},
	});
	if (
		!isRecord(answer) ||
		(answer.state !== "linked" && answer.state !== "refused")
	) {
		throw new HttpError(503, "backend_unavailable");
	}
	context.log(
		`link: ${answer.state}${answer.state === "refused" ? ` ${String(answer.refusal)}` : ""}`,
	);
	return json(
		{
			state: answer.state,
			refusal:
				answer.state === "refused"
					? typeof answer.refusal === "string"
						? answer.refusal
						: "unknown_payment"
					: null,
		},
		200,
	);
}

async function checkoutOrder(
	request: Request,
	context: RequestContext,
	dependencies: CheckoutOrderDependencies,
): Promise<Response> {
	requireMethod(request, "POST");
	const session = bearerToken(request.headers.get("authorization"));
	if (session === null) {
		throw new HttpError(401, "unauthorized");
	}
	context.protect(session);
	const { body } = await readJsonObject(request, MAX_BODY_BYTES);
	const backend = backendOf(context.environment, dependencies.backend);
	let user: string | null;
	try {
		user = await backend.sessionUser(session);
	} catch {
		throw new HttpError(503, "backend_unavailable");
	}
	if (user === null) {
		throw new HttpError(401, "unauthorized");
	}
	switch (body.action) {
		case "start":
			return start(backend, user, body, context);
		case "link":
			return link(backend, user, body, context);
		default:
			throw new HttpError(400, "invalid_request");
	}
}

export function handleCheckoutOrder(
	request: Request,
	environment: FunctionEnvironment,
	dependencies: CheckoutOrderDependencies = {},
): Promise<Response> {
	return serveFunction(
		request,
		environment,
		(incoming, context) => checkoutOrder(incoming, context, dependencies),
		{
			name: FUNCTION_NAME,
			origins: paymentOrigins(request, environment),
			...(dependencies.log === undefined ? {} : { log: dependencies.log }),
			...(dependencies.requestId === undefined
				? {}
				: { requestId: dependencies.requestId }),
		},
	);
}
